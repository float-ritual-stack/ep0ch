// The glass (ADR 0007): the float layer above every screen, a placement. Its tiles are the host desk's floats; their
// rectangles and order belong to its LayoutState, and they change through `apply` like any tile. `tile.float to=glass`
// (^W U) lifts a tile onto it, `tile.dock` puts one in the work area, `tile.drawer` tucks one into the drawer, and a drag
// carries one off it. This is core: anything may be put here. The hover behaviour that fills it with post-its and
// shelves is an extension on the hover primitive (src/hover.ts, packages/door/ext/glass; PIE-1505, ADR 0008).
import type { App, Screen } from "./app";
import type { Rect } from "./canvas";
import type { AgentDrawer } from "./drawer";
import type { Desk } from "./desk/desk";
import { makeTile } from "./desk/tiles";
import type { Pane } from "./desk/panes";
import type { TileDone } from "./desk/tile-actions";
import type { TileSpec } from "./desk/tiles";
import { keepOnScreen, type Dir } from "./desk/screen-layout";
import { inside, type Hover } from "./hover";
import { USER, type Actor } from "./socket";
import { ActionRefused } from "./surface/actions";
import type { Key } from "./term";

export class FloatLayer {
  constructor(private readonly app: App, private readonly host: AgentDrawer, private readonly hover: Hover) {}
  floats() { return this.host.made?.floatingTiles() ?? []; }
  describe() { return { tiles: this.floats().map(({ pane: _p, ...f }) => f) }; }

  /**
   * Where a new float lands: `size` (clamped to the terminal) in the corner away from the pointer, so it never covers
   * what the pointer is on; `pin` steps each further float in, so a pile stays readable.
   */
  rectangle(size = { cols: 56, rows: 16 }, pin = false): Rect {
    const { cols, rows } = this.app.terminalSize, p = this.hover.pointer ?? { x: 0, y: 0 };
    const s = { cols: Math.min(cols, size.cols), rows: Math.min(rows - 2, size.rows) };
    const n = pin ? this.floats().length : 0;
    return keepOnScreen({ ...s, col: p.x < cols / 2 ? cols - s.cols - 1 - n * 3 : 1 + n * 3, row: p.y < rows / 2 ? rows - s.rows - 2 - n * 2 : 1 + n * 2 }, { col: 0, row: 0, cols, rows: rows - 1 });
  }

  /** Put a new pane on the glass (a post-it, a shelf, an extension's own): brought into the host desk as a float, keys left where they are. */
  put(pane: Pane, name: string, spec: TileSpec, actor: Actor, at: Rect = this.rectangle()): TileDone {
    const d = this.host.desk!;
    const done = d.bringIn({ pane, name, spec, from: "glass", typing: false }, undefined, undefined, actor, at);
    d.save(); this.app.redraw(); return done;
  }

  dock(name: string, pin: boolean | undefined, edge: Dir | "other" | undefined, actor: Actor, container?: string): TileDone {
    const landed = this.host.take(name, undefined, undefined, actor);
    return this.host.resolveTile(landed.tile)!.desk.dockTile(landed.tile, pin, edge, actor, container);
  }
  tuck(name: string, actor: Actor): TileDone {
    const done = this.host.made!.floatTile(name, actor, false);
    if (this.host.glassHasKeys(done.tile)) this.host.restoreGlassKeys();
    this.app.redraw(); return { ...done, inDrawer: true };
  }
  float(from: Desk, name: string, actor: Actor) {
    const d = this.host.desk!;
    if (from === d) return d.floatTile(name, actor, true);
    const heir = from.tileCount() === 1 ? makeTile({ t: "leaf", kind: "blank" }) : undefined;
    const why = from.takeRefusal(name, actor, !!heir);
    if (why) throw new ActionRefused(why);
    const admission = d.bringRefusal({ name, spec: { t: "leaf", kind: from.pane(name)!.kind } }, undefined, undefined, actor, this.rectangle());
    if (admission) throw new ActionRefused(admission);
    const moved = from.takeOut(name, actor, heir);
    const done = d.bringIn(moved, undefined, undefined, actor, this.rectangle());
    this.app.redraw(); return { ...done, floated: true, to: "glass" };
  }
  /** Close every float, keeping any tile the person is working in when an agent asks. */
  clear(actor: Actor) {
    const kept: { tile: string; why: string }[] = [], d = this.host.made;
    for (const f of this.floats()) {
      // Closing a shelf also closes its unentered preview.
      if (!d!.floatingTiles().some(t => t.tile === f.tile)) continue;
      const why = d!.tileNow(f.tile, actor).refused("close");
      if (why) kept.push({ tile: f.tile, why }); else d!.closeTile(f.tile, actor);
    }
    if (!this.floats().some(f => this.host.glassHasKeys(f.tile))) this.host.restoreGlassKeys();
    this.app.redraw(); return { kept };
  }
  menuInput(k: Extract<Key, { kind: "mouse" }>, own: Rect[], behind: Rect[], screen?: Screen): boolean {
    const point = { x: k.x, y: k.y };
    if (!this.host.glassHasKeys() && !this.floats().some(f => inside(point, f.rect))) return false;
    const owner = own.some(r => inside(point, r)) ? this.host.made : behind.some(r => inside(point, r)) ? screen : null;
    owner?.key(k, this.app);
    return !!owner;
  }
  dragFloat(k: Extract<Key, { kind: "mouse" }>, screen: Desk | null): boolean {
    const d = this.host.made, moving = d?.draggedFloat();
    if (!d || !moving || k.action !== "drag" && k.action !== "up") return false;
    if (k.action === "drag") d.key(k, this.app);
    const pane = d.pane(moving)!, chip = this.host.chipAt;
    const tuck = !!chip && k.y === chip.row && k.x >= chip.from && k.x < chip.to;
    const target = !d.floatDrop()?.receive && screen ? screen.foreignAt(k.x - screen.screenOrigin.col, k.y - screen.screenOrigin.row, { name: moving, kind: pane.kind, pane }, true) : null;
    if (!target) screen?.cancelDrag();
    if (k.action === "up") {
      if (tuck || target) {
        d.cancelDrag(); screen?.cancelDrag();
        if (target?.refused) this.app.flash(`not moved: ${target.refused}`);
        else if (target?.receive && !tuck) void d.perform(target.receive.action, target.receive.args ?? {}, USER, moving);
        else void d.perform("tile.drawer", tuck ? { on: true } : { on: false, to: target!.to, where: target!.where }, USER, moving);
      } else d.key(k, this.app);
    }
    return true;
  }
}
