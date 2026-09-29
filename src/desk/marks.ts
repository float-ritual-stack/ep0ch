// Attention marks (PIE-423's door side): "look here", from an agent or the person, on a block or on a line of an
// nvim tile. A marked block is framed and labelled in every tile that shows it ("◆ needs your call · by
// claude-float-2"); a marked nvim line gets an extmark with virtual text. A mark stays until it's dismissed,
// and `alt+m` (or `marks.next`) steps through them. Marks never move the person's focus, selection or cursor.
//
// The store is behind `MarkStore` so PIE-423's service-backed focus marks (shared, so Detail shows them too)
// can replace this door-local one, kept in the door's state (marks.json).
import { readState, writeState } from "../state";

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

/** Door-local marks, kept in marks.json in the door's state. */
export class LocalMarks implements MarkStore {
  private marks: Mark[];
  private next: number;
  private listeners: (() => void)[] = [];
  constructor(private readonly persist = true) {
    const saved = persist ? readState<Mark[]>("marks.json") : null;
    this.marks = Array.isArray(saved) ? saved.filter(m => m && typeof m.n === "number" && typeof m.reason === "string") : [];
    this.next = Math.max(0, ...this.marks.map(m => m.n)) + 1;
  }
  list() { return [...this.marks]; }
  add(m: Omit<Mark, "n" | "at">): Mark {
    const mark: Mark = { ...m, n: this.next++, at: Date.now() };
    this.marks.push(mark);
    this.changed();
    return mark;
  }
  remove(n: number): Mark | null {
    const i = this.marks.findIndex(m => m.n === n);
    if (i < 0) return null;
    const [m] = this.marks.splice(i, 1);
    this.changed();
    return m!;
  }
  onChange(f: () => void) { this.listeners.push(f); }
  private changed() { if (this.persist) writeState("marks.json", this.marks); for (const f of this.listeners) f(); }
}

/** How a mark reads in a tile's header. */
export const markLabel = (m: Mark) => `◆ ${m.line ? `line ${m.line}: ` : ""}${m.reason} · by ${m.by}`;
