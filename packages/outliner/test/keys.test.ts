// PIE-887: `ep0ch keys` and the scopes a key is granted with. Every value here is made up and lives in a scratch
// WITH_SECRETS_DIR; every test also checks that no command, line or error says one.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEYS_USAGE, runKeysCommand } from "../src/keys-cli";
import { checkScope, extensionKeyLines, keyLineWords, keyRows, scopeAllows, scopeProblem, scopesFor, writeScopes } from "../src/secret-keys";

const VALUE = "made-up-value-77", OTHER = "another-made-up-9";
let dir = "", previous: string | undefined;
const say: string[] = [];
const realLog = console.log, realError = console.error;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "outliner-keys-")));
  previous = process.env.WITH_SECRETS_DIR;
  process.env.WITH_SECRETS_DIR = dir;
  writeFileSync(join(dir, "typesafe.env"), `TYPESAFE_API_KEY=${VALUE}\nJEV_API_KEY="${OTHER}"\nEMPTY_ONE=\n`, { mode: 0o600 });
  writeFileSync(join(dir, "loose.env"), `LOOSE_KEY=${OTHER}\n`);
  chmodSync(join(dir, "loose.env"), 0o644);
  say.length = 0;
  console.log = (...a: unknown[]) => { say.push(a.join(" ")); };
  console.error = (...a: unknown[]) => { say.push(a.join(" ")); };
});
afterEach(() => {
  console.log = realLog; console.error = realError;
  if (previous === undefined) delete process.env.WITH_SECRETS_DIR; else process.env.WITH_SECRETS_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});
const said = () => say.join("\n");

test("list names every group's keys with where, mode and scope, and never a value", async () => {
  expect(await runKeysCommand(["list"])).toBe(0);
  const text = said();
  expect(text).toMatch(new RegExp(`typesafe/TYPESAFE_API_KEY\\s+${join(dir, "typesafe.env")} 600\\s+scope machine`));
  expect(text).toContain("typesafe/JEV_API_KEY");
  expect(text).toMatch(/typesafe\/EMPTY_ONE\s+missing/);
  expect(text).toMatch(new RegExp(`loose/LOOSE_KEY\\s+unreadable: ${join(dir, "loose.env")} is mode 644; run: chmod 600 ${join(dir, "loose.env")}`));
  expect(text).not.toContain(VALUE);
  expect(text).not.toContain(OTHER);
  say.length = 0;
  await runKeysCommand(["list", "--json"]);
  const json = JSON.parse(said());
  expect(json.keys.find((k: any) => k.key === "TYPESAFE_API_KEY")).toMatchObject({ group: "typesafe", mode: "600", state: "present", scopes: ["machine"] });
  expect(said()).not.toContain(VALUE);
});

test("check exits 0 when a key is present and readable, 1 when it is missing, empty, unreadable or in no group; no output holds a value", async () => {
  expect(await runKeysCommand(["check", "TYPESAFE_API_KEY"])).toBe(0);
  expect(said()).toBe(`typesafe/TYPESAFE_API_KEY: present in ${join(dir, "typesafe.env")}`);
  expect(await runKeysCommand(["check", "NOWHERE_KEY"])).toBe(1);
  expect(said()).toContain("NOWHERE_KEY: not in any group on this machine");
  expect(said()).toContain("ep0ch keys set <group> NOWHERE_KEY");
  expect(await runKeysCommand(["check", "EMPTY_ONE"])).toBe(1);
  expect(await runKeysCommand(["check", "LOOSE_KEY"])).toBe(1);
  expect(await runKeysCommand(["check", "TYPESAFE_API_KEY", "--group", "loose"])).toBe(1);
  expect(await runKeysCommand(["check", "TYPESAFE_API_KEY", "--json"])).toBe(0);
  expect(JSON.parse(say.at(-1)!)).toMatchObject({ key: "TYPESAFE_API_KEY", present: true });
  expect(said()).not.toContain(VALUE);
  expect(said()).not.toContain(OTHER);
});

test("set, grant and revoke are the person's: refused without a terminal, nothing written", async () => {
  expect(await runKeysCommand(["grant", "typesafe/TYPESAFE_API_KEY", "ext:requests"])).toBe(1);
  expect(said()).toContain("keys grant is the person's: run it in a terminal");
  expect(await runKeysCommand(["set", "typesafe", "NEW_KEY"])).toBe(1);
  expect(said()).toContain("keys set is the person's");
  expect(() => readFileSync(join(dir, "scopes.json"))).toThrow();
  expect(await runKeysCommand(["nonsense"])).toBe(1);
  expect(said()).toContain(KEYS_USAGE.split("\n")[0]);
});

test("a key with no entry is machine's; a scoped one goes only to who it names; the file is mode 600 and holds no value", () => {
  writeScopes("typesafe", "TYPESAFE_API_KEY", ["ext:requests@gurgle"]);
  expect(statSync(join(dir, "scopes.json")).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(dir, "scopes.json"), "utf8")).not.toContain(VALUE);
  const scopes = JSON.parse(readFileSync(join(dir, "scopes.json"), "utf8"));
  expect(scopesFor(scopes, "typesafe", "TYPESAFE_API_KEY")).toEqual(["ext:requests@gurgle"]);
  expect(scopesFor(scopes, "typesafe", "JEV_API_KEY")).toEqual(["machine"]);
  const asker = (extension: string, outline?: string) => ({ extension, ...(outline ? { outline } : {}) });
  expect(scopeProblem("typesafe", "TYPESAFE_API_KEY", asker("requests", "gurgle"))).toBeNull();
  expect(scopeProblem("typesafe", "TYPESAFE_API_KEY", asker("requests", "pie"))).toContain("is scoped to ext:requests@gurgle, not requests in pie");
  expect(scopeProblem("typesafe", "TYPESAFE_API_KEY", asker("requests", "pie"))).toContain("ep0ch keys grant typesafe/TYPESAFE_API_KEY ext:requests@pie");
  expect(scopeProblem("typesafe", "TYPESAFE_API_KEY", asker("other", "gurgle"))).not.toBeNull();
  expect(scopeProblem("typesafe", "JEV_API_KEY", asker("anyone"))).toBeNull();
  // A group-wide entry covers the keys without their own; outline: and ext: alone; machine in the list opens it.
  writeScopes("typesafe", null, ["outline:gurgle"]);
  expect(scopeAllows(scopesFor(readJson(), "typesafe", "JEV_API_KEY"), asker("x", "gurgle"))).toBe(true);
  expect(scopeAllows(scopesFor(readJson(), "typesafe", "JEV_API_KEY"), asker("x", "pie"))).toBe(false);
  expect(scopeAllows(["ext:requests"], asker("requests", "anything"))).toBe(true);
  expect(scopeAllows(["machine", "ext:requests"], asker("someone"))).toBe(true);
  // An empty list is machine again.
  writeScopes("typesafe", "TYPESAFE_API_KEY", []);
  expect(scopesFor(readJson(), "typesafe", "TYPESAFE_API_KEY")).toEqual(["outline:gurgle"]);
  expect(checkScope("ext:requests@gurgle")).toBeNull();
  expect(checkScope("somebody")).toContain("isn't a scope");
  expect(() => writeScopes("typesafe", "X", ["nonsense"])).toThrow("isn't a scope");
});
const readJson = () => JSON.parse(readFileSync(join(dir, "scopes.json"), "utf8")) as Record<string, string[]>;

test("an extension's keys read as lines: present, missing, not allowed; names and words only", () => {
  const ext = { id: "requests", credentials: { jev: { group: "typesafe", key: "JEV_API_KEY" }, gone: { group: "typesafe", key: "NOT_THERE" }, nogroup: { group: "ghost", key: "G" }, plain: { env: "X" } } };
  const lines = extensionKeyLines(ext, "gurgle");
  expect(lines.map(keyLineWords)).toEqual([
    "typesafe/JEV_API_KEY present",
    "typesafe/NOT_THERE missing · ep0ch keys set typesafe NOT_THERE",
    "ghost/G missing (no group ghost) · ep0ch keys set ghost G",
  ]);
  writeScopes("typesafe", "JEV_API_KEY", ["ext:other"]);
  expect(keyLineWords(extensionKeyLines(ext, "gurgle")[0]!)).toBe("typesafe/JEV_API_KEY not allowed (scoped to ext:other)");
  expect(keyRows().find((row) => row.key === "JEV_API_KEY")!.scopes).toEqual(["ext:other"]);
  expect(JSON.stringify([lines, keyRows()])).not.toContain(VALUE);
});

test("a scopes file that is there but broken hands a key to nobody; grant rewrites it", () => {
  const asker = { extension: "requests", outline: "gurgle" };
  writeFileSync(join(dir, "scopes.json"), "{ not json");
  expect(scopeProblem("typesafe", "JEV_API_KEY", asker)).toContain("isn't valid JSON, so JEV_API_KEY in typesafe goes to no extension");
  writeFileSync(join(dir, "scopes.json"), JSON.stringify({ "typesafe/JEV_API_KEY": ["somebody"] }));
  expect(scopeProblem("typesafe", "JEV_API_KEY", asker)).toContain("typesafe/JEV_API_KEY isn't a list of scopes");
  writeFileSync(join(dir, "scopes.json"), JSON.stringify(["machine"]));
  expect(scopeProblem("typesafe", "JEV_API_KEY", asker)).toContain("isn't an object of scopes");
  // No file at all is the default, machine's.
  rmSync(join(dir, "scopes.json"));
  expect(scopeProblem("typesafe", "JEV_API_KEY", asker)).toBeNull();
  // Writing a scope replaces a broken file with a good one.
  writeFileSync(join(dir, "scopes.json"), "{ not json");
  writeScopes("typesafe", "JEV_API_KEY", ["machine"]);
  expect(scopeProblem("typesafe", "JEV_API_KEY", asker)).toBeNull();
});
