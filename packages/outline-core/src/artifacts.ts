/**
 * `url` is the artifact's page in the web client (signed in, or by a share): the only address a person is given. `frame` is
 * where a frame loads it from, present only when a reader asked for it (`artifacts.show` with `frame`), and never shown.
 */
export interface ArtifactInfo { name: string; version?: number; files: string[]; bytes: number; url: string | null; warning?: string; frame?: string | null }
/** Who a frame is for: the signed-in owner (a short while), or one open share by its id. */
export type ArtifactReader = { owner: true } | { share: { id: string } };
export type ArtifactRequest =
  | { action: "artifacts.deploy"; repo: string; domain?: string; mutation?: { author: "agent" | "user" | "system"; actorId?: string; sessionId?: string; taskId?: string } }
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
