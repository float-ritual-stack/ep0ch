import { completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
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
import { completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
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

test("layout completion belongs to the view note on its title and the hero on its image line", async () => {
  const { client, create } = await setup();
  const note = await create("Garden [query::type=chore]");
  const read = async (lines: string[], row: number) => {
    const target = completionTargetAtCursor(lines[row]!, lines[row]!.length, lines, row)!;
    const result = await client.request<CompletionRowsResult>({ action: "completion.rows", target, draft: { blockId: note.id, text: lines.join("\n") } });
    return merged(result, "").map(row => row.label);
  };
  const title = await read(["Garden [query::type=chore] [layout::"], 0);
  expect(title).toContain("gallery");
  expect(title).not.toContain("hero");
  const image = await read(["Garden [query::type=chore]", "", "[img::garden.png] [layout::"], 2);
  expect(image).toContain("hero");
  expect(image).not.toContain("gallery");
});

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

test("(( with a short id offers the note it names first, its title as the label (PIE-1437)", async () => {
  const { create, rows } = await setup();
  await create("Seed tray rota\nWho waters which tray.");
  const note = await create("Compost turning\nEvery second Sunday.");
  const short = note.id.slice(0, 8);
  const list1 = merged(await rows("block", short), short);
  expect(list1[0]).toMatchObject({ label: "Compost turning", kind: "block", blockId: note.id });
  expect(insertText(list1[0]!.insert)).toBe(`((${note.id}))`);
});

// Note components (WP4): a render script's note completes under `::` like any component, `g` opens its note, a name no
// component has offers to make one, and its props complete from what its call's where= holds.
const BOARD = "Errand board [script::board] [mode::render] [form-field::where query required] [form-field::group property default=status]\nLanes of what a query holds.\n\n::board{where=\"type=errand\" group=status}\n\n```js\nreturn 1;\n```";

test(":: lists a render script's note as a component whose g opens its note; a new name offers + new component first", async () => {
  const { create, list, rows } = await setup();
  const board = await create(BOARD);
  await list(true);
  const found = merged(await rows("component", "bo"), "bo");
  expect(found.find(r => r.component === "board")).toMatchObject({ definition: board.id, group: expect.stringMatching(/^this outline's/) });
  // Writing ::board itself names a component: nothing is offered new.
  expect(merged(await rows("component", "board"), "board").some(r => r.newComponent)).toBe(false);
  const fresh = merged(await rows("component", "zz-stale"), "zz-stale");
  expect(fresh[0]).toMatchObject({ label: "+ new component ::zz-stale", newComponent: "zz-stale", kind: "new" });
  expect(insertText(fresh[0]!.insert)).toBe("::zz-stale{}");
  // A name no component can have (an upper-case letter) is never offered.
  expect(merged(await rows("component", "Zz"), "Zz").some(r => r.newComponent)).toBe(false);
});

test("group= offers the keys where='s rows carry, most carried first; where=\" completes the query grammar", async () => {
  const { create, list, rows } = await setup();
  await create(BOARD);
  await create("Fix the shed door [type::errand] [status::open] [owner::sam]");
  await create("Buy compost [type::errand] [status::doing] [owner::ida]");
  await create("Return ladder [type::errand] [status::done]");
  await create("Not an errand [type::note] [mood::calm]");
  await list(true);
  const attrs = [{ key: "where", value: "type=errand" }];
  const group = merged(await rows("attribute-value", "", { component: "board", key: "group", attrs }), "");
  expect(group.map(r => r.label)).toEqual(["status", "type", "owner"]);
  expect(group[0]!.docs).toBe("3 of the 3 notes where= holds carry it");
  expect(merged(await rows("attribute-value", "o", { component: "board", key: "group", attrs }), "o").map(r => r.label)).toEqual(["owner"]);
  // A where= nothing answers: the note's own keys, as before.
  const where = merged(await rows("attribute-value", "typ", { component: "board", key: "where", attrs: [] }), "typ");
  expect(where.length).toBeGreaterThan(0);
  expect(where.some(r => r.label.startsWith("type"))).toBe(true);
});

test("[query:: completes the grammar (atoms, this, NOT, dates) beside the keys and values the notes have", async () => {
  const { create, rows } = await setup([]);
  await create("Planning call [type::meeting] [when::2031-03-02]");
  const values = async (query: string) => merged(await rows("value", query, { key: "query" }), query).map(row => insertText(row.insert));
  expect(await values("type=meeting AND under:t")).toContain("type=meeting AND under:this]");
  expect(await values("")).toEqual(expect.arrayContaining(["under:", "NOT", "type=meeting]"]));
  expect(await values("when>=-")).toContain("when>=-7d]");
  // A key that isn't a query gets none of it.
  expect(merged(await rows("value", "under:", { key: "status" }), "under:").map(row => insertText(row.insert))).not.toContain("under:this]");
});

test("a handler line completes the slots its script declares: names with their words, then a query slot's grammar (PIE-1472)", async () => {
  const { list, rows, create } = await setup(["lens"]);
  await list(true);
  await create("Planning call [type::meeting] [when::2031-03-02]");
  const slots = await rows("attribute", "", { component: "lens", attrs: [{ key: "columns", value: "title" }] });
  const names = merged(slots, "").map(r => r.label);
  expect(names).toEqual(expect.arrayContaining(["query", "view", "edit", "sort", "dir", "avg", "title"]));
  expect(names).not.toContain("columns");
  expect(merged(slots, "").find(r => r.label === "query")!.docs).toContain("grammar");
  const query = (text: string) => rows("attribute-value", text, { component: "lens", key: "query", quote: '"', attrs: [] });
  expect(merged(await query("type=meeting AND un"), "").map(r => r.label)).toEqual(expect.arrayContaining(["type=meeting AND under:", "type=meeting AND unread:"]));
  // A slot that names properties offers the keys the line's own query rows carry.
  const sort = await rows("attribute-value", "wh", { component: "lens", key: "sort", quote: '"', attrs: [{ key: "query", value: "type=meeting" }] });
  expect(merged(sort, "").map(r => r.label)).toContain("when");
});

test("a figure's query: written in YAML quotes still completes the grammar; the quote is decoded, not offered (PIE-1472)", async () => {
  const { rows } = await setup([]);
  const labels = async (query: string) => merged(await rows("yaml-value", query, { component: "graph-tabs", key: "query" }), query).map(r => insertText(r.insert));
  // The first pick wrote `"#garden AND under:"`; the next lookup is asked from inside that quote.
  expect(await labels('"#garden AND un')).toEqual(expect.arrayContaining(['"#garden AND under:"', '"#garden AND unread:"']));
  expect(await labels('"#garden AND under:t')).toContain('"#garden AND under:this"');
  expect(await labels("'#garden AND under:t")).toContain('"#garden AND under:this"');
});


test("shell completion shows its demo and | as finds the outline's own formatter scripts", async () => {
  const { create, list, rows } = await setup(["runbook"]);
  await list(true);
  const handlerTarget = completionTargetAtCursor("::sh", 4)!;
  const handlers = merged(await rows(handlerTarget.kind, handlerTarget.query), handlerTarget.query);
  const sh = handlers.find(row => row.label === "sh::")!;
  expect(sh.example?.use).toContain("| sed 's/^/- [file::/");
  expect(insertText(sh.insert)).toBe("sh:: ");
  const line = "sh:: ls | as fi", target = completionTargetAtCursor(line, line.length)!;
  const files = merged(await rows(target.kind, target.query), target.query).find(row => row.label === "files")!;
  expect(line.slice(0, target.start) + insertText(files.insert)).toBe("sh:: ls | as files");
  const own = await create("My formatter [script::plant-labels]\n```js\nreturn props.lines.join(\"\\n\");\n```");
  await list(true);
  const custom = merged(await rows("formatter", "plant"), "plant").find(row => row.label === "plant-labels")!;
  expect(custom.definition).toBe(own.id);
});
