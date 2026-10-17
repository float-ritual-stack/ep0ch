// Motion (PIE-958, S8 of the self-reference wave; design §4.9): a layout change animates the tiles from where they were to
// where they are, over the 33 ms tick, and never changes brightness (Evan is photosensitive: movement only, no flashes,
// no fades, no strobing). The engine decides nothing about the layout: every op went through `apply` and the final
// arrangement is settled state; this module only says where a tile is drawn on the way. Pure: no I/O, no clock of its
// own (the desk passes one in, so a test injects it).
import type { Rect } from "./canvas";

/** The person's setting: full (everything the hint asks), calm (a short plain ease), off (snap). */
export type MotionMode = "full" | "calm" | "off";
export const MOTION_MODES: readonly MotionMode[] = ["full", "calm", "off"];

let setting: MotionMode | null = null;
/** The setting kept from last time (the door's start) or just chosen (`motion.set`). */
export function useMotion(v: unknown) { setting = motionOf(v); }
/** `full`, `calm` or `off` (also the words people type), else null. */
export function motionOf(v: unknown): MotionMode | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "full" || s === "on" || s === "yes") return "full";
  if (s === "calm" || s === "reduced") return "calm";
  if (s === "off" || s === "no" || s === "none" || s === "false" || s === "0") return "off";
  return null;
}
/** EP0CH_MOTION when set, else the person's setting, else full (the design's default: a Fantasia press is Fantasia). */
export function motionMode(env: string | undefined = process.env.EP0CH_MOTION): MotionMode { return motionOf(env) ?? setting ?? "full"; }

/** The styles a `motion=` hint names. Anything else is the plain ease. */
export type MotionStyle = "ease" | "fantasia";
/** How long each takes at full (ms). */
export const EASE_MS = 260, FANTASIA_MS = 1100, CALM_MS = 200;

export interface MotionPlan { style: MotionStyle; ms: number }

/**
 * What the person's setting leaves of an actor's hint (`motion=fantasia`, `settle`, none): off snaps whatever was asked;
 * calm caps the time at 200 ms and drops the wandering path; full draws what was asked. A hint nobody understands, or none, is
 * the plain ease.
 */
export function planMotion(hint: string | undefined, mode: MotionMode = motionMode()): MotionPlan | null {
  if (mode === "off") return null;
  const want: MotionStyle = hint === "fantasia" ? "fantasia" : "ease";
  if (mode === "calm") return { style: "ease", ms: CALM_MS };
  return { style: want, ms: want === "fantasia" ? FANTASIA_MS : EASE_MS };
}

/** A slow start and end, no overshoot (nothing springs past where it lands). */
export const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** A small stable number from a tile's id, so each wanders its own way and the same way every time. */
const wander = (id: number) => { const h = Math.sin(id * 12.9898) * 43758.5453; return h - Math.floor(h) - 0.5; };

/**
 * The rectangle a tile is drawn at `t` (0 to 1) on its way from `from` to `to`, whole cells: the plain ease moves in a
 * straight line; fantasia bends the path through a point off to one side (a quadratic Bézier), a different one for each tile,
 * and sizes by the same ease. Always inside `area`.
 */
export function inFlight(from: Rect, to: Rect, t: number, style: MotionStyle, id: number, area: Rect): Rect {
  const k = ease(t);
  const lerp = (a: number, b: number) => a + (b - a) * k;
  let col = lerp(from.col, to.col), row = lerp(from.row, to.row);
  if (style === "fantasia") {
    const dx = to.col - from.col, dy = to.row - from.row, len = Math.hypot(dx, dy) || 1;
    // The bend peaks mid-way and is gone at both ends; it grows with the distance, capped.
    const bend = wander(id) * Math.min(24, len * 0.8) * Math.sin(Math.PI * k);
    col += (-dy / len) * bend * 2;      // cells are about twice as tall as wide
    row += (dx / len) * bend * 0.5;
  }
  const cols = Math.max(1, Math.round(lerp(from.cols, to.cols))), rows = Math.max(1, Math.round(lerp(from.rows, to.rows)));
  return {
    col: Math.max(area.col, Math.min(area.col + Math.max(0, area.cols - cols), Math.round(col))),
    row: Math.max(area.row, Math.min(area.row + Math.max(0, area.rows - rows), Math.round(row))),
    cols, rows,
  };
}

const same = (a: Rect, b: Rect) => a.col === b.col && a.row === b.row && a.cols === b.cols && a.rows === b.rows;

/** One layout change in flight: the tiles' rectangles before and after, when it began and how long it runs. */
export class Transition {
  constructor(readonly from: ReadonlyMap<number, Rect>, readonly to: ReadonlyMap<number, Rect>, readonly start: number, readonly plan: MotionPlan) {}
  /** 0 at the start, 1 once it has run its time. */
  progress(now: number): number { return Math.max(0, Math.min(1, (now - this.start) / this.plan.ms)); }
  done(now: number): boolean { return now - this.start >= this.plan.ms; }
  /** Whether anything moves at all (a change that kept every rectangle where it was needs no frames). */
  get moves(): boolean { return [...this.to].some(([id, r]) => { const f = this.from.get(id); return !!f && !same(f, r); }); }
  /**
   * How tile `id` is drawn now: `settled` (at its final place, as always: a tile that didn't move, a new one, which
   * appears at once) or the rectangle it is in.
   */
  at(id: number, now: number, area: Rect): "settled" | Rect {
    const to = this.to.get(id), from = this.from.get(id);
    if (!to || !from || same(from, to)) return "settled";
    return inFlight(from, to, this.progress(now), this.plan.style, id, area);
  }
  /** The rectangles now, for a change begun while this one is still going: it goes on from where the tiles are drawn. */
  rectsNow(now: number, area: Rect): Map<number, Rect> {
    const out = new Map<number, Rect>();
    for (const [id, r] of this.to) { const a = this.at(id, now, area); out.set(id, a === "settled" ? r : a); }
    return out;
  }
}
