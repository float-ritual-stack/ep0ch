// A rule's decorations on a note (PIE-600, pi-herdr-outliner src/extension-rules.ts): the service says which rules
// match the note and what each draws (view primitives, placed above or below what matched, in its place or around
// it); the reader lays them out here and draws them through the same primitives a component uses
// (src/components.ts primitiveLines). The note's text is never changed: `R` (decor.raw) shows it as written.
import { calloutBlocks } from "@ep0ch/outline-core/callouts";
import { primitiveHeadRow, primitiveLines } from "./components";
import type { HeadingStyleRegistry } from "@ep0ch/outline-core/heading-styles";
import type { Decoration } from "./projection";
import { C, fg, RESET } from "./style";
import { wrap } from "./text";

/** How the reader draws inside a decoration: a link a card names (`[ ]` stops on it), its Markdown when a primitive is new to this door. */
export interface DecorationDraw {
  row?: (block: string, text: string) => string;
  /** The outline's heading styles (PIE-599): what a band or a track names, and draws with. */
  headings?: HeadingStyleRegistry;
  markdown: (text: string, width: number) => string[];
  /** A `blockdown` primitive drawn as the note's body is (src/components.ts PrimitiveDraw). */
  blockdown?: (text: string, width: number) => string[];
}

/** Where a note's decorations go, by body line (the reader's `after` and `decorate` hooks, src/doc.ts). */
export interface DecorationPlan {
  /** Rows drawn after body line `n` (-1: above the body): `above` the line after, `below` the last line of what matched. */
  after: Map<number, ((width: number) => string[])[]>;
  /** What's drawn in the place of body lines from `n` to `end` (`replace`), or around them (`around`). */
  place: Map<number, { end: number; draw: (width: number) => { rows?: string[]; headRow?: number; frame?: { title: string; colour: number } } | null }>;
}

/** A decoration's rows, `width` wide: its view's primitives, else its Markdown, else what's wrong, dim. */
export function decorationRows(d: Decoration, width: number, draw: DecorationDraw): string[] {
  if (d.view) { try { return primitiveLines(d.view, width, { link: draw.row, headings: draw.headings, blockdown: draw.blockdown }); } catch { /* the next step of the chain */ } }
  if (d.markdown?.trim()) return draw.markdown(d.markdown, width);
  // Not drawn yet, or failed: said in one dim line, so a rule's author sees why.
  const why = d.status === "not-run" ? `${d.name} · drawing…` : `${d.name} · ${d.reason ?? d.status}`;
  return wrap(why, width).map(l => fg(d.status === "unavailable" ? C.yellow : C.dark) + l + RESET);
}

/** The row a decoration in a heading's place keeps its fold on: a band's words (its style may put them top or bottom). */
function headRowOf(d: Decoration, width: number, draw: DecorationDraw): { headRow?: number } {
  const row = primitiveHeadRow(d.view, width, draw.headings);
  return row === undefined ? {} : { headRow: row };
}

/** The title of a frame drawn around what matched: the view's own (a box's, a card's), else the decoration's. */
function frameTitle(d: Decoration): string {
  const v = d.view as { type?: string; title?: unknown } | undefined;
  return typeof v?.title === "string" ? v.title : d.title ?? "";
}

/**
 * Lay a note's decorations out over its body lines (`noteLines[i]` is the whole-text line body line `i` shows). A
 * decoration of the whole block goes above the body, below its last line, or around all of it; one of a construct or
 * a text line goes above or below it, in its place, or around it (one inside a callout is drawn above or below the
 * callout, never in its place). Two that want the same place: the first rule listed has it, and the
 * other is drawn above. A hit on a line the body doesn't show (folded under a heading, the title line) is left out.
 */
export function planDecorations(ds: readonly Decoration[], noteLines: readonly number[], draw: DecorationDraw, body: readonly string[] = []): DecorationPlan {
  const after = new Map<number, ((width: number) => string[])[]>();
  const place: DecorationPlan["place"] = new Map();
  const put = (at: number, f: (width: number) => string[]) => { const g = after.get(at); if (g) g.push(f); else after.set(at, [f]); };
  const last = noteLines.length - 1;
  const bodyLine = (line: number) => noteLines.indexOf(line);
  const aroundAll: Decoration[] = [];
  const callouts = calloutBlocks(body);
  for (const d of ds) {
    const rows = (width: number) => decorationRows(d, width, draw);
    if (d.hit.at === "block") {
      if (d.place === "below") put(last, rows);
      else if (d.place === "around" && d.status !== "unavailable") aroundAll.push(d);
      else put(-1, rows);
      continue;
    }
    const first = bodyLine(d.hit.line);
    if (first < 0) continue;
    // Inside a callout (its frame draws its lines itself): above it, never in its place.
    const callout = callouts.find(c => first > c.line && first < c.end);
    if (callout && d.place !== "below") { put(callout.line - 1, rows); continue; }
    // The body line after the last the hit covers (a callout's or a list's lines are consecutive in the body).
    let end = first + 1;
    while (end < noteLines.length && noteLines[end]! < d.hit.end) end++;
    if (d.place === "below") { put(end - 1, rows); continue; }
    const taken = [...place].some(([at, p]) => first < p.end && at < end);
    if (d.place === "replace" && !taken && d.status !== "not-run" && d.status !== "unavailable") {
      place.set(first, { end, draw: width => ({ rows: rows(width), ...headRowOf(d, width, draw) }) });
      continue;
    }
    if (d.place === "around" && !taken && d.status !== "unavailable") {
      place.set(first, { end, draw: () => ({ frame: { title: frameTitle(d), colour: C.blue } }) });
      continue;
    }
    put(first - 1, rows);
  }
  // A frame around the whole body, when nothing else takes a place in it (it would be drawn inside, out of reach); else above.
  for (const d of aroundAll) {
    if (!place.size && noteLines.length) place.set(0, { end: noteLines.length, draw: () => ({ frame: { title: frameTitle(d), colour: C.blue } }) });
    else put(-1, width => decorationRows(d, width, draw));
  }
  return { after, place };
}
