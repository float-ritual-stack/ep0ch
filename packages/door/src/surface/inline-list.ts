import { clipText } from "../overflow";
import { RowView } from "../scroll";
import { extractLinks, fg, C, pad, RESET } from "../style";
import { cellsOf } from "./selection";
import type { LinkTarget } from "../refs";

export const inlineRowKey = (key: number, target: LinkTarget) => `inline:${key}:${target.listRow?.row ?? [target.block, target.fragment, target.resourceRef, target.url, target.query].join("|")}`;

export type InlineListDraw = (lines: string[], width: number) => string[];

/** The reader lends every inline list the same viewport; row targets still belong to its elements. */
export class InlineList {
  readonly view = new RowView();
  rows: { target: LinkTarget; label: string; first: number; last: number; from: number }[] = [];
  width = 0;
  before = 0;
  after = 0;

  draw(key: number, lines: string[], width: number, targets: LinkTarget[], current: string | null, height?: number): string[] {
    const parsed = extractLinks(lines), byTag = new Map<number, typeof parsed.ranges>();
    for (const r of parsed.ranges) {
      if (targets[r.n]?.role !== "row") continue;
      const ranges = byTag.get(r.n) ?? [];
      ranges.push(r); byTag.set(r.n, ranges);
    }
    this.rows = [...byTag].map(([n, rs], row) => {
      const target = targets[n]!;
      target.inlineList = { key, row };
      return { target, label: rs.map(r => cellsOf(parsed.lines[r.line]!).slice(r.from, r.to).join("")).join(" "), first: rs[0]!.line, last: rs.at(-1)!.line, from: rs[0]!.from };
    });
    this.width = width;
    if (!this.rows.length && height === undefined) return lines;
    const first = height === undefined ? this.rows[0]!.first : 2, last = height === undefined ? this.rows.at(-1)!.last : lines.length - 3;
    this.before = first; this.after = lines.length - last - 1;
    // Ten lines, or room for three of its rows when a row is tall (PIE-1402: a narrow table's card is a row of many lines,
    // and a window of ten showed one card at a time).
    const tallest = Math.max(...this.rows.map(r => r.last - r.first + 1));
    const total = last - first + 1, room = height ?? Math.min(total, Math.max(10, Math.min(30, tallest * 3)));
    const index = this.rows.findIndex(r => inlineRowKey(key, r.target) === current);
    const selected = index < 0 ? undefined : this.rows[index];
    const top = this.view.place(selected ? index : null, total, room, selected ? [selected.first - first, selected.last - first] : null);
    const size = Math.max(1, Math.round(room * room / total));
    const pos = total > room ? Math.round((room - size) * top / (total - room)) : 0;
    const body = lines.slice(first + top, Math.min(last + 1, first + top + room)).map((line, i) => total > room
      ? pad(clipText(line, width - 1), width - 1) + fg(C.dark) + (i >= pos && i < pos + size ? "█" : "│") + RESET : line);
    const blank = fg(C.dark) + "┊" + " ".repeat(Math.max(0, width - 2)) + "┊" + RESET;
    const end = room;
    while (body.length < end) body.push(blank);
    return [...lines.slice(0, first), ...body, ...lines.slice(last + 1)];
  }
}
