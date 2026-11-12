// `screens.list` and `screens.save` (packages/native/docs/DESIGN.md §2): an outline's screens, read and written by the
// service so no client reads a screen note's text. A scratch service in a temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import type { ScreenSaved, ScreensList } from "../src/screens";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-screens-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const list = (more: Record<string, unknown> = {}) => client.request<ScreensList>({ action: "screens.list", ...more } as never);
  return { client, create, list, socket };
}

const KINDS = ["tree", "reader", "query", "backlinks", "properties"];

/** The made-up garden screen, as blocks under its note. */
async function garden(create: (text: string, parentId?: string) => Promise<Block>) {
  const note = await create("Garden work [type::screen] [screen::garden-work] [lands::reader] [focus::beds]");
  const split = await create("split row [ratio::0.3]", note.id);
  const beds = await create("tile query [name::beds] [query::type=bed NOT stage=done] [select::reader]", split.id);
  const tabs = await create("tabs", split.id);
  await create("tile reader [name::reader]", tabs.id);
  await create("tile backlinks [name::links] [source::tile:reader] [subject::follows]", tabs.id);
  const keys = await create("keys", note.id);
  await create("ctrl+l [action::bar.open source=query]", keys.id);
  return { note, beds };
}

test("a screen note's blocks are listed as its spec, the same one its json fence would hold", async () => {
  const { create, list } = await setup();
  const { note } = await garden(create);
  const spec = { name: "seed-list", title: "Seed list", layout: { root: { t: "leaf", kind: "query", name: "seeds", query: "type=seed" } } };
  await create(`Seed list [type::screen] [screen::seed-list]\n\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``);
  const { screens, problems } = await list({ kinds: KINDS });
  expect(problems).toEqual([]);
  expect(screens.map(s => [s.name, s.title, s.from, s.note?.form, s.problems])).toEqual([["garden-work", "Garden work", "note", "blocks", []], ["seed-list", "Seed list", "note", "json", []]]);
  expect(screens[0]!.note).toEqual({ id: note.id, revision: note.revision, form: "blocks" });
  expect(screens[0]!.spec).toEqual({
    name: "garden-work", title: "Garden work", lands: "reader", keys: [{ key: "ctrl+l", action: "bar.open", args: { source: "query" } }],
    layout: { focus: "beds", root: { t: "split", dir: "row", weights: [0.3, 0.7], kids: [
      { t: "leaf", kind: "query", name: "beds", query: "type=bed NOT stage=done", wires: [{ verb: "select", to: "reader" }] },
      { t: "tabs", active: 0, tabs: [{ t: "leaf", kind: "reader", name: "reader" }, { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", subject: "follows" }] }] } },
  } as never);
  expect(screens[1]!.spec).toEqual(spec as never);
});

test("a kind nobody draws and a name the layout hasn't are said for their tile, and the screen still opens", async () => {
  const { client, create, list } = await setup();
  const { beds } = await garden(create);
  await client.request({ action: "update", blockId: beds.id, text: "tile qeury [name::beds] [query::type=bed] [select::raeder]", expectedRevision: beds.revision, mutation: { author: "user" } });
  const { screens } = await list({ kinds: KINDS });
  expect(screens[0]!.spec?.name).toBe("garden-work");
  expect(screens[0]!.problems).toEqual([
    { tile: "beds", said: "beds sends its select to raeder, a tile this screen hasn't" },
    { tile: "beds", said: "no tile kind qeury here · did you mean query?" },
  ]);
  // An asker that names no kinds is told nothing of kinds: it draws what it can.
  expect((await list()).screens[0]!.problems).toEqual([{ tile: "beds", said: "beds sends its select to raeder, a tile this screen hasn't" }]);
});

test("a note that doesn't read, two notes with one name and a name the asker keeps open nothing, and say why", async () => {
  const { create, list } = await setup();
  const stray = await create("Compost [type::screen]");
  await create("heap of leaves", stray.id);
  const a = await create("Beds [type::screen]"), b = await create("Beds [type::screen]");
  await create("tile reader [name::bed]", a.id);
  await create("tile reader [name::bed]", b.id);
  const desk = await create("desk [type::screen]");
  await create("tile reader [name::reader]", desk.id);
  const { screens, problems } = await list({ reserved: ["desk"] });
  expect(screens.filter(s => s.spec).map(s => s.name)).toEqual([]);
  expect(problems.sort()).toEqual([
    `2 screen notes are named beds: none is opened by that name · rename all but one (${[`((${a.id}))`, `((${b.id}))`].sort().join(", ")})`,
    `a screen note is named desk, a built-in screen's name: it isn't opened · rename it ([screen::…] in ((${desk.id})))`,
  ].sort());
  expect(screens.find(s => s.name === "compost")!.problems[0]!.said).toContain("it has no layout under it");
});

test("screens.save writes the block form under the Screens note, and saves over the note it has at the revision read", async () => {
  const { client, list } = await setup();
  const spec = { name: "seed-list", title: "Seed list", layout: { focus: "seeds", root: { t: "split", dir: "row", weights: [0.4, 0.6], kids: [{ t: "leaf", kind: "query", name: "seeds", query: "type=seed" }, { t: "leaf", kind: "reader", name: "reader" }] } } };
  const made = await client.request<ScreenSaved>({ action: "screens.save", spec, mutation: { author: "agent", actorId: "seedling-agent" } } as never);
  expect([made.name, made.title, made.created]).toEqual(["seed-list", "Seed list", true]);
  const note = await client.request<Block>({ action: "get", blockId: made.id } as never);
  expect(note.text).toBe("Seed list [type::screen] [screen::seed-list] [focus::seeds]");
  const home = await client.request<Block>({ action: "get", blockId: note.parentId! } as never);
  expect(home.text.split("\n")[0]).toBe("Screens [type::screens]");
  const under = async (id: string): Promise<unknown[]> => Promise.all((await client.request<{ id: string; text: string }[]>({ action: "children", parentId: id } as never)).map(async b => [b.text, ...(await under(b.id))]));
  expect(await under(made.id)).toEqual([["split row [ratio::0.4]", ["tile query [name::seeds] [query::type=seed]"], ["tile reader [name::reader]"]]]);
  const first = (await list()).screens[0]!;
  expect([first.spec, first.note?.form]).toEqual([spec as never, "blocks"]);

  // A person's save names their client as every write of theirs does: the blocks are made as theirs.
  const mine = await client.request<ScreenSaved>({ action: "screens.save", spec: { ...spec, name: "Seed trays" }, mutation: { author: "user", actorId: "ep0ch-native:box" } } as never);
  expect([mine.name, mine.title, mine.created]).toEqual(["seed-trays", "Seed trays", true]);
  await client.request({ action: "delete", blockId: mine.id, mutation: { author: "user" } } as never);

  // Saved again from the revision read: the same note, its blocks replaced.
  const again = { ...spec, layout: { ...spec.layout, root: { ...spec.layout.root, weights: [0.5, 0.5] } } };
  const saved = await client.request<ScreenSaved>({ action: "screens.save", spec: again, base: first.note, mutation: { author: "user" } } as never);
  expect([saved.id, saved.created]).toEqual([made.id, false]);
  const listed = await list();
  expect([listed.screens.length, listed.screens[0]!.spec]).toEqual([1, again as never]);
  // From a revision since changed: refused, and nothing is written.
  await expect(client.request({ action: "screens.save", spec, base: first.note, mutation: { author: "user" } } as never)).rejects.toThrow();
  expect((await list()).screens[0]!.spec).toEqual(again as never);
});

test("a watched screens.list says when a block under a screen note changed", async () => {
  const { client, create, socket } = await setup();
  const { beds } = await garden(create);
  const lines: any[] = [];
  const wire = connect(socket);
  cleanups.push(() => { wire.destroy(); });
  let pending = "";
  wire.on("data", chunk => { pending += chunk; const parts = pending.split("\n"); pending = parts.pop()!; for (const p of parts) if (p.trim()) lines.push(JSON.parse(p)); });
  const until = async (found: () => any): Promise<any> => { for (let i = 0; i < 200 && !found(); i++) await Bun.sleep(25); return found(); };
  wire.write(JSON.stringify({ id: "w1", action: "screens.list", watch: "screens", kinds: KINDS }) + "\n");
  const first = await until(() => lines.find(l => l.id === "w1"));
  expect(first.result.screens[0].problems).toEqual([]);
  await client.request({ action: "update", blockId: beds.id, text: "tile qeury [name::beds]", expectedRevision: beds.revision, mutation: { author: "user" } });
  const changed = await until(() => lines.find(l => l.event?.action === "queries.changed" && l.event.changes.some((c: any) => c.key === "screens")));
  expect(changed).toBeTruthy();
  const generation = changed.event.changes.find((c: any) => c.key === "screens").generation;
  wire.write(JSON.stringify({ id: "w2", action: "screens.list", watch: "screens", kinds: KINDS, generation }) + "\n");
  const second = await until(() => lines.find(l => l.id === "w2"));
  expect(second.result.screens[0].problems).toEqual([{ tile: "beds", said: "no tile kind qeury here · did you mean query?" }]);
});
