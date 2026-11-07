// A door open across a deploy answers in under a second (PIE-1610). What a restart held the loop with on pie's shape, one
// test per cause (scripts/bench-host-queue.ts --copy for the numbers): a question walking every note, an open reading the
// whole outline, a read opening every other outline, and doors arriving at a cold host.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import { makeOutline } from "../scripts/host-bench/fixture";
import { OutlinerStore } from "../src/store";
import { ShareSessions } from "../src/share-sessions";

function scratch(name: string) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

function garden(store: OutlinerStore) {
  const shed = store.create("Shed [type::project] [owner::Moss]\n- [ ] felt the roof [needs::sysop: which felt] [due::2031-03-04]");
  const beds = store.create("Beds [type::project] [tag::soil]", shed.id);
  store.create("Bed one [type::[bed, raised]] [area::north/east] [cost::12] #soil", beds.id);
  store.create("Bed two [type::bed] [area::north] [cost::40] [work-stage::done]", beds.id);
  store.create("Pond [type::Pond] [tags::water, soil] [season::Été]");
  store.create("Quiet one [machine::record] [type::bed]");
  store.create("Plain note about the bed, no chips");
  // A Kelvin sign: JavaScript folds it to k, SQLite's lower() leaves it.
  store.create("Thermometer [unit::\u212Aelvin]");
  store.create("Long bed [kind::raised bed] [kinds::[raised bed, low bed]]");
  const trashed = store.create("Trashed bed [type::bed]");
  store.delete(trashed.id);
  const window = store.create("Window box [due::2031-03-01..2031-03-09] [type::box]");
  store.create("Under the box [type::bed]", window.id);
  return shed;
}

/** The question by a walk of every note: an OR with a clause no key answers keeps the prefilter out, and it matches nothing. */
const walked = (where: string) => `(${where}) OR text~"zz-nothing-holds-this-zz"`;

test("a question through the property index holds the same notes, in the same order and depth, as a walk of every note", () => {
  const { root, done } = scratch("candidates");
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  try {
    garden(store);
    const questions = [
      "type=bed", "type=BED", "type=raised", "type=project OR type=box", "type=bed AND cost > 20", "cost < 20 OR owner=Moss",
      "area=north/*", "area=north", "due=2031-03-05", "due=2031-03-04", "due <= 2031-03-04", "needs", "tag=soil", "tag=water",
      "season=été", "season=ÉTÉ", "unit=kelvin", "type=bed NOT work-stage=done", "(needs NOT work-stage=done) OR type=box", "owner=moss type=project", "kind=\"raised bed\"", "kinds=\"low bed\"", "KIND=\"RAISED BED\"", "nosuchkey", "type=nosuchvalue", "revision >= 2", "type=bed revision >= 1",
    ];
    for (const scope of ["block", "all"] as const) for (const where of questions) {
      const through = store.queryBlocks({ where, propertyScope: scope, limit: 100 }).blocks;
      const walking = store.queryBlocks({ where: walked(where), propertyScope: scope, limit: 100 }).blocks;
      expect(through.map(block => [block.id, block.depth])).toEqual(walking.map(block => [block.id, block.depth]));
    }
    expect(store.queryBlocks({ where: "unit=kelvin", limit: 100 }).blocks).toHaveLength(1);
    // Machinery and the Trash, as a walk leaves them.
    const beds = (machinery: "hide" | "show") => store.queryBlocks({ where: "type=bed", machinery, limit: 100 }).blocks.map(block => block.text.split(" [")[0]);
    expect(beds("hide")).toEqual(["Bed one", "Bed two", "Under the box"]);
    expect(beds("show")).toContain("Quiet one");
    expect(beds("show")).not.toContain("Trashed bed");
    // A property filter, and a limit: the first in outline order.
    expect(store.queryBlocks({ filters: [{ key: "type", value: "bed" }], limit: 1 }).blocks.map(block => block.text.split(" [")[0])).toEqual(["Bed one"]);
    // A write is seen by the next question: what the index held belongs to one graph.
    const added = store.create("Bed three [type::bed]");
    expect(store.queryBlocks({ where: "type=bed", limit: 100 }).blocks.map(block => block.id)).toContain(added.id);
    store.update(added.id, "Bed three, now a pond [type::pond]", added.revision);
    expect(store.queryBlocks({ where: "type=bed", limit: 100 }).blocks.map(block => block.id)).not.toContain(added.id);
  } finally { store.close(); done(); }
});

test("a rule's baseline over the graph holds what asking note by note holds", () => {
  const { root, done } = scratch("over-graph");
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  try {
    const shed = garden(store);
    const ids = store.liveBlocks().map(block => block.id);
    for (const [where, narrow] of [
      ["type=bed", {}], ["needs", { propertyScope: "all" as const }], ["needs", {}], ["cost > 20", {}], ["NOT type=bed", {}], [undefined, { subtreeRootId: shed.id }], ["type=bed", { subtreeRootId: shed.id }], ["child:type=project", {}], ["unit=kelvin", {}],
    ] as const) {
      const statements = store.matchQuery(where, ids, narrow).blockIds;
      expect(store.matchQuery(where, ids, { ...narrow, overGraph: true }).blockIds).toEqual(statements);
    }
  } finally { store.close(); done(); }
});

test("opening an outline reads none of it: the graph waits for the first whole-outline question", () => {
  const { root, done } = scratch("store-open");
  const path = join(root, "outline.sqlite");
  try {
    const first = new OutlinerStore(path);
    garden(first);
    first.close();
    const store = new OutlinerStore(path);
    try {
      expect((store as unknown as { graph?: unknown }).graph).toBeUndefined();
      expect(store.queryBlocks({ where: "system-view=trash", machinery: "show", limit: 5 }).blocks).toHaveLength(1);
    } finally { store.close(); }
  } finally { done(); }
});

test("a Trash view however its value is written is the Trash view: opening makes no second one", () => {
  for (const written of ["Trash", "TRASH", "[trash, archive]"]) {
    const { root, done } = scratch("trash-view");
    const path = join(root, "outline.sqlite");
    const trashViews = (store: OutlinerStore) => store.database.query("SELECT block_id FROM block_properties WHERE scope = 'block' AND key = 'system-view' AND lower(value) LIKE '%trash%'").all();
    try {
      const first = new OutlinerStore(path);
      const { block_id } = trashViews(first)[0] as { block_id: string };
      const view = first.require(block_id);
      first.update(view.id, view.text.replace("[system-view::trash]", `[system-view::${written}]`), view.revision);
      first.close();
      const store = new OutlinerStore(path);
      try { expect(trashViews(store)).toHaveLength(1); } finally { store.close(); }
    } finally { done(); }
  }
});

test("a statement past Bun's first 20 stays prepared", () => {
  const { root, done } = scratch("statements");
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  try {
    const statement = () => store.database.query("SELECT 'a statement this test owns' AS said");
    for (let i = 0; i < 40; i++) store.database.query(`SELECT ${i} AS filler`).get();
    expect(statement()).toBe(statement());
  } finally { store.close(); done(); }
});

test("a sweep's list of shares is soonest to end first", () => {
  let saved = "";
  const shares = new ShareSessions({ read: () => saved, write: (value: string) => { saved = value; } } as never, () => Date.parse("2031-03-04T00:00:00Z"));
  saved = JSON.stringify({ sessions: ["2031-03-06", "2031-03-05", "2031-03-07"].map((day, i) => ({ id: `s${i}`, token: `t${i}`, state: "active", expiresAt: `${day}T00:00:00.000Z`, createdAt: "2031-03-04T00:00:00.000Z" })) });
  expect(shares.list().map(share => share.id)).toEqual(["s1", "s0", "s2"]);
});

/** A host of `recent` outlines and `old` ones nobody has written for a month, as a restart finds them. */
async function restartedHost(root: string, names: { recent: string[]; old?: string[]; bad?: string[] }, warmRecent = true) {
  const outlines = join(root, "o");
  mkdirSync(outlines, { recursive: true });
  const notes = new Map<string, { note: string; bare: string }>();
  for (const name of [...names.recent, ...names.old ?? []]) {
    const store = new OutlinerStore(join(outlines, `${name}.sqlite`), { workspaceRoot: join(outlines, name) });
    const bare = store.create(`A note in ${name}`);
    notes.set(name, { bare: bare.id, note: store.create(`Local link ((${bare.id})) [type::note]`).id });
    store.close();
  }
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const name of names.old ?? []) for (const file of [`${name}.sqlite`, `${name}.sqlite-wal`]) { try { utimesSync(join(outlines, file), longAgo, longAgo); } catch { /* no wal left */ } }
  for (const name of names.bad ?? []) await Bun.write(join(outlines, `${name}.sqlite`), "this is not a database file at all");
  const logged: string[] = [];
  const host = new OutlineHost({ outlinesFolder: outlines, warmRecent, log: line => logged.push(line) });
  await host.start();
  const client = (name: string) => new OutlinerClient(host.socketPath, 30_000, name);
  const opened = async () => (await new OutlinerClient(host.socketPath, 30_000).request<{ outlines: { name: string; open: boolean }[] }>({ action: "outlines.list" } as never)).outlines.filter(o => o.open).map(o => o.name).sort();
  return { host, client, opened, notes, logged };
}

test("a restart opens what was written lately, a door's first answer waits for its own outline only, and an old outline stays closed", async () => {
  const { root, done } = scratch("warm");
  const { host, client, opened, notes, logged } = await restartedHost(root, { recent: ["orchard", "meadow"], old: ["attic"], bad: ["broken"] });
  try {
    const orchard = client("orchard");
    expect((await orchard.request<{ id: string } | null>({ action: "get", blockId: notes.get("orchard")!.note } as never))?.id).toBe(notes.get("orchard")!.note);
    expect(await opened()).toContain("orchard");
    for (let i = 0; i < 200 && !logged.some(line => line.includes('"meadow" warmed')); i++) await Bun.sleep(25);
    // A file that can't open says so, and the rest are served.
    for (let i = 0; i < 200 && !logged.some(line => line.includes('"broken"')); i++) await Bun.sleep(25);
    expect(logged.join("\n")).toContain('Outline "broken" did not warm');
    expect(await opened()).toEqual(["meadow", "orchard"]);
    // Asked for, the old one opens as ever.
    await client("attic").request({ action: "ping" } as never);
    expect(await opened()).toContain("attic");
  } finally { await host.close(); done(); }
});

test("the outline a door is waiting for warms next, ahead of the rest of the line", async () => {
  const { root, done } = scratch("warm-order");
  const outlines = join(root, "o");
  mkdirSync(join(outlines, "orchard"), { recursive: true });
  makeOutline(join(outlines, "orchard.sqlite"), join(outlines, "orchard"), "small");
  for (const name of ["pond", "shed"]) {
    const store = new OutlinerStore(join(outlines, `${name}.sqlite`), { workspaceRoot: join(outlines, name) });
    store.create(`A note in ${name}`);
    store.close();
  }
  // The big one is first in line, whichever was written last.
  const hour = new Date(Date.now() - 60 * 60 * 1000);
  for (const name of ["pond", "shed"]) utimesSync(join(outlines, `${name}.sqlite`), hour, hour);
  const logged: string[] = [];
  const host = new OutlineHost({ outlinesFolder: outlines, warmRecent: true, log: line => logged.push(line) });
  await host.start();
  try {
    await new OutlinerClient(host.socketPath, 30_000, "shed").request({ action: "ping" } as never);
    // Asked while the big one was warming: shed went ahead of pond.
    expect(logged.filter(line => line.includes('"pond" warmed'))).toEqual([]);
  } finally { await host.close(); done(); }
});

test("the graph read in slices is the graph read at once, and a later write still reaches it", async () => {
  const { root, done } = scratch("graph-slices");
  const path = join(root, "outline.sqlite");
  try {
    const seed = new OutlinerStore(path);
    const parent = seed.create("A shed [type::shed]");
    // More than a slice of notes and of properties, so a page ends in the middle of them.
    seed.database.transaction(() => { for (let i = 0; i < 1200; i++) seed.create(`Bed ${i} [type::bed] [row::${i % 7}] [plot::${i}]`, parent.id); })();
    const whole = seed.liveBlocks().map(block => [block.id, block.text, block.properties]);
    seed.close();
    const store = new OutlinerStore(path);
    try {
      let passes = 0;
      await store.readGraphInSlices(async () => { passes += 1; });
      expect(passes).toBeGreaterThan(3);
      const read = (store as unknown as { graph?: { graph: unknown } }).graph?.graph;
      expect(read).toBeDefined();
      expect(store.liveBlocks().map(block => [block.id, block.text, block.properties])).toEqual(whole);
      // The same graph, not a whole read again.
      expect((store as unknown as { graph?: { graph: unknown } }).graph?.graph).toBe(read as never);
      const made = store.create("A spade [type::spade]");
      expect(store.queryBlocks({ where: "type=spade", limit: 5 }).blocks.map(block => block.id)).toEqual([made.id]);
    } finally { store.close(); }
  } finally { done(); }
});

test("a read that fails keeps the graph; a write that fails drops what it may have undone", () => {
  const { root, done } = scratch("graph-failed");
  try {
    const store = new OutlinerStore(join(root, "outline.sqlite"));
    try {
      const note = store.create("A note [type::bed]");
      store.liveBlocks();
      const graph = () => (store as unknown as { graph?: { graph: unknown } }).graph?.graph;
      const read = graph();
      expect(() => store.queryBlocks({ where: "type=bed", subtreeRootId: "99999999-aaaa-4bbb-8ccc-000000000001", limit: 5 })).toThrow("Block not found");
      expect(graph()).toBe(read as never);
      expect(() => store.update(note.id, "A stale edit", note.revision + 5)).toThrow();
      expect(graph()).toBe(read as never);
      expect(() => store.database.transaction(() => { store.create("Half a write"); store.liveBlocks(); throw new Error("undone"); })()).toThrow("undone");
      expect(graph()).toBeUndefined();
      expect(store.liveBlocks().map(block => block.text)).not.toContain("Half a write");
    } finally { store.close(); }
  } finally { done(); }
});

test("outlines open one at a time, however many are asked for at once", async () => {
  const { root, done } = scratch("open-line");
  const outlines = join(root, "o");
  mkdirSync(outlines, { recursive: true });
  for (const name of ["orchard", "meadow", "pond"]) {
    const store = new OutlinerStore(join(outlines, `${name}.sqlite`), { workspaceRoot: join(outlines, name) });
    store.create(`A note in ${name}`);
    store.close();
  }
  let open = 0, most = 0;
  const host = new OutlineHost({ outlinesFolder: outlines, log: () => {}, onOpen: async () => { most = Math.max(most, ++open); await Bun.sleep(20); open -= 1; } });
  await host.start();
  try {
    await Promise.all(["orchard", "meadow", "pond"].map(name => new OutlinerClient(host.socketPath, 30_000, name).request({ action: "ping" } as never)));
    expect(most).toBe(1);
  } finally { await host.close(); done(); }
});

test("a note whose links are all here opens no other outline; a link to one that isn't here looks there", async () => {
  const { root, done } = scratch("lazy-links");
  const { host, client, opened, notes } = await restartedHost(root, { recent: ["orchard", "meadow"] }, false);
  try {
    const orchard = client("orchard");
    const { note } = notes.get("orchard")!;
    await orchard.request({ action: "blocks.authored-links", ownerBlockId: note } as never);
    await orchard.request({ action: "transclusions.read", targets: [{ blockId: note }], hostBlockId: note } as never);
    expect(await opened()).toEqual(["orchard"]);
    // A note in the other outline, named by id: it's found there, as before, and only then is that outline opened.
    const away = notes.get("meadow")!.bare;
    const made = await orchard.request<{ id: string }>({ action: "create", text: `See ((${away}))` } as never);
    const links = await orchard.request<{ references?: unknown }>({ action: "blocks.authored-links", ownerBlockId: made.id } as never);
    expect(JSON.stringify(links)).toContain("meadow");
    expect(await opened()).toEqual(["meadow", "orchard"]);
    const embed = await orchard.request<{ results: { status: string }[] }>({ action: "transclusions.read", targets: [{ blockId: away }], hostBlockId: made.id } as never);
    expect(embed.results[0]!.status).toBe("ready");
  } finally { await host.close(); done(); }
});
