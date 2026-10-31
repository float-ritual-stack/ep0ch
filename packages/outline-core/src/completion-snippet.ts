/** Offsets are UTF-16, in the inserted text until a session places them in its draft. */
export interface SnippetSlot { start: number; end: number; key?: string }

/** Both editors keep slot positions through edits; their own history owns the undo transaction. */
export class SnippetSession {
  index = 0;
  readonly slots: SnippetSlot[];
  constructor(slots: readonly SnippetSlot[], offset: number) {
    this.slots = slots.map(s => ({ ...s, start: s.start + offset, end: s.end + offset }));
  }
  get current(): SnippetSlot { return this.slots[this.index]!; }
  move(by: number): SnippetSlot | null {
    if (this.index + by >= this.slots.length) return null;
    this.index = Math.max(0, this.index + by);
    return this.current;
  }
  /** Editing outside the current slot ends the session instead of swallowing that edit into its undo. */
  update(before: string, after: string): boolean {
    if (before === after) return true;
    let start = 0, end = before.length, tail = after.length;
    while (start < end && start < tail && before[start] === after[start]) start++;
    while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
    const slot = this.current;
    if (start < slot.start || end > slot.end) return false;
    const delta = after.length - before.length;
    slot.end += delta;
    for (const s of this.slots.slice(this.index + 1)) { s.start += delta; s.end += delta; }
    return true;
  }
}
