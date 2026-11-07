// What a picture is (PIE-1594): a media line, a picture fence, a script's drawing, and which one is the note's header;
// where it is across an insert above it; how big it draws, from its words and its pixels; and one step bigger or smaller
// for every kind. Pure, given the note's text: the door's reader and digest and the published page all read it.
// media-line.ts stays the one grammar: this module reads it, and adds no syntax.

import { noteCodeFences, noteStructure } from "./component-block";
import { heroPropStep, heroPropText, imagePrimitiveSpec, MAX_CONTENT_HEIGHT, MEDIA_ATTRS, noteMediaLines, parseMediaLine, pictureFenceSpec, rewriteImageLine, type Focus, type ImagePrimitive, type MediaAttr, type MediaSpec } from "./media-line";

export type PictureKind = "line" | "fence" | "drawing";
/** A render line whose script answered with an svg image: the service's answer, as a note's reader has it. */
export interface Drawing { line: number; svg: string; alt?: string }
export interface Picture {
  /** Who it is: the same across a resize and an insert above it (locatePicture). */
  id: string;
  kind: PictureKind;
  /** The note line it's written on (a fence's opening line, a render line). */
  line: number;
  /** That line as the note reads now. */
  source: string;
  spec: MediaSpec;
  /** The one picture the reader draws above the title. */
  header: boolean;
  /** A script's drawing: its SVG. */
  svg?: string;
}

/** How a render line names its script: what comes before its `::`. */
const renderName = (line: string): string => line.split("::")[0]!.trim();
/** The layout a render line writes, read by the media line's own grammar. */
export function drawingSpec(source: string, path = "svg picture", alt?: string): MediaSpec {
  // Only the layout words: the line's other properties are its script's.
  const tokens = (source.match(/\[[A-Za-z-]+::[^\]]*\]/g) ?? []).filter(t => (MEDIA_ATTRS as readonly string[]).includes(t.slice(1, t.indexOf("::")).toLowerCase()));
  const spec = parseMediaLine(`[img::${path}] ${tokens.join(" ")}`) ?? { kind: "img" as const, path, problems: [] };
  return { ...spec, path, drawn: true, ...(alt ? { alt } : {}) };
}

/** A script's drawing as a picture to lay out: what its script says of its size, and what its render line says over that. */
export function drawingLayout(node: ImagePrimitive, source: string | undefined, path: string): MediaSpec {
  const script = imagePrimitiveSpec({ ...node, svg: undefined, src: path }), line = source === undefined ? null : drawingSpec(source, path);
  return { ...script, path, drawn: true, ...(line?.size ? { size: line.size } : {}), ...(line?.height ? { height: line.height } : {}), ...(line?.align ? { align: line.align } : {}), ...(line?.layout ? { layout: line.layout } : {}) };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Every line that could be a picture, with what makes it this picture and not another: what it draws, never how big. */
function candidates(lines: readonly string[]): { kind: PictureKind; line: number; key: string; spec?: MediaSpec }[] {
  const out: { kind: PictureKind; line: number; key: string; spec?: MediaSpec }[] = [];
  for (const f of noteCodeFences(lines)) {
    const spec = f.closed ? pictureFenceSpec(f.fence.info) : null;
    if (spec) out.push({ kind: "fence", line: f.start, key: `${spec.fence}\0${lines.slice(f.start + 1, f.end).map(l => l.trim()).join("\n")}`, spec });
  }
  for (const [line, spec] of noteMediaLines(lines.join("\n"))) out.push({ kind: "line", line, key: spec.path, spec });
  const structure = noteStructure(lines);
  lines.forEach((l, line) => { if (structure[line] === -1 && l.includes("::") && !parseMediaLine(l)) out.push({ kind: "drawing", line, key: renderName(l) }); });
  return out.sort((a, b) => a.line - b.line);
}

/** Each candidate's id: its kind, what it draws, and which of those alike it is, of how many. */
function identified(lines: readonly string[]) {
  const all = candidates(lines), counts = new Map<string, number>(), seen = new Map<string, number>();
  const whole = (c: { kind: PictureKind; key: string }) => `${c.kind}\0${c.key}`;
  for (const c of all) counts.set(whole(c), (counts.get(whole(c)) ?? 0) + 1);
  return all.map(c => {
    const n = seen.get(whole(c)) ?? 0;
    seen.set(whole(c), n + 1);
    return { ...c, id: `${c.kind}-${fnv(c.key)}-${n + 1}-of-${counts.get(whole(c))}` };
  });
}

/**
 * A note's pictures, in reading order. `drawings`: its render lines that answered with an SVG; a render line is a picture
 * only once it has. The header is the first `[layout::hero]` media line, else the first drawing whose line says it.
 */
export function picturesIn(text: string, drawings: readonly Drawing[] = []): Picture[] {
  const lines = text.split("\n"), drawn = new Map(drawings.map(d => [d.line, d]));
  const out: Picture[] = identified(lines).flatMap((c): Picture[] => {
    const source = lines[c.line]!;
    if (c.kind !== "drawing") return [{ id: c.id, kind: c.kind, line: c.line, source, spec: c.spec!, header: c.kind === "line" && c.spec!.layout === "hero" }];
    const d = drawn.get(c.line);
    return d ? [{ id: c.id, kind: "drawing", line: c.line, source, spec: drawingSpec(source, "svg picture", d.alt), header: false, svg: d.svg }] : [];
  });
  if (!out.some(p => p.header)) { const first = out.find(p => p.kind === "drawing" && p.spec.layout === "hero"); if (first) first.header = true; }
  return out;
}

/**
 * Where picture `id` is in `text` now, whatever went in above it or was resized since: the same one of those alike.
 * `null` when no such picture is left, or when how many are alike changed, so which one it was can't be told.
 */
export function locatePicture(text: string, id: string): { kind: PictureKind; line: number; source: string } | null {
  const lines = text.split("\n"), hit = identified(lines).find(c => c.id === id);
  return hit ? { kind: hit.kind, line: hit.line, source: lines[hit.line]! } : null;
}

/** A picture's line with its layout changed, whichever kind it is; null when the line isn't that any more. */
export function rewritePicture(kind: PictureKind, source: string, set: Partial<Record<MediaAttr, string | null>>): string | null {
  if (kind !== "drawing") return rewriteImageLine(source, set);
  let line = source;
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) continue;
    const token = new RegExp(`\\s*\\[${key}::[^\\]]*\\]`, "i");
    line = value === null ? line.replace(token, "") : token.test(line) ? line.replace(token, m => `${/^\s*/.exec(m)![0]}[${key}::${value}]`) : `${line.trimEnd()} [${key}::${value}]`;
  }
  return line;
}

// ── how big it draws ──────────────────────────────────────────────────────────

/** A picture drawn from text (a fence, a script's) is made at twice its size, to draw sharp. */
export const PICTURE_SCALE = 2;
export interface Pixels { width: number; height: number }
export interface Cells { cellW: number; cellH: number; maxImageRows: number }

const rowsFor = (m: Pixels, cols: number, c: Pick<Cells, "cellW" | "cellH">) => Math.max(1, Math.round((cols * c.cellW * m.height) / m.width / c.cellH));
const colsFor = (m: Pixels, rows: number, c: Pick<Cells, "cellW" | "cellH">) => Math.max(1, Math.round((rows * c.cellH * m.width) / m.height / c.cellW));

/**
 * Its width with no words on it: its own, about half its file's pixels. A drawing (a fence's, a script's) is exactly its
 * own width, the file having been made at PICTURE_SCALE; a file is never below 24 cells, so a small one reads.
 */
function ownCols(m: Pixels, spec: MediaSpec, W: number, c: Pick<Cells, "cellW">): number {
  return spec.fence || spec.drawn ? Math.max(1, Math.ceil(m.width / PICTURE_SCALE / c.cellW)) : Math.max(Math.min(W, 24), Math.round((m.width / c.cellW) * 0.5));
}

/** A picture nobody sized: no `[size::…]` and no `[height::…]` written. The reader's cap is for these only (PIE-1630). */
export const unsized = (spec: MediaSpec) => spec.size === undefined && spec.height === undefined;

/**
 * Where a picture goes in a body `W` wide: its width from `[size::…]` (cells, a share of the body, or all of it) or from
 * `[height::…]`, else its own; its aspect kept, inside both when both are written; then placed by `[align::…]`. Unsized,
 * it's at most `maxImageRows` tall (the reader's share of its rows). Sized, only its own words hold it (PIE-1630): it goes
 * as wide as they ask, up to the body's width, and a tall one scrolls as any tall block does, at most MAX_CONTENT_HEIGHT.
 */
export function imageBox(m: Pixels, spec: MediaSpec, W: number, c: Cells): { col: number; cols: number; rows: number } {
  const s = spec.size;
  let cols = s === "full" ? W : s && "percent" in s ? Math.round((W * s.percent) / 100) : s ? s.cells : spec.height ? colsFor(m, spec.height, c) : ownCols(m, spec, W, c);
  cols = Math.max(1, Math.min(W, cols));
  let rows = rowsFor(m, cols, c);
  const most = unsized(spec) ? c.maxImageRows : Math.min(spec.height ?? MAX_CONTENT_HEIGHT, MAX_CONTENT_HEIGHT);
  if (rows > most) { rows = Math.max(1, most); cols = Math.max(1, Math.min(W, colsFor(m, rows, c))); }
  const col = spec.align === "center" ? Math.floor((W - cols) / 2) : spec.align === "right" ? W - cols : 0;
  return { col, cols, rows };
}

/**
 * What a caption says of a picture's size: the rows `box` drew (never the words', which the width may not hold), and its
 * width when it's the body's or a share written; "(N asked)" when `[height::N]` asked for more rows than were drawn.
 */
export function drawnSizeText(box: { cols: number; rows: number }, spec: MediaSpec, W: number): string {
  const width = box.cols >= W && !unsized(spec) ? "full width" : spec.size && spec.size !== "full" && "percent" in spec.size ? `${spec.size.percent}%` : "";
  const asked = spec.height !== undefined && spec.height > box.rows ? ` (${spec.height} asked)` : "";
  return [`${box.rows} rows`, width].filter(Boolean).join(" · ") + asked;
}

/**
 * The part of `m` (as fractions of it) that fills a box `pxW` × `pxH` pixels with its aspect kept, around `focus`
 * (`[hero-focus::x,y]`; its middle when there's none), kept inside the image.
 */
export function coverCrop(m: Pixels, pxW: number, pxH: number, focus: Focus = { x: 0.5, y: 0.5 }): { x: number; y: number; w: number; h: number } | undefined {
  const box = pxW / pxH, own = m.width / m.height;
  const at = (f: number, span: number) => Math.max(0, Math.min(1 - span, f - span / 2));
  if (Math.abs(box - own) / own < 0.01) return undefined;
  if (own > box) { const w = box / own; return { x: at(focus.x, w), y: 0, w, h: 1 }; }
  const h = own / box;
  return { x: 0, y: at(focus.y, h), w: 1, h };
}

/**
 * Where a header image goes in a width of `W` cells, at most `cap` rows tall: the full width, the whole image, when it
 * fits under the cap; taller, cropped to fill the cap around its middle (`[fit::cover]`, the default), or shown whole
 * in the middle of the cap's rows (`[fit::contain]`).
 */
export function heroBox(m: Pixels, spec: MediaSpec, W: number, cap: number, cellW: number, cellH: number): { col: number; cols: number; rows: number; crop?: { x: number; y: number; w: number; h: number } } {
  const own = Math.max(1, Math.round((W * cellW * m.height) / m.width / cellH)), most = Math.max(1, cap);
  // A height its line sets (PIE-1361: the header's edge dragged down) is the height, cropped to fill; else at most its own.
  const asked = spec.fit !== "contain" && (spec.height !== undefined || spec.heightShare !== undefined);
  if (own <= most && !(asked && own < most)) return { col: 0, cols: W, rows: own };
  if (spec.fit === "contain") {
    const cols = Math.max(1, Math.min(W, Math.round((most * cellH * m.width) / m.height / cellW)));
    return { col: Math.floor((W - cols) / 2), cols, rows: most };
  }
  const crop = coverCrop(m, W * cellW, most * cellH, spec.focus);
  return { col: 0, cols: W, rows: most, ...(crop ? { crop } : {}) };
}

/**
 * A header laid out by heroBox, drawn `extra` rows taller (PIE-1631: a desk tile's padding above the body, which the
 * header bleeds up into): laid out again for those rows, never the same crop stretched to fill them (a disc an oval).
 * `[fit::contain]`: the whole picture, inside both the width `W` and the taller rows, in the middle of that band
 * (`line`: the rows down from its top), as the published page's object-fit:contain shows it. Else the full width,
 * cropped to fill around its focus.
 */
export function heroBoxGrown(m: Pixels, spec: MediaSpec, box: { col: number; cols: number; rows: number }, extra: number, W: number, cellW: number, cellH: number): { col: number; cols: number; rows: number; line?: number; crop?: { x: number; y: number; w: number; h: number } } {
  if (extra <= 0) return box;
  const band = box.rows + extra;
  if (spec.fit === "contain") {
    const wide = (W * cellW) / (band * cellH) > m.width / m.height;
    const cols = wide ? Math.max(1, Math.min(W, Math.round((band * cellH * m.width) / m.height / cellW))) : W;
    const rows = wide ? band : Math.max(1, Math.min(band, Math.round((W * cellW * m.height) / m.width / cellH)));
    return { col: Math.floor((W - cols) / 2), cols, rows, line: Math.floor((band - rows) / 2) };
  }
  const crop = coverCrop(m, W * cellW, band * cellH, spec.focus);
  return { col: 0, cols: W, rows: band, ...(crop ? { crop } : {}) };
}

/** An SVG's own size: its root's `width` and `height`, else its viewBox's. Null when it names neither. */
export function svgOwnSize(svg: string): Pixels | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const attr = (name: string) => { const v = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, "i").exec(root)?.[1]; return v ? +v : undefined; };
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(root);
  const width = attr("width") ?? (box ? +box[1]! : undefined), height = attr("height") ?? (box ? +box[2]! : undefined);
  return width && height ? { width, height } : null;
}

/** A row of the door on a page: a line of its text. */
export const ROW_REM = 1.25;

/**
 * Its width as a page's CSS, for the same words the door reads. With none: a drawing's own width (`spec.own`, as the
 * door's ownCols), capped at the page; a file has no own width here, the publisher not reading its pixels.
 */
export function pictureWidthCss(spec: MediaSpec): string | undefined {
  if (spec.layout === "hero" || spec.size === "full") return "100%";
  if (spec.size) return "percent" in spec.size ? `${spec.size.percent}%` : `min(100%,${spec.size.cells}ch)`;
  if (!spec.own) return undefined;
  // Written in rows, as wide as those rows make it (the door's colsFor), a row a line of the page's text.
  return spec.height ? `min(100%,${(spec.height * ROW_REM * spec.own.width / spec.own.height).toFixed(2)}rem)` : `min(100%,${spec.own.width}px)`;
}

// ── one step ──────────────────────────────────────────────────────────────────

/** The widths a step goes through, as shares of the body (100 is `full`). */
const SIZE_STEPS = [25, 33, 50, 66, 75, 100];
/** The rows the reader starts a height from when none is drawn or written. */
export const HERO_ROWS = 10;

export interface StepRoom extends Cells {
  /** The body's width in cells. */
  body: number;
  /** Its pixels, when it's been read. */
  px?: Pixels | null;
  /** How it's drawn now, when it is. */
  drawn?: { cols: number; rows: number } | null;
  /** The header's rows as drawn, and the most it can take. */
  header?: { rows: number | null; most: number };
}
export type PictureStep = { set: { size?: string; height?: string | null } } | { stop: string };

const BIGGEST = "it's as big as it gets here", SMALLEST = "it's at its smallest", FULL = "it's the full width already";

/**
 * One step bigger or smaller, for every kind: the header and a drawing by rows, a media line by shares of the body. A
 * step that wouldn't change what's drawn stops there, says so, and leaves the source alone.
 */
export function pictureStep(p: Pick<Picture, "kind" | "spec" | "header">, by: number, room: StepRoom): PictureStep {
  const { spec } = p;
  if (p.header) {
    const rows = room.header?.rows ?? null;
    if (by > 0 && room.header && rows !== null && rows >= room.header.most) return { stop: BIGGEST };
    const now = heroPropText(spec, "height") ?? String(rows ?? HERO_ROWS);
    const next = heroPropStep("height", now, by);
    return next === now ? { stop: by > 0 ? BIGGEST : SMALLEST } : { set: { height: next } };
  }
  const box = (s: MediaSpec) => (room.px ? imageBox(room.px, s, room.body, room) : null);
  if (p.kind === "line") {
    const was = room.drawn ?? box(spec), shown = was ? (was.cols / Math.max(1, room.body)) * 100 : null;
    const size = spec.size;
    let at = size === "full" ? 100 : size && "percent" in size ? size.percent : size ? (size.cells / Math.max(1, room.body)) * 100 : shown ?? 50;
    for (;;) {
      const step = by > 0 ? SIZE_STEPS.find(x => x > at + 1) : [...SIZE_STEPS].reverse().find(x => x < at - 1);
      if (step === undefined) return { stop: by > 0 ? (size === "full" || (was && was.cols >= room.body) ? FULL : BIGGEST) : "it's at the smallest step (25%) already: image.size to= any width" };
      const word = step === 100 ? "full" : `${step}%`;
      const after = box({ ...spec, size: step === 100 ? "full" : { percent: step } });
      if (!was || !after || after.cols !== was.cols || after.rows !== was.rows) return { set: { size: word } };
      if (by > 0) return { stop: BIGGEST };
      at = step;
    }
  }
  // A fence and a drawing by rows, up to the full width: past the last row step, or where the next would reach the
  // width, the step is `size=full` (its height word taken out), and at the full width [+] stops there (PIE-1630).
  const now = room.drawn ?? box(spec), at = now?.rows ?? spec.height ?? HERO_ROWS;
  if (by > 0 && now && now.cols >= room.body) return { stop: FULL };
  const next = heroPropStep("height", String(at), by);
  if (by < 0) return next === String(at) ? { stop: SMALLEST } : { set: { height: next } };
  const after = next === String(at) ? null : box({ ...spec, height: +next });
  if (!room.px && !now) return next === String(at) ? { stop: BIGGEST } : { set: { height: next } };
  if (after && after.cols < room.body && after.rows > at) return { set: { height: next } };
  const full = box({ ...spec, size: "full", height: undefined });
  if (now && full && full.cols <= now.cols && full.rows <= now.rows) return { stop: BIGGEST };
  // A fence's height word goes; a drawing's line writes the full width's rows instead, since without a height of its own
  // the script's (its image primitive's `height`) would hold it again, smaller.
  return { set: { size: "full", height: p.kind === "drawing" && full ? String(full.rows) : null } };
}
