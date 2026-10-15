// Which keys exist here, and who may have each one (PIE-887): `ep0ch keys`, the Extensions page's key lines and the check
// the service makes before it hands an extension a secret. Everything here is names, places and modes; no function in
// this file returns, logs or puts in an error a value. A key is a `with-secrets` group's `KEY` (`<group>.env`, or on
// macOS the Keychain items its `<group>.keys` names: extension-secrets.ts).
//
// Scopes live beside the store, not in it: `<secrets folder>/scopes.json` maps `group/KEY` (or `group`, every key in it)
// to who may receive it. A key with no entry is `machine`: any extension that names it, as before. An entry lists scopes:
// `machine`, `outline:<name>` (extensions of that outline) and `ext:<id>` (that extension, in any outline) or
// `ext:<id>@<outline>`. The person grants and revokes (`ep0ch keys grant|revoke`); the service only reads it.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { groupValue, SECRET_GROUP_PATTERN, SECRET_KEY_PATTERN, secretsDirectory } from "./extension-secrets";

export type KeyState = "present" | "missing" | "unreadable" | "no group";

export interface KeyRow {
  group: string;
  key: string;
  /** Where it lives: the group's file, or "Keychain" for a macOS group read from it. */
  where: string;
  source: "file" | "keychain";
  /** The file's mode, as `600`; absent for the Keychain. */
  mode?: string;
  state: KeyState;
  /** Why it can't be read (a mode others can read), with the command; never a value. */
  problem?: string;
  scopes: string[];
}

const groupName = new RegExp(SECRET_GROUP_PATTERN), keyName = new RegExp(SECRET_KEY_PATTERN);

const groupsIn = (directory: string): { group: string; file: string; source: "file" | "keychain" }[] => {
  let names: string[] = [];
  try { names = readdirSync(directory); } catch { return []; }
  const files = names.filter((name) => name.endsWith(".env")).map((name) => ({ group: name.slice(0, -4), file: join(directory, name), source: "file" as const }));
  const taken = new Set(files.map((entry) => entry.group));
  const keychain = names.filter((name) => name.endsWith(".keys") && !taken.has(name.slice(0, -5)))
    .map((name) => ({ group: name.slice(0, -5), file: join(directory, name), source: "keychain" as const }));
  return [...files, ...keychain].filter((entry) => groupName.test(entry.group)).sort((a, b) => a.group.localeCompare(b.group));
};

/** The variable names a group's file lists (`KEY=…` lines or the `.keys` names), and whether each has a value there. */
function namesIn(path: string, source: "file" | "keychain"): { key: string; set: boolean }[] {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return []; }
  const out: { key: string; set: boolean }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (source === "keychain") {
      const key = line.trim();
      if (keyName.test(key)) out.push({ key, set: true });
      continue;
    }
    const at = line.indexOf("=");
    const key = at < 1 ? "" : line.slice(0, at).trim().replace(/^export\s+/, "");
    if (keyName.test(key) && !out.some((entry) => entry.key === key)) out.push({ key, set: !!groupValue(line, line.slice(0, at).trim()) });
  }
  return out;
}

const modeOf = (path: string): number | undefined => { try { return statSync(path).mode & 0o777; } catch { return undefined; } };
const octal = (mode: number) => mode.toString(8).padStart(3, "0");

// ── scopes ──────────────────────────────────────────────────────────────────────────────────

export const scopesPath = (env: NodeJS.ProcessEnv = process.env) => join(secretsDirectory(env), "scopes.json");

/** The grants file: `group/KEY` (or `group`) to its scopes. A file that can't be read or parsed grants nothing extra (machine). */
export function readScopes(env: NodeJS.ProcessEnv = process.env): Record<string, string[]> {
  try {
    const parsed = JSON.parse(readFileSync(scopesPath(env), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => Array.isArray(value) && value.every((scope) => typeof scope === "string"))
      .map(([name, value]) => [name, value as string[]]));
  } catch { return {}; }
}

/** A scope as written, or why it isn't one. */
export function checkScope(scope: string): string | null {
  if (scope === "machine") return null;
  const outline = /^outline:([A-Za-z0-9._-]+)$/.exec(scope);
  if (outline) return null;
  const ext = /^ext:([a-z0-9._-]+)(?:@([A-Za-z0-9._-]+))?$/.exec(scope);
  return ext ? null : `${scope} isn't a scope: machine, outline:<name>, ext:<id> or ext:<id>@<outline>`;
}

/** The scopes that apply to `group/key`: its own entry, else its group's, else machine. */
export function scopesFor(scopes: Record<string, string[]>, group: string, key: string): string[] {
  return scopes[`${group}/${key}`] ?? scopes[group] ?? ["machine"];
}

/** Who is asking for a key: an extension (its id), running in an outline (its name, when the host has one). */
export interface KeyAsker { extension: string; outline?: string }

/** Whether `asker` may receive a key with these scopes. */
export function scopeAllows(granted: readonly string[], asker: KeyAsker): boolean {
  return granted.some((scope) => {
    if (scope === "machine") return true;
    if (scope.startsWith("outline:")) return !!asker.outline && scope === `outline:${asker.outline}`;
    const match = /^ext:([^@]+)(?:@(.+))?$/.exec(scope);
    return !!match && match[1] === asker.extension && (match[2] === undefined || match[2] === asker.outline);
  });
}

/** Why `asker` may not have `group/key`, with the command that grants it; null when it may. */
export function scopeProblem(group: string, key: string, asker: KeyAsker, env: NodeJS.ProcessEnv = process.env): string | null {
  const granted = scopesFor(readScopes(env), group, key);
  if (scopeAllows(granted, asker)) return null;
  const who = `ext:${asker.extension}${asker.outline ? `@${asker.outline}` : ""}`;
  return `${key} in ${group} is scoped to ${granted.join(", ")}, not ${asker.extension}${asker.outline ? ` in ${asker.outline}` : ""}; the person grants it: ep0ch keys grant ${group}/${key} ${who}`;
}

/** Write one key's scopes (an empty list removes the entry: back to machine). Atomic, mode 600. */
export function writeScopes(group: string, key: string | null, scopes: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  if (!groupName.test(group)) throw new Error(`${group} isn't a with-secrets group name (${SECRET_GROUP_PATTERN})`);
  if (key !== null && !keyName.test(key)) throw new Error(`${key} isn't a variable name`);
  for (const scope of scopes) { const bad = checkScope(scope); if (bad) throw new Error(bad); }
  const all = readScopes(env), name = key === null ? group : `${group}/${key}`;
  if (scopes.length) all[name] = [...new Set(scopes)]; else delete all[name];
  const path = scopesPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

// ── what exists ─────────────────────────────────────────────────────────────────────────────

/** Every key of every group on this machine: names, places, modes, scopes; never a value. */
export function keyRows(env: NodeJS.ProcessEnv = process.env): KeyRow[] {
  const directory = secretsDirectory(env), scopes = readScopes(env), rows: KeyRow[] = [];
  for (const { group, file, source } of groupsIn(directory)) {
    const mode = source === "file" ? modeOf(file) : undefined;
    const readable = mode === undefined || (mode & 0o077) === 0;
    for (const { key, set } of namesIn(file, source)) {
      rows.push({
        group, key, source, where: source === "file" ? file : "Keychain", ...(mode !== undefined ? { mode: octal(mode) } : {}),
        state: !readable ? "unreadable" : set ? "present" : "missing",
        ...(!readable ? { problem: `${file} is mode ${octal(mode!)}; run: chmod 600 ${file}` } : {}),
        scopes: scopesFor(scopes, group, key),
      });
    }
  }
  return rows;
}

/** One named key's state in one group: present, missing from a group that exists, unreadable, or no such group. */
export function keyState(group: string, key: string, env: NodeJS.ProcessEnv = process.env): { state: KeyState; problem?: string } {
  const row = keyRows(env).find((candidate) => candidate.group === group && candidate.key === key);
  if (row) return { state: row.state, ...(row.problem ? { problem: row.problem } : {}) };
  const exists = groupsIn(secretsDirectory(env)).some((entry) => entry.group === group);
  return { state: exists ? "missing" : "no group" };
}

/** What a manifest names, as the page and `ext ls` say it: each fixed key with where and whether it is there. */
export interface ExtensionKeyLine { name: string; group: string; key: string; state: KeyState; allowed: boolean; scopes: string[]; problem?: string }

export function extensionKeyLines(
  extension: { id: string; credentials: Record<string, unknown> },
  outline: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ExtensionKeyLine[] {
  const scopes = readScopes(env), lines: ExtensionKeyLine[] = [];
  for (const [name, reference] of Object.entries(extension.credentials)) {
    const ref = reference as { group?: string; key?: string };
    if (typeof ref?.group !== "string" || typeof ref.key !== "string") continue;
    const state = keyState(ref.group, ref.key, env), granted = scopesFor(scopes, ref.group, ref.key);
    lines.push({
      name, group: ref.group, key: ref.key, state: state.state, scopes: granted,
      allowed: scopeAllows(granted, { extension: extension.id, ...(outline ? { outline } : {}) }),
      ...(state.problem ? { problem: state.problem } : {}),
    });
  }
  return lines;
}

/** The line a key gets on a page or in `ext ls --long`: names and words only. */
export function keyLineWords(line: ExtensionKeyLine): string {
  const state = !line.allowed ? `not allowed (scoped to ${line.scopes.join(", ")})`
    : line.state === "present" ? "present"
    : line.state === "missing" ? "missing"
    : line.state === "unreadable" ? `unreadable${line.problem ? ` (${line.problem})` : ""}`
    : `missing (no group ${line.group})`;
  const fix = line.state === "present" || !line.allowed ? "" : ` · ep0ch keys set ${line.group} ${line.key}`;
  return `${line.group}/${line.key} ${state}${fix}`;
}

