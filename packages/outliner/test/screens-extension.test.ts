// The screens extension (packages/outliner/extensions/screens): the screens and tile kinds every door ships, served
// the way any extension's are. Installed and uninstalled on a scratch outline over the wire, as the bar's install row
// and `act extensions.install` do; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListAnswer } from "@ep0ch/outline-core/list-row";
import { newNoteRule, readSpec, savedNodes, targetFilled } from "@ep0ch/outline-core/screen-spec";
import { OutlinerClient } from "../src/client";
import { defaultOnBuiltIns } from "../src/extension-install";
import type { ScreensList } from "../src/screens";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const MANIFEST = JSON.parse(readFileSync(join(import.meta.dir, "..", "extensions", "screens", "extension.json"), "utf8")) as {
  tiles: { kind: string; drawer: string; description: string; fields?: Record<string, unknown>; replaces: string[] }[];
  screens: ({ name: string } & Record<string, unknown>)[];
};
const DRAWERS = ["list", "page"];

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-screens-ext-"));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-registry.json");
  const outline = join(root, "outline"), socket = join(root, "outline.sock");
  mkdirSync(outline);
  const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: outline });
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close(); store.close(); rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const extensions = () => client.request<{ extensions: { id: string; error?: string; screens?: { name: string }[] }[]; tileKinds: { kind: string; extension: string; drawer?: string; fields?: Record<string, unknown>; description?: string; replaces?: string[] }[] }>({ action: "extensions.list", reload: true } as never);
  const screens = (more: Record<string, unknown> = {}) => client.request<ScreensList>({ action: "screens.list", kinds: [], drawers: DRAWERS, ...more } as never);
  const list = (from: string, more: Record<string, unknown> = {}) => client.request<ListAnswer>({ action: "lists.read", from, ...more } as never);
  return { client, extensions, screens, list };
}

test("the shipped screens and kinds are one extension, on wherever the service runs", async () => {
  expect(await defaultOnBuiltIns()).toContain("screens");
  // Every kind names a drawer and the bare name saved screens use; every list kind says which list it is of.
  for (const tile of MANIFEST.tiles) {
    expect(DRAWERS, tile.kind).toContain(tile.drawer);
    expect(tile.replaces, tile.kind).toContain(tile.kind);
    if (tile.drawer === "list") expect(typeof tile.fields?.from, tile.kind).toBe("string");
  }
  // Every screen reads as a spec, names only kinds the extension has, and exactly one is where a window starts.
  const kinds = new Set(MANIFEST.tiles.flatMap(t => t.replaces));
  const specs = MANIFEST.screens.map(screen => readSpec(screen));
  for (const spec of specs) for (const leaf of savedNodes(spec.layout.root)) if (leaf.t === "leaf") expect(kinds.has(String(leaf.kind)), `${spec.name}: ${leaf.kind}`).toBe(true);
  expect(specs.filter(s => s.start).map(s => s.name)).toEqual(["desk"]);
  expect(specs.map(s => s.name)).toEqual(expect.arrayContaining(["desk", "navigator", "board", "lastcall", "who"]));
});

test("installed as a person does, a door reads its kinds from extensions.list and its screens from screens.list; uninstalled, neither is left", async () => {
  const { client, extensions, screens, list } = await setup();
  // A scratch outline with nothing installed has no shipped screens and no kinds: the list says how to get them.
  expect((await screens()).screens).toEqual([]);
  expect((await list("screens")).list).toMatchObject({ rows: [], empty: expect.stringContaining("extensions.install id=screens") });

  const installed = await client.request<{ id: string; error?: string }>({ action: "extensions.install", extension: "screens", where: "outline" } as never);
  expect(installed).toMatchObject({ id: "screens" });
  const served = await extensions();
  expect(served.extensions.find(e => e.id === "screens")?.error).toBeUndefined();
  const rows = served.tileKinds.filter(k => k.extension === "screens");
  expect(rows.map(k => [k.kind, k.drawer, k.fields?.from ?? null, k.replaces])).toEqual(MANIFEST.tiles.map(t => [`screens.${t.kind}`, t.drawer, t.fields?.from ?? null, t.replaces]));
  expect(rows.every(k => !!k.description)).toBe(true);

  // A door that has both drawers opens every shipped screen with nothing wrong, each tile's kind as the row names it.
  const all = await screens();
  expect(all.problems).toEqual([]);
  expect(all.screens.map(s => [s.name, s.from, s.extension, s.problems])).toEqual(MANIFEST.screens.map(s => [s.name, "extension", "screens", []]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  // The kinds ride on the same watched answer, so a window learns what a tile's kind is where it learns its screens.
  expect(all.kinds.filter(k => k.extension === "screens").map(k => [k.kind, k.drawer, k.fields?.from ?? null, k.replaces])).toEqual(MANIFEST.tiles.map(t => [`screens.${t.kind}`, t.drawer, t.fields?.from ?? null, t.replaces]) as never);
  expect(all.kinds.find(k => k.kind === "screens.reader")!.about).toBe(MANIFEST.tiles.find(t => t.kind === "reader")!.description);
  const desk = all.screens.find(s => s.name === "desk")!.spec!;
  expect(desk.start).toBe(true);
  expect(savedNodes(desk.layout.root).filter(n => n.t === "leaf").map(n => n.kind)).toEqual(["screens.tree", "screens.reader", "screens.props", "screens.backlinks", "screens.threads", "screens.proposals", "screens.revisions"]);
  // Each keeps the name its screen wrote as its role, so `tile=role:reader` names it in every door.
  expect(savedNodes(desk.layout.root).filter(n => n.t === "leaf").map(n => n.role)).toEqual(["tree", "reader", "props", "backlinks", "threads", "proposals", "revisions"]);
  // A door without the list drawer is told so on each tile it can't draw, in words, and still gets the reader's.
  const pages = await screens({ drawers: ["page"] });
  expect(pages.screens.find(s => s.name === "desk")!.problems).toEqual([
    { tile: "tree", said: "this door has no list drawer, which draws a screens.tree tile" },
    { tile: "props", said: "this door has no list drawer, which draws a screens.props tile" },
    { tile: "backlinks", said: "this door has no list drawer, which draws a screens.backlinks tile" },
    { tile: "threads", said: "this door has no list drawer, which draws a screens.threads tile" },
    { tile: "proposals", said: "this door has no list drawer, which draws a screens.proposals tile" },
    { tile: "revisions", said: "this door has no list drawer, which draws a screens.revisions tile" },
  ]);
  // The bar's screens are the same rows, each a pick that opens one.
  expect((await list("screens", { kinds: [], drawers: DRAWERS })).list.rows.map(r => [r.id, r.act])).toEqual(all.screens.map(s => [s.name, `screen.open name="${s.name}"`]));
  // What the service answers here is written down for a client's own tests to stand a host in with (the native
  // window's): EP0CH_WRITE_FIXTURES=1 writes it, and it is never edited by hand.
  const fixture = join(import.meta.dir, "..", "..", "outline-core", "fixtures", "served-screens.json");
  const answered = JSON.stringify({ screens: all.screens, kinds: all.kinds, sources: (await list("sources")).sources }, null, 2) + "\n";
  if (process.env.EP0CH_WRITE_FIXTURES === "1") writeFileSync(fixture, answered);
  expect(existsSync(fixture) ? readFileSync(fixture, "utf8") : "", "outline-core/fixtures/served-screens.json is stale: EP0CH_WRITE_FIXTURES=1 bun test test/screens-extension.test.ts").toBe(answered);
  // A screen opened on a target carries it in the tile its spec says.
  const navigator = targetFilled(all.screens.find(s => s.name === "navigator")!.spec!, { query: "type=bed" });
  expect(savedNodes(navigator.layout.root).find(n => n.t === "leaf" && n.name === "facets")).toMatchObject({ query: "type=bed" });

  // The fork check: every shipped screen saved as a note of a person's own reads back as the same screen, with
  // nothing wrong, so what a door opens on is changed by a note, never by building a door again.
  for (const shipped of all.screens) {
    const { start: _start, ...spec } = shipped.spec! as unknown as Record<string, unknown>;
    const mine = await client.request<{ name: string; id: string }>({ action: "screens.save", spec: { ...spec, name: `My ${shipped.name}` } } as never);
    const read = (await screens()).screens.find(s => s.name === mine.name)!;
    expect([read.from, read.problems], mine.name).toEqual(["note", []]);
    const shape = (root: unknown) => savedNodes(root as never).map(n => [n.t, n.kind ?? null, n.name ?? null, n.role ?? null]);
    expect(shape(read.spec!.layout.root), mine.name).toEqual(shape(shipped.spec!.layout.root));
    expect([read.spec!.lands ?? null, read.spec!.toolbar ?? null], mine.name).toEqual([shipped.spec!.lands ?? null, shipped.spec!.toolbar ?? null]);
    await client.request({ action: "delete", blockId: mine.id, mutation: { author: "user" } } as never);
  }

  // A window saves a tile under the kind its row names; the role the row gives it anyway isn't written, and reads back.
  const potting = await client.request<{ id: string }>({ action: "screens.save", spec: { name: "Potting bench", layout: { root: { t: "leaf", kind: "screens.reader", role: "reader", name: "bench" } } } } as never);
  expect((await client.request<{ text: string }[]>({ action: "children", parentId: potting.id } as never)).map(b => b.text)).toEqual(["tile screens.reader [name::bench]"]);
  expect(savedNodes((await screens()).screens.find(s => s.name === "potting-bench")!.spec!.layout.root)[0]).toMatchObject({ kind: "screens.reader", role: "reader", name: "bench" });
  await client.request({ action: "delete", blockId: potting.id, mutation: { author: "user" } } as never);

  // A new-note rule names kinds as its screen wrote them (`reader`): served, each is the kind its tiles are served as,
  // so a client asks the one rule (outline-core's newNoteRule) with the kind a tile carries, and keeps no map of names.
  const seedbed = await client.request<{ id: string }>({ action: "screens.save", spec: { name: "Seed bed", newNote: [{ opens: "tab", only: ["reader"] }, { opens: "float", unless: ["tree", "wheelbarrow"] }, { opens: "lands" }], layout: { root: { t: "split", dir: "row", weights: [0.3, 0.7], kids: [{ t: "leaf", kind: "tree", name: "tree" }, { t: "leaf", kind: "reader", name: "bench" }] } } } } as never);
  const rules = (await screens()).screens.find(s => s.name === "seed-bed")!.spec!;
  expect(rules.newNote).toEqual([{ opens: "tab", only: ["screens.reader"] }, { opens: "float", unless: ["screens.tree", "wheelbarrow"] }, { opens: "lands" }]);
  const tileKind = (name: string) => String(savedNodes(rules.layout.root).find(n => n.t === "leaf" && n.name === name)!.kind);
  expect([newNoteRule(rules, tileKind("bench"))?.opens, newNoteRule(rules, tileKind("tree"))?.opens]).toEqual(["tab", "lands"]);
  await client.request({ action: "delete", blockId: seedbed.id, mutation: { author: "user" } } as never);
  // A kind's row says which of the names it replaces it serves now: the name a tile made by a door carries is that kind's.
  expect(all.kinds.map(k => [k.kind, k.serves])).toEqual(MANIFEST.tiles.map(t => [`screens.${t.kind}`, t.replaces]));

  // Uninstalled the same way: its screens and kinds are gone, and a screen a person saved stays.
  await client.request({ action: "screens.save", spec: { name: "Seed swap", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } } } as never);
  const removed = await client.request<{ removed: boolean }>({ action: "extensions.uninstall", extension: "screens", demo: "keep" } as never);
  expect(removed.removed).toBe(true);
  expect((await extensions()).tileKinds.filter(k => k.extension === "screens")).toEqual([]);
  const left = await screens();
  expect(left.kinds).toEqual([]);
  expect(left.screens.map(s => [s.name, s.from])).toEqual([["seed-swap", "note"]]);
  // What is left says why its tile can't be drawn: the kind went with the extension.
  expect(left.screens[0]!.problems).toEqual([{ tile: "reader", said: "no tile kind reader here" }]);
  // Back by the same row.
  await client.request({ action: "extensions.install", extension: "screens", where: "outline" } as never);
  await extensions();
  expect((await screens()).screens.map(s => s.name)).toEqual(["board", "desk", "keys", "kitchen", "lastcall", "library", "navigator", "seed-swap", "who"]);
});
