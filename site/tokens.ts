// The site's colour tokens, written from the door's own themes (packages/door/src/theme.ts) so the docs wear
// exactly what the door wears. Run after a theme changes: `bun site/tokens.ts` writes site/assets/tokens.css.
//
// Roles, not colour names: a page asks for `--ink-link`, never "light cyan". The map below is the door's own
// reading of its palette (theme.ts's comments; the callout tones are src/callouts.ts's TONE itself).
import { THEMES, type Rgb, type Theme } from "../packages/door/src/theme";
import { TONE } from "../packages/door/src/callouts";
import { C as P } from "../packages/door/src/style";

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as unknown as Rgb;

function roles(t: Theme): Record<string, string> {
  const c = (k: keyof typeof P) => t.palette[P[k]]!;
  const ground = t.ground ?? c("black");
  return {
    // Surfaces
    "surface-ground": hex(ground),                      // the page: the door's ground
    "surface-sunk": hex(mix(ground, [0, 0, 0], 0.35)),  // a terminal or code well, below the ground
    "surface-raised": hex(t.tint.embed),                // a framed object: callout body, signature, step list
    "surface-bar": hex(c("blue")),                      // the status bar, a tile header's fill
    "surface-select": hex(t.tint.select),               // the current chapter, a selected row
    "surface-ruler": hex(t.tint.ruler),                 // the reading ruler: the step or line in focus
    "surface-agent": hex(t.tint.agent),                 // an agent's selection or row
    // Lines
    "line-frame": hex(mix(c("blue"), c("dark"), 0.25)), // tile and callout frames
    "line-quiet": hex(mix(ground, c("blue"), 0.6)),     // rules inside a frame
    // Ink
    "ink-body": hex(c("grey")),                         // running text
    "ink-strong": hex(c("white")),                      // titles; never #fff
    "ink-dim": hex(c("dark")),                          // metadata, hints, captions
    "ink-heading": hex(c("yellow")),                    // section headings, as the door draws ## lines
    "ink-link": hex(c("lcyan")),                        // links and focus
    "ink-agent": hex(c("lmagenta")),                    // anything an agent did or can do (act)
    "ink-key": hex(c("lblue")),                         // a key's glyph
    "ink-add": hex(c("lgreen")),                        // a diff's added line
    "ink-remove": hex(c("lred")),                       // a diff's removed line
    "ink-error": hex(c("lred")),
    // Callout tones: the door's own map (src/callouts.ts TONE, outline-core's CalloutTone to a palette colour)
    ...Object.fromEntries(Object.entries(TONE).map(([tone, i]) => [`tone-${tone}`, hex(t.palette[i]!)])),
    // The 16 cells colours, for the cast player's terminal (casts mostly carry their own RGB)
    ...Object.fromEntries(t.palette.map((rgb, i) => [`term-${i}`, hex(rgb)])),
  };
}

const block = (sel: string, t: Theme) => `${sel} {\n${Object.entries(roles(t)).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}`;
const css = [
  "/* Written by site/tokens.ts from packages/door/src/theme.ts. Don't edit: change the theme and run it again. */",
  "/* calm is the default; night is calm dimmer (brightest text near 10:1). Both are dark; there is no light theme. */",
  block(":root", THEMES.calm).replace("{\n", "{\n  color-scheme: dark;\n"),
  block(':root[data-tone="night"]', THEMES.night),
  "",
].join("\n");
await Bun.write(new URL("./assets/tokens.css", import.meta.url), css);
console.log(`site/assets/tokens.css: ${Object.keys(roles(THEMES.calm)).length} roles × calm, night`);
