// The reader's producers for the undo journal (undo-journal.ts, Nov 3 review card 15): each kind of change a reader
// makes to a note says what takes it back and how it is labelled, and ctrl+z reads the note's journal for the newest.
import { statusWord, type UndoEntry } from "../steps";
import { printable } from "../text";
import { NOTE_JOURNAL, newestOf, SETTINGS_JOURNAL, UndoHistory, type Journaled } from "../undo-journal";

/** One line of a note rewritten: its index, its text as it was read, and what it became. `picture`: who the line is, so an undo finds it wherever it has moved to. */
export interface LineEdit { line: number; before: string; after: string; picture?: string }
/** A change of whole lines (a callout's header, an image's layout) for undo. */
export interface LineUndo {
  patch?: { start: number }; block: string; edits: LineEdit[]; by: string; context: string;
  /** What the press this write finished did (PIE-1666): its run's undo, or the layout step it took, taken back with it. */
  then?: { run: string } | { layout: number };
}

const lines = (what: string) => (e: LineUndo) => `${what} ${printable(e.edits[0]?.after.trim() ?? "")}`;
/** The step changes made in readers, for Undo (ctrl+z, `task.undo`): each party undoes its own. */
export const STEP_HISTORY = new UndoHistory<UndoEntry>(NOTE_JOURNAL, { kind: "step", via: "task.undo", label: e => (e.live ? `"${e.title}" ${e.live.key}::${e.live.after}` : `"${e.title}" ${statusWord(e.to)}`) });
/** The callout changes (PIE-538). */
export const CALLOUT_HISTORY = new UndoHistory<LineUndo>(NOTE_JOURNAL, { kind: "callout", via: "callout.undo", label: lines("the callout change to") });
/** Image layout changes (PIE-532), for image.undo. */
export const IMAGE_HISTORY = new UndoHistory<LineUndo>(NOTE_JOURNAL, { kind: "image", via: "image.undo", label: lines("the picture change to") });
/** The props a `::use` line was given (PIE-533 S4, use.fill), for use.undo. */
export const USE_HISTORY = new UndoHistory<LineUndo>(NOTE_JOURNAL, { kind: "use", via: "use.undo", label: lines("the ::use change to") });
/**
 * A source line edited (the Sources inspector, a parameter, a button's slot), for sources.undo. Per note, not per reader
 * (PIE-1666): a write made where no reader shows the note (a status-bar press, an agent's button.slot note=) is undone by
 * the reader that does.
 */
export const SOURCE_HISTORY = new UndoHistory<LineUndo>(NOTE_JOURNAL, { kind: "source", via: "sources.undo", label: lines("the source change to") });

/** What ctrl+z takes back in the note `at` for `by`: the newest entry of its journal, or of the settings' scope. */
export const newestUndo = (by: string, at: string): Journaled | null => newestOf([NOTE_JOURNAL, SETTINGS_JOURNAL], by, at);
