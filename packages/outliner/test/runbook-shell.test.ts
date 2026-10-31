import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "shell-lines-")), folder = join(root, "outline"), socket = join(root, "host.sock");
  mkdirSync(folder);
  const keys = ["OUTLINER_EXTENSIONS_DIR", "OUTLINER_RESOURCE_EXTENSIONS"] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-registry.json");
  const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: folder });
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  await server.start();
  const client = new OutlinerClient(socket);
  cleanups.push(async () => {
    await server.close(); store.close();
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    rmSync(root, { recursive: true, force: true });
  });
  await client.request({ action: "extensions.install", extension: "runbook", where: "outline" });
  const create = (text: string, parentId: string | null = null) => client.request<Block>({ action: "create", text, parentId, author: "user" });
  const run = (note: Block, shell = "sh") => client.request({ action: "extensions.act", extension: "runbook", extensionAction: `run-${shell}`, blockId: note.id, line: 2, mutation: { author: "agent", actorId: "garden-helper" } });
  const body = (note: Block) => findOutputRegions(store.require(note.id).text)[0]?.body;
  return { root, folder, store, client, create, run, body };
}

test("installed shell lines use Site cwd, script stages, capped output, live hints, and keep their results after uninstall", async () => {
  const { root, folder, store, client, create, run, body } = await setup();
  const parent = await create(`Garden [cwd::${root}]`);
  writeFileSync(join(root, "beds.md"), "Garden beds\n");
  const note = await create("Files\n\nsh:: ls *.md | as files", parent.id);
  await run(note);
  expect(body(note)).toBe(`- [file::${join(root, "beds.md")}]`);
  const record = store.children(note.id).find(b => b.text.includes("[type::run]"))!;
  expect(record).toMatchObject({ author: "agent", actorId: "ext:runbook" });
  expect(record.text).toContain("[run.by::garden-helper]");
  expect(record.text).toContain(`[run.cwd::${root}]`);
  const defaultCwd = await create("Folder\n\nsh:: pwd");
  await run(defaultCwd);
  expect(body(defaultCwd)).toBe(folder);
  const pipes = await create("Pipes\n\nsh:: printf 'a | as list\\n' | tr a-z A-Z | as list | as code");
  await run(pipes);
  expect(body(pipes)).toContain("- A | AS LIST");
  expect(body(pipes)).toContain("```");
  const sed = await create("Sed output\n\nsh:: printf 'beds.md\\n' | sed 's/^/- [file::/; s/$/]/'");
  await run(sed);
  expect(body(sed)).toBe("- [file::beds.md]");
  const literal = await create("Literal option\n\nsh:: printf '[run::open]'");
  await run(literal);
  expect(body(literal)).toBe("[run::open]");
  const lots = await create("Many lines\n\nsh:: seq 205");
  await run(lots);
  expect(body(lots)?.split("\n")).toHaveLength(201);
  expect(body(lots)?.split("\n").at(-1)).toBe("+5 lines");
  const fileNote = await create(`Garden source [file::${join(root, "beds.md")}]`);
  const cat = await create(`Read the file\n\nsh:: cat ${join(root, "beds.md")}`);
  await run(cat);
  expect(body(cat)).toBe("Garden beds");
  await client.request({ action: "resources.projection.read", blockId: cat.id, materialize: true });
  // A refresh waits for the shared handler answer used by every renderer.
  const refreshed = await client.request({ action: "resources.projection.refresh", blockId: cat.id, line: 2 });
  expect(JSON.stringify(refreshed)).toContain(`!((${fileNote.id}))`);
  expect(JSON.stringify(refreshed)).toContain(`[file::${join(root, "beds.md")}]`);
  const removed = await client.request<{ lines: string[] }>({ action: "extensions.uninstall", extension: "runbook", demo: "keep" });
  expect(removed.lines.join("\n")).toMatch(/kept|remain/i);
  expect(body(note)).toContain("beds.md");
  expect(store.require(record.id).text).toContain("[run.exit::0]");
}, 30000);

test("opening opts in per line, and a command past the runbook deadline is stopped and recorded", async () => {
  const { folder, store, client, create, body } = await setup();
  const note = await create("Open counter\n\nsh:: printf seen >> count; cat count [run::open]\nsh:: printf forbidden > off");
  const open = () => client.request({ action: "resources.projection.read", blockId: note.id, opened: true });
  const waitFor = async (wanted: string) => {
    const end = Date.now() + 10000;
    while (body(note) !== wanted) { if (Date.now() > end) throw new Error(`expected ${wanted}, got ${body(note)}`); await Bun.sleep(25); }
  };
  await open(); await waitFor("seen");
  await open(); await waitFor("seenseen");
  expect(await Bun.file(join(folder, "off")).exists()).toBe(false);
  const manifest = join(folder, "extensions/runbook/extension.json");
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), deadline: "2s" }));
  await client.request({ action: "extensions.list", reload: true });
  const slow = await create("Slow command\n\nsh:: sleep 10; printf too-late > escaped");
  await expect(client.request({ action: "extensions.act", extension: "runbook", extensionAction: "run-sh", blockId: slow.id, line: 2 })).rejects.toThrow("deadline reached");
  expect(body(slow)).toBeUndefined();
  expect(store.children(slow.id).some(b => b.text.includes("[run.status::failed]") && b.text.includes("command stopped"))).toBe(true);
  expect(await Bun.file(join(folder, "escaped")).exists()).toBe(false);
  await create("Slow formatter [script::slow-format]\n```js\nwhile (true) {}\n```");
  const format = await create("Format deadline\n\nsh:: printf done | as slow-format");
  await expect(client.request({ action: "extensions.act", extension: "runbook", extensionAction: "run-sh", blockId: format.id, line: 2 })).rejects.toThrow(/deadline|time/i);
  expect(body(format)).toBeUndefined();
  expect(store.children(format.id).some(b => b.text.includes("[run.status::failed]"))).toBe(true);
}, 20000);

test.skipIf(!Bun.which("nu"))("Nushell runs and formats through the same installed handler (requires nu on PATH)", async () => {
  const { create, run, body } = await setup();
  const note = await create('Nushell labels\n\nnu:: ["peas" "beans"] | str join (char newline) | as tasks');
  await run(note, "nu");
  expect(body(note)).toBe("- [ ] peas\n- [ ] beans");
}, 15000);
