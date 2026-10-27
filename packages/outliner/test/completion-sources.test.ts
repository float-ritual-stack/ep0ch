// `completion.rows` and `completion.picked` (PIE-1340): the service's completion sources and an extension's, on one
// row contract, merged by outline-core's one matcher, with picks kept by the host. Scratch service in a temp folder;
// every note and issue is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { mergeSourceAnswers, insertText } from "@ep0ch/outline-core/completion-source";
import { completionRows } from "../src/completion-sources";
import type { CompletionRowsResult } from "@ep0ch/outline-core/protocol";
import type { CompletionKind } from "@ep0ch/outline-core/completion-triggers";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { Block } from "../src/types";

const REPO_EXTENSIONS = join(import.meta.dir, "..", "extensions");
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(install: string[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-complete-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlineFolder = join(root, "outline");
  mkdirSync(join(outlineFolder, "extensions"), { recursive: true });
  for (const name of install) cpSync(join(REPO_EXTENSIONS, name), join(outlineFolder, "extensions", name), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  const client = new OutlinerClient(socket);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string) => client.request<Block>({ action: "create", text });
  const list = (reload = false) => client.request<ExtensionsListResult>({ action: "extensions.list", ...(reload ? { reload: true } : {}) });
  const rows = (kind: CompletionKind, query: string, more: Record<string, unknown> = {}) =>
    client.request<CompletionRowsResult>({ action: "completion.rows", target: { kind, query, ...more } });
  return { root, extensionsFolder: join(outlineFolder, "extensions"), client, create, list, rows };
}

const merged = (r: CompletionRowsResult, query: string) => mergeSourceAnswers(r.answers, query, { picks: r.picks });

test("an extension's source joins [[ beside the pages: its rows rank with them by the one matcher", async () => {
  const { create, list, rows } = await setup(["issues"]);
  await create("Seed swap [page::Seed swap]");
  await create("Garden club [page::Garden club]");
  const listed = await list(true);
  expect(listed.completionSources).toEqual([expect.objectContaining({ name: "ext.issues.issues", triggers: ["[[", "key::"], keys: ["issue"] })]);
  const r = await rows("page", "seed");
  expect(r.answers.map(a => a.source.id)).toEqual(["pages", "ext.issues.issues"]);
  const list1 = merged(r, "seed");
  // The page whose title starts with the word, then the issue whose title holds it; weaker letters-in-order hits after.
  expect(list1.slice(0, 2).map(row => [row.label, insertText(row.insert)])).toEqual([
    ["Seed swap · Seed swap", "[[Seed swap]]"],
    ["#15 Seed swap sign-up sheet", "[issue::#15]"],
  ]);
  expect(list1[1]).toMatchObject({ kind: "issue", from: "ext.issues.issues", detail: "feature" });
  expect(list1[1]!.docs).toContain("spring seed swap");
});

test("key:: asks only a source that names the key, and its insert is the value", async () => {
  const { list, rows, create } = await setup(["issues"]);
  await list(true);
  // The service's properties source answers every key (PIE-1344); an extension's only the keys it names, and on those
  // the properties source steps aside, so a value a note already has isn't offered twice with two inserts.
  await create("Swap table [issue::#21]");
  expect((await rows("value", "", { key: "status" })).answers.map(a => a.source.id)).toEqual(["properties"]);
  expect((await rows("value", "21", { key: "issue" })).answers.map(a => a.source.id)).toEqual(["ext.issues.issues"]);
  const r = await rows("value", "21", { key: "issue" });
  expect(merged(r, "21").map(row => insertText(row.insert))).toEqual(["#21"]);
});

test("a pick is kept by the host: the next ask of the trigger ranks it first among equals, on any client", async () => {
  const { client, list, rows } = await setup(["issues"]);
  await list(true);
  const before = merged(await rows("value", "", { key: "issue" }), "");
  expect(insertText(before[0]!.insert)).toBe("#12");
  await client.request({ action: "completion.picked", key: "key::issue", insert: "#27" });
  const after = await rows("value", "", { key: "issue" });
  expect(after.picks["#27"]?.n).toBe(1);
  expect(insertText(merged(after, "")[0]!.insert)).toBe("#27");
});

test("a source that fails says so, and the built-ins still answer", async () => {
  const { create, extensionsFolder, list, rows } = await setup();
  mkdirSync(join(extensionsFolder, "broken"), { recursive: true });
  writeFileSync(join(extensionsFolder, "broken", "extension.json"), JSON.stringify({ contract: 2, id: "broken", version: 1, name: "broken", run: ["bun", "main.ts"],
    sources: [{ id: "odd", title: "odd", triggers: ["[["] }] }));
  writeFileSync(join(extensionsFolder, "broken", "main.ts"), `process.stdout.write(JSON.stringify({ ok: true, value: { rows: [{ label: "no insert" }] } }));`);
  await create("Compost [page::Compost]");
  await list(true);
  const r = await rows("page", "comp");
  expect(r.answers.find(a => a.source.id === "ext.broken.odd")!.problem).toContain("insert");
  expect(merged(r, "comp").map(row => row.label)).toEqual(["Compost · Compost", "new page · comp"]);
});

test("a built-in source that fails says so, and the extensions' rows still come", async () => {
  const svc = { request: async <T>(action: string): Promise<T> => {
    if (action === "references.resolve") return {} as T;
    throw new Error("the page index is busy");
  } };
  const issues = { id: "issues", extension: "issues", name: "ext.issues.issues", title: "issues", triggers: ["[["] as const };
  const r = await completionRows(svc, { target: { kind: "page", query: "seed" } }, [issues], async () => [{ label: "#15 Seed swap", insert: "#15" }], {});
  expect(r.answers.find(a => a.source.id === "pages")!.problem).toContain("the page index is busy");
  expect(r.answers.find(a => a.source.id === "ext.issues.issues")!.rows).toHaveLength(1);
});

test("a source in no list, or keys without key::, is refused with what to write", async () => {
  const { extensionsFolder, list } = await setup();
  for (const [id, source] of [["nowhere", { id: "x", title: "x" }], ["keyless", { id: "y", title: "y", triggers: ["[["], keys: ["issue"] }]] as const) {
    mkdirSync(join(extensionsFolder, id), { recursive: true });
    writeFileSync(join(extensionsFolder, id, "extension.json"), JSON.stringify({ contract: 2, id, version: 1, name: id, run: ["bun", "main.ts"], sources: [source] }));
  }
  const listed = await list(true);
  expect(listed.extensions.find(e => e.id === "nowhere")?.error).toContain("give it a prefix (the power bar), triggers (completion), or both");
  expect(listed.extensions.find(e => e.id === "keyless")?.error).toContain("add \"key::\" to its triggers");
});

test("(( answers the notes and their anchors from the service, as the door and Detail both show them", async () => {
  const { create, rows } = await setup();
  await create("Greenhouse meeting\n## Heating ^heat\nWe agreed to move the seedlings.");
  const r = await rows("block", "greenhouse");
  const list1 = merged(r, "greenhouse");
  expect(list1[0]).toMatchObject({ label: "Greenhouse meeting", kind: "block" });
  expect(list1.map(row => row.kind)).toContain("anchor");
});
