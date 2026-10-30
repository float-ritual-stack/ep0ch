// Imports by name (src/script-link.ts): `import { X } from "kit"` reads another script's note, the nearest first; a
// cycle, an unknown name and too deep a chain are refused by name; editing a module draws its importers again.
// Scratch service (script-harness.ts) and made-up notes only.
import { expect, test } from "bun:test";
import { importedNames, linkScript, MAX_IMPORT_DEPTH, ScriptLinkError, type ModuleLookup } from "../src/script-link";
import { setup, until } from "./script-harness";

const modules = (code: Record<string, string>) => (name: string): ModuleLookup =>
  code[name] === undefined ? undefined : { id: `id-${name}`, name, code: code[name]!, stamp: "1", blockId: `note-${name}` };
const refused = (run: () => unknown) => { try { run(); } catch (e) { expect(e).toBeInstanceOf(ScriptLinkError); return (e as Error).message; } throw new Error("linked"); };

test("an import becomes a call of the module, keeping the line count, and names the notes read", () => {
  const linked = linkScript({ name: "board", code: 'import {\n  Lane,\n  Card as C,\n} from "ui-kit"\nreturn [Lane, C]' }, modules({ "ui-kit": "return { Lane: 1, Card: 2 }" }));
  expect(linked.code.split("\n")).toHaveLength(5);
  expect(linked.code).toContain("const { Lane, Card: C } = await __ep0ch_module_id_ui_kit.call(__this);");
  expect(linked.modules).toContain("const __ep0ch_module_id_ui_kit");
  expect(linked.moduleIds).toEqual(["note-ui-kit"]);
  expect(linkScript({ name: "plain", code: "return 1" }, () => { throw new Error("never asked"); }).code).toBe("return 1");
});

test("a cycle is named, an unknown name points at ext ls, and a chain past the limit stops", () => {
  expect(refused(() => linkScript({ name: "board", code: 'import { Lane } from "ui-kit"' }, modules({ "ui-kit": 'import { x } from "board"\nreturn {}', board: "return {}" }))))
    .toContain("Import cycle: board → ui-kit → board");
  expect(refused(() => linkScript({ name: "board", code: 'import { Lane } from "ui-kat"' }, modules({}))))
    .toBe("board imports ui-kat, and there is no script ui-kat here; ep0ch ext ls lists the scripts");
  const chain = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i + 1}`, i + 1 < n ? `import { v } from "m${i + 2}"\nreturn { v }` : "return { v: 1 }"]));
  expect(linkScript({ name: "top", code: 'import { v } from "m1"' }, modules(chain(MAX_IMPORT_DEPTH))).moduleIds).toHaveLength(MAX_IMPORT_DEPTH);
  expect(refused(() => linkScript({ name: "top", code: 'import { v } from "m1"' }, modules(chain(MAX_IMPORT_DEPTH + 1))))).toContain(`Imports nest deeper than ${MAX_IMPORT_DEPTH}`);
});

test("only the script's head imports: an import line in a string or a comment is text", () => {
  const find = modules({ kit: "return { a: 1 }" });
  const template = 'import { a } from "kit"\nconst snippet = `\nimport { Lane } from "ui-kit"\n`\nreturn snippet + a';
  const linked = linkScript({ name: "snippets", code: template }, find);
  expect(linked.code).toContain('`\nimport { Lane } from "ui-kit"\n`');
  expect(linked.moduleIds).toEqual(["note-kit"]);
  const commented = '// ep0ch-script effects=read\n/* import { Old } from "gone-kit"\n*/\n/* a note */ import { a } from "kit"\nreturn a';
  expect(importedNames(commented)).toEqual(["kit"]);
  expect(importedNames('return `\nimport { Lane } from "ui-kit"\n`')).toEqual([]);
  expect(importedNames('const a = 1\nimport { b } from "kit"\nreturn b')).toEqual([]);
  expect(importedNames('import("kit")')).toEqual([]);
  expect(linkScript({ name: "plain", code: 'return `\nimport x from "nowhere"\n`' }, () => undefined).moduleIds).toEqual([]);
});

test("fixing a broken module draws its importers again at once, as editing a good one does", async () => {
  const { store, create, output, draw } = await setup();
  const kit = create("Broken kit [script::broken-kit] [mode::module]\n```ts\nconst = 1\nreturn { word: 'mended' }\n```");
  create("Mender [script::mender] [mode::render]\n```ts\nimport { word } from \"broken-kit\"\nreturn word\n```");
  const note = create("Workbench\nmender::");
  await draw(note.id);
  const row = () => store.extensionOutputs(note.id).find(r => r.handlerKey === "mender");
  await until("the compile error", () => row()?.error?.includes("doesn't compile"));
  const fixed = store.get(kit.id)!;
  store.update(kit.id, fixed.text.replace("const = 1\n", ""), fixed.revision, { author: "user" });
  await until("the mended word", () => output(note.id)[0] === "mended", 3_000);
});

test("a render that throws after reading a note draws again when that note changes", async () => {
  const { store, create, output, draw } = await setup();
  const fuel = create("Fuel gauge\nempty");
  create(`Burner [script::burner] [mode::render]\n\`\`\`ts\nconst r = await read("${fuel.id}")\nif (r.text.includes("empty")) throw new Error("no fuel")\nreturn "lit"\n\`\`\``);
  const note = create("Stove\nburner::");
  await draw(note.id);
  await until("the failure", () => store.extensionOutputs(note.id).find(r => r.handlerKey === "burner")?.error?.includes("no fuel"));
  const gauge = store.get(fuel.id)!;
  store.update(fuel.id, "Fuel gauge\nfull", gauge.revision, { author: "user" });
  await until("the burner lit", () => output(note.id)[0] === "lit", 3_000);
});

test("the nearest definition of a name wins, and a tsx module draws through a ts render", async () => {
  const { store, create, output, draw } = await setup();
  create("Far kit [script::kit] [mode::module]\n```ts\nreturn { word: 'far' }\n```");
  const near = create("Near kit [script::kit] [mode::module]\n```ts\nreturn { word: 'near' }\n```");
  create("Word [script::word-of] [mode::render]\n```ts\nimport { word } from \"kit\"\nreturn word\n```");
  const inside = store.create("Inside\nword-of::", near.id, "user");
  const outside = create("Outside\nword-of::");
  await draw(inside.id);
  await draw(outside.id);
  expect(await until("the near word", () => output(inside.id)[0])).toBe("near");
  expect(await until("the far word", () => output(outside.id)[0])).toBe("far");
  create("Lanes [script::lanes] [mode::module]\n```tsx\nconst Lane = ({ title }) => <box title={title}><text>none yet</text></box>\nreturn { Lane }\n```");
  create("Board [script::lane-board] [mode::render]\n```ts\nimport { Lane } from \"lanes\"\nreturn view.row({ children: [Lane({ title: 'doing' })] })\n```");
  const host = create("Host\nlane-board::");
  await draw(host.id);
  expect(await until("the lane", () => output(host.id)[0])).toContain("doing");
});

test("editing a module draws the notes that import it again, and an import error says which", async () => {
  const { store, create, output, draw } = await setup();
  const kit = create("Greeting kit [script::greet-kit] [mode::module]\n```ts\nreturn { hello: 'hello' }\n```");
  create("Greeter [script::greeter] [mode::render]\n```ts\nimport { hello } from \"greet-kit\"\nreturn hello + ' there'\n```");
  const note = create("Front porch\ngreeter::");
  await draw(note.id);
  expect(await until("the greeting", () => output(note.id)[0])).toBe("hello there");
  store.update(kit.id, kit.text.replace("'hello'", "'howdy'"), store.get(kit.id)!.revision, { author: "user" });
  // No reload asked: the importer reads the module's note, so the edit itself draws it again.
  await until("the new greeting", () => output(note.id)[0] === "howdy there");
  create("Lost [script::lost] [mode::render]\n```ts\nimport { x } from \"nowhere-kit\"\nreturn x\n```");
  const lost = create("Lost line\nlost::");
  await draw(lost.id);
  expect(await until("the import error", () => output(lost.id)[0])).toContain("no script nowhere-kit here; ep0ch ext ls");
});
