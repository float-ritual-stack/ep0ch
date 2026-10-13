// An artifact line's facts as the door's card shows them (PIE-793): its kind (outline-core's artifactKind, by its
// extension) and its title (artifactTitle: `[alt::]`, an HTML or SVG file's <title>, else its file's name). The file is
// read through the service (`files.read`), so a relative path is the outline's own folder, as the publisher reads it,
// and a door on another machine reads the same file. No script runs in the terminal: the card opens its web page.
import { artifactKind, artifactTitle, type ArtifactKind, type MediaSpec } from "@ep0ch/outline-core/media-line";

/** What the card says: its kind (null for a file claude.ai doesn't run) and title, and why its file couldn't be read. */
export interface ArtifactFacts { kind: ArtifactKind | null; title: string; state: "reading" | "ready" | "missing"; reason?: string }
/** Reads a file through the service: its text, or a rejection with why. */
export type ArtifactReader = (path: string) => Promise<string>;

/** How long a file's title is kept before it is read again (it may have been saved since). */
const RECHECK_MS = 5000;
interface Entry { text?: string; reason?: string; at: number; reading: boolean }
const read = new Map<string, Entry>();

/**
 * The facts for `spec`'s card. Without `reader` (`ep0ch show`, a note from no outline), its file's name is its title.
 * With it, the file is read (again after a while: it says whether it's there, and an HTML or SVG file's title), and
 * `changed` is called once a read settles, to draw again.
 */
export function artifactFacts(spec: Pick<MediaSpec, "path" | "alt">, reader?: ArtifactReader, changed?: () => void): ArtifactFacts {
  const kind = artifactKind(spec.path);
  if (!reader || !kind) return { kind, title: artifactTitle(spec), state: "ready" };
  let e = read.get(spec.path);
  if (!e || (!e.reading && Date.now() - e.at > RECHECK_MS)) {
    const entry: Entry = e ?? { at: 0, reading: true };
    entry.reading = true;
    read.set(spec.path, entry);
    reader(spec.path).then(
      text => { entry.text = text; delete entry.reason; },
      (err: Error) => { delete entry.text; entry.reason = err?.message ?? String(err); },
    ).finally(() => { entry.reading = false; entry.at = Date.now(); changed?.(); });
    e = entry;
  }
  if (e.text !== undefined) return { kind, title: artifactTitle(spec, e.text), state: "ready" };
  if (e.reason !== undefined) return { kind, title: artifactTitle(spec), state: "missing", reason: e.reason };
  return { kind, title: artifactTitle(spec), state: "reading" };
}
