// Which extensions supply scripts is the extension registry's answer (PIE-1240): a disabled extension, or a copy another
// folder shadows, supplies none, and enabling it again brings its scripts back. Scratch services; names are made up.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { scriptSourceId } from "../src/script-sources";
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
