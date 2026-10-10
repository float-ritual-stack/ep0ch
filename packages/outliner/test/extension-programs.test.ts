// Extensions as first-class programs (PIE-754): a schedule the service runs and records, a connection to the
// service in every process (EP0CH_SOCKET, EP0CH_WS and a grant that makes its writes ext:<id>'s), writes anywhere
// through the normal paths and guards, secrets by with-secrets group, collections, and an annotation's properties.
// Scratch services in temp folders; every note, name, token and saying is made up.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { liveGrants } from "../src/extension-grants";
import type { ExtensionsListResult } from "../src/extension-registry";
import { nextCron, parseCron } from "../src/extension-schedule";
import { groupValue } from "../src/extension-secrets";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, OutlinerChange, OutlinerEvent } from "../src/types";

const REPO_EXTENSIONS = join(import.meta.dir, "..", "extensions");
const LOKI = { author: "agent" as const, actorId: "loki-test" };
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

/** The helper an extension copies (extensions/almanac/outline.ts), inlined for fixtures. */
const CALL = `import { connect } from "node:net";
const call = (request, name = process.env.EP0CH_WS, grant = process.env.EP0CH_EXT_GRANT) => new Promise((resolve, reject) => {
  const c = connect(process.env.EP0CH_SOCKET); let b = "";
  c.on("data", (d) => { b += d; const n = b.indexOf("\\n"); if (n < 0) return; c.end(); const r = JSON.parse(b.slice(0, n)); r.ok ? resolve(r.result) : reject(new Error(r.error)); });
  c.on("error", reject);
  c.write(JSON.stringify({ id: crypto.randomUUID(), ...(name ? { outline: name } : {}), ...request, grant }) + "\\n");
});
const say = (value) => process.stdout.write(JSON.stringify({ ok: true, value }));
const request = await Bun.stdin.json();
const { operation, input } = request;
`;

async function setup(options: { now?: () => number; secrets?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-ext-programs-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS, secrets: process.env.WITH_SECRETS_DIR };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  process.env.WITH_SECRETS_DIR = options.secrets ?? join(root, "secrets");
  const outline = join(root, "outline");
  const extensions = join(outline, "extensions");
  mkdirSync(extensions, { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const state = join(root, "state");
  const server = new OutlinerServer(store, socket, undefined, undefined, {
    extensionPollMs: 0, stateDirectory: state, scheduleTickMs: 3_600_000, ...(options.now ? { scheduleNow: options.now } : {}),
  });
  server.setOutline({ name: "garden-scratch" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry], ["WITH_SECRETS_DIR", previous.secrets]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const install = async (id: string, manifest: Record<string, unknown>, code: string, config?: Record<string, unknown>) => {
    mkdirSync(join(extensions, id), { recursive: true });
    writeFileSync(join(extensions, id, "extension.json"), JSON.stringify({ contract: 2, id, version: 1, name: id, run: ["bun", "main.ts"], ...manifest }));
    writeFileSync(join(extensions, id, "main.ts"), code);
    if (config) writeFileSync(join(extensions, id, "config.json"), JSON.stringify(config));
    return client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  };
  const feed = (): OutlinerChange[] => {
    const page = store.changes.since(0, 1000);
    return page.kind === "changes" ? page.changes : [];
  };
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  return { root, socket, state, extensions, store, server, client, install, feed, create };
}

// ── A connection to the service ──────────────────────────────────────────

test("every extension process gets its connection and nothing else of the host's: PATH, LANG, the socket, the outline and a grant", async () => {
  const { socket, client, install } = await setup();
  process.env.OUTLINER_TEST_HOST_SECRET = "not-for-extensions";
  cleanups.push(() => { delete process.env.OUTLINER_TEST_HOST_SECRET; });
  const listed = await install("envy", { actions: [{ id: "show", label: "Show", on: "outline" }] },
    `${CALL}say({ message: JSON.stringify({ keys: Object.keys(process.env).filter((k) => !k.startsWith("BUN_")).sort(), socket: process.env.EP0CH_SOCKET, ws: process.env.EP0CH_WS, ext: process.env.OUTLINER_EXTENSION, grant: (process.env.EP0CH_EXT_GRANT ?? "").length }) });`);
  expect(listed.extensions.find((entry) => entry.id === "envy")?.state).toBe("active");
  const done = await client.request<{ message: string }>({ action: "extensions.act", extension: "envy", extensionAction: "show" });
  const seen = JSON.parse(done.message) as { keys: string[]; socket: string; ws: string; ext: string; grant: number };
  expect(seen.keys).toEqual(["EP0CH_EXT_GRANT", "EP0CH_SOCKET", "EP0CH_WS", "LANG", "OUTLINER_EXTENSION", "PATH"]);
  expect(seen).toMatchObject({ socket, ws: "garden-scratch", ext: "envy", grant: 48 });
  // The grant lived only while the process ran.
  expect(liveGrants()).toBe(0);
});

test("a cross-note write over the connection is ext:<id>'s with who asked, runs no extension, and becomes a proposal while the person types", async () => {
  const { store, client, install, feed, create } = await setup();
  const elsewhere = await create("Seed swap\nbring marigolds\nmore later");
  const shelf = await create("Shelf");
  await install("echo", { handlers: [{ key: "echo", kind: "output", effects: "read" }] },
    `${CALL}say({ markdown: "echo " + input.argument });`);
  await install("courier", {
    actions: [{ id: "deliver", label: "Deliver", on: "outline", effects: "write" }, { id: "keepgrant", label: "Keep grant", on: "outline" }],
  }, `${CALL}
if (input.action === "keepgrant") say({ message: process.env.EP0CH_EXT_GRANT });
else {
  const made = await call({ action: "create", parentId: input.args.shelf, text: "Parcel\\necho:: from a courier", author: "user", provenance: { actorId: "someone-else" } });
  const note = await call({ action: "get", blockId: input.args.note });
  const edited = await call({ action: "update", blockId: note.id, expectedRevision: note.revision, text: note.text.replace(input.args.from, input.args.to), mutation: { author: "user" } });
  say({ message: JSON.stringify({ made: made.id, outcome: edited.outcome ?? "block", proposalId: edited.proposalId ?? null }) });
}`);

  // No one types: the update applies, through draft.patch, as the extension, with loki as who asked.
  const first = JSON.parse((await client.request<{ message: string }>({ action: "extensions.act", extension: "courier", extensionAction: "deliver",
    args: { note: elsewhere.id, shelf: shelf.id, from: "marigolds", to: "sunflowers" }, mutation: LOKI })).message) as { made: string; outcome: string };
  expect(first.outcome).toBe("applied");
  expect(store.get(elsewhere.id)!.text).toBe("Seed swap\nbring sunflowers\nmore later");
  const made = store.get(first.made)!;
  expect(made).toMatchObject({ parentId: shelf.id, author: "agent", actorId: "ext:courier" });
  const written = feed().filter((change) => change.actor?.actorId === "ext:courier");
  expect(written.map((change) => change.blockId)).toEqual(expect.arrayContaining([first.made, elsewhere.id]));
  for (const change of written) expect(change).toMatchObject({ action: "ext.courier.deliver", requestedBy: LOKI });
  // An extension's write sets no extension off: the echo:: line it wrote hasn't run.
  await Bun.sleep(400);
  expect(store.extensionOutputs(first.made)).toEqual([]);

  // A door holds the note and the person is typing in that passage: the update is a proposal, not a write.
  const holding = store.get(elsewhere.id)!;
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId: "door-typing", role: "observer", contextId: "door-typing" }, onConnect: connected.resolve,
    onEvent: async (event: OutlinerEvent) => {
      const ask = event.domain === "draft" ? event.draft : undefined;
      if (!ask) return;
      const answer = ask.kind === "read" ? { text: holding.text, revision: holding.revision } : { applied: false, reason: "the person is typing there" };
      await client.request({ action: "drafts.answer", requestId: ask.requestId, clientId: "door-typing", answer: answer as never }).catch(() => undefined);
    },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await client.request({ action: "drafts.hold", blockId: elsewhere.id, clientId: "door-typing", revision: holding.revision });
  const second = JSON.parse((await client.request<{ message: string }>({ action: "extensions.act", extension: "courier", extensionAction: "deliver",
    args: { note: elsewhere.id, shelf: shelf.id, from: "sunflowers", to: "beans" }, mutation: LOKI })).message) as { outcome: string; proposalId: string | null };
  expect(second.outcome).toBe("proposed");
  expect(second.proposalId).toBeString();

  // A grant is good only while its process runs.
  const kept = (await client.request<{ message: string }>({ action: "extensions.act", extension: "courier", extensionAction: "keepgrant" })).message;
  await expect(client.request({ action: "create", text: "late", grant: kept })).rejects.toThrow("EP0CH_EXT_GRANT holds only while");
  // And a client still can't name the actor.
  await expect(client.request({ action: "create", text: "fake", author: "agent", provenance: { actorId: "ext:courier" } })).rejects.toThrow("only the service writes as an extension");
});

test("over its connection an extension reads, writes and comments, and is refused what isn't one of those", async () => {
  const { store, client, install, create } = await setup();
  const note = await create("Pond notes\nThe heron came back on Tuesday.");
  await install("margin", { actions: [{ id: "mark", label: "Mark", on: "outline", effects: "write" }, { id: "wander", label: "Wander", on: "outline" }] }, `${CALL}
if (input.action === "wander") {
  try { await call({ action: "delete", blockId: input.args.note }); say({ message: "deleted" }); }
  catch (error) { say({ message: String(error.message) }); }
} else {
  const block = await call({ action: "get", blockId: input.args.note });
  const receipt = await call({ action: "annotations.batch", requestId: "margin-" + block.revision, operations: [{ operationId: "a", type: "block-comment",
    input: { blockId: block.id, expectedRevision: block.revision, body: "A heron, again.", source: "user", passage: { quote: "The heron came back" },
      properties: { kind: "highlight", tags: ["birds", "pond"], color: "accent" } } }] });
  say({ message: receipt.annotations[0].block.id });
}`);
  const id = (await client.request<{ message: string }>({ action: "extensions.act", extension: "margin", extensionAction: "mark", args: { note: note.id } })).message;
  const annotation = store.get(id)!;
  expect(annotation).toMatchObject({ author: "agent", actorId: "ext:margin", parentId: note.id });
  expect(annotation.text.split("\n")[1]).toBe("[type::annotation] [annotation-source::agent] [annotation-status::open] [kind::highlight] [tags::birds] [tags::pond] [color::accent]");
  // Resolving the thread keeps its properties.
  await client.request({ action: "annotations.lifecycle", input: { annotationId: id, lifecycle: "resolved" }, mutation: { author: "user" } });
  expect(store.get(id)!.text).toContain("[annotation-status::resolved] [kind::highlight] [tags::birds] [tags::pond] [color::accent]");
  // An annotation's own keys aren't a bag's.
  await expect(client.request({ action: "annotations.batch", requestId: "bad-bag", operations: [{ operationId: "a", type: "block-comment",
    input: { blockId: note.id, expectedRevision: store.get(note.id)!.revision, body: "x", source: "user", properties: { "annotation-status": "resolved" } } }] }))
    .rejects.toThrow("annotation-status is the annotation store's own");
  const said = (await client.request<{ message: string }>({ action: "extensions.act", extension: "margin", extensionAction: "wander", args: { note: note.id } })).message;
  expect(said).toContain("ext:margin can read, create, update, comment and annotate over its connection; delete isn't one of them");
  expect(store.get(note.id)!.effectiveDeletedRootId ?? null).toBeNull();
});

test("an action's returned writes may land anywhere in the outline, still all or none, and never on a record an extension keeps", async () => {
  const { store, client, install, create } = await setup();
  const mine = await create("Mine");
  const elsewhere = await create("Elsewhere");
  await install("roam", { actions: [{ id: "drop", label: "Drop", effects: "write" }, { id: "half", label: "Half", effects: "write" }] }, `${CALL}
say({ writes: input.action === "half"
  ? [{ op: "create", parentId: input.args.parent, text: "first" }, { op: "update", blockId: input.target.blockId, expectedRevision: 999, text: "nope" }]
  : [{ op: "create", parentId: input.args.parent, text: "dropped off" }] });`);
  const done = await client.request<{ written: string[] }>({ action: "extensions.act", extension: "roam", extensionAction: "drop", blockId: mine.id, args: { parent: elsewhere.id } });
  expect(store.get(done.written[0]!)).toMatchObject({ parentId: elsewhere.id, text: "dropped off", actorId: "ext:roam" });
  await expect(client.request({ action: "extensions.act", extension: "roam", extensionAction: "half", blockId: mine.id, args: { parent: elsewhere.id } })).rejects.toThrow();
  expect(store.children(elsewhere.id).map((child) => child.text)).toEqual(["dropped off"]);
});

// ── Secrets by with-secrets group ────────────────────────────────────────

test("a with-secrets group key reaches only the extension that names it, as its credential and its variable, never logged", async () => {
  const secrets = realpathSync(mkdtempSync(join(tmpdir(), "outliner-secrets-")));
  cleanups.push(() => rmSync(secrets, { recursive: true, force: true }));
  const group = join(secrets, "pondfeed.env");
  writeFileSync(group, "# made up\nPOND_TOKEN=\"tok-made-up-123\"\nOTHER_TOKEN=tok-other-456\n", { mode: 0o600 });
  chmodSync(group, 0o600);
  const { client, install } = await setup({ secrets });
  const SHOW = `${CALL}say({ message: JSON.stringify({ variable: process.env.POND_TOKEN ? "set" : "unset", same: process.env.POND_TOKEN === request.credentials?.token,
    other: process.env.OTHER_TOKEN ? "set" : "unset", echoed: process.env.POND_TOKEN ?? "" }) });`;
  await install("pondfeed", { secrets: { token: { group: "pondfeed", key: "POND_TOKEN", description: "a made-up pond token" } }, actions: [{ id: "peek", label: "Peek", on: "outline" }] }, SHOW);
  await install("bystander", { actions: [{ id: "peek", label: "Peek", on: "outline" }] }, SHOW);
  const owner = JSON.parse((await client.request<{ message: string }>({ action: "extensions.act", extension: "pondfeed", extensionAction: "peek" })).message);
  // Its own value comes back scrubbed: an extension's answer never carries the secret.
  expect(owner).toEqual({ variable: "set", same: true, other: "unset", echoed: "[redacted]" });
  const other = JSON.parse((await client.request<{ message: string }>({ action: "extensions.act", extension: "bystander", extensionAction: "peek" })).message);
  expect(other).toEqual({ variable: "unset", same: true, other: "unset", echoed: "" });
  // A group others can read is refused, naming the file and its mode, never the value.
  chmodSync(group, 0o644);
  const refused = await client.request({ action: "extensions.act", extension: "pondfeed", extensionAction: "peek" }).then(() => "", (error: Error) => error.message);
  expect(refused).toContain(`${group} is mode 644; run: chmod 600 ${group}`);
  expect(refused).not.toContain("tok-made-up");
  chmodSync(group, 0o600);
  // A key the group doesn't have says how to add it.
  await install("pondfeed", { secrets: { token: { group: "pondfeed", key: "MISSING_TOKEN" } }, actions: [{ id: "peek", label: "Peek", on: "outline" }] }, SHOW);
  await expect(client.request({ action: "extensions.act", extension: "pondfeed", extensionAction: "peek" })).rejects.toThrow("with-secrets --add pondfeed MISSING_TOKEN");
  expect(groupValue("A=1\nB='two'\n# B=no\n", "B")).toBe("two");
});

// ── Schedules ────────────────────────────────────────────────────────────

test("a scheduled action runs when it's due, once however many runs were missed, and its runs are recorded and listed", async () => {
  let now = Date.parse("2026-10-09T09:00:00.000Z");
  const { store, server, client, install, create, state } = await setup({ now: () => now });
  const log = await create("Rain log");
  const listed = await install("rain", {
    actions: [{ id: "tally", label: "Tally the rain", on: "outline", effects: "write", schedule: { every: "15m" } }],
  }, `${CALL}say({ message: "tallied " + (input.scheduled ? "on schedule" : "by hand"), writes: [{ op: "create", parentId: request.config.log, text: "Rain at " + input.context.now }] });`,
  { config: { log: log.id } });
  const entry = listed.extensions.find((candidate) => candidate.id === "rain") as unknown as { schedules: Array<{ entry: string; every: string; next: string; last?: unknown }> };
  expect(entry.schedules).toEqual([{ entry: "action:tally", every: "15m", next: "2026-10-09T09:15:00.000Z" }]);

  await server.extensionSchedules.tick();
  expect(store.children(log.id)).toEqual([]);
  // Two hours late (the host was down): it runs once, now.
  now = Date.parse("2026-10-09T11:00:30.000Z");
  await server.extensionSchedules.tick();
  await server.extensionSchedules.tick();
  expect(store.children(log.id).map((child) => child.text)).toEqual(["Rain at 2026-10-09T11:00:30.000Z"]);
  expect(store.children(log.id)[0]).toMatchObject({ actorId: "ext:rain" });
  const after = (await client.request<ExtensionsListResult>({ action: "extensions.list" })).extensions.find((candidate) => candidate.id === "rain") as unknown as {
    schedules: Array<{ next: string; last: { at: string; ok: boolean; message: string } }> };
  expect(after.schedules[0]).toMatchObject({ next: "2026-10-09T11:15:30.000Z", last: { at: "2026-10-09T11:00:30.000Z", ok: true, message: "tallied on schedule" } });
  // The record is a file beside the outline, so a restart keeps it.
  expect(JSON.parse(readFileSync(join(state, "extension-schedules.json"), "utf8")).schedules["rain/action:tally"].last.ok).toBe(true);
  // Run now, by hand: recorded like any run.
  const run = await client.request<{ ok: boolean; message: string }>({ action: "extensions.schedule.run", extension: "rain", entry: "action:tally" });
  expect(run).toMatchObject({ ok: true, message: "tallied on schedule" });
  await expect(client.request({ action: "extensions.schedule.run", extension: "rain", entry: "action:nope" })).rejects.toThrow("its schedules: action:tally");
});

test("a schedule is checked when the folder loads: one of every or cron, at least a minute, a cron that parses, an action on the outline", async () => {
  const { install } = await setup();
  const state = async (manifest: Record<string, unknown>) => (await install("bad", manifest, "")).extensions.find((entry) => entry.id === "bad")!.error;
  expect(await state({ actions: [{ id: "go", label: "Go", schedule: { every: "1h" } }] })).toContain("a scheduled action acts on the outline");
  expect(await state({ actions: [{ id: "go", label: "Go", on: "outline", schedule: { every: "30s" } }] })).toContain("every is shorter than 1m");
  expect(await state({ actions: [{ id: "go", label: "Go", on: "outline", schedule: { cron: "61 * * * *" } }] })).toContain("minute \"61\" is outside 0-59");
  expect(await state({ actions: [{ id: "go", label: "Go", on: "outline", schedule: {} }] })).toContain("needs one of every or cron");
  expect(nextCron("5 6 * * *", new Date(2026, 9, 9, 6, 5, 0).getTime())).toBe(new Date(2026, 9, 10, 6, 5, 0).getTime());
  expect(nextCron("*/20 9-10 * * 1-5", new Date(2026, 9, 10, 12, 0).getTime())).toBe(new Date(2026, 9, 12, 9, 0).getTime());
  expect([...parseCron("0 0 * * 7").weekday.values]).toEqual([0]);
});

// ── Collections ──────────────────────────────────────────────────────────

test("a data handler's collection writes many records keyed by the extension's own ids, idempotently, on its schedule", async () => {
  let now = Date.parse("2026-10-09T09:00:00.000Z");
  const { store, server, client, install, create, feed, root } = await setup({ now: () => now });
  const answers = join(root, "shelf-answers.json");
  const answer = (value: unknown) => writeFileSync(answers, JSON.stringify(value));
  answer({ records: [
    { key: "hl-1", title: "On herons", fields: [{ key: "book", value: "Pond Days" }], body: "Stand still on purpose." },
    { key: "hl-2", title: "On moss", fields: [{ key: "book", value: "Pond Days" }], body: "Moss keeps its own calendar." },
  ] });
  await install("shelf", {
    handlers: [{ key: "shelf", kind: "data", effects: "read", keyPattern: "^[a-z-]+$", schedule: { every: "1h" } }],
  }, `const request = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: JSON.parse(await Bun.file(${JSON.stringify(answers)}).text()) }));`);
  const asker = await create("Reading\nshelf:: highlights");
  const record = await until("the collection", () => store.extensionRecords({ extensionId: "shelf", role: "record", itemKey: "highlights" })[0]);
  const members = () => store.extensionRecords({ parentBlockId: record.blockId, extensionId: "shelf", role: "comment" }).map((row) => [row.itemKey, store.get(row.blockId)!.text.split("\n")[0]]);
  await until("two members", () => members().length === 2);
  expect(record.parentBlockId).toBe(asker.id);
  expect(store.get(record.blockId)!.text.split("\n")[0]).toBe("shelf: highlights");
  expect(members()).toEqual([["hl-1", "On herons"], ["hl-2", "On moss"]]);
  const herons = store.extensionRecords({ parentBlockId: record.blockId, extensionId: "shelf", role: "comment", itemKey: "hl-1" })[0]!.blockId;
  expect(store.get(herons)!.text).toContain("[shelf.key::hl-1] [shelf.book::Pond Days]");

  // The same answer again, on its schedule: nothing is written.
  const before = feed().length;
  now += 3_600_001;
  await server.extensionSchedules.tick();
  expect(feed().length).toBe(before);
  const listed = (await client.request<ExtensionsListResult>({ action: "extensions.list" })).extensions.find((entry) => entry.id === "shelf") as unknown as { schedules: Array<{ last: { message: string } }> };
  expect(listed.schedules[0]!.last.message).toBe("fetched 1 record");

  // A new one and a changed one (not complete): added and updated in place; the one not named stays.
  answer({ records: [
    { key: "hl-2", title: "On moss, again", fields: [], body: "Moss keeps its own calendar and never shares it." },
    { key: "hl-3", title: "On bread", fields: [], body: "Bread rises faster when nobody watches it." },
  ] });
  await client.request({ action: "extensions.schedule.run", extension: "shelf", entry: "handler:shelf" });
  expect(members()).toEqual([["hl-1", "On herons"], ["hl-2", "On moss, again"], ["hl-3", "On bread"]]);
  // complete: the list is the whole collection, so the one it no longer names goes to Trash, and comes back when named.
  answer({ complete: true, records: [{ key: "hl-3", title: "On bread", fields: [], body: "Bread rises faster when nobody watches it." }] });
  await client.request({ action: "extensions.schedule.run", extension: "shelf", entry: "handler:shelf" });
  expect(members()).toEqual([["hl-3", "On bread"]]);
  expect(store.get(herons)!.effectiveDeletedRootId).toBe(herons);
  answer({ records: [{ key: "hl-1", title: "On herons", fields: [{ key: "book", value: "Pond Days" }], body: "Stand still on purpose." }] });
  await client.request({ action: "extensions.schedule.run", extension: "shelf", entry: "handler:shelf" });
  expect(store.get(herons)!.effectiveDeletedRootId ?? null).toBeNull();
  // Two records with one key are refused whole.
  answer({ records: [{ key: "hl-9", title: "a", fields: [] }, { key: "hl-9", title: "b", fields: [] }] });
  const run = await client.request<{ ok: boolean; error: string }>({ action: "extensions.schedule.run", extension: "shelf", entry: "handler:shelf" });
  expect(run).toMatchObject({ ok: false });
  expect(run.error).toContain("records[1].key hl-9 is another record's too");
});

// ── The kitchen sink's example ───────────────────────────────────────────

test("almanac: its scheduled action writes a dated note under the almanac page, as ext:almanac, once a day", async () => {
  const { store, extensions, client, create } = await setup();
  cpSync(join(REPO_EXTENSIONS, "almanac"), join(extensions, "almanac"), { recursive: true });
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const almanac = listed.extensions.find((entry) => entry.id === "almanac") as unknown as { state: string; schedules: Array<{ entry: string; cron: string }> };
  expect(almanac.state).toBe("active");
  expect(almanac.schedules).toMatchObject([{ entry: "action:write-day", cron: "5 6 * * *" }]);
  const missing = await client.request<{ ok: boolean; message: string }>({ action: "extensions.schedule.run", extension: "almanac", entry: "action:write-day" });
  expect(missing.message).toBe("no [[almanac]] page: write [page::almanac] on the note it should write under");
  const page = await create("Almanac [page::almanac]");
  const ran = await client.request<{ ok: boolean; message: string }>({ action: "extensions.schedule.run", extension: "almanac", entry: "action:write-day" });
  expect(ran.message).toStartWith("wrote Almanac for ");
  const [note] = store.children(page.id);
  expect(note).toMatchObject({ author: "agent", actorId: "ext:almanac" });
  expect(note!.text).toMatch(/^Almanac for \d{4}-\d{2}-\d{2} \[type::almanac\] \[date::\d{4}-\d{2}-\d{2}\]\n\n\S/);
  const again = await client.request<{ message: string }>({ action: "extensions.schedule.run", extension: "almanac", entry: "action:write-day" });
  expect(again.message).toEndWith("is already there");
  expect(store.children(page.id)).toHaveLength(1);
  expect(existsSync(join(extensions, "almanac", "outline.ts"))).toBe(true);
});

// ── Opening a Resource (kitty's gaps) ────────────────────────────────────

test("an extension names a Resource to open: a bar row's resource, a view's link, an action's open; a bad ref is refused with why", async () => {
  const { client, install, create } = await setup();
  const note = await create("Shelf");
  await install("shelfie", {
    actions: [{ id: "show", label: "Show", on: "outline" }, { id: "bad", label: "Bad", on: "outline" }, { id: "note", label: "Note", on: "outline" }],
    bar: [{ id: "files", title: "files" }],
  }, `${CALL}
if (operation === "bar") say({ rows: input.query === "bad"
  ? [{ id: "x", label: "x", resource: "file:relative.md" }]
  : [{ id: "a", label: "a.md", resource: "file:/srv/made-up/a.md" }, { id: "b", label: "site", resource: "web:https://example.com/shelf" }] });
else if (input.action === "show") say({ message: "here", open: "file:/srv/made-up/a.md" });
else if (input.action === "note") say({ open: input.args.note });
else say({ open: "not a thing" });`);
  const rows = await client.request<{ rows: Array<{ resource?: string }> }>({ action: "extensions.bar", extension: "shelfie", source: "files", query: "" });
  expect(rows.rows.map((row) => row.resource)).toEqual(["file:/srv/made-up/a.md", "web:https://example.com/shelf"]);
  await expect(client.request({ action: "extensions.bar", extension: "shelfie", source: "files", query: "bad" })).rejects.toThrow("file: takes an absolute path");
  expect(await client.request({ action: "extensions.act", extension: "shelfie", extensionAction: "show" })).toMatchObject({ message: "here", open: "file:/srv/made-up/a.md" });
  expect(await client.request({ action: "extensions.act", extension: "shelfie", extensionAction: "note", args: { note: note.id } })).toMatchObject({ open: note.id });
  await expect(client.request({ action: "extensions.act", extension: "shelfie", extensionAction: "bad" })).rejects.toThrow("open: not a thing is no block here");
  const { validateComponent } = await import("../src/component-primitives");
  expect(() => validateComponent({ data: {}, view: { type: "table", columns: ["File"], rows: [["a.md"], ["b"]], links: ["file:/srv/made-up/a.md", "resource:res-1"] } })).not.toThrow();
  expect(() => validateComponent({ data: {}, view: { type: "card", title: "c", link: "web:ftp://nope" } })).toThrow("must be a block id or a Resource ref");
});
