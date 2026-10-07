// The header's backdrop (PIE-598): as a note's hero image (its `[layout::hero]` image, else an image that is the
// note's first block) scrolls up under a reader's sticky header (title, summary, byline, crumbs), the header takes a
// crop of it as its background, muted (most of its colour gone, softened) and dark, so the header's text reads over it.
// It comes in by steps as the image goes under, from the ground up (each step more opaque over the theme's ground), so
// no frame is ever bright. The crop is the header's
// own box, around the image's middle or `[hero-focus::x,y]`. Kitty graphics: the media cache's muted variant, placed
// under the header's text. Cells: one colour per cell from the same crop, under the text. Elsewhere (text out, no
// colour): nothing. `reader.hero on=false` turns it off, kept for the next start as the theme is; `mode=follow` makes
// the header follow the note's pictures: each one that scrolls under takes over, fading in over the one before.
import { coverCrop } from "../doc";
import type { Placement } from "../kitty";
import { cellColours, sized, type CellGrid, type Focus, type Look, type ReadyMedia } from "../media";
import { bgRgb, glyphWidth, graphemes, pad, RESET } from "../style";
import { theme, type Rgb } from "../theme";

/** Which picture the header takes: the note's hero only, or each picture in turn as it scrolls under. */
export type HeroMode = "first" | "follow";
export const HERO_MODES: readonly HeroMode[] = ["first", "follow"];
/** The person's setting (reader.hero, kept in the state dir as `reader-hero.json`); unset: on, first. */
let saved: { on?: boolean; mode?: HeroMode } = {};
/** Use the setting kept from last time (the door's start) or just chosen (reader.hero): `{ on, mode }`. */
export function useHeroHeader(v: unknown) {
  const o = (v ?? {}) as { on?: unknown; mode?: unknown };
  saved = { ...(typeof o.on === "boolean" ? { on: o.on } : {}), ...(HERO_MODES.includes(o.mode as HeroMode) ? { mode: o.mode as HeroMode } : {}) };
}
/** Whether readers give their header a picture's backdrop. */
export const heroHeaderOn = () => saved.on ?? true;
/** Which picture: the hero (first) or the last one scrolled under the header (follow). */
export const heroHeaderMode = (): HeroMode => saved.mode ?? "first";

/** The steps it comes in by, as the image goes under the header. */
export const HERO_STEPS = 3;
/** At its full step, the backdrop's mean luminance (0–1) and its brightest part's, at most. */
export const HERO_MEAN = 0.1, HERO_PEAK = 0.22;
/** Without the image drawn (cells), the rows scrolled past its line over which it comes in. */
export const HERO_RAMP_ROWS = 3;

/** The step (0 none … HERO_STEPS) for how far the image has gone under the header (0–1). */
export const heroStep = (gone: number) => (gone <= 0 ? 0 : Math.min(HERO_STEPS, Math.ceil(gone * HERO_STEPS - 1e-9)));

/** How the backdrop draws the image over the part `crop` shows: muted and dark; at step `n`, that opaque over the ground. */
const lookAt = (crop: Look["crop"], dim: number | undefined, n = HERO_STEPS): Look => ({ ...(crop ? { crop } : {}), ...(dim !== undefined ? { dim } : {}), mean: HERO_MEAN, peak: HERO_PEAK, mute: true, ...(n < HERO_STEPS ? { alpha: n / HERO_STEPS } : {}) });
/** What the terminal draws under a cell without a colour: the theme's ground, else its black. */
const groundOf = (): Rgb => theme().ground ?? theme().palette[0]!;

/** What a header's backdrop draws: its Kitty placement or its cells' colours, at the step shown. */
export type { CellGrid };
export type Backdrop = { step: number; placement: Placement } | { step: number; grid: CellGrid };

/**
 * The backdrop of a header `cols` × `rows` cells (each `cellW` × `cellH` pixels) at step `step`, from `m`: a Kitty
 * placement under the text (`graphics`; every step's PNG is asked for at once, so the next is ready when the scroll
 * reaches it, and one not ready yet is drawn as the nearest that is), else a colour per cell, mixed with the ground
 * by the step. None ready: null, and the header stays plain until one is (never a bright frame).
 */
export function backdrop(m: ReadyMedia, focus: Focus | undefined, dim: number | undefined, step: number, cols: number, rows: number, cellW: number, cellH: number, graphics: boolean, over: { grid?: CellGrid; z?: number } = {}): Backdrop | null {
  if (step <= 0 || cols < 1 || rows < 1) return null;
  const crop = coverCrop(m, cols * cellW, rows * cellH, focus);
  const steps = Array.from({ length: HERO_STEPS }, (_, i) => i + 1).sort((a, b) => Math.abs(a - step) - Math.abs(b - step) || a - b);
  if (!graphics) {
    const full = cellColours(m, cols, rows, lookAt(crop, dim));
    if (!full) return null;
    // Mixed by the step with what's under it: the picture before it (follow), else the ground.
    const g = groundOf(), a = step / HERO_STEPS;
    return { step, grid: full.map((row, r) => row.map((c, k) => { const u = over.grid?.[r]?.[k] ?? g; return c.map((v, i) => Math.round(u[i]! + (v - u[i]!) * a)) as unknown as Rgb; })) };
  }
  const made = steps.map(n => [n, sized(m, cols * cellW, rows * cellH, lookAt(crop, dim, n))] as const);
  const hit = made.find(([, p]) => p);
  if (!hit) return null;
  const [n, png] = hit as [number, NonNullable<(typeof made)[number][1]>];
  const px = crop ? { x: Math.round(crop.x * png.width), y: Math.round(crop.y * png.height), w: Math.max(1, Math.round(crop.w * png.width)), h: Math.max(1, Math.round(crop.h * png.height)) } : undefined;
  // Under the text (z < 0), above the body's images' layer and the CRT's; the picture it fades in over a layer lower.
  return { step: n, placement: { key: `hero-backdrop:${png.key}`, image: png, col: 0, row: 0, cols, rows, z: over.z ?? -2, ...(px ? { crop: px } : {}) } };
}

/**
 * `line` drawn over a row of colours, `w` cells wide: each cell's background its colour, the text and its own
 * colours kept on top. A background the line sets itself (the ruler, a selection) wins until its reset.
 */
export function overColours(line: string, w: number, colours: readonly (readonly [number, number, number])[]): string {
  let out = "", col = 0, own = false;
  for (const part of pad(line, w).split(/(\x1b\[[\d;]*m)/)) {
    if (!part) continue;
    if (part.startsWith("\x1b[")) {
      out += part;
      own = backgroundAfter(part, own);
      continue;
    }
    for (const g of graphemes(part)) {
      const c = colours[Math.min(col, colours.length - 1)];
      if (!own && glyphWidth(g) > 0 && c) out += bgRgb(c);
      out += g;
      col += glyphWidth(g);
    }
  }
  return out + RESET;
}

/**
 * Whether the line has a background of its own after SGR sequence `sgr`, given whether it had one before: its
 * parameters in order, a reset (0, or none) or 49 letting it go, 40–48 and 100–107 setting one, a colour's own
 * numbers after 38, 48 or 58 skipped.
 */
export function backgroundAfter(sgr: string, own: boolean): boolean {
  const ps = sgr.slice(2, -1).split(";").map(p => (p === "" ? 0 : Number(p)));
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p === 38 || p === 48 || p === 58) { if (p === 48) own = true; i += ps[i + 1] === 2 ? 4 : 2; continue; }
    if (p === 0 || p === 49) own = false;
    else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) own = true;
  }
  return own;
}
