import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * A script the checkout ships into ~/.local/bin (with-secrets, offload): its `# <name> v<N>` line says its version, and
 * install copies the checkout's over an older or missing one (an installed copy with no version line counts as v0).
 */
export function shippedScript(name: string, source: string, installed: string) {
  const version = (path: string) => Number(new RegExp(`^# ${name} v(\\d+)$`, "m").exec(readFileSync(path, "utf8"))?.[1] ?? 0);
  const shippedVersion = version(source);
  const installedVersion = existsSync(installed) ? version(installed) : null;
  const mode = installedVersion === null ? null : statSync(installed).mode & 0o777;
  const older = installedVersion === null || installedVersion < shippedVersion;
  return { source, installed, shippedVersion, installedVersion, mode, older, command: older ? source : installed };
}

export function withSecretsFacts(home = process.env.HOME || homedir(), repoRoot = resolve(import.meta.dir, "../../..")) {
  return shippedScript("with-secrets", join(repoRoot, "packages/door/scripts/with-secrets"), join(home, ".local/bin/with-secrets"));
}
