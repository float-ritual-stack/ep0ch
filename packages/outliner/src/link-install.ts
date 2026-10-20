import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LinkInstallResult {
  sha: string;
  code: number;
  commit?: string;
  notDone: string[];
  notes?: string[];
  sessions: { why: string; done?: string[]; error?: string }[];
  error?: string;
}
export interface LinkDeploy {
  sha: string;
  record?: { socket: string; outline: string; id: string };
}
export interface LinkUpdate {
  sha: string;
  phase: "ready" | "installing" | "done" | "blocked";
  result?: LinkInstallResult;
  restart?: boolean;
}

export const linkDeployPath = (outlines: string) => join(outlines, ".host/link-deploy.json");
export const linkUpdatePath = (outlines: string) => join(outlines, ".host/link-update.json");
export const linkResultPath = (outlines: string, machine: string, sha: string) => join(outlines, ".remote", `${machine}.${sha}.install.json`);
export function readLinkFile<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
}
export function writeLinkFile(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.tmp`, JSON.stringify(value) + "\n", { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export const linkDeployAt = (outlines: string, sha: string) => join(outlines, ".host/link-deploys", `${sha}.json`);
export function publishLinkInstall(outlines: string, deploy: LinkDeploy) {
  writeLinkFile(linkDeployAt(outlines, deploy.sha), deploy);
  writeLinkFile(linkDeployPath(outlines), deploy);
}
export function linkInstallResult(outlines: string, machine: string, sha: string) {
  const result = readLinkFile<LinkInstallResult>(linkResultPath(outlines, machine, sha));
  return result?.sha === sha ? result : undefined;
}
export function linkInstallSummary(machine: string, result: LinkInstallResult): string {
  const outcome = result.code === 0 && !result.error ? `installed ${result.sha}` : `blocked installing ${result.sha} (exit ${result.code})`;
  return [`${machine}: ${outcome}`, result.error, ...result.notDone, ...(result.notes ?? []), ...result.sessions.flatMap(s => [s.why, ...(s.done ?? []), s.error])].filter(Boolean).join("\n");
}
export function linkUpdateLabel(outlines: string): string {
  const update = readLinkFile<LinkUpdate>(linkUpdatePath(outlines));
  if (!update || update.phase === "done") return "";
  return update.phase === "installing" ? "update ready · installing" : "update ready · ep0ch install --apply";
}

export function reconcileLinkInstall(outlines: string, result: LinkInstallResult) {
  const path = linkUpdatePath(outlines), update = readLinkFile<LinkUpdate>(path);
  if (update?.sha === result.sha) writeLinkFile(path, { sha: result.sha, phase: result.code === 0 ? "done" : "blocked", result });
}
