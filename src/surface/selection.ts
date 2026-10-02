// Selecting text in a reader (PIE-419): the door keeps terminal mouse reporting on, so the terminal
// can't select for the person; the reader does. One model for every reader: rows of rendered text,
// addressed by content row (so scrolling moves the highlight with the text), a highlight painted over
// the drawn line, a mouse gesture (press, drag, release, double and triple click), the keyboard mode's
// movement keys, and the OSC 52 clipboard write.
//
// Copy on select (Evan's call, Oct 1, reversing the old rule that only `y` copied): a selection made with
// the mouse (a drag, a double click's word, a triple click's row) is copied when the button comes up, by
// the same copy action `y` runs, so cmd+c and a drag behave alike in every reader and in a terminal tile
// running Claude Code. It matches Herdr's `ui.copy_on_select` (on by default). `EP0CH_COPY_ON_SELECT=0`
// turns it off, as Herdr's setting does: the selection stays, and `y`, cmd+c (super+c) or the copy control
// copies it. A plain click selects nothing and copies nothing; a selection made by keys (`v`) is copied by
// `y` or cmd+c; an agent's selection is never the person's clipboard. A copy shows "copied to clipboard"
// over the screen (App.copy), as Herdr's `ui.toast.clipboard` does.
import { ch, isUp, isDown, type Key } from "../term";
import { RESET, tint } from "../style";
import { themed } from "../theme";

/** A cell in rendered rows: `row` in content (not screen) rows, `col` in cells. */
export interface Pos { row: number; col: number }

/** What a selection is over: rendered rows, by content row. */
export interface SelectRows {
  count: number;
  /** The row's visible cells as drawn (colour and link tags taken out). */
  cells(row: number): string[];
  /** Cells at the start of the row that are the reader's margin: drawn, never copied. */
  margin?(row: number): number;
}

// The tints below are the theme's (src/theme.ts): `let`s set again on a theme switch, so every importer draws the new one.
/** The person's selection: calm, readable over any text colour, on the board and under kitty+crt. */
export let SELECT_BG = "";
/** An agent's selection: tinted in the agents' colour, and never the person's. */
export let AGENT_BG = "";
/**
 * The reading ruler (PIE-441, the door side of PIE-423's focus mark): a calm warm tint under the block the
 * reader's current element is in, or that an agent marked. Unlike the selection's blue, the agents'
 * purple, an embed's navy and comment mode's cyan, it's a dim amber, so white, cyan and grey text all
 * stay readable on it.
 */
export let RULER_BG = "";
/** A comment thread's quoted passage while the thread is expanded under it (PIE-420): a quiet olive. */
export let THREAD_BG = "";
themed(() => { SELECT_BG = tint("select"); AGENT_BG = tint("agent"); RULER_BG = tint("ruler"); THREAD_BG = tint("thread"); });

const SGR = /(\x1b\[[\d;]*m)/;
const TAG = /[\u{100000}-\u{10FFFD}]/u;

/** A drawn line's visible cells: one per code point, as `width` counts them. */
export function cellsOf(line: string): string[] {
  const out: string[] = [];
  for (const part of line.split(SGR)) {
    if (!part || part.startsWith("\x1b[")) continue;
    for (const ch of part) if (!TAG.test(ch)) out.push(ch);
  }
  return out;
}

/** Rows made from drawn lines. */
export function rowsOf(lines: readonly string[], margin?: (row: number) => number): SelectRows {
  const cache = new Map<number, string[]>();
  return {
    count: lines.length,
    cells: r => { let c = cache.get(r); if (!c) cache.set(r, c = cellsOf(lines[r] ?? "")); return c; },
    margin,
  };
}

const before = (a: Pos, b: Pos) => a.row < b.row || (a.row === b.row && a.col <= b.col);

export class Selection {
  /**
   * `keys`: made or taken over by the keyboard mode (`v`), whose movement keys move `head`.
   * `w`, `top`: the reader width and header height it was made at; a different layout clears it.
   */
  constructor(public anchor: Pos, public head: Pos, public keys = false, public w = 0, public top = 0) {}

  get start(): Pos { return before(this.anchor, this.head) ? this.anchor : this.head; }
  get end(): Pos { return before(this.anchor, this.head) ? this.head : this.anchor; }

  /** The cells [from, to) of `row` inside the selection (the end cell included), or null. */
  span(row: number, len = Infinity): [number, number] | null {
    const s = this.start, e = this.end;
    if (row < s.row || row > e.row) return null;
    const from = row === s.row ? s.col : 0, to = row === e.row ? e.col + 1 : len;
    return to > from ? [from, to] : null;
  }

  /** The selected text as drawn: rows joined by newlines, each without the margin or trailing blanks. */
  text(rows: SelectRows): string {
    const s = this.start, e = this.end, out: string[] = [];
    for (let r = s.row; r <= e.row && r < rows.count; r++) {
      const cells = rows.cells(r), m = rows.margin?.(r) ?? 0;
      const from = Math.max(m, r === s.row ? s.col : 0), to = Math.min(cells.length, r === e.row ? e.col + 1 : cells.length);
      out.push(to > from ? cells.slice(from, to).join("").trimEnd() : "");
    }
    return out.join("\n");
  }
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Double click: the word under `p` (a run of non-blanks), or the blank run it's in. */
export function wordAt(rows: SelectRows, p: Pos): Selection {
  const cells = rows.cells(p.row), m = rows.margin?.(p.row) ?? 0;
  const col = Math.max(m, Math.min(p.col, cells.length - 1));
  if (col < 0 || col >= cells.length) return new Selection({ ...p }, { ...p });
  const blank = isSpace(cells[col]);
  let a = col, b = col;
  while (a > m && isSpace(cells[a - 1]) === blank) a--;
  while (b + 1 < cells.length && isSpace(cells[b + 1]) === blank) b++;
  return new Selection({ row: p.row, col: a }, { row: p.row, col: b });
}

/** Triple click: the drawn row's text, without the margin, its indent or trailing blanks. */
export function lineAt(rows: SelectRows, row: number): Selection {
  const cells = rows.cells(row), m = rows.margin?.(row) ?? 0;
  let start = m, end = cells.length - 1;
  while (end > m && isSpace(cells[end])) end--;
  while (start < end && isSpace(cells[start])) start++;
  return new Selection({ row, col: start }, { row, col: Math.max(start, end) });
}

/**
 * `line` with its cells [from, to) on `style`'s background. The line's own colours stay: the style is
 * put back after every colour change inside the range, and the line's state is restored after it.
 */
export function paintRange(line: string, from: number, to: number, style: string): string {
  if (to <= from) return line;
  let out = "", col = 0, state = "", inside = false;
  const open = () => { if (!inside && col >= from && col < to) { out += style; inside = true; } };
  const close = () => { if (inside && col >= to) { out += RESET + state; inside = false; } };
  for (const part of line.split(SGR)) {
    if (!part) continue;
    if (part.startsWith("\x1b[")) {
      state = part === RESET || part === "\x1b[m" ? "" : state + part;
      out += part + (inside ? style : "");
      continue;
    }
    for (const ch of part) {
      if (TAG.test(ch)) { out += ch; continue; }
      close(); open();
      out += ch; col++;
    }
  }
  close();
  if (inside) out += RESET + state;
  return out;
}

/** `ESC ] 52 ; c ; <base64> BEL`: the terminal's clipboard, which works over SSH and through Herdr. */
export const osc52 = (text: string) => `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;

/**
 * Whether a mouse selection copies when the button comes up: on unless `EP0CH_COPY_ON_SELECT` is 0, off, no or
 * false (Herdr's `ui.copy_on_select`). Read at each release, so a door started either way can be told apart.
 */
export function copyOnSelect(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.EP0CH_COPY_ON_SELECT?.trim().toLowerCase();
  return !(v === "0" || v === "off" || v === "no" || v === "false");
}

/** The copy key besides `y`: cmd+c (super+c, as the Kitty keyboard protocol reports it). */
export const isCopyKey = (k: Key): boolean => k.kind === "super" && k.ch === "c";

/** A double or triple click is the next press on the same cell within this long. */
const MULTI_MS = 450;

/**
 * One press-drag-release. A press and release on the same cell, with no drag in between, is a click
 * (the reader's old click: follow a link, fold, pick a row); a drag off the cell selects instead.
 */
export class Gesture {
  private down: { x: number; y: number; n: number; moved: boolean } | null = null;
  private last: { x: number; y: number; at: number; n: number } | null = null;

  /** The press: how many clicks it makes on this cell (1, 2 or 3). */
  press(x: number, y: number, now = Date.now()): number {
    const l = this.last;
    const n = l && l.x === x && l.y === y && now - l.at < MULTI_MS ? Math.min(3, l.n + 1) : 1;
    this.last = { x, y, at: now, n };
    this.down = { x, y, n, moved: false };
    return n;
  }

  /** Where the press was, while the button is down. */
  get pressed(): { x: number; y: number; n: number } | null { return this.down; }

  /** A drag event: true once it has left the pressed cell (from then on it selects). */
  drag(x: number, y: number): boolean {
    const d = this.down;
    if (!d) return false;
    if (!d.moved && (x !== d.x || y !== d.y)) { d.moved = true; this.last = null; }
    return d.moved;
  }

  /**
   * The release: a click when it's where the press was, nothing dragged, and not a double or triple click.
   * `copy`: it ended a selection made with the mouse (a drag, a double or triple click) and copy on select is
   * on, so the reader copies what it selected, through its copy action. Never for a plain click.
   */
  release(x: number, y: number): { click: boolean; moved: boolean; n: number; copy: boolean } {
    const d = this.down;
    this.down = null;
    if (!d) return { click: false, moved: false, n: 0, copy: false };
    return { click: !d.moved && d.n === 1 && x === d.x && y === d.y, moved: d.moved, n: d.n, copy: (d.moved || d.n > 1) && copyOnSelect() };
  }

  cancel() { this.down = null; }

  /** The click did something (opened a link, folded): the next press on its cell starts afresh, not a double click. */
  forget() { this.last = null; }
}

/** What a key did in the keyboard mode. */
export type ModeKey = "moved" | "copy" | "source" | "done" | null;

/**
 * The keyboard mode's keys (after `v`): h l ← → a cell, j k ↑ ↓ a row, PgUp PgDn a page, Home End the
 * row's ends move the head; y or cmd+c copies, Y copies the source, v and esc leave. Null: not one of its keys.
 */
export function modeKey(k: Key, s: Selection, rows: SelectRows, page: number): ModeKey {
  const c = ch(k);
  if (c === "y" || isCopyKey(k)) return "copy";
  if (c === "Y") return "source";
  if (c === "v" || k.kind === "esc") return "done";
  const h = s.head, last = Math.max(0, rows.count - 1);
  const len = (r: number) => rows.cells(r).length;
  const m = (r: number) => rows.margin?.(r) ?? 0;
  const clampCol = (r: number, col: number) => Math.max(m(r), Math.min(col, Math.max(m(r), len(r) - 1)));
  const toRow = (r: number) => { const row = Math.max(0, Math.min(last, r)); s.head = { row, col: clampCol(row, h.col) }; };
  if (isDown(k)) toRow(h.row + 1);
  else if (isUp(k)) toRow(h.row - 1);
  else if (k.kind === "pgdn") toRow(h.row + page);
  else if (k.kind === "pgup") toRow(h.row - page);
  else if (k.kind === "right" || c === "l") {
    if (h.col + 1 < len(h.row)) s.head = { row: h.row, col: h.col + 1 };
    else if (h.row < last) s.head = { row: h.row + 1, col: m(h.row + 1) };
  } else if (k.kind === "left" || c === "h") {
    if (h.col > m(h.row)) s.head = { row: h.row, col: h.col - 1 };
    else if (h.row > 0) s.head = { row: h.row - 1, col: clampCol(h.row - 1, Infinity) };
  } else if (k.kind === "home") s.head = { row: h.row, col: m(h.row) };
  else if (k.kind === "end") s.head = { row: h.row, col: clampCol(h.row, Infinity) };
  else return null;
  return "moved";
}

/** The hint while a selection exists. */
export function selectionHint(s: Selection, chars: number): string {
  return s.keys
    ? `selecting ${chars} chars · h j k l move · y cmd+c copy · Y source · esc done`
    : `selected ${chars} chars · y cmd+c copy · Y source · v keys · esc clear`;
}
