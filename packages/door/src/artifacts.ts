import type { ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { artifactKind, artifactTitle, type ArtifactKind, type MediaSpec } from "@ep0ch/outline-core/media-line";

export interface ArtifactFacts { kind: ArtifactKind | null; title: string; state: "reading" | "ready" | "missing"; reason?: string }
export interface ArtifactReader { scope: object; read(name: string): Promise<ArtifactInfo>; changed(): void }

/** Recheck availability after a sync or put without keeping source text in the reader. */
const RECHECK_MS = 5000;
interface Entry { title?: string; reason?: string; at: number; reading: boolean; changed?: () => void }
const byScope = new WeakMap<object, Map<string, Entry>>();

export function artifactFacts(spec: Pick<MediaSpec, "path" | "alt">, reader?: ArtifactReader): ArtifactFacts {
  const kind = artifactKind(spec.path);
  if (!reader) return { kind, title: artifactTitle(spec), state: "ready" };
  let read = byScope.get(reader.scope);
  if (!read) byScope.set(reader.scope, (read = new Map()));
  let e = read.get(spec.path);
  if (e) e.changed = reader.changed;
  if (!e || (!e.reading && Date.now() - e.at > RECHECK_MS)) {
    const entry: Entry = e ?? { at: 0, reading: true, changed: reader.changed };
    entry.reading = true;
    read.set(spec.path, entry);
    reader.read(spec.path).then(
      info => { entry.title = info.name; delete entry.reason; },
      (err: Error) => { delete entry.title; entry.reason = err?.message ?? String(err); },
    ).finally(() => { entry.reading = false; entry.at = Date.now(); entry.changed?.(); });
    e = entry;
  }
  if (e.title !== undefined) return { kind, title: spec.alt || e.title, state: "ready" };
  if (e.reason !== undefined) return { kind, title: artifactTitle(spec), state: "missing", reason: e.reason };
  return { kind, title: artifactTitle(spec), state: "reading" };
}
