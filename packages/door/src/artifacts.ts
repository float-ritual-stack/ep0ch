// An artifact line's facts as the door's card shows them (PIE-793): its kind (outline-core's artifactKind, by its
// extension) and its title (artifactTitle: `[alt::]`, an HTML or SVG file's <title>, else its file's name). The file is
// read through the service (`files.read`), so a relative path is the outline's own folder, as the publisher reads it,
// and a door on another machine reads the same file. No script runs in the terminal: the card opens its web page.
import { artifactKind, artifactTitle, type ArtifactKind, type MediaSpec } from "@ep0ch/outline-core/media-line";

/** What the card says: its kind (null for a file claude.ai doesn't run) and title, and why its file couldn't be read. */
export interface ArtifactFacts { kind: ArtifactKind | null; title: string; state: "reading" | "ready" | "missing"; reason?: string }
/**
 * Where a card's file is read: `scope` the outline's connection (each outline's `artifacts/x.html` is its own), `read` its
 * text through the service, `changed` asked to draw again once a read settles.
 */
export interface ArtifactReader { scope: object; read(path: string): Promise<string>; changed(): void }

/** How long a file's title is kept before it is read again (it may have been saved since). */
const RECHECK_MS = 5000;
/** A read file: its title as its text gives it (an HTML or SVG file's <title>, else its name), never the text itself. */
interface Entry { title?: string; reason?: string; at: number; reading: boolean; changed?: () => void }
const byScope = new WeakMap<object, Map<string, Entry>>();

/**
 * The facts for `spec`'s card. Without `reader` (`ep0ch show`, a note from no outline), its file's name is its title.
 * With it, the file is read (again after a while: it says whether it's there, and an HTML or SVG file's title), and the
 * reader that asked last is told once a read settles, to draw again.
 */
export function artifactFacts(spec: Pick<MediaSpec, "path" | "alt">, reader?: ArtifactReader): ArtifactFacts {
  const kind = artifactKind(spec.path);
  if (!reader || !kind) return { kind, title: artifactTitle(spec), state: "ready" };
  let read = byScope.get(reader.scope);
  if (!read) byScope.set(reader.scope, (read = new Map()));
  let e = read.get(spec.path);
  if (e) e.changed = reader.changed;
  if (!e || (!e.reading && Date.now() - e.at > RECHECK_MS)) {
    const entry: Entry = e ?? { at: 0, reading: true, changed: reader.changed };
    entry.reading = true;
    read.set(spec.path, entry);
    reader.read(spec.path).then(
      text => { entry.title = artifactTitle({ path: spec.path }, text); delete entry.reason; },
      (err: Error) => { delete entry.title; entry.reason = err?.message ?? String(err); },
    ).finally(() => { entry.reading = false; entry.at = Date.now(); entry.changed?.(); });
    e = entry;
  }
  if (e.title !== undefined) return { kind, title: spec.alt || e.title, state: "ready" };
  if (e.reason !== undefined) return { kind, title: artifactTitle(spec), state: "missing", reason: e.reason };
  return { kind, title: artifactTitle(spec), state: "reading" };
}
