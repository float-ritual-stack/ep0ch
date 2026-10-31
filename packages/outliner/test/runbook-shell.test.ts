import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { OutlinerClient } from "../src/client";
import type { ResourceProjectionReadResult } from "../src/resource-projection";
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
  // Opening may already be running the handler when refresh answers with its pending state.
  let refreshed = await client.request<ResourceProjectionReadResult>({ action: "resources.projection.refresh", blockId: cat.id, line: 2 });
  for (const end = Date.now() + 10000; refreshed.projections.some(p => p.fetching);) {
    if (Date.now() > end) throw new Error(`Shell hint did not finish: ${JSON.stringify(refreshed)}`);
    await Bun.sleep(25);
    refreshed = await client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId: cat.id, line: 2 });
  }
  expect(JSON.stringify(refreshed)).toContain(`!((${fileNote.id}))`);
  expect(JSON.stringify(refreshed)).toContain(`[file::${join(root, "beds.md")}]`);
  const removed = await client.request<{ lines: string[] }>({ action: "extensions.uninstall", extension: "runbook", demo: "keep" });
  expect(removed.lines.join("\n")).toMatch(/kept|remain/i);
  expect(body(note)).toContain("beds.md");
  expect(store.require(record.id).text).toContain("[run.exit::0]");
}, 30000);

test("empty shell output stays empty through all bundled formatters", async () => {
  const { client, create, run } = await setup();
  const output: Record<string, string | undefined> = {};
  for (const formatter of ["files", "links", "list", "tasks", "table", "code"]) {
    const note = await create(`Empty output\n\nsh:: true | as ${formatter}`);
    await run(note);
    const saved = await client.request<Block>({ action: "get", blockId: note.id });
    output[formatter] = findOutputRegions(saved.text)[0]?.body;
  }
  expect(output).toEqual({ files: "", links: "", list: "", tasks: "", table: "", code: "" });
}, 30000);

test("large shell output retains a bounded stdout head and stderr tail", async () => {
  const { root, client, create, run } = await setup();
  const cap = 4 * 1024 * 1024;
  const lines = Array.from({ length: 131072 }, (_, i) => `${String(i + 1).padStart(7, "0")} ${"x".repeat(55)}`);
  writeFileSync(join(root, "stdout.txt"), lines.join("\n") + "\n");
  await create('Output length [script::output-length]\n```js\nreturn String(props.lines.join("\\n").length);\n```');
  const note = await create(`Large output [cwd::${root}]\n\nsh:: cat stdout.txt | as output-length`);
  await run(note);
  let saved = await client.request<Block>({ action: "get", blockId: note.id });
  expect(Number(findOutputRegions(saved.text)[0]!.body)).toBeLessThanOrEqual(cap);
  saved = await client.request<Block>({ action: "update", blockId: note.id, text: saved.text.replace(" | as output-length", ""), expectedRevision: saved.revision, mutation: { author: "user" } });
  await run(saved);
  saved = await client.request<Block>({ action: "get", blockId: note.id });
  const shown = findOutputRegions(saved.text)[0]!.body.split("\n");
  expect(shown.slice(0, 200)).toEqual(lines.slice(0, 200));
  expect(shown).toHaveLength(201);
  expect(shown[200]).toMatch(/^\+\d+ lines$/);

  const diagnostic = "latest garden failure\n";
  writeFileSync(join(root, "stderr.txt"), "old failure\n" + "x".repeat(cap) + diagnostic + "x".repeat(cap - diagnostic.length));
  const failed = await create(`Large error [cwd::${root}]\n\nsh:: cat stderr.txt >&2; exit 2`);
  await expect(run(failed)).rejects.toThrow("exit 2: latest garden failure");
}, 30000);

test("saving a shell parent preserves its anchor and output when a child has the same anchor", async () => {
  const { client, create, run } = await setup();
  const parent = await create("Garden parent\n\nsh:: printf parent");
  await run(parent);
  const before = await client.request<Block>({ action: "get", blockId: parent.id });
  const region = findOutputRegions(before.text)[0]!;
  const child = await create("Garden child\n\nsh:: printf child", parent.id);
  await run(child);
  const saved = await client.request<Block>({ action: "update", blockId: parent.id, text: before.text.replace("Garden parent", "Garden parent edited"), expectedRevision: before.revision, mutation: { author: "user" } });
  expect(saved.text.split("\n")[2]).toBe(before.text.split("\n")[2]);
  expect(findOutputRegions(saved.text)).toMatchObject([{ anchor: region.anchor, body: region.body }]);
  await run(saved);
  const rerun = await client.request<Block>({ action: "get", blockId: parent.id });
  expect(findOutputRegions(rerun.text)).toMatchObject([{ anchor: region.anchor, body: "parent" }]);
  expect(findOutputRegions(rerun.text)).toHaveLength(1);
  const records = await client.request<Block[]>({ action: "children", parentId: parent.id });
  expect(records.filter(b => b.properties.some(p => p.key === "type" && p.value === "run"))
    .every(b => b.properties.some(p => p.key === "run.step" && p.value === "^step-sh"))).toBe(true);
}, 15000);

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
