// The river as its tests read it (PIE-515: the River is a screen spec on the desk, its columns `river.column` tiles in
// a flow): its columns in order, by title, which has the keys, which is wide, how each shows, where each was drawn.
// Read through the desk's own host API (`columnsOf`, `coverOf`, `isWide`, `focusedPane`, `rectOf`): no private reaches.
import type { Rect } from "../src/canvas";
import type { Desk } from "../src/desk/desk";
import type { RiverColumn } from "../src/river/column";

export class RiverView {
  constructor(readonly b: Desk) {}
  /** Each column's first tile, in the flow's order. */
  get columns(): RiverColumn[] { return this.b.columnsOf("river").map(c => c[0] as RiverColumn); }
  /** Every column tile, stacked ones too. */
  get tiles(): RiverColumn[] { return this.b.columnsOf("river").flat() as RiverColumn[]; }
  /** The stacked tiles of column `n` (from 1). */
  stack(n: number): RiverColumn[] { return (this.b.columnsOf("river")[n - 1] ?? []) as RiverColumn[]; }
  /** Column `n` (from 1). */
  column(n: number): RiverColumn { return this.columns[n - 1]!; }
  /** The column titled `t` (the Library, a note's title, #value). */
  byTitle(t: string): RiverColumn | undefined { return this.tiles.find(c => c.titleOf() === t); }
  /** The column showing note `id` (opened on it). */
  byNote(id: string): RiverColumn | undefined { return this.tiles.find(c => c.source.kind === "block" && c.source.id === id); }
  /** The column tile with the keys. */
  get focused(): RiverColumn { return this.b.focusedPane() as RiverColumn; }
  /** Its place in the flow, from 0. */
  get focus(): number { const f = this.focused; return this.b.columnsOf("river").findIndex(c => c.includes(f)); }
  focusedTitle(): string { return this.focused.titleOf(); }
  wideTitle(): string { return this.columns.find(c => this.b.isWide(c))?.titleOf() ?? ""; }
  coverOf(c: RiverColumn | string | undefined): string | undefined { const p = typeof c === "string" ? this.byTitle(c) : c; return p ? this.b.coverOf(p) ?? "off screen" : undefined; }
  /** Where a column was last drawn (render first). */
  rectOf(c: RiverColumn | string): Rect { const p = typeof c === "string" ? this.byTitle(c)! : c; return this.b.rectOf(p)!; }
  /** A column tile's name, what `tile=` takes. */
  name(c: RiverColumn): string { return this.b.nameOfPane(c); }
}

export const view = (b: Desk) => new RiverView(b);
