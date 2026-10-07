// The media line (PIE-532): a note line that is only an image or video reference and its layout properties. Shared
// so the service and every client agree on it: the reader draws it, the image actions rewrite it, and the property
// parser never takes it for block metadata (an image right under a note's subject is content, PIE-598).

/** What a media line names: an image or a video. */
export type MediaKind = "img" | "video";
export type Align = "left" | "center" | "right";
export const ALIGNS: readonly Align[] = ["left", "center", "right"];
export type MediaSize = { cells: number } | { percent: number } | "full";
/**
 * A note line that is only a media reference and its layout (PIE-532): `img:: path`, or `[img::path]` (`image`,
 * `video`) after an optional list mark, then any of `[size::…]` (its width: cells, `N%` of the reader, or `full`),
 * `[height::N]` (rows), `[align::left|center|right]`, `[layout::hero]` (the note's header image), `[fit::cover|contain]`
 * (a header's: crop to fill, or show it whole), `[dim::N]` (0 none … 1 black; left out, a bright image is dimmed),
 * `[hero-focus::x,y]` (the point a header's crop and backdrop keep in view, fractions or percents across and down;
 * its middle when left out) and `[alt::…]`; a block anchor (`^id`) may end it. `problems`: what's written there that isn't one of those values,
 * said on the image's line.
 */
export interface MediaSpec {
  kind: MediaKind; path: string;
  size?: MediaSize; height?: number; align?: Align; layout?: "hero"; fit?: "cover" | "contain"; dim?: number; focus?: Focus; alt?: string;
  problems: string[];
}
/** A point in an image, as fractions of it across and down. */
export type Focus = { x: number; y: number };
export type MediaAttr = "size" | "height" | "align" | "layout" | "fit" | "dim" | "hero-focus" | "alt";
const MEDIA_KEY = /^(img|image|video)$/i;
const ATTRS = new Set<string>(["size", "height", "align", "layout", "fit", "dim", "hero-focus", "alt"]);
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
  const blockForm = /^(img|image|video)::\s*(.*)$/i.exec(rest);
  if (blockForm) {
    const tail = /(?:^|\s)(\[(?:size|height|align|layout|fit|dim|hero-focus|alt)::.*)$/i.exec(blockForm[2]!);
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
  const spec: MediaSpec = { kind: media[0]!.key.toLowerCase() === "video" ? "video" : "img", path: media[0]!.value, problems: [] };
  const seen = new Set<string>();
  for (const { key, value } of t.toks) {
    const k = key.toLowerCase(), v = value.trim().toLowerCase();
    if (MEDIA_KEY.test(k)) continue;
    // A key written twice: the first counts (the one image.* changes), and the line says so.
    if (seen.has(k)) { spec.problems.push(`${k} is written twice: the first counts`); continue; }
    seen.add(k);
    if (k === "size") {
      const size = parseSize(v);
      if (size) spec.size = size; else spec.problems.push(`size::${value} isn't a size (cells, N% or full)`);
    } else if (k === "height") {
      if (/^\d{1,3}$/.test(v) && +v > 0) spec.height = +v; else spec.problems.push(`height::${value} isn't a number of rows`);
    } else if (k === "align") {
      if ((ALIGNS as readonly string[]).includes(v)) spec.align = v as Align; else spec.problems.push(`align::${value} isn't left, center or right`);
    } else if (k === "layout") {
      if (v === "hero") spec.layout = "hero"; else spec.problems.push(`layout::${value} isn't a layout (hero)`);
    } else if (k === "fit") {
      if (v === "cover" || v === "contain") spec.fit = v; else spec.problems.push(`fit::${value} isn't cover or contain`);
    } else if (k === "dim") {
      const d = parseDim(v);
      if (d !== null) spec.dim = d; else spec.problems.push(`dim::${value} isn't a number from 0 to 1`);
    } else if (k === "hero-focus") {
      const f = parseFocus(v);
      if (f) spec.focus = f; else spec.problems.push(`hero-focus::${value} isn't a point (x,y: 0 to 1, or percents)`);
    } else if (k === "alt") spec.alt = value.trim();
  }
  return spec;
}

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
