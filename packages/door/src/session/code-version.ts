import { resolve } from "node:path";

/** The checkout this code runs from, and its commit (an upgrade compares them). */
export function codeVersion(dir = resolve(import.meta.dir, "../..")): { dir: string; commit: string | null } {
  try {
    const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    return { dir, commit: r.exitCode === 0 ? r.stdout.toString().trim() : null };
  } catch { return { dir, commit: null }; }
}
