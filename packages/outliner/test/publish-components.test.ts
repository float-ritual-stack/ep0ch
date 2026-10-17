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
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A throwaway service over a fictional garden outline, and a publisher reading it. */
async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-publish-components-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "garden");
  mkdirSync(workspace);
  const paths = scratchOutline(root, { folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const publisher = new Publisher({ client: new OutlinerClient(paths.socket) });
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
  });
  await publisher.start();
  const page = async (path: string) => {
    const response = await publisher.handle(new Request(`http://127.0.0.1${path}`, { headers: { accept: "text/html" } }));
    expect(response.status).toBe(200);
    return response.text();
  };
  return { store, page, publisher };
}

/** Chores in three stages, one of them locked, and a hub of three views over them. */
function seed(store: OutlinerStore) {
  const chores = store.create("Chores");
  store.create("Sow the runner beans [type::chore] [stage::sow] [bed::north]", chores.id);
  store.create("Sow the sweet peas [type::chore] [stage::sow] [bed::south]", chores.id);
  store.create("Weed the onion bed [type::chore] [stage::weed] [bed::north]", chores.id);
  store.create("Compost secret recipe [type::chore] [stage::sow] [publish::never]", chores.id);
  const hub = store.create("Garden board");
  const sowing = store.create("Sowing [type::virtual-branch] [query::type=chore stage=sow] [summary-properties::bed]", hub.id);
  store.create("Weeding [type::virtual-branch] [query::type=chore stage=weed]", hub.id);
  const harvest = store.create("Harvest [type::virtual-branch] [query::type=chore stage=harvest]", hub.id);
  const byBed = store.create("By bed [type::virtual-branch] [query::type=chore] [group::bed]");
  return { hub, sowing, harvest, byBed };
}

test("a hub reads as a board of its views, each lane its rows and count; locked rows never show", async () => {
  const { store, page } = await setup();
  const { hub } = seed(store);
  const html = await page(`/p/${hub.id}`);
  expect(html).toContain(`<section class="board">`);
  expect(html.match(/<section class="lane ext-box">/g)?.length).toBe(3);
  expect(html).toContain("Sow the runner beans");
  expect(html).toContain("bed: north");
  expect(html).toContain("Weed the onion bed");
  expect(html).toMatch(/Sowing<\/a> <span class="dim">2<\/span>/);
  expect(html).toContain("No notes match this view yet. It asks <code>type=chore stage=harvest</code>.");
  expect(html).not.toContain("Compost secret recipe");
});

test("a view's own page lists its rows, grouped by its [group::] property", async () => {
  const { store, page } = await setup();
  const { byBed } = seed(store);
  const html = await page(`/p/${byBed.id}`);
  expect(html).toMatch(/<h4 class="view-group">north <span class="dim">2<\/span><\/h4>/);
  expect(html).toMatch(/<h4 class="view-group">south <span class="dim">1<\/span><\/h4>/);
  expect(html).toContain("Weed the onion bed");
  expect(html).not.toContain("Compost secret recipe");
});

test("figures draw live from the service, links list the note's links, and an embedded view draws as its lane", async () => {
  const { store, page } = await setup();
  const { sowing } = seed(store);
  const other = store.create("Seed catalogue");
  store.create("Hushed chore [type::chore] [stage::hushed] [publish::never]");
  const note = store.create([
    `Garden report, see ((${other.id}))`,
    "::graph-tabs",
    "---",
    "title: Chores by stage",
    'query: "type=chore"',
    "group: stage",
    "columns: [title, bed]",
    "---",
    "::",
    "::graph-stat",
    "---",
    "title: Counts",
    "items:",
    '  - { label: chores, query: "type=chore" }',
    "  - { label: beds, value: 2 }",
    "---",
    "::",
    "::graph-decision",
    "---",
    "title: Beds",
    "---",
    "- **Raised beds** — drains on clay",
    "- *Grow bags* — two seasons",
    "::",
    "::links",
    "::",
    "::graph-waterfall",
    "---",
    "title: Budget",
    "---",
    "- start: 10",
    "::",
    `!((${sowing.id}))`,
  ].join("\n"));
  const html = await page(`/p/${note.id}`);
  // Tabs: one radio per stage the service grouped, its table's rows linked to their notes.
  expect(html).toContain("<figcaption>Chores by stage</figcaption>");
  expect(html).toMatch(/<label class="fig-tab" for="fig-tabs-\d+-0">sow <span class="dim">2<\/span><\/label>/);
  expect(html).toContain("weed <span class=\"dim\">1</span>");
  // A group whose only members are locked isn't a tab: its value is theirs.
  expect(html).not.toContain("hushed");
  expect(html).toMatch(/<a href="\/p\/[0-9a-f-]+">Sow the runner beans<\/a>/);
  // Stat: the live count leaves the locked chore out; a static value stays.
  expect(html).toMatch(/<span class="v">3<\/span><span class="l">chores<\/span>/);
  expect(html).toMatch(/<span class="v">2<\/span><span class="l">beds<\/span>/);
  // Decision: chosen and rejected from the Markdown rows.
  expect(html).toContain(`<li class="chosen"><span class="g" aria-label="chosen">●</span> <span class="t">Raised beds</span> <span class="dim">— drains on clay</span></li>`);
  expect(html).toContain(`<li class="rejected">`);
  // Links: the outlinks (the catalogue, and the embedded view).
  expect(html).toMatch(/<h4 class="view-group">Outlinks <span class="dim">2<\/span><\/h4><ul class="fig-list fig-links"><li><span class="g">→<\/span> <a href="[^"]+">Seed catalogue<\/a>/);
  // A kind not drawn here yet: its source and a quiet word.
  expect(html).toContain("::graph-waterfall");
  expect(html).toContain("not drawn here yet");
  // The embedded view: its lane, not a quote, not the old placeholder.
  expect(html).not.toContain("views are not published");
  expect(html).toMatch(/<section class="lane ext-box"><h3><a href="[^"]+">Sowing<\/a> <span class="dim">2<\/span><\/h3>/);
  expect(html).not.toContain("Compost secret recipe");
  // No raw component source for the drawn ones.
  expect(html).not.toContain("::graph-tabs");
  expect(html).not.toContain("::graph-decision");
});

test("a figure written without its --- lines says so on the page (PIE-941)", async () => {
  const { store, page } = await setup();
  const bare = store.create("Deploys\n::graph-table\nquery: type=deploy\ncolumns: [title, created]\n::");
  const html = await page(`/p/${bare.id}`);
  expect(html).toContain("the ::graph-table has query:, columns: but no --- lines");
  const ruled = store.create("Deploys\n::graph-table\n---\ntitle: Deploys\nheaders: [a]\nrows: [[b]]\n---\n::");
  expect(await page(`/p/${ruled.id}`)).not.toContain("no --- lines");
});

test("the Markdown view keeps a figure's source as written", async () => {
  const { store, publisher } = await setup();
  const note = store.create("Report\n::graph-stat\n---\ntitle: Counts\n---\n- chores: 3\n::");
  const markdown = await (await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=md`))).text();
  expect(markdown).toContain("::graph-stat\n---\ntitle: Counts");
});

test("every kind a page draws draws from its Markdown rows, never its source", async () => {
  const { store, page } = await setup();
  const sources: Record<string, string> = {
    table: "headers: [bed, crop]\nrows: [[north, beans], [south, peas]]\n---",
    stat: "---\n- chores: 3\n- **beds: 2**",
    kpi: "---\n- chores: 3",
    check: "---\n- [x] sow the beans\n- [ ] weed",
    rank: "---\n- beans: 12\n- peas: 4",
    funnel: "---\n- sown: 12\n- sprouted: 9",
    timeline: "---\n- 2026-03: **sow**\n- 2026-05: *harvest*",
    meter: "value: 0.4\n---",
    decision: "---\n- **raised beds** — drains\n- *grow bags* — two seasons",
    uptime: "from: 2026-09-01\n---\n- ok*5 degraded ok down",
    activity: "---\n- 2026-03-02: 0 1 4 2 0*3",
    calendar: "year: 2026\nmonth: 3\n---\n- 12: **launch**",
    spark: "---\n2 0 5 11 3",
    plot: "---\n- Mon: 2\n- Tue: 5",
    tree: "nodes:\n  - label: garden\n    children: [{ label: north bed }]\n---",
    chat: "---\n- shypht: did the beans go in?\n- loki: yes, this morning",
    compare: "columns: [Raised, Bags]\n---\n- cost: £60 | £12",
    matrix: "---\n- north: beans=2 peas=1",
  };
  for (const [kind, body] of Object.entries(sources)) {
    const note = store.create(`Figure ${kind}\n::graph-${kind}\n---\ntitle: The ${kind}\n${body}\n::`);
    const html = await page(`/p/${note.id}`);
    expect(html, kind).toContain(`<figure class="fig fig-${kind}">`);
    expect(html, kind).not.toContain("not drawn here yet");
    expect(html, kind).not.toContain(`::graph-${kind}`);
  }
});

test("on a public page a live figure lists only public notes", async () => {
  const { store, publisher } = await setup();
  store.create("Sow the runner beans [type::chore] [publish::public]");
  store.create("Weed the onion bed [type::chore]");
  const note = store.create('Chore board [publish::public]\n::graph-table\n---\ntitle: Chores\nquery: "type=chore"\n---\n::');
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=html`, { headers: { accept: "text/html" } }), "public");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Sow the runner beans");
  expect(html).not.toContain("Weed the onion bed");
  expect(html).toContain("live · 1 result");
});

test("PIE-533 S3 on a page: one figure on two project pages lists each page's own, ::fields lists the occurrences, ::if draws its body only when this matches", async () => {
  const { store, page } = await setup();
  for (const [title, project] of [["Sort the bricks", "lego-night"], ["Build the tower", "lego-night"], ["Water the beans", "garden"]]) store.create(`${title} [type::ticket] [project::${project}]`);
  const figure = "::graph-table\n---\nquery: type=ticket project={{this.project}}\ncolumns: [title]\n---\n::";
  const lego = store.create(`Lego night [project::lego-night]\n\n${figure}`);
  const garden = store.create(`Garden [project::garden]\n\n${figure}`);
  const a = await page(`/p/${lego.id}`), b = await page(`/p/${garden.id}`);
  expect(a).toContain("Sort the bricks");
  expect(a).toContain("Build the tower");
  expect(a).not.toContain("Water the beans");
  expect(b).toContain("Water the beans");
  expect(b).not.toContain("Sort the bricks");

  const rail = store.create([
    "Vent rail [status::active]", "",
    "- first pass [connectTo::demonstrating by doing]", "- second pass [connectTo::shacks not cathedrals]", "",
    "::fields{key=connectTo}", "",
    "::if{where=\"status=active\"}", "shown when active", "::", "",
    "::if{where=\"status=paused\"}", "shown when paused", "::",
  ].join("\n"));
  const html = await page(`/p/${rail.id}`);
  expect(html).toContain("demonstrating by doing");
  expect(html).toContain("shacks not cathedrals");
  expect(html).toContain("line 3");
  expect(html).toContain("live · 2 occurrences");
  expect(html).toContain("shown when active");
  expect(html).not.toContain("shown when paused");
  expect(html).not.toContain("::if");
  expect(html).not.toContain("::fields");
});

test("on a public page a stat counts only the notes the page may show", async () => {
  const { store, publisher } = await setup();
  store.create("Sow the runner beans [type::chore] [publish::public]");
  store.create("Weed the onion bed [type::chore]");
  store.create("Mulch the paths [type::chore]");
  const note = store.create('Chore counts [publish::public]\n::graph-stat\n---\ntitle: Counts\nitems:\n  - label: chores\n    query: "type=chore"\n---\n::');
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=html`, { headers: { accept: "text/html" } }), "public");
  const html = await response.text();
  expect(html).toContain("chores");
  expect(html).toMatch(/>1</);
  expect(html).not.toMatch(/>3</);
});

test("a figure's call-site args reach the page's question: ::graph-table{project=…} reads {{props.project}}", async () => {
  const { store, page } = await setup();
  for (const [title, project] of [["Sort the bricks", "lego-night"], ["Water the beans", "garden"]]) store.create(`${title} [type::ticket] [project::${project}]`);
  const note = store.create("Pick\n\n::graph-table{project=garden}\n---\nquery: type=ticket project={{props.project}}\ncolumns: [title]\n---\n::");
  const html = await page(`/p/${note.id}`);
  expect(html).toContain("Water the beans");
  expect(html).not.toContain("Sort the bricks");
});

test("on a public page a figure's {{ }} operand never reads through a note the page may not show", async () => {
  const { store, publisher } = await setup();
  store.create("Sort the bricks [type::ticket] [project::secret-plan] [publish::public]");
  const parent = store.create("Private plans [project::secret-plan]");
  const note = store.create('Tickets [publish::public]\n\n::graph-table\n---\nquery: type=ticket project={{project}}\ncolumns: [title]\n---\n::', parent.id);
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=html`, { headers: { accept: "text/html" } }), "public");
  const html = await response.text();
  expect(html).not.toContain("Sort the bricks");
  expect(html).not.toContain("secret-plan");
});
