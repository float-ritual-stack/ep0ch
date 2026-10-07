// One line of typed text with a cursor (PIE-516's small parts): a property's value, a filter, a search, a layout's
// name. Its keys are the line editor's everywhere: typing, backspace, delete, ← →, home end (ctrl+a ctrl+e), ctrl+u.
// Enter, esc and the rest stay the caller's.
import { bg, C, fg, INPUT_CURSOR, paint, RESET } from "../style";
import type { Key } from "../term";
import type { Actor } from "../socket";

/**
 * What a line completes (PIE-626): by default outline text, as a draft does (`[[` `((` `[file::`, a callout, a `[key::`);
 * `grammar: "filter"` a `key:value` filter's words; `valueKey` the value of that property (the panel's field); `false`
 * names, paths and plain queries, which aren't outline text.
 */
export type LineCompletion = false | { grammar?: "text" | "filter"; valueKey?: string };

/**
 * The completer's side of every line (src/surface/completer.ts sets these when it loads, so this file stays small):
 * the connection a line made while the door runs belongs to, and what happens around its keys.
 */
export const lineCompletionHooks: {
  ambient?: () => object | null;
  before?: (i: LineInput, k: Key) => boolean;
  after?: (i: LineInput, k: Key, took: boolean, text: string) => void;
} = {};

export class LineInput {
  cursor: number;
  /** Prefilled (a layout's own name): the first key typed replaces it, ⏎ keeps it. */
  private fresh: boolean;
  /**
   * The line completes by default (PIE-626: one attachment point, no per-screen code): `{ complete: false }` opts out
   * (a name, a path), `{ complete: { grammar: "filter" } }` completes a filter's words. Drawing the popup is the
   * screen's (`completionOf`, `renderCompletion`).
   */
  readonly complete: LineCompletion;
  /** The connection it completes from, the door's at the time it was made; none (a test's line) never completes. */
  readonly completionHost: object | null;
  /** The note it's written about: completion searches from there. */
  near?: string;
  constructor(public text = "", prefilled = false, o: { complete?: LineCompletion } = {}) {
    this.cursor = [...text].length; this.fresh = prefilled && !!text;
    this.complete = o.complete ?? {};
    this.completionHost = this.complete === false ? null : lineCompletionHooks.ambient?.() ?? null;
  }

  // The completer reads a line as it reads a draft (src/surface/completer.ts, CompletionField): one row of text.
  get lines(): string[] { return [this.text]; }
  readonly row = 0;
  /** The cursor as a UTF-16 offset in the text, as a draft's column is. */
  get col(): number { return [...this.text].slice(0, this.cursor).join("").length; }
  readonly busy = false;
  note = "";
  /** A chosen completion: `[start,end)` of the text becomes `text`, the cursor after it. */
  splice(start: number, end: number, text: string, _lines: Record<number, string> = {}, _by?: Actor) {
    const head = this.text.slice(0, start) + text;
    this.text = head + this.text.slice(end);
    this.cursor = [...head].length;
    this.fresh = false;
  }

  /**
   * A key for the line: true when it took it (typed, erased or moved), false when it's the caller's (⏎, esc, ↑ ↓…).
   * An open completion popup takes ↑ ↓ ⏎ tab and esc first, and follows the typing after.
   */
  key(k: Key): boolean {
    const h = lineCompletionHooks;
    if (!this.completionHost || !h.before || !h.after) return this.edit(k);
    if (h.before(this, k)) return true;
    const was = this.text, took = this.edit(k);
    h.after(this, k, took, was);
    return took;
  }

  private edit(k: Key): boolean {
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
