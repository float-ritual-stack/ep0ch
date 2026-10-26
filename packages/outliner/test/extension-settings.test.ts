// An extension's settings (PIE-1343): `extensions.list` says each one's state from its configSchema (set, default and
// what the default does, missing, failing) and where its config.json is; `extensions.configure` checks a change against
// the schema, writes the file and reloads, so the next call uses it. Scratch services in temp folders; everything made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionSettings, ExtensionsConfigured } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { ResourceProjectionReadResult } from "../src/resource-projection";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-ext-settings-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const extensions = join(outline, "extensions");
  mkdirSync(extensions, { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 60 });
  await server.start();
  const client = new OutlinerClient(socket);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const settings = async (id: string) =>
    (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find((e) => e.id === id)?.settings as ExtensionSettings | undefined;
  const configure = (extension: string, change: Record<string, unknown>) =>
    client.request<ExtensionsConfigured>({ action: "extensions.configure", extension, ...change, mutation: { author: "user" } });
  return { root, extensions, store, client, settings, configure };
}

test("tidy's settings say its default, and an answer set in them is what the next @tidy runs", async () => {
  const { extensions, client, store, settings, configure } = await setup();
  await client.request({ action: "extensions.install", extension: "tidy", where: "outline" });
  const file = join(extensions, "tidy", "config.json");
  const before = await settings("tidy");
  expect(before).toMatchObject({ file, exists: false, state: "default" });
  expect(before!.fields).toEqual([expect.objectContaining({ name: "answer", type: "command", state: "default", default: ["claude", "-p", "--model", "haiku", "--tools", ""] })]);

  // A value the schema refuses is refused with its words, and nothing is written.
  await expect(configure("tidy", { config: { answer: "claude -p" } })).rejects.toThrow(/Tidy's settings don't match its config schema: .*answer/);
  await expect(configure("tidy", { config: { model: "sonnet" } })).rejects.toThrow(/field it doesn't know: model/);
  expect(existsSync(file)).toBe(false);

  const answer = ["bun", "-e", `await Bun.stdin.text(); console.log(JSON.stringify({ replacement: "- [ ] water the beans", message: "made it a task" }));`];
  const done = await configure("tidy", { config: { answer } });
  expect(done.settings).toMatchObject({ state: "set", exists: true });
  expect(done.settings.fields[0]).toMatchObject({ state: "set", value: answer });
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ config: { answer } });

  const note = await client.request<Block>({ action: "create", text: "Garden\nwater the beans\n@tidy make it a task" });
  await until("@tidy ran the configured answer", () => store.get(note.id)!.text.includes("- [ ] water the beans"));
  const read = await client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId: note.id });
  expect(read.projections.find((p) => p.kind === "agent")?.summary).toBe("made it a task");

  // An empty answer was set back: the default again.
  const back = await configure("tidy", { config: {} });
  expect(back.settings).toMatchObject({ state: "default" });

  // Uninstalling takes config.json with the folder: nothing stray is left.
  await client.request({ action: "extensions.uninstall", extension: "tidy", demo: "remove" });
  expect(existsSync(join(extensions, "tidy"))).toBe(false);
});

test("a failing call says so with its error until config.json changes", async () => {
  const { extensions, client, store, settings, configure } = await setup();
  cpSync(join(import.meta.dir, "..", "extensions", "tidy"), join(extensions, "tidy"), { recursive: true });
  writeFileSync(join(extensions, "tidy", "config.json"), JSON.stringify({ config: { answer: ["bun", "-e", "process.exit(3)"] } }));
  await settings("tidy");
  const note = await client.request<Block>({ action: "create", text: "Garden\nwater the beans\n@tidy make it a task" });
  await until("the failed ask", () => store.agentRequests(note.id)[0]?.answeredAt);
  const failing = await settings("tidy");
  expect(failing).toMatchObject({ state: "failing" });
  expect(failing!.error).toContain("answer command exited 3");
  expect(failing!.error).toContain("ext.tidy.settings");
  await Bun.sleep(5); // a later mtime than the failed call
  const fixed = await configure("tidy", { config: { answer: ["bun", "-e", "console.log('{}')"] } });
  expect(fixed.settings.state).toBe("set");
});

test("settings name a missing value and secret, keep enabled and sources, take secrets only as references, and fix a config.json that doesn't load", async () => {
  const { extensions, settings, configure } = await setup();
  const folder = join(extensions, "almanack");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "extension.json"), JSON.stringify({
    contract: 2, id: "almanack", version: 1, name: "Almanack", run: ["bun", "main.ts"],
    actions: [{ id: "forecast", label: "Forecast", on: "block", effects: "read" }],
    configSchema: { type: "object", properties: {
      email: { type: "string", description: "who the frost warnings go to" },
      days: { type: "integer", minimum: 1, maximum: 14, default: 3, description: "how far ahead" },
      units: { type: "string", enum: ["metric", "imperial"] },
    }, required: ["email"], additionalProperties: false },
    secrets: { token: "the weather service's token" },
  }));
  writeFileSync(join(folder, "main.ts"), "process.stdout.write('{\"ok\":true,\"value\":{}}');");
  writeFileSync(join(folder, "config.json"), JSON.stringify({ config: { email: 7 }, enabled: true, sources: [{ origin: "https://weather.example", project: "FROST" }] }));

  // config.json doesn't match the schema: it never loaded, and its settings say why, from the folder as it is.
  const broken = await settings("almanack");
  expect(broken).toMatchObject({ state: "failing" });
  expect(broken!.error).toContain("config.json");

  await expect(configure("almanack", { secrets: { token: "hunter2-not-a-reference" } })).rejects.toThrow(/reference/);
  await expect(configure("almanack", { secrets: { password: { env: "X" } } })).rejects.toThrow(/declares no secret password/);
  await expect(configure("almanack", { config: { email: "frost@example.com", days: 40 } })).rejects.toThrow(/days/);

  const saved = await configure("almanack", { config: { email: "frost@example.com" }, secrets: { token: { env: "ALMANACK_TEST_TOKEN_UNSET" } } });
  expect(saved.state).toBe("active");
  expect(saved.settings.fields.map((f) => [f.name, f.state])).toEqual([["email", "set"], ["days", "default"], ["units", "unset"]]);
  expect(saved.settings.fields.find((f) => f.name === "units")?.choices).toEqual(["metric", "imperial"]);
  // The token's reference points at nothing on this host: missing, by name, never a value.
  expect(saved.settings.secrets).toEqual([{ name: "token", description: "the weather service's token", reference: "env ALMANACK_TEST_TOKEN_UNSET", state: "missing" }]);
  expect(saved.settings.state).toBe("missing");
  expect(JSON.parse(readFileSync(join(folder, "config.json"), "utf8"))).toEqual({
    config: { email: "frost@example.com" }, enabled: true, sources: [{ origin: "https://weather.example", project: "FROST" }],
    secrets: { token: { env: "ALMANACK_TEST_TOKEN_UNSET" } },
  });

  // Taking the reference out leaves the rest.
  const unset = await configure("almanack", { secrets: { token: null } });
  expect(unset.settings.secrets[0]).toMatchObject({ state: "missing" });
  expect(unset.settings.secrets[0]!.reference).toBeUndefined();
  expect(JSON.parse(readFileSync(join(folder, "config.json"), "utf8")).secrets).toBeUndefined();
});
