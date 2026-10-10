// Live figures: a ::graph-* block that asks the outline instead of restating it.
// The note stores the question (a query, or a saved view to read); the service answers it, and says when the
// answer changed (a watched read, src/watched.ts), so status lives in one place and every figure agrees.
//
//   query: "type=outbox-item ticket=PC-762"   ad-hoc filter, same syntax as virtual branches (OR, NOT,
//                                              parentheses, created/updated ranges, the atoms), parsed by the
//                                              service (`where`); the door never parses it. `this` in it is the
//                                              note the figure sits in: `links:this NOT linkedfrom:this`
//   view: ((5c6cda4c-…))                        read an existing saved virtual branch faithfully
//   limit: 20   sort: updated|created|<property>   direction: desc|asc
//                                              a property sorts numbers as numbers, then text, blocks without it
//                                              last (property:created for one so named); the service refuses a bad
//                                              sort or direction, and the figure says which of its lines it was
//
// Per kind, what the results become:
//   check     one row per block; done: "<filter>" marks which are ticked; note: <property>
//   stat/kpi  items: [{ label, query|view }] → each value is a live count
//   rank      group: <property> → a bar per value, counted by the service (its `groups`, every match)
//   table     columns: [title, <property>, updated, author, …]
//   tabs      group: <property> → one tab per value the service groups, each a table of its results (columns: as
//             table); order: [values…] first (shown even when empty), then the rest in the service's value
//             order (numbers, then text; work-stage in the workboard's order), no value last; a tab counts every match;
//             limit: rows per tab (50); the question itself asks for up to 1000 results
//   timeline  one event per block, dated by updated/created or date: <property>; now: "<filter>"
//   meter     value = share of results matching done: "<filter>"
//   decision  one option per block, its glyph from decision-state (chosen, rejected, open); reason: <property>
//   uptime    a day per date: date: <property> (date), state: <property> (status), the worst that day;
//             last: N (the last N days to today); source: backups is query "type=backup-run"
//   activity  blocks per day: count: created|updated (or a date property); weeks: N
//   calendar  date: <property> (date) marks its day in the month shown (year:, month:, else today's)
//   quadrant  x: <property>, y: <property> → a point per block in that cell (xs:, ys: order the axes)
//   matrix    down: <property>, across: <property> → a count per pair (value: <property> sums it instead)
//   flow      from: <property>, to: <property> → a flow per pair, counted
//   meter     with limit: the count of results against it (one bar), instead of a share
//
// A figure block's child bullets (src/graphs.ts FigureSource) are asked for here too (childRows), the same way.
import { referencedBlock } from "@ep0ch/outline-core/link-syntax";
import type { Msg } from "./board";
import type { SocketBoard } from "./socket";
import { subject } from "./board";
import { viewReadOf } from "./views";
import { watchedOn, type Watching } from "./watched";
import type { QuestionGroup } from "@ep0ch/outline-core/protocol";
import { figureRow } from "@ep0ch/outline-core/figure-markdown";
import { headerLine } from "@ep0ch/outline-core/header-line";
import type { Row } from "./figures/markdown";
import { decisionState } from "./figures/decision";
import { dayOf, dayState, isoOf, localDay, monthOf, today, uptimeDays } from "./figures/days";
import { addCell, type Cells } from "./figures/matrix";

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

/** A sort the service refused, said as the figure's own line (`sort:` or `direction:`). */
const sortProblem = (sort: string, direction: string) => (e: Error) =>
  /^Sort direction /.test(e.message) ? new Error(`direction: ${direction} · ${e.message}`) : /^Sort /.test(e.message) ? new Error(`sort: ${sort} · ${e.message}`) : e;

/**
 * The figure's question, watched: a saved view read faithfully (`view:`), or a query (`query:`) the service parses,
 * sorts (unset: updated, newest first) and groups (`group:`, for the figures that group). Null without either. `note`
 * is the note it sits in: `this` in its queries.
 */
function ask(p: Props, note: string | undefined, group?: string): Entry | null {
  if (!board) return null;
  const b = board, watched = watchedOn(b);
  let read: Watching<Answer>;
  if (p.view) {
    const ref = referencedBlock(String(p.view));
    if (!ref) return { state: "error", items: [], truncated: false, error: "view: needs a ((block-ref)) or block id" };
    read = watched.read("views.read", { viewId: ref.blockId, format: "tree" }, (r: any) => {
      const view = viewReadOf({ ...r, blocks: b.toMsgs(r.blocks ?? []) });
      if (view.status !== "ready") throw new Error(`view ${view.status}: ${view.errors.join("; ")}`);
      return { items: view.items, truncated: view.truncated };
    });
  } else if (p.query) {
    const sort = String(p.sort ?? "updated"), direction = String(p.direction ?? "desc");
    // `this` in the query is the note the figure sits in (`links:this`).
    const query = { where: String(p.query), ...(note ? { this: note } : {}), limit: Math.min(1000, Number(p.limit) || 200), sort: `${sort} ${direction}`, ...(group ? { group } : {}) };
    read = watched.read("blocks.query", { query }, (r: { blocks: any[]; completeness?: { kind: string }; groups?: QuestionGroup[]; hint?: string }) =>
      ({ items: b.toMsgs(r.blocks), truncated: r.completeness?.kind === "truncated", ...(r.groups ? { groups: r.groups } : {}), ...(r.hint ? { hint: r.hint } : {}) }));
    if (read.state === "error") read = { ...read, error: sortProblem(sort, direction)(new Error(read.error)).message };
  } else return null;
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

const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const field = (m: Msg, key: string): string =>
  key === "title" ? subject(m) : key === "updated" ? date(m.updatedAt) : key === "created" ? date(m.createdAt)
    : key === "author" ? m.author ?? "" : m.props[key] ?? "";

/** A result with no value for a figure's `group:` property. */
export const NONE = "—";
/** What a tabs figure asks for (the service's most), and its rows per tab unless `limit:` says. */
const TABS_FETCH = 1000, TABS_PER = 50;

/**
 * A table's props from results (a `::graph-table`, or one tab of a `::graph-tabs`): `columns:` (title and updated
 * when left out) as headers unless `headers:` names them, a row per result and its note's id, and which column is
 * the title (the one density wraps).
 */
function tableOf(p: Props, items: readonly Msg[]) {
  const cols: string[] = p.columns ?? ["title", "updated"];
  return { headers: p.headers ?? cols, rows: items.map(m => cols.map(c => field(m, c))), blocks: items.map(m => m.id), titleColumn: Math.max(0, cols.indexOf("title")) };
}

export interface Resolved { props: Props; status: string | null; waiting: boolean; error?: string }

/**
 * Turn a live block's props into the static props the drawing code already understands. A row that stands
 * for one result (a check item, an event, a table row) carries its note's id (`block`, `blocks`), so the
 * reader can open it (PIE-441).
 */
export function resolveLive(kind: string, p: Props, note?: string): Resolved | null {
  // stat/kpi: each item can carry its own source.
  if ((kind === "stat" || kind === "kpi") && Array.isArray(p.items) && p.items.some((i: Props) => i?.query || i?.view)) {
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
  // `source: backups`: the backup-run notes a timer writes (scripts/backup-runs.ts), dated and with a status.
  if (kind === "uptime" && p.source === "backups") p = { query: "type=backup-run", ...p };
  // Figures of days count every result, not the first 200.
  if ((kind === "uptime" || kind === "activity" || kind === "calendar") && (p.query || p.view)) p = { limit: 1000, ...p };
  // A tabs figure groups every result, so it asks for all of them; its `limit:` is per tab.
  // A tabs figure groups every result, and a meter with a budget counts them all: `limit:` is theirs, not the query's.
  // A rank and a tabs figure are grouped by the service (`group:`, every match counted): the figure draws its groups.
  const grouped = kind === "rank" || kind === "tabs" ? String(p.group ?? "status") : undefined;
  if (grouped && p.view && !p.query) return { props: p, status: null, waiting: false, error: "group: groups a query's results, and this figure reads a view: write query: with the view's own query" };
  const a = ask(kind === "tabs" || (kind === "meter" && p.limit !== undefined) ? { ...p, limit: TABS_FETCH } : p, note, grouped);
  if (!a) return null;
  if (a.state === "error") return { props: p, status: null, waiting: false, error: a.error };
  if (a.state === "loading" && !a.items.length) return { props: p, status: null, waiting: true };
  const items = a.items;
  const status = `live · ${items.length}${a.truncated ? "+" : ""} result${items.length === 1 ? "" : "s"}`;
  // A key nobody has written: the service's hint (with the nearest keys that exist) is said under the figure.
  if (a.hint) { const r = resolveKind(kind, p, a, items, status); return r && { ...r, error: r.error ?? a.hint }; }
  return resolveKind(kind, p, a, items, status);
}

/** A live figure's static props from its answer (`resolveLive`'s per-kind half). */
function resolveKind(kind: string, p: Props, a: Entry, items: Msg[], status: string): Resolved | null {
  // done: and now: are queries too: the service says which results they hold for.
  const done = a.done, now = a.now;
  const isDone = (m: Msg) => !!done?.has(m.id);
  switch (kind) {
    case "check":
      return { status, waiting: false, props: { ...p, items: items.map(m => ({ label: subject(m), done: isDone(m), note: p.note ? field(m, p.note) || undefined : undefined, block: m.id })) } };
    case "rank":
      // The service's groups, most first; a match without the property is the NONE group.
      return { status, waiting: false, props: { ...p, items: [...(a.groups ?? [])].sort((x, y) => y.count - x.count).map(g => ({ label: g.value ?? NONE, value: g.count })) } };
    case "table":
      return { status, waiting: false, props: { ...p, ...tableOf(p, items) } };
    case "tabs": {
      // One tab per group the service answered for `group:`: the values `order:` lists first (even with nothing in
      // them), then the rest in the service's order (the property's value order, so a count changing never moves a
      // tab under the person's pointer), results with no value last. A tab's count is every match's.
      const byId = new Map(items.map(m => [m.id, m]));
      const groups = new Map((a.groups ?? []).map(g => [g.value ?? NONE, g]));
      const order: string[] = Array.isArray(p.order) ? p.order.map(String) : [];
      const rest = [...groups.keys()].filter(v => !order.includes(v));
      const per = Math.max(1, Number(p.limit) || TABS_PER);
      const tabs = [...order, ...rest].map(value => {
        const g = groups.get(value);
        const ms = (g?.ids ?? []).flatMap(id => byId.get(id) ?? []).slice(0, per);
        return { value, count: g?.count ?? 0, more: Math.max(0, (g?.count ?? 0) - ms.length), ...tableOf(p, ms) };
      });
      return { status, waiting: false, props: { ...p, tabs, truncated: a.truncated } };
    }
    case "timeline":
      return { status, waiting: false, props: { ...p, events: items.map(m => ({ date: p.date ? field(m, p.date) : date(p.sort === "created" ? m.createdAt : m.updatedAt), label: subject(m), state: now?.has(m.id) ? "now" : undefined, block: m.id })) } };
    case "meter":
      if (p.limit !== undefined) return { status, waiting: false, props: { ...p, items: [{ label: p.label ?? "", value: items.filter(m => (done ? isDone(m) : true)).length }] } };
      return { status, waiting: false, props: { ...p, value: items.length ? items.filter(m => (done ? isDone(m) : true)).length / items.length : 0, caption: p.caption ?? `${items.filter(m => (done ? isDone(m) : true)).length} of ${items.length}` } };
    case "quadrant": {
      const xk = String(p.x ?? ""), yk = String(p.y ?? "");
      if (!xk || !yk) return { status, waiting: false, props: p, error: "quadrant: x: and y: name the two properties" };
      return { status, waiting: false, props: { ...p, points: items.map(m => ({ x: m.props[xk] ?? NONE, y: m.props[yk] ?? NONE, label: p.label ? field(m, String(p.label)) : subject(m), block: m.id })) } };
    }
    case "matrix": {
      const dk = String(p.down ?? ""), ak = String(p.across ?? ""), vk = p.value ? String(p.value) : null;
      if (!dk || !ak) return { status, waiting: false, props: p, error: "matrix: down: and across: name the two properties" };
      const cells: Cells = new Map();
      for (const m of items) addCell(cells, m.props[dk] ?? NONE, m.props[ak] ?? NONE, vk ? Number(m.props[vk]) || 0 : 1);
      return { status, waiting: false, props: { ...p, cells } };
    }
    case "flow": {
      const fk = String(p.from ?? ""), tk = String(p.to ?? "");
      if (!fk || !tk) return { status, waiting: false, props: p, error: "flow: from: and to: name the two properties" };
      const pairs = new Map<string, { from: string; to: string; value: number }>();
      for (const m of items) { const from = m.props[fk] ?? NONE, to = m.props[tk] ?? NONE, k = `${from}\0${to}`; const f = pairs.get(k); if (f) f.value++; else pairs.set(k, { from, to, value: 1 }); }
      return { status, waiting: false, props: { ...p, flows: [...pairs.values()] } };
    }
    case "decision":
      return { status, waiting: false, props: { ...p, options: items.map(m => ({ label: subject(m), state: decisionState(m.props["decision-state"]), reason: m.props[String(p.reason ?? "reason")] || undefined, block: m.id })) } };
    case "uptime": {
      const dateKey = String(p.date ?? "date"), stateKey = String(p.state ?? "status");
      const results = items.flatMap(m => { const day = dayOf(m.props[dateKey]); return day === null ? [] : [{ day, state: dayState(m.props[stateKey]), block: m.id }]; });
      // `last: 30`: the thirty days to today (or to `to:`).
      const last = Number(p.last) || 0, to = dayOf(p.to) ?? (last ? today() : null), from = dayOf(p.from) ?? (last && to !== null ? to - last + 1 : null);
      return { status, waiting: false, props: { ...p, ...uptimeDays(results, from, to) } };
    }
    case "activity": {
      const how = String(p.count ?? "created"), counts: Record<string, number> = {};
      for (const m of items) {
        const day = how === "created" ? localDay(m.createdAt) : how === "updated" ? localDay(m.updatedAt) : dayOf(m.props[how]);
        if (day !== null) counts[isoOf(day)] = (counts[isoOf(day)] ?? 0) + 1;
      }
      return { status, waiting: false, props: { ...p, counts, to: p.to ?? isoOf(today()), weeks: p.weeks ?? 26 } };
    }
    case "calendar": {
      const { first, last, year, month } = monthOf(p), dateKey = String(p.date ?? "date");
      const marks = items.flatMap(m => { const d = dayOf(m.props[dateKey]); return d !== null && d >= first && d <= last ? [{ day: d - first + 1, date: isoOf(d), label: subject(m), block: m.id }] : []; });
      return { status, waiting: false, props: { ...p, year, month, marks } };
    }
    default:
      return { status, waiting: false, props: { ...p }, error: `live data isn't wired for graph-${kind} yet` };
  }
}
