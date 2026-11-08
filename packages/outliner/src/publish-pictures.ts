// A page's pictures from the media bucket (PIE-1634): the outline host copies each picture a saved note names
// (media-copies.ts), and a page serves the copy, so a picture shows wherever its file is (another folder, another
// machine) and the publisher's disk holds none. The address a page writes is unchanged (`/p/<id>/media/<line>`, the
// note and the line, never a path); it redirects to a short-lived address in the private bucket the host signs. A
// picture whose copy hasn't landed is read from its file as before, inside the publish roots.
import type { MediaCopies, MediaCopy } from "@ep0ch/outline-core/media-copy";
import { notePicturePaths } from "@ep0ch/outline-core/picture-address";
import { checkImage, readCheckedImage, type AttachmentPolicy } from "./publish-attachments";

type Asks = { request<T>(request: never): Promise<T> };

/** What the host has of a page's pictures, by the path as each note writes it. */
export interface PictureCopies { bucket: boolean; problem?: string; byPath: Map<string, MediaCopy> }

const NONE: PictureCopies = { bucket: false, byPath: new Map() };

/** The copies of the pictures `texts` (the page's notes) name; none when the host doesn't keep copies. */
export async function pictureCopies(client: Asks, texts: readonly string[], presign = false): Promise<PictureCopies> {
  const paths = [...new Set(texts.flatMap((text) => notePicturePaths(text)))];
  return paths.length ? copiesOf(client, paths, presign) : NONE;
}

async function copiesOf(client: Asks, paths: readonly string[], presign: boolean): Promise<PictureCopies> {
  try {
    const answer = await client.request<MediaCopies>({ action: "media.copies", paths: [...paths], presign } as never);
    return { bucket: answer.bucket, ...(answer.problem ? { problem: answer.problem } : {}), byPath: new Map(answer.copies.map((copy) => [copy.path, copy])) };
  } catch {
    return NONE;
  }
}

/**
 * The picture at `path` for a page that may show it: a redirect to its bucket copy, else its file when the publish roots
 * allow it, else not found.
 */
export async function pictureResponse(client: Asks, path: string, policy: AttachmentPolicy, head: boolean, headers: Record<string, string>): Promise<Response> {
  const copy = (await copiesOf(client, [path], true)).byPath.get(path);
  // Shorter than the address's own life, so a browser never holds one that ran out.
  if (copy?.url) return new Response(null, { status: 302, headers: { ...headers, location: copy.url, "cache-control": "private, max-age=240" } });
  const check = checkImage(path, policy);
  const bytes = check.ok ? readCheckedImage(check) : null;
  if (!check.ok || !bytes) return new Response("Not found\n", { status: 404, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  return new Response(head ? null : new Uint8Array(bytes), {
    headers: {
      ...headers, "content-type": check.mime, "content-length": String(bytes.length), "cache-control": "private, max-age=300",
      // An SVG opened on its own runs nothing.
      ...(check.mime === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}

/** Why a picture with no copy isn't on the page, for the owner, when the bucket is what would show it; null to say what the file check says. */
export function copyWhy(copies: PictureCopies | undefined, path: string): string | null {
  const copy = copies?.byPath.get(path);
  if (copy?.error) return `Its copy to the media bucket didn't land: ${copy.error}. Saving the note tries again.`;
  if (copies?.problem) return `The outline host can't copy pictures: ${copies.problem}.`;
  if (copies?.bucket) return copy ? "Its copy to the media bucket is on its way: reload in a moment." : "It isn't in the media bucket yet: saving the note copies it (the file must be on the outline's machine).";
  return null;
}
