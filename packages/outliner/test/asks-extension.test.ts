// PIE-1612: the write review's asks kept as properties. A scratch service with the asks extension installed and a fake
// Jev that answers by the line's words; every note is made up. The table, the settle wait, clearing, and the waiting
// list reading what it wrote.
import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, ChangeFeedPage, VisibleBlockCollection } from "../src/types";
import { asksBackfill } from "../src/asks-backfill";
import { aboutLines, withMark } from "../extensions/asks/asks-line";

const REPO_EXTENSIONS = join(import.meta.dir, "..", "extensions");
const AGENT = { author: "agent" as const, actorId: "builder" };
const PERSON = { author: "user" as const };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

/** The fake Jev's word on a line: by the words in it. */
const NOUL: [RegExp, number][] = [[/opens the yard|Red first|Done when/, 0.4], [/shed|fence|hedge|quoted/i, 0.92], [/maybe/i, 0.4], [/idle/i, 0.1], [/Evan, Oct|Decision:|Mark a finding|Wildcards|Check:|Note to self/, 0.72]];
/** Its word on the questions beside "does it ask": each reads the line and where it sits, so these can only pass if the note's context reached Jev. */
const BESIDE: Record<string, (line: string, around: { heading?: string; parent?: string; before?: string; after?: string }) => boolean> = {
  record: line => /^- \*\*\d+:\d+/.test(line),
  settled: (line, around) => /with the owner's yes/.test(line) || /answered: south/i.test(around.after ?? ""),
  addressed: (_, around) => !/checklist/i.test(around.heading ?? ""),
};

/**
 * The bigger model, as the config's `answer` command: prompt on stdin, a yes or no per line on stdout. It says no to a
 * line that reads as no ask, and keeps every prompt it was sent. Made up, as the notes are.
 */
const FAKE_MODEL = (log: string) => `
import { appendFileSync } from "node:fs";
const prompt = await Bun.stdin.text();
appendFileSync(${JSON.stringify(log)}, JSON.stringify(prompt) + "\\n");
const answers = Object.fromEntries([...prompt.matchAll(/^L(\\d+): (.*)$/gm)].map(m => ["L" + m[1], /Wildcards|Mark a finding|Evan, Oct|turned down/.test(m[2]) ? "no" : "yes"]));
console.log(JSON.stringify(answers));
`;

async function setup(past: readonly string[] = [], ruleQuietMs = 100, model?: { answer: string[] }) {
  const asked: Record<string, string>[] = [];
  const jev = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as { state: { asks?: Record<string, string>; around?: Record<string, Record<string, string>> }; questions: Record<string, unknown> };
      asked.push(body.state.asks ?? {});
      const answers: Record<string, { type: string; noul: number }> = {};
      for (const id of Object.keys(body.questions)) {
        const [question, at] = id.split("::") as [string, string];
        const line = body.state.asks?.[at] ?? "";
        const beside = BESIDE[question];
        answers[id] = { type: "noul", noul: beside ? (beside(line, body.state.around?.[at] ?? {}) ? 0.95 : 0.05) : NOUL.find(([pattern]) => pattern.test(line))?.[1] ?? 0.1 };
      }
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 1 } });
    },
  });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-asks-")));
  const previous = Object.fromEntries(["OUTLINER_EXTENSIONS_DIR", "OUTLINER_RESOURCE_EXTENSIONS", "OUTLINER_FIGURE_FIT", "OUTLINER_JEV_ENDPOINT", "TYPESAFE_API_KEY"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { OUTLINER_EXTENSIONS_DIR: join(root, "user-extensions"), OUTLINER_RESOURCE_EXTENSIONS: join(root, "no-legacy-registry.json"), OUTLINER_FIGURE_FIT: "on", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${jev.port}/v1/systemone`, TYPESAFE_API_KEY: "fake-key" });
  const outlineFolder = join(root, "outline");
  mkdirSync(join(outlineFolder, "extensions"), { recursive: true });
  cpSync(join(REPO_EXTENSIONS, "asks"), join(outlineFolder, "extensions", "asks"), { recursive: true });
  const modelLog = join(root, "model.jsonl"), modelScript = join(root, "fake-model.ts");
  writeFileSync(modelScript, FAKE_MODEL(modelLog));
  writeFileSync(join(outlineFolder, "extensions", "asks", "config.json"), JSON.stringify({ config: { answer: model?.answer ?? [process.execPath, modelScript] } }));
  const modelPrompts = () => existsSync(modelLog) ? readFileSync(modelLog, "utf8").trim().split("\n").map(line => JSON.parse(line) as string) : [];
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  // Notes from before the rule: a rule starts from now, so only a backfill reaches them.
  const older = past.map(text => store.create(text, null, "agent", { actorId: "builder" }));
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, ruleQuietMs });
  await server.start();
  const client = new OutlinerClient(socket);
  cleanups.push(async () => {
    await server.close();
    store.close();
    jev.stop(true);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const write = (text: string, who: { author: "agent" | "user"; actorId?: string } = AGENT) => client.request<Block>({ action: "create", text, author: who.author, ...(who.actorId ? { provenance: { actorId: who.actorId } } : {}) } as never);
  const edit = async (id: string, change: (text: string) => string, who: { author: "agent" | "user"; actorId?: string } = PERSON) => {
    const block = store.require(id);
    return client.request<Block>({ action: "update", blockId: id, text: change(block.text), expectedRevision: block.revision, mutation: who } as never);
  };
  const marked = (id: string, count = 1) => until(`${count} marks on ${id}`, () => { const text = store.require(id).text; return (text.match(/\[asks\.derived::/g)?.length ?? 0) === count ? text : null; });
  const settled = async () => { await Bun.sleep(400); await until("the rules to finish", async () => true); };
  const waiting = () => client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "needs", propertyScope: "all", limit: 50 } });
  return { older, store, server, client, write, edit, marked, settled, waiting, asked, modelPrompts };
}

test("the table: a sure ask gets a needs chip on its line, an unsure one its own lane, a no nothing, a filed top box nothing", async () => {
  const t = await setup();
  const note = await t.write([
    "Garden plan",
    "- [ ] Should the fence be cedar or larch?",
    "",
    "Notes on the beds.",
    "",
    "- Should the shed face south or east, Evan?",
    "- Maybe we could move the beans, what do you think?",
    "- Should idle plots get a cover crop?",
    "> She asked: should the shed be painted?",
  ].join("\n"));
  const text = await t.marked(note.id, 2);
  const lines = text.split("\n");
  expect(lines[1]).toBe("- [ ] Should the fence be cedar or larch?");
  expect(lines[5]).toBe(withMark("- Should the shed face south or east, Evan?", "yes"));
  expect(lines[5]).toStartWith("- Should the shed face south or east, Evan? [needs::sysop: Should the shed face south or east, Evan?] [asks.derived::");
  expect(lines[6]).toStartWith("- Maybe we could move the beans, what do you think? [maybe-needs::sysop] [asks.derived::");
  expect(lines[7]).toBe("- Should idle plots get a cover crop?");
  expect(lines[8]).toBe("> She asked: should the shed be painted?");
  // The write is the extension's, and the waiting list reads it at its line; the maybe lane stays out of it.
  const page = await t.client.request<ChangeFeedPage>({ action: "changes.since", sequence: 0, limit: 1000 } as never);
  expect((page as Extract<ChangeFeedPage, { kind: "changes" }>).changes.filter(c => c.blockId === note.id).at(-1)).toMatchObject({ actor: { author: "agent", actorId: "ext:asks" }, requestedBy: { actorId: "builder" } });
  const rows = (await t.waiting()).blocks.filter(b => b.id === note.id);
  expect(rows.flatMap(b => b.propertyMatches ?? []).map(m => [m.key, m.line])).toEqual([["needs", 5]]);
});

test("a person's save never marks; each line is marked once, so a chip you took off stays off", async () => {
  const t = await setup();
  const mine = await t.write("My list\n\n- Should the shed face south?", PERSON);
  const note = await t.write("Yard notes\n\nSome text.\n\n- Should the hedge be cut low?");
  await t.marked(note.id);
  await t.settled();
  expect(t.store.require(mine.id).text).not.toContain("asks.derived");
  // Taken off by hand, then an agent saves the note again: the same words aren't marked a second time.
  await t.edit(note.id, text => text.replace(/ \[needs::[^\]]*\] \[asks\.derived::[^\]]*\]/, ""));
  await t.edit(note.id, text => `${text}\n\nAnother line.`, AGENT);
  await t.settled();
  expect(t.store.require(note.id).text).not.toContain("asks.derived");
});

test("a hand-written chip is never added to or taken off; ticking takes off only the marked one", async () => {
  const t = await setup();
  const note = await t.write([
    "Shed work",
    "",
    "Some text about it.",
    "More text about it.",
    "And more text.",
    "",
    "- [ ] Should the shed have a window? [needs::sysop: window or not]",
    "- [ ] Should the fence be cedar or larch?",
    "- [ ] Should the hedge go?",
  ].join("\n"));
  await t.marked(note.id, 2);
  await t.edit(note.id, text => text.replace("- [ ] Should the fence", "- [x] Should the fence").replace("- [ ] Should the shed", "- [x] Should the shed"));
  const text = await t.marked(note.id, 1);
  expect(text).toContain("- [x] Should the shed have a window? [needs::sysop: window or not]");
  expect(text).toContain("- [x] Should the fence be cedar or larch?\n");
  expect(text).toContain(withMark("- [ ] Should the hedge go?", "yes"));
});

test("a reply under the line clears it for a person, not an agent; lines already under it or an agent's don't count", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Should the shed face south?\n  - It gets the morning sun\n- Should the hedge be low?");
  await t.marked(note.id, 2);
  // Evan's unrelated save doesn't clear the shed's: the line under it was there when it was marked.
  await t.edit(note.id, text => `${text}\n\nA thought.`);
  await t.settled();
  expect(await t.marked(note.id, 2)).toContain("Should the shed face south? [needs::");
  await t.edit(note.id, text => text.replace("- Should the hedge be low?", "- Should the hedge be low? X").replace(" X [needs", " [needs").replace(/(Should the hedge be low\?[^\n]*)/, "$1\n  - An agent's thought"), AGENT);
  expect(await t.marked(note.id, 2)).toContain("An agent's thought");
  // Once the agent's save has been read: its line under the ask now counts as already there.
  await until("the agent's line to be counted", async () => (await t.client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: `asks.note=${note.id}`, machinery: "show" } })).blocks.some(b => b.text.includes("Should the hedge") && b.text.includes("[asks.under::1]")));
  await t.edit(note.id, text => text.replace(/(Should the shed face south\?[^\n]*\n  - It gets the morning sun)/, "$1\n  - South, it is"));
  // The shed's goes; the hedge's stays: the agent's line under it isn't taken for Evan's reply by this save or any later.
  const text = await t.marked(note.id, 1);
  expect(text).toContain("- Should the shed face south?\n");
  expect(text).toContain("- Should the hedge be low? [needs::");
});

test("a comment on the line clears that one; a comment on the whole note clears them all", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Should the shed face south?\n- Should the hedge be low?");
  await t.marked(note.id, 2);
  const fresh = t.store.require(note.id);
  const start = fresh.text.indexOf("Should the shed");
  const quote = "Should the shed face south?";
  await t.client.request({ action: "annotations.batch", requestId: "a1", operations: [{ operationId: "o1", type: "block-comment", input: { blockId: note.id, expectedRevision: fresh.revision, body: "South.", source: "user", passage: { subject: note.id, revision: fresh.revision, quote, start, end: start + quote.length, prefix: "- ", suffix: " " } } }] } as never);
  const one = await t.marked(note.id, 1);
  expect(one).toContain("- Should the shed face south?\n");
  await t.client.request({ action: "annotations.batch", requestId: "a2", operations: [{ operationId: "o2", type: "block-comment", input: { blockId: note.id, expectedRevision: t.store.require(note.id).revision, body: "All of it, yes.", source: "user" } }] } as never);
  await t.marked(note.id, 0);
});

test("the note reaching done clears every mark, and a done note gets none", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Should the shed face south?");
  await t.marked(note.id, 1);
  await t.edit(note.id, text => text.replace("Yard", "Yard [status::done]"));
  await t.marked(note.id, 0);
  const closed = await t.write("Old yard [status::done]\n\nSome text.\n\n- Should the shed face south?");
  await t.settled();
  expect(t.store.require(closed.id).text).not.toContain("asks.derived");
});

test("PIE-1662: a roadmap item's own lines never reach Jev or a chip, though the same lines in a plain note do; a mark already on one comes off", async () => {
  const t = await setup();
  const body = ["", "Evan opens the yard note and every bed has a label he can read.", "", "- **Red first:** a made-up bed with no label gets no decision on main.", "- **Done when:** Evan sees every bed with its label.", "- Should the shed face south, Evan?"];
  // The control: in an ordinary note the description lines are Jev's unsure band, and the question a sure ask. A
  // bold-led line that asks nothing of Evan is filed in code and never marked (PIE-1715).
  const plain = await t.write(["Yard labels", ...body].join("\n"));
  const marked = (await t.marked(plain.id, 3)).split("\n");
  expect(marked[2]).toContain("[maybe-needs::sysop]");
  expect(marked[4]).not.toContain("needs::sysop");
  expect(marked[6]).toContain("[needs::sysop: Should the shed face south, Evan?]");
  const jevBefore = t.asked.length, modelBefore = t.modelPrompts().length;
  const item = await t.write(["YARD-7 — Every bed shows its label [type::roadmap-item] [work-stage::queued] [work-id::YARD-7]", ...body].join("\n"));
  await t.settled();
  // Its own run says why, and leaves the text as written.
  const ran = await t.client.request<{ message: string }>({ action: "extensions.act", extension: "asks", extensionAction: "settle", blockId: item.id, mutation: AGENT } as never);
  expect(ran.message).toBe("left out: a roadmap-item's lines describe the work, they don't ask");
  expect(t.store.require(item.id).text).toBe(item.text);
  // Decided in code: neither Jev nor the model was asked about it.
  expect(t.asked.slice(jevBefore).flatMap(a => Object.values(a))).not.toContain("- **Done when:** Evan sees every bed with its label.");
  expect(t.modelPrompts().slice(modelBefore).join("\n")).not.toContain("YARD-7");
  expect((await t.waiting()).blocks.map(b => b.id)).not.toContain(item.id);
  // A ticket marked before this: the next save takes its marks off.
  const lines = ["YARD-8 — Every bed shows its label [type::roadmap-item] [work-stage::queued] [work-id::YARD-8]", ...body];
  lines[2] = withMark(lines[2]!, "unsure");
  const old = await t.write(lines.join("\n"), PERSON);
  await t.settled();
  await t.edit(old.id, text => `${text}\n- Labels are slate.`, AGENT);
  await t.marked(old.id, 0);
  expect(t.store.require(old.id).text).not.toContain("maybe-needs");
});

test("dry: it says what it would write and writes nothing", async () => {
  const t = await setup();
  const note = await t.write("Yard [asks::off]\n\nSome text.\n\n- Should the shed face south?");
  const dry = await t.client.request<{ message?: string }>({ action: "extensions.act", extension: "asks", extensionAction: "settle", blockId: note.id, args: { dry: "yes" }, mutation: AGENT } as never);
  expect(dry.message).toContain("would write 1");
  expect(dry.message).toContain("L5 needs (0.92): Should the shed face south?");
  expect(t.store.require(note.id).text).not.toContain("asks.derived");
});


test("ep0ch review asks: a dry run prints and writes nothing; --write writes; a second run has nothing new; no extension says how to get it", async () => {
  const t = await setup(["Older yard\n\nSome text.\n\n- Should the hedge be low?", "Yard [asks::off]\n\nSome text.\n\n- Should the shed face south?"]);
  const [old, kept] = t.older as [Block, Block];
  const lines: string[] = [];
  const io = { out: (s: string) => { lines.push(s); }, err: (s: string) => { lines.push(s); } };
  const board = { address: { outline: "yard" }, send: (action: string, params: Record<string, unknown>) => t.client.request({ action, ...params } as never) };
  const before = t.store.require(old.id).text;
  expect(await asksBackfill(board, { since: "30d", write: false }, io)).toBe(0);
  expect(lines.join("\n")).toContain("L5 needs (0.92): Should the hedge be low?");
  expect(lines.join("\n")).toContain("Dry run");
  // Read through the rule's own query, so a note `asks::off` keeps out stays out.
  expect(lines.join("\n")).not.toContain(kept.id);
  expect(t.store.require(old.id).text).toBe(before);
  lines.length = 0;
  expect(await asksBackfill(board, { since: "30d", write: true }, io)).toBe(0);
  expect(t.store.require(old.id).text).toContain("[asks.derived::");
  lines.length = 0;
  expect(await asksBackfill(board, { since: "30d", write: true }, io)).toBe(0);
  expect(lines.join("\n")).toContain("0 written");
  expect(await asksBackfill(board, { since: "soon", write: false }, io)).toBe(2);
});

// Review of #1330: each of these went wrong in a note like these.

const comment = async (t: Awaited<ReturnType<typeof setup>>, id: string, quote: string | undefined, start?: number) => {
  const fresh = t.store.require(id);
  const at = start ?? (quote ? fresh.text.indexOf(quote) : 0);
  await t.client.request({ action: "annotations.batch", requestId: crypto.randomUUID(), operations: [{ operationId: "o", type: "block-comment", input: { blockId: id, expectedRevision: fresh.revision, body: "Yes.", source: "user", ...(quote ? { passage: { quote, start: at } } : {}) } }] } as never);
};

test("a comment on part of one ask clears that ask alone, though its words are in another too", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Should the shed face south?\n- Should the shed have a window?");
  await t.marked(note.id, 2);
  await comment(t, note.id, "shed", t.store.require(note.id).text.indexOf("the shed face") + 4);
  const text = await t.marked(note.id, 1);
  expect(text).toContain("- Should the shed face south?\n");
  expect(text).toContain("- Should the shed have a window? [needs::");
});

test("a comment on a checklist item clears that item's ask, not the note's", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\nMore text.\nEven more text.\n\n- [ ] Should the shed face south? ^a1b2c3\n- [ ] Should the hedge be low?");
  const marked = await t.marked(note.id, 2);
  // An anchor at the end of its line stays at the end: the mark goes before it.
  expect(marked).toContain("[asks.derived::");
  expect(marked).toMatch(/Should the shed face south\? \[needs::[^\]]*\] \[asks\.derived::[^\]]*\] \^a1b2c3\n/);
  // A list-item anchor is what a comment resolves to once its quote is gone.
  const lines = marked.split("\n");
  const about = aboutLines({ kind: "list-item", itemId: "a1b2c3" }, marked)!;
  expect(lines.flatMap((_, i) => about(i, lines) ? [i] : [])).toEqual([6]);
  expect(aboutLines({ kind: "dom-range" }, marked)).toBeNull();
  const fresh = t.store.require(note.id);
  await t.client.request({ action: "annotations.batch", requestId: "item", operations: [{ operationId: "o", type: "block-comment", input: { blockId: note.id, expectedRevision: fresh.revision, body: "South.", source: "user", passage: { quote: "shed", start: fresh.text.indexOf("the shed") + 4, itemId: "a1b2c3" } } }] } as never);
  const text = await t.marked(note.id, 1);
  expect(text).toContain("Should the hedge be low? [needs::");
  expect(text).toContain("- [ ] Should the shed face south? ^a1b2c3\n");
});

test("while Evan types in that passage, the marks wait as a proposal, and the run says so", async () => {
  const t = await setup();
  const note = await t.write("Yard [asks::off]\n\nSome text.\n\n- Should the shed face south?");
  const connected = Promise.withResolvers<void>();
  const watcher = t.client.watch({
    client: { clientId: "door", role: "observer", contextId: "door" }, onConnect: connected.resolve,
    onEvent: async (event: { domain: string; draft?: { kind: string; requestId: string } }) => {
      if (event.domain !== "draft" || !event.draft) return;
      const answer = event.draft.kind === "read" ? { text: note.text, revision: note.revision } : { applied: false, reason: "the person is typing in that passage" };
      await t.client.request({ action: "drafts.answer", requestId: event.draft.requestId, clientId: "door", answer } as never).catch(() => undefined);
    },
  } as never);
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await t.client.request({ action: "drafts.hold", blockId: note.id, clientId: "door", revision: note.revision } as never);
  const answer = await t.client.request<{ message?: string }>({ action: "extensions.act", extension: "asks", extensionAction: "settle", blockId: note.id, mutation: AGENT } as never);
  expect(answer.message).toContain("proposed 1");
  expect(t.store.require(note.id).text).not.toContain("asks.derived");
  const proposals = await t.client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "type=draft-proposal", limit: 5 } });
  expect(proposals.blocks.length).toBe(1);
}, 20_000);

test("a note reaching done leaves a fenced example of a mark as written", async () => {
  const t = await setup();
  const example = "- An example? [needs::sysop: An example?] [asks.derived::abc123]";
  const note = await t.write(`Yard\n\nSome text.\n\n- Should the shed face south?\n\n\`\`\`text\n${example}\n\`\`\``);
  await t.marked(note.id, 2);
  await t.edit(note.id, text => text.replace("Yard", "Yard [status::done]"));
  const text = await t.marked(note.id, 1);
  expect(text).toContain(example);
  expect(text).toContain("- Should the shed face south?\n");
});

test("a chip is ours by more than sitting beside the mark: a chip written between doesn't move what comes off", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\nMore text.\nEven more text.\n\n- [ ] Should the shed face south?\n- [ ] Should the hedge be low?");
  await t.marked(note.id, 2);
  await t.edit(note.id, text => text
    .replace(/(Should the shed face south\? \[needs::[^\]]*\]) /, "$1 [priority::high] ")
    .replace(/(Should the hedge be low\? \[needs::[^\]]*\]) /, "$1 [needs::sysop: mine, by hand] "));
  await t.settled();
  await t.edit(note.id, text => text.replaceAll("- [ ] Should", "- [x] Should"));
  const text = await t.marked(note.id, 0);
  expect(text).toContain("- [x] Should the shed face south? [priority::high]\n");
  expect(text).toEndWith("- [x] Should the hedge be low? [needs::sysop: mine, by hand]");
});

test("a ninth question is read too, each request to Jev at most eight lines", async () => {
  const t = await setup();
  const asks = Array.from({ length: 12 }, (_, i) => `- Should the shed have ${i + 1} doors?`);
  const note = await t.write(`Yard\n\nSome text.\n\n${asks.join("\n")}`);
  await t.marked(note.id, 12);
  expect(Math.max(...t.asked.map(a => Object.keys(a).length))).toBeLessThanOrEqual(8);
});

// PIE-1620: the dry run a person reads lists what still waits on him. Every note made up.

const boardOf = (t: Awaited<ReturnType<typeof setup>>) => ({ address: { outline: "yard" }, send: (action: string, params: Record<string, unknown>) => t.client.request({ action, ...params } as never) });
const dryRun = async (t: Awaited<ReturnType<typeof setup>>, o: { pageSize?: number } = {}) => {
  const lines: string[] = [];
  const code = await asksBackfill(boardOf(t), { since: "30d", write: false, ...o }, { out: s => { lines.push(s); }, err: s => { lines.push(s); } });
  return { code, said: lines.join("\n") };
};

test("the dry run lists only open asks: records, closed notes, answered lines, prose and someone else's checklist stay out", async () => {
  const t = await setup([
    // Still waiting.
    "Open yard\n\nSome text.\n\n- Should the shed face south?",
    "Open plot\n\nSome text.\n\n- Maybe we could move the beans, what do you think?",
    // Records and closed notes, by what they carry.
    "Asked: allow Bash: mow the shed? [type::permission-ask] [ask-tool::Bash]\n\n- ~~allow this once~~\n- ~~deny~~\n\nShould the shed run this? Tick one: only your tick counts here.",
    "Walked the shed [type::proof]\n\n- Should the shed have failed? It didn't.",
    "Shed landed [type::landed]\n\n- Should the shed face south? It does now.",
    "Yard log, Mar 3 [type::build-log]\n\n- Should the shed move? Picked it.",
    "Hedge parked [work-stage::later]\n\n- Should the hedge be high?",
    "A call made [type::decision]\n\n- Should the fence be pine?",
    "Fence closed [status::closed]\n\n- Should the fence be cedar?",
    "Fence answered [status::answered]\n\n- Should the fence be larch?",
    "Fence decided [status::decided]\n\n- Should the fence be oak?",
    // The line says what its surroundings make of it.
    "Sweep\n\n## Sweep, Mar 3\n- Should the hedge wait? To later, with the owner's yes.",
    "Shed thread\n\nSome text.\n\n- Should the shed face south first?\n- Answered: south, on the phone.",
    "Yard diary\n\n- **9:41:** Should the fence wait? Picked it from the queue.",
    "Runbook\n\n## The deployer's checklist\n1. Should the shed go out? Check the queue.",
  ]);
  const open = t.older.slice(0, 2) as [Block, Block];
  const { code, said } = await dryRun(t);
  expect(said).toContain(open[0].id);
  expect(said).toContain("L5 needs (0.92): Should the shed face south?");
  // The maybe lane is for what was just written: a run over the past leaves it unmarked.
  expect(said).not.toContain(open[1].id);
  for (const closed of t.older.slice(2)) expect(said).not.toContain(closed.id);
  expect(said).toContain("1 would be written");
  expect(code).toBe(0);
});

test("Codex on #1332: a question in a capability or design note is still a question; the records are the rule's query, a person can edit it", async () => {
  const t = await setup(["Shed design [type::capability]\n\n## Open questions\n- Should the shed face east?", "Hedge design [type::design]\n\n- Should the hedge be low?"], 60_000);
  const { said } = await dryRun(t);
  for (const note of t.older) expect(said).toContain(note.id);
  const manifest = await Bun.file(join(REPO_EXTENSIONS, "asks", "extension.json")).json() as { rules: { id: string; match: { query: string } }[] };
  expect(manifest.rules.find(rule => rule.id === "settle")!.match.query).toContain("NOT type=permission-ask");
});

test("Codex on #1332: a comment on one question answers that one; the next is still marked", async () => {
  const t = await setup(["Yard\n\nSome text.\n\n- Should the shed face south?\n- Should the hedge be low?"], 60_000);
  const note = t.older[0]!;
  await comment(t, note.id, "Should the shed face south?");
  await t.edit(note.id, text => `${text}\n\nAgent's aside.`, AGENT);
  const { said } = await dryRun(t);
  expect(said).toContain("Should the hedge be low?");
  expect(said).not.toContain("Should the shed face south?");
});

test("Codex on #1332: the same words an agent writes again under another heading are a new line, above or below the old one", async () => {
  const t = await setup(["Below\n\n## Front\n- Should the shed move?", "Above\n\n## Front\n- Should the fence move?"], 60_000);
  const [below, above] = t.older as [Block, Block];
  await t.edit(below.id, text => `${text}\n\nA thought.`);
  await t.edit(below.id, text => `${text}\n\n## Back\n- Should the shed move?`, AGENT);
  await t.edit(above.id, text => `${text}\n\nA thought.`);
  await t.edit(above.id, text => text.replace("## Front", "## Back\n- Should the fence move?\n\n## Front"), AGENT);
  const { said } = await dryRun(t);
  expect(said).toContain("L9 needs (0.92): Should the shed move?");
  expect(said).not.toContain("L4 needs (0.92): Should the shed move?");
  expect(said).toContain("L4 needs (0.92): Should the fence move?");
  expect(said).not.toContain("L7 needs (0.92): Should the fence move?");
});

test("a line older than a person's last save or comment is answered; a line an agent adds after it still asks", async () => {
  const t = await setup([
    "Ticked yard\n\nSome text.\n\n- Should the shed face south?\n- [ ] Water the beds",
    "Commented yard\n\nSome text.\n\n- Should the fence be cedar?",
    "Asked again\n\nSome text.\n\n- Should the hedge be low?",
  // The rule stays quiet: this is what a run over the past reads, with no settle of the same saves racing it.
  ], 60_000);
  const [ticked, commented, again] = t.older as [Block, Block, Block];
  // A tick is a person's save, and leaves an agent the last word on the note as a later save would.
  await t.edit(ticked.id, text => text.replace("- [ ] Water", "- [x] Water"));
  await t.edit(ticked.id, text => `${text}\n\nAgent's aside.`, AGENT);
  await comment(t, commented.id, undefined);
  await t.edit(commented.id, text => `${text}\n\nAgent's aside.`, AGENT);
  await t.edit(again.id, text => `${text}\n\nA thought of mine.`);
  await t.edit(again.id, text => `${text}\n\n- Should the hedge be cut in spring?`, AGENT);
  const { said } = await dryRun(t);
  expect(said).not.toContain(ticked.id);
  expect(said).not.toContain(commented.id);
  expect(said).toContain(again.id);
  expect(said).toContain("Should the hedge be cut in spring?");
  expect(said).not.toContain("needs (0.92): Should the hedge be low?");
});

test("the live settle reads the same: a permission record isn't marked, a person's own line isn't, what an agent adds is", async () => {
  const t = await setup();
  const record = await t.write("Allow Bash: mow the shed? [type::permission-ask]\n\nSome text.\n\n- Should the shed run this?");
  const mine = await t.write("My yard\n\nSome text.\n\n- Should the shed face south?", PERSON);
  await t.edit(mine.id, text => `${text}\n- Should the hedge be low?`, AGENT);
  const text = await t.marked(mine.id, 1);
  expect(text).toContain("- Should the shed face south?\n");
  expect(text).toContain("- Should the hedge be low? [needs::");
  await t.settled();
  expect(t.store.require(record.id).text).not.toContain("asks.derived");
});

test("a done key beyond status=done closes a note both ways: nothing is marked on it, and reaching it takes the marks off", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Should the shed face south?");
  await t.marked(note.id, 1);
  await t.edit(note.id, text => text.replace("Yard", "Yard [status::decided]"));
  await t.marked(note.id, 0);
  const closed = await t.write("Old yard [answered::2026-03-03]\n\nSome text.\n\n- Should the shed face south?");
  await t.settled();
  expect(t.store.require(closed.id).text).not.toContain("asks.derived");
});

test("Jev reads a line where it sits: its heading, the item it's under and the lines either side", async () => {
  const bodies: { state: { title?: string; kind?: string; around?: Record<string, Record<string, string>> } }[] = [];
  const answers = (ids: string[]) => Object.fromEntries(ids.map(id => [id, { type: "noul", noul: 0.05 }]));
  const { readAsks } = await import("../src/write-review");
  await readAsks("Yard plan [type::plan]\n\n## Beds\n- Beans\n  - Should the shed move?\n  - It shades them", {
    apiKey: "fake", env: { OUTLINER_FIGURE_FIT: "on" }, fetch: (async (_: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body); bodies.push(body);
      return Response.json({ model: "jev-1.13.0", answers: answers(Object.keys(body.questions)), usage: { input_tokens: 1, output_tokens: 1 } });
    }) as never,
  });
  expect(bodies[0]!.state.kind).toBe("plan");
  expect(bodies[0]!.state.around?.L4).toEqual({ heading: "Beds", parent: "- Beans", before: "- Beans", after: "- It shades them" });
});

test("a note of many asks: the dry run prints every line whole, and a live settle's message still fits", async () => {
  const many = Array.from({ length: 12 }, (_, i) => `- Should the shed have ${i + 1} doors, and what about the long list of hinges they need?`);
  const t = await setup([`Yard\n\nSome text.\n\n${many.join("\n")}`]);
  const { code, said } = await dryRun(t);
  expect(code).toBe(0);
  for (let i = 1; i <= 12; i++) expect(said).toContain(`Should the shed have ${i} doors`);
  const note = t.older[0]!;
  const answer = await t.client.request<{ message?: string; answer?: string }>({ action: "extensions.act", extension: "asks", extensionAction: "settle", blockId: note.id, mutation: AGENT } as never);
  expect(answer.message!.length).toBeLessThanOrEqual(500);
  expect(answer.message).toStartWith("wrote 12");
  expect(answer.answer).toContain("Should the shed have 12 doors");
  expect(t.store.require(note.id).text.match(/\[needs::/g)?.length).toBe(12);
}, 20_000);

test("a line of nothing but chips is no ask, whatever its chips say", async () => {
  const t = await setup(["Yard\n[type::note] [topic::decision] [who::you]\n\nSome text."]);
  const before = t.asked.length;
  const { said } = await dryRun(t);
  expect(t.asked.length).toBe(before);
  expect(said).toContain("0 would be written");
});

test("a person's run reads what that person saved: an agent's line written before the run starts is no reply", async () => {
  const t = await setup(["Yard\n\nSome text.\n\n- Should the hedge be low?"], 60_000);
  const note = t.older[0]!;
  await t.client.request({ action: "extensions.act", extension: "asks", extensionAction: "settle", blockId: note.id, mutation: AGENT } as never);
  await t.edit(note.id, text => `${text}\n\nA thought.`);
  await t.edit(note.id, text => text.replace(/(Should the hedge be low\?[^\n]*)/, "$1\n  - An agent's thought"), AGENT);
  // The run for the person's save was queued, and starts only now.
  await t.client.request({ action: "extensions.act", extension: "asks", extensionAction: "clear", blockId: note.id, mutation: PERSON } as never);
  expect(t.store.require(note.id).text).toContain("[asks.derived::");
});

test("a stopped service runs nothing still queued behind a trigger: its database may be closed by then", async () => {
  const t = await setup();
  const rules = (t.server as unknown as { extensionRules: { stop(): void; settle(): Promise<void>; queue(block: string, work: () => Promise<void>): void } }).extensionRules;
  rules.stop();
  let ran = false;
  rules.queue("a-note", async () => { ran = true; });
  await rules.settle();
  expect(ran).toBe(false);
});

test("a mark's record is there before its chip, so a save right after it has a count to compare", async () => {
  const asks = Array.from({ length: 12 }, (_, i) => `- Should the shed have ${i + 1} doors?`);
  const t = await setup();
  const note = await t.write(`Yard\n\nSome text.\n\n${asks.join("\n")}`);
  await t.marked(note.id, 12);
  const records = t.store.queryBlocks({ where: `asks.note=${note.id}`, machinery: "show", limit: 50 });
  expect(records.blocks.length).toBe(12);
});

test("a done value reads the same in any case", async () => {
  const t = await setup(["Yard [status::Done]\n\nSome text.\n\n- Should the shed face south?"], 60_000);
  const { said } = await dryRun(t);
  expect(said).not.toContain(t.older[0]!.id);
});

test("a note saved while the window is listed is listed once, and pushes no other note off a page", async () => {
  const t = await setup(Array.from({ length: 5 }, (_, i) => `Yard ${i}\n\nSome text.\n\n- Should the shed have ${i} doors?`), 60_000);
  const board = boardOf(t), lines: string[] = [];
  let pages = 0;
  const spy = { ...board, send: async (action: string, params: Record<string, unknown>) => {
    const answer = await board.send(action, params);
    // An agent saves the oldest note just after the first page is read: "updated desc" would move it to the front.
    if (action === "blocks.query" && ++pages === 1) await t.edit(t.older[0]!.id, text => `${text}\n\nAn aside.`, AGENT);
    return answer;
  } };
  await asksBackfill(spy, { since: "30d", write: false, pageSize: 2 }, { out: s => { lines.push(s); }, err: s => { lines.push(s); } });
  const said = lines.join("\n");
  for (const note of t.older) expect(said.split(note.id).length).toBe(2);
  expect(said).toContain("5 notes read");
});

test("a chip's words fit however long the line is", () => {
  const marked = withMark(`- Should the shed ${"really ".repeat(200)}face south?`, "yes");
  const chip = /\[needs::([^\]]*)\]/.exec(marked)![1]!;
  expect(chip.length).toBeLessThanOrEqual(120);
});

test("the backfill pages past a page of notes, oldest included, with nothing said about a cut", async () => {
  const t = await setup(Array.from({ length: 5 }, (_, i) => `Yard ${i}\n\nSome text.\n\n- Should the shed have ${i} doors?`));
  const lines: string[] = [], offsets: unknown[] = [];
  const board = boardOf(t);
  const spy = { ...board, send: (action: string, params: Record<string, unknown>) => { if (action === "blocks.query") offsets.push((params.query as { offset?: number }).offset ?? 0); return board.send(action, params); } };
  await asksBackfill(spy, { since: "30d", write: false, pageSize: 2 }, { out: s => { lines.push(s); }, err: s => { lines.push(s); } });
  const said = lines.join("\n");
  expect(offsets.slice(0, 3)).toEqual([0, 2, 4]);
  for (const note of t.older) expect(said).toContain(note.id);
  expect(said).toContain("5 notes read, 5 would be written");
  expect(said).not.toContain("more than");
});

// PIE-1620, Evan's shape: code first, Jev generous, a bigger model confirms. His dry run's noise at 0.70 to 0.73, as
// made-up copies: the fake Jev answers each as generously as the real one did.

const NOISE = [
  "> [!quote] Evan, Oct 20",
  "> You could pick either, it said.",
  "- **Decision:** a header picture is set one way",
  "- Check: the mower takes its keys from the tile",
  "- Note to self: please confirm the fence posts later",
  "- Mark a finding below: x when you agree with the gardener",
  "- Wildcards and masks should work as they did on the old board",
];

test("the noise: structural lines never reach Jev, what Jev passes the model turns down, and only the real asks would be written", async () => {
  const t = await setup([["Yard review", "", ...NOISE, "", "## Still open", "- Should the shed face south or east?", "- Decision: should the fence be cedar or larch?"].join("\n")]);
  const { code, said } = await dryRun(t);
  expect(code).toBe(0);
  const read = t.asked.flatMap(a => Object.values(a)).join("\n");
  // Code first.
  for (const line of ["Evan, Oct 20", "You could pick", "a header picture", "takes its keys", "Note to self"]) expect(read).not.toContain(line);
  // A label over a real question still reaches Jev: a miss can't be recovered later.
  expect(read).toContain("Decision: should the fence be cedar or larch?");
  // Jev is generous, and passes these on.
  for (const line of ["Mark a finding", "Wildcards"]) expect(read).toContain(line);
  const would = said.split("Turned down")[0]!;
  expect(would).toContain("Should the shed face south or east?");
  expect(would).toContain("Decision: should the fence be cedar or larch?");
  for (const line of ["Mark a finding", "Wildcards", "Evan, Oct 20", "header picture", "takes its keys"]) expect(would).not.toContain(line);
  // What the model struck is said apart, so a person sees what the confirm took.
  expect(said.split("Turned down")[1]).toContain("Mark a finding below");
  expect(said).toContain("1 would be written");
});

test("Jev's judgments are separate questions, and code combines them: yes needs both addressed and asking; said answered or a record is no", async () => {
  const { readAsks } = await import("../src/write-review");
  const say: Record<string, Record<string, number>> = {
    "- Should the shed open east?": { decide: 0.9, addressed: 0.9 },
    "- Should the hedge open east?": { decide: 0.9, addressed: 0.1 },
    "- Should the fence open east?": { decide: 0.1, addressed: 0.9 },
    "- Should the beans open east?": { decide: 0.9, addressed: 0.9, settled: 0.9 },
    "- Should the peas open east?": { decide: 0.9, addressed: 0.9, record: 0.9 },
    "- Should the pond open east?": { decide: 0.6, addressed: 0.55 },
    "- Should the path open east?": { decide: 0.4, addressed: 0.9 },
  };
  const text = `Yard\n\n${Object.keys(say).join("\n")}`;
  const lines = text.split("\n");
  const asked = new Set<string>();
  const read = await readAsks(text, {
    apiKey: "fake", env: { OUTLINER_FIGURE_FIT: "on" }, fetch: (async (_: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { questions: Record<string, unknown> };
      const answers = Object.fromEntries(Object.keys(body.questions).map(id => {
        const [question, at] = id.split("::") as [string, string];
        asked.add(question);
        return [id, { type: "noul", noul: say[lines[Number(at.slice(1))]!]?.[question] ?? 0.05 }];
      }));
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } });
    }) as never,
  });
  expect([...asked].sort()).toEqual(["addressed", "decide", "record", "settled"]);
  expect(read.lines.map(l => [l.text.slice(13, 18).trim(), l.reads])).toEqual([["shed", "yes"], ["hedge", "no"], ["fence", "no"], ["beans", "no"], ["peas", "no"], ["pond", "yes"], ["path", "unsure"]]);
});

test("Jev reads what follows a line, so an answer further down the section can settle it", async () => {
  const bodies: { state: { around?: Record<string, { later?: string }> } }[] = [];
  const { readAsks } = await import("../src/write-review");
  await readAsks("Yard\n\n## Beds\n- Should the shed move?\n- It shades them\n- We moved it\n\n## Other\n- Not this", {
    apiKey: "fake", env: { OUTLINER_FIGURE_FIT: "on" }, fetch: (async (_: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body); bodies.push(body);
      return Response.json({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } });
    }) as never,
  });
  expect(bodies[0]!.state.around?.L3?.later).toBe("- It shades them\n- We moved it");
});

test("the model reads one batch per note, with its title and what follows; the unsure band never reaches it and stays a maybe", async () => {
  const t = await setup();
  const note = await t.write(["Yard plan", "", "Some text.", "", "## Beds", "- Should the shed face south?", "- Should the fence be cedar?", "- Maybe move the beans, what do you think?", "- Wildcards should do what you want here", "- It shades the beans"].join("\n"));
  const text = await t.marked(note.id, 3);
  expect(t.modelPrompts()).toHaveLength(1);
  const prompt = t.modelPrompts()[0]!;
  expect(prompt).toContain("Yard plan");
  expect(prompt).toContain("## Beds");
  expect(prompt).toContain("It shades the beans");
  expect(prompt).toContain("L6: ");
  expect(prompt).toContain("L7: ");
  expect(prompt).not.toContain("L8: ");
  expect(prompt).toContain("evidence");
  const lines = text.split("\n");
  expect(lines[5]).toContain("[needs::sysop: Should the shed face south?]");
  expect(lines[6]).toContain("[needs::sysop: Should the fence be cedar?]");
  expect(lines[7]).toContain("[maybe-needs::sysop]");
  expect(lines[8]).toBe("- Wildcards should do what you want here");
});

test("a line the model turned down isn't asked about again on the next save", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Wildcards should do what you want here");
  await until("the model's answer", () => t.modelPrompts().length === 1);
  await t.settled();
  await t.edit(note.id, text => `${text}\n\nAnother line.`, AGENT);
  await t.settled();
  expect(t.modelPrompts()).toHaveLength(1);
  expect(t.store.require(note.id).text).not.toContain("asks.derived");
});

test.each([
  ["exits non-zero", ["false"]],
  ["can't start", ["/no/such/model"]],
  ["answers prose", ["echo", "I think both of them, yes."]],
  ["leaves a line out", ["echo", "{}"]],
  ["is turned off", []],
])("the model %s: nothing is written, not even the maybes; the run says so and the backfill counts it failed", async (_, answer) => {
  const t = await setup(["Older yard\n\nSome text.\n\n- Should the hedge be low?\n- Maybe move the beans, what do you think?"], 100, { answer });
  const [old] = t.older as [Block];
  const before = t.store.require(old.id).text;
  const out: string[] = [];
  expect(await asksBackfill(boardOf(t), { since: "30d", write: true }, { out: s => { out.push(s); }, err: s => { out.push(s); } })).toBe(1);
  expect(t.store.require(old.id).text).toBe(before);
  expect(out.join("\n")).toContain(old.id);
  expect(out.join("\n")).toMatch(/model|answer/i);
  expect(out.join("\n")).toContain("1 failed");
  const records = await t.client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `asks.note=${old.id}`, machinery: "show" } } as never);
  expect(records.blocks).toEqual([]);
});

test("PIE-1708: a model that isn't logged in names the command that stores claude's login; nothing is written", async () => {
  const t = await setup(["Older yard\n\nSome text.\n\n- Should the hedge be low?"], 100,
    { answer: [process.execPath, "-e", 'console.log("Not logged in · Please run /login"); process.exit(1)'] });
  const [old] = t.older as [Block];
  const before = t.store.require(old.id).text;
  const out: string[] = [];
  expect(await asksBackfill(boardOf(t), { since: "30d", write: true }, { out: s => { out.push(s); }, err: s => { out.push(s); } })).toBe(1);
  expect(out.join("\n")).toContain("with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN");
  expect(t.store.require(old.id).text).toBe(before);
});

test("with only unsure lines the model isn't called, so a live settle still writes the maybe with no model at all", async () => {
  const t = await setup([], 100, { answer: ["false"] });
  const note = await t.write("Yard\n\nSome text.\n\n- Maybe move the beans, what do you think?");
  const text = await t.marked(note.id);
  expect(text).toContain("[maybe-needs::sysop]");
});

test("a question callout's title can ask; another callout's header, a heading and a table row never reach Jev", async () => {
  const t = await setup(["Yard\n\n> [!question] Should the shed face south?\n> [!warning] Should nobody touch the fence?\n## Should the hedge go?\n| Should the fence stay? | yes |\n\nSome text."]);
  await dryRun(t);
  const read = t.asked.flatMap(a => Object.values(a)).join("\n");
  expect(read).toContain("Should the shed face south?");
  for (const line of ["touch the fence", "the hedge go", "the fence stay"]) expect(read).not.toContain(line);
});

// Codex on #1337: each of these could happen on pie.

const SAME_START = "- Should the shed face south, which we went over at length with the gardener last week and wrote up in the plan, ";

test("Codex on #1337: a declined line whose ending is edited into a new request is asked again, past the chip's hundred characters", async () => {
  const t = await setup();
  const note = await t.write(`Yard\n\nSome text.\n\n${SAME_START}turned down by then`);
  await until("the model's answer", () => t.modelPrompts().length === 1);
  await t.settled();
  expect(t.store.require(note.id).text).not.toContain("asks.derived");
  await t.edit(note.id, text => text.replace("turned down by then", "and you should pick one now"), AGENT);
  await t.marked(note.id);
  expect(t.modelPrompts()).toHaveLength(2);
});

test("Codex on #1337: a declined line moved under another heading is asked again; the same words in the same place aren't", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\n## Beds\n- Wildcards should do what you want here\n\n## Paths\nSome text.");
  await until("the model's answer", () => t.modelPrompts().length === 1);
  await t.settled();
  await t.edit(note.id, text => `${text}\n\nAnother line.`, AGENT);
  await t.settled();
  expect(t.modelPrompts()).toHaveLength(1);
  await t.edit(note.id, text => text.replace("- Wildcards should do what you want here\n\n", "").replace("Some text.", "- Wildcards should do what you want here"), AGENT);
  await until("the model's second answer", () => t.modelPrompts().length === 2);
});

test("Codex on #1337: the model's no is kept apart from a chip you took off, which stays off whatever the section", async () => {
  const t = await setup();
  const note = await t.write("Yard\n\nSome text.\n\n- Wildcards should do what you want here\n- Should the hedge be cut low?");
  await t.marked(note.id);
  const records = await t.client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `asks.note=${note.id}`, machinery: "show" } } as never);
  const keys = records.blocks.map(b => b.text.includes("Wildcards") ? "declined" : "marked").sort();
  expect(keys).toEqual(["declined", "marked"]);
  for (const b of records.blocks) expect(b.text.includes("[asks.line::")).toBe(!b.text.includes("Wildcards"));
  await t.edit(note.id, text => text.replace(/ \[needs::[^\]]*\] \[asks\.derived::[^\]]*\]/, "").replace("Some text.", "## Beds"));
  await t.edit(note.id, text => `${text}\n\nAnother line.`, AGENT);
  await t.settled();
  expect(t.store.require(note.id).text).not.toContain("asks.derived");
});

test("Codex on #1337: a label over a request still reaches Jev and gets its chip; a label over a statement doesn't", async () => {
  const t = await setup(["Yard\n\nSome text.\n\n- Decision: Evan, please choose cedar or larch\n- Check: Evan, please confirm the shed dimensions\n- Decision: a header picture is set one way\n- Check: the mower takes its keys from the tile"]);
  const { said } = await dryRun(t);
  const read = t.asked.flatMap(a => Object.values(a)).join("\n");
  for (const line of ["please choose cedar", "please confirm the shed"]) { expect(read).toContain(line); expect(said).toContain(line); }
  for (const line of ["header picture", "takes its keys"]) expect(read).not.toContain(line);
});

test("a long note reaches the model as the lines around what's asked, with its title and a gap marked", async () => {
  const { confirmPrompt } = await import("../extensions/asks/asks-confirm");
  const rows = Array.from({ length: 800 }, (_, i) => `- Row ${i} of beans along the old fence by the shed door`);
  const prompt = confirmPrompt(["Yard plan", ...rows].join("\n"), [400]);
  expect(prompt).toContain("Title: Yard plan");
  expect(prompt).toContain("L401: - Row 399 of beans");
  expect(prompt).toContain("401| - Row 399 of beans");
  expect(prompt).toContain("441| - Row 439 of beans");
  expect(prompt).not.toContain("442| - Row 440 of beans");
  expect(prompt).not.toContain("300| - Row 298 of beans");
  expect(prompt).toContain("\n…\n");
});

test("what follows a line stops at its limit, and reads the same as the whole section cut there", async () => {
  const bodies: { state: { around?: Record<string, { later?: string }> } }[] = [];
  const { readAsks } = await import("../src/write-review");
  const rows = Array.from({ length: 200 }, (_, i) => `- Row ${i} of beans along the old fence by the shed door`);
  await readAsks(["Yard", "", "- Should the shed move?", ...rows].join("\n"), {
    apiKey: "fake", env: { OUTLINER_FIGURE_FIT: "on" }, fetch: (async (_: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body); bodies.push(body);
      return Response.json({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } });
    }) as never,
  });
  expect(bodies[0]!.state.around?.L2?.later).toBe(rows.join("\n").slice(0, 600));
});
