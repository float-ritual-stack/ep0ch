// Notes route themselves by rules written as notes (PIE-1010, src/note-routing.ts): a rule is a block
// `[type::route] [query::…] [route-to::((id))]`; first match wins; a match moves the note with the service's atomic
// move (note-move.ts), as `ext:route`; a note a door holds a draft of waits for the draft to close. Every service here
// is a scratch service in a temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NoteRouteRun } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { runRouteCommand } from "../src/route-cli";
import type { Block, NewNoteReceipt } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function startService() {
  const directory = mkdtempSync(join(tmpdir(), "outliner-routing-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, routeQuietMs: 100 });
  await server.start();
  const client = new OutlinerClient(socket);
  const events: Array<{ domain: string; action: string; blockId?: string; change?: { kind: string; actor?: { actorId?: string; author?: string }; requestedBy?: { actorId?: string } } }> = [];
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId: "routing-test-door", role: "composed", contextId: "routing-test-door" },
    onConnect: connected.resolve, onError: connected.reject, onEvent: (event) => { events.push(event as (typeof events)[number]); },
  });
  await connected.promise;
  cleanups.push(async () => { await watcher.stop(); await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const inbox = store.readWorkspaceSnapshot().physical.blocks.find(b => b.properties.some(p => p.key === "system-view" && p.value === "inbox"))!;
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, ...(parentId ? { parentId } : {}), author: "user" });
  const update = async (id: string, text: string) => {
    const block = store.get(id)!;
    return client.request<Block>({ action: "update", blockId: id, text, expectedRevision: block.revision, mutation: { author: "user" } });
  };
  const route = (input: Record<string, unknown> = {}) => client.request<NoteRouteRun>({ action: "notes.route", ...input });
  const parentOf = (id: string) => store.get(id)!.parentId;
  return { client, store, server, inbox, events, create, update, route, parentOf, directory, socket };
}

const RECIPES_RULE = (recipes: string) => `Recipes go to the shelf [type::route] [query::type=recipe] [route-to::((${recipes}))]`;

test("a new note whose text matches a rule is placed by routing, and the receipt names the rule", async () => {
  const { client, create, inbox } = await startService();
  const recipes = await create("Recipes");
  const rule = await create(RECIPES_RULE(recipes.id));
  const r = await client.request<NewNoteReceipt>({ action: "notes.create", text: "Pickled walnuts [type::recipe]\n\nBrine for a week." });
  expect(r.placement).toMatchObject({ parentId: recipes.id, at: "top", rule: "route", routeRule: { id: rule.id, title: "Recipes go to the shelf" } });
  expect(r.placement.said).toBe("in “Recipes” (routed by “Recipes go to the shelf”)");
  expect(r.block).toMatchObject({ parentId: recipes.id, position: 0 });
  // A note no rule holds for goes where it always went.
  const plain = await client.request<NewNoteReceipt>({ action: "notes.create", text: "Shopping" });
  expect(plain.placement).toMatchObject({ parentId: inbox.id, rule: "inbox" });
});

test("a note made bare, and a new note whose first words match, route after a quiet moment, as ext:route; the rule's history says so", async () => {
  const { client, create, update, events, parentOf, store } = await startService();
  const recipes = await create("Recipes");
  const rule = await create(RECIPES_RULE(recipes.id));
  // Made bare at the root (an agent's `create`, no placement): routed once quiet.
  const made = await create("Damson jam [type::recipe]");
  await until("the bare note routed", () => parentOf(made.id) === recipes.id);
  const moved = await until("the move's event", () => events.find(e => e.change?.kind === "move" && e.blockId === made.id));
  expect(moved.change?.actor).toMatchObject({ author: "agent", actorId: "ext:route" });
  // The person's ctrl+n: an empty note first, its words on the first save. That first save is its creation to a rule.
  const fresh = await client.request<NewNoteReceipt>({ action: "notes.create", text: "" });
  expect(fresh.block.parentId).not.toBe(recipes.id);
  await update(fresh.block.id, "Quince cheese [type::recipe]\n\nSlow.");
  await until("the new note routed on its first words", () => parentOf(fresh.block.id) === recipes.id);
  // The rule's history: one line per move, newest first, under the rule.
  const history = await until("the history under the rule", () => store.children(rule.id).find(b => b.properties.some(p => p.key === "type" && p.value === "route-history")));
  expect(history.text).toContain(`((${fresh.block.id}|Quince cheese))`);
  expect(history.text).toContain(`((${made.id}|Damson jam))`);
  expect(history.text.indexOf("Quince cheese")).toBeLessThan(history.text.indexOf("Damson jam"));
  expect(history.author).toBe("agent");
  expect(history.actorId).toBe("ext:route");
  // Its own writes set nothing off: the history note stays, and the routed notes aren't touched again.
  await Bun.sleep(300);
  expect(store.children(rule.id).filter(b => b.properties.some(p => p.key === "type" && p.value === "route-history"))).toHaveLength(1);
  expect(events.filter(e => e.change?.kind === "move" && e.change?.actor?.actorId === "ext:route")).toHaveLength(2);
});

test("route-when says when a rule fires on its own: create (default) only for new notes, edit on every save, command only when asked", async () => {
  const { client, create, update, parentOf, route } = await startService();
  const recipes = await create("Recipes");
  const archive = await create("Archive");
  const done = await create("Done");
  await create(RECIPES_RULE(recipes.id));
  await create(`Old things are archived [type::route] [query::status=old] [route-to::((${archive.id}))] [route-when::edit]`);
  await create(`Done by hand [type::route] [query::status=done] [route-to::((${done.id}))] [route-when::command]`);
  const note = await create("Shelf plan");
  await Bun.sleep(250);
  expect(parentOf(note.id)).toBeNull();
  // An existing note given a recipe type later: a create rule doesn't move it; an edit rule would.
  await update(note.id, "Shelf plan [type::recipe]");
  await Bun.sleep(300);
  expect(parentOf(note.id)).toBeNull();
  await update(note.id, "Shelf plan [type::recipe] [status::old]");
  await until("the edit rule routed it", () => parentOf(note.id) === archive.id);
  // A command rule waits to be asked, and then every rule counts, first match first.
  const finished = await create("Bench [status::done]");
  await Bun.sleep(250);
  expect(parentOf(finished.id)).toBeNull();
  const run = await route({ ref: finished.id });
  expect(run.results[0]).toMatchObject({ outcome: "moved", to: { id: done.id }, rule: { title: "Done by hand" } });
  expect(parentOf(finished.id)).toBe(done.id);
  const byHand = await client.request<Block>({ action: "get", blockId: finished.id });
  expect(byHand.parentId).toBe(done.id);
});

test("a dry run says what would move where and why, and moves nothing; --all routes every note, first match wins by route-order", async () => {
  const { create, route, parentOf } = await startService();
  const recipes = await create("Recipes");
  const sweets = await create("Sweets");
  // Written second, but first by route-order: a sweet recipe goes to Sweets, the rest to Recipes.
  await create(`${RECIPES_RULE(recipes.id)} [route-order::2]`);
  await create(`Sweet recipes [type::route] [query::type=recipe AND #sweet] [route-to::((${sweets.id}))] [route-order::1] [route-when::command]`);
  const jam = await create("Plum jam [type::recipe] #sweet");
  const stew = await create("Oxtail stew [type::recipe]");
  const plan = await create("Weekend plan");
  await until("the stew routed on create", () => parentOf(stew.id) === recipes.id);
  // The jam: the create rule took it to Recipes (the sweet rule is by command); a dry run says it would move on.
  await until("the jam routed on create", () => parentOf(jam.id) === recipes.id);
  const dry = await route({ all: true, dryRun: true });
  expect(dry.dryRun).toBe(true);
  expect(dry.rules).toBe(2);
  const forJam = dry.results.find(r => r.blockId === jam.id)!;
  expect(forJam).toMatchObject({ outcome: "would-move", rule: { title: "Sweet recipes" }, from: { id: recipes.id }, to: { id: sweets.id } });
  expect(forJam.said).toBe("would move “Plum jam” from “Recipes” to “Sweets” (rule “Sweet recipes”)");
  expect(dry.results.find(r => r.blockId === stew.id)).toMatchObject({ outcome: "unchanged", rule: { title: "Recipes go to the shelf" } });
  // Notes no rule holds for are counted, not listed (an outline has thousands).
  expect(dry.results.find(r => r.blockId === plan.id)).toBeUndefined();
  expect(dry.unmatched).toBeGreaterThanOrEqual(1);
  expect(parentOf(jam.id)).toBe(recipes.id);
  const run = await route({ all: true });
  expect(run.results.find(r => r.blockId === jam.id)).toMatchObject({ outcome: "moved", to: { id: sweets.id } });
  expect(parentOf(jam.id)).toBe(sweets.id);
  // Rule notes, the Routing view and the history are never candidates.
  expect(run.results.some(r => r.title.includes("Sweet recipes") || r.title.includes("Recipes go to"))).toBe(false);
});

test("a note a door holds a draft of is never moved under the person: it routes when the draft closes", async () => {
  const { client, create, update, parentOf } = await startService();
  const recipes = await create("Recipes");
  await create(RECIPES_RULE(recipes.id));
  const fresh = await client.request<NewNoteReceipt>({ action: "notes.create", text: "" });
  const hold = await client.request<{ holdId: string }>({ action: "drafts.hold", blockId: fresh.block.id, clientId: "routing-test-door", revision: fresh.block.revision });
  await update(fresh.block.id, "Sloe gin [type::recipe]");
  await Bun.sleep(350);
  expect(parentOf(fresh.block.id)).not.toBe(recipes.id);
  // Asked by hand meanwhile: held, said so, nothing moved.
  const asked = await client.request<NoteRouteRun>({ action: "notes.route", ref: fresh.block.id });
  expect(asked.results[0]).toMatchObject({ outcome: "held", to: { id: recipes.id } });
  expect(asked.results[0]!.said).toContain("being written");
  expect(parentOf(fresh.block.id)).not.toBe(recipes.id);
  await client.request({ action: "drafts.release", holdId: hold.holdId });
  await until("routed once the draft closed", () => parentOf(fresh.block.id) === recipes.id);
  // Asked by hand for a rule that fires only by command, while held: it still routes when the draft closes.
  const done = await create("Done");
  await create(`Finished by hand [type::route] [query::status=done] [route-to::((${done.id}))] [route-when::command]`);
  const bench = await client.request<NewNoteReceipt>({ action: "notes.create", text: "Bench [status::done]" });
  const hold2 = await client.request<{ holdId: string }>({ action: "drafts.hold", blockId: bench.block.id, clientId: "routing-test-door", revision: bench.block.revision });
  expect((await client.request<NoteRouteRun>({ action: "notes.route", ref: bench.block.id })).results[0]).toMatchObject({ outcome: "held", to: { id: done.id } });
  await Bun.sleep(250);
  expect(parentOf(bench.block.id)).not.toBe(done.id);
  await client.request({ action: "drafts.release", holdId: hold2.holdId });
  await until("the command route ran once the draft closed", () => parentOf(bench.block.id) === done.id);
}, 15_000);

test("a rule that can't be used is a listed problem, never a move: no route-to, a target in the Trash or a system note, a query that doesn't parse", async () => {
  const { client, create, route, parentOf, store } = await startService();
  const recipes = await create("Recipes");
  const gone = await create("Old shelf");
  const bad1 = await create("No target [type::route] [query::type=recipe]");
  const bad2 = await create(`Trashed target [type::route] [query::type=recipe] [route-to::((${gone.id}))]`);
  const trash = store.liveBlocks().find(b => b.properties.some(p => p.key === "system-view" && p.value === "trash"))!;
  const bad3 = await create(`Into the trash [type::route] [query::type=recipe] [route-to::((${trash.id}))]`);
  const bad4 = await create(`Broken query [type::route] [query::(type=recipe] [route-to::((${recipes.id}))]`);
  await client.request({ action: "delete", blockId: gone.id, mutation: { author: "user" } });
  const note = await create("Marmalade [type::recipe]");
  await Bun.sleep(300);
  expect(parentOf(note.id)).toBeNull();
  const run = await route({ ref: note.id, dryRun: true });
  expect(run.results[0]).toMatchObject({ outcome: "no-rule" });
  expect(run.problems).toHaveLength(4);
  expect(run.problems.find(p => p.includes(bad1.id.slice(0, 8)))).toContain("no [route-to::");
  expect(run.problems.find(p => p.includes(bad2.id.slice(0, 8)))).toContain("Trash");
  expect(run.problems.find(p => p.includes(bad3.id.slice(0, 8)))).toContain("Trash");
  expect(run.problems.find(p => p.includes(bad4.id.slice(0, 8)))).toContain("query");
  // Fixed, it works: the rule note's save is what the engine reads next.
  const fixed = store.get(bad1.id)!;
  await client.request({ action: "update", blockId: bad1.id, text: `No target [type::route] [query::type=recipe] [route-to::((${recipes.id}))]`, expectedRevision: fixed.revision, mutation: { author: "user" } });
  const again = await route({ ref: note.id });
  expect(again.results[0]).toMatchObject({ outcome: "moved", to: { id: recipes.id } });
});

test("the rules are read again when a rule, the Routing view or a target changes, never for a write elsewhere (PIE-1413)", async () => {
  const { client, create, route, store } = await startService();
  const recipes = await create("Recipes");
  await create(`Recipes go to the shelf [type::route] [query::type=recipe] [route-to::((${recipes.id}))]`);
  expect((await route({ ref: (await create("Toast")).id, dryRun: true })).problems).toEqual([]);
  // Every rules read starts by asking for the rule notes.
  const internals = store as unknown as { queryBlocks: (...args: unknown[]) => unknown };
  const queryBlocks = internals.queryBlocks.bind(store);
  let reads = 0;
  internals.queryBlocks = (...args: unknown[]) => { if (JSON.stringify(args[0]).includes('"route"')) reads += 1; return queryBlocks(...args); };
  for (let i = 0; i < 5; i++) await create(`Shopping list ${i} [type::list]`);
  await route({ ref: (await create("Porridge")).id, dryRun: true });
  expect(reads).toBe(0);
  await client.request({ action: "delete", blockId: recipes.id, mutation: { author: "user" } });
  const run = await route({ ref: (await create("Soup")).id, dryRun: true });
  // Read again (and, while the rule names a note in the Trash, after each write, so a restore heals it).
  expect(reads).toBeGreaterThan(0);
  expect(run.problems.join("\n")).toContain("Trash");
});

test("the Routing view is seeded once, listing every rule; a person who trashes it isn't given it again", async () => {
  const { client, create, store, server } = await startService();
  const hub = store.liveBlocks().find(b => b.properties.some(p => p.key === "page" && p.value === "routing"));
  expect(hub).toBeDefined();
  expect(hub!.properties).toEqual(expect.arrayContaining([
    { key: "type", value: "virtual-branch" }, { key: "query", value: "type=route" },
  ]));
  expect(hub!.author).toBe("system");
  const recipes = await create("Recipes");
  const rule = await create(RECIPES_RULE(recipes.id));
  const members = await client.request<{ blockIds: string[] }>({ action: "virtual.occurrences.order", viewId: hub!.id });
  expect(members.blockIds).toContain(rule.id);
  await client.request({ action: "delete", blockId: hub!.id, mutation: { author: "user" } });
  await server.close();
  const reopened = new OutlinerServer(store, join(mkdtempSync(join(tmpdir(), "outliner-routing-2-")), "o.sock"), undefined, undefined, { extensionPollMs: 0 });
  await reopened.start();
  cleanups.push(async () => { await reopened.close(); });
  expect(store.liveBlocks().some(b => b.properties.some(p => p.key === "page" && p.value === "routing"))).toBe(false);
});

test("ep0ch route says each note's words, the rules that can't be used and the count; --dry-run names the command that moves them", async () => {
  const { create, socket, parentOf, directory } = await startService();
  const recipes = await create("Recipes");
  await create(RECIPES_RULE(recipes.id));
  await create("Half a rule [type::route] [query::type=recipe]");
  const jam = await create("Plum jam [type::recipe] [status::done]");
  await create("Weekend plan");
  // The rule routed the jam on create; a second place it would go needs a command rule.
  await until("the jam routed", () => parentOf(jam.id) === recipes.id);
  const done = await create("Done things [status::finished]");
  await create(`Finished [type::route] [query::status=done] [route-to::((${done.id}))] [route-order::1] [route-when::command]`);
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    expect(await runRouteCommand(["--all", "--dry-run"], { ...process.env, EP0CH_SOCKET: socket, EP0CH_WS: "scratch", EP0CH_OUTLINES: directory })).toBe(0);
    expect(lines).toEqual([
      "would move “Plum jam” from “Recipes” to “Done things” (rule “Finished”)",
      expect.stringMatching(/^can't use rule [0-9a-f]{8} “Half a rule”: no \[route-to::/),
      expect.stringMatching(/^2 rules: 1 would move, \d+ no rule holds for$/),
      "A dry run. To move them: ep0ch route --all",
    ]);
    lines.length = 0;
    expect(await runRouteCommand([jam.id], { ...process.env, EP0CH_SOCKET: socket, EP0CH_WS: "scratch", EP0CH_OUTLINES: directory })).toBe(0);
    expect(lines[0]).toBe("moved “Plum jam” from “Recipes” to “Done things” (rule “Finished”)");
    expect(parentOf(jam.id)).toBe(done.id);
    lines.length = 0;
    expect(await runRouteCommand([], { ...process.env, EP0CH_SOCKET: socket, EP0CH_WS: "scratch", EP0CH_OUTLINES: directory })).toBe(2);
  } finally { console.log = log; }
});

test("a person's rule routes a note the service wrote (a snapshot record); the Inbox, Trash and guides stay put", async () => {
  const { store, inbox, create, route, parentOf } = await startService();
  const snapshots = await create("Snapshots");
  await create(`Snapshots go to their page [type::route] [query::type=snapshot] [route-to::((${snapshots.id}))]`);
  // The service writes the record itself, as the snapshot tool does.
  const record = store.create("Snapshot of garden [type::snapshot] [machine::snapshot] [publish::never]\n\nWho: you\nOutline: garden", null, "system");
  await until("the record routed on create", () => parentOf(record.id) === snapshots.id);
  // A rule that would catch the Inbox never moves it: the service finds it by its place.
  const elsewhere = await create("Elsewhere");
  await create(`Grab the inbox [type::route] [query::system-view=inbox] [route-to::((${elsewhere.id}))] [route-when::command]`);
  const run = await route({ all: true });
  expect(run.results.some(r => r.blockId === inbox.id && r.outcome === "moved")).toBe(false);
  expect(parentOf(inbox.id)).toBe(null);
});
