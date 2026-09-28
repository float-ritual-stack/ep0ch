// Images and video referenced from notes (`img:: path`, `[img::path]`, `[video::path]`),
// turned into bounded PNGs the terminal can place. Work happens off the render path;
// entries start "loading" and a redraw follows when they settle.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface PngRef { png: Buffer; width: number; height: number; key: string }
export type Media =
  | { state: "loading"; path: string; kind: "img" | "video" }
  | { state: "ready"; path: string; kind: "img" | "video"; image: PngRef }
  | { state: "error"; path: string; kind: "img" | "video"; reason: string };

const MAX_PX = 1600;
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ep0ch-door", "media");
const store = new Map<string, Media>();
let onChange: () => void = () => {};
export function onMediaChange(fn: () => void) { onChange = fn; }

/** `~`, backslash-escaped spaces, and macOS screenshot names (a narrow no-break space before AM/PM). */
export function resolveMediaPath(raw: string): { path: string; exists: boolean } {
  const p = raw.trim().replace(/^["']|["']$/g, "").replace(/\\ /g, " ").replace(/^~(?=\/)/, homedir());
  const candidates = [p, p.replace(/ (AM|PM)(?=\.\w+$)/, " $1")];
  for (const c of candidates) { try { statSync(c); return { path: c, exists: true }; } catch { /* next */ } }
  return { path: p, exists: false };
}

function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(err.trim().split("\n").pop() || `${cmd[0]} failed`);
  return err;
}

async function produce(path: string, kind: "img" | "video"): Promise<PngRef> {
  const st = statSync(path);
  const key = createHash("sha1").update(`${path}\0${st.mtimeMs}\0${st.size}`).digest("hex").slice(0, 16);
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, `${key}.png`);
  if (!existsSync(out)) {
    if (kind === "video") {
      try { await run(["ffmpeg", "-v", "error", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", `scale='min(${MAX_PX},iw)':-2`, "-y", out]); }
      catch { await run(["qlmanage", "-t", "-s", String(MAX_PX), "-o", CACHE, path]); await Bun.write(out, Bun.file(join(CACHE, `${basename(path)}.png`))); }
    } else {
      const raw = readFileSync(path);
      const size = pngSize(raw);
      if (size && size.width <= MAX_PX && size.height <= MAX_PX) await Bun.write(out, raw);
      else await run(["sips", "-s", "format", "png", "-Z", String(MAX_PX), path, "--out", out]);
    }
  }
  const png = readFileSync(out);
  const size = pngSize(png);
  if (!size) throw new Error("not a PNG after conversion");
  return { png, ...size, key };
}

export function media(raw: string, kind: "img" | "video"): Media {
  const { path, exists } = resolveMediaPath(raw);
  const hit = store.get(path);
  if (hit) return hit;
  if (!exists) {
    const m: Media = { state: "error", path, kind, reason: "file not found" };
    store.set(path, m); return m;
  }
  const m: Media = { state: "loading", path, kind };
  store.set(path, m);
  produce(path, kind).then(image => { store.set(path, { state: "ready", path, kind, image }); onChange(); }, e => {
    const msg = String((e as Error).message ?? e);
    const reason = /EPERM|not permitted/i.test(msg) ? "macOS blocked the read: give this terminal Files & Folders access" : msg;
    store.set(path, { state: "error", path, kind, reason }); onChange();
  });
  return m;
}

/** A note line that is only a media reference: `img:: path`, `- [img::path]`, `[video::path]`. */
export const MEDIA_LINE = /^\s*(?:[-*]\s+)?\[?(img|image|video)::\s*(.+?)\]?\s*$/i;
