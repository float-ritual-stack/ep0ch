import { expandsEmbeds } from "./embed-policy";
import { valueLinkOccurrences } from "@ep0ch/outline-core/site-values";
import { C, fg, drawEllipsized, ellipsize } from "./style";
// Links in read mode, as Detail shows them: `((id))` and `[[address]]` become the target's title or the
// authored label, without delimiters; a missing target reads `label ◌` (MISSING_MARK), quiet in running text. The service
// resolves (`references.resolve`, `pages.resolve`); the door keeps the answers until the outline changes.
// Edit mode, comments and storage keep the raw text: this is presentation only.
import { tokensOf, type Source } from "./props";
import { COMPONENT_OPEN, componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { siteBlockAt } from "@ep0ch/outline-core/site-blocks";
import { ticketKeyReferences, type TicketPrefixes } from "@ep0ch/outline-core/work-ids";
import { emphasis } from "./inline";
import { ADORN, LINK_END, linkTag, STYLE, stripMarks } from "./style";
import type { ReferenceResolution, PageResolution, SocketBoard } from "./socket";
import type { StepRef } from "./steps";
import type { FigureControl } from "./graphs";
import type { DocImage, ImageControl } from "./doc";
import { isOutlineNote, type AuthoredLinksSnapshot, type AuthoredResourceLink } from "./authored";
import { resourceProviderKeys } from "./resource-providers";
import { codeHides, codeSpanRanges, structuralLiteralLines } from "@ep0ch/outline-core/code-ranges";
import { blockReferenceOccurrences, linkOccurrences, qualifiedReference, pageAddressText, referencesToResolve } from "@ep0ch/outline-core/link-syntax";
import { codeBlocks } from "@ep0ch/outline-core/code-fence";
import { propertyTokenMatches } from "@ep0ch/outline-core/property-grammar";
import { interpolationSpans } from "@ep0ch/outline-core/interpolation";
import { MAX_NOTE_VALUES, EMPTY_VALUE, hasWords, pairValues, problemWords, readerWords } from "@ep0ch/outline-core/site-values";
import type { SiteAnswer, SiteLink, SiteValue } from "@ep0ch/outline-core/site";

/** Markers around a resolved link / an unlinked missing one in prepared text; colourBody styles them. */
export const LINK_ON = "", MISSING_ON = "", LINK_OFF = "";
/** A link to the web, not to the outline: its own colour (the theme's `external`) and a ↗ after its label. */
export const EXTERNAL_ON = "";
export const isExternalUrl = (url: string) => /^https?:\/\//i.test(url);
export { stripMarks };

/** What a reference's answer is kept under: its target. Its label is how the note writes it, not what it resolves to. */
export const refKey = (id: string, fragment?: string, outline?: string) => `${outline ? outline + ":" : ""}${id}${fragment ? `^${fragment}` : ""}`;

/** Reference data and refusals must stay plain; reveal metadata belongs to drawing. */
export const shortId = (id: string) => id.length > 12 ? ellipsize(id, 9) : id;
/** The drawing counterpart; reference data and refusals use shortId. */
export const drawShortId = (id: string) => id.length > 12 ? drawEllipsized(id, 9) : id;

// ── what changed: a cached answer is asked again only when a change could have altered it ──────────

let tick = 0, allAt = 0, anyAt = 0, configAt = 0;
const changedAt = new Map<string, number>();
/**
 * The outline changed. `ids`: the blocks a change record names (an edit, a create), so only answers
 * about them are asked again (plus the ones any change can alter: missing pages, views, failures).
 * null: anything may have changed (a move or trash takes a subtree along; a reset; a service without
 * change records). `config`: the workspace may differ too (a reconnect), so its Work-ID prefix is re-read.
 */
export function outlineChanged(ids: readonly string[] | null, config = false) {
  tick++; anyAt = tick;
  if (config) configAt = tick;
  if (!ids || changedAt.size > 5000) { allAt = tick; changedAt.clear(); }
  for (const id of ids ?? []) { changedAt.delete(id); changedAt.set(id, tick); }
}
/** Now, for an answer being asked: later changes make it stale. */
export const changeClock = () => tick;
/** Did a block in `ids` (or everything) change after `at`? */
export function changedSince(at: number, ids: Iterable<string>): boolean {
  if (allAt > at) return true;
  for (const id of ids) if ((changedAt.get(id) ?? 0) > at) return true;
  return false;
}
/** Did anything change after `at`? */
export const anyChangeSince = (at: number) => anyAt > at;
/** Everything is asked again (a reset, or tests). Answers stay visible until re-read. */
export function invalidateReferences() { outlineChanged(null, true); }

interface Cached<T> { value: T | null; error?: string; at: number; asking: boolean }
const refsBy = new WeakMap<object, Map<string, Cached<Map<string, ReferenceResolution>>>>();
const pagesBy = new WeakMap<object, Map<string, Cached<PageResolution>>>();
const siteBy = new WeakMap<object, Map<string, Cached<{ answer: SiteAnswer | null; ms: number; text: string }>>>();

function ask<T>(by: WeakMap<object, Map<string, Cached<T>>>, src: Source | null | undefined, key: string, fetch: (b: SocketBoard) => Promise<T>, stale: (c: Cached<T>) => boolean): Cached<T> | null {
  if (!src) return null;
  let cache = by.get(src.board);
  if (!cache) by.set(src.board, (cache = new Map()));
  const hit = cache.get(key);
  if (hit && (hit.asking || !stale(hit))) return hit;
  const at = tick, c = cache;
  const entry: Cached<T> = { value: hit?.value ?? null, error: hit?.error, at, asking: true };
  cache.set(key, entry);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  Promise.resolve().then(() => fetch(src.board)).then(v => { c.set(key, { value: v, at, asking: false }); src.redraw(); },
    (e: Error) => { c.set(key, { value: hit?.value ?? null, error: e.message, at, asking: false }); src.redraw(); });
  return entry;
}

const BLOCK_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/**
 * The references a note's text holds, in one canonical form: every `((…))`, and each bare block id (a
 * `[related-to::<id>]` value) as `((id))`. The note's links, its body and its property panel all look
 * their targets up in this one answer, so a note's references are resolved once.
 */
function refsOf(text: string): { text: string; ids: string[] } {
  const refs = new Set<string>(), ids = new Set<string>();
  let rest = "", at = 0;
  // A figure's cells name notes too (PIE-1334): found as prose's are, code still left out.
  for (const r of referencesToResolve(text)) {
    refs.add(`((${refKey(r.blockId, r.fragmentId, r.outline)}))`); ids.add(r.blockId);
    rest += text.slice(at, r.start) + " "; at = r.end;
  }
  for (const m of (rest + text.slice(at)).matchAll(BLOCK_ID)) { refs.add(`((${m[0]}))`); ids.add(m[0]); }
  return { text: [...refs].sort().join(" "), ids: [...ids] };
}

/**
 * Every `((…))` in `text` (a note's whole text) as the service reads it (outline-core's scan), keyed by its
 * target (refKey: the id and fragment, never the label); also its bare block ids, keyed by id. null while the first answer is on its way. Asked again only when one of those
 * blocks changes.
 */
export function referencesIn(text: string, src: Source | null | undefined): Map<string, ReferenceResolution> | null {
  const refs = refsOf(text);
  if (!refs.text) return new Map();
  return ask(refsBy, src, refs.text, async b => {
    const answers = await b.resolveReferences(refs.text), byKey = new Map(answers.map(r => [refKey(r.blockId, r.fragmentId, r.requestedOutline), r]));
    // One answer per reference asked, in order, each naming the whole id: a reference written by its short id
    // (`((0a1b2c3d|label))`, PIE-1334) is found by what was written too.
    const asked = blockReferenceOccurrences(refs.text);
    if (asked.length === answers.length) asked.forEach((q, k) => { const key = refKey(q.blockId, q.fragmentId, q.outline); if (!byKey.has(key)) byKey.set(key, answers[k]!); });
    return byKey;
    // Asked again when a note it names changes: a short id's change is told by the whole id it resolved to (PIE-1334).
  }, c => changedSince(c.at, c.value ? [...refs.ids, ...[...c.value.values()].map(r => r.blockId)] : refs.ids))?.value ?? null;
}

type CommentSubject = { kind: "block"; blockId: string } | { kind: "resource"; resourceId: string };
type CommentTarget = { representation: { subject: CommentSubject } };
const commentSubjects = new WeakMap<object, Map<string, Cached<CommentSubject>>>();
/** The service owns a comment's subject, including replies whose parent is another comment. */
export function commentSubject(id: string, src: Source | null) {
  return ask(commentSubjects, src, id, async board => {
    const r = await board.request<{ originalTarget: CommentTarget; resolvedTarget: CommentTarget | null }>("annotations.get", { annotationId: id });
    return (r.resolvedTarget ?? r.originalTarget).representation.subject;
  }, c => anyChangeSince(c.at));
}

const scopeBy = new WeakMap<object, Map<string, Cached<TicketPrefixes>>>();
/**
 * Which prefixes make a bare `LETTERS-digits` a Work ID link in this outline (#429): its configured prefix and the
 * prefixes in use, as the service says them; null while asked (or when it couldn't be).
 */
export function ticketPrefixesOf(src: Source | null | undefined): TicketPrefixes | null {
  // Configuration, as the prefix is: asked again after a reconnect or reset (a prefix first used since shows then).
  const c = ask(scopeBy, src, "scope", b => b.ticketPrefixes(), c => configAt > c.at || (!!c.error && anyChangeSince(c.at)));
  return c?.value ?? null;
}

const prefixBy = new WeakMap<object, Map<string, Cached<string | null>>>();
/** The workspace's Work-ID prefix: a string, null when none is configured (or unknown), undefined until asked. */
export function workIdPrefix(src: Source | null | undefined): string | null | undefined {
  // Configuration, not content: asked again after a reconnect or reset, or after a change when it failed.
  const c = ask(prefixBy, src, "prefix", b => b.workIdPrefix(), c => configAt > c.at || (!!c.error && anyChangeSince(c.at)));
  if (!c) return null;
  return c.value !== null || !c.asking ? c.value : undefined;
}

/**
 * What `[[address]]` points at; null while asking (or when it couldn't be asked). A found page is asked
 * again when its block changes; a missing one after any change (any edit or create can add the address).
 */
export function pageOf(address: string, src: Source | null | undefined): PageResolution | null {
  return ask(pagesBy, src, address.trim().toLowerCase(), b => b.resolvePage(address.trim()),
    c => (c.value?.block ? changedSince(c.at, [c.value.block.id]) : anyChangeSince(c.at)) || (c.value?.status !== "resolved" && anyChangeSince(c.at)))?.value ?? null;
}

/**
 * What the `{{ }}` of note `blockId` read as, from the service's `site.answer` (the door resolves nothing itself); null
 * while asked, for a note with no placeholders, and when the service can't answer. `draft`: the note's unsaved text.
 * Asked again when a note it was computed from changes, any change when it looked for a page that isn't there, and each
 * minute for a value that reads the clock.
 */
function siteRead(blockId: string, text: string, src: Source | null | undefined, draft: boolean, call?: SiteCall): { answer: SiteAnswer | null; current: boolean } {
  if (!text.includes("{{") || !interpolationSpans(text).length) return { answer: null, current: true };
  // A draft is asked for under its note's own key, so one read is in flight at a time as the person types (the answer of the
  // text before is drawn meanwhile): asked again only when the draft is no longer the text that was read.
  // A template's body is read in the call that draws it (its chain and props), under a key of its own: one note, many hosts.
  const callKey = call && (call.chain?.length || call.props) ? `\0${JSON.stringify([call.chain, call.props])}` : "";
  const entry = ask(siteBy, src, `${blockId}${draft ? "\0draft" : ""}${callKey}`, async b => {
    // A failed read is an answer of none, kept with the text it was for: a change (or more typing) asks again.
    try { return { answer: await b.siteAnswer(blockId, draft ? text : undefined, call) as SiteAnswer | null, ms: Date.now(), text }; }
    catch { return { answer: null, ms: Date.now(), text }; }
  }, c => !c.value ? true
      : (draft && c.value.text !== text) ? true
      : !c.value.answer ? anyChangeSince(c.at)
      : changedSince(c.at, c.value.answer.deps) || (!!c.value.answer.anyChange && anyChangeSince(c.at))
        || (c.value.answer.clock === "minute" && Math.floor(c.value.ms / 60000) !== Math.floor(Date.now() / 60000)));
  const answer = entry?.value?.answer ?? null;
  return { answer, current: !!entry && !entry.asking && !!entry.value && (!draft || entry.value.text === text) };
}

/** Where a note is drawn, for its `{{ }}`: the invocations that draw it (a `::use`) and that call's props (`props.*`). */
export interface SiteCall { chain?: SiteLink[]; props?: Record<string, string[]> }

export const siteAnswerOf = (blockId: string, text: string, src: Source | null | undefined, draft = false, call?: SiteCall): SiteAnswer | null => siteRead(blockId, text, src, draft, call).answer;


/** The text has a `{{ }}` whose answer isn't read yet for this very text (being read, or the draft has moved on): a drawing of it is not final. */
export const siteAnswerWaiting = (blockId: string, text: string, src: Source | null | undefined, draft = false, call?: SiteCall): boolean =>
  !!src && !siteRead(blockId, text, src, draft, call).current;

/**
 * Only a cheap guard, so a note without a bracketed resource-shaped property costs no request: the keys
 * pi-herdr-outliner's `authoredResourceReferenceOccurrences` (src/resource-references.ts) reads as resources.
 * The service decides which tokens are.
 */
const MAY_HAVE_RESOURCE_TOKEN = /\[(?:file|web|app|raw-capture|before-rewrite)::/i;
/** A bracketed token of a resource provider the service lists (`[jira::KEY]`). */
const mayHaveProviderToken = (text: string) => resourceProviderKeys().some(key => text.toLowerCase().includes(`[${key}::`));
const authoredBy = new WeakMap<object, Map<string, Cached<AuthoredLinksSnapshot>>>();
/** A resource token in a note's text as the service found it: its exact text there, and the service's entry. */
export interface ResourceToken { raw: string; link: AuthoredResourceLink }
/**
 * The bracketed resource tokens in note `m` (`[file::…]`, `[jira::KEY]`), as the service's authored links
 * name them (`blocks.authored-links`: which tokens are resources, and where each points). The door finds each
 * by the exact text the service's span covers; it never decides what a resource token is. [] while asking,
 * and for a note that has none. Asked again when the note changes.
 */
export function resourceTokensOf(m: { id: string; text: string }, src: Source | null | undefined): ResourceToken[] {
  if ((!MAY_HAVE_RESOURCE_TOKEN.test(m.text) && !mayHaveProviderToken(m.text)) || !isOutlineNote(m as never)) return [];
  const s = ask(authoredBy, src, m.id, b => b.authoredLinks(m.id), c => changedSince(c.at, [m.id]))?.value;
  if (s?.kind !== "ready") return [];
  return s.resources.entries.flatMap(link => {
    const raw = m.text.slice(link.firstSpan.start, link.firstSpan.end);
    return raw.startsWith("[") && raw.endsWith("]") && raw.includes("::") && !raw.includes("\n") ? [{ raw, link }] : [];
  });
}

export interface LinkView { text: string; missing: boolean }
/** What a link points at: a block (and fragment), or a page or Work ID; `label` as the note wrote it. */
/**
 * Where a link goes. `role`: what the reader drew it as, when it isn't a link in the text (PIE-441): an
 * embed's title (`embed`), or a row that stands for a note (`row`: a live figure's row, an embedded
 * view's result). Two links to the same place are the same link whatever their role.
 */
/**
 * What a drawn link opens. `role`: an embed's title, a row that stands for a note, or a resource
 * projection's head (src/projection.ts), whose `url` is the ticket's page and `reason` says why there is
 * none.
 */
export type LinkTarget = {
  outline?: string;
  machine?: string;
  inlineList?: { key: number; row: number };
  /**
   * A `{{ }}` the note reads (PIE-533 S2), as the service answered it: ⏎ or a click shows where its value is written (`block`,
   * `at` and `atLabel` light that line), or says it is computed. `problem` is why it has no value.
   */
  value?: { expression: string; words: string; problem?: string; route: string };
  /** A `#tag` (PIE-800), its value as the service's parser read it (`garden/beds`): it opens the notes carrying the tag. */
  tag?: string;
  query?: string;
  /** A resource token (`[file::…]`, `[jira::KEY]`): its Resource is shown as a note, as the tree's resource rows are. */
  resource?: AuthoredResourceLink;
  /** A Resource an extension's view links to (PIE-754): `file:/path`, `web:https://…` or `resource:<id>`. */
  resourceRef?: string;
  /** With `block`: open it at this revision, beside how it is now (PIE-1433; a live table's `at:` row). */
  revision?: number;
  block?: string; fragment?: string; at?: number; atLabel?: string; /** With `at`: what the lit line is (a `::fields` row's: "the line it was written on"). */ atSays?: string; label?: string; page?: string; media?: string; url?: string; role?: "embed" | "row" | "resource" | "task" | "control" | "callout" | "figure" | "image" | "picture"; reason?: string;
  /**
   * A live figure's control (role "figure"): one of a tabs figure's tabs, or its density; on a row (role "row"), the
   * figure the row is in (`figure` only), so the figure's keys work while the row is current (src/graphs.ts).
   */
  figure?: FigureControl;
  /** The service answered that nothing is at this address (drawn `label ◌`): a page not written yet, a gone id (PIE-1455). */
  missing?: true;
  /** A grid's cell (role "row": a live calendar's day, an activity cell): one click opens it, a row's selects (PIE-1457). */
  cell?: true;
  /**
   * The `¶` on a `::fields` row (role "row"): it anchors that row's line when pressed (`fields.anchor`): the `::fields` of
   * that `key`, its `n`th row.
   */
  anchor?: { key: string; n: number };
  /**
   * The offer on a `::use` that needs a prop (role "control", src/template-use.ts): ⏎ or a click asks for what it needs, in the
   * power bar, and writes the answers onto the call's line (`use.fill` on that `line` of `block`).
   */
  use?: { block: string; line: number };
  /**
   * An agent's open proposal (PIE-501): on its embed's source line, the proposal it shows; with `op`, one of
   * the controls drawn there (role "control"), which runs `proposal.apply` or `proposal.dismiss` on it.
   */
  proposal?: { id: string; op?: "apply" | "dismiss" | "resolve" };
  /**
   * A control on an `■ unsent` line (role "control", src/unsent.ts): what's put aside on note `of` (its edit, a comment,
   * a note under it, a card), and which of its actions it runs (`unsent.diff`, `.copy`, `.dismiss`, `.add`, `.keep`, `.show`).
   */
  unsent?: { of: string; kind: "edit" | "comment" | "child" | "card"; op: "diff" | "copy" | "dismiss" | "add" | "keep" | "show" };
  /**
   * An extension's line (PIE-512): its head and its controls (role "control") run `action` on it, an
   * `ext.<id>.<action>` or `projection.refresh` (r: run it again, ask the agent again). `extension` and
   * `handler` say whose line it is, so the reader finds the keys its actions answer to.
   */
  ext?: { block: string; line: number; action: string; extension: string; handler: string };
  /** A form field drawn in the reader: mouse placement uses its shared editor. */
  form?: { field: string };
  /**
   * A press (PIE-957): a `::button`, or a view's button, badge, card, text or table row that carries an action line (role
   * "control"). ⏎ and a click run `act` through the door's one dispatcher as the person, on the note `block` (the script's `this`).
   */
  /** `label`: a `::button`'s words, so its press's state stays with it when an edit moves lines (PIE-1415). */
  press?: { act: string; steps?: readonly import("@ep0ch/outline-core/button-call").ButtonStep[]; alt?: string; block: string; line: number; label?: string };
  /** A ticket's age (PIE-445): following it refreshes the tickets this block shows (`projection.refresh`). */
  refresh?: string;
  /** With `refresh`: only the ticket under this line of that block (its index in the note's text). */
  refreshLine?: number;
  /** A checklist step's box (role "task", PIE-472): the step, where it is, and the revision it was read at. */
  task?: StepRef;
  /** A row of a step's open status choice (role "task") or of a callout's type choice (role "callout"): which, from 0. */
  choice?: number;
  /** A callout's icon or type (role "callout", PIE-538): ⏎ or a click opens its type choice. */
  callout?: CalloutRef;
  /**
   * An inline list's (PIE-693, PIE-747: a `::links` component, an extension's `list` view): on a row (role "row"), the
   * list (its key) and the row's id, so the `[ ]` position on it selects it there and its preview follows; alone
   * (role "control"), its `⏎ in` control.
   */
  listRow?: { key: string; row?: string };
  /** A list row's `copy` or `insert` activation (PIE-747): ⏎ puts the text on the clipboard, or into the person's open draft. */
  listText?: { copy: string } | { insert: string };
  /**
   * An image (PIE-532): on its `[ ]` element (with `media`), the image the keys change; on a control of its caption
   * (role "image", with `control`), what a click on it changes.
   */
  image?: ImageRef;
  /**
   * An extension view's picture (PIE-827, role "picture"): the tag on its first row, where the reader places it once the
   * view is laid out (its row and column are where the tag landed).
   */
  picture?: DocImage;
};

/**
 * An image line as the reader drew it: the note, the line's index in the note and how it read (a change is checked
 * against that line), the file it names, and on a caption's control, which change it makes.
 */
export interface ImageRef { block: string; line: number; source: string; path: string; control?: ImageControl }

/**
 * A callout as the reader drew it: the note, its header's note line and how that line read (a change is checked
 * against that line, and written at the revision the service has now), and its fold point's key when it has one.
 */
export interface CalloutRef { block: string; line: number; header: string; type: string; fold: "+" | "-" | null; foldKey: string | null }

/** The mark after a link whose target doesn't exist yet: one quiet glyph, not words, so a note full of
 * not-yet pages stays readable. Selecting or clicking the link says what it is and offers to make it. */
export const MISSING_MARK = "◌";

/** How a `((…))` reads: the label or title (with `^fragment`), and what's wrong with it, as Detail says it. */
export function refView(id: string, fragment: string | undefined, label: string | undefined, r: ReferenceResolution | undefined): LinkView {
  if (!r) return { text: label ?? shortId(id) + (fragment ? `^${fragment}` : ""), missing: false };
  if (r.status === "missing") return { text: `${label ?? shortId(id)} ${MISSING_MARK}`, missing: true };
  const title = (label ?? r.title ?? shortId(id)) + (label === undefined && fragment ? `^${fragment}` : "");
  const suffix = r.status === "deleted" ? " · Trash" : r.status === "stale" ? " · Missing fragment" : r.status === "duplicate" ? " · Duplicate fragment" : "";
  return { text: (r.outline ? `${r.outline} · ` : "") + title + suffix, missing: false };
}

/** How a `[[address]]` reads: its label or address, followed by MISSING_MARK when no page has it yet. */
export function pageView(address: string, label: string | undefined, r: PageResolution | null): LinkView {
  const q = qualifiedReference(address);
  const text = (q.outline ? `${q.outline} · ` : "") + (label ?? pageAddressText(q.target)).trim();
  if (r?.status === "missing") return { text: `${text} ${MISSING_MARK}`, missing: true };
  return { text: text + (r?.status === "deleted" ? " · Trash" : ""), missing: false };
}

/**
 * Body text with links replaced by how they read, between markers colourBody styles. Code fences and
 * inline code keep their text. Transclusions (`!((…))`) are left for the renderer when `embeds` is on
 * (it nests them as the service projects them); off (a component's labels, a list's digest) they read as
 * a link that says it isn't expanded there.
 */
/** The note's `#tags` as the service's parser reads them (never re-derived here), each with where it may stand in a line. */
function tagsIn(noteText: string, src: Source | null | undefined): { raw: string; value: string; re: RegExp }[] {
  const parsed = src ? tokensOf(noteText, src) : null;
  if (parsed?.state !== "ready") return [];
  const values = [...new Set((parsed.tokens ?? []).filter(t => t.syntax === "hashtag").map(t => t.value))];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  // At a word's start, and not the head of a longer tag (`#bike` in `#bikes`, `#garden` in `#garden/beds`).
  return values.map(value => ({ raw: `#${value}`, value, re: new RegExp(`(^|[\\s(])#${esc(value)}(?![\\p{L}\\p{M}\\p{N}_/-])`, "gu") }));
}

/** A value's words with the characters inline Markdown would take for emphasis kept as typed. */
const plainWords = (words: string) => words.replace(/[*_~\\]/g, "\\$&");

/**
 * A line of words that may name notes (a status message, a refusal): each labelled reference said as its label, as a
 * reader draws one (`((id|Seed order))` reads "Seed order", PIE-1439), by outline-core's one scan; an unlabelled one stays
 * as written, since its id is all it says. For one row of words with no note to resolve against; a note is presentLinks'.
 */
export function referenceWords(text: string): string {
  let out = "", at = 0;
  for (const r of blockReferenceOccurrences(text, "inline")) {
    if (r.label === undefined) continue;
    out += text.slice(at, r.start) + r.label;
    at = r.end;
  }
  return at ? out + text.slice(at) : text;
}

/**
 * `site`: the note this text is drawn for. Its `{{ }}` are drawn as the service's `site.answer` reads them (PIE-533 S2):
 * the value in place, in italics as computed (a URL as a link), or an unresolved one dimmed as typed with the nearest key.
 * Each is an element: ⏎ or a click shows the line the value is written on. Without `site`, or while the answer is on its
 * way, a placeholder stays as typed. `draft`: the text is the note's unsaved one.
 */
export function presentLinks(text: string, embeds: boolean, src: Source | null | undefined, noteText = text, sink?: LinkTarget[], resources: readonly ResourceToken[] = [], site?: { block: string; draft?: boolean; call?: SiteCall }, literal: { properties?: boolean } = {}): string {
  embeds = expandsEmbeds(embeds);
  // `noteText`: the whole note `text` was cut from, so it shares that note's one references answer.
  const resolved = referencesIn(noteText, src) ?? new Map<string, ReferenceResolution>();
  // Fence lines and the code between them are left as typed, links and Markdown alike. So is a component block
  // (a live figure, an inline `::links`, from its first line to its `::` as outline-core finds it): its YAML is its
  // question, and a `view: ((id))` or `of: ((id))` in it must still name the id when it's read (src/live.ts,
  // src/links.ts); drawn as a link, the id would be gone.
  const lines = text.split("\n"), typed = noteStructure(lines);
  const tags = tagsIn(noteText, src);
  // A bare Work ID where the outline uses its prefix (#429): a link to its item, as `[[PIE-795]]` is; one the outline
  // has no item for stays text.
  const scope = src ? ticketPrefixesOf(src) : null;
  // A fence inside a callout or quote is code too (PIE-690): its lines stay as typed.
  for (const span of structuralLiteralLines(lines)) for (let j = span.start; j <= span.end; j++) if (typed[j]! < 0) typed[j] = span.start;
  // A `::fields{…}` standing alone on its line is no component block (it has no closing `::`), but its `of=((id))` is
  // its question as much as a figure's `of: ((id))` is: drawn as a link it would name a title, not the id.
  lines.forEach((line, i) => { if (typed[i]! < 0 && line.trimStart().startsWith("::fields") && siteBlockAt(lines, i)) typed[i] = i; });
  // An `::if` body is the note's own prose, shown while the query holds: its words are presented as any line's are. A
  // body holding a figure, a fence or another component keeps the whole block as typed.
  for (const block of componentBlocks(lines)) {
    if (block.name !== "if") continue;
    const body = lines.slice(block.start + 1, block.end);
    if (body.some(l => COMPONENT_OPEN.test(l) || /^\s*---\s*$/.test(l)) || codeBlocks(body).fences.length) continue;
    for (let j = block.start + 1; j < block.end; j++) if (typed[j] === block.start) typed[j] = -1;
  }
  // A `{{ }}` as the reader draws it: tagged as an element of its own, never in a link's colour unless it is a URL.
  const drawValue = (raw: string, v: SiteValue, block: string, label?: string): string => {
    const words = readerWords(raw, v);
    const shown = label ?? words;
    const resolved = hasWords(v);
    const near = v.problem && !resolved ? problemWords(v) : undefined;
    const to: LinkTarget = {
      value: { expression: v.expression, words, ...(near ? { problem: near } : {}), route: v.route.join(" → ") },
      label: v.expression,
      ...(v.source ? { block: v.source.block, at: v.source.start, ...(v.source.mark ? { atLabel: v.source.mark } : {}) } : v.from && v.from !== block ? { block: v.from } : {}),
    };
    const [on, off] = sink ? [linkTag(sink.push(to) - 1), LINK_END] : ["", ""];
    if (!current) return fg(C.dark) + on + plainWords(shown) + off + LINK_OFF;
    if (!resolved) return MISSING_ON + on + plainWords(shown) + off + LINK_OFF;
    const url = (v.values ?? []).length === 1 && isExternalUrl(v.values![0]!);
    // Computed, so lightly marked: italic; a URL is a link's colour instead.
    return url ? EXTERNAL_ON + on + plainWords(shown) + off + LINK_OFF
      : STYLE.italic[0] + on + plainWords(shown === "" ? EMPTY_VALUE : shown) + off + STYLE.italic[1];
  };
  // With a sink, each link is also tagged with its place in it, so a click can find it (PIE-415).
  const mark = (v: LinkView, to: LinkTarget, external = false) => {
    const [on, off] = sink ? [linkTag(sink.push(v.missing ? { ...to, missing: true } : to) - 1), LINK_END] : ["", ""];
    const block = to.block;
    const text = block && to.label === undefined
      ? v.text.replace(shortId(block), () => drawShortId(block)) : v.text;
    return (v.missing ? MISSING_ON : external ? EXTERNAL_ON : LINK_ON) + on + text + off + (external ? ADORN + "↗" : "") + LINK_OFF;
  };
  // The `{{ }}` of the text, where the scan finds them, paired with the service's answers (none until it has answered).
  const { answer, current } = site ? siteRead(site.block, noteText, src, !!site.draft, site.call) : { answer: null, current: true };
  const pairs = answer ? pairValues(text, answer.values.slice(0, MAX_NOTE_VALUES)).filter(p => p.value) : [];
  let lineStart = 0;
  return lines.map((line, i) => {
    const from = lineStart;
    lineStart += line.length + 1;
    if (typed[i]! >= 0) return line;
    // Each link where outline-core's scan finds it, spliced in by its offsets; code spans keep their text.
    // `literal.properties`: a `[key::value]` is kept as written too (PIE-1455): a message's fix reads as what to type.
    const code = literal.properties ? [...codeSpanRanges(line), ...propertyTokenMatches(line)] : codeSpanRanges(line);
    const spans: { start: number; end: number; draw: () => string }[] = [];
    for (const p of pairs) if (p.start >= from && p.end <= from + line.length) {
      spans.push({ start: p.start - from, end: p.end - from, draw: () => drawValue(line.slice(p.start - from, p.end - from), p.value!, site!.block) });
    }
    // A resource token the service names reads as itself without its brackets, and shows its Resource.
    for (const t of resources) for (let at = line.indexOf(t.raw); at >= 0; at = line.indexOf(t.raw, at + t.raw.length))
      spans.push({ start: at, end: at + t.raw.length, draw: () => mark({ text: t.raw.slice(1, -1), missing: false }, { resource: t.link, label: t.link.label }) });
    if (scope) for (const t of ticketKeyReferences(line, scope)) {
      const r = pageOf(t.workId, src);
      if (r?.status === "missing") continue;
      spans.push({ start: t.start, end: t.end, draw: () => mark(pageView(t.workId, t.workId, r), { page: t.workId, label: t.workId }) });
    }
    // A `#tag` the service reads as a tag (PIE-800): a link to the notes carrying it, where it starts a word.
    for (const tag of tags) for (const m of line.matchAll(tag.re)) {
      const start = m.index! + m[1]!.length;
      spans.push({ start, end: start + tag.raw.length, draw: () => mark({ text: tag.raw, missing: false }, { tag: tag.value, label: tag.raw }) });
    }
    const built = valueLinkOccurrences(line, answer?.values ?? [], code);
    const links = linkOccurrences(line, code).filter(l => !built.some(b => b.start < l.end && l.start < b.end));
    for (const b of built) {
      if (b.link) links.push(b.link);
      else spans.push({ ...b, draw: () => b.values.length ? b.values.map(v => drawValue(`{{${v.expression}}}`, v, site!.block)).join(", ") : fg(C.dark) + plainWords(line.slice(b.start, b.end)) + LINK_OFF });
    }
    const sourceMark = (l: typeof links[number]) => built.find(b => b.link === l)?.values.map(v => " " + drawValue(`{{${v.expression}}}`, v, site!.block, "¶")).join("") ?? "";
    for (const l of links) {
      if (l.kind === "markdown") {
        // `[review layout](act: layout.load name=review)` (PIE-957) is a press: its text runs the action line as the person.
        const act = /^act:\s*(\S.*)$/.exec(l.url.trim())?.[1]?.trim();
        if (act) spans.push({ ...l, draw: () => mark({ text: emphasis(l.text), missing: false }, { role: "control", label: l.text, press: { act, block: site?.block ?? "", line: i } }) });
        // A Markdown link reads as its text and opens its destination (a web page, or a pi-outliner:// link). A `{{ }}`
        // in its destination (`[pew]({{this.src}})`) is filled from the note's values first: the link opens what the
        // value reads; one that has no single value yet is drawn missing, with the value's words as its label.
        else {
          const inner = pairs.filter(p => p.start >= from + l.start && p.end <= from + l.end && p.value);
          let url = l.url, unresolved = false;
          for (const p of inner) {
            const raw = line.slice(p.start - from, p.end - from), vals = p.value!.values ?? [];
            if (!url.includes(raw)) continue;
            if (vals.length !== 1 || !hasWords(p.value!)) { unresolved = true; continue; }
            url = url.replace(raw, vals[0]!);
          }
          spans.push({ ...l, draw: () => mark({ text: emphasis(l.text), missing: unresolved }, { url, label: l.text }, !unresolved && isExternalUrl(url)) });
        }
      } else if (l.kind === "page") {
        // `![[page^anchor]]` (PIE-1247) is left as written where embeds are drawn: the reader expands it (doc.ts).
        if (l.embed && embeds) continue;
        const to: LinkTarget = { page: l.displayAddress, ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
        const v = pageView(l.displayAddress, l.label, pageOf(l.displayAddress, src));
        // `[[page^anchor]]` reads as the page and the anchor it opens at, as `((id^anchor))` does.
        const shown = l.fragmentId && l.label === undefined ? { ...v, text: `${v.text}^${l.fragmentId}` } : v;
        spans.push({ ...l, draw: () => (l.embed ? `!${mark(shown, to)} · embed not expanded here` : mark(shown, to)) + sourceMark(l) });
      } else if (l.embed && embeds && built.some(b => b.link === l)) {
        spans.push({ ...l, draw: () => built.find(b => b.link === l)!.text! + sourceMark(l) });
      } else if (!l.embed || !embeds) {
        const answer = resolved.get(refKey(l.blockId, l.fragmentId, l.outline));
        const v = refView(l.blockId, l.fragmentId, l.label, answer);
        // A reference written by its short id (`((0a1b2c3d|label))`) follows the whole id the service resolved it to
        // (PIE-1334): `board.get` takes only a whole one.
        const to: LinkTarget = { block: answer?.status === "resolved" && answer.blockId.length > l.blockId.length ? answer.blockId : l.blockId, ...(answer?.outline || l.outline ? { outline: answer?.outline ?? l.outline, machine: answer?.machine } : {}), ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
        spans.push({ ...l, draw: () => (l.embed ? `!${mark(v, to)} · embed not expanded here` : mark(v, to)) + sourceMark(l) });
      }
    }
    let out = "", at = 0;
    for (const s of spans.sort((a, b) => a.start - b.start)) {
      if (s.start < at || codeHides(s, code)) continue;
      out += line.slice(at, s.start) + s.draw();
      at = s.end;
    }
    return emphasis(out + line.slice(at));
  }).join("\n");
}
