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
import { glyphWidth, RESET, tint } from "../style";
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
  /**
   * Cell ranges [from, to) of the row that are drawn decoration inside the text (a quote's or callout's bar,
   * a frame's right edge, a bullet glyph, a fold arrow, a gutter): drawn, never copied. `to` may be Infinity.
   */
  cuts?(row: number): readonly (readonly [number, number, string?])[] | undefined;
  /** A row that is only decoration (a frame's top or bottom edge): left out of a copy, no blank line in its place. */
  edge?(row: number): boolean;
}

/** Cell `col` of `row` is drawn decoration (rows.cuts). */
const isCut = (rows: SelectRows, row: number, col: number): boolean => !!rows.cuts?.(row)?.some(([a, b]) => col >= a && col < b);

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
export function rowsOf(lines: readonly string[], margin?: (row: number) => number, trim?: (row: number) => { cuts: [number, number, string?][]; edge?: true } | undefined): SelectRows {
  const cache = new Map<number, string[]>();
  return {
    count: lines.length,
    cells: r => { let c = cache.get(r); if (!c) cache.set(r, c = cellsOf(lines[r] ?? "")); return c; },
    margin,
    ...(trim ? { cuts: (r: number) => trim(r)?.cuts, edge: (r: number) => !!trim(r)?.edge } : {}),
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
      if (rows.edge?.(r)) continue;
      const cells = rows.cells(r), m = rows.margin?.(r) ?? 0;
      const from = Math.max(m, r === s.row ? s.col : 0), to = Math.min(cells.length, r === e.row ? e.col + 1 : cells.length);
      const cuts = rows.cuts?.(r);
      // A cut with a replacement (a bullet glyph drawn for the note's "- ") gives the replacement once, where its first cell is.
      const kept: string[] = [];
      if (to > from) for (let c = from; c < to; c++) {
        const cut = cuts?.find(([a, b]) => c >= a && c < b);
        if (!cut) kept.push(cells[c]!);
        else if (cut[2] && c === Math.max(cut[0], from)) kept.push(cut[2]);
      }
      out.push(kept.join("").trimEnd());
    }
    return out.join("\n");
  }
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
/** Blank, or drawn decoration (a word or a line doesn't start or end on one). */
const blankAt = (rows: SelectRows, row: number, cells: readonly string[], col: number) => isSpace(cells[col]) || isCut(rows, row, col);

/** Double click: the word under `p` (a run of non-blanks), or the blank run it's in. */
export function wordAt(rows: SelectRows, p: Pos): Selection {
  const cells = rows.cells(p.row), m = rows.margin?.(p.row) ?? 0;
  const col = Math.max(m, Math.min(p.col, cells.length - 1));
  if (col < 0 || col >= cells.length) return new Selection({ ...p }, { ...p });
  const blank = blankAt(rows, p.row, cells, col);
  let a = col, b = col;
  while (a > m && blankAt(rows, p.row, cells, a - 1) === blank) a--;
  while (b + 1 < cells.length && blankAt(rows, p.row, cells, b + 1) === blank) b++;
  return new Selection({ row: p.row, col: a }, { row: p.row, col: b });
}

/** Triple click: the drawn row's text, without the margin, its indent or trailing blanks. */
export function lineAt(rows: SelectRows, row: number): Selection {
  const cells = rows.cells(row), m = rows.margin?.(row) ?? 0;
  let start = m, end = cells.length - 1;
  while (end > m && blankAt(rows, row, cells, end)) end--;
  while (start < end && blankAt(rows, row, cells, start)) start++;
  return new Selection({ row, col: start }, { row, col: Math.max(start, end) });
}

/**
 * `line` with `glyph` (in `style`) in visible cell `col`, when that cell is blank, a rule `─` or past the line's end (then the line is
 * padded to it); else null: the control doesn't cover text. The line's own colours stay for the cells after it.
 */
export function putCell(line: string, col: number, glyph: string, style: string): string | null {
  let out = "", at = 0, state = "";
  for (const part of line.split(SGR)) {
    if (!part) continue;
    if (part.startsWith("\x1b[")) { state = part === RESET || part === "\x1b[m" ? "" : state + part; out += part; continue; }
    for (const c of part) {
      const w = TAG.test(c) ? 0 : glyphWidth(c);
      if (!w) { out += c; continue; }
      // Counted in terminal columns, as the control's place is: a wide character before it moves it, one on it covers text.
      if (col >= at && col < at + w) {
        if (w !== 1 || (c !== " " && c !== "─")) return null;
        out += style + glyph + RESET + state;
      } else out += c;
      at += w;
    }
  }
  if (at > col) return out;
  return out + RESET + " ".repeat(col - at) + style + glyph + RESET;
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
 * The most the door puts on the clipboard at once, in UTF-8 bytes: its own copies and a terminal tile's program's
 * alike (App.copy). Its OSC 52 is under 700 KB, inside tmux's 1 MB limit on one escape sequence.
 */
export const COPY_MAX = 512 * 1024;
/** How recently the person must have typed, pasted or clicked in a terminal tile for its program's copy to reach them. */
export const TILE_COPY_RECENT_MS = 2 * 60_000;
/**
 * A copy the door didn't make: over COPY_MAX (`tooBig` bytes), or a terminal tile's program asking while the person
 * hadn't typed, pasted or clicked in that tile within TILE_COPY_RECENT_MS (`away`: an agent typing into a shell nobody
 * is using can't fill the person's clipboard).
 */
export type Uncopied = { tooBig: number } | { away: true };
/** What the door says about a copy it didn't make (App.copy's toast). */
export const uncopied = (u: Uncopied, from?: string) =>
  `not copied${from ? ` from ${from}` : ""} · ${"away" in u ? `you haven't typed or clicked in it for ${TILE_COPY_RECENT_MS / 60_000} min · click in it, then copy again` : `${Math.ceil(u.tooBig / 1024)} KB is more than the clipboard takes (${COPY_MAX / 1024} KB)`}`;
/** The longest OSC 52 body (`c;<base64>`) a tile's program can send that fits COPY_MAX. */
const OSC52_BODY_MAX = Math.ceil(COPY_MAX / 3) * 4 + 8;
const OSC52_START = "\x1b]52;";

/** What a terminal tile's program put on the clipboard: its text, or how big a write over COPY_MAX was. */
export type Clip = { text: string } | { tooBig: number };

/**
 * A terminal tile's program's clipboard writes (OSC 52), found in what it writes, so the door can pass them on to
 * the person's terminal: the tile's emulator (headless xterm) would swallow them. Only writes: the clipboard `c` or
 * the default one (an empty selection), with a base64 payload. A read (`?`) is dropped, so a program can't read the
 * person's clipboard, and so are other selections, a clear (an empty payload) and bad base64. BEL or ST (`ESC \`)
 * ends one; a sequence cut across the program's writes is held until its end comes. Fed latin1 text (a byte a char).
 */
export class Osc52Reader {
  /** `scan`: looking for one to start; `body`: in one, its payload kept; `skip`: in one too long, only counted. */
  private mode: "scan" | "body" | "skip" = "scan";
  /** The end of what was scanned that could be the start of one (ESC, ESC ], …). */
  private tail = "";
  /** The body so far, in pieces (joined once, at its end: a body that comes a byte at a time stays linear). */
  private parts: string[] = [];
  private size = 0;
  /** The body's first bytes (its selection), kept when one too long is only counted: only the clipboard's is said. */
  private head = "";
  /** The last write ended on an ESC: the next one's first byte says whether it was ST. */
  private esc = false;

  /** Start over (the program's output starts over: a resync). */
  reset() { this.mode = "scan"; this.tail = ""; this.parts = []; this.size = 0; this.head = ""; this.esc = false; }

  feed(chunk: string): Clip[] {
    const out: Clip[] = [];
    let p = 0;
    while (p < chunk.length) {
      if (this.mode === "scan") {
        if (this.tail) {
          // The last write ended on what could be its start: does this one go on with it?
          const t = this.tail, s = t + chunk.slice(p, p + OSC52_START.length - t.length);
          this.tail = "";
          if (s === OSC52_START) { p += OSC52_START.length - t.length; this.open(); continue; }
          if (OSC52_START.startsWith(s)) { this.tail = s; return out; }
        }
        const i = chunk.indexOf(OSC52_START, p);
        if (i < 0) {
          for (let k = Math.min(OSC52_START.length - 1, chunk.length - p); k > 0; k--) if (OSC52_START.startsWith(chunk.slice(chunk.length - k))) { this.tail = chunk.slice(chunk.length - k); break; }
          return out;
        }
        p = i + OSC52_START.length;
        this.open();
        continue;
      }
      if (this.esc) {
        // An ESC ended the last write: `\` makes it ST; anything else cut the sequence off (and starts something else).
        this.esc = false;
        if (chunk[p] === "\\") { this.end(out, true); p += 1; }
        else { this.end(out, false); this.tail = "\x1b"; }
        continue;
      }
      const e = oscEnd(chunk, p);
      const piece = chunk.slice(p, e < 0 ? chunk.length : e);
      this.size += piece.length;
      if (this.mode === "body") {
        if (this.size > OSC52_BODY_MAX) { this.mode = "skip"; this.head = this.parts.join("").slice(0, 2) + piece.slice(0, 2); this.parts = []; }
        else this.parts.push(piece);
      }
      if (e < 0) return out;
      if (chunk[e] === "\x07") { this.end(out, true); p = e + 1; }
      else if (e + 1 >= chunk.length) { this.esc = true; return out; }
      else if (chunk[e + 1] === "\\") { this.end(out, true); p = e + 2; }
      else { this.end(out, false); p = e; }
    }
    return out;
  }

  private open() { this.mode = "body"; this.parts = []; this.size = 0; this.head = ""; this.esc = false; }

  /** The sequence ended: properly (BEL or ST), or cut off by another ESC. */
  private end(out: Clip[], ok: boolean) {
    // One too long is said only when it ended properly and was for the clipboard; one cut off, or another selection's, is dropped.
    if (this.mode === "skip") { if (ok && /^c?;/.test(this.head)) out.push({ tooBig: Math.floor((this.size * 3) / 4) }); }
    else if (ok) { const t = clipText(this.parts.join("")); if (t !== null) out.push({ text: t }); }
    this.mode = "scan"; this.parts = []; this.size = 0; this.head = "";
  }
}

/** Where an OSC from `from` ends: its BEL or the ESC of its ST (or of what cut it off); -1 when not yet. */
function oscEnd(s: string, from: number): number {
  for (let i = from; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 7 || c === 27) return i; }
  return -1;
}

/** An OSC 52 body (`<selection>;<payload>`) as the text to copy, or null when it isn't a write to the clipboard. */
function clipText(body: string): string | null {
  const semi = body.indexOf(";");
  if (semi < 0) return null;
  const sel = body.slice(0, semi), data = body.slice(semi + 1);
  if (sel !== "" && sel !== "c") return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1) return null;
  return Buffer.from(data, "base64").toString("utf8");
}

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
