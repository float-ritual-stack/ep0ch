// The pure part of Structure: lists inside a block's text, sorting, and what an extract writes. No I/O.

export interface SortSpec { by: string; order: "asc" | "desc" }
export interface Item { lines: string[]; marker: string }
export interface Run { start: number; end: number; items: Item[]; indent: string }

const MARK = /^(\s*)([-*+]|\d+[.)])\s+/;
const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
const blank = (line: string) => line.trim() === "";

/** The sort asked for: arguments first, then the block's own `[sort-by::]` / `[sort-order::]`, else by title, ascending. */
export function sortSpec(args: Record<string, string> | undefined, properties: { key: string; value: string }[] | undefined): SortSpec {
  const own = (key: string) => properties?.find((p) => p.key === key)?.value.trim();
  const by = (args?.by ?? own("sort-by") ?? "title").trim() || "title";
  const order = (args?.order ?? own("sort-order") ?? "asc").trim().toLowerCase();
  if (order !== "asc" && order !== "desc") throw new Error(`order is asc or desc, not "${order}" (with={"by":"${by}","order":"desc"})`);
  return { by, order };
}

/** An item's title: its first line without its list mark, properties and anchor. */
export function titleOf(firstLine: string): string {
  return firstLine.replace(MARK, "").replace(/\[[A-Za-z][\w.-]*::[^\]]*\]/g, "").replace(/\s\^[A-Za-z0-9][\w-]*\s*$/, "").trim();
}

/** The value of property `key` in lines of text: `[key::value]` anywhere, or a `key:: value` line. */
export function propertyIn(lines: string[], key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const line of lines) {
    const inline = new RegExp(`\\[${escaped}::\\s*([^\\]]*?)\\s*\\]`).exec(line);
    if (inline) return inline[1];
    const own = new RegExp(`^\\s*(?:[-*+]\\s+)?${escaped}::\\s*(.+?)\\s*$`).exec(line);
    if (own) return own[1];
  }
  return undefined;
}

const numberOf = (v: string): number | null => {
  const n = Number(v.replace(/[,$%\s]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Compare two keys: numbers as numbers, words without regard to case; a missing one is always last. */
export function compareKeys(a: string | undefined, b: string | undefined, order: "asc" | "desc"): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const na = numberOf(a), nb = numberOf(b);
  const c = na !== null && nb !== null ? na - nb : a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return order === "desc" ? -c : c;
}

/** Every top-level list run in `lines` (a run ends at a blank line or a line that isn't an item or under one). */
export function listRuns(lines: string[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!MARK.test(lines[i]!)) { i++; continue; }
    const base = indentOf(lines[i]!);
    const items: Item[] = [];
    const start = i;
    while (i < lines.length && !blank(lines[i]!)) {
      const line = lines[i]!, m = MARK.exec(line);
      if (m && indentOf(line) === base) items.push({ lines: [line], marker: m[2]! });
      else if (indentOf(line) > base && items.length) items[items.length - 1]!.lines.push(line);
      else break;
      i++;
    }
    runs.push({ start, end: i, items, indent: " ".repeat(base) });
  }
  return runs;
}

/** The items sorted (stable), renumbered when the list is numbered. */
export function sortItems(items: Item[], spec: SortSpec): Item[] {
  const keyed = items.map((item, index) => ({
    item, index,
    key: spec.by === "title" ? titleOf(item.lines[0]!) : propertyIn(item.lines, spec.by),
  }));
  keyed.sort((x, y) => compareKeys(x.key, y.key, spec.order) || x.index - y.index);
  const sorted = keyed.map((k) => k.item);
  if (items.every((item) => /^\d+[.)]$/.test(item.marker))) {
    const first = parseInt(items[0]!.marker, 10), tail = items[0]!.marker.slice(-1);
    return sorted.map((item, n) => ({ ...item, lines: [item.lines[0]!.replace(MARK, (_, ws: string) => `${ws}${first + n}${tail} `), ...item.lines.slice(1)] }));
  }
  return sorted;
}

/** Why no item has the property: the nearest keys the items do have (properties are open). */
export function noteMissingKey(items: Item[], key: string): string | null {
  if (key === "title" || items.some((item) => propertyIn(item.lines, key) !== undefined)) return null;
  const keys = new Set<string>();
  for (const item of items) for (const line of item.lines) for (const m of line.matchAll(/\[([A-Za-z][\w.-]*)::/g)) keys.add(m[1]!);
  return `no item has ${key}${keys.size ? `; the items have ${[...keys].sort().join(", ")}` : " (they have no properties)"}`;
}

/** Sort one run of `text`'s lines (`which` of them, 0 first), or only the lines from `lo` to `hi` when given. */
export function sortListInText(text: string, spec: SortSpec, which = 0, within?: [number, number]): { text: string; count: number; note?: string } {
  const lines = text.split("\n");
  const limit = within ?? [0, lines.length];
  const runs = listRuns(lines.slice(limit[0], limit[1])).map((r) => ({ ...r, start: r.start + limit[0], end: r.end + limit[0] }));
  const run = runs[which];
  if (!run) throw new Error(runs.length ? `the text has ${runs.length} list${runs.length === 1 ? "" : "s"}; list ${which + 1} isn't one (with={"list":"1"})` : "no list here: a list is lines starting with -, * or 1.");
  const note = noteMissingKey(run.items, spec.by);
  if (note) throw new Error(note);
  const sorted = sortItems(run.items, spec).flatMap((item) => item.lines);
  lines.splice(run.start, run.end - run.start, ...sorted);
  return { text: lines.join("\n"), count: run.items.length };
}

/** The line range `[lo, hi)` a character span touches. */
export function lineRange(text: string, start: number, end: number): [number, number] {
  const lo = text.slice(0, start).split("\n").length - 1;
  const hi = text.slice(0, Math.max(start, end - (text[end - 1] === "\n" ? 1 : 0))).split("\n").length;
  return [lo, hi];
}

/**
 * What extracting `[start, end)` of `text` makes: the child's text, and `text` with `!((id))` in place of the span.
 * A span of whole lines (or a list item) is moved by line, dedented; a list item's mark is kept in the note
 * (`- !((id))`) and dropped from the child, whose title is the item and whose children are its sub-items.
 */
export function extractFrom(text: string, start: number, end: number): { child: string; replace: (id: string) => string } {
  const quote = text.slice(start, end);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const eol = text.indexOf("\n", end - (text[end - 1] === "\n" ? 1 : 0));
  const lineEnd = eol < 0 ? text.length : eol;
  const wholeLines = quote.includes("\n") || (text.slice(lineStart, start).trim() === "" && text.slice(end, lineEnd).trim() === "");
  if (!wholeLines) return { child: quote, replace: (id) => text.slice(0, start) + `!((${id}))` + text.slice(end) };
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const base = Math.min(...lines.filter((l) => !blank(l)).map(indentOf));
  const lead = " ".repeat(base);
  const dedented = lines.map((l) => (blank(l) ? "" : l.slice(base)));
  const tops = dedented.filter((l) => !blank(l) && indentOf(l) === 0);
  const single = MARK.exec(dedented[0]!) && tops.length === 1;
  let child: string, embed: string;
  if (single) {
    const m = MARK.exec(dedented[0]!)!;
    const rest = dedented.slice(1);
    const inner = Math.min(...rest.filter((l) => !blank(l)).map(indentOf));
    child = [dedented[0]!.slice(m[0].length), ...rest.map((l) => (blank(l) || !Number.isFinite(inner) ? l : l.slice(inner)))].join("\n");
    embed = `${lead}${m[2]} !((ID))`;
  } else {
    child = dedented.join("\n");
    embed = `${lead}!((ID))`;
  }
  return { child, replace: (id) => text.slice(0, lineStart) + embed.replace("ID", id) + text.slice(lineEnd) };
}
