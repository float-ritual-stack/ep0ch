// Pictures a note names, copied to the media bucket (PIE-1634): the wire's requests and answers. The outline host copies
// each picture a saved note names, keyed by its content's sha256 (outliner's media-copies.ts), and answers where it is:
// the publisher asks which of a page's pictures have a copy and, for one it serves, a short-lived address in the private
// bucket; the door asks for a picture's bytes when the file isn't on its machine. Types only.

/** `media.copies`: which of `paths` (as notes write them) have a copy, each with a presigned `url` when `presign`. */
export interface MediaCopiesRequest { action: "media.copies"; paths: string[]; presign?: boolean }
/** `media.read`: one picture's bytes, from the file on the host's machine, else its bucket copy. */
export interface MediaReadRequest { action: "media.read"; path: string }
export type MediaRequest = MediaCopiesRequest | MediaReadRequest;

/** One picture's copy, by the path as asked. `copied` false: recorded, the upload not landed (`error` says why when it failed). */
export interface MediaCopy {
  path: string;
  sha256: string;
  mime: string;
  bytes: number;
  copied: boolean;
  /** With `presign`: where the bucket serves it for a few minutes. */
  url?: string;
  error?: string;
}

/** `bucket`: whether this host has a media bucket; `problem` why not, when it's half set up. */
export interface MediaCopies { bucket: boolean; problem?: string; copies: MediaCopy[] }

export interface MediaRead { path: string; mime: string; from: "file" | "bucket"; sha256?: string; base64: string }
