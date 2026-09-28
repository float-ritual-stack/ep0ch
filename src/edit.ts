// An in-place draft of one block's whole text: subject line, body and [key::value] properties together,
// so a save never drops anything the reader didn't show. The service decides conflicts: a save carries
// the revision the draft started from, and a stale one is refused, never overwritten.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./board";
import { stateDir } from "./state";
import { bg, C, fg, RESET } from "./style";
import type { Key } from "./term";

export type DraftAction = "keep" | "save" | "editor" | "reload" | "close";

export class Draft {
  lines: string[];
  row = 0;
  col = 0;
  private top = 0;
  /** The text the draft started from, to tell whether anything changed. */
  private original: string;
  /** Another writer changed the block after the draft opened (seen through an outline event). */
  changedElsewhere = false;
  /** The service refused the last save; the draft is kept as typed. */
  conflict: string | null = null;
  /** Where the draft was copied when the service refused it. */
  savedCopy: string | null = null;
  saving = false;
  private discardArmed = false;
  note = "";

  constructor(readonly blockId: string, public base: number, text: string) {
    this.original = text;
    this.lines = text.split("\n");
    this.row = 0;
    this.col = this.lines[0]!.length;
  }

  get text() { return this.lines.join("\n"); }
  get dirty() { return this.text !== this.original; }

  /** Start over from the block as it is now. The typed draft is dropped (a refused one was already copied out). */
  rebase(m: Msg) {
    this.base = m.revision ?? this.base;
    this.original = m.text;
    this.lines = m.text.split("\n");
    this.row = Math.min(this.row, this.lines.length - 1);
    this.col = Math.min(this.col, this.lines[this.row]!.length);
    this.changedElsewhere = false;
    this.conflict = null;
    this.note = "reloaded the current text";
  }

  /** Replace the text wholesale ($EDITOR came back). The base revision stays: the service still judges it. */
  replace(text: string) {
    this.lines = text.replace(/\n$/, "").split("\n");
    this.row = Math.min(this.row, this.lines.length - 1);
    this.col = Math.min(this.col, this.lines[this.row]!.length);
  }

  /** Write the draft next to the door's state so a refused save can't lose it. */
  copyOut(): string {
    const dir = join(stateDir(), "drafts");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${this.blockId.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    writeFileSync(path, this.text + "\n");
    this.savedCopy = path;
    return path;
  }

  key(k: Key): DraftAction {
    if (k.kind === "mouse") return "keep";
    const was = this.discardArmed;
    this.discardArmed = false;
    if (k.kind === "char" && k.ctrl) {
      if (k.ch === "s") return "save";
      if (k.ch === "e") return "editor";
      if (k.ch === "r") return "reload";
      if (k.ch === "a") { this.col = 0; return "keep"; }
      if (k.ch === "k") { this.lines[this.row] = this.line.slice(0, this.col); return "keep"; }
      return "keep";
    }
    if (k.kind === "esc") {
      if (!this.dirty || was) return "close";
      this.discardArmed = true;
      this.note = "unsaved changes · esc again discards · ctrl+s saves";
      return "keep";
    }
    this.note = "";
    const L = this.lines;
    switch (k.kind) {
      case "left":
        if (this.col > 0) this.col = stepBack(this.line, this.col);
        else if (this.row > 0) { this.row--; this.col = this.line.length; }
        break;
      case "right":
        if (this.col < this.line.length) this.col = stepForward(this.line, this.col);
        else if (this.row < L.length - 1) { this.row++; this.col = 0; }
        break;
      case "up": this.moveRow(-1); break;
      case "down": this.moveRow(1); break;
      case "pgup": this.moveRow(-15); break;
      case "pgdn": this.moveRow(15); break;
      case "home": this.col = 0; break;
      case "end": this.col = this.line.length; break;
      case "enter": case "alt-enter": {
        const rest = this.line.slice(this.col);
        L[this.row] = this.line.slice(0, this.col);
        L.splice(++this.row, 0, rest);
        this.col = 0;
        break;
      }
      case "backspace":
        if (this.col > 0) {
          const at = stepBack(this.line, this.col);
          L[this.row] = this.line.slice(0, at) + this.line.slice(this.col);
          this.col = at;
        } else if (this.row > 0) {
          const prev = L[this.row - 1]!;
          L[this.row - 1] = prev + this.line;
          L.splice(this.row--, 1);
          this.col = prev.length;
        }
        break;
      case "delete":
        if (this.col < this.line.length) L[this.row] = this.line.slice(0, this.col) + this.line.slice(stepForward(this.line, this.col));
        else if (this.row < L.length - 1) { L[this.row] = this.line + L[this.row + 1]!; L.splice(this.row + 1, 1); }
        break;
      case "tab": this.insert("  "); break;
      case "char": this.insert(k.ch); break;
    }
    return "keep";
  }

  private get line() { return this.lines[this.row]!; }
  private insert(s: string) {
    this.lines[this.row] = this.line.slice(0, this.col) + s + this.line.slice(this.col);
    this.col += s.length;
  }
  private moveRow(d: number) {
    this.row = Math.max(0, Math.min(this.lines.length - 1, this.row + d));
    this.col = Math.min(this.col, this.line.length);
  }

  /** The draft as terminal lines, soft-wrapped at `w`, with the cursor drawn and kept on screen. */
  render(w: number, h: number): string[] {
    const w1 = Math.max(4, w);
    const out: string[] = [];
    let cursorAt = 0;
    this.lines.forEach((line, r) => {
      const chars = [...line];
      // Map the UTF-16 cursor column to a code-point column for display.
      const cursorCp = r === this.row ? [...line.slice(0, this.col)].length : -1;
      const rows = Math.max(1, Math.ceil((chars.length + (r === this.row ? 1 : 0)) / w1));
      for (let i = 0; i < rows; i++) {
        const seg = chars.slice(i * w1, (i + 1) * w1);
        if (cursorCp >= i * w1 && cursorCp < (i + 1) * w1) {
          const c = cursorCp - i * w1;
          cursorAt = out.length;
          out.push(fg(C.white) + seg.slice(0, c).join("") + bg(C.lcyan) + fg(C.black) + (seg[c] ?? " ") + RESET + fg(C.white) + seg.slice(c + 1).join("") + RESET);
        } else {
          out.push(fg(C.white) + seg.join("") + RESET);
        }
      }
    });
    if (cursorAt < this.top) this.top = cursorAt;
    if (cursorAt >= this.top + h) this.top = cursorAt - h + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, out.length - h)));
    return out.slice(this.top, this.top + h);
  }
}

const isLow = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
const stepBack = (s: string, i: number) => (i >= 2 && isLow(s, i - 1) ? i - 2 : i - 1);
const stepForward = (s: string, i: number) => (isLow(s, i + 1) ? i + 2 : i + 1);
