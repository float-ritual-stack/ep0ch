// Reference completion in the edit control (PIE-416): typing `[[`, `((` or `[file::` in a draft offers
// pages and Work IDs, blocks and fragments, or workspace paths, from the service's lookups (`pages.complete`,
// `tree.search`: the one search, Goto's ranker, forgiving punctuation, order and typos; `fragments.candidates`,
// `files.complete`, `blocks.context`), so the door keeps no index, ranking or fragment rules of its own. The
// draft's note is the search's context: nearer notes first, and `((` alone lists what's linked and edited
// around it. A pause asks Jev to re-order the same candidates; the selected one stays selected. Keep typing
// to filter, up/down choose, Enter or Tab inserts, Esc dismisses; Tab or Ctrl+Space asks again. The popup
// never keeps a key it doesn't use: with nothing to choose, Enter, arrows and Esc do what they always do.
//
// Deep links (PIE-762): a reference is refined in place. `((Gree` lists the notes with each top note's `^anchors`
// right under it; `^` or `#` typed in (or just after) a finished `((id))` opens it again as `((id^`, and the popup
// searches inside that one note: its anchors first, then its headings, paragraphs and list items, each without an
// anchor offered with the one it would get. Choosing one of those adds the anchor (`fragments.ensure`, attributed)
// and links it, as one choice. `((Meeting^` searches inside the notes `((Meeting` listed, in the same order. The
// triggers stay here until ADR 0004's source contract (slice 6, PIE-750) moves them into outline-core.
import { subject, type Msg } from "../board";
import {
  completionTargetAtCursor, completionWindow, filterTargetAtCursor, pageAddressCompletion, pageCompletionLookupQuery, parseFragmentCompletionQuery,
  type CompletionTarget,
} from "../completion";
import type { Draft, DraftAction } from "../edit";
import { USER, type Actor, type FragmentCandidate, type SocketBoard } from "../socket";
import { lineCompletionHooks, type LineCompletion, type LineInput } from "./line";
import { bg, C, chip, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { printable } from "../text";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { cursorInCode } from "@ep0ch/outline-core/code-ranges";
import type { CalloutRegistry } from "@ep0ch/outline-core/callouts";
import { calloutsReady, TONE } from "../callouts";
import { keyCandidates, valueCandidates, variation, yamlKeyCandidates, type ComponentSchema, type PropertyCandidate } from "@ep0ch/outline-core/component-schema";
import { componentsReady } from "../component-schemas";
import type { ListSource } from "../outline-lists";
import { drawVariation } from "../library/draw";
import { visible, width as cells } from "../style";

/** At most this many candidates per lookup, as in the outliner. */
export const COMPLETION_LIMIT = 20;
/** How long typing pauses before Jev is asked to re-order the candidates: the popup's and the desk's search overlay's. */
export const SEARCH_JEV_PAUSE_MS = 300;
/** Services that said Jev isn't configured there: not asked again this run (each ask is a round trip, and when configured, paid). */
export const jevOff = new WeakSet<object>();
/** The popup's tallest: a header, three candidates with the selected one's context, and the footer. */
export const COMPLETION_ROWS = 8;
export const COMPLETION_HINT = "up/down or wheel choose · enter/tab/click inserts · esc dismisses";
/** A `((` popup's: what a reference does once it's in (PIE-762). */
export const REFERENCE_HINT = "up/down choose · enter/click inserts · then ^ or # searches inside it · esc dismisses";

/** The service lookups completion needs (SocketBoard has them). */
export type CompletionBoard = Pick<SocketBoard, "completePages" | "completeFiles" | "searchBlocks" | "blockContext" | "workIdPrefix" | "fragmentCandidates" | "ensureFragment" | "readFragment" | "propertyCatalog">;

/**
 * Anything outline text is written in (PIE-626): a `Draft`, or a `LineInput` (a property's value, a filter). The completer
 * reads its text and cursor, and a choice is spliced in. One completer for both, never one per surface.
 */
export interface CompletionField {
  readonly lines: readonly string[];
  readonly row: number;
  readonly col: number;
  readonly busy: boolean;
  readonly text: string;
  near?: string;
  note: string;
  /** What a line completes: a draft has none of this and completes text. */
  readonly complete?: LineCompletion;
  splice(start: number, end: number, text: string, lines?: Record<number, string>, by?: Actor): void;
}

export interface CompletionItem {
  label: string;
  /** Exactly what choosing it writes in place of the token. */
  insertion: string;
  kind: "page" | "work-id" | "alias" | "block" | "fragment" | "file" | "folder" | "callout" | string;
  /** A callout type's icon, drawn in its tone (PIE-538). */
  icon?: { glyph: string; colour: number };
  blockId?: string;
  address?: string;
  fragmentId?: string;
  /** Where it sits (ancestors) and how its body starts; read for the selected candidate. */
  context?: string;
  /**
   * A heading without an anchor that gets one when chosen: in the draft's own note, that line's new text
   * (the draft saves it); in another note, the service writes it (`fragments.ensure`), if that note is
   * still at `revision`.
   */
  anchor?: { lineIndex: number; line: string; revision: number };
}

export interface CompletionLookup {
  items: CompletionItem[];
  /** The service cut the list at this many. */
  truncated: number | null;
  /** Empty or partial: said in words instead of an empty popup. */
  message: string;
  /** Jev re-ordered the list (`ranked`), is being asked (`asking`), or never was. */
  jev?: "asking" | "ranked";
  /** The service has no Jev configured: don't ask again. */
  jevOff?: boolean;
  /** What the list is, when it isn't the kind's own word: `in Greenhouse meeting` for a reference being refined. */
  heading?: string;
}

/** The note a draft's search asks from: its own note, else the note it's about (a comment's, a new card's view). */
export const nearOf = (d: CompletionField | null | undefined, own?: OwnNote): string | undefined => own?.blockId ?? d?.near;

/** How the lookup is asked: `semantic` has Jev re-order it; `near` is the note the draft writes in. */
export interface LookupOptions { semantic?: boolean; near?: string }

/** The note a note draft is writing, for `((#heading` in itself; comments and replies have none. */
export interface OwnNote { blockId: string; text: string }

const title = (m: Msg) => subject({ ...m, text: m.text.replace(/ \^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\s*$/m, "") }).replace(/\s{2,}/g, " ");
const REASON = { linked: "linked from here", near: "near here", yours: "you edited" } as const;
/** The service's snippet of a hit, its first line left out when it's the title the row already shows. */
const hitSnippet = (title: string, text: string) => {
  const lines = text.split(/\r?\n/);
  return (withoutPropertyTokens(lines[0] ?? "").trim().startsWith(title.slice(0, 24)) ? lines.slice(1) : lines)
    .map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
};
const snippet = (text: string) => text.split(/\r?\n/).slice(1).map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);

export const notConfigured = (semantic: { status: string; message?: string }) => semantic.status === "unavailable" && /not configured/i.test(semantic.message ?? "");

/** The candidates for one token: the same lookups and insertions the outliner's editors use. */
export async function lookupCompletion(board: CompletionBoard, target: CompletionTarget, prefix: string | null, own?: OwnNote, opts: LookupOptions = {}): Promise<CompletionLookup> {
  let items: CompletionItem[] = [], truncated: number | null = null, empty = "", partial = "", ranked = false, off = false, heading: string | undefined;
  if (target.kind === "filter-key" || target.kind === "filter-value") {
    items = await filterCandidates(board, target);
    empty = target.kind === "filter-key" ? "" : `no ${target.key} value starts ${JSON.stringify(target.query)}`;
  } else if (target.kind === "key" || target.kind === "value" || target.kind === "yaml-key" || target.kind === "yaml-value") {
    // The component schemas (PIE-618): the same answer the library draws its pages from, no list of the completer's own.
    const src = { board, redraw: () => {} };
    items = propertyCandidates(await componentsReady(src), target, src);
    empty = "";
  } else if (target.kind === "callout") {
    // The outline's callout types (PIE-538): the one list the reader draws and the type choice offers.
    items = calloutCandidates(await calloutsReady({ board, redraw: () => {} }), target.query);
    empty = `no callout type starts ${JSON.stringify(target.query)}; [!${target.query}] still draws, in neutral (declare it with [callout-type::${target.query || "name"}])`;
  } else if (target.kind === "file") {
    const files = await board.completeFiles(target.query);
    items = files.slice(0, COMPLETION_LIMIT).map(f => ({ label: f.sourcePath, kind: f.isDirectory ? "folder" : "file", insertion: `[file::${f.sourcePath}${f.isDirectory ? "" : "]"}` }));
    if (files.length > COMPLETION_LIMIT) truncated = COMPLETION_LIMIT;
    empty = "no matching files";
  } else if (target.kind === "page") {
    const r = await board.completePages(pageCompletionLookupQuery(target.query, prefix) || undefined, COMPLETION_LIMIT, opts);
    items = r.addresses.map(a => ({ ...pageAddressCompletion(a, target.query, prefix), blockId: a.blockId, address: a.address, kind: a.kind }));
    if (r.completeness.kind === "truncated") truncated = r.completeness.limit ?? COMPLETION_LIMIT;
    ranked = r.semantic?.status === "ranked";
    off = !!r.semantic && notConfigured(r.semantic);
    empty = "no matching named addresses; [[target|label]] labels a target, ((...)) searches blocks";
  } else {
    const fragment = parseFragmentCompletionQuery(target.query);
    if (!fragment) {
      ({ items, truncated, ranked, off } = await blockCandidates(board, target.query, own, opts));
      empty = "no matching blocks";
    } else {
      const r = await fragmentLookup(board, fragment, own, opts);
      items = r.items; heading = r.heading; empty = r.empty;
      if (r.truncated) { truncated = r.truncated; partial = `showing the first ${truncated} fragments`; }
    }
  }
  const message = items.length ? partial || (truncated ? `showing the first ${truncated} matches` : "") : [partial && `partial search: ${partial}`, empty].filter(Boolean).join(" · ");
  return { items, truncated, message, ...(ranked ? { jev: "ranked" as const } : {}), ...(off ? { jevOff: true } : {}), ...(heading ? { heading } : {}) };
}

/** How many of the top notes a `((words` list shows the anchors of, and how many each. */
const ANCHORED_NOTES = 4, ANCHORS_PER_NOTE = 3;
/** How many notes `((words^` and `((words#` search inside: the first ones `((words` listed. */
const NOTES_SEARCHED = 3;

/**
 * `((words`: the one search (`tree.search`, from the draft's note: what Goto, the desk's `/` and Jev rank), and
 * (PIE-762) the anchors that are already valid targets: an anchor whose id starts with what's typed (`((a10`) first,
 * then each of the top notes followed by its own anchors, then the other notes.
 */
async function blockCandidates(board: CompletionBoard, query: string, own: OwnNote | undefined, opts: LookupOptions): Promise<{ items: CompletionItem[]; truncated: number | null; ranked: boolean; off: boolean }> {
  const q = query.trim(), anchored = q.length >= 2, draft = own ? { draft: own } : {};
  // The anchors are extra: a lookup of them that fails leaves the notes as the one search answered them.
  const anchors = (query: Parameters<CompletionBoard["fragmentCandidates"]>[0]) => Promise.resolve().then(() => board.fragmentCandidates(query)).catch(() => null);
  const [r, named] = await Promise.all([
    board.searchBlocks(query, opts),
    anchored && /^[A-Za-z0-9_-]+$/.test(q) ? anchors({ fragmentQuery: q, mode: "id", limit: COMPLETION_LIMIT, ...draft }) : null,
  ]);
  const notes: CompletionItem[] = r.matches.slice(0, COMPLETION_LIMIT).map(m => ({
    label: m.title, blockId: m.block.id, kind: m.reason ? `block · ${REASON[m.reason]}` : "block", insertion: `((${m.block.id}))`,
    context: [m.path, hitSnippet(m.title, m.snippet)].filter(Boolean).join(" » "),
  }));
  const top = notes.slice(0, ANCHORED_NOTES).map(n => n.blockId!);
  const theirs = anchored && top.length
    ? await anchors({ blockIds: top, fragmentQuery: "", mode: "id", limit: COMPLETION_LIMIT, ...draft }) : null;
  const items: CompletionItem[] = [], seen = new Set<string>();
  const add = (it: CompletionItem) => { if (!seen.has(it.insertion)) { seen.add(it.insertion); items.push(it); } };
  const lower = q.toLowerCase();
  for (const c of named?.items ?? []) if (c.fragmentId?.toLowerCase().startsWith(lower) && items.length < 3) add(fragmentItem(c, false));
  for (const n of notes) {
    add(n);
    for (const c of (theirs?.items ?? []).filter(c => c.blockId === n.blockId && c.fragmentId).slice(0, ANCHORS_PER_NOTE)) add(fragmentItem(c, false, true));
  }
  return {
    items, truncated: r.matches.length > COMPLETION_LIMIT || r.completeness.kind === "truncated" ? COMPLETION_LIMIT : null,
    ranked: r.semantic.status === "ranked", off: notConfigured(r.semantic),
  };
}

/**
 * `((note#…` / `((note^…`: the service's fragment rules (PIE-424) answer it. The note part says where: a block id
 * (a reference being refined, PIE-762) is that one note; words are the notes `((words` listed, in its order; nothing
 * is every note, the draft's own first. Inside named notes `^` is every passage (anchors first, then headings,
 * paragraphs and list items with the anchor each would get) and `#` is headings; across every note, `^` is anchors.
 */
async function fragmentLookup(board: CompletionBoard, fragment: { blockQuery: string; fragmentQuery: string; mode: "heading" | "id" }, own: OwnNote | undefined, opts: LookupOptions): Promise<{ items: CompletionItem[]; truncated: number | null; empty: string; heading?: string }> {
  const note = fragment.blockQuery, draft = own ? { draft: own } : {};
  let blockIds: string[] | undefined;
  if (BLOCK_ID_PATTERN.test(note)) blockIds = [note];
  else if (note) {
    blockIds = (await board.searchBlocks(note, { ...opts, semantic: false })).matches.slice(0, NOTES_SEARCHED).map(m => m.block.id);
    if (!blockIds.length) return { items: [], truncated: null, empty: `no note matches ${JSON.stringify(note)}` };
  }
  const mode = blockIds ? (fragment.mode === "id" ? "passage" : "heading") : fragment.mode;
  const r = await board.fragmentCandidates({ ...(blockIds ? { blockIds } : {}), fragmentQuery: fragment.fragmentQuery, mode, limit: COMPLETION_LIMIT, ...draft });
  const one = blockIds?.length === 1;
  const title = one ? r.items[0]?.title : undefined;
  return {
    items: r.items.map(c => fragmentItem(c, one)),
    truncated: r.completeness.kind === "truncated" ? r.completeness.limit ?? COMPLETION_LIMIT : null,
    empty: one ? `nothing in that note matches ${JSON.stringify(fragment.fragmentQuery)}${mode === "heading" ? "; ^ searches its passages too" : ""}` : "no matching fragments",
    ...(one ? { heading: title ? `in ${title}` : "in that note" } : {}),
  };
}

/**
 * A fragment as a row: an anchor it has already leads the row (`^a10  Greenhouse meeting » We agreed…`); one without
 * says the anchor choosing it adds. `under`: listed under its note's own row, so the note's title isn't repeated.
 */
function fragmentItem(c: FragmentCandidate, oneNote: boolean, under = false): CompletionItem {
  const id = c.fragmentId ?? c.anchor!.fragmentId;
  const what = c.kind === "heading" ? `# ${c.label}` : c.label;
  const where = oneNote || under ? "" : `${c.title} » `;
  return {
    label: c.fragmentId ? `${under ? "  " : ""}^${id}  ${where}${what}` : `${where}${what} · adds ^${id}`,
    blockId: c.blockId, fragmentId: id, kind: "fragment", insertion: `((${c.blockId}^${id}))`,
    context: `${c.kind} in ${c.title}${c.fragmentId ? "" : `: choosing it adds ^${id} to that line`}`,
    ...(c.anchor ? { anchor: { lineIndex: c.lineIndex, line: c.anchor.line, revision: c.revision } } : {}),
  };
}

/**
 * `^` or `#` typed with the cursor in a finished `((id))` or `((id^anchor))`, or just after its `))`, opens it again
 * (PIE-762): it becomes `((id^anchor` (`^` keeps the anchor it had, as what's searched) or `((id#`, with the `))` after
 * the cursor, and the popup searches inside that note. False (and nothing changed) anywhere else: in code, in a
 * labelled reference, or outside one. One undo step, by `by`.
 */
export function reopenReference(d: CompletionField, ch: string, by: Actor = USER): boolean {
  if (ch !== "^" && ch !== "#") return false;
  const line = d.lines[d.row] ?? "";
  if (cursorInCode(d.lines, d.row, d.col)) return false;
  const ref = blockReferenceOccurrences(line).find(r => r.label === undefined && d.col >= r.start + 2 && d.col <= r.end);
  if (!ref) return false;
  d.splice(ref.start, ref.end - 2, `((${ref.blockId}${ch}${ch === "^" ? ref.fragmentId ?? "" : ""}`, {}, by);
  return true;
}

/**
 * A filter's keys or a property's values, from the outline's property index (`properties.catalog`: what its notes carry,
 * most used first) and then the component schemas (what a key can hold, used or not): the same two sources the
 * outliner's filter completion and the editors' `[key::` completion read, never a list of its own.
 */
async function filterCandidates(board: CompletionBoard, target: CompletionTarget): Promise<CompletionItem[]> {
  const value = target.kind === "filter-value", q = target.query.trim().toLowerCase();
  const [catalog, schemas] = await Promise.all([
    board.propertyCatalog(value ? target.key : undefined, q, 100).catch(() => []),
    componentsReady({ board, redraw: () => {} }).catch(() => []),
  ]);
  const out: CompletionItem[] = [], seen = new Set<string>();
  if (!value) {
    const counts = new Map<string, number>();
    for (const c of catalog) counts.set(c.key, (counts.get(c.key) ?? 0) + c.count);
    for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) { seen.add(key); out.push({ label: `${key} (${n})`, insertion: `${key}:`, kind: "property", context: `${n} block${n === 1 ? "" : "s"} carry it` }); }
    for (const c of keyCandidates(schemas, q)) if (!seen.has(c.key) && c.key.toLowerCase().startsWith(q)) { seen.add(c.key); out.push({ label: c.key, insertion: `${c.key}:`, kind: "property", context: c.detail }); }
  } else {
    // A filter's word has no spaces to hold: a value with one is left out there (a field's value may have them).
    const fits = (v: string) => !target.words || !/\s/.test(v);
    for (const c of catalog) if (!seen.has(c.value) && fits(c.value)) { seen.add(c.value); out.push({ label: `${c.value} (${c.count})`, insertion: c.value, kind: "value", context: `${c.count} block${c.count === 1 ? "" : "s"} have ${target.key}:${c.value}` }); }
    for (const c of valueCandidates(schemas, target.key ?? "", q, false)) if (!seen.has(c.label) && fits(c.label) && c.label.toLowerCase().startsWith(q)) { seen.add(c.label); out.push({ label: c.label, insertion: c.insertion, kind: "value", context: c.detail }); }
  }
  return out.slice(0, COMPLETION_LIMIT);
}

/**
 * The schemas' keys or values for a property target: a key with where it goes and what it means, a value with its
 * meaning and a preview, the variation it makes drawn small (one row of it: a style's glyph track, a callout's frame).
 */
export function propertyCandidates(schemas: readonly ComponentSchema[], target: CompletionTarget, src: ListSource | null = null): CompletionItem[] {
  const found: PropertyCandidate[] = target.kind === "key" ? keyCandidates(schemas, target.query)
    : target.kind === "value" ? valueCandidates(schemas, target.key ?? "", target.query)
    : target.kind === "yaml-key" ? yamlKeyCandidates(schemas, target.component ?? "", target.query)
    : valueCandidates(schemas, target.key ?? "", target.query, false, target.component);
  return found.slice(0, COMPLETION_LIMIT).map(c => {
    const preview = c.value === undefined ? "" : valuePreview(schemas, c, src);
    return { label: preview ? `${c.label}  ${preview}` : c.label, insertion: c.insertion, kind: target.kind.endsWith("key") ? "property" : "value", context: c.detail };
  });
}

/** One row of what a value draws, at most 24 columns: the row with the most shades and blocks, else its first with anything on it. */
function valuePreview(schemas: readonly ComponentSchema[], c: PropertyCandidate, src: ListSource | null): string {
  const schema = schemas.find(s => s.id === c.component);
  if (!schema) return "";
  let rows: string[];
  try { rows = drawVariation(variation(schema, { [c.key]: c.value! }, c.key), 64, src).map(r => visible(r).replace(/[┊│]/g, " ").trim()).filter(Boolean); } catch { return ""; }
  const weight = (r: string) => [...r].filter(ch => /[\u2580-\u259f]/.test(ch)).length;
  const best = rows.reduce<string | undefined>((a, r) => (a === undefined || weight(r) > weight(a) ? r : a), undefined) ?? "";
  let out = "";
  for (const ch of best) { if (cells(out + ch) > 24) break; out += ch; }
  return out;
}

/**
 * The callout types for `> [!query`: the names and aliases that start with what's typed first (a name before its
 * aliases), then those that contain it; each written as `[!name]`, with its icon in its tone.
 */
export function calloutCandidates(types: CalloutRegistry, query: string): CompletionItem[] {
  const q = query.trim().toLowerCase();
  const score = (t: CalloutRegistry["types"][number]) => {
    if (!q) return 0;
    if (t.name.startsWith(q)) return 0;
    if (t.aliases.some(a => a.startsWith(q))) return 1;
    if (t.name.includes(q) || t.aliases.some(a => a.includes(q)) || t.title.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return types.types.map(t => ({ t, s: score(t) })).filter(x => x.s >= 0).sort((a, b) => a.s - b.s).map(({ t }) => ({
    label: `${t.icon} ${t.name}${t.aliases.length ? ` (${t.aliases.join(", ")})` : ""}`,
    insertion: `[!${t.name}]`, kind: t.block ? "callout · this outline's" : "callout", icon: { glyph: t.icon, colour: TONE[t.tone] },
    context: `${t.title}${t.aliases.length ? ` · also ${t.aliases.map(a => `[!${a}]`).join(" ")}` : ""}`,
  }));
}

/**
 * Put a chosen candidate into the draft, after checking with the service that it still answers: the
 * named address still names that note, the note isn't gone, the fragment is still there once. Throws
 * with the reason (and changes nothing) when it doesn't.
 */
export async function insertCompletion(board: CompletionBoard, d: CompletionField, target: CompletionTarget, item: CompletionItem, own: OwnNote | undefined, still: () => boolean, by: Actor = USER, commit?: () => void): Promise<boolean> {
  if (item.blockId) {
    if (item.address) {
      const r = await board.completePages(item.address, COMPLETION_LIMIT);
      if (!still()) return false;
      if (!r.addresses.some(a => a.address === item.address && a.blockId === item.blockId)) throw new Error("that address changed; search again");
    }
    const ctx = await board.blockContext(item.blockId);
    if (!still()) return false;
    if ((!ctx.selected || ctx.selected.id !== item.blockId || ctx.selected.deleted)) throw new Error("that note is no longer there; search again");
    const mine = own?.blockId === item.blockId;
    // Another note's fragment: the service says it's still there, once (the draft's own was read as typed).
    if (item.fragmentId && !item.anchor && !mine) {
      const f = await board.readFragment(item.blockId, item.fragmentId);
      if (!still()) return false;
      if (f.status !== "resolved") throw new Error("that fragment changed or is ambiguous; search again");
    }
    // Another note's heading gets its anchor from the service, if that note hasn't changed since it was offered.
    if (item.fragmentId && item.anchor && !mine) {
      const written = await board.ensureFragment(item.blockId, item.anchor.lineIndex, item.anchor.revision, by)
        .catch((e: Error) => { throw new Error(`the anchor wasn't added: ${e.message}`); });
      if (!still()) return false;
      if (written.fragmentId !== item.fragmentId) throw new Error("that heading changed; search again");
    }
  }
  // Right before the splice, with no wait between: what the insert uses up (an invitation) is spent only when it lands.
  commit?.();
  d.splice(target.start, target.end, item.insertion, item.anchor && own?.blockId === item.blockId ? { [item.anchor.lineIndex]: item.anchor.line } : {}, by);
  return true;
}

export interface CompletionState extends CompletionLookup {
  target: CompletionTarget;
  index: number;
  loading: boolean;
  /** Where the cursor was when it was asked: a reply for anywhere else is dropped. */
  at: { row: number; col: number; line: string };
}

/** One draft's completion popup: a lookup at a time, newer typing or a dismissal dropping older answers. */
export class Completer {
  state: CompletionState | null = null;
  private generation = 0;
  private accepting = false;
  private prefix: string | null | undefined;
  constructor(private readonly d: CompletionField, private readonly board: CompletionBoard, private readonly redraw: () => void, private readonly own: () => OwnNote | undefined = () => undefined) {}

  /** The token the cursor is in, if any: in a filter's words its key or value; in a property's field its value (a `[[` there first). */
  target(): CompletionTarget | null {
    const f = this.d, line = f.lines[f.row] ?? "", c = f.complete;
    if (c && c.grammar === "filter") { const t = filterTargetAtCursor(line, f.col); return t && { ...t, words: true }; }
    const t = completionTargetAtCursor(line, f.col, f.lines, f.row);
    if (t || !c || !c.valueKey) return t;
    return { kind: "filter-value", start: 0, end: line.length, query: line.slice(0, f.col), key: c.valueKey };
  }

  /** The popup still belongs where the cursor is (the wheel, or an agent's edit.text, can move it without a key). */
  get shown(): CompletionState | null {
    const s = this.state, h = this.here();
    return s && s.at.row === h.row && s.at.col === h.col && s.at.line === h.line ? s : null;
  }

  private here() { return { row: this.d.row, col: this.d.col, line: this.d.lines[this.d.row] ?? "" }; }
  private current(generation: number): boolean {
    const s = this.state, h = this.here();
    return generation === this.generation && !!s && s.at.row === h.row && s.at.col === h.col && s.at.line === h.line;
  }

  dismiss(): void {
    this.generation++;
    this.stopJev();
    if (!this.state) return;
    this.state = null;
    this.redraw();
  }

  private near(): string | undefined { return nearOf(this.d, this.own()); }

  private jevTimer: ReturnType<typeof setTimeout> | null = null;
  private stopJev(): void { if (this.jevTimer) clearTimeout(this.jevTimer); this.jevTimer = null; }

  /**
   * After a pause, ask the service again with Jev re-ordering the same candidates. The answer is used only if
   * nothing moved meanwhile (the query, the cursor, the selection), and the selected candidate stays selected.
   */
  private askJev(generation: number, target: CompletionTarget): void {
    this.stopJev();
    const fragment = target.kind === "block" && parseFragmentCompletionQuery(target.query);
    if (target.kind !== "page" && target.kind !== "block" || fragment || target.query.trim().length < 3 || jevOff.has(this.board)) return;
    // Jev re-orders the service's candidates (up to 30 for ((): one beyond the 20 shown can come into view.
    this.jevTimer = setTimeout(async () => {
      this.jevTimer = null;
      const s = this.state;
      if (!s || !this.current(generation) || s.loading || s.items.length < 2 || this.accepting || this.d.busy) return;
      const index = s.index, chosen = s.items[index]?.insertion;
      s.jev = "asking";
      this.redraw();
      try {
        const r = await lookupCompletion(this.board, target, this.prefix ?? null, this.own(), { semantic: true, near: this.near() });
        if (r.jevOff) jevOff.add(this.board);
        const now = this.state;
        if (now !== s) return;
        // Anything moved meanwhile (the pick, the cursor, a save or an insert under way): the answer isn't used.
        if (!this.current(generation) || now.index !== index || now.items[index]?.insertion !== chosen || this.accepting || this.d.busy) { now.jev = undefined; this.redraw(); return; }
        const at = r.items.findIndex(i => i.insertion === chosen);
        if (at < 0) { now.jev = undefined; this.redraw(); return; }
        this.state = { ...r, target, index: at, loading: false, at: now.at };
        this.redraw();
        void this.enrich(generation);
      } catch {
        if (this.state === s) { s.jev = undefined; this.redraw(); }
      }
    }, SEARCH_JEV_PAUSE_MS);
  }

  /** Look up the token at the cursor (or close the popup when the cursor isn't in one). */
  async refresh(): Promise<void> {
    const target = this.target();
    if (!target || this.d.busy) { this.dismiss(); return; }
    this.stopJev();
    // A re-ask of the same query keeps the pick; a changed query picks its best match.
    const same = this.state?.target.kind === target.kind && this.state.target.query === target.query;
    const generation = ++this.generation, was = same ? this.state?.items[this.state.index]?.insertion : undefined;
    this.state = { target, items: this.state?.items ?? [], index: this.state?.index ?? 0, truncated: null, message: "finding references...", loading: true, at: this.here() };
    this.redraw();
    try {
      // Only an answer is kept for the draft: a failed lookup is asked again next time, as the outliner does.
      if (this.prefix === undefined) this.prefix = await this.board.workIdPrefix().catch(() => undefined);
      const r = await lookupCompletion(this.board, target, this.prefix ?? null, this.own(), { near: this.near() });
      if (r.jevOff) jevOff.add(this.board);
      if (!this.current(generation)) return;
      // A `[` that starts no property the schemas know (a Markdown link's text, say) opens nothing.
      if (!r.items.length && target.kind !== "page" && target.kind !== "block" && target.kind !== "file" && target.kind !== "callout") { this.dismiss(); return; }
      const index = Math.max(0, r.items.findIndex(i => i.insertion === was));
      this.state = { ...r, target, index, loading: false, at: this.state!.at };
      this.redraw();
      void this.enrich(generation);
      this.askJev(generation, target);
    } catch (e) {
      if (this.current(generation)) { this.state = { ...this.state!, items: [], loading: false, message: `lookup failed: ${e instanceof Error ? e.message : String(e)}` }; this.redraw(); }
    }
  }

  /** The selected candidate's ancestors and first lines, from `blocks.context`. */
  private async enrich(generation = this.generation): Promise<void> {
    const item = this.state?.items[this.state.index];
    // A fragment's row says where it is in its note already; the note's first lines would hide that.
    if (!item?.blockId || item.fragmentId) return;
    try {
      const ctx = await this.board.blockContext(item.blockId);
      if (!this.current(generation) || this.state?.items[this.state.index] !== item) return;
      item.context = ctx.selected ? [...ctx.ancestors.map(title), snippet(ctx.selected.text)].filter(Boolean).join(" » ") : "target unavailable";
      this.redraw();
    } catch { /* the snippet from the lookup stays */ }
  }

  /** Where the last render drew the popup, in the editor's rows: its first row and each row's candidate. */
  drawn: { row: number; items: (number | null)[] } | null = null;

  /**
   * A click on row `y` of the editor: on a candidate, it's chosen and inserted (as Enter does); anywhere
   * else on the popup, nothing. True when the popup was there (the click is the popup's either way).
   */
  click(y: number): boolean {
    const s = this.shown, at = this.drawn;
    if (!s || !at || y < at.row || y >= at.row + at.items.length) return false;
    const i = at.items[y - at.row];
    if (i !== null && i !== undefined && s.items[i] && !s.loading) { s.index = i; this.redraw(); void this.accept(i); }
    return true;
  }

  move(delta: number): void {
    const s = this.state;
    if (!s?.items.length) return;
    s.index = Math.max(0, Math.min(s.items.length - 1, s.index + delta));
    this.redraw();
    void this.enrich();
  }

  /** Enter / Tab: insert the selected candidate (checked with the service first). */
  async accept(index = this.state?.index ?? 0): Promise<boolean> {
    const s = this.state, item = s?.items[index], generation = this.generation;
    if (this.accepting || !s || !item || s.loading || !this.current(generation)) return false;
    this.accepting = true;
    try {
      if (!await insertCompletion(this.board, this.d, s.target, item, this.own(), () => this.current(generation))) return false;
      this.dismiss();
      // A folder leaves `[file::notes/` open: its entries are offered next; a filter's key `stage:` its values. A chosen value ends it
      // (the cursor is still in its word, which would offer the same value again).
      if (s.target.kind !== "filter-value" && this.target()) void this.refresh();
      return true;
    } catch (e) {
      if (this.current(generation)) { s.message = e instanceof Error ? e.message : String(e); this.redraw(); }
      return false;
    } finally { this.accepting = false; }
  }
}

const byDraft = new WeakMap<CompletionField, Completer>();

/** The draft's (or line's) completer, made on first use; null when the board can't look anything up (a test double). */
export function completerFor(d: CompletionField, board: unknown, redraw: () => void, own?: () => OwnNote | undefined): Completer | null {
  const had = byDraft.get(d);
  if (had) return had;
  const b = board as Partial<CompletionBoard> | null;
  if (!b || typeof b.completePages !== "function" || typeof b.searchBlocks !== "function") return null;
  const c = new Completer(d, b as CompletionBoard, redraw, own);
  byDraft.set(d, c);
  return c;
}

/** The draft's completer, if it has one. */
export const completerOf = (d: CompletionField): Completer | null => byDraft.get(d) ?? null;

/** The draft's popup, if one is open (for drawing). */
export const completionOf = (d: CompletionField): CompletionState | null => byDraft.get(d)?.shown ?? null;

const isCtrlSpace = (k: Key) => k.kind === "char" && !!k.ctrl && (k.ch === "`" || k.ch === " " || k.ch === "@");

/**
 * The popup's own keys, for a draft or a line: while it has candidates, up/down choose and Enter/Tab insert; Esc closes
 * the popup (and only the popup). Tab or Ctrl+Space in a token asks again; Tab anywhere else is the field's. True when
 * the popup took the key.
 */
function popupKey(d: CompletionField, k: Key, c: Completer, line = false): boolean {
  if (c.state && !c.shown) c.dismiss();
  const s = c.state;
  if (s) {
    // A line (a filter, a panel value) has esc of its own: a popup with nothing to choose never keeps it.
    if (k.kind === "esc") { c.dismiss(); return !line || !!s.items.length; }
    if (s.items.length && !s.loading) {
      if (k.kind === "up" || k.kind === "down") { c.move(k.kind === "up" ? -1 : 1); return true; }
      if (k.kind === "enter" || k.kind === "tab") { void c.accept(); return true; }
    }
  }
  if (k.kind === "tab" || isCtrlSpace(k)) {
    if (c.target()) { void c.refresh(); return true; }
    if (k.kind !== "tab") { d.note = "completion works inside [[, ((, [file::, a callout's > [!, a [key:: property or a figure's YAML"; return true; }
  }
  return false;
}

/**
 * After a key the field took: the popup opens and refreshes only on typing. Moving the cursor never opens it (landing
 * inside `[[garden]]` or after an unclosed `((` must not take the next Down or Enter): an open popup follows the cursor
 * within its token and closes once the cursor leaves it. Tab or Ctrl+Space asks.
 */
function followCursor(c: Completer, changed: boolean, open: CompletionTarget | undefined): void {
  if (changed) { void c.refresh(); return; }
  const now = c.target();
  if (open && now && now.kind === open.kind && now.start === open.start) void c.refresh(); else c.dismiss();
}

/**
 * A key in a draft, with completion first (`popupKey`). Every other key goes to the draft, then the popup follows the
 * cursor. An Esc the draft took (arming discard) doesn't bring it back.
 */
export function completionKey(d: Draft, k: Key, c: Completer | null): DraftAction {
  if (!c || d.busy || k.kind === "mouse") return d.key(k);
  // A line break or tab inside a paste is text: it never chooses a candidate.
  if ("pasted" in k || k.kind === "paste") { c.dismiss(); return d.key(k); }
  if (popupKey(d, k, c)) return "keep";
  // `^` or `#` in a finished ((reference)), or just after it, opens it again to search inside its note (PIE-762).
  if (k.kind === "char" && !k.ctrl && d.selectedText() === null && reopenReference(d, k.ch)) { void c.refresh(); return "keep"; }
  const before = d.text, open = c.state?.target;
  const a = d.key(k);
  if (a !== "keep" || k.kind === "esc") { c.dismiss(); return a; }
  followCursor(c, d.text !== before, open);
  return a;
}

// ── a line completes like a draft (PIE-626) ─────────────────────────────────────────────────────────────────────

/** The connection a line made now belongs to: the door's (App sets it when it starts, `useCompletion`). */
let ambient: { board: SocketBoard; redraw: () => void } | null = null;
export function useCompletion(board: SocketBoard | null, redraw: () => void = () => {}): void { ambient = board && { board, redraw }; }
/** The door ended: lines made after it complete nothing (a line made earlier keeps its own connection). */
export function stopCompletion(board: SocketBoard): void { if (ambient?.board === board) ambient = null; }

/** A draft's completer from the session's connection, else the door's (a comment's session has none of its own). */
export function defaultCompleter(d: CompletionField, board?: unknown, redraw?: () => void): Completer | null {
  return completerFor(d, board ?? ambient?.board, redraw ?? ambient?.redraw ?? (() => {}));
}

const openAt = new WeakMap<LineInput, CompletionTarget | undefined>();
/** A line's completer, made on first use, from the connection the line was made under. */
export function lineCompleter(i: LineInput): Completer | null {
  const host = i.completionHost as { board: SocketBoard; redraw: () => void } | null;
  return host ? completerFor(i, host.board, host.redraw) : null;
}

// What every `LineInput.key` does around its own: the popup first, then it follows the typing.
lineCompletionHooks.ambient = () => ambient;
lineCompletionHooks.before = (i, k) => {
  const c = lineCompleter(i);
  if (!c || k.kind === "mouse") return false;
  if ("pasted" in k || k.kind === "paste") { c.dismiss(); return false; }
  const took = popupKey(i, k, c, true);
  openAt.set(i, c.state?.target);
  return took;
};
lineCompletionHooks.after = (i, k, took, was) => {
  const c = lineCompleter(i);
  if (!c || k.kind === "mouse") return;
  // A paste lands as text and opens nothing (a draft's is the same): the next ⏎ is the caller's.
  if (!took || k.kind === "esc" || "pasted" in k) { c.dismiss(); return; }
  followCursor(c, i.text !== was, openAt.get(i));
};

/**
 * The popup as lines `w` wide, at most `h` tall: header, candidates (the selected one with its context),
 * footer. `rows`, when given, gets each line's candidate index (null for the header, context and footer).
 */
export function renderCompletion(s: CompletionState, w: number, h: number, rows: (number | null)[] = []): string[] {
  rows.length = 0;
  if (h <= 0) return [];
  // Titles come from notes: text.ts's printable takes out what a terminal acts on, pad cuts by cells, and a glyph
  // the VGA font lacks goes as its lookalike at the sink (App, CP437_NEAREST).
  const line = (text: string, colour: string, back = "") => back + colour + pad(printable(text, " "), w) + RESET;
  if (!s.items.length) { rows.push(null); return [line(` ${s.message || "no matches"}`, fg(s.loading ? C.grey : C.yellow), bg(C.blue))]; }
  const header = h >= 3, footer = h >= 2;
  const room = Math.max(1, h - Number(header) - Number(footer) - 1);
  const win = completionWindow(s.items.length, s.index, room);
  const out: string[] = [];
  const heading = { callout: "callout types", key: "properties", "yaml-key": "properties", "filter-key": "properties", value: "values", "yaml-value": "values", "filter-value": "values" }[s.target?.kind as string] ?? "references";
  if (header) rows.push(null), out.push(line(` ${s.heading ?? heading} ${s.index + 1}/${s.items.length}${s.truncated ? ` · first ${s.truncated}` : ""}${s.loading ? " · finding..." : ""}`, fg(C.lcyan), bg(C.blue)));
  for (let i = win.start; i < win.end; i++) {
    const it = s.items[i]!, sel = i === s.index;
    rows.push(i);
    // A callout type's icon in its tone (on the lit row, the row's own colours).
    const iconed = it.icon && it.label.startsWith(it.icon.glyph) && w > 4
      ? (sel ? chip(C.cyan) + "» " + it.icon.glyph : bg(C.blue) + "  " + fg(it.icon.colour) + it.icon.glyph) + (sel ? "" : fg(C.grey)) + pad(printable(it.label.slice(it.icon.glyph.length), " "), w - 3) + RESET
      : null;
    out.push(iconed ?? (sel ? line(`» ${it.label}`, chip(C.cyan)) : line(`  ${it.label}`, fg(C.grey), bg(C.blue))));
    if (sel && out.length < h - Number(footer)) rows.push(i), out.push(line(`    ${it.kind} · ${it.context || it.insertion}`, fg(C.lcyan), bg(C.blue)));
  }
  // Whether Jev ordered the list, said quietly first, where a narrow popup doesn't cut it.
  const jev = s.jev === "ranked" ? "jev ranked · " : s.jev === "asking" ? "jev… · " : "";
  if (footer) rows.push(null), out.push(line(` ${jev}${s.message || (s.target?.kind === "block" ? REFERENCE_HINT : COMPLETION_HINT)}`, fg(s.message ? C.yellow : C.grey), bg(C.blue)));
  rows.length = Math.min(rows.length, h);
  return out.slice(0, h);
}
