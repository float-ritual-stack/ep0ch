// The one drawing rule for a generated region (PIE-956): what a script, a handler, a component, a template's `::use` or an
// `[!output]` callout writes into a note reads as the note's own content. Its body is drawn flush with the text around
// it at the note's measure, with no box, no indent, no header and no bullet row, so a page with several of them reads
// like one document. Everything else about it (its name, when it ran, keep, run again, source) sits behind ONE dim mark
// in the reader's gutter beside its first row, and shows, as a single dim row under the body, while the region is open:
// the reader opens it when the `[ ]` position reaches it or a click lands on the mark (the door asks for button
// tracking, not motion, so there is no hover). What is wrong with a region (not run yet, failed, stale) stays in the
// flow as a dim row, never behind the mark.
//
// Used by every generated region (src/projection.ts extensionRegion, src/template-use.ts useRegion, the `[!output]`
// callouts of src/doc.ts) and drawn by the reader (src/surface/note.ts): the mark, its click and its `[ ]` stop.
import type { AfterRows } from "./doc";
import type { LinkTarget } from "./refs";
import { C, fg, RESET, visible, width } from "./style";

/** The glyph of the one dim mark a generated region carries in the reader's gutter. */
export const REGION_MARK = "≡";

/** What the reader needs to know about a region it draws: its stop for `[ ]`, and whether it is open now. */
export interface RegionBook {
  /** Whether the region keyed `key` shows what is behind its mark (the `[ ]` position is in it). */
  isOpen(key: string): boolean;
  /** The region as drawn: the reader makes its mark (a `[ ]` stop and a click target) from this. */
  add(region: { key: string; label: string; target: LinkTarget }): void;
}

export interface RegionDraw {
  /** Stable for the region in its note: `<block>:<line>`, or `<block>:#<anchor>`. */
  key: string;
  /** The region's name and what its mark stands for: `[ ]` says it, ⏎ does what the target does. */
  label: string;
  target?: LinkTarget;
  /** The body's rows, drawn `width` wide: its words, table or figure as the note would draw them written by hand. */
  body: readonly string[];
  /** What is wrong, already coloured, always shown (a stale reason, a failure, an option nobody knows). */
  notes?: readonly string[];
  /** Behind the mark: what the region is (its name, when it ran, who asked), and its controls (already tagged links). */
  facts: readonly string[];
  controls: readonly string[];
  width: number;
}

const dim = (text: string) => fg(C.dark) + text + RESET;

/** The dim row(s) behind the mark: facts joined by " · ", then the controls, wrapped at `w`. */
function panel(facts: readonly string[], controls: readonly string[], w: number): string[] {
  const rows: string[] = [];
  let row = "", cols = 0;
  const put = (text: string, sep: string) => {
    const n = width(text);
    if (cols && cols + sep.length + n > w) { rows.push(row); row = ""; cols = 0; sep = ""; }
    row += (cols ? dim(sep) : "") + text;
    cols += (cols ? sep.length : 0) + n;
  };
  facts.forEach((f, i) => put(dim(visible(f)), i ? " · " : ""));
  controls.forEach((c, i) => put(c, cols ? (i ? " " : "  ") : ""));
  if (row) rows.push(row);
  return rows;
}

/**
 * What a region draws after its body: what is wrong with it (always), and, while it is open, the row behind its mark. The
 * body's own rows are the caller's when it draws them itself (a callout's body is drawn by the document renderer).
 */
export function regionTail(d: RegionDraw, book: RegionBook | undefined): string[] {
  const rows = [...(d.notes ?? [])];
  if (!d.body.length && !rows.length) rows.push(dim("nothing drawn"));
  if (d.target) book?.add({ key: d.key, label: d.label, target: d.target });
  if (book?.isOpen(d.key)) rows.push(...panel(d.facts, d.controls, d.width));
  return rows;
}

/** The rows a region draws, and where it is (the reader's gutter mark goes on its first row). */
export function regionRows(d: RegionDraw, book: RegionBook | undefined): AfterRows {
  const rows = [...d.body, ...regionTail(d, book)];
  return { rows, regions: [{ key: d.key, at: 0, rows: rows.length }] };
}

/** Row groups in order as one: plain rows and a region's, with each region's `at` moved to where its rows land. */
export function joinRows(parts: readonly (readonly string[] | AfterRows)[]): string[] | AfterRows {
  const rows: string[] = [], regions: NonNullable<AfterRows["regions"]> = [];
  for (const part of parts) {
    if ("rows" in part) { for (const r of part.regions ?? []) regions.push({ ...r, at: r.at + rows.length }); rows.push(...part.rows); }
    else rows.push(...part);
  }
  return regions.length ? { rows, regions } : rows;
}
