// A file kept for a note: what a picture put into a draft is called in its outline's folder, and the media line a
// kept file is written as. One rule, asked by the door (which keeps a picture itself when the outline is on its
// own machine, src/paste-image.ts) and by the service's `media.keep` (for a client that reaches the outline over
// its socket: the native window, a pasted picture or a dropped file).
import { artifactKind } from "./media-line";

/** The picture formats a paste or a drop keeps: what a reader draws. */
const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"];

/** A name's extension, lowercased, with its dot; "" when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) ? name.slice(dot).toLowerCase() : "";
}

/** Whether a file by this name is a picture a draft keeps. */
export const isImageName = (name: string): boolean => IMAGE_EXTENSIONS.includes(extensionOf(name));

/** What a file dropped on a draft is kept as, by its name: a picture (copied into the outline), an artifact (run from where it is), or neither. */
export function keptAs(name: string): "picture" | "artifact" | null {
  return isImageName(name) ? "picture" : artifactKind(name) ? "artifact" : null;
}

/** A kept picture's file name: its day and the first of its contents' sha256 (`2026-10-13-1a2b3c4d.png`), so the same picture twice is one file. */
export const keptMediaName = (day: string, sha256: string, extension: string): string => `${day}-${sha256.slice(0, 8)}${extension}`;

/** The media line for a kept picture: brackets in its path are the line's own grammar's to read. */
export const imageLine = (path: string): string => `[img::${path}]`;
/** The media line for an artifact (PIE-1656): its path as the file's, spaces and all; the line's grammar reads it whole. */
export const artifactLine = (path: string): string => `[artifact::${path}]`;

/** What `media.keep` answers: where the file is now, the line to put in the draft, and whether a copy was made. */
export interface MediaKept {
  /** The kept picture's path in the outline's folder, or the artifact's own path. */
  path: string;
  /** The media line that draws it: what a client puts in the draft, on a line of its own. */
  line: string;
  kind: "picture" | "artifact";
  /** A copy went into the outline's folder (a picture); false for an artifact, which runs from where it is, and for a picture that was there already. */
  kept: boolean;
}
