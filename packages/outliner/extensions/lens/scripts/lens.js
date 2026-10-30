// ep0ch-script mode=render
// A lens: one line in any note draws a live table of what a query holds, relative to that note (PIE-1461).
// [form-field::query text]: the views' grammar; {{this.page}} and this read the note the line is in
// [form-field::view note]: a saved view to draw instead of query= (its [query::] and [sort::])
// [form-field::columns property]: the columns, comma-separated: title, created, updated, any property, any computed column
// [form-field::edit property]: columns whose cells press to step the property to its next value
// [form-field::sort property]: the column the rows are sorted by
// [form-field::group property]: a box per value of this column
// [form-field::sum property]: columns summed in a footer, comma-separated
// [form-field::limit number]: the most rows (200)
// (an action declares at most 8 slots; dir=asc|desc, avg=, title=, empty=, link= and <name>="<expression>" work undeclared)
//
//   lens:: query="type=meeting when={{this.page}}" columns=title,when,who,status edit=status sort=when
//   lens:: query="type=line" columns=title,qty,price,cost cost="qty * price" sum=cost,qty
//   lens:: view="[[open-tickets]]" group=priority
//
// The query is the outline's one grammar (it reads `this`); the shape is this script's: columns, computed
// columns, sort, group, footer sums, and cells that press to change a property. Every other slot word is a
// computed column: `cost="qty * price"` is JavaScript over the row's properties (hyphens read as underscores,
// numbers as numbers) and `row` (title, created, updated, props, n(key), list(key)).

const RESERVED = new Set(["query", "view", "under", "columns", "edit", "sort", "dir", "group", "sum", "avg", "count", "limit", "title", "empty", "link", "max"]);
const slots = { ...props };
const one = key => slots[key]?.[0];
const list = key => (one(key) ?? "").split(",").map(s => s.trim()).filter(Boolean);
const fmt = n => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
// A property key as a JavaScript name: hyphens to underscores, a leading digit prefixed, a reserved word suffixed
// (`[default::yes]` on one row must not stop every computed column compiling).
const RESERVED_WORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await arguments eval row".split(" "));
const ident = key => { const name = key.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^(\d)/, "_$1"); return RESERVED_WORDS.has(name) ? `${name}_` : name; };
const bad = (what, detail) => view.text({ text: `${what}: ${detail}`, tone: "bad" });

// --- the rows ------------------------------------------------------------------------------------------------------
let query = one("query");
if (!query && one("view")) {
  let saved;
  try { saved = await read(one("view")); } catch (e) { return bad("lens", `view=${one("view")}: ${e.message}`); }
  const q = saved.properties.find(p => p.key === "query")?.values[0];
  if (!q) return bad("lens", `${saved.title} has no [query::]: name a saved view, or write query=`);
  query = q;
  if (!one("sort")) { const s = saved.properties.find(p => p.key === "sort")?.values[0]; if (s) slots.sort = [s]; }
}
if (!query) return bad("lens", 'needs query="…" (the views\' grammar, {{this.page}} and this allowed) or view="[[a saved view]]"');
// A table holds at most 200 rows, and a footer (sum=, avg=) is one of them.
const cap = list("sum").length || list("avg").length ? 199 : 200;
const limit = Math.max(1, Math.min(cap, Number(one("limit")) || cap));
let found;
try { found = await q(query, { limit, properties: true, ...(one("under") ? { under: one("under") } : {}) }); }
catch (e) { return bad("lens", `query="${query}": ${e.message}`); }
const rows = (found.blocks ?? []).map(b => {
  const props = {};
  for (const p of b.properties ?? []) props[p.key] = p.values;
  return { id: b.id, title: b.title, created: b.created, updated: b.updated, revision: b.revision, props };
});

// --- the columns ----------------------------------------------------------------------------------------------------
const computed = {};
for (const key of Object.keys(slots)) if (!RESERVED.has(key) && !key.startsWith("choices-")) computed[key] = slots[key][0];
const columns = list("columns").length ? list("columns") : ["title", ...Object.keys(computed), "updated"];
const editable = new Set(list("edit"));
const keysSeen = [...new Set(rows.flatMap(r => Object.keys(r.props)))];
const compiled = {};
const errors = [];
for (const [name, expr] of Object.entries(computed)) {
  try { compiled[name] = new Function(...keysSeen.map(ident), "row", `return (${expr});`); }
  catch (e) { errors.push(`${name}="${expr}": ${e.message}`); }
}
const num = v => { const n = Number(v); return v !== "" && v !== undefined && Number.isFinite(n) ? n : v; };
const coerce = r => keysSeen.map(k => { const vs = r.props[k]; return vs === undefined ? undefined : vs.length === 1 ? num(vs[0]) : vs.map(num); });
const rowApi = r => ({ ...r, n: k => Number(r.props[k]?.[0] ?? 0), list: k => r.props[k] ?? [], get: k => r.props[k]?.[0] });
const valueOf = (r, col) => {
  if (col in compiled) {
    // A row missing a property gives NaN (`qty * price` with no qty); a division by zero gives Infinity. Neither is a
    // value: the cell is empty, and the footer and the sort leave it out.
    try { const out = compiled[col](...coerce(r), rowApi(r)); return typeof out === "number" && !Number.isFinite(out) ? "" : out; }
    catch (e) { return { error: e.message }; }
  }
  if (col === "title") return r.title;
  if (col === "created" || col === "updated") return (r[col] ?? "").slice(0, 10);
  if (col === "id") return r.id.slice(0, 8);
  const vs = r.props[col];
  return vs === undefined ? "" : vs.length === 1 ? num(vs[0]) : vs.join(", ");
};
const shown = v => v === undefined || v === null || v === "" ? "" : typeof v === "object" ? "!" : typeof v === "number" ? fmt(v) : String(v);

// --- sort and group --------------------------------------------------------------------------------------------------
const compare = (a, b) => {
  const [x, y] = [a, b].map(v => (typeof v === "object" ? "" : v));
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (x === "" && y !== "") return 1;
  if (y === "" && x !== "") return -1;
  return String(x).localeCompare(String(y), undefined, { numeric: true });
};
const sortKey = one("sort");
if (sortKey) rows.sort((a, b) => compare(valueOf(a, sortKey), valueOf(b, sortKey)) * (one("dir") === "desc" ? -1 : 1));
const groupKey = one("group");
const groups = groupKey ? [...rows.reduce((m, r) => { const k = shown(valueOf(r, groupKey)) || "(none)"; (m.get(k) ?? m.set(k, []).get(k)).push(r); return m; }, new Map())] : [[null, rows]];

// --- the table ---------------------------------------------------------------------------------------------------------
const linkCol = one("link") === "none" ? null : one("link") ?? (columns.includes("title") ? "title" : null);
const choicesFor = key => one(`choices-${key}`);
// A property column shows the value as written (`02134`, `1.50`); the number it reads as is for sorting and sums.
const asWritten = (r, col) => col in compiled || col === "title" || col === "created" || col === "updated" || col === "id" ? null : (r.props[col]?.join(", ") ?? "");
const cellOf = (r, col) => {
  const v = valueOf(r, col);
  const text = asWritten(r, col) ?? shown(v);
  if (typeof v === "object" && v?.error) { const said = `${col}: ${v.error}`; if (!errors.includes(said)) errors.push(said); return { text: "!", tone: "bad" }; }
  if (editable.has(col)) {
    const choices = choicesFor(col);
    const quoted = s => `"${String(s).replace(/(["\\])/g, "\\$1")}"`;
    return { text: text || "·", act: `lens-set note=${r.id} key=${col} next=1${choices ? ` choices=${quoted(choices)}` : ""}`, tone: "accent" };
  }
  if (col === linkCol) return { text: text || "(untitled)", link: r.id };
  return text;
};
const sums = list("sum"), avgs = list("avg");
const footerFor = rs => {
  if (!sums.length && !avgs.length) return null;
  return columns.map((col, i) => {
    const values = rs.map(r => valueOf(r, col)).filter(v => typeof v === "number");
    if (sums.includes(col)) return values.length ? fmt(values.reduce((a, b) => a + b, 0)) : "";
    if (avgs.includes(col)) return values.length ? fmt(values.reduce((a, b) => a + b, 0) / values.length) : "";
    return i === 0 ? "Σ" : "";
  });
};
const tableOf = rs => {
  const body = rs.map(r => columns.map(col => cellOf(r, col)));
  const footer = footerFor(rs);
  return view.table({ columns, rows: footer ? [...body, footer.map(t => ({ text: t, tone: "dim" }))] : body });
};

const parts = [];
const title = one("title");
const count = rows.length;
if (!count) parts.push(view.text({ text: one("empty") ?? `nothing holds for ${query}`, tone: "dim" }));
else if (groupKey) {
  if (title || one("count")) parts.push(view.band({ text: `${title ?? groupKey} · ${count}`, level: 3 }));
  for (const [name, rs] of groups) parts.push(view.box({ title: `${name} · ${rs.length}`, children: [tableOf(rs)] }));
} else {
  if (title || one("count")) parts.push(view.band({ text: `${title ?? query} · ${count}${found.complete === false ? "+" : ""}`, level: 3 }));
  parts.push(tableOf(rows));
}
if (found.complete === false && !one("count") && !title) parts.push(view.text({ text: `first ${count} of more: raise limit= or narrow the query`, tone: "dim" }));
for (const e of errors) parts.push(bad("lens", e));
return view.stack({ children: parts });
