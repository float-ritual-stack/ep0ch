// The door's colour themes: the 16 palette entries every screen names (`C.*`, `|NN` pipe codes) and the few
// tints drawn as raw RGB (a selection, an agent's, the reading ruler, a thread, an embed band). `style.ts`
// resolves every colour through the active theme, so a theme switch is one call and a repaint.
//
// ANSI art never comes through here: art packs, the menu art, `.ans` files and the CRT art path keep true VGA
// (`VGA_RGB`, `artLines`, `rasterize`), whichever theme the UI wears.
//
// - `calm` (the default): a near-black ground, an ink-slate bar, off-white body text and desaturated accents, each
//   checked against WCAG 2 contrast on every background the door draws text on (test/theme-contrast.test.ts).
// - `night`: calm, dimmer: the brightest text near 10:1, for working past midnight.
// - `classic`: the exact VGA palette and the tints the door has always used.
import { VGA_RGB } from "./ansi";
import { SURFACE_STEPS, type Surface } from "@ep0ch/outline-core/style-cascade";
import type { CalloutTone } from "@ep0ch/outline-core/callouts";

export type Rgb = readonly [number, number, number];
export const THEME_NAMES = ["calm", "night", "classic"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export interface Theme {
  name: ThemeName;
  /** One line: what it is for (`theme.set` lists it). */
  about: string;
  /** The 16 UI colours, by VGA index (`C.black` … `C.white`). */
  palette: readonly Rgb[];
  /**
   * The terminal's own default background and text (OSC 11 / OSC 10) while the door runs: the ground every
   * cell without a colour of its own is drawn on. null: the terminal's own (classic).
   */
  ground: Rgb | null;
  text: Rgb | null;
  /** Backgrounds drawn under text that aren't palette entries. */
  tint: {
    /** The person's selection (a reader's, the river's, a draft's). */
    select: Rgb;
    /** An agent's selection: tinted in the agents' colour. */
    agent: Rgb;
    /** The reading ruler under the current block (PIE-441). */
    ruler: Rgb;
    /** A comment thread's quoted passage while the thread is open (PIE-420). */
    thread: Rgb;
    /** An embed or a resource projection's band (src/embeds.ts). */
    embed: Rgb;
    /** A list's selected row while the list doesn't have the keys. */
    idle: Rgb;
    /** A search or backlinks row selected while its tile doesn't have the keys. */
    idleRow: Rgb;
  };
  /**
   * The look's surfaces (PIE-675: a tile's or a box's `bg`, a header's `header.bg`, a list's zebra), as roles: `raised`
   * and `sunken` at their full strength, and `tone`, how much of a tone's colour (the callouts' families) is mixed into
   * the ground at full strength. A strength below full is that share of the way from the ground; every one is capped
   * dark (surfaceRgb), and checked by test/theme-contrast.test.ts.
   */
  surface: { raised: Rgb; sunken: Rgb; tone: number };
  /**
   * A tile's frame (PIE-535's clearer edges): `tile`, every frame's line, a mid-tone that shows where one tile ends and
   * the next begins (two stacked in a column too), 3:1 or better on the ground; `focus`, the tile with the person's
   * keys, a warm accent apart from the typing yellow, linking magenta and the cyan text. Both dark-capped.
   */
  edge: { tile: Rgb; focus: Rgb };
  /**
   * A link to the web (a Markdown `[label](https://…)`, drawn with a ↗), apart from the cyan of a link inside the outline
   * (`((id))`, `[[page]]`, a Work ID): a muted blue-violet, 4.5:1 or better on the ground, dark-capped.
   */
  external: Rgb;
  /** The CRT underlay (kitty+crt): its dark base and the bloom added in the middle of the tube. */
  crt: { base: Rgb; bloom: Rgb };
  /** The heatmap's lowest step (the rest climb the palette's blue, cyan, light cyan, white). */
  heatLow: Rgb;
  /**
   * A chip's text (`chip(bg, fg)`): when the asked colour reads under 4.5:1 on the chip, the more legible of the
   * ground and white is drawn instead. Off for classic, which keeps every chip.
   */
  legibleChips: boolean;
}

const CLASSIC: Theme = {
  name: "classic",
  about: "the exact VGA palette: bright cyan, magenta and phosphor green on blue bars",
  palette: VGA_RGB,
  ground: null,
  text: null,
  tint: {
    select: [46, 72, 132], agent: [78, 40, 88], ruler: [58, 50, 26], thread: [40, 52, 30], embed: [18, 24, 44],
    idle: [22, 30, 58], idleRow: VGA_RGB[8]!,
  },
  surface: { raised: [28, 28, 48], sunken: [0, 0, 0], tone: 0.16 },
  edge: { tile: [112, 112, 136], focus: [232, 148, 48] },
  external: [140, 140, 255],
  crt: { base: [4, 6, 14], bloom: [10, 16, 38] },
  heatLow: [8, 10, 24],
  legibleChips: false,
};

/** Every number here is checked by test/theme-contrast.test.ts; the README's table is its output. */
const CALM: Theme = {
  name: "calm",
  about: "the default: a near-black ground, ink-slate bars, off-white text and softened accents, easy on the eyes for long sessions",
  palette: [
    [13, 16, 22],     // 0 black: the ground, a near-black with a little blue in it
    [46, 55, 72],     // 1 blue: the bars, ink slate rather than #0000AA
    [100, 160, 100],  // 2 green
    [72, 150, 160],   // 3 cyan
    [200, 98, 92],    // 4 red
    [168, 106, 178],  // 5 magenta
    [176, 128, 72],   // 6 brown
    [200, 202, 206],  // 7 grey: body text, off-white
    [156, 160, 168],  // 8 dark: hints and metadata, dim but readable everywhere it's drawn
    [134, 164, 220],  // 9 light blue
    [138, 196, 132],  // 10 light green
    [128, 206, 214],  // 11 light cyan: links and focus
    [232, 132, 126],  // 12 light red: errors
    [204, 146, 214],  // 13 light magenta: agents
    [230, 206, 120],  // 14 yellow: headings
    [228, 226, 220],  // 15 white: off-white, never #fff
  ],
  ground: [13, 16, 22],
  text: [200, 202, 206],
  tint: {
    select: [34, 50, 82], agent: [66, 40, 78], ruler: [56, 50, 30], thread: [36, 50, 34], embed: [20, 26, 38],
    idle: [30, 38, 54], idleRow: [30, 38, 54],
  },
  surface: { raised: [40, 46, 61], sunken: [6, 8, 12], tone: 0.2 },
  edge: { tile: [98, 112, 136], focus: [236, 152, 72] },
  external: [156, 150, 226],
  crt: { base: [12, 15, 21], bloom: [6, 8, 12] },
  heatLow: [16, 20, 28],
  legibleChips: true,
};

const NIGHT: Theme = {
  name: "night",
  about: "calm, dimmer: the brightest text near 10:1, for late hours and sensitive eyes",
  palette: [
    [10, 11, 14],     // 0 black: the ground
    [30, 34, 42],     // 1 blue: the bars
    [88, 140, 90],    // 2 green
    [64, 132, 140],   // 3 cyan
    [192, 96, 90],    // 4 red
    [160, 104, 170],  // 5 magenta
    [160, 116, 66],   // 6 brown
    [166, 166, 170],  // 7 grey: body text
    [138, 140, 146],  // 8 dark
    [118, 144, 192],  // 9 light blue
    [120, 170, 116],  // 10 light green
    [110, 176, 184],  // 11 light cyan
    [206, 118, 112],  // 12 light red
    [176, 128, 186],  // 13 light magenta
    [200, 180, 108],  // 14 yellow
    [186, 184, 178],  // 15 white
  ],
  ground: [10, 11, 14],
  text: [166, 166, 170],
  tint: {
    select: [26, 36, 58], agent: [50, 30, 58], ruler: [40, 36, 22], thread: [28, 40, 28], embed: [16, 20, 28],
    idle: [24, 28, 38], idleRow: [24, 28, 38],
  },
  surface: { raised: [31, 35, 45], sunken: [4, 5, 7], tone: 0.16 },
  edge: { tile: [86, 96, 114], focus: [206, 134, 66] },
  external: [140, 134, 200],
  crt: { base: [9, 10, 13], bloom: [3, 4, 6] },
  heatLow: [14, 16, 22],
  legibleChips: true,
};

export const THEMES: Readonly<Record<ThemeName, Theme>> = { calm: CALM, night: NIGHT, classic: CLASSIC };
export const DEFAULT_THEME: ThemeName = "calm";

export const isThemeName = (s: unknown): s is ThemeName => typeof s === "string" && (THEME_NAMES as readonly string[]).includes(s);
/** `EP0CH_THEME` (or a saved choice) read as a theme's name; anything else is null. */
export const themeNamed = (s: string | undefined | null): ThemeName | null => {
  const n = s?.trim().toLowerCase();
  return isThemeName(n) ? n : null;
};

/** The theme a door starts in: EP0CH_THEME when it names one, else the one last chosen (`saved`), else calm. */
export const startTheme = (env: string | undefined, saved: string | undefined | null): ThemeName => themeNamed(env) ?? themeNamed(saved) ?? DEFAULT_THEME;

let active: Theme = THEMES[startTheme(process.env.EP0CH_THEME, null)];
const listeners: (() => void)[] = [];

/** The theme the door draws in now. */
export const theme = (): Theme => active;

/** Draw in `name` from now on; everything `themed` set up is made again. Returns whether it changed. */
export function setTheme(name: ThemeName): boolean {
  if (active.name === name) return false;
  active = THEMES[name];
  for (const f of listeners) f();
  return true;
}

/** The theme after `from` (calm → night → classic → calm). */
export const nextTheme = (from: ThemeName = active.name): ThemeName => THEME_NAMES[(THEME_NAMES.indexOf(from) + 1) % THEME_NAMES.length]!;

/**
 * Run `f` now and again whenever the theme changes: for a module's colour strings made once (`SEL = bg(…) + fg(…)`),
 * so they follow a live switch.
 */
export function themed(f: () => void): void {
  listeners.push(f);
  f();
}

const hex2 = (v: number) => v.toString(16).padStart(2, "0");
const xcolor = ([r, g, b]: Rgb) => `rgb:${hex2(r)}/${hex2(g)}/${hex2(b)}`;
/**
 * What sets the terminal's default text and background to the theme's (OSC 10, OSC 11), so every cell drawn
 * without a colour of its own sits on the theme's ground; for a theme without one (classic), the terminal's own
 * again (OSC 110, 111). A terminal that doesn't know them ignores them.
 */
export function groundSeq(t: Theme = active): string {
  if (!t.ground || !t.text) return "\x1b]110\x1b\\\x1b]111\x1b\\";   // term.ts GROUND_RESET
  return `\x1b]10;${xcolor(t.text)}\x1b\\\x1b]11;${xcolor(t.ground)}\x1b\\`;
}

// ── WCAG 2 contrast ──
const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** Relative luminance (WCAG 2). */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** The WCAG 2 contrast ratio of two colours, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

// ── surfaces (PIE-675) ──

/** A tone's colour: the palette entry its callouts are drawn in (callouts.ts TONE reads this). */
export const TONE_INDEX: Readonly<Record<CalloutTone, number>> = { blue: 11, green: 10, violet: 13, amber: 14, coral: 12, neutral: 7 };
/** The brightest a surface may be (WCAG relative luminance): about rgb(62, 62, 62), dark in every theme. */
export const SURFACE_MAX_LUMINANCE = 0.045;
/** Every text colour reads on every surface at this or better, in a theme with a ground of its own. */
export const SURFACE_MIN_CONTRAST = 4.5;

const mix = (a: Rgb, b: Rgb, f: number): Rgb => a.map((v, i) => Math.round(v + (b[i]! - v) * f)) as unknown as Rgb;

/** A surface role at its full strength, before the cap: `raised`, `sunken`, or a tone mixed into the ground. */
function fullSurface(role: Exclude<Surface, "none">, t: Theme): Rgb {
  const ground = t.ground ?? t.palette[0]!;
  if (role === "raised" || role === "sunken") return t.surface[role];
  return mix(ground, t.palette[TONE_INDEX[role]]!, t.surface.tone);
}

/** The palette entries drawn as words on anything: grey, dark and the light accents. */
export const TEXT_INKS = [7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** Whether `c` is dark enough to be a surface: under the cap, and (a theme with its ground) every text colour reads on it. */
export const surfaceOk = (c: Rgb, t: Theme = active) => luminance(c) <= SURFACE_MAX_LUMINANCE && (!t.ground || TEXT_INKS.every(i => contrast(t.palette[i]!, c) >= SURFACE_MIN_CONTRAST));

/**
 * Surface `role` at `share` (0 the ground, 1 full) of the way from `over` (default the ground): the colour a tile's,
 * a box's, a header's or a stripe's background is drawn in. Never light: a share that would pass the cap is backed off
 * until it's under it. `none`: null (nothing drawn: the ground, or a picture, shows).
 */
export function surfaceMix(role: Surface, share: number, over?: Rgb, t: Theme = active): Rgb | null {
  if (role === "none") return null;
  const from = over ?? t.ground ?? t.palette[0]!, full = fullSurface(role, t);
  let f = Math.max(0, Math.min(1, share));
  let c = mix(from, full, f);
  while (f > 0 && !surfaceOk(c, t)) { f = Math.max(0, f - 0.05); c = mix(from, full, f); }
  return surfaceOk(c, t) ? c : (t.ground ?? t.palette[0]!);
}

/** Surface `role` at `strength` (1 to SURFACE_STEPS, as the look's `bg.strength` and `list.zebra.strength` say). */
export const surfaceRgb = (role: Surface, strength: number, t: Theme = active): Rgb | null => surfaceMix(role, strength / SURFACE_STEPS, undefined, t);
