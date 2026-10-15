// `ep0ch keys` (PIE-887): which secrets exist on this machine and who may have each one, never a value.
//
//   keys list [--json]                       every group's keys: where, mode, scope, which extensions name it
//   keys check <KEY> [--group <g>] [--json]  present and readable or not; exit 1 when not (for scripts)
//   keys who <KEY> [--group <g>]             who may receive it: its scopes and the extensions that name it
//   keys set <group> <KEY>                   the person's: prompts for the value (with-secrets --add)
//   keys grant <group>[/<KEY>] <scope> [--outline <name>]   the person's: who may have it (machine, outline:<name>, ext:<id>)
//   keys revoke <group>[/<KEY>] [<scope>]                   the person's: take a scope away (none left: machine)
//
// The store is `with-secrets`' (`~/.config/secrets`, `WITH_SECRETS_DIR`); a value is read only into a process, by the
// service or by `with-secrets`. Nothing here reads one out. `set`, `grant` and `revoke` need a terminal: they are the
// person's, an agent runs `list`, `check` and `who`.
import { parseArgs } from "node:util";
import { keyRows, readScopes, scopesFor, scopesPath, writeScopes, checkScope, type KeyRow } from "./secret-keys";
import { secretsDirectory } from "./extension-secrets";
import { serviceClient } from "./extension-install";
import type { ExtensionsListResult } from "./extension-registry";

export const KEYS_USAGE = `usage: ep0ch keys list [--json] | check <KEY> [--group <g>] [--json] | who <KEY> [--group <g>] | set <group> <KEY> | grant <group>[/<KEY>] <scope> [--outline <name>] | revoke <group>[/<KEY>] [<scope>]
  Names, places and modes only; a value is never printed. A key is a with-secrets group's variable (~/.config/secrets/<group>.env).
  scope: machine (any extension that names it, the default), outline:<name>, ext:<id> or ext:<id>@<outline>.
  set, grant and revoke are the person's and need a terminal; a missing key: ep0ch keys set <group> <KEY>.`;

const out = (line = "") => console.log(line);

/** Which extensions of this outline name each group/key, from the service when one answers here. */
async function usedBy(): Promise<{ users: Map<string, string[]> | null }> {
  const client = await serviceClient();
  if (!client) return { users: null };
  try {
    const list = await client.request<ExtensionsListResult>({ action: "extensions.list" });
    const users = new Map<string, string[]>();
    for (const entry of list.extensions) for (const key of entry.keys ?? []) {
      const name = `${key.group}/${key.key}`;
      users.set(name, [...(users.get(name) ?? []), entry.id]);
    }
    return { users };
  } catch { return { users: null }; }
}

const table = (rows: readonly (readonly string[])[]): string[] => {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows.map((row) => row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column]!)).join("  ").trimEnd());
};

const describe = (row: KeyRow, users: Map<string, string[]> | null): string[] => [
  `${row.group}/${row.key}`, row.state === "present" ? (row.source === "keychain" ? "Keychain" : `${row.where} ${row.mode ?? ""}`.trim()) : `${row.state}${row.problem ? `: ${row.problem}` : ""}`,
  `scope ${row.scopes.join(", ")}`, users ? `used by: ${users.get(`${row.group}/${row.key}`)?.join(", ") ?? "(none)"}` : "used by: (no outline service answers here)",
];

export async function runKeysCommand(args: readonly string[]): Promise<number> {
  const [operation, ...rest] = args;
  try {
    if (operation === "list" || operation === "ls") {
      const { values } = parseArgs({ args: [...rest], allowPositionals: false, strict: true, options: { json: { type: "boolean" } } });
      const rows = keyRows(), { users } = await usedBy();
      if (values.json) { out(JSON.stringify({ directory: secretsDirectory(), scopes: scopesPath(), keys: rows.map((row) => ({ ...row, usedBy: users?.get(`${row.group}/${row.key}`) ?? null })) }, null, 2)); return 0; }
      if (!rows.length) { out(`no keys: ${secretsDirectory()} holds no with-secrets group. Add one (the person's): ep0ch keys set <group> <KEY>`); return 0; }
      for (const line of table(rows.map((row) => describe(row, users)))) out(line);
      out(); out("A value is never printed. Name a fixed key in an extension's manifest `secrets`, a run-time group in `secretGroups`; who may have one: ep0ch keys who <KEY>.");
      return 0;
    }
    if (operation === "check" || operation === "who") {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, strict: true, options: { group: { type: "string" }, json: { type: "boolean" } } });
      const [key, ...extra] = positionals;
      if (!key || extra.length) throw new Error(KEYS_USAGE);
      const found = keyRows().filter((row) => row.key === key && (values.group === undefined || row.group === values.group));
      if (operation === "check") {
        const ok = found.some((row) => row.state === "present");
        if (values.json) out(JSON.stringify({ key, present: ok, where: found.map((row) => ({ group: row.group, state: row.state, where: row.where, ...(row.problem ? { problem: row.problem } : {}) })) }));
        else if (!found.length) out(`${key}: not in any group on this machine (${secretsDirectory()}). The person adds it: ep0ch keys set <group> ${key}`);
        else for (const row of found) out(`${row.group}/${key}: ${row.state}${row.problem ? ` (${row.problem})` : ` in ${row.where}`}`);
        return ok ? 0 : 1;
      }
      const { users } = await usedBy();
      if (!found.length) { out(`${key}: not in any group on this machine; nobody can receive it. The person adds it: ep0ch keys set <group> ${key}`); return 1; }
      for (const row of found) {
        out(`${row.group}/${key}: scope ${row.scopes.join(", ")}`);
        out(`  extensions that name it: ${users ? users.get(`${row.group}/${key}`)?.join(", ") ?? "(none)" : "(no outline service answers here)"}`);
      }
      return 0;
    }
    if (operation === "set" || operation === "grant" || operation === "revoke") {
      if (process.stdin.isTTY !== true) throw new Error(`keys ${operation} is the person's: run it in a terminal (an agent asks them to: ep0ch keys ${operation} …)`);
    }
    if (operation === "set") {
      const [group, key, ...extra] = rest;
      if (!group || !key || extra.length) throw new Error(KEYS_USAGE);
      const run = Bun.spawn(["with-secrets", "--add", group, key], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
      return await run.exited;
    }
    if (operation === "grant" || operation === "revoke") {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, strict: true, options: { outline: { type: "string" } } });
      const [name, scopeArg, ...extra] = positionals;
      if (!name || extra.length || (operation === "grant" && !scopeArg)) throw new Error(KEYS_USAGE);
      const [group, key] = name.split("/") as [string, string | undefined];
      const scope = scopeArg && values.outline && /^ext:[^@]+$/.test(scopeArg) ? `${scopeArg}@${values.outline}` : scopeArg;
      if (scope) { const bad = checkScope(scope); if (bad) throw new Error(bad); }
      const current = scopesFor(readScopes(), group, key ?? "");
      const explicit = readScopes()[key ? `${group}/${key}` : group];
      if (operation === "grant") {
        // A first grant narrows the key from machine to this scope alone; `machine` restores the default.
        writeScopes(group, key ?? null, scope === "machine" ? [] : [...(explicit ?? []).filter((candidate) => candidate !== "machine"), scope!]);
        out(`${name}: scope ${scope === "machine" ? "machine" : [...new Set([...(explicit ?? []).filter((candidate) => candidate !== "machine"), scope!])].join(", ")}`);
      } else {
        const left = scope ? (explicit ?? current).filter((candidate) => candidate !== scope) : [];
        writeScopes(group, key ?? null, left);
        out(`${name}: scope ${left.length ? left.join(", ") : "machine"}`);
      }
      return 0;
    }
    throw new Error(KEYS_USAGE);
  } catch (error) {
    console.error(`ep0ch keys: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
