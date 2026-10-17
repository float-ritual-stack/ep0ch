// PIE-982: the scripts reference (docs/scripts.md) says what the code does. Its generated tables (the tools, the view
// builders) are rewritten from the code, its `path:line` pointers still land on what they name, the globals and traps it
// lists are real in a sandbox, and each worked example is created from the page itself, drawn or run, and compared with
// the page's own "shows" block. When one of these fails the page is stale: `bun scripts/scripts-doc.ts` rewrites the
// tables, and the message names a pointer to move. Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIMITIVE_TYPES } from "../src/component-primitives";
import { scriptExamples, SCRIPTS_DOC_FILE, type ScriptExample } from "../src/script-examples";
import { stalePointers, withGenerated } from "../scripts/scripts-doc";
import { setup, until } from "./script-harness";

const page = readFileSync(SCRIPTS_DOC_FILE, "utf8");

test("the page's generated tables are what the code says, and its pointers still land", () => {
  expect(withGenerated(page) === page ? "fresh" : "stale: run `bun packages/outliner/scripts/scripts-doc.ts` and commit the page").toBe("fresh");
  expect(stalePointers(page)).toEqual([]);
});

test("the pointer check notices a pointer that moved, or a file that is gone", () => {
  expect(stalePointers("| `read` | `packages/outliner/src/host-api.ts:1` |")).toHaveLength(1);
  expect(stalePointers("| `read` | `packages/outliner/src/no-such-file.ts:1` |")).toHaveLength(1);
  const at = readFileSync(join(import.meta.dir, "../src/host-api.ts"), "utf8").split("\n").findIndex(line => line.includes("const read = async")) + 1;
  expect(stalePointers(`| \`read\` | \`packages/outliner/src/host-api.ts:${at}\` |`)).toEqual([]);
});

/** A script that reports what its sandbox holds, run on a note that has one child. */
async function surface() {
  const { create, run } = await setup();
  const host = create("Host [owner::sam]");
  create(`Surface [script::surface]
\`\`\`js
const kids = (await q("parent:this")).blocks;
return {
  tools: Object.keys(tools), builders: Object.keys(view),
  kinds: Object.fromEntries(["q", "read", "resolve", "act", "wait", "text", "console", "exit", "now", "stop", "fetch"].map(n => [n, typeof globalThis[n]])),
  caller, props, childrenOfThis: this.children, row: Object.keys(kids[0] ?? {}).sort(),
};
\`\`\``);
  create("Child [qty::2]", host.id);
  const ran = await run("surface", { blockId: host.id });
  if (!ran.text.includes("· done")) throw new Error(ran.text);
  return JSON.parse(ran.text.split("\n").pop()!);
}
const documented = (heading: string) => [...page.matchAll(new RegExp(`^\\| \`${heading}\\.(\\w+)\``, "gm"))].map(m => m[1]!);

test("the tools and view builders the page lists are the ones a script sees", async () => {
  const seen = await surface();
  expect(seen.tools).toEqual(documented("tools"));
  expect(seen.builders).toEqual(documented("view"));
  expect(seen.builders).toEqual([...PRIMITIVE_TYPES]);
});

test("the functions the page lists exist, and the globals it says are absent are", async () => {
  expect((await surface()).kinds).toMatchObject({ q: "function", read: "function", resolve: "function", act: "function", wait: "function", text: "function", console: "object", exit: "function", now: "undefined", stop: "undefined", fetch: "undefined" });
});

test("the traps: this has no children, a q row has no properties, caller and props are empty off a line", async () => {
  const seen = await surface();
  expect(seen.childrenOfThis).toEqual([]);
  expect(seen.row).toEqual(["id", "parentId", "revision", "title", "updated"]);
  expect(seen.caller).toBeNull();
  expect(seen.props).toEqual({});
});

test("a read-only script's write is refused, a render can't act, and an arrow function keeps this", async () => {
  const { create, run } = await setup();
  const host = create("Host");
  create("Reader [script::reader-only]\n```js\nawait tools.outline_create({ parent: this.id, text: 'x' });\n```");
  expect((await run("reader-only", { blockId: host.id })).text).toContain("This script is read-only; declare effects=write to write");
  create("Nope [script::nope]\n```js\ntry { await tools.nope({}); } catch (e) { return e.name; }\n```");
  expect((await run("nope", { blockId: host.id })).text.split("\n").pop()).toBe("TypeError");
  create("Arrows [script::arrows]\n```js\nconst ok = [1].map(() => this.title)[0];\nconst lost = [1].map(function () { return this?.title; })[0];\nreturn JSON.stringify({ ok, lost: lost ?? null });\n```");
  expect(JSON.parse((await run("arrows", { blockId: host.id })).text.split("\n").pop()!)).toEqual({ ok: "Host", lost: null });
});

// ── The worked examples ────────────────────────────────────────────────────────────────────────

const examples = scriptExamples(page);

/** An example's notes made on a scratch service, in the page's order: `parent=` nests one under an earlier note. */
async function paste(example: ScriptExample) {
  const world = await setup();
  const made = new Map<string, ReturnType<typeof world.create>>();
  const settled = async () => { await world.client.request({ action: "extensions.list", reload: true }); await Bun.sleep(120); };
  for (const note of example.notes) {
    if (note.parent && !made.has(note.parent)) throw new Error(`${note.label}: its parent ${note.parent} isn't an earlier note of the example`);
    made.set(note.label, world.create(note.text, note.parent ? made.get(note.parent)!.id : null));
    // A rule is read once the service has loaded it; a script, once it is listed.
    if (/\[(?:script|rule-name)::/.test(note.text.split("\n")[0]!)) await settled();
  }
  const drawn = async (label: string, wanted?: (text: string) => boolean) => {
    const id = made.get(label)!.id;
    await world.client.request({ action: "resources.projection.read", blockId: id, materialize: true });
    return until(`${label} to be drawn`, () => { const out = world.output(id)[0]; return out && (!wanted || wanted(out)) ? out : undefined; });
  };
  return { ...world, made, drawn };
}

test("the examples the page promises are all there", () => {
  expect(examples.map(e => e.example)).toEqual([1, 2, 3, 4, 5]);
  for (const example of examples) {
    expect(example.notes.length, `example ${example.example} has notes to paste`).toBeGreaterThan(0);
    expect(example.shows.trim(), `example ${example.example} says what it shows`).not.toBe("");
  }
});

test("example 1: a sentence from the note's own properties and a slot", async () => {
  const example = examples.find(e => e.example === 1)!;
  const { drawn, made, store } = await paste(example);
  expect(await drawn("ex1-bed")).toBe(example.shows.trim());
  // It redraws when the note changes, and writes nothing.
  const bed = made.get("ex1-bed")!, revision = store.get(bed.id)!.revision;
  store.update(bed.id, store.get(bed.id)!.text.replace("[owner::Sam]", "[owner::Robin]"), revision, { author: "user" });
  await until("the redraw", async () => (await drawn("ex1-bed", out => out.startsWith("Robin"))));
  expect(store.children(bed.id)).toHaveLength(0);
});

test("example 2: the table of children, with its computed column, draws again when a child changes or arrives", async () => {
  const example = examples.find(e => e.example === 2)!;
  const { drawn, made, store, create } = await paste(example);
  expect(await drawn("ex2-order")).toBe(example.shows.trim());
  const beans = made.get("ex2-beans")!;
  store.update(beans.id, "Beans [qty::6] [price::2]", store.get(beans.id)!.revision, { author: "user" });
  expect(await drawn("ex2-order", out => out.includes("| Beans | 6 | 2 | 12 |"))).toContain("| Total |  |  | 24 |");
  create("Kale [qty::2] [price::3]", made.get("ex2-order")!.id);
  expect(await drawn("ex2-order", out => out.includes("Kale"))).toContain("| Total |  |  | 30 |");
});

test("example 3: the board is a property; a move changes it and the drawing follows", async () => {
  const example = examples.find(e => e.example === 3)!;
  const { drawn, made, store, run } = await paste(example);
  const game = made.get("ex3-game")!;
  expect(await drawn("ex3-game")).toBe(example.shows.trim());
  for (const cell of [5, 1, 9]) {
    const ran = await run("ttt-play", { blockId: game.id, args: { cell: String(cell) } });
    expect(ran.text).toContain("· done");
  }
  expect(store.get(game.id)!.text).toContain("[board::O...X...X]");
  expect(await drawn("ex3-game", out => out.includes("X wins") || out.includes("O to play"))).toContain("O to play");
  // An occupied cell is refused, with why.
  expect((await run("ttt-play", { blockId: game.id, args: { cell: "5" } })).text).toContain("cell 5 is taken");
  expect(store.get(game.id)!.text).toContain("[board::O...X...X]");
  // Three in a diagonal wins.
  const playing = store.get(game.id)!;
  store.update(game.id, playing.text.replace("O...X...X", "XO..X...X"), playing.revision, { author: "user" });
  expect(await drawn("ex3-game", out => out.includes("wins"))).toContain("X wins");
});

test("example 5: the same table by query and read, sorted", async () => {
  const example = examples.find(e => e.example === 5)!;
  const { drawn } = await paste(example);
  expect(await drawn("ex5-host")).toBe(example.shows.trim());
});

test("example 4: the rule stamps the template under every match", async () => {
  const example = examples.find(e => e.example === 4)!;
  const { made, store, create } = await paste({ ...example, notes: example.notes.filter(n => n.label !== "ex4-match") });
  const match = create(example.notes.find(n => n.label === "ex4-match")!.text);
  const stamped = await until("the stamped list", () => store.children(match.id)[0]);
  expect(stamped.text).toBe(example.shows.trim());
  // A second match is stamped on its own; the first keeps just one list.
  const second = create("Peas for the swap #shipit");
  await until("the second list", () => store.children(second.id)[0]);
  expect(store.children(match.id)).toHaveLength(1);
  expect(made.get("ex4-script")).toBeTruthy();
});
