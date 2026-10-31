// Live figures: a ::graph-* block that asks the outline instead of restating it.
// The note stores the question (a query, or a saved view to read); the service answers it, and says when the
// answer changed (a watched read, src/watched.ts), so status lives in one place and every figure agrees. What each
// kind asks and what its answer becomes is outline-core's (figure-live.ts), shared with the publisher's figures; this
// module asks through the door's watched reads.
//
// A figure block's child bullets (src/graphs.ts FigureSource) are asked for here too (childRows), the same way.
import type { Msg } from "./board";
import type { SocketBoard } from "./socket";
import { subject } from "./board";
import { propertyListOf } from "./props";
import { recordProperties } from "@ep0ch/outline-core/block-record";
import { watchedOn, type Watching } from "./watched";
import type { QuestionGroup } from "@ep0ch/outline-core/protocol";
import { figureRow } from "@ep0ch/outline-core/figure-markdown";
import { headerLine } from "@ep0ch/outline-core/header-line";
import type { Row } from "@ep0ch/outline-core/figure-props";
import { askProps, asksPerItem, figureQuestion, liveAsk, liveProps, liveStatus, type FigureItem } from "@ep0ch/outline-core/figure-live";
import type { SiteLink, SiteProduced, SiteProducer } from "@ep0ch/outline-core/site";
export { NONE } from "@ep0ch/outline-core/figure-live";

type Props = Record<string, any>;
/**
 * One figure's answer: its results, the service's `groups` when the figure groups, and which results the figure's
 * `done:` and `now:` queries hold for (as the service says).
 */
interface Entry { state: "loading" | "ready" | "error"; items: Msg[]; truncated: boolean; total?: number; /** The title read in the figure's Site (PIE-1362). */ title?: string; groups?: QuestionGroup[]; done?: Set<string>; now?: Set<string>; error?: string; hint?: string; counts?: { ids: string[]; truncated: boolean; error?: string }[]; /** Titles of the notes a table's cells name by id (PIE-1388). */ titles?: Record<string, string> }
type Answer = Omit<Entry, "state" | "error">;

let board: SocketBoard | null = null;
let onChange: () => void = () => {};
let unlisten: () => void = () => {};

/**
 * The outline live figures ask, and the repaint to run when an answer arrives. Answers are the board's watched reads
 * (src/watched.ts): the service says when one changed, so nothing is dropped on a change or asked again on paint.
 */
export function setLiveSource(b: SocketBoard | null, redraw: () => void) {
  unlisten();
  board = b; onChange = redraw;
  unlisten = b ? watchedOn(b).listen(changed) : () => {};
}
/** The connection and its repaint now, to put back after borrowing it (drawNote). */
export const liveSource = (): { board: SocketBoard | null; redraw: () => void } => ({ board, redraw: onChange });
/** The outline live figures ask now, if one is connected. */
export const liveBoard = (): SocketBoard | null => board;
/** Also told when an answer arrives (besides the connection's own redraw), until the returned function is called. */
const listeners = new Set<() => void>();
export function listenLive(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { onChange(); for (const fn of listeners) fn(); }

/** What a figure's Site is: the invocations that draw it (a `::use`, an embed) and its call-site args, as `site.answer` takes them. */
export interface LiveSite { board?: SocketBoard; draft?: { text: string }; pending?: boolean; changed?: (loading: boolean) => void; chain?: SiteLink[]; args?: Record<string, string>; /** The props of the call that draws it (a `::use`'s), under `args`. */ props?: Record<string, string[]> }

/** A producer's question asked of its note's Site, watched: the service answers it (`site.answer`), and says when the answer changed. */
export function siteProduced(note: string | undefined, producer: SiteProducer, site?: LiveSite): Watching<SiteProduced> | null {
  if (site?.pending) return { state: "loading" };
  const source = site?.board ?? board;
  const read = source ? produced(source, note, producer, site) : null;
  site?.changed?.(read?.state === "loading");
  return read;
}

function produced(b: SocketBoard, note: string | undefined, producer: SiteProducer, site?: LiveSite): Watching<SiteProduced> {
  const own = site?.args && Object.keys(site.args).length ? Object.fromEntries(Object.entries(site.args).map(([k, v]) => [k, [v]])) : undefined;
  const props = site?.props && Object.keys(site.props).length ? { ...site.props, ...own } : own;
  return watchedOn(b).read("site.answer", { ...(note ? { blockId: note } : {}), produce: producer, ...(site?.draft ? { draft: site.draft } : {}), ...(site?.chain?.length ? { chain: site.chain } : {}), ...(props ? { props } : {}) }, (r: { produced: SiteProduced }) => {
    const answer = r.produced;
    return answer.kind === "figure" || answer.kind === "children" ? { ...answer, blocks: b.toMsgs(answer.blocks as any[]) } as SiteProduced : answer;
  });
}

/**
 * The figure's question, watched: the service reads it in the figure's Site (`site.answer`): a saved view faithfully
 * (`view:`), or a query (`query:`) it parses, sorts (unset: updated, newest first) and groups (`group:`, for the figures
 * that group), `this` and its `{{ }}` operands the note's the figure sits in (or its host, drawn through a template).
 * Null without either.
 */
function ask(kind: string, p: Props, note: string | undefined, site?: LiveSite): Entry | null {
  if (!board) return null;
  const asking = liveAsk(kind, p);
  if (!figureQuestion(asking.ask, asking.group) && !asksPerItem(kind, p)) return null;
  const read = siteProduced(note, { kind: "figure", figure: kind, props: askProps(p) }, site)!;
  if (read.state === "loading") return { state: "loading", items: [], truncated: false };
  if (read.state === "error" && !read.value) return { state: "error", items: [], truncated: false, error: read.error };
  const a = read.value as Extract<SiteProduced, { kind: "figure" }>;
  const items = a.blocks as unknown as Msg[];
  const error = read.state === "error" ? read.error : a.error;
  if (error) return { state: "error", items, truncated: false, error, ...(a.counts ? { counts: a.counts } : {}) };
  return { state: "ready", items, truncated: a.truncated, total: a.total, ...(a.title !== undefined ? { title: a.title } : {}), ...(a.groups ? { groups: a.groups } : {}), ...(a.done ? { done: new Set(a.done) } : {}), ...(a.now ? { now: new Set(a.now) } : {}), ...(a.hint ? { hint: a.hint } : {}), ...(a.counts ? { counts: a.counts } : {}), ...(a.titles ? { titles: a.titles } : {}) };
}

/**
 * Synchronous for the renderer: the newest answer to the figure's question, asked once and told when it changes.
 * `note` is the note the figure sits in: what `this` stands for in its query.
 */
export function answer(p: Props, note?: string, site?: LiveSite): Entry | null {
  return ask("table", p, note, site);
}

/**
 * Once every answer asked for so far has come (and any those answers asked for in turn), or `ms` has passed: an
 * outline that never answers leaves those figures asking, it never hangs the caller.
 */
export async function liveSettled(ms = 10_000, on: SocketBoard | null = board): Promise<void> {
  if (on) await watchedOn(on).settled(ms);
}

/**
 * A note's child bullets as figure rows (a figure block's, or a figure's with `rows: children`): each child's first
 * line without its property tokens, read by outline-core's figure grammar, standing for its note. Comment threads
 * (annotation blocks) aren't rows. `waiting` until the first answer. The children are a watched question
 * (`parent:this`), in the note's order.
 */
export function childRows(note: string, site?: LiveSite): { rows: Row[]; waiting: boolean } | null {
  if (!board) return null;
  const read = siteProduced(note, { kind: "children" }, site)!;
  const items = ((read.value as Extract<SiteProduced, { kind: "children" }> | undefined)?.blocks ?? []) as unknown as Msg[];
  // Each child's header line without its chips and their ` - ` (outline-core's reading, as its title is made); a
  // child with no text isn't a row.
  const rows = items.flatMap(m => { const prose = headerLine(m.text).prose.trim(); return prose ? [{ ...figureRow(prose), block: m.id }] : []; });
  return { rows, waiting: read.state === "loading" };
}

/** A result as outline-core's live figures read it. */
const itemOf = (m: Msg): FigureItem => ({ id: m.id, parentId: m.parentId, title: subject(m), properties: recordProperties(propertyListOf(m)), createdAt: m.createdAt, updatedAt: m.updatedAt, author: m.author });

/** `found`: how many results the question came back with, and whether it was cut (a figure's copied results say so). */
export interface Resolved { props: Props; status: string | null; waiting: boolean; error?: string; found?: { n: number; truncated: boolean } }

/**
 * Turn a live block's props into the static props the drawing code already understands. A row that stands
 * for one result (a check item, an event, a table row) carries its note's id (`block`, `blocks`), so the
 * reader can open it (PIE-441).
 */
export function resolveLive(kind: string, p: Props, note?: string, site?: LiveSite): Resolved | null {
  // stat/kpi: each item can carry its own source; the service counts them in the figure's Site.
  if (asksPerItem(kind, p)) {
    const a = ask(kind, p, note, site);
    if (!a) return null;
    if (a.state === "loading") return { props: { ...p, items: p.items.map((i: Props) => ({ ...i, value: i?.query || i?.view ? "…" : i?.value })) }, status: "live", waiting: true };
    const items = p.items.map((i: Props, k: number) => (a.counts?.[k] && (i?.query || i?.view) ? { ...i, value: a.counts[k]!.error ? "?" : `${a.counts[k]!.ids.length}${a.counts[k]!.truncated ? "+" : ""}` } : i));
    return { props: { ...p, items, ...(a.title !== undefined ? { title: a.title } : {}) }, status: "live", waiting: false, error: a.error };
  }
  const asking = liveAsk(kind, p);
  if (asking.error) return { props: p, status: null, waiting: false, error: asking.error };
  p = asking.props;
  const a = ask(kind, p, note, site);
  if (!a) return null;
  if (a.state === "error") return { props: p, status: null, waiting: false, error: a.error };
  if (a.state === "loading" && !a.items.length) return { props: p, status: null, waiting: true };
  const status = liveStatus(a);
  const drawn = liveProps(kind, p, { ...a, items: a.items.map(itemOf) });
  // A key nobody has written: the service's hint (with the nearest keys that exist) is said under the figure.
  const error = drawn.error ?? a.hint;
  return { props: a.title !== undefined ? { ...drawn.props, title: a.title } : drawn.props, status, waiting: false, found: { n: a.items.length, truncated: a.truncated }, ...(error ? { error } : {}) };
}
