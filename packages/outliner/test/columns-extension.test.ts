// The columns extension (PIE-758): a rich component whose view is a row of boxes, one per note under the line.
// A scratch service in a temp folder; every note and word is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { ResourceProjection, ResourceProjectionReadResult } from "../src/resource-projection";
import type { Block } from "../src/types";
import { resourceProjectionLayout } from "../src/detail-embeds";

const PERSON = { author: "user" as const };
const REPO_EXTENSIONS = join(import.meta.dir, "..", "extensions");
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

/** A scratch service whose outline root (and so its `extensions/` folder) is a temp folder. */
async function setup(options: { install?: string[]; userInstall?: string[] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-ext-b-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlineFolder = join(root, "outline");
  mkdirSync(join(outlineFolder, "extensions"), { recursive: true });
  for (const name of options.install ?? []) cpSync(join(REPO_EXTENSIONS, name), join(outlineFolder, "extensions", name), { recursive: true });
  for (const name of options.userInstall ?? []) cpSync(join(REPO_EXTENSIONS, name), join(root, "user-extensions", name), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  const client = new OutlinerClient(socket);
  const events: Array<{ domain: string; action: string; blockId?: string }> = [];
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId: "ext-test-observer", role: "observer", contextId: "ext-test-observer" },
    onConnect: connected.resolve, onError: connected.reject, onEvent: (event) => { events.push(event); },
  });
  await connected.promise;
  cleanups.push(async () => {
    await watcher.stop();
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parentId?: string, by?: { author: "user" | "agent"; actorId?: string }) =>
    client.request<Block>({ action: "create", text, ...(parentId ? { parentId } : {}),
      ...(by ? { author: by.author, ...(by.actorId ? { provenance: { actorId: by.actorId } } : {}) } : {}) });
  const list = (reload = false) => client.request<ExtensionsListResult>({ action: "extensions.list", ...(reload ? { reload: true } : {}) });
  const projections = async (blockId: string) =>
    (await client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId })).projections;
  const projection = (blockId: string, kind: string, ready: (projection: ResourceProjection) => boolean = (p) => p.status === "ready") =>
    until(`${kind} projection`, async () => (await projections(blockId)).find((p) => p.kind === kind && ready(p)));
  const extensionsFolder = join(outlineFolder, "extensions");
  return { root, outlineFolder, extensionsFolder, store, server, client, events, create, list, projections, projection };
}


test("columns:: draws the notes under it as a row of boxes, and renders to html, markdown and json", async () => {
  const { client, create, projection } = await setup({ install: ["columns"] });
  const block = await create("Compare\ncolumns:: 2");
  await create("Concept\nIdeas sit beside code.", block.id);
  await create("Build\nA row of boxes.\nStacked when narrow.", block.id);
  await create("Third\nNot shown at two.", block.id);
  const shown = await projection(block.id, "component", (p) => p.status === "ready" && p.output?.markdown !== undefined && (p.output.component as { view: { type: string; children?: unknown[] } }).view.children?.length === 2);
  const view = (shown.output!.component as { view: { type: string; children: { type: string; title: string }[] } }).view;
  expect(view.type).toBe("row");
  expect(view.children.map((box) => box.title)).toEqual(["Concept", "Build"]);

  const render = async (target: string) => (await client.request<{ results: { rendered: { body: string; via: string } }[] }>(
    { action: "extensions.render", blockId: block.id, target })).results[0]!.rendered;
  // Composed from the view: a grid that stacks below 24 characters a column, each section's Blockdown left to the reader.
  expect(await render("html")).toMatchObject({ via: "primitives", contentType: "text/html; charset=utf-8" });
  expect((await render("html")).body).toContain('<div class="ext-row" style="--ext-min:24ch">');
  expect((await render("html")).body).toContain('<div class="ext-blockdown">A row of boxes.\nStacked when narrow.</div>');
  expect((await render("markdown")).body).toContain("**Build**");
  expect(JSON.parse((await render("json")).body).columns).toHaveLength(2);
}, 30_000);

test("with no argument there is one column per note, at most four; with no notes it says so", async () => {
  const { create, projection } = await setup({ install: ["columns"] });
  const block = await create("Wide\ncolumns::");
  for (const name of ["a", "b", "c", "d", "e"]) await create(`Section ${name}\nwords`, block.id);
  const view = ((await projection(block.id, "component", (p) => p.status === "ready" && (p.output?.component as { view: { children?: unknown[] } }).view.children?.length === 4)).output!.component as { view: { children: unknown[] } }).view;
  expect(view.children).toHaveLength(4);
  const empty = await create("Empty\ncolumns:: 3");
  const none = (await projection(empty.id, "component")).output!.component as { view: { type: string } };
  expect(none.view.type).toBe("text");
}, 30_000);

test("the line redraws without r when what it reads changes: the block, a child, a child added", async () => {
  const { client, create, projection } = await setup({ install: ["columns"] });
  const block = await create("Inline\ncolumns::\nLeft\nsome words\n|||\nRight\nmore words");
  const titles = async () => ((await projection(block.id, "component")).output!.component as { view: { children: { title: string }[] } }).view.children.map((b) => b.title);
  expect(await titles()).toEqual(["Left", "Right"]);
  const got = await client.request<{ text: string; revision: number }>({ action: "get", blockId: block.id });
  await client.request({ action: "update", blockId: block.id, text: got.text.replace("Right", "Far right"), expectedRevision: got.revision, mutation: PERSON });
  const view = (blockId: string, check: (titles: string[]) => boolean) => projection(blockId, "component", (p) => p.status === "ready" && !p.output?.inputsChanged &&
    check(((p.output!.component as { view: { children?: { title: string }[] } }).view.children ?? []).map((b) => b.title)));
  await view(block.id, (shown) => shown.join() === "Left,Far right");

  // Sections as child notes: the line was run before they existed; each one written redraws it, as does an edit to one.
  const parent = await create("Under\ncolumns::");
  await projection(parent.id, "component");
  const first = await create("One\nfirst words", parent.id, PERSON);
  await create("Two\nsecond words", parent.id, PERSON);
  await view(parent.id, (shown) => shown.join() === "One,Two");
  const child = await client.request<{ text: string; revision: number }>({ action: "get", blockId: first.id });
  await client.request({ action: "update", blockId: first.id, text: child.text.replace("One", "Uno"), expectedRevision: child.revision, mutation: PERSON });
  await view(parent.id, (shown) => shown.join() === "Uno,Two");
}, 30_000);

test("Detail (the sysop console) draws the sections from the view: a row it lays side by side, or stacks", async () => {
  const { create, projection } = await setup({ install: ["columns"] });
  const block = await create("Compare\ncolumns:: 2");
  await create("Concept\nIdeas sit beside code.", block.id);
  await create("Build\nA row of boxes.", block.id);
  const shown = await projection(block.id, "component", (p) => p.status === "ready" && p.output?.markdown.includes("Build") === true);
  const text = resourceProjectionLayout(shown).lines.join("\n");
  expect(text).toContain("~~~ep0ch-row 24");
  expect(text).toContain("**Concept**");
  expect(text.indexOf("**Concept**")).toBeLessThan(text.indexOf("**Build**"));
}, 30_000);

test("the web draws it: a grid of the sections read as Blockdown, the Markdown export in order, a line not run yet as its source", async () => {
  const { client, create, projection } = await setup({ install: ["columns"] });
  const block = await create("Compare\ncolumns:: 2");
  await create("Concept\n## Why\n- ideas *sit* beside code", block.id, PERSON);
  await create("Build\nA row of boxes.\n\n> [!warning] Mind the gap\n> narrow screens stack", block.id, PERSON);
  await projection(block.id, "component", (p) => p.status === "ready" && !p.output?.inputsChanged && p.output?.markdown.includes("Build") === true);
  const render = async (format: "html" | "markdown", blockId = block.id) =>
    (await client.request<{ text: string }>({ action: "notes.render", blockId, format })).text;
  const html = await render("html");
  expect(html).toContain('<div class="ext-row" style="--ext-min:24ch">');
  // The page's own reader drew each section: a heading, a list, emphasis, not their source.
  expect(html).toContain('<div class="ext-blockdown ext-read"><h2>Why</h2>');
  expect(html).toContain("<li>ideas <em>sit</em> beside code</li>");
  expect(html).not.toContain("");
  // A callout in a section is a callout, as on the rest of the page.
  expect(html).toContain('data-callout="warning"');
  const markdown = await render("markdown");
  expect(markdown.indexOf("**Concept**")).toBeGreaterThan(0);
  expect(markdown.indexOf("**Concept**")).toBeLessThan(markdown.indexOf("**Build**"));
  // A line that can't run (its argument is bad) has nothing to show: its source stands in, never nothing.
  const pending = await create("Pending\ncolumns:: x");
  expect(await render("html", pending.id)).toContain("<code>columns:: x</code>");
}, 30_000);
