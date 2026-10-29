import type { SearchCertainty } from "@ep0ch/outline-core/protocol";
import { SCRIPT_FENCE } from "@ep0ch/outline-core/code-fence";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import type { Ctx } from "../app";
import type { NoteSurface, SurfaceHost } from "./note";
import { Canvas, type Rect } from "../canvas";
// Reference completion in the edit control (PIE-416): typing `[[`, `((` or `[file::` in a draft offers
// pages and Work IDs, blocks and fragments, or workspace paths, from the service's lookups (`pages.complete`,
// `tree.search`: the one search, Goto's ranker, forgiving punctuation, order and typos; `fragments.candidates`,
// `files.complete`, `blocks.context`), so the door keeps no index, ranking or fragment rules of its own. The
// draft's note is the search's context: nearer notes first, and `((` alone lists what's linked and edited
// around it. A pause asks Jev to re-order the same candidates; a row moved to stays selected, the top row stays the top. Keep typing
// to filter, up/down choose, Enter or Tab inserts, Esc dismisses; Tab or Ctrl+Space asks again. The popup
// never keeps a key it doesn't use: with nothing to choose, Enter, arrows and Esc do what they always do.
//
// Deep links (PIE-762): a reference is refined in place. `((Gree` lists the notes with each top note's `^anchors`
// right under it; `^` or `#` typed in (or just after) a finished `((id))` opens it again as `((id^`, and the popup
// searches inside that one note: its anchors first, then its headings, paragraphs, list items, quotes and callouts, each without an
// anchor offered with the one it would get. Choosing one of those adds the anchor (`fragments.ensure`, attributed)
// and links it, as one choice. `((Meeting^` searches inside the notes `((Meeting` listed, in the same order.
//
// Sources (PIE-1340, ADR 0004 §4): the triggers are outline-core's (completion-triggers.ts, the one detector Detail
// asks too); pages, blocks and fragments, files, agents, components, properties and filters, a component's attributes
// and a figure's values, callouts and the extensions' sources answer through the service (`completion.rows`, outliner
// completion-sources.ts, PIE-1344, PIE-1366); only what the door alone knows (its actions, a fence's settings, a
// button's steps) is DOOR_SOURCES below; outline-core's mergeSourceAnswers ranks them all with the one matcher, recent
// and frequent picks first among equals.
import { ListPicker, pickRow } from "./picker";
import { ActionRefused, actionSet, declaredKeys, def, keyCaption } from "./actions";
import { listPreview } from "../bar/list-preview";
import { litCells } from "../bar/filter";
import { rankTextSearchMatches } from "@ep0ch/outline-core/search-match";
import { headedTitle, subject, type Msg } from "../board";
import { completionTargetAtCursor, filterTargetAtCursor, parseFragmentCompletionQuery, type CompletionKind, type CompletionTarget } from "@ep0ch/outline-core/completion-triggers";
import { insertSelection, insertText, mergeSourceAnswers, pickKey, triggerOf, type SourceAnswer, type SourceDecl, type SourceRow } from "@ep0ch/outline-core/completion-source";
import type { CompletionRowsResult, CompletionSourceAnswer } from "@ep0ch/outline-core/protocol";
import type { Draft, DraftAction } from "../edit";
import { USER, type Actor, type SocketBoard } from "../socket";
import { lineCompletionHooks, type LineCompletion } from "./line-hooks";
import type { LineField } from "./line";
import { C, chip, fg, pad, RESET, TAGS, MARKS } from "../style";
import type { Key } from "../term";
import { rowLines, printable } from "../text";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import { blockReferenceOccurrences, qualifiedReference } from "@ep0ch/outline-core/link-syntax";
import { cursorInCode } from "@ep0ch/outline-core/code-ranges";
import { attributeScalar, yamlScalar, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { componentsReady } from "../component-schemas";
import { COMPONENT_OPEN } from "@ep0ch/outline-core/component-block";
import type { ListSource } from "../outline-lists";
import { drawVariation, drawComponentProps } from "../library/draw";
import { openNote, barSource, type BarHost } from "../bar/source";
import { commandCandidates } from "../bar/command";
import { Gesture, Selection, rowsOf, paintRange, selectText, SELECT_BG } from "./selection";
import { visible, width as cells, ellipsize } from "../style";
import { JEV_PAUSE_MS, SearchSchedule, SearchTurn, TYPING_PAUSE_MS } from "../search-schedule";

/** At most this many candidates per lookup, as in the outliner. */
export const COMPLETION_LIMIT = 20;
/** Services that said Jev isn't configured there: not asked again this run (each ask is a round trip, and when configured, paid). */
export const jevOff = new WeakSet<object>();
/** Room for the list and a small reader-rendered example beneath it. */
export const COMPLETION_ROWS = 14;

/** The service lookups completion needs (SocketBoard has them). */
export type CompletionBoard = Pick<SocketBoard, "completePages" | "completeFiles" | "searchBlocks" | "blockContext" | "workIdPrefix" | "fragmentCandidates" | "ensureFragment" | "readFragment" | "followPage" | "listExtensions"> & Partial<Pick<SocketBoard, "completionRows" | "completionPicked" | "searchPicked">>;

/**
 * Anything outline text is written in (PIE-626): a `Draft`, or a `LineField` (a property's value, a filter). The completer
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
  splice(start: number, end: number, text: string, lines?: Record<number, string>, by?: Actor, selection?: { start: number; end: number }): void;
}

/**
 * One row of the popup, as its source answers it (PIE-1339, PIE-1340): outline-core's `SourceRow` (label, kind, detail,
 * docs, the reference fields) with its insert as the text it writes and the span it selects, plus what only the door
 * draws (a component's variations, a drawn preview). The row draws from these fields alone, never from a switch on
 * the kind's name.
 */
export interface CompletionItem extends Omit<SourceRow, "insert"> {
  children?: CompletionItem[];
  source?: string;
  preview?: (w: number, h: number) => string[];
  selection?: { start: number; end: number };
  /** Exactly what choosing it writes in place of the token. */
  insertion: string;
  /** One short word for the row's right-hand column: block, anchor, page, property, component, agent, action, value. */
  kind: string;
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
  /** The key a pick of this list is counted under (`completion.picked`). */
  pickKey?: string;
  /** How sure Jev's order is (PIE-1198), the service's call: the footer says "no strong match" when it isn't. */
  sure?: SearchCertainty;
}

/** The note a draft's search asks from: its own note, else the note it's about (a comment's, a new card's view). */
export const nearOf = (d: CompletionField | null | undefined, own?: OwnNote): string | undefined => own?.blockId ?? d?.near;

/** How the lookup is asked: `semantic` has Jev re-order it; `near` is the note the draft writes in. */
export interface LookupOptions { semantic?: boolean; near?: string; limit?: number; offset?: number; host?: BarHost; signal?: AbortSignal }

/** The note a note draft is writing, for `((#heading` in itself; comments and replies have none. */
export interface OwnNote { blockId: string; text: string }

const title = (m: Msg) => subject({ ...m, text: m.text.replace(/ \^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\s*$/m, "") }).replace(/\s{2,}/g, " ");
const snippet = (text: string) => text.split(/\r?\n/).slice(1).map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim();

export const notConfigured = (semantic: { status: string; message?: string }) => semantic.status === "unavailable" && /not configured/i.test(semantic.message ?? "");

/** What a door source is asked: the token, the draft's note, and how (ADR 0004 §4's ask, with the door's own reach). */
interface DoorAsk { board: CompletionBoard; target: CompletionTarget; own?: OwnNote; opts: LookupOptions; signal?: AbortSignal }
/** A door source's answer: its rows, and what to say when it has none. */
interface DoorAnswer { rows: CompletionItem[]; empty?: string }
/**
 * A completion source the door answers itself (PIE-1340): only what the door alone knows (its actions, for a button's
 * steps and an action-typed prop; a fence's settings). Each answers on outline-core's contract (`SourceDecl`, rows a
 * `SourceRow` and more); everything about the outline (its notes, pages, files, agents, properties, components and
 * their values, callouts, the extensions' sources) is the service's (`completion.rows`). `lookupCompletion` asks
 * every source for the token and merges them with outline-core's one matcher: nothing below switches on a kind.
 */
interface DoorSource { decl: SourceDecl; kinds: readonly CompletionKind[]; rows(ask: DoorAsk): Promise<DoorAnswer> }

const hostOf = (board: CompletionBoard, opts: LookupOptions) => opts.host ?? (ambient?.board === board ? ambient.host?.() : undefined);
const door = (id: string, title: string, ranked = false): SourceDecl => ({ id, title, triggers: [], priority: 10, ranked, by: "door" });

const DOOR_SOURCES: readonly DoorSource[] = [
  // A button's step (PIE-1298): a script note's name after `((`, else the door's actions and their arguments.
  { decl: door("steps", "steps", true), kinds: ["button-step"], async rows({ board, target, own, opts }) {
    if (target.query.trimStart().startsWith("((")) {
      const q = target.query.trimStart().slice(2);
      const listed = await board.listExtensions(false, own ? { blockId: own.blockId, draft: { text: own.text } } : {});
      return { rows: listed.extensions.filter(e => e.script && (e.state === "active" || e.state === "failed") && e.name?.startsWith(q))
        .map(e => ({ label: e.name!, insertion: `((${e.name}))`, docs: e.description, kind: "script" })) };
    }
    const host = hostOf(board, opts);
    if (!host) return { rows: [] };
    const rows = await barSource("actions")!.rows(target.query, host, "actions");
    const args = await commandCandidates(target.query, host);
    return { rows: [...args.map(value => ({ label: value, insertion: value, kind: "value" })), ...rows.map(r => ({ label: r.label, insertion: r.fill ?? r.label, docs: r.detail, kind: "action" }))] };
  } },
  { decl: door("fence", "settings"), kinds: ["fence-setting"], async rows() {
    return { rows: SCRIPT_FENCE.settings.map(s => ({ label: `${s.key}=`, insertion: `${s.key}=`, docs: s.meaning, kind: "setting" })) };
  } },
  // A prop whose values are the door's own actions (a rule's `run`, PIE-1366): the service answers every other prop's.
  { decl: door("actions", "values", true), kinds: ["attribute-value", "yaml-value"], async rows({ board, target, opts }) {
    const host = hostOf(board, opts);
    if (!host) return { rows: [] };
    const schemas = await componentsReady({ board, redraw: () => {} });
    const schema = schemas.find(s => COMPONENT_OPEN.exec(s.source.use.split("\n")[0]!)?.[1] === target.component);
    if (schema?.props.find(p => p.key === target.key)?.type !== "action") return { rows: [] };
    const q = target.query, write = (v: string) => target.kind === "yaml-value" ? yamlScalar(v) : attributeScalar(v, target.quote);
    const args = await commandCandidates(q, host), rows = await barSource("actions")!.rows(q, host, "actions");
    return { rows: [...args.map(v => ({ label: v, insertion: write(v), kind: "value" })), ...rows.map(r => ({ label: r.label, insertion: write(r.fill ?? r.label), docs: r.detail, kind: "value" }))] };
  } },
];

/**
 * A row the service answered, as the popup holds it: what it writes, the span a snippet selects, and what the door draws
 * of it (PIE-1344): its `example` drawn beside the list (and a glimpse after the label when `inline`), its variations
 * under →, and the source and properties table of the component it writes. Drawing only: every word and every insert
 * is the service's.
 */
const itemOf = (row: SourceRow, src: ListSource, schemas: readonly ComponentSchema[]): CompletionItem => {
  const { insert, variations, example, ...rest } = row;
  const selection = insertSelection(insert);
  const schema = row.component ? schemas.find(s => s.id === row.component) : undefined;
  const glimpse = example?.inline ? exampleGlimpse(example, src) : "";
  return {
    ...rest, kind: rest.kind ?? "", insertion: insertText(insert), ...(selection ? { selection } : {}),
    ...(glimpse ? { label: `${rest.label}  ${glimpse}` } : {}),
    ...(example ? {
      source: example.use,
      preview: (w: number, h: number) => [
        ...(row.component ? `[copy] ${example.use}`.split("\n").flatMap(line => rowLines(line, w)) : []),
        ...drawVariation({ values: {}, ...example }, w, src),
        ...(schema ? drawComponentProps(schema, w) : []),
      ].slice(0, h),
    } : {}),
    ...(variations?.length ? { children: variations.map(v => itemOf(v, src, schemas)) } : {}),
  };
};
/** A door row on the contract: its insertion as the insert (a selection makes it a snippet). */
const rowOf = (item: CompletionItem): CompletionItem & SourceRow => ({ ...item, insert: item.selection ? { snippet: item.insertion, select: item.selection } : item.insertion });

/** A token no service or extension source can answer (a fence's settings, a button's step) asks nothing: it needs no pause for typing. */
const asksService = (board: CompletionBoard, target: CompletionTarget) => typeof board.completionRows === "function" && !!triggerOf(target.kind);

/** The service's answer to `completion.rows`, or none (a test double, a service without it): its sources answer nothing. */
async function serviceRows(board: CompletionBoard, target: CompletionTarget, own: OwnNote | undefined, opts: LookupOptions): Promise<CompletionRowsResult & { failed?: string }> {
  if (!asksService(board, target)) return { answers: [], picks: {} };
  const { start: _s, end: _e, ...asked } = target;
  return board.completionRows!({
    target: asked,
    ...(opts.near ? { near: opts.near } : {}), ...(own ? { draft: own } : {}), ...(opts.limit ? { limit: opts.limit } : {}),
    ...(opts.offset ? { offset: opts.offset } : {}), ...(opts.semantic ? { semantic: true } : {}),
  }, opts.signal).catch((e: Error) => ({ answers: [], picks: {}, failed: `lookup failed: ${e.message}` }));
}

/**
 * The candidates for one token (ADR 0004 §4, PIE-1340): every source for its trigger, the door's and the service's
 * (with the extensions'), asked at once and merged by outline-core's one matcher, recent and frequent picks first among
 * equals. What it says when there are none, or the list is cut, is the sources' own words.
 */
export async function lookupCompletion(board: CompletionBoard, target: CompletionTarget, own?: OwnNote, opts: LookupOptions = {}): Promise<CompletionLookup> {
  const mine = DOOR_SOURCES.filter(s => s.kinds.includes(target.kind));
  const [service, ...answers] = await Promise.all([
    serviceRows(board, target, own, opts),
    ...mine.map(s => s.rows({ board, target, own, opts, ...(opts.signal ? { signal: opts.signal } : {}) }).then(a => ({ source: s.decl, rows: a.rows.map(rowOf), empty: a.empty }))),
  ]);
  const src = { board, redraw: () => {} };
  // A row that draws a component's properties finds its schema in the connection's copy (the library's).
  const schemas = service.answers.some(a => a.rows.some(r => r.component)) ? await componentsReady(src) : [];
  const all: (SourceAnswer<CompletionItem & SourceRow> & Partial<CompletionSourceAnswer>)[] = [...answers, ...service.answers.map(a => ({ ...a, rows: a.rows.map(r => rowOf(itemOf(r, src, schemas))) }))];
  const merged = mergeSourceAnswers(all, target.query, { picks: service.picks });
  const items = merged.map(({ insert: _i, from: _f, tier: _t, ...item }) => item as CompletionItem);
  const truncated = all.find(a => a.truncated)?.truncated ?? null;
  const partial = all.map(a => a.partial).find(Boolean) ?? "";
  const problems = [service.failed, ...all.map(a => a.problem)].filter(Boolean).join(" · ");
  const empty = all.map(a => a.empty).filter(Boolean).join(" · ");
  const message = items.length ? [partial || (truncated ? `showing the first ${truncated} matches` : ""), problems].filter(Boolean).join(" · ")
    : [partial && `partial search: ${partial}`, empty, problems].filter(Boolean).join(" · ");
  const heading = all.map(a => a.heading).find(Boolean);
  return {
    items, truncated, message, ...(all.some(a => a.jev === "ranked") ? { jev: "ranked" as const } : {}), ...(all.some(a => a.jevOff) ? { jevOff: true } : {}),
    ...(all.find(a => a.sure)?.sure ? { sure: all.find(a => a.sure)!.sure! } : {}),
    // Only a token the service answers has picks kept for it (a fence's settings, a button's steps don't: nothing reads them).
    ...(heading ? { heading } : {}), ...(triggerOf(target.kind) ? { pickKey: pickKey({ trigger: triggerOf(target.kind), kind: target.kind, key: target.key }) } : {}),
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

/** One row of what an example draws, at most 24 columns: the row with the most shades and blocks, else its first with anything on it. */
function exampleGlimpse(example: { use: string; note?: string }, src: ListSource | null): string {
  let rows: string[];
  try { rows = drawVariation({ values: {}, ...example }, 64, src).map(r => visible(r).replace(/[┊│]/g, " ").trim()).filter(Boolean); } catch { return ""; }
  const weight = (r: string) => [...r].filter(ch => /[\u2580-\u259f]/.test(ch)).length;
  const best = rows.reduce<string | undefined>((a, r) => (a === undefined || weight(r) > weight(a) ? r : a), undefined) ?? "";
  let out = "";
  for (const ch of best) { if (cells(out + ch) > 24) break; out += ch; }
  return out;
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
    const ctx = item.address && qualifiedReference(item.address).outline ? null : await board.blockContext(item.blockId);
    if (!still()) return false;
    if (ctx && (!ctx.selected || ctx.selected.id !== item.blockId || ctx.selected.deleted)) throw new Error("that note is no longer there; search again");
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
  // A new page (PIE-592): made before it's linked, so the link never names nothing.
  let made: string | null = null;
  if (item.newPage) {
    const r = await board.followPage(item.newPage, by).catch((e: Error) => { throw new Error(`the page wasn't made: ${e.message}`); });
    if (!still()) return false;
    if (!r.note) throw new Error(r.status === "deleted" ? `[[${item.newPage}]] is a page in the trash: restore it there` : `the page wasn't made (${r.status})`);
    made = r.created ? `made page ${item.newPage} ${r.placement?.said ?? ""}`.trim() + " · ctrl+l opens it" : `${item.newPage} was there already · ctrl+l opens it`;
  }
  // Right before the splice, with no wait between: what the insert uses up (an invitation) is spent only when it lands.
  commit?.();
  d.splice(target.start, target.end, item.insertion, item.anchor && own?.blockId === item.blockId ? { [item.anchor.lineIndex]: item.anchor.line } : {}, by, by.kind === "user" ? item.selection : undefined);
  if (made) d.note = made;
  return true;
}

export interface CompletionState extends CompletionLookup {
  previewRect?: Rect;
  listWidth?: number;
  listCol?: number;
  target: CompletionTarget;
  previewLines?: string[];
  previewTop?: number;
  previewSelection?: Selection;
  index: number;
  loading: boolean;
  /** Where the cursor was when it was asked: a reply for anywhere else is dropped. */
  at: { row: number; col: number; line: string };
  /** The person chose the popup with arrows, the wheel, a click, Tab or Ctrl+Space. */
  picked?: boolean;
  /** The person moved the lit row (arrows, the wheel, a click): a re-order keeps it lit (PIE-1409). */
  moved?: boolean;
  /** It completes a line (a filter, a property's value), whose ⏎ applies it, rather than a draft's text. */
  line?: boolean;
}

/** One draft's completion popup: a lookup at a time, newer typing or a dismissal dropping older answers. */
export class Completer {
  state: CompletionState | null = null;
  /** The tile host paints this popup after the screen, beyond the editor's rectangle. */
  screenLayer = false;
  private preview: { item: CompletionItem; surface: NoteSurface; host: SurfaceHost } | null = null;
  /** The lookup and what follows it (Jev's re-order, the preview's context): the pause for typing, latest-wins, abort. */
  private readonly search = new SearchSchedule(TYPING_PAUSE_MS);
  private previewGesture = new Gesture();
  private accepting = false;
  private loadingMore = false;
  private limit = COMPLETION_LIMIT;
  /** The order `::` first listed the components in, kept for this draft. */
  private componentOrder?: Map<string, { i: number; group?: string }>;
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
  /** `turn` is still the newest lookup's (none, for a list no lookup made), and the popup is where the cursor is. */
  private current(turn: SearchTurn | null): boolean {
    const s = this.state, h = this.here();
    return turn === this.search.turn && (!turn || turn.alive()) && !!s && s.at.row === h.row && s.at.col === h.col && s.at.line === h.line;
  }

  dismiss(): void {
    this.search.cancel();
    this.previewGesture.cancel();
    if (!this.state) return;
    this.state = null;
    this.parent = null;
    this.preview?.surface.dispose();
    this.preview = null;
    this.redraw();
  }

  private near(): string | undefined { return nearOf(this.d, this.own()); }

  /**
   * After a pause, ask the service again with Jev re-ordering the same candidates. The answer is used only if
   * nothing moved meanwhile (the query, the cursor, the selection); a row the person moved to stays selected, the top
   * row stays the top.
   */
  private askJev(turn: SearchTurn, target: CompletionTarget): void {
    const fragment = target.kind === "block" && parseFragmentCompletionQuery(target.query);
    if (target.kind !== "page" && target.kind !== "block" || fragment || target.query.trim().length < 3 || jevOff.has(this.board)) return;
    // Jev re-orders the service's candidates (up to 30 for ((): one beyond the 20 shown can come into view.
    turn.after(JEV_PAUSE_MS, async () => {
      const s = this.state;
      // One row is nothing to re-order, except `[[` naming no page yet: Jev reads the pages by meaning (PIE-1409).
      if (!s || !this.current(turn) || s.loading || (s.items.length < 2 && !(target.kind === "page" && s.items[0]?.newPage)) || this.accepting || this.d.busy) return;
      const index = s.index, chosen = s.items[index]?.insertion;
      s.jev = "asking";
      this.redraw();
      try {
        const r = await lookupCompletion(this.board, target, this.own(), { semantic: true, near: this.near(), limit: this.limit, host: ambient?.board === this.board ? ambient.host?.() : undefined, signal: turn.signal });
        if (r.jevOff) jevOff.add(this.board);
        const now = this.state;
        if (now !== s) return;
        // Anything moved meanwhile (the pick, the cursor, a save or an insert under way): the answer isn't used.
        if (!this.current(turn) || now.index !== index || now.items[index]?.insertion !== chosen || this.accepting || this.d.busy) { now.jev = undefined; this.redraw(); return; }
        // A row the person moved to stays lit wherever Jev puts it; the top row (never moved off) is Jev's best, not
        // the old best followed down the list (PIE-1409: a 0.0/3 row lit at 19/20).
        // A new page alone on the list stays lit with Jev's finds above it: Enter stays the draft's until one is chosen.
        const follow = now.moved || !!now.items[index]?.newPage;
        const at = follow ? r.items.findIndex(i => i.insertion === chosen) : 0;
        if (at < 0 || !r.items.length) { now.jev = undefined; this.redraw(); return; }
        this.state = { ...r, target, picked: now.picked, moved: now.moved, line: now.line, index: at, loading: false, at: now.at };
        this.redraw();
        void this.enrich(turn);
      } catch {
        if (this.state === s) { s.jev = undefined; this.redraw(); }
      }
    });
  }

  /**
   * Look up the token at the cursor (or close the popup when the cursor isn't in one). A lookup that asks the service
   * waits for typing to pause (TYPING_PAUSE_MS) unless asked on purpose (`explicit`: Tab, Ctrl+Space, `complete.ask`);
   * resolves once it's drawn, or replaced.
   */
  refresh(explicit = false): Promise<void> {
    this.parent = null;
    const target = this.target();
    if (!target || this.d.busy) { this.dismiss(); return Promise.resolve(); }
    this.limit = COMPLETION_LIMIT;
    // A re-ask of the same query keeps the pick; a changed query picks its best match.
    const same = this.state?.target.kind === target.kind && this.state.target.query === target.query;
    const picked = explicit || (same && this.state?.picked);
    const turn = this.search.begin(), was = same ? this.state?.items[this.state.index]?.insertion : undefined;
    this.state = { target, picked, line: this.d.complete !== undefined, items: this.state?.items ?? [], index: this.state?.index ?? 0, truncated: null, message: "finding references...", loading: true, at: this.here() };
    this.redraw();
    if (explicit || !asksService(this.board, target)) return this.lookup(turn, target, was);
    return new Promise<void>(done => {
      turn.signal.addEventListener("abort", () => done(), { once: true });
      this.search.pause(() => void this.lookup(turn, target, was).then(done));
    });
  }

  private async lookup(turn: SearchTurn, target: CompletionTarget, was: string | undefined): Promise<void> {
    try {
      // Only an answer is kept for the draft: a failed lookup is asked again next time, as the outliner does.
      const r = await lookupCompletion(this.board, target, this.own(), { near: this.near(), limit: this.limit, host: ambient?.board === this.board ? ambient.host?.() : undefined, signal: turn.signal });
      if (r.jevOff) jevOff.add(this.board);
      if (!this.current(turn)) return;
      // `::` with nothing typed lists the components used ones first: the order this draft first saw stays while it's
      // written (PIE-1127), so a component used meanwhile doesn't move the rows under the person's eye.
      if (target.kind === "component" && !target.query.trim()) {
        const key = (i: CompletionItem) => i.id ?? i.insertion;
        this.componentOrder ??= new Map(r.items.map((item, i) => [key(item), { i, group: item.group }]));
        const first = (i: CompletionItem) => this.componentOrder!.get(key(i));
        // Each row keeps its first place and the heading it was under then.
        r.items = [...r.items].sort((a, b) => (first(a)?.i ?? Infinity) - (first(b)?.i ?? Infinity)).map(i => first(i) ? { ...i, group: first(i)!.group } : i);
      }
      // A `[` that starts no property the schemas know (a Markdown link's text, say) opens nothing.
      if (!r.items.length && target.kind !== "page" && target.kind !== "block" && target.kind !== "file" && target.kind !== "callout") { this.dismiss(); return; }
      const index = Math.max(0, r.items.findIndex(i => i.insertion === was));
      this.state = { ...r, target, picked: this.state?.picked, line: this.state?.line, index, loading: false, at: this.state!.at };
      this.redraw();
      void this.enrich(turn);
      this.askJev(turn, target);
    } catch (e) {
      if (this.current(turn)) { this.state = { ...this.state!, items: [], loading: false, message: `lookup failed: ${e instanceof Error ? e.message : String(e)}` }; this.redraw(); }
    }
  }

  /** The selected candidate's ancestors and first lines, from `blocks.context`. */
  private async enrich(turn = this.search.turn): Promise<void> {
    const item = this.state?.items[this.state.index];
    if (!item?.blockId || this.preview?.item === item) return;
    try {
      const [ctx, { NoteSurface }] = await Promise.all([this.board.blockContext(item.blockId), import("./note")]);
      if (!this.current(turn) || this.state?.items[this.state.index] !== item) return;
      if (ctx.selected) {
        this.preview?.surface.dispose();
        const surface = new NoteSurface();
        // The docs panel reads the note, not its conversation: no margin cards in a panel 30 columns wide.
        surface.setMargin("off");
        const host: SurfaceHost = { ctx: { board: this.board, t: { cols: 80, rows: 20, cellW: 9, cellH: 18, kitty: false }, graphics: false, flash: (s: string) => { this.d.note = s; }, redraw: this.redraw } as unknown as Ctx, redraw: this.redraw, navigate() {},
          header: (m, w) => [fg(C.grey) + pad([headedTitle(m), ...ctx.ancestors.map(title), m.author].filter(Boolean).join(" · "), w) + RESET],
        };
        const own = this.own();
        const note = own?.blockId === item.blockId ? { ...ctx.selected, text: own.text } : ctx.selected;
        surface.show(note, host);
        this.preview = { item, surface, host };
        if (item.fragmentId && !item.anchor && own?.blockId !== item.blockId) await surface.revealFragment(item.fragmentId, host);
        else if (item.passageLine !== undefined) {
          const offset = note.text.split("\n").slice(0, item.passageLine).reduce((n, l) => n + l.length + 1, 0);
          await surface.revealAt(offset, host);
        } else {
          const lines = note.text.split("\n");
          const hit = rankTextSearchMatches(lines.map((text, line) => ({ id: String(line), title: "", text, line })), this.state!.target.query, 1)[0]?.document;
          if (hit) await surface.revealAt(lines.slice(0, hit.line).reduce((n, l) => n + l.length + 1, 0), host);
        }
        item.preview = (w, h) => surface.render(w, h, host).lines.slice(0, h).map(l => l.replace(TAGS, "").replace(MARKS, ""));
      }
      item.docs = ctx.selected ? [...ctx.ancestors.map(title), snippet(ctx.selected.text)].filter(Boolean).join(" » ") : "target unavailable";
      this.redraw();
    } catch { /* the snippet from the lookup stays */ }
  }

  /** Whether the docs panel has more than it shows: shift+up/down are its then (docsScroll). */
  get docsScroll(): boolean { return !!this.shown && docsScroll(this.shown); }

  scrollPreview(by: number): boolean {
    if (!this.docsScroll) return false;
    void COMPLETION_ACTIONS.run("complete.preview", { by }, this, USER);
    return true;
  }

  overPreview(x: number, y: number): boolean {
    const r = this.shown?.previewRect, at = this.drawn;
    if (!r || !at) return false;
    x -= at.col ?? 0; y -= at.row;
    return x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows;
  }

  selectPreview(text: string, actor: Actor): string {
    const s = this.shown;
    if (!s?.previewLines) throw new Error("open a component preview first");
    const rows = rowsOf(s.previewLines), selected = selectText(rows, text);
    if (actor.kind === "user") { s.previewSelection = selected; this.redraw(); }
    return selected.text(rows);
  }

  previewBy(by: number, actor: Actor): boolean {
    const p = this.preview;
    if (!p || p.item !== this.shown?.items[this.shown.index]) {
      const s = this.shown;
      if (!s?.previewLines) return false;
      s.previewTop = Math.max(0, Math.min(Math.max(0, s.previewLines.length - (s.previewRect?.rows ?? 1)), (s.previewTop ?? 0) + by));
      s.previewSelection = undefined;
      this.redraw(); return true;
    }
    void p.surface.act("scroll", { by }, p.host, actor);
    return true;
  }

  /** Where the last render drew the popup, in the editor's rows: its first row and each row's candidate. */
  drawn: { row: number; col?: number; cols?: number; anchor?: number; items: (number | null)[] } | null = null;

  /**
   * A click selects and previews; a double click inserts. The preview and frame consume clicks without choosing.
   */
  click(y: number, x = 0, copy?: (text: string) => void): boolean {
    const s = this.shown, at = this.drawn;
    if (!s || !at || y < at.row || y >= at.row + at.items.length) return false;
    if (at.cols !== undefined && (x < (at.col ?? 0) || x >= (at.col ?? 0) + at.cols)) return false;
    if (this.overPreview(x, y)) {
      const localRow = y - at.row - s.previewRect!.row + (s.previewTop ?? 0);
      const localCol = x - (at.col ?? 0) - s.previewRect!.col;
      const row = visible(s.previewLines?.[localRow] ?? "");
      const released = this.previewGesture.release(x, y);
      if (!released.moved && row.startsWith("[copy]") && localCol < 6) {
        void COMPLETION_ACTIONS.run("complete.copy", {}, this, USER); return true;
      }
      if (!released.moved && row.startsWith("[g]") && localCol < 3) {
        void COMPLETION_ACTIONS.run("complete.definition", {}, this, USER); return true;
      }
      const text = s.previewSelection?.text(rowsOf(s.previewLines ?? []));
      if (text && released.copy) copy?.(text);
      if (!released.moved && released.n === 1) s.previewSelection = undefined;
      return true;
    }
    if (x < (at.col ?? 0) + (s.listCol ?? 0) || x >= (at.col ?? 0) + (s.listWidth ?? Infinity)) return true;
    const i = at.items[y - at.row];
    if (i !== null && i !== undefined && s.items[i] && !s.loading) {
      if (s.index !== i) { s.previewTop = 0; s.previewSelection = undefined; this.previewGesture.cancel(); s.moved = true; }
      s.index = i; s.picked = true;
      if (s.items[i]!.children && at.items[y - at.row - 1] !== i && x === (at.col ?? 0) + (s.listWidth ?? 0) - 1) {
        void COMPLETION_ACTIONS.run("complete.step", { direction: "right" }, this, USER);
        return true;
      }
      const press = completionPicker(s).view.press(i, { mods: 0, button: 0 });
      this.redraw(); void this.enrich();
      if (press === "open") personRuns("complete.accept", { n: i + 1 }, this);
    }
    return true;
  }

  /** Repaint in the host's frame, keeping hit columns relative to its measured text. */
  inFrame(w: number, col: number, height = this.drawn?.items.length ?? 0, values?: StyleValues): string[] {
    const at = this.drawn, s = this.shown;
    if (!at || !s) return [];
    at.col = col;
    at.cols = w;
    return renderCompletion(s, w, height, at.items, (at.anchor ?? 0) - col, values);
  }

  previewPress(x: number, y: number, drag: boolean): boolean {
    const s = this.shown, at = this.drawn;
    if (!s || !at || !this.overPreview(x, y) || !s.previewLines) return false;
    const pos = { col: x - (at.col ?? 0) - s.previewRect!.col, row: y - at.row - s.previewRect!.row + (s.previewTop ?? 0) };
    if (drag) {
      if (this.previewGesture.drag(x, y) && s.previewSelection) s.previewSelection.head = pos;
    } else {
      this.previewGesture.press(x, y);
      s.previewSelection = new Selection(pos, pos);
    }
    this.redraw(); return true;
  }

  copySource(actor: Actor): string {
    const source = this.shown?.items[this.shown.index]?.source;
    if (!source) throw new ActionRefused("select a component first");
    if (actor.kind === "user") ambient?.host?.().ctx.copy?.(source, "component source");
    return source;
  }

  jumpDefinition(actor: Actor): unknown {
    const id = this.shown?.items[this.shown.index]?.definition;
    if (!id) throw new ActionRefused("select a script note first");
    const host = ambient?.host?.();
    if (actor.kind === "agent" || !host) return { blockId: id };
    return openNote(id, host, { alt: true, actor });
  }

  get hasParent() { return this.parent !== null; }
  private parent: CompletionState | null = null;
  expand(): boolean {
    const s = this.shown, item = s?.items[s.index];
    if (!s || !item?.children) return false;
    this.parent = s;
    // Its variations and arguments, as the service answered them (PIE-1344).
    this.state = { ...s, items: item.children, previewLines: undefined, previewTop: 0, previewSelection: undefined, index: 0, picked: true, heading: `${item.label}: variations and arguments` };
    this.redraw();
    return true;
  }
  back(): boolean {
    if (!this.parent) return false;
    this.state = this.parent; this.parent = null; this.redraw(); return true;
  }

  /** The wheel's or a key's move through the rows: the `complete.move` action, as `act` runs it. */
  move(delta: number): void { personRuns("complete.move", { by: delta }, this); }

  /** Light the row `delta` rows on (complete.move). */
  moveBy(delta: number): boolean {
    const s = this.state;
    if (!s?.items.length) return false;
    s.picked = true; s.moved = true;
    s.previewTop = 0; s.previewSelection = undefined;
    const picker = completionPicker(s);
    picker.sel = s.index;
    for (let i = 0; i < Math.abs(delta); i++) picker.key({ kind: delta < 0 ? "up" : "down" }, undefined);
    s.index = picker.sel;
    if (delta > 0 && s.index >= s.items.length - 3) void this.more();
    this.redraw();
    void this.enrich();
    return true;
  }

  private async more(): Promise<void> {
    const s = this.shown, turn = this.search.turn;
    if (!s || s.target.kind !== "block" || !s.truncated || this.loadingMore) return;
    this.loadingMore = true;
    turn?.dropAfter();
    const fragment = parseFragmentCompletionQuery(s.target.query);
    const offset = fragment ? this.limit : undefined;
    const limit = this.limit + COMPLETION_LIMIT;
    try {
      const r = await lookupCompletion(this.board, s.target, this.own(), { near: this.near(), limit: fragment ? COMPLETION_LIMIT : limit, offset, signal: turn?.signal });
      if (!this.current(turn) || this.state !== s) return;
      this.limit = limit;
      const seen = new Set(s.items.map(i => i.insertion));
      s.items.push(...r.items.filter(i => !seen.has(i.insertion)));
      s.truncated = r.truncated;
      s.message = fragment && r.truncated ? "scroll for more fragments" : r.message;
      this.redraw();
      void this.enrich();
    } catch (e) {
      if (this.current(turn)) { s.message = `more matches: ${e instanceof Error ? e.message : String(e)}`; this.redraw(); }
    } finally { this.loadingMore = false; }
  }

  /** Enter / Tab: insert the selected candidate (checked with the service first). */
  async accept(index = this.state?.index ?? 0): Promise<boolean> {
    const s = this.state, item = s?.items[index], turn = this.search.turn;
    if (this.accepting || !s || !item || s.loading || !this.current(turn)) return false;
    this.accepting = true;
    try {
      if (!await insertCompletion(this.board, this.d, s.target, item, this.own(), () => this.current(turn))) return false;
      // Counted by the outline host (PIE-1340), so this pick ranks higher next time, here and in every other client.
      if (s.pickKey) void this.board.completionPicked?.(s.pickKey, item.insertion).catch(() => {});
      // A note picked from a search's list (ranked or not, as the bar's): the words and the note, the eval's label (PIE-1197).
      if ((s.target.kind === "page" || s.target.kind === "block") && item.blockId) this.board.searchPicked?.(s.target.query, item.blockId, index, "complete");
      this.dismiss();
      // A folder leaves `[file::notes/` open: its entries are offered next; a filter's key `stage:` its values. A chosen value ends it
      // (the cursor is still in its word, which would offer the same value again).
      if (s.target.kind !== "filter-value" && (s.target.kind !== "component" || item.kind === "property") && this.target()) void this.refresh();
      return true;
    } catch (e) {
      if (this.current(turn)) { s.message = e instanceof Error ? e.message : String(e); this.redraw(); }
      return false;
    } finally { this.accepting = false; }
  }
}

export const COMPLETION_PREVIEW = {
    summary: "scroll the docs panel beside the completion list (the lit row's docs, a reference's reader, a component's demo), or select text from a component demo; an agent reads that text without changing the person's selection",
    keys: "shift+up, shift+down, PgUp/PgDn, wheel over the docs",
    touches: "tile", replay: "safe",
    touchesWith: ({ text }: { text?: string }): "nothing" | "tile" => text === undefined ? "tile" : "nothing",
    args: { by: { type: "number", optional: true, about: "rows to scroll; negative goes up" }, text: { type: "string", optional: true, about: "component preview text to select; an agent reads it without changing the selection" } },
    examples: [{ act: "complete.preview by=3", does: "reads three rows further in the selected reference" }],
} as const;

export const COMPLETION_STEP = {
  summary: "show a component's variations and arguments, or return to components",
  keys: [{ keys: "right", does: "into a component's variations" }, { keys: "click", does: "on >" }, { keys: "left", does: "returns", says: "return from a component's variations to the components" }], touches: "nothing", replay: "safe",
  args: { direction: { type: "string", choices: ["right", "left"], about: "right opens variations; left returns" } },
  examples: [{ act: "complete.step direction=right", does: "shows the selected component's variations and arguments" }],
} as const;

export const COMPLETION_COPY = {
  summary: "copy the selected component's source, ready to paste into a note",
  keys: [{ keys: "y", does: "after choosing a component" }, { keys: "click", does: "[copy]" }], touches: "nothing", replay: "safe", args: {},
} as const;
export const COMPLETION_DEFINITION = {
  summary: "open the selected agent's defining script note beside the draft",
  keys: [{ keys: "g", does: "after choosing an agent" }, { keys: "click", does: "[g]" }], touches: "nothing", replay: "safe", args: {},
} as const;

export const COMPLETION_MOVE = {
  summary: "light another row of the open completion list (PIE-1339): by= rows, negative up; the docs beside it follow the lit row",
  keys: "up/down, wheel over the list", touches: "draft", draft: "type", replay: "safe",
  args: { by: { type: "number", about: "rows to move; negative goes up" } },
  examples: [{ act: "complete.move by=2", does: "lights the row two below the lit one" }],
} as const;
export const COMPLETION_ACCEPT = {
  words: "insert the lit completion row",
  summary: "insert the lit row of the open completion list, or row n= (from 1), as tab or enter does: checked with the service first, one undo step",
  keys: "tab, enter (unless the footer says it's a new line), double click", touches: "draft", draft: "type", replay: "ask",
  args: { n: { type: "number", optional: true, about: "the row to insert (from 1); default the lit one" } },
  examples: [{ act: "complete.accept", does: "inserts the lit row" }, { act: "complete.accept n=3", does: "inserts the third row" }],
} as const;
export const COMPLETION_ASK = {
  words: "open the completion list where you're typing",
  summary: "open (or ask again) the completion list for the token at the cursor, as a deliberate choice: ⏎ then inserts its lit row",
  keys: "tab, ctrl+space in a [[, ((, ::, > [! or [key:: token", touches: "draft", draft: "type", replay: "safe", args: {},
  examples: [{ act: "complete.ask", does: "lists the candidates for the token at the draft's cursor, in the popup" }],
} as const;
export const COMPLETION_DISMISS = {
  summary: "close the open completion list, leaving what's typed as it is",
  keys: "esc, a click outside", touches: "draft", draft: "type", replay: "safe", args: {},
} as const;

export const COMPLETION_ACTIONS = actionSet<Completer>()("completion", {
  "complete.move": def({ ...COMPLETION_MOVE, run({ by }, c) {
    if (!c.shown?.items.length) throw new ActionRefused("no completion list is open; type [[, ((, :: or a [key:: first");
    c.moveBy(by);
    const s = c.shown!;
    return { index: s.index + 1, of: s.items.length, label: s.items[s.index]?.label };
  } }),
  "complete.accept": def({ ...COMPLETION_ACCEPT, async run({ n }, c) {
    const s = c.shown;
    if (!s?.items.length) throw new ActionRefused("no completion list is open; type [[, ((, :: or a [key:: first");
    const i = n === undefined ? s.index : n - 1, item = s.items[i];
    if (!item) throw new ActionRefused(`there is no row ${n}; there are ${s.items.length}`);
    if (!await c.accept(i)) throw new ActionRefused(`not inserted${s.message ? `: ${s.message}` : ""}`);
    return { inserted: item.insertion };
  } }),
  "complete.ask": def({ ...COMPLETION_ASK, async run(_, c) {
    if (!c.target()) throw new ActionRefused("the cursor isn't in a [[, ((, [file::, > [!, ::component, a [key:: property or a figure's YAML");
    await c.refresh(true);
    const s = c.shown;
    return { kind: s?.target.kind, rows: s?.items.length ?? 0, ...(s?.message ? { message: s.message } : {}) };
  } }),
  "complete.dismiss": def({ ...COMPLETION_DISMISS, run(_, c) { const open = !!c.state; c.dismiss(); return { closed: open }; } }),
  "complete.copy": def({ ...COMPLETION_COPY, run(_, c, actor) { return c.copySource(actor); } }),
  "complete.definition": def({ ...COMPLETION_DEFINITION, run(_, c, actor) { return c.jumpDefinition(actor); } }),
  "complete.step": def({
    ...COMPLETION_STEP,
    run({ direction }, c, actor) {
      if (actor.kind === "agent") return c.shown?.items[c.shown.index]?.children ?? [];
      return direction === "left" ? c.back() : c.expand();
    },
  }),
  "complete.preview": def({
    ...COMPLETION_PREVIEW,
    run({ by, text }, c, actor) { return text === undefined ? c.previewBy(by ?? 0, actor) : c.selectPreview(text, actor); },
  }),
});

/**
 * The person's key, wheel or click running one of the list's actions: a refusal (an insert the service turned down, a
 * second ⏎ while the first is checked) is already said in the popup's footer, so it ends there rather than as an
 * unhandled rejection. `act` callers await the action and get the refusal.
 */
function personRuns<K extends "complete.move" | "complete.accept" | "complete.ask" | "complete.dismiss">(name: K, args: Parameters<typeof COMPLETION_ACTIONS.run<K>>[1], c: Completer): void {
  const refused = (e: unknown) => { if (!(e instanceof ActionRefused)) throw e; };
  // An action's own run is called at once (ActionSet.call), so a refusal can come before there's a promise to catch.
  try { COMPLETION_ACTIONS.run(name, args, c, USER).catch(refused); } catch (e) { refused(e); }
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

const AUTO_OPENING_KINDS: ReadonlySet<CompletionKind> = new Set([
  "button-step", "fence-setting", "component", "attribute", "attribute-value", "key", "value", "yaml-key", "yaml-value", "filter-key", "filter-value",
]);

/** Where a line ends in ⏎ as it's written (a figure's YAML, a fence's settings): ⏎ stays a new line until a choice. */
const ENTER_ENDS_THE_LINE: ReadonlySet<CompletionKind> = new Set(["yaml-key", "yaml-value", "fence-setting"]);

const isCtrlSpace = (k: Key) => k.kind === "char" && !!k.ctrl && (k.ch === "`" || k.ch === " " || k.ch === "@");

/**
 * The popup's own keys, for a draft or a line: while it has candidates, up/down choose, Enter accepts (auto-opening kinds need a deliberate choice) and Tab inserts; Esc closes
 * the popup (and only the popup). Tab or Ctrl+Space in a token asks again; Tab anywhere else is the field's. True when
 * the popup took the key.
 */
function popupKey(d: CompletionField, k: Key, c: Completer, line = false): boolean {
  if (c.shown && (k.kind === "pgup" || k.kind === "pgdn" || ((k.kind === "up" || k.kind === "down") && k.shift)) && c.scrollPreview(k.kind === "pgup" ? -8 : k.kind === "pgdn" ? 8 : k.kind === "up" ? -1 : 1)) return true;
  if (c.state && !c.shown) c.dismiss();
  const s = c.state;
  if (s) {
    // A line (a filter, a panel value) has esc of its own: a popup with nothing to choose never keeps it.
    if (k.kind === "char" && k.ctrl && k.ch === "c" && s.previewSelection) {
      ambient?.host?.().ctx.copy?.(s.previewSelection.text(rowsOf(s.previewLines ?? [])), "component preview"); return true;
    }
    if (k.kind === "esc") { personRuns("complete.dismiss", {}, c); return !line || !!s.items.length; }
    if (s.items.length && !s.loading) {
      const item = s.items[s.index];
      if (k.kind === "char" && !k.ctrl && k.ch === "y" && s.picked && item?.source) { void COMPLETION_ACTIONS.run("complete.copy", {}, c, USER); return true; }
      if (k.kind === "char" && !k.ctrl && k.ch === "g" && s.picked && item?.definition) { void COMPLETION_ACTIONS.run("complete.definition", {}, c, USER); return true; }
      if (k.kind === "char" && !k.ctrl && (k.ch === "^" || k.ch === "#") && s.target.kind === "block" && !parseFragmentCompletionQuery(s.target.query) && item?.blockId) {
        d.splice(s.target.start, s.target.end, `((${item.blockId}${k.ch}`);
        void c.refresh();
        return true;
      }
      if (k.kind === "right" && item?.children) { void COMPLETION_ACTIONS.run("complete.step", { direction: "right" }, c, USER); return true; }
      if (k.kind === "left" && c.hasParent) { void COMPLETION_ACTIONS.run("complete.step", { direction: "left" }, c, USER); return true; }
      if (k.kind === "up" || k.kind === "down") { c.move(k.kind === "up" ? -1 : 1); return true; }
      // A new page lit and not chosen on purpose (PIE-592: ↓, ↑ or a click; PIE-1409: Jev's finds above it): Enter and Tab stay the draft's.
      const lone = !!s.items[s.index]?.newPage && !s.picked;
      // Tab and Enter both insert the lit row; where Enter is the field's, the footer says so (enterKeeps).
      if ((k.kind === "tab" || (k.kind === "enter" && !enterKeeps(s))) && !lone) { personRuns("complete.accept", {}, c); return true; }
    }
  }
  if (k.kind === "tab" || isCtrlSpace(k)) {
    if (c.target()) { personRuns("complete.ask", {}, c); return true; }
    if (k.kind !== "tab") { d.note = "completion works inside [[, ((, [file::, a callout's > [!, ::component, a [key:: property or a figure's YAML"; return true; }
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
let ambient: { board: SocketBoard; redraw: () => void; host?: () => BarHost } | null = null;
export function useCompletion(board: SocketBoard | null, redraw: () => void = () => {}, host?: () => BarHost): void { ambient = board && { board, redraw, host }; }
/** The door ended: lines made after it complete nothing (a line made earlier keeps its own connection). */
export function stopCompletion(board: SocketBoard): void { if (ambient?.board === board) ambient = null; }

/** A draft's completer from the session's connection, else the door's (a comment's session has none of its own). */
export function defaultCompleter(d: CompletionField, board?: unknown, redraw?: () => void): Completer | null {
  return completerFor(d, board ?? ambient?.board, redraw ?? ambient?.redraw ?? (() => {}));
}

const openAt = new WeakMap<LineField, CompletionTarget | undefined>();
/** A line's completer, made on first use, from the connection the line was made under. */
export function lineCompleter(i: LineField): Completer | null {
  const host = i.completionHost as { board: SocketBoard; redraw: () => void } | null;
  return host ? completerFor(i, host.board, host.redraw) : null;
}

// What every `LineField.key` does around its own: the popup first, then it follows the typing.
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
  if (!took || k.kind === "esc" || k.kind === "paste" || "pasted" in k) { c.dismiss(); return; }
  followCursor(c, i.text !== was, openAt.get(i));
};

/**
 * The popup as lines `w` wide, at most `h` tall: header, candidates (the selected one with its context),
 * footer. `rows`, when given, gets each line's candidate index (null for the header, context and footer).
 */
export function renderCompletion(s: CompletionState, w: number, h: number, rows: (number | null)[] = [], anchor = 0, values?: StyleValues): string[] {
  if (h < 4 || w < 8) return completionLines(s, w, h, rows, anchor);
  const body = completionLines(s, w - 3, h - 3, rows, Math.max(0, anchor - 1));
  const canvas = new Canvas(w, body.length + 3);
  const rect = { col: 0, row: 0, cols: w - 1, rows: body.length + 2 };
  canvas.float(rect, "", "", () => body.forEach((line, y) => canvas.text(1, y + 1, line, w - 3)), false, values);
  rows.unshift(null); rows.push(null, null);
  s.listCol = (s.listCol ?? 0) + 1;
  s.listWidth = (s.listWidth ?? w - 3) + 1;
  if (s.previewRect) s.previewRect = { ...s.previewRect, col: s.previewRect.col + 1, row: s.previewRect.row + 1 };
  return canvas.lines();
}

function completionLines(s: CompletionState, w: number, h: number, rows: (number | null)[] = [], anchor = 0): string[] {
  rows.length = 0;
  s.previewRect = undefined;
  if (h <= 0) return [];
  // Titles come from notes: text.ts's printable takes out what a terminal acts on, pad cuts by cells, and a glyph
  // the VGA font lacks goes as its lookalike at the sink (App, CP437_NEAREST).
  const line = (text: string, colour: string, back = "") => back + colour + pad(printable(text, " "), w) + RESET;
  const reference = s.target?.kind === "block" || s.target?.kind === "page";
  const echo = reference ? `  ${printable(s.at.line.slice(s.target.start, s.at.col), " ")}▌` : "";
  const scopes = reference ? [...s.target.query.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_.-]*):[ \t]*("[^"]*"|'[^']*'|[^\s:]*(?=\s|$))/g)]
    .map(m => chip(C.blue) + ` ${m[1]}: ${printable(m[2]!.replace(/^['"]|['"]$/g, ""), " ")} ` + RESET).join(" ") : "";
  if (!s.items.length) {
    const out = reference && h > 1 ? [fg(C.lcyan) + pad(echo + (scopes ? ` ${scopes}` : ""), w) + RESET] : [];
    out.push(line(` ${s.message || "no matches"}`, fg(s.loading ? C.grey : C.yellow)));
    rows.push(...out.map(() => null));
    return out;
  }
  const header = h >= 3, footer = h >= 2 && (!reference || h >= 6);
  const out: string[] = [];
  const heading = { attribute: "attributes", "attribute-value": "values", component: "components", agent: "agents", callout: "callout types", key: "properties", "yaml-key": "properties", "filter-key": "properties", value: "values", "yaml-value": "values", "filter-value": "values" }[s.target?.kind as string] ?? "references";
  const ranking = !footer && s.jev ? ` · jev ${s.jev}` : "";
  if (header) rows.push(null), out.push(fg(C.lcyan) + pad(` ${printable(s.heading ?? heading, " ")} ${s.index + 1}/${s.items.length}${echo}${ranking}${scopes ? ` ${scopes}` : ""}${s.loading ? " · finding..." : ""}`, w) + RESET);
  const picker = completionPicker(s);
  picker.sel = s.index;
  const selected = s.items[s.index]!;
  // The docs panel (PIE-1339, PIE-1245): the lit row's docs wrapped at the panel's own width, then what it draws; a
  // reference's own reader once it's read (enrich). Every line is kept, so shift+up/down and the wheel scroll it.
  const preview = (pw: number, ph: number) => {
    if (selected.blockId && selected.preview) { s.previewLines = undefined; return selected.preview(pw, ph); }
    const docs = selected.docs ?? (selected.preview ? "" : selected.insertion);
    const lines = [...(docs ? docs.split("\n").flatMap(d => rowLines(printable(d, " "), pw, Infinity)).map(l => fg(C.lcyan) + l + RESET) : []), ...(selected.preview?.(pw, 10000) ?? [])];
    s.previewLines = lines;
    // Not clamped here: the room rule asks once to measure, at a height other than the panel's (previewBy clamps).
    const top = s.previewTop ?? 0;
    return lines.slice(top, top + ph).map((line, i) => {
      const span = s.previewSelection?.span(top + i);
      return span ? paintRange(line, span[0], span[1], SELECT_BG) : line;
    });
  };
  const labelWidth = Math.min(w, listMaxCols(w), Math.max(...s.items.map(rowWidth)));
  const anchorCol = s.target.kind === "agent" || s.target.kind === "component" || s.target.kind === "attribute" || s.target.kind === "attribute-value" ? 0 : anchor;
  const drawn = listPreview(picker, w, h - Number(header) - Number(footer), preview, 0, w, { col: anchorCol, width: labelWidth }, { list: labelWidth });
  if (drawn.preview) s.previewRect = { ...drawn.preview, row: drawn.preview.row + Number(header) };
  s.listCol = drawn.listCol;
  s.listWidth = drawn.listWidth;
  rows.push(...drawn.rows); out.push(...drawn.lines);
  // Whether Jev ordered the list, said quietly first, where a narrow popup doesn't cut it.
  const long = s.jev === "ranked" ? (s.sure?.label ? `jev ranked · ${s.sure.label} · ` : "jev ranked · ") : s.jev === "asking" ? "jev… · " : "";
  // Where it and a note about the list don't both fit (40 columns, PIE-1409), how sure is said in its own words alone.
  const jev = s.message && s.sure?.label && cells(` ${long}${s.message}`) > w ? `${s.sure.label} · ` : long;
  const hint = completionHint(s, selected);
  const enter = enterKeeps(s);
  const keys = enter ? `↑↓ tab ⏎ ${enter} esc` : "↑↓ ⏎/tab esc";
  // The keys stay said under a note about the list (the first 20, a refusal): the note first, the keys after it.
  const said = s.message ? `${s.message} · ` : "";
  const fitted = cells(` ${jev}${said}${hint}`) <= w ? hint : cells(` ${jev}${said}${keys}`) <= w ? keys : "";
  if (footer) rows.push(null), out.push(line(` ${jev}${said}${fitted}`.replace(/ · $/, ""), fg(s.message ? C.yellow : C.grey)));
  rows.length = Math.min(rows.length, h);
  return out.slice(0, h);
}

/** The columns a row wants: marker, label, its detail (up to a cap), its kind and a component's arrow. */
const DETAIL_COLS = 28;
/**
 * The list is never wider than this, so a wide pane keeps 30 columns for its docs beside it (a long title is cut with
 * …): 48 columns, more as the pane widens, up to 60.
 */
const listMaxCols = (w: number) => Math.min(60, Math.max(48, w - 36));
function rowWidth(it: CompletionItem): number {
  const label = cells(printable(it.label, " "));
  const detail = it.detail ? 2 + Math.min(DETAIL_COLS, cells(printable(it.detail, " "))) : 0;
  return 3 + label + detail + (it.kind ? 2 + cells(it.kind) : 0) + 1 + (it.children ? 2 : 0);
}

/**
 * Whether ⏎ is the field's rather than the popup's (PIE-1339), and what the footer says it does then. ⏎ inserts the lit
 * row as Tab does, except: a filter's words or a property value's (filter-key, filter-value) keep ⏎ to apply what's
 * typed (a `[[` or `((` in that line still inserts); a figure's YAML and a script fence's settings keep ⏎ a new line,
 * since a line there ends in one; a property or a heading's `::` offered before anything is typed does too; and so does
 * a row that would leave the line as it is (the value already typed out). A deliberate choice (arrows, the wheel, a
 * click, Tab or ctrl+space) makes ⏎ insert. A lone new page is never taken by ⏎ unless chosen (PIE-592).
 */
export function enterKeeps(s: CompletionState): "new line" | "applies" | null {
  const item = s.items[s.index];
  if (s.picked || !item) return null;
  const word = s.line ? "applies" : "new line";
  if (item.newPage) return word;
  if (s.target.kind === "filter-key" || s.target.kind === "filter-value") return "applies";
  if (ENTER_ENDS_THE_LINE.has(s.target.kind)) return word;
  if (AUTO_OPENING_KINDS.has(s.target.kind) && s.target.kind !== "component" && !s.target.query.trim()) return word;
  const line = s.at.line;
  if (line.slice(0, s.target.start) + item.insertion + line.slice(s.target.end) === line) return word;
  return null;
}

/** Whether the docs panel has more than it shows (a reference's reader always may): shift+up/down, PgUp/PgDn scroll it. */
function docsScroll(s: CompletionState): boolean {
  const item = s.items[s.index];
  if (!item) return false;
  if (item.blockId && item.preview) return true;
  return !!s.previewLines && !!s.previewRect && s.previewLines.length > s.previewRect.rows;
}

/** The footer's words for the popup's keys, from what the lit row can do and what ⏎ does here: the popup's and its host's hint row. */
/** The first `n` keys an action's own `keys` names, as keycaps (`up/down` is `↑ ↓`, `shift+up` `shift+↑`). */
function caps(keys: string, n: number): string {
  return [...declaredKeys(keys)].slice(0, n).map(keyCaption).join(" ").replace(/shift\+↑ shift\+↓/, "shift+↑↓");
}
export const popupHint = (s: CompletionState): string => completionHint(s, s.items[s.index]);
function completionHint(s: CompletionState, selected: CompletionItem | undefined): string {
  const enter = enterKeeps(s);
  const insert = enter ? `tab inserts · ⏎ ${enter}` : `${caps(COMPLETION_ACCEPT.keys, 2).replace(" ", "/").split("/").reverse().join("/")} inserts`;
  if (!selected) return "esc dismisses";
  const docs = docsScroll(s) ? ` · ${caps(COMPLETION_PREVIEW.keys, 2)} docs` : "";
  const extra = [
    selected.children ? "→ variations" : "", s.target.kind === "component" ? "← returns · y/[copy] source" : "",
    selected.definition ? "g/[g] definition" : "", s.target.kind === "block" && !parseFragmentCompletionQuery(s.target.query) ? "^/# narrow" : "",
  ].filter(Boolean).map(x => ` · ${x}`).join("");
  return `${caps(COMPLETION_MOVE.keys, 2).replace(" ", "")} move · ${insert}${docs}${extra} · ${caps(COMPLETION_DISMISS.keys, 1)} dismiss`;
}

const pickers = new WeakMap<CompletionState, ListPicker<CompletionItem, void>>();
function completionPicker(s: CompletionState): ListPicker<CompletionItem, void> {
  let picker = pickers.get(s);
  if (!picker) {
    picker = new ListPicker({ name: "completion", items: () => s.items,
      // A row (PIE-1339): marker, label with the typed letters lit, its detail dim, its kind at the right edge. Every row
      // draws the same way from its own fields; a component's › opens its variations.
      row: (it, _i, on, w) => {
        const arrow = it.children ? " ›" : "";
        const kind = it.kind ? ` ${it.kind} ` : " ";
        const room = Math.max(1, w - 3 - cells(kind) - cells(arrow));
        const label = ellipsize(printable(it.addition ? it.label.slice(0, -it.addition.length) : it.label, " "), room);
        const addition = it.addition ? ellipsize(it.addition, Math.max(0, room - cells(label))) : "";
        const left = room - cells(label) - cells(addition);
        const detail = it.detail && left > 3 ? ellipsize("  " + printable(it.detail, " "), left) : "";
        const lit = litCells(label, s.target.query);
        const words = [...label].map((c, i) => lit.has(i) ? fg(C.yellow) + c + fg(C.grey) : c).join("");
        const text = ` ${on ? "»" : " "} ${words}` + (addition ? fg(C.dark) + addition + fg(C.grey) : "") + (detail ? fg(C.dark) + detail + fg(C.grey) : "");
        const tail = fg(C.dark) + kind + fg(C.grey) + arrow;
        return [pickRow(pad(text, w - cells(kind) - cells(arrow)) + tail, on, w)];
      },
      heading: (it, i, w) => it.group && it.group !== s.items[i - 1]?.group ? fg(C.dark) + pad(` ${it.group} (${s.items.filter(row => row.group === it.group).length})`, w) + RESET : null,
      choose: () => {},
    });
    pickers.set(s, picker);
  }
  return picker;
}
