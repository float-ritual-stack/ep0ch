// PIE-978 (permissions): what a published page draws from the Site never reveals a note the page may not show. A render
// script's output, an `::if` over a relation, on the tailnet page (every note but a locked one) and the public one (only
// [publish::public] notes). Scratch services in temp folders; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-publish-visibility-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const workspace = join(root, "garden");
  mkdirSync(workspace);
  const paths = scratchOutline(root, { folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80, ruleQuietMs: 20 });
  await server.start();
  const client = new OutlinerClient(paths.socket, 15_000);
  const publisher = new Publisher({ client });
  await publisher.start();
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  /** The page as a tailnet reader sees it, and as anyone with the public link does. */
  const tailnet = async (slug: string) => (await publisher.handle(new Request(`http://127.0.0.1/p/${slug}?view=html`, { headers: { accept: "text/html" } }))).text();
  const publicly = async (slug: string) => (await publisher.handle(new Request(`http://moth-box.tail0000.ts.net/share/p/${slug}?view=html`, { headers: { accept: "text/html" } }), "public")).text();
  return { store, client, tailnet, publicly };
}

test("a render script's output on a page says hidden here when the script read a note the page may not show", async () => {
  const { store, client, tailnet, publicly } = await setup();
  const quiet = store.create("Gate codes [code::4471]");
  const locked = store.create("Vault codes [publish::never] [code::9023]");
  const page = store.create([
    "Shed report [publish::public:shed-report]",
    `::= (await resolve('((${quiet.id})).code')).values[0]`,
    `::= (await resolve('((${locked.id})).code')).values[0]`,
  ].join("\n"), null, "user");
  await client.request({ action: "resources.projection.read", blockId: page.id, materialize: true });
  await until("both lines drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 2);
  // The tailnet page shows an untagged note, never a locked one; the public page shows neither.
  const inside = await tailnet("shed-report");
  expect(inside).toContain("4471");
  expect(inside).not.toContain("9023");
  const outside = await publicly("shed-report");
  expect(outside).not.toContain("4471");
  expect(outside).not.toContain("9023");
  expect(outside).toContain("hidden here");
});

test("an ::if over a relation never lets its body say what a note the page may not show holds", async () => {
  const { store, tailnet, publicly } = await setup();
  const plan = store.create("Bed plan [publish::public:bed-plan] [status::open]\n::if{where=\"child:status=approved\"}\nApproved by the committee.\n::");
  store.create("Quote from the nursery [status::approved]", plan.id);
  const inside = await tailnet("bed-plan");
  expect(inside).toContain("Approved by the committee.");
  expect(await publicly("bed-plan")).not.toContain("Approved by the committee.");

  const locked = store.create("Bed plan two [publish::public:bed-plan-two] [status::open]\n::if{where=\"child:status=approved\"}\nApproved too.\n::");
  store.create("Locked quote [status::approved] [publish::never]", locked.id);
  expect(await tailnet("bed-plan-two")).not.toContain("Approved too.");
  expect(await publicly("bed-plan-two")).not.toContain("Approved too.");
});

// Codex's review of the first fix: what a script or a query consults is more than the rows it returns.

test("a render script that reads a note and returns its child says hidden here when the child is one the page may not show", async () => {
  const { store, client, tailnet, publicly } = await setup();
  const parent = store.create("Seed shelf [publish::public:shelf]");
  store.create("Vault codes [publish::never] [code::9023]", parent.id);
  const reader = store.create("Peek [script::peek] [mode::render]\n```js\nreturn JSON.stringify(await read(\"" + parent.id + "\", { depth: 1 }));\n```");
  const page = store.create("Shelf view [publish::public:shelf-view]\npeek::", null, "user");
  void reader;
  await client.request({ action: "resources.projection.read", blockId: page.id, materialize: true });
  await until("the line drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 1);
  for (const html of [await tailnet("shelf-view"), await publicly("shelf-view")]) {
    expect(html).not.toContain("9023");
    expect(html).toContain("hidden here");
  }
});

test("a script defined in a note the page does not show still draws: its code is not content", async () => {
  const { store, client, publicly } = await setup();
  store.create("Peek [script::peek-self] [mode::render] [publish::never]\n```js\nreturn `self says ${self.title}`;\n```");
  const page = store.create("Shelf view [publish::public:shelf-two]\npeek-self::", null, "user");
  await client.request({ action: "resources.projection.read", blockId: page.id, materialize: true });
  await until("the line drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 1);
  expect(await publicly("shelf-two")).toContain("self says Peek");
});

test("a script that prints a breadcrumb, or counts matches it was not shown, says hidden here", async () => {
  const { store, client, tailnet, publicly } = await setup();
  const locked = store.create("Vault shelf [publish::never]");
  const row = store.create("Seed packet [type::seed] [publish::public]", locked.id);
  store.create("Seed packet two [type::seed] [publish::never]");
  store.create("Crumbs [script::crumbs] [mode::render]\n```js\nreturn JSON.stringify(await read(\"" + row.id + "\", { depth: 0 }));\n```");
  store.create("Counter [script::counter] [mode::render]\n```js\nconst found = await q(\"type=seed\", { limit: 1 });\nreturn `${found.total} seeds`;\n```");
  const page = store.create("Script page two [publish::public:script-two]\ncrumbs::\ncounter::", null, "user");
  await client.request({ action: "resources.projection.read", blockId: page.id, materialize: true });
  await until("both drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 2);
  expect(store.extensionOutputs(page.id).map(r => (r.request as { untracked?: boolean }).untracked ?? false).sort()).toEqual([false, true]);
  for (const html of [await tailnet("script-two"), await publicly("script-two")]) {
    expect(html).not.toContain("Vault shelf");
    expect(html).not.toMatch(/\d seeds/);
  }
});

test("an ::if over any relation to a note the page may not show says nothing", async () => {
  const { store, tailnet } = await setup();
  const locked = store.create("Vault note [publish::never]");
  const page = store.create(`Linked page [publish::public:linked-page]\n::if{where="linkedfrom:((${locked.id}))"}\nVault links here.\n::`);
  store.update(locked.id, `Vault note [publish::never] ((${page.id}))`, store.get(locked.id)!.revision, { author: "user" });
  expect(await tailnet("linked-page")).not.toContain("Vault links here.");
});

test("a count over a relation filter never changes with a note the page may not show", async () => {
  const { store, tailnet } = await setup();
  const page = store.create("Orders [publish::public:orders]\nApproved: {{this.children | child:status=approved .count}}");
  const kid = store.create("Bed order [publish::public]", page.id);
  const quote = store.create("Quote [status::approved] [publish::never]", kid.id);
  expect(await tailnet("orders")).not.toMatch(/Approved: [01]/);
  expect(await tailnet("orders")).toContain("hidden here");
  store.update(quote.id, "Quote [status::draft] [publish::never]", store.get(quote.id)!.revision, { author: "user" });
  expect(await tailnet("orders")).toContain("hidden here");
});

test("a figure's relation query lists a note only when every note that decided it is one the page may show", async () => {
  const { store, tailnet } = await setup();
  const alpha = store.create("Alpha project [type::project] [publish::public]");
  store.create("Alpha sign-off [status::approved] [publish::never]", alpha.id);
  const beta = store.create("Beta project [type::project] [publish::public]");
  store.create("Beta sign-off [status::approved] [publish::public]", beta.id);
  const page = store.create('Signed off [publish::public:signed-off]\n\n::graph-table\n---\nquery: type=project child:status=approved\ncolumns: [title]\n---\n::');
  void page;
  const html = await tailnet("signed-off");
  expect(html).toContain("Beta project");
  expect(html).not.toContain("Alpha project");
});

test("a ::links query and a view lane over a child: clause list a note only when the page shows every child that decided it", async () => {
  const { store, tailnet } = await setup();
  const alpha = store.create("Alpha project [type::project] [publish::public]");
  store.create("Alpha sign-off [status::approved] [publish::never]", alpha.id);
  const beta = store.create("Beta project [type::project] [publish::public]");
  store.create("Beta sign-off [status::approved] [publish::public]", beta.id);
  const view = store.create("Signed [type::virtual-branch] [query::type=project child:status=approved] [publish::public]");
  store.create("Links page [publish::public:links-page]\n\n::links{query=\"type=project child:status=approved\"}\n::\n\n" + `!((${view.id}))`);
  const html = await tailnet("links-page");
  expect(html).toContain("Beta project");
  expect(html).not.toContain("Alpha project");
});

test("a script that calls a tool directly, or reads deep, is tracked as well as one that calls q() or read()", async () => {
  const { store, client, tailnet, publicly } = await setup();
  const alpha = store.create("Alpha project [type::project] [publish::public]");
  store.create("Alpha sign-off [status::approved] [publish::never]", alpha.id);
  store.create("Direct [script::direct] [mode::render]\n```js\nconst found = await tools.outline_find({ query: \"type=project child:status=approved\" });\nreturn `${found.blocks.length} signed`;\n```");
  const top = store.create("Top [publish::public]");
  let at = top;
  for (let level = 0; level < 5; level++) at = store.create(`Level ${level}`, at.id);
  store.create("Deep vault [publish::never] [code::9023]", at.id);
  store.create("Deep [script::deep] [mode::render]\n```js\nreturn JSON.stringify(await read(\"" + top.id + "\", { depth: 6 }));\n```");
  const page = store.create("Script page [publish::public:script-page]\ndirect::\ndeep::", null, "user");
  await client.request({ action: "resources.projection.read", blockId: page.id, materialize: true });
  await until("both drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 2);
  for (const html of [await tailnet("script-page"), await publicly("script-page")]) {
    expect(html).not.toContain("1 signed");
    expect(html).not.toContain("9023");
    expect(html).toContain("hidden here");
  }
});

test("a NOT over a relation to a note the page may not show says nothing, and an unrelated private neighbour hides no child", async () => {
  const { store, tailnet } = await setup();
  const locked = store.create("Vault note [publish::never]");
  store.create(`Absent page [publish::public:absent-page]\n::if{where="NOT linkedfrom:((${locked.id}))"}\nNo vault link.\n::`);
  expect(await tailnet("absent-page")).not.toContain("No vault link.");
  const parent = store.create("Bed list [publish::public:bed-list]");
  const child = store.create("Bean bed [publish::public]", parent.id);
  store.create("Hidden compost [publish::never]", child.id);
  store.update(parent.id, `Bed list [publish::public:bed-list]\n::graph-table\n---\nquery: parent:this\ncolumns: [title]\n---\n::`, store.get(parent.id)!.revision, { author: "user" });
  expect(await tailnet("bed-list")).toContain("Bean bed");
});
