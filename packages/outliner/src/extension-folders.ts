import { join } from "node:path";

type Env = Record<string, string | undefined>;

/** The user extensions folder: OUTLINER_EXTENSIONS_DIR, else `$XDG_CONFIG_HOME/pi-herdr-outliner/extensions` (or `~/.config/…`). */
export function userFolderOf(env: Env, home: string): string {
  return env.OUTLINER_EXTENSIONS_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "pi-herdr-outliner", "extensions");
}

/**
 * Whether a process with `env` reads the user folder. A service pointed at another legacy registry (a scratch or test
 * service) reads it only when pointed at a folder too, so it never picks up the owner's real extensions and secrets.
 */
export function userFolderInUse(env: Env): boolean {
  return !(env.OUTLINER_RESOURCE_EXTENSIONS !== undefined && env.OUTLINER_EXTENSIONS_DIR === undefined);
}
