import { landingLine } from "@ep0ch/outline-core/block-insert";
import { ReaderPosition, PositionRows } from "./reader-position";
// An in-place draft of one block's whole text: subject line, body and [key::value] properties together,
// so a save never drops anything the reader didn't show. The service decides conflicts: a save carries
// the revision the draft started from, and a stale one is refused, never overwritten.
import { propertyListOf, type PropertyList } from "./props";
import { strayKeys } from "./stray";
import { pageTitleLine } from "@ep0ch/outline-core/page-title";
import { COMPONENT_OPEN, componentBlocks, noteCodeFences } from "@ep0ch/outline-core/component-block";
import { linkOccurrences, type LinkOccurrence } from "@ep0ch/outline-core/link-syntax";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./board";
import type { Placement } from "./kitty";
import type { LinkTarget } from "./refs";
import { authorName, whoOf, USER, type Actor } from "./socket";
import { ActionRefused, actionSet, def, type ArgsOfSet } from "./surface/actions";
import { isCopyKey, SELECT_BG } from "./surface/selection";
import { stateDir } from "./state";
import { bg, C, chip, codePointCells, drawEllipsized, fg, RESET, width } from "./style";
import { wrap } from "./text";
import { lastTop, scrolled, scrollOff } from "./scroll";
import type { Key } from "./term";
import { applyLocated, blockStartAt, locateSpans, mapOffset, markStart, type DraftPatchSpan, type LocatedSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { STEP_BOX } from "@ep0ch/outline-core/checklist-marks";
import { nextGraphemeEnd, previousGraphemeStart } from "@ep0ch/outline-core/graphemes";
import { foldPoints, type FoldPoint } from "./doc";

/** How long an agent's patch stays lit in the draft, with who made it (ms). */
export const PATCH_FLASH_MS = 2500;
/** How many agent patches a draft keeps for an agent's own undo. */
const PATCH_UNDO_KEEP = 20;
/** How many steps a draft's history keeps (PIE-621). */
export const UNDO_KEEP = 300;
/** Typing within this long of the last key, next to it, is the same undo step (ms). */
export const TYPING_PAUSE_MS = 1200;
/** A paste over this many lines or bytes says how big it was, and that ctrl+z takes it back. */
export const BIG_PASTE_LINES = 20, BIG_PASTE_BYTES = 2048;

/**
 * An agent's patch applied to a draft (PIE-501): one undo unit. Each span is where its replacement sits in
 * the text just after it, with the text it replaced and a little text either side for undo's own compare.
 */
interface PatchUnit { group?: string; patchIds?: string[]; patchId: string; by: Actor; spans: { start: number; text: string; was: string; before: string; after: string }[] }
/**
 * One step of a draft's history (PIE-621): the whole text before and after one change, who made it and what it was
 * (`typing`, `the paste (340 lines)`, `tidy's edit`). Typing runs on into one step until a pause, a space or a jump
 * elsewhere (`open` while it may); a paste, an insert, $EDITOR's text and each agent's patch are one step each.
 * `unit`: the agent patch it was, so undoing it takes it off the draft's patches too; with `removes`, the patch it took
 * back (an agent's own undo), so undoing that puts the patch back among them.
 */
export interface Step { before: string; after: string; by: Actor; what: string; at: number; caret: number; open: boolean; word?: boolean; unit?: PatchUnit; removes?: true }
/** A patch's new text, lit for a moment and labelled with who made it. Offsets are the draft's (UTF-16). */
export interface PatchFlash { start: number; end: number; label: string; until: number }
/** What the service asks a draft to patch (the `draft` event's patch, src/socket.ts DraftRequest). */
export interface DraftPatchRequest { patchId: string; patches: DraftPatchSpan[]; revision: number; replyTo?: string; replyGroup?: string; mark?: string; output?: boolean; force?: boolean }
export type DraftPatchAnswer = { applied: true } | { applied: false; reason: string };

/**
 * What a key in a draft asks its host to do: `close` (esc on nothing changed), `discard` (the second esc on
 * changed text: its session puts it aside as unsent), `copy` (cmd+c: the host runs its draft.copy).
 */
export type DraftAction = "keep" | "save" | "editor" | "pick" | "reload" | "close" | "discard" | "copy" | "follow" | "image" | "attach";

export class Draft {
  lines: string[];
  position = new ReaderPosition();
  private positionRows = new PositionRows(this.position);
  get row() { return this.position.cursor.row; }
  set row(value: number) { this.position.cursor.row = value; }
  get col() { return this.position.cursor.col; }
  set col(value: number) { this.position.cursor.col = value; }
  usePosition(position: ReaderPosition) {
    this.position = position;
    this.positionRows.position = position;
    this.follow = false;
  }
  /** Rich editing owns the rows now; patches must not compensate through a stale raw layout too. */
  leaveRawView() {
    this.shown = { w: 0, h: 15, rows: [] };
    this.frame = null;
    this.anchoredRow = null;
  }
  get scrollFigure() { return { top: this.top, room: this.shown.h, total: this.shown.rows.length }; }
  /** The screen row of the cursor in the last render (the completion popup opens under it). */
  cursorRow = 0;
  cursorCol = 0;
  readonly asks = new Map<string, import("@ep0ch/outline-core/protocol").AskProgress>();
  onAskSelected: ((ask: string, fold?: string) => void) | null = null;
  private foldCache: { text: string; points: FoldPoint[] } | null = null;
  private openedFolds = new Set<string>();
  private anchoredRow: number | null = null;
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
  /** Its host offers to attach it to open work (a new roadmap card with a twin, PIE-1258): ctrl+x a does that. */
  attachChord = false;
  note = "";

  /**
   * Who changed the text since the draft opened (each once, in the order they first did), and who changed
   * it last: the person's keys and $EDITOR, or an agent's `edit.text` / `comment.write`. A save is recorded
   * by who wrote it (`recordAs`), and an agent replacing someone else's typing copies it out first.
   */
  writers: Actor[] = [];
  lastWriter: Actor | null = null;

  /** The note's properties when the draft opened, as the service parsed them, to report what a save changed. */
  baseProps: PropertyList;

  /** The earlier revision whose text `revision.restore` last put in (PIE-621): the next one goes further back from it. */
  revisionShown: number | null = null;

  /** The note this draft is about (its target's `near`): reference completion searches from there. */
  near?: string;
  /** A note's text (an edit, a new card or note; not a comment): ⏎ on a first line of only `[page::x]` titles it (PIE-544). */
  titlesPages = false;
  /** Agents' patches applied to this draft, newest last: an agent's `draft.undo` takes back its own last one, wherever it is now. */
  patches: PatchUnit[] = [];
  /**
   * The draft's one history (PIE-621): every change, the person's typing and pastes and an agent's patches alike,
   * oldest first. ctrl+z (`draft.undo`) takes back the newest, ctrl+y (`draft.redo`) puts back what it took; any
   * new change drops what could be put back.
   */
  undos: Step[] = [];
  redos: Step[] = [];
  /** The text as of the last step recorded: the next step's `before`. */
  private seen: string;
  /** Pasted keys are going in (a paste typed out key by key): they become one step once the paste is all in. */
  private pasting = false;
  /** Where agents' patches just landed, lit until `until`. */
  flashes: PatchFlash[] = [];

  constructor(readonly blockId: string, public base: number, text: string, props: PropertyList = []) {
    this.baseProps = props;
    this.original = text;
    this.seen = text;
    this.lines = text.split("\n");
    this.row = 0;
    this.col = this.lines[0]!.length;
  }

  get text() { return this.lines.join("\n"); }

  /**
   * The link the cursor is on (PIE-592): a `((reference))`, an embed, a `[[page]]` or a Markdown link, as outline-core's
   * scan finds it in the whole text (one in code is text), the cursor anywhere in it or just after it. Null on none.
   */
  linkAtCursor(): LinkOccurrence | null { return this.linkAt(this.row, this.col); }
  /** The link at line `row`, column `col` (from 0), as `linkAtCursor` finds one. */
  linkAt(row: number, col: number): LinkOccurrence | null {
    const at = this.offsetOf(row, col);
    return linkOccurrences(this.text).find(l => l.start <= at && at <= l.end) ?? null;
  }
  get dirty() { return this.text !== this.original; }
  /** The text the draft started from (a kept edit keeps it: "add them" and the comparison read its own changes from it). */
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
  /** Its host draws it again (its session's): a paste typed out key by key is said once it's all in, after the keys drew. */
  redraw: (() => void) | null = null;

  /** `who` changed the text: a step of the draft's history (`what` it was), and they're among its writers. */
  wrote(who: Actor, what = "typing") {
    this.markWriter(who);
    this.record(who, what);
  }

  private markWriter(who: Actor) {
    if (who.kind === "user") this.onPersonTyped?.();
    const { with: _, ...me } = who;
    this.lastWriter = me as Actor;
    if (!this.writers.some(w => sameParty(w, who))) this.writers.push(me as Actor);
  }

  // ── the history (PIE-621): undo and redo for every change ──────────────────

  /**
   * The text changed since the last step: a step from what it was to what it is. Typing joins the open typing step
   * when it's the same party's, soon after and next to it; a space or line break typed after a word ends that step,
   * so a step is a word and the space after it.
   */
  private record(by: Actor, what: string, unit?: PatchUnit, removes = false) {
    if (this.pasting) return;
    const before = this.seen, after = this.text;
    if (after === before) return;
    this.seen = after;
    this.redos = [];
    const c = changeOf(before, after), now = Date.now(), top = this.undos.at(-1);
    const small = what === "typing" && c.added <= 2 && c.removed <= 2;
    const typed = after.slice(c.at, c.at + c.added), space = c.added > 0 && !typed.trim(), word = !!typed.trim();
    if (small && top?.open && top.what === "typing" && sameParty(top.by, by) && now - top.at < TYPING_PAUSE_MS && Math.abs(c.at - top.caret) <= 2) {
      top.after = after; top.at = now; top.caret = c.at + c.added;
      if (space && top.word) top.open = false;
      if (word) top.word = true;
      return;
    }
    if (top) top.open = false;
    this.undos.push({ before, after, by: stripWith(by), what, at: now, caret: c.at + c.added, open: small, word, ...(unit ? { unit } : {}), ...(removes ? { removes: true as const } : {}) });
    if (this.undos.length > UNDO_KEEP) this.undos.shift();
  }

  /** A paste typed out key by key that's still going in becomes its step now (before anything else changes the text). */
  private settle() { if (this.pasting) this.pasted(USER); }

  /** A paste is all in: one step, said when it's big. */
  private pasted(by: Actor) {
    this.pasting = false;
    const before = this.seen;
    const c = changeOf(before, this.text), text = this.text.slice(c.at, c.at + c.added);
    const lines = text ? text.split("\n").length : 0;
    this.record(by, lines > 1 ? `the paste (${lines} lines)` : "the paste");
    if (lines > BIG_PASTE_LINES || Buffer.byteLength(text) > BIG_PASTE_BYTES) this.note = `pasted ${lines} line${lines === 1 ? "" : "s"} · ctrl+z undoes`;
  }

  /**
   * The text becomes `to` (an undo or redo): the person's own puts the cursor at the end of what changed, the view
   * following it; an agent's leaves their cursor and selection on the text they were on (PIE-632).
   */
  private jump(to: string, by: Actor, spans?: Edit[] | null) {
    if (by.kind === "agent") this.carry(to, spans);
    else {
      const c = changeOf(this.text, to);
      this.lines = to.split("\n");
      const p = this.placeOf(c.at + c.added);
      this.row = p.row; this.col = p.col;
      this.anchor = null; this.goal = null; this.follow = true;
    }
    this.seen = to;
    this.flashes = [];
    this.discardArmed = false;
    this.markWriter(by);
  }

  /**
   * ctrl+z: the newest step taken back, whoever made it (the person's). An agent takes back only its own: the newest
   * step when it's theirs, else its last patch where it is now (`undoPatch`). Says what it did.
   */
  undo(by: Actor): string {
    this.settle();
    this.record(USER, "a change");
    const s = this.undos.at(-1);
    if (by.kind === "agent" && (!s || !sameParty(s.by, by))) return this.undoPatch(by);
    if (!s) throw new ActionRefused("nothing to undo in this draft");
    this.undos.pop();
    s.open = false;
    this.jump(s.before, by, editsOf(s, true));
    if (s.unit) this.patches = s.removes ? [...this.patches, s.unit] : this.patches.filter(u => u !== s.unit && !s.unit?.patchIds?.includes(u.patchId));
    this.redos.push(s);
    return this.note = `undid ${s.what === "typing" ? "typing" : s.what}${this.undos.length ? "" : " · the draft is as it started"} · ctrl+y redoes`;
  }

  /** ctrl+y (ctrl+shift+z): the last step undo took back, put back. An agent puts back only its own. */
  redo(by: Actor): string {
    this.settle();
    this.record(USER, "a change");
    const s = this.redos.at(-1);
    if (!s) throw new ActionRefused("nothing to redo in this draft");
    if (by.kind === "agent" && !sameParty(s.by, by)) throw new ActionRefused("the next redo is someone else's change; an agent redoes only its own");
    this.redos.pop();
    this.jump(s.after, by, editsOf(s, false));
    if (s.unit) this.patches = s.removes ? this.patches.filter(u => u !== s.unit && !s.unit?.patchIds?.includes(u.patchId)) : [...this.patches, s.unit];
    this.undos.push(s);
    return this.note = `redid ${s.what}`;
  }

  /** What ctrl+z would take back now, for the keys line: `typing`, `the paste (340 lines)`, `tidy's edit`. */
  get undoable(): string | null { return this.undos.at(-1)?.what ?? null; }

  /**
   * A history carried over from an earlier draft of the same text (its session's: a save, then the note opened again
   * unchanged), so ctrl+z goes back past the save to where that draft started (PIE-621).
   */
  adopt(steps: Step[]) {
    if (this.undos.length || steps.at(-1)?.after !== this.text) return;
    this.undos = steps.map(s => ({ ...s, open: false, unit: undefined }));
  }

  /** Start over from the block as it is now. The typed draft is dropped (a refused one was already copied out). */
  rebase(m: Msg) {
    this.record(USER, "a change");
    this.baseProps = propertyListOf(m);
    this.base = m.revision ?? this.base;
    this.original = m.text;
    this.lines = m.text.split("\n");
    // The typed text is a step back: ctrl+z after a reload brings it back.
    this.record(USER, "the reload");
    this.row = Math.min(this.row, this.lines.length - 1);
    this.col = Math.min(this.col, this.lines[this.row]!.length);
    this.changedElsewhere = false;
    this.conflict = null;
    this.writers = []; this.lastWriter = null;
    this.note = "reloaded the current text";
  }

  /**
   * Replace the text wholesale ($EDITOR came back, an agent sent it, an earlier revision put in). The base revision
   * stays: the service still judges it. One undo step, `what` it was.
   */
  replace(text: string, by: Actor = USER, what = by.kind === "agent" ? `${patchLabel(by)}'s text` : "the editor's text", exact = false) {
    this.settle();
    this.record(USER, "a change");
    const before = this.text;
    // An editor's file ends in a line break the draft never had; `exact` (an earlier revision) keeps the text as it was.
    this.carry(exact ? text : text.replace(/\n$/, ""));
    if (this.text !== before) this.wrote(by, what);
  }

  /**
   * The text becomes `to` wholesale, by a change the cursor didn't make: the cursor and the selection stay on the text
   * they were on (after what changed, they move with it; inside it, to its end, and a selection there is let go), so the
   * next key types where the person is, never past the text's end (PIE-632). `edits`: the change as the spans it
   * really was (an agent's patch, which can change text above and below the person's), when they make `to` exactly;
   * else the one span from the first difference to the last.
   */
  private carry(to: string, edits?: Edit[] | null) {
    const from = this.text;
    const cs = edits && applyEdits(from, edits) === to ? edits : [((c: ReturnType<typeof changeOf>) => ({ at: c.at, removed: c.removed, text: to.slice(c.at, c.at + c.added) }))(changeOf(from, to))];
    const at = (o: number) => {
      let shift = 0;
      for (const c of cs) {
        if (o < c.at) break;
        if (o < c.at + c.removed) return c.at + shift + c.text.length;
        shift += c.text.length - c.removed;
      }
      return o + shift;
    };
    const cursor = at(this.offsetOf(this.row, this.col));
    const view = this.position.view, viewOffset = view ? this.offsetOf(view.line, 0) : null;
    const a = this.anchor ? this.offsetOf(this.anchor.row, this.anchor.col) : null;
    const anchor = a === null || cs.some(c => a > c.at && a < c.at + c.removed) ? null : at(a);
    this.lines = to.split("\n");
    if (view && viewOffset !== null) view.line = this.placeOf(at(viewOffset)).row;
    const p = this.placeOf(cursor);
    this.row = p.row; this.col = p.col;
    this.anchor = anchor === null || anchor === cursor ? null : this.placeOf(anchor);
    this.goal = null;
  }

  /**
   * A chosen completion: `[start,end)` of the cursor's line becomes `text` and the cursor lands after it;
   * `lines` first replaces other whole lines (a heading given a fragment anchor). `selection` names offsets in the
   * inserted text, so typing can replace an example value. One change, by `by`.
   */
  splice(start: number, end: number, text: string, lines: Record<number, string> = {}, by: Actor = USER, selection?: { start: number; end: number }) {
    this.settle();
    this.record(USER, "a change");
    const before = this.text;
    for (const [i, l] of Object.entries(lines)) if (this.lines[Number(i)] !== undefined) this.lines[Number(i)] = l;
    const line = this.line;
    const row = this.row, head = line.slice(0, start);
    this.lines.splice(row, 1, ...(head + text + line.slice(end)).split("\n"));
    const position = (offset: number) => {
      const parts = (head + text.slice(0, offset)).split("\n");
      return { row: row + parts.length - 1, col: parts.at(-1)!.length };
    };
    const cursor = position(selection?.end ?? text.length);
    this.row = cursor.row; this.col = cursor.col;
    this.anchor = selection ? position(selection.start) : null; this.goal = null;
    this.discardArmed = false;
    this.note = "";
    if (this.text !== before) this.wrote(by, "the insert");
  }

  /**
   * Put media line `line` in at the cursor (PIE-592): on its own line, after the cursor's line when that has text. One
   * undo step, as a paste is.
   */
  putLine(line: string, by: Actor = USER, replace?: { start: number; end: number }) {
    // The cursor's line written again whole, in one step: without the path it came from (a dropped file's), and the
    // media line under what's left of it, or in its place when nothing is.
    const was = this.line, kept = (replace ? was.slice(0, replace.start) + was.slice(replace.end) : was).replace(/\s+$/, "");
    this.anchor = { row: this.row, col: 0 }; this.col = was.length;
    this.pasteText(kept.trim() ? `${kept}\n${line}` : line, by);
  }


  /** The text a put-aside draft was brought back with (its session's restore): esc twice on it unchanged drops it. */
  restored: string | null = null;

  /** Write the draft next to the door's state so a refused save can't lose it. */
  copyOut(label = this.blockId.slice(0, 8)): string {
    return (this.savedCopy = keepCopy(this.text + "\n", label));
  }

  key(k: Key): DraftAction {
    // Whatever comes after ctrl+x lets the chord go (only a ctrl+e right after it is $EDITOR).
    const chord = this.letChordGo();
    if (k.kind === "mouse") return "keep";
    // Any key brings the cursor back into view after the wheel scrolled away from it.
    this.follow = true;
    if (k.kind !== "char" && k.kind !== "paste" && k.kind !== "backspace") this.anchoredRow = null;
    if (k.kind === "paste") { this.pasteText(k.text); return "keep"; }
    // A paste typed out key by key (the App's) is one step: recorded once the last of its keys is in, or as soon as
    // another key comes.
    if (!("pasted" in k && k.pasted)) this.settle();
    else if (!this.pasting) {
      this.record(USER, "a change"); this.pasting = true;
      queueMicrotask(() => { if (this.pasting) { this.pasted(USER); this.redraw?.(); } });
    }
    // cmd+c copies the selection; it never types, and never ends a put-aside's second esc. alt+c too,
    // where cmd+c can't reach the door (a terminal without the Kitty keyboard protocol, tmux).
    if (isCopyKey(k) || (k.kind === "alt" && k.ch === "c")) return "copy";
    if (k.kind === "super") return "keep";
    const was = this.discardArmed;
    this.discardArmed = false;
    if (chord && this.attachChord && k.kind === "char" && !k.ctrl && k.ch === "a") return "attach";
    if (k.kind === "char" && k.ctrl) {
      if (k.ch === "s") return "save";
      // ctrl+x ctrl+e: $EDITOR. ctrl+e alone is the line's end, as ctrl+a is its start (a Mac's cmd+→ and cmd+←).
      if (k.ch === "x") { this.ctrlX = true; this.note = `ctrl+x · ctrl+e opens $EDITOR${this.attachChord ? " · a attaches it" : ""}`; return "keep"; }
      if (k.ch === "e" && chord) return "editor";
      if (k.ch === "e") { this.anchor = this.goal = null; this.col = this.line.length; return "keep"; }
      if (k.ch === "t") return "pick";
      if (k.ch === "r") return "reload";
      if (k.ch === "p") { void DRAFT_ACTIONS.run("draft.preview", {}, this, USER); return "keep"; }
      // ctrl+v puts in a picture (PIE-592): the image file whose path the cursor is on (a file dropped on the terminal
      // pastes its path), else the clipboard's; kept in the outline's folder, a media line here.
      if (k.ch === "v") return "image";
      // ctrl+l follows the link the cursor is on (PIE-592): it opens beside the edit, which stays open.
      if (k.ch === "l") {
        if (this.linkAtCursor()) return "follow";
        this.note = "no link here · ctrl+l on a [[page]], ((reference)) or [text](url) opens it beside the edit";
        return "keep";
      }
      // ctrl+z undoes; ctrl+y and ctrl+shift+z (the Kitty keyboard protocol tells shift apart) redo.
      if (k.ch === "z" || k.ch === "y") {
        const name = k.ch === "y" || k.shift ? "draft.redo" : "draft.undo";
        void DRAFT_ACTIONS.run(name, {}, this, USER).catch(e => { this.note = e instanceof Error ? e.message : String(e); });
        return "keep";
      }
      if (k.ch === "a") { this.anchor = this.goal = null; this.col = 0; return "keep"; }
      if (k.ch === "k") { this.anchor = null; if (this.col < this.line.length) { this.lines[this.row] = this.line.slice(0, this.col); this.wrote(USER, "the cut to the line's end"); } return "keep"; }
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
          ? "esc again lets this kept draft go (a copy stays on disk) · ctrl+s saves"
          : "unsaved · esc again keeps it here (nothing is lost) · ctrl+s saves";
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
    // Shift with an arrow, Home or End selects from where the cursor was; the move alone lets the selection go.
    const extend = "shift" in k && !!k.shift && SELECTING.has(k.kind);
    if (extend) this.anchor ??= { row: this.row, col: this.col };
    else if (k.kind !== "tab" && k.kind !== "backtab") this.anchor = null;
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
    if (extend && this.anchor && this.anchor.row === this.row && this.anchor.col === this.col) this.anchor = null;
    // Every keystroke that changes the text makes the person its last writer.
    if (L.length !== len || L[r0] !== cur) this.wrote(USER);
    if (this.row !== r0) this.selectAsk();
    return "keep";
  }

  private get line() { return this.lines[this.row]!; }
  private insert(s: string) {
    this.lines[this.row] = this.line.slice(0, this.col) + s + this.line.slice(this.col);
    this.col += s.length;
  }

  /** Pasted text goes in as it came: no list continuation, no indenting, tabs kept. */
  pasteText(text: string, by: Actor = USER) {
    this.settle();
    this.record(USER, "a change");
    const before = this.text;
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
    if (this.text === before) return;
    this.markWriter(by);
    this.pasted(by);
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
    const closes = !plain && !rest.trim() && this.opensComponent(this.row);
    L[this.row] = line.slice(0, col);
    L.splice(this.row + 1, 0, keep + (keep ? rest.replace(/^[ \t]+/, "") : rest));
    // ⏎ after a component's opening line that nothing closes yet (`::box{list.gap="2"}`): its `::` comes with it, as an
    // editor closes a bracket, so what's written between reads as the component and not as plain text (PIE-1392).
    if (closes) L.splice(this.row + 2, 0, indent + "::");
    this.row++; this.col = keep.length;
  }

  /** Whether line `row` opens a component with a body (not a one-line call) that no `::` closes yet, outside code. */
  private opensComponent(row: number): boolean {
    const open = COMPONENT_OPEN.exec(this.lines[row]!);
    if (!open || open[2] !== undefined) return false;
    if (noteCodeFences(this.lines).some(f => row > f.start && row <= f.end)) return false;
    // Unclosed when a `::` after it closes one more component than the note has now: a closer already below may be an
    // inner component's (a box typed inside a box), so whether this line is paired isn't asked alone.
    const closer = [...this.lines.slice(0, row + 1), "::", ...this.lines.slice(row + 1)];
    return componentBlocks(closer).length > componentBlocks(this.lines).length;
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
    // The person's own write into the draft they're typing in (a part they dropped there, PIE-1357) is theirs to place:
    // no cursor or typing guard, as their own keys have none. An agent's patch keeps them; proposals are for it.
    const own = by.kind === "user";
    if (!p.force && !p.output && !own) {
      const c = this.offsetOf(this.row, this.col), a = this.anchor ? this.offsetOf(this.anchor.row, this.anchor.col) : c;
      if (p.replyTo && located.spans.some(sp => sp.start <= c && c <= sp.end)) return no("the cursor is on the ask being answered");
      if (located.spans.some(sp => (sp.start < c && c < sp.end) || (sp.start < a && a < sp.end))) return no("the cursor is in that passage");
      // With a mark: above it; and when the person went back up above the mark to write, above the block they're in.
      if (p.mark !== undefined) {
        const mark = markStart(text, p.mark);
        if (mark < 0) return no("the mark isn't in the draft");
        const at = Math.min(c, a);
        const limit = at > mark ? mark : blockStartAt(text, at);
        if (located.spans.some(sp => sp.end > limit)) return no(`it reaches ${limit === mark ? "the mark" : "the block being typed in"} or below it; a patch changes only text above it`);
      } else if (!p.replyTo) {
        const typing = [...new Set([blockStartAt(text, c), blockStartAt(text, a)])];
        if (located.spans.some(sp => typing.some(block => blockStartAt(text, sp.start) === block || (sp.start < block && block < sp.end)))) {
          return no("it changes the block being typed in");
        }
      }
    }
    if (p.replyTo && !p.replyGroup) this.asks.set(p.replyTo, { line: p.replyTo, state: "replied", blocks: 1, beside: true });
    this.settle();
    this.record(USER, "a change");
    const prior = p.replyGroup ? this.undos.find(step => step.unit?.group === p.replyGroup && sameParty(step.by, by)) : undefined;
    const rebased: { step: Step; before: string; after: string }[] = [];
    if (prior?.unit) {
      // Check every snapshot before changing any: an ambiguous copy must not leave half-rebased undo history.
      const span = p.patches[0]!;
      const advance = (text: string) => {
        // The live range follows typing; older snapshots can have this answer much earlier.
        const found = locateSpans(text, [{ observed: span.observed, replacement: span.replacement }]);
        return found.ok ? applyLocated(text, found.spans) : null;
      };
      for (const step of this.undos.slice(this.undos.indexOf(prior))) {
        const before = step === prior ? step.before : advance(step.before), after = advance(step.after);
        if (before === null || after === null) return no("the answer's undo history changed; keep or dismiss the proposed continuation");
        rebased.push({ step, before, after });
      }
    }
    this.commitPatch(located.spans, by, p.patchId);
    const latest = this.undos.at(-1);
    if (p.replyGroup && latest?.unit) {
      latest.unit.group = p.replyGroup;
      if (prior?.unit && prior !== latest) {
        for (const { step, before, after } of rebased) { step.before = before; step.after = after; }
        prior.unit = { ...prior.unit, patchIds: [...(prior.unit.patchIds ?? [prior.unit.patchId]), p.patchId],
          spans: prior.unit.spans.map(sp => ({ ...sp, text: p.patches[0]!.replacement })) };
        this.undos.pop();
      }
    }
    return { applied: true };
  }

  /** Plan a run's inverse using the same compare as undo, without changing the live draft or caret. */
  withoutPatches(ids: readonly string[]): string {
    const copy = new Draft(this.blockId, this.base, this.text, this.baseProps);
    copy.patches = this.patches.map(p => ({ ...p, spans: p.spans.map(s => ({ ...s })) }));
    for (const id of [...ids].reverse()) {
      if (!copy.revertPatch(id)) throw new ActionRefused("The script's draft patch changed since; nothing was undone");
    }
    return copy.text;
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
    this.commitPatch(located.spans, by, null, undefined, u);
    this.flashes = this.flashes.filter(f => !u.spans.some(sp => f.start === sp.start));
    return true;
  }

  /** ctrl+z: take back the last agent patch (an agent only its own). Says what it did, or why not. */
  undoPatch(by: Actor): string {
    let u = [...this.patches].reverse().find(x => by.kind === "user" || sameParty(x.by, by));
    if (u?.group) {
      const whole = this.undos.find(step => step.unit?.group === u!.group)?.unit;
      if (whole?.patchIds) {
        this.patches = this.patches.filter(patch => !whole.patchIds!.includes(patch.patchId));
        this.patches.push(whole);
        u = whole;
      }
    }
    if (!u) throw new ActionRefused(by.kind === "user" ? "no agent edit to undo in this draft" : "this agent has no edit to undo in this draft");
    if (!this.revertPatch(u.patchId, by)) throw new ActionRefused(`couldn't undo ${patchLabel(u.by)}'s edit: the text changed around it since`);
    return this.note = `undid ${patchLabel(u.by)}'s edit`;
  }

  /** Replace `spans` of the text; the cursor, selection, view and lit patches move with it. */
  private commitPatch(spans: LocatedSpan[], by: Actor, patchId: string | null, map: (o: number) => number = o => mapOffset(o, spans), removed?: PatchUnit) {
    // Whatever changed the text without a step (the text set outright) is one first, so the patch is its own.
    this.settle();
    this.record(USER, "a change");
    const before = this.text, after = applyLocated(before, spans);
    const view = this.position.view, viewOffset = view ? this.offsetOf(view.line, 0) : null;
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
    if (view && viewOffset !== null) view.line = this.placeOf(map(viewOffset)).row;
    const c = this.placeOf(cursor);
    this.row = c.row; this.col = c.col;
    this.anchor = anchor === null ? null : this.placeOf(anchor);
    if (keep && w) {
      const p = this.placeOf(map(keep.offset)), rows = this.layout(w);
      this.positionRows.source = rows.map(r => r.line);
      this.top = Math.max(0, this.viOf(rows, p.row, p.col) - keep.screen);
      this.anchoredRow = keep.screen;
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
      this.discardArmed = false;
      if (this.text !== before) { this.markWriter(by); this.record(by, `${patchLabel(by)}'s edit`, unit); }
      return;
    }
    this.discardArmed = false;
    if (this.text !== before) { this.markWriter(by); this.record(by, "taking back an edit", removed, !!removed); }
  }

  /** The visual row a place is drawn on. */
  private viOf(rows: VRow[], row: number, col: number): number {
    const cp = [...(this.lines[row] ?? "").slice(0, col)].length;
    let vi = rows.findIndex(r => r.line === row);
    if (vi < 0) return 0;
    while (vi + 1 < rows.length && rows[vi + 1]!.line === row && !rows[vi + 1]!.status && rows[vi + 1]!.start <= cp) vi++;
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
    this.follow = true;
    this.anchoredRow = null;
    const r = Math.max(0, Math.min(this.lines.length - 1, row));
    if (extend) this.anchor ??= { row: this.row, col: this.col };
    else this.anchor = null;
    this.row = r;
    this.col = Math.max(0, Math.min(this.lines[r]!.length, col));
    this.selectAsk();
    if (this.anchor && this.anchor.row === this.row && this.anchor.col === this.col && !extend) this.anchor = null;
    this.goal = null; this.discardArmed = false;
    // A click between ctrl+x and ctrl+e lets the chord go, as any key does: the ctrl+e after it is the line's end.
    this.letChordGo();
  }

  /** Let a pending ctrl+x go (its note too); true when one was pending. */
  private letChordGo(): boolean {
    if (!this.ctrlX) return false;
    this.ctrlX = false; this.note = "";
    return true;
  }

  // ── the view: soft-wrapped rows, the wheel, the mouse ──────────────────────

  private get top() { return this.positionRows.top; }
  private set top(value: number) { this.positionRows.top = value; }
  /** The view follows the cursor; false after the wheel scrolled it, until the next key. */
  follow = true;
  /** The column up and down keep to (cells from the row's left), while they repeat. */
  private goal: number | null = null;
  /** The last render: its width, height and rows, for the wheel, clicks and up/down. */
  private shown: { w: number; h: number; rows: VRow[] } = { w: 0, h: 15, rows: [] };
  /** Show the Markdown preview under the text (ctrl+p, or the frame's control). The host draws it. */
  preview = false;
  /**
   * The preview scrolled by the wheel (PIE-846): its source offset from the cursor, for the text it was scrolled on. Typing (the text changing)
   * lets it go, and the preview follows the cursor's line again.
   */
  previewScroll: { lineDelta: number; row: number; text: string } | null = null;
  /** Where the edit frame drew the text and its controls, in the host's cells (set by renderEditor). */
  frame: {
    row: number; col: number; rows: number; cols: number; controls: { row: number; from: number; to: number; action: "preview" | "pick" | "copy" | "place" | "lands" | "attach" | "file-new" }[];
    /**
     * The preview's rows under the text (its rule first), and its top row and length as drawn: what its wheel scrolls.
     * `placements`: its pictures (PIE-846), on the rows they're drawn, for the host to put out with its own.
     */
    preview?: { row: number; col: number; cols: number; rows: number; top: number; total: number; source: number[]; placements?: Placement[] };
    /** The preview's links, where they're drawn (PIE-592): a click on one follows it. */
    links?: { row: number; from: number; to: number; target: LinkTarget }[];
  } | null = null;

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

  /** The rows the draft is drawn in at width `w`: each line wrapped at spaces, continuations hung under its text. */
  private selectAsk() {
    const answer = this.answerFolds().find(p => p.line === this.row + 1);
    if (!answer && !this.asks.has(this.line)) return;
    if (answer) this.openedFolds.add(answer.key);
    this.onAskSelected?.(this.line, answer?.key);
  }

  askStatus(line: string, room = Infinity): string {
    const ask = this.asks.get(line);
    if (!ask) return "";
    if (ask.warning) return ` · ${ask.warning}${ask.blocks ? ` · ${ask.blocks} block${ask.blocks === 1 ? "" : "s"}` : ""}${ask.beside ? " · beside ▸" : ""}`;
    const short = ` · ${ask.state}${ask.beside ? " · beside ▸" : ""}`;
    const full = ` · ${ask.state}${ask.blocks ? ` · ${ask.blocks} block${ask.blocks === 1 ? "" : "s"}` : ""}${ask.beside ? " · beside ▸" : ""}`;
    return width(full) <= room ? full : short;
  }

  answerFolds() {
    const text = this.text;
    if (this.foldCache?.text !== text) this.foldCache = { text, points: foldPoints(text) };
    return this.foldCache.points.filter(p => {
      const ask = this.lines[p.line - 1]?.trim() ?? "";
      return p.kind === "callout" && ask.startsWith("@") && p.text === `${ask.split(/\s+/, 1)[0]} answered`;
    });
  }

  toggleAnswer(p: FoldPoint) {
    if (this.openedFolds.has(p.key)) {
      if (this.row >= p.line && this.row < p.end) this.place(p.line - 1, 0);
      this.openedFolds.delete(p.key);
    } else this.openedFolds.add(p.key);
    return !this.openedFolds.has(p.key);
  }

  hiddenAnswerLines(): Set<number> {
    const hidden = new Set<number>();
    for (const p of this.answerFolds()) {
      // Entering the answer to edit it reveals it; selecting the ask alone does not.
      if (this.row >= p.line && this.row < p.end) this.openedFolds.add(p.key);
      if (!this.openedFolds.has(p.key)) for (let i = p.line; i < p.end; i++) hidden.add(i);
    }
    return hidden;
  }

  layout(w: number): VRow[] {
    const out: VRow[] = [];
    const hidden = this.hiddenAnswerLines();
    this.lines.forEach((line, i) => {
      if (hidden.has(i)) return;
      const chars = [...line];
      const rows = wrapRows(chars, Math.max(4, w), hangOf(line, Math.max(4, w)));
      for (const r of rows) out.push({ line: i, ...r });
      const last = rows.at(-1)!;
      const room = w - last.indent - width(chars.slice(last.start, last.end).join("")) - (i === this.row ? 1 : 0);
      const status = this.askStatus(line, room);
      if (status && width(status) > room) {
        for (const text of wrap(status.trim(), Math.max(4, w))) out.push({ line: i, start: chars.length, end: chars.length, indent: 0, status: text });
      }
      for (const text of this.kept?.(i, Math.max(4, w)) ?? []) out.push({ line: i, start: chars.length, end: chars.length, indent: 0, status: text, drawn: true });
    });
    return out;
  }

  /** The visual row the cursor is on, its cell (`x`, in cells) and its code point in the line (`cp`). */
  private cursorIn(rows: VRow[]): { vi: number; x: number; cp: number } {
    const cp = [...this.line.slice(0, this.col)].length;
    let vi = rows.findIndex(r => r.line === this.row);
    if (vi < 0) return { vi: 0, x: 0, cp };
    while (vi + 1 < rows.length && rows[vi + 1]!.line === this.row && !rows[vi + 1]!.status && rows[vi + 1]!.start <= cp) vi++;
    const r = rows[vi]!, cw = codePointCells([...this.line]);
    let x = r.indent; for (let k = r.start; k < cp; k++) x += cw[k] ?? 1;
    return { vi, x, cp };
  }

  /** The source place at a visual row's cell `x`. */
  private posIn(rows: VRow[], vi: number, x: number): { row: number; col: number } {
    if (!rows.length) return { row: 0, col: 0 };
    vi = Math.max(0, Math.min(rows.length - 1, vi));
    const r = rows[vi]!, last = rows[vi + 1]?.line !== r.line || !!rows[vi + 1]?.status;
    if (r.status) return { row: r.line, col: this.lines[r.line]!.length };
    // The code point at cell `x`: past the glyphs that end at or before it, never inside one (a wrapped row's
    // last glyph is where its end lands, so a click past it never splits a joined emoji).
    const line = this.lines[r.line]!, cw = codePointCells([...line]);
    let end = last ? r.end : Math.max(r.start, r.end - 1);
    while (!last && end > r.start && cw[end] === 0) end--;
    let cp = r.start;
    for (let at = r.indent; cp < end && at + (cw[cp] ?? 1) <= x; ) { at += cw[cp] ?? 1; cp++; while (cp < end && cw[cp] === 0) cp++; }
    return { row: r.line, col: [...line].slice(0, cp).join("").length };
  }

  private moveVisual(d: number) {
    if (!this.shown.w) {
      this.row = Math.max(0, Math.min(this.lines.length - 1, this.row + d));
      this.col = Math.min(this.col, this.line.length);
      return;
    }
    const rows = this.layout(this.shown.w).filter(r => !r.status), at = this.cursorIn(rows);
    this.goal ??= at.x;
    const p = this.posIn(rows, at.vi + d, this.goal);
    this.row = p.row; this.col = p.col;
  }

  /** The wheel: the view moves `by` rows, past the end as a reader does (PIE-622); the cursor stays where it is (typing brings it back). */
  scrollBy(by: number) {
    this.top = scrolled(this.top, by, lastTop(this.shown.rows.length, this.shown.h));
    this.follow = false;
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
    const f = this.frame, rows = this.shown.rows;
    // Rich edit draws no source rows (PIE-1357): the part lands after the block the cursor is in, with no line drawn.
    if (!f || !rows.length) return { line: landingLine(this.lines, this.row), row: -1 };
    if (y < f.row || y >= f.row + f.rows || x < f.col - 1 || x > f.col + f.cols) return null;
    const line = landingLine(this.lines, rows[Math.min(rows.length - 1, this.top + (y - f.row))]!.line);
    // Its drop line: under the last row the landing line is drawn on, when that row is in view.
    let k = rows.length - 1;
    while (k > 0 && rows[k]!.line > line) k--;
    const row = f.row + (k - this.top) + 1;
    return { line, row: row > f.row && row < f.row + f.rows ? row : -1 };
  }



  /** The draft as terminal lines, soft-wrapped at `w`, with the cursor and selection drawn; the cursor kept on screen unless scrolled away. */
  render(w: number, h: number): string[] {
    const w1 = Math.max(4, w);
    const rows = this.layout(w1);
    this.positionRows.source = rows.map(r => r.line);
    this.positionRows.origin = this.frame?.row ?? 0;
    this.shown = { w: w1, h: Math.max(1, h), rows };
    const at = this.cursorIn(rows), sel = this.selection();
    // Following the cursor, the view keeps a few rows around it (scrolloff, PIE-622): on the last line too, where
    // the rows under it are the blank ones past the end (reader.overscroll; none keeps the last line on the edge).
    if (this.follow && this.anchoredRow !== null) this.top = at.vi - this.anchoredRow;
    else if (this.follow) {
      const off = scrollOff(h);
      if (at.vi - off < this.top) this.top = at.vi - off;
      if (at.vi + off >= this.top + h) this.top = at.vi + off - h + 1;
    }
    // An incoming answer can require more blank room below than the usual overscroll limit.
    this.top = Math.max(0, Math.min(this.top, this.follow && this.anchoredRow !== null ? Math.max(0, at.vi) : lastTop(rows.length, h)));
    this.cursorCol = at.x;
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
      if (r.status) { out.push(r.drawn ? r.status : fg(C.lmagenta) + r.status + RESET); continue; }
      const cells = chars.slice(r.start, r.end).map(c => (c === "\t" || c < " " ? " " : c));
      // Selected cells, in this row's own cells.
      let s0 = -1, s1 = -1;
      if (sel) {
        const cpOf = (p: { row: number; col: number }) => [...this.lines[p.row]!.slice(0, p.col)].length;
        const a = sel[0].row < r.line ? 0 : sel[0].row === r.line ? cpOf(sel[0]) : Infinity;
        const b = sel[1].row > r.line ? Infinity : sel[1].row === r.line ? cpOf(sel[1]) : -1;
        s0 = Math.max(r.start, a) - r.start; s1 = Math.min(r.end, b) - r.start;
      }
      const cx = vi === at.vi ? at.cp - r.start : -1;
      if (cx >= cells.length) cells.push(" ");
      const glow = lit.map(f => ({
        from: (f.a.row < r.line ? 0 : f.a.row === r.line ? f.a.cp : Infinity) - r.start,
        to: (f.b.row > r.line ? Infinity : f.b.row === r.line ? f.b.cp : -1) - r.start,
        last: f.b.row === r.line && f.b.cp >= r.start && (f.b.cp <= r.end || r.end === chars.length), label: f.label,
      }));
      let line = " ".repeat(r.indent) + fg(C.white), style = "";
      const inks = this.inks?.(r.line, this.lines[r.line]!) ?? null;
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
      const progress = rows[vi + 1]?.line !== r.line || rows[vi + 1]?.drawn ? this.askStatus(this.lines[r.line]!) : "";
      const roomForStatus = Math.max(0, w1 - r.indent - width(cells.join("")));
      if (progress) line += RESET + fg(C.lmagenta) + this.askStatus(this.lines[r.line]!, roomForStatus);
      const said = glow.find(g => g.last)?.label;
      const room = w1 - r.indent - width(cells.join("")) - width(progress ? this.askStatus(this.lines[r.line]!, roomForStatus) : "") - 2;
      out.push(line + RESET + (said && room > 4 ? "  " + fg(C.lmagenta) + drawEllipsized("@" + said, room) + RESET : ""));
    }
    return out;
  }
}

/** One drawn row of a draft: line `line`, code points [start, end), drawn `indent` cells in. */
export interface VRow {
  line: number; start: number; end: number; indent: number;
  /** A row that is no text of the line: its progress words, or (`drawn`) a read-only drawing `kept` put under it, already coloured. */
  status?: string; drawn?: true;
}

/** The keys that select with shift held (`Draft.key`). */
const SELECTING = new Set<Key["kind"]>(["left", "right", "up", "down", "home", "end", "pgup", "pgdn"]);

/** A list item's lead: its indent, marker (`-`, `*`, `+`, `1.`, `1)`), the space after it and a `[ ]` box. */
export interface ListLead { indent: string; marker: string; gap: string; box: string; length: number }
const LIST_LEAD = new RegExp(`^([ \\t]*)([-*+]|\\d{1,9}[.)])([ \\t]+)(${STEP_BOX}(?:[ \\t]+|$))?`);

/** The list item `line` starts, or null. `- ` with nothing after it is an (empty) item; `-` alone isn't. */
export function listLead(line: string): ListLead | null {
  const m = LIST_LEAD.exec(line);
  return m ? { indent: m[1]!, marker: m[2]!, gap: m[3]!, box: m[4] ?? "", length: m[0].length } : null;
}

/** An empty item with a marker typed after it: `- -`, `  1. 2.`, `- [ ] *` (indent, the typed marker). */
const TYPED_MARKER = new RegExp(`^([ \\t]*)(?:[-*+]|\\d{1,9}[.)])[ \\t]+(?:${STEP_BOX}[ \\t]+)?([-*+]|\\d{1,9}[.)])$`);

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
    examples: [
      { act: "draft.newline", does: "breaks the line, and on a list item starts the next item at the same level" },
      { act: "draft.newline plain=true", does: "breaks the line with no list marker or indent carried over" },
    ],
    run({ plain }, d, actor) { const t = d.text; d.newline(!!plain); if (d.text !== t) d.wrote(actor); return { line: d.row + 1, col: d.col }; },
  }),
  "draft.indent": def({
    summary: "indent the cursor's line (or the selection's lines, or from..to) one level: a list item goes under the item above", keys: "tab",
    touches: "draft", draft: "type", replay: "ask",
    args: { from: { type: "number", optional: true, about: "first line, from 1" }, to: { type: "number", optional: true, about: "last line, from 1" } },
    examples: [
      { act: "draft.indent", does: "indents the cursor's line, or the selected lines, one level" },
      { act: "draft.indent from=3 to=5", does: "indents lines 3 to 5 one level" },
    ],
    run({ from, to }, d, actor) { const n = from ? d.indent(1, from - 1, (to ?? from) - 1) : d.indent(1); if (n) d.wrote(actor); return { lines: n }; },
  }),
  "draft.outdent": def({
    summary: "outdent the cursor's line (or the selection's lines, or from..to) one level: a list item back to its parent's", keys: "shift+tab",
    touches: "draft", draft: "type", replay: "ask",
    args: { from: { type: "number", optional: true, about: "first line, from 1" }, to: { type: "number", optional: true, about: "last line, from 1" } },
    examples: [
      { act: "draft.outdent", does: "outdents the cursor's line, or the selected lines, one level" },
      { act: "draft.outdent from=3 to=5", does: "outdents lines 3 to 5 one level" },
    ],
    run({ from, to }, d, actor) { const n = from ? d.indent(-1, from - 1, (to ?? from) - 1) : d.indent(-1); if (n) d.wrote(actor); return { lines: n }; },
  }),
  "draft.place": def({
    summary: "put the draft's cursor at a line and column; extend=true selects from where it was", keys: "click, drag",
    touches: "draft", draft: "type", replay: "safe",
    args: { line: { type: "number", about: "line, from 1" }, col: { type: "number", optional: true, about: "column, from 1 (default the end)" }, extend: { type: "boolean", optional: true, about: "select from the cursor to here" } },
    examples: [
      { act: "draft.place line=4 col=1", does: "puts the cursor at the start of line 4" },
      { act: "draft.place line=9 extend=true", does: "selects from the cursor to the end of line 9" },
    ],
    run({ line, col, extend }, d, actor) { d.place(line - 1, col === undefined ? Infinity : col - 1, !!extend); d.follow = true; return { line: d.row + 1, col: d.col + 1 }; },
  }),
  "draft.scroll": def({
    summary: "scroll the draft's view by rows; the cursor stays (the next key brings it back into view). preview=true scrolls its preview instead (PIE-846), until the text changes", keys: "wheel over the text, or over the preview",
    touches: "draft", draft: "type", replay: "safe",
    args: { by: { type: "number", about: "rows, negative up" }, preview: { type: "boolean", optional: true, about: "scroll the preview under the text (ctrl+p shows it)" } },
    examples: [
      { act: "draft.scroll by=10", does: "scrolls the draft's view down ten rows, the cursor staying put" },
      { act: "draft.scroll by=-5 preview=true", does: "scrolls the preview up five rows" },
    ],
    run({ by, preview }, d, actor) {
      if (!preview) { d.scrollBy(by); return { following: d.follow }; }
      const p = d.frame?.preview;
      if (!d.preview || !p) throw new ActionRefused("the preview isn't shown · ctrl+p (draft.preview) shows it");
      const top = Math.max(0, Math.min(Math.max(0, p.total - (p.rows - 1)), p.top + by));
      const projected = new PositionRows(new ReaderPosition());
      projected.source = p.source;
      projected.top = top;
      const view = projected.position.view;
      d.previewScroll = view ? { lineDelta: view.line - d.row, row: view.row, text: d.text } : null;
      return { previewTop: top };
    },
  }),
  "draft.paste": def({
    summary: "put text in at the cursor as it came, as a paste does (over the selection, if any): no list continuation or indenting, and one undo step however big; a paste over 20 lines or 2 KB says so on the status line", keys: "a paste (bracketed paste: cmd+v, ctrl+shift+v)",
    touches: "draft", draft: "type", replay: "ask",
    args: { text: { type: "string", about: "the text" } },
    examples: [
      { act: "draft.paste text=\"- seed swap on Saturday\"", does: "puts that line in at the cursor as it came, as one undo step" },
    ],
    run({ text }, d, actor) { d.pasteText(text, actor); return { line: d.row + 1, col: d.col + 1, note: d.note || null }; },
  }),
  "draft.undo": def({
    summary: "take back the last change in this draft, whoever made it: typing (a word or a pause at a time), a paste (one step, however big), an insert, an agent's draft.patch; back to where the draft started, past a save when the note was opened again unchanged. An agent takes back only its own: its newest step, else its last patch where it is now", keys: "ctrl+z",
    touches: "draft", draft: "safe", replay: "ask",
    args: {},
    async run(_, d, actor) { const said = d.undo(actor); return { undone: said, left: d.undos.length, redo: d.redos.length }; },
  }),
  "draft.redo": def({
    summary: "put back what draft.undo took back, in order; any new change drops what could be put back. An agent puts back only its own", keys: "ctrl+y, ctrl+shift+z",
    touches: "draft", draft: "safe", replay: "ask",
    args: {},
    async run(_, d, actor) { const said = d.redo(actor); return { redone: said, left: d.redos.length }; },
  }),
  "draft.preview": def({
    summary: "show or hide the draft's Markdown preview under it, drawn by the reader's renderer", keys: "ctrl+p, a click on ◧ preview",
    touches: "draft", draft: "type", replay: "safe",
    args: { on: { type: "boolean", optional: true, about: "default: toggle" } },
    examples: [
      { act: "draft.preview on=true", does: "shows the Markdown preview under the draft" },
      { act: "draft.preview", does: "shows the preview if hidden, hides it if shown" },
    ],
    run({ on }, d, actor) { d.preview =on ?? !d.preview; return { preview: d.preview }; },
  }),
  "draft.copy": def({
    summary: "the draft's selected text, returned. The host puts the person's on their clipboard (OSC 52; an agent's never) and says \"copied N chars\". A selection made with the mouse copies when the button comes up, as in a reader (EP0CH_COPY_ON_SELECT=0 turns it off); one made by keys (shift+arrows) is copied by cmd+c, alt+c or the frame's [copy]", keys: "cmd+c, alt+c, the frame's [copy], the release of a drag",
    touches: "draft", draft: "type", replay: "safe",
    args: {},
    run(_, d, actor) {
      const text = d.selectedText();
      if (!text) throw new ActionRefused("nothing is selected in the draft · drag across the text, then cmd+c");
      return { text, chars: [...text].length };
    },
  }),
});

/** How a patch's writer is named where it landed: `tidy` for an agent (its persona first), `you` for the person. */
export const patchLabel = (actor: Actor): string => authorName(whoOf(actor));

/** The same party: the person, or the same agent. */
export const sameParty = (a: Actor, b: Actor) => a.kind === b.kind && (a.kind === "user" || a.id === (b as { id: string }).id);

/** An actor without the others it names (`with`): who made a step. */
const stripWith = (who: Actor): Actor => { const { with: _, ...me } = who; return me as Actor; };

/** One span of a change, in the text it starts from: `removed` characters at `at` become `text`. */
type Edit = { at: number; removed: number; text: string };
/** `edits` (in order, apart) made to `from`. */
const applyEdits = (from: string, edits: Edit[]) => { let out = "", i = 0; for (const e of edits) { out += from.slice(i, e.at) + e.text; i = e.at + e.removed; } return out + from.slice(i); };
/**
 * Step `s` as the spans its agent patch changed, in the text undoing (`back`) or redoing it starts from; null for a step
 * with no patch, or one that took a patch back (its spans were where the patch was, not where it was taken back).
 */
function editsOf(s: Step, back: boolean): Edit[] | null {
  if (!s.unit || s.removes) return null;
  let delta = 0;
  return s.unit.spans.map(sp => {
    const e = back ? { at: sp.start, removed: sp.text.length, text: sp.was } : { at: sp.start - delta, removed: sp.was.length, text: sp.text };
    delta += sp.text.length - sp.was.length;
    return e;
  });
}

/** Where two texts differ: the offset of the first difference, and how many UTF-16 units of each differ from there. */
export function changeOf(a: string, b: string): { at: number; removed: number; added: number } {
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  // Never between a surrogate pair's halves.
  if (p > 0 && p < n && isLow(a, p)) p--;
  let e = 0;
  while (e < n - p && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
  return { at: p, removed: a.length - p - e, added: b.length - p - e };
}

const isLow = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
// A cursor steps by what a person sees as one character (outline-core/graphemes.ts, PIE-1290).
const stepBack = previousGraphemeStart;
const stepForward = nextGraphemeEnd;

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
