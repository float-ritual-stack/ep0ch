// A figure suggestion as a ready patch (PIE-1252): when Jev says a note's list reads as a figure, code builds that figure
// from the list's own lines and hands back one outline_patch edit (the lines seen → the figure), so following the
// suggestion costs the writer nothing. Built by code from the parsed rows, never by Jev (Jev only chose the figure):
// dated items a timeline; boxes, or done and open words, a check; `a · b · c` rows a table; `label: A | B` rows a
// compare (its columns from a `A | B` line above); options with a chosen or rejected mark or word, and a reason, a
// decision. A shape code can't map exactly gets no patch, and the suggestion says so. Pure.

import { noteStructure } from "./component-block";
import type { ShapePatch } from "./write-shape";

const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;
const DATED = /^(\*\*|\*)?(\d{4}-\d{2}(?:-\d{2})?)\b\s*(?::|—|–|-)?\s*(.+?)\1?$/;
const BOX = /^\[([ xX~!✓✗])\][ \t]+\S/;
const DOT = /\s+·\s+/;

/** A row a checklist reads without a box: a done or open word or glyph leading it (`✓ dig`, `Done: dig`, `todo: sow`). */
const STATUS_LEAD = /^(?:(✓|✔|☑)|(☐|○)|(done|finished)\s*:|(todo|to do|open|not done|pending)\s*:)\s*(\S.*)$/i;
/** A compare row: a short label, a colon, then two or three cells between ` | `; bold all through for the accent. */
const COMPARE = /^(\*\*)?([^:|*]{1,40}):\s+(.+?)\1$/;
/** A decision row: chosen (bold), rejected (italic) or open, then its reason after a dash; or `Chosen:`/`Rejected:` said. */
const DECISION = /^(\*\*[^*]+\*\*|\*[^*]+\*|[^—–]+?)\s+(?:—|–|-)\s+(\S.*)$/;
const SAID_DECISION = /^(chosen|picked|kept|decided|rejected|dropped|ruled out|open|undecided)\s*:\s*(.+?)(?:\s+(?:—|–|-|because)\s+(\S.*))?$/i;

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

/**
 * The figure a run's rows make for `component`, or null when its rows don't all have that shape. `lead`: the line just
 * above the run, which a compare takes its column names from (`Today | After the fix`).
 */
function figureOf(component: string, rows: string[], lead?: string): string | null {
  switch (component) {
    case "graph-timeline": {
      const events = rows.map(r => DATED.exec(r));
      if (events.some(e => !e)) return null;
      return ["::graph-timeline", "---", "---", ...events.map(e => `- ${e![1] ?? ""}${e![2]}: ${e![3]}${e![1] ?? ""}`), "::"].join("\n");
    }
    case "graph-check": {
      // Boxes as written, or a done or open word or glyph made the box it means.
      const checked = rows.map(r => {
        if (BOX.test(r)) return r;
        const m = STATUS_LEAD.exec(r);
        return m ? `[${m[1] || m[3] ? "x" : " "}] ${m[5]}` : null;
      });
      if (checked.some(r => r === null)) return null;
      return ["::graph-check", "---", "---", ...checked.map(r => `- ${r}`), "::"].join("\n");
    }
    case "graph-compare": {
      const parsed = rows.map(r => COMPARE.exec(r)).map(m => m && { bold: !!m[1], label: m[2]!.trim(), cells: m[3]!.split(/\s+\|\s+/).map(c => c.trim()) });
      const n = parsed[0]?.cells.length ?? 0;
      if (n < 2 || n > 3 || parsed.some(p => !p || p.cells.length !== n || p.cells.some(c => !c))) return null;
      const columns = lead && lead.split(/\s+\|\s+/).length === n ? lead.split(/\s+\|\s+/).map(c => c.replace(/^\*\*|\*\*$|:$/g, "").trim()) : null;
      return ["::graph-compare", "---", ...(columns ? [`columns: [${columns.map(yamlCell).join(", ")}]`] : []), "---", ...parsed.map(p => p!.bold ? `- **${p!.label}: ${p!.cells.join(" | ")}**` : `- ${p!.label}: ${p!.cells.join(" | ")}`), "::"].join("\n");
    }
    case "graph-decision": {
      const options = rows.map(r => {
        const said = SAID_DECISION.exec(r);
        if (said) {
          const word = said[1]!.toLowerCase(), what = said[2]!.trim(), why = said[3]?.trim();
          const mark = /^(?:chosen|picked|kept|decided)$/.test(word) ? `**${what}**` : /^(?:rejected|dropped|ruled out)$/.test(word) ? `*${what}*` : what;
          return why ? `${mark} — ${why}` : mark;
        }
        const m = DECISION.exec(r);
        return m ? `${m[1]!.trim()} — ${m[2]!.trim()}` : null;
      });
      // A decision needs a choice in it: one option chosen or rejected, never a plain list with dashes.
      if (options.some(o => o === null) || !options.some(o => /^\*/.test(o!))) return null;
      return ["::graph-decision", "---", "---", ...options.map(o => `- ${o}`), "::"].join("\n");
    }
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
/** The figures code builds from a list's lines. */
export const BUILT: readonly string[] = ["graph-timeline", "graph-check", "graph-table", "graph-compare", "graph-decision"];

export function figurePatch(text: string, component: string): { patch: ShapePatch[] } | { why: string } {
  const lines = text.split("\n");
  for (const run of runs(lines)) {
    // A compare's column names, when the line right above the run names them (and then that line goes into the figure).
    const above = run.start > 0 ? lines[run.start - 1]!.trim() : "";
    const lead = component === "graph-compare" && / \| /.test(above) && !ITEM.test(above) ? above : undefined;
    const figure = figureOf(component, run.rows, lead);
    if (!figure) continue;
    const from = lead && figure.includes("columns:") ? run.start - 1 : run.start;
    return { patch: [{ observed: lines.slice(from, run.end + 1).join("\n"), replacement: figure }] };
  }
  return { why: BUILT.includes(component) ? "no list whose every row has its shape" : `code doesn't build a ${component} from lines yet: write it yourself` };
}
