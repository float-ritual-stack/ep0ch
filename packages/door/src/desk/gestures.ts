// What the mouse button held down is doing on a desk (PIE-1530, PIE-1781): one gesture at a time, by construction. The
// desk starts and ends gestures as the mouse goes; this owns the kinds, how each is read, and the one place a gesture a
// closed tile was part of ends (`forget`).
import type { Rect } from "../canvas";
import { resizeEnded } from "../resize";
import type { GroupDrop } from "./desk";
import type { Drop } from "./drop";
import type { ReaderPane } from "./panes";
import type { Grab } from "./screen-layout";
import type { Where } from "./tile-actions";

/** A part of a reader's note dragged out (PIE-1247): its tile and line, the pointer, and what a release there does. */
export type ElementDrag = { src: number; line: number; x: number; y: number; target: { kind: "into"; tile: number; note: string; line: number; label: string; bar: Rect | null; draft: boolean } | { kind: "detach"; drop: Drop<number>; label: string } | null };
/** A title pressed with no modifier: where, so a release there is a click (RowPresses: the second opens its title). */
type TitleClick = { x: number; y: number };
/**
 * What the mouse button held down is doing (PIE-1530): one at a time, by construction.
 * - resize: a border following the pointer (layout.resize), `at` the share it was last put at.
 * - float: a float's title moving it or its ◢ corner sizing it; its title over a dock's handle, a tile's header or the
 *   screen's edge (PIE-591) is a place to dock it (`drop`).
 * - head: a press on a header (the tile, or the tab under the pointer), and the drag it became (`carry`; `drawer`: over
 *   the drawer, what a release there says).
 * - reader: a press in a reader (PIE-419) until it comes up, where its content was drawn (PIE-673's rect), and the part of
 *   its note dragged out with alt or ctrl (`element`).
 * - tile: a tile that takes every mouse event while the button is down (a terminal, a screen), and a group's tile
 *   dragged out past its content (`out`).
 * - edit: a press in a reader's open edit (`fresh`: alt- or ctrl-click; `float`: on a float in it).
 */
export type Gesture<D> =
  | { kind: "resize"; grab: Grab; at: number | null }
  | { kind: "float"; id: number; size: boolean; dx: number; dy: number; drop?: Drop<number> | null; x?: number; y?: number; click?: TitleClick }
  | { kind: "head"; id: number; x: number; y: number; click?: TitleClick; carry?: { src: number; drop: Drop<number> | null; x: number; y: number; drawer?: string | null; into?: GroupDrop } }
  | { kind: "reader"; frame?: Rect; gutter?: Rect; pane: ReaderPane; col: number; row: number; cols: number; fresh: boolean; focusing?: boolean; at?: { x: number; y: number }; element?: ElementDrag }
  | { kind: "tile"; id: number; r: Rect; out?: { inner: D; name: string; target: { to?: string; where: Where; label: string; refused?: string } | null } }
  | { kind: "edit"; pane: ReaderPane; fresh: boolean; float: boolean };

/** The gesture held now, read as each kind it can be. */
export class HeldGesture<D> {
  now: Gesture<D> | null = null;
  get drag() { const g = this.now; return g?.kind === "resize" ? g : null; }
  get floatDrag() { const g = this.now; return g?.kind === "float" ? g : null; }
  get headPress() { const g = this.now; return g?.kind === "head" ? g : null; }
  get dragging() { return this.headPress?.carry ?? null; }
  get pressed() { const g = this.now; return g?.kind === "reader" ? g : null; }
  get elementDrag() { return this.pressed?.element ?? null; }
  get mouseTile() { const g = this.now; return g?.kind === "tile" ? g : null; }
  get outDrag() { return this.mouseTile?.out ?? null; }
  get editPressed() { const g = this.now; return g?.kind === "edit" ? g : null; }
  /** Tile `id` (instance `pane`) left the desk: a gesture on it ends its own way (a float's sizing ends, a reader's press ends). */
  forget(id: number, pane: unknown): void {
    const g = this.now;
    if (!((g?.kind === "float" || g?.kind === "tile" || g?.kind === "head") && g.id === id || (g?.kind === "reader" || g?.kind === "edit") && g.pane === pane)) return;
    if (g.kind === "float" && g.size) resizeEnded();
    if (g.kind === "reader" || g.kind === "edit") g.pane.surface.endPress();
    this.now = null;
  }
}
