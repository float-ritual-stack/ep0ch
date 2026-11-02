// An extension's status chip (PIE-1505, docs/adr/0008-extension-first.md): a chip on the status bar's right that a
// door module declares from its own state, the way ◇ is the glass's. The status bar draws each one as one of its own
// items (src/status-bar.ts): a click presses `click`, an alt-click `alt`, and a narrow bar shows `tiny`. Nothing here
// knows what a chip says; taking a chip away (its module turned off) takes it off the bar.
export interface StatusChip {
  /** The item's id on the bar (and in `status.bar` lists): its module's id, unless it has more than one. */
  id: string;
  /** What it says now, styled: empty hides it this frame. */
  text(): string;
  /** What a crowded bar shows in its place. */
  tiny?(): string;
  /** The action a click presses (with `args`). */
  click: string;
  args?: Record<string, unknown>;
  /** The action an alt-click presses. */
  alt?: string;
  /** Stays on the bar while others go into +N. */
  keep?: boolean;
}

const chips = new Map<string, StatusChip>();
/** Put a chip on the bar; answers the function that takes it off. */
export function registerStatusChip(c: StatusChip): () => void {
  chips.set(c.id, c);
  return () => { if (chips.get(c.id) === c) chips.delete(c.id); };
}
export const statusChips = (): StatusChip[] => [...chips.values()];
