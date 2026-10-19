import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function withSecretsFacts(home = process.env.HOME || homedir(), repoRoot = resolve(import.meta.dir, "../../..")) {
  const source = join(repoRoot, "packages/door/scripts/with-secrets");
  const installed = join(home, ".local/bin/with-secrets");
  const version = (path: string) => Number(/^# with-secrets v(\d+)$/m.exec(readFileSync(path, "utf8"))?.[1] ?? 0);
  const shippedVersion = version(source);
  const installedVersion = existsSync(installed) ? version(installed) : null;
  const mode = installedVersion === null ? null : statSync(installed).mode & 0o777;
  const older = installedVersion === null || installedVersion < shippedVersion;
  return { source, installed, shippedVersion, installedVersion, mode, older, command: older ? source : installed };
}
