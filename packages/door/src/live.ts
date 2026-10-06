// Live figures: a ::graph-* block that asks the outline instead of restating it.
// The note stores the question (a query, or a saved view to read); the door answers it on
// every render from the source data, so status lives in one place and every figure agrees.
//
//   query: "type=outbox-item ticket=PC-762"   ad-hoc filter, same syntax as virtual branches (OR, NOT,
//                                              parentheses, created/updated ranges), parsed by the service
//                                              (`query.expression`); the door never parses it
//   view: ((5c6cda4c-…))                        read an existing saved virtual branch faithfully
//   limit: 20   sort: updated|created|<property>   direction: desc|asc
//                                              a property sorts numbers as numbers, then text, blocks without it
//                                              last (property:created for one so named); the service refuses a bad
//                                              sort or direction, and the figure says which of its lines it was
//
// Per kind, what the results become:
//   check     one row per block; done: "<filter>" marks which are ticked; note: <property>
//   stat/kpi  items: [{ label, query|view }] → each value is a live count
//   rank      group: <property> → a bar per value, counted
//   table     columns: [title, <property>, updated, author, …]
//   tabs      group: <property> → one tab per value, each a table of its results (columns: as table);
//             order: [values…] first (shown even when empty), then the rest alphabetically, no value last;
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
import { readView } from "./views";
import { figureRow } from "@ep0ch/outline-core/figure-markdown";
import { headerLine } from "@ep0ch/outline-core/header-line";
import type { Row } from "./figures/markdown";
import { decisionState } from "./figures/decision";
import { dayOf, dayState, isoOf, localDay, monthOf, today, uptimeDays } from "./figures/days";

type Props = Record<string, any>;
/** `done` / `now`: the results the figure's `done:` and `now:` queries hold for, as the service says. */
interface Entry { state: "loading" | "ready" | "error"; items: Msg[]; truncated: boolean; done?: Set<string>; now?: Set<string>; error?: string; at: number }

let board: SocketBoard | null = null;
let onChange: () => void = () => {};
const cache = new Map<string, Entry>();
let generation = 0;

export function setLiveSource(b: SocketBoard | null, redraw: () => void) {
  // Answers are kept by question, not by outline: another outline asks them all again.
  if (b !== board) generation++;
  board = b; onChange = redraw;
}
/** The connection and its repaint now, to put back after borrowing it (drawNote). */
export const liveSource = (): { board: SocketBoard | null; redraw: () => void } => ({ board, redraw: onChange });
/** The outline live figures ask now, if one is connected. */
export const liveBoard = (): SocketBoard | null => board;
/** Also told when an answer arrives (besides the connection's own redraw), until the returned function is called. */
const listeners = new Set<() => void>();
export function listenLive(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { onChange(); for (const fn of listeners) fn(); };

/** The outline changed somewhere: re-ask every question on the next render (answers stay visible meanwhile). */
export function invalidateLive() { generation++; }


function sourceKey(p: Props): string | null {
  const also = `|done:${p.done ?? ""}|now:${p.now ?? ""}`;
  if (p.view) return `view:${p.view}${also}`;
  if (p.query) return `query:${p.query}|${p.limit ?? ""}|${p.sort ?? ""}|${p.direction ?? ""}${also}`;
  return null;
}

/** The results, and which of them the figure's `done:` and `now:` queries hold for (asked of the service). */
async function fetchSource(p: Props): Promise<{ items: Msg[]; truncated: boolean; done?: Set<string>; now?: Set<string> }> {
  const r = await fetchItems(p);
  const ids = r.items.map(m => m.id);
  const subset = async (k: "done" | "now") => {
    if (!p[k]) return undefined;
    return board!.matchQuery(String(p[k]), ids).catch((e: Error) => { throw new Error(`${k}: ${e.message}`); });
  };
  const [done, now] = [await subset("done"), await subset("now")];
  return { ...r, ...(done ? { done } : {}), ...(now ? { now } : {}) };
}

async function fetchItems(p: Props): Promise<{ items: Msg[]; truncated: boolean }> {
  if (!board) throw new Error("no outline connection");
  if (p.view) {
    const ref = referencedBlock(String(p.view));
    if (!ref) throw new Error("view: needs a ((block-ref)) or block id");
    const def = await board.get(ref.blockId);
    if (!def) throw new Error("view not found");
    const r = await readView(board, def);
    if (r.status !== "ready") throw new Error(`view ${r.status}: ${r.errors.join("; ")}`);
    return { items: r.items, truncated: r.truncated };
  }
  const limit = Math.min(1000, Number(p.limit) || 200);
  const q = String(p.query);
  // The service checks the sort (unset: updated, newest first) and says what's wrong; the figure names its own lines.
  const sort = { field: String(p.sort ?? "updated"), direction: String(p.direction ?? "desc") };
  // The service parses the query (PIE-398).
  const r = await board.request<{ blocks: any[]; completeness: { kind: string } }>("blocks.query", { query: { expression: q, limit, sort } })
    .catch((e: Error) => { throw /^Sort direction /.test(e.message) ? new Error(`direction: ${sort.direction} · ${e.message}`) : /^Sort /.test(e.message) ? new Error(`sort: ${sort.field} · ${e.message}`) : e; });
  return { items: board.toMsgs(r.blocks), truncated: r.completeness?.kind === "truncated" };
}

/** Synchronous for the renderer: the last answer, refreshed in the background when stale. */
export function answer(p: Props): Entry | null {
  const key = sourceKey(p);
  return key ? cached(key, () => fetchSource(p)) : null;
}

/** The answers being asked for now: `ep0ch export` waits for them before it draws (liveSettled). */
const asking = new Set<Promise<unknown>>();

/** The entry under `key`, asked again (by `fetch`) when the outline changed since. */
function cached(key: string, fetch: () => Promise<Omit<Entry, "state" | "at">>): Entry {
  const hit = cache.get(key);
  if (!hit || hit.at < generation) {
    const entry: Entry = hit ? { ...hit, at: generation } : { state: "loading", items: [], truncated: false, at: generation };
    cache.set(key, entry);
    // Kept as of when it was asked, and only while the same outline is connected: an answer from the outline before
    // a swap (drawNote lending the connection) is never this one's.
    const asked = generation, from = board;
    // …nor kept over a newer answer.
    const keep = () => board === from && (cache.get(key)?.at ?? -1) <= asked;
    const q = fetch().then(r => { if (keep()) { cache.set(key, { state: "ready", ...r, at: asked }); changed(); } },
      e => { if (keep()) { cache.set(key, { state: "error", items: [], truncated: false, error: String(e.message ?? e), at: asked }); changed(); } });
    asking.add(q);
    void q.finally(() => asking.delete(q));
    return entry;
  }
  return hit;
}

/**
 * Once every answer asked for so far has come (and any those answers asked for in turn), or `ms` has passed: an
 * outline that never answers leaves those figures asking, it never hangs the caller.
 */
export async function liveSettled(ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (asking.size && Date.now() < end) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all([...asking]), new Promise(r => { timer = setTimeout(r, Math.max(0, end - Date.now())); })]);
    clearTimeout(timer);
  }
}

/**
 * A note's child bullets as figure rows (a figure block's, or a figure's with `rows: children`): each child's first
 * line without its property tokens, read by outline-core's figure grammar, standing for its note. Comment threads
 * (annotation blocks) aren't rows. `waiting` until the first answer.
 */
export function childRows(note: string): { rows: Row[]; waiting: boolean } | null {
  if (!board) return null;
  const e = cached(`children:${note}`, async () => ({ items: (await board!.children(note)).filter(m => !m.props.type?.startsWith("annotation")), truncated: false }));
  // Each child's header line without its chips and their ` - ` (outline-core's reading, as its title is made); a
  // child with no text isn't a row.
  const rows = e.items.flatMap(m => { const prose = headerLine(m.text).prose.trim(); return prose ? [{ ...figureRow(prose), block: m.id }] : []; });
  return { rows, waiting: e.state === "loading" && !e.items.length };
}

const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const field = (m: Msg, key: string): string =>
  key === "title" ? subject(m) : key === "updated" ? date(m.updatedAt) : key === "created" ? date(m.createdAt)
    : key === "author" ? m.author ?? "" : m.props[key] ?? "";

/** A result with no value for a figure's `group:` property. */
export const NONE = "—";
/** What a tabs figure asks for (the service's most), and its rows per tab unless `limit:` says. */
const TABS_FETCH = 1000, TABS_PER = 50;

/** Results by their value of property `key`, in the order they came (rank and tabs group the same way). */
function groupBy(items: readonly Msg[], key: string): Map<string, Msg[]> {
  const out = new Map<string, Msg[]>();
  for (const m of items) { const v = m.props[key] ?? NONE; const g = out.get(v); if (g) g.push(m); else out.set(v, [m]); }
  return out;
}

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
export function resolveLive(kind: string, p: Props): Resolved | null {
  // stat/kpi: each item can carry its own source.
  if ((kind === "stat" || kind === "kpi") && Array.isArray(p.items) && p.items.some((i: Props) => i?.query || i?.view)) {
    let waiting = false, error: string | undefined;
    const items = p.items.map((i: Props) => {
      const a = answer(i);
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
  const a = answer(kind === "tabs" ? { ...p, limit: TABS_FETCH } : p);
  if (!a) return null;
  if (a.state === "error") return { props: p, status: null, waiting: false, error: a.error };
  if (a.state === "loading" && !a.items.length) return { props: p, status: null, waiting: true };
  const items = a.items;
  const status = `live · ${items.length}${a.truncated ? "+" : ""} result${items.length === 1 ? "" : "s"}`;
  // done: and now: are queries too: the service says which results they hold for.
  const done = a.done, now = a.now;
  const isDone = (m: Msg) => !!done?.has(m.id);
  switch (kind) {
    case "check":
      return { status, waiting: false, props: { ...p, items: items.map(m => ({ label: subject(m), done: isDone(m), note: p.note ? field(m, p.note) || undefined : undefined, block: m.id })) } };
    case "rank": {
      const groups = groupBy(items, String(p.group ?? "status"));
      return { status, waiting: false, props: { ...p, items: [...groups].sort((x, y) => y[1].length - x[1].length).map(([label, ms]) => ({ label, value: ms.length })) } };
    }
    case "table":
      return { status, waiting: false, props: { ...p, ...tableOf(p, items) } };
    case "tabs": {
      // One tab per value of `group:`, the values `order:` lists first (even with nothing in them), then the rest
      // alphabetically (a count changing never moves a tab under the person's pointer), results with no value last.
      const groups = groupBy(items, String(p.group ?? "status"));
      const order: string[] = Array.isArray(p.order) ? p.order.map(String) : [];
      const rest = [...groups.keys()].filter(v => !order.includes(v)).sort((x, y) => (x === NONE ? 1 : y === NONE ? -1 : x.localeCompare(y)));
      const per = Math.max(1, Number(p.limit) || TABS_PER);
      const tabs = [...order, ...rest].map(value => {
        const ms = groups.get(value) ?? [];
        return { value, count: ms.length, more: Math.max(0, ms.length - per), ...tableOf(p, ms.slice(0, per)) };
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
      const cells: Record<string, Record<string, number>> = {};
      for (const m of items) { const r = (cells[m.props[dk] ?? NONE] ??= {}), c = m.props[ak] ?? NONE; r[c] = (r[c] ?? 0) + (vk ? Number(m.props[vk]) || 0 : 1); }
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
