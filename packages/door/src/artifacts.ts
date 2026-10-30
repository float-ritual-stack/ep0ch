import type { ArtifactDeployState, ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { artifactKind, artifactTitle, type ArtifactKind, type MediaSpec } from "@ep0ch/outline-core/media-line";

/** `deploy`: what the repo the line names is doing (PIE-1060), as the service's deploy records answer. */
export interface ArtifactFacts { kind: ArtifactKind | null; title: string; state: "reading" | "ready" | "missing"; reason?: string; warning?: string; deploy?: ArtifactDeployState }
export interface ArtifactReader { scope: object; read(name: string): Promise<ArtifactInfo>; changed(): void }

/** Recheck availability after a sync or put without keeping source text in the reader. */
const RECHECK_MS = 5000;
/** How often a repo's card asks again when no deploy is under way: a save's deploy shows within this. */
const REPO_RECHECK_MS = 6000;
interface Entry { title?: string; reason?: string; warning?: string; deploy?: ArtifactDeployState; at: number; reading: boolean; changed?: () => void }
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
      info => { entry.title = info.name; entry.warning = info.warning; entry.deploy = info.deploy; delete entry.reason; },
      (err: Error) => { delete entry.title; delete entry.deploy; entry.reason = err?.message ?? String(err); },
    ).finally(() => {
      entry.reading = false; entry.at = Date.now(); entry.changed?.();
      // A repo's card is asked again while it's drawn: a save's deploy starts after the note is quiet and ends in a run
      // note elsewhere, so nothing else redraws it. Often while one is under way, so it turns live (or failed) by itself.
      if (entry.deploy) setTimeout(() => entry.changed?.(), entry.deploy.state === "deploying" ? RECHECK_MS + 50 : REPO_RECHECK_MS).unref?.();
    });
    e = entry;
  }
  if (e.title !== undefined) return { kind, title: spec.alt || e.title, state: "ready", warning: e.warning, ...(e.deploy ? { deploy: e.deploy } : {}) };
  if (e.reason !== undefined) return { kind, title: artifactTitle(spec), state: "missing", reason: e.reason };
  return { kind, title: artifactTitle(spec), state: "reading" };
}
