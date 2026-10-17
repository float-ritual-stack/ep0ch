// Scripts in their Site (PIE-955, S5 of the self-reference wave): a script reads `this`, `self`, `caller` and `props`
// without a hard-coded id, `read` is the record, `resolve` answers like `{{ }}`, `q("parent:this")` works, a js script
// takes `week=42`, a rule-fired one is told the matched block, render mode draws a line in place and writes nothing,
// a script that writes into its own note goes on, `wait` is bounded, and one run can be stopped.
// Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import type { ExtensionsListResult } from "../src/extension-registry";
import { setup, until } from "./script-harness";

test("a script reads this, self, caller and props, with no id written in it", async () => {
  const { store, create, run } = await setup();
  const garden = create("Garden [owner::sam] [status::open]");
  create("Seed bed", garden.id);
  create("Water butt", garden.id);
  create("Elsewhere");
  const reader = create(`Site reader [script::site-reader]
\`\`\`js
const kids = (await q("parent:this")).blocks.map(b => b.title).sort();
const owner = await resolve("this.owner");
const missing = await resolve("this.colour");
const mine = await read(self.id);
return JSON.stringify({ here: this.title, mine: self.title, week: props.week, kids, owner: owner.values, problem: !!missing.problem, header: Array.isArray(mine.header), tasks: Array.isArray(mine.tasks), caller: caller });
\`\`\``);
  const ran = await run("site-reader", { blockId: garden.id, args: { week: "42" } });
  const answer = JSON.parse(ran.text.split("\n").pop()!);
  // The run note quotes ((ids)) it read: bookkeeping, so it's no backlink on the script's note or the garden.
  expect(ran.text.split("\n")[0]).toContain("[machine::script]");
  expect(store.queryBacklinks({ targetBlockId: reader.id, limit: 50 }).sources).toEqual([]);
  expect(store.queryBacklinks({ targetBlockId: garden.id, limit: 50 }).sources).toEqual([]);
  expect(answer).toEqual({ here: "Garden", mine: "Site reader", week: ["42"], kids: ["Seed bed", "Water butt"], owner: ["sam"], problem: true, header: true, tasks: true, caller: null });
});

test("a returned string shows as plain text, and a run with no note says why this is empty", async () => {
  const { create, run } = await setup();
  create("Plain [script::plain]\n```js\nreturn 'just words';\n```");
  create("Blind [script::blind]\n```js\nreturn this.title;\n```");
  const plain = await run("plain");
  expect(plain.text.split("\n").pop()).toBe("just words");
  const blind = await run("blind");
  expect(blind.text).toContain("· failed");
  expect(blind.text).toContain("this run has no note; pass at= or run it from a note");
});

test("a rule-fired script is told the matched block as this, and its caller", async () => {
  const { store, create } = await setup();
  const script = create("Stamper [script::stamper]\n```js\nreturn `stamped ${this.title} from ${caller.block === this.id}`;\n```");
  create("Stamp rule [rule-name::stamp] [rule-match::#shipit] [rule-on::script:stamper]");
  await until("the rule", async () => store.queryBlocks({ where: "rule-name" }).blocks.length === 1);
  await Bun.sleep(100);
  const hit = create("Ship the beans #shipit");
  const note = await until("the run note", () => store.children(script.id).find(child => child.text.includes("stamped")));
  expect(note.text).toContain(`stamped ${hit.text.replace(" #shipit", "")} from true`);
});

test("render mode draws a line in place from its slots, redraws when a note it read changes, and writes nothing", async () => {
  const { store, client, create, output } = await setup();
  const script = create(`Beds table [script::beds-table] [mode::render]
\`\`\`js
const owner = (await resolve("this.owner")).values[0];
return view.table({ columns: ["Owner", "Week"], rows: [[owner, props.week[0]]] });
\`\`\``);
  const note = create("Beds [owner::sam]\nbeds-table:: week=42");
  const draw = () => client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  await draw();
  const first = await until("the first drawing", () => output(note.id)[0]);
  expect(first).toContain("Owner");
  expect(first).toContain("sam");
  expect(first).toContain("42");
  expect(first).not.toContain('"columns"');
  // Drawing again and again leaves the outline exactly as it was: no block, no revision.
  const before = JSON.stringify([store.queryBlocks({ where: "" }).blocks.length, store.get(note.id)!.revision, store.get(script.id)!.revision, store.children(script.id).length]);
  for (let i = 0; i < 3; i++) await client.request({ action: "resources.projection.refresh", blockId: note.id });
  expect(JSON.stringify([store.queryBlocks({ where: "" }).blocks.length, store.get(note.id)!.revision, store.get(script.id)!.revision, store.children(script.id).length])).toBe(before);
  // The note it reads changes: the line is drawn again without a press.
  store.update(note.id, "Beds [owner::robin]\nbeds-table:: week=42", store.get(note.id)!.revision, { author: "user" });
  await until("the redraw", () => output(note.id)[0]?.includes("robin"));
  expect(output(note.id)[0]).not.toContain("sam");
});

test("a script a render line reads another note through is drawn again when that note changes", async () => {
  const { store, create, client, output } = await setup();
  const other = create("Weather [sky::grey]");
  create(`Sky [script::sky] [mode::render]\n\`\`\`js\nreturn (await resolve("((${other.id})).sky")).values[0];\n\`\`\``);
  const note = create("Today\nsky::");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  expect(await until("grey", () => output(note.id)[0])).toBe("grey");
  store.update(other.id, "Weather [sky::blue]", store.get(other.id)!.revision, { author: "user" });
  await until("blue", () => output(note.id)[0] === "blue");
});

test("a ::= line is a one-line render-mode script", async () => {
  const { create, client, output } = await setup();
  const note = create("Pipeline [owner::sam]\n::= (await resolve('this.owner')).values[0].toUpperCase()");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  expect(await until("the line", () => output(note.id)[0])).toBe("SAM");
});

test("a render script that declares effects=write isn't served, and says why", async () => {
  const { create, client } = await setup();
  create("Writer [script::drawer-writer] [mode::render] [effects::write]\n```js\nreturn 'x';\n```");
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const slot = JSON.stringify(listed.extensions.filter(e => e.name === "drawer-writer")) + JSON.stringify((listed as { errors?: unknown }).errors ?? []);
  expect(slot + JSON.stringify(listed)).toContain("draws a view and never writes");
});

test("a script that writes into its own note keeps running to the end", async () => {
  const { store, create, run } = await setup();
  const script = create(`Self writer [script::self-writer] [effects::write]
\`\`\`js
const me = await read(self.id);
await tools.outline_set_property({ ref: self.id, key: "ran", value: "yes", revision: me.revision });
await wait(30);
return "finished after writing";
\`\`\``);
  const ran = await run("self-writer");
  expect(ran.text).toContain("· done");
  expect(ran.text).toContain("finished after writing");
  expect(store.get(script.id)!.text).toContain("[ran::yes]");
});

test("wait is bounded by the script's deadline, and stop ends one run", async () => {
  const { client, store, create, extensionOf, run } = await setup();
  create("Sleeper [script::sleeper] [deadline::1s]\n```js\nawait wait(60000);\nreturn 'never';\n```");
  const slept = await run("sleeper");
  expect(slept.text).toContain("· failed");
  expect(slept.text).toContain("past its deadline");
  create("Forever [script::forever]\n```js\nwhile (true) await wait(25);\n```");
  const extension = await extensionOf("forever");
  const started = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run" });
  await Bun.sleep(150);
  expect(store.get(started.written[0]!)!.text).toContain("· working");
  expect(await client.request({ action: "scripts.stop", run: started.undo })).toMatchObject({ stopped: true });
  await until("the stopped run", () => store.get(started.written[0]!)!.text.includes("· failed"));
  expect(store.get(started.written[0]!)!.text).toContain("Stopped by");
  expect(await client.request({ action: "scripts.stop", run: started.undo })).toMatchObject({ stopped: false });
});

test("a read-only render script can't write: its write is refused", async () => {
  const { create, client, output } = await setup();
  const target = create("Target");
  create(`Meddler [script::meddler] [mode::render]\n\`\`\`js\nawait tools.outline_comment({ ref: "${target.id}", whole: true, body: "hi" });\nreturn "wrote";\n\`\`\``);
  const note = create("Draw\nmeddler::");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  expect(await until("the refusal", () => output(note.id)[0])).toContain("read-only");
});

test("a render line is drawn again when its script's code changes, and when a query it ran finds a new match", async () => {
  const { store, create, client, output } = await setup();
  const script = create("Count [script::todo-count] [mode::render]\n```js\nconst open = (await q('status=todo')).blocks.length;\nreturn `open: ${open}`;\n```");
  create("Wash the shed [status::todo]");
  const note = create("Chores\ntodo-count::");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  expect(await until("one open", () => output(note.id)[0])).toBe("open: 1");
  // A new match (no row of the old answer changed): drawn again.
  create("Mend the gate [status::todo]");
  await until("two open", () => output(note.id)[0] === "open: 2");
  // The code changes: drawn again, though nothing the code read did.
  store.update(script.id, store.get(script.id)!.text.replace("`open: ${open}`", "`todo: ${open}`"), store.get(script.id)!.revision, { author: "user" });
  await client.request({ action: "extensions.list", reload: true });
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  await until("new wording", () => output(note.id)[0] === "todo: 2");
});

test("stop refuses a run's next call, and a script run on its own note has that note as this", async () => {
  const { store, client, create, extensionOf, run } = await setup();
  const looper = create("Reader loop [script::reader-loop]\n```js\nwhile (true) { await read(self.id); await wait(10); }\n```");
  const extension = await extensionOf("reader-loop");
  const started = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run" });
  await Bun.sleep(100);
  await client.request({ action: "scripts.stop", run: started.undo });
  await until("the stopped run", () => store.get(started.written[0]!)!.text.split("\n")[0]!.includes("failed"));
  const steps = (store.get(started.written[0]!)!.text.match(/outline_read/g) ?? []).length;
  await Bun.sleep(150);
  expect((store.get(started.written[0]!)!.text.match(/outline_read/g) ?? []).length).toBe(steps);
  create("Own [script::own]\n```js\nreturn this.title;\n```");
  const own = await run("own", { blockId: store.queryBlocks({ where: "script=own" }).blocks[0]!.id });
  expect(own.text.split("\n").pop()).toBe("Own");
  expect(looper.id).toBeTruthy();
});

test("keep on a render line writes its output as a note and starts no run", async () => {
  const { store, client, create, output } = await setup();
  const script = create("Kept words [script::kept-words] [mode::render]\n```js\nreturn 'sow the peas';\n```");
  const note = create("Plan\nkept-words::");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  await until("drawn", () => output(note.id)[0]);
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const extension = listed.extensions.find(e => e.name === "kept-words")!;
  await client.request({ action: "extensions.act", extension: extension.id, extensionAction: "keep", blockId: note.id, line: 1 });
  expect(store.children(note.id).map(c => c.text).join("\n")).toContain("sow the peas");
  expect(store.children(script.id)).toHaveLength(0);
});
