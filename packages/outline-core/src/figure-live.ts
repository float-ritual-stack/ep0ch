// Live figures: a `::graph-*` block that asks the outline instead of restating it. The note stores the question (a
// query, or a saved view to read); the service answers it; this module says what each kind asks and turns the answer
// into the static props its drawing understands, so the door's figures and the publisher's agree. How a client asks
// (the door's watched reads, the publisher's one-off requests) is its own. Pure: no I/O.
//
//   query: "type=outbox-item ticket=PC-762"   ad-hoc filter, same syntax as virtual branches, parsed by the
//                                              service (`where`); `this` in it is the note the figure sits in
//   view: ((5c6cda4c-…))                        read an existing saved virtual branch faithfully
//   limit: 20   sort: updated|created|<property>   direction: desc|asc
//
// Per kind, what the results become:
//   check     one row per block; done: "<filter>" marks which are ticked; note: <property>
//   stat/kpi  items: [{ label, query|view }] → each value is a live count
//   rank      group: <property> → a bar per value, counted by the service (its `groups`, every match)
//   table     columns: [title, <property>, updated, author, …]
//   tabs      group: <property> → one tab per value the service groups, each a table of its results (columns: as
//             table); order: [values…] first (shown even when empty), then the rest in the service's value
//             order, no value last; a tab counts every match; limit: rows per tab (50); the question asks for up to 1000
//   timeline  one event per block, dated by updated/created or date: <property>; now: "<filter>"
//   meter     value = share of results matching done: "<filter>"; with limit: the count of results against it
//   decision  one option per block, its glyph from decision-state (chosen, rejected, open); reason: <property>
//   uptime    a day per date: date: <property> (date), state: <property> (status), the worst that day;
//             last: N (the last N days to today); source: backups is query "type=backup-run"
//   activity  blocks per day: count: created|updated (or a date property); weeks: N
//   calendar  date: <property> (date) marks its day in the month shown (year:, month:, else today's)
//   quadrant  x: <property>, y: <property> → a point per block in that cell (xs:, ys: order the axes)
//   matrix    down: <property>, across: <property> → a count per pair (value: <property> sums it instead)
//   flow      from: <property>, to: <property> → a flow per pair, counted

import { MACHINERY_MODES, type MachineryMode } from "./machinery";
import type { QuestionGroup } from "./protocol";
import { referencedBlock } from "./link-syntax";
import { isChecklistStatus, type ChecklistStatus } from "./checklist-marks";
import { addCell, dayOf, dayState, decisionState, isoOf, localDay, monthOf, today, uptimeDays, type Cells, type Props } from "./figure-props";

/** One result as a live figure reads it: its note, its title and properties, and when it was made and changed. */
export interface FigureItem { id: string; title: string; props: Record<string, string>; createdAt: number; updatedAt: number; author: string | null }

/** What the service answered a figure's question: its results, its groups when it grouped, which `done:`/`now:` hold. */
export interface FigureAnswer {
  items: readonly FigureItem[];
  truncated: boolean;
  groups?: readonly QuestionGroup[];
  done?: ReadonlySet<string>;
  now?: ReadonlySet<string>;
  hint?: string;
}

/** A figure's question, as the service takes it: a saved view read (`views.read`), or a query (`blocks.query`). */
export type FigureQuestion =
  | { kind: "view"; viewId: string }
  | { kind: "query"; where: string; limit: number; sort: string; direction: string; group?: string; machinery?: MachineryMode };

/** A result with no value for a figure's `group:` property. */
export const NONE = "—";
/** What a tabs figure asks for (the service's most), and its rows per tab unless `limit:` says. */
export const TABS_FETCH = 1000, TABS_PER = 50;

/**
 * A figure's question from its props, or null when it asks nothing (`query:` and `view:` both unset), or why it can't
 * ask. `group`: the property the service groups by (rank, tabs).
 */
export function figureQuestion(p: Props, group?: string): FigureQuestion | { error: string } | null {
  if (p.view) {
    const ref = referencedBlock(String(p.view));
    return ref ? { kind: "view", viewId: ref.blockId } : { error: "view: needs a ((block-ref)) or block id" };
  }
  if (!p.query) return null;
  // `machinery: show` or `only` (PIE-867): a figure of what tools wrote for their own bookkeeping, such as backup runs.
  const machinery = (MACHINERY_MODES as readonly unknown[]).includes(p.machinery) ? p.machinery as MachineryMode : undefined;
  return { kind: "query", where: String(p.query), limit: Math.min(1000, Number(p.limit) || 200), sort: String(p.sort ?? "updated"), direction: String(p.direction ?? "desc"), ...(group ? { group } : {}), ...(machinery ? { machinery } : {}) };
}

/** A sort the service refused, said as the figure's own line (`sort:` or `direction:`). */
export function sortProblem(message: string, sort: string, direction: string): string {
  return /^Sort direction /.test(message) ? `direction: ${direction} · ${message}` : /^Sort /.test(message) ? `sort: ${sort} · ${message}` : message;
}

/** A figure that asks per item (`stat`/`kpi` with an item's own `query:` or `view:`). */
export const asksPerItem = (kind: string, p: Props) =>
  (kind === "stat" || kind === "kpi") && Array.isArray(p.items) && p.items.some((i: Props) => i?.query || i?.view);

/**
 * What a figure asks with: `props`, what its answer is drawn with (`source: backups` is its query, figures of days ask
 * for a thousand); `ask`, the props its question is read from (a tabs figure and a budget meter ask for every result:
 * their `limit:` is per tab, or the budget); and the property the service groups by. `error`: a figure that can't be
 * asked as written.
 */
export function liveAsk(kind: string, p: Props): { props: Props; ask: Props; group?: string; error?: string } {
  if (kind === "uptime" && p.source === "backups") p = { query: "type=backup-run", machinery: "show", ...p };
  if ((kind === "uptime" || kind === "activity" || kind === "calendar") && (p.query || p.view)) p = { limit: 1000, ...p };
  const group = kind === "rank" || kind === "tabs" ? String(p.group ?? "status") : undefined;
  if (group && p.view && !p.query) return { props: p, ask: p, error: "group: groups a query's results, and this figure reads a view: write query: with the view's own query" };
  const ask = kind === "tabs" || (kind === "meter" && p.limit !== undefined) ? { ...p, limit: TABS_FETCH } : p;
  return { props: p, ask, ...(group ? { group } : {}) };
}

/** The status line of a live figure's answer: `live · 12 results`. */
export const liveStatus = (a: { items: readonly unknown[]; truncated: boolean }) =>
  `live · ${a.items.length}${a.truncated ? "+" : ""} result${a.items.length === 1 ? "" : "s"}`;

const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** A column of a live table, or a row's field (`title`, `updated`, `created`, `author`, or any property). */
export function itemField(m: FigureItem, key: string): string {
  return key === "title" ? m.title : key === "updated" ? date(m.updatedAt) : key === "created" ? date(m.createdAt)
    : key === "author" ? m.author ?? "" : m.props[key] ?? "";
}

/**
 * A table's props from results (a `::graph-table`, or one tab of a `::graph-tabs`): `columns:` (title and updated
 * when left out) as headers unless `headers:` names them, a row per result and its note's id, and which column is
 * the title (the one density wraps).
 */
export function tableOf(p: Props, items: readonly FigureItem[]) {
  const cols: string[] = p.columns ?? ["title", "updated"];
  return { headers: p.headers ?? cols, rows: items.map(m => cols.map(c => itemField(m, c))), blocks: items.map(m => m.id), titleColumn: Math.max(0, cols.indexOf("title")) };
}

/**
 * What a mark on a live `::graph-check` row writes (PIE-864): the property its `done:` names, when `done:` is one
 * `key=value` (`stage=done`). `x` writes that value to the row's note; any other mark writes its status word
 * (`stage::waiting`, `stage::todo`). Null when `done:` is anything else: the row is marked in its own note.
 */
export function liveMark(p: Props): { key: string; done: string } | null {
  const m = /^\s*([\p{L}\p{N}_][\p{L}\p{N}_.\/-]*)\s*=\s*("?)([^"\s]+)\2\s*$/u.exec(typeof p.done === "string" ? p.done : "");
  return m ? { key: m[1]!, done: m[3]! } : null;
}

/** The value a mark writes to a live row's `done:` property (liveMark). */
export const liveMarkValue = (mark: { done: string }, status: ChecklistStatus) => (status === "done" ? mark.done : status);

/**
 * A live row's status: with a `done:` of one `key=value` (liveMark), by the row's own value (that value done, a status
 * word that status, else to do), so it reads right before the `done:` answer comes; else done where `done:` holds.
 */
export function liveRowStatus(done: boolean, mark: { done: string } | null, value: string | undefined): ChecklistStatus {
  if (!mark) return done ? "done" : "todo";
  const v = (value ?? "").trim().toLowerCase();
  if (v === mark.done.toLowerCase()) return "done";
  return isChecklistStatus(v) ? v : "todo";
}

/** A live figure's static props from its answer, or why the kind can't be drawn from one. */
export function liveProps(kind: string, p: Props, a: FigureAnswer): { props: Props; error?: string } {
  const items = a.items, done = a.done, now = a.now;
  const isDone = (m: FigureItem) => !!done?.has(m.id);
  switch (kind) {
    case "check": {
      // A row's box: done where `done:` holds, else the status its `done:` property names (PIE-864, liveMark).
      const mark = liveMark(p);
      return { props: { ...p, items: items.map(m => ({ label: m.title, done: isDone(m), status: liveRowStatus(isDone(m), mark, mark ? m.props[mark.key] : undefined), note: p.note ? itemField(m, p.note) || undefined : undefined, block: m.id, ...(mark ? { mark } : {}) })) } };
    }
    case "rank":
      // The service's groups, most first; a match without the property is the NONE group.
      return { props: { ...p, items: [...(a.groups ?? [])].sort((x, y) => y.count - x.count).map(g => ({ label: g.value ?? NONE, value: g.count })) } };
    case "table":
      return { props: { ...p, ...tableOf(p, items) } };
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
      return { props: { ...p, tabs, truncated: a.truncated } };
    }
    case "timeline":
      return { props: { ...p, events: items.map(m => ({ date: p.date ? itemField(m, p.date) : date(p.sort === "created" ? m.createdAt : m.updatedAt), label: m.title, state: now?.has(m.id) ? "now" : undefined, block: m.id })) } };
    case "meter": {
      const held = items.filter(m => (done ? isDone(m) : true)).length;
      if (p.limit !== undefined) return { props: { ...p, items: [{ label: p.label ?? "", value: held }] } };
      return { props: { ...p, value: items.length ? held / items.length : 0, caption: p.caption ?? `${held} of ${items.length}` } };
    }
    case "quadrant": {
      const xk = String(p.x ?? ""), yk = String(p.y ?? "");
      if (!xk || !yk) return { props: p, error: "quadrant: x: and y: name the two properties" };
      return { props: { ...p, points: items.map(m => ({ x: m.props[xk] ?? NONE, y: m.props[yk] ?? NONE, label: p.label ? itemField(m, String(p.label)) : m.title, block: m.id })) } };
    }
    case "matrix": {
      const dk = String(p.down ?? ""), ak = String(p.across ?? ""), vk = p.value ? String(p.value) : null;
      if (!dk || !ak) return { props: p, error: "matrix: down: and across: name the two properties" };
      const cells: Cells = new Map();
      for (const m of items) addCell(cells, m.props[dk] ?? NONE, m.props[ak] ?? NONE, vk ? Number(m.props[vk]) || 0 : 1);
      return { props: { ...p, cells } };
    }
    case "flow": {
      const fk = String(p.from ?? ""), tk = String(p.to ?? "");
      if (!fk || !tk) return { props: p, error: "flow: from: and to: name the two properties" };
      const pairs = new Map<string, { from: string; to: string; value: number }>();
      for (const m of items) { const from = m.props[fk] ?? NONE, to = m.props[tk] ?? NONE, k = `${from}\0${to}`; const f = pairs.get(k); if (f) f.value++; else pairs.set(k, { from, to, value: 1 }); }
      return { props: { ...p, flows: [...pairs.values()] } };
    }
    case "decision":
      return { props: { ...p, options: items.map(m => ({ label: m.title, state: decisionState(m.props["decision-state"]), reason: m.props[String(p.reason ?? "reason")] || undefined, block: m.id })) } };
    case "uptime": {
      const dateKey = String(p.date ?? "date"), stateKey = String(p.state ?? "status");
      const results = items.flatMap(m => { const day = dayOf(m.props[dateKey]); return day === null ? [] : [{ day, state: dayState(m.props[stateKey]), block: m.id }]; });
      // `last: 30`: the thirty days to today (or to `to:`).
      const last = Number(p.last) || 0, to = dayOf(p.to) ?? (last ? today() : null), from = dayOf(p.from) ?? (last && to !== null ? to - last + 1 : null);
      return { props: { ...p, ...uptimeDays(results, from, to) } };
    }
    case "activity": {
      const how = String(p.count ?? "created"), counts: Record<string, number> = {};
      for (const m of items) {
        const day = how === "created" ? localDay(m.createdAt) : how === "updated" ? localDay(m.updatedAt) : dayOf(m.props[how]);
        if (day !== null) counts[isoOf(day)] = (counts[isoOf(day)] ?? 0) + 1;
      }
      return { props: { ...p, counts, to: p.to ?? isoOf(today()), weeks: p.weeks ?? 26 } };
    }
    case "calendar": {
      const { first, last, year, month } = monthOf(p), dateKey = String(p.date ?? "date");
      const marks = items.flatMap(m => { const d = dayOf(m.props[dateKey]); return d !== null && d >= first && d <= last ? [{ day: d - first + 1, date: isoOf(d), label: m.title, block: m.id }] : []; });
      return { props: { ...p, year, month, marks } };
    }
    default:
      return { props: { ...p }, error: `live data isn't wired for graph-${kind} yet` };
  }
}
