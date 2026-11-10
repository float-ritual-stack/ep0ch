// PIE-1585: yo's words come from the actions' own records, and code decides. The model is a made-up command here.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { argsOf, asksHow, buttonIn, buttonLine, doneRow, isGo, keysOf, labelOf, lastAnswer, lastButton, memoryStep, memoryText, planOf, planPrompt, pressLine, quoted, quoteOf, ranked, recalled, sections, shortReason, type ActionRecord } from "../extensions/yo/yo-line";

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

test("PIE-1632: no memory outline yet is a first run, said plainly; a memory that can't be reached is said as it came", () => {
  const missing = shortReason('No outline named "yo" in /srv/outlines/of/this/machine. Nothing was created (a read never makes one)');
  expect(memoryStep(missing, "yo")).toBe("no memory yet: yo remembers once an outline named yo exists, `ep0ch outline create yo`");
  expect(memoryStep(missing, "yo", "write")).toBe("not remembered: no outline named yo yet, `ep0ch outline create yo`");
  expect(memoryStep("no answer from yo@shed in 20000 ms", "yo")).toBe("memory skipped (no answer from yo@shed in 20000 ms)");
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

test("PIE-1626: the label is the doc's button for the press's arguments, and a press that changed nothing has nothing to undo", () => {
  const both: ActionRecord = { ...LIFT, keys: [...(LIFT.keys as []), { via: 'one that only drops it (::button{label="▼ drop" act="barrow.lift on=false"})' }] };
  expect(labelOf(both, "barrow.lift on=false")).toBe("▼ drop");
  expect(labelOf(both, "barrow.lift on=false reach=full")).toBe("▼ drop");
  expect(labelOf(both, "barrow.lift reach=full")).toBe("▲ lift");
  expect(labelOf(both)).toBe("▲ lift");
  expect(buttonLine(both, pressLine(both, { on: "false" }), "drop the barrow")).toBe('::button{label="▼ drop" act=["barrow.lift on=false", "ext.yo.remember act=barrow.lift asked=drop-barrow args=on:false"]}');
  expect(doneRow("▼ drop", "run-1", true, false)).toBe("✓ yo pressed ▼ drop · nothing to undo: it was already so");
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
  expect(lastAnswer(lines)).toEqual({ ask: "lift the barrow", button: { line: fold[1]!, at: 3, label: "▲ lift", act: "barrow.lift" } });
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
async function setup(plan: unknown, options: { claude?: { login?: string } } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-yo-")));
  const was = Object.fromEntries(["OUTLINER_EXTENSIONS_DIR", "OUTLINER_RESOURCE_EXTENSIONS", "HOME", "PATH", "WITH_SECRETS_DIR", "CLAUDE_CODE_OAUTH_TOKEN"].map(k => [k, process.env[k]]));
  Object.assign(process.env, { OUTLINER_EXTENSIONS_DIR: join(root, "user"), OUTLINER_RESOURCE_EXTENSIONS: join(root, "none.json") });
  const folder = join(root, "outline"), yo = join(folder, "extensions", "yo");
  mkdirSync(join(folder, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "yo"), yo, { recursive: true });
  const fakeCli = join(root, "cli.ts"), fakeModel = join(root, "model.ts"), act = join(root, "act.ts"), log = join(root, "models.log");
  writeFileSync(fakeCli, `const a = process.argv.slice(2); console.log(a[0] === "actions" && a[1] === "--all" ? ${JSON.stringify(JSON.stringify([LIFT, WATER]))} : a[0] === "actions" ? "the page" : "# Doc\\nnothing");`);
  writeFileSync(fakeModel, `import { appendFileSync } from "node:fs"; await Bun.stdin.text(); appendFileSync(${JSON.stringify(log)}, "answer\\n"); console.log(${JSON.stringify(JSON.stringify(plan))});`);
  writeFileSync(act, `import { appendFileSync } from "node:fs"; await Bun.stdin.text(); appendFileSync(${JSON.stringify(log)}, "act\\n"); console.log(JSON.stringify({ press: true, args: {} }));`);
  if (options.claude) {
    // PIE-1708: yo's own default (`claude -p …`), on a host with no Claude login of its own: a made-up HOME, no
    // CLAUDE_CODE_OAUTH_TOKEN, and a `claude` that answers only with the made-up login and otherwise says what the
    // real one says (on stdout) and exits 1. The login, when there is one, is the with-secrets `claude` group's.
    const bin = join(root, "bin"), secrets = join(root, "secrets");
    mkdirSync(bin); mkdirSync(join(root, "home")); mkdirSync(secrets);
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nif [ "$CLAUDE_CODE_OAUTH_TOKEN" = "tok-made-up-login" ]; then exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeModel)}; fi\necho "Not logged in · Please run /login"\nexit 1\n`, { mode: 0o755 });
    if (options.claude.login) writeFileSync(join(secrets, "claude.env"), `CLAUDE_CODE_OAUTH_TOKEN=${options.claude.login}\n`, { mode: 0o600 });
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    Object.assign(process.env, { HOME: join(root, "home"), PATH: `${bin}:${process.env.PATH}`, WITH_SECRETS_DIR: secrets });
  }
  writeFileSync(join(yo, "config.json"), JSON.stringify({ config: { ...(options.claude ? {} : { answer: [process.execPath, fakeModel], act: [process.execPath, act] }), memory: {}, ep0ch: [process.execPath, fakeCli] } }));
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

test("PIE-1708: yo's default claude answers on a host with no Claude login of its own, from the with-secrets claude group", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift" }, { claude: { login: "tok-made-up-login" } });
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo how do I lift the barrow", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).not.toContain("no answer from the model");
  expect(t.models()).toEqual(["answer"]);
  expect(text).not.toContain("tok-made-up-login");
}, 30_000);

test("PIE-1708: with no Claude login stored, yo's line names the command that stores one, not \"exited 1\"", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift" }, { claude: {} });
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo how do I lift the barrow", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).toContain("no answer from the model: the answer model command: claude isn't logged in where the outline host runs; store its login: with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN");
  expect(text).not.toContain("exited 1");
  expect(t.models()).toEqual([]);
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
  for (const q of ["how do I lift the agent again", "How can I lift the agent?", "what's the key for lift", "whats the key to lift it", "is there a way to lift the agent", "where is the lift", "which key lifts the agent", "lift the agent?", "can I lift the agent from a shell", "tell me how to lift the agent", "show me how to lift it", "the key for lifting the agent", "can you lift the agent?", "could you lift the agent for me?"])
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

test("PIE-1632: after four answers with the same button, do it presses the newest by its range, not by text alone", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const pressed: string[] = [];
  const door = t.client.watch({
    client: { clientId: "a-shed-door", role: "observer", contextId: "shed", app: "door" },
    onEvent: async event => {
      const call = (event as unknown as { script?: { requestId: string; targetClientId: string; action: string } }).script;
      if (event.domain !== "script" || !call || call.targetClientId !== "a-shed-door") return;
      pressed.push(call.action);
      await t.client.request({ action: "scripts.answer", requestId: call.requestId, clientId: "a-shed-door", result: { ok: true } } as never);
    },
  });
  cleanups.push(() => door.stop());
  await until("the door connected", async () => (await t.client.request<{ clientId: string }[]>({ action: "clients.list" })).length >= 1);
  // Four asks of the same thing in other words: each answer's button and hint read the same, line for line.
  const asks = ["how do I lift the barrow again", "how can I lift the barrow?", "what's the key for lifting the barrow", "can you lift the barrow?"];
  const made = await t.client.request<{ id: string }>({ action: "create", text: ["Shed list", "", ...asks.map(a => `@yo ${a}\n`)].join("\n"), author: "user" } as never);
  const answered = await until("four answers", () => { const b = t.store.require(made.id); return t.store.agentRequests(made.id).filter(r => r.answeredAt).length === 4 ? b : null; });
  // The newest answer's button, written above too: "lift barrow" slugs alike ("lifting" is another word).
  const button = answered.text.split("\n").filter(l => l.startsWith("> ::button{")).at(-1)!;
  const before = answered.text.split("\n").filter(l => l === button).length;
  expect(before).toBeGreaterThanOrEqual(3);
  await t.client.request({ action: "update", blockId: made.id, text: `${answered.text}\n\n@yo do it`, expectedRevision: answered.revision, mutation: { author: "user" } } as never);
  const row = await until("do it answered", () => t.store.agentRequests(made.id).find(r => r.request === "do it" && r.answeredAt));
  expect([row.status, row.message]).toEqual(["applied", "✓ pressed ▲ lift as yo"]);
  expect(pressed).toEqual(["barrow.lift"]);
  const lines = t.store.require(made.id).text.split("\n");
  // The older answers keep their button and hint; the newest's are its done row.
  expect(lines.filter(l => l === button).length).toBe(before - 1);
  const fourth = lines.lastIndexOf("> [!note]+ @yo answered");
  expect(lines[fourth - 1]).toBe("@yo can you lift the barrow?");
  expect(lines.slice(fourth).join("\n")).toMatch(/\n> keys: ✦b · \^W Z\n> ✓ yo pressed ▲ lift · [^\n]+\n> > \[!note\]-/);
}, 60_000);

// PIE-1709: the settings card's try is yo's own action: it runs a model setting once and says its answer, or why not in the
// command's own words (a `claude` with no login says them on stdout, in its JSON envelope, and exits 1).
test("try runs a model setting once: its answer, or why not in its own words; an answer that failed says them too", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-yo-try-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const refused = join(root, "refused.ts");
  writeFileSync(refused, `await Bun.stdin.text(); console.log(JSON.stringify({ type: "result", is_error: true, result: "Model not found: big-one" })); process.exit(1);`);
  const loggedOut = join(root, "logged-out.ts");
  writeFileSync(loggedOut, `await Bun.stdin.text(); console.log(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" })); process.exit(1);`);
  const tried = (setting: string) => t.client.request<{ message: string }>({ action: "extensions.act", extension: "yo", extensionAction: "try", args: { setting } } as never);
  // The made-up answer model answers: said with its time.
  expect((await tried("answer")).message).toMatch(/^✓ the answer model answered in \d+\.\d s/);
  // No act model: said, nothing run.
  await t.client.request({ action: "extensions.configure", extension: "yo", set: { act: [] } } as never);
  expect((await tried("act")).message).toBe("the act model: none set · yo offers the button and presses nothing itself");
  // The answer model refusing: its own words, not "exited 1".
  await t.client.request({ action: "extensions.configure", extension: "yo", set: { answer: [process.execPath, refused] } } as never);
  expect((await tried("answer")).message).toBe("✗ the answer model: Model not found: big-one (exited 1)");
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo how do I lift the barrow", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).toContain("closest match by its words (the answer model: Model not found: big-one (exited 1))");
  expect(text).toContain(`::button{label="⚙ yo's settings" act="ext.yo.settings"}`);
  // Not logged in (PIE-1708's words): the try says the command that stores the login.
  await t.client.request({ action: "extensions.configure", extension: "yo", set: { answer: [process.execPath, loggedOut] } } as never);
  expect((await tried("answer")).message).toBe("✗ the answer model: claude isn't logged in where the outline host runs; store its login: with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN");
}, 60_000);

// PIE-1710: yo knows itself. Asked about itself it answers from its own README and settings, with no model and never the
// closest action by its words; a greeting gets what it's for and two asks to try; a slip ("sue yo") reads through.
test("asked about itself, yo answers from its own page and settings, with no model; a greeting gets what it's for", async () => {
  const { selfAsk } = await import("../extensions/yo/yo-line");
  expect(["how do I use yo", "how do i sue yo", "how do use yo", "what do you do"].map(selfAsk)).toEqual(["use", "use", "use", "use"]);
  expect(["how do I set you up", "which model do you use", "how do i configure yo", "what model are you on", "where are your settings"].map(selfAsk)).toEqual(["setup", "setup", "setup", "setup", "setup"]);
  expect(["whats good", "hi", "what can you do", "hey!"].map(selfAsk)).toEqual(["greeting", "greeting", "greeting", "greeting"]);
  // About the door, not yo, though "you" is in them: the actions' business, and the empty ask about a tile is the tile's.
  const door = ["how do I lift the agent", "can you lift the agent?", "could you lift the agent for me", "mamama", "how do you split a tile", "can you set the trail to 7 days",
    "how do you install an extension", "how do you get the trail", "can you zoom", "how do you use the power bar", "can you change the model of the trail", ""];
  expect(door.map(selfAsk)).toEqual(door.map(() => null));

  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const ask = async (words: string) => {
    const note = await t.client.request<{ id: string }>({ action: "create", text: `Shed list\n\n@yo ${words}`, author: "user" } as never);
    return until(`the answer to ${words}`, () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  };
  const use = await ask("how do i sue yo");
  expect(use).toContain("Ask `@yo` how to do an ep0ch thing");
  expect(use).toContain("- `@yo how do I lift the agent again`");
  expect(use).toContain(`::button{label="⚙ yo's settings" act="ext.yo.settings"}`);
  expect(use).toContain("read yo's own page: its README and its settings");
  expect(use).not.toContain("barrow.lift");
  const set = await ask("how do I set you up");
  expect(set).toContain("My answer model: bun");
  expect(set).toContain("My memory: this outline");
  const hi = await ask("whats good");
  expect(hi).toContain("yo. Ask `@yo` how to do an ep0ch thing");
  expect(hi).not.toContain("steps");
  expect(t.models()).toEqual([]);
}, 60_000);

// PIE-1722: a note asked yo before is asked again like a fresh one. Its ninth ask was never seen (a cap counted every
// @name line from the top, answered or not), and the same words asked again were taken for the first ask's.
test("PIE-1722: a new ask in a note with eight answered asks is answered, and the same words asked again are answered again", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const asks = ["lift the barrow", "lift the barrow high", "water the tray", "lift it again", "drop the barrow", "water it now", "tilt the tray", "lift the shed"];
  const made = await t.client.request<{ id: string }>({ action: "create", text: ["Shed list", "", ...asks.map(a => `@yo how do I ${a}\n`)].join("\n"), author: "user" } as never);
  const answered = (n: number) => until(`${n} answers`, () => { const b = t.store.require(made.id); return t.store.agentRequests(made.id).filter(r => r.answeredAt).length >= n ? b : null; });
  let note = await answered(8);
  await t.client.request({ action: "update", blockId: made.id, text: `${note.text}\n\n@yo how do I sweep the shed\n`, expectedRevision: note.revision, mutation: { author: "user" } } as never);
  note = await answered(9);
  expect(note.text).toMatch(/@yo how do I sweep the shed\n> \[!note\]\+ @yo answered\n/);
  // The first ask's words again, further down: a request of its own, answered under its own line.
  await t.client.request({ action: "update", blockId: made.id, text: `${note.text}\n\n@yo how do I lift the barrow\n`, expectedRevision: note.revision, mutation: { author: "user" } } as never);
  note = await answered(10);
  const lines = note.text.split("\n"), last = lines.lastIndexOf("@yo how do I lift the barrow");
  expect(lines.indexOf("@yo how do I lift the barrow")).toBeLessThan(last);
  expect(lines[last + 1]).toBe("> [!note]+ @yo answered");
}, 90_000);

// PIE-1712: an answer fits the ask: the argument it names, the one key that presses it, and a button that gets there first.
const SHELF_VIEW: ActionRecord = {
  name: "shelf.view", summary: "change a shelf tile's view: step=<control> steps one", scope: "shelf",
  keys: [{ keys: "s", does: "the next sort order", args: { step: "sort" } }, { keys: "K", does: "by kind, a kind at a time", args: { step: "kind" } }, { keys: "click", does: "on the status line" }],
  args: { step: { type: "string", optional: true, about: "a control stepped to its next value: kind or sort" } },
  examples: [{ act: "shelf.view step=kind", does: "groups the shelf by kind" }],
};
const SHED_SHELF: ActionRecord = { name: "shed.shelf", summary: "show this note's shelf in the shelf tile", scope: "note", opens: "shelf", args: {} };

test("PIE-1712: the key line names only the key for the arguments, the button says what it does and gets to its tile first", () => {
  expect(keysOf(SHELF_VIEW)).toBe("s · K · click");
  expect(keysOf(SHELF_VIEW, 3, { step: "kind" })).toBe("K: by kind");
  expect(quoted(SHELF_VIEW, { step: "kind" })[1]).toBe("keys: K: by kind");
  expect(labelOf(SHELF_VIEW, "shelf.view step=kind")).toBe("▸ by kind");
  expect(labelOf(SHELF_VIEW)).toBe("▸ view");
  const { pathTo } = require("../extensions/yo/yo-line") as typeof import("../extensions/yo/yo-line");
  const before = pathTo(SHELF_VIEW, [SHED_SHELF, SHELF_VIEW]);
  expect(before).toEqual(["shed.shelf"]);
  // Asked from a shelf tile, it's already there.
  expect(pathTo(SHELF_VIEW, [SHED_SHELF, SHELF_VIEW], "shelf")).toEqual([]);
  const line = buttonLine(SHELF_VIEW, pressLine(SHELF_VIEW, { step: "kind" }), "how do I find shelf items by a type", { before });
  expect(line).toBe('::button{label="▸ by kind" act=["shed.shelf", "shelf.view step=kind", "ext.yo.remember act=shelf.view asked=find-shelf-items-type args=step:kind"]}');
  // do it presses every step but the remember, in order; the answer is about shelf.view.
  expect(buttonIn(`> ${line}`)).toEqual({ label: "▸ by kind", act: "shelf.view step=kind", steps: ["shed.shelf", "shelf.view step=kind"] });
  // A find's button keeps nothing: do it opens it, and no memory note is written of its query.
  expect(buttonIn(`> ::button{label="▸ open in facets" act=["tile.open kind=facets name=found", "facets.query text='type=plan' tile=found"]}`)).toEqual({ label: "▸ open in facets", act: "facets.query text='type=plan' tile=found", steps: ["tile.open kind=facets name=found", "facets.query text='type=plan' tile=found"], forget: true });
  // The model reads each argument and an example, so "by kind" can be filled.
  const prompt = planPrompt({ asked: "how do I find shelf items by a type", question: true, candidates: [SHELF_VIEW], docs: [], habits: [] });
  expect(prompt).toContain("shelf.view: change a shelf tile's view");
  expect(prompt).toContain("args: step (a control stepped to its next value: kind or sort); presets: step=sort: the next sort order; step=kind: by kind, a kind at a time e.g. shelf.view step=kind");
  // No key row or button of its own for these arguments: its verb, with them.
  expect(labelOf(SHELF_VIEW, "shelf.view sort=title")).toBe("▸ view sort title");
});

test("PIE-1712: asked how, the answer fills the argument the model read, names its one key and gets to the tile first", async () => {
  const t = await setup({ kind: "quote", action: "barrow.lift", args: { reach: "full" } });
  const note = await t.client.request<{ id: string }>({ action: "create", text: "Shed list\n\n@yo how do I lift the barrow across the shed", author: "user" } as never);
  const text = await until("the answer", () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  expect(text).toContain('act=["barrow.lift reach=full", "ext.yo.remember act=barrow.lift asked=lift-barrow-across-shed args=reach:full"]');
}, 30_000);

// PIE-1711: a find ask is answered with the notes, the query that found them and buttons, from the outline's own facets
// through query.suggest. Jev is a made-up server here that reads words as their values do.
function lexicalJev() {
  const stem = (w: string) => w.toLowerCase().replace(/(?<=\w{3})s$/, "");
  const said = (request: string, value: string) => {
    const words = request.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem), parts = value.toLowerCase().split(/[-_ ]+/).map(stem);
    const at = words.findIndex(w => parts.includes(w));
    return at < 0 ? null : { at, negated: words[at - 1] === "not" || (words[at - 2] === "not" && parts.length > 1) };
  };
  return Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const payload = await request.json() as { state: { request: string; candidates: Record<string, { value: string }[]> }; questions: Record<string, { type: string; criteria?: Record<string, string>; instructions?: { key?: string; span?: string } }> };
    const ask = payload.state.request, keyOf = (id: string) => id.split(":").slice(1).join(":");
    const hit = (key: string) => (payload.state.candidates[key] ?? []).map(c => ({ value: c.value, m: said(ask, c.value) })).find(c => c.m);
    const answers = Object.fromEntries(Object.entries(payload.questions).map(([id, q]) => {
      const key = keyOf(id), found = hit(key);
      if (q.type === "noul") return [id, { type: "noul", noul: id.startsWith("gate:") ? (found && key !== "by" && key !== "view" ? 0.96 : 0.02) : id.startsWith("negate:") ? (found?.m?.negated ? 0.96 : 0.02) : 0.02 }];
      const criteria = Object.entries(q.criteria ?? {}).filter(([k]) => k !== "none");
      const choice = id.startsWith("pick:") ? criteria.find(([, v]) => v === found?.value)?.[0] : id.startsWith("words:") ? criteria.find(([, v]) => found && said(v, found.value))?.[0] : undefined;
      return [id, { type: "choice", choice: choice ?? "none", confidence: 0.9, probabilities: { [choice ?? "none"]: 0.9 } }];
    }));
    return Response.json({ model: "jev-made-up", answers, usage: { input_tokens: 10, output_tokens: 1 } });
  } });
}

test("PIE-1711: a find ask answers with the notes, the query that found them, how it read the words and buttons; no model", async () => {
  const jev = lexicalJev();
  const was = { key: process.env.TYPESAFE_API_KEY, endpoint: process.env.OUTLINER_JEV_ENDPOINT };
  Object.assign(process.env, { TYPESAFE_API_KEY: "made-up", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${jev.port}` });
  cleanups.push(() => { jev.stop(true); for (const [k, v] of Object.entries({ TYPESAFE_API_KEY: was.key, OUTLINER_JEV_ENDPOINT: was.endpoint })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const make = (text: string) => t.client.request<{ id: string }>({ action: "create", text, author: "user" } as never);
  const seed = await make("Seed swap flyer [type::hub-item] [status::draft]");
  const shed = await make("Shed rota [type::hub-item] [status::queued]");
  await make("Compost notice [type::hub-item] [status::sent]");
  await make("Bean trellis plan [type::plan] [status::draft]");
  const ask = async (words: string) => {
    const note = await make(`Shed list\n\n@yo ${words}`);
    return until(`the answer to ${words}`, () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
  };
  const found = await ask("find me all hub items that are not sent yet");
  expect(found).toContain(`((${seed.id}|Seed swap flyer))`);
  expect(found).toContain(`((${shed.id}|Shed rota))`);
  expect(found).not.toContain("Compost notice");
  expect(found).not.toContain("Bean trellis");
  // The query, as the service wrote it, and how the words were read.
  expect(found).toMatch(/> 2 notes: `[^`]*type=hub-item[^`]*NOT[^`]*status=sent[^`]*`/);
  expect(found).toMatch(/> read: hub( items?)? → `type=hub-item` · not sent → `NOT \(?status=sent\)?`/);
  expect(found).toMatch(/::button\{label="▸ open in facets" act=\['tile\.open kind=facets name=found', 'facets\.query text=[^']+ tile=found'\]\}/);
  expect(found).toContain('label="▸ edit the query"');
  expect(found).toContain('label="▸ save as a view"');
  expect(found).toContain("> > - a find by its words: query.suggest over this outline's facets");
  // Not the actions' docs, and no model.
  expect(found).not.toContain("barrow.lift");
  expect(t.models()).toEqual([]);
  // Nothing matches: the query said, and the nearest keys and values.
  const none = await ask("find me all invoices that are paid");
  expect(none).toMatch(/> no notes: /);
  expect(none).toMatch(/nearest|keys here/);
  expect(t.models()).toEqual([]);
}, 60_000);

test("PIE-1711: a find is told from a how-do-I by its words, before any model", async () => {
  const { findAsk } = await import("../extensions/yo/yo-line");
  for (const [asked, words] of [["find me all hub items that are not sent yet", "hub items that are not sent yet"], ["show me the plans tagged garden", "plans tagged garden"], ["which notes are drafts", "notes are drafts"], ["list all chirps from this week", "chirps from this week"], ["all hub items not sent", "hub items not sent"]] as const)
    expect([asked, findAsk(asked)]).toEqual([asked, words]);
  for (const asked of ["how do I find backlinks by a type", "how do I lift the agent", "show me how to lift the agent", "find the key for zoom", "lift the agent", "what's the key for lift", ""])
    expect([asked, findAsk(asked)]).toEqual([asked, null]);
});

// PIE-1711 review (CodeRabbit on #1422): an extension may read words into a query; recording an outcome or corrections writes
// the query-words rule note, which its read is no grant for.
test("an extension's query.suggest reads; an outcome or corrections from it is refused and writes nothing", async () => {
  const t = await setup({ kind: "none", line: "no" });
  const folder = join(t.store.workspaceRoot!, "extensions", "wordprobe");
  mkdirSync(folder, { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "yo", "outline.ts"), join(folder, "outline.ts"));
  writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: "wordprobe", version: 1, name: "Word probe", description: "Asks query.suggest", run: ["bun", "probe.ts"],
    actions: [{ id: "learn", label: "Learn", on: "outline", effects: "read" }] }));
  writeFileSync(join(folder, "probe.ts"), `import { outline } from "./outline";
await Bun.stdin.json();
const said = await outline({ action: "query.suggest", text: "beds", outcome: "accepted", suggestion: { id: "x", input: "beds", base: "", where: "#beds", text: [], clauses: [{ clause: "#beds", from: ["beds"], confidence: 1, alternatives: [] }] } }).then(() => "accepted", (e: Error) => "refused: " + e.message);
process.stdout.write(JSON.stringify({ ok: true, value: { message: said } }));`);
  await until("the probe loaded", async () => (await t.client.request<{ extensions: { id: string; state?: string }[] }>({ action: "extensions.list" } as never)).extensions.some(e => e.id === "wordprobe" && e.state === "active"));
  const answer = await t.client.request<{ message: string }>({ action: "extensions.act", extension: "wordprobe", extensionAction: "learn" } as never);
  expect(answer.message).toStartWith("refused:");
  expect(answer.message).toContain("query-words");
  expect((await t.client.request<{ blocks: unknown[] }>({ action: "blocks.query", query: { where: "rule-name=query-words", limit: 5 } } as never)).blocks).toEqual([]);
}, 60_000);

// PIE-1711 review (CodeRabbit on #1422): a thread draws a find's buttons as links, and a link ends at the first ")": the
// action a link carries is the whole query, or there is no link.
test("in a thread, a find's links carry the whole query, as the comment's links read it", async () => {
  const { findAnswer } = await import("../extensions/yo/yo-line");
  const { linkOccurrences } = await import("@ep0ch/outline-core/link-syntax");
  const { actRequestOf, lineWords } = await import("@ep0ch/outline-core/action-line");
  const acts = (lines: string[]) => lines.flatMap(l => linkOccurrences(l).flatMap(o => o.kind === "markdown" ? [o.url.replace(/^act:\s*/, "")] : []));
  const found = { notes: [{ id: "n1", title: "Seed swap flyer" }], more: false };
  const plain = findAnswer({ words: "hub items not sent", where: "(type=hub-item NOT status=sent)", found, thread: true });
  expect(acts(plain)).toEqual(["facets.query text=type=hub-item\\ NOT\\ status=sent tile=found", "facets.edit text=type=hub-item\\ NOT\\ status=sent tile=found", "facets.save name=Hub\\ items\\ not\\ sent tile=found"]);
  expect(acts(plain).map(a => actRequestOf(lineWords(a)).args?.text ?? actRequestOf(lineWords(a)).args?.name)).toEqual(["type=hub-item NOT status=sent", "type=hub-item NOT status=sent", "Hub items not sent"]);
  // Parentheses inside it: no link would carry it, so none is drawn, and the query is still said.
  const grouped = findAnswer({ words: "plans or chirps", where: "(type=plan OR type=chirp) status=draft", found, thread: true });
  expect(acts(grouped)).toEqual([]);
  expect(grouped[0]).toContain("`(type=plan OR type=chirp) status=draft`");
});

// PIE-1711, the verifier's walk: a find's answer never changes the asking note's properties or links, its buttons carry
// any query whole (quotes, #tags, parentheses), and nothing found names the keys here, never a machinery count.
test("PIE-1711: a find's answer adds no tag or link to the note, its buttons carry the query whole, and a miss names keys", async () => {
  const jev = lexicalJev();
  const was = { key: process.env.TYPESAFE_API_KEY, endpoint: process.env.OUTLINER_JEV_ENDPOINT };
  Object.assign(process.env, { TYPESAFE_API_KEY: "made-up", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${jev.port}` });
  cleanups.push(() => { jev.stop(true); for (const [k, v] of Object.entries({ TYPESAFE_API_KEY: was.key, OUTLINER_JEV_ENDPOINT: was.endpoint })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const t = await setup({ kind: "quote", action: "barrow.lift" });
  const { parsePropertyRecords } = await import("@ep0ch/outline-core/property-parse");
  const { linkOccurrences } = await import("@ep0ch/outline-core/link-syntax");
  const { buttonCallsOf } = await import("@ep0ch/outline-core/button-call");
  const { actRequestOf, lineWords } = await import("@ep0ch/outline-core/action-line");
  const make = (text: string) => t.client.request<{ id: string }>({ action: "create", text, author: "user" } as never);
  const pond = await make("Pond cleanup plan [type::plan] [tag::garden]\nClear the reeds.");
  await make("Shed paint plan [type::plan] [tag::shed]");
  const ask = async (words: string) => {
    const note = await make(`Shed list\n\n@yo ${words}`);
    const text = await until(`the answer to ${words}`, () => { const x = t.store.require(note.id).text; return x.includes("@yo answered") ? x : null; });
    return { text, id: note.id };
  };
  for (const words of ["list the plans tagged garden", "find me the plans about reeds"]) {
    const { text } = await ask(words);
    expect(text).toContain(`((${pond.id}|Pond cleanup plan))`);
    // Saved, the note's own properties are only what it had: none.
    expect(parsePropertyRecords(text).map(p => `${p.key}=${p.value}`)).toEqual([]);
    // do it reads the same steps back, the query whole.
    const first = buttonIn(text.split("\n").find(l => l.includes("▸ open in facets"))!);
    expect(first?.steps?.[1] && actRequestOf(lineWords(first.steps[1])).args?.text).toBe(/> 1 note: `([^`]+)`/.exec(text)![1]!);
    // Its only link is the note it found.
    expect(linkOccurrences(text).filter(o => o.kind !== "markdown").map(o => text.slice(o.start, o.end))).toEqual([`((${pond.id}|Pond cleanup plan))`]);
    // Three buttons, each carrying the query the answer says, whole.
    const where = /> 1 note: `([^`]+)`/.exec(text)![1]!;
    const calls = buttonCallsOf(text);
    expect(calls.map(c => c.label)).toEqual(["▸ open in facets", "▸ edit the query", "▸ save as a view"]);
    for (const c of calls) expect(actRequestOf(lineWords(c.steps[1]!.source)).args?.text).toBe(where);
  }
  const miss = (await ask("find me all the widget items")).text;
  expect(miss).toMatch(/> no notes: `[^`]*widget[^`]*`/);
  expect(miss).toMatch(/> keys here: type \(/);
  expect(miss).not.toContain("machinery");
}, 60_000);
