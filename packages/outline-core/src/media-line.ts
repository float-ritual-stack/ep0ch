import { isArtifactName } from "./artifacts";
// The media line (PIE-532): a note line that is only an image, video or artifact reference and its layout properties.
// Shared so the service and every client agree on it: the reader draws it, the image actions rewrite it, and the
// property parser never takes it for block metadata (an image right under a note's subject is content, PIE-598).
// An artifact (PIE-793) is a file claude.ai would run (`.jsx`/`.tsx`, `.html`, `.svg`, `.mermaid`): the web pages run it
// inline in a sandboxed frame, the door draws it as a card that opens that page.

import { noteStructure } from "./component-block";
import { frontMatterLines } from "./header-line";
import { propertyTokensInLine } from "./property-grammar";
import { parseResourceRef } from "./resource-ref";

/** What a media line names: an image, a video or an artifact. */
export type MediaKind = "img" | "video" | "artifact";
export type Align = "left" | "center" | "right";
export const ALIGNS: readonly Align[] = ["left", "center", "right"];
export type MediaSize = { cells: number } | { percent: number } | "full";
/**
 * A note line that is only a media reference and its layout (PIE-532): `img:: path`, or `[img::path]` (`image`,
 * `video`, `artifact`) after an optional list mark, then any of `[size::…]` (its width: cells, `N%` of the reader, or `full`),
 * `[height::N]` (rows), `[align::left|center|right]`, `[layout::hero]` (the note's header image), `[fit::cover|contain]`
 * (a header's: crop to fill, or show it whole), `[dim::N]` (0 none … 1 black; left out, a bright image is dimmed),
 * `[hero-focus::x,y]` (the point a header's crop and backdrop keep in view, fractions or percents across and down;
 * its middle when left out) and `[alt::…]`; a block anchor (`^id`) may end it. `problems`: what's written there that isn't one of those values,
 * said on the image's line. An artifact takes `size`, `height`, `align` and `alt`; the rest are an image's, and said as
 * problems on its line.
 */
export interface MediaSpec {
  kind: MediaKind; path: string;
  size?: MediaSize; height?: number; align?: Align; layout?: "hero"; fit?: "cover" | "contain"; dim?: number; focus?: Focus; alt?: string;
  blur?: number; bleed?: "full" | "measure"; heightShare?: number; tint?: number; fade?: number; title?: "below" | "over"; scroll?: "scroll" | "pinned";
  problems: string[];
}
/** A point in an image, as fractions of it across and down. */
export type Focus = { x: number; y: number };
export type MediaAttr = "size" | "height" | "align" | "layout" | "fit" | "dim" | "hero-focus" | "alt" | "blur" | "bleed" | "tint" | "fade" | "title" | "scroll";
const MEDIA_KEY = /^(img|image|video|artifact)$/i;
/** The layout properties a media line takes beside its path: what the library's image schemas must document. */
export const MEDIA_ATTRS: readonly MediaAttr[] = ["size", "height", "align", "layout", "fit", "dim", "hero-focus", "alt", "blur", "bleed", "tint", "fade", "title", "scroll"];
const ATTRS = new Set<string>(MEDIA_ATTRS);
const LEAD = /^\s*(?:[-*]\s+)?/;
/** A block anchor ending a line (` ^beds`), kept as it is when the line is rewritten. */
const ANCHOR = /\s+\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\s*$/;

interface Tok { key: string; value: string }
/**
 * `[key::value]` tokens from the start of `rest`, separated by blanks, a value's own brackets balanced
 * (`[img::shots/a [1].png]`); null when anything else is there.
 */
function scanTokens(rest: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < rest.length) {
    const head = /^\[([A-Za-z][\w-]*)::/.exec(rest.slice(i));
    if (!head) return null;
    let j = i + head[0].length, depth = 0;
    for (; j < rest.length; j++) {
      if (rest[j] === "[") depth++;
      else if (rest[j] === "]") { if (depth === 0) break; depth--; }
    }
    if (j >= rest.length) return null;
    toks.push({ key: head[1]!, value: rest.slice(i + head[0].length, j).trim() });
    i = j + 1;
    const gap = /^\s*/.exec(rest.slice(i))![0].length;
    if (gap === 0 && i < rest.length) return null;
    i += gap;
  }
  return toks;
}

/** The line's lead (its indent and list mark), its tokens (the media one first for `img:: path`), and its anchor. */
function tokens(line: string): { lead: string; toks: Tok[]; block: boolean; anchor: string } | null {
  const anchor = ANCHOR.exec(line)?.[0] ?? "";
  const body = anchor ? line.slice(0, -anchor.length) : line.trimEnd();
  const lead = LEAD.exec(body)![0], rest = body.slice(lead.length);
  // `img:: path`, perhaps followed by the layout tokens: the path is what comes before them.
  const blockForm = /^(img|image|video|artifact)::\s*(.*)$/i.exec(rest);
  if (blockForm) {
    const tail = /(?:^|\s)(\[(?:size|height|align|layout|fit|dim|hero-focus|alt|blur|bleed|tint|fade|title|scroll)::.*)$/i.exec(blockForm[2]!);
    const path = (tail ? blockForm[2]!.slice(0, tail.index) : blockForm[2]!).trim();
    const more = tail ? scanTokens(tail[1]!) : [];
    if (!path || path.startsWith("[") || !more) return null;
    return { lead, toks: [{ key: blockForm[1]!, value: path }, ...more], block: true, anchor };
  }
  const toks = rest ? scanTokens(rest) : null;
  return toks ? { lead, toks, block: false, anchor } : null;
}

/** Whether `line` is a media line (parseMediaLine): content to draw, never a line of block metadata. */
export const isMediaLine = (line: string): boolean => parseMediaLine(line) !== null;

export function parseMediaLine(line: string): MediaSpec | null {
  const t = tokens(line);
  if (!t) return null;
  const media = t.toks.filter(x => MEDIA_KEY.test(x.key));
  if (media.length !== 1 || !media[0]!.value || t.toks.some(x => !MEDIA_KEY.test(x.key) && !ATTRS.has(x.key.toLowerCase()))) return null;
  const key = media[0]!.key.toLowerCase();
  const spec: MediaSpec = { kind: key === "video" ? "video" : key === "artifact" ? "artifact" : "img", path: media[0]!.value, problems: [] };
  if (spec.kind === "artifact" && !artifactKind(spec.path) && !isArtifactName(spec.path) && !artifactRepoRef(spec.path)) spec.problems.push(`${fileName(spec.path)} isn't an artifact (${ARTIFACT_EXTENSIONS})`);
  const seen = new Set<string>();
  for (const { key, value } of t.toks) {
    const k = key.toLowerCase(), v = value.trim().toLowerCase();
    if (MEDIA_KEY.test(k)) continue;
    if (spec.kind === "artifact" && !ARTIFACT_ATTRS.has(k)) { spec.problems.push(`${k}:: is an image's: an artifact takes size, height, align and alt`); continue; }
    // A key written twice: the first counts (the one image.* changes), and the line says so.
    if (seen.has(k)) { spec.problems.push(`${k} is written twice: the first counts`); continue; }
    seen.add(k);
    if (k === "size") {
      const size = parseSize(v);
      if (size) spec.size = size; else spec.problems.push(`size::${value} isn't a size (cells, N% or full)`);
    } else if (k === "height") {
      if (/^\d{1,2}%$/.test(v) && parseInt(v) > 0 && parseInt(v) <= 50) spec.heightShare = parseInt(v) / 100;
      else if (/^\d{1,3}$/.test(v) && +v > 0) spec.height = +v; else spec.problems.push(`height::${value} isn't a number of rows`);
    } else if (k === "align") {
      if ((ALIGNS as readonly string[]).includes(v)) spec.align = v as Align; else spec.problems.push(`align::${value} isn't left, center or right`);
    } else if (k === "layout") {
      if (v === "hero") spec.layout = "hero"; else spec.problems.push(`layout::${value} isn't a layout (hero)`);
    } else if (k === "fit") {
      if (v === "cover" || v === "contain") spec.fit = v; else spec.problems.push(`fit::${value} isn't cover or contain`);
    } else if (k === "dim") {
      const d = parseDim(v);
      if (d !== null) spec.dim = d; else spec.problems.push(`dim::${value} isn't a number from 0 to 1`);
    } else if (k === "blur") {
      if (/^\d+$/.test(v) && +v <= 24) spec.blur = +v; else spec.problems.push(`blur::${value} must be 0 to 24`);
    } else if (k === "tint" || k === "fade") {
      const n = parseDim(v);
      if (n !== null) spec[k] = n; else spec.problems.push(`${k}::${value} must be 0 to 1`);
    } else if (k === "bleed") {
      if (v === "full" || v === "measure") spec.bleed = v; else spec.problems.push(`bleed::${value} must be full or measure`);
    } else if (k === "title") {
      if (v === "below" || v === "over") spec.title = v; else spec.problems.push(`title::${value} must be below or over`);
    } else if (k === "scroll") {
      if (v === "scroll" || v === "pinned") spec.scroll = v; else spec.problems.push(`scroll::${value} must be scroll or pinned`);
    } else if (k === "hero-focus") {
      const f = parseFocus(v);
      if (f) spec.focus = f; else spec.problems.push(`hero-focus::${value} isn't a point (x,y: 0 to 1, or percents)`);
    } else if (k === "alt") spec.alt = value.trim();
  }
  return spec;
}

/**
 * An extension view's `image` primitive (PIE-827): `{ type: "image", src, alt?, size?, fit?, height?, caption? }`. `src` is
 * a path, as an `[img::]` line names one, or a `file:` Resource ref; `size` is written as `[size::]` is (cells, `N%` or
 * `full`). `caption: false` (PIE-839): the picture alone where it's drawn, without the caption line under it (a card's
 * cover, where the card is what opens); where it can't be drawn, its caption still says what it is.
 */
export interface ImagePrimitive { src: string; alt?: string; size?: string | number; fit?: "cover" | "contain"; height?: number; caption?: boolean }

/**
 * The path an image primitive's `src` names: a `file:` Resource ref's path, read by `parseResourceRef` (so it is
 * absolute and has no control characters), else the path as written. A `file:` ref that can't be read names nothing.
 */
export function imageSource(src: string): string {
  if (!src.startsWith("file:")) return src;
  const ref = parseResourceRef(src);
  return "kind" in ref && ref.kind === "filesystem" ? ref.path : "";
}

/**
 * An image primitive as the media line it stands for (PIE-827): one spec, so every client lays it out, dims it and
 * serves it as it does a note's `[img::]` line (the door's graphics, the publisher's served image, alt text and path
 * where neither can be drawn). What isn't a value of the line's grammar is a problem, said on its caption.
 */
export function imagePrimitiveSpec(node: ImagePrimitive): MediaSpec {
  const spec: MediaSpec = { kind: "img", path: imageSource(node.src), problems: [] };
  if (!spec.path) spec.problems.push(`${node.src} isn't a file: ref this can read (file:/absolute/path)`);
  if (node.size !== undefined) {
    const size = parseSize(String(node.size));
    if (size) spec.size = size; else spec.problems.push(`size ${node.size} isn't a size (cells, N% or full)`);
  }
  if (node.height !== undefined) spec.height = node.height;
  if (node.fit !== undefined) spec.fit = node.fit;
  if (node.alt?.trim()) spec.alt = node.alt.trim();
  return spec;
}

/** The layout an artifact takes: the rest are an image's. */
const ARTIFACT_ATTRS = new Set<string>(["size", "height", "align", "alt"]);

/** What kind of artifact a file is (claude.ai's kinds), by its extension. */
export type ArtifactKind = "react" | "html" | "svg" | "mermaid";
const ARTIFACT_KINDS: Readonly<Record<string, ArtifactKind>> = {
  ".jsx": "react", ".tsx": "react", ".html": "html", ".htm": "html", ".svg": "svg", ".mermaid": "mermaid", ".mmd": "mermaid",
};
const ARTIFACT_EXTENSIONS = ".jsx, .tsx, .html, .svg or .mermaid";
/** How a kind is named to a reader. */
export const ARTIFACT_KIND_LABELS: Readonly<Record<ArtifactKind, string>> = { react: "React", html: "HTML", svg: "SVG", mermaid: "Mermaid" };
/** A file's name, never its folders. */
export const fileName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";
/**
 * The GitHub repo an artifact line names (PIE-1060): `https://github.com/<owner>/<name>`, `github.com/<owner>/<name>` or
 * `<owner>/<name>` (a `.git` or a trailing `/` left off), never a file claude.ai runs (`shots/lamp.html` is a path).
 * Null when the value isn't one. Which owners may deploy is the deploy's rule, not the grammar's.
 */
export function artifactRepoRef(value: string): { owner: string; name: string; repo: string } | null {
  const trimmed = value.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.*)$/i.exec(trimmed);
  // An address on another host is a link, not a repo.
  if (!url && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const parts = (url ? url[1]! : trimmed).replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner) || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name) || artifactKind(name)) return null;
  return { owner, name, repo: `${owner}/${name}` };
}
/** The kind of artifact `path` is, by its extension; null when it's none claude.ai runs. */
export function artifactKind(path: string): ArtifactKind | null {
  const ext = /\.[A-Za-z0-9]+$/.exec(fileName(path))?.[0]?.toLowerCase();
  return (ext && ARTIFACT_KINDS[ext]) || null;
}
const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
/**
 * An artifact's title, as both clients show it: its line's `[alt::]`, else an HTML or SVG file's `<title>` (from `text`,
 * its contents, when they were read), else its file's name.
 */
export function artifactTitle(spec: Pick<MediaSpec, "path" | "alt">, text?: string): string {
  if (spec.alt) return spec.alt;
  const kind = artifactKind(spec.path);
  if (text !== undefined && (kind === "html" || kind === "svg")) {
    const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(text.slice(0, 64 * 1024))?.[1]
      ?.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e]!).replace(/\s+/g, " ").trim();
    if (title) return title;
  }
  return fileName(spec.path);
}
/**
 * Where the publisher runs line `line`'s artifact of note `blockId`, below a page's base (`/pub`, a share's): the
 * web page frames it, and the door's open goes there. It names the note and the line, never a path.
 */
export const artifactPagePath = (blockId: string, line: number) => `/p/${blockId}/artifact/${line}`;

/** A width as `[size::…]` writes it: cells, `N%` (1–100) or `full`; null when it's none of those. */
export function parseSize(v: string): MediaSize | null {
  const s = v.trim().toLowerCase();
  if (s === "full") return "full";
  const pc = /^(\d{1,3})%$/.exec(s);
  if (pc && +pc[1]! > 0 && +pc[1]! <= 100) return { percent: +pc[1]! };
  if (/^\d{1,4}$/.test(s) && +s > 0) return { cells: +s };
  return null;
}
/** How much to dim, as `[dim::…]` writes it: a number from 0 (none) to 1 (black); null otherwise. */
export function parseDim(v: string): number | null {
  const s = v.trim();
  return /^(0|1|0?\.\d+|1\.0+)$/.test(s) ? Number(s) : null;
}
/** A point as `[hero-focus::…]` writes it: `x,y`, each a fraction (0–1) or a percent; null otherwise. */
export function parseFocus(v: string): Focus | null {
  const parts = v.split(",").map(x => x.trim());
  if (parts.length !== 2) return null;
  const [x, y] = parts.map(p => { const pc = /^(\d{1,3}(?:\.\d+)?)%$/.exec(p); return pc ? +pc[1]! / 100 : parseDim(p); });
  return x !== null && x !== undefined && y !== null && y !== undefined && x <= 1 && y <= 1 ? { x, y } : null;
}
export const sizeText = (s: MediaSize | undefined) => s === undefined ? "" : s === "full" ? "full" : "percent" in s ? `${s.percent}%` : `${s.cells}`;

/**
 * `line` (a media line) with its layout properties changed: each key in `set` written with its value, or taken out
 * when it's null. A token already there keeps its place (a second one of the same key goes); new ones go after the
 * rest; an anchor stays at the end. `img:: path` becomes `[img::path]` so the properties sit beside it. Null when
 * `line` isn't a media line.
 */
export function rewriteMediaLine(line: string, set: Partial<Record<MediaAttr, string | null>>): string | null {
  const t = parseMediaLine(line) ? tokens(line) : null;
  if (!t) return null;
  let toks = t.toks.map(x => ({ ...x }));
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) continue;
    const i = toks.findIndex(x => x.key.toLowerCase() === k);
    if (v === null) toks = toks.filter(x => x.key.toLowerCase() !== k);
    else if (i < 0) toks.push({ key: k, value: v });
    else { toks[i]!.value = v; toks = toks.filter((x, j) => j === i || x.key.toLowerCase() !== k); }
  }
  return t.lead + toks.map(x => `[${x.key}::${x.value}]`).join(" ") + t.anchor;
}

/**
 * A header image's look (PIE-1361): each a property on its own `[layout::hero]` line, so the note owns it and its source
 * shows it. The tune's hero rows and the `image.look` action read this one description: what each is, what leaving it
 * out means, and the values a step goes through (`none` takes it off the line). `focus.x` and `focus.y` are the two
 * halves of `[hero-focus::x,y]`.
 */
export type HeroProp = "height" | "focus.x" | "focus.y" | "fit" | "dim" | "tint" | "fade" | "blur" | "bleed" | "title" | "scroll";
export interface HeroPropSpec { attr: MediaAttr; what: string; none: string; steps: readonly string[] }
const tenths = Array.from({ length: 11 }, (_, i) => String(i / 10));
export const HERO_PROPS: Readonly<Record<HeroProp, HeroPropSpec>> = {
  height: { attr: "height", what: "the header's rows (a number), or a share of the reader (25%), at most half of it", none: "a third", steps: Array.from({ length: 19 }, (_, i) => String(4 + i * 2)) },
  "focus.x": { attr: "hero-focus", what: "the point the crop keeps in view, across (0 left … 1 right)", none: "0.5", steps: tenths },
  "focus.y": { attr: "hero-focus", what: "the point the crop keeps in view, down (0 top … 1 bottom)", none: "0.5", steps: tenths },
  fit: { attr: "fit", what: "cover crops it to fill; contain shows it whole", none: "cover", steps: ["none", "contain"] },
  dim: { attr: "dim", what: "darken it, 0 (as it is) to 1 (black)", none: "auto", steps: ["none", "0", "0.2", "0.4", "0.6", "0.8", "1"] },
  tint: { attr: "tint", what: "duotone toward the tile's tone, 0 (as it is) to 1", none: "0", steps: ["none", "0.25", "0.5", "0.75", "1"] },
  fade: { attr: "fade", what: "the share of its bottom that fades into the reader, 0 to 1", none: "0", steps: ["none", "0.25", "0.5", "0.75", "1"] },
  blur: { attr: "blur", what: "soften it, 0 (sharp) to 24", none: "0", steps: ["none", "1", "2", "4", "8", "12", "16", "24"] },
  bleed: { attr: "bleed", what: "full spans the tile; measure follows the text column", none: "full", steps: ["none", "measure"] },
  title: { attr: "title", what: "the title below the picture, or over its bottom", none: "below", steps: ["none", "over"] },
  scroll: { attr: "scroll", what: "scroll away with the note, or stay pinned above it", none: "scroll", steps: ["none", "pinned"] },
};
/** The steps of a height written as a share of the reader. */
const HEIGHT_SHARES: readonly string[] = ["10%", "15%", "20%", "25%", "33%", "40%", "50%"];
export const HERO_PROP_NAMES = Object.keys(HERO_PROPS) as HeroProp[];
export const isHeroProp = (s: string): s is HeroProp => Object.hasOwn(HERO_PROPS, s);

/** What `spec`'s line writes for `prop`, as text; undefined when it's left out. */
export function heroPropText(spec: MediaSpec, prop: HeroProp): string | undefined {
  const n = (v: number | undefined) => (v === undefined ? undefined : String(Math.round(v * 100) / 100));
  switch (prop) {
    case "height": return spec.height !== undefined ? String(spec.height) : spec.heightShare !== undefined ? `${Math.round(spec.heightShare * 100)}%` : undefined;
    case "focus.x": return n(spec.focus?.x);
    case "focus.y": return n(spec.focus?.y);
    case "dim": case "tint": case "fade": case "blur": return n(spec[prop]);
    default: return spec[prop];
  }
}

/**
 * The line's property for `prop` set to `value` (`none` takes it off): what `rewriteMediaLine` is given, or a problem
 * saying what the value can be. A focus half keeps the other half as written (0.5 when it isn't).
 */
export function heroPropSet(spec: MediaSpec, prop: HeroProp, value: string): { set: Partial<Record<MediaAttr, string | null>> } | { problem: string } {
  const p = HERO_PROPS[prop], v = value.trim().toLowerCase();
  if (prop === "focus.x" || prop === "focus.y") {
    const f = { x: spec.focus?.x ?? 0.5, y: spec.focus?.y ?? 0.5 };
    if (v !== "none") { const d = parseDim(v); if (d === null) return { problem: `${prop} is a number from 0 to 1, or none` }; f[prop === "focus.x" ? "x" : "y"] = d; }
    else f[prop === "focus.x" ? "x" : "y"] = 0.5;
    const r = (x: number) => String(Math.round(x * 100) / 100);
    return { set: { "hero-focus": f.x === 0.5 && f.y === 0.5 ? null : `${r(f.x)},${r(f.y)}` } };
  }
  if (v === "none") return { set: { [p.attr]: null } };
  const read = parseMediaLine(`[img::x] [${p.attr}::${v}]`);
  if (!read || read.problems.length) return { problem: `${prop} is ${p.what}; or none (${p.none})` };
  return { set: { [p.attr]: v } };
}

/**
 * The value `by` steps (1 up, -1 down) from `now`: the line's, or (a height left out or written as a share) the rows
 * drawn. A value between steps (written by hand) goes to the nearest one on the side it moves to.
 */
export function heroPropStep(prop: HeroProp, now: string | undefined, by: number): string {
  const p = HERO_PROPS[prop];
  // The built-in written out (`[fit::cover]`) steps as if left out.
  const cur = now === undefined || (now === p.none && p.steps.includes("none")) ? (p.steps.includes("none") ? "none" : p.none) : now;
  // A height written as a share steps by shares, never into rows.
  const steps = prop === "height" && cur.endsWith("%") ? HEIGHT_SHARES : p.steps;
  const i = steps.indexOf(cur);
  if (i >= 0) return steps[Math.max(0, Math.min(steps.length - 1, i + Math.sign(by)))]!;
  const x = parseFloat(cur), at = (s: string) => parseFloat(s === "none" ? p.none : s);
  return (by > 0 ? steps.find(s => at(s) > x) : [...steps].reverse().find(s => at(s) < x)) ?? cur;
}

/**
 * The migration of PIE-1361's retired look keys (PIE-1365): a note's `style.header.image…` and `style.header.title`, as
 * written, read as the hero line they mean. `path` is the picture `style.header.image` named (none: there's no picture to
 * move); `set` is the line's properties for the rest, each checked as the line reads it and left out at its built-in;
 * `left` says each key that has no place on the line (a width's variant, a value the line can't take) and why. The old
 * crop offsets (`x`, `y`: % of the picture, -50 to 50 from its middle) are the focus point's halves (0.5 + offset).
 */
export function heroFromRetired(keys: readonly { key: string; value: string }[]): { path: string | null; set: Partial<Record<MediaAttr, string>>; left: string[] } {
  const set: Partial<Record<MediaAttr, string>> = {}, left: string[] = [];
  let path: string | null = null, fx: number | null = null, fy: number | null = null;
  const ATTR: Record<string, MediaAttr> = { height: "height", blur: "blur", bleed: "bleed", fit: "fit", dim: "dim", tint: "tint", fade: "fade", scroll: "scroll" };
  /** Puts `value` on the line as `attr` when the line reads it, and it isn't the built-in. */
  const put = (key: string, attr: MediaAttr, value: string) => {
    const v = value.trim().toLowerCase(), prop = (Object.keys(HERO_PROPS) as HeroProp[]).find(p => HERO_PROPS[p].attr === attr)!;
    if (v === HERO_PROPS[prop].none || (attr === "height" && v === "auto") || (attr === "dim" && v === "auto")) return;
    const read = parseMediaLine(`[img::x] [${attr}::${v}]`);
    if (!read || read.problems.length) { left.push(`${key} "${value}": ${prop} is ${HERO_PROPS[prop].what}`); return; }
    if (heroPropText(read, prop) === HERO_PROPS[prop].none) return;
    set[attr] = v;
  };
  for (const { key, value } of keys) {
    const k = key.toLowerCase().replace(/^style\./, "");
    if (/^(narrow|wide)\./.test(k)) { left.push(`${key}: a width's own value (a hero line has one look at every width)`); continue; }
    if (k === "header.image") { path = value.trim().replace(/^(['"])(.*)\1$/, "$2") || null; continue; }
    if (k === "header.title") { const v = value.trim().toLowerCase(); if (v === "over") set.title = "over"; else if (v !== "below") left.push(`${key} "${value}": title is below or over`); continue; }
    const m = /^header\.image\.(.+)$/.exec(k);
    if (m && (m[1] === "x" || m[1] === "y")) {
      const n = Number(value.trim());
      if (!Number.isFinite(n) || n < -50 || n > 50) { left.push(`${key} "${value}": a crop offset is -50 to 50`); continue; }
      if (m[1] === "x") fx = n; else fy = n;
      continue;
    }
    if (m && ATTR[m[1]!]) { put(key, ATTR[m[1]!]!, value); continue; }
    left.push(`${key}: no hero property says it`);
  }
  if (fx !== null || fy !== null) {
    const r = (o: number | null) => String(Math.round((0.5 + (o ?? 0) / 100) * 100) / 100);
    if ((fx ?? 0) !== 0 || (fy ?? 0) !== 0) set["hero-focus"] = `${r(fx)},${r(fy)}`;
  }
  return { path, set, left };
}

/**
 * `text` with the retired keys' picture as its header image (PIE-1365, their move), as the old cascade drew it: the line
 * owned its look and the keys filled in only what it left out. A hero line already there stays the header, given the
 * properties of `set` it doesn't write (`path` is then said in `left`, not drawn twice); else the image line naming
 * `path` is made the hero the same way; else a new `[img::path] [layout::hero]` line goes under the note's subject and
 * its properties. `line` is the hero line's, from 0, in the text returned.
 */
export function withHeroLine(text: string, path: string, set: Partial<Record<MediaAttr, string>>): { text: string; line: number; left: string[] } {
  const lines = text.split("\n"), base = (p: string) => p.split("/").pop()!, left: string[] = [];
  // Only the lines the reader draws as pictures: one in a fence or a component is an example, not the note's.
  const drawn = noteStructure(lines), spec = (i: number) => (i >= 0 && drawn[i] === -1 ? parseMediaLine(lines[i]!) : null);
  let at = lines.findIndex((_, i) => spec(i)?.layout === "hero");
  if (at >= 0 && spec(at)!.path !== path) left.push(`the picture ${base(path)}: the note's own header picture (${base(spec(at)!.path)}) stays`);
  // The image naming it: by its path, or, when the key named only a file, by that name (as header.image allowed).
  if (at < 0) at = lines.findIndex((_, i) => { const m = spec(i); return !!m && m.kind === "img" && (m.path === path || (!path.includes("/") && base(m.path) === path)); });
  if (at >= 0) {
    const has = spec(at)!, written = (a: MediaAttr) => a === "hero-focus" ? has.focus !== undefined : a === "height" ? has.height !== undefined || has.heightShare !== undefined : has[a as keyof MediaSpec] !== undefined;
    const fill = Object.fromEntries(Object.entries(set).filter(([a]) => !written(a as MediaAttr)));
    for (const a of Object.keys(set)) if (written(a as MediaAttr)) left.push(`${a}: the line's own stays`);
    lines[at] = rewriteMediaLine(lines[at]!, { layout: "hero", ...fill })!;
  } else {
    // Under the subject and the lines of its properties alone (a property line under the title is the note's own).
    const front = frontMatterLines(text);
    at = lines.findIndex(l => l.trim() !== "") + 1;
    const onlyProps = (l: string) => { let rest = l; for (const t of [...propertyTokensInLine(l)].reverse()) rest = rest.slice(0, t.start) + rest.slice(t.end); return !rest.trim(); };
    while (at > 0 && at < lines.length && front.has(at) && onlyProps(lines[at]!)) at++;
    if (at <= 0) at = lines.length;
    lines.splice(at, 0, rewriteMediaLine(`[img::${path}]`, { layout: "hero", ...set })!);
    if (lines[at + 1] !== undefined && lines[at + 1]!.trim()) lines.splice(at + 1, 0, "");
  }
  return { text: lines.join("\n"), line: at, left };
}
