// Scripts in their Site (PIE-955, S5 of the self-reference wave): a script reads `this`, `self`, `caller` and `props`
// without a hard-coded id, `read` is the record, `resolve` answers like `{{ }}`, `q("parent:this")` works, a js script
// takes `week=42`, a rule-fired one is told the matched block, render mode draws a line in place and writes nothing,
// a script that writes into its own note goes on, `wait` is bounded, and one run can be stopped.
// Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { ScriptEnded } from "@ep0ch/outline-core/protocol";
import type { RuleListEntry } from "../src/extension-rules";
import { setup, until } from "./script-harness";

test("a script reads this, self, caller and props, with no id written in it", async () => {
  const { store, create, run } = await setup();
  const garden = create("Garden [owner::sam] [status::open]");
  create("Seed bed", garden.id);
  create("Water butt", garden.id);
  create("Elsewhere");
  const reader = create(`Site reader [SCRIPT::site-reader]
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

test("short answers and property-only runs leave no note; documents, views, explicit output and requested records are kept", async () => {
  const { store, create, client, extensionOf } = await setup();
  const ended = new Map<string, ScriptEnded>();
  let connected = false;
  const watcher = client.watch({ client: { clientId: "answer-reader", role: "observer", contextId: "answers" },
    onConnect: () => { connected = true; }, onEvent: e => { if (e.ended) ended.set(e.ended.run, e.ended); } });
  try {
    await until("the answer reader", () => connected);
    const note = create("Garden [colour::grey]");
    const cases = [
      { code: "return 'just words';", answer: "just words" },
      { code: "return 42;", answer: "42" },
      { code: "await tools.outline_set_property({ ref: this.id, key: 'colour', value: 'blue', revision: this.revision });", answer: "Plain done" },
      { code: "return 'One\\nTwo';", kept: "One\nTwo" },
      { code: "return { count: 42 };", kept: '{"count":42}' },
      { code: "return view.text({ text: 'Kept view' });", kept: "Kept view" },
      { code: "text('Kept output'); return 'Done';", answer: "Done", kept: "Kept output" },
      { code: "return 'Keep this answer';", answer: "Keep this answer", kept: "Keep this answer", record: true },
    ];
    for (const [i, scenario] of cases.entries()) {
      const name = `answer-${i}`;
      const script = create(`Plain [script::${name}] [effects::write]${scenario.record ? " [results::keep]" : ""}\n\`\`\`js\n${scenario.code}\n\`\`\``);
      const extension = await extensionOf(name);
      const run = await client.request<{ undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", blockId: note.id, clientId: "answer-reader" });
      const answer = await until("the script's answer", () => ended.get(run.undo));
      expect(answer.reason).toBe("done");
      if (scenario.answer) expect(answer.message).toBe(scenario.answer);
      const notes = store.children(script.id);
      if (scenario.kept) {
        expect(notes).toHaveLength(1);
        expect(notes[0]!.text).toContain(scenario.kept);
        expect(answer.written).toEqual([notes[0]!.id]);
      } else expect(notes).toEqual([]);
    }
    expect(store.require(note.id).text).toContain("[colour::blue]");
  } finally { await watcher.stop(); }
});

test("a rule-fired script is told the matched block as this, and its caller", async () => {
  const { store, create, client, extensionOf } = await setup();
  const script = create("Stamper [script::stamper] [results::keep]\n```js\nreturn `stamped ${this.title} from ${caller.block === this.id}`;\n```");
  // A script installed after the match takes it as its baseline and does not fire.
  await extensionOf("stamper");
  create("Stamp rule [rule-name::stamp] [rule-match::#shipit] [rule-on::script:stamper]");
  await until("the stamp rule to load", async () => (await client.request<{ rules: RuleListEntry[] }>({ action: "extensions.list" })).rules.some(rule => rule.name === "stamp"));
  const hit = create("Ship the beans #shipit");
  const note = await until("the run note", () => store.children(script.id).find(child => child.text.includes("stamped")));
  expect(note.text).toContain(`stamped ${hit.text.replace(" #shipit", "")} from true`);
}, 30_000);

test("render mode draws a line in place from its slots, redraws when a note it read changes, and writes nothing", async () => {
  const { store, client, create, output, draw } = await setup();
  const script = create(`Beds table [script::beds-table] [mode::render]
\`\`\`js
const owner = (await resolve("this.owner")).values[0];
return view.table({ columns: ["Owner", "Week"], rows: [[owner, props.week[0]]] });
\`\`\``);
  const note = create("Beds [owner::sam]\nbeds-table:: week=42");
  await draw(note.id);
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
  const { store, create, output, draw } = await setup();
  const other = create("Weather [sky::grey]");
  create(`Sky [script::sky] [mode::render]\n\`\`\`js\nreturn (await resolve("((${other.id})).sky")).values[0];\n\`\`\``);
  const note = create("Today\nsky::");
  await draw(note.id);
  expect(await until("grey", () => output(note.id)[0])).toBe("grey");
  store.update(other.id, "Weather [sky::blue]", store.get(other.id)!.revision, { author: "user" });
  await until("blue", () => output(note.id)[0] === "blue");
});

test("a ::= line is a one-line render-mode script", async () => {
  const { create, output, draw } = await setup();
  const note = create("Pipeline [owner::sam]\n::= (await resolve('this.owner')).values[0].toUpperCase()");
  await draw(note.id);
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
  create("Forever [script::forever] [results::keep]\n```js\nwhile (true) await wait(25);\n```");
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
  const { create, output, draw } = await setup();
  const target = create("Target");
  create(`Meddler [script::meddler] [mode::render]\n\`\`\`js\nawait tools.outline_comment({ ref: "${target.id}", whole: true, body: "hi" });\nreturn "wrote";\n\`\`\``);
  const note = create("Draw\nmeddler::");
  await draw(note.id);
  expect(await until("the refusal", () => output(note.id)[0])).toContain("read-only");
});

test("a render line is drawn again when its script's code changes, and when a query it ran finds a new match", async () => {
  const { store, create, client, output, draw } = await setup();
  const script = create("Count [script::todo-count] [mode::render]\n```js\nconst open = (await q('status=todo')).blocks.length;\nreturn `open: ${open}`;\n```");
  create("Wash the shed [status::todo]");
  const note = create("Chores\ntodo-count::");
  await draw(note.id);
  expect(await until("one open", () => output(note.id)[0])).toBe("open: 1");
  // A new match (no row of the old answer changed): drawn again.
  create("Mend the gate [status::todo]");
  await until("two open", () => output(note.id)[0] === "open: 2");
  // The code changes: drawn again, though nothing the code read did.
  store.update(script.id, store.get(script.id)!.text.replace("`open: ${open}`", "`todo: ${open}`"), store.get(script.id)!.revision, { author: "user" });
  await client.request({ action: "extensions.list", reload: true });
  await draw(note.id);
  await until("new wording", () => output(note.id)[0] === "todo: 2");
});

test("stop refuses a run's next call, and a script run on its own note has that note as this", async () => {
  const { store, client, create, extensionOf, run } = await setup();
  const looper = create("Reader loop [script::reader-loop] [results::keep]\n```js\nwhile (true) { await read(self.id); await wait(10); }\n```");
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
  const { store, client, create, output, draw } = await setup();
  const script = create("Kept words [script::kept-words] [mode::render]\n```js\nreturn 'sow the peas';\n```");
  const note = create("Plan\nkept-words::");
  await draw(note.id);
  await until("drawn", () => output(note.id)[0]);
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const extension = listed.extensions.find(e => e.name === "kept-words")!;
  await client.request({ action: "extensions.act", extension: extension.id, extensionAction: "keep", blockId: note.id, line: 1 });
  expect(store.children(note.id).map(c => c.text).join("\n")).toContain("sow the peas");
  expect(store.children(script.id)).toHaveLength(0);
});

test("a render script's view reaches a client as a view, its squares carrying the action they press; the text form carries none (PIE-981)", async () => {
  const { client, create } = await setup();
  create(`Move [script::ttt-move]\n\`\`\`js\nreturn "moved " + props.at[0];\n\`\`\``);
  create(`Board [script::ttt-board] [mode::render]\n\`\`\`js\nreturn view.stack({ children: [view.badge({ label: "5", act: "ttt-move at=5" })] });\n\`\`\``);
  const note = create("Game\nttt-board::");
  const projections = async () => (await client.request<{ projections: { kind?: string; output?: { markdown: string; component?: { view: unknown } } }[] }>({ action: "resources.projection.read", blockId: note.id, materialize: true })).projections;
  const drawn = await until("the board", async () => (await projections()).find(p => p.output)?.output);
  expect(JSON.stringify(drawn.component?.view)).toContain('"act":"ttt-move at=5"');
  expect(drawn.markdown).toContain("5");
  expect(drawn.markdown).not.toContain("ttt-move");
});

test("a script's write to a note a render line reads draws the line again, and the render line itself writes nothing (PIE-981)", async () => {
  const { store, client, create, output, run } = await setup();
  create(`Mark [script::mark-it] [effects::write]\n\`\`\`js\nawait tools.outline_set_property({ ref: this.id, key: "mark", value: "x", revision: this.revision });\nreturn "marked";\n\`\`\``);
  create(`Show [script::show-mark] [mode::render]\n\`\`\`js\nreturn "mark: " + ((await resolve("this.mark")).values?.[0] ?? "none");\n\`\`\``);
  const note = create("Square\nshow-mark::");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  await until("the first drawing", () => output(note.id)[0]?.includes("none"));
  await run("mark-it", { blockId: note.id });
  await until("the line drawn again after the script's write", () => output(note.id)[0]?.includes("mark: x"));
  expect(store.get(note.id)!.text).toContain("[mark::x]");
});

test("a script that acts on a door with none connected is refused with where to find one (PIE-957)", async () => {
  const { create, run } = await setup();
  create(`Ask door [script::ask-door] [effects::write]\n\`\`\`js\nawait act("actions", {});\nreturn "asked";\n\`\`\``);
  const note = create("Somewhere");
  const { text } = await run("ask-door", { blockId: note.id });
  expect(text).toContain("failed");
  expect(text).toMatch(/no door (on|here)/);
  expect(text).toContain("door=<client>");
});

test("a script's act with no door= uses the one connected door, which a client declares with app: \"door\", not by the look of its clientId (PIE-957)", async () => {
  const { client, create, run } = await setup();
  create(`Ask door [script::ask-one-door] [effects::write]\n\`\`\`js\nconst r = await act("actions", {});\nreturn "door said " + JSON.stringify(r);\n\`\`\``);
  const note = create("Somewhere else");
  // A client whose id merely looks like a door's is not one.
  const impostor = client.watch({ client: { clientId: "ep0ch-door-lookalike", role: "observer", contextId: "x" }, onEvent: () => {} });
  const asked: string[] = [];
  const door = client.watch({
    client: { clientId: "a-real-door", role: "observer", contextId: "y", app: "door" },
    onEvent: async event => {
      const call = (event as unknown as { script?: { requestId: string; targetClientId: string; action: string } }).script;
      if (event.domain !== "script" || !call || call.targetClientId !== "a-real-door") return;
      asked.push(call.action);
      await client.request({ action: "scripts.answer", requestId: call.requestId, clientId: "a-real-door", result: { ok: true } } as never);
    },
  });
  try {
    await until("both clients connected", async () => (await client.request<{ clientId: string }[]>({ action: "clients.list" })).length >= 2);
    const { text } = await run("ask-one-door", { blockId: note.id });
    expect(text).toContain("door said");
    expect(asked).toEqual(["actions"]);
  } finally { await impostor.stop(); await door.stop(); }
});

test("a line written before its script exists is drawn once the script is loaded, without being asked again", async () => {
  const { create, client, output } = await setup();
  const note = create("Later\nlate-bloomer::");
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  expect(output(note.id)).toEqual([]);
  create("Late [script::late-bloomer] [mode::render]\n```js\nreturn 'bloomed';\n```");
  expect(await until("the line drawn by the script's arrival", () => output(note.id)[0])).toBe("bloomed");
});


test("named fences register separately, resolve nearest first and keep their name when moved", async () => {
  const { store, create, client, draw, output } = await setup();
  const other = create("Elsewhere\n```js script=pair\nreturn 'far';\n```");
  const local = create("Workbench\n```js script=pair effects=write\nawait tools.outline_set_property({ ref: this.id, key: 'result', value: 'near', revision: this.revision });\nreturn 'near';\n```\n```js script=mark effects=write\nawait tools.outline_set_property({ ref: this.id, key: 'second', value: 'yes', revision: this.revision });\nreturn (await read(this.id)).title;\n```\n```js script=caption mode=render\nreturn 'drawn here';\n```\ncaption::\n::button{of=pair}");
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true, blockId: local.id });
  const pairs = listed.extensions.filter(e => e.name === "pair");
  expect(pairs.map(e => e.script?.blockId)).toEqual([local.id, other.id]);
  expect(pairs[0]!.description).toContain(other.id);
  expect(listed.extensions.find(e => e.name === "mark")?.actions[0]?.effects).toBe("write");
  await draw(local.id);
  expect(await until("the named render fence", () => output(local.id)[0])).toBe("drawn here");
  const second = listed.extensions.find(e => e.name === "mark")!;
  await client.request({ action: "extensions.act", extension: second.id, extensionAction: "run", blockId: local.id });
  await until("the second fence's write", () => store.require(local.id).text.includes("[second::yes]"));
  const run = await client.request<{ undo: string }>({ action: "extensions.act", extension: "script:pair", extensionAction: "run", blockId: local.id });
  await until("the nearest fence's write", () => store.get(local.id)!.text.includes("[result::near]"));
  expect(run.undo).toBeTruthy();
  const current = store.require(local.id);
  const fence = current.text.slice(current.text.indexOf("```js script=pair"), current.text.indexOf("```js script=mark"));
  store.update(local.id, current.text.replace(fence, ""), current.revision, { author: "user" });
  const moved = create("Pair on its own [script::pair]\n" + fence);
  // Remove the other definition so the unchanged button now finds the relocated fence by name.
  store.update(other.id, "Elsewhere", store.require(other.id).revision, { author: "user" });
  const after = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true, blockId: local.id });
  expect(after.extensions.filter(e => e.name === "pair").map(e => e.script?.blockId)).toEqual([moved.id]);
  store.update(local.id, store.require(local.id).text.replace("[result::near]", "[result::ready]"), store.require(local.id).revision, { author: "user" });
  await client.request({ action: "extensions.act", extension: "script:pair", extensionAction: "run", blockId: local.id });
  await until("the relocated fence's write", () => store.require(local.id).text.includes("[result::near]"));
});


test("a note script never borrows a differently named fence", async () => {
  const { store, create, client, run } = await setup();
  const note = create("Outer [script::outer] [effects::write]\n```js script=inner effects=read\nreturn 'inner';\n```");
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "outer" && e.state === "active")).toBeUndefined();
  expect(listed.extensions.find(e => e.name === "inner")?.actions[0]?.effects).toBe("read");
  store.update(note.id, note.text + "\n```js\nreturn 'outer';\n```", note.revision, { author: "user" });
  expect((await run("outer")).text.split("\n").pop()).toBe("outer");
});

test("moving a named fence preserves its explicit effects and ordinary note effects do not configure it", async () => {
  const { store, create, client } = await setup();
  const note = create("Workbench [effects::write]");
  const target = create("Garden");
  const settings: ("read" | "write" | undefined)[] = ["read", "write", undefined];
  for (const effects of settings) {
    const fence = "```js script=traveller" + (effects ? ` effects=${effects}` : "") + "\nawait tools.outline_set_property({ ref: this.id, key: 'visited', value: 'yes', revision: this.revision });\nreturn 'visited';\n```";
    for (const matching of [false, true, false]) {
      const current = store.require(note.id);
      store.update(note.id, `Workbench [effects::${matching ? "read" : "write"}] [results::keep]${matching ? " [script::traveller]" : ""}\n${fence}`, current.revision, { author: "user" });
      const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
      const entry = listed.extensions.find(e => e.name === "traveller")!;
      expect(entry.actions[0]?.effects).toBe(effects ?? "read");
      const before = store.children(note.id).map(b => b.id);
      await client.request({ action: "extensions.act", extension: entry.id, extensionAction: "run", blockId: target.id });
      const answer = await until("the moved fence's answer", () => store.children(note.id).find(b => !before.includes(b.id) && !b.text.split("\n")[0]!.includes("· working")));
      if (effects === "write") {
        expect(answer.text.split("\n").pop()).toBe("visited");
        expect(store.require(target.id).text).toContain("[visited::yes]");
      } else {
        expect(answer.text).toContain("read-only");
      }
    }
  }
});

test("removing a failed named fence removes its registry entry without a manual reload", async () => {
  const { store, create, client } = await setup();
  for (const fence of ["```js script=unfinished\nreturn 'x';", "```js script=invalid effects=write mode=render\nreturn 'x';\n```"]) {
    const note = create("Workbench\n" + fence);
    const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
    const failed = listed.extensions.find(e => e.state === "failed" && e.error?.includes(fence.includes("unfinished") ? "closed" : "mode=render"))!;
    expect(failed?.error).toBeTruthy();
    store.update(note.id, "Workbench", note.revision, { author: "user" });
    await until("the removed failed fence to disappear", async () => {
      const current = await client.request<ExtensionsListResult>({ action: "extensions.list" });
      return !current.extensions.some(e => e.id === failed.id);
    }, 1000);
  }
});


test("running by block id chooses the note script and refuses an unnamed choice between scripts", async () => {
  const { store, create, client } = await setup();
  store.configureMcpAccess("full");
  const note = create("Outer [script::outer] [results::keep]\n```js script=inner effects=write\nreturn 'inner';\n```\n```js script=outer effects=read\nreturn 'outer';\n```");
  const started = await client.request<{ written: string[] }>({ action: "scripts.run", blockId: note.id, access: "full", mutation: { author: "agent", actorId: "script-reader" } });
  const answer = await until("the block's own script answer", () => store.get(started.written[0]!)?.text.includes("· done") && store.get(started.written[0]!)!.text);
  expect(answer.split("\n").pop()).toBe("outer");
  store.update(note.id, store.require(note.id).text.replace(" [script::outer]", ""), store.require(note.id).revision, { author: "user" });
  await expect(client.request({ action: "scripts.run", blockId: note.id, access: "full", mutation: { author: "agent", actorId: "script-reader" } })).rejects.toThrow(/(inner.*outer|outer.*inner)/);
});

test.each([true, false])("narrowing effects while a script waits revokes its next write (named fence: %s)", async (named) => {
  const { store, create, client, extensionOf } = await setup();
  const target = create("Garden");
  const gate = create("Closed gate");
  const code = `await tools.outline_set_property({ ref: this.id, key: 'waiting', value: 'yes', revision: this.revision });
while ((await read('${gate.id}')).title !== 'Open gate') await wait(10);
const current = await read(this.id);
await tools.outline_set_property({ ref: this.id, key: 'after', value: 'yes', revision: current.revision });
return 'wrote after revocation';`;
  const note = create(`Writer [results::keep]${named ? "" : " [script::revocable] [effects::write]"}\n\`\`\`js${named ? " script=revocable effects=write" : ""}\n${code}\n\`\`\``);
  const extension = await extensionOf("revocable");
  const started = await client.request<{ written: string[] }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", blockId: target.id });
  await until("the script's first write", () => store.require(target.id).text.includes("[waiting::yes]"));
  await until("the script waiting at the closed gate", () => store.require(started.written[0]!).text.includes("Closed gate"));
  const current = store.require(note.id);
  store.update(note.id, current.text.replace(named ? "effects=write" : "[effects::write]", named ? "effects=read" : "[effects::read]"), current.revision, { author: "user" });
  store.update(gate.id, "Open gate", gate.revision, { author: "user" });
  const answer = await until("the revoked run's answer", () => {
    const text = store.require(started.written[0]!).text;
    return !text.split("\n")[0]!.includes("· working") && text;
  });
  expect(answer.split("\n").pop()).toContain("read-only");
  expect(store.require(target.id).text).not.toContain("[after::yes]");
});

test("removing a failed fence in a draft hides its saved registry error", async () => {
  const { create, client } = await setup();
  const note = create("Workbench\n```js script=draft-broken effects=write mode=render\nreturn 'x';\n```");
  const saved = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const failed = saved.extensions.find(e => e.state === "failed" && e.error?.includes("mode=render"))!;
  expect(failed?.error).toBeTruthy();
  const draft = await client.request<ExtensionsListResult>({ action: "extensions.list", blockId: note.id, draft: { text: "Workbench" } });
  expect(draft.extensions.find(e => e.id === failed.id)).toBeUndefined();
  expect((await client.request<ExtensionsListResult>({ action: "extensions.list" })).extensions.find(e => e.id === failed.id)?.error).toBeTruthy();
});
