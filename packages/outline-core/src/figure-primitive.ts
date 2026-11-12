// A `::graph-*` figure as catalogue primitives (primitive.ts): what a client that draws primitives draws of it, from
// the props the figure draws from once the outline has answered (figure-props.ts, figure-live.ts). One entry a kind,
// by the kind's own props; a kind with no entry has no primitive form yet, and `figurePrimitive` says so with null (a
// page then hands over the service's Markdown for it, or its lines as written). The door's own drawings (graphs.ts)
// stay the door's. Pure: no I/O.
import { cellsOf, type Props } from "./figure-props";
import type { Primitive, TableCell, Tone } from "./primitive";

const records = (v: unknown): Props[] => (Array.isArray(v) ? v.filter((x): x is Props => !!x && typeof x === "object") : []);
const words = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const number = (v: unknown): number => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const tone = (item: Props): { tone?: Tone } => (item.accent ? { tone: "accent" } : item.muted ? { tone: "dim" } : {});
/** A row's note it is drawn from (`block`), as a table's `links` column: every row's, or none when no row has one. */
const links = (rows: readonly Props[]): { links?: (string | null)[] } => (rows.some(r => typeof r.block === "string") ? { links: rows.map(r => (typeof r.block === "string" ? r.block : null)) } : {});
const table = (columns: string[], rows: readonly Props[], cells: (row: Props) => TableCell[]): Primitive => ({ type: "table", columns, rows: rows.map(cells), ...links(rows) });
const titled = (cells: unknown, headers: unknown, blocks: unknown): Primitive => {
  const rows = Array.isArray(cells) ? cells.map(r => (Array.isArray(r) ? r.map(words) : [words(r)])) : [], ids = Array.isArray(blocks) ? blocks : [];
  return { type: "table", columns: Array.isArray(headers) ? headers.map(words) : [], rows, ...(ids.some(id => typeof id === "string") ? { links: rows.map((_, i) => (typeof ids[i] === "string" ? ids[i] as string : null)) } : {}) };
};
const bars = (items: readonly Props[], max: number): Primitive => ({ type: "stack", children: items.map(i => ({ type: "bar", label: words(i.label), value: number(i.value), max, ...tone(i) })) });

/** Each kind's primitive form, from its answered props. A kind with nothing to draw yet (no rows) answers null. */
export const FIGURE_PRIMITIVES: Record<string, (p: Props) => Primitive | null> = {
  stat: p => { const items = records(p.items); return items.length ? { type: "row", children: items.map(i => ({ type: "stat", label: words(i.label), value: typeof i.value === "number" ? i.value : words(i.value), ...tone(i) })) } : null; },
  // One bar an item against the figure's `limit`; a meter of one value (`value: 0.6`) is one bar, of 1 when it names no limit.
  meter: p => {
    const items = records(p.items), limit = number(p.limit);
    if (items.length) return bars(items, limit > 0 ? limit : Math.max(1, ...items.map(i => number(i.value))));
    return p.value === undefined || p.value === null ? null : { type: "bar", label: words(p.label), value: number(p.value), max: limit > 0 ? limit : 1 };
  },
  rank: p => { const items = records(p.items); return items.length ? bars(items, Math.max(1, ...items.map(i => number(i.value)))) : null; },
  spark: p => { const values = (Array.isArray(p.data) ? p.data : []).map(number); return values.length ? { type: "sparkline", ...(typeof p.label === "string" ? { label: p.label } : {}), values } : null; },
  check: p => { const items = records(p.items); return items.length ? { type: "checklist", items: items.map(i => ({ label: words(i.label) + (i.note ? ` — ${i.note}` : ""), done: i.status ? i.status === "done" : !!i.done })) } : null; },
  timeline: p => { const events = records(p.events); return events.length ? table(["When", "What", ""], events, e => [words(e.date), { text: words(e.label), ...(e.state === "now" ? { tone: "accent" as const } : {}) }, words(e.note ?? (e.state === "now" || e.state === "next" ? e.state : ""))]) : null; },
  decision: p => {
    const options = records(p.options), text = Array.isArray(p.text) ? p.text.map(words) : [];
    if (!options.length && !text.length) return null;
    const stated: Record<string, Tone> = { chosen: "good", rejected: "dim" };
    return { type: "stack", children: [
      ...(options.length ? [table(["", "Option", "Why"], options, o => [{ text: words(o.state), ...(stated[words(o.state)] ? { tone: stated[words(o.state)]! } : {}) }, words(o.label), words(o.reason)])] : []),
      ...text.map(t => ({ type: "text" as const, text: t })),
    ] };
  },
  chat: p => { const messages = records(p.messages); return messages.length ? table(["Who", "Said"], messages, m => [words(m.from), { text: words(m.text), ...(m.aside ? { tone: "dim" as const } : {}) }]) : null; },
  keys: p => { const keys = records(p.keys); return keys.length ? table(["Keys", "Does"], keys, k => [{ text: words(k.keys), ...(k.learn ? { tone: "accent" as const } : {}) }, words(k.action)]) : null; },
  props: p => { const props = records(p.props); return props.length ? table(["Name", "Values", "Default", "Meaning"], props, r => [{ text: words(r.name), ...(r.needed ? { tone: "accent" as const } : {}) }, words(r.values), words(r.default), words(r.meaning)]) : null; },
  example: p => { const examples = records(p.examples); return examples.length ? table(["Act", "Does", ""], examples, e => [words(e.act), words(e.does), e.safe ? "safe" : ""]) : null; },
  compare: p => {
    const entries = records(p.entries), columns = Array.isArray(p.columns) ? p.columns.map(words) : [];
    if (!entries.length) return null;
    const wide = Math.max(columns.length, ...entries.map(e => (Array.isArray(e.cells) ? e.cells.length : 0)));
    return table(["", ...Array.from({ length: wide }, (_, i) => columns[i] ?? "")], entries, e => [{ text: words(e.label), ...tone(e) }, ...Array.from({ length: wide }, (_, i) => words(Array.isArray(e.cells) ? e.cells[i] : ""))]);
  },
  // A cell a row and a column name: the columns in the order the rows first name them.
  matrix: p => {
    const cells = cellsOf(p.cells), columns = [...new Set([...cells.values()].flatMap(row => [...row.keys()]))];
    return cells.size ? { type: "table", columns: ["", ...columns], rows: [...cells].map(([row, held]) => [row, ...columns.map(c => (held.has(c) ? held.get(c)! : ""))]) } : null;
  },
  // A node a line, under its parent by its depth.
  tree: p => {
    const lines: Primitive[] = [];
    const walk = (nodes: readonly Props[], depth: number) => { for (const n of nodes) { lines.push({ type: "text", text: `${"    ".repeat(depth)}${depth ? "└ " : ""}${words(n.label)}${n.meta !== undefined ? ` · ${words(n.meta)}` : ""}`, ...tone(n) }); walk(records(n.children), depth + 1); } };
    walk(records(p.nodes), 0);
    return lines.length ? { type: "stack", children: lines } : null;
  },
  table: p => (Array.isArray(p.rows) && p.rows.length ? titled(p.rows, p.headers, p.blocks) : null),
  tabs: p => { const tabs = records(p.tabs); return tabs.length ? { type: "stack", children: tabs.map(t => ({ type: "box", title: `${words(t.value)} · ${number(t.count)}`, children: Array.isArray(t.rows) && t.rows.length ? [titled(t.rows, t.headers, t.blocks)] : [] })) } : null; },
  annotate: p => (typeof p.code === "string" ? { type: "stack", children: [{ type: "blockdown", text: "```" + words(p.lang) + "\n" + p.code + "\n```" }, ...(Array.isArray(p.notes) ? p.notes.map((n, i) => ({ type: "text" as const, text: `${i + 1}. ${words(n)}` })) : [])] } : null),
};

/** The figure `kind` as primitives from its answered `props`, or null when it has no primitive form (yet, or for these props). */
export function figurePrimitive(kind: string, props: Props): Primitive | null {
  return FIGURE_PRIMITIVES[kind]?.(props) ?? null;
}
