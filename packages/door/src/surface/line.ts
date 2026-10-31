// The one line field (PIE-1290): every place a person types one line (the power bar, a rename, a search, a filter, a
// property's value, a picker's line, a form's field) is this, a one-row Draft with the line editor's keys
// (`editorLineKey`): typing, a paste (whole, its line breaks as spaces), backspace and delete by grapheme, ← → home end
// (shift selects), ctrl+a ctrl+e, ctrl+u, ctrl+w and alt+backspace (the word before), ctrl+k, ctrl+x (cut), ctrl+z
// ctrl+y (undo, redo), cmd+c (copy), and the mouse: a click places the cursor, a drag selects, a double click a word,
// a triple the line. Enter, esc, tab, ↑ ↓ and the rest stay the caller's (`take` answers false for them).
import { Draft } from "../edit";
import { INPUT_CURSOR, paint, bg, C, fg, headOf, RESET, tailFrom, width } from "../style";
import type { Key } from "../term";
import type { Actor } from "../socket";
import { USER } from "../socket";
import { editorLineKey } from "./editor";
import { Gesture, isCopyKey, rowsOf, wordAt } from "./selection";
import { lineCompletionHooks, type LineCompletion } from "./line-hooks";
import { clampToGraphemeStart } from "@ep0ch/outline-core/graphemes";

export { lineCompletionHooks, type LineCompletion };

/** The ctrl keys a line takes; any other ctrl key is the caller's (a screen's ctrl+n, ctrl+s). */
const LINE_CTRL = new Set(["a", "e", "k", "u", "w", "x", "z", "y"]);
const LINE_KEYS = new Set<Key["kind"]>(["char", "paste", "backspace", "delete", "left", "right", "home", "end", "alt-backspace"]);

export class LineField extends Draft {
  completed?: (item: import("./completer").CompletionItem) => void;
  /** Prefilled (a layout's own name): shown lit, the first key typed replaces it, ⏎ keeps it. */
  private fresh: boolean;
  /**
   * The line completes by default (PIE-626: one attachment point, no per-screen code): `{ complete: false }` opts out
   * (a name, a path), `{ complete: { grammar: "filter" } }` completes a filter's words. Drawing the popup is the
   * screen's (`completionOf`, `renderCompletion`).
   */
  readonly complete: LineCompletion;
  /** The connection it completes from, the door's at the time it was made; none (a test's line) never completes. */
  readonly completionHost: object | null;
  /** Where its text was last drawn on the screen (`drawnAt`): a click there is the field's. */
  private at: { x: number; y: number; w: number } | null = null;
  private readonly gesture = new Gesture();
  /** What a cut or copy does with its text: the door's clipboard unless the field says otherwise (a masked answer). */
  copy: (text: string) => void = text => lineCompletionHooks.copy?.(text);

  constructor(text = "", prefilled = false, o: { complete?: LineCompletion; id?: string } = {}) {
    super(o.id ?? "line", 0, text.replace(/\r\n?|\n/g, " "));
    this.fresh = prefilled && !!text;
    if (this.fresh) { this.place(0, 0); this.place(0, this.text.length, true); }
    this.complete = o.complete ?? {};
    this.completionHost = this.complete === false ? null : lineCompletionHooks.ambient?.() ?? null;
  }

  /** The cursor, in UTF-16 units from the line's start. */
  get cursor(): number { return this.col; }

  /** Make the line `text` (the cursor at its end), as one undoable change: esc clearing a filter, an agent's line. */
  set(text: string, by: Actor = USER) { this.fresh = false; this.splice(0, this.text.length, text.replace(/\r\n?|\n/g, " "), {}, by); }

  /**
   * A key for the line: true when it took it (typed, erased, moved, undone), false when it's the caller's (⏎, esc,
   * ↑ ↓, tab, another screen's ctrl key). An open completion popup takes ↑ ↓ ⏎ tab and esc first, and follows the
   * typing after.
   */
  take(k: Key): boolean {
    if (k.kind === "mouse") return this.mouse(k);
    const h = lineCompletionHooks;
    if (!this.completionHost || !h.before || !h.after) return this.edit(k);
    if (h.before(this, k)) return true;
    const was = this.text, took = this.edit(k);
    h.after(this, k, took, was);
    return took;
  }

  private edit(k: Key): boolean {
    if (isCopyKey(k) || (k.kind === "alt" && k.ch === "c")) {
      const text = this.selectedText();
      if (!text) return false;
      this.copy(text); return true;
    }
    if (k.kind === "char" && k.ctrl) {
      if (!LINE_CTRL.has(k.ch)) return false;
      this.fresh = false;
      if (k.ch === "z" || k.ch === "y") { this.history(k.ch === "y" || !!k.shift ? "redo" : "undo"); return true; }
      if (k.ch === "a" || k.ch === "e" || k.ch === "k") { this.key(k); return true; }
      return editorLineKey(this, k, this.copy);
    }
    if (!LINE_KEYS.has(k.kind)) return false;
    if (k.kind === "paste" && !k.text) return false;   // an empty paste (only a picture on the clipboard) is the caller's
    this.fresh = false;
    return editorLineKey(this, k, this.copy);
  }

  /** ctrl+z, ctrl+y: the line's own history (`Draft.undo`), and nothing to take back is said, never thrown. */
  history(op: "undo" | "redo", by: Actor = USER): string {
    try { return op === "undo" ? this.undo(by) : this.redo(by); }
    catch (e) { return this.note = e instanceof Error ? e.message : String(e); }
  }

  /** Where `show` was just drawn on the screen (`x`, `y`: its first cell), so the mouse reaches it. */
  drawnAt(x: number, y: number, w: number) { this.at = { x, y, w }; }

  /**
   * A mouse report: a press on the drawn text places the cursor (a double click selects a word, a triple the line), a
   * drag from there selects, the release copies a mouse selection when copy on select is on. False when it isn't on
   * the field (and no press of its is held).
   */
  mouse(k: Extract<Key, { kind: "mouse" }>, at = this.at): boolean {
    if (!at) return false;
    const x = k.x - at.x, inside = k.y === at.y && x >= 0 && x < at.w;
    if (k.action === "down" && k.button !== 2 && inside) {
      this.fresh = false;
      // Snapped to a grapheme's start: a click on an accent or an emoji's joiner never lands inside the character.
      const n = this.gesture.press(k.x, k.y), col = clampToGraphemeStart(this.text, this.posAt(x, 0).col);
      this.place(0, col);
      if (n > 1) {
        const cs = [...this.text], cp = [...this.text.slice(0, this.col)].length;
        const word = wordAt(rowsOf([this.text]), { row: 0, col: cp });
        this.place(0, n === 3 ? 0 : cs.slice(0, word.start.col).join("").length);
        this.place(0, n === 3 ? this.text.length : cs.slice(0, word.end.col + 1).join("").length, true);
      }
      return true;
    }
    if (!this.gesture.pressed) return false;
    if (k.action === "drag") { if (this.gesture.drag(k.x, k.y)) this.place(0, clampToGraphemeStart(this.text, this.posAt(x, 0).col), true); return true; }
    if (k.action === "up") { if (this.gesture.release(k.x, k.y).copy) { const t = this.selectedText(); if (t) this.copy(t); } return true; }
    return false;
  }

  /** The first cell of the line drawn, when it's wider than its field: the line scrolls sideways, never wraps. */
  private scrollX = 0;

  /**
   * One row (PIE-1405, PIE-1418): the line laid out whole, then the `w` cells around the cursor, reading as scrolled: a `«`
   * in the first cell where words are off to the left, a `»` in the last where they go on past the right (CP437's, in the
   * VGA font). The start stays
   * in view while the cursor allows, and a click lands on the character under it. Wrapped, a long query at 40 columns drew
   * only its last wrapped piece ("› swap"). More rows: the draft's own wrapping.
   */
  override render(w: number, h: number): string[] {
    if (h !== 1) { this.scrollX = 0; return super.render(w, h); }
    const tw = width(this.text), room = Math.max(1, w);
    const line = super.render(Math.max(4, w, tw + 2), 1)[0] ?? "";
    if (tw + 1 <= room || room < 3) { this.scrollX = 0; return [room < 3 ? headOf(line, room) + RESET : line]; }
    const cursor = this.cursorCol, last = tw + 1 - room;
    // The cursor in a cell no mark covers: the start while it fits before the » cell, else just inside the marks.
    if (cursor <= room - 2) this.scrollX = 0;
    else if (cursor < this.scrollX + 1) this.scrollX = cursor - 1;
    else if (cursor > this.scrollX + room - 2) this.scrollX = cursor - room + 2;
    this.scrollX = Math.max(0, Math.min(this.scrollX, last));
    this.cursorCol = cursor - this.scrollX;
    const cells = headOf(tailFrom(line, this.scrollX), room) + RESET;
    const left = this.scrollX > 0, right = this.scrollX < last, mark = (m: string) => fg(C.dark) + m + RESET;
    const body = headOf(left ? tailFrom(cells, 1) : cells, room - (left ? 1 : 0) - (right ? 1 : 0)) + RESET;
    return [(left ? mark("«") : "") + body + (right ? mark("»") : "")];
  }

  /** The source place under a cell as last drawn: on one row, counted from the first cell shown (every caller's click). */
  override posAt(x: number, y: number): { row: number; col: number } { return super.posAt(x + this.scrollX, y); }

  /** The text with ▌ where the cursor is, uncoloured (a status line's part). */
  plain(): string { return this.text.slice(0, this.col) + INPUT_CURSOR + this.text.slice(this.col); }

  /**
   * The line and its cursor in `w` cells, as the draft draws it (the cursor a lit cell, a selection lit), the part
   * with the cursor in view. A prefilled line shows lit, saying ⏎ keeps it.
   */
  show(w: number): string {
    if (this.fresh) return `${bg(C.blue)}${fg(C.white)}${this.text}${RESET}${paint(`|07${INPUT_CURSOR} |08⏎ keeps it, typing replaces it`)}`;
    // One cell kept for the cursor after the last character (the draft draws it there).
    return this.render(Math.max(1, w - 1), 1)[0] ?? "";
  }
}

/** A line that filters a list: plain words, no outline-text completion (ListView.startTyping). */
export const filterLine = (was: string) => new LineField(was, false, { complete: false });
