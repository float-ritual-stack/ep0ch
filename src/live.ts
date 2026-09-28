// Live figures: a ::graph-* block that asks the outline instead of restating it.
// The note stores the question (a query, or a saved view to read); the door answers it on
// every render from the source data, so status lives in one place and every figure agrees.
//
//   query: "type=outbox-item ticket=PC-762"   ad-hoc filter, same syntax as virtual branches
//   view: ((5c6cda4c-…))                        read an existing saved virtual branch faithfully
//   limit: 20   sort: updated|created   direction: desc|asc
//
// Per kind, what the results become:
//   check     one row per block; done: "<filter>" marks which are ticked; note: <property>
//   stat/kpi  items: [{ label, query|view }] → each value is a live count
//   rank      group: <property> → a bar per value, counted
//   table     columns: [title, <property>, updated, author, …]
//   timeline  one event per block, dated by updated/created or date: <property>; now: "<filter>"
//   meter     value = share of results matching done: "<filter>"
import type { Msg } from "./board";
import type { SocketBoard } from "./socket";
import { subject } from "./board";
import { parseFilterExpression, readView, type PropertyFilter } from "./views";

type Props = Record<string, any>;
interface Entry { state: "loading" | "ready" | "error"; items: Msg[]; truncated: boolean; error?: string; at: number }

let board: SocketBoard | null = null;
let onChange: () => void = () => {};
const cache = new Map<string, Entry>();
let generation = 0;

export function setLiveSource(b: SocketBoard, redraw: () => void) { board = b; onChange = redraw; }

/** The outline changed somewhere: re-ask every question on the next render (answers stay visible meanwhile). */
export function invalidateLive() { generation++; }

const REF = /\(\(([0-9a-f]{8}-[0-9a-f-]{27})[^)]*\)\)|^([0-9a-f]{8}-[0-9a-f-]{27})$/;

function sourceKey(p: Props): string | null {
  if (p.view) return `view:${p.view}`;
  if (p.query) return `query:${p.query}|${p.limit ?? ""}|${p.sort ?? ""}|${p.direction ?? ""}`;
  return null;
}

async function fetchSource(p: Props): Promise<{ items: Msg[]; truncated: boolean }> {
  if (!board) throw new Error("no outline connection");
  if (p.view) {
    const m = String(p.view).trim().match(REF);
    if (!m) throw new Error("view: needs a ((block-ref)) or block id");
    const def = await board.get(m[1] ?? m[2]!);
    if (!def) throw new Error("view not found");
    const r = await readView(board, def);
    if (r.status !== "ready") throw new Error(`view ${r.status}: ${r.errors.join("; ")}`);
    return { items: r.items, truncated: r.truncated };
  }
  const limit = Math.min(1000, Number(p.limit) || 200);
  const filters = parseFilterExpression(String(p.query));
  const r = await board.request<{ blocks: any[]; completeness: { kind: string } }>("blocks.query", {
    query: { filters, limit, sort: { field: p.sort === "created" ? "created" : "updated", direction: p.direction === "asc" ? "asc" : "desc" } },
  });
  return { items: board.toMsgs(r.blocks), truncated: r.completeness?.kind === "truncated" };
}

/** Synchronous for the renderer: the last answer, refreshed in the background when stale. */
export function answer(p: Props): Entry | null {
  const key = sourceKey(p);
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit || hit.at < generation) {
    const entry: Entry = hit ? { ...hit, at: generation } : { state: "loading", items: [], truncated: false, at: generation };
    cache.set(key, entry);
    fetchSource(p).then(r => { cache.set(key, { state: "ready", ...r, at: generation }); onChange(); },
      e => { cache.set(key, { state: "error", items: [], truncated: false, error: String(e.message ?? e), at: generation }); onChange(); });
    return entry;
  }
  return hit;
}

function matches(m: Msg, filters: PropertyFilter[]): boolean {
  return filters.every(f => {
    const v = f.key === "author" ? m.author ?? undefined : m.props[f.key];
    return f.value === undefined ? v !== undefined : (v ?? "").toLowerCase() === f.value.toLowerCase();
  });
}
const filterOf = (s: unknown) => (s ? parseFilterExpression(String(s)) : null);
const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const field = (m: Msg, key: string): string =>
  key === "title" ? subject(m) : key === "updated" ? date(m.updatedAt) : key === "created" ? date(m.createdAt)
    : key === "author" ? m.author ?? "" : m.props[key] ?? "";

export interface Resolved { props: Props; status: string | null; waiting: boolean; error?: string }

/** Turn a live block's props into the static props the drawing code already understands. */
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
  const a = answer(p);
  if (!a) return null;
  if (a.state === "error") return { props: p, status: null, waiting: false, error: a.error };
  if (a.state === "loading" && !a.items.length) return { props: p, status: null, waiting: true };
  const items = a.items;
  const status = `live · ${items.length}${a.truncated ? "+" : ""} result${items.length === 1 ? "" : "s"}`;
  const done = filterOf(p.done), now = filterOf(p.now);
  switch (kind) {
    case "check":
      return { status, waiting: false, props: { ...p, items: items.map(m => ({ label: subject(m), done: done ? matches(m, done) : false, note: p.note ? field(m, p.note) || undefined : undefined })) } };
    case "rank": {
      const key = String(p.group ?? "status");
      const counts = new Map<string, number>();
      for (const m of items) { const v = m.props[key] ?? "—"; counts.set(v, (counts.get(v) ?? 0) + 1); }
      return { status, waiting: false, props: { ...p, items: [...counts].sort((x, y) => y[1] - x[1]).map(([label, value]) => ({ label, value })) } };
    }
    case "table": {
      const cols: string[] = p.columns ?? ["title", "updated"];
      return { status, waiting: false, props: { ...p, headers: p.headers ?? cols, rows: items.map(m => cols.map(c => field(m, c))) } };
    }
    case "timeline":
      return { status, waiting: false, props: { ...p, events: items.map(m => ({ date: p.date ? field(m, p.date) : date(p.sort === "created" ? m.createdAt : m.updatedAt), label: subject(m), state: now && matches(m, now) ? "now" : undefined })) } };
    case "meter":
      return { status, waiting: false, props: { ...p, value: items.length ? items.filter(m => (done ? matches(m, done) : true)).length / items.length : 0, caption: p.caption ?? `${items.filter(m => (done ? matches(m, done) : true)).length} of ${items.length}` } };
    default:
      return { status, waiting: false, props: { ...p }, error: `live data isn't wired for graph-${kind} yet` };
  }
}
