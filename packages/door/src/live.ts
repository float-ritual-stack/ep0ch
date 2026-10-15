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
import { viewReadOf } from "./views";
import { watchedOn, type Watching } from "./watched";
import type { QuestionGroup } from "@ep0ch/outline-core/protocol";
import { figureRow } from "@ep0ch/outline-core/figure-markdown";
import { headerLine } from "@ep0ch/outline-core/header-line";
import type { Row } from "@ep0ch/outline-core/figure-props";
import { asksPerItem, figureQuestion, liveAsk, liveProps, liveStatus, sortProblem, type FigureItem } from "@ep0ch/outline-core/figure-live";
export { NONE } from "@ep0ch/outline-core/figure-live";

type Props = Record<string, any>;
/**
 * One figure's answer: its results, the service's `groups` when the figure groups, and which results the figure's
 * `done:` and `now:` queries hold for (as the service says).
 */
interface Entry { state: "loading" | "ready" | "error"; items: Msg[]; truncated: boolean; groups?: QuestionGroup[]; done?: Set<string>; now?: Set<string>; error?: string; hint?: string }
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

/** A figure's `done:` or `now:` answer while a newer one is asked for (its results changed): shown until it comes. */
const lastSubset = new Map<string, Set<string>>();

/**
 * Which of `items` the figure's `done:` (or `now:`) query holds for: a watched `query.matches` of its own, so it changes
 * when the subset does even if the results don't (`done: linkedfrom:this`). Undefined when the figure has none.
 */
function subset(b: SocketBoard, p: Props, k: "done" | "now", items: readonly Msg[], note: string | undefined): { ids?: Set<string>; error?: string } {
  if (!p[k]) return {};
  const held = `${note ?? ""}|${p.view ?? p.query}|${k}|${p[k]}`;
  const read = watchedOn(b).read("query.matches", { expression: String(p[k]), blockIds: items.map(m => m.id), ...(note ? { this: note } : {}) }, (r: { blockIds: string[] }) => new Set(r.blockIds));
  if (read.state === "ready") lastSubset.set(held, read.value);
  if (read.state === "error") return { error: `${k}: ${read.error}` };
  return { ids: read.value ?? lastSubset.get(held) ?? new Set() };
}

/**
 * The figure's question, watched: a saved view read faithfully (`view:`), or a query (`query:`) the service parses,
 * sorts (unset: updated, newest first) and groups (`group:`, for the figures that group). Null without either. `note`
 * is the note it sits in: `this` in its queries.
 */
function ask(p: Props, note: string | undefined, group?: string): Entry | null {
  if (!board) return null;
  const b = board, watched = watchedOn(b);
  const question = figureQuestion(p, group);
  if (!question) return null;
  if ("error" in question) return { state: "error", items: [], truncated: false, error: question.error };
  let read: Watching<Answer>;
  if (question.kind === "view") {
    read = watched.read("views.read", { viewId: question.viewId, format: "tree" }, (r: any) => {
      const view = viewReadOf({ ...r, blocks: b.toMsgs(r.blocks ?? []) });
      if (view.status !== "ready") throw new Error(`view ${view.status}: ${view.errors.join("; ")}`);
      return { items: view.items, truncated: view.truncated, ...(r.machineryHidden ? { hint: `${r.machineryHidden > 50 ? "50+" : r.machineryHidden} machinery note${r.machineryHidden === 1 ? "" : "s"} hidden · machinery=show` } : {}) };
    });
  } else {
    const { where, limit, sort, direction, machinery } = question;
    // `this` in the query is the note the figure sits in (`links:this`).
    const query = { where, ...(note ? { this: note } : {}), limit, sort: `${sort} ${direction}`, ...(group ? { group } : {}), ...(machinery ? { machinery } : {}) };
    read = watched.read("blocks.query", { query }, (r: { blocks: any[]; completeness?: { kind: string }; groups?: QuestionGroup[]; hint?: string }) =>
      ({ items: b.toMsgs(r.blocks), truncated: r.completeness?.kind === "truncated", ...(r.groups ? { groups: r.groups } : {}), ...(r.hint ? { hint: r.hint } : {}) }));
    if (read.state === "error") read = { ...read, error: sortProblem(read.error, sort, direction) };
  }
  if (read.state === "loading") return { state: "loading", items: [], truncated: false };
  if (read.state === "error" && !read.value) return { state: "error", items: [], truncated: false, error: read.error };
  const answer = read.value!;
  const done = subset(b, p, "done", answer.items, note), now = subset(b, p, "now", answer.items, note);
  const error = read.state === "error" ? read.error : done.error ?? now.error;
  if (error) return { state: "error", items: answer.items, truncated: false, error };
  return { state: "ready", ...answer, ...(done.ids ? { done: done.ids } : {}), ...(now.ids ? { now: now.ids } : {}) };
}

/**
 * Synchronous for the renderer: the newest answer to the figure's question, asked once and told when it changes.
 * `note` is the note the figure sits in: what `this` stands for in its query.
 */
export function answer(p: Props, note?: string): Entry | null {
  return ask(p, note);
}

/**
 * Once every answer asked for so far has come (and any those answers asked for in turn), or `ms` has passed: an
 * outline that never answers leaves those figures asking, it never hangs the caller.
 */
export async function liveSettled(ms = 10_000): Promise<void> {
  if (board) await watchedOn(board).settled(ms);
}

/**
 * A note's child bullets as figure rows (a figure block's, or a figure's with `rows: children`): each child's first
 * line without its property tokens, read by outline-core's figure grammar, standing for its note. Comment threads
 * (annotation blocks) aren't rows. `waiting` until the first answer. The children are a watched question
 * (`parent:this`), in the note's order.
 */
export function childRows(note: string): { rows: Row[]; waiting: boolean } | null {
  if (!board) return null;
  const b = board;
  const read = watchedOn(b).read("blocks.query", { query: { where: "parent:this NOT type=annotation NOT type=annotation-reply", this: note, limit: 1000 } }, (r: { blocks: any[] }) => b.toMsgs(r.blocks));
  const items = read.value ?? [];
  // Each child's header line without its chips and their ` - ` (outline-core's reading, as its title is made); a
  // child with no text isn't a row.
  const rows = items.flatMap(m => { const prose = headerLine(m.text).prose.trim(); return prose ? [{ ...figureRow(prose), block: m.id }] : []; });
  return { rows, waiting: read.state === "loading" };
}

/** A result as outline-core's live figures read it. */
const itemOf = (m: Msg): FigureItem => ({ id: m.id, title: subject(m), props: m.props, createdAt: m.createdAt, updatedAt: m.updatedAt, author: m.author });

export interface Resolved { props: Props; status: string | null; waiting: boolean; error?: string }

/**
 * Turn a live block's props into the static props the drawing code already understands. A row that stands
 * for one result (a check item, an event, a table row) carries its note's id (`block`, `blocks`), so the
 * reader can open it (PIE-441).
 */
export function resolveLive(kind: string, p: Props, note?: string): Resolved | null {
  // stat/kpi: each item can carry its own source.
  if (asksPerItem(kind, p)) {
    let waiting = false, error: string | undefined;
    const items = p.items.map((i: Props) => {
      const a = answer(i, note);
      if (!a) return i;
      if (a.state === "error") error = a.error;
      if (a.state === "loading" && !a.items.length) { waiting = true; return { ...i, value: "…" }; }
      return { ...i, value: `${a.items.length}${a.truncated ? "+" : ""}` };
    });
    return { props: { ...p, items }, status: "live", waiting, error };
  }
  const asking = liveAsk(kind, p);
  if (asking.error) return { props: p, status: null, waiting: false, error: asking.error };
  p = asking.props;
  const a = ask(asking.ask, note, asking.group);
  if (!a) return null;
  if (a.state === "error") return { props: p, status: null, waiting: false, error: a.error };
  if (a.state === "loading" && !a.items.length) return { props: p, status: null, waiting: true };
  const status = liveStatus(a);
  const drawn = liveProps(kind, p, { ...a, items: a.items.map(itemOf) });
  // A key nobody has written: the service's hint (with the nearest keys that exist) is said under the figure.
  const error = drawn.error ?? a.hint;
  return { props: drawn.props, status, waiting: false, ...(error ? { error } : {}) };
}
