import { SnippetSession, type SnippetSlot } from "@ep0ch/outline-core/completion-snippet";
import { ReaderPosition, PositionRows } from "./reader-position";
import { DraftViews, draftView } from "./draft-view";
import { disarms } from "./arm";
import { DraftStatus, UNDO_ASK_PAUSE_MS, type DraftArm } from "./draft-status";
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
import { authorName, whoOf, USER, type Actor } from "./socket";
import { ActionRefused, actionSet, def, exactKeyName, keyName, type ArgsOfSet } from "./surface/actions";
import { Gesture, wordIn } from "./surface/selection";
import { lineCompletionHooks } from "./surface/line-hooks";
import { stateDir } from "./state";
import { width } from "./style";
import { pageRows } from "./scroll";
import type { Key } from "./term";
import { escByHint } from "./esc-rule";
import { applyLocated, locateSpans, mapOffset, type DraftPatchSpan, type LocatedSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { mapCursor, patchedSpans, placeDraftPatch, revertSpans, type PatchedSpan } from "@ep0ch/outline-core/draft-patch-place";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { STEP_BOX } from "@ep0ch/outline-core/checklist-marks";
import { ANSWERED_ASK_STATES, ASK_AT_CURSOR } from "@ep0ch/outline-core/ask-states";
import { nextGraphemeEnd, previousGraphemeStart, wordEndAfter, wordEraseStart, wordStartBefore } from "@ep0ch/outline-core/graphemes";
import { foldPoints, type FoldPoint } from "./doc";
import type { ModeKey } from "./surface/modes";
import { effective, keyTable, movedInTable } from "./surface/keymap";

/** How long an agent's patch stays lit in the draft, with who made it (ms). */
export const PATCH_FLASH_MS = 2500;
/** How many agent patches a draft keeps for an agent's own undo. */
const PATCH_UNDO_KEEP = 20;
/** How many steps a draft's history keeps (PIE-621). */
export const UNDO_KEEP = 300;
/** A ctrl+z this long after undo asked at a save goes past it; sooner (a held key's repeats) it asks again (ms). */
export { UNDO_ASK_PAUSE_MS };
/** Typing within this long of the last key, next to it, is the same undo step (ms). */
export const TYPING_PAUSE_MS = 1200;
/** A paste over this many lines or bytes says how big it was, and that ctrl+z takes it back. */
export const BIG_PASTE_LINES = 20, BIG_PASTE_BYTES = 2048;

/**
 * An agent's patch applied to a draft (PIE-501): one undo unit. Each span is where its replacement sits in
 * the text just after it, with the text it replaced and a little text either side for undo's own compare.
 */
interface PatchUnit { group?: string; patchIds?: string[]; patchId: string; by: Actor; spans: PatchedSpan[] }
/**
 * One step of a draft's history (PIE-621): the whole text before and after one change, who made it and what it was
 * (`typing`, `the paste (340 lines)`, `tidy's edit`). Typing runs on into one step until a pause, a space or a jump
 * elsewhere (`open` while it may); a paste, an insert, $EDITOR's text and each agent's patch are one step each.
 * `unit`: the agent patch it was, so undoing it takes it off the draft's patches too; with `removes`, the patch it took
 * back (an agent's own undo), so undoing that puts the patch back among them. `saved`: the revision a save wrote, on the last step
 * before it in a history carried over (`adopt`); ctrl+z stops there and asks before taking saved text back (PIE-1414).
 * `follows`: an agent's write that came right after the step before it was saved (`followHistory`, PIE-1733), undone
 * and redone with it as one.
 */
export interface Step { before: string; after: string; by: Actor; what: string; at: number; caret: number; open: boolean; word?: boolean; unit?: PatchUnit; removes?: true; saved?: number; follows?: true }

/**
 * A save and the agents' writes that followed it (newest first, as one undo takes them): "your save and yo's removal of
 * its answer".
 */
const chainWhat = (chain: readonly Step[]): string => {
  const save = chain.filter(x => !x.follows), after = chain.filter(x => x.follows).reverse().map(x => x.what);
  return [save.every(x => x.by.kind === "agent" && sameParty(x.by, save[0]!.by)) ? `${patchLabel(save[0]!.by)}'s save` : "your save", ...after].join(" and ");
};
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

/**
 * What wraps a selection when typed over it (PIE-1607), as VS Code's Markdown does, with its closer: the inner text stays
 * selected, so `[[`, `((` and `**` are the key twice. Not `<` and `$` (VS Code's too): no Blockdown form uses them, and typing
 * one over a word mostly means to replace it.
 */
const WRAPS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "\"": "\"", "'": "'", "`": "`", "*": "*", "_": "_", "~": "~" };
/** A motion's rows: its keys, and the same with the selection following. */
const go = (to: string, words: string, move: string[], select: string[]): ModeKey[] => [
  ...move.map(key => ({ key, action: "draft.go", args: { to }, label: `go ${words}`, says: `move the cursor ${words}` })),
  ...select.map(key => ({ key, action: "draft.go", args: { to, extend: true }, label: `select ${words}`, says: `select from the cursor ${words}` })),
];

/**
 * The draft's keys (PIE-1542): one table every place a person types reads (a note's edit, a comment, the composer, an
 * inspector field, the power bar, a line field), with the person's keymap applied, so a rebind works in each and the hint
 * row says the key that works. Typing, the arrows, the esc ladder and the line motions (ctrl+a ctrl+e ctrl+k) are the
 * control's own, not actions.
 */
export const DRAFT_KEYS: readonly ModeKey[] = keyTable("draft", "every place a person types: a note's edit, a comment, the composer, an inspector field, the power bar, a line field", [
  { key: "ctrl+s", action: "edit.save", label: "save", says: "save or send what's written" },
  { key: "esc", action: "edit.close", label: "done", says: "let go of a selection; then close what you're writing (on changed text a second press puts it aside as unsent, never dropped)" },
  { key: "tab", action: "draft.indent", label: "indent", says: "indent the line, or the selected lines, one level (a list item goes under the item above)" },
  { key: "shift+tab", action: "draft.outdent", label: "out", says: "outdent the line, or the selected lines, one level" },
  { key: "ctrl+z", action: "draft.undo", label: "undo", says: "take back the last change in what you're writing" },
  { key: "ctrl+y", action: "draft.redo", label: "redo", says: "put back the change you undid (ctrl+shift+z too)" },
  { key: "ctrl+t", action: "draft.pick", label: "insert", says: "insert a link or a component from a picker" },
  { key: "ctrl+r", action: "edit.reload", label: "reload", says: "after it changed elsewhere: load what's being edited as it is now, or find a comment's quote again" },
  { key: "ctrl+p", action: "draft.preview", label: "preview", says: "show or hide the preview of what you're writing" },
  { key: "ctrl+v", action: "draft.image", label: "picture", says: "put in a picture from the clipboard or the path at the cursor" },
  { key: "ctrl+l", action: "edit.follow", label: "open link", says: "open the link the cursor is on, beside the edit" },
  { key: "alt+c", action: "draft.copy", label: "copy", says: "copy the selected text" },
  { key: "super+c", action: "draft.copy", label: "copy", says: "copy the selected text" },
  // A Mac editor's keys (PIE-1607), each with a twin that arrives where a terminal takes the cmd chord for itself or has no
  // Kitty keys to report it: docs/UI-GRAMMAR.md's "The keys of a draft" says which. Wherever cmd is a twin of ctrl or alt.
  { key: "super+s", action: "edit.save", label: "save", says: "save or send what's written" },
  { key: "super+z", action: "draft.undo", label: "undo", says: "take back the last change in what you're writing" },
  { key: "super+Z", action: "draft.redo", label: "redo", says: "put back the change you undid" },
  { key: "super+x", action: "draft.cut", label: "cut", says: "cut the selected text to the clipboard" },
  { key: "alt+x", action: "draft.cut", label: "cut", says: "cut the selected text to the clipboard" },
  ...go("line-start", "to the line's start", ["super+left"], ["super+shift+left", "shift+home", "alt+H"]),
  ...go("line-end", "to the line's end", ["super+right"], ["super+shift+right", "shift+end", "alt+E"]),
  ...go("doc-start", "to the beginning of the text", ["super+up", "ctrl+home", "alt+<"], ["super+shift+up", "ctrl+shift+home", "alt+{"]),
  ...go("doc-end", "to the end of the text", ["super+down", "ctrl+end", "alt+>"], ["super+shift+down", "ctrl+shift+end", "alt+}"]),
  ...go("word-back", "back a word", ["alt+left", "ctrl+left", "alt+b"], ["alt+shift+left", "ctrl+shift+left", "alt+B"]),
  ...go("word-forward", "forward a word", ["alt+right", "ctrl+right", "alt+f"], ["alt+shift+right", "ctrl+shift+right", "alt+F"]),
  ...["super+a", "alt+S"].map(key => ({ key, action: "draft.select", args: { what: "all" }, label: "select all", says: "select the whole text" })),
  ...["super+l", "alt+L"].map(key => ({ key, action: "draft.select", args: { what: "line" }, label: "select line", says: "select the cursor's line; again takes in the next line" })),
  ...["super+d", "alt+W"].map(key => ({ key, action: "draft.select", args: { what: "word" }, label: "select word", says: "select the word the cursor is on" })),
  { key: "alt+up", action: "draft.line", args: { op: "up" }, label: "line up", says: "move the line, or the selected lines, up" },
  { key: "alt+down", action: "draft.line", args: { op: "down" }, label: "line down", says: "move the line, or the selected lines, down" },
  { key: "alt+shift+up", action: "draft.line", args: { op: "copy-up" }, label: "copy line up", says: "copy the line, or the selected lines, above itself" },
  { key: "alt+shift+down", action: "draft.line", args: { op: "copy-down" }, label: "copy line down", says: "copy the line, or the selected lines, below itself and go to the copy" },
  ...["super+K", "alt+D"].map(key => ({ key, action: "draft.line", args: { op: "delete" }, label: "delete line", says: "delete the line, or the selected lines" })),
  ...["alt+backspace", "ctrl+backspace"].map(key => ({ key, action: "draft.erase", args: { to: "word-back" }, label: "erase word", says: "erase the word before the cursor" })),
  ...["alt+delete", "ctrl+delete"].map(key => ({ key, action: "draft.erase", args: { to: "word-forward" }, label: "erase next word", says: "erase the word after the cursor" })),
  ...["super+backspace", "ctrl+u"].map(key => ({ key, action: "draft.erase", args: { to: "line-start" }, label: "erase to line start", says: "erase from the cursor to the line's start" })),
  { key: "super+delete", action: "draft.erase", args: { to: "line-end" }, label: "erase to line end", says: "erase from the cursor to the line's end" },
  // Typed over a selection, these wrap it instead of replacing it (`Draft.binding`); with nothing selected they're text.
  ...Object.keys(WRAPS).map(key => ({ key, action: "draft.wrap", args: { with: key }, label: "wraps", says: `wrap the selected text in ${key}${WRAPS[key]}; typed twice, in ${key}${key}${WRAPS[key]}${WRAPS[key]}` })),
]);
/**
 * The keys only a one-line field has (the power bar, a rename, a filter, a property's value): readline's, which a note's
 * edit leaves alone (ctrl+w is the desk's window chord there, ctrl+x its $EDITOR chord, ctrl+u the line's start). Read
 * ahead of DRAFT_KEYS by a line field (`Draft.tables`), with the keymap applied, so each is rebound, hinted and listed in
 * the keys window like any other row.
 */
export const LINE_KEYS: readonly ModeKey[] = keyTable("line", "a line field: the power bar's line, a rename, a filter, a property's value", [
  { key: "ctrl+w", action: "draft.erase", args: { to: "word-back" }, label: "erase word", says: "erase the word before the cursor" },
  { key: "ctrl+u", action: "draft.clear", label: "clear", says: "clear the whole line" },
  { key: "ctrl+x", action: "draft.cut", label: "cut", says: "cut the selected text to the clipboard" },
]);
/**
 * What follows ctrl+x in a draft (bash's chord): the second key of $EDITOR. A chord table like the desk's ^W keys, so the
 * keymap rebinds the second key (`"edit.external": ["ctrl+x alt+e"]`) and the hint says the chord that works.
 */
export const DRAFT_CHORD_KEYS: readonly ModeKey[] = keyTable("draft chord", "after ctrl+x in what you're writing", [
  { key: "ctrl+e", action: "edit.external", label: "$EDITOR", says: "edit the text in $VISUAL or $EDITOR; it comes back when that exits" },
], "ctrl+x ");
/** The chord rows as a hint or the keys window names them, whole (`ctrl+x ctrl+e`), the keymap applied. */
export const draftChordRows = (): ModeKey[] => effective(DRAFT_CHORD_KEYS, "ctrl+x ").map(r => ({ ...r, key: `ctrl+x ${r.key}` }));
/** What a table key asks of the draft's host (its session runs the host's action); the rest are the draft's own actions. */
type DraftActionName = Parameters<typeof DRAFT_ACTIONS.run>[0];
const HOST_PART: Record<string, DraftAction> = { "edit.save": "save", "draft.pick": "pick", "edit.reload": "reload", "draft.image": "image", "edit.follow": "follow", "draft.copy": "copy" };

export class Draft {
  lines: string[];
  position = new ReaderPosition();
  /** Every view of this draft (src/draft-view.ts): its raw rows, a line field's one row, rich cells, the popup. */
  readonly views: DraftViews = new DraftViews(this);
  get row() { return this.position.cursor.row; }
  set row(value: number) {
    const was = this.position.cursor.row;
    this.position.cursor.row = value;
    if (value !== was) this.leftOn = null;
    // The cursor left the line the person last typed on: the service hears it, so an ask written there is sent (PIE-1743).
    // That line moved with the cursor on it (an answer landing above) is no leaving.
    if (this.typedOn !== null && value !== this.typedOn) {
      if (this.lines[value] === this.typedLine) { this.typedOn = value; return; }
      this.typedOn = null;
      this.onPersonTyped?.();
      return;
    }
    // An ask the service holds for the cursor (it was back on the line when the service read it): leaving that line
    // tells the service again, typed on or not (Codex on #1445: off and back within the touch's second, then off again).
    if (value !== was && this.waitingAt(was)) this.onPersonTyped?.();
  }
  /** Whether the ask on row `row` waits for the cursor to leave it, as the service last said. */
  private waitingAt(row: number): boolean {
    const line = this.lines[row];
    if (!this.asks.size || line === undefined) return false;
    return this.asks.get(Draft.askKey(line, this.lines.slice(0, row).filter(l => l === line).length))?.warning === ASK_AT_CURSOR;
  }
  /** The line the person last typed on (its row and its text), until the cursor leaves it (PIE-1743). */
  private typedOn: number | null = null;
  /**
   * The line the cursor is on that the person has left all the same (PIE-1757): an ↑ on a wrapped line that keeps the
   * cursor on it, a row up, counts as leaving it, as an ↑ off a line of one row does. Until the cursor moves to another
   * line or the person types again.
   */
  private leftOn: number | null = null;
  /**
   * The line the person is writing on, as the service is told (the draft's read, `cursorLine`): the cursor's line, unless
   * they have left it (`leftOn`). An ask there waits for them (PIE-1743); one on any other line is sent.
   */
  get writingOn(): number | undefined { return this.leftOn === this.row ? undefined : this.row; }
  /** An ↑ that kept the cursor on line `row`, a row up its wrap: leaving it, for an ask typed or held there (PIE-1757). */
  private upWithin(row: number) {
    if (this.row !== row || (this.typedOn !== row && !this.waitingAt(row))) return;
    this.typedOn = null;
    this.leftOn = row;
    this.onPersonTyped?.();
  }
  private typedLine = "";
  get col() { return this.position.cursor.col; }
  set col(value: number) { this.position.cursor.col = value; }
  usePosition(position: ReaderPosition) {
    this.position = position;
    this.follow = false;
  }
  /** Each ask's progress, by its line's text and which line saying it (`askKey`): two lines in the same words are two asks (PIE-1722). */
  readonly asks = new Map<string, import("@ep0ch/outline-core/protocol").AskProgress>();
  /** An ask's place in `asks`: its text, and its `nth` (from 0) among the lines saying it exactly. */
  static askKey(line: string, nth = 0) { return nth ? `${line}\u0000${nth}` : line; }
  /** Take an ask's progress, as the service sends it. */
  progress(ask: import("@ep0ch/outline-core/protocol").AskProgress) {
    this.asks.set(Draft.askKey(ask.line, ask.nth), ask);
    // The ask on the cursor's line said something new of itself (typed on, its words are another ask now): the answer
    // tile already beside an ask follows it, so the two say the same (loki on #1445: "its ask is gone" beside "asks once
    // you leave"). A first ask opens none before its answer, as before.
    if (this.selectedAsk !== null && ask.line === this.lines[this.row] && ask.line !== this.selectedAsk) this.selectAsk();
  }
  /** The ask an answer tile beside the note already shows, when the edit opens beside it: typing on it follows (Codex on #1445). */
  following(ask: string | undefined) { this.selectedAsk = ask ?? null; }
  /** What the service last said of the ask `line` while this draft is open (its progress), if anything. */
  liveAsk(line: string, nth = 0) { return this.asks.get(Draft.askKey(line, nth)); }
  /** The ask the cursor last selected (`selectAsk`): the one the answer tile beside the note follows. */
  private selectedAsk: string | null = null;
  onAskSelected: ((ask: string, fold?: string) => void) | null = null;
  private foldCache: { text: string; points: FoldPoint[] } | null = null;
  /** The answers opened by hand (their fold row, the answer tile's `f`, fold.toggle): open until shut by hand (`answerOpen`). */
  private openedFolds = new Set<string>();
  /** The text the draft started from, to tell whether anything changed. */
  private original: string;
  /**
   * Its one status line (src/draft-status.ts): a write under way, a conflict, the copy on disk, the esc ladder's arm and
   * the last thing said. Its session owns it; the draft only says what its own keys did (undo, a paste, esc).
   */
  readonly status: DraftStatus = new DraftStatus();
  /** The last thing said on its status line. */
  get note(): string { return this.status.note; }
  /** Its host offers to attach it to open work (a new roadmap card with a twin, PIE-1258): ctrl+x a does that. */
  attachChord = false;
  /** Its host saves on ⏎ (an inspector field, PIE-1542): a typed ⏎ asks "save", a pasted one is a line break. */
  enterSaves = false;
  /** The mouse's presses on its text, counted (a double click its word, a triple its line: `selectClicks`). */
  readonly clicks = new Gesture();
  /**
   * The answers drawn open when the mouse was pressed (`holdFolds`), kept open until the press is over (`letFoldsGo`, or
   * any key): a press out of an answer the cursor opened folds it after its release, which so meets the rows it was
   * pressed on (Codex on #1442: it folded at the press, the release met other rows, and the cursor went four lines down).
   */
  private heldOpen: Set<string> | null = null;
  holdFolds() { this.heldOpen = null; this.heldOpen = new Set(this.answerFolds().filter(p => this.answerOpen(p)).map(p => p.key)); }
  letFoldsGo() { this.heldOpen = null; }

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
  snippet: SnippetSession | null = null;
  private snippetStep?: Step;

  startSnippet(slots: SnippetSlot[], offset: number): void {
    if (!slots.length) return;
    this.snippet = new SnippetSession(slots, offset);
    this.snippetStep = this.undos.at(-1);
    this.selectSlot(this.snippet.current);
  }
  private selectSlot(slot: SnippetSlot) {
    this.anchor = this.placeOf(slot.start);
    const end = this.placeOf(slot.end);
    this.row = end.row; this.col = end.col; this.follow = true;
    this.markTypesOver();
  }
  moveSnippet(by: number) {
    const slot = this.snippet?.move(by);
    if (slot) this.selectSlot(slot); else this.endSnippet();
    return { slot: this.snippet ? this.snippet.index + 1 : null, of: this.snippet?.slots.length ?? 0 };
  }
  endSnippet() { this.snippet = null; this.snippetStep = undefined; this.anchor = null; }
  snippetKey(k: Key): boolean {
    if (!this.snippet) return false;
    const own = this.binding(k)?.action;
    const action = own === "draft.indent" ? "snippet.next" : own === "draft.outdent" ? "snippet.previous" : own === "edit.close" ? "snippet.end" : null;
    if (!action) return false;
    void DRAFT_ACTIONS.run(action, {}, this, USER);
    return true;
  }
  /** The text as of the last step recorded: the next step's `before`. */
  private seen: string;
  /** Where agents' patches just landed, lit until `until`. */
  flashes: PatchFlash[] = [];

  constructor(readonly blockId: string, public base: number, text: string, props: PropertyList = []) {
    this.baseProps = props;
    this.status.changed = () => this.redraw?.();
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
  get dirty() { return this.body !== this.original; }
  /** The text it opened on is only a frame the door wrote (a reply's `re::` line): the person has written nothing until there's more than it. */
  framed = false;
  /** Nothing written: it started empty or framed and holds only that, spaces and line breaks (Enter in a new note, PIE-1449). Esc closes it as unchanged. */
  get blank() { const now = this.text.trim(); return (this.framed || !this.original.trim()) && (!now || now === this.original.trim()); }
  /** Changed, and more than blank: what close, leave and discard keep or write. */
  get written() { return this.dirty && !this.blank; }
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
  get busy() { return this.status.busy; }

  /**
   * The person changed the text (never an agent's patch), or the cursor left the line they typed on: the reader holding
   * this draft tells the service, so a request line they write here (`@tidy …`) runs before any save (`drafts.touch`),
   * once quiet and once the cursor is off it (the read answers the cursor's line, PIE-1743).
   */
  onPersonTyped: (() => void) | null = null;
  /** Its host draws it again (its session's): when an armed key's say lapses. */
  redraw: (() => void) | null = null;

  /** `who` changed the text: a step of the draft's history (`what` it was), and they're among its writers. */
  wrote(who: Actor, what = "typing") {
    this.markWriter(who);
    this.record(who, what);
  }

  private markWriter(who: Actor) {
    if (who.kind === "user") { this.leftOn = null; this.typedOn = this.row; this.typedLine = this.lines[this.row] ?? ""; this.onPersonTyped?.(); }
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
    // The history is of what a save writes (`body`): a landing line nothing is typed on is in none of its steps, so the
    // history a save keeps ends on the saved text and the next edit takes it up (PIE-1741: after ctrl+End's line, none).
    // Words written on the landing line (typed or pasted there: CodeRabbit on #1444), or the line taken out, make it the
    // person's: from then on it is theirs, a line made after it too. A change above it, or one only taking text out,
    // leaves it pending (`seen` and the line are what was there).
    if (this.landingRow !== null) { const was = `${this.seen}\n`, c = changeOf(was, this.text); if ((c.added > 0 && c.at + c.removed >= was.length) || this.lines.at(-1) !== "") this.landingRow = null; }
    const before = this.seen, after = this.body;
    if (after === before) return;
    this.seen = after;
    this.redos = [];
    this.status.letGo();
    const c = changeOf(before, after), now = Date.now(), top = this.undos.at(-1);
    if (this.snippet && top && this.snippetStep === top && sameParty(top.by, by) && !unit && this.snippet.update(before, after)) {
      top.after = after; top.at = now; top.caret = c.at + c.added;
      return;
    }
    if (this.snippet) { this.snippet = null; this.snippetStep = undefined; }
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
    // Past the history's end a save takes the agents' writes that followed it along (CodeRabbit on #1435): undo never
    // reaches one without the save it came after.
    if (this.undos.length > UNDO_KEEP) { this.undos.shift(); while (this.undos[0]?.follows) this.undos.shift(); }
  }

  /** A paste is all in: one step, said when it's big. */
  private pasted(by: Actor) {
    const before = this.seen;
    const c = changeOf(before, this.body), text = this.body.slice(c.at, c.at + c.added);
    const lines = text ? text.split("\n").length : 0;
    this.record(by, lines > 1 ? `the paste (${lines} lines)` : "the paste");
    if (lines > BIG_PASTE_LINES || Buffer.byteLength(text) > BIG_PASTE_BYTES) this.status.say(`pasted ${lines} line${lines === 1 ? "" : "s"} · ctrl+z undoes`);
  }

  /**
   * The text becomes `to` (an undo or redo): the person's own puts the cursor at the end of what changed, the view
   * following it; an agent's leaves their cursor and selection on the text they were on (PIE-632).
   */
  private jump(to: string, by: Actor, spans?: Edit[] | null) {
    if (by.kind === "agent") this.carry(to, spans);
    else {
      const was = this.text, c = changeOf(was, to);
      this.lines = to.split("\n");
      let p = this.placeOf(c.at + c.added);
      // An undo or redo that brought an ask back with its answer lands at the ask's end, the answer folded under it
      // (PIE-1738): landing inside the callout opened it raw. A change inside a shut answer alone still lands in it.
      // Not when the change goes on past the answer with words of its own (a paste's text after it, put back by a redo):
      // the cursor stays after those. What follows the answer there is only what was already in the text (a trailing line
      // counted in the change because the newline after it differs) or blank.
      const askEnd = (f: FoldPoint) => this.offsetOf(f.line - 1, this.endOf(f.line - 1));
      const onlyAnswer = (f: FoldPoint) => {
        const after = to.slice(Math.min(this.offsetOf(f.end, 0), c.at + c.added), c.at + c.added).trim();
        return !after || was.slice(c.at, c.at + c.removed).trim().endsWith(after);
      };
      // Opened by hand, not by where the cursor was: the lines just changed under the old cursor (`answerOpen` reads it).
      const fold = this.answerFolds().findLast(f => !this.openedFolds.has(f.key) && p.row >= f.line && askEnd(f) >= c.at && askEnd(f) <= c.at + c.added && onlyAnswer(f));
      if (fold) p = { row: fold.line - 1, col: this.endOf(fold.line - 1) };
      this.row = p.row; this.col = p.col;
      this.anchor = null; this.goal = null; this.follow = true;
    }
    // A snapshot never holds the landing line: what it puts in is all text (CodeRabbit on #1444).
    this.seen = to; this.landingRow = null;
    this.flashes = [];
    this.status.letGo();
    this.markWriter(by);
  }

  /**
   * ctrl+z: the newest step taken back, whoever made it (the person's). An agent takes back only its own: the newest
   * step when it's theirs, else its last patch where it is now (`undoPatch`). Says what it did.
   */
  undo(by: Actor, past = false): string { return this.undoStep(by, past).said; }

  /** undo, saying whether it took a step back or stopped at a save to ask (`asked`: nothing changed). */
  undoStep(by: Actor, past = false): { asked: boolean; said: string } {
    this.record(USER, "a change");
    this.snippet = null; this.snippetStep = undefined;
    const s = this.undos.at(-1);
    if (by.kind === "agent" && (!s || !sameParty(s.by, by))) return { asked: false, said: this.undoPatch(by) };
    if (!s) throw new ActionRefused("nothing to undo in this draft");
    // Saved text is never taken back silently (PIE-1414): ctrl+z at a save says so; one after a pause goes past it. The ask
    // comes first ("saved · ctrl+z again in 5s undoes", one row at 40 columns, PIE-1428); what was saved after it.
    // Going past is the person's alone (draft.undo's personWith): an agent at a save only ever hears the question.
    // An agent's write that followed the save (`follows`, PIE-1733: yo taking out the answer of an ask the save deleted)
    // goes back with the step it followed, in one undo: the save and what it led to.
    const chain = this.chainAt(this.undos.length - 1);
    const what = chain.length > 1 ? chainWhat(chain) : s.what;
    // The line counts the second press's window down (PIE-1738), on two rows of a 44-column reader; what act answers
    // keeps no seconds, and says the revision the note keeps.
    if (s.saved !== undefined && (!past || by.kind === "agent")) {
      const said = `saved · ctrl+z again undoes ${what}; revision ${s.saved} stays in its history`;
      if (by.kind !== "agent") this.status.arm("undo", left => `saved · ctrl+z again in ${left}s undoes ${what}`);
      else this.status.say(said);
      return { asked: true, said };
    }
    for (const step of chain) {
      this.undos.pop();
      step.open = false;
      if (step.unit) this.patches = step.removes ? [...this.patches, step.unit] : this.patches.filter(u => u !== step.unit && !step.unit?.patchIds?.includes(u.patchId));
      this.redos.push(step);
    }
    const first = chain.at(-1)!;
    if (chain.length > 1) this.redoChains.set(first, chain.length);
    this.jump(first.before, by, chain.length > 1 ? null : editsOf(s, true));
    return { asked: false, said: this.status.say(`undid ${what}${this.undos.length ? "" : " · the draft is as it started"} · ctrl+y redoes`) };
  }

  /**
   * The steps one undo takes from `i` down (newest first): the step; or, when it `follows` a save, the agents' writes after
   * that save and the whole save, every step of it back to the save before (its `saved` mark) or the history's start:
   * an ask deleted in two keys comes back whole with its answer, never its answer under an empty line (PIE-1733).
   */
  private chainAt(i: number): Step[] {
    const chain: Step[] = [];
    for (; i >= 0 && this.undos[i]!.follows; i--) chain.push(this.undos[i]!);
    if (!chain.length) return i >= 0 ? [this.undos[i]!] : [];
    for (let first = true; i >= 0 && (first || this.undos[i]!.saved === undefined); i--, first = false) chain.push(this.undos[i]!);
    return chain;
  }
  /** A step undone as part of a whole save (`chainAt`), at the top of the redos: how many ctrl+y puts back with it. */
  private redoChains = new WeakMap<Step, number>();

  /** ctrl+y (ctrl+shift+z): the last step undo took back, put back. An agent puts back only its own. */
  redo(by: Actor): string {
    this.record(USER, "a change");
    const s = this.redos.at(-1);
    if (!s) throw new ActionRefused("nothing to redo in this draft");
    if (by.kind === "agent" && !sameParty(s.by, by)) throw new ActionRefused("the next redo is someone else's change; an agent redoes only its own");
    // A save undone whole with the agents' writes after it (PIE-1733) is put back whole, as one undo took it back.
    const chain = this.redos.slice(-(this.redoChains.get(s) ?? 1)).reverse();
    this.redoChains.delete(s);
    for (const step of chain) {
      this.redos.pop();
      if (step.unit) this.patches = step.removes ? this.patches.filter(u => u !== step.unit && !step.unit?.patchIds?.includes(u.patchId)) : [...this.patches, step.unit];
      this.undos.push(step);
    }
    const last = chain.at(-1)!;
    this.jump(last.after, by, chain.length > 1 ? null : editsOf(s, false));
    return this.status.say(`redid ${chain.length > 1 ? chainWhat([...chain].reverse()) : s.what}`);
  }

  /** What ctrl+z would take back now, for the keys line: `typing`, `the paste (340 lines)`, `tidy's edit`. */
  get undoable(): string | null { return this.undos.at(-1)?.what ?? null; }

  /**
   * A history carried over from an earlier draft of the same text (its session's: a save, then the note opened again
   * unchanged), so ctrl+z can go back past the save to where that draft started (PIE-621). Its last step is marked
   * `saved`: ctrl+z stops there first and asks (PIE-1414).
   */
  adopt(steps: Step[], revision: number) {
    if (this.undos.length || steps.at(-1)?.after !== this.body) return;
    this.undos = steps.map((s, i) => ({ ...s, open: false, unit: undefined, ...(i === steps.length - 1 ? { saved: revision } : {}) }));
  }

  /** Start over from the block as it is now. The typed draft is dropped (a refused one was already copied out). */
  rebase(m: Msg) {
    this.record(USER, "a change");
    this.stood.clear();   // what a stamp's revert would stand it back on is gone with the old base
    this.baseProps = propertyListOf(m);
    this.base = m.revision ?? this.base;
    this.original = m.text;
    this.landingRow = null;
    this.lines = m.text.split("\n");
    // The typed text is a step back: ctrl+z after a reload brings it back.
    this.record(USER, "the reload");
    this.row = Math.min(this.row, this.lines.length - 1);
    this.col = Math.min(this.col, this.lines[this.row]!.length);
    this.writers = []; this.lastWriter = null;
  }

  /**
   * Just loaded (`rebase`), and what's typed next has no place in it: the cursor waits at the end, on a line of its own
   * when the last one has words. The line is part of what was loaded, not a change: with nothing typed on it there's
   * nothing to save, and a save only writes it with words on it.
   */
  landAtEnd() {
    if (this.lines.at(-1)) { this.lines.push(""); this.landingRow = this.lines.length - 1; }
    this.place(this.lines.length - 1, 0);
  }
  /**
   * `landAtEnd` added the last line: until something is typed on it (`record` lets it go), it isn't the person's text
   * (PIE-1578), whatever is taken out above it (PIE-1741: an ask deleted above it once had the save write it).
   */
  private landingRow: number | null = null;
  /**
   * The text a save writes: all of it, less the line a reload's landing added while nothing is typed on it (PIE-1578),
   * so an edit elsewhere (a key, an agent's patch) never saves a trailing line nobody wrote.
   */
  get body(): string {
    return this.landingRow !== null && this.lines.length > 1 && this.lines.at(-1) === "" ? this.lines.slice(0, -1).join("\n") : this.text;
  }

  /**
   * Replace the text wholesale ($EDITOR came back, an agent sent it, an earlier revision put in). The base revision
   * stays: the service still judges it. One undo step, `what` it was.
   */
  replace(text: string, by: Actor = USER, what = by.kind === "agent" ? `${patchLabel(by)}'s text` : "the editor's text", exact = false) {
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
    this.status.say("");
    if (this.text !== before) this.wrote(by, "the insert");
    if (selection) this.markTypesOver();
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


  /**
   * Whether `typed`, just before the cursor, is a property's value (PIE-1656): it follows an open `[key::` (or a line's
   * `key::`) on its line, as a path pasted after `[artifact::` does. A drop there stays as it was pasted.
   */
  typedInToken(typed: string): boolean {
    const upTo = this.text.slice(0, this.offsetOf(this.row, this.col)), want = typed.replace(/\r\n?/g, "\n");
    if (!upTo.endsWith(want)) return false;
    const start = this.placeOf(upTo.lastIndexOf(want));
    return /(?:\[[A-Za-z][\w-]*::|^\s*(?:[-*]\s+)?[A-Za-z][\w-]*::)\s*$/.test(this.lines[start.row]!.slice(0, start.col));
  }

  /**
   * `typed`, just before the cursor (a paste as it came), written again as `lines`, each on a line of its own, in one
   * undo step that gives `typed` back. False, and nothing changed, when it isn't there any more.
   */
  replaceTyped(typed: string, lines: readonly string[], by: Actor = USER): boolean {
    const upTo = this.text.slice(0, this.offsetOf(this.row, this.col)), want = typed.replace(/\r\n?/g, "\n");
    if (!upTo.endsWith(want)) return false;
    const start = this.placeOf(upTo.lastIndexOf(want));
    const before = this.lines[start.row]!.slice(0, start.col), after = this.line.slice(this.col);
    this.anchor = start;
    this.pasteText(`${before.trim() ? "\n" : ""}${lines.join("\n")}${after.trim() ? "\n" : ""}`, by);
    return true;
  }

  /** The text a put-aside draft was brought back with (its session's restore): esc twice on it unchanged drops it. */
  restored: string | null = null;

  /** Write the draft next to the door's state so a refused save can't lose it. */
  copyOut(label = this.blockId.slice(0, 8)): string {
    return (this.status.savedCopy = keepCopy(this.text + "\n", label));
  }

  key(k: Key): DraftAction {
    this.heldOpen = null;
    // What was armed goes with this press, whoever takes the key: what it confirms, if anything, is `was`.
    const was = this.keepsArm(k) ? null : this.status.press();
    if (!this.busy && this.snippetKey(k)) return "keep";
    if (k.kind === "mouse") return "keep";
    // Any key brings the cursor back into view after the wheel scrolled away from it.
    this.follow = true;
    // A paste is the person's typing: what the status line said before goes, as any typed key's does (a big paste says so).
    if (k.kind === "paste") { this.status.say(""); this.pasteText(k.text); return "keep"; }
    // The keys that run an action, from the one key table (DRAFT_KEYS, the person's keymap applied).
    const bound = this.binding(k) ?? (this.closesBy(k) ? this.closeRow() : undefined);
    // cmd+c copies the selection; it never types, and never ends a put-aside's second esc.
    if (bound?.action === "draft.copy") return "copy";
    // A cmd (super) key nothing binds never types; one the table binds (a rebind to cmd+z) runs below.
    if (k.kind === "super" && !bound) return "keep";
    if (was === "chord" && this.confirmsArm(was, k)) return this.chordBinding(k) ? "editor" : "attach";
    // The esc ladder is a row of the table too (edit.close), so a rebind of it closes from the new key.
    if (bound?.action === "edit.close") return this.escape(was);
    if (bound) return this.run(bound.action, k, was === "undo", bound);
    if (k.kind === "char" && k.ctrl) {
      // ctrl+x ctrl+e: $EDITOR (bash's chord). ctrl+e alone is the line's end, as ctrl+a is its start (a Mac's cmd+→ and cmd+←).
      if (k.ch === "x") { this.status.say(`ctrl+x · ${draftChordRows().map(r => r.key.slice(7)).join(" ")} opens $EDITOR${this.attachChord ? " · a attaches it" : ""}`); this.status.arm("chord"); return "keep"; }
      if (k.ch === "e") { this.anchor = this.goal = null; this.col = this.line.length; return "keep"; }
      if (k.ch === "a") { this.anchor = this.goal = null; this.col = 0; return "keep"; }
      if (k.ch === "k") { this.anchor = null; if (this.col < this.line.length) { this.lines[this.row] = this.line.slice(0, this.col); this.wrote(USER, "the cut to the line's end"); } return "keep"; }
      // A key the person's keymap took from a draft action (ctrl+z after draft.undo went to alt+u) says where it went.
      const moved = this.moved(k);
      if (moved) this.status.say(moved);
      return "keep";
    }
    // A field whose host says ⏎ saves (an inspector's value): ⏎ saves; shift+⏎ and a pasted line break (a paste) are text.
    if (k.kind === "enter" && this.enterSaves && !("shift" in k && k.shift)) return "save";
    this.status.say("");
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
      case "up": { const c0 = this.col; this.views.raw.moveBy(-1); if (this.col !== c0) this.upWithin(r0); break; }
      case "down": this.views.raw.moveBy(1); break;
      case "pgup": this.views.raw.moveBy(-this.views.raw.pageRows()); break;
      case "pgdn": this.views.raw.moveBy(this.views.raw.pageRows()); break;
      case "home": this.col = 0; break;
      case "end": this.col = this.line.length; break;
      // Enter keeps the list going (draft.newline); alt+enter and shift+enter are plain line breaks, as a paste's are.
      case "enter": void DRAFT_ACTIONS.run("draft.newline", { plain: "shift" in k && !!k.shift }, this, USER); break;
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
      // Tab and shift+tab (draft.indent, draft.outdent: rows of the table, run above) indent and outdent the line, or every
      // line the selection touches; a paste's tab is text (a paste), and a tab the keymap took away is nothing.
      case "tab": break;
      case "char":
        // A marker typed by hand on an item Enter already started ("- " then "- ") takes the item's place (a paste goes in as it came).
        if (k.ch === " " && this.col === this.line.length) {
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

  /** The close key (edit.close, esc built in): lets go of a selection, then closes; on changed text the second press puts it aside. */
  private escape(was: DraftArm | null): DraftAction {
    // The first press lets go of a selection; nothing else.
    if (this.anchor) { this.anchor = null; return "keep"; }
    if (!this.written) return "close";
    // An edit opened by mistake (a stray `j` or `q` became text) closes on the first press: its session drops the strays.
    if (this.stray() !== null) return "discard";
    if (was !== "discard") {
      const close = this.keyOf("edit.close");
      this.status.say(this.restored === this.text
        ? `${close} again lets this kept draft go (a copy stays on disk) · ${this.keyOf("edit.save")} saves` // says, not a hint row
        : `unsaved · ${close} again keeps it here (nothing is lost) · ${this.keyOf("edit.save")} saves`); // says, not a hint row
      this.status.arm("discard");
      return "keep";
    }
    return "discard";
  }
  /** Whether `k` closes the innermost thing here: its edit.close row's key, or the hint's click (`esc.close`) while Esc is moved off. */
  closesBy(k: Key): boolean {
    return this.binding(k)?.action === "edit.close" || (k.kind === "esc" && escByHint());
  }
  /** The key `closesBy` answers to, as the table has it (esc, or the person's rebind): what a host's hint names. */
  closeKey(): string { return this.closeRow()?.key ?? "esc"; }
  private closeRow(): ModeKey | undefined { for (const t of this.tables) { const r = effective(t).find(x => x.action === "edit.close"); if (r) return r; } return undefined; }

  /** The key the table gives `action` now (the keymap applied), for what this draft says of its keys. */
  keyOf(action: string): string {
    const r = effective(DRAFT_KEYS).find(x => x.action === action);
    return r?.key ?? "(unbound)";
  }

  /** The row of the chord table the second key `k` presses after ctrl+x, or undefined. */
  private chordBinding(k: Key): ModeKey | undefined {
    const name = exactKeyName(k);
    return name ? effective(DRAFT_CHORD_KEYS, "ctrl+x ").find(r => r.key === name) : undefined;
  }

  /**
   * The row of the key table `k` presses here, by its exact name (cmd+shift+← isn't alt+←, as it is on a screen), or
   * undefined. A wrap key is a wrap only over a selection the person made; otherwise it's the character.
   */
  binding(k: Key): ModeKey | undefined {
    if (k.kind === "mouse") return undefined;
    const name = exactKeyName(k);
    let row: ModeKey | undefined;
    if (name) for (const table of this.tables) if ((row = effective(table).find(r => r.key === name))) break;
    return row?.action === "draft.wrap" && (!this.selection() || this.typesOver()) ? undefined : row;
  }

  /** The key tables this draft reads, first match wins: every draft's (DRAFT_KEYS); a line field puts its own (LINE_KEYS) ahead. */
  tables: readonly (readonly ModeKey[])[] = [DRAFT_KEYS];

  /** What to say of a key a table of this draft once bound and the person's keymap took away (where it went), or null. */
  moved(k: Key): string | null {
    for (const table of this.tables) { const said = movedInTable(table, "", keyName(k) ?? ""); if (said) return said; }
    return null;
  }

  /**
   * A key the table bound to `action`: the host's part (save, insert, reload, a picture, a link) comes back as what it
   * asks of its host; the draft's own actions run here. ctrl+shift+z is redo (the Kitty keyboard protocol tells shift apart).
   */
  private run(action: string, k: Key, armed: boolean, bound?: ModeKey): DraftAction {
    const host = HOST_PART[action];
    if (host === "follow" && !this.linkAtCursor()) {
      this.status.say("no link here · ctrl+l on a [[page]], ((reference)) or [text](url) opens it beside the edit");
      return "keep";
    }
    if (host) return host;
    const name = action === "draft.undo" && "shift" in k && k.shift ? "draft.redo" : action;
    const refused = (e: unknown) => { this.status.say(e instanceof Error ? e.message : String(e)); };
    // A refusal (alt+x with nothing selected) is said, whether the action throws at once or later.
    try { void Promise.resolve(DRAFT_ACTIONS.run(name as DraftActionName, (name === "draft.undo" && armed ? { past: true } : bound?.args ?? {}) as never, this, USER)).catch(refused); }
    catch (e) { refused(e); }
    return "keep";
  }

  private get line() { return this.lines[this.row]!; }
  private insert(s: string) {
    this.lines[this.row] = this.line.slice(0, this.col) + s + this.line.slice(this.col);
    this.col += s.length;
  }

  /** Pasted text goes in as it came: no list continuation, no indenting, tabs kept. */
  pasteText(text: string, by: Actor = USER) {
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
    // ⏎ at the end of an answered ask: the answer stays under its ask and the words go on below it (PIE-1585).
    const answer = this.line.slice(this.col) ? undefined : this.answerFolds().find(p => p.line === this.row + 1);
    if (answer) ({ row: this.row, col: this.col } = this.placeOf(this.offsetOf(answer.end, 0) - 1));
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
    // Whether it may land, and where, is outline-core's one decision (draft-patch-place.ts): the service asks the same
    // of a draft held by a window that reads no Blockdown.
    const c = this.offsetOf(this.row, this.col), a = this.anchor ? this.offsetOf(this.anchor.row, this.anchor.col) : c;
    const placed = placeDraftPatch({ text: this.text, base: this.base, cursor: c, anchor: a, busy: this.busy }, p, by.kind === "user");
    if (!placed.ok) return no(placed.reason);
    const located = { spans: placed.spans };
    // Said at once, for the first line saying it when none has said more (which of them it is, the service's progress says).
    if (p.replyTo && !p.replyGroup && !this.asks.has(p.replyTo)) this.asks.set(p.replyTo, { line: p.replyTo, state: "replied", blocks: 1, beside: true });
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
    // A cursor at the ask's end stays there, and a paragraph added at the very end opens below the cursor: each span says (`mapCursor`).
    this.commitPatch(located.spans, by, p.patchId, o => mapCursor(o, placed.spans));
    const latest = this.undos.at(-1);
    if (p.replyGroup && latest?.unit) {
      latest.unit.group = p.replyGroup;
      if (prior?.unit && prior !== latest) {
        for (const { step, before, after } of rebased) { step.before = before; step.after = after; }
        prior.unit = { ...prior.unit, patchIds: [...(prior.unit.patchIds ?? [prior.unit.patchId]), p.patchId],
          spans: prior.unit.spans.map(sp => ({ ...sp, text: p.patches[0]!.replacement.slice(p.replyTo!.length) })) };
        this.undos.pop();
      }
    }
    return { applied: true };
  }

  /** What the draft stood on before a patch the saved note also took (PIE-1756), by patch: a service revert goes back. */
  private stood = new Map<string, { base: number; original: string; baseProps: PropertyList }>();

  /**
   * A patch the saved note took too, as `on.revision` with `on.text` (an agent's property stamp, PIE-1756): the draft
   * stands on that revision, its unchanged text is that text (an edit holding only the stamp closes on one esc), and the
   * save's "this changes properties" check starts from its chips, so a stamp taken back with ctrl+z is the person's change.
   */
  standOn(patchId: string, on: { revision: number; text: string }) {
    this.stood.set(patchId, { base: this.base, original: this.original, baseProps: this.baseProps });
    this.baseProps = chipsMoved(this.baseProps, this.original, on.text);
    this.original = on.text;
    this.base = on.revision;
  }

  /** The service took back a patch `standOn` followed: the draft stands where it stood. The revision now, or undefined. */
  unstand(patchId: string): number | undefined {
    const was = this.stood.get(patchId);
    if (!was) return undefined;
    this.stood.delete(patchId);
    this.base = was.base; this.original = was.original; this.baseProps = was.baseProps;
    return was.base;
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
    // Undo is a compare-and-swap too (outline-core's `revertSpans`): what it wrote must still be there.
    const spans = revertSpans(this.text, u.spans);
    if (!spans) return false;
    const located = { spans };
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
    return this.status.say(`undid ${patchLabel(u.by)}'s edit`);
  }

  /** Replace `spans` of the text; the cursor, selection, view and lit patches move with it. */
  private commitPatch(spans: LocatedSpan[], by: Actor, patchId: string | null, map: (o: number) => number = o => mapOffset(o, spans), removed?: PatchUnit) {
    // Whatever changed the text without a step (the text set outright) is one first, so the patch is its own.
    this.record(USER, "a change");
    const before = this.text, after = applyLocated(before, spans);
    // What stays put on screen is the place, in source coordinates (a view of the draft keeps it at each render, never
    // read here): the cursor's line on the row it was drawn on while it's in view, else the top row's line. Mapped through
    // the patch, the next render draws it where it was, whatever view draws it and whether or not one drew it yet.
    const view = this.position.view, viewOffset = view ? this.offsetOf(view.line, 0) : null;
    const caret = this.position.caret?.line === this.row ? this.position.caret : null;
    const top = !caret && view && this.position.top?.line === view.line ? this.position.top : null, topOffset = top ? this.offsetOf(top.line, top.col) : null;
    const cursor = map(this.offsetOf(this.row, this.col));
    const anchor = this.anchor ? map(this.offsetOf(this.anchor.row, this.anchor.col)) : null;
    const flashes = this.flashes.map(f => ({ ...f, start: map(f.start), end: map(f.end) }));
    this.lines = after.split("\n");
    if (view && viewOffset !== null) view.line = this.placeOf(map(viewOffset)).row;
    const c = this.placeOf(cursor);
    this.row = c.row; this.col = c.col;
    if (caret) { this.position.view = { line: c.row, row: caret.row }; this.position.caret = { line: c.row, row: caret.row }; this.position.top = null; }
    else if (top && topOffset !== null) { const p = this.placeOf(map(topOffset)); this.position.top = { line: p.row, col: p.col, mapped: true }; if (view) view.line = p.row; }
    this.anchor = anchor === null ? null : this.placeOf(anchor);
    this.flashes = flashes;
    if (patchId !== null) {
      const unit: PatchUnit = { patchId, by, spans: patchedSpans(before, after, spans) };
      for (const [i, sp] of spans.entries()) {
        const start = unit.spans[i]!.start;
        const lit = sp.replacement.replace(/^\n/, "");
        this.flashes.push({ start: start + (sp.replacement.length - lit.length), end: start + sp.replacement.length, label: `${patchLabel(by)} · just now`, until: Date.now() + PATCH_FLASH_MS });
      }
      this.patches.push(unit);
      if (this.patches.length > PATCH_UNDO_KEEP) this.patches.shift();
      if (this.text !== before) { this.markWriter(by); this.record(by, `${patchLabel(by)}'s edit`, unit); }
      return;
    }
    if (this.text !== before) { this.markWriter(by); this.record(by, "taking back an edit", removed, !!removed); }
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

  /**
   * The selection is one the door filled in for typing over (a snippet's slot, a completion's example value, a prefilled
   * line), not one the person made: a wrap key typed there replaces it as any key does. Moving either end makes it theirs,
   * and so does making it again: the anchor itself is compared, and a new selection has a new one.
   */
  private filled: { anchor: Draft["anchor"]; row: number; col: number } | null = null;
  markTypesOver() { this.filled = { anchor: this.anchor, row: this.row, col: this.col }; }
  private typesOver() { return !!this.anchor && this.filled?.anchor === this.anchor && this.filled.row === this.row && this.filled.col === this.col; }

  /** The last column of line `row` (UTF-16, as every column in a draft is). */
  private endOf(row: number) { return this.offsetOf(row + 1, 0) - this.offsetOf(row, 0) - 1; }

  /** Where a motion lands from the cursor. Word motions step over to the next line at a line's edge, as an editor's do. */
  private landing(to: DraftGo): { row: number; col: number } {
    const { row, col } = this, last = this.lines.length - 1;
    switch (to) {
      case "line-start": return { row, col: 0 };
      case "line-end": return { row, col: this.endOf(row) };
      case "doc-start": return { row: 0, col: 0 };
      case "doc-end": return { row: last, col: this.endOf(last) };
      case "word-back":
        for (let r = row, c = col; r >= 0; r--, c = r >= 0 ? this.endOf(r) : 0) { const at = wordStartBefore(this.lines[r]!, c); if (at !== null) return { row: r, col: at }; }
        return { row: 0, col: 0 };
      case "word-forward":
        for (let r = row, c = col; r <= last; r++, c = 0) { const at = wordEndAfter(this.lines[r]!, c); if (at !== null) return { row: r, col: at }; }
        return { row: last, col: this.endOf(last) };
    }
  }

  /**
   * The cursor goes `to`; `extend` keeps or starts a selection from where it was. ctrl+End under an answer that ends the
   * note, shut, goes to a line of its own after it (PIE-1741: the callout's last line opened it raw), the line a reload
   * lands on (`landAtEnd`): not a change until something is typed there. One the person opened by hand goes to its end.
   */
  go(to: DraftGo, extend = false) {
    if (to === "doc-end" && !extend && this.endsInShutAnswer()) return this.landAtEnd();
    const p = this.landing(to); this.place(p.row, p.col, extend);
  }
  /** The text's last line is in an answer nobody opened by hand. */
  private endsInShutAnswer() {
    const last = this.lines.length - 1;
    return this.answerFolds().some(p => !this.openedFolds.has(p.key) && last >= p.line && last < p.end);
  }
  /**
   * Where the draft opens, `to` on its line: a landing, not the person's move, so an answer under an ask it lands on stays
   * folded as the live edit draws it (PIE-1733: a reopened edit on an answered ask drew its callout's raw lines).
   */
  land(to: DraftGo) { const p = this.landing(to); this.place(p.row, p.col, false, false); }

  /** The word under the cursor, its line (again: the next line too) or the whole text selected. */
  selectWhat(what: "word" | "line" | "all") {
    if (what === "all") { this.place(0, 0); this.place(this.lines.length - 1, Infinity, true); return; }
    if (what === "word") { const w = wordIn(this.line, this.col); this.place(this.row, w.start); this.place(this.row, w.end, true); return; }
    const s = this.selection(), first = s ? s[0].row : this.row, last = !s ? this.row : s[1].col === this.endOf(s[1].row) && s[0].col === 0 ? s[1].row + 1 : s[1].row;
    this.place(first, 0);
    this.place(Math.min(last, this.lines.length - 1), Infinity, true);
  }

  /** The whole lines a line key acts on: the selection's (one ending at a line's very start leaves that line out), else the cursor's. */
  private wholeLines(): [number, number] {
    const s = this.selection();
    if (!s) return [this.row, this.row];
    return [s[0].row, s[1].col === 0 && s[1].row > s[0].row ? s[1].row - 1 : s[1].row];
  }

  /** The lines at the cursor moved a line up or down, the cursor and the selection with them. How many rows they moved. */
  moveLines(by: -1 | 1): number {
    const [a, b] = this.wholeLines(), L = this.lines;
    if (a + by < 0 || b + by > L.length - 1) return 0;
    const moving = L.splice(a, b - a + 1);
    L.splice(a + by, 0, ...moving);
    this.row += by;
    if (this.anchor) this.anchor.row += by;
    return by;
  }

  /** The lines at the cursor written again above (`up`: the cursor stays on the upper) or below them (it goes to the copy). */
  copyLines(where: "up" | "down") {
    const [a, b] = this.wholeLines(), n = b - a + 1;
    this.lines.splice(b + 1, 0, ...this.lines.slice(a, b + 1));
    if (where === "down") { this.row += n; if (this.anchor) this.anchor.row += n; }
  }

  /** The lines at the cursor taken out; the cursor stays at its column on what comes up to its row. */
  deleteLines() {
    const [a, b] = this.wholeLines();
    this.anchor = null;
    this.lines.splice(a, b - a + 1);
    if (!this.lines.length) this.lines.push("");
    this.row = Math.min(a, this.lines.length - 1);
    this.col = Math.min(this.col, this.endOf(this.row));
  }

  /** The selection, else from the cursor back or on to `to`, taken out. Word-back is what ctrl+w always erased: the word and the spaces after it. */
  erase(to: "word-back" | "word-forward" | "line-start" | "line-end", by: Actor = USER): boolean {
    this.record(USER, "a change");
    const before = this.text;
    if (!this.selection()) {
      this.anchor = { row: this.row, col: this.col };
      if (to === "line-start") this.col = 0;
      else if (to === "line-end") this.col = this.endOf(this.row);
      else if (to === "word-forward") { const p = this.landing("word-forward"); this.row = p.row; this.col = p.col; }
      else if (this.col > 0) this.col = wordEraseStart(this.line, this.col);
      else if (this.row > 0) { this.row--; this.col = this.endOf(this.row); }
    }
    this.deleteSelection();
    this.goal = null;
    if (this.text === before) return false;
    this.wrote(by, "the erase");
    return true;
  }

  /** Erase all of the text (a line field's ctrl+u). One undo step; whether anything went. */
  clear(by: Actor = USER): boolean {
    this.record(USER, "a change");
    const before = this.text;
    this.anchor = { row: 0, col: 0 };
    this.row = this.lines.length - 1; this.col = this.endOf(this.row);
    this.deleteSelection();
    this.anchor = null; this.goal = null;
    if (this.text === before) return false;
    this.wrote(by, "the clear");
    return true;
  }

  /** The selection between `open` and its closer, the same text left selected, so the key again wraps again. One undo step. */
  wrap(open: string, by: Actor = USER) {
    const s = this.selection();
    if (!s) throw new ActionRefused("nothing is selected in the draft · select text (shift+arrows, a drag, draft.place extend=true), then type [ or ( to wrap it");
    this.record(USER, "a change");
    const close = [...open].reverse().map(c => WRAPS[c] ?? c).join("");
    const forward = this.anchor!.row === s[0].row && this.anchor!.col === s[0].col, text = this.text;
    const a = this.offsetOf(s[0].row, s[0].col), b = this.offsetOf(s[1].row, s[1].col);
    this.lines = (text.slice(0, a) + open + text.slice(a, b) + close + text.slice(b)).split("\n");
    const start = this.placeOf(a + open.length), end = this.placeOf(b + open.length);
    this.anchor = forward ? start : end;
    const cursor = forward ? end : start;
    this.row = cursor.row; this.col = cursor.col; this.goal = null;
    this.wrote(by, "the wrap");
  }

  /** Where a cut goes: the door's clipboard; a line field's own (a masked answer's) where it says otherwise. */
  clip(text: string) { lineCompletionHooks.copy?.(text); }

  /** Put the cursor at line `row`, column `col` (UTF-16, clamped); `extend` keeps or starts a selection. */
  place(row: number, col: number, extend = false, select = true) {
    this.follow = true;
    const r = Math.max(0, Math.min(this.lines.length - 1, row));
    if (extend) this.anchor ??= { row: this.row, col: this.col };
    else this.anchor = null;
    this.row = r;
    this.col = Math.max(0, Math.min(this.lines[r]!.length, col));
    if (select) this.selectAsk();
    // Back on where it started, nothing is selected: no anchor for esc to let go. A drag going on starts from the same place.
    if (this.anchor && this.anchor.row === this.row && this.anchor.col === this.col) this.anchor = null;
    this.goal = null;
    // A click lets what's armed go, as any key does: the ctrl+e after ctrl+x and a click is the line's end.
    this.status.letGo();
  }

  /** A key that leaves what's armed as it was: a button's release; for esc and ctrl+z, cmd+c and a cmd key nothing binds (only ctrl+e right after ctrl+x is $EDITOR). */
  private keepsArm(k: Key): boolean {
    if (!disarms(k)) return true;
    if (this.status.armed() === "chord") return false;
    const bound = this.binding(k);
    return bound?.action === "draft.copy" || (k.kind === "super" && !bound);
  }
  /** `k` is the second press of `what`. */
  private confirmsArm(what: DraftArm, k: Key): boolean {
    if (what === "discard") return this.closesBy(k);
    if (what === "undo") return this.binding(k)?.action === "draft.undo" && !("shift" in k && k.shift);
    return !!this.chordBinding(k) || (this.attachChord && k.kind === "char" && !k.ctrl && k.ch === "a");
  }
  /** A key was pressed, whoever goes on to take it (a host's own key comes first): what it can't confirm is let go. */
  heard(k: Key) {
    const what = this.status.armed();
    if (what && !this.keepsArm(k) && !this.confirmsArm(what, k)) this.status.letGo();
  }

  /**
   * A write landed and this text is what it wrote (`at`, its revision): the draft goes on from there. What's typed next
   * is a change to it. Its last step stops at the save, as a draft opened again on it does (PIE-1414).
   */
  wentOnFrom(text: string, at?: number) {
    // What a save wrote is the body: a landing line nothing was typed on stays pending past it (PIE-1578).
    if (text !== this.body) { this.lines = text.split("\n"); this.landingRow = null; this.place(this.lines.length - 1, Infinity); this.undos = []; this.redos = []; }
    else this.undos = this.undos.map((s, i, all) => ({ ...s, open: false, ...(i === all.length - 1 && at !== undefined ? { saved: at } : {}) }));
    this.original = text; this.seen = this.body;
    if (at !== undefined) this.base = at;
    this.restored = null; this.writers = []; this.lastWriter = null;
  }

  // ── the view: soft-wrapped rows, the wheel, the mouse ──────────────────────

  /** The view follows the cursor; false after the wheel scrolled it, until the next key. */
  follow = true;
  /**
   * An open from a reader that had scrolled off its reading line (PIE-1579): the first draw moves a cursor out of view
   * onto the first row with text in view, so the first key lands where the person is looking and nothing jumps.
   */
  landInView = false;
  /** Where that first draw put the cursor: an edit closed with the cursor still here leaves the reading line alone. */
  landed: { row: number; col: number } | null = null;
  get stillLanded() { return !!this.landed && this.landed.row === this.row && this.landed.col === this.col; }
  /** The column up and down keep to (cells from the row's left), while they repeat. */
  goal: number | null = null;
  /**
   * The cursor came onto an ask's line: its answer is shown beside the note. Its fold under the ask stays as it was
   * (PIE-1738: a saved answer drew its callout's raw lines the moment the cursor reached its ask); entering the callout
   * opens it and leaving shuts it (`answerOpen`), and the answer tile's fold or fold.toggle opens and shuts it.
   */
  private selectAsk() {
    const answer = this.answerFolds().find(p => p.line === this.row + 1);
    if (!answer && !this.asks.has(this.line)) return;
    this.selectedAsk = this.line;
    this.onAskSelected?.(this.line, answer?.key);
  }

  /** The status of the ask `line` says; `row`, the line it is on, picks which of the lines saying it (the first when left out). */
  askStatus(line: string, room = Infinity, row?: number): string {
    const nth = row === undefined ? 0 : this.lines.slice(0, row).filter(l => l === line).length;
    // A saved answer has no progress of its own (the ask was answered before this draft opened): its fold row says what
    // its callout does, as a live one's progress would (PIE-1738), so a shut answer is never only missing lines.
    // One wording for an ask that was answered when this draft opened (PIE-1741), whichever door reads it: `· answered`,
    // never the progress one door kept from watching it land (`· found 1 note · beside ▸`) or the service replays at the
    // first key. An answer landing while this draft is open says its own progress; asked again, under way, it does too.
    const key = Draft.askKey(line, nth), live = this.asks.get(key), saved = row === undefined ? undefined : this.savedAnswer(row);
    const ask = saved && (!live || (this.answeredAtOpen().has(key) && (ANSWERED_ASK_STATES.has(live.state) || live.state === "answered"))) ? saved : live ?? saved;
    if (!ask) return "";
    const where = this.answerSaid(ask, row, ask === saved);
    if (ask.warning) {
      // Beside its line while that fits (a row of its own moves what's typed below it): the count gives way first (PIE-1775),
      // the answer's side never (PIE-1791: a 44-column row named no tile under it); narrower, all of it takes its own row.
      const warn = ` · ${ask.warning}`, blocks = ask.blocks ? ` · ${ask.blocks} block${ask.blocks === 1 ? "" : "s"}` : "";
      return [warn + blocks + where, warn + where].find(t => width(t) <= room) ?? warn + blocks + where;
    }
    const short = ` · ${ask.state}${where}`;
    const full = ` · ${ask.state}${ask.blocks ? ` · ${ask.blocks} block${ask.blocks === 1 ? "" : "s"}` : ""}${where}`;
    return width(full) <= room ? full : short;
  }

  /**
   * Where the answer tile beside this draft's reader is and which line's answer it shows (its host's desk says, PIE-1757,
   * PIE-1768); undefined where no desk holds answer tiles (a float, no desk).
   */
  answerAt: (() => AnswerPlace | undefined) | null = null;
  /**
   * `answerAt`, asked once a draw (Codex on #1466: asked again for every ask's row, a long note's frame took three
   * times as long): `drawing` holds the answer for the frame it draws; outside one, each status asks afresh.
   */
  private answerPlace(): AnswerPlace | undefined { const now = this.placeNow; if (now && !now.asked) Object.assign(now, { asked: true, at: this.answerAt?.() ?? undefined }); return now ? now.at : this.answerAt?.() ?? undefined; }
  private placeNow: { asked: boolean; at?: AnswerPlace } | null = null;
  /** The answer under fold `p` to the tile beside, when one can show answers and isn't showing this one: whether it went. */
  showInTile(p: { line: number; key: string }): boolean { const at = this.answerPlace(), ask = this.lines[p.line - 1]; if (!at || !ask || (at.side && at.row === p.line - 1)) return false; this.selectedAsk = ask; this.onAskSelected?.(ask, p.key); return true; }
  /** A frame of this draft, with `answerAt` asked at most once for all its rows. */ drawing<T>(draw: () => T): T { if (this.placeNow) return draw(); this.placeNow = { asked: false }; try { return draw(); } finally { this.placeNow = null; } }
  private answerSaid(ask: { line: string; beside?: boolean }, row: number | undefined, saved: boolean): string { const words = this.answerWords(ask, row, saved); return words ? ` · ${words}` : ""; }
  /**
   * Where an ask's answer is, as its row says it. The one answer tile shows one line's answer (PIE-1768): that row names
   * the tile's side (beside ▸, below ▾, in a tab), a saved answer's too; every other ask with an answer to show, saved or
   * on its way, says `show ▸`, which the cursor or a click on it does (PIE-1758). The tile's own status (no `row`) is the
   * ask it shows. Where no desk holds tiles, nothing.
   */
  private answerWords(ask: { line: string; beside?: boolean }, row: number | undefined, saved: boolean): string {
    const at = this.answerPlace();
    if (!at) return "";
    // A tile on no clear side of its reader (overlapping it, PIE-1768) is named by its number, never `show ▸`.
    if (at.side && (row === undefined ? at.ask === ask.line : at.row === row)) return at.side === "apart" ? `in tile ${at.n ?? "?"}` : ANSWER_WORDS[at.side];
    return ask.beside || saved ? ANSWER_HIDDEN : "";
  }

  /** The asks (`askKey`) the text this draft opened on (or reloaded) already had an answer under. */
  private answeredAtOpen(): Set<string> {
    if (this.openAnswers?.text !== this.original) {
      const lines = this.original.split("\n"), keys = new Set<string>();
      for (const p of foldPoints(this.original)) {
        const ask = lines[p.line - 1] ?? "", name = ask.trim().split(/\s+/, 1)[0] ?? "";
        if (p.kind !== "callout" || !name.startsWith("@") || p.text !== `${name} answered`) continue;
        keys.add(Draft.askKey(ask, lines.slice(0, p.line - 1).filter(l => l === ask).length));
      }
      this.openAnswers = { text: this.original, keys };
    }
    return this.openAnswers.keys;
  }
  private openAnswers: { text: string; keys: Set<string> } | null = null;

  /** The answer folded under the ask on line `row`, as an ask's progress reads: answered (how many blocks is the service's to count). */
  private savedAnswer(row: number): import("@ep0ch/outline-core/protocol").AskProgress | undefined {
    return this.answerFolds().some(p => p.line === row + 1) ? { line: this.lines[row]!, state: "answered" } : undefined;
  }

  answerFolds() {
    const text = this.text;
    if (this.foldCache?.text !== text) this.foldCache = { text, points: foldPoints(text) };
    return this.foldCache.points.filter(p => {
      const ask = this.lines[p.line - 1]?.trim() ?? "";
      return p.kind === "callout" && ask.startsWith("@") && p.text === `${ask.split(/\s+/, 1)[0]} answered`;
    });
  }

  /**
   * Whether the answer `p` is drawn open, the one answer to it (PIE-1741): opened by hand (`openedFolds`) until shut by
   * hand, else while the cursor, or a selection's other end, is in it. The cursor leaving shuts what the cursor opened;
   * the ask alone opens nothing.
   */
  answerOpen(p: FoldPoint): boolean {
    if (this.openedFolds.has(p.key) || this.heldOpen?.has(p.key)) return true;
    const inside = (row: number) => row >= p.line && row < p.end;
    return inside(this.row) || (!!this.anchor && inside(this.anchor.row));
  }

  /**
   * Open or shut the answer `p` by hand; shut with the cursor in it, the cursor goes back to its ask. True when it is now
   * shut. An agent never moves the person's cursor or selection (CodeRabbit on #1442): with them in it, its shut is refused.
   */
  toggleAnswer(p: FoldPoint, by: Actor = USER) {
    // As it was drawn when pressed (a click on its fold row comes at the release): the press's hold lets it go.
    const was = this.answerOpen(p);
    this.heldOpen?.delete(p.key);
    if (was) {
      const had = this.openedFolds.delete(p.key);
      if (this.answerOpen(p) && by.kind === "agent") {
        if (had) this.openedFolds.add(p.key);
        throw new ActionRefused("the person's cursor is in this answer: it folds when they leave it");
      }
      if (this.answerOpen(p)) this.place(p.line - 1, 0);
    } else this.openedFolds.add(p.key);
    return !this.answerOpen(p);
  }

  /** The lines of every answer drawn shut (`answerOpen`). */
  hiddenAnswerLines(): Set<number> {
    const hidden = new Set<number>();
    for (const p of this.answerFolds()) if (!this.answerOpen(p)) for (let i = p.line; i < p.end; i++) hidden.add(i);
    return hidden;
  }
}


/** The keys that select with shift held (`Draft.key`). */
/** An ask row's words for where its answer tile is, by its side of the pair with the reader (PIE-1757). */
const ANSWER_WORDS = { right: "beside ▸", left: "◂ beside", down: "below ▾", up: "above ▴", tab: "in a tab" } as const;
/** Where the answer tile beside a draft's reader is (`side`, null with none open), the ask it shows and that ask's line. */
export interface AnswerPlace { side: "left" | "right" | "up" | "down" | "tab" | "apart" | null; n?: number; ask?: string; row?: number }
/** An answer no tile shows: a click on its row (or the cursor onto its ask) shows it. */
const ANSWER_HIDDEN = "show ▸";
const SELECTING = new Set<Key["kind"]>(["left", "right", "up", "down", "home", "end", "pgup", "pgdn"]);

export { hangOf, wrapRows, type VRow } from "./draft-view";

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

/** A path as the person would type it: their home as `~`. */
export const tidy = (p: string) => { const h = process.env.HOME; return h && p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

/** "10:42" today, or "Sep 29 10:42". */
export const whenPut = (at: number) => {
  const d = new Date(at), t = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? t : `${d.toDateString().slice(4, 10)} ${t}`;
};

// ── the draft's actions: keys, clicks and `act` all run these ───────────────

export type DraftActionArgs = ArgsOfSet<typeof DRAFT_ACTIONS>;
/** Where `draft.go` takes the cursor. */
export type DraftGo = "line-start" | "line-end" | "doc-start" | "doc-end" | "word-back" | "word-forward";
const DRAFT_GOES = ["line-start", "line-end", "doc-start", "doc-end", "word-back", "word-forward"] as const;
/** The keys a table row of these names, for an action's def (the row's own words say what each does). */
const rowKeys = (action: string, args: Record<string, unknown> = {}) => [...DRAFT_KEYS, ...LINE_KEYS].filter(r => r.action === action && Object.entries(args).every(([k, v]) => r.args?.[k] === v)).map(r => r.key).join(" ");

/**
 * What the draft does besides typing, as actions: Enter's list continuation, Tab and Shift+Tab, a click or a
 * drag (place), the wheel (scroll) and the preview. The keys and the mouse call these; so does `act`
 * (through the note actions of the same names), where the draft session's agent rule decides first
 * (`agentRefusal`: a draft the agent opened and alone typed in).
 */
export const DRAFT_ACTIONS = actionSet<Draft>()("draft", {
  "snippet.next": def({ summary: "select the next snippet slot; after the last, finish the snippet", keys: "tab, click next slot", touches: "draft", draft: "type", replay: "safe", args: {},
    run(_, d) { return d.moveSnippet(1); } }),
  "snippet.previous": def({ summary: "select the previous snippet slot", keys: "shift+tab, click previous slot", touches: "draft", draft: "type", replay: "safe", args: {},
    run(_, d) { return d.moveSnippet(-1); } }),
  "snippet.end": def({ summary: "finish the snippet, keeping its text and one undo step", keys: "esc, click end snippet", touches: "draft", draft: "type", replay: "safe", args: {},
    run(_, d) { d.endSnippet(); return { ended: true }; } }),
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
    summary: "indent the cursor's line (or the selection's lines, or from..to) one level: a list item goes under the item above", keys: rowKeys("draft.indent"),
    touches: "draft", draft: "type", replay: "ask",
    args: { from: { type: "number", optional: true, about: "first line, from 1" }, to: { type: "number", optional: true, about: "last line, from 1" } },
    examples: [
      { act: "draft.indent", does: "indents the cursor's line, or the selected lines, one level" },
      { act: "draft.indent from=3 to=5", does: "indents lines 3 to 5 one level" },
    ],
    run({ from, to }, d, actor) { const n = from ? d.indent(1, from - 1, (to ?? from) - 1) : d.indent(1); if (n) d.wrote(actor); return { lines: n }; },
  }),
  "draft.outdent": def({
    summary: "outdent the cursor's line (or the selection's lines, or from..to) one level: a list item back to its parent's", keys: rowKeys("draft.outdent"),
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
    run({ line, col, extend }, d, _actor) { d.place(line - 1, col === undefined ? Infinity : col - 1, !!extend); d.follow = true; return { line: d.row + 1, col: d.col + 1 }; },
  }),
  "draft.go": def({
    summary: "move the draft's cursor: to the line's start or end, the text's beginning or end, or a word back or forward; extend=true selects from where it was. Word motions step over to the next line at a line's edge; the end under a shut answer that ends the note is a line of its own after it",
    keys: rowKeys("draft.go"), touches: "draft", draft: "type", replay: "safe",
    args: { to: { type: "string", about: `one of: ${DRAFT_GOES.join(", ")}` }, extend: { type: "boolean", optional: true, about: "select from the cursor to there" } },
    examples: [
      { act: "draft.go to=line-end extend=true", does: "selects from the cursor to the end of its line, as cmd+shift+→ does" },
      { act: "draft.go to=doc-start", does: "puts the cursor at the beginning of the text" },
    ],
    run({ to, extend }, d) {
      if (!(DRAFT_GOES as readonly string[]).includes(to)) throw new ActionRefused(`draft.go takes to=${DRAFT_GOES.join("|")}, not ${to} · draft.go to=line-end extend=true`);
      d.go(to as DraftGo, !!extend);
      return { line: d.row + 1, col: d.col + 1, selected: d.selectedText()?.length ?? 0 };
    },
  }),
  "draft.select": def({
    summary: "select the word under the cursor, its line (again: the next line too) or the whole text",
    keys: rowKeys("draft.select"), touches: "draft", draft: "type", replay: "safe",
    args: { what: { type: "string", about: "word, line or all" } },
    examples: [{ act: "draft.select what=line", does: "selects the cursor's line; run again it takes in the next line" }],
    run({ what }, d) {
      if (what !== "word" && what !== "line" && what !== "all") throw new ActionRefused(`draft.select takes what=word|line|all, not ${what} · draft.select what=line`);
      d.selectWhat(what);
      return { text: d.selectedText() ?? "" };
    },
  }),
  "draft.line": def({
    summary: "act on the cursor's line or the selected lines: op=up or down moves them, copy-up or copy-down writes them again, delete takes them out. One undo step each",
    keys: rowKeys("draft.line"), touches: "draft", draft: "type", replay: "ask",
    args: { op: { type: "string", about: "up, down, copy-up, copy-down or delete" } },
    examples: [
      { act: "draft.line op=up", does: "moves the cursor's line, or the selected lines, up one line" },
      { act: "draft.line op=copy-down", does: "writes the line again below itself and goes to the copy" },
    ],
    run({ op }, d, actor) {
      const was = d.text;
      if (op === "up" || op === "down") d.moveLines(op === "up" ? -1 : 1);
      else if (op === "copy-up" || op === "copy-down") d.copyLines(op === "copy-up" ? "up" : "down");
      else if (op === "delete") d.deleteLines();
      else throw new ActionRefused(`draft.line takes op=up|down|copy-up|copy-down|delete, not ${op} · draft.line op=up`);
      d.follow = true; d.goal = null;
      if (d.text !== was) d.wrote(actor, op === "delete" ? "the line's delete" : op === "up" || op === "down" ? "the line's move" : "the line's copy");
      return { line: d.row + 1, changed: d.text !== was };
    },
  }),
  "draft.erase": def({
    summary: "erase from the cursor to: word-back, word-forward, line-start or line-end; the selection instead, if any. One undo step",
    keys: rowKeys("draft.erase"), touches: "draft", draft: "type", replay: "ask",
    args: { to: { type: "string", about: "word-back, word-forward, line-start or line-end" } },
    examples: [{ act: "draft.erase to=word-back", does: "erases the word before the cursor, as alt+backspace does" }],
    run({ to }, d, actor) {
      if (to !== "word-back" && to !== "word-forward" && to !== "line-start" && to !== "line-end") throw new ActionRefused(`draft.erase takes to=word-back|word-forward|line-start|line-end, not ${to} · draft.erase to=word-back`);
      return { erased: d.erase(to, actor) };
    },
  }),
  "draft.clear": def({
    summary: "erase the whole text of the draft, the selection or not. One undo step",
    keys: rowKeys("draft.clear"), touches: "draft", draft: "type", replay: "ask",
    args: {},
    examples: [{ act: "draft.clear", does: "empties the draft; ctrl+z puts it back" }],
    run(_, d, actor) { return { cleared: d.clear(actor) }; },
  }),
  "draft.cut": def({
    summary: "take the selected text out, returned. The person's goes on their clipboard (OSC 52; an agent's never), as draft.copy's does. One undo step",
    keys: rowKeys("draft.cut"), touches: "draft", draft: "type", replay: "ask",
    args: {},
    run(_, d, actor) {
      const text = d.selectedText();
      if (!text) throw new ActionRefused("nothing is selected in the draft · select text (shift+arrows, a drag), then cmd+x or alt+x");
      if (actor.kind === "user") d.clip(text);
      d.erase("line-end", actor);
      return { text, chars: [...text].length };
    },
  }),
  "draft.wrap": def({
    summary: `wrap the selected text: with=[[ makes [[text]], with=** makes **text**, the text left selected. Typing ${Object.keys(WRAPS).join(" ")} over a selection does it a key at a time. One undo step`,
    keys: [{ keys: Object.keys(WRAPS).join(" "), does: "typed over a selection" }, { keys: "click", does: "the hint's wraps" }], touches: "draft", draft: "type", replay: "ask",
    args: { with: { type: "string", about: "what opens it; the closer is its mirror" } },
    examples: [{ act: "draft.wrap with=[[", does: "turns the selected text into a [[page]] link" }],
    run({ with: open }, d, actor) { d.wrap(open, actor); return { text: d.selectedText() ?? "", line: d.row + 1 }; },
  }),
  "draft.scroll": def({
    summary: "scroll the draft's view by rows; the cursor stays (the next key brings it back into view). preview=true scrolls its preview instead (PIE-846), until the text changes", keys: [{ keys: "wheel", does: "over the text, or over the preview" }],
    touches: "draft", draft: "type", replay: "safe",
    args: { by: { type: "number", about: "rows, negative up" }, preview: { type: "boolean", optional: true, about: "scroll the preview under the text (ctrl+p shows it)" }, page: { type: "boolean", optional: true, about: "by= counts pages (the rows shown, less one: PgUp PgDn), not rows" } },
    examples: [
      { act: "draft.scroll by=10", does: "scrolls the draft's view down ten rows, the cursor staying put" },
      { act: "draft.scroll by=-5 preview=true", does: "scrolls the preview up five rows" },
    ],
    run({ by, preview, page }, d, _actor) {
      const v = draftView(d);
      if (!preview) { v.scrollBy(page ? Math.sign(by) * v.pageRows() : by); return { following: d.follow }; }
      const p = v.frame?.preview;
      if (!v.preview || !p) throw new ActionRefused("the preview isn't shown · ctrl+p (draft.preview) shows it");
      if (page) by = Math.sign(by) * pageRows(p.rows);
      const top = Math.max(0, Math.min(Math.max(0, p.total - (p.rows - 1)), p.top + by));
      const projected = new PositionRows(new ReaderPosition());
      projected.source = p.source;
      projected.top = top;
      const view = projected.position.view;
      v.previewScroll = view ? { lineDelta: view.line - d.row, row: view.row, text: d.text } : null;
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
    summary: "take back the last change in this draft, whoever made it: typing (a word or a pause at a time), a paste (one step, however big), an insert, an agent's draft.patch; back to where the draft started. In a note opened again on what was saved, it stops at the save and asks, its line counting the 5 s window down (ctrl+z again in 4s): ctrl+z again (or past=true) takes saved text back, a step at a time; a save that agents wrote after (yo taking out the answer of an ask it deleted) goes back whole with their writes, in one undo. An agent takes back only its own: its newest step, else its last patch where it is now, never saved text", keys: "ctrl+z",
    touches: "draft", draft: "safe", replay: "ask",
    args: { past: { type: "boolean", optional: true, about: "go past the save: take back text the note already holds (ctrl+z pressed again after it asked)" } },
    personWith: ({ past }) => (past ? { always: "going past a save takes back text the note already holds: only the person does that (their ctrl+z, pressed again after it asks)" } : null),
    examples: [
      { act: "draft.undo", does: "takes back the newest change; in a note opened again after a save, stops there and answers asks" },
      { act: "draft.undo past=true", does: "the person goes past the save: takes back text from before it (the saved revision stays in the note's history)" },
    ],
    async run({ past }, d, actor) {
      const r = d.undoStep(actor, past === true);
      return r.asked ? { asks: r.said, left: d.undos.length } : { undone: r.said, left: d.undos.length, redo: d.redos.length };
    },
  }),
  "draft.redo": def({
    words: "put back what you undid",
    summary: "put back what draft.undo took back, in order (a save it took back whole with the agents' writes after it goes back whole); any new change drops what could be put back. An agent puts back only its own", keys: [{ keys: "ctrl+y", does: "redo", says: "put back the change you undid" }, { via: "ctrl+shift+z (redo)" }],
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
    run({ on }, d) { const v = draftView(d); v.preview = on ?? !v.preview; return { preview: v.preview }; },
  }),
  "draft.copy": def({
    summary: "the draft's selected text, returned. The host puts the person's on their clipboard (OSC 52; an agent's never) and says \"copied N chars\". A selection made with the mouse copies when the button comes up, as in a reader (EP0CH_COPY_ON_SELECT=0 turns it off); one made by keys (shift+arrows) is copied by cmd+c, alt+c or the frame's [copy]", keys: [{ keys: "cmd+c alt+c", does: "copy", says: "copy the selected text of the draft" }, { keys: "click", does: "the frame's [copy]" }, { keys: "drag", does: "the release of a drag copies" }],
    touches: "draft", draft: "type", replay: "safe",
    args: {},
    run(_, d, _actor) {
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
/** `props` with the chips `before` held and `after` doesn't taken out, and the ones `after` adds put in. */
const chipsMoved = (props: PropertyList, before: string, after: string): PropertyList => {
  const chips = (text: string) => parsePropertyRecords(text).map(p => `${p.key}\u0000${p.value}`);
  const less = (from: string[], take: string[]) => { const left = [...from]; for (const c of take) { const i = left.indexOf(c); if (i >= 0) left.splice(i, 1); } return left; };
  const was = chips(before), now = chips(after), out = [...props];
  for (const gone of less(was, now)) { const i = out.findIndex(p => `${p.key}\u0000${p.value}` === gone); if (i >= 0) out.splice(i, 1); }
  return [...out, ...less(now, was).map(c => { const [key, value] = c.split("\u0000") as [string, string]; return { key, value }; })];
};
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
