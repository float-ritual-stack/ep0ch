import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SourceCheckout {
  path: string;
  agentsMd: string;
  docs: string;
  skills: string;
  sha: string | null;
}

export const NO_SOURCE = "No ep0ch checkout on this machine; read ep0ch://docs/scripts and ep0ch://docs/extensions.";

/** Resolve from the running code, never the caller's folder or another machine's inherited path. */
export function sourcePath(): string | null {
  const root = resolve(import.meta.dir, "../../..");
  return existsSync(join(root, "AGENTS.md")) ? root : null;
}

export function codeVersion(dir: string): { dir: string; commit: string | null } {
  try {
    const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    return { dir, commit: r.exitCode === 0 ? r.stdout.toString().trim() : null };
  } catch { return { dir, commit: null }; }
}

export function sourceCheckout(): SourceCheckout | null {
  const path = sourcePath();
  return path ? { path, agentsMd: join(path, "AGENTS.md"), docs: join(path, "packages/outliner/docs"),
    skills: join(path, "packages/door/skills"), sha: codeVersion(path).commit } : null;
}

/** The environment of every program ep0ch starts; callers supply their outline and program-specific values. */
export function programEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && key !== "EP0CH_SOURCE") out[key] = value;
  const source = sourcePath();
  if (source) out.EP0CH_SOURCE = source;
  return out;
}

/** hc may start this on another machine: discover that machine's checkout immediately before exec. */
export function execProgram(argv: string[]): never {
  const env = programEnv(process.env);
  const binary = Bun.which(argv[0]!, { PATH: env.PATH });
  if (!binary) throw new Error(`ep0ch agent exec: ${argv[0]} is not on PATH`);
  process.execve!(binary, argv, env);
  throw new Error(`ep0ch agent exec: could not start ${argv[0]}`);
}
