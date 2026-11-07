// Pictures drawn from a note's code fences (PIE-1555): a ```mermaid fence and a ```svg fence become an SVG file in the
// media cache, named by what it holds, and from there they are ordinary images: media.ts reads, dims and scales them
// (sharp/libvips rasterizes SVG), and the door's one kitty placement layer (src/kitty.ts) places them. Nothing here
// draws; it only turns a fence's text into a file the image pipeline already knows.
//
// The renderers are a table by fence language (FENCE_PICTURES): a new kind of picture is one row, and an extension
// can add one the day the service can hand the door an SVG. Mermaid's is pele (obsidianmd/pele, MIT, no dependencies:
// every diagram type Mermaid 12.1 has, synchronous, no browser or DOM, a few ms a render), loaded only when a note first
// holds one; what it makes is kept in the cache, so a note's diagram is rendered once.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mediaCache, mediaChanged, PICTURE_SCALE, svgOwnSize, type PictureFence } from "./media";
import { theme, type Rgb } from "./theme";

/** The colours a picture is drawn in: the door's own ground, text and lines (dark first, never a white sheet). */
export interface PictureColours { bg: Rgb; fg: Rgb; muted: Rgb; line: Rgb; accent: Rgb; surface: Rgb; surfaceAlt: Rgb; border: Rgb }

/** One kind of fence that draws as a picture: what a text reader is told it is, and how its SVG is made. */
export interface FencePicture {
  /** "mermaid diagram: flowchart, 6 nodes": what `ep0ch show`, `peek` and the caption say in its place. */
  describe(source: string): string;
  /** Its SVG, in the door's colours, laid out for `room`; a thrown error is said under the fence's source. */
  svg(source: string, colours: PictureColours, room: PictureRoom): Promise<string>;
  /** What in `source` the rasterizer (librsvg, through sharp) leaves out, said on the caption as a known limit. */
  limits?(source: string): string[];
}

/** Where a picture goes: the body's width in pixels, and the terminal's text size, so a diagram's words read as the note's. */
export interface PictureRoom { pxWidth: number; fontSize: number }

/** The room a body `cols` wide gives a picture, in cells of `cellW` × `cellH` pixels. */
export const pictureRoom = (cols: number, cellW: number, cellH: number): PictureRoom => ({ pxWidth: cols * cellW, fontSize: Math.max(10, Math.round(cellH * 0.75)) });
/** How much bigger than its layout a picture's SVG is drawn (sharp on a wide or dense screen). */
export { PICTURE_SCALE };

/** What the door has of a fence's picture now: being drawn, ready as a file, or what went wrong. */
export type PictureState =
  | { state: "drawing"; label: string }
  | { state: "ready"; label: string; path: string }
  | { state: "error"; label: string; reason: string; snippet?: string };

// ── mermaid ───────────────────────────────────────────────────────────────────

/** Mermaid's diagram kinds by their first word, as a reader names them. */
const MERMAID_KINDS: [RegExp, string][] = [
  [/^(flowchart|graph)\b/i, "flowchart"], [/^sequenceDiagram\b/, "sequence"], [/^stateDiagram(-v2)?\b/, "state"],
  [/^classDiagram\b/, "class"], [/^erDiagram\b/, "entity-relationship"], [/^xychart(-beta)?\b/, "xy chart"],
];

/** A fence's lines that say something: no blanks, no `%%` comments. */
const meaningful = (source: string) => source.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("%%"));

/**
 * What a mermaid fence is, said in words: its kind and how many things it has (a flowchart's or a state diagram's
 * nodes, a sequence's participants, a class diagram's classes). Counted from the text, so a reader with no picture
 * (`ep0ch show`, an agent's peek) is told the same as the caption.
 */
export function describeMermaid(source: string): string {
  const lines = meaningful(source);
  const head = lines[0] ?? "";
  const kind = MERMAID_KINDS.find(([re]) => re.test(head))?.[1];
  if (!kind) return "mermaid diagram";
  const body = lines.slice(1);
  const names = new Set<string>();
  const ident = /^([A-Za-z_][\w.-]*)/;
  if (kind === "flowchart") {
    for (const l of body) {
      if (/^(subgraph|end\b|classDef|class\s|style\s|click\s|linkStyle|direction\s)/.test(l)) continue;
      // Edge labels go first (|yes|, -- text -->), then the line splits at its arrows and its & lists.
      const parts = l.replace(/\|[^|]*\|/g, " ").replace(/--\s[^-]*?\s?(-->|---)/g, "$1")
        .split(/\s*(?:<?[-=.]{2,}[->ox]?|~~~)\s*|\s*&\s*/);
      for (const p of parts) { const m = ident.exec(p.trim()); if (m && m[1] !== "end") names.add(m[1]!); }
    }
    return `mermaid diagram: flowchart, ${count(names.size, "node")}`;
  }
  if (kind === "sequence") {
    for (const l of body) {
      const decl = /^(participant|actor)\s+(\S+)/.exec(l);
      if (decl) { names.add(decl[2]!); continue; }
      const msg = /^([^\s:-][^:]*?)\s*-[-x)>]*>+[+-]?\s*([^:]+?)\s*:/.exec(l) ?? /^([^\s:-][^:]*?)\s*--?[x)]\s*([^:]+?)\s*:/.exec(l);
      if (msg) { names.add(msg[1]!.trim()); names.add(msg[2]!.trim()); }
    }
    return `mermaid diagram: sequence, ${count(names.size, "participant")}`;
  }
  if (kind === "state") {
    for (const l of body) {
      const decl = /^state\s+(?:"[^"]*"\s+as\s+)?([\w.-]+)/.exec(l);
      if (decl) { names.add(decl[1]!); continue; }
      for (const side of l.replace(/:.*$/, "").split(/\s*-->\s*/)) { const m = ident.exec(side.trim()); if (m) names.add(m[1]!); }
    }
    return `mermaid diagram: state, ${count(names.size, "state")}`;
  }
  if (kind === "class") {
    for (const l of body) {
      const decl = /^class\s+([\w.-]+)/.exec(l);
      if (decl) { names.add(decl[1]!); continue; }
      const rel = /^([\w.-]+)\s*(?:"[^"]*"\s*)?(?:<\|--|\*--|o--|-->|--|\.\.>|\.\.\|>|\.\.)\s*(?:"[^"]*"\s*)?([\w.-]+)/.exec(l);
      if (rel) { names.add(rel[1]!); names.add(rel[2]!); }
    }
    return `mermaid diagram: class, ${count(names.size, "class", "classes")}`;
  }
  return `mermaid diagram: ${kind}`;
}
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Pele = typeof import("pele");
let peleLib: Promise<Pele> | null = null;
/** pele, loaded the first time a note holds a mermaid fence. */
const pele = () => (peleLib ??= import("pele").catch(e => { peleLib = null; throw new Error(`the mermaid renderer (pele) isn't installed (${(e as Error).message}): bun install, in the ep0ch checkout`); }));

const hex = (c: Rgb) => `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;

// ── svg ───────────────────────────────────────────────────────────────────────

/**
 * What an SVG has that librsvg doesn't draw (PIE-1630): text on a curve (`<textPath>`) comes out as nothing at all, the
 * curve bare, so the caption says so rather than leave the words missing unexplained.
 */
export function svgLimits(source: string): string[] {
  return /<textPath\b/i.test(source) ? ["text on a path (<textPath>) isn't drawn: librsvg leaves it out"] : [];
}

/** A ```svg fence: an `<svg>` element, its size if it says one. */
export function describeSvg(source: string): string {
  const own = svgOwnSize(source);
  return `svg picture${own ? `: ${Math.round(own.width)}×${Math.round(own.height)}` : ""}`;
}

// ── the table ─────────────────────────────────────────────────────────────────

/** Every fence language that draws as a picture, and how. */
export const FENCE_PICTURES: Record<PictureFence, FencePicture> = {
  mermaid: {
    describe: describeMermaid,
    async svg(source, c, room) {
      const { render, PeleError } = await pele();
      // Laid out for the body's width (a wide flowchart turns vertical in a narrow reader: pele's autoDirection), its
      // words at the terminal's size; no links or remote images are drawn (a picture is pixels; the links can come later).
      let svg: string;
      try {
        ({ svg } = render(source.trim(), { maxWidth: room.pxWidth, fontSize: room.fontSize, fontFamily: "'DejaVu Sans', Helvetica, Arial, sans-serif", fontFamilyMono: "'DejaVu Sans Mono', Menlo, monospace", links: false, images: false }));
      } catch (e) {
        if (e instanceof PeleError) throw Object.assign(new Error(`${e.code}${e.line ? ` at line ${e.line}` : ""}: ${e.message}`), { snippet: e.snippet });
        throw e;
      }
      // Its colours are CSS variables (--pele-*), which librsvg (sharp) can't read: the door's palette is set on its root,
      // then flattenSvgVars writes every one in as a value.
      const theme = `--pele-bg:${hex(c.bg)};--pele-fg:${hex(c.fg)};--pele-muted:${hex(c.muted)};--pele-line:${hex(c.line)};--pele-surface:${hex(c.surface)};--pele-surface-alt:${hex(c.surfaceAlt)};--pele-border:${hex(c.border)};--pele-accent:${hex(c.accent)};`;
      return scaleSvg(flattenSvgVars(svg.replace(/(<svg\b[^>]*\bstyle=")/, `$1${theme}`)), PICTURE_SCALE);
    },
  },
  svg: {
    describe: describeSvg,
    limits: svgLimits,
    async svg(source) {
      const s = source.trim();
      if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(s)) throw new Error("an svg fence starts with <svg …>");
      return scaleSvg(flattenSvgVars(s), PICTURE_SCALE);
    },
  },
};

/** The picture kind fence `language` draws as, or null when it's text (any other language, or none). */
export const fencePictureOf = (language: string): FencePicture | null => Object.hasOwn(FENCE_PICTURES, language.toLowerCase()) ? FENCE_PICTURES[language.toLowerCase() as PictureFence]! : null;

/** The door's colours for a picture: its palette's ground, text, blue lines and cyan arrows. */
export function pictureColours(): PictureColours {
  const p = theme().palette;
  const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => Math.round(v * t + b[i]! * (1 - t))) as unknown as Rgb;
  return { bg: p[0]!, fg: p[7]!, muted: p[8]!, line: p[9]!, accent: p[11]!, surface: mix(p[1]!, p[0]!, 0.25), surfaceAlt: mix(p[1]!, p[0]!, 0.4), border: p[1]! };
}

// ── the cache ─────────────────────────────────────────────────────────────────

/** What each fence has come to, by its file name (its content and colours). */
const states = new Map<string, PictureState>();

/**
 * Fence `language`'s picture of `source`, as the door has it now. The first ask starts making its SVG (off the draw
 * path; a redraw follows through media's change hook) and says "drawing"; once the file is there it's "ready" with
 * its path, the same file for the same text in the same colours (also across restarts: it's in the media cache).
 */
export function fencePicture(language: string, source: string, room: PictureRoom, colours: PictureColours = pictureColours()): PictureState | null {
  const kind = fencePictureOf(language);
  if (!kind) return null;
  const label = kind.describe(source);
  // Laid out again at each step of 160 pixels across, never wider than the room (a resize draws the last one meanwhile).
  const at: PictureRoom = { pxWidth: Math.max(160, Math.floor(room.pxWidth / 160) * 160), fontSize: room.fontSize };
  const name = createHash("sha1").update(`${language.toLowerCase()}\0${source.trim()}\0${JSON.stringify(colours)}\0${at.pxWidth}\0${at.fontSize}`).digest("hex").slice(0, 20);
  const path = join(mediaCache(), "pictures", `${name}.svg`);
  const known = states.get(name);
  if (known) return known.state === "ready" && !existsSync(path) ? (states.delete(name), fencePicture(language, source, room, colours)) : { ...known, label };
  if (existsSync(path)) { const ready: PictureState = { state: "ready", label, path }; states.set(name, ready); return ready; }
  const drawing: PictureState = { state: "drawing", label };
  states.set(name, drawing);
  kind.svg(source, colours, at).then(svg => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try { writeFileSync(tmp, svg); renameSync(tmp, path); } finally { rmSync(tmp, { force: true }); }
    states.set(name, { state: "ready", label, path });
  }, e => {
    const snippet = (e as { snippet?: string }).snippet;
    states.set(name, { state: "error", label, reason: String((e as Error).message ?? e).split("\n")[0]!, ...(snippet ? { snippet } : {}) });
  }).finally(() => mediaChanged());
  return drawing;
}

/** Every fence picture made or being made, forgotten (a test starting fresh). */
export function forgetFencePictures(): void { states.clear(); }

// ── SVG for librsvg ───────────────────────────────────────────────────────────

/**
 * `svg` with its CSS custom properties written in as values: librsvg (sharp) reads neither `var()` nor `color-mix()`,
 * and would draw every fill black. The properties come from the root's `style` and the `<style>` sheet's
 * declarations; `color-mix(in srgb, A p%, B)` is worked out; an `@import` (a web font) goes.
 */
export function flattenSvgVars(svg: string): string {
  const vars = new Map<string, string>();
  const declare = (css: string) => { for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) vars.set(m[1]!, m[2]!.trim()); };
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const style = /\bstyle\s*=\s*"([^"]*)"/.exec(root)?.[1];
  if (style) declare(style);
  for (const sheet of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) declare(sheet[1]!.replace(/\/\*[\s\S]*?\*\//g, ""));
  if (!vars.size && !/var\(--/.test(svg)) return svg.replace(/@import[^;]*;/g, "");
  const resolve = (value: string, depth = 0): string => {
    if (depth > 12) return value;
    let v = value, prev = "";
    while (v !== prev) {
      prev = v;
      // The innermost var() first: its fallback can hold another.
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (_, name: string, fallback?: string) => {
        const own = vars.get(name);
        return own !== undefined ? resolve(own, depth + 1) : fallback !== undefined ? resolve(fallback.trim(), depth + 1) : "currentColor";
      });
    }
    return v.replace(/color-mix\(\s*in\s+srgb\s*,\s*([^,()]+?)\s+([\d.]+)%\s*,\s*([^,()]+?)\s*\)/g, (_, a: string, p: string, b: string) => mixColours(a, b, Number(p) / 100) ?? a);
  };
  let out = svg.replace(/@import[^;]*;/g, "");
  out = out.replace(/var\(\s*--[\w-]+\s*(?:,\s*(?:[^()]|\((?:[^()]|\([^()]*\))*\))*)?\)/g, m => resolve(m));
  // A colour left as a color-mix outside any var() (written straight into a fill).
  return out.replace(/color-mix\(\s*in\s+srgb\s*,\s*([^,()]+?)\s+([\d.]+)%\s*,\s*([^,()]+?)\s*\)/g, (m, a: string, p: string, b: string) => mixColours(a, b, Number(p) / 100) ?? m);
}

/** `a` at `t` mixed with `b`, both `#rgb` or `#rrggbb`; null when either isn't one. */
function mixColours(a: string, b: string, t: number): string | null {
  const rgb = (s: string): number[] | null => {
    const h = s.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(h)) return [...h].map(c => parseInt(c + c, 16));
    if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return null;
  };
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return null;
  return `#${x.map((v, i) => Math.round(v * t + y[i]! * (1 - t)).toString(16).padStart(2, "0")).join("")}`;
}

/** `svg` with its root's `width` and `height` times `k` (its viewBox kept): drawn sharp at a wide tile's size. */
export function scaleSvg(svg: string, k: number): string {
  return svg.replace(/<svg\b[^>]*>/i, root => root.replace(/\b(width|height)\s*=\s*"([\d.]+)"/g, (_, a: string, v: string) => `${a}="${Math.round(Number(v) * k)}"`));
}

// ── links in an SVG ───────────────────────────────────────────────────────────

/** An `<a href>` in an SVG, and the part of the picture it covers (fractions of it, across and down). */
export interface PictureLink { href: string; label: string; box: { x: number; y: number; w: number; h: number } }

/** The `<a>` elements of `svg`, in order: each one's href (`href` or `xlink:href`) and its words. */
export function svgAnchors(svg: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  for (const m of svg.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\b(?:xlink:)?href\s*=\s*"([^"]*)"|\b(?:xlink:)?href\s*=\s*'([^']*)'/i.exec(m[1]!);
    const value = (href?.[1] ?? href?.[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!value) continue;
    const words = m[2]!.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    // A link with no words of its own (a shape) is named by where it goes: the page, the block, the address.
    out.push({ href: value, label: words || value.replace(/^\[\[([^\]|]+).*$/, "$1").replace(/^\(\(([^)|]+)\|?([^)]*)\)\)$/, (_, id: string, l: string) => l || id) });
  }
  return out;
}

/** How wide the masks a link's box is found from are drawn: enough for a cell's accuracy in the widest reader. */
const MASK_PX = 480;

/**
 * Where each `<a href>` of `svg` is drawn, as fractions of the picture: each link alone is drawn as a mask (every
 * other element hidden, its own shapes and words white; librsvg keeps transforms and nesting), and its box is where
 * the mask has ink. A link that draws nothing (an empty `<a>`) has no box and is left out.
 */
export async function svgLinkBoxes(svg: string): Promise<PictureLink[]> {
  const anchors = svgAnchors(svg);
  if (!anchors.length) return [];
  const sharp = (await import("sharp")).default;
  let k = 0;
  const stamped = svg.replace(/<a\b/gi, m => `${m} data-ep0ch-link="${k++}"`);
  const out: PictureLink[] = [];
  let n = 0;
  for (const m of svg.matchAll(/<a\b([^>]*)>/gi)) {
    const i = n++;
    if (!/\bhref\s*=/i.test(m[1]!)) continue;
    const anchor = anchors.shift();
    if (!anchor) break;
    const style = `<style>*{visibility:hidden}[data-ep0ch-link="${i}"],[data-ep0ch-link="${i}"] *{visibility:visible;fill:#fff;stroke:#fff}</style>`;
    const mask = stamped.replace(/(<svg\b[^>]*>)/i, `$1${style}`);
    const { data, info } = await sharp(Buffer.from(mask)).resize({ width: MASK_PX, withoutEnlargement: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3]! > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) continue;
    out.push({ ...anchor, box: { x: x0 / info.width, y: y0 / info.height, w: (x1 + 1 - x0) / info.width, h: (y1 + 1 - y0) / info.height } });
  }
  return out;
}

/** The links of each SVG file, by its path and when it last changed: null while they're being found. */
const linkCache = new Map<string, { stamp: string; links: PictureLink[] | null }>();

/**
 * The links in the SVG file at `path` (an [img::…svg] line, a fence's or a script's picture), with the part of the
 * picture each covers; null while they're found (off the draw path: a redraw follows), [] for none or not an SVG.
 */
export function pictureLinks(path: string): PictureLink[] | null {
  if (!/\.svg$/i.test(path)) return [];
  let stamp: string;
  try { const st = statSync(path); stamp = `${st.mtimeMs}:${st.size}`; } catch { return []; }
  const hit = linkCache.get(path);
  if (hit && hit.stamp === stamp) return hit.links;
  const entry: { stamp: string; links: PictureLink[] | null } = { stamp, links: null };
  linkCache.set(path, entry);
  let svg = "";
  try { svg = readFileSync(path, "utf8"); } catch { entry.links = []; return []; }
  if (!/<a\b/i.test(svg)) { entry.links = []; return []; }
  svgLinkBoxes(svg).then(links => { entry.links = links; }, () => { entry.links = []; }).finally(() => mediaChanged());
  return null;
}

/**
 * Where an SVG link's href goes, as the reader opens a link: `((id))` (or `((id|label))`) a block, `[[page]]` a page, a
 * web address the browser; anything else (`#frag`, `javascript:`) nowhere.
 */
export function pictureLinkTarget(href: string, label: string): { block: string; label: string } | { page: string; label: string } | { url: string; label: string } | null {
  const h = href.trim();
  const block = /^\(\(([^)|^]+)(?:\^[^)|]*)?(?:\|[^)]*)?\)\)$/.exec(h);
  if (block) return { block: block[1]!.trim(), label };
  const page = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(h);
  if (page) return { page: page[1]!.trim(), label };
  if (/^https?:\/\//i.test(h)) return { url: h, label };
  return null;
}
