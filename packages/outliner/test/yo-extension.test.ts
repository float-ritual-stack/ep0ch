// PIE-1585: yo's words come from the actions' own records, and code decides. The model is a made-up command here.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { argsOf, asksHow, buttonIn, buttonLine, doneRow, isGo, keysOf, labelOf, lastAnswer, lastButton, memoryText, planOf, planPrompt, pressLine, quoted, quoteOf, ranked, recalled, sections, shortReason, type ActionRecord } from "../extensions/yo/yo-line";

const LIFT: ActionRecord = {
  name: "barrow.lift", summary: "lift the barrow above the bench as a column (reach=full: across the shed), wherever it is: the one you used last. Again drops it",
  keys: [{ keys: "✦b", does: "lift it" }, { via: 'a status-bar button (::button{label="▲ lift" act="barrow.lift"} in your bar note)' }, { keys: "^W Z", does: "on its tile" }],
  args: { reach: { type: "string", optional: true }, on: { type: "boolean", optional: true } },
};
const WATER: ActionRecord = { name: "tray.water", summary: "water the tray by=<cm> from the can", keys: "click", args: { by: { type: "number" } } };

test("a quote is the action's own words, cut at a clause, and its keys its own rows", () => {
  const q = quoteOf(LIFT);
  expect(q).toBe("lift the barrow above the bench as a column");
  expect(LIFT.summary.startsWith(q)).toBe(true);
  expect(quoted(LIFT)).toEqual(['`barrow.lift`: "lift the barrow above the bench as a column"', "keys: ✦b · ^W Z"]);
  expect(quoteOf({ ...LIFT, words: "lift this barrow" })).toBe("lift this barrow");
  expect(keysOf(WATER)).toBe("click");
});

test("a long refusal in a step ends at a sentence, never inside a code span", () => {
  const missing = 'No outline named "yo" in /srv/outlines/of/this/machine. Nothing was created (a read never makes one). Which machines have it: `ep0ch outline list --all`; to make it here on purpose: `ep0ch outline create yo`';
  expect(shortReason(missing)).toBe('No outline named "yo" in /srv/outlines/of/this/machine. Nothing was created (a read never makes one)');
  expect(shortReason("short\nand a second line")).toBe("short");
  const word = `run \`${"x".repeat(170)}\` first`;
  expect(shortReason(word)).toBe("run…");
  expect(shortReason("y".repeat(200))).toBe(`${"y".repeat(159)}…`);
  // A sentence end inside a code span isn't one: the cut is the sentence before the span.
  const inCode = `The model refused it. Its words were \`invalid query? ${"z ".repeat(60)}\` and it stopped there for good.`;
  expect(shortReason(inCode)).toBe("The model refused it");
});

test("the button takes the label its doc gives, asks for a required argument, and a press remembers", () => {
  expect(labelOf(LIFT)).toBe("▲ lift");
  expect(labelOf(WATER)).toBe("▸ water");
  expect(pressLine(WATER)).toEqual({ line: "tray.water by={by}", slots: ["by"] });
  expect(pressLine(LIFT, { reach: "full", nonsense: "x", on: "a b" }).line).toBe("barrow.lift reach=full");
  const line = buttonLine(LIFT, pressLine(LIFT), "how do I lift the barrow again");
  expect(line).toBe('::button{label="▲ lift" act=["barrow.lift", "ext.yo.remember act=barrow.lift asked=lift-barrow"]}');
  expect(buttonIn(`> ${line}`)).toEqual({ label: "▲ lift", act: "barrow.lift" });
  expect(buttonIn(buttonLine(WATER, pressLine(WATER), "water it"))).toEqual({ label: "▸ water", act: "tray.water by={by}" });
  expect(buttonLine(LIFT, pressLine(LIFT), "lift it", { thread: true })).toBe("[▲ lift](act: barrow.lift)");
  expect(buttonIn("✓ yo pressed ▲ lift · [undo](act: ext.undo run=abc)")).toBeNull();
  expect(lastButton(["[▲ lift](act: barrow.lift)", "words", "[▸ water](act: tray.water)"])?.act).toBe("tray.water");
});

test("code decides: do it needs no model, memory matches on words, and a plan names only what was offered", () => {
  for (const go of ["do it", "Yes!", "press it", "go ahead"]) expect(isGo(go)).toBe(true);
  expect(isGo("do it tomorrow in the shed")).toBe(false);
  const memory = [{ id: "m", asked: "lift barrow", action: "barrow.lift", line: "barrow.lift", kind: "answer", text: "lift barrow: barrow.lift" }];
  expect(recalled(memory, "how do I lift the barrow again")).toEqual({ hit: memory[0]! });
  expect(recalled(memory, "lift")).toEqual({ hit: memory[0]! });
  expect(recalled(memory, "water the tray")).toEqual({});
  expect(memoryText("how do I lift the barrow again", "barrow.lift")).toBe("lift barrow: barrow.lift [yo-memory::answer] [yo-action::barrow.lift] [yo-asked::lift barrow] [yo-line::barrow.lift]");
  expect(ranked([WATER, LIFT], "how do I lift the barrow")[0]!.name).toBe("barrow.lift");
  expect(planOf({ kind: "quote", action: "made.up" }, [LIFT], [])).toBeNull();
  expect(planOf({ kind: "act", action: "barrow.lift", args: { reach: "full" } }, [LIFT], [])).toEqual({ kind: "act", action: "barrow.lift", args: { reach: "full" } });
  expect(planOf({ kind: "doc", quote: "not in the doc" }, [], ["# Doc\nthe real line"])).toBeNull();
  expect(planOf({ kind: "doc", quote: "the real line" }, [], ["# Doc\nthe real line"])).toEqual({ kind: "doc", quote: "the real line" });
  expect(sections("# A\nlift lift lift\n# B\nnothing", "lift")[0]).toContain("# A");
});

const note = (asked: string, action: string, line = action) => ({ id: `${asked}/${line}`, asked, action, line, kind: "answer", text: `${asked}: ${line}` });

test("memory: an exact ask wins whatever order the notes are in; broader notes that disagree are a conflict, never a guess", () => {
  const broad = note("lift barrow", "barrow.lift"), exact = note("lift", "tray.lift");
  for (const notes of [[broad, exact], [exact, broad]]) expect(recalled(notes, "lift")).toEqual({ hit: exact });
  const other = note("lift tray", "tray.lift");
  expect(recalled([broad, other], "lift").conflict?.map(m => m.action)).toEqual(["barrow.lift", "tray.lift"]);
  expect(recalled([broad, note("lift barrow high", "barrow.lift")], "lift").hit?.action).toBe("barrow.lift");
  expect(recalled([note("lift", "barrow.lift"), note("lift", "tray.lift")], "lift").conflict?.length).toBe(2);
});

test("memory keeps the arguments that worked, never the tile they ran in", () => {
  const remembered = memoryText("drop the barrow", "barrow.lift on=false tile=t-1");
  expect(remembered).toBe("drop barrow: barrow.lift on=false [yo-memory::answer] [yo-action::barrow.lift] [yo-asked::drop barrow] [yo-line::barrow.lift on=false]");
  expect(argsOf("barrow.lift on=false reach=full tile=t-1")).toEqual({ on: "false", reach: "full" });
  expect(buttonLine(LIFT, pressLine(LIFT, argsOf("barrow.lift on=false")), "drop the barrow")).toBe('::button{label="▲ lift" act=["barrow.lift on=false", "ext.yo.remember act=barrow.lift asked=drop-barrow args=on:false"]}');
});

test("do it is tied to yo's own last answer: another button below it is not pressed, and an answer with none presses nothing", () => {
  const ask = "@yo lift the barrow", fold = ["> [!note]+ @yo answered", '> ::button{label="▲ lift" act="barrow.lift"}', "> > [!note]- 2 steps", "> > - read"];
  const lines = ["Shed", ask, ...fold, "", '::button{label="close" act="tile.close"}', "[bin it](act: note.trash)"];
  expect(lastAnswer(lines)).toEqual({ ask: "lift the barrow", button: { line: fold[1]!, label: "▲ lift", act: "barrow.lift" } });
  expect(lastAnswer(["Shed", '::button{label="close" act="tile.close"}'])).toBeNull();
  expect(lastAnswer([ask, "> [!note]+ @yo answered", "> ✓ yo pressed ▲ lift · [undo](act: ext.undo run=a)"])?.button).toBeNull();
  // A newer answer with nothing to press hides an older button.
  expect(lastAnswer([ask, ...fold, "@yo mamama", "> [!note]+ @yo answered", "> yo mama"])?.button).toBeNull();
});

test("the done row offers undo only when the run can take it back", () => {
  expect(doneRow("▲ lift", "run-1", true)).toBe("✓ yo pressed ▲ lift · [undo](act: ext.undo run=run-1)");
  expect(doneRow("▸ set", "run-1", false)).toBe("✓ yo pressed ▸ set · no undo: it changes no note and no layout");
});

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

async function until<T>(what: string, check: () => T | undefined | null | false): Promise<T> {
  const end = Date.now() + 20_000;
  for (;;) { const v = check(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(25); }
}

/** A scratch service with yo installed, a made-up catalog (`ep0ch actions --all`) and a model that answers by its log. */
async function setup(plan: unknown) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-yo-")));
  const was = Object.fromEntries(["OUTLINER_EXTENSIONS_DIR", "OUTLINER_RESOURCE_EXTENSIONS"].map(k => [k, process.env[k]]));
  Object.assign(process.env, { OUTLINER_EXTENSIONS_DIR: join(root, "user"), OUTLINER_RESOURCE_EXTENSIONS: join(root, "none.json") });
  const folder = join(root, "outline"), yo = join(folder, "extensions", "yo");
  mkdirSync(join(folder, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "yo"), yo, { recursive: true });
  const fakeCli = join(root, "cli.ts"), fakeModel = join(root, "model.ts"), act = join(root, "act.ts"), log = join(root, "models.log");
  writeFileSync(fakeCli, `const a = process.argv.slice(2); console.log(a[0] === "actions" && a[1] === "--all" ? ${JSON.stringify(JSON.stringify([LIFT, WATER]))} : a[0] === "actions" ? "the page" : "# Doc\\nnothing");`);
  writeFileSync(fakeModel, `import { appendFileSync } from "node:fs"; await Bun.stdin.text(); appendFileSync(${JSON.stringify(log)}, "answer\\n"); console.log(${JSON.stringify(JSON.stringify(plan))});`);
  writeFileSync(act, `import { appendFileSync } from "node:fs"; await Bun.stdin.text(); appendFileSync(${JSON.stringify(log)}, "act\\n"); console.log(JSON.stringify({ press: true, args: {} }));`);
  writeFileSync(join(yo, "config.json"), JSON.stringify({ config: { answer: [process.execPath, fakeModel], act: [process.execPath, act], memory: {}, ep0ch: [process.execPath, fakeCli] } }));
  const store = new OutlinerStore(join(root, "o.sqlite"), { workspaceRoot: folder });
  const socket = join(root, "o.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  const client = new OutlinerClient(socket);
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  });
  const models = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { store, client, models };
}

test("a quote runs only the answer model; the reply is the doc's words, with its steps folded and its cost nothing of the act model", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo how do I lift the barrow", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).toContain('> [!note]+ @yo answered\n> `barrow.lift`: "lift the barrow above the bench as a column"\n> keys: ✦b · ^W Z\n> ::button{label="▲ lift"');
  expect(text).toMatch(/> > \[!note\]- \d+ steps\n> > - read memory: 0 notes/);
  expect(t.models()).toEqual(["answer"]);
}, 30_000);

test("PIE-1629: a how-do-I question never reaches the act model, even when the answer model says act; a command does", async () => {
  // The answer model here always says act: what it did, unprompted, in one of two fresh doors.
  const t = await setup({ kind: "act", action: "barrow.lift" });
  for (const asked of ["how do I lift the barrow again", "how can I lift the barrow?", "what's the key for lifting the barrow", "is there a way to lift the barrow"]) {
    const note = await t.client.request<{ id: string }>({ action: "create", text: `Shed list\n\n@yo ${asked}`, author: "user" } as never);
    const text = await until(`the answer to ${asked}`, () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
    expect(text).toContain('::button{label="▲ lift"');
    expect(text).toContain("a question: say `@yo do it` to press it");
    expect(text).not.toContain("refused");
  }
  expect(t.models()).toEqual(["answer", "answer", "answer", "answer"]);
  const command = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo lift the barrow", author: "user" } as never);
  await until("the command's answer", () => t.store.require(command.id).text.includes("@yo answered"));
  expect(t.models()).toEqual(["answer", "answer", "answer", "answer", "answer", "act"]);
}, 60_000);

test("a question is told by its words, not by the model: how, what, where, is there; a command or a polite ask to do it is not one", () => {
  for (const q of ["how do I lift the agent again", "How can I lift the agent?", "what's the key for lift", "whats the key to lift it", "is there a way to lift the agent", "where is the lift", "which key lifts the agent", "lift the agent?", "can I lift the agent from a shell", "tell me how to lift the agent", "show me how to lift it", "the key for lifting the agent"])
    expect([q, asksHow(q)]).toEqual([q, true]);
  for (const c of ["lift the agent", "lift the agent again", "do it", "please lift the agent", "can you lift the agent", "could you lift the agent for me", "drop the agent"])
    expect([c, asksHow(c)]).toEqual([c, false]);
  // A question's prompt doesn't offer the model an act at all.
  const prompt = (asked: string) => planPrompt({ asked, question: asksHow(asked), candidates: [LIFT], docs: [], habits: [] });
  expect(prompt("how do I lift the barrow")).not.toContain('"kind":"act"');
  expect(prompt("lift the barrow")).toContain('"kind":"act"');
});

test("banter gets one line in character and no steps, and memory is left alone", async () => {
  const t = await setup({ kind: "chat", line: "yo mama reads the manual." });
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo mamama", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).toContain("> yo mama reads the manual.");
  expect(text).not.toContain("steps");
  expect((await t.client.request<{ blocks: unknown[] }>({ action: "blocks.query", query: { where: "yo-memory", limit: 5 } } as never)).blocks).toEqual([]);
}, 30_000);

test("an act steps up once to the act model; with no door to press in, it says so and keeps the button", async () => {
  const t = await setup({ kind: "act", action: "barrow.lift" });
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo lift the barrow now", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(t.models()).toEqual(["answer", "act"]);
  expect(text).toContain("the door refused it as yo:");
  expect(text).toContain('::button{label="▲ lift"');
}, 30_000);

test("door.act is an extension's: a client with no grant is refused, whoever it says it is", async () => {
  const t = await setup({ kind: "none", line: "no" });
  await expect(t.client.request({ action: "door.act", line: "barrow.lift" } as never)).rejects.toThrow("door.act needs an agent extension's grant");
  await expect(t.client.request({ action: "door.act", line: "barrow.lift", agent: "yo", extension: "yo" } as never)).rejects.toThrow("door.act needs an agent extension's grant");
}, 30_000);

test("do it presses yo's own answer, not a button written below it", async () => {
  const t = await setup({ kind: "none", line: "no" });
  const text = ["Shed list", "", "@yo lift the barrow", "> [!note]+ @yo answered", '> ::button{label="▲ lift" act="barrow.lift"}', "", '::button{label="close" act="tile.close"}', "", "@yo do it"].join("\n");
  const made = await t.client.request<{ id: string }>({ action: "create", text, author: "user" } as never);
  const said = await until("the answer", () => { const x = t.store.require(made.id).text; return /refused|nothing/.test(x) ? x : null; });
  expect(said).toContain("the door refused ▲ lift");
  expect(said).not.toContain("the door refused close");
}, 30_000);

test("a memory note whose words are covered isn't written twice; other arguments are another fact", async () => {
  const t = await setup({ kind: "none", line: "no" });
  const remember = (args: Record<string, string>) => t.client.request({ action: "extensions.act", extension: "yo", extensionAction: "remember", args } as never);
  const notes = async () => (await t.client.request<{ blocks: { text: string }[] }>({ action: "blocks.query", query: { where: "yo-memory", limit: 9 } } as never)).blocks.map(b => b.text.split(" [yo-memory")[0]);
  await remember({ act: "barrow.lift", asked: "lift-barrow" });
  await remember({ act: "barrow.lift", asked: "lift" });
  expect(await notes()).toEqual(["lift barrow: barrow.lift"]);
  await remember({ act: "barrow.lift", asked: "drop-barrow", args: "on:false" });
  expect((await notes()).sort()).toEqual(["drop barrow: barrow.lift on=false", "lift barrow: barrow.lift"]);
}, 30_000);

test("a remembered answer's button keeps the arguments that worked", async () => {
  const t = await setup({ kind: "none", line: "no" });
  await t.client.request({ action: "extensions.act", extension: "yo", extensionAction: "remember", args: { act: "barrow.lift", asked: "drop-barrow", args: "on:false" } } as never);
  const made = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo drop the barrow", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(made.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).toContain('act=["barrow.lift on=false"');
  expect(t.models()).toEqual([]);
}, 30_000);
