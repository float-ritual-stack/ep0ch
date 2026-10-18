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
  /** Draws a note's script lines: the script sources are loaded first, so a line is never asked before its script exists. */
  const draw = async (blockId: string) => {
    await client.request({ action: "extensions.list", reload: true });
    await client.request({ action: "resources.projection.read", blockId, materialize: true });
  };
  return { store, client, tailnet, publicly, draw };
}

test("a render script's output on a page says hidden here when the script read a note the page may not show", async () => {
  const { store, draw, tailnet, publicly } = await setup();
  const quiet = store.create("Gate codes [code::4471]");
  const locked = store.create("Vault codes [publish::never] [code::9023]");
  const page = store.create([
    "Shed report [publish::public:shed-report]",
    `::= (await resolve('((${quiet.id})).code')).values[0]`,
    `::= (await resolve('((${locked.id})).code')).values[0]`,
  ].join("\n"), null, "user");
  await draw(page.id);
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

test("a render script reads only the children the page may show", async () => {
  const { store, draw, tailnet, publicly } = await setup();
  const parent = store.create("Seed shelf [publish::public:shelf]");
  store.create("Vault codes [publish::never] [code::9023]", parent.id);
  const reader = store.create("Peek [script::peek] [mode::render] [publish::public]\n```js\nreturn JSON.stringify(await read(\"" + parent.id + "\", { depth: 1 }));\n```");
  const page = store.create("Shelf view [publish::public:shelf-view]\npeek::", null, "user");
  void reader;
  await draw(page.id);
  await until("the line drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 1);
  for (const html of [await tailnet("shelf-view"), await publicly("shelf-view")]) {
    expect(html).not.toContain("9023");
    expect(html).toContain("&quot;children&quot;:[]");
    expect(html).toContain("&quot;complete&quot;:true");
  }
});

test("a private script's self never appears directly, embedded, or used on a public page", async () => {
  const { store, draw, publicly } = await setup();
  const script = store.create('PRIVATE_SCRIPT_TITLE [script::peek-self] [mode::render] [publish::never] [secret::PRIVATE_SCRIPT_PROPERTY]\n```js\nreturn self.title + JSON.stringify(self.properties);\n```');
  const page = store.create("Shelf view [page::private-script-host] [publish::public:shelf-two]\npeek-self::");
  await draw(page.id);
  await until("private script drawn", () => store.extensionOutputs(page.id).some(row => row.result));
  store.create(`Embedded [publish::public:self-embedded]\n!((${page.id}))`);
  store.create("Used [publish::public:self-used]\n::use{of=[[private-script-host]]}");
  for (const slug of ["shelf-two", "self-embedded", "self-used"]) {
    const html = await publicly(slug);
    expect(html).not.toContain("PRIVATE_SCRIPT_TITLE");
    expect(html).not.toContain("PRIVATE_SCRIPT_PROPERTY");
    expect(html).not.toContain(script.id);
    expect(html).toContain("not shared");
  }
});

test("published script globals and query rows withhold private parent ids but retain visible parents", async () => {
  const { store, client, draw, publicly } = await setup();
  const parent = store.create("PRIVATE_PARENT");
  const visible = store.create("Visible parent [publish::public]");
  store.create("Private child [type::parent-probe] [publish::public]", parent.id);
  store.create("Visible child [type::parent-probe] [publish::public]", visible.id);
  store.create('Parent probe [script::parent-probe] [mode::render] [publish::public]\n```js\nconst rows = (await q("type=parent-probe")).blocks;\nreturn "THIS=" + this.parent + "; SELF=" + self.parent + "; ROWS=" + rows.map(row => row.parentId).join(",");\n```', parent.id);
  const page = store.create("Parent report [publish::public:parent-report]\nparent-probe::", parent.id);
  await draw(page.id);
  await until("parent probe drawn", () => store.extensionOutputs(page.id).some(row => row.result));
  const html = await publicly("parent-report");
  expect(html).not.toContain(parent.id);
  expect(html).toContain("THIS=null; SELF=null; ROWS=");
  expect(html).toContain(visible.id);
  const answer = await client.request<{ deps: string[]; script: { markdown: string } }>({ action: "site.answer", blockId: page.id, scriptLine: 1, hidden: [parent.id] });
  expect(answer.deps).toContain(parent.id);
  expect(answer.script.markdown).not.toContain(parent.id);
});

test("a script that prints a breadcrumb, or counts matches it was not shown, says hidden here", async () => {
  const { store, draw, tailnet, publicly } = await setup();
  const locked = store.create("Vault shelf [publish::never]");
  const row = store.create("Seed packet [type::seed] [publish::public]", locked.id);
  store.create("Seed packet two [type::seed] [publish::never]");
  store.create("Crumbs [script::crumbs] [mode::render] [publish::public]\n```js\nreturn JSON.stringify(await read(\"" + row.id + "\", { depth: 0 }));\n```");
  store.create("Counter [script::counter] [mode::render] [publish::public]\n```js\nconst found = await q(\"type=seed\", { limit: 1 });\nreturn `${found.total} seeds`;\n```");
  const page = store.create("Script page two [publish::public:script-two]\ncrumbs::\ncounter::", null, "user");
  await draw(page.id);
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
  const { store, draw, tailnet, publicly } = await setup();
  const alpha = store.create("Alpha project [type::project] [publish::public]");
  store.create("Alpha sign-off [status::approved] [publish::never]", alpha.id);
  store.create("Direct [script::direct] [mode::render] [publish::public]\n```js\nconst found = await tools.outline_find({ query: \"type=project child:status=approved\" });\nreturn `${found.blocks.length} signed`;\n```");
  const top = store.create("Top [publish::public]");
  let at = top;
  for (let level = 0; level < 5; level++) at = store.create(`Level ${level}`, at.id);
  store.create("Deep vault [publish::never] [code::9023]", at.id);
  store.create("Deep [script::deep] [mode::render] [publish::public]\n```js\nreturn JSON.stringify(await read(\"" + top.id + "\", { depth: 6 }));\n```");
  const page = store.create("Script page [publish::public:script-page]\ndirect::\ndeep::", null, "user");
  await draw(page.id);
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

test("embedded and used script lines show safe output and hide private reads", async () => {
  const { store, draw, tailnet, publicly } = await setup();
  const locked = store.create("Locked [publish::never] [code::SECRET_EMBED_CODE]");
  store.create("Marker [script::marker] [mode::render] [publish::public]\n```js\nreturn 'EMBED-MARK ' + this.title;\n```");
  const inner = store.create(`Inner [page::inner] [publish::public]\nmarker::\n::= (await resolve('((${locked.id})).code')).values[0]`);
  await draw(inner.id);
  await until("the inner lines drawn", () => store.extensionOutputs(inner.id).filter(row => row.result).length === 2);
  store.create(`Outer [publish::public:outer]\n!((${inner.id}))`);
  store.create("Used [publish::public:used]\n::use{of=[[inner]]}");
  for (const page of ["outer", "used"]) for (const read of [tailnet, publicly]) {
    const html = await read(page);
    expect(html).toContain(page === "used" ? "EMBED-MARK Used" : "EMBED-MARK Inner");
    expect(html).toContain("hidden here");
    expect(html).not.toContain("SECRET_EMBED_CODE");
  }
});

test("a limited script search counts visible matches before applying its limit", async () => {
  const { store, draw, tailnet, publicly } = await setup();
  store.create("Visible seed [type::seed] [publish::public]");
  store.create("Quiet seed [type::seed]");
  store.create("Locked seed [type::seed] [publish::never]");
  const view = store.create("Seeds [type::virtual-branch] [query::type=seed] [publish::public]");
  store.create(`Counter [script::visible-count] [mode::render] [publish::public]\n\`\`\`js\nconst found = await tools.outline_find({ view: "${view.id}", limit: 1 });\nreturn "VISIBLE_COUNT=" + found.total + "; ROWS=" + found.blocks.length;\n\`\`\``);
  const page = store.create("Count [publish::public:count]\nvisible-count::");
  await draw(page.id);
  await until("counter drawn", () => store.extensionOutputs(page.id).some(row => row.result));
  expect(await publicly("count")).toContain("VISIBLE_COUNT=1; ROWS=1");
  expect(await tailnet("count")).toContain("VISIBLE_COUNT=2; ROWS=1");
  store.create(`All seeds [script::all-seeds] [mode::render] [publish::public]\n\`\`\`js\nconst found = await q("type=seed", { limit: 10 });\nreturn view.text({ text: "ALL_COUNT=" + found.blocks.length });\n\`\`\``);
  const all = store.create("All [publish::public:all]\nall-seeds::");
  await draw(all.id);
  await until("all seeds drawn", () => store.extensionOutputs(all.id).some(row => row.result));
  expect(await publicly("all")).toContain("ALL_COUNT=1");
  expect(await tailnet("all")).toContain("ALL_COUNT=2");
});

for (const scope of ["under", "view"] as const) test(`a published script cannot count through a hidden ${scope} note`, async () => {
  const { store, client, draw, publicly, tailnet } = await setup();
  const root = store.create(scope === "view"
    ? "Private seed view [type::virtual-branch] [query::type=seed]"
    : "Private seed shelf");
  store.create("Visible seed [type::seed] [publish::public]", scope === "under" ? root.id : null);
  const query = scope === "under"
    ? `q("type=seed", { under: "${root.id}" })`
    : `tools.outline_find({ view: "${root.id}" })`;
  store.create(`Counter [script::scope-count] [mode::render] [publish::public]\n\`\`\`js\nconst found = await ${query};\nreturn "SCOPE_COUNT=" + ${scope === "under" ? "found.blocks.length" : "found.total"};\n\`\`\``);
  const page = store.create("Scoped count [publish::public:scoped-count]\nscope-count::");
  await draw(page.id);
  await until("scoped counter drawn", () => store.extensionOutputs(page.id).some(row => row.result));
  expect(await tailnet("scoped-count")).toContain("SCOPE_COUNT=1");
  const outside = await publicly("scoped-count");
  expect(outside).not.toContain("SCOPE_COUNT=1");
  expect(outside).toContain("not shared");
  const answer = await client.request<{ deps: string[]; script: { markdown: string } }>({
    action: "site.answer", blockId: page.id, scriptLine: 1, hidden: [root.id],
  });
  expect(answer.deps).toContain(root.id);
  expect(answer.script.markdown).toBe("not shared");
  store.update(root.id, `${root.text} [publish::public]`, root.revision, { author: "user" });
  expect(await publicly("scoped-count")).toContain("SCOPE_COUNT=1");
});

test("the Site counts a limited figure's groups before taking its first row", async () => {
  const { store, client } = await setup();
  const page = store.create("Bed totals [publish::public]");
  store.create("Beans [type::crop] [family::legume] [publish::public]");
  const hidden = store.create("Peas [type::crop] [family::legume] [publish::never]");
  const answer = await client.request<{ produced: { groups: { value: string; count: number }[] } }>({
    action: "site.answer", blockId: page.id, hidden: [hidden.id],
    produce: { kind: "figure", figure: "rank", props: { query: "type=crop", group: "family", limit: 1 } },
  });
  expect(answer.produced.groups).toEqual([expect.objectContaining({ value: "legume", count: 1 })]);
});

test("a published read is complete when its only child is hidden", async () => {
  const { store, draw, publicly } = await setup();
  const parent = store.create("Visible shelf [publish::public]");
  store.create("Private packet [publish::never]", parent.id);
  store.create(`Read completeness [script::read-completeness] [mode::render] [publish::public]\n\`\`\`js\nconst read = await tools.outline_read({ ref: "${parent.id}", depth: 0 });\nreturn "COMPLETE=" + read.complete + "; CHILDREN=" + read.children.length;\n\`\`\``);
  const page = store.create("Shelf report [publish::public:shelf-report]\nread-completeness::");
  await draw(page.id);
  await until("read drawn", () => store.extensionOutputs(page.id).some(row => row.result));
  expect(await publicly("shelf-report")).toContain("COMPLETE=true; CHILDREN=0");
  const visible = store.create("Public packet [publish::public]", parent.id);
  expect(await publicly("shelf-report")).toContain("COMPLETE=false; CHILDREN=0");
  store.create("Private label [publish::never]", visible.id);
  store.create(`Bounded read [script::bounded-read] [mode::render] [publish::public]\n\`\`\`js\nconst read = await tools.outline_read({ ref: "${parent.id}", depth: 1, limit: 1 });\nreturn "BOUNDED=" + read.complete + "; CHILD=" + read.children[0]?.text + "; MORE=" + !!read.children[0]?.more;\n\`\`\``);
  const bounded = store.create("Bounded shelf [publish::public:bounded-shelf]\nbounded-read::");
  await draw(bounded.id);
  await until("bounded read drawn", () => store.extensionOutputs(bounded.id).some(row => row.result));
  const html = await publicly("bounded-shelf");
  expect(html).toContain("BOUNDED=true; CHILD=Public packet");
  expect(html).toContain("MORE=false");
});

test("published changes count visible edits before limiting the page", async () => {
  const { store, draw, publicly } = await setup();
  const visible = store.create("Public planting [publish::public]");
  const edit = (id: string, text: string) => store.update(id, text, store.get(id)!.revision, { author: "agent", actorId: "garden-helper" });
  edit(visible.id, "Public planting revised [publish::public]");
  for (let i = 0; i < 3; i++) {
    const hidden = store.create("Private planting [publish::never]");
    edit(hidden.id, "Private planting revised [publish::never]");
  }
  store.create('Recent planting [script::recent-planting] [mode::render] [publish::public]\n```js\nconst found = await tools.outline_changes({ since: 0, actor: "garden-helper", limit: 1 });\nreturn "CHANGES=" + found.entries.length + "; COMPLETE=" + found.complete + "; TITLE=" + found.entries[0]?.title;\n```');
  const page = store.create("Planting changes [publish::public:planting-changes]\nrecent-planting::");
  await draw(page.id);
  await until("changes drawn", () => store.extensionOutputs(page.id).some(row => row.result));
  expect(await publicly("planting-changes")).toContain("CHANGES=1; COMPLETE=true; TITLE=Public planting revised");
});


test("nested templates publish the caller's props and values, including conditional fields", async () => {
  const { store, tailnet, publicly } = await setup();
  store.create('Leaf [page::leaf] [publish::public] [form-field::crop text]\nFor {{this.owner}}: {{props.crop}}.\n::if{where="status=active"}\nActive template body\n::\n::fields{key=owner}');
  store.create('Middle [page::middle] [publish::public] [form-field::crop text]\n::use{of=[[leaf]] crop="{{props.crop}}"}');
  store.create('Garden [publish::public:nested-use] [owner::Ada] [status::active]\n::use{of=[[middle]] crop=seedlings}');
  for (const read of [tailnet, publicly]) {
    const html = (await read("nested-use")).split("<article>")[1]!.split("</article>")[0]!.split("</aside></details>").at(-1)!;
    expect(html).toContain("For Ada: seedlings.");
    expect(html).toContain("Active template body");
    expect(html).not.toContain("{{props.crop}}");
    expect(html).not.toContain("::fields");
  }
});
