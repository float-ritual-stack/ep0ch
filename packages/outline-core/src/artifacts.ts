export interface ArtifactInfo { name: string; version?: number; files: string[]; bytes: number; url: string | null }
export type ArtifactRequest =
  | { action: "artifacts.deploy"; repo: string; domain?: string; mutation?: { author: "agent" | "user" | "system"; actorId?: string; sessionId?: string; taskId?: string } }
  | { action: "artifacts.dns"; name: string; to: "vercel" | "float-2" }
  | { action: "artifacts.backfill"; catalogue?: string }
  | { action: "artifacts.put"; name: string; files: Record<string, string> }
  | { action: "artifacts.show" | "artifacts.snapshot" | "artifacts.versions" | "artifacts.rm"; name: string }
  | { action: "artifacts.list" | "artifacts.import" }
  | { action: "artifacts.upload.begin"; name: string }
  | { action: "artifacts.upload.chunk"; upload: string; data: string }
  | { action: "artifacts.upload.finish" | "artifacts.upload.abort"; upload: string };

export function artifactReference(value: string): { name: string; version?: number } | null {
  const match = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:@([1-9][0-9]*))?$/.exec(value);
  return match ? { name: match[1]!, ...(match[2] ? { version: Number(match[2]) } : {}) } : null;
}
export const isArtifactName = (value: string): boolean => artifactReference(value) !== null;
