// `lists.read` (packages/native/docs/DESIGN.md §3): one list, whatever it is of. One test a producer, over a scratch
// service in a temp folder; every note is made up (a garden: beds, a seed list, a shed).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListAnswer } from "@ep0ch/outline-core/list-row";
import { OutlinerClient } from "../src/client";
import { listSources } from "../src/list-producers";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-lists-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const list = (from: string, more: Record<string, unknown> = {}) => client.request<ListAnswer>({ action: "lists.read", from, ...more } as never);
  // The garden: three beds at different stages under one note, a seed list that links to one bed, and a shed.
  const beds = await create("Beds");
  const north = await create("North bed [type::bed] [stage::sown] [crop::peas]", beds.id);
  const south = await create("South bed [type::bed] [stage::planned] [crop::beans]", beds.id);
  const herbs = await create("Herb spiral [type::bed] [stage::sown] [crop::thyme]", beds.id);
  const rows = await create("First row", north.id);
  const seeds = await create(`Seed list\nPeas go in ((${north.id})) first.`);
  const shed = await create("Shed");
  return { client, create, list, socket, beds, north, south, herbs, rows, seeds, shed };
}

/** A scratch outline starts with its own notes (Workspace, Trash, Inbox…): the garden's rows are the ones after them. */
const SYSTEM = new Set(["Workspace", "Trash", "Inbox", "Bookmarks", "Note mover"]);
const garden = (answer: ListAnswer) => answer.list.rows.filter(r => !SYSTEM.has(r.label));
const shape = (answer: ListAnswer) => garden(answer).map(r => [r.label, r.depth ?? 0, r.folds ?? false, r.open ?? false]);

test("children: the outline as a tree, a folder's notes under it only when it is open, each row its own act line", async () => {
  const { list, beds, north } = await setup();
  const top = await list("children");
  expect(top.list.arrange).toBe("tree");
  expect(shape(top)).toEqual([["Beds", 0, true, false], ["Seed list", 0, false, false], ["Shed", 0, false, false]]);
  expect(top.open).toEqual([]);
  expect(garden(top)[0]).toMatchObject({ id: beds.id, do: { open: beds.id }, act: `open id="${beds.id}"` });
  const unfolded = await list("children", { open: [beds.id, north.id] });
  expect(shape(unfolded)).toEqual([
    ["Beds", 0, true, true], ["North bed", 1, true, true], ["First row", 2, false, false], ["South bed", 1, false, false], ["Herb spiral", 1, false, false],
    ["Seed list", 0, false, false], ["Shed", 0, false, false],
  ]);
  // The folders listed are said, and a listed folder says how many notes are under it.
  expect([...unfolded.open!].sort()).toEqual([beds.id, north.id].sort());
  expect(garden(unfolded)[0]!.kids).toBe(3);
  // A tree under one note is the same list, from there.
  expect(shape(await list("children", { of: beds.id }))).toEqual([["North bed", 0, true, false], ["South bed", 0, false, false], ["Herb spiral", 0, false, false]]);
  // More rows than asked for is said, never silently cut.
  expect(await list("children", { limit: 2 })).toMatchObject({ truncated: true, total: 2 });
});

test("query: a question's matches, sorted and grouped by any property name, with chips, a table's columns and the facets", async () => {
  const { list, north, south, herbs } = await setup();
  const found = await list("query", { query: "type=bed", sort: "title asc" });
  expect(found.list.arrange).toBe("rows");
  expect(found.list.rows.map(r => r.label)).toEqual(["Herb spiral", "North bed", "South bed"]);
  expect(found.list.rows[1]).toMatchObject({ id: north.id, act: `open id="${north.id}"`, chips: [{ key: "type", value: "bed" }, { key: "stage", value: "sown" }, { key: "crop", value: "peas" }] });
  // The facets are the keys the matches carry, counted: nothing here names which keys there may be.
  expect(found.facets!.find(f => f.key === "stage")!.values).toEqual(expect.arrayContaining([{ value: "sown", count: 2 }, { value: "planned", count: 1 }]));
  // A property nobody wrote as a column is just an empty cell; a note's own facts are columns too.
  const table = await list("query", { query: "type=bed", sort: "crop asc", columns: "title crop stage shade" });
  expect(table.list).toMatchObject({ arrange: "table", columns: ["title", "crop", "stage", "shade"], headers: ["title", "crop", "stage", "shade"] });
  expect(table.list.rows.map(r => r.cells)).toEqual([["South bed", "beans", "planned", ""], ["North bed", "peas", "sown", ""], ["Herb spiral", "thyme", "sown", ""]]);
  expect(table.sort).toBe("crop asc");
  // Grouped by another property the same way: the groups are the list's sections.
  const grouped = await list("query", { query: "type=bed", group: "crop", sort: "title asc" });
  expect(grouped.list.groups!.map(g => [g.name, g.count, g.ids])).toEqual(expect.arrayContaining([["peas", 1, [north.id]], ["beans", 1, [south.id]], ["thyme", 1, [herbs.id]]]));
  // A key no note has is answered with the service's hint, not a silent empty list.
  const none = await list("query", { query: "soil=clay" });
  expect(none.list.rows).toEqual([]);
  expect(none.hint).toContain("soil");
});

test("query: arranged as a table with no columns named, its columns are the title and the properties the matches carry", async () => {
  const { list } = await setup();
  // `list.layout layout=table` on a tile whose spec names no columns: a table of titles alone would show less than rows do.
  const table = await list("query", { query: "type=bed", sort: "title asc", arrange: "table" });
  expect(table.list).toMatchObject({ arrange: "table", columns: ["title", "crop", "stage", "type"], headers: ["title", "crop", "stage", "type"] });
  expect(table.list.rows.map(r => r.cells)).toEqual([["Herb spiral", "thyme", "sown", "bed"], ["North bed", "peas", "sown", "bed"], ["South bed", "beans", "planned", "bed"]]);
  // The columns the asker names stand as named, and rows asked for stay rows with no cells.
  expect((await list("query", { query: "type=bed", arrange: "table", columns: "title crop" })).list.columns).toEqual(["title", "crop"]);
  const rows = await list("query", { query: "type=bed", arrange: "rows" });
  expect(rows.list.columns).toBeUndefined();
  expect(rows.list.rows.every(r => r.cells === undefined)).toBe(true);
});

test("lanes: the matches grouped by a property name into lanes, and refused in words when none is named", async () => {
  const { list, client, north, south, herbs } = await setup();
  const board = await list("lanes", { query: "type=bed", group: "stage", sort: "title asc" });
  expect(board).toMatchObject({ from: "lanes", group: "stage" });
  expect(board.list.arrange).toBe("lanes");
  const lanes = Object.fromEntries(board.list.groups!.map(g => [g.name, g.ids]));
  expect(lanes).toEqual({ sown: [herbs.id, north.id], planned: [south.id] });
  expect(board.list.groups!.find(g => g.name === "sown")).toMatchObject({ label: "sown", count: 2 });
  await expect(client.request({ action: "lists.read", from: "lanes", query: "type=bed" } as never)).rejects.toThrow("group=<a property name>");
});

test("facets: the properties the matches carry as rows, a group a key, each a pick that narrows the list it is in", async () => {
  const { list } = await setup();
  const found = await list("facets", { query: "type=bed" });
  expect(found.list.groups!.map(g => g.name)).toEqual(expect.arrayContaining(["type", "stage", "crop"]));
  const sown = found.list.rows.find(r => r.id === "stage=sown")!;
  expect(found.facets).toBeUndefined();
  expect(sown).toMatchObject({ label: "sown", detail: "2", group: "stage", do: { run: { action: "facets.set", args: { key: "stage", value: "sown" } } }, act: `facets.set key="stage" value="sown"` });
});

test("search: notes by the words typed, ranked by the one search, each saying where it sits", async () => {
  const { list, north } = await setup();
  const found = await list("search", { query: "north" });
  expect(found.list.rows[0]).toMatchObject({ id: north.id, label: "North bed", act: `open id="${north.id}"` });
  expect(found.list.rows[0]!.detail).toContain("Beds");
  // No words is no question: the list says what to do.
  expect((await list("search", { query: "  " })).list).toMatchObject({ rows: [], empty: "Type to search." });
});

test("links: the notes that link to a note, and by linkGroups the notes under it and the ones it links to", async () => {
  const { list, client, north, seeds, rows } = await setup();
  const back = await list("links", { of: north.id });
  expect(back.list.rows.map(r => [r.id, r.label, r.act])).toEqual([[seeds.id, "Seed list", `open id="${seeds.id}"`]]);
  expect(back.list.title).toBe("Linked from · 1");
  expect((await list("links", { of: north.id, linkGroups: "children" })).list.rows.map(r => r.id)).toEqual([rows.id]);
  expect((await list("links", { of: seeds.id, linkGroups: "outlinks" })).list.rows.map(r => r.id)).toEqual([north.id]);
  const every = await list("links", { of: north.id, linkGroups: "all" });
  expect(every.list.groups!.map(g => [g.name, g.count])).toEqual([["outlinks", 0], ["backlinks", 1], ["children", 1]]);
  expect(every.list.rows.map(r => [r.group, r.label])).toEqual([["backlinks", "Seed list"], ["children", "First row"]]);
  await expect(client.request({ action: "lists.read", from: "links" } as never)).rejects.toThrow("of=<a block id>");
  await expect(client.request({ action: "lists.read", from: "links", of: north.id, linkGroups: "cousins" } as never)).rejects.toThrow("cousins isn't a group");
});

test("properties: a note's properties as a table, each value a question to open, then its record", async () => {
  const { list, north } = await setup();
  const about = await list("properties", { of: north.id });
  expect(about.list).toMatchObject({ arrange: "table", columns: ["property", "value"], title: "North bed" });
  const stage = about.list.rows.find(r => r.label === "stage")!;
  expect(stage).toMatchObject({ detail: "sown", cells: ["stage", "sown"], group: "properties", act: `bar.open scope="query" query="stage=sown"` });
  expect(about.list.rows.filter(r => r.group === "record").map(r => r.label)).toEqual(["revision", "updated", "by", "id"]);
  expect(about.list.rows.find(r => r.id === "record:id")!.detail).toBe(north.id);
});

test("activity: what changed lately, newest first, a pick opening the note", async () => {
  const { list, client, shed, south } = await setup();
  expect((await list("activity")).list).toMatchObject({ rows: [], empty: "Nothing has changed yet." });
  await client.request({ action: "update", blockId: shed.id, text: "Shed, with the tools", expectedRevision: shed.revision, mutation: { author: "user" } } as never);
  await client.request({ action: "update", blockId: south.id, text: "South bed [type::bed] [stage::sown] [crop::beans]", expectedRevision: south.revision, mutation: { author: "agent", actorId: "compost-agent" } } as never);
  const recent = await list("activity");
  expect(recent.list.rows.map(r => [r.label, r.act])).toEqual([["South bed", `open id="${south.id}"`], ["Shed, with the tools", `open id="${shed.id}"`]]);
  expect(recent.list.rows[0]!.detail).toContain("compost-agent");
});

test("clients: who is attached to the outline now", async () => {
  const { list, client } = await setup();
  await client.request({ action: "events.subscribe", clientId: "potting-bench", role: "reader" } as never).catch(() => {});
  const here = await list("clients");
  expect(here.list.arrange).toBe("rows");
  expect(here.list.empty).toBe("Nobody else is here.");
  expect(Array.isArray(here.list.rows)).toBe(true);
});

test("screens: the screens there are to open, each a pick that lays the window out, a problem said on its row", async () => {
  const { list, create } = await setup();
  const note = await create("Garden work [type::screen] [screen::garden-work]");
  await create("tile reader [name::reader]", note.id);
  const broken = await create("Seed swap [type::screen] [screen::seed-swap]");
  await create("tile wheelbarrow [name::barrow]", broken.id);
  const found = await list("screens", { kinds: ["reader"] });
  expect(found.list.rows.map(r => [r.id, r.label, r.act])).toEqual([["garden-work", "Garden work", `screen.open name="garden-work"`], ["seed-swap", "Seed swap", `screen.open name="seed-swap"`]]);
  expect(found.list.rows[1]).toMatchObject({ tone: "warn" });
  expect(found.list.rows[1]!.detail).toContain("no tile kind wheelbarrow");
  expect((await list("screens", { query: "swap" })).list.rows.map(r => r.id)).toEqual(["seed-swap"]);
});

test("sources: the producers say what they are, so a bar's sources and an agent's question come from one place", async () => {
  const { list, client } = await setup();
  const said = await list("sources");
  expect(said.list.rows.map(r => r.id)).toEqual(listSources().map(s => s.from));
  expect(said.list.rows.filter(r => r.group === "bar").map(r => [r.id, r.label, r.mark ?? ""])).toEqual([["search", "Notes", "main"], ["query", "Query", ""], ["screens", "Screens", ""]]);
  // Every producer is asked for by its row's name, and a name none has is refused with the ones there are.
  await expect(client.request({ action: "lists.read", from: "wheelbarrows" } as never)).rejects.toThrow("lists.read lists children, search, query");
});

test("a watched list is asked again when the outline changes, and says its answer moved", async () => {
  const { socket, create } = await setup();
  const wire = connect(socket);
  cleanups.push(() => { wire.destroy(); });
  const lines: any[] = [];
  let rest = "";
  wire.on("data", chunk => { rest += chunk.toString(); const parts = rest.split("\n"); rest = parts.pop() ?? ""; for (const part of parts) if (part.trim()) lines.push(JSON.parse(part)); });
  const until = async (found: (line: any) => boolean) => { for (let i = 0; i < 400; i++) { const hit = lines.find(found); if (hit) return hit; await Bun.sleep(25); } throw new Error(`nothing came: ${JSON.stringify(lines.slice(-3))}`); };
  await new Promise<void>(resolve => wire.once("connect", () => resolve()));
  wire.write(JSON.stringify({ id: "w1", action: "lists.read", from: "children", watch: "tree" }) + "\n");
  const first = await until(line => line.id === "w1");
  const labels = (line: any) => line.result.list.rows.map((r: { label: string }) => r.label).filter((label: string) => !SYSTEM.has(label));
  expect(labels(first)).toEqual(["Beds", "Seed list", "Shed"]);
  await create("Compost heap");
  const changed = await until(line => line.event?.action === "queries.changed" && line.event.changes.some((c: { key: string }) => c.key === "tree"));
  const generation = changed.event.changes.find((c: { key: string }) => c.key === "tree").generation;
  wire.write(JSON.stringify({ id: "w2", action: "lists.read", from: "children", watch: "tree", generation }) + "\n");
  const again = await until(line => line.id === "w2");
  expect(labels(again)).toEqual(["Beds", "Seed list", "Shed", "Compost heap"]);
});
