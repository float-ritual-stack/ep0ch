// Which extensions supply scripts is the extension registry's answer (PIE-1240): a disabled extension, or a copy another
// folder shadows, supplies none, and enabling it again brings its scripts back. Scratch services; names are made up.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { scriptSourceId, scriptSources } from "../src/script-sources";
import type { ExtensionsListResult } from "../src/extension-registry";
import { setup, until } from "./script-harness";

function plant(folder: string, id: string, script: string, config: Record<string, unknown> = {}) {
  mkdirSync(join(folder, id, "scripts"), { recursive: true });
  writeFileSync(join(folder, id, "extension.json"), JSON.stringify({ contract: 2, id, name: id, version: 1, scripts: [{ name: script, file: `scripts/${script}.js`, about: `${script} the ${id}` }] }));
  writeFileSync(join(folder, id, "scripts", `${script}.js`), `// ep0ch-script\nreturn "${script}";\n`);
  writeFileSync(join(folder, id, "config.json"), JSON.stringify(config));
}

const scriptsListed = async (client: OutlinerClient) =>
  (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.flatMap(e => e.script && e.name && ["water", "rain"].includes(e.name) ? [e.name] : []).sort();

test("a disabled extension's scripts are not listed or runnable, and enabling it brings them back", async () => {
  const { root, client } = await setup();
  const config = join(root, "outline/extensions/garden/config.json");
  plant(join(root, "outline/extensions"), "garden", "water");
  const entry = async () => (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find(e => e.script && e.name === "water");
  const id = (await entry())!.id;
  // A script keeps the id its file always had, so saved buttons and sequences still find it.
  expect(id).toBe(scriptSourceId(join(root, "outline/extensions/garden/scripts/water.js")));
  expect((await client.request<{ written: string[] }>({ action: "extensions.act", extension: id, extensionAction: "run" })).written).toBeDefined();
  writeFileSync(config, JSON.stringify({ enabled: false }));
  expect(await entry()).toBeUndefined();
  await expect(client.request({ action: "extensions.act", extension: id, extensionAction: "run" })).rejects.toThrow();
  writeFileSync(config, JSON.stringify({ enabled: true }));
  await until("the script back", async () => (await entry())?.id === id);
});

test("an extension another folder shadows supplies no scripts, and the winning copy's are listed", async () => {
  const { root, client } = await setup();
  plant(join(root, "user-extensions"), "garden", "rain");
  plant(join(root, "outline/extensions"), "garden", "water");
  expect(await scriptsListed(client)).toEqual(["water"]);
});

test("a file script headed `mode=render` draws its `name::` lines, updates with its file, and a note script of the same name still wins", async () => {
  const { root, store, create, output, draw, client } = await setup();
  const folder = join(root, "outline/extensions/garden");
  mkdirSync(join(folder, "scripts"), { recursive: true });
  writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: "garden", name: "garden", version: 1, scripts: [{ name: "tally", file: "scripts/tally.js", about: "draws the bed's tally" }] }));
  const file = (word: string) => writeFileSync(join(folder, "scripts", "tally.js"), `// ep0ch-script mode=render\nreturn "${word} for " + (await resolve("this.owner")).values[0];\n`);
  file("beans");
  const note = create("Bed [owner::sam]\ntally::");
  await draw(note.id);
  expect(await until("the file's drawing", async () => output(note.id)[0])).toBe("beans for sam");
  // The listed entry is a render handler: the line is drawn, not run by a press.
  const listed = (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find(e => e.script && e.name === "tally")!;
  expect(listed.state).toBe("active");
  // The file changes (as `ep0ch install --apply` would change it): the line draws the new words.
  file("leeks");
  await client.request({ action: "extensions.list", reload: true });
  await client.request({ action: "resources.projection.refresh", blockId: note.id });
  await until("the new file's drawing", async () => output(note.id)[0] === "leeks for sam");
  // A note with the same [script::] name wins over the extension's file.
  create("Tally [script::tally] [mode::render]\n```js\nreturn 'the note says so';\n```");
  await client.request({ action: "extensions.list", reload: true });
  await client.request({ action: "resources.projection.refresh", blockId: note.id });
  await until("the note script's drawing", async () => output(note.id)[0] === "the note says so");
  expect(store.get(note.id)!.revision).toBe(1);
});

test("a file script's header names its mode and effects, and anything else is refused with the header that works", async () => {
  const { root, client } = await setup();
  const folder = join(root, "outline/extensions/garden");
  mkdirSync(join(folder, "scripts"), { recursive: true });
  writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: "garden", name: "garden", version: 1, scripts: [{ name: "tally", file: "scripts/tally.js", about: "draws the bed's tally" }] }));
  writeFileSync(join(folder, "scripts", "tally.js"), "// ep0ch-script mode=paint\nreturn 1;\n");
  const all = (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions;
  const refused = all.find(e => e.id === "garden" || e.name === "garden" || e.name === "tally");
  expect(refused?.state).not.toBe("active");
  expect(refused?.error).toContain("mode=render");
  expect(refused?.error).toContain("effects=write");
});

// PIE-1298: what a slot names is the script's own word, in the form grammar, so a button's empty slot is asked in that kind.
test("a script declares its slots' kinds with [form-field::…]: a file in its opening comments, a note on itself", async () => {
  const { root, client, create } = await setup();
  const folder = join(root, "outline/extensions/garden");
  mkdirSync(join(folder, "scripts"), { recursive: true });
  writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: "garden", name: "garden", version: 1, scripts: [{ name: "pair", file: "scripts/pair.js", about: "two beds" }] }));
  writeFileSync(join(folder, "scripts", "pair.js"), "// ep0ch-script\n// [form-field::bed note] [form-field::size choice small|large]\nconst x = '[form-field::later number]';\nreturn props.bed?.[0] + props.size?.[0] + props.extra?.[0];\n");
  create("Sow [script::sow]\n[form-field::when choice spring|autumn]\n```js\nreturn props.when?.[0] + props.row?.[0];\n```");
  const listed = (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions;
  const args = (name: string) => listed.find(e => e.script && e.name === name)!.actions.find(a => a.id === "run")!.args;
  // Declared first, then what the code reads that it doesn't declare, as text; a chip past the comments is code, not a declaration.
  expect(args("pair")).toEqual([{ name: "bed", type: "note" }, { name: "size", type: "choice", options: ["small", "large"] }, { name: "extra", type: "text" }]);
  expect(args("sow")).toEqual([{ name: "when", type: "choice", options: ["spring", "autumn"] }, { name: "row", type: "text" }]);
});

test("a script's own words are its summary (PIE-1284): a note script's its note's title, an extension's its about; retitling the note is a change clients hear", async () => {
  const { root, store, create, client } = await setup();
  plant(join(root, "outline/extensions"), "garden", "water");
  const note = create("Weekly tidy of the beds [script::tidyup]\n\n```js\nreturn 1;\n```");
  const list = () => client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const summary = async (name: string) => (await list()).extensions.find(e => e.script && e.name === name)?.summary;
  expect(await summary("tidyup")).toBe("Weekly tidy of the beds");
  expect(await summary("water")).toBe("water the garden");
  // A note that opens with its code has no title to say: never the fence's opener.
  create("[script::bare]\n```js\nreturn 2;\n```");
  create("```js script=fenced\nreturn 3;\n```");
  expect(await summary("bare")).toBeUndefined();
  expect(await summary("fenced")).toBeUndefined();
  // Its description still says where it is written (completions show it).
  expect((await list()).extensions.find(e => e.name === "tidyup")?.description).toContain(`((${note.id}))`);
  const before = (await list()).generation;
  store.update(note.id, note.text.replace("Weekly", "Monthly"), note.revision, { author: "user" });
  expect(await until("the new title", async () => (await summary("tidyup")) === "Monthly tidy of the beds")).toBe(true);
  expect((await list()).generation).toBeGreaterThan(before);
});

// Note components: a render script's note is a component schema (its chips its props, its demo line its example); a
// module is only imported; of two notes that say one name, the one whose lines it draws is the one listed.
test("a render note's manifest carries its component, its demo line the example; a module has no run, @name or schema", async () => {
  const { store, create, client } = await setup();
  const board = create("Errand board [script::board] [mode::render] [form-field::where query required] [form-field::group property default=status]\nLanes of what a query holds.\n\n::board{where=\"type=errand\" group=owner}\n\n```js\nreturn props.where[0];\n```");
  create("UI kit [script::ui-kit] [mode::module]\n```js\nreturn { Lane: () => 1 };\n```");
  const sources = await scriptSources(store);
  const manifest = (name: string) => JSON.parse(sources.find(s => s.scriptName === name)!.manifestRaw);
  const [component] = manifest("board").components;
  expect(component).toMatchObject({ id: "board", title: "Errand board", intro: "Lanes of what a query holds.", origin: `note:((${board.id}))`,
    example: { where: "type=errand", group: "owner" }, source: { use: "::board{where=\"type=errand\" group=owner}" } });
  expect(component.props.map((p: { key: string }) => p.key)).toEqual(["where", "group"]);
  expect(manifest("ui-kit")).toMatchObject({ actions: [] });
  expect(manifest("ui-kit").agents).toBeUndefined();
  expect(manifest("ui-kit").components).toBeUndefined();
  expect(sources.find(s => s.scriptName === "ui-kit")!.script!.module).toBe(true);
  // The module still loads (an import finds it by name), with nothing to run or ask.
  const listed = (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions;
  const kit = listed.find(e => e.script && e.name === "ui-kit")!;
  expect(kit.state).toBe("active");
  expect([kit.actions, kit.agents, kit.handlers]).toEqual([[], [], []]);
});

test("of two render notes named board, only the one that draws board's lines lists its component", async () => {
  const { create, client } = await setup();
  const first = create("Board [script::board] [mode::render]\n```js\nreturn 'first';\n```");
  create("Board again [script::board] [mode::render]\n```js\nreturn 'second';\n```");
  await client.request({ action: "extensions.list", reload: true });
  const answer = await client.request<{ schemas: { id: string; origin?: string }[]; problems: string[] }>({ action: "components.schemas" });
  expect(answer.schemas.filter(s => s.id === "board").map(s => s.origin)).toEqual([`note:((${first.id}))`]);
  expect(answer.problems.filter(p => p.includes("board"))).toEqual([]);
});
