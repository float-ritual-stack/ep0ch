// The press map (PIE-1530): every control a desk paints on a tile's frame or header, recorded once where it is drawn
// with the action a click runs. The mouse looks a press up here and runs its action through the dispatcher; x-ray and the
// controls card read the same entries, so a control says what it does from the one place that decides it. A new frame
// control is one `record` (or `draw`) where it is painted, nothing else.
import type { Canvas, Rect } from "../canvas";
import type { StripHit } from "../surface/chip-rows";
import { RESET } from "../style";
import type { Dir } from "./layout";

/**
 * What a press is, for the order a click asks them in and for tests that look one up. `title` (a tile's name or a tab's
 * label: the grip a drag moves) and `dock` (a shut dock's strip segment) are looked up apart: a title press is the start
 * of a drag or a double click, and a dock's strip sits outside every tile.
 */
export type PressKind = "pointer" | "mark" | "dock-close" | "dock-label" | "agent" | "head" | "float" | "close" | "hold" | "lift" | "fold" | "wire" | "menu" | "title" | "dock";

/** The kinds a press on a tile asks, first match wins: the order the desk's clicks always took. */
const ORDER: readonly PressKind[] = ["pointer", "mark", "dock-close", "dock-label", "agent", "head", "float", "close", "hold", "lift", "fold", "wire"];

/** One control as drawn: its cells, the tile it belongs to, and what a click there runs. */
export interface Press {
  kind: PressKind;
  /** The tile (the desk's number for it). */
  id: number;
  row: number; from: number; to: number;
  /** What it is, in a person's words: x-ray and the controls card say it. */
  label: string;
  /** What a click runs, through the desk's dispatcher on tile `id`, as the same action's key and `act` do. */
  action: string; args?: Record<string, unknown>;
  /** What a click with a modifier in `altMods` runs instead (alt+click folds the other way; a dock's alt+click opens beside). */
  alt?: StripHit; altMods?: number;
  /** A tile's own control (a pane's action set, `runOwn`; a panel the desk opens): run here instead of the dispatcher. */
  run?: () => void;
  /** Drawn from the tile's right edge (the corner's controls): moves with a float's width as well as its place. */
  right?: true;
  /** A dock strip's segment: the tile it shows and its edge, as a drag's drop handles read them. */
  handle?: { shows: number; edge: Dir };
}

const inside = (p: Press, x: number, y: number) => p.row === y && x >= p.from && x < p.to;

export class PressMap {
  private all: Press[] = [];

  /** A control drawn this frame. */
  record(p: Press): void { this.all.push(p); }
  /** A control painted and recorded in one step: `text` in `sgr` over its cells. */
  draw(canvas: Canvas, p: Press, text: string, sgr: string): void {
    canvas.text(p.from, p.row, sgr + text + RESET, p.to - p.from);
    this.record(p);
  }
  /** A new frame: nothing drawn is pressable until it's drawn again. */
  clear(): void { this.all = []; }
  /** Every press of a kind (tests, and the drag's grips and dock handles). */
  kind(k: PressKind): Press[] { return this.all.filter(p => p.kind === k); }
  /** Tile `id`'s presses of a kind, as drawn. */
  on(id: number, k?: PressKind): Press[] { return this.all.filter(p => p.id === id && (k === undefined || p.kind === k)); }
  /** Rewrite the map: each press becomes what `f` gives (none, itself, or pieces of it). */
  keep(f: (p: Press) => Press[]): void { this.all = this.all.flatMap(f); }

  /** The control a press at x, y on tile `top` (the tile under the pointer) lands on, in the order clicks always asked. */
  at(x: number, y: number, top: number | undefined): Press | undefined {
    if (top === undefined) return undefined;
    let best: Press | undefined, rank = ORDER.length;
    for (const p of this.all) {
      const i = ORDER.indexOf(p.kind);
      if (i >= 0 && i < rank && p.id === top && inside(p, x, y)) { best = p; rank = i; }
    }
    return best;
  }
  /** A press of kind `k` at x, y on any tile (the menu's ≡ before the tile under it is asked; a dock strip's segment). */
  find(k: PressKind, x: number, y: number): Press | undefined { return this.all.find(p => p.kind === k && inside(p, x, y)); }

  /** What a click with `mods` on `p` runs: its alt when a modifier it names is held. */
  choose(p: Press, mods = 0): StripHit {
    return p.alt && p.altMods && (mods & p.altMods) ? p.alt : { action: p.action, ...(p.args ? { args: p.args } : {}) };
  }

  /** A float moved (or was sized) since it was drawn: its controls go with it, the corner's with its right edge. */
  move(id: number, was: Rect, now: Rect): void {
    const dx = now.col - was.col, dy = now.row - was.row, dr = dx + now.cols - was.cols;
    if (!dx && !dy && dr === dx) return;
    this.all = this.all.map(p => (p.id !== id ? p : { ...p, row: p.row + dy, from: p.from + (p.right ? dr : dx), to: p.to + (p.right ? dr : dx) }));
  }

  /**
   * Tile `id`'s controls as x-ray and the controls card say them: each one's label and the action a click runs (with its
   * alt-click's), one line each, in the order drawn. The title and tab labels are the tile's own, not controls.
   */
  describe(id: number): string[] {
    const seen = new Set<string>();
    return this.all.filter(p => p.id === id && p.kind !== "title").flatMap(p => {
      const line = `${p.label}: ${actLine(p)}${p.alt ? ` · alt+click ${actLine(p.alt)}` : ""}`;
      if (seen.has(line)) return [];
      seen.add(line);
      return [line];
    });
  }
}

/** An action as `act` takes it: its name and its arguments, `key=value`. */
function actLine(a: StripHit): string {
  const args = Object.entries(a.args ?? {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return [a.action, ...args].join(" ");
}

/** Which controls a tile's top right corner carries, right to left: × ◘ ≡, then its fold, hold, name/sys and lift. */
export interface CornerAsk { closes: boolean; floats: boolean; menus: boolean; fold: boolean; hold: boolean; titleMode: boolean; lifts: boolean }

/**
 * Where each corner control goes on a tile's header in rect `r` (columns), and `end`: where the title must stop before
 * them. Pure: a click test asks it with no desk.
 */
export function cornerSlots(r: Rect, a: CornerAsk) {
  const right = r.col + r.cols;
  const closeX = right - 2;
  const floatX = right - (a.closes ? 4 : 3);
  const menuX = (a.floats ? floatX : a.closes ? right - 2 : right - 1) - 2;
  const foldX = menuX - 2;
  const holdX = (a.fold ? foldX : menuX) - 2;
  const beforeMode = a.hold ? holdX : a.fold ? foldX : menuX;
  const titleModeX = a.titleMode ? beforeMode - 7 : null;
  const liftX = (titleModeX ?? beforeMode) - 2;
  return { closeX, floatX, menuX, foldX, holdX, titleModeX, liftX, end: titleModeX ?? beforeMode };
}
