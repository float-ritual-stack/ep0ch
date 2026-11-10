import { readGroupSecret } from "./extension-secrets";
import { keychainItem } from "./keychain";
import { scopeProblem, type KeyAsker } from "./secret-keys";

/**
 * Claude's login for a program the host starts (PIE-1708): an extension's process, and a script's `sh`. A host under
 * launchd can't read the Keychain login `claude` keeps, so `claude -p` says "Not logged in" and exits 1; `with-secrets
 * claude --` held the fix, and every extension's setting had to name it. The host gives the login instead, the way
 * `with-secrets` would: the host's own `CLAUDE_CODE_OAUTH_TOKEN`, else the `claude` group's (`~/.config/secrets/
 * claude.env`, or the Keychain item `with-secrets:claude:CLAUDE_CODE_OAUTH_TOKEN` on macOS). Read when each program
 * starts, so a key added with `with-secrets --add` works at the next call, with no restart. No group, a key scoped to
 * someone else (`ep0ch keys grant`) or one that can't be read gives nothing: `claude` then finds its own login, as it
 * does on a machine where it can (float-2's `~/.claude`).
 */
export const CLAUDE_LOGIN = { group: "claude", key: "CLAUDE_CODE_OAUTH_TOKEN" } as const;

export async function claudeLogin(asker: KeyAsker, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env[CLAUDE_LOGIN.key]) return env[CLAUDE_LOGIN.key];
  if (scopeProblem(CLAUDE_LOGIN.group, CLAUDE_LOGIN.key, asker, env)) return undefined;
  try {
    return await readGroupSecret(CLAUDE_LOGIN.group, CLAUDE_LOGIN.key, "claude's login",
      process.platform === "darwin" ? (service) => keychainItem(service) : undefined, env);
  } catch {
    return undefined;
  }
}
