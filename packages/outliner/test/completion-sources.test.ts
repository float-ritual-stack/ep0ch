// `completion.rows` and `completion.picked` (PIE-1340): the service's completion sources and an extension's, on one
// row contract, merged by outline-core's one matcher, with picks kept by the host. Scratch service in a temp folder;
// every note and issue is made up.
import { afterEach, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { mergeSourceAnswers, insertText, pickId } from "@ep0ch/outline-core/completion-source";
import { completionRows } from "../src/completion-sources";
import { ReferenceCompletionSession, referenceCompletionProvider } from "../src/reference-completion";
import { renderReferenceCompletion } from "../src/reference-completion-renderer";
import { TextBuffer } from "../src/text-buffer";
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

test("exact property keys and values complete beyond the catalog's first hundred, including filters", async () => {
  const { create, rows } = await setup();
  const common = Array.from({ length: 105 }, (_, i) => `[bed-${i}::green] [planting::bed-${i}]`).join(" ");
  await create(`Common beds ${common}`);
  await create(`More common beds ${common}`);
  await create("Rare bed [zz-trellis::silver] [planting::zz-moonflower]");
  for (const [kind, query, expected] of [
    ["key", "zz-trellis", "[zz-trellis::"],
    ["filter-key", "zz-trellis", "zz-trellis:"],
    ["value", "zz-moonflower", "zz-moonflower]"],
    ["filter-value", "zz-moonflower", "zz-moonflower"],
  ] as const) {
    const result = await rows(kind, query, { key: "planting" });
    expect(merged(result, query).map(row => insertText(row.insert))).toContain(expected);
  }
});

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
  expect(listed.completionSources).toContainEqual(expect.objectContaining({ name: "ext.issues.issues", keys: ["issue"] }));
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
  await client.request({ action: "completion.picked", key: "key::issue", insert: pickId("#27") });
  const after = await rows("value", "", { key: "issue" });
  expect(after.picks[pickId("#27")]?.n).toBe(1);
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
  const { client, create, rows } = await setup();
  const folder = await create("Garden club");
  await client.request({ action: "create", parentId: folder.id, text: "Greenhouse meeting\n## Heating ^heat\nWe agreed to move the seedlings." });
  const r = await rows("block", "greenhouse");
  const list1 = merged(r, "greenhouse");
  expect(list1[0]).toMatchObject({ label: "Greenhouse meeting", kind: "block", detail: expect.stringContaining("Garden club") });
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


test("Detail wraps a service component's docs beside its detail line and preserves Enter on a bare property (PIE-1478)", async () => {
  const { client, create } = await setup();
  const note = await create("Completion practice\n");
  await create("Watering rota [trellis::north]");
  const buffer = new TextBuffer("::graph-table");
  buffer.moveEnd();
  const session = new ReferenceCompletionSession(referenceCompletionProvider(client, "popup-test"), () => buffer, () => {}, () => true, () => ({ blockId: note.id, text: buffer.text }));
  await session.refresh();
  const state = session.state!;
  expect(state.items[0]!.kind).toBe("component");
  expect(state.items[0]!.docs).toBeTruthy();
  const plain = (s: string) => s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\d;]*[A-Za-z]/g, "");
  const lines = renderReferenceCompletion(state, 120, 24).map(plain);
  expect(lines.some(line => line.includes(" │ "))).toBe(true);
  expect(lines.join("\n")).toContain(state.items[0]!.detail!);
  session.dismiss();
  buffer.replaceText("[trellis::"); buffer.moveEnd();
  await session.refresh();
  expect(session.state!.items[0]!.label).toBe("north");
  expect(session.chooses).toBe(false);
  expect(renderReferenceCompletion(session.state!, 80, 24).map(plain).join("\n")).toContain("↵ new line · ⇥ insert");
  expect(await session.accept()).toBe(true);
  expect(buffer.text).toBe("[trellis::north]");
});

test("scrolling large completion docs stays cheap and reaches the whole passage", async () => {
  const { client, create } = await setup();
  const last = "The final harvest belongs on the bottom shelf.";
  const body = Array.from({ length: 5000 }, (_, i) => `Harvest ${i}: keep the \`seed packets\` in the greenhouse until the beds are ready for planting.`).join("\n");
  const ledger = await create(`Harvest ledger\n${body}\n${last}`);
  const buffer = new TextBuffer("((Harvest ledger"); buffer.moveEnd();
  const session = new ReferenceCompletionSession(referenceCompletionProvider(client, "docs-test"), () => buffer, () => {}, () => true);
  try {
    await session.refresh();
    const state = session.state!;
    const row = state.items[state.index]!;
    for (let n = 0; !row.context?.includes(last) && n < 200; n++) await Bun.sleep(10);
    expect(row.context).toContain(last);
    const draw = (width = 120) => renderReferenceCompletion(state, width, 24).map(stripTerminalSequences);
    const coldStart = performance.now();
    expect(draw().join("\n")).toContain("Harvest 0:");
    const coldMs = performance.now() - coldStart;
    const scrollStart = performance.now();
    for (let n = 0; n < 30; n++) { session.scrollDocs(3); draw(); }
    const scrollMs = performance.now() - scrollStart;
    console.log(`completion docs: first draw ${coldMs.toFixed(1)} ms; 30 scroll draws ${scrollMs.toFixed(1)} ms`);
    expect(scrollMs).toBeLessThan(coldMs * 5);
    session.scrollDocs(Number.MAX_SAFE_INTEGER);
    expect(draw().join("\n")).toContain(last);
    const narrow = draw(48);
    expect(narrow.every(line => visibleWidth(line) <= 48)).toBe(true);
    session.scrollDocs(Number.MAX_SAFE_INTEGER);
    expect(draw(48).join("\n")).toContain(last);
    // Context is enriched after the row first appears; a cached draw must follow that new text too.
    const corrected = "A corrected harvest date.";
    await client.request({ action: "update", blockId: ledger.id, text: `Harvest ledger\n${corrected}`, expectedRevision: ledger.revision, mutation: { author: "agent", actorId: "docs-editor" } });
    session.move(0);
    for (let n = 0; !row.context?.includes(corrected) && n < 200; n++) await Bun.sleep(10);
    expect(draw(48).join("\n")).toContain(corrected);
  } finally { session.dismiss(); }
}, 20_000);


test("Detail fills a component and an extension button through shared slots, keeps the pick, and undoes each insertion whole", async () => {
  const { client, list } = await setup(["issues"]);
  await list(true);
  for (const [query, label] of [["::graph-stat", "component"], ["::button issue", "snippet"]]) {
    const buffer = new TextBuffer(query); buffer.moveEnd();
    const session = new ReferenceCompletionSession(referenceCompletionProvider(client, "slot-test"), () => buffer, () => {}, () => true);
    await session.refresh();
    const n = session.state!.items.findIndex(i => i.kind === label);
    expect(n).toBeGreaterThanOrEqual(0);
    const insertion = session.state!.items[n]!.insertion;
    expect(await session.accept(n)).toBe(true);
    expect(buffer.selectedText).toBeTruthy();
    buffer.insert("Garden totals");
    buffer.moveSnippet(1);
    expect(buffer.selectedText).toBeTruthy();
    buffer.moveSnippet(-1);
    expect(buffer.selectedText).toBe("Garden totals");
    buffer.endSnippet();
    expect(buffer.undo()).toBe(true);
    expect(buffer.text).toBe(query);
    const result = await client.request<CompletionRowsResult>({ action: "completion.rows", target: { kind: "component", query: "" } });
    expect(result.picks[pickId(insertion)]?.n).toBe(1);
    session.dismiss();
  }
});

test.each(["editor import", "backspace"])("Detail undoes a change outside the snippet before undoing the snippet: %s", async change => {
  const { client } = await setup();
  const original = "Planting notes\n::graph-stat";
  const buffer = new TextBuffer(original); buffer.placeCursor(1, 12);
  const session = new ReferenceCompletionSession(referenceCompletionProvider(client, "undo-test"), () => buffer, () => {}, () => true);
  await session.refresh();
  const n = session.state!.items.findIndex(i => i.component === "graph-stat");
  expect(n).toBeGreaterThanOrEqual(0);
  expect(await session.accept(n)).toBe(true);
  buffer.insert("Garden totals");
  buffer.moveSnippet(1); buffer.moveSnippet(-1);
  const before = buffer.text;
  if (change === "editor import") buffer.replaceText(before.replace("Planting notes", "Harvest notes"));
  else {
    const start = buffer.selectionRange!.start;
    buffer.placeCursor(start.row, start.column);
    buffer.backspace();
  }
  expect(buffer.text).not.toBe(before);
  expect(buffer.undo()).toBe(true);
  expect(buffer.text).toBe(before);
  expect(buffer.snippet).toBeNull();
  expect(buffer.undo()).toBe(true);
  expect(buffer.text).toBe(original);
  session.dismiss();
});

test("cancelling a popup stops a slow extension source before its timeout", async () => {
  const { client, extensionsFolder, list } = await setup();
  const folder = join(extensionsFolder, "slow-garden");
  mkdirSync(folder);
  writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: "slow-garden", version: 1, name: "Slow garden", run: ["bun", "source.ts"], sources: [{ id: "beds", title: "beds", triggers: ["[["] }] }));
  writeFileSync(join(folder, "source.ts"), 'await Bun.stdin.json(); await Bun.write(import.meta.dir + "/started", "ready"); await Bun.sleep(10000); console.log(JSON.stringify({ok:true,value:{rows:[]}}));');
  await list(true);
  const pending = client.request<CompletionRowsResult>({ action: "completion.rows", turn: "garden-turn", target: { kind: "page", query: "" } });
  for (let n = 0; n < 100 && !existsSync(join(folder, "started")); n++) await Bun.sleep(10);
  expect(existsSync(join(folder, "started"))).toBe(true);
  await client.request({ action: "completion.cancel", turn: "garden-turn" });
  const answer = await pending;
  const source = answer.answers.find(a => a.source.id === "ext.slow-garden.beds")!;
  expect(source.problem).toMatch(/abort|cancel|stop/i);
  expect(source.problem).not.toContain("no answer in");
});
