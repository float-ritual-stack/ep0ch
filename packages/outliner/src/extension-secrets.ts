import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A secret by `with-secrets` group (PIE-754): `{ group: "readwise", key: "READWISE_TOKEN" }` is the `KEY=value`
 * line `READWISE_TOKEN` of `~/.config/secrets/readwise.env` (`WITH_SECRETS_DIR` moves the folder, as it does for
 * the `with-secrets` command). The file is read when a call starts, and only the one key it names is taken: the
 * rest of the group never reaches the extension. On macOS a group with no file falls back to the Keychain the way
 * `with-secrets` does: `<group>.keys` lists the names, each read from the generic password
 * `with-secrets:<group>:<KEY>`.
 *
 * Errors say which group, key and file, and its mode; never a value.
 */

export const SECRET_GROUP_PATTERN = "^[a-z0-9._-]{1,64}$";
export const SECRET_KEY_PATTERN = "^[A-Za-z_][A-Za-z0-9_]{0,63}$";

export function secretsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.WITH_SECRETS_DIR || join(env.HOME || homedir(), ".config", "secrets");
}

/** One `KEY=value` line's value, quotes trimmed as `with-secrets` trims them; undefined when the key isn't there. */
export function groupValue(text: string, key: string): string | undefined {
  let found: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const at = line.indexOf("=");
    if (at < 1 || line.slice(0, at).trim() !== key) continue;
    let value = line.slice(at + 1);
    value = value.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    found = value;
  }
  return found;
}

/** Every `KEY=value` line of a group's file, quotes trimmed as `with-secrets` trims them. */
export function groupValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const at = line.indexOf("=");
    const key = at < 1 ? "" : line.slice(0, at).trim().replace(/^export\s+/, "");
    if (!new RegExp(SECRET_KEY_PATTERN).test(key)) continue;
    const value = groupValue(line, line.slice(0, at).trim());
    if (value) values[key] = value;
  }
  return values;
}

/** Whether a manifest's `secretGroups` (names, or `*` for any) lets it ask for `group` at run time. */
export function secretGroupAllowed(allowed: readonly string[] | undefined, group: string): boolean {
  return !!allowed && (allowed.includes("*") || allowed.includes(group));
}

/**
 * A whole group, asked for by name while a call runs (`secrets.group` over an extension's connection): every key, or
 * only `keys`. Read and checked as `readGroupSecret` reads one key; on macOS a group with no file reads each key its
 * `.keys` list names from the Keychain.
 */
export async function readGroupSecrets(
  group: string, who: string, keys?: readonly string[],
  keychain?: (service: string) => Promise<string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  if (!new RegExp(SECRET_GROUP_PATTERN).test(group)) throw new Error(`${who}: secret group ${group} isn't a with-secrets group name (${SECRET_GROUP_PATTERN})`);
  for (const key of keys ?? []) if (!new RegExp(SECRET_KEY_PATTERN).test(key)) throw new Error(`${who}: secret key ${key} isn't a variable name`);
  const directory = secretsDirectory(env);
  const path = join(directory, `${group}.env`);
  const file = Bun.file(path);
  let values: Record<string, string>;
  if (await file.exists()) {
    // One key read the way readGroupSecret reads it gives the same refusals (mode, size); then the whole file.
    const mode = (await file.stat().catch(() => null))?.mode;
    if (mode === undefined) throw new Error(`${who}: the secret group ${group} (${path}) can't be read`);
    if (mode & 0o077) throw new Error(`${who}: ${path} is mode ${(mode & 0o777).toString(8).padStart(3, "0")}; run: chmod 600 ${path}`);
    if (file.size > 64 * 1024) throw new Error(`${who}: ${path} is larger than 64 KiB; a group holds KEY=value lines`);
    values = groupValues(await file.text());
  } else {
    const list = Bun.file(join(directory, `${group}.keys`));
    if (!(process.platform === "darwin" && keychain && await list.exists())) {
      throw new Error(`${who}: no secret group ${group} on this machine (expected ${path}); add it: with-secrets --add ${group} <KEY>`);
    }
    const names = (await list.text()).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    values = {};
    for (const name of keys ?? names) {
      if (!names.includes(name)) continue;
      const value = await keychain(`with-secrets:${group}:${name}`);
      if (value) values[name] = value;
    }
  }
  if (keys) {
    const missing = keys.find((key) => !values[key]);
    if (missing) throw new Error(`${who}: ${missing} isn't set in the secret group ${group} (${path}); add it: with-secrets --add ${group} ${missing}`);
    values = Object.fromEntries(keys.map((key) => [key, values[key]!]));
  }
  if (!Object.keys(values).length) throw new Error(`${who}: the secret group ${group} (${path}) holds no KEY=value lines`);
  return values;
}

/**
 * The value of `key` in `group`. `keychain` reads one macOS Keychain item (the runtime passes its own command
 * runner), used only when the group has no `.env` file and has a `.keys` list naming the key.
 */
export async function readGroupSecret(
  group: string, key: string, who: string,
  keychain?: (service: string) => Promise<string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!new RegExp(SECRET_GROUP_PATTERN).test(group)) throw new Error(`${who}: secret group ${group} isn't a with-secrets group name (${SECRET_GROUP_PATTERN})`);
  if (!new RegExp(SECRET_KEY_PATTERN).test(key)) throw new Error(`${who}: secret key ${key} isn't a variable name`);
  const directory = secretsDirectory(env);
  const path = join(directory, `${group}.env`);
  const file = Bun.file(path);
  if (await file.exists()) {
    let mode: number;
    try {
      mode = (await file.stat()).mode;
    } catch {
      throw new Error(`${who}: the secret group ${group} (${path}) can't be read`);
    }
    if (mode & 0o077) throw new Error(`${who}: ${path} is mode ${(mode & 0o777).toString(8).padStart(3, "0")}; run: chmod 600 ${path}`);
    if (file.size > 64 * 1024) throw new Error(`${who}: ${path} is larger than 64 KiB; a group holds KEY=value lines`);
    const value = groupValue(await file.text(), key);
    if (!value) throw new Error(`${who}: ${key} isn't set in the secret group ${group} (${path}); add it: with-secrets --add ${group} ${key}`);
    return value;
  }
  const keys = Bun.file(join(directory, `${group}.keys`));
  if (process.platform === "darwin" && keychain && await keys.exists()) {
    const names = (await keys.text()).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (!names.includes(key)) throw new Error(`${who}: ${key} isn't listed in ${join(directory, `${group}.keys`)}`);
    const value = await keychain(`with-secrets:${group}:${key}`);
    if (!value) throw new Error(`${who}: no Keychain item with-secrets:${group}:${key}`);
    return value;
  }
  throw new Error(`${who}: no secret group ${group} on this machine (expected ${path}); add it: with-secrets --add ${group} ${key}`);
}
