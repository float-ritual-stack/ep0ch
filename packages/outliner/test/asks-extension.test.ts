// PIE-1612: the write review's asks kept as properties. A scratch service with the asks extension installed and a fake
// Jev that answers by the line's words; every note is made up. The table, the settle wait, clearing, and the waiting
// list reading what it wrote.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
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
const NOUL: [RegExp, number][] = [[/shed|fence|hedge|quoted/i, 0.92], [/maybe/i, 0.5], [/idle/i, 0.1]];

async function setup(past: readonly string[] = []) {
  const asked: Record<string, string>[] = [];
  const jev = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as { state: { asks?: Record<string, string> }; questions: Record<string, unknown> };
      asked.push(body.state.asks ?? {});
      const answers: Record<string, { type: string; noul: number }> = {};
      for (const id of Object.keys(body.questions)) {
        const line = body.state.asks?.[id.split("::")[1]!] ?? "";
        answers[id] = { type: "noul", noul: NOUL.find(([pattern]) => pattern.test(line))?.[1] ?? 0.1 };
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
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  // Notes from before the rule: a rule starts from now, so only a backfill reaches them.
  const older = past.map(text => store.create(text, null, "agent", { actorId: "builder" }));
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, ruleQuietMs: 100 });
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
  return { older, store, client, write, edit, marked, settled, waiting, asked };
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
  const before = t.asked.length;
  await t.edit(note.id, text => `${text}\n\nAnother line.`, AGENT);
  await until("the review asked again", () => t.asked.length > before);
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
