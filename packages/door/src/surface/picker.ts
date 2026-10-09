// A list to pick from, as a mode (src/surface/modes.ts): the desk's layout picker, policy panel and search, the
// board's hub picker, mover and steps, a reader's status choice. It holds every key while open: ↑ ↓ (j k when
// nothing is typed), Tab, Home End, PgUp PgDn and the wheel move the cursor (a RowView); ⏎ or a double click on a row
// chooses (a click moves the cursor there, RowView.press; in a menu, `clickChooses`, it chooses), and puts it away unless it
// `stays`; esc, a closing letter or a click outside puts it away. A heading row (a menu's group) chooses nothing. Put away, it has
// `ended` (its mode stack lets it go). A line typed above the list is a LineInput.
import type { Canvas, Rect } from "../canvas";
import { RowView } from "../scroll";
import { bg, C, fg, pad, RESET, selected } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { LineInput } from "./line";
import type { Mode } from "./modes";

/** Its box, title and foot, lines above and below the list, and lines beside a list `w` wide (the search's preview). */
export interface PickerFrame { rect: Rect; title: string; foot: string; head?: string[]; tail?: string[]; side?: { w: number; lines: string[] } }

/** How a picker was put away: esc, one of its closing letters (q), or a click outside it. */
export type PickerClose = "esc" | "letter" | "click";

export interface PickerSpec<T, H> {
  name: string;
  items(): readonly T[];
  /** An item's rows, `w` cells wide; `on`: the cursor is on it (`pickRow` lights it). */
  row(it: T, i: number, on: boolean, w: number): string[];
  choose(it: T, i: number, host: H): void;
  /** It stays open after a choice (the policy panel, the steps). */
  stays?: boolean;
  /** A row drawn above an item (a menu's group): never lit, and a click on it chooses nothing. */
  heading?(it: T, i: number, w: number): string | null;
  /** A click chooses the row it's on, at once (a menu), instead of moving the cursor there first. */
  clickChooses?: boolean;
  /** Put away by esc, a closing letter or a click outside (`how`): what else that does. */
  closed?(host: H, how: PickerClose): void;
  /** Keys and clicks of its own before the list's (the steps' x w !, the policy's h l + - and containers). */
  keys?(k: Key, host: H): boolean;
  clicked?(x: number, y: number, host: H): boolean;
  /** Letters that put it away besides esc; `wraps`: ↑ at the top goes round to the bottom. */
  closers?: string;
  wraps?: boolean;
  /** A line typed above the list (its keys go there; the list moves on ↑ ↓ only), and what runs when it changed. */
  input?: LineInput;
  typed?(host: H): void;
  /** Its frame, for `n` items in `area`. */
  frame?(area: Rect, n: number): PickerFrame;
}

export class ListPicker<T, H> implements Mode<H> {
  sel = 0;
  readonly view = new RowView();
  /** Where the last draw put each item's rows (screen rows), and the box. */
  private hits: { y: number; i: number }[] = [];
  private box: Rect | null = null;
  /** Rows an item takes (as last drawn), and the list's width when something is drawn beside it. */
  private per = 1;
  private listW = Infinity;
  private done = false;
  constructor(readonly spec: PickerSpec<T, H>) {}

  ended() { return this.done; }
  /** Put it away, as esc does (or `how` it was). */
  close(host: H, how: PickerClose = "esc") { this.spec.closed?.(host, how); this.done = true; }

  get name() { return this.spec.name; }
  get items(): readonly T[] { return this.spec.items(); }

  private move(by: number) {
    const n = this.items.length;
    if (!n) return;
    this.sel = this.spec.wraps ? (((this.sel + by) % n) + n) % n : Math.max(0, Math.min(n - 1, this.sel + by));
  }
  private pick(i: number, host: H) {
    const it = this.items[i];
    if (it === undefined) return;
    this.sel = i;
    if (!this.spec.stays) this.done = true;
    this.spec.choose(it, i, host);
  }

  key(k: Key, host: H): boolean {
    if (k.kind === "mouse") {
      if (k.action === "wheel-up" || k.action === "wheel-down") this.move(k.action === "wheel-down" ? 1 : -1);
      else if (k.action === "down") this.clickAt(k, host);
      return true;
    }
    const c = ch(k), input = this.spec.input;
    if (k.kind === "esc") { this.close(host); return true; }
    if (!input && c && this.spec.closers?.includes(c)) { this.close(host, "letter"); return true; }
    if (this.spec.keys?.(k, host)) return true;
    const was = input?.text;
    if (input?.key(k)) { if (input.text !== was) this.spec.typed?.(host); return true; }
    const page = Math.max(1, Math.floor((this.view.room - 1) / this.per));
    if (k.kind === "up" || k.kind === "backtab" || (!input && isUp(k))) this.move(-1);
    else if (k.kind === "down" || k.kind === "tab" || (!input && isDown(k))) this.move(1);
    else if (k.kind === "pgup" || k.kind === "pgdn") this.move(k.kind === "pgdn" ? page : -page);
    else if (k.kind === "home" || k.kind === "end") this.sel = k.kind === "home" ? 0 : Math.max(0, this.items.length - 1);
    else if (k.kind === "enter") this.pick(this.sel, host);
    return true;
  }

  /**
   * A press on a row escalates as the keys do (RowView.press): a click moves the cursor there (as ↑ ↓), a double
   * click chooses it (⏎), as an alt-, ctrl- or middle-click does. A panel that `stays` open has controls for rows:
   * a click changes one. One in its frame is the frame's; one outside puts it away.
   */
  private clickAt(k: Extract<Key, { kind: "mouse" }>, host: H) {
    const { x, y } = k;
    const r = this.box, hit = r && x > r.col && x < Math.min(r.col + r.cols - 1, r.col + 1 + this.listW) ? this.hits.find(h => h.y === y) : undefined;
    if (!r) return;                                          // never drawn (the reader's status choice): not its click
    // A panel that stays open (the policy rows, the steps) has controls for rows: a click on one is its change.
    if (hit) { const g = this.spec.stays || this.spec.clickChooses ? "open" : this.view.press(hit.i, { mods: k.mods ?? 0, button: k.button }); if (g === "open" || g === "fresh") this.pick(hit.i, host); else this.sel = hit.i; }
    else if (!this.spec.clicked?.(x, y, host) && (!r || x < r.col || x >= r.col + r.cols || y < r.row || y >= r.row + r.rows)) this.close(host, "click");
  }

  /** The list's rows in `h` rows of `w` cells, the cursor's item in view; `at` is the screen row the first is drawn on. */
  lines(w: number, h: number, at = 0): string[] {
    const items = this.items;
    this.sel = Math.max(0, Math.min(this.sel, items.length - 1));
    const rows: { text: string; i: number; inert?: true }[] = [];
    let first = 0, last = 0;
    items.forEach((it, i) => {
      const head = this.spec.heading?.(it, i, w);
      if (i === this.sel) first = rows.length;
      if (head != null) rows.push({ text: head, i, inert: true });
      for (const text of this.spec.row(it, i, i === this.sel, w)) rows.push({ text, i });
      if (i === this.sel) last = rows.length - 1;
    });
    const top = this.view.place(items.length ? this.sel : null, rows.length, h, [first, last]);
    const shown = rows.slice(top, top + h);
    // An item cut off at the bottom isn't shown in part (the mover's lane without what moving there would patch).
    const cut = shown.at(-1)?.i;
    if (cut !== undefined && rows[top + h]?.i === cut && shown[0]!.i !== cut) while (shown.at(-1)?.i === cut) shown.pop();
    this.per = Math.max(1, rows.length / Math.max(1, items.length));
    this.hits = shown.flatMap((r, j) => (r.inert ? [] : [{ y: at + j, i: r.i }]));
    return shown.map(r => r.text);
  }

  /** Drawn in its frame over the screen. */
  draw(canvas: Canvas, area: Rect) {
    const f = this.spec.frame!(area, this.items.length), r = (this.box = f.rect), w = r.cols - 2, head = f.head ?? [], tail = f.tail ?? [];
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + f.title, fg(C.dark) + f.foot);
    head.forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, w));
    const room = Math.max(0, r.rows - 2 - head.length - tail.length), y0 = r.row + 1 + head.length;
    const side = f.side, list = this.lines(side?.w ?? w, room, y0);
    this.listW = side?.w ?? Infinity;
    for (let i = 0; i < (side ? room : list.length); i++) {
      canvas.text(r.col + 1, y0 + i, side ? (list[i] ?? " ".repeat(side.w)) + fg(C.blue) + " │ " + RESET + (side.lines[i] ?? "") : list[i]!, w);
    }
    tail.forEach((l, i) => canvas.text(r.col + 1, r.row + r.rows - 1 - tail.length + i, l, w));
  }
}

/** A box `w` by `h` over the screen: centred across, a third of the way down. */
export const centred = (a: Rect, w: number, h: number): Rect => ({ col: Math.floor((a.cols - w) / 2), row: Math.floor((a.rows - h) / 3), cols: w, rows: h });

/**
 * One line to type in a box over the screen (a layout's name, a new outline's name, a file): the line, then the one
 * row that does it once something is typed (`doing` says what), so ⏎ or a click on that row runs `done`.
 */
export function linePrompt<H>(o: { name: string; title: string; text: string; prefilled?: boolean; doing: (t: string) => string; hint?: (t: string) => { text: string; warn?: boolean }; done: (t: string, host: H) => void; head?: string[]; w?: number }): ListPicker<string, H> {
  const input = new LineInput(o.text, o.prefilled ?? true, { complete: false });   // a name or a path, never outline text
  return new ListPicker<string, H>({
    name: o.name, input, items: () => { const t = input.text.trim(); return t && !o.hint?.(t).warn ? [o.doing(t)] : []; },
    row: (it, _i, on, w) => [pickRow(` ${it}`, on, w)],
    choose: (_it, _i, host) => o.done(input.text.trim(), host),
    frame: a => { const w = Math.min(o.w ?? 70, a.cols - 4), head = o.head ?? [], h = o.hint?.(input.text.trim());
      // The hint under the input: dim, or in the warning colour when what's typed can't be used (⏎ then does nothing, so the prompt stays).
      const hintLine = h ? [fg(h.warn ? C.yellow : C.dark) + " " + h.text + RESET] : [];
      return { rect: centred(a, w, 4 + head.length + hintLine.length), title: o.title, foot: "⏎ or a click · esc closes", head: [" " + input.show(w - 4), ...hintLine, ...head] }; },
  });
}

/** A row in the picker's colours: lit when the cursor is on it, else in `ink`. */
export const pickRow = (text: string, on: boolean, w: number, ink: number = C.grey) => (on ? selected() : fg(ink)) + pad(text, w) + RESET;
