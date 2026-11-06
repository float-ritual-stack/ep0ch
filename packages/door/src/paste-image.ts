// A picture put into a draft (PIE-592): from the clipboard, or a file dropped on the terminal (which pastes its
// path, typed in as text like any paste: ctrl+v on it makes it a picture). Either way it's copied into the outline's own folder, `<outline folder>/media/`, and the draft gets a media
// line, `[img::<path>]`, which the reader draws (src/media.ts, outline-core's media-line.ts). The terminal can't hand
// over an image, so the clipboard is read on this machine: pbpaste's cousins on macOS, wl-paste or xclip on Linux.
import { createHash } from "node:crypto";
import { extensionOfBytes } from "@ep0ch/outline-core/file-magic";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { resolveMediaPath } from "./media";
import type { SocketBoard } from "./socket";
import { def } from "./surface/actions";
import type { On } from "./surface/note";
import { pasteKeys, type Key } from "./term";

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

/** A line of a paste as a shell would read it: its words, quoted or with escaped characters; null with a quote left open. */
function shellWords(line: string): string[] | null {
  const words: string[] = [];
  let word = "", inWord = false, quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) { if (c === quote) quote = ""; else word += c; continue; }
    if (c === " " || c === "\t") { if (inWord) words.push(word); word = ""; inWord = false; continue; }
    inWord = true;
    if (c === "'" || c === '"') quote = c;
    else if (c === "\\" && i + 1 < line.length) word += line[++i];
    else word += c;
  }
  if (quote) return null;
  if (inWord) words.push(word);
  return words;
}

const isImageName = (name: string) => IMAGE_EXT.has(extname(name).toLowerCase());
const isPathWord = (word: string) => /^(?:\/|~\/)/.test(word);
const MOST_DROPPED_LINES = 50;

/**
 * The image files a paste names and nothing else, as a drop on a terminal writes them (PIE-1589): paths, quoted or with
 * escaped spaces, several on a line or a line each, or bare names a line each (what macOS's file copy leaves on the
 * clipboard: the folder never reaches the door). Null for any other paste. Reads no file.
 */
export function droppedFiles(text: string): string[] | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > MOST_DROPPED_LINES) return null;
  const files: string[] = [];
  for (const line of lines) {
    const words = shellWords(line);
    if (!words) return null;
    if (words.every(word => isPathWord(word) && isImageName(word))) { files.push(...words); continue; }
    const whole = words.join(" ");
    // One file with spaces its terminal left as they are: a path, or a name that starts as a file's name does.
    if (!isImageName(whole) || !(isPathWord(whole) || (/^[\p{L}\p{N}]/u.test(whole) && !whole.includes("/")))) return null;
    files.push(whole);
  }
  return files;
}

const sameName = (name: string) => name.normalize("NFC").replace(/\u202f/g, " ");

/**
 * A file `droppedFiles` read: the path when it's on this machine, else (a bare name, another machine's path) the file of
 * that name in `folders`, the first that holds one; else null.
 */
export function findDropped(file: string, folders: readonly string[]): string | null {
  if (isPathWord(file)) { const here = droppedImage(file); if (here) return here; }
  const name = sameName(basename(file));
  for (const folder of folders) {
    let names: string[];
    try { names = readdirSync(folder); } catch { continue; }
    const found = names.find(n => sameName(n) === name);
    if (found && droppedImage(join(folder, found))) return join(folder, found);
  }
  return null;
}

/** The kind of picture `b` is, by its first bytes: its file extension (a PNG when they say none). */
const extOf = (b: Buffer): string => extensionOfBytes(b) ?? ".png";

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

/** The folders this outline's notes name for dropped files: `[drop-folder::<folder>]` on any note. */
async function dropFolders(board: Pick<SocketBoard, "request">): Promise<string[]> {
  const { blocks } = await board.request("blocks.query", { query: { where: "drop-folder", limit: 50 } });
  return [...new Set(blocks.flatMap(b => (b.properties ?? []).filter(p => p.key === "drop-folder").map(p => p.value.trim())))];
}

/** Their one action, in the reader's set beside `draft.image`. */
export const dropActions = {
  "draft.drop": def({
    summary: "turn what was just pasted before the cursor into pictures, when it is nothing but image files (PIE-1589): a file dropped on the terminal pastes its path, or on macOS a bare name; each found here (its path, else its name in a folder a note names with [drop-folder::<folder>]) is copied into the outline's folder (media/) and becomes an [img::<path>] line, one undo step that gives the paste back. What it can't find stays as written, and is said. Any other paste stays as it is",
    keys: "a paste of nothing but image files, in an edit or a comment",
    touches: "draft", draft: "type", replay: "ask",
    args: { text: { type: "string", about: "the paste, as it sits before the cursor" } },
    examples: [
      { act: "draft.drop text=\"plot at dusk.png\"", does: "after draft.paste of the same text: finds it in the outline's [drop-folder::] folders and makes it a picture" },
    ],
    async run({ text }: { text: string }, { surface, host }: On, actor) {
      const d = surface.writingDraft, files = droppedFiles(text);
      if (!d || !files) return { pictures: 0 };
      const info = await host.ctx.board.info().catch(() => null);
      // Pictures live in the outline's folder: the words stay, whole, in a draft on an outline elsewhere.
      if (!info || info.host !== hostname()) { d.status.say(`the outline is on ${info?.host ?? "another machine"}: what you dropped stays as text, and a picture goes into an outline on this machine`); host.redraw(); return { pictures: 0 }; }
      const here = files.map(file => findDropped(file, []));
      // Only a file that isn't where it's named asks the outline where else to look.
      const folders = here.every(Boolean) ? [] : await dropFolders(host.ctx.board).catch(() => [] as string[]);
      const found = here.map((path, i) => path ?? findDropped(files[i]!, folders));
      const missing = files.filter((_, i) => !found[i]);
      const lookIn = folders.length ? `isn't in ${folders.join(", ")} or on this machine` : "isn't on this machine: a note carrying [drop-folder::<folder>] says where dropped names are looked up";
      if (missing.length === files.length) { d.status.say(`${missing.join(", ")} ${lookIn}`); host.redraw(); return { pictures: 0, missing }; }
      if (surface.writingDraft !== d || d.busy) return { pictures: 0 };
      let lines: string[];
      try { lines = found.map((path, i) => path ? imageLine(keepImage(info.workspace, path)) : files[i]!); }
      catch (e) { d.status.say((e as Error).message); host.redraw(); return { pictures: 0 }; }
      if (!d.replaceTyped(text, lines, actor)) return { pictures: 0 };
      const pictures = files.length - missing.length;
      d.status.say(`${pictures === 1 ? "a picture" : `${pictures} pictures`} kept in media/ · ctrl+z gives back what you dropped${missing.length ? ` · ${missing.join(", ")} ${lookIn}` : ""}`);
      host.redraw();
      return { pictures, missing };
    },
  }),
};

/**
 * A paste in anything but a terminal tile: written first, key by key, whatever it holds; files dropped on a terminal
 * then become pictures in a draft that took them (draft.drop, PIE-1589).
 */
export function typePaste(text: string, to: { key(k: Key): void; held: boolean; has(action: string): boolean; press(action: string, args: { text: string }): unknown }): void {
  for (const key of pasteKeys(text)) to.key(key);
  if (to.held && droppedFiles(text) && to.has("draft.drop")) void to.press("draft.drop", { text });
}
