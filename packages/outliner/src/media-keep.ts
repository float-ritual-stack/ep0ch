/*
 * `media.keep`: a file put into a draft by a client that reaches the outline over its socket (the native window: a
 * picture pasted, a file dropped on a note). The door keeps a picture itself, and only when the outline's folder is
 * on its own machine (src/paste-image.ts); a client elsewhere hands the bytes over and the service keeps them, by
 * the door's own rule:
 *
 * - **A picture** is copied into `<outline folder>/media/`, named by its day and contents (outline-core's
 *   `keptMediaName`: the same picture twice is one file), and answered with its `[img::<path>]` line.
 * - **An artifact** (a page a note runs) is not copied: it runs from where it is, so its line names its own path
 *   (`[artifact::<path>]`), which the asker says (`path`).
 * - **Anything else** is refused, saying what a note keeps.
 *
 * The line is the service's to write (outline-core's `imageLine`, `artifactLine`): a client puts it in its draft as
 * answered and reads no grammar. Nothing is written to a note here; a read-only copy never answers it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { extensionOfBytes } from "@ep0ch/outline-core/file-magic";
import { artifactLine, imageLine, keptAs, keptMediaName, type MediaKept } from "@ep0ch/outline-core/media-keep";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { MAX_PUBLISHED_IMAGE_BYTES } from "./publish-attachments";

/** What a client asks. Declared here, beside the handler: types.ts names it once in the request union. */
export interface MediaKeepRequest {
  id: string; action: "media.keep";
  /** The file's name, as it was called where it came from: says what it is kept as. None: a picture off a clipboard. */
  name?: string;
  /** Where the file is: read here when no bytes are handed over, and the path an artifact's line names. */
  path?: string;
  /** The file's bytes, when the asker has them and the service may not (another machine's file, a clipboard's picture). */
  base64?: string;
}

/** The file `request` names, kept for the outline whose folder is `folder`: what the draft's line is. */
export function keepMedia(folder: string | undefined, request: MediaKeepRequest, now = new Date()): MediaKept {
  const named = request.name ?? (request.path ? basename(request.path) : "");
  const kind = named ? keptAs(named) : "picture";
  if (!kind) throw new Refusal("invalid", `${named} is no picture and no page a note runs: a note keeps pictures (png, jpg, gif, webp and their kin) and artifacts (html, jsx, tsx, svg, mermaid)`);
  if (kind === "artifact") {
    if (!request.path || !isAbsolute(request.path)) throw new Refusal("invalid", `${named} runs from where it is, so its line names its path: say where it is (path, from /)`);
    return { path: request.path, line: artifactLine(request.path), kind, kept: false };
  }
  if (!folder || !existsSync(folder)) throw new Refusal("failed", `the outline's folder isn't on this machine (${folder || "none"}): pictures go there`);
  let bytes: Buffer;
  if (request.base64 !== undefined) bytes = Buffer.from(request.base64, "base64");
  else if (request.path) {
    try { bytes = readFileSync(request.path); } catch { throw new Refusal("not-found", `${request.path} isn't on the outline's machine: hand its bytes over (base64)`); }
  } else throw new Refusal("invalid", "media.keep takes a file: its bytes (base64) or where it is (path)");
  if (!bytes.length) throw new Refusal("invalid", `${named || "the picture"} is empty`);
  if (bytes.length > MAX_PUBLISHED_IMAGE_BYTES) throw new Refusal("invalid", `${named || "the picture"} is ${bytes.length} bytes, over the ${MAX_PUBLISHED_IMAGE_BYTES} a picture may be`);
  const dot = named.lastIndexOf(".");
  const extension = (dot > 0 ? named.slice(dot).toLowerCase() : "") || extensionOfBytes(bytes) || ".png";
  const directory = join(folder, "media");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, keptMediaName(now.toISOString().slice(0, 10), createHash("sha256").update(bytes).digest("hex"), extension));
  const kept = !existsSync(path);
  if (kept) writeFileSync(path, bytes);
  return { path, line: imageLine(path), kind, kept };
}
