// An in-place draft of one block's whole text: subject line, body and [key::value] properties together,
// so a save never drops anything the reader didn't show. The service decides conflicts: a save carries
// the revision the draft started from, and a stale one is refused, never overwritten.
import { strayKeys } from "./stray";
import { pageTitleLine } from "@ep0ch/outline-core/page-title";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./board";
import { whoOf, USER, type Actor } from "./socket";
import { ActionRefused, actionSet, def, type ArgsOfSet } from "./surface/actions";
import { isCopyKey, SELECT_BG } from "./surface/selection";
import { stateDir } from "./state";
import { bg, C, chip, fg, RESET } from "./style";
import { scrolled } from "./scroll";
import type { Key } from "./term";
import { applyLocated, blockStartAt, locateSpans, mapOffset, markStart, type DraftPatchSpan, type LocatedSpan } from "@ep0ch/outline-core/draft-patch-compare";

/** How long an agent's patch stays lit in the draft, with who made it (ms). */
export const PATCH_FLASH_MS = 2500;
/** How many agent patches a draft keeps for ctrl+z. */
const PATCH_UNDO_KEEP = 20;

/**
 * An agent's patch applied to a draft (PIE-501): one undo unit. Each span is where its replacement sits in
 * the text just after it, with the text it replaced and a little text either side for undo's own compare.
 */
interface PatchUnit { patchId: string; by: Actor; spans: { start: number; text: string; was: string; before: string; after: string }[] }
/** A patch's new text, lit for a moment and labelled with who made it. Offsets are the draft's (UTF-16). */
export interface PatchFlash { start: number; end: number; label: string; until: number }
/** What the service asks a draft to patch (the `draft` event's patch, src/socket.ts DraftRequest). */
export interface DraftPatchRequest { patchId: string; patches: DraftPatchSpan[]; revision: number; mark?: string; force?: boolean }
export type DraftPatchAnswer = { applied: true } | { applied: false; reason: string };

/**
 * What a key in a draft asks its host to do: `close` (esc on nothing changed), `discard` (the second esc on
 * changed text: its session puts it aside as unsent), `copy` (cmd+c: the host runs its draft.copy).
 */
export type DraftAction = "keep" | "save" | "editor" | "pick" | "reload" | "close" | "discard" | "copy";

export class Draft {
  lines: string[];
  row = 0;
  col = 0;
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
  /** ctrl+x was pressed: a ctrl+e next hands the draft to $EDITOR (bash's edit-and-execute chord); any other key lets it go. */
  private ctrlX = false;
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

  /** The note this draft is about (its target's `near`): reference completion searches from there. */
  near?: string;
  /** A note's text (an edit, a new card or note; not a comment): ⏎ on a first line of only `[page::x]` titles it (PIE-544). */
  titlesPages = false;
  /** Agents' patches applied to this draft, newest last: ctrl+z (`draft.undo`) takes back the last one. */
  patches: PatchUnit[] = [];
  /** Where agents' patches just landed, lit until `until`. */
  flashes: PatchFlash[] = [];

  constructor(readonly blockId: string, public base: number, text: string, props: Record<string, string> = {}) {
    this.baseProps = props;
    this.original = text;
    this.lines = text.split("\n");
    this.row = 0;
    this.col = this.lines[0]!.length;
  }

  get text() { return this.lines.join("\n"); }
  get dirty() { return this.text !== this.original; }
  /** The text the draft started from (an unsent edit keeps it: "take it back" replays its changes against the note now). */
  get started() { return this.original; }
  /** When the draft opened. */
  readonly openedAt = Date.now();
  /** Stray characters close it on the first esc: a note's edit the person opened (its session says so), never a comment, a new card or an agent's edit. */
  straysClose = false;
  /**
   * The characters an edit opened by mistake picked up (`strayKeys`: open briefly, a few characters typed, nothing taken
   * out, only by the person, not text brought back), or null. Esc closes it at once, copied but not put aside.
   */
  stray(now = Date.now()): string | null {
    if (!this.straysClose || this.restored !== null || this.writers.some(w => w.kind !== "user")) return null;
    return strayKeys(this.original, this.text, now - this.openedAt);
  }
  /** A save is under way (checking properties, or writing): nothing may change or close the draft. */
  get busy() { return this.saving || this.previewing; }

  /**
   * The person changed the text (never an agent's patch): the reader holding this draft tells the service, so a
   * request line they write here (`@tidy …`) runs once quiet, before any save (`drafts.touch`).
   */
  onPersonTyped: (() => void) | null = null;

  /** `who` changed the text. */
  wrote(who: Actor) {
    if (who.kind === "user") this.onPersonTyped?.();
    const { with: _, ...me } = who;
    this.lastWriter = me as Actor;
    if (!this.writers.some(w => sameParty(w, who))) this.writers.push(me as Actor);
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

  /** The text a put-aside draft was brought back with (its session's restore): esc twice on it unchanged drops it. */
  restored: string | null = null;

  /** Write the draft next to the door's state so a refused save can't lose it. */
  copyOut(label = this.blockId.slice(0, 8)): string {
    return (this.savedCopy = keepCopy(this.text + "\n", label));
  }

  key(k: Key): DraftAction {
    // Whatever comes after ctrl+x lets the chord go (only a ctrl+e right after it is $EDITOR).
    const chord = this.ctrlX;
    if (chord) { this.ctrlX = false; this.note = ""; }
    if (k.kind === "mouse") return "keep";
    // Any key brings the cursor back into view after the wheel scrolled away from it.
    this.follow = true;
    if (k.kind === "paste") { this.pasteText(k.text); return "keep"; }
    // cmd+c copies the selection; it never types, and never ends a put-aside's second esc.
    if (isCopyKey(k)) return "copy";
    if (k.kind === "super") return "keep";
    const was = this.discardArmed;
    this.discardArmed = false;
    if (k.kind === "char" && k.ctrl) {
      if (k.ch === "s") return "save";
      // ctrl+x ctrl+e: $EDITOR. ctrl+e alone is the line's end, as ctrl+a is its start (a Mac's cmd+→ and cmd+←).
      if (k.ch === "x") { this.ctrlX = true; this.note = "ctrl+x · ctrl+e opens $EDITOR"; return "keep"; }
      if (k.ch === "e" && chord) return "editor";
      if (k.ch === "e") { this.anchor = this.goal = null; this.col = this.line.length; return "keep"; }
      if (k.ch === "t") return "pick";
      if (k.ch === "r") return "reload";
      if (k.ch === "p") { void DRAFT_ACTIONS.run("draft.preview", {}, this, USER); return "keep"; }
      if (k.ch === "z") { void DRAFT_ACTIONS.run("draft.undo", {}, this, USER).catch(e => { this.note = e instanceof Error ? e.message : String(e); }); return "keep"; }
      if (k.ch === "a") { this.anchor = this.goal = null; this.col = 0; return "keep"; }
      if (k.ch === "k") { this.anchor = null; if (this.col < this.line.length) { this.lines[this.row] = this.line.slice(0, this.col); this.wrote(USER); } return "keep"; }
      return "keep";
    }
    if (k.kind === "esc") {
      // The first esc lets go of a selection; nothing else.
      if (this.anchor) { this.anchor = null; return "keep"; }
      if (!this.dirty) return "close";
      // An edit opened by mistake (a stray `j` or `q` became text) closes on the first esc: its session drops the strays.
      if (this.stray() !== null) return "discard";
      if (!was) {
        this.discardArmed = true;
        this.note = this.restored === this.text
          ? "esc again drops this unsent draft (a copy stays on disk) · ctrl+s saves"
          : "unsaved · esc again puts it aside as unsent (nothing is lost) · ctrl+s saves";
        return "keep";
      }
      return "discard";
    }
    this.note = "";
    const L = this.lines, len = L.length, r0 = this.row, cur = this.line;
    const typing = k.kind === "char" || k.kind === "enter" || k.kind === "alt-enter" || k.kind === "backspace" || k.kind === "delete";
    // Typing over a selection replaces it; backspace and delete take it away.
    if (typing && this.anchor) {
      const had = this.deleteSelection();
      if (had && (k.kind === "backspace" || k.kind === "delete")) { this.wrote(USER); return "keep"; }
    }
    if (k.kind !== "tab" && k.kind !== "backtab" && k.kind !== "up" && k.kind !== "down" && k.kind !== "pgup" && k.kind !== "pgdn") this.goal = null;
    if (k.kind !== "tab" && k.kind !== "backtab") this.anchor = null;
    switch (k.kind) {
      case "left":
        if (this.col > 0) this.col = stepBack(this.line, this.col);
        else if (this.row > 0) { this.row--; this.col = this.line.length; }
        break;
      case "right":
        if (this.col < this.line.length) this.col = stepForward(this.line, this.col);
        else if (this.row < L.length - 1) { this.row++; this.col = 0; }
        break;
      // Up and down move by the rows drawn (a wrapped line is several), keeping the column they started at.
      case "up": this.moveVisual(-1); break;
      case "down": this.moveVisual(1); break;
      case "pgup": this.moveVisual(-Math.max(1, this.shown.h - 1)); break;
      case "pgdn": this.moveVisual(Math.max(1, this.shown.h - 1)); break;
      case "home": this.col = 0; break;
      case "end": this.col = this.line.length; break;
      // Enter keeps the list going (draft.newline); alt+enter, shift+enter and a pasted line break are plain line breaks.
      case "enter": void DRAFT_ACTIONS.run("draft.newline", { plain: "pasted" in k || ("shift" in k && !!k.shift) }, this, USER); break;
      case "alt-enter": void DRAFT_ACTIONS.run("draft.newline", { plain: true }, this, USER); break;
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
      // Tab and shift+tab indent and outdent the line (or every line the selection touches); a pasted tab is text.
      case "tab":
        if ("pasted" in k) this.insert("\t");
        else void DRAFT_ACTIONS.run("draft.indent", {}, this, USER);
        break;
      case "backtab": void DRAFT_ACTIONS.run("draft.outdent", {}, this, USER); break;
      case "char":
        // A marker typed by hand on an item Enter already started ("- " then "- ") takes the item's place.
        // Pasted text goes in as it came.
        if (k.ch === " " && !k.pasted && this.col === this.line.length) {
          const m = TYPED_MARKER.exec(this.line);
          if (m) { L[this.row] = m[1]! + m[2]!; this.col = L[this.row]!.length; }
        }
        this.insert(k.ch);
        break;
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

  /** Pasted text goes in as it came: no list continuation, no indenting, tabs kept. */
  pasteText(text: string, by: Actor = USER) {
    if (this.anchor) this.deleteSelection();
    this.anchor = null; this.goal = null;
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    const line = this.line, head = line.slice(0, this.col), tail = line.slice(this.col);
    if (parts.length === 1) { this.lines[this.row] = head + parts[0] + tail; this.col += parts[0]!.length; }
    else {
      const last = parts.at(-1)!;
      this.lines.splice(this.row, 1, head + parts[0], ...parts.slice(1, -1), last + tail);
      this.row += parts.length - 1;
      this.col = last.length;
    }
    if (text) this.wrote(by);
  }

  // ── lists: Enter keeps the level, Tab and Shift+Tab move it ────────────────

  /**
   * A line break at the cursor. On a list item (`-`, `*`, `+`, `1.`, `1)`, with or without `[ ]`, at any
   * indent) the next line starts at the same indent with the next marker; on an empty item it goes up a
   * level instead, and at the top level the list ends (the marker goes). An indented line keeps its indent.
   * `plain`: just the break (alt+enter, a pasted line).
   */
  newline(plain = false) {
    if (this.anchor) this.deleteSelection();
    this.anchor = null;
    // ⏎ at the end of a first line of only `[page::x]` titles it `x` (PIE-544), outline-core's rule, the one the service
    // saves by. Anywhere else on the line (before it, inside the token) it's a plain break: the save titles it later.
    if (this.titlesPages && this.row === 0 && this.col >= this.lines[0]!.trimEnd().length) {
      const titled = pageTitleLine(this.lines[0]!);
      if (titled !== null) { this.lines[0] = titled; this.col = titled.length; }
    }
    const line = this.line, L = this.lines;
    const lead = plain ? null : listLead(line);
    // The cursor on the item's marker (a click lands there): the break goes before the item, which stays whole.
    const col = lead && this.col < lead.length ? 0 : this.col;
    const rest = line.slice(col);
    if (lead && col >= lead.length) {
      if (!line.slice(lead.length).trim()) {
        // An empty item: up to the parent item's level (continuing its numbering), or out of the list.
        const up = this.parentOf(this.row, lead.indent.length);
        const next = up ? up.indent + nextMarker(up.marker) + up.gap + (lead.box ? "[ ] " : "")
          : lead.indent ? outdentBy(lead.indent) + lead.marker + lead.gap + lead.box : "";
        L[this.row] = next;
        this.col = next.length;
        return;
      }
      const next = lead.indent + nextMarker(lead.marker) + lead.gap + (lead.box ? "[ ] " : "");
      L[this.row] = line.slice(0, col);
      L.splice(this.row + 1, 0, next + rest.replace(/^[ \t]+/, ""));
      this.row++; this.col = next.length;
      return;
    }
    const indent = plain ? "" : /^[ \t]*/.exec(line)![0];
    if (indent && !line.trim() && col === line.length) {
      // A line of spaces: Enter takes it up a level, as on an empty item.
      L[this.row] = outdentBy(indent);
      this.col = L[this.row]!.length;
      return;
    }
    const keep = indent && col >= indent.length ? indent : "";
    L[this.row] = line.slice(0, col);
    L.splice(this.row + 1, 0, keep + (keep ? rest.replace(/^[ \t]+/, "") : rest));
    this.row++; this.col = keep.length;
  }

  /** The nearest list item above `row` indented less than `than`: the item this one is nested in. */
  private parentOf(row: number, than: number): ListLead | null {
    for (let r = row - 1; r >= 0; r--) {
      const l = this.lines[r]!;
      if (!l.trim()) continue;
      const lead = listLead(l);
      const ind = lead ? lead.indent.length : /^[ \t]*/.exec(l)![0].length;
      if (ind < than) return lead;
      if (ind === 0) return null;
    }
    return null;
  }

  /** The nearest list item above `row` at exactly `indent`: the one this item follows. */
  private siblingOf(row: number, indent: number): ListLead | null {
    for (let r = row - 1; r >= 0; r--) {
      const l = this.lines[r]!;
      if (!l.trim()) continue;
      const lead = listLead(l);
      const ind = lead ? lead.indent.length : /^[ \t]*/.exec(l)![0].length;
      if (ind < indent) return null;
      if (lead && ind === indent) return lead;
    }
    return null;
  }

  /** The lines a Tab acts on: the selection's, else the cursor's. */
  private span(): [number, number] {
    const s = this.selection();
    return s ? [s[0].row, s[1].row] : [this.row, this.row];
  }

  /**
   * Indent (`dir` 1) or outdent (-1) lines `from`..`to` by one level. A list item goes under the item above
   * it (its text's column), or back to its parent's level; anything else moves two spaces. Every line
   * moves by the first line's step, so the nesting inside a selection is kept. The cursor stays on its text.
   */
  indent(dir: 1 | -1, from = this.span()[0], to = this.span()[1]): number {
    const L = this.lines;
    from = Math.max(0, Math.min(L.length - 1, from)); to = Math.max(from, Math.min(L.length - 1, to));
    const first = L[from]!, lead = listLead(first);
    const ind = lead ? lead.indent : /^[ \t]*/.exec(first)![0];
    const tabs = ind.includes("\t");
    let step: number;
    if (dir > 0) {
      const sib = lead ? this.siblingOf(from, ind.length) : null;
      step = sib && !tabs ? sib.marker.length + sib.gap.length : tabs ? 1 : 2;
    } else {
      const up = lead ? this.parentOf(from, ind.length) : null;
      step = up && !tabs ? ind.length - up.indent.length : Math.min(ind.length, tabs ? 1 : 2);
    }
    if (step <= 0) return 0;
    let moved = 0;
    for (let r = from; r <= to; r++) {
      const l = L[r]!;
      if (!l.trim() && from !== to) continue;
      const have = /^[ \t]*/.exec(l)![0].length;
      const d = dir > 0 ? step : -Math.min(step, have);
      if (!d) continue;
      L[r] = dir > 0 ? (tabs ? "\t" : " ".repeat(step)) + l : l.slice(-d);
      moved++;
      if (r === this.row) this.col = Math.max(0, this.col + d);
      if (this.anchor && r === this.anchor.row) this.anchor.col = Math.max(0, this.anchor.col + d);
    }
    return moved;
  }

  // ── an agent's patch (PIE-501): compare-and-swap on a span, while the person types ──

  /** The UTF-16 offset of line `row`, column `col` in the draft's text. */
  offsetOf(row: number, col: number): number {
    let o = 0;
    for (let r = 0; r < row && r < this.lines.length; r++) o += this.lines[r]!.length + 1;
    return o + col;
  }

  /** The line and column of a UTF-16 offset in the draft's text (clamped). */
  placeOf(offset: number): { row: number; col: number } {
    let o = Math.max(0, offset);
    for (let r = 0; r < this.lines.length; r++) {
      const n = this.lines[r]!.length;
      if (o <= n || r === this.lines.length - 1) return { row: r, col: Math.min(o, n) };
      o -= n + 1;
    }
    return { row: 0, col: 0 };
  }

  /**
   * An agent's patch, if its compare holds against the text as typed now: every span's observed text still
   * there, at or near where it was seen; the draft still on the revision the agent read; none around the
   * cursor; and, when the patch names a mark (the `@request` line), every span above it, or above the block
   * the cursor is in when the person went back up above the mark to write. Without a mark the only limit is
   * the block being typed in (the cursor's paragraph, list item or heading): an agent's ordinary edit of a
   * note the person has open lands anywhere else, above or below. Then the text changes, the cursor, selection and view move with it so nothing on screen
   * jumps, and the change is one undo unit, lit for a moment with who made it. `force`: "apply anyway",
   * the person's own choice, placed by its passage wherever it is now, with no revision or cursor check, but
   * still above the mark when the draft has it (the service sends a proposal's mark with it, PIE-510).
   */
  applyPatch(p: DraftPatchRequest, by: Actor): DraftPatchAnswer {
    const no = (reason: string): DraftPatchAnswer => ({ applied: false, reason });
    if (this.busy) return no("the draft is being saved");
    if (!p.force && p.revision !== this.base) return no(`the draft is on revision ${this.base}, not the ${p.revision} it was read at`);
    const text = this.text;
    const located = locateSpans(text, p.patches, !!p.force);
    if (!located.ok) return no(located.reason);
    if (p.force && p.mark !== undefined) {
      // A mark line the person took out holds nothing back: the passage is placed by its own text.
      const mark = markStart(text, p.mark);
      if (mark >= 0 && located.spans.some(sp => sp.end > mark)) return no("it reaches the mark or below it; a patch changes only text above the mark");
    }
    if (!p.force) {
      const c = this.offsetOf(this.row, this.col), a = this.anchor ? this.offsetOf(this.anchor.row, this.anchor.col) : c;
      if (located.spans.some(sp => (sp.start < c && c < sp.end) || (sp.start < a && a < sp.end))) return no("the cursor is in that passage");
      // With a mark: above it; and when the person went back up above the mark to write, above the block they're in.
      if (p.mark !== undefined) {
        const mark = markStart(text, p.mark);
        if (mark < 0) return no("the mark isn't in the draft");
        const at = Math.min(c, a);
        const limit = at > mark ? mark : blockStartAt(text, at);
        if (located.spans.some(sp => sp.end > limit)) return no(`it reaches ${limit === mark ? "the mark" : "the block being typed in"} or below it; a patch changes only text above it`);
      } else {
        const typing = [...new Set([blockStartAt(text, c), blockStartAt(text, a)])];
        if (located.spans.some(sp => typing.some(block => blockStartAt(text, sp.start) === block || (sp.start < block && block < sp.end)))) {
          return no("it changes the block being typed in");
        }
      }
    }
    this.commitPatch(located.spans, by, p.patchId);
    return { applied: true };
  }

  /**
   * A line the service puts in for a proposal (`!((id))`): after the mark line, or at the end without one.
   * The cursor at the very place it goes stays before it, so typing at the end of the note carries on.
   */
  insertLine(line: string, mark: string | undefined, by: Actor, patchId = `embed-${Date.now()}`): DraftPatchAnswer {
    if (this.busy) return { applied: false, reason: "the draft is being saved" };
    const at = mark?.trim() ? this.lines.findIndex(l => l.trim() === mark.trim()) : -1;
    const offset = at >= 0 ? this.offsetOf(at, this.lines[at]!.length) : this.text.length;
    const add = (this.text ? "\n" : "") + line;
    this.commitPatch([{ start: offset, end: offset, replacement: add }], by, patchId, o => (o <= offset ? o : o + add.length));
    return { applied: true };
  }

  /** Take back the patch `patchId` (the service reverting a patch that didn't apply everywhere, or undo). */
  revertPatch(patchId: string, by: Actor = USER): boolean {
    const i = this.patches.findIndex(u => u.patchId === patchId);
    if (i < 0) return false;
    const u = this.patches[i]!;
    // Undo is a compare-and-swap too: the patched text (and a little either side) must still be there.
    const spans: DraftPatchSpan[] = u.spans.map(sp => {
      const start = sp.start - sp.before.length;
      const observed = sp.before + sp.text + sp.after;
      return { observed, replacement: sp.before + sp.was + sp.after, range: { start, end: start + observed.length } };
    });
    // Typing since may have moved it further than the compare looks from its range: then its one copy anywhere,
    // with the text either side, and failing that the patched text alone when it is in the draft just once.
    const located = [spans, spans.map(({ range: _, ...sp }) => sp), u.spans.map(sp => ({ observed: sp.text, replacement: sp.was }))]
      .map(tried => tried.some(sp => !sp.observed) ? null : locateSpans(this.text, tried))
      .find(r => r?.ok);
    if (!located?.ok) return false;
    this.patches.splice(i, 1);
    this.commitPatch(located.spans, by, null);
    this.flashes = this.flashes.filter(f => !u.spans.some(sp => f.start === sp.start));
    return true;
  }

  /** ctrl+z: take back the last agent patch (an agent only its own). Says what it did, or why not. */
  undoPatch(by: Actor): string {
    const u = [...this.patches].reverse().find(x => by.kind === "user" || sameParty(x.by, by));
    if (!u) throw new ActionRefused(by.kind === "user" ? "no agent edit to undo in this draft" : "this agent has no edit to undo in this draft");
    if (!this.revertPatch(u.patchId, by)) throw new ActionRefused(`couldn't undo ${patchLabel(u.by)}'s edit: the text changed around it since`);
    return this.note = `undid ${patchLabel(u.by)}'s edit`;
  }

  /** Replace `spans` of the text; the cursor, selection, view and lit patches move with it. */
  private commitPatch(spans: LocatedSpan[], by: Actor, patchId: string | null, map: (o: number) => number = o => mapOffset(o, spans)) {
    const before = this.text, after = applyLocated(before, spans);
    // What stays put on screen: the cursor's row while it's in view, else the top row's text.
    const w = this.shown.w;
    let keep: { offset: number; screen: number } | null = null;
    if (w) {
      const rows = this.layout(w), at = this.cursorIn(rows);
      if (at.vi >= this.top && at.vi < this.top + this.shown.h) keep = { offset: this.offsetOf(this.row, this.col), screen: at.vi - this.top };
      else { const r = rows[this.top]; if (r) keep = { offset: this.offsetOf(r.line, [...this.lines[r.line]!].slice(0, r.start).join("").length), screen: 0 }; }
    }
    const cursor = map(this.offsetOf(this.row, this.col));
    const anchor = this.anchor ? map(this.offsetOf(this.anchor.row, this.anchor.col)) : null;
    const flashes = this.flashes.map(f => ({ ...f, start: map(f.start), end: map(f.end) }));
    this.lines = after.split("\n");
    const c = this.placeOf(cursor);
    this.row = c.row; this.col = c.col;
    this.anchor = anchor === null ? null : this.placeOf(anchor);
    if (keep && w) {
      const p = this.placeOf(map(keep.offset)), rows = this.layout(w);
      this.top = Math.max(0, this.viOf(rows, p.row, p.col) - keep.screen);
    }
    this.flashes = flashes;
    if (patchId !== null) {
      let delta = 0;
      const unit: PatchUnit = { patchId, by, spans: [] };
      for (const sp of spans) {
        const start = sp.start + delta;
        delta += sp.replacement.length - (sp.end - sp.start);
        unit.spans.push({ start, text: sp.replacement, was: before.slice(sp.start, sp.end), before: after.slice(Math.max(0, start - 8), start), after: after.slice(start + sp.replacement.length, start + sp.replacement.length + 8) });
        const lit = sp.replacement.replace(/^\n/, "");
        this.flashes.push({ start: start + (sp.replacement.length - lit.length), end: start + sp.replacement.length, label: `${patchLabel(by)} · just now`, until: Date.now() + PATCH_FLASH_MS });
      }
      this.patches.push(unit);
      if (this.patches.length > PATCH_UNDO_KEEP) this.patches.shift();
    }
    this.discardArmed = false;
    if (this.text !== before) this.wrote(by);
  }

  /** The visual row a place is drawn on. */
  private viOf(rows: VRow[], row: number, col: number): number {
    const cp = [...(this.lines[row] ?? "").slice(0, col)].length;
    let vi = rows.findIndex(r => r.line === row);
    if (vi < 0) return 0;
    while (vi + 1 < rows.length && rows[vi + 1]!.line === row && rows[vi + 1]!.start <= cp) vi++;
    return vi;
  }

  // ── the selection (a drag in the draft) ────────────────────────────────────

  /** Where a selection started; the cursor is its other end. */
  anchor: { row: number; col: number } | null = null;

  /** The selection, start before end, or null. */
  selection(): [{ row: number; col: number }, { row: number; col: number }] | null {
    const a = this.anchor;
    if (!a || (a.row === this.row && a.col === this.col)) return null;
    const c = { row: this.row, col: this.col };
    return a.row < c.row || (a.row === c.row && a.col < c.col) ? [a, c] : [c, a];
  }

  /** The selected text, as typed (lines joined by newlines), or null with nothing selected. */
  selectedText(): string | null {
    const s = this.selection();
    if (!s) return null;
    const [a, b] = s, L = this.lines;
    return a.row === b.row ? L[a.row]!.slice(a.col, b.col) : [L[a.row]!.slice(a.col), ...L.slice(a.row + 1, b.row), L[b.row]!.slice(0, b.col)].join("\n");
  }

  private deleteSelection(): boolean {
    const s = this.selection();
    this.anchor = null;
    if (!s) return false;
    const [a, b] = s, L = this.lines;
    L.splice(a.row, b.row - a.row + 1, L[a.row]!.slice(0, a.col) + L[b.row]!.slice(b.col));
    this.row = a.row; this.col = a.col;
    return true;
  }

  /** Put the cursor at line `row`, column `col` (UTF-16, clamped); `extend` keeps or starts a selection. */
  place(row: number, col: number, extend = false) {
    const r = Math.max(0, Math.min(this.lines.length - 1, row));
    if (extend) this.anchor ??= { row: this.row, col: this.col };
    else this.anchor = null;
    this.row = r;
    this.col = Math.max(0, Math.min(this.lines[r]!.length, col));
    if (this.anchor && this.anchor.row === this.row && this.anchor.col === this.col && !extend) this.anchor = null;
    this.goal = null; this.discardArmed = false;
  }

  // ── the view: soft-wrapped rows, the wheel, the mouse ──────────────────────

  private top = 0;
  /** The view follows the cursor; false after the wheel scrolled it, until the next key. */
  follow = true;
  /** The column up and down keep to (cells from the row's left), while they repeat. */
  private goal: number | null = null;
  /** The last render: its width, height and rows, for the wheel, clicks and up/down. */
  private shown: { w: number; h: number; rows: VRow[] } = { w: 0, h: 15, rows: [] };
  /** Show the Markdown preview under the text (ctrl+p, or the frame's control). The host draws it. */
  preview = false;
  /** Where the edit frame drew the text and its controls, in the host's cells (set by renderEditor). */
  frame: { row: number; col: number; rows: number; controls: { row: number; from: number; to: number; action: "preview" | "pick" }[] } | null = null;

  /** The rows the draft is drawn in at width `w`: each line wrapped at spaces, continuations hung under its text. */
  layout(w: number): VRow[] {
    const out: VRow[] = [];
    this.lines.forEach((line, i) => {
      const chars = [...line];
      for (const r of wrapRows(chars, Math.max(4, w), hangOf(line, Math.max(4, w)))) out.push({ line: i, ...r });
    });
    return out;
  }

  /** The visual row the cursor is on, and its cell. */
  private cursorIn(rows: VRow[]): { vi: number; x: number } {
    const cp = [...this.line.slice(0, this.col)].length;
    let vi = rows.findIndex(r => r.line === this.row);
    if (vi < 0) return { vi: 0, x: 0 };
    while (vi + 1 < rows.length && rows[vi + 1]!.line === this.row && rows[vi + 1]!.start <= cp) vi++;
    const r = rows[vi]!;
    return { vi, x: r.indent + cp - r.start };
  }

  /** The source place at a visual row's cell `x`. */
  private posIn(rows: VRow[], vi: number, x: number): { row: number; col: number } {
    if (!rows.length) return { row: 0, col: 0 };
    vi = Math.max(0, Math.min(rows.length - 1, vi));
    const r = rows[vi]!, last = rows[vi + 1]?.line !== r.line;
    const cp = Math.min(r.start + Math.max(0, x - r.indent), last ? r.end : Math.max(r.start, r.end - 1));
    const line = this.lines[r.line]!;
    return { row: r.line, col: [...line].slice(0, cp).join("").length };
  }

  private moveVisual(d: number) {
    if (!this.shown.w) {
      this.row = Math.max(0, Math.min(this.lines.length - 1, this.row + d));
      this.col = Math.min(this.col, this.line.length);
      return;
    }
    const rows = this.layout(this.shown.w), at = this.cursorIn(rows);
    this.goal ??= at.x;
    const p = this.posIn(rows, at.vi + d, this.goal);
    this.row = p.row; this.col = p.col;
  }

  /** The wheel: the view moves `by` rows; the cursor stays where it is (typing brings it back). */
  scrollBy(by: number) {
    const max = Math.max(0, this.shown.rows.length - this.shown.h);
    this.top = scrolled(this.top, by, max);
    this.follow = false;
  }

  /** The source place under a cell of the text as last drawn (`x`, `y` from the text's top left). */
  posAt(x: number, y: number): { row: number; col: number } {
    return this.posIn(this.shown.rows, this.top + Math.max(0, y), Math.max(0, x));
  }

  /** The draft as terminal lines, soft-wrapped at `w`, with the cursor and selection drawn; the cursor kept on screen unless scrolled away. */
  render(w: number, h: number): string[] {
    const w1 = Math.max(4, w);
    const rows = this.layout(w1);
    this.shown = { w: w1, h: Math.max(1, h), rows };
    const at = this.cursorIn(rows), sel = this.selection();
    if (this.follow) {
      if (at.vi < this.top) this.top = at.vi;
      if (at.vi >= this.top + h) this.top = at.vi - h + 1;
    }
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - h)));
    this.cursorRow = Math.max(0, Math.min(h - 1, at.vi - this.top));
    const out: string[] = [];
    // Agents' patches just landed: their text lit, and who made it at the end of their last row.
    const now = Date.now();
    this.flashes = this.flashes.filter(f => f.until > now);
    const lit = this.flashes.map(f => {
      const a = this.placeOf(f.start), b = this.placeOf(f.end);
      const cp = (p: { row: number; col: number }) => [...this.lines[p.row]!.slice(0, p.col)].length;
      return { a: { row: a.row, cp: cp(a) }, b: { row: b.row, cp: cp(b) }, label: f.label };
    });
    for (let vi = this.top; vi < Math.min(rows.length, this.top + h); vi++) {
      const r = rows[vi]!, chars = [...this.lines[r.line]!];
      const cells = chars.slice(r.start, r.end).map(c => (c === "\t" || c < " " ? " " : c));
      // Selected cells, in this row's own cells.
      let s0 = -1, s1 = -1;
      if (sel) {
        const cpOf = (p: { row: number; col: number }) => [...this.lines[p.row]!.slice(0, p.col)].length;
        const a = sel[0].row < r.line ? 0 : sel[0].row === r.line ? cpOf(sel[0]) : Infinity;
        const b = sel[1].row > r.line ? Infinity : sel[1].row === r.line ? cpOf(sel[1]) : -1;
        s0 = Math.max(r.start, a) - r.start; s1 = Math.min(r.end, b) - r.start;
      }
      const cx = vi === at.vi ? at.x - r.indent : -1;
      if (cx >= cells.length) cells.push(" ");
      const glow = lit.map(f => ({
        from: (f.a.row < r.line ? 0 : f.a.row === r.line ? f.a.cp : Infinity) - r.start,
        to: (f.b.row > r.line ? Infinity : f.b.row === r.line ? f.b.cp : -1) - r.start,
        last: f.b.row === r.line && f.b.cp >= r.start && (f.b.cp <= r.end || r.end === chars.length), label: f.label,
      }));
      let line = " ".repeat(r.indent) + fg(C.white), style = "";
      cells.forEach((c, j) => {
        const want = j === cx ? bg(C.lcyan) + fg(C.black) : j >= s0 && j < s1 ? SELECT_BG + fg(C.white) : glow.some(g => j >= g.from && j < g.to) ? chip(C.magenta) : "";
        if (want !== style) { line += RESET + fg(C.white) + want; style = want; }
        line += c;
      });
      const said = glow.find(g => g.last)?.label;
      const room = w1 - r.indent - Bun.stringWidth(cells.join("")) - 2;
      out.push(line + RESET + (said && room > 4 ? "  " + fg(C.lmagenta) + ("@" + said).slice(0, room) + RESET : ""));
    }
    return out;
  }
}

/** One drawn row of a draft: line `line`, code points [start, end), drawn `indent` cells in. */
export interface VRow { line: number; start: number; end: number; indent: number }

/** A list item's lead: its indent, marker (`-`, `*`, `+`, `1.`, `1)`), the space after it and a `[ ]` box. */
export interface ListLead { indent: string; marker: string; gap: string; box: string; length: number }
const LIST_LEAD = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX~!]\](?:[ \t]+|$))?/;

/** The list item `line` starts, or null. `- ` with nothing after it is an (empty) item; `-` alone isn't. */
export function listLead(line: string): ListLead | null {
  const m = LIST_LEAD.exec(line);
  return m ? { indent: m[1]!, marker: m[2]!, gap: m[3]!, box: m[4] ?? "", length: m[0].length } : null;
}

/** An empty item with a marker typed after it: `- -`, `  1. 2.`, `- [ ] *` (indent, the typed marker). */
const TYPED_MARKER = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX~!]\][ \t]+)?([-*+]|\d{1,9}[.)])$/;

/** The marker after `m`: the same bullet, or the next number with the same closer. */
export const nextMarker = (m: string) => (/^\d/.test(m) ? `${Number.parseInt(m, 10) + 1}${m.at(-1)}` : m);
/** An indent one level less: a tab, or two spaces. */
const outdentBy = (ind: string) => (ind.endsWith("\t") ? ind.slice(0, -1) : ind.slice(0, Math.max(0, ind.length - 2)));

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
  // Each character's cells as the row draws it (a tab or control as one space; CJK and wide emoji two, a
  // combining mark none), so a row of wide characters wraps where the screen ends, not past it (PIE-510).
  const cw = chars.map(c => (c.length === 1 && c < "\u0300" ? 1 : Bun.stringWidth(c)));
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

/** A path as the person would type it: their home as `~`. */
export const tidy = (p: string) => { const h = process.env.HOME; return h && p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

/** "10:42" today, or "Sep 29 10:42". */
export const whenPut = (at: number) => {
  const d = new Date(at), t = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? t : `${d.toDateString().slice(4, 10)} ${t}`;
};

// ── the draft's actions: keys, clicks and `act` all run these ───────────────

export type DraftActionArgs = ArgsOfSet<typeof DRAFT_ACTIONS>;

/**
 * What the draft does besides typing, as actions: Enter's list continuation, Tab and Shift+Tab, a click or a
 * drag (place), the wheel (scroll) and the preview. The keys and the mouse call these; so does `act`
 * (through the note actions of the same names), where the draft session's agent rule decides first
 * (`agentRefusal`: a draft the agent opened and alone typed in).
 */
export const DRAFT_ACTIONS = actionSet<Draft>()("draft", {
  "draft.newline": def({
    summary: "a line break at the cursor; on a list item the next item at the same level (an empty item goes up a level or ends the list); plain=true just breaks", keys: "enter (alt+enter or shift+enter plain)",
    touches: "draft", draft: "type", replay: "ask",
    args: { plain: { type: "boolean", optional: true, about: "no list continuation" } },
    run({ plain }, d, actor) { const t = d.text; d.newline(!!plain); if (d.text !== t) d.wrote(actor); return { line: d.row + 1, col: d.col }; },
  }),
  "draft.indent": def({
    summary: "indent the cursor's line (or the selection's lines, or from..to) one level: a list item goes under the item above", keys: "tab",
    touches: "draft", draft: "type", replay: "ask",
    args: { from: { type: "number", optional: true, about: "first line, from 1" }, to: { type: "number", optional: true, about: "last line, from 1" } },
    run({ from, to }, d, actor) { const n = from ? d.indent(1, from - 1, (to ?? from) - 1) : d.indent(1); if (n) d.wrote(actor); return { lines: n }; },
  }),
  "draft.outdent": def({
    summary: "outdent the cursor's line (or the selection's lines, or from..to) one level: a list item back to its parent's", keys: "shift+tab",
    touches: "draft", draft: "type", replay: "ask",
    args: { from: { type: "number", optional: true, about: "first line, from 1" }, to: { type: "number", optional: true, about: "last line, from 1" } },
    run({ from, to }, d, actor) { const n = from ? d.indent(-1, from - 1, (to ?? from) - 1) : d.indent(-1); if (n) d.wrote(actor); return { lines: n }; },
  }),
  "draft.place": def({
    summary: "put the draft's cursor at a line and column; extend=true selects from where it was", keys: "click, drag",
    touches: "draft", draft: "type", replay: "safe",
    args: { line: { type: "number", about: "line, from 1" }, col: { type: "number", optional: true, about: "column, from 1 (default the end)" }, extend: { type: "boolean", optional: true, about: "select from the cursor to here" } },
    run({ line, col, extend }, d, actor) { d.place(line - 1, col === undefined ? Infinity : col - 1, !!extend); d.follow = true; return { line: d.row + 1, col: d.col + 1 }; },
  }),
  "draft.scroll": def({
    summary: "scroll the draft's view by rows; the cursor stays (the next key brings it back into view)", keys: "wheel",
    touches: "draft", draft: "type", replay: "safe",
    args: { by: { type: "number", about: "rows, negative up" } },
    run({ by }, d, actor) { d.scrollBy(by); return { following: d.follow }; },
  }),
  "draft.undo": def({
    summary: "take back the last edit an agent's draft.patch made in this draft (an agent: only its own); one patch is one undo", keys: "ctrl+z",
    touches: "draft", draft: "safe", replay: "ask",
    args: {},
    async run(_, d, actor) { const said = d.undoPatch(actor); return { undone: said, left: d.patches.length }; },
  }),
  "draft.preview": def({
    summary: "show or hide the draft's Markdown preview under it, drawn by the reader's renderer", keys: "ctrl+p, a click on ◧ preview",
    touches: "draft", draft: "type", replay: "safe",
    args: { on: { type: "boolean", optional: true, about: "default: toggle" } },
    run({ on }, d, actor) { d.preview = on ?? !d.preview; return { preview: d.preview }; },
  }),
  "draft.copy": def({
    summary: "the draft's selected text, returned. The host puts the person's on their clipboard (an agent's never). A drag in a draft doesn't copy by itself, unlike a reader's: typing or a paste replaces what's selected there", keys: "cmd+c",
    touches: "draft", draft: "type", replay: "safe",
    args: {},
    run(_, d, actor) {
      const text = d.selectedText();
      if (!text) throw new ActionRefused("nothing is selected in the draft · drag across the text, then cmd+c");
      return { text, chars: [...text].length };
    },
  }),
});

/** How a patch's writer is named where it landed: `tidy` for an agent, `you` for the person. */
export const patchLabel = whoOf;

/** The same party: the person, or the same agent. */
export const sameParty = (a: Actor, b: Actor) => a.kind === b.kind && (a.kind === "user" || a.id === (b as { id: string }).id);

const isLow = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
const stepBack = (s: string, i: number) => (i >= 2 && isLow(s, i - 1) ? i - 2 : i - 1);
const stepForward = (s: string, i: number) => (isLow(s, i + 1) ? i + 2 : i + 1);

/**
 * Keep `text` in `state/drafts/` as `<label>-<time>.md` (0600, the folder 0700) and prune old copies: the one
 * place unsaved text is copied to, for a draft (`Draft.copyOut`) and for a ctrl+e editor's file alike.
 */
export function keepCopy(text: string, label: string): string {
  const dir = join(stateDir(), "drafts");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(path, text, { mode: 0o600 });
  pruneDrafts(dir, path);
  return path;
}

/** Copies kept in `state/drafts/`: the newest this many, and anything younger than DRAFT_DAYS. */
export const DRAFT_KEEP = 50, DRAFT_DAYS = 30;

/** Drop old draft copies so the folder doesn't grow forever. The copy just written is always kept. */
export function pruneDrafts(dir: string, keep: string, now = Date.now()): string[] {
  let files: { path: string; at: number }[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".md")).map(f => ({ path: join(dir, f), at: statSync(join(dir, f)).mtimeMs }));
  } catch { return []; }
  return pruneOld(files, keep, now);
}

/** Of `files`, remove what the rule drops (past the newest DRAFT_KEEP and older than DRAFT_DAYS; never `keep`), and say which. */
export function pruneOld(files: { path: string; at: number }[], keep: string, now: number): string[] {
  files.sort((a, b) => b.at - a.at);
  const old = files.filter((f, i) => f.path !== keep && i >= DRAFT_KEEP && now - f.at > DRAFT_DAYS * 86_400_000);
  for (const f of old) { try { rmSync(f.path); } catch { /* best effort */ } }
  return old.map(f => f.path);
}
