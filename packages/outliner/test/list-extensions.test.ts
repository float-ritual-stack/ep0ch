// The bar's Extensions and Outlines lists (src/list-extensions.ts), a rendered tile's view (src/tile-view.ts) and an
// extension's settings reaching the script it ships: the service's half of "install Waiting from the bar, use it,
// configure it, uninstall it, switch outline". A scratch service in a temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListAnswer, ListSource } from "@ep0ch/outline-core/list-row";
import type { ExtensionsConfigured } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import type { KnownOutlines } from "../src/outline-links";
import type { ScreensList } from "../src/screens";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { TileView } from "../src/tile-view";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-list-ext-"));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-registry.json");
  const outline = join(root, "outline"), socket = join(root, "outline.sock");
  mkdirSync(outline);
  const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: outline });
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 30_000);
  cleanups.push(async () => {
    await server.close(); store.close(); rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const list = (from: string, more: Record<string, unknown> = {}) => client.request<ListAnswer & { sources?: ListSource[] }>({ action: "lists.read", from, ...more } as never);
  const view = (kind: string, fields: Record<string, unknown> = {}) => client.request<TileView>({ action: "tiles.view", kind, fields } as never);
  const row = (answer: ListAnswer, id: string) => answer.list.rows.find(r => r.id === id);
  const install = (id: string) => client.request({ action: "extensions.install", extension: id, mutation: { author: "user" } } as never);
  return { client, list, view, row, install };
}

/** A day as a person writes one, `days` ago. */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 16).replace("T", " ");

test("the bar's extensions are one list: a row a thing to do with one, each with its act line", async () => {
  const { client, list, row, install } = await setup();
  const sources = (await list("sources")).sources!;
  expect(sources.find(s => s.from === "extensions")).toMatchObject({ about: "Extensions", bar: {} });
  expect(sources.find(s => s.from === "outlines")).toMatchObject({ about: "Outlines", bar: {} });

  // A service no host started has installed nothing yet (a host installs the default-on ones as it starts): Waiting
  // is one the repo has, and its row says the act that installs it.
  const fresh = await list("extensions");
  expect(row(fresh, "waiting")).toBeUndefined();
  expect(row(fresh, "install:waiting")).toMatchObject({ label: "Install Waiting", group: "available", act: 'extensions.install id="waiting"' });
  await install("waiting");

  // Installed: its row, and its settings as its own schema says them.
  const first = await list("extensions");
  expect(row(first, "waiting")).toMatchObject({ label: "Waiting", group: "installed" });
  expect(row(first, "waiting")?.act, "its page is what its row opens").toMatch(/^open id="/);
  expect(row(first, "settings:waiting")).toMatchObject({ label: "Settings of Waiting", detail: "warn-days=3 (its default)", act: 'extensions.configure id="waiting"' });
  expect(first.list.rows.some(r => r.id.startsWith("remove:")), "removing is listed once something is typed").toBe(false);
  expect(first.list.groups!.map(g => g.name)).toEqual(["installed", "settings", "available"]);

  // Typed, it can be removed, its demo notes kept or binned: a row each, since demo= has no default.
  const typed = await list("extensions", { query: "waiting" });
  expect(row(typed, "remove:waiting:keep")).toMatchObject({ label: "Remove Waiting", act: 'extensions.uninstall id="waiting" demo="keep"' });
  expect(typed.list.rows.every(r => /waiting/i.test(`${r.label} ${r.detail ?? ""} ${r.mark ?? ""}`))).toBe(true);

  // Uninstalled, it is one the repo has again.
  await client.request({ action: "extensions.uninstall", extension: "waiting", demo: "keep", mutation: { author: "user" } } as never);
  const gone = await list("extensions");
  expect(row(gone, "waiting")).toBeUndefined();
  expect(row(gone, "install:waiting")?.act).toBe('extensions.install id="waiting"');
}, 120_000);

test("a tile a script renders is one view, each press its act line, and reads its extension's settings", async () => {
  const { client, view, install } = await setup();
  await install("screens");
  await install("waiting");
  // The kind's row says the drawer a client draws it with: none of the client's own code is about Waiting.
  const served = await client.request<ScreensList>({ action: "screens.list", kinds: [], drawers: ["list", "page", "view"] } as never);
  expect(served.kinds.find(k => k.kind === "waiting.list")).toMatchObject({ drawer: "view", serves: ["waiting"] });
  const without = await client.request<ScreensList>({ action: "screens.list", kinds: [], drawers: ["list", "page"] } as never);
  expect(without.screens.find(s => s.name === "waiting")!.problems.map(p => p.said)).toContain("this door has no view drawer, which draws a waiting.list tile");

  const made = await client.request<{ id: string }>({ action: "create", parentId: null, text: `Jars for the cellar [type::outbox-item] [outbox::waiting] [waiting-on::Ada: which shelf do the jars go on?] [sent::${ago(2)}]`, author: "user" } as never);
  const drawn = await view("waiting.list");
  expect(drawn).toMatchObject({ kind: "waiting.list", extension: "waiting", title: "outbox · 1 waiting on 1 person" });
  const list = drawn.view as { type: string; rows: { id: string; label: string; act?: string; tone?: string }[] };
  expect(list.type).toBe("list");
  expect(list.rows).toHaveLength(1);
  expect(list.rows[0]).toMatchObject({ id: made.id, act: `open id="${made.id}"` });
  expect(list.rows[0]!.tone, "two days is inside its three").toBeUndefined();
  // A name the kind serves in place of finds it too, and a tile's own fields are the script's props.
  expect((await view("waiting")).kind).toBe("waiting.list");
  expect(((await view("waiting.list", { demo: "only" })).view as { rows: unknown[] }).rows.length, "its made-up asks alone").toBeGreaterThan(0);

  // Its setting changed, the next draw warns sooner: the script read it as a prop.
  const configured = await client.request<ExtensionsConfigured>({ action: "extensions.configure", extension: "waiting", set: { "warn-days": 1 }, mutation: { author: "user" } } as never);
  expect(configured.settings.fields.find(f => f.name === "warn-days")).toMatchObject({ value: 1, state: "set", default: 3 });
  expect(((await view("waiting.list")).view as { rows: { tone?: string }[] }).rows[0]!.tone).toBe("warn");

  await expect(view("reader")).rejects.toThrow("isn't drawn by a script");
  await expect(view("compost.heap")).rejects.toThrow("no extension here serves a compost.heap tile");
}, 120_000);

test("the outlines there are to open are a list, and it makes none", async () => {
  const { client, list } = await setup();
  // A service no host runs knows its own outline; a host's answer names every one and each forward's.
  expect(await client.request<KnownOutlines>({ action: "outlines.known" } as never)).toEqual({ outlines: [{ name: "garden", here: true }] });
  const outlines = await list("outlines");
  expect(outlines.list.rows).toEqual([expect.objectContaining({ id: "garden", label: "garden", act: 'outline.switch name="garden"' })]);
  const none = await list("outlines", { query: "allotment" });
  expect(none.list.rows).toEqual([]);
  expect(none.list.empty).toContain("makes none");
}, 60_000);
