// A figure suggestion as a ready patch (PIE-1252): when Jev says a note's list reads as a figure, code builds that figure
// from the list's own lines and hands back one outline_patch edit (the lines seen → the figure), so following the
// suggestion costs the writer nothing. Built by code from the parsed rows, never by Jev (Jev only chose the figure). A
// shape code can't map exactly (a decision's chosen and rejected, a compare with no column names) gets no patch, and
// the suggestion says so. Pure.

import { noteStructure } from "./component-block";
import type { ShapePatch } from "./write-shape";

const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;
const DATED = /^(\*\*|\*)?(\d{4}-\d{2}(?:-\d{2})?)\b\s*(?::|—|–|-)?\s*(.+?)\1?$/;
const BOX = /^\[([ xX~!✓✗])\][ \t]+\S/;
const DOT = /\s+·\s+/;

interface Run { start: number; end: number; rows: string[] }

/** The runs of three or more list items at one indent, outside code and components, top-level lines only (not in a callout). */
function runs(lines: readonly string[]): Run[] {
  const structure = noteStructure(lines);
  const out: Run[] = [];
  let open: (Run & { indent: string }) | null = null;
  const close = () => { if (open && open.rows.length >= 3) out.push({ start: open.start, end: open.end, rows: open.rows }); open = null; };
  lines.forEach((line, i) => {
    const m = structure[i] === -1 ? ITEM.exec(line) : null;
    if (!m) { close(); return; }
    if (open && open.indent === m[1]) { open.rows.push(m[2]!.trim()); open.end = i; return; }
    close();
    open = { start: i, end: i, rows: [m[2]!.trim()], indent: m[1]! };
  });
  close();
  return out;
}

const yamlCell = (cell: string) => (/^[\p{L}\p{N} ._/()'-]+$/u.test(cell) && !/^\d/.test(cell) ? cell : JSON.stringify(cell));

/** The figure a run's rows make for `component`, or null when its rows don't all have that shape. */
function figureOf(component: string, rows: string[]): string | null {
  switch (component) {
    case "graph-timeline": {
      const events = rows.map(r => DATED.exec(r));
      if (events.some(e => !e)) return null;
      return ["::graph-timeline", "---", "---", ...events.map(e => `- ${e![1] ?? ""}${e![2]}: ${e![3]}${e![1] ?? ""}`), "::"].join("\n");
    }
    case "graph-check":
      if (!rows.every(r => BOX.test(r))) return null;
      return ["::graph-check", "---", "---", ...rows.map(r => `- ${r}`), "::"].join("\n");
    case "graph-table": {
      const cells = rows.map(r => r.split(DOT).map(c => c.trim()));
      if (cells[0]!.length < 2 || cells.some(c => c.length !== cells[0]!.length)) return null;
      return ["::graph-table", "---", `rows: [${cells.map(c => `[${c.map(yamlCell).join(", ")}]`).join(", ")}]`, "---", "::"].join("\n");
    }
    default:
      return null;
  }
}

/**
 * The ready patch that draws the note's list as `component`: the first run of three or more items whose every row has
 * that figure's shape, replaced by the figure. `why` when there is none: no such run, or a figure code doesn't build.
 */
export function figurePatch(text: string, component: string): { patch: ShapePatch[] } | { why: string } {
  const lines = text.split("\n");
  for (const run of runs(lines)) {
    const figure = figureOf(component, run.rows);
    if (figure) return { patch: [{ observed: lines.slice(run.start, run.end + 1).join("\n"), replacement: figure }] };
  }
  return { why: ["graph-timeline", "graph-check", "graph-table"].includes(component) ? "no list whose every row has its shape" : `code doesn't build a ${component} from lines yet: write it yourself` };
}
