// A query-fed component: the service answers and watches the saved view's Question. This process only presents that
// answer through the existing primitives. It never scans the outline or implements query membership.
interface Property { key: string; value: string }
interface Record_ { key: string; values: string[] }
interface Row { id: string; title: string; text: string; displayText: string; revision: number; properties: Property[]; updatedAt: string }
interface QueryAnswer {
  blocks: Row[];
  completeness: { kind: string; matched?: number };
  groups?: { value: string | null; count: number; ids: string[] }[];
  facets?: { key: string; count: number; values: { value: string; count: number }[]; more?: number }[];
  hint?: string;
}
interface Request {
  operation: string;
  input: { query?: QueryAnswer; context: { block: { text: string; properties: Record_[] } } };
}

const request = (await Bun.stdin.json()) as Request;
if (request.operation !== "run" || !request.input.query) {
  process.stdout.write(JSON.stringify({ ok: false, code: "not-found" }));
  process.exit(0);
}
const answer = request.input.query;
const own = request.input.context.block;
const prop = (key: string): string | undefined => own.properties.find(p => p.key === key)?.values[0];
const value = (row: Row, key: string): string => row.properties.filter(p => p.key === key).map(p => p.value).join(", ");
const title = (row: Row): string => row.title || "untitled";
const requestedColumns = (prop("columns") ?? "").split(",").map(s => s.trim()).filter(Boolean);
const columns = (requestedColumns.length ? requestedColumns : (answer.facets ?? []).map(f => f.key).filter(k => !["query", "type", "workbench"].includes(k)).slice(0, 3)).slice(0, 5);
const count = answer.completeness.kind === "truncated" ? (answer.completeness.matched ?? answer.blocks.length) : answer.blocks.length;
const groupKey = prop("group") ?? "type";
const groupOf = new Map(answer.groups?.flatMap(g => g.ids.map(id => [id, g.value ?? "Unspecified"] as const)) ?? []);
const groups = (answer.groups ?? []).map(g => ({ name: g.value ?? "Unspecified", label: g.value ?? "Unspecified", count: g.count }));
const listRows = answer.blocks.slice(0, 80).map(row => ({
  id: row.id,
  label: title(row),
  detail: columns.map(key => value(row, key) ? `${key}: ${value(row, key)}` : "").filter(Boolean).join(" · ").slice(0, 200),
  ...(answer.groups ? { group: groupOf.get(row.id) ?? "Unspecified" } : {}),
  preview: { block: row.id },
  do: { open: row.id },
}));
const tableRows = answer.blocks.slice(0, 40);
const cards = answer.blocks.slice(0, 9).map(row => ({
  type: "card", title: title(row), link: row.id,
  subtitle: columns.map(key => value(row, key) ? `${key}: ${value(row, key)}` : "").filter(Boolean).join(" · ").slice(0, 180),
  children: [{ type: "text", text: (row.displayText || row.text).split("\n").slice(1).join(" ").trim().slice(0, 160) || "open note", tone: "dim" }],
}));
const cardRows = Array.from({ length: Math.ceil(cards.length / 3) }, (_, i) => ({ type: "row", minWidth: 22, children: cards.slice(i * 3, i * 3 + 3) }));
const facetWords = (answer.facets ?? []).slice(0, 6).map(f => `${f.key}: ${f.values.slice(0, 4).map(v => `${v.value} ${v.count}`).join(" · ")}${f.more ? ` · +${f.more}` : ""}`);
const view = {
  type: "stack",
  children: [
    { type: "row", children: [
      { type: "stat", label: "matches", value: count },
      { type: "stat", label: "shown", value: answer.blocks.length },
      { type: "badge", label: answer.completeness.kind, tone: answer.completeness.kind === "complete" ? "good" : "warn" },
    ] },
    { type: "text", text: `query: ${prop("query") ?? ""} · group: ${groupKey} · sort: ${prop("sort") ?? "updated"} ${prop("direction") ?? "desc"}`, tone: "dim" },
    ...(answer.hint ? [{ type: "text", text: answer.hint, tone: "warn" }] : []),
    ...facetWords.map(text => ({ type: "text", text, tone: "dim" })),
    { type: "box", title: `Table · ${tableRows.length}${count > tableRows.length ? ` of ${count}` : ""}`, children: [{
      type: "table", columns: ["Note", ...columns], rows: tableRows.map(row => [title(row), ...columns.map(key => value(row, key))]), links: tableRows.map(row => row.id),
    }] },
    { type: "box", title: `Cards · ${cards.length}${count > cards.length ? ` of ${count}` : ""}`, children: cardRows.length ? cardRows : [{ type: "text", text: "No matches yet", tone: "dim" }] },
    { type: "box", title: `List · ${listRows.length}${count > listRows.length ? ` of ${count}` : ""}`, children: [{
      type: "list", rows: listRows, ...(groups.length ? { groups } : {}), preview: "right", filter: true, enter: true, empty: "No matching notes",
    }] },
  ],
};
process.stdout.write(JSON.stringify({ ok: true, value: {
  title: `${count} matches · ${answer.completeness.kind}`,
  data: { question: { where: prop("query"), group: groupKey, sort: prop("sort") ?? "updated", direction: prop("direction") ?? "desc" }, ...answer, columns },
  view,
} }));
