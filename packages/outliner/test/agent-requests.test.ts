// Agents addressed while you write (PIE-501): a person's `@name …` line runs the agent an extension
// declares; its patches apply as an attributed edit through draft.patch (edit policy), a failed compare
// becomes a proposal, a reply shows under the line, and a line an agent wrote waits for r. Scratch
// services and made-up notes only.
import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { hostApi } from "../src/host-api";
import { requestLines } from "../src/agent-requests";
import { applyLocated, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import type { DraftHolderRequest } from "../src/draft-patch";
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

async function setup(options: { quietMs?: number } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-agents-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const extensions = join(outline, "extensions");
  mkdirSync(extensions, { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "tidy"), join(extensions, "tidy"), { recursive: true });
  writeFileSync(join(extensions, "tidy", "config.json"), JSON.stringify({ config: { answer: [] } }));
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
  return { store, client, create, agentOf, writeAgent, restart, counted };
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
        else { door.text = applyLocated(door.text, located.spans); answer = { applied: true }; }
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
  const again = await client.request<ResourceProjectionReadResult>({ action: "resources.projection.refresh", blockId: note.id, line: 3 });
  expect(again.projections.find((p) => p.kind === "agent")).toMatchObject({ summary: "nothing to tidy above" });
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
  await until("both unique asks finished", () => store.agentRequests(note.id).length === 2 && store.agentRequests(note.id).every(r => r.answeredAt));
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

test("a patch whose compare fails becomes a proposal under the line; a reply shows under it; a failure says why", async () => {
  const { store, create, agentOf, writeAgent } = await setup();
  await writeAgent("stale", `process.stdout.write(JSON.stringify({ ok: true, value: { patches: [{ observed: "text the note never had", replacement: "x" }] } }));`);
  const note = await create("Plan\nthe real text\n@stale");
  const proposed = await agentOf(note.id, (p) => p.status === "ready");
  const proposalId = proposed.agent!.proposalId!;
  expect(proposed.agent!.status).toBe("proposed");
  expect(proposed.summary).toStartWith("proposed instead: ");
  expect(store.get(proposalId)?.parentId).toBe(note.id);
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

test("a request's proposal, applied anyway or dismissed, says so under the line (PIE-510)", async () => {
  const { store, client, create, agentOf, writeAgent } = await setup();
  await writeAgent("stale", `process.stdout.write(JSON.stringify({ ok: true, value: { patches: [{ observed: "two  beans", replacement: "two beans" }] } }));`);
  const dropped = await create("Plan\nthe real text\n@stale");
  const first = await agentOf(dropped.id, (p) => p.agent?.status === "proposed");
  const dismissed = await client.request<{ outcome: string }>({ action: "draft.proposal.dismiss", proposalId: first.agent!.proposalId!, mutation: PERSON });
  expect(dismissed.outcome).toBe("dismissed");
  const after = await agentOf(dropped.id, (p) => p.agent?.status === "dismissed");
  expect(after.summary).toBe("its proposal was dismissed");

  const kept = await create("Plan\nthe real text\n@stale");
  const second = await agentOf(kept.id, (p) => p.agent?.status === "proposed");
  // The passage the agent meant turns up after all; the person applies the proposal anyway.
  const now = store.get(kept.id)!;
  await client.request({ action: "update", blockId: kept.id, text: now.text.replace("the real text", "two  beans"), expectedRevision: now.revision, mutation: PERSON });
  await client.request({ action: "draft.proposal.apply", proposalId: second.agent!.proposalId!, mutation: PERSON });
  const applied = await agentOf(kept.id, (p) => p.agent?.status === "applied");
  expect(applied.summary).toBe("its proposal was applied anyway");
  expect(store.get(kept.id)!.text).toStartWith("Plan\ntwo beans\n@stale");
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
  expect((await agentOf(old.id, (p) => p.status === "not-run")).reason).toBe("r asks @slow");

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
  expect(again).toMatchObject({ status: "waiting", message: "held: @sneaky is already in this chain (@sneaky → @sneaky), so a repeat is held · r to send" });

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
  expect(back.message).toBe("held: @ping is already in this chain (@ping → @pong → @ping), so a repeat is held · r to send");

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

  expect(store.agentRequests(crashed.id)[0]).toMatchObject({ status: "failed", message: "interrupted by a restart: r asks again" });
  expect(store.agentRequests(waiting.id)[0]).toMatchObject({ status: "waiting", message: "the service stopped before @count answered: r asks it", requestedBy: "user" });
  await client.request({ action: "resources.projection.refresh", blockId: waiting.id, line: 1 });
  expect(calls()).toEqual(["run please"]);
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
  expect(store.agentRequests(crashed.id)[0]).toMatchObject({ status: "failed", message: "interrupted by a restart: r asks again" });
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
  expect(calls()).toEqual(["run allowance", "run from an agent"]);
  expect(store.agentRequests(theirs.id)[0]).toMatchObject({ status: "replied", requestedBy: "user" });
  // Released by a person, an agent may ask it again on its line, and is named as who asked.
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id, line: 1, mutation: { author: "agent", actorId: "loki" } });
  expect(store.agentRequests(theirs.id)[0]).toMatchObject({ status: "replied", requestedBy: "agent:loki" });
  // r on the note doesn't ask an answered request again.
  await client.request({ action: "resources.projection.refresh", blockId: theirs.id });
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

