// Images and video referenced from notes (`img:: path`, `[img::path]`, `[video::path]`), with their layout written as
// properties beside them on the same line (PIE-532: `[size::40%]`, `[height::8]`, `[align::center]`,
// `[layout::hero]`, `[fit::contain]`, `[dim::0.3]`, `[alt::…]`), turned into PNGs the terminal can place. Decoding and
// scaling are sharp's (prebuilt libvips for linux and macOS, no system tool); a video's poster frame is ffmpeg's
// (qlmanage on a Mac without it). Kitty scales a placement into its cell box by itself, so an image is only ever
// scaled down, to about the box it's drawn in (for bandwidth and memory), never up.
//
// Dark first: a bright image is dimmed in the same step, so it's cached dimmed and no frame ever shows it bright. By
// default its brightness is scaled so its mean luminance is at most MAX_MEAN (art that's dark already is untouched);
// `[dim::N]` on its line says how much instead (0 none, 0.6 to 40%). Work happens off the render path; an entry
// starts "loading" and a redraw follows when it settles.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { cacheDir } from "./state";

export interface PngRef { png: Buffer; width: number; height: number; key: string }
type Kind = "img" | "video";
/** A media file as the door holds it. Ready: its size (`width`, `height`, upright) and its mean luminance (0–1). */
export type Media =
  | { state: "loading"; path: string; kind: Kind }
  | { state: "ready"; path: string; kind: Kind; width: number; height: number; mean: number }
  | { state: "error"; path: string; kind: Kind; reason: string };
export type ReadyMedia = Extract<Media, { state: "ready" }>;

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

interface Entry { media: Media; mtime: number; size: number; checked: number }
const store = new Map<string, Entry>();
/** Scaled PNGs in memory, least recently drawn first: `path\0edge\0factor` → PNG. */
const scaled = new Map<string, PngRef>();
let scaledBytes = 0;
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

interface Source { src: string; key: string; width: number; height: number; png: boolean; mean: number }

/** What to scale from: the file (or a video's frame), its upright size and mean luminance, and whether it's a PNG. */
const sources = new Map<string, Promise<Source>>();
function sourceOf(path: string, kind: Kind): Promise<Source> {
  let s = sources.get(path);
  if (!s) {
    s = (async () => {
      const st = statSync(path);
      const key = createHash("sha1").update(`${path}\0${st.mtimeMs}\0${st.size}`).digest("hex").slice(0, 16);
      mkdirSync(mediaCache(), { recursive: true });
      const src = kind === "video" ? await posterFrame(path, key) : path;
      const sharp = await lib();
      const [meta, stats] = await Promise.all([sharp(src, { pages: 1 }).metadata(), sharp(src, { pages: 1 }).stats()]);
      if (!meta.width || !meta.height) throw new Error(`not an image the door can read (${meta.format ?? "unknown format"})`);
      const c = stats.channels, mean = c.length >= 3 ? (0.2126 * c[0]!.mean + 0.7152 * c[1]!.mean + 0.0722 * c[2]!.mean) / 255 : c[0]!.mean / 255;
      // An EXIF quarter turn swaps its sides (rotate() turns it upright when it's scaled).
      const turned = (meta.orientation ?? 1) >= 5;
      return { src, key, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height, png: meta.format === "png" && !turned, mean };
    })();
    sources.set(path, s);
    s.catch(() => sources.delete(path));
  }
  return s;
}

/**
 * How bright `m` is drawn, as a multiplier (1 as it is): `dim` from its line (0 none … 1 black), else enough to bring
 * its mean luminance down to MAX_MEAN. Rounded, so it names a cache file.
 */
export function brightness(m: { mean: number }, dim?: number): number {
  const f = dim !== undefined ? 1 - Math.max(0, Math.min(1, dim)) : Math.min(1, MAX_MEAN / Math.max(1e-3, m.mean));
  return Math.round(f * 100) / 100;
}

/**
 * The PNG of `s` with its longest edge at most `edge`, at brightness `f`: from the cache (its name has both in it),
 * or the file itself when it's a PNG that small already and isn't dimmed, or made now (the first frame of an
 * animation, turned upright, dimmed in the same step).
 */
async function scale(s: Source, edge: number, f: number): Promise<PngRef> {
  const ref = `${s.key}-${edge}-${Math.round(f * 100)}`;
  if (s.png && f === 1 && Math.max(s.width, s.height) <= edge) return { png: readFileSync(s.src), width: s.width, height: s.height, key: ref };
  const out = await cached(join(mediaCache(), `${ref}.png`), async tmp => {
    const sharp = await lib();
    let p = sharp(s.src, { pages: 1 }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
    if (f < 1) p = p.modulate({ brightness: f });
    await p.png().toFile(tmp);
  });
  const b = readFileSync(out), size = pngSize(b);
  if (!size) throw new Error("not a PNG after conversion");
  return { png: b, ...size, key: ref };
}

/** The step that covers `edge` pixels on the longest side, never past the image's own. */
const stepFor = (edge: number, own: number) => Math.min(STEPS.find(s => s >= edge) ?? MAX_PX, STEPS.find(s => s >= own) ?? MAX_PX);
const jobOf = (path: string, edge: number, f: number) => `${path}\0${edge}\0${f}`;

function remember(job: string, ref: PngRef) {
  const was = scaled.get(job);
  if (was) { scaledBytes -= was.png.length; scaled.delete(job); }
  scaled.set(job, ref);
  scaledBytes += ref.png.length;
  for (const [k, v] of scaled) { if (scaledBytes <= KEEP_BYTES || k === job) break; scaled.delete(k); scaledBytes -= v.png.length; }
}

/** Forget everything held for `path` (its file changed on disk). */
function forget(path: string) {
  store.delete(path); sources.delete(path);
  for (const [k, v] of scaled) if (k.startsWith(`${path}\0`)) { scaled.delete(k); scaledBytes -= v.png.length; }
}

export function media(raw: string, kind: Kind): Media {
  const { path, exists } = resolveMediaPath(raw);
  const hit = store.get(path), now = Date.now();
  // A file changed on disk (or gone, or back) is read again; looked at every RECHECK_MS at most.
  if (hit && now - hit.checked >= RECHECK_MS) {
    hit.checked = now;
    let st: { mtimeMs: number; size: number } | null = null;
    try { st = statSync(path); } catch { /* gone */ }
    if (st ? st.mtimeMs !== hit.mtime || st.size !== hit.size : hit.media.state !== "error") forget(path);
  }
  const kept = store.get(path);
  if (kept) return kept.media;
  if (!exists) {
    const m: Media = { state: "error", path, kind, reason: "file not found" };
    store.set(path, { media: m, mtime: -1, size: -1, checked: now }); return m;
  }
  const st = statSync(path);
  const entry: Entry = { media: { state: "loading", path, kind }, mtime: st.mtimeMs, size: st.size, checked: now };
  store.set(path, entry);
  (async () => {
    const s = await sourceOf(path, kind);
    // The first look, already dimmed as it will be drawn, so the first frame of it is never bright.
    const edge = stepFor(FIRST, Math.max(s.width, s.height)), f = brightness(s);
    remember(jobOf(path, edge, f), await scale(s, edge, f));
    return s;
  })().then(s => {
    if (store.get(path) !== entry) return;
    entry.media = { state: "ready", path, kind, width: s.width, height: s.height, mean: s.mean };
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
 * The PNG to draw `m` with in a box of `pxW` × `pxH` pixels (covered, as a cropped header is) at brightness `f`
 * (`brightness`): the scaled one for that box when it's ready; else it's made now (a redraw follows) and the closest
 * one ready at that brightness is drawn meanwhile, the terminal scaling it; null when none is ready yet (its rows stay
 * dark). Never bigger than the image. A failure turns `m` into an error its line says.
 */
export function sized(m: ReadyMedia, pxW: number, pxH: number, f: number): PngRef | null {
  const fit = Math.max(pxW / m.width, pxH / m.height), own = Math.max(m.width, m.height);
  const edge = stepFor(Math.ceil(fit * own), own), job = jobOf(m.path, edge, f);
  const exact = scaled.get(job);
  if (exact) { scaled.delete(job); scaled.set(job, exact); return exact; }
  if (!making.has(job)) {
    making.add(job);
    sourceOf(m.path, m.kind).then(s => scale(s, edge, f)).then(ref => { making.delete(job); remember(job, ref); onChange(); }, e => {
      making.delete(job);
      const entry = store.get(m.path);
      if (entry && entry.media.state === "ready") { entry.media = { state: "error", path: m.path, kind: m.kind, reason: String((e as Error).message ?? e) }; onChange(); }
    });
  }
  // The smallest one ready that covers the box, else the biggest one ready, at this brightness.
  const ready = [...scaled].filter(([k]) => k.startsWith(`${m.path}\0`) && k.endsWith(`\0${f}`)).map(([k, v]) => [Number(k.split("\0")[1]), v] as const).sort((a, b) => a[0] - b[0]);
  return (ready.find(([e]) => e >= edge) ?? ready.at(-1))?.[1] ?? null;
}

// ── the media line ────────────────────────────────────────────────────────────

export type Align = "left" | "center" | "right";
export const ALIGNS: readonly Align[] = ["left", "center", "right"];
export type MediaSize = { cells: number } | { percent: number } | "full";
/**
 * A note line that is only a media reference and its layout (PIE-532): `img:: path`, or `[img::path]` (`image`,
 * `video`) after an optional list mark, then any of `[size::…]` (its width: cells, `N%` of the reader, or `full`),
 * `[height::N]` (rows), `[align::left|center|right]`, `[layout::hero]` (the note's header image), `[fit::cover|contain]`
 * (a header's: crop to fill, or show it whole), `[dim::N]` (0 none … 1 black; left out, a bright image is dimmed) and
 * `[alt::…]`; a block anchor (`^id`) may end it. `problems`: what's written there that isn't one of those values,
 * said on the image's line.
 */
export interface MediaSpec {
  kind: Kind; path: string;
  size?: MediaSize; height?: number; align?: Align; layout?: "hero"; fit?: "cover" | "contain"; dim?: number; alt?: string;
  problems: string[];
}
export type MediaAttr = "size" | "height" | "align" | "layout" | "fit" | "dim" | "alt";
const MEDIA_KEY = /^(img|image|video)$/i;
const ATTRS = new Set<string>(["size", "height", "align", "layout", "fit", "dim", "alt"]);
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
    const tail = /(?:^|\s)(\[(?:size|height|align|layout|fit|dim|alt)::.*)$/i.exec(blockForm[2]!);
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
