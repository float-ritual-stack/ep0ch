// The reader's keys (PIE-1527), one table. Every key a note being read answers is a row here, in the order the reader
// looks a key up: the reader's key() is a lookup over it (readerBinding), and what reads the reader's keys reads this
// table: the keys window and the keymap (a `keyTable`, as the ^W keys are), the hint rows (STEP_KEYS, READING_KEYS …),
// the note actions' own keys (readerKeys), the session keys the desk hands a reader (sessionStart) and the keys an
// extension's line can't take (READER_OWN_KEYS). A key bound twice says the guard that picks (`when`); a row that runs
// one of several actions by what's in front of the reader names the choice (`pick`) and the actions it can run (`runs`).
// Keys a current element's own table answers first (a figure's, an image's, a collection row's, a selection's) are those
// tables', asked before this one.
import { keyCaption, type KeyRow } from "./actions";
import { effective, keyTable } from "./keymap";
import type { ModeKey } from "./modes";
import { REORDER_KEYS } from "./attached-keys";
import type { Key } from "../term";
import { keyName } from "./actions";
import type { SessionKind } from "./note";

/** What must hold for a row to take its key, each in the words the keys window says it. */
export const READER_GUARDS = {
  note: "a note is shown",
  whole: "a whole note is shown (not a list's row of it)",
  outline: "the note is the outline's",
  parent: "the note has a parent",
  preview: "it is a list's preview of a row's children",
  resolvable: "a proposal shown here can be resolved",
  proposal: "a proposal is shown, or is the current element",
  element: "an element is current ([ ] or a click)",
  tinted: "someone's focus mark is on the note",
  zoomed: "a part of the note is zoomed",
  settings: "the note has settings",
  task: "a step is the current element",
  detach: "the reader sits on a desk",
} as const;
export type ReaderGuard = keyof typeof READER_GUARDS;

/**
 * What the reader decides at the key, from what's in front of it: `page` scrolls a page of the room drawn, `fold-all`
 * folds every section or unfolds them, `task` toggles the current step, `undo` takes back the newest change made here
 * (of the `runs`), `enter` acts on the current element (a link follows, a fold toggles, a button presses), `detach`
 * puts the part read into a tile of its own.
 */
export type ReaderPick = "page" | "fold-all" | "task" | "undo" | "enter" | "detach";

export interface ReaderKey extends ModeKey {
  /** Every guard must hold, else the key falls to the next row (and then out of the reader). */
  readonly when?: readonly ReaderGuard[];
  readonly pick?: ReaderPick;
  /** The actions a `pick` can run besides `action`: their keys name this row's key too. */
  readonly runs?: readonly string[];
  /** A key that starts a session as the person (the note's SESSION_ACTIONS): an edit, a comment, the panel. */
  readonly start?: SessionKind;
  /** Its refusal is said where it happened (the action's own flash), not again in the status bar. */
  readonly quiet?: true;
}

const r = (key: string, action: string, more: Partial<ReaderKey> = {}): ReaderKey => ({ key, action, ...more });
const WHOLE: readonly ReaderGuard[] = ["whole"];
const OUTLINE: readonly ReaderGuard[] = ["whole", "outline"];
const UP = "step to the block or row above", DOWN = "step to the block or row below";
const END = "scroll to the last line, then (again) past it to the middle";
const UNDONE = ["edit.strays", "callout.undo", "image.undo", "use.undo", "sources.undo", "ext.undo", "note.move.undo", "settings.undo", "note.untrash"];

/** Zoom into a part of a reader's note (PIE-780): W on the part the [ ] position (else the reading line) is in; esc returns. */
export const ZOOM_KEYS: readonly ReaderKey[] = [
  r("W", "element.zoom", { label: "zoom into this part", when: OUTLINE }),
  r("esc", "element.zoom", { label: "whole note", args: { on: false }, when: ["zoomed", ...OUTLINE] }),
];

/** Every key of a note being read, first first: the first row whose key matches and whose guards hold runs. */
export const READER_KEYS = keyTable<ReaderKey>("reader", "a note being read", [
  // Back, forward and the trail (PIE-453, PIE-208): alt+b alt+f too, which some macOS terminals send for option+← →.
  r("alt+left", "back", { label: "back" }), r("alt+b", "back", { label: "back" }), r("backspace", "back", { label: "back" }),
  r("alt+right", "forward", { label: "forward" }), r("alt+f", "forward", { label: "forward" }),
  r("alt+T", "trail", { label: "trail" }),
  r("~", "decor.raw"),
  // A list's preview of a row's children (the board's): ↑ ↓ scroll it, e edits them.
  r("up", "list.preview.scroll", { args: { by: -1 }, when: ["preview"] }), r("k", "list.preview.scroll", { args: { by: -1 }, when: ["preview"] }),
  r("down", "list.preview.scroll", { args: { by: 1 }, when: ["preview"] }), r("j", "list.preview.scroll", { args: { by: 1 }, when: ["preview"] }),
  r("e", "list.preview.edit", { when: ["preview"] }),
  r('"', "note.quote", { when: ["note"] }),
  // A session as the person (SESSION_ACTIONS): e and ctrl+e arm the edit first (edit.arm), the rest start at once.
  r("t", "note.thread", { start: "note-thread", label: "thread", says: "open the note's replies in place", when: ["note"] }),
  r("R", "note.reply", { start: "note-reply", label: "reply", when: ["note"] }),
  r("e", "edit.arm", { start: "edit", label: "edit", when: ["note"] }),
  r("ctrl+e", "edit.arm", { start: "external", args: { external: true }, label: "edit in $EDITOR", when: ["note"] }),
  r("C", "passage.select", { start: "comment", label: "comment", when: ["note"] }),
  r("m", "threads", { start: "threads", label: "comments", says: "show the note's comment threads", when: ["note"] }),
  r("i", "props", { start: "props", label: "properties", says: "open the property panel", when: ["note"] }),
  r("I", "props", { start: "props-full", args: { full: true }, label: "all properties", when: ["note"] }),
  // A proposal (PIE-501): the one shown, or the one whose embed or control is the current element.
  r("r", "proposal.resolve", { label: "resolve", when: ["note", "resolvable"] }),
  r("A", "proposal.apply", { label: "apply anyway", when: ["note", "proposal"] }),
  r("X", "proposal.dismiss", { label: "dismiss", when: ["note", "proposal"] }),
  // esc lets go of the current element, then of a focus mark, then of a zoom.
  r("esc", "element.select", { args: { n: 0 }, label: "lets go", says: "let go of the element you are on", when: ["element"] }),
  r("esc", "block.untint", { label: "lets go of the mark", when: ["tinted"] }),
  ...ZOOM_KEYS,
  r("up", "reading.step", { args: { by: -1 }, label: "blocks/rows", says: UP }), r("down", "reading.step", { args: { by: 1 }, label: "blocks/rows", says: DOWN }),
  r("j", "reading.step", { args: { by: 1 }, label: "blocks/rows", says: DOWN }), r("k", "reading.step", { args: { by: -1 }, label: "blocks/rows", says: UP }),
  r("space", "task.status", { pick: "task", label: "done/to do", when: ["task"], quiet: true }),
  r("ctrl+z", "task.undo", { pick: "undo", runs: UNDONE, label: "undo", says: "undo the newest change made here: a step's status, a callout, an image, a fill, a source, an extension's line, a move, a setting", quiet: true }),
  r("pgdn", "scroll", { pick: "page", args: { by: 1 }, label: "page", says: "scroll the note a page down" }), r("space", "scroll", { pick: "page", args: { by: 1 }, label: "page", says: "scroll the note a page down" }),
  r("pgup", "scroll", { pick: "page", args: { by: -1 }, label: "page", says: "scroll the note a page up" }),
  // Home to the top; End or G to the last line, then (pressed again) past it to the middle (PIE-622).
  r("home", "scroll", { args: { to: "top" }, label: "top", says: "scroll to the top of the note" }), r("end", "scroll", { args: { to: "end" }, label: "end", says: END }), r("G", "scroll", { args: { to: "end" }, label: "end", says: END }),
  // [ ] walk every element in reading order (PIE-441); ( ) the folds only.
  r("[", "element.select", { args: { by: -1 }, label: "elements", says: "select the previous element" }), r("]", "element.select", { args: { by: 1 }, label: "elements", says: "select the next element" }),
  r("z", "callouts", { label: "callouts", says: "open every callout, or put them back as written" }),
  r(",", "settings", { label: "settings", when: [...OUTLINE, "settings"] }),
  r("enter", "element.open", { pick: "enter", runs: ["fold.toggle", "button.press", "link.follow"], label: "open", says: "act on the current element: open it, follow its link, toggle its fold or press its button" }),
  r("alt+enter", "element.open", { pick: "enter", args: { fresh: true }, runs: ["button.press", "link.follow"], label: "new", says: "open the current element in a new reader, or run a control's alt action" }),
  r("(", "fold.select", { args: { by: -1 }, label: "sections", says: "select the previous heading, list item or callout", when: WHOLE }), r(")", "fold.select", { args: { by: 1 }, label: "sections", says: "select the next heading, list item or callout", when: WHOLE }),
  r("f", "fold.toggle", { label: "fold", when: WHOLE }),
  r("F", "fold", { pick: "fold-all", args: { all: true }, runs: ["unfold"], label: "all", says: "fold every section, or unfold them all when some are folded", when: WHOLE }),
  r("u", "up", { label: "up", says: "go to the note's parent", when: ["parent"], quiet: true }),
  ...REORDER_KEYS.filter(b => b.action === "note.move" && b.args?.step !== "in" && b.args?.step !== "out").map(b => ({ ...b, when: OUTLINE })),
  r("alt+z", "note.route", { label: "route by rules", when: OUTLINE }), r("alt+Z", "note.route", { args: { dry: true }, label: "says what would move, moving nothing", when: OUTLINE }),
  r("alt+D", "element.detach", { pick: "detach", label: "detach", when: [...OUTLINE, "detach"] }),
  r("b", "links", { label: "links", when: WHOLE, quiet: true }),
  r("M", "margin", { label: "comments mode", says: "cycle the margin's cards: trim, full, off (as marks)", when: WHOLE }),
  r("r", "projection.refresh", { label: "fetch again", when: ["outline"], quiet: true }),
  r("S", "sources.open", { label: "sources", says: "show where this note's generated parts come from", when: OUTLINE }),
]);

/** Keys the reader keeps without binding them: each is said, so a person who reaches for it learns the one that does. */
export const READER_SAYS: Readonly<Record<string, string>> = { c: "nothing collapses here · C comments on a passage" };

/** A gesture is the drawn hit's, never a row's key. */
const GESTURE = new Set(["click", "drag", "wheel", "hover", "sideways"]);

/**
 * The row key `k` runs in a reader, the keymap applied: the first whose key matches and whose guards all hold (`holds`
 * answers each guard for the reader the key is in). Undefined when no row takes it.
 */
export function readerBinding(k: Key, holds: (g: ReaderGuard) => boolean): ReaderKey | undefined {
  const name = keyName(k);
  if (name === null || GESTURE.has(name)) return undefined;
  return effective(READER_KEYS).find(row => row.key === name && (row.when ?? []).every(holds));
}

/** The session a reader's key starts as the person (an edit, a comment, the panel): the table's `start` rows. */
export function sessionStart(k: Key): SessionKind | null {
  const name = keyName(k);
  return effective(READER_KEYS).find(row => row.start && row.key === name)?.start ?? null;
}

/**
 * The note action `action`'s keys in a reader, as its def's `keys` rows: the table's keys that run it (or a pick that
 * can), each said with what it does there, then `more` (a click, the ways outside a reader).
 */
export function readerKeys(action: string, ...more: KeyRow[]): KeyRow[] {
  const rows = READER_KEYS.filter(row => row.action === action || row.runs?.includes(action));
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const does = row.says ?? ([row.label, row.when?.length ? `when ${row.when.map(g => READER_GUARDS[g]).join(" and ")}` : ""].filter(Boolean).join(", ") || "in a reader");
    groups.set(does, [...(groups.get(does) ?? []), keyCaption(row.key)]);
  }
  return [...[...groups].map(([does, keys]) => ({ keys: keys.join(" "), does })), ...more];
}

/**
 * The keys a reader keeps while one of its elements is current: an extension's key never shadows them (it still runs by
 * a click on its control and by `act`). The table's one-character keys, what the reader says (READER_SAYS), and the
 * selection's (v V y Y, and h l moving its end: src/surface/selection.ts, asked before this table). Keys a layer over the
 * tile takes (q ? / g, a screen's digits) never reach a reader; a host's own it names itself (SurfaceHost.ownKeys).
 */
export const READER_OWN_KEYS: ReadonlySet<string> = new Set([
  ...READER_KEYS.map(row => row.key === "space" ? " " : row.key).filter(key => [...key].length === 1),
  ...Object.keys(READER_SAYS),
  ..."vVyYhl",
]);

// ── the reader's hint rows (PIE-1293): rows of the table, as the hint row names them ──
const rowsOf = (action: string, keys: readonly string[]) => keys.map(key => READER_KEYS.find(row => row.key === key && row.action === action)!);
/** ↑ ↓ j k: a block (or a figure's row) at a time. */
export const STEP_KEYS: readonly ModeKey[] = rowsOf("reading.step", ["up", "down", "j", "k"]);
export const ELEMENT_STEP_KEYS: readonly ModeKey[] = rowsOf("element.select", ["[", "]"]);
export const SECTION_KEYS: readonly ModeKey[] = rowsOf("fold.select", ["(", ")"]);
/** The reading keys the hint row names after the steps, in the order it names them. */
export const READING_KEYS: readonly ModeKey[] = ["f", "M", "R", "t", "i", "z", "u", "C", "m"].map(key => READER_KEYS.find(row => row.key === key && !row.when?.includes("preview"))!);
