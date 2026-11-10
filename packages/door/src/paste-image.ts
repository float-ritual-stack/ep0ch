// A picture put into a draft (PIE-592): from the clipboard, or a file dropped on the terminal (which pastes its
// path, typed in as text like any paste: ctrl+v on it makes it a picture). Either way it's copied into the outline's own folder, `<outline folder>/media/`, and the draft gets a media
// line, `[img::<path>]`, which the reader draws (src/media.ts, outline-core's media-line.ts). The terminal can't hand
// over an image, so the clipboard is read on this machine: pbpaste's cousins on macOS, wl-paste or xclip on Linux.
import { createHash } from "node:crypto";
import { extensionOfBytes } from "@ep0ch/outline-core/file-magic";
import { artifactKind } from "@ep0ch/outline-core/media-line";
import { shellWords } from "@ep0ch/outline-core/shell-words";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { resolveMediaPath } from "./media";
import type { SocketBoard } from "./socket";
import { def } from "./surface/actions";
import type { On } from "./surface/note";

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
export const droppedImage = (text: string): string | null => droppedFile(text, isImageName);

/** The one file `text` names, here, that `wanted` takes by its name (an image, or any file a drop turns into a line), or null. */
function droppedFile(text: string, wanted: (name: string) => boolean = isDropName): string | null {
  const t = text.trim();
  if (!t || t.includes("\n")) return null;
  const r = resolveMediaPath(t);
  if (!r.exists || !isAbsolute(r.path) || !wanted(r.path)) return null;
  try { return statSync(r.path).isFile() ? r.path : null; } catch { return null; }
}

const isImageName = (name: string) => IMAGE_EXT.has(extname(name).toLowerCase());
/** A file a drop turns into a line: a picture, or an artifact (a page claude.ai runs: `.html`, `.jsx`, `.svg`, …; PIE-1656). */
const isDropName = (name: string) => isImageName(name) || !!artifactKind(name);
const isPathWord = (word: string) => /^(?:\/|~\/)/.test(word);
const MOST_DROPPED_LINES = 50;

/**
 * The image and artifact files a paste names and nothing else, as a drop on a terminal writes them (PIE-1589, PIE-1656):
 * paths, quoted or with escaped spaces, several on a line or a line each, or bare names a line each (what macOS's file
 * copy leaves on the clipboard: the folder never reaches the door). Null for any other paste. Reads no file.
 */
export function droppedFiles(text: string): string[] | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > MOST_DROPPED_LINES) return null;
  const files: string[] = [];
  for (const line of lines) {
    const words = shellWords(line);
    if (!words) return null;
    if (words.every(word => isPathWord(word) && isDropName(word))) { files.push(...words); continue; }
    // One file with spaces its terminal left as they are, unless a word is another file: files mixed with anything stay text.
    if (words.slice(0, -1).some(isDropName) || words.slice(1).some(word => word.includes("/"))) return null;
    const whole = words.join(" ");
    // A path, or a name that starts as a file's name does.
    if (!isDropName(whole) || !(isPathWord(whole) || (/^[\p{L}\p{N}]/u.test(whole) && !whole.includes("/")))) return null;
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
  if (isPathWord(file)) { const here = droppedFile(file); if (here) return here; }
  const name = sameName(basename(file));
  for (const folder of folders) {
    let names: string[];
    try { names = readdirSync(folder); } catch { continue; }
    const found = names.find(n => sameName(n) === name);
    if (found && droppedFile(join(folder, found))) return join(folder, found);
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
/** The media line for a dropped artifact (PIE-1656): its path as the file's, spaces and all; the line's grammar reads it whole. */
export const artifactLine = (path: string) => `[artifact::${path}]`;

/** The folders this outline's notes name for dropped files: `[drop-folder::<folder>]` on any note. */
async function dropFolders(board: Pick<SocketBoard, "request">): Promise<string[]> {
  const { blocks } = await board.request("blocks.query", { query: { where: "drop-folder", limit: 50 } });
  return [...new Set(blocks.flatMap(b => (b.properties ?? []).filter(p => p.key === "drop-folder").map(p => p.value.trim())))];
}

/** Their one action, in the reader's set beside `draft.image`. */
export const dropActions = {
  "draft.drop": def({
    summary: "turn what was just pasted before the cursor into lines, when it is nothing but image or artifact files (PIE-1589, PIE-1656): a file dropped on the terminal pastes its path (escaped or quoted), or on macOS a bare name; each found here (its path, else its name in a folder a note names with [drop-folder::<folder>]) becomes a line of its own, one undo step that gives the paste back. A picture is copied into the outline's folder (media/) as an [img::<path>] line; an artifact (.html, .jsx, .svg, …) runs from where it is, as an [artifact::<path>] line naming it with its spaces as they are. What it can't find stays as written, and is said. A path pasted as a value (after [artifact:: or [img::) and any other paste stay as they are",
    keys: "a paste of nothing but image or artifact files, in an edit or a comment",
    touches: "draft", draft: "type", replay: "ask",
    args: { text: { type: "string", about: "the paste, as it sits before the cursor" } },
    examples: [
      { act: "draft.drop text=\"plot at dusk.png\"", does: "after draft.paste of the same text: finds it in the outline's [drop-folder::] folders and makes it a picture" },
      { act: "draft.drop text=\"/made/up/night\\ shift.html\"", does: "after draft.paste of the same text: an [artifact::/made/up/night shift.html] line, its card reading the file" },
    ],
    async run({ text }: { text: string }, { surface, host }: On, actor) {
      const d = surface.writingDraft, files = droppedFiles(text);
      if (!d || !files) return { pictures: 0 };
      // A path pasted as a property's value (typed `[artifact::`, then the path) is the person's own line: it stays.
      if (d.typedInToken(text)) return { pictures: 0 };
      const here = files.map(file => findDropped(file, []));
      // Only a file that isn't where it's named asks the outline where else to look.
      const folders = here.every(Boolean) ? [] : await dropFolders(host.ctx.board).catch(() => [] as string[]);
      const found = here.map((path, i) => path ?? findDropped(files[i]!, folders));
      const missing = files.filter((_, i) => !found[i]);
      const lookIn = folders.length ? `isn't in ${folders.join(", ")} or on this machine` : "isn't on this machine: a note carrying [drop-folder::<folder>] says where dropped names are looked up";
      if (missing.length === files.length) { d.status.say(`${missing.join(", ")} ${lookIn}`); host.redraw(); return { pictures: 0, missing }; }
      // A picture is copied into the outline's folder, so it needs the outline on this machine; an artifact runs from
      // where it is (the outline's host reads it from the machine that has it, PIE-1644), so its line names that path.
      const isPicture = (path: string | null) => !!path && isImageName(path);
      const info = found.some(isPicture) ? await host.ctx.board.info().catch(() => null) : null;
      const away = found.some(isPicture) && (!info || info.host !== hostname());
      const awaySaid = `the outline is on ${info?.host ?? "another machine"}: what you dropped stays as text, and a picture goes into an outline on this machine`;
      if (away && found.every(path => !path || isPicture(path))) { d.status.say(awaySaid); host.redraw(); return { pictures: 0 }; }
      if (surface.writingDraft !== d || d.busy) return { pictures: 0 };
      let lines: string[];
      try { lines = found.map((path, i) => !path || (away && isPicture(path)) ? files[i]! : isPicture(path) ? imageLine(keepImage(info!.workspace, path)) : artifactLine(path)); }
      catch (e) { d.status.say((e as Error).message); host.redraw(); return { pictures: 0 }; }
      if (!d.replaceTyped(text, lines, actor)) return { pictures: 0 };
      const pictures = away ? 0 : found.filter(isPicture).length, artifacts = found.filter(path => path && !isPicture(path)).length;
      const made = [pictures ? `${pictures === 1 ? "a picture" : `${pictures} pictures`} kept in media/` : "", artifacts ? `${artifacts === 1 ? "an artifact" : `${artifacts} artifacts`}, run from where ${artifacts === 1 ? "it is" : "they are"}` : ""].filter(Boolean).join(" · ");
      d.status.say(`${made} · ctrl+z gives back what you dropped${away ? ` · ${awaySaid}` : ""}${missing.length ? ` · ${missing.join(", ")} ${lookIn}` : ""}`);
      host.redraw();
      return { pictures, artifacts, missing };
    },
  }),
};
