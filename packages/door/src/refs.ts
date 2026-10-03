// Links in read mode, as Detail shows them: `((id))` and `[[address]]` become the target's title or the
// authored label, without delimiters; a missing target reads `label · Missing target`. The service
// resolves (`references.resolve`, `pages.resolve`); the door keeps the answers until the outline changes.
// Edit mode, comments and storage keep the raw text: this is presentation only.
import type { Source } from "./props";
import { emphasis } from "./inline";
import { LINK_END, linkTag, stripMarks } from "./style";
import type { ReferenceResolution, PageResolution, SocketBoard } from "./socket";
import type { StepRef } from "./steps";
import { isOutlineNote, type AuthoredLinksSnapshot, type AuthoredResourceLink } from "./authored";
import { linkBlockLines } from "./links";

/** The service's exact reference: `((id))`, `((id^fragment))`, `((id|label))`, `((id^fragment|label))`. */
export const REF = /\(\(([A-Za-z0-9_-]{8,})(?:\^([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?(?:\|((?:(?!\)\))[^\r\n])+))?\)\)/g;
/** A transclusion (Detail's pattern: no label). */
export const EMBED = /!\(\(([A-Za-z0-9_-]{8,})(?:\^([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?\)\)/g;
/** A symbolic link, `[[address]]` or `[[address|label]]`. */
export const PAGE = /\[\[([^\]|\r\n]+)(?:\|([^\]\r\n]+))?\]\]/g;
/** A Markdown link, `[text](destination)`, not an image (the service's pattern: src/authored-links.ts). */
export const MD_LINK = /(?<!!)\[([^\[\]\r\n]*)\]\(([^)\r\n]*)\)/g;

/** Markers around a resolved link / an unlinked missing one in prepared text; colourBody styles them. */
export const LINK_ON = "", MISSING_ON = "", LINK_OFF = "";
export { stripMarks };

export const refKey = (id: string, fragment?: string, label?: string) => `${id}${fragment ? `^${fragment}` : ""}${label !== undefined ? `|${label}` : ""}`;
/** An id cut to its first eight characters and …, once it is longer than twelve (a link's, an embed's, a property's). */
export const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

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
  for (const m of text.matchAll(REF)) { refs.add(m[0]); ids.add(m[1]!); }
  for (const m of text.replace(REF, " ").matchAll(BLOCK_ID)) { refs.add(`((${m[0]}))`); ids.add(m[0]); }
  return { text: [...refs].sort().join(" "), ids: [...ids] };
}

/**
 * Every `((…))` in `text` (a note's whole text) as the service reads it, keyed by refKey; also its bare
 * block ids, keyed by id. null while the first answer is on its way. Asked again only when one of those
 * blocks changes.
 */
export function referencesIn(text: string, src: Source | null | undefined): Map<string, ReferenceResolution> | null {
  const refs = refsOf(text);
  if (!refs.text) return new Map();
  return ask(refsBy, src, refs.text, async b => new Map((await b.resolveReferences(refs.text)).map(r => [refKey(r.blockId, r.fragmentId, r.label), r])),
    c => changedSince(c.at, refs.ids))?.value ?? null;
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
 * Only a cheap guard, so a note without a bracketed resource-shaped property costs no request: the keys
 * pi-herdr-outliner's `authoredResourceReferenceOccurrences` (src/resource-references.ts) reads as resources.
 * The service decides which tokens are.
 */
const MAY_HAVE_RESOURCE_TOKEN = /\[(?:file|web|jira|app|raw-capture|before-rewrite)::/i;
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
  if (!MAY_HAVE_RESOURCE_TOKEN.test(m.text) || !isOutlineNote(m as never)) return [];
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
  /** A resource token (`[file::…]`, `[jira::KEY]`): its Resource is shown as a note, as the tree's resource rows are. */
  resource?: AuthoredResourceLink;
  block?: string; fragment?: string; label?: string; page?: string; media?: string; url?: string; role?: "embed" | "row" | "resource" | "task" | "control" | "callout"; reason?: string;
  /**
   * An agent's open proposal (PIE-501): on its embed's source line, the proposal it shows; with `op`, one of
   * the controls drawn there (role "control"), which runs `proposal.apply` or `proposal.dismiss` on it.
   */
  proposal?: { id: string; op?: "apply" | "dismiss" };
  /**
   * An extension's line (PIE-512): its head and its controls (role "control") run `action` on it, an
   * `ext.<id>.<action>` or `projection.refresh` (r: run it again, ask the agent again). `extension` and
   * `handler` say whose line it is, so the reader finds the keys its actions answer to.
   */
  ext?: { block: string; line: number; action: string; extension: string; handler: string };
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
};

/**
 * A callout as the reader drew it: the note, its header's note line and how that line read (what a type change is
 * checked against), the note's revision, and its fold point's key when it has one (a body to fold).
 */
export interface CalloutRef { block: string; line: number; header: string; revision?: number; type: string; fold: "+" | "-" | null; foldKey: string | null }

/** How a `((…))` reads: the label or title (with `^fragment`), and what's wrong with it, as Detail says it. */
export function refView(id: string, fragment: string | undefined, label: string | undefined, r: ReferenceResolution | undefined): LinkView {
  if (!r) return { text: label ?? shortId(id) + (fragment ? `^${fragment}` : ""), missing: false };
  if (r.status === "missing") return { text: `${label ?? shortId(id)} · Missing target`, missing: true };
  const title = (label ?? r.title ?? shortId(id)) + (label === undefined && fragment ? `^${fragment}` : "");
  const suffix = r.status === "deleted" ? " · Trash" : r.status === "stale" ? " · Missing fragment" : r.status === "duplicate" ? " · Duplicate fragment" : "";
  return { text: title + suffix, missing: false };
}

/** How a `[[address]]` reads: its label or address, or `address · Missing target`. */
export function pageView(address: string, label: string | undefined, r: PageResolution | null): LinkView {
  const text = (label ?? address).trim();
  if (r?.status === "missing") return { text: `${text} · Missing target`, missing: true };
  return { text: text + (r?.status === "deleted" ? " · Trash" : ""), missing: false };
}

/**
 * Body text with links replaced by how they read, between markers colourBody styles. Code fences and
 * inline code keep their text. Transclusions (`!((…))`) are left for the renderer when `embeds` is on
 * (it nests them as the service projects them); off (a component's labels, a list's digest) they read as
 * a link that says it isn't expanded there.
 */
/** A live figure's first line (src/graphs.ts `isGraphStart`). */
const GRAPH_START = /^\s*::graph-[a-z-]+\s*$/;

export function presentLinks(text: string, embeds: boolean, src: Source | null | undefined, noteText = text, sink?: LinkTarget[], resources: readonly ResourceToken[] = []): string {
  // `noteText`: the whole note `text` was cut from, so it shares that note's one references answer.
  const resolved = referencesIn(noteText, src) ?? new Map<string, ReferenceResolution>();
  let fenced = false, figure = false;
  // Fence lines and the code between them are left as typed, links and Markdown alike. So is a live
  // figure (`::graph-*` to `::`): its YAML is the figure's question, and a `view: ((id))` in it must still
  // name the id when the figure reads it (src/live.ts); drawn as a link, the id would be gone.
  const fencedAt: boolean[] = [];
  // An inline links component (`::links` to its `::`, src/links.ts) is left as typed too: an `of: ((id))` in it names whose.
  const lines = text.split("\n"), linkLines = linkBlockLines(lines);
  return lines.map((line, i) => {
    if (!fenced && !figure && linkLines.has(i)) { fencedAt.push(true); return line; }
    if (!fenced && (figure ? /^\s*::\s*$/.test(line) : GRAPH_START.test(line))) { figure = !figure; fencedAt.push(true); return line; }
    if (!figure && /^\s*```/.test(line)) { fenced = !fenced; fencedAt.push(true); return line; }
    fencedAt.push(fenced || figure);
    if (fenced || figure) return line;
    return line.split(/(`[^`]*`)/).map((part, i) => {
      if (i % 2) return part;
      // With a sink, each link is also tagged with its place in it, so a click can find it (PIE-415).
      const mark = (v: LinkView, to: LinkTarget) => {
        const [on, off] = sink ? [linkTag(sink.push(to) - 1), LINK_END] : ["", ""];
        return (v.missing ? MISSING_ON : LINK_ON) + on + v.text + off + LINK_OFF;
      };
      // A resource token the service names reads as itself without its brackets, and shows its Resource.
      for (const t of resources) if (part.includes(t.raw)) part = part.split(t.raw).join(mark({ text: t.raw.slice(1, -1), missing: false }, { resource: t.link, label: t.link.label }));
      return part
        // A Markdown link reads as its text and opens its destination (a web page, or a pi-outliner:// link).
        .replace(MD_LINK, (_all, text: string, url: string) => mark({ text: emphasis(text), missing: false }, { url, label: text }))
        .replace(new RegExp(`(!?)${REF.source}`, "g"), (all, bang: string, id: string, frag?: string, label?: string) => {
          if (label !== undefined && !label.trim()) return all;
          if (bang && !label && embeds) return all;
          const v = refView(id, frag, label, resolved.get(refKey(id, frag, label)));
          const to: LinkTarget = { block: id, ...(frag ? { fragment: frag } : {}), ...(label !== undefined ? { label } : {}) };
          return bang && !label ? `!${mark(v, to)} · embed not expanded here` : bang + mark(v, to);
        })
        .replace(PAGE, (_all, address: string, label?: string) => mark(pageView(address, label, pageOf(address, src)), { page: address.trim(), ...(label !== undefined ? { label } : {}) }));
    }).join("");
  }).map((line, i) => (fencedAt[i] ? line : emphasis(line))).join("\n");
}
