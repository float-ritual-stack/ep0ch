// Images and video referenced from notes (`img:: path`, `[img::path]`, `[video::path]`), with their layout written as
// properties beside them on the same line (PIE-532: `[size::40%]`, `[height::8]`, `[align::center]`,
// `[layout::hero]`, `[fit::contain]`, `[dim::0.3]`, `[alt::…]`), turned into PNGs the terminal can place. Decoding and
// scaling are sharp's (prebuilt libvips for linux and macOS, no system tool); a video's poster frame is ffmpeg's
// (qlmanage on a Mac without it). Kitty scales a placement into its cell box by itself, so an image is only ever
// scaled down, to about the box it's drawn in (for bandwidth and memory), never up.
//
// Dark first: a bright image is dimmed in the same step, so it's cached dimmed and no frame ever shows it bright. By
// default its brightness is scaled so the mean luminance of the part drawn (a header's crop), as it shows on the
// door's dark ground (a transparent pixel is the ground), is at most MAX_MEAN; art that's dark already is untouched.
// `[dim::N]` on its line says how much instead (0 none, 0.6 to 40%). An image's size is read from its header at once
// (image-size), so its rows are known before it's decoded and the note never moves when it arrives. Work happens off
// the render path; a redraw follows when it settles.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { imageSize } from "image-size";
import { cacheDir } from "./state";
import type { Rgb } from "./theme";

export interface PngRef { png: Buffer; width: number; height: number; key: string }
type Kind = "img" | "video";
/**
 * A media file as the door holds it, `key` naming its content (path, mtime, size). Loading: its size when its header
 * says it. Ready: its size (upright) and the mean luminance of all of it as drawn (0–1, the caption's "dimmed").
 */
export type Media =
  | { state: "loading"; path: string; kind: Kind; width?: number; height?: number }
  | { state: "ready"; path: string; kind: Kind; key: string; width: number; height: number; mean: number }
  | { state: "error"; path: string; kind: Kind; reason: string };
export type ReadyMedia = Extract<Media, { state: "ready" }>;
/** The part of an image drawn, as fractions of it (a header's cover crop). */
export type Crop = { x: number; y: number; w: number; h: number };
/**
 * How an image is drawn: dimmed by `[dim::…]` (else held to `mean`, MAX_MEAN unless said, and to `peak` for its
 * brightest part), over the part `crop` shows; `mute`d (desaturated and softened) and only `alpha` opaque (the ground
 * showing through the rest) as a header's backdrop (PIE-598).
 */
export interface Look { dim?: number; crop?: Crop; mean?: number; peak?: number; mute?: boolean; alpha?: number }

/** The longest edge, in pixels, an image is kept at. */
const MAX_PX = 1600;
/** The longest edges an image is scaled to: a box is drawn from the next one up (so a resize rarely scales again). */
const STEPS = [320, 640, 960, 1280, MAX_PX];
/** The step made with the first look, before the box it's drawn in is known. */
const FIRST = 640;
/** The mean luminance (0–1) an image is dimmed to at most, unless its line says otherwise. */
export const MAX_MEAN = 0.3;
/** How many bytes of scaled PNGs are kept in memory; the least recently drawn go first (the disk cache keeps them). */
const KEEP_BYTES = 96 * 1024 * 1024;
/** How often a file is looked at again for a change on disk, in ms. */
const RECHECK_MS = 2000;

/** Where converted images are kept: media/ in the door's cache (under EP0CH_STATE when it is set). */
export const mediaCache = () => join(cacheDir(), "media");
const CHECKOUT = resolve(import.meta.dir, "../../..");
const installAll = () => existsSync(join(CHECKOUT, "package.json")) ? `(cd ${CHECKOUT} && bun install --frozen-lockfile)` : "bun install --frozen-lockfile, in the ep0ch checkout (ep0ch doctor names it)";

interface Entry { media: Media; key: string; checked: number }
const store = new Map<string, Entry>();
/**
 * Scaled PNGs in memory by job (`content key\0edge\0look`), least recently drawn first, held to `budget` bytes. Every
 * draw (`use`) moves a job to the end; what was drawn in this frame or the last is on screen and never evicted, so it
 * is passed over and the ones behind it go instead.
 */
export class ScaledCache {
  private refs = new Map<string, PngRef>();
  /** The last frame each job was drawn in. */
  private drawn = new Map<string, number>();
  bytes = 0;
  constructor(private budget: number) {}
  get(job: string): PngRef | undefined { return this.refs.get(job); }
  entries() { return this.refs.entries(); }
  /** `job` drawn in `frame`: the most recently drawn now. */
  use(job: string, frame: number) {
    const ref = this.refs.get(job);
    if (!ref) return;
    this.refs.delete(job); this.refs.set(job, ref); this.drawn.set(job, frame);
  }
  /** Keeps `ref` as `job`, then evicts the least recently drawn (never one on screen in `frame`) down to the budget. */
  put(job: string, ref: PngRef, frame: number) {
    this.drop(job);
    this.refs.set(job, ref);
    // Made to be drawn next (a redraw follows): on screen until two frames pass without it.
    this.drawn.set(job, frame);
    this.bytes += ref.png.length;
    for (const k of this.refs.keys()) {
      if (this.bytes <= this.budget) break;
      if (k !== job && (this.drawn.get(k) ?? -9) < frame - 1) this.drop(k);
    }
  }
  /** Drops every step held for content `key`. */
  forget(key: string) { for (const k of this.refs.keys()) if (k.startsWith(`${key}\0`)) this.drop(k); }
  private drop(job: string) {
    const was = this.refs.get(job);
    if (!was) return;
    this.refs.delete(job); this.drawn.delete(job); this.bytes -= was.png.length;
  }
}
const scaled = new ScaledCache(KEEP_BYTES);
/** The frame being drawn (counted by `sized` callers through `nextFrame`). */
let frame = 0;
const making = new Set<string>();
let onChange: () => void = () => {};
export function onMediaChange(fn: () => void) { onChange = fn; }
/** A new frame is being drawn: what the last one drew stays in memory (never evicted while it's on screen). */
export function nextFrame() { frame++; }

/** `~`, backslash-escaped spaces, and macOS screenshot names (a narrow no-break space before AM/PM). */
export function resolveMediaPath(raw: string): { path: string; exists: boolean } {
  const p = raw.trim().replace(/^["']|["']$/g, "").replace(/\\ /g, " ").replace(/^~(?=\/)/, homedir());
  const candidates = [p, p.replace(/ (AM|PM)(?=\.\w+$)/, " $1")];
  for (const c of candidates) { try { statSync(c); return { path: c, exists: true }; } catch { /* next */ } }
  return { path: p, exists: false };
}

type Sharp = typeof import("sharp").default;
let sharpLib: Promise<Sharp> | null = null;
/** sharp, loaded on the first image: a checkout whose packages aren't installed says how to install them. */
function lib(): Promise<Sharp> {
  return (sharpLib ??= import("sharp").then(m => m.default, () => {
    sharpLib = null;
    throw new Error(`the image library (sharp) isn't installed: ${installAll()}`);
  }));
}

const isMac = process.platform === "darwin";
const install = (tool: string) => isMac ? `brew install ${tool}` : `sudo apt install ${tool}`;

async function run(cmd: string[]): Promise<void> {
  let p: ReturnType<typeof Bun.spawn>;
  try { p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" }); }
  catch { throw Object.assign(new Error(`no ${cmd[0]}`), { missing: true }); }
  const err = await new Response(p.stderr as ReadableStream).text();
  if ((await p.exited) !== 0) throw new Error(err.trim().split("\n").pop() || `${cmd[0]} failed`);
}

/** A file in the cache, written whole or not at all: made at a name of this process's own, then renamed into place. */
async function cached(out: string, make: (tmp: string) => Promise<void>): Promise<string> {
  if (existsSync(out)) return out;
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp.png`;
  try { await make(tmp); renameSync(tmp, out); }
  finally { rmSync(tmp, { force: true }); }
  return out;
}

/** A video's poster frame (a second in), as a PNG in the cache: ffmpeg, else qlmanage on a Mac. */
function posterFrame(path: string, key: string): Promise<string> {
  const CACHE = mediaCache();
  return cached(join(CACHE, `${key}-frame.png`), async tmp => {
    try { await run(["ffmpeg", "-v", "error", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", `scale='min(${MAX_PX},iw)':-2`, "-y", tmp]); }
    catch (e) {
      if (!isMac) throw (e as { missing?: boolean }).missing ? new Error(`no ffmpeg to take the video's poster frame: ${install("ffmpeg")}`) : e;
      try { await run(["qlmanage", "-t", "-s", String(MAX_PX), "-o", CACHE, path]); }
      catch { throw new Error(`no ffmpeg to take the video's poster frame (and Quick Look made none): ${install("ffmpeg")}`); }
      renameSync(join(CACHE, `${basename(path)}.png`), tmp);
    }
  });
}

/** The content key of the file at `path` as it is now: its path, when it changed and its size. */
function contentKey(path: string): string | null {
  try { const st = statSync(path); return createHash("sha1").update(`${path}\0${st.mtimeMs}\0${st.size}`).digest("hex").slice(0, 16); }
  catch { return null; }
}

/** The upright size an image's header says, read at once (no decoding); null when it can't be read that way. */
function headerSize(path: string): { width: number; height: number } | null {
  try {
    const d = imageSize(readFileSync(path));
    if (!d.width || !d.height) return null;
    return (d.orientation ?? 1) >= 5 ? { width: d.height, height: d.width } : { width: d.width, height: d.height };
  } catch { return null; }
}

interface Source { src: string; key: string; width: number; height: number; png: boolean }

/** What to scale from, by content key: the file (or a video's frame), its upright size, and whether it's a PNG. */
const sources = new Map<string, Promise<Source>>();
function sourceOf(path: string, key: string, kind: Kind): Promise<Source> {
  let s = sources.get(key);
  if (!s) {
    s = (async () => {
      const src = kind === "video" ? await posterFrame(path, key) : path;
      const meta = await (await lib())(src, { pages: 1 }).metadata();
      if (!meta.width || !meta.height) throw new Error(`not an image the door can read (${meta.format ?? "unknown format"})`);
      // An EXIF quarter turn swaps its sides (rotate() turns it upright when it's scaled).
      const turned = (meta.orientation ?? 1) >= 5;
      return { src, key, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height, png: meta.format === "png" && !turned };
    })();
    sources.set(key, s);
    s.catch(() => sources.delete(key));
  }
  return s;
}

/**
 * The mean luminance (0–1) of the part `crop` of `s` shows (all of it without one), as it shows on the door's dark
 * ground: a pixel counts as much as it's opaque, a transparent one as the ground. `peak`: how bright its brightest
 * part is (at the size it's measured at, a 96-pixel thumbnail: a highlight is averaged with what's around it, never left out).
 */
async function lightOf(s: Source, crop?: Crop): Promise<{ mean: number; peak: number }> {
  const { data, info } = await (await cropped(s, crop)).resize({ width: 96, height: 96, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum: number[] = [];
  for (let i = 0; i < data.length; i += info.channels) lum.push(((0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255) * (data[i + 3]! / 255));
  return { mean: lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length), peak: Math.max(0, ...lum) };
}
/** `s` upright, cut to the part `crop` shows (all of it without one). */
async function cropped(s: Source, crop?: Crop) {
  const sharp = await lib();
  const p = sharp(s.src, { pages: 1 }).rotate();
  if (!crop) return p;
  const left = Math.max(0, Math.floor(crop.x * s.width)), top = Math.max(0, Math.floor(crop.y * s.height));
  return sharp(await p.toBuffer()).extract({ left, top, width: Math.max(1, Math.min(s.width - left, Math.round(crop.w * s.width))), height: Math.max(1, Math.min(s.height - top, Math.round(crop.h * s.height))) });
}
const meanOf = async (s: Source, crop?: Crop) => (await lightOf(s, crop)).mean;


/**
 * How bright an image is drawn, as a multiplier (1 as it is): `dim` from its line (0 none … 1 black), else enough to
 * bring `mean` (of the part drawn) down to `most` (MAX_MEAN), and its brightest part (`light.peak`) to `light.most`
 * when one is given. Rounded, so it names a cache file.
 */
export function brightness(mean: number, dim?: number, most = MAX_MEAN, light?: { peak: number; most: number }): number {
  const f = dim !== undefined ? 1 - Math.max(0, Math.min(1, dim))
    : Math.min(1, most / Math.max(1e-3, mean), light ? light.most / Math.max(1e-3, light.peak) : 1);
  return Math.round(f * 100) / 100;
}
/**
 * How bright `look` draws an image whose part drawn is `light`: its `[dim::…]`, else held to its limits; a look with
 * limits of its own (a header's backdrop) keeps them under a dim too, whichever is darker.
 */
function brightnessOf(light: { mean: number; peak: number }, look: Look): number {
  const held = brightness(light.mean, undefined, look.mean, look.peak !== undefined ? { peak: light.peak, most: look.peak } : undefined);
  if (look.dim === undefined) return held;
  return limited(look) ? Math.min(brightness(0, look.dim), held) : brightness(0, look.dim);
}
/** A look with limits of its own (a header's backdrop): its brightness depends on the image even under a dim. */
const limited = (look: Look) => look.mean !== undefined || look.peak !== undefined;

/** How much a muted image (a header's backdrop) keeps of its colour. */
const MUTE_SATURATION = 0.12;

/** What a look names in a cache file: its dim (or auto, and its limits), its crop, rounded, and whether it's muted. */
const lookKey = (look: Look) => `${look.dim === undefined ? "a" : Math.round(look.dim * 100)}${look.crop ? `c${[look.crop.x, look.crop.y, look.crop.w, look.crop.h].map(v => Math.round(v * 1000)).join("_")}` : ""}${look.mean !== undefined ? `m${Math.round(look.mean * 1000)}` : ""}${look.peak !== undefined ? `p${Math.round(look.peak * 1000)}` : ""}${look.mute ? "u" : ""}${look.alpha !== undefined && look.alpha < 1 ? `o${Math.round(look.alpha * 100)}` : ""}`;

/**
 * The PNG of `s` with its longest edge at most `edge`, drawn as `look` says: its brightness worked out from the part
 * drawn, dimmed in the same step as it's scaled (the first frame of an animation, turned upright). From the cache
 * (its name has the content, the step and the look in it), or the file itself when it's a PNG that small already and
 * isn't dimmed.
 */
async function scale(s: Source, edge: number, look: Look): Promise<PngRef> {
  const f = look.dim !== undefined && !limited(look) ? brightness(0, look.dim) : brightnessOf(await lightOf(s, look.crop), look);
  const ref = `${s.key}-${edge}-${lookKey(look)}`;
  const alpha = look.alpha !== undefined && look.alpha < 1 ? Math.max(0, look.alpha) : 1;
  if (s.png && f === 1 && !look.mute && alpha === 1 && Math.max(s.width, s.height) <= edge) return { png: readFileSync(s.src), width: s.width, height: s.height, key: `${ref}-${Math.round(f * 100)}` };
  const out = await cached(join(mediaCache(), `${ref}.png`), async tmp => {
    const sharp = await lib();
    let p = sharp(s.src, { pages: 1 }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
    // A header's backdrop: most of its colour gone and its detail softened, so the header's text reads over it.
    if (look.mute) p = p.modulate({ brightness: f, saturation: MUTE_SATURATION }).blur(Math.max(1, edge / 160));
    else if (f < 1) p = p.modulate({ brightness: f });
    if (alpha < 1) {
      // Partly opaque: the terminal draws the ground through it (a backdrop coming in by steps).
      const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i]! * alpha);
      p = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
    }
    await p.png().toFile(tmp);
  });
  const b = readFileSync(out);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG after conversion");
  return { png: b, width: b.readUInt32BE(16), height: b.readUInt32BE(20), key: ref };
}

/** The step that covers `edge` pixels on the longest side, never past the image's own. */
const stepFor = (edge: number, own: number) => Math.min(STEPS.find(s => s >= edge) ?? MAX_PX, STEPS.find(s => s >= own) ?? MAX_PX);
const jobOf = (key: string, edge: number, look: Look) => `${key}\0${edge}\0${lookKey(look)}`;

/** Forget what's held for content `key` (its file changed on disk). */
function forget(path: string, key: string) {
  store.delete(path); sources.delete(key);
  scaled.forget(key);
}

/** The entry for `path`, read again when its file changed on disk (looked at every RECHECK_MS at most). */
function current(path: string): Entry | undefined {
  const hit = store.get(path), now = Date.now();
  if (hit && now - hit.checked >= RECHECK_MS) {
    hit.checked = now;
    const key = contentKey(path);
    if (key !== hit.key) { forget(path, hit.key); return undefined; }
  }
  return store.get(path);
}

export function media(raw: string, kind: Kind): Media {
  const { path, exists } = resolveMediaPath(raw);
  const kept = current(path);
  if (kept) return kept.media;
  const now = Date.now(), key = exists ? contentKey(path) : null;
  if (!key) {
    const m: Media = { state: "error", path, kind, reason: "file not found" };
    store.set(path, { media: m, key: "", checked: now }); return m;
  }
  const size = kind === "img" ? headerSize(path) : null;
  const entry: Entry = { media: { state: "loading", path, kind, ...(size ?? {}) }, key, checked: now };
  store.set(path, entry);
  (async () => {
    const s = await sourceOf(path, key, kind);
    // The first look (all of it), already dimmed as it will be drawn, so the first frame of it is never bright.
    const edge = stepFor(FIRST, Math.max(s.width, s.height));
    const [first, mean] = await Promise.all([scale(s, edge, {}), meanOf(s)]);
    if (store.get(path) === entry) scaled.put(jobOf(key, edge, {}), first, frame);
    return { s, mean };
  })().then(({ s, mean }) => {
    if (store.get(path) !== entry) return;
    entry.media = { state: "ready", path, kind, key, width: s.width, height: s.height, mean };
    onChange();
  }, e => {
    if (store.get(path) !== entry) return;
    const msg = String((e as Error).message ?? e);
    entry.media = { state: "error", path, kind, reason: /EPERM|not permitted/i.test(msg) ? "macOS blocked the read: give this terminal Files & Folders access" : msg };
    onChange();
  });
  return entry.media;
}

/**
 * The PNG to draw `m` with in a box of `pxW` × `pxH` pixels (covered, as a cropped header is), as `look` says: the
 * scaled one for that box when it's ready; else it's made now (a redraw follows) and the closest one ready with that
 * look is drawn meanwhile, the terminal scaling it; null when none is ready yet (its rows stay dark) or the file has
 * changed since `m` was read. Never bigger than the image. A failure turns `m` into an error its line says.
 */
export function sized(m: ReadyMedia, pxW: number, pxH: number, look: Look = {}): PngRef | null {
  // The file as it is now: one changed on disk is read again (media), and nothing old is drawn meanwhile.
  if (current(m.path)?.media !== m) { media(m.path, m.kind); return null; }
  const fit = Math.max(pxW / m.width, pxH / m.height), own = Math.max(m.width, m.height);
  const edge = stepFor(Math.ceil(fit * own), own), job = jobOf(m.key, edge, look);
  const exact = scaled.get(job);
  if (exact) { scaled.use(job, frame); return exact; }
  if (!making.has(job)) {
    making.add(job);
    sourceOf(m.path, m.key, m.kind).then(s => scale(s, edge, look)).then(ref => {
      making.delete(job);
      if (current(m.path)?.media === m) { scaled.put(job, ref, frame); onChange(); }
    }, e => {
      making.delete(job);
      const entry = store.get(m.path);
      if (entry && entry.media === m) { entry.media = { state: "error", path: m.path, kind: m.kind, reason: String((e as Error).message ?? e) }; onChange(); }
    });
  }
  // The smallest one ready that covers the box, else the biggest one ready, with this look.
  const tail = `\0${lookKey(look)}`;
  const ready = [...scaled.entries()].filter(([k]) => k.startsWith(`${m.key}\0`) && k.endsWith(tail)).map(([k, v]) => [Number(k.split("\0")[1]), k, v] as const).sort((a, b) => a[0] - b[0]);
  const pick = ready.find(([e]) => e >= edge) ?? ready.at(-1);
  if (pick) scaled.use(pick[1], frame);
  return pick?.[2] ?? null;
}

/** One colour per cell: an image drawn in a terminal's cells (a header's backdrop without Kitty graphics, PIE-598). */
export type CellGrid = readonly (readonly Rgb[])[];
/** The grids made, least recently drawn first: small (a header's cells), so a count bounds them. */
const grids = new Map<string, CellGrid>();
const GRIDS_KEPT = 64;

/**
 * `m` drawn in `cols` × `rows` cells as `look` says (its crop, its limits, muted): each cell the mean colour of the
 * part of the image under it, the whole grid then dimmed as the look's PNG would be. Made off the render path (a
 * redraw follows); null until it's ready, so nothing bright is ever drawn first.
 */
export function cellColours(m: ReadyMedia, cols: number, rows: number, look: Look = {}): CellGrid | null {
  if (current(m.path)?.media !== m) { media(m.path, m.kind); return null; }
  const job = `${m.key}\0${cols}x${rows}\0${lookKey(look)}`, hit = grids.get(job);
  if (hit) { grids.delete(job); grids.set(job, hit); return hit; }
  if (!making.has(job)) {
    making.add(job);
    sourceOf(m.path, m.key, m.kind).then(s => gridOf(s, cols, rows, look)).then(g => {
      making.delete(job);
      if (current(m.path)?.media !== m) return;
      grids.set(job, g);
      for (const k of grids.keys()) { if (grids.size <= GRIDS_KEPT) break; grids.delete(k); }
      onChange();
    }, () => { making.delete(job); });
  }
  return null;
}

async function gridOf(s: Source, cols: number, rows: number, look: Look): Promise<CellGrid> {
  const { data } = await (await cropped(s, look.crop)).resize({ width: cols, height: rows, fit: "fill" }).flatten({ background: "#000" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px: [number, number, number][] = [];
  for (let i = 0; i + 2 < data.length; i += 3) {
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!], y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    px.push(look.mute ? [y + (r - y) * MUTE_SATURATION, y + (g - y) * MUTE_SATURATION, y + (b - y) * MUTE_SATURATION] : [r, g, b]);
  }
  const lum = px.map(([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  const f = brightnessOf({ mean: lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length), peak: Math.max(0, ...lum) }, look);
  const out: Rgb[][] = [];
  for (let r = 0; r < rows; r++) out.push(px.slice(r * cols, (r + 1) * cols).map(c => c.map(v => Math.max(0, Math.min(255, Math.round(v * f)))) as unknown as Rgb));
  return out;
}

// ── the media line ────────────────────────────────────────────────────────────

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
  kind: Kind; path: string;
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
