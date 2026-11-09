// Where a note names a picture, for an address that holds no path (a published card's cover, PIE-1595): a page's image
// URL says the note and the place, and the publisher reads the note again when it's asked. Beside media-line.ts because
// the property parser imports that file. Pure: no I/O.
import { artifactKind, isPictureValue, noteMediaLines } from "./media-line";
import { splitPropertyValue } from "./property-grammar";
import { parsePropertyRecords } from "./property-parse";

/** The pictures a note's properties name, each with its line and its place among that line's pictures: chips and bare lines alike. */
function propertyPictures(text: string): { line: number; image: number; path: string }[] {
  const seen = new Map<number, number>();
  return parsePropertyRecords(text).flatMap(record => splitPropertyValue(record.value).filter(isPictureValue).map(path => {
    const image = seen.get(record.line) ?? 0;
    seen.set(record.line, image + 1);
    return { line: record.line, image, path };
  }));
}

/** Where in a note the picture `path` is named: its media line, or a property's place on a line; null when it doesn't name it. */
export function pictureAddress(text: string, path: string): { line: number; image?: number } | null {
  for (const [line, spec] of noteMediaLines(text)) if (spec.kind === "img" && spec.path === path) return { line };
  const found = propertyPictures(text).find(picture => picture.path === path);
  return found ? { line: found.line, image: found.image } : null;
}

/** The picture a property names at that place: what `/p/<id>/media/<line>/<image>` serves when no component draws on the line. */
export const propertyPictureAt = (text: string, line: number, image: number): string | undefined =>
  propertyPictures(text).find(picture => picture.line === line && picture.image === image)?.path;

/** Every picture path a note names, once each: its picture lines and its properties' pictures (what the media bucket copies, PIE-1634). */
export const notePicturePaths = (text: string): string[] => [...new Set([
  ...[...noteMediaLines(text).values()].filter(spec => spec.kind === "img" && !spec.fence).map(spec => spec.path),
  ...propertyPictures(text).map(picture => picture.path).filter(path => !/^[a-z][a-z0-9+.-]*:/i.test(path)),
])];

/**
 * Every artifact file a note names, once each: its artifact lines whose path is a file a page runs (`.html`, `.jsx`, …),
 * never a stored artifact's name or a repo. What the media bucket copies beside the pictures (PIE-1644).
 */
export const noteArtifactPaths = (text: string): string[] => [...new Set(
  [...noteMediaLines(text).values()].filter(spec => spec.kind === "artifact" && !spec.fence && artifactKind(spec.path)).map(spec => spec.path.trim()),
)];
