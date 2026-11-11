// Agents addressed while you write (PIE-501): a person's `@name …` line runs the agent an extension
// declares; its patches apply as an attributed edit through draft.patch (edit policy), a failed compare
// becomes a proposal, a reply shows under the line, and a line an agent wrote waits for r. Scratch
// services and made-up notes only.
import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { hostApi } from "../src/host-api";
import { requestLines } from "../src/agent-requests";
import { applyLocated, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import type { DraftHolderRequest } from "../src/draft-patch";
import type { RuleListEntry } from "../src/extension-rules";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { ResourceProjection, ResourceProjectionReadResult } from "../src/resource-projection";
import type { Block, OutlinerEvent } from "../src/types";

const PERSON = { author: "user" as const };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup(options: { quietMs?: number; answer?: string[] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-agents-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const extensions = join(outline, "extensions");
  mkdirSync(extensions, { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "tidy"), join(extensions, "tidy"), { recursive: true });
  writeFileSync(join(extensions, "tidy", "config.json"), JSON.stringify({ config: { answer: options.answer ?? [] } }));
  let store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  let server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: options.quietMs ?? 80 });
  await server.start();
  const client = new OutlinerClient(socket);
  /** The service stops and starts again on the same outline (the client reconnects). */
  const restart = async (quietMs = 80, reopen = false) => {
    await server.close();
    if (reopen) { store.close(); store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline }); }
    server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: quietMs });
    await server.start();
    await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  };
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, by: "user" | "agent" = "user") =>
    client.request<Block>({ action: "create", text, author: by, ...(by === "agent" ? { provenance: { actorId: "claude-test" } } : {}) });
  const agentOf = async (blockId: string, ready: (projection: ResourceProjection) => boolean) => until("the agent's projection", async () =>
    (await client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId })).projections.find((p) => p.kind === "agent" && ready(p)));
  const writeAgent = async (id: string, code: string, effects?: "write") => {
    mkdirSync(join(extensions, id), { recursive: true });
    writeFileSync(join(extensions, id, "extension.json"), JSON.stringify({ contract: 2, id, version: 1, name: id, run: ["bun", "main.ts"], agents: [{ name: id, ...(effects ? { effects } : {}) }] }));
    writeFileSync(join(extensions, id, "main.ts"), code);
    await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  };
  /** An agent that tidies nothing and counts its runs (one line per run in `calls`). */
  const counted = async (id: string) => {
    const log = join(root, `${id}.log`);
    await writeAgent(id, `import { appendFileSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, "run " + request.input.request + "\\n");
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "noted" } }));`);
    return () => existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  };
  return { store, client, create, agentOf, writeAgent, restart, counted, socket };
}

/**
 * A stand-in for a door holding a live draft of one note: it answers the service's `draft` reads and patches
 * against its own buffer, with the compare the door vendors.
 */
async function fakeDoor(client: OutlinerClient, clientId: string, block: Block) {
  const door = { text: block.text, holdId: "", requests: [] as DraftHolderRequest[], progress: [] as NonNullable<OutlinerEvent["ask"]>[] };
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId, role: "observer", contextId: clientId },
    onConnect: connected.resolve,
    onEvent: async (event: OutlinerEvent) => {
      if (event.blockId === block.id && event.ask) door.progress.push(event.ask);
      if (event.domain !== "draft" || !event.draft) return;
      const request = event.draft;
      door.requests.push(request);
      let answer: unknown = { applied: false, reason: "not in this stand-in" };
      if (request.kind === "read") answer = { text: door.text, revision: block.revision };
      else if (request.kind === "patch") {
        const located = locateSpans(door.text, request.patches, request.force);
        if (!located.ok) answer = { applied: false, reason: located.reason };
        else {
          const text = door.text;
          door.text = applyLocated(door.text, located.spans);
          answer = { applied: true, ...(request.undoPatches ? {inverse: {before: door.text, text, revision: block.revision}} : {}) };
        }
      }
      await client.request({ action: "drafts.answer", requestId: request.requestId, clientId, answer: answer as never }).catch(() => undefined);
    },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  door.holdId = (await client.request<{ holdId: string }>({ action: "drafts.hold", blockId: block.id, clientId, revision: block.revision })).holdId;
  return door;
}

test("request lines: an answered @name at a line's start, outside code; unknown names are prose", () => {
  const names = new Set(["tidy"]);
  const lines = requestLines("Plan\n@tidy\n- @tidy: all of it\n`@tidy` in code\n@evan says hi\nmail me @tidy\n```\n@tidy\n```", names);
  expect(lines.map((line) => [line.line, line.agent, line.request])).toEqual([[1, "tidy", ""], [2, "tidy", "all of it"]]);
  expect(lines[0]!.requestKey).not.toBe(lines[1]!.requestKey);
});

test("request lines: only an answered @name at a line start wakes: another handle, an email address, a host, a capital and a mid-line @tidy are prose", () => {
  const names = new Set(["tidy"]);
  const pasted = "@e_p82 said the thing\nsam@tidy.example.com wrote\n@tidy.example.com is a host\n@tidy@mastodon.example\n@Tidy loud\nask @tidy later\n  - @tidy still";
  expect(requestLines(pasted, names).map((line) => line.line)).toEqual([6]);
});

test("@tidy: a person's request tidies the paragraph above as an attributed edit, and says so under the line", async () => {
  const { store, client, create, agentOf } = await setup();
  const note = await create("Morning plan\n*  call the  printer people\n-   **  order  ** paper\n@tidy\nstill typing here");
  const done = await agentOf(note.id, (p) => p.status === "ready");
  expect(done).toMatchObject({ provider: "tidy", label: "Tidy", key: "@tidy", anchor: { line: 3 }, summary: "formatted 2 lines",
    agent: { name: "tidy", status: "applied", requestedBy: "user" } });
  expect(store.get(note.id)!.text).toBe("Morning plan\n- call the printer people\n- **order** paper\n@tidy\nstill typing here");
  const changes = store.changes.since(0, 1000);
  const edit = changes.kind === "changes" ? changes.changes.find((change) => change.kind === "edit" && change.blockId === note.id) : undefined;
  expect(edit?.actor).toMatchObject({ author: "agent", actorId: "ext:tidy" });
  expect(edit?.action).toBe("ext.tidy.agent.tidy");

  // It ran once: a later save of the note (another line) doesn't ask again. r does.
  const current = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: `${current.text} and more`, expectedRevision: current.revision, mutation: PERSON });
  await Bun.sleep(250);
  expect(store.agentRequests(note.id).map((row) => row.status)).toEqual(["applied"]);
  // r answers at once, saying it runs (PIE-1737); the answer lands on the line after.
  await client.request<ResourceProjectionReadResult>({ action: "resources.projection.refresh", blockId: note.id, line: 3 });
  expect(await agentOf(note.id, (p) => p.status === "ready" && p.agent?.status === "nothing")).toMatchObject({ summary: "nothing to tidy above" });
});

test("bare tidy fixes staggered nesting and counts actual changes (PIE-916)", async () => {
  const { store, create, agentOf } = await setup();
  const note = await create("Plan\n        - apples  \n  - pears\n    - plums\n- figs\n@tidy");
  const done = await agentOf(note.id, p => p.status === "ready");
  expect(store.get(note.id)!.text).toBe("Plan\n- apples\n- pears\n  - plums\n- figs\n@tidy");
  expect(done.summary).toBe("fixed nesting in 3 items, trimmed 1 line");
  const continued = await create("Plan\n   - parent\n       - child\n\n     continuation\n@tidy all");
  await agentOf(continued.id, p => p.status === "ready");
  expect(store.get(continued.id)!.text).toBe("Plan\n- parent\n  - child\n\n  continuation\n@tidy all");
});

test("a live draft gets tidy's reason, including repeated asks (PIE-916)", async () => {
  const { client, create, store } = await setup();
  const note = await create("Plan");
  const door = await fakeDoor(client, "tidy-reasons", note);
  door.text = "Plan\n- apples\n@tidy remove cruft\n@tidy  remove cruft\n@tidy yo\n";
  await client.request({ action: "drafts.touch", holdId: door.holdId });
  // The same words again on another line are an ask of their own (PIE-1722): three asks, each answered.
  await until("every ask finished", () => store.agentRequests(note.id).length === 3 && store.agentRequests(note.id).every(r => r.answeredAt));
  const lines = ["@tidy remove cruft", "@tidy  remove cruft", "@tidy yo"];
  await until("every final progress delivered", () => lines.every(line => door.progress.some(p => p.line === line && p.warning?.includes("no model"))));
  for (const line of lines) {
    expect([...door.progress].reverse().find(p => p.line === line)?.warning).toContain("no model");
  }
});

test("a request line an agent wrote runs; a line still being changed runs once, as finally written", async () => {
  const { store, client, create, agentOf } = await setup();
  const theirs = await create("Draft\n*  messy  line\n@tidy", "agent");
  await agentOf(theirs.id, p => p.status === "ready");
  expect(store.get(theirs.id)!.text).toBe("Draft\n- messy line\n@tidy");

  // Typed in two saves inside the quiet window: only the finished request runs.
  const mine = await create("Notes\n*  one  two\n@tidy al");
  await client.request({ action: "update", blockId: mine.id, text: "Notes\n*  one  two\n@tidy all", expectedRevision: mine.revision, mutation: PERSON });
  await agentOf(mine.id, (p) => p.status === "ready");
  expect(store.agentRequests(mine.id).map((row) => row.request)).toEqual(["all"]);
});

test("a patch whose compare fails reports an error without a proposal; replies still show under the line", async () => {
  const { store, create, agentOf, writeAgent } = await setup();
  await writeAgent("stale", `process.stdout.write(JSON.stringify({ ok: true, value: { patches: [{ observed: "text the note never had", replacement: "x" }] } }));`);
  const note = await create("Plan\nthe real text\n@stale");
  const refused = await agentOf(note.id, (p) => p.status === "unavailable");
  expect(refused.agent!.status).toBe("failed");
  expect(refused.reason).toContain("read it again and send the patch");
  expect(store.children(note.id)).toEqual([]);
  expect(store.get(note.id)!.text).toContain("the real text");

  await writeAgent("answer", `const request = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: { message: "two items", reply: "- [ ] call Dana\\n- [ ] [status::x] stays text", } }));`);
  const asked = await create("Yesterday\n@answer what is left over");
  const replied = await agentOf(asked.id, (p) => p.status === "ready");
  expect(replied.agent!.status).toBe("replied");
  expect(store.get(asked.id)!.text).toContain("@answer what is left over\n> [!note]- @answer answered\n> - [ ] call Dana\n> - [ ] [status::x] stays text");

  await writeAgent("broken", `process.stdout.write(JSON.stringify({ ok: true, value: { patches: "nope" } }));`);
  const bad = await create("x\n@broken");
  const failed = await agentOf(bad.id, (p) => p.status === "unavailable");
  expect(failed.reason).toBe("@broken answered something the service can't apply: patches must be a list of at most 20");
});

test("a line asked in other words: its new answer takes the old one's place under it, and a quotation under the line stays (PIE-1585)", async () => {
  const { store, client, create, agentOf, writeAgent } = await setup();
  await writeAgent("answer", `const request = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "for: " + request.input.request } }));`);
  const note = await create("Shed\n@answer how do I\n\nthe rest");
  await agentOf(note.id, (p) => p.status === "ready");
  expect(store.get(note.id)!.text).toBe("Shed\n@answer how do I\n> [!note]- @answer answered\n> for: how do I\n\nthe rest");
  const reworded = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: reworded.text.replace("how do I", "how do I lift it"), expectedRevision: reworded.revision, mutation: PERSON });
  await until("the new answer", () => store.get(note.id)!.text.includes("for: how do I lift it"));
  expect(store.get(note.id)!.text).toBe("Shed\n@answer how do I lift it\n> [!note]- @answer answered\n> for: how do I lift it\n\nthe rest");
  const quoting = await create("Shed\n@answer what next\n> a quotation of mine");
  await until("the answer", () => store.get(quoting.id)!.text.includes("for: what next"));
  expect(store.get(quoting.id)!.text).toContain("> a quotation of mine");
});

test("asked again in other words, only the answer the agent wrote goes: a quotation of his under it and an answer he edited stay (PIE-1585)", async () => {
  const { store, client, create, writeAgent } = await setup();
  await writeAgent("answer", `const request = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "for: " + request.input.request } }));`);
  const reword = async (id: string, from: string, to: string) => {
    const now = store.get(id)!;
    await client.request({ action: "update", blockId: id, text: now.text.replace(from, to), expectedRevision: now.revision, mutation: PERSON });
    await until(`the answer for ${to}`, () => store.get(id)!.text.includes(`for: ${to.replace(/^@answer /, "")}`));
  };
  const typed = async (id: string, text: string) => {
    const now = store.get(id)!;
    await client.request({ action: "update", blockId: id, text, expectedRevision: now.revision, mutation: PERSON });
  };

  // A quotation of his right under the answer (no blank line between) stays, and the new answer doesn't swallow it.
  const quoted = await create("Shed\n@answer how do I");
  await until("the answer", () => store.get(quoted.id)!.text.includes("for: how do I"));
  await typed(quoted.id, `${store.get(quoted.id)!.text}\n> a quotation of mine`);
  await reword(quoted.id, "@answer how do I", "@answer how do I lift it");
  expect(store.get(quoted.id)!.text).toBe("Shed\n@answer how do I lift it\n> [!note]- @answer answered\n> for: how do I lift it\n\n> a quotation of mine");

  // An answer he corrected is his now: the new one goes above it and his correction stays.
  const edited = await create("Shed\n@answer what next");
  await until("the answer", () => store.get(edited.id)!.text.includes("for: what next"));
  await typed(edited.id, store.get(edited.id)!.text.replace("> for: what next", "> for: what next, and water the beans"));
  await reword(edited.id, "@answer what next", "@answer what next week");
  expect(store.get(edited.id)!.text).toBe("Shed\n@answer what next week\n> [!note]- @answer answered\n> for: what next week\n\n> [!note]- @answer answered\n> for: what next, and water the beans");
});

test("a streamed answer asked again in other words keeps a quotation of his under the old one (PIE-1585)", async () => {
  const { store, client, create, writeAgent } = await setup();
  await writeAgent("drip", `const request = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ reply: "for: " + request.input.request }) + "\\n");
process.stdout.write(JSON.stringify({ ok: true, value: { message: "done" } }));`);
  const note = await create("Shed\n@drip how do I");
  await until("the answer", () => store.get(note.id)!.text.includes("for: how do I"));
  let now = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: `${now.text}\n> a quotation of mine`, expectedRevision: now.revision, mutation: PERSON });
  now = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: now.text.replace("@drip how do I", "@drip how do I lift it"), expectedRevision: now.revision, mutation: PERSON });
  await until("the new answer", () => store.get(note.id)!.text.includes("for: how do I lift it"));
  expect(store.get(note.id)!.text).toContain("> a quotation of mine");
  expect(store.get(note.id)!.text).not.toContain("for: how do I\n");
});

test("only a request a person's save adds runs: lines from before the install wait, note-level r doesn't ask, typing elsewhere still applies", async () => {
  const { store, client, create, agentOf, writeAgent } = await setup();
  // Written while no extension answered @slow: when one appears, an unrelated save doesn't run it.
  const old = await create("Old note\n*  stale  text\n@slow");
  await writeAgent("slow", `const request = await Bun.stdin.json();
await Bun.sleep(400);
const text = request.input.note.text;
const observed = text.split("\\n")[1];
process.stdout.write(JSON.stringify({ ok: true, value: { message: "done", patches: [{ observed, replacement: observed.toUpperCase() }] } }));`);
  const current = store.get(old.id)!;
  await client.request({ action: "update", blockId: old.id, text: `${current.text}\nmore`, expectedRevision: current.revision, mutation: PERSON });
  await Bun.sleep(300);
  expect(store.agentRequests(old.id)).toEqual([]);
  expect((await agentOf(old.id, (p) => p.status === "not-run")).reason).toBe("waits for a person to ask @slow");

  // A note with no @ lines yet, never read: the person's first request in it is new, and runs.
  const plain = await create("Plain note\nsome  words");
  await client.request({ action: "update", blockId: plain.id, text: "Plain note\nsome  words\n@slow", expectedRevision: plain.revision, mutation: PERSON });
  await until("the first request answered", () => store.agentRequests(plain.id)[0]?.status === "applied");

  // A new request; the person types below it while the agent works: the edit still applies.
  const note = await create("Plan\nfirst line\n@slow\n");
  await until("running", () => store.agentRequests(note.id)[0]?.status === "running");
  const typing = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: `${typing.text}typing below`, expectedRevision: typing.revision, mutation: PERSON });
  await until("answered", () => store.agentRequests(note.id)[0]?.status === "applied");
  expect(store.get(note.id)!.text).toBe("Plan\nFIRST LINE\n@slow\ntyping below");

  // r on the note refreshes its other lines but never re-asks an agent.
  const answeredAt = store.agentRequests(note.id)[0]!.answeredAt;
  await client.request({ action: "resources.projection.refresh", blockId: note.id });
  await Bun.sleep(600);
  expect(store.agentRequests(note.id)[0]!.answeredAt).toBe(answeredAt);
  expect(store.agentRequests(note.id).map((row) => row.status)).toEqual(["applied"]);
});

test("an agent's answer may write a request line: it lands, held; a request reworded while it runs drops the old answer", async () => {
  const { store, client, create, agentOf, writeAgent } = await setup();
  await writeAgent("sneaky", `const text = (await Bun.stdin.json()).input.note.text;
process.stdout.write(JSON.stringify({ ok: true, value: { patches: [{ observed: "harmless", replacement: "@sneaky again" }] } }));`);
  const note = await create("x\nharmless\n@sneaky");
  await agentOf(note.id, (p) => p.status === "ready");
  expect(store.get(note.id)!.text).toBe("x\n@sneaky again\n@sneaky");
  const again = store.agentRequests(note.id).find((row) => row.request === "again");
  expect(again).toMatchObject({ status: "waiting", message: "held: @sneaky is already in this chain (@sneaky → @sneaky), so a repeat is held · ask again to send" });

  await writeAgent("tardy", `await Bun.sleep(400);
process.stdout.write(JSON.stringify({ ok: true, value: { patches: [{ observed: "words", replacement: "WORDS" }] } }));`);
  const asked = await create("y\nwords\n@tardy one");
  await until("running", () => store.agentRequests(asked.id)[0]?.status === "running");
  const now = store.get(asked.id)!;
  await client.request({ action: "update", blockId: asked.id, text: "y\nwords\n@tardy two", expectedRevision: now.revision, mutation: PERSON });
  await until("the new wording answered", () => store.agentRequests(asked.id).some((row) => row.request === "two" && row.status === "applied"));
  expect(store.agentRequests(asked.id).map((row) => row.request)).toEqual(["two"]);
  expect(store.get(asked.id)!.text).toBe("y\nWORDS\n@tardy two");
});

const AGENT = { author: "agent" as const, actorId: "claude-test" };

test("an agent's draft.patch wakes an agent in a live draft and a saved note", async () => {
  const { store, client, create, counted } = await setup();
  const calls = await counted("count");
  const held = await create("Errands\nbuy string\nmore words");
  const door = await fakeDoor(client, "door-1", held);
  await client.request({ action: "draft.patch", blockId: held.id, revision: held.revision, mutation: AGENT,
    patches: [{ observed: "buy string", replacement: "buy string\n@count draft" }] });
  await until("draft answered", () => store.agentRequests(held.id)[0]?.status === "replied");
  expect(door.text).toContain("> noted");
  const saved = await create("Ledger\nentry");
  await client.request({ action: "draft.patch", blockId: saved.id, revision: saved.revision, mutation: AGENT,
    patches: [{ observed: "entry", replacement: "entry\n@count saved" }] });
  await until("saved answered", () => store.agentRequests(saved.id)[0]?.status === "replied");
  expect(store.get(saved.id)!.text).toContain("> noted");
  expect(calls()).toEqual(["run draft", "run saved"]);
});

test("an OAuth connector's MCP write is the person's ask, even with an invocation deny", async () => {
  const { store, client, create, counted, agentOf } = await setup();
  const calls = await counted("loki");
  await create("No automatic asks [invoke-from::all] [invoke-deny::loki]");
  const parent = await create("Inbox");
  const api = hostApi(client, { actorId: "mcp:daddy/chat.example", sessionId: "fixture-oauth-subject#call" }, { mcpAccess: "full" });
  const result = await api.tool.outline_create!({ parent: parent.id, text: "Pickup\n@loki pick this up" }) as { id: string };
  const projection = await agentOf(result.id, p => p.agent?.status === "replied" || p.agent?.status === "waiting" || p.agent?.status === "nothing");
  expect(projection.agent?.status).toBe("replied");
  expect(calls()).toEqual(["run pick this up"]);
  expect(store.get(result.id)?.author).toBe("agent");
});

test("agents wake each other by default and a daily cap survives a service restart", async () => {
  const { client, create, counted, agentOf, restart } = await setup();
  const calls = await counted("loki");
  const plain = await create("Pickup\n@loki pick this up", "agent");
  const initial = await agentOf(plain.id, p => p.agent?.status === "replied" || p.agent?.status === "waiting");
  expect(initial.agent?.status).toBe("replied");
  expect(calls()).toEqual(["run pick this up"]);
  await create("Limit wakes [invoke-from::agents] [invoke-to::loki] [cap::1/day]");
  const first = await create("First\n@loki first", "agent");
  await agentOf(first.id, p => p.agent?.status === "replied");
  await restart(80, true);
  const second = await create("Second\n@loki second", "agent");
  const held = await agentOf(second.id, p => p.agent?.status === "waiting");
  expect(held.agent?.message).toContain("cap");
  expect(calls()).toEqual(["run pick this up", "run first"]);
  expect((await client.request<Block>({ action: "get", blockId: second.id })).text).toContain("@loki second");
});

test("a chain of woken asks stops at a repeat and at its hop limit, each held with why", async () => {
  const { store, create, writeAgent, agentOf } = await setup();
  const patching = (observed: string, replacement: string) => `process.stdout.write(JSON.stringify({ ok: true, value: { patches: [{ observed: ${JSON.stringify(observed)}, replacement: ${JSON.stringify(replacement)} }] } }));`;
  await writeAgent("ping", patching("seed", "@pong next"));
  await writeAgent("pong", patching("start", "start\n@ping back"));
  const note = await create("start\nseed\n@ping go");
  await until("pong asked and answered", () => store.agentRequests(note.id).find((r) => r.agent === "pong" && r.status === "applied"));
  expect(store.get(note.id)!.text).toBe("start\n@ping back\n@pong next\n@ping go");
  const back = store.agentRequests(note.id).find((r) => r.request === "back")!;
  expect(back).toMatchObject({ agent: "ping", status: "waiting", requestedBy: "agent:ext:pong" });
  expect(back.message).toBe("held: @ping is already in this chain (@ping → @pong → @ping), so a repeat is held · ask again to send");

  // A pair can narrow the default: the writer wakes the agent, and what that agent writes is held.
  await writeAgent("first", patching("seed", "@second next"));
  await writeAgent("second", patching("start", "start\n@third later"));
  await writeAgent("third", patching("start", "start"));
  await create("Let first wake second [invoke-from::ext:first] [invoke-to::second] [max-hops::1]");
  await create("Let second wake third [invoke-from::ext:second] [invoke-to::third] [max-hops::1]");
  const chain = await create("start\nseed\n@first go");
  await until("second answered", () => store.agentRequests(chain.id).find((r) => r.agent === "second" && r.status === "applied"));
  const later = store.agentRequests(chain.id).find((r) => r.agent === "third")!;
  expect(later).toMatchObject({ status: "waiting" });
  expect(later.message).toContain("max-hops: allows 1 hop and this would be hop 2");
  await agentOf(chain.id, (p) => p.agent?.name === "third" && p.agent.status === "waiting");
}, 40_000);

test("an answering agent's connection cannot reuse the person's approval to wake itself", async () => {
  const { store, create, writeAgent } = await setup();
  await writeAgent("echo", `import { connect } from "node:net";
const r = await Bun.stdin.json();
if (r.input.request === "start") await new Promise((resolve, reject) => {
  const c = connect(process.env.EP0CH_SOCKET); let b = "";
  c.on("data", d => { b += d; if (!b.includes("\\n")) return; c.end(); const reply = JSON.parse(b); reply.ok ? resolve(reply.result) : reject(new Error(reply.error)); });
  c.on("error", reject);
  c.write(JSON.stringify({ id: "copy", grant: process.env.EP0CH_EXT_GRANT, action: "create", parentId: r.input.note.id, text: "Followup\\n@echo again" }) + "\\n");
});
process.stdout.write(JSON.stringify({ ok: true, value: { message: "finished" } }));`, "write");
  const note = await create("Echo\n@echo start");
  await until("parent finished", () => store.agentRequests(note.id)[0]?.status === "nothing");
  const child = store.children(note.id)[0]!;
  const row = await until("followup decided", () => store.agentRequests(child.id)[0]);
  expect(row.status).toBe("waiting");
  expect(row.message).toContain("@echo is already in this chain");
});

test("notes from before agent requests keep their @name lines old; restarts say what they cut off (B5, B17)", async () => {
  const { store, client, create, restart, counted } = await setup({ quietMs: 60_000 });
  // A note as it was before this feature: an `@count` line, no baseline, no rows.
  const old = await create("Old note\n@count from long ago", "agent");
  const calls = await counted("count");
  store.database.query("DELETE FROM agent_request_baseline").run();
  store.database.query("DELETE FROM agent_requests").run();
  store.database.query("DELETE FROM metadata WHERE key = 'agent_request_baseline_seeded'").run();
  // A person's request still waiting for quiet, and one a crash left running.
  const waiting = await create("Fresh\n@count please");
  const crashed = await create("Crashed\n@count halfway");
  store.putAgentRequest({ blockId: crashed.id, requestKey: requestLines(crashed.text, null)[0]!.requestKey, agent: "count", extensionId: "count",
    request: "halfway", status: "running", requestedBy: "user", requestedAt: new Date().toISOString() });
  await restart();

  const current = store.get(old.id)!;
  await client.request({ action: "update", blockId: old.id, text: `${current.text}\nan unrelated line`, expectedRevision: current.revision, mutation: PERSON });
  await Bun.sleep(300);
  expect(calls()).toEqual([]);
  expect(store.agentRequests(old.id)).toEqual([]);

  expect(store.agentRequests(crashed.id)[0]).toMatchObject({ status: "failed", message: "interrupted by a restart: ask again" });
  expect(store.agentRequests(waiting.id)[0]).toMatchObject({ status: "waiting", message: "the service stopped before @count answered: ask it again", requestedBy: "user" });
  await client.request({ action: "resources.projection.refresh", blockId: waiting.id, line: 1 });
  await until("the asked one ran", () => calls().length === 1);
  expect(calls()).toEqual(["run please"]);
});

// PIE-1722: the same words again are an ask of their own now. A baseline written before that keyed every repeat by the first
// line's key, once per line: those repeats are old lines, and a save that touches the note asks nothing.
test("repeated @name lines a baseline from before PIE-1722 holds stay old; a new repeat is asked", async () => {
  const { store, client, create, counted } = await setup({ quietMs: 50 });
  const note = await create("Twice\n@count do it\n@count do it", "agent");
  const calls = await counted("count");
  const first = requestLines(note.text, null)[0]!;
  // As the old code wrote it: the plain key once per line, and the first line answered.
  store.database.query("DELETE FROM agent_requests").run();
  store.setAgentRequestBaseline(note.id, [first.requestKey, first.requestKey]);
  let current = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: `${current.text}\nan unrelated line`, expectedRevision: current.revision, mutation: PERSON });
  await Bun.sleep(400);
  expect(calls()).toEqual([]);
  // A third, written now: a new ask.
  current = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: `${current.text}\n@count do it`, expectedRevision: current.revision, mutation: PERSON });
  await until("the new repeat asked", () => calls().length === 1);
  expect(calls()).toEqual(["run do it"]);
});

// PIE-1722 review (CodeRabbit on #1422): the same words written again above an answered ask are the new ask. The answered
// line keeps its answer and is not asked again; the line written now is asked and answered under itself.
test("the same words written above an answered ask: the new line is asked, the answered one keeps its answer", async () => {
  const { store, client, create, counted } = await setup({ quietMs: 50 });
  const calls = await counted("count");
  const note = await create("Shelf\nfirst\n@count tally\nlast");
  await until("the first ask answered", () => store.agentRequests(note.id).some(r => r.answeredAt));
  expect(calls()).toEqual(["run tally"]);
  let current = store.get(note.id)!;
  expect(current.text).toContain("@count tally\n> [!note]");
  // Written above it, on its own line: a new ask in the same words.
  await client.request({ action: "update", blockId: note.id, text: current.text.replace("Shelf\nfirst\n", "Shelf\n@count tally\nfirst\n"), expectedRevision: current.revision, mutation: PERSON });
  await until("the new ask answered", () => calls().length === 2 && store.agentRequests(note.id).filter(r => r.answeredAt).length === 2);
  current = store.get(note.id)!;
  const lines = current.text.split("\n");
  // Each line has one answer, right under it: the new one under the line written now, the old one where it was.
  expect(lines[1]).toBe("@count tally");
  expect(lines[2]).toMatch(/^> \[!note\]/);
  expect(current.text.split("@count tally\n> [!note]").length - 1).toBe(2);
  await Bun.sleep(300);
  expect(calls()).toEqual(["run tally", "run tally"]);
});

test("in a live draft too: the same words typed above an answered ask are asked, and the answered one isn't", async () => {
  const { store, client, create, counted } = await setup({ quietMs: 50 });
  const calls = await counted("count");
  const note = await create("Shelf\nfirst\n@count tally\nlast");
  await until("the first ask answered", () => store.agentRequests(note.id).some(r => r.answeredAt));
  const saved = store.get(note.id)!;
  const door = await fakeDoor(client, "door-dup", saved);
  door.text = saved.text.replace("Shelf\nfirst\n", "Shelf\n@count tally\nfirst\n");
  await client.request({ action: "drafts.touch", holdId: door.holdId });
  await until("the new ask answered in the draft", () => calls().length === 2);
  await until("its answer under the new line", () => door.text.split("\n")[2]?.startsWith("> [!note]"));
  // Touched again with nothing new: nothing more is asked.
  await client.request({ action: "drafts.touch", holdId: door.holdId });
  await Bun.sleep(300);
  expect(calls()).toEqual(["run tally", "run tally"]);
  expect(door.text.split("@count tally\n> [!note]").length - 1).toBe(2);
});

// PIE-1711, the verifier's re-walk: an answer belongs to its ask line. Typed on, then typed back, the line's answer is for the
// words it says now, never one left from a keystroke since undone; and that line never swallows the same words asked anew.
test("an ask typed on and back is answered for what it says now; the same words on a new line are answered too", async () => {
  const { store, client, create, writeAgent } = await setup({ quietMs: 50 });
  const log = join(mkdtempSync(join(tmpdir(), "echo-")), "echo.log");
  await writeAgent("echo", `import { appendFileSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, request.input.request + "\\n");
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "for: " + request.input.request } }));`);
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  const note = await create("Hub\nfirst line");
  const door = await fakeDoor(client, "door-retype", note);
  const type = async (text: string) => { door.text = text; await client.request({ action: "drafts.touch", holdId: door.holdId }); };
  await type("Hub\nfirst line\n@echo hub items not sent");
  await until("the first answer", () => door.text.includes("> for: hub items not sent"));
  // Typed on: the answer follows the words.
  await type(door.text.replace("@echo hub items not sent\n", "@echo hub items not sent AND\n"));
  await until("the answer to the longer words", () => door.text.includes("> for: hub items not sent AND"));
  // Typed back: the answer is for the words again, and only one answer is under the line.
  await type(door.text.replace("@echo hub items not sent AND\n", "@echo hub items not sent\n"));
  await until("the answer for the words as they are", () => door.text.includes("> for: hub items not sent\n") || door.text.endsWith("> for: hub items not sent"), );
  expect(door.text).not.toContain("not sent AND");
  expect(door.text.split("@echo answered").length - 1).toBe(1);
  // The same words again on a new line: answered, under it.
  await type(`${door.text}\n@echo hub items not sent`);
  await until("the new line answered", () => door.text.split("@echo answered").length - 1 === 2);
  expect(door.text.trimEnd()).toMatch(/@echo hub items not sent\n> \[!note\][-+] @echo answered\n> for: hub items not sent$/);
  expect(store.agentRequests(note.id).length).toBeGreaterThanOrEqual(2);
  // Asked once per wording it said, and once more for the new line: never twice for a line that already had its answer.
  expect(asked()).toEqual(["hub items not sent", "hub items not sent AND", "hub items not sent", "hub items not sent"]);
});

test("an outline a host opens gets the same start: old @name lines baselined, cut-off requests failed (B5, B17 hosted)", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-agents-hosted-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: join(root, "outline") });
  const old = store.create("Old note\n@tidy from long ago");
  const crashed = store.create("Crashed\n@tidy halfway");
  store.database.query("DELETE FROM agent_request_baseline").run();
  store.putAgentRequest({ blockId: crashed.id, requestKey: requestLines(crashed.text, null)[0]!.requestKey, agent: "tidy", extensionId: "tidy",
    request: "halfway", status: "running", requestedBy: "user", requestedAt: new Date().toISOString() });
  const server = new OutlinerServer(store, join(root, "unused.sock"), undefined, undefined, { extensionPollMs: 0 });
  server.startHosted();
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  expect(store.agentRequestBaseline(old.id)).toEqual(requestLines(old.text, null).map((line) => line.requestKey));
  expect(store.agentRequests(crashed.id)[0]).toMatchObject({ status: "failed", message: "interrupted by a restart: ask again" });
});

test("a reason stored before the door's run-again key moved reads with no key: nothing tells a person to press r (Codex, #1314)", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-agents-old-words-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: join(root, "outline") });
  cleanups.push(async () => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const put = (title: string, status: "waiting" | "failed", message: string, requestedBy: string) => {
    const block = store.create(`${title}\n@tidy please`);
    store.putAgentRequest({ blockId: block.id, requestKey: requestLines(block.text, null)[0]!.requestKey, agent: "tidy", extensionId: "tidy", request: "please", status, message, requestedBy, requestedAt: new Date().toISOString() });
    return block.id;
  };
  const held = put("Held", "waiting", "held: budget: all 2 wakes in this chain are spent · r to send", "agent:fern");
  const stopped = put("Stopped", "waiting", "the service stopped before @tidy answered: r asks it", "user");
  const crashed = put("Crashed", "failed", "interrupted by a restart: r asks again", "user");
  const own = put("Its own words", "failed", "the r to send button is broken", "user");
  expect(store.heldAgentRequests().map(row => row.message)).toEqual(["held: budget: all 2 wakes in this chain are spent · ask again to send"]);
  expect(store.agentRequests(held)[0]!.message).toBe("held: budget: all 2 wakes in this chain are spent · ask again to send");
  expect(store.agentRequests(stopped)[0]!.message).toBe("the service stopped before @tidy answered: ask it again");
  expect(store.agentRequests(crashed)[0]!.message).toBe("interrupted by a restart: ask again");
  expect(store.agentRequests(own)[0]!.message).toBe("the r to send button is broken");
});

test("taking an answered line out and putting it back (undo) doesn't ask again (B18)", async () => {
  const { store, client, create, agentOf, counted } = await setup();
  const calls = await counted("count");
  const note = await create("Note\n@count once\nend");
  await agentOf(note.id, (p) => p.status === "ready");
  expect(calls()).toEqual(["run once"]);
  const save = async (text: string) => {
    const block = store.get(note.id)!;
    await client.request({ action: "update", blockId: note.id, text, expectedRevision: block.revision, mutation: PERSON });
  };
  await save("Note\nend");
  await Bun.sleep(150);
  expect(store.agentRequests(note.id)).toEqual([]);
  await save("Note\n@count once\nend");
  await Bun.sleep(400);
  expect(calls()).toEqual(["run once"]);
  expect(store.agentRequests(note.id).map((row) => row.status)).toEqual(["replied"]);
});

test("yolo: an agent's r releases a line an agent wrote, as a person's r would (PIE-973)", async () => {
  const { client, create, agentOf, counted } = await setup();
  const calls = await counted("count");
  await create("One wake [invoke-from::agents] [invoke-to::count] [cap::1/day]");
  const spent = await create("Spent\n@count allowance", "agent");
  await agentOf(spent.id, p => p.agent?.status === "replied");
  const theirs = await create("Shared\n@count from an agent", "agent");
  await agentOf(theirs.id, (p) => p.agent?.status === "waiting");
  const byAgent = { author: "agent" as const, actorId: "loki" };
  await expect(client.request({ action: "resources.projection.refresh", blockId: theirs.id, line: 1, mutation: byAgent })).rejects.toThrow("it waits for a person's r");
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({ client: { clientId: "door-yolo", role: "observer", contextId: "door-yolo" }, onConnect: connected.resolve, onEvent: () => {} });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await client.request({ action: "agents.yolo", clientId: "door-yolo", on: true });
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id, line: 1, mutation: byAgent });
  await until("the released one ran", () => calls().length === 2);
  expect(calls()).toEqual(["run allowance", "run from an agent"]);
});

test("r says who asked, an agent's r doesn't release a line an agent wrote, and r on the note asks what isn't answered (C6, E5)", async () => {
  const { store, client, create, agentOf, counted } = await setup();
  const calls = await counted("count");
  await create("One wake [invoke-from::agents] [invoke-to::count] [cap::1/day]");
  const spent = await create("Spent\n@count allowance", "agent");
  await agentOf(spent.id, p => p.agent?.status === "replied");
  const theirs = await create("Shared\n@count from an agent", "agent");
  await agentOf(theirs.id, (p) => p.agent?.status === "waiting");
  await expect(client.request({ action: "resources.projection.refresh", blockId: theirs.id, line: 1, mutation: { author: "agent", actorId: "loki" } }))
    .rejects.toThrow("@count on this line was written by an agent or an import: it waits for a person's r");
  // Who asks is checked as extensions.act checks it: an agent names itself, and no other author passes as a person.
  await expect(client.request({ action: "resources.projection.refresh", blockId: theirs.id, line: 1, mutation: { author: "agent" } }))
    .rejects.toThrow("resources.projection.refresh's mutation names who asks");
  await expect(client.request({ action: "resources.projection.refresh", blockId: theirs.id, mutation: { author: "someone" } } as never))
    .rejects.toThrow("resources.projection.refresh's mutation names who asks");
  // Not on the note either: the agent's note-level r passes it by.
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id, mutation: { author: "agent", actorId: "loki" } });
  expect(calls()).toEqual(["run allowance"]);
  // Detail's r sends only the note: a person's asks the waiting request.
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id });
  await until("the person's r answered", () => store.agentRequests(theirs.id)[0]?.status === "replied");
  expect(calls()).toEqual(["run allowance", "run from an agent"]);
  expect(store.agentRequests(theirs.id)[0]).toMatchObject({ status: "replied", requestedBy: "user" });
  // Released by a person, an agent may ask it again on its line, and is named as who asked.
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id, line: 1, mutation: { author: "agent", actorId: "loki" } });
  await until("the agent's r answered", () => calls().length === 3 && store.agentRequests(theirs.id)[0]?.status === "replied");
  expect(store.agentRequests(theirs.id)[0]).toMatchObject({ status: "replied", requestedBy: "agent:loki" });
  // r on the note doesn't ask an answered request again: a run it started would say running by now (PIE-1737).
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id });
  expect(store.agentRequests(theirs.id)[0]?.status).toBe("replied");
  expect(calls()).toHaveLength(3);
});

test("drafts.touch: a request written in a held draft runs before any save, and the save doesn't run it twice (F1)", async () => {
  const { store, client, create } = await setup();
  const note = await create("Morning plan\n*  call the  printer people");
  const door = await fakeDoor(client, "door-2", note);
  await expect(client.request({ action: "drafts.touch", holdId: "no-such-hold" })).rejects.toThrow("hold the draft again");
  // The person types `@tidy` in the draft and keeps going; the door says so.
  door.text = "Morning plan\n*  call the  printer people\n@tidy\nand then";
  expect(await client.request<{ touched: boolean }>({ action: "drafts.touch", holdId: door.holdId })).toEqual({ touched: true });
  await until("the draft tidied", () => door.text === "Morning plan\n- call the printer people\n@tidy\nand then");
  await until("answered", () => store.agentRequests(note.id)[0]?.status === "applied");
  expect(store.get(note.id)!.text).toBe("Morning plan\n*  call the  printer people");
  const answeredAt = store.agentRequests(note.id)[0]!.answeredAt;
  // The door saves the draft as the person: the request is known, nothing runs again.
  await client.request({ action: "update", blockId: note.id, text: door.text, expectedRevision: note.revision, mutation: PERSON });
  await Bun.sleep(300);
  expect(store.agentRequests(note.id).map((row) => [row.status, row.answeredAt])).toEqual([["applied", answeredAt]]);
  expect(door.requests.filter((request) => request.kind === "patch")).toHaveLength(1);
});



test("resolve a revision-four proposal against revision five, or leave conflicting readings open", async () => {
  const answer = ["bun", "-e", `const prompt = await Bun.stdin.text();
const data = JSON.parse(prompt.split("RESOLUTION CONTEXT:\\n")[1]);
if (data.region_ours === "carrots") console.log(JSON.stringify({ambiguous: "Proposal asks for peas; current note asks for carrots."}));
else console.log(JSON.stringify({patches: [{observed: "grow beans", replacement: "grow peas"}], message: "Kept the new delivery date and changed the crop."}));`];
  const { client, store, create } = await setup({ answer });
  for (const conflict of [false, true]) {
    let note = await create("Garden plan\ngrow beans\ndelivery Monday");
    for (let i = 2; i <= 4; i++) note = await client.request<Block>({action: "update", blockId: note.id, text: `Garden plan ${i}\ngrow beans\ndelivery Monday`, expectedRevision: note.revision, mutation: PERSON});
    const proposal = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: 4, propose: true, patches: [{observed: "grow beans", replacement: "grow peas"}], mutation: {author: "agent", actorId: "gardener"}});
    const current = await client.request<Block>({action: "update", blockId: note.id, text: note.text.replace(conflict ? "grow beans" : "Monday", conflict ? "grow carrots" : "Tuesday"), expectedRevision: 4, mutation: PERSON});
    const api = hostApi(client, {actorId: "resolver-test"}, {mcpAccess: "full"});
    const tool = conflict ? await api.tool.outline_proposal_resolve!({ref: proposal.proposalId}) as {outcome: string; undo?: string} : undefined;
    const result = tool ?? await client.request<{outcome: string; undo?: string}>({action: "draft.proposal.resolve", proposalId: proposal.proposalId, mutation: PERSON});
    const resolved = store.get(proposal.proposalId)!;
    if (conflict) {
      expect(result.outcome).toBe("open");
      expect(store.get(note.id)!.text).toBe(current.text);
      expect(resolved.text).toContain("Proposal asks for peas; current note asks for carrots.");
      expect(resolved.properties).toContainEqual(expect.objectContaining({key: "proposal-status", value: "open"}));
    } else {
      expect(result).toMatchObject({outcome: "resolved"});
      expect(store.get(note.id)!.text).toBe(current.text.replace("grow beans", "grow peas"));
      const changes = store.changes.since(0, 1000);
      const edit = changes.kind === "changes" ? [...changes.changes].reverse().find(change => change.kind === "edit" && change.blockId === note.id) : undefined;
      expect(edit?.actor).toMatchObject({author: "agent", actorId: "ext:tidy"});
      expect(resolved.text).toContain(`((${note.id}`);
      expect(resolved.text).toContain("[from::gardener]");
      expect(result.undo).toBeString();
      await client.request({action: "extensions.undo", undo: result.undo!, mutation: PERSON});
      expect(store.get(note.id)!.text).toBe(current.text);
      expect(store.get(proposal.proposalId)!.properties).toContainEqual(expect.objectContaining({key: "proposal-status", value: "open"}));
      expect(resolved.properties).toContainEqual(expect.objectContaining({key: "proposal-status", value: "resolved"}));
    }
  }
  await create("Invalid resolver [rule-name::invalid-resolver] [rule-on::proposal/resolve] [rule-match::kind=unused]");
  const rules = await client.request<ExtensionsListResult & {rules: RuleListEntry[]}>({action: "extensions.list"});
  expect(rules.rules?.find(rule => rule.name === "invalid-resolver")?.problem).toContain("proposal isn't installed");
  await create("Resolve stale proposals [rule-name::resolve-stale] [rule-on::tidy/resolve] [rule-match::type=proposal stale=true] [rule-quiet::1s]");
  const auto = await create("Auto garden\ngrow beans\ndelivery Monday");
  const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: auto.id, revision: auto.revision, propose: true, patches: [{observed: "grow beans", replacement: "grow peas"}], mutation: {author: "agent", actorId: "gardener"}});
  await client.request({action: "update", blockId: auto.id, text: auto.text.replace("Monday", "Tuesday"), expectedRevision: auto.revision, mutation: PERSON});
  await until("the rule resolving the stale proposal", () => store.get(pending.proposalId)!.properties.some(p => p.key === "proposal-status" && p.value === "resolved"));
  expect(store.get(auto.id)!.text).toContain("grow peas\ndelivery Tuesday");
  expect(store.get(pending.proposalId)!.text).toContain("[via-trigger::resolve-stale]");
  const waiting = await client.request<{proposals: unknown[]}>({action: "draft.proposals.list", blockId: auto.id});
  expect(waiting.proposals).toEqual([]);

});


test("resolution respects the proposal's request boundary", async () => {
  const patches = [{observed: "grow beans", replacement: "grow peas"}];
  const answer = ["bun", "-e", `await Bun.stdin.text(); console.log(${JSON.stringify(JSON.stringify({patches, message: "Changed the crop."}))});`];
  const {client, store, create} = await setup({answer});
  const note = await create("Garden\n@tidy\ngrow beans");
  const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: note.revision, propose: true, patches, mark: {text: "@tidy", blockId: note.id}, mutation: {author: "agent", actorId: "gardener"}});
  const result = await client.request<{outcome: string; message: string}>({action: "draft.proposal.resolve", proposalId: pending.proposalId, mutation: PERSON});
  expect(result.outcome).toBe("open");
  expect(result.message).toContain("the mark or below");
  expect(store.require(note.id).text).toBe(note.text);
});


test("three-way resolution merges independent words and appends without calling the model, and undoes exactly", async () => {
  const cases = [
    {base: "We grow beans every Monday.", ours: "We grow beans every Tuesday.", patches: [{observed: "beans", replacement: "peas"}], expected: "We grow peas every Tuesday."},
    {base: "We grow beans every Monday.", ours: "Our gardeners grow beans every Monday.", patches: [{observed: "beans", replacement: "peas"}], expected: "Our gardeners grow peas every Monday."},
    {base: "We grow beans.", ours: "We grow carrots.", patches: [{observed: "", replacement: "\nDelivery Tuesday."}], expected: "We grow carrots.\nDelivery Tuesday."},
  ];
  for (const c of cases) {
    const {client, store, create, counted} = await setup();
    const calls = await counted("tidy");
    const note = await create("Garden\n" + c.base);
    const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: note.revision, propose: true, patches: c.patches, mutation: {author: "agent", actorId: "gardener"}});
    const current = await client.request<Block>({action: "update", blockId: note.id, expectedRevision: note.revision, text: "Garden\n" + c.ours, mutation: PERSON});
    const result = await client.request<{outcome: string; undo: string}>({action: "draft.proposal.resolve", proposalId: pending.proposalId, mutation: PERSON});
    expect(calls()).toEqual([]);
    expect(result.outcome).toBe("resolved");
    expect(store.require(note.id).text).toBe("Garden\n" + c.expected);
    await client.request({action: "extensions.undo", undo: result.undo, mutation: PERSON});
    expect(store.require(note.id).text).toBe(current.text);
  }
});

test.each([false, true])("conflicts alone reach the model; an ambiguous region leaves the whole proposal open (%s)", async ambiguous => {
  const answer = ["bun", "-e", `const prompt = await Bun.stdin.text();
const data = JSON.parse(prompt.split("RESOLUTION CONTEXT:\\n")[1]);
if (data.region_base === "Monday") {
  if (JSON.stringify(data) !== JSON.stringify({region_base: "Monday", region_ours: "Tuesday", region_theirs: "Wednesday", proposal_note: "Keep both crops."})) throw new Error("unexpected date conflict");
  console.log(JSON.stringify(${ambiguous} ? {ambiguous: "Proposal asks for Wednesday; current note asks for Tuesday."} : {replacement: "Thursday"}));
} else {
  if (JSON.stringify(data) !== JSON.stringify({region_base: "beans", region_ours: "carrots", region_theirs: "peas", proposal_note: "Keep both crops."})) throw new Error("model received more than the conflict: " + JSON.stringify(data));
  console.log(JSON.stringify({replacement: "peas and carrots"}));
}`];
  const {client, store, create} = await setup({answer});
  const note = await create("Garden [kind::plan]\nWe grow beans every Monday.\nsee [[Seed list]] ^seeds\nUntouched  spaces  ");
  const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: note.revision, propose: true, patches: [{observed: "beans", replacement: "peas"}, {observed: "Monday", replacement: "Wednesday"}], mutation: {author: "agent", actorId: "gardener"}});
  const proposal = store.require(pending.proposalId);
  await client.request({action: "update", blockId: proposal.id, expectedRevision: proposal.revision, text: proposal.text.replace("\nTo ", "\nKeep both crops.\nTo "), mutation: PERSON});
  const current = await client.request<Block>({action: "update", blockId: note.id, expectedRevision: note.revision, text: note.text.replace("beans", "carrots").replace("Monday", "Tuesday"), mutation: PERSON});
  const result = await client.request<{outcome: string; message: string; undo: string}>({action: "draft.proposal.resolve", proposalId: pending.proposalId, mutation: PERSON});
  if (ambiguous) {
    expect(result.outcome).toBe("open");
    expect(result.message).toBe("Proposal asks for Wednesday; current note asks for Tuesday.");
    expect(store.require(note.id).text).toBe(current.text);
    expect(store.require(proposal.id).properties).toContainEqual({key: "proposal-status", value: "open"});
  } else {
    expect(result.outcome).toBe("resolved");
    expect(store.require(note.id).text).toBe(current.text.replace("carrots", "peas and carrots").replace("Tuesday", "Thursday"));
    await client.request({action: "extensions.undo", undo: result.undo, mutation: PERSON});
    expect(store.require(note.id).text).toBe(current.text);
  }
});


test("long-note conflicts exclude 1,100 unchanged words from the model", async () => {
  const answer = ["bun", "-e", `const prompt = await Bun.stdin.text();
const data = JSON.parse(prompt.split("RESOLUTION CONTEXT:\\n")[1]);
console.log(JSON.stringify(data.region_base === "beans" && data.region_ours === "carrots" && data.region_theirs === "peas" ? {replacement: "peas and carrots"} : data.region_base === "Monday" && data.region_ours === "Tuesday" && data.region_theirs === "Wednesday" ? {replacement: "Thursday"} : {ambiguous: "unchanged text reached the model"}));`];
  const {client, store, create} = await setup({answer});
  const middle = Array.from({length: 1100}, (_, i) => `unchanged${i}`).join(" ");
  const note = await create(`Garden\nbeans ${middle} Monday`);
  const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: note.revision, propose: true, patches: [{observed: "beans", replacement: "peas"}, {observed: "Monday", replacement: "Wednesday"}], mutation: {author: "agent", actorId: "gardener"}});
  await client.request({action: "update", blockId: note.id, expectedRevision: note.revision, text: `Garden\ncarrots ${middle} Tuesday`, mutation: PERSON});
  const result = await client.request<{outcome: string; message: string}>({action: "draft.proposal.resolve", proposalId: pending.proposalId, mutation: PERSON});
  expect(result).toMatchObject({outcome: "resolved"});
  expect(store.require(note.id).text).toBe(`Garden\npeas and carrots ${middle} Thursday`);
});

test("undoing resolution restores the agent request's proposed row and projection", async () => {
  const answer = ["bun", "-e", 'await Bun.stdin.text(); console.log(JSON.stringify({replacement: "peas and carrots"}));'];
  const {client, store, create, agentOf, writeAgent} = await setup({answer});
  await writeAgent("grower", `await Bun.stdin.json(); console.log(JSON.stringify({ok: true, value: {message: "A suggestion follows."}}));`);
  const note = await create("Garden\nbeans\n@grower");
  await agentOf(note.id, p => p.status === "ready");
  const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: note.revision, propose: true,
    patches: [{observed: "beans", replacement: "peas"}], mutation: {author: "agent", actorId: "grower"}});
  await client.request({action: "update", blockId: note.id, expectedRevision: note.revision, text: "Garden\ncarrots\n@grower", mutation: PERSON});
  // An existing request-linked proposal must still restore its request row when resolution is undone.
  store.putAgentRequest({...store.agentRequests(note.id)[0]!, status: "proposed", proposalId: pending.proposalId});
  const projected = await agentOf(note.id, p => p.agent?.status === "proposed");
  const before = store.agentRequests(note.id)[0]!;
  const result = await client.request<{outcome: string; undo: string}>({action: "draft.proposal.resolve", proposalId: projected.agent!.proposalId!, mutation: PERSON});
  expect(result.outcome).toBe("resolved");
  expect(store.require(note.id).text).toBe("Garden\npeas and carrots\n@grower");
  expect(store.agentRequests(note.id)[0]!.status).toBe("applied");
  await client.request({action: "extensions.undo", undo: result.undo, mutation: PERSON});
  expect(store.require(note.id).text).toBe("Garden\ncarrots\n@grower");
  expect(store.agentRequests(note.id)[0]).toEqual(before);
  expect((await agentOf(note.id, p => p.agent?.status === "proposed")).agent!.proposalId).toBe(before.proposalId!);
});


test("undo restores every byte after resolution empties a held draft", async () => {
  const {client, store, create} = await setup();
  const note = await create("Garden\r\nKeep  these bytes.  \r\n日本語 👩🏽‍💻\r\n");
  const door = await fakeDoor(client, "door-empty-resolution", note);
  const pending = await client.request<{proposalId: string}>({action: "draft.patch", blockId: note.id, revision: note.revision, propose: true, patches: [{observed: note.text, replacement: ""}], mutation: {author: "agent", actorId: "gardener"}});
  const result = await client.request<{outcome: string; undo: string}>({action: "draft.proposal.resolve", proposalId: pending.proposalId, mutation: PERSON});
  expect(result.outcome).toBe("resolved");
  expect(door.text).toBe("");
  await client.request({action: "extensions.undo", undo: result.undo, mutation: PERSON});
  expect(door.text).toBe(note.text);
  expect(store.require(note.id).text).toBe(note.text);
  expect(store.require(pending.proposalId).properties).toContainEqual({key: "proposal-status", value: "open"});
});

// PIE-1180: an agent still streaming when its service stops. Its next chunk's reply is refused ("the service
// stopped while answering"); that refusal ends the run quietly, never as an unhandled rejection that fails
// whichever test or process happens to be running next. The last chunk has no newline, as a real agent's might.
test("an agent streaming when the service stops ends quietly, its late chunks refused, nothing unhandled", async () => {
  const { create, writeAgent, restart, store } = await setup();
  const unhandled: unknown[] = [];
  const catcher = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", catcher);
  try {
    await writeAgent("drip", `await Bun.stdin.json();
process.stdout.write(JSON.stringify({ reply: "first" }) + "\\n");
await Bun.sleep(400);
process.stdout.write(JSON.stringify({ reply: "late" }) + "\\n" + JSON.stringify({ reply: "last" }));
process.exit(0);`);
    const note = await create("Seedlings\n@drip water them");
    await until("the first chunk in the note", () => store.get(note.id)?.text.includes("first"));
    await restart();                             // the service that asked stops; a new one starts
    await Bun.sleep(900);                        // the agent's late and last chunks arrive at the stopped one
    expect(unhandled.map(String)).toEqual([]);
  } finally { process.off("unhandledRejection", catcher); }
}, 20_000);

// PIE-1711, the verifier's re-walk: an answer that says what kept it from answering (no model, Jev not set up) is never
// recalled for the same words: taken out and written again, the line is asked again.
test("an answer marked retry is asked again when its line is taken out and written back; a real answer is recalled", async () => {
  const { store, client, create, writeAgent } = await setup({ quietMs: 50 });
  const log = join(mkdtempSync(join(tmpdir(), "flaky-")), "flaky.log");
  await writeAgent("flaky", `import { appendFileSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, request.input.request + "\\n");
const down = request.input.request.startsWith("down");
process.stdout.write(JSON.stringify({ ok: true, value: { reply: down ? "not set up here" : "found it", ...(down ? { retry: true } : {}) } }));`);
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  for (const words of ["down find hub items", "up find hub items"]) {
    const note = await create(`Hub\n@flaky ${words}`);
    await until(`${words} answered`, () => asked().filter(a => a === words).length === 1 && store.agentRequests(note.id).some(r => r.answeredAt));
    let current = store.get(note.id)!;
    const answered = current.text;
    // Taken out, then written back as it was (an undo would do the same).
    await client.request({ action: "update", blockId: note.id, text: "Hub", expectedRevision: current.revision, mutation: PERSON });
    current = store.get(note.id)!;
    await client.request({ action: "update", blockId: note.id, text: answered, expectedRevision: current.revision, mutation: PERSON });
    await Bun.sleep(600);
    expect([words, asked().filter(a => a === words).length]).toEqual([words, words.startsWith("down") ? 2 : 1]);
  }
});

// PIE-1731, the verifier's walk: in a live draft too, a no-answer's line typed away and typed back is asked again; a real
// answer's is not.
test("in a live draft, a retry answer's line retyped is asked again; a real answer's is kept", async () => {
  const { client, create, writeAgent } = await setup({ quietMs: 50 });
  const log = join(mkdtempSync(join(tmpdir(), "flaky-draft-")), "flaky.log");
  await writeAgent("flaky", `import { appendFileSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, request.input.request + "\\n");
const down = request.input.request.startsWith("down");
process.stdout.write(JSON.stringify({ ok: true, value: { reply: down ? "not set up here" : "found it", ...(down ? { retry: true } : {}) } }));`);
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  for (const words of ["down find hub items", "up find hub items"]) {
    const note = await create("Hub\nfirst line");
    const door = await fakeDoor(client, `door-${words.split(" ")[0]}`, note);
    const type = async (text: string) => { door.text = text; await client.request({ action: "drafts.touch", holdId: door.holdId }); };
    await type(`Hub\nfirst line\n@flaky ${words}`);
    await until(`${words} answered`, () => door.text.includes("@flaky answered"));
    const answered = door.text;
    // Backspaced whole, then typed again: two touches, the first read before the second is sent.
    const reads = () => door.requests.filter(r => r.kind === "read").length;
    let before = reads();
    await type(answered.replace(`@flaky ${words}`, ""));
    await until("the backspaced draft read", () => reads() > before);
    before = reads();
    await type(answered);
    await until("the retyped draft read", () => reads() > before);
    if (words.startsWith("down")) await until("the no-answer asked again", () => asked().filter(a => a === words).length === 2);
    else { await Bun.sleep(400); expect(asked().filter(a => a === words).length).toBe(1); }
  }
});

// PIE-1731, the verifier's walk: an ask line deleted and saved takes its answer with it, as the agent's write; an answer
// the person changed is theirs and stays.
test("a deleted ask takes its answer with it on save; an answer the person changed stays", async () => {
  const { store, client, create, counted } = await setup({ quietMs: 50 });
  await counted("count");
  for (const changed of [false, true]) {
    const note = await create(`Shelf ${changed}\nfirst\n@count tally\nlast`);
    await until("answered", () => store.get(note.id)!.text.includes("@count answered"));
    let current = store.get(note.id)!;
    const without = current.text.replace("@count tally\n", "");
    await client.request({ action: "update", blockId: note.id, text: changed ? without.replace("> noted", "> noted, and kept by me") : without, expectedRevision: current.revision, mutation: PERSON });
    await Bun.sleep(600);
    current = store.get(note.id)!;
    if (changed) expect(current.text).toContain("@count answered");
    else {
      expect(current.text).toBe(`Shelf ${changed}\nfirst\nlast`);
      // Taken out as the agent's write: its revision is the agent's, undone like any.
      expect(store.revisions(note.id).revisions.find(r => r.revision === current.revision)?.author).toBe("agent");
    }
  }
});

// PIE-1733: an ask and its answer put back by the person's undo (the text as it was before the ask went) are the agent's
// again: the ask taken out once more takes its answer with it.
test("an answer put back with its ask by an undo is still the agent's: the ask taken out again takes it", async () => {
  const { store, client, create, counted } = await setup({ quietMs: 50 });
  await counted("count");
  const note = await create("Shelf undo\nfirst\n@count tally\nlast");
  await until("answered", () => store.get(note.id)!.text.includes("@count answered"));
  const answered = store.get(note.id)!.text;
  const take = async () => {
    const current = store.get(note.id)!;
    await client.request({ action: "update", blockId: note.id, text: current.text.replace("@count tally\n", ""), expectedRevision: current.revision, mutation: PERSON });
    await until("the answer gone with its ask", () => !store.get(note.id)!.text.includes("@count answered"));
  };
  await take();
  // The undo: the person writes the note back as it was, ask and answer.
  const now = store.get(note.id)!;
  await client.request({ action: "update", blockId: note.id, text: answered, expectedRevision: now.revision, mutation: PERSON });
  await Bun.sleep(400);
  expect(store.get(note.id)!.text).toBe(answered);
  await take();
  expect(store.get(note.id)!.text).toBe("Shelf undo\nfirst\nlast");
}, 20_000);

// CodeRabbit on #1431: a draft's last-read lines are that draft's (its hold's). A no-answer's line taken out in one draft
// closed unsaved is no rewrite in the next draft of the note: the saved line, unchanged, is not asked again on its first touch.
test("a draft's snapshot is its own hold's: a draft closed unsaved doesn't make the next one re-ask an unchanged line", async () => {
  const { client, create, writeAgent } = await setup({ quietMs: 50 });
  const log = join(mkdtempSync(join(tmpdir(), "flaky-holds-")), "flaky.log");
  await writeAgent("flaky", `import { appendFileSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, request.input.request + "\\n");
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "not set up here", retry: true } }));`);
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  const note = await create("Hub\n@flaky down find hub items");
  await until("answered once", () => asked().length === 1);
  const first = await fakeDoor(client, "door-first", (await client.request<Block>({ action: "get", blockId: note.id } as never)));
  const reads = (d: { requests: { kind: string }[] }) => d.requests.filter(r => r.kind === "read").length;
  // The first draft takes the line out, then closes without saving.
  let n = reads(first);
  first.text = first.text.replace("@flaky down find hub items", "");
  await client.request({ action: "drafts.touch", holdId: first.holdId });
  await until("the first draft read", () => reads(first) > n);
  await client.request({ action: "drafts.release", holdId: first.holdId });
  // The next draft opens on the saved note, the line as it was: its first touch asks nothing.
  const next = await fakeDoor(client, "door-next", (await client.request<Block>({ action: "get", blockId: note.id } as never)));
  n = reads(next);
  await client.request({ action: "drafts.touch", holdId: next.holdId });
  await until("the next draft read", () => reads(next) > n);
  await Bun.sleep(400);
  expect(asked()).toEqual(["down find hub items"]);
});

// PIE-1731, the verifier's walk: a no-answer stays one across a restart (a deploy between the failure and its retype):
// written again in a live draft afterwards, its line is asked again.
test("a retry answer is still one after the service restarts: retyped in a draft, it is asked again", async () => {
  const { store, client, create, writeAgent, restart } = await setup({ quietMs: 50 });
  const log = join(mkdtempSync(join(tmpdir(), "flaky-restart-")), "flaky.log");
  await writeAgent("flaky", `import { appendFileSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, request.input.request + "\\n");
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "not set up here", retry: true } }));`);
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  const note = await create("Hub\n@flaky down find hub items");
  await until("answered once", () => asked().length === 1 && store.agentRequests(note.id).some(r => r.answeredAt));
  await restart(50, true);
  const fresh = new OutlinerClient(client.socketPath);
  const door = await fakeDoor(fresh, "door-after-restart", (await fresh.request<Block>({ action: "get", blockId: note.id } as never)));
  const reads = () => door.requests.filter(r => r.kind === "read").length;
  const type = async (text: string) => { const n = reads(); door.text = text; await fresh.request({ action: "drafts.touch", holdId: door.holdId }); await until("the draft read", () => reads() > n); };
  const saved = door.text;
  await type(saved.replace("@flaky down find hub items", ""));
  await type(saved);
  await until("asked again after the restart", () => asked().length === 2);
});

// PIE-1731, the walk on this branch: an answer this service wrote is still its own after a restart (a deploy). Retyped,
// its line's new answer takes the old one's place, never stacked above it; deleted and saved, the ask takes it along.
test("an answer written before a restart is still the agent's: a retype replaces it, a deleted ask takes it", async () => {
  const { client, create, writeAgent, restart } = await setup({ quietMs: 50 });
  const log = join(mkdtempSync(join(tmpdir(), "flaky-own-")), "flaky.log"), state = join(log, "..", "up");
  await writeAgent("flaky", `import { appendFileSync, existsSync } from "node:fs";
const request = await Bun.stdin.json();
appendFileSync(${JSON.stringify(log)}, request.input.request + "\\n");
const up = existsSync(${JSON.stringify(state)});
process.stdout.write(JSON.stringify({ ok: true, value: { reply: up ? "found 2 notes" : "not set up here", ...(up ? {} : { retry: true }) } }));`);
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  const note = await create("Hub\nfirst\n@flaky find hub items\nlast");
  await until("the failure", () => asked().length === 1);
  await until("the failure saved", () => client.request<Block>({ action: "get", blockId: note.id } as never).then(b => b.text.includes("not set up here")));
  await restart(50, true);
  writeFileSync(state, "");
  const fresh = new OutlinerClient(client.socketPath);
  const read = async () => (await fresh.request<Block>({ action: "get", blockId: note.id } as never));
  await until("the failure saved", async () => (await read()).text.includes("not set up here"));
  const door = await fakeDoor(fresh, "door-own", await read());
  const reads = () => door.requests.filter(r => r.kind === "read").length;
  const type = async (text: string) => { const n = reads(); door.text = text; await fresh.request({ action: "drafts.touch", holdId: door.holdId }); await until("the draft read", () => reads() > n); };
  const saved = door.text;
  await type(saved.replace("@flaky find hub items", ""));
  await type(saved);
  await until("the retype's answer", () => door.text.includes("found 2 notes"));
  // One answer under the line: the new one in the old one's place.
  expect(door.text.split("@flaky answered").length - 1).toBe(1);
  expect(door.text).not.toContain("not set up here");
  // Saved with the line deleted after another restart: the answer goes with it.
  const held = await read();
  await fresh.request({ action: "update", blockId: note.id, text: door.text, expectedRevision: held.revision, mutation: PERSON });
  await restart(50, true);
  const after = new OutlinerClient(client.socketPath), now = await after.request<Block>({ action: "get", blockId: note.id } as never);
  await after.request({ action: "update", blockId: note.id, text: now.text.replace(/\n@flaky find hub items/, ""), expectedRevision: now.revision, mutation: PERSON });
  await until("the answer taken with its ask", async () => !(await after.request<Block>({ action: "get", blockId: note.id } as never)).text.includes("@flaky answered"));
});

// CodeRabbit on #1434: the answers kept across a restart had a cap of 50 per agent and note, so in a note asked more often
// than that (answers gone since still counted) the oldest answer still there was no longer the agent's after a deploy.
test("every answer still in a note is the agent's after a restart, however many it has had", async () => {
  const { store, client, create, writeAgent, restart } = await setup({ quietMs: 50 });
  await writeAgent("echo", `const request = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "re " + request.input.request } }));`);
  const note = await create("Many asks\n@echo first item\nlast");
  const get = () => client.request<Block>({ action: "get", blockId: note.id } as never);
  await until("the first answer", async () => (await get()).text.includes("re first item"));
  // Fifty answers this note had since, gone now (deleted by hand, or with their asks).
  const kept = JSON.parse(store.readMetadata(`agent-answers:${note.id}`) ?? "{}") as Record<string, [string, string][]>;
  kept.echo = [...kept.echo!, ...Array.from({ length: 50 }, (_, i) => [`gone-${i}`, `key-${i}`] as [string, string])];
  store.writeMetadata(`agent-answers:${note.id}`, JSON.stringify(kept));
  const before = await get();
  await client.request({ action: "update", blockId: note.id, text: `${before.text}\n@echo second item`, expectedRevision: before.revision, mutation: PERSON });
  await until("the second answer", async () => (await get()).text.includes("re second item"));
  await restart(50, true);
  const fresh = new OutlinerClient(client.socketPath), read = () => fresh.request<Block>({ action: "get", blockId: note.id } as never);
  const now = await read();
  await fresh.request({ action: "update", blockId: note.id, text: now.text.replace("@echo first item\n", ""), expectedRevision: now.revision, mutation: PERSON });
  await until("the first answer taken with its ask", async () => !(await read()).text.includes("re first item"));
});

// PIE-1737: R on a slow agent's line answers at once, saying it runs, and the connection that pressed it keeps answering
// while the agent works: the door sends its next open, undo and read on that one connection.
test("r on a slow agent answers at once with running, and the same connection keeps answering while it works (PIE-1737)", async () => {
  const { store, client, create, agentOf, writeAgent, socket } = await setup();
  await writeAgent("slow", `await Bun.sleep(2500);
process.stdout.write(JSON.stringify({ ok: true, value: { reply: "took my time" } }));`);
  const note = await create("Seed list\n@slow think it over", "agent");
  await agentOf(note.id, (p) => p.agent?.status !== "running");
  const other = await create("Another note");
  // As a door does: one long-lived connection, the refresh and then a read on it.
  const door = createConnection(socket);
  door.setEncoding("utf8");
  const answered = new Map<string, { at: number; response: { ok: boolean; result?: unknown } }>();
  let buffer = "";
  door.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const response = JSON.parse(buffer.slice(0, at)) as { id: string; ok: boolean; result?: unknown };
      buffer = buffer.slice(at + 1);
      answered.set(response.id, { at: Date.now(), response });
    }
  });
  cleanups.push(() => { door.destroy(); });
  await new Promise<void>((resolve) => door.once("connect", () => resolve()));
  const pressed = Date.now();
  door.write(`${JSON.stringify({ id: "r", action: "resources.projection.refresh", blockId: note.id, line: 1 })}\n`);
  door.write(`${JSON.stringify({ id: "open", action: "get", blockId: other.id })}\n`);
  await until("both answers", () => answered.has("r") && answered.has("open"), 6_000);
  expect(answered.get("r")!.at - pressed).toBeLessThan(1_500);
  expect(answered.get("open")!.at - pressed).toBeLessThan(1_500);
  const projections = (answered.get("r")!.response.result as ResourceProjectionReadResult).projections;
  expect(projections.find((p) => p.kind === "agent")).toMatchObject({ fetching: true, agent: { status: "running" } });
  expect(answered.get("open")!.response.result).toMatchObject({ id: other.id });
  await until("the slow answer", () => store.agentRequests(note.id)[0]?.status === "replied");
});
