// One line of typed text with a cursor (PIE-516's small parts): a property's value, a filter, a search, a layout's
// name. Its keys are the line editor's everywhere: typing, backspace, delete, ← →, home end (ctrl+a ctrl+e), ctrl+u.
// Enter, esc and the rest stay the caller's.
import { bg, C, fg, INPUT_CURSOR, paint, RESET } from "../style";
import type { Key } from "../term";

export class LineInput {
  cursor: number;
  /** Prefilled (a layout's own name): the first key typed replaces it, ⏎ keeps it. */
  private fresh: boolean;
  constructor(public text = "", prefilled = false) { this.cursor = [...text].length; this.fresh = prefilled && !!text; }

  /** A key for the line: true when it took it (typed, erased or moved), false when it's the caller's (⏎, esc, ↑ ↓…). */
  key(k: Key): boolean {
    const cs = [...this.text], at = this.cursor;
    const set = (t: string[], c: number) => { this.text = t.join(""); this.cursor = c; this.fresh = false; return true; };
    if (k.kind === "char" && k.ctrl) {
      if (k.ch === "a") return set(cs, 0);
      if (k.ch === "e") return set(cs, cs.length);
      if (k.ch === "u") return set([], 0);
      return false;
    }
    if (k.kind === "char") {
      if (this.fresh) return set([...k.ch], [...k.ch].length);
      return set([...cs.slice(0, at), ...k.ch, ...cs.slice(at)], at + [...k.ch].length);
    }
    if (k.kind === "backspace") return this.fresh ? set([], 0) : set([...cs.slice(0, Math.max(0, at - 1)), ...cs.slice(at)], Math.max(0, at - 1));
    if (k.kind === "delete") return set([...cs.slice(0, at), ...cs.slice(at + 1)], at);
    if (k.kind === "left") return set(cs, Math.max(0, at - 1));
    if (k.kind === "right") return set(cs, Math.min(cs.length, at + 1));
    if (k.kind === "home") return set(cs, 0);
    if (k.kind === "end") return set(cs, cs.length);
    return false;
  }

  /** The text with ▌ where the cursor is, uncoloured (a status line's part). */
  plain(): string { const cs = [...this.text]; return cs.slice(0, this.cursor).join("") + INPUT_CURSOR + cs.slice(this.cursor).join(""); }

  /**
   * The text and its cursor, at most `w` characters, scrolled so the cursor shows: `bar` puts the ▌ cursor in the
   * text (a prefilled line shows lit, saying ⏎ keeps it); `block` lights the character under it (a property value).
   */
  show(w: number, look: "bar" | "block" = "bar"): string {
    if (this.fresh) return `${bg(C.blue)}${fg(C.white)}${this.text}${RESET}${paint(`|07${INPUT_CURSOR} |08⏎ keeps it, typing replaces it`)}`;
    const cs = [...this.text], start = Math.max(0, this.cursor - w + 2), shown = cs.slice(start, start + w - 1), at = this.cursor - start;
    const before = shown.slice(0, at).join(""), after = shown.slice(at);
    if (look === "block") return fg(C.white) + before + bg(C.lcyan) + fg(C.black) + (after[0] ?? " ") + RESET + fg(C.white) + after.slice(1).join("");
    return fg(C.white) + before + fg(C.grey) + INPUT_CURSOR + fg(C.white) + after.join("") + RESET;
  }
}
