// Images and video referenced from notes (`img:: path`, `[img::path]`, `[video::path]`), with their layout written as
// properties beside them on the same line (PIE-532: `[size::40%]`, `[height::8]`, `[align::center]`,
// `[layout::hero]`, `[alt::…]`), turned into PNGs the terminal can place. Decoding and scaling are sharp's
// (prebuilt libvips for linux and macOS, no system tool); a video's poster frame is ffmpeg's (qlmanage on a Mac
// without it). Kitty scales a placement into its cell box by itself, so an image is only ever scaled down, to about the
// box it's drawn in (for bandwidth and memory), never up. Work happens off the render path; an entry starts
// "loading" and a redraw follows when it settles.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { cacheDir } from "./state";

export interface PngRef { png: Buffer; width: number; height: number; key: string }
type Kind = "img" | "video";
/**
 * A media file as the door holds it. Ready: its size (`width`, `height`, upright) and `image`, the PNG drawn first
 * (`sized` gives the one a box needs).
 */
export type Media =
  | { state: "loading"; path: string; kind: Kind }
  | { state: "ready"; path: string; kind: Kind; width: number; height: number; image: PngRef }
  | { state: "error"; path: string; kind: Kind; reason: string };
type Ready = Extract<Media, { state: "ready" }>;

/** The longest edge, in pixels, an image is kept at. */
const MAX_PX = 1600;
/** The longest edges an image is scaled to: a box is drawn from the next one up (so a resize rarely scales again). */
const STEPS = [320, 640, 960, 1280, MAX_PX];
/** The step a first look is scaled to, before the box it's drawn in is known. */
const FIRST = 640;

/** Where converted images are kept: media/ in the door's cache (under EP0CH_STATE when it is set). */
export const mediaCache = () => join(cacheDir(), "media");
const ROOT = resolve(import.meta.dir, "../../..");
const store = new Map<string, Media>();
/** Each file's scaled PNGs, by longest edge, and the ones being made. */
const scaled = new Map<string, Map<number, PngRef>>();
const making = new Set<string>();
let onChange: () => void = () => {};
export function onMediaChange(fn: () => void) { onChange = fn; }

/** `~`, backslash-escaped spaces, and macOS screenshot names (a narrow no-break space before AM/PM). */
export function resolveMediaPath(raw: string): { path: string; exists: boolean } {
  const p = raw.trim().replace(/^["']|["']$/g, "").replace(/\\ /g, " ").replace(/^~(?=\/)/, homedir());
  const candidates = [p, p.replace(/ (AM|PM)(?=\.\w+$)/, " $1")];
  for (const c of candidates) { try { statSync(c); return { path: c, exists: true }; } catch { /* next */ } }
  return { path: p, exists: false };
}

function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

type Sharp = typeof import("sharp").default;
let sharpLib: Promise<Sharp> | null = null;
/** sharp, loaded on the first image that needs it: a checkout whose packages aren't installed says how to install them. */
function lib(): Promise<Sharp> {
  return (sharpLib ??= import("sharp").then(m => m.default, () => {
    sharpLib = null;
    throw new Error(`the image library (sharp) isn't installed: (cd ${ROOT} && bun install --frozen-lockfile)`);
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

/** A video's poster frame (a second in), as a PNG in the cache: ffmpeg, else qlmanage on a Mac. */
async function posterFrame(path: string, key: string): Promise<string> {
  const CACHE = mediaCache(), out = join(CACHE, `${key}-frame.png`);
  if (existsSync(out)) return out;
  try { await run(["ffmpeg", "-v", "error", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", `scale='min(${MAX_PX},iw)':-2`, "-y", out]); return out; }
  catch (e) {
    if (!isMac) throw (e as { missing?: boolean }).missing ? new Error(`no ffmpeg to take the video's poster frame: ${install("ffmpeg")}`) : e;
    try { await run(["qlmanage", "-t", "-s", String(MAX_PX), "-o", CACHE, path]); }
    catch { throw new Error(`no ffmpeg to take the video's poster frame (and Quick Look made none): ${install("ffmpeg")}`); }
    await Bun.write(out, Bun.file(join(CACHE, `${basename(path)}.png`)));
    return out;
  }
}

/** The file's identity in the cache: its path, when it changed and its size. */
function keyOf(path: string): string {
  const st = statSync(path);
  return createHash("sha1").update(`${path}\0${st.mtimeMs}\0${st.size}`).digest("hex").slice(0, 16);
}

interface Source { src: string; key: string; width: number; height: number; png: boolean }

/**
 * The PNG of `s` with its longest edge at most `edge`, from the cache (its name has the edge in it), or the file
 * itself when it's a PNG that small already, or scaled now (the first frame of an animation, turned upright).
 */
async function scale(s: Source, edge: number): Promise<PngRef> {
  const ref = `${s.key}-${edge}`;
  if (s.png && Math.max(s.width, s.height) <= edge) return { png: readFileSync(s.src), width: s.width, height: s.height, key: ref };
  const out = join(mediaCache(), `${ref}.png`);
  if (!existsSync(out)) {
    const sharp = await lib();
    await sharp(s.src, { pages: 1 }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).png().toFile(out);
  }
  const b = readFileSync(out), size = pngSize(b);
  if (!size) throw new Error("not a PNG after conversion");
  return { png: b, ...size, key: ref };
}

/** What to scale from: the file (or a video's frame), its upright size, and whether it's a PNG already. */
const sources = new Map<string, Promise<Source>>();
function sourceOf(path: string, kind: Kind): Promise<Source> {
  let s = sources.get(path);
  if (!s) {
    s = (async () => {
      const key = keyOf(path);
      mkdirSync(mediaCache(), { recursive: true });
      const src = kind === "video" ? await posterFrame(path, key) : path;
      const own = pngSize(readFileSync(src).subarray(0, 32));
      if (own) return { src, key, ...own, png: true };
      const meta = await (await lib())(src, { pages: 1 }).metadata();
      if (!meta.width || !meta.height) throw new Error(`not an image the door can read (${meta.format ?? "unknown format"})`);
      // An EXIF quarter turn swaps its sides (rotate() turns it upright when it's scaled).
      const turned = (meta.orientation ?? 1) >= 5;
      return { src, key, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height, png: false };
    })();
    sources.set(path, s);
    s.catch(() => sources.delete(path));
  }
  return s;
}

/** The step that covers `edge` pixels on the longest side, never past the image's own. */
const stepFor = (edge: number, own: number) => Math.min(STEPS.find(s => s >= edge) ?? MAX_PX, STEPS.find(s => s >= own) ?? MAX_PX);

function remember(path: string, edge: number, ref: PngRef) {
  const m = scaled.get(path) ?? new Map<number, PngRef>();
  m.set(edge, ref);
  scaled.set(path, m);
}

export function media(raw: string, kind: Kind): Media {
  const { path, exists } = resolveMediaPath(raw);
  const hit = store.get(path);
  if (hit) return hit;
  if (!exists) {
    const m: Media = { state: "error", path, kind, reason: "file not found" };
    store.set(path, m); return m;
  }
  const m: Media = { state: "loading", path, kind };
  store.set(path, m);
  (async () => {
    const s = await sourceOf(path, kind);
    const edge = stepFor(FIRST, Math.max(s.width, s.height));
    const image = await scale(s, edge);
    remember(path, edge, image);
    return { width: s.width, height: s.height, image };
  })().then(r => { store.set(path, { state: "ready", path, kind, ...r }); onChange(); }, e => {
    const msg = String((e as Error).message ?? e);
    const reason = /EPERM|not permitted/i.test(msg) ? "macOS blocked the read: give this terminal Files & Folders access" : msg;
    store.set(path, { state: "error", path, kind, reason }); onChange();
  });
  return m;
}

/**
 * The PNG to draw `m` with in a box of `pxW` × `pxH` pixels (covered, as a cropped header is): the scaled one for
 * that box when it's ready; else it's made now (a redraw follows) and the closest one ready is drawn meanwhile, the
 * terminal scaling it. Never bigger than the image.
 */
export function sized(m: Ready, pxW: number, pxH: number): PngRef {
  const fit = Math.max(pxW / m.width, pxH / m.height), own = Math.max(m.width, m.height);
  const edge = stepFor(Math.ceil(fit * own), own);
  const have = scaled.get(m.path);
  const exact = have?.get(edge);
  if (exact) return exact;
  const job = `${m.path}\0${edge}`;
  if (!making.has(job)) {
    making.add(job);
    sourceOf(m.path, m.kind).then(s => scale(s, edge)).then(ref => { remember(m.path, edge, ref); making.delete(job); onChange(); }, () => making.delete(job));
  }
  // The smallest one ready that covers the box, else the biggest one ready.
  const ready = [...(have?.entries() ?? [])].sort((a, b) => a[0] - b[0]);
  return (ready.find(([e]) => e >= edge) ?? ready.at(-1))?.[1] ?? m.image;
}

// ── the media line ────────────────────────────────────────────────────────────

export type Align = "left" | "center" | "right";
export const ALIGNS: readonly Align[] = ["left", "center", "right"];
export type MediaSize = { cells: number } | { percent: number } | "full";
/**
 * A note line that is only a media reference and its layout (PIE-532): `img:: path`, or `[img::path]` (`image`,
 * `video`) after an optional list mark, then any of `[size::…]` (its width: cells, `N%` of the reader, or `full`),
 * `[height::N]` (rows), `[align::left|center|right]`, `[layout::hero]` (the note's header image) and `[alt::…]`.
 * `problems`: what's written there that isn't one of those values, said on the image's line.
 */
export interface MediaSpec {
  kind: Kind; path: string;
  size?: MediaSize; height?: number; align?: Align; layout?: "hero"; alt?: string;
  problems: string[];
}
export type MediaAttr = "size" | "height" | "align" | "layout" | "alt";
const MEDIA_KEY = /^(img|image|video)$/i;
const ATTRS = new Set<string>(["size", "height", "align", "layout", "alt"]);
const TOKEN = /^\[([A-Za-z][\w-]*)::\s*([^\]]*?)\s*\]/;
const LEAD = /^\s*(?:[-*]\s+)?/;
/** The line's lead (its indent and list mark) and its `[key::value]` tokens, or null when anything else is on it. */
function tokens(line: string): { lead: string; toks: { key: string; value: string }[] } | null {
  const lead = LEAD.exec(line)![0];
  const toks: { key: string; value: string }[] = [];
  let rest = line.slice(lead.length).trimEnd();
  if (!rest) return null;
  while (rest.length) {
    const t = TOKEN.exec(rest);
    if (!t) return null;
    toks.push({ key: t[1]!, value: t[2]! });
    rest = rest.slice(t[0].length).replace(/^\s+/, "");
  }
  return { lead, toks };
}

export function parseMediaLine(line: string): MediaSpec | null {
  const block = /^\s*(?:[-*]\s+)?(img|image|video)::\s*([^[\s].*?)\s*$/i.exec(line);
  if (block) return { kind: block[1]!.toLowerCase() === "video" ? "video" : "img", path: block[2]!, problems: [] };
  const t = tokens(line);
  if (!t) return null;
  const media = t.toks.filter(x => MEDIA_KEY.test(x.key));
  if (media.length !== 1 || !media[0]!.value || t.toks.some(x => !MEDIA_KEY.test(x.key) && !ATTRS.has(x.key.toLowerCase()))) return null;
  const spec: MediaSpec = { kind: media[0]!.key.toLowerCase() === "video" ? "video" : "img", path: media[0]!.value, problems: [] };
  for (const { key, value } of t.toks) {
    const k = key.toLowerCase(), v = value.trim().toLowerCase();
    if (k === "size") {
      const size = parseSize(v);
      if (size) spec.size = size; else spec.problems.push(`size::${value} isn't a size (cells, N% or full)`);
    } else if (k === "height") {
      if (/^\d{1,3}$/.test(v) && +v > 0) spec.height = +v; else spec.problems.push(`height::${value} isn't a number of rows`);
    } else if (k === "align") {
      if ((ALIGNS as readonly string[]).includes(v)) spec.align = v as Align; else spec.problems.push(`align::${value} isn't left, center or right`);
    } else if (k === "layout") {
      if (v === "hero") spec.layout = "hero"; else spec.problems.push(`layout::${value} isn't a layout (hero)`);
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
export const sizeText = (s: MediaSize | undefined) => s === undefined ? "" : s === "full" ? "full" : "percent" in s ? `${s.percent}%` : `${s.cells}`;

/** Whether `line` is a media line (`parseMediaLine`). */
export const isMediaLine = (line: string) => parseMediaLine(line) !== null;

/**
 * `line` (a media line) with its layout properties changed: each key in `set` written with its value, or taken out
 * when it's null. Tokens already there keep their place; new ones go after the rest. `img:: path` becomes
 * `[img::path]` so the properties can sit beside it. Null when `line` isn't a media line.
 */
export function rewriteMediaLine(line: string, set: Partial<Record<MediaAttr, string | null>>): string | null {
  const spec = parseMediaLine(line);
  if (!spec) return null;
  const t = tokens(line) ?? { lead: LEAD.exec(line)![0], toks: [{ key: /(img|image|video)::/i.exec(line)![1]!, value: spec.path }] };
  const toks = t.toks.map(x => ({ ...x }));
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) continue;
    const i = toks.findIndex(x => x.key.toLowerCase() === k);
    if (v === null) { if (i >= 0) toks.splice(i, 1); }
    else if (i >= 0) toks[i]!.value = v;
    else toks.push({ key: k, value: v });
  }
  return t.lead + toks.map(x => `[${x.key}::${x.value}]`).join(" ");
}
