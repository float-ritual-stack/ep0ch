// The reader's undo: one journal per note (Nov 3 review card 15). Every undoable change a reader makes (a step's
// status, a callout, a picture's layout, a ::use fill, a source line, an extension's write, a note move) is an entry
// that carries its note, its kind, the action that takes it back, its maker and a label; ctrl+z reads the newest
// entry of the note it is pressed in, whatever the kind. Settings, which aren't a note's, keep a journal of their own
// scope (SETTINGS_JOURNAL) through the same type. The desk's layout undo is another scope (desk/step-record.ts).
import type { UndoEntry } from "./steps";

export type UndoKind = "step" | "callout" | "image" | "use" | "source" | "ext" | "move" | "settings";

/** What every producer's entry carries: its maker (`partyOf`) and the note it was made while reading. */
export interface Made { by: string; context: string }
/** An entry as the journal keeps it. `seq` is the place in the door's one order of changes (the desk's and trash's compare with it). */
export type Journaled<E = any> = E & { seq: number; kind: UndoKind; via: string; label: string };

let undoSeq = 0;
/** The next place in the order undoable changes are made in: the journal's entries, a layout step, a trashed note. */
export const undoStamp = () => ++undoSeq;

/** A note keeps this many changes (the newest). */
const PER_NOTE = 100;

export class UndoJournal {
  private byNote = new Map<string, Journaled[]>();

  record<E extends Made>(kind: UndoKind, via: string, label: string, e: E): Journaled<E> {
    const entry: Journaled<E> = { ...e, seq: undoStamp(), kind, via, label };
    const list = this.byNote.get(e.context) ?? [];
    list.push(entry);
    if (list.length > PER_NOTE) list.shift();
    this.byNote.set(e.context, list);
    return entry;
  }
  /** The newest change `by` made while reading `note`, of any kind, or null. */
  last(by: string, note: string): Journaled | null { return this.byNote.get(note)?.findLast(e => e.by === by) ?? null; }
  lastOf(kind: UndoKind, by: string, note: string): Journaled | null { return this.byNote.get(note)?.findLast(e => e.by === by && e.kind === kind) ?? null; }
  /** Every change `by` made in `note`, newest first. */
  list(by: string, note: string): Journaled[] { return (this.byNote.get(note) ?? []).filter(e => e.by === by).reverse(); }
  count(kind: UndoKind, note: string) { return (this.byNote.get(note) ?? []).filter(e => e.kind === kind).length; }
  drop(e: Journaled) {
    const list = this.byNote.get(e.context), i = list?.lastIndexOf(e) ?? -1;
    if (list && i >= 0) { list.splice(i, 1); if (!list.length) this.byNote.delete(e.context); }
  }
  /** Forget every entry of `kind` that `gone` holds for: a change found to have nothing to take back (PIE-1678). */
  dropWhere(kind: UndoKind, gone: (e: Journaled) => boolean) {
    for (const [note, list] of this.byNote) {
      const kept = list.filter(e => e.kind !== kind || !gone(e));
      if (kept.length) this.byNote.set(note, kept); else this.byNote.delete(note);
    }
  }
  /** Only our own box writes preserve a row's position; other edits leave its undo stale. */
  advance(kind: UndoKind, block: string, before: number, after: number) {
    for (const list of this.byNote.values()) for (const e of list) {
      const x = e as Partial<UndoEntry> & Journaled;
      if (x.kind === kind && x.block === block && x.at?.revision === before) x.at.revision = after;
    }
  }
}

/** The journal of every note's changes, and the one of settings (not a note's). */
export const NOTE_JOURNAL = new UndoJournal();
export const SETTINGS_JOURNAL = new UndoJournal();

/** The newest change of `by` in `note` across scopes (a reader's note journal and the settings'). */
export const newestOf = (journals: UndoJournal[], by: string, note: string): Journaled | null =>
  journals.map(j => j.last(by, note)).reduce<Journaled | null>((a, e) => (e && (!a || e.seq > a.seq) ? e : a), null);

/** What an undo says: what it took back and who made it. */
export const undoneSaid = (e: Pick<Journaled, "label" | "by">) => `undid ${e.label} (made by ${e.by})`;

/** A producer's way into the journal: what it records, what takes it back, how it labels an entry. */
export interface UndoSpec<E> { kind: UndoKind; via: string; label: (e: E) => string }

/** One producer's changes in a journal, as the code that makes them knows them: push, last, drop, advance. */
export class UndoHistory<E extends Made = UndoEntry> {
  constructor(private readonly journal: UndoJournal, private readonly spec: UndoSpec<E>) {}
  push(e: E) { this.journal.record(this.spec.kind, this.spec.via, this.spec.label(e), e); }
  /** The newest change of this kind `by` made while reading `context`, or null. */
  last(by: string, context: string): Journaled<E> | null { return this.journal.lastOf(this.spec.kind, by, context); }
  advance(block: string, before: number, after: number) { this.journal.advance(this.spec.kind, block, before, after); }
  drop(e: Journaled<E>) { this.journal.drop(e); }
  /** Forget every change of this kind `gone` holds for (PIE-1678). */
  dropWhere(gone: (e: Journaled<E>) => boolean) { this.journal.dropWhere(this.spec.kind, gone as (e: Journaled) => boolean); }
  /** The changes of this kind in the note `context` (the status line counts a note's step changes). */
  size(context: string) { return this.journal.count(this.spec.kind, context); }
}
