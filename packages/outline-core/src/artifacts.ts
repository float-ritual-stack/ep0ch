/**
 * `url` is the artifact's page in the web client (signed in, or by a share): the only address a person is given. `frame` is
 * where a frame loads it from, present only when a reader asked for it (`artifacts.show` with `frame`), and never shown.
 */
export interface ArtifactInfo { name: string; version?: number; files: string[]; bytes: number; url: string | null; warning?: string; frame?: string | null; deploy?: ArtifactDeployState }
/**
 * What a repo an artifact line names is doing (PIE-1060), as artifact-deploy's records say: `deploying` (a run is under way
 * here), `live` (deployed, at `url`), `failed` (its last run failed: `said` says why, `command` fixes it), `not-deployed`
 * (no record: `command` deploys it) or `refused` (not an ep0ch-artifacts repo: `command` forks it there). `run` is the
 * newest run note for it; `recorded` the repo the live record came from when it isn't this one (an imported deployment).
 */
export interface ArtifactDeployState {
  repo: string; state: "deploying" | "live" | "failed" | "not-deployed" | "refused";
  url?: string; where?: string; commit?: string; deployedAt?: string; recorded?: string;
  said?: string; command?: string; run?: { id: string; title: string; at: string };
}
/** Who a frame is for: the signed-in owner (a short while), or one open share by its id. */
export type ArtifactReader = { owner: true } | { share: { id: string } };
export type ArtifactRequest =
  /** `note` deploys every repo that note's artifact lines name (the deploy rule's script), `repo` the one named. */
  | { action: "artifacts.deploy"; repo?: string; note?: string; domain?: string; mutation?: { author: "agent" | "user" | "system"; actorId?: string; sessionId?: string; taskId?: string } }
  | { action: "artifacts.dns"; name: string; to: "vercel" | "float-2" }
  | { action: "artifacts.backfill"; catalogue?: string }
  /** A one-time link to hand a file to the inbox for this outline's day note (PIE-1267); the name is optional. */
  | { action: "artifacts.lease"; name?: string; mutation?: { author: "agent" | "user" | "system"; actorId?: string; sessionId?: string; taskId?: string } }
  | { action: "artifacts.put"; name: string; files: Record<string, string> }
  | { action: "artifacts.show"; name: string; frame?: ArtifactReader }
  | { action: "artifacts.snapshot" | "artifacts.versions" | "artifacts.rm"; name: string }
  | { action: "artifacts.list" | "artifacts.import" }
  | { action: "artifacts.upload.begin"; name: string }
  | { action: "artifacts.upload.chunk"; upload: string; data: string }
  | { action: "artifacts.upload.finish" | "artifacts.upload.abort"; upload: string };

export function artifactReference(value: string): { name: string; version?: number } | null {
  const match = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:@([1-9][0-9]*))?$/.exec(value);
  return match ? { name: match[1]!, ...(match[2] ? { version: Number(match[2]) } : {}) } : null;
}
export const isArtifactName = (value: string): boolean => artifactReference(value) !== null;
