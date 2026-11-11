// The draft's view (PIE-1560): one module draws a Draft (src/edit.ts, the text, cursor, selection and history) and
// answers where a cell is in it. Three adapters share the place the draft keeps in source coordinates (its
// ReaderPosition): raw rows (the text soft-wrapped, the edit frame's), a one-row line (a line field, scrolled
// sideways), and rich cells (surface/element-editor.ts, a table's cells). Nothing about the view is kept on the
// draft but `views`, so an agent's patch keeps the person's place by mapping the position alone, never by reading
// the last render.
import { landingLine } from "@ep0ch/outline-core/block-insert";
import type { FoldPoint } from "./doc";
import type { Draft } from "./edit";
import type { Completer } from "./surface/completer";
import type { ElementEdit } from "./surface/element-editor";
import { listLead } from "./edit";
import type { Placement } from "./kitty";
import type { LinkTarget } from "./refs";
import { PositionRows } from "./reader-position";
import { lastTop, pageRows, scrolled, scrollOff } from "./scroll";
import { SELECT_BG } from "./surface/selection";
import { bg, C, chip, codePointCells, drawEllipsized, fg, headOf, RESET, tailFrom, width, type LinkRange } from "./style";
import { wrap } from "./text";

/** One drawn row of a draft: line `line`, code points [start, end), drawn `indent` cells in. */
export interface VRow {
  line: number; start: number; end: number; indent: number;
  /** A row that is no text of the line: its progress words, or (`drawn`) a read-only drawing `kept` put under it, already coloured. */
  status?: string; drawn?: true;
}

/** Where the edit frame drew the text and its controls, in the host's cells (set by renderEditor). */
export interface DraftFrame {
  row: number; col: number; rows: number; cols: number; controls: { row: number; from: number; to: number; action: "preview" | "pick" | "copy" | "place" | "lands" | "attach" | "file-new" | "snippet.next" | "snippet.previous" | "snippet.end" }[];
  /**
   * The preview's rows under the text (its rule first), and its top row and length as drawn: what its wheel scrolls.
   * `placements`: its pictures (PIE-846), on the rows they're drawn, for the host to put out with its own.
   */
  preview?: { row: number; col: number; cols: number; rows: number; top: number; total: number; source: number[]; placements?: Placement[] };
  /** The preview's links, where they're drawn (PIE-592): a click on one follows it. */
  links?: { row: number; from: number; to: number; target: LinkTarget }[];
}

/** The preview's last drawing (editor.ts `previewRows`), drawn again only when the text or width changed. */
export interface PreviewDrawn { text: string; w: number; at: number; body: string[]; ranges: LinkRange[]; links: LinkTarget[]; pending: boolean; placements: Placement[]; source: number[] }

/**
 * Every view of one draft, in one place: the raw rows (always there), the one-row line (a line field's), the rich cells
 * (made on first use by element-editor.ts), the completion popup (completer.ts) and the preview's last drawing.
 */
export class DraftViews {
  readonly raw: RawRows;
  line: LineRow | null = null;
  /** The rich cells' adapter (`ElementEdit`), made by `elementEdit` on first use. */
  rich: ElementEdit | null = null;
  /** The completion popup (`Completer`), made by `completerFor` on first use. */
  completer: Completer | null = null;
  preview: PreviewDrawn | null = null;
  constructor(d: Draft) { this.raw = new RawRows(d); }
}

/** One source line as every view of a draft lays it out: its ask's progress, and what a handler line keeps under it. */
export interface SourceLine { i: number; line: string; status: string; beside: boolean; kept: string[] }

/**
 * Lines `from`..`to` as every view lays them out (raw rows and rich cells alike, PIE-1560): a closed answer fold left out;
 * each line's ask progress (`beside` it when it fits in `room(i, line)` cells, else on rows of its own); the read-only
 * rows a handler line last drew (PIE-981, the raw view's `kept`).
 */
export function sourceLines(d: Draft, from: number, to: number, w: number, room: (i: number, line: string) => number): SourceLine[] {
  const hidden = d.hiddenAnswerLines(), out: SourceLine[] = [];
  for (let i = from; i < to; i++) {
    if (hidden.has(i)) continue;
    const line = d.lines[i]!, r = room(i, line), status = d.askStatus(line, r, i);
    out.push({ i, line, status, beside: !!status && width(status) <= r, kept: d.views.raw.kept?.(i, w) ?? [] });
  }
  return out;
}

/** The draft's raw rows: what the edit frame draws, clicks, scrolls and moves up and down through. */
export const draftView = (d: Draft): RawRows => d.views.raw;

/**
 * The raw rows adapter: each line soft-wrapped at spaces, continuations hung under its text; the cursor, the selection,
 * an agent's glow and what a handler line keeps under it drawn in. Its top row is the draft's position (source line and
 * screen row), so anything that maps the position keeps the view where it was.
 */
export class RawRows {
  private readonly rows: PositionRows;
  /** The last render: its width, height and rows, for the wheel, clicks and up/down. */
  private shown: { w: number; h: number; rows: VRow[] } = { w: 0, h: 15, rows: [] };
  /** The screen row of the cursor in the last render (the completion popup opens under it), and its cell. */
  cursorRow = 0;
  cursorCol = 0;
  /** Where the edit frame drew the text and its controls (renderEditor), for clicks in the host's cells. */
  frame: DraftFrame | null = null;
  /** Show the Markdown preview under the text (ctrl+p, or the frame's control). The host draws it. */
  preview = false;
  /**
   * The preview scrolled by the wheel (PIE-846): its source offset from the cursor, for the text it was scrolled on. Typing (the text changing)
   * lets it go, and the preview follows the cursor's line again.
   */
  previewScroll: { lineDelta: number; row: number; text: string } | null = null;
  /**
   * Rows drawn under a line, read-only (PIE-981): what a handler line last drew, kept in view while the lines around it are
   * edited. Already coloured, `w` wide at most; the host sets it before each paint (a draft that has none draws none). The
   * cursor never stops on one, and a click on one lands at the end of its line.
   */
  kept: ((line: number, w: number) => string[]) | null = null;
  /**
   * A line's ink while it is typed (PIE-1312): spans of code points [from, to) drawn in colour `fg`, `under` underlined (what
   * won't run). The host sets it (a `::button` line's parts and marks); the cursor, a selection and an agent's glow draw over it.
   */
  inks: ((line: number, text: string) => readonly { from: number; to: number; fg: number; under?: boolean }[] | null) | null = null;

  constructor(private readonly d: Draft) { this.rows = new PositionRows(d.position); }

  /** The draft's position (it can change: a reader hands its own over, `usePosition`). */
  private get at(): PositionRows { this.rows.position = this.d.position; return this.rows; }
  private get top() { return this.at.top; }
  private set top(value: number) { this.at.top = value; }
  get scrollFigure() { return { top: this.top, room: this.shown.h, total: this.shown.rows.length }; }
  /** Rows PgUp PgDn move the cursor (and scroll): the rows shown, less one (pageRows, PIE-1293). */
  pageRows(): number { return pageRows(this.shown.h); }

  /** The rows the draft is drawn in at width `w`. */
  layout(w: number): VRow[] {
    const d = this.d, out: VRow[] = [], ww = Math.max(4, w);
    const wrapped = new Map<number, { chars: string[]; rows: ReturnType<typeof wrapRows> }>();
    const room = (i: number, line: string) => {
      const chars = [...line], rows = wrapRows(chars, ww, hangOf(line, ww)), last = rows.at(-1)!;
      wrapped.set(i, { chars, rows });
      // The cursor at the line's end sits on the progress's leading space (render), so it takes no room of its own here.
      return w - last.indent - width(chars.slice(last.start, last.end).join(""));
    };
    for (const l of sourceLines(d, 0, d.lines.length, ww, room)) {
      const { chars, rows } = wrapped.get(l.i)!;
      for (const r of rows) out.push({ line: l.i, ...r });
      if (l.status && !l.beside) for (const text of wrap(l.status.trim(), ww)) out.push({ line: l.i, start: chars.length, end: chars.length, indent: 0, status: text });
      for (const text of l.kept) out.push({ line: l.i, start: chars.length, end: chars.length, indent: 0, status: text, drawn: true });
    }
    return out;
  }

  /** The visual row the cursor is on, its cell (`x`, in cells) and its code point in the line (`cp`). */
  private cursorIn(rows: VRow[]): { vi: number; x: number; cp: number } {
    const d = this.d, line = d.lines[d.row]!;
    const cp = [...line.slice(0, d.col)].length;
    let vi = rows.findIndex(r => r.line === d.row);
    if (vi < 0) return { vi: 0, x: 0, cp };
    while (vi + 1 < rows.length && rows[vi + 1]!.line === d.row && !rows[vi + 1]!.status && rows[vi + 1]!.start <= cp) vi++;
    const r = rows[vi]!, cw = codePointCells([...line]);
    let x = r.indent; for (let k = r.start; k < cp; k++) x += cw[k] ?? 1;
    return { vi, x, cp };
  }

  /** The visual row that line `line`, column `col` (UTF-16) is drawn on. */
  private rowOf(rows: VRow[], line: number, col: number): number {
    const cp = [...(this.d.lines[line] ?? "").slice(0, col)].length;
    let vi = rows.findIndex(r => r.line === line);
    if (vi < 0) return 0;
    while (vi + 1 < rows.length && rows[vi + 1]!.line === line && !rows[vi + 1]!.status && rows[vi + 1]!.start <= cp) vi++;
    return vi;
  }

  /** The source place at a visual row's cell `x`. */
  private posIn(rows: VRow[], vi: number, x: number): { row: number; col: number } {
    if (!rows.length) return { row: 0, col: 0 };
    vi = Math.max(0, Math.min(rows.length - 1, vi));
    const r = rows[vi]!, last = rows[vi + 1]?.line !== r.line || !!rows[vi + 1]?.status;
    if (r.status) return { row: r.line, col: this.d.lines[r.line]!.length };
    // The code point at cell `x`: past the glyphs that end at or before it, never inside one (a wrapped row's
    // last glyph is where its end lands, so a click past it never splits a joined emoji).
    const line = this.d.lines[r.line]!, cw = codePointCells([...line]);
    let end = last ? r.end : Math.max(r.start, r.end - 1);
    while (!last && end > r.start && cw[end] === 0) end--;
    let cp = r.start;
    for (let at = r.indent; cp < end && at + (cw[cp] ?? 1) <= x; ) { at += cw[cp] ?? 1; cp++; while (cp < end && cw[cp] === 0) cp++; }
    return { row: r.line, col: [...line].slice(0, cp).join("").length };
  }

  /** Up and down by the rows drawn (a wrapped line is several), keeping the column they started at (the draft's goal). */
  moveBy(by: number) {
    const d = this.d;
    if (!this.shown.w) {
      d.row = Math.max(0, Math.min(d.lines.length - 1, d.row + by));
      d.col = Math.min(d.col, d.lines[d.row]!.length);
      return;
    }
    const rows = this.layout(this.shown.w).filter(r => !r.status), at = this.cursorIn(rows);
    d.goal ??= at.x;
    const p = this.posIn(rows, at.vi + by, d.goal);
    d.row = p.row; d.col = p.col;
  }

  /** The wheel: the view moves `by` rows, past the end as a reader does (PIE-622); the cursor stays where it is (typing brings it back). */
  scrollBy(by: number) {
    this.top = scrolled(this.top, by, lastTop(this.shown.rows.length, this.shown.h));
    this.d.follow = false;
    this.d.position.top = null;
  }

  /**
   * The answer fold whose row is under a cell of the text as last drawn (`x`, `y` from the text's top left): its ask's
   * progress, on a row of its own or beside the ask's last row (PIE-1738). A click there opens or shuts the answer.
   */
  foldAt(x: number, y: number): FoldPoint | null {
    const rows = this.shown.rows, vi = this.top + Math.max(0, y), r = rows[vi];
    if (!r || r.drawn) return null;
    const fold = this.d.answerFolds().find(p => p.line === r.line + 1);
    if (!fold || !this.d.askStatus(this.d.lines[r.line]!, Infinity, r.line)) return null;
    if (r.status) return fold;
    // Beside: on the line's last row of text (as render draws it there), past the text.
    if (rows[vi + 1]?.line === r.line && !rows[vi + 1]?.drawn) return null;
    const cw = codePointCells([...this.d.lines[r.line]!]);
    let at = r.indent; for (let k = r.start; k < r.end; k++) at += cw[k] ?? 1;
    return x > at ? fold : null;
  }

  /** The source place under a cell of the text as last drawn (`x`, `y` from the text's top left). */
  posAt(x: number, y: number): { row: number; col: number } {
    return this.posIn(this.shown.rows, this.top + Math.max(0, y), Math.max(0, x));
  }

  /**
   * Where a part dropped at host cell `x`, `y` lands (PIE-1357): after the block of lines under it (down to the line
   * before a blank one), and the host row its drop line is drawn on, under that block. Null off the text.
   */
  dropAt(x: number, y: number): { line: number; row: number } | null {
    const d = this.d, f = this.frame, rows = this.shown.rows;
    // Rich edit draws no source rows (PIE-1357): the part lands after the block the cursor is in, with no line drawn.
    if (!f || !rows.length || d.views.rich?.on) return { line: landingLine(d.lines, d.row), row: -1 };
    if (y < f.row || y >= f.row + f.rows || x < f.col - 1 || x > f.col + f.cols) return null;
    const line = landingLine(d.lines, rows[Math.min(rows.length - 1, this.top + (y - f.row))]!.line);
    // Its drop line: under the last row the landing line is drawn on, when that row is in view.
    let k = rows.length - 1;
    while (k > 0 && rows[k]!.line > line) k--;
    const row = f.row + (k - this.top) + 1;
    return { line, row: row > f.row && row < f.row + f.rows ? row : -1 };
  }

  /** `Draft.landInView`, once, unless a key or an agent has placed the cursor since the open (they follow). As ↑↓ resume at the view's top in a reader. */
  private landInView(rows: VRow[]) {
    const d = this.d, h = this.shown.h;
    d.landInView = false;
    if (d.follow || !rows.length) return;
    const top = rows.length <= h ? 0 : Math.max(0, Math.min(this.top, lastTop(rows.length, h))), at = this.cursorIn(rows).vi;
    if (at >= top && at < top + h) return;
    // A status or a drawing is no place to type, and its line can be above the view: with only those in view, the cursor stays.
    const shown = rows.slice(top, top + h), first = [shown.findIndex(r => !r.status && r.end > r.start), shown.findIndex(r => !r.status)].find(i => i >= 0);
    if (first === undefined) return;
    const p = this.posIn(rows, top + first, 0);
    d.row = p.row; d.col = p.col; d.landed = p;
  }

  /** The draft as terminal lines, soft-wrapped at `w`, with the cursor and selection drawn; the cursor kept on screen unless scrolled away. */
  render(w: number, h: number): string[] {
    const d = this.d, w1 = Math.max(4, w);
    const rows = this.layout(w1), pr = this.at;
    pr.source = rows.map(r => r.line);
    pr.origin = this.frame?.row ?? 0;
    this.shown = { w: w1, h: Math.max(1, h), rows };
    // An agent's patch moved the top row's start (`Draft.commitPatch`): that row goes back on top, mid-line or not.
    const moved = d.position.top;
    if (moved?.mapped && d.position.view?.line === moved.line) this.top = this.rowOf(rows, moved.line, moved.col);
    if (d.landInView) this.landInView(rows);
    const at = this.cursorIn(rows), sel = d.selection();
    // Following the cursor, the view keeps a few rows around it (scrolloff, PIE-622): on the last line too, where the rows
    // under it are the blank ones past the end (reader.overscroll; none keeps the last line on the edge). An agent's patch
    // put the cursor's line back on its row (`Draft.commitPatch`), so it is still inside them: nothing on screen moves.
    // The line being typed on stays on its screen row when rows above it come or go (an ask's progress, a status above the
    // text), as it does under an agent's patch: nothing moves under the person's cursor until they move it.
    // A note that fits shows all of it instead: seeing the whole note wins, and the typed row may move.
    const fits = rows.length <= h, holding = d.follow && !fits && d.position.caret?.line === d.row;
    if (holding) {
      let first = at.vi;
      while (first > 0 && rows[first - 1]!.line === d.row) first--;
      this.top = first - (d.position.caret!.row - pr.origin);
    }
    // Rows that fit start at the first, whatever scrolled them before (an open keeps the reader's top, and isn't following)
    // and whatever the cursor's margin wants: a blank row past the end is never worth a row of the note (PIE-1573, PIE-1560).
    if (fits) this.top = 0;
    else if (d.follow && !(holding && at.vi >= this.top && at.vi < this.top + h)) {
      const off = scrollOff(h);
      if (at.vi - off < this.top) this.top = at.vi - off;
      if (at.vi + off >= this.top + h) this.top = at.vi + off - h + 1;
    }
    // Holding the typed line can need more blank room below than the usual overscroll limit.
    const top = Math.max(0, Math.min(this.top, holding ? Math.max(0, at.vi) : lastTop(rows.length, h)));
    // The place, in source coordinates, for whatever changes the text next: the top row's line (`view`), and the cursor's
    // line where it is on screen while it's in view (`caret`), so an agent's patch keeps either without this render.
    this.top = top;
    let first = at.vi;
    while (first > 0 && rows[first - 1]!.line === d.row) first--;
    d.position.caret = at.vi >= top && at.vi < top + h ? pr.at(d.row, first - top) : null;
    const tr = rows[top];
    d.position.top = tr ? { line: tr.line, col: utf16Col(d.lines[tr.line]!, tr.start) } : null;
    this.cursorCol = at.x;
    this.cursorRow = Math.max(0, Math.min(h - 1, at.vi - top));
    const out: string[] = [];
    // Agents' patches just landed: their text lit, and who made it at the end of their last row.
    const now = Date.now();
    d.flashes = d.flashes.filter(f => f.until > now);
    const lit = d.flashes.map(f => {
      const a = d.placeOf(f.start), b = d.placeOf(f.end);
      const cp = (p: { row: number; col: number }) => [...d.lines[p.row]!.slice(0, p.col)].length;
      return { a: { row: a.row, cp: cp(a) }, b: { row: b.row, cp: cp(b) }, label: f.label };
    });
    for (let vi = top; vi < Math.min(rows.length, top + h); vi++) {
      const r = rows[vi]!, chars = [...d.lines[r.line]!];
      if (r.status) { out.push(r.drawn ? r.status : fg(C.lmagenta) + r.status + RESET); continue; }
      const cells = chars.slice(r.start, r.end).map(c => (c === "\t" || c < " " ? " " : c));
      // Selected cells, in this row's own cells.
      let s0 = -1, s1 = -1;
      if (sel) {
        const cpOf = (p: { row: number; col: number }) => [...d.lines[p.row]!.slice(0, p.col)].length;
        const a = sel[0].row < r.line ? 0 : sel[0].row === r.line ? cpOf(sel[0]) : Infinity;
        const b = sel[1].row > r.line ? Infinity : sel[1].row === r.line ? cpOf(sel[1]) : -1;
        s0 = Math.max(r.start, a) - r.start; s1 = Math.min(r.end, b) - r.start;
      }
      const cx = vi === at.vi ? at.cp - r.start : -1;
      // The ask's progress beside its last row; the cursor at the line's end sits on its leading space, so the words don't
      // move as the cursor comes and goes (PIE-1741: "drafts  · answered" at the ask, "drafts · answered" away from it).
      const progress = rows[vi + 1]?.line !== r.line || rows[vi + 1]?.drawn ? d.askStatus(d.lines[r.line]!, Infinity, r.line) : "";
      const onStatus = cx >= cells.length && progress.startsWith(" ");
      if (cx >= cells.length) { if (!onStatus) cells.push(" "); }
      // The line break is selected too (the selection goes on below this line): one lit cell after its text, so a blank line
      // in the selection, and where each line ends, can be seen. Not past the row's width.
      else if (sel && sel[0].row <= r.line && sel[1].row > r.line && rows[vi + 1]?.line !== r.line && r.indent + width(cells.join("")) < w1) { cells.push(" "); s1 = cells.length; }
      const glow = lit.map(f => ({
        from: (f.a.row < r.line ? 0 : f.a.row === r.line ? f.a.cp : Infinity) - r.start,
        to: (f.b.row > r.line ? Infinity : f.b.row === r.line ? f.b.cp : -1) - r.start,
        last: f.b.row === r.line && f.b.cp >= r.start && (f.b.cp <= r.end || r.end === chars.length), label: f.label,
      }));
      let line = " ".repeat(r.indent) + fg(C.white), style = "";
      const inks = this.inks?.(r.line, d.lines[r.line]!) ?? null;
      const ink = (j: number) => {
        if (!inks) return "";
        const at = r.start + j, hit = inks.filter(k => at >= k.from && at < k.to);
        if (!hit.length) return "";
        const colour = hit.findLast(k => !k.under) ?? hit.at(-1)!;
        return fg(colour.fg) + (hit.some(k => k.under) ? "\x1b[4m" : "");
      };
      // A style changes only at a glyph's first code point, never between the parts of a joined one.
      const cw = codePointCells(chars);
      cells.forEach((c, j) => {
        if (cw[r.start + j] === 0 && j > 0) { line += c; return; }
        const want = j === cx ? bg(C.lcyan) + fg(C.black) : j >= s0 && j < s1 ? SELECT_BG + fg(C.white) : glow.some(g => j >= g.from && j < g.to) ? chip(C.magenta) : ink(j);
        if (want !== style) { line += RESET + fg(C.white) + want; style = want; }
        line += c;
      });
      const roomForStatus = Math.max(0, w1 - r.indent - width(cells.join("")));
      const status = progress ? d.askStatus(d.lines[r.line]!, roomForStatus, r.line) : "";
      if (status) line += RESET + (onStatus ? bg(C.lcyan) + fg(C.black) + " " + RESET + fg(C.lmagenta) + status.slice(1) : fg(C.lmagenta) + status);
      const said = glow.find(g => g.last)?.label;
      const room = w1 - r.indent - width(cells.join("")) - width(status) - 2;
      out.push(line + RESET + (said && room > 4 ? "  " + fg(C.lmagenta) + drawEllipsized("@" + said, room) + RESET : ""));
    }
    return out;
  }
}

/**
 * The one-row line adapter (PIE-1405, PIE-1418): a line field's text laid out whole, then the `w` cells around the
 * cursor, reading as scrolled: a `«` in the first cell where words are off to the left, a `»` in the last where they go
 * on past the right (CP437's, in the VGA font). The start stays in view while the cursor allows, and a click lands on
 * the character under it.
 */
export class LineRow {
  /** The first cell of the line drawn, when it's wider than its field: the line scrolls sideways, never wraps. */
  private scrollX = 0;
  /** The cursor's cell in the last render. */
  cursorCol = 0;
  constructor(private readonly d: Draft) {}

  render(w: number): string {
    const raw = this.d.views.raw, tw = width(this.d.text), room = Math.max(1, w);
    const line = raw.render(Math.max(4, w, tw + 2), 1)[0] ?? "";
    const cursor = raw.cursorCol;
    if (tw + 1 <= room || room < 3) { this.scrollX = 0; this.cursorCol = cursor; return room < 3 ? headOf(line, room) + RESET : line; }
    const last = tw + 1 - room;
    // The cursor in a cell no mark covers: the start while it fits before the » cell, else just inside the marks.
    if (cursor <= room - 2) this.scrollX = 0;
    else if (cursor < this.scrollX + 1) this.scrollX = cursor - 1;
    else if (cursor > this.scrollX + room - 2) this.scrollX = cursor - room + 2;
    this.scrollX = Math.max(0, Math.min(this.scrollX, last));
    this.cursorCol = cursor - this.scrollX;
    const cells = headOf(tailFrom(line, this.scrollX), room) + RESET;
    const left = this.scrollX > 0, right = this.scrollX < last, mark = (m: string) => fg(C.dark) + m + RESET;
    const body = headOf(left ? tailFrom(cells, 1) : cells, room - (left ? 1 : 0) - (right ? 1 : 0)) + RESET;
    return (left ? mark("«") : "") + body + (right ? mark("»") : "");
  }

  /** The source column under cell `x` as last drawn, counted from the first cell shown. */
  posAt(x: number): number { return this.d.views.raw.posAt(x + this.scrollX, 0).col; }
}

/** The UTF-16 column of code point `cp` in `line` (a source column, not a width). */
function utf16Col(line: string, cp: number): number {
  let col = 0, n = 0;
  for (const ch of line) { if (n++ >= cp) break; col += ch.codePointAt(0)! > 0xffff ? 2 : 1; }
  return col;
}

/** How far a line's continuation rows are hung: under the item's text, or the line's own indent; at most half the width. */
export function hangOf(line: string, w: number): number {
  const lead = listLead(line);
  const n = lead ? [...line.slice(0, lead.length)].length : /^[ \t]*/.exec(line)![0].length;
  return Math.min(n, Math.floor(w / 2));
}

/**
 * A line's rows at width `w`: broken after a space where one fits (a word longer than a row is cut), the
 * first row from the left edge and the rest `hang` in. A space a row ends on may sit in the cell past it.
 */
export function wrapRows(chars: readonly string[], w: number, hang: number): { start: number; end: number; indent: number }[] {
  const out: { start: number; end: number; indent: number }[] = [];
  const n = chars.length;
  // Each code point's cells as the row draws it, by glyph (a tab or control as one space; CJK and wide emoji two,
  // a joined emoji's or a combining mark's later code points none), so a row wraps where the screen ends (PIE-510, PIE-1291).
  const cw = codePointCells(chars);
  let s = 0;
  for (;;) {
    const indent = out.length ? hang : 0, room = Math.max(1, w - indent);
    // `e`: the first character past the row's room.
    let e = s, used = 0;
    while (e < n && used + cw[e]! <= room) used += cw[e++]!;
    if (e >= n) { out.push({ start: s, end: n, indent }); return out; }
    // The space just past a full row ends it (drawn in the spare cell); else the last space inside it.
    let b = -1;
    if (chars[e] === " ") b = e + 1;
    else for (let i = e; i > s; i--) if (chars[i - 1] === " ") { b = i; break; }
    // Never a first row of only the item's marker and indent; a word longer than a row is cut (at least one character a row).
    if (b < s + (out.length ? 1 : hang + 1)) b = Math.max(e, s + 1);
    out.push({ start: s, end: b, indent });
    s = b;
  }
}
