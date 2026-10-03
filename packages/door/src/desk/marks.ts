// Attention marks (PIE-423's door side): "look here", from an agent or the person, on a block or on a line of an
// nvim tile. A marked block is framed and labelled in every tile that shows it ("◆ needs your call · by
// claude-float-2"); a marked nvim line gets an extmark with virtual text. A mark stays until it's dismissed,
// and `alt+m` (or `marks.next`) steps through them. Marks never move the person's focus, selection or cursor.
//
// The store is behind `MarkStore` so PIE-423's service-backed focus marks (shared, so Detail shows them too)
// can replace this door-local one, kept in the door's state (marks.json).
import { statSync } from "node:fs";
import { join } from "node:path";
import { readState, stateDir, writeState } from "../state";

export interface Mark {
  /** Its number, for dismissing and stepping: stays the same while the mark lives. */
  n: number;
  /** A block (a note) the mark is on. */
  block?: string;
  /** Or a line of what a terminal tile edits (nvim): the tile's name, the 1-based line, the file, nvim's extmark id. */
  tile?: string;
  line?: number;
  file?: string;
  extmark?: number;
  reason: string;
  /** Who set it: "you", or the agent's id. */
  by: string;
  at: number;
}

export interface MarkStore {
  list(): Mark[];
  add(m: Omit<Mark, "n" | "at">): Mark;
  remove(n: number): Mark | null;
  /** Called after every change. */
  onChange(f: () => void): void;
}

/**
 * Door-local marks, kept in marks.json in the door's state. The file is the store: every read and change
 * reads it first (only when it changed on disk), so two doors on one state dir see each other's marks and
 * never number two marks alike; a change is a read, the edit, and an atomic write (writeState).
 */
export class LocalMarks implements MarkStore {
  private marks: Mark[] = [];
  /** The highest number this door has given, so its own numbers never repeat while it runs. */
  private last = 0;
  private seen = "";
  private listeners: (() => void)[] = [];
  constructor(private readonly persist = true) { this.load(); }
  /** marks.json again, if it changed since it was last read (its size and time say). */
  private load() {
    if (!this.persist) return;
    let stamp = "";
    try { const st = statSync(join(stateDir(), "marks.json")); stamp = `${st.mtimeMs}:${st.size}`; } catch { /* none yet */ }
    if (stamp === this.seen) return;
    this.seen = stamp;
    const saved = readState<Mark[]>("marks.json");
    this.marks = Array.isArray(saved) ? saved.filter(m => m && typeof m.n === "number" && typeof m.reason === "string") : [];
  }
  list() { this.load(); return [...this.marks]; }
  add(m: Omit<Mark, "n" | "at">): Mark {
    this.load();
    const mark: Mark = { ...m, n: (this.last = Math.max(this.last, 0, ...this.marks.map(x => x.n)) + 1), at: Date.now() };
    this.marks.push(mark);
    this.changed();
    return mark;
  }
  remove(n: number): Mark | null {
    this.load();
    const i = this.marks.findIndex(m => m.n === n);
    if (i < 0) return null;
    const [m] = this.marks.splice(i, 1);
    this.changed();
    return m!;
  }
  onChange(f: () => void) { this.listeners.push(f); }
  private changed() {
    if (this.persist) {
      writeState("marks.json", this.marks);
      try { const st = statSync(join(stateDir(), "marks.json")); this.seen = `${st.mtimeMs}:${st.size}`; } catch { /* re-read next time */ }
    }
    for (const f of this.listeners) f();
  }
}

/** How a mark reads in a tile's header. */
export const markLabel = (m: Mark) => `◆ ${m.line ? `line ${m.line}: ` : ""}${m.reason} · by ${m.by}`;
