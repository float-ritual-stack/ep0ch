// The scratch service the script tests share (script-site.test.ts, scripts-docs.test.ts): a store and server in a temp
// folder, a client, and `run` to start a script by name as a person would. Every note and name is made up.
import { afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

export async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

export async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-script-site-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  // Watch the extension folders themselves so SQLite writes cannot masquerade as source changes.
  for (const folder of ["user-extensions", "outline/extensions", "outline/.ep0ch/scripts", "outline/scripts"])
    mkdirSync(join(root, folder), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: join(root, "outline") });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80, ruleQuietMs: 20 });
  await server.start();
  const client = new OutlinerClient(socket, 15_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parent: string | null = null) => store.create(text, parent, "user");
  const extensionOf = async (name: string) => (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find(e => e.name === name)!;
  /** Runs a script by name, as a person would, with the note it is about and its slots. */
  const run = async (name: string, options: { blockId?: string; args?: Record<string, string>; line?: number } = {}) => {
    const script = store.queryBlocks({ where: `script=${name}` }).blocks[0]!;
    const source = store.require(script.id);
    if (!source.properties.some(p => p.key === "results" && p.value === "keep"))
      store.update(source.id, source.text.replace("\n", " [results::keep]\n"), source.revision, { author: "user" });
    const extension = await extensionOf(name);
    const started = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", ...options });
    const note = () => store.get(started.written[0]!)!.text;
    await until(`${name} to finish`, () => !note().split("\n")[0]!.includes("· working"));
    return { text: note(), undo: started.undo, extension };
  };
  const output = (blockId: string) => store.extensionOutputs(blockId).map(row => (row.result as { markdown?: string } | null)?.markdown ?? row.error);
  /** Draws a note's lines: the script sources are loaded first, so a line is never asked before its script exists (a load-dependent race otherwise). */
  const draw = async (blockId: string) => {
    await client.request({ action: "extensions.list", reload: true });
    await client.request({ action: "resources.projection.read", blockId, materialize: true });
  };
  return { store, server, client, create, extensionOf, run, output, draw };
}

