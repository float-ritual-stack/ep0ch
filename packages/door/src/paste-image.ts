// A picture put into a draft (PIE-592): from the clipboard, or a file dropped on the terminal (which pastes its
// path, typed in as text like any paste: ctrl+v on it makes it a picture). Either way it's copied into the outline's own folder, `<outline folder>/media/`, and the draft gets a media
// line, `[img::<path>]`, which the reader draws (src/media.ts, outline-core's media-line.ts). The terminal can't hand
// over an image, so the clipboard is read on this machine: pbpaste's cousins on macOS, wl-paste or xclip on Linux.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { resolveMediaPath } from "./media";

/** The picture formats a paste takes: what the reader draws. */
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"]);

/** Tests and other platforms say how the clipboard is read; null: this platform's way. */
export const clipboardImageReader: { read: (() => Promise<Buffer | null>) | null } = { read: null };

/** Run `cmd`, its stdout as bytes, or null when it isn't there, fails or takes longer than `ms` (then it's killed). */
async function bytesOf(cmd: string[], ms = 3000): Promise<Buffer | null> {
  let p: ReturnType<typeof Bun.spawn> | null = null;
  try {
    p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const run = p;
    const done = Promise.all([new Response(run.stdout as ReadableStream).arrayBuffer(), run.exited]);
    const late = new Promise<null>(resolve => setTimeout(() => resolve(null), ms));
    const r = await Promise.race([done, late]);
    if (!r) { run.kill(9); return null; }
    const out = Buffer.from(r[0]);
    return r[1] === 0 && out.length ? out : null;
  } catch { p?.kill(9); return null; }
}

/** `«data PNGf89504E47…»`, as osascript prints the clipboard's PNG, to its bytes. */
const fromAppleData = (b: Buffer | null) => {
  const m = b?.toString("utf8").match(/«data PNGf([0-9A-Fa-f]+)»/);
  return m ? Buffer.from(m[1]!, "hex") : null;
};

/** The image on this machine's clipboard as PNG (or what the clipboard holds), or null when there is none or no way to read it. */
export async function clipboardImage(): Promise<Buffer | null> {
  if (clipboardImageReader.read) return clipboardImageReader.read();
  if (process.platform === "darwin") {
    return (await bytesOf(["pngpaste", "-"])) ?? fromAppleData(await bytesOf(["osascript", "-e", "the clipboard as «class PNGf»"]));
  }
  if (process.env.WAYLAND_DISPLAY) { const b = await bytesOf(["wl-paste", "--no-newline", "--type", "image/png"]); if (b) return b; }
  if (process.env.DISPLAY) return bytesOf(["xclip", "-selection", "clipboard", "-t", "image/png", "-o"]);
  return null;
}

/** Why the clipboard gave no picture here, with what to do: said on the draft's line. */
export function noClipboardImage(): string {
  if (process.platform === "darwin") return "no picture on the clipboard (copy one first, or drop the file on the terminal; `brew install pngpaste` reads more of them)";
  if (!process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) return "this door runs without a desktop to read a clipboard picture from (over ssh?): drop the file on the terminal instead, or `act draft.image path=<file>`";
  return "no picture on the clipboard (wl-paste or xclip reads it: install one), or drop the file on the terminal";
}

/**
 * The image file path the cursor is on or just after in `line` (a file dropped on the terminal pastes its path:
 * quoted, with escaped spaces, `~` too), for ctrl+v to turn into a picture: where it is (the quotes included) and the
 * file. Only a path to an image file on this machine.
 */
export function imagePathAt(line: string, col: number): { start: number; end: number; path: string } | null {
  const found = /(['"]?)((?:~|\/)[^'"\n]*?\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic))\1(?=$|[\s,.;:)\]])/gi;
  for (let from = 0; from <= line.length;) {
    found.lastIndex = from;
    const m = found.exec(line);
    if (!m) break;
    const start = m.index, end = m.index + m[0].length;
    // Quoted, it can follow anything (a drop right after other text); bare, it starts a word.
    if (start <= col && col <= end && (m[1] || start === 0 || /[\s(\[]/.test(line[start - 1]!))) {
      const path = droppedImage(m[0]);
      if (path) return { start, end, path };
    }
    from = start + 1;
  }
  return null;
}

/** The one image file `text` names (a path dropped on the terminal: quoted or with escaped spaces, `~` too), or null. */
export function droppedImage(text: string): string | null {
  const t = text.trim();
  if (!t || t.includes("\n") || !IMAGE_EXT.has(extname(t.replace(/["']$/, "")).toLowerCase())) return null;
  const r = resolveMediaPath(t);
  if (!r.exists || !isAbsolute(r.path)) return null;
  try { return statSync(r.path).isFile() ? r.path : null; } catch { return null; }
}

/** The kind of picture `b` is, by its first bytes: its file extension. */
function extOf(b: Buffer): string {
  if (b[0] === 0x89 && b[1] === 0x50) return ".png";
  if (b[0] === 0xff && b[1] === 0xd8) return ".jpg";
  if (b.subarray(0, 3).toString("latin1") === "GIF") return ".gif";
  if (b.subarray(8, 12).toString("latin1") === "WEBP") return ".webp";
  return ".png";
}

/**
 * `image` (its bytes, or a file to copy) kept in the outline's folder `folder`, under `media/`, named by its day and
 * contents (`2026-10-13-1a2b3c4d.png`: the same picture twice is one file): its absolute path.
 */
export function keepImage(folder: string, image: Buffer | string, now = new Date()): string {
  if (!folder || !existsSync(folder)) throw new Error(`the outline's folder isn't on this machine (${folder || "none"}): pictures go there`);
  const bytes = typeof image === "string" ? readFileSync(image) : image;
  const ext = typeof image === "string" ? extname(image).toLowerCase() || extOf(bytes) : extOf(bytes);
  const day = now.toISOString().slice(0, 10), hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  const dir = join(folder, "media");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${day}-${hash}${ext}`);
  if (!existsSync(path)) { if (typeof image === "string") copyFileSync(image, path); else writeFileSync(path, bytes); }
  return path;
}

/** The media line for a kept picture: brackets in its path are the line's own grammar's to read. */
export const imageLine = (path: string) => `[img::${path}]`;
