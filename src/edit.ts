// An in-place draft of one block's whole text: subject line, body and [key::value] properties together,
// so a save never drops anything the reader didn't show. The service decides conflicts: a save carries
// the revision the draft started from, and a stale one is refused, never overwritten.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./board";
import { actorIdOf, USER, type Actor } from "./socket";
import { stateDir } from "./state";
import { bg, C, fg, RESET } from "./style";
import type { Key } from "./term";

export type DraftAction = "keep" | "save" | "editor" | "reload" | "close";

export class Draft {
  lines: string[];
  row = 0;
  col = 0;
  private top = 0;
  /** The screen row of the cursor in the last render (the completion popup opens under it). */
  cursorRow = 0;
  /** The text the draft started from, to tell whether anything changed. */
  private original: string;
  /** Another writer changed the block after the draft opened (seen through an outline event). */
  changedElsewhere = false;
  /** The service refused the last save; the draft is kept as typed. */
  conflict: string | null = null;
  /** Where the draft was copied when the service refused it. */
  savedCopy: string | null = null;
  saving = false;
  /** A save is asking the service how it will read the draft's properties; the draft holds still meanwhile. */
  previewing = false;
  /** The text a "this save changes properties" warning was shown for; saving that same text again goes ahead. */
  propertyWarned: string | null = null;
  private discardArmed = false;
  note = "";

  /**
   * Who changed the text since the draft opened (each once, in the order they first did), and who changed
   * it last: the person's keys and $EDITOR, or an agent's `edit.text` / `comment.write`. A save is recorded
   * by who wrote it (`recordAs`), and an agent replacing someone else's typing copies it out first.
   */
  writers: Actor[] = [];
  lastWriter: Actor | null = null;

  /** The note's properties when the draft opened, as the service parsed them, to report what a save changed. */
  baseProps: Record<string, string>;

  constructor(readonly blockId: string, public base: number, text: string, props: Record<string, string> = {}) {
    this.baseProps = props;
    this.original = text;
    this.lines = text.split("\n");
    this.row = 0;
    this.col = this.lines[0]!.length;
  }

  get text() { return this.lines.join("\n"); }
  get dirty() { return this.text !== this.original; }
  /** A save is under way (checking properties, or writing): nothing may change or close the draft. */
  get busy() { return this.saving || this.previewing; }

  /** `who` changed the text. */
  wrote(who: Actor) {
    const { with: _, ...me } = who;
    this.lastWriter = me as Actor;
    if (!this.writers.some(w => sameParty(w, who))) this.writers.push(me as Actor);
  }

  /**
   * Who a save by `saver` is recorded as. One party wrote every change since the draft opened: them,
   * whoever presses save. Several did: the saver, naming the others (`with`), so neither is left out.
   */
  recordAs(saver: Actor): Actor {
    if (this.writers.length === 1) return this.writers[0]!;
    if (!this.writers.length) return saver;
    const others = this.writers.filter(w => !sameParty(w, saver)).map(actorIdOf);
    const { with: _, ...me } = saver;
    return { ...(me as Actor), with: others };
  }

  /** Start over from the block as it is now. The typed draft is dropped (a refused one was already copied out). */
  rebase(m: Msg) {
    this.base = m.revision ?? this.base;
    this.baseProps = m.props;
    this.original = m.text;
    this.lines = m.text.split("\n");
    this.row = Math.min(this.row, this.lines.length - 1);
    this.col = Math.min(this.col, this.lines[this.row]!.length);
    this.changedElsewhere = false;
    this.conflict = null;
    this.writers = []; this.lastWriter = null;
    this.note = "reloaded the current text";
  }

  /** Replace the text wholesale ($EDITOR came back, or an agent sent it). The base revision stays: the service still judges it. */
  replace(text: string, by: Actor = USER) {
    const before = this.text;
    this.lines = text.replace(/\n$/, "").split("\n");
    if (this.text !== before) this.wrote(by);
    this.row = Math.min(this.row, this.lines.length - 1);
    this.col = Math.min(this.col, this.lines[this.row]!.length);
  }

  /**
   * A chosen completion: `[start,end)` of the cursor's line becomes `text` and the cursor lands after it;
   * `lines` first replaces other whole lines (a heading given a fragment anchor). One change, by `by`.
   */
  splice(start: number, end: number, text: string, lines: Record<number, string> = {}, by: Actor = USER) {
    const before = this.text;
    for (const [i, l] of Object.entries(lines)) if (this.lines[Number(i)] !== undefined) this.lines[Number(i)] = l;
    const line = this.line;
    this.lines[this.row] = line.slice(0, start) + text + line.slice(end);
    this.col = start + text.length;
    this.discardArmed = false;
    this.note = "";
    if (this.text !== before) this.wrote(by);
  }

  /** Write the draft next to the door's state so a refused save can't lose it. */
  copyOut(label = this.blockId.slice(0, 8)): string {
    const dir = join(stateDir(), "drafts");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    writeFileSync(path, this.text + "\n");
    this.savedCopy = path;
    pruneDrafts(dir, path);
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
      if (k.ch === "k") { if (this.col < this.line.length) { this.lines[this.row] = this.line.slice(0, this.col); this.wrote(USER); } return "keep"; }
      return "keep";
    }
    if (k.kind === "esc") {
      if (!this.dirty || was) return "close";
      this.discardArmed = true;
      this.note = "unsaved changes · esc again discards · ctrl+s saves";
      return "keep";
    }
    this.note = "";
    const L = this.lines, len = L.length, r0 = this.row, cur = this.line;
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
    // Every keystroke that changes the text makes the person its last writer.
    if (L.length !== len || L[r0] !== cur) this.wrote(USER);
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
    this.cursorRow = cursorAt - this.top;
    return out.slice(this.top, this.top + h);
  }
}

/** The same party: the person, or the same agent. */
export const sameParty = (a: Actor, b: Actor) => a.kind === b.kind && (a.kind === "user" || a.id === (b as { id: string }).id);

const isLow = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
const stepBack = (s: string, i: number) => (i >= 2 && isLow(s, i - 1) ? i - 2 : i - 1);
const stepForward = (s: string, i: number) => (isLow(s, i + 1) ? i + 2 : i + 1);

/** Copies kept in `state/drafts/`: the newest this many, and anything younger than DRAFT_DAYS. */
export const DRAFT_KEEP = 50, DRAFT_DAYS = 30;

/** Drop old draft copies so the folder doesn't grow forever. The copy just written is always kept. */
export function pruneDrafts(dir: string, keep: string, now = Date.now()): string[] {
  let files: { path: string; at: number }[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".md")).map(f => ({ path: join(dir, f), at: statSync(join(dir, f)).mtimeMs }));
  } catch { return []; }
  files.sort((a, b) => b.at - a.at);
  const old = files.filter((f, i) => f.path !== keep && i >= DRAFT_KEEP && now - f.at > DRAFT_DAYS * 86_400_000);
  for (const f of old) { try { rmSync(f.path); } catch { /* best effort */ } }
  return old.map(f => f.path);
}
