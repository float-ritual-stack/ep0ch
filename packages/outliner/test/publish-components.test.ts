import { outputRegionText } from "@ep0ch/outline-core/output-region";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";
import { loadDetailReadPreview } from "../src/detail-read-preview";
import { renderDetailReadPreview } from "../src/detail-pi-preview";
import { stripTerminalSequences, type MarkdownTheme } from "@earendil-works/pi-tui";
import { pageReadingText } from "../../door/src/showcase/seed/page-reading";

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
  const client = new OutlinerClient(paths.socket);
  const publisher = new Publisher({ client });
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
  return { store, page, publisher, client };
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

test("one garden report renders the summary's bold and link", async () => {
  const { store, page } = await setup();
  const note = store.create(pageReadingText("garden-readings"));
  const html = await page(`/p/${note.id}`);
  expect(html.match(/class="callout-title">([\s\S]*?)<\/span>/)?.[1]).toContain('<strong>Window readings</strong>');
  expect(html).toContain('<a href="https://example.org/garden-plan">the garden plan</a>');
  expect(html).not.toContain('**Window readings**');
});

test("one garden report's view table shows only the five requested readings", async () => {
  const { store, page } = await setup();
  const view = store.create('Readings [page::garden-readings] [type::virtual-branch] [query::type=window-reading] [sort::title]');
  for (let i = 1; i <= 8; i++) store.create(`Window sample ${i} [type::window-reading] [merged-at::2026-03-04T03:47:00Z]`);
  for (const ref of [`((${view.id}))`, "garden-readings"]) {
    const note = store.create(pageReadingText(ref).replace("[page::garden-reading]", ""));
    const html = await page(`/p/${note.id}`);
    const table = html.match(/<figure[^>]*><figcaption>Five recent readings<\/figcaption>([\s\S]*?)<\/figure>/)![1]!;
    expect(table.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]!.match(/<tr>/g)).toHaveLength(5);
    expect(table).toContain("Window sample");
  }
});

test("a collection block draws its answer in published HTML and Detail", async () => {
  const { store, page, client } = await setup();
  store.create("Water beans [type::garden-chore] [area::beds] [owner::Mira]\n\nWater at dusk.");
  store.create("Wash pots [type::garden-chore] [area::shed] [owner::Sol]");
  const note = store.create(["Garden layouts", "", ...["table", "gallery", "feed", "board"].flatMap(layout => [
    `::view{query="type=garden-chore" layout=${layout} group=area summary-properties="title, owner"}`, "::", "",
  ]), '::graph-table{kind=garden-chore}', '---', 'query: type={{props.kind}}', 'columns: [title, owner]', '---', '::'].join("\n"));
  const html = await page(`/p/${note.id}`);
  expect(html).toContain('<table class="ext-table">');
  expect(html).toContain('class="ext-collection-grid"');
  expect(html).toContain('class="ext-collection-rows"');
  expect(html).toContain('class="ext-collection-lanes"');
  expect(html).toContain("Water at dusk.");
  expect(html).not.toContain("not drawn here");
  const document = await loadDetailReadPreview(client, note);
  const plain = (s: string) => s;
  const theme: MarkdownTheme = { heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain };
  const drawn = renderDetailReadPreview(document, 100, theme, undefined, true).lines.map(stripTerminalSequences).join("\n");
  expect(drawn).toContain("Water beans");
  expect(drawn).toContain("Mira");
  expect(drawn).toContain("Water at dusk.");
  expect(drawn).not.toContain("::view");
  expect(drawn).not.toContain("::graph-table");
  expect(drawn).not.toContain("⚠");
});

test("a box renders its note's values, bold and day links inside its frame", async () => {
  const { store, page, client } = await setup();
  store.create("Previous [page::garden-prev] [publish::public]");
  store.create("Next [page::garden-next] [publish::public]");
  const lines = "Kept by {{this.owner}}: **seed trays**.\n<< [[garden-prev]] | [[garden-next]] >>\n[[{{this.destination}}|Value-built destination]]\n> [!note] Seed care\n> Keep **seedlings** dry.";
  const note = store.create(`Box parity [owner::Ada] [destination::garden-next]\n\n${lines}\n\n::box{border=round pad.x=1}\n${lines}\n::box{pad.x=1}\nNested **bold**\n::\n::graph-stat\n---\ntitle: Box harvest\n---\n- beans: 7\n::\n::`);
  const html = await page(`/p/${note.id}`);
  expect(html.match(/<strong>seed trays<\/strong>/g)).toHaveLength(2);
  expect(html.match(/href="\/p\/garden-prev\?view=html"/g)).toHaveLength(2);
  expect(html.match(/href="\/p\/garden-next\?view=html"/g)).toHaveLength(4);
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<figcaption>Box harvest</figcaption>");
  expect(html).not.toContain("::box");
  expect(html).not.toContain("{{this.owner}}");
  const document = await loadDetailReadPreview(client, note);
  const plain = (s: string) => s;
  const theme: MarkdownTheme = { heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain };
  const reader = renderDetailReadPreview(document, 80, theme, undefined, true);
  const drawn = reader.lines.map(stripTerminalSequences).join("\n");
  expect(drawn).not.toContain("::box");
  expect(drawn.match(/Kept by Ada: seed trays\./g)).toHaveLength(2);
  expect(drawn.match(/Seed care/g)).toHaveLength(2);
  expect(drawn).not.toContain("[!note]");
  expect(reader.frame.cells.some(cell => cell.styles.includes("bold") && cell.text === "s")).toBe(true);
  const destinations = reader.frame.cells.filter(cell => cell.link?.uri.includes("garden-next"));
  expect(new Set(destinations.map(cell => cell.row)).size).toBe(4);
});

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
  expect(html.split("<article>")[1]!.split("</article>")[0]).not.toContain("::graph-decision");
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
    keys: "---\n- g then d: the desk\n- ctrl+k: the power bar",
    props: "---\n- **bed**: text — the bed it goes in\n- depth: a number · 2 — how deep, in cm",
    example: "prompt: ep0ch act\n---\n- `layout.move tile=tree where=edge-down` → lays the tree along the bottom",
  };
  for (const [kind, body] of Object.entries(sources)) {
    const note = store.create(`Figure ${kind}\n::graph-${kind}\n---\ntitle: The ${kind}\n${body}\n::`);
    const html = await page(`/p/${note.id}`);
    expect(html, kind).toContain(`<figure class="fig fig-${kind}">`);
    expect(html, kind).not.toContain("not drawn here yet");
    expect(html.split("<article>")[1]!.split("</article>")[0], kind).not.toContain(`::graph-${kind}`);
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
  expect(html.split("<article>")[1]!.split("</article>")[0]).not.toContain("::if");
  expect(html.split("<article>")[1]!.split("</article>")[0]).not.toContain("::fields");
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
  const note = store.create("Pick\n\n::graph-table{project=garden}\n---\ntitle: tickets for {{props.project}}\nquery: type=ticket project={{props.project}}\ncolumns: [title]\n---\n::");
  const html = await page(`/p/${note.id}`);
  expect(html).toContain("Water the beans");
  // Its title reads the same props (PIE-1362).
  expect(html).toContain("<figcaption>tickets for garden");
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

test("a button is its label on a page and runs nothing: ::button{…} and [label](act: …) never show the line they would run (PIE-957)", async () => {
  const { store, page } = await setup();
  const note = store.create('Beds\n::button{label="Review the beds" act="layout.load name=review"}\nOr in prose: [start over](act: ttt-reset) and done.\n```\n::button{label="In code" act="x"}\n```\n\n    [start over](act: ttt-reset) in an indented example');
  const html = await page(`/p/${note.id}`);
  expect(html).toContain("Review the beds");
  expect(html).not.toContain("layout.load");
  expect(html).not.toContain("::button{label=&quot;Review");
  expect(html).toContain("start over");
  expect(html.split("ttt-reset").length - 1).toBe(1);   // only the indented code example
  // A button written in a code fence is code, as every component is.
  expect(html).toContain("In code");
  // An indented code example keeps its link as written.
  expect(html).toContain("[start over](act: ttt-reset) in an indented example");
});

test("a button in a list item or a quote is its label on a page too, never its source line (PIE-1224)", async () => {
  const { store, page } = await setup();
  const note = store.create('Shelf\n- ::button{label="Tidy the shelf" act="layout.load name=tidy"}\n\n> ::button{label="Quoted press" act="theme.cycle"}');
  const html = await page(`/p/${note.id}`);
  expect(html).toContain("Tidy the shelf");
  expect(html).toContain("Quoted press");
  expect(html).not.toContain("layout.load");
  expect(html).not.toContain("theme.cycle");
});


test("published Sources exposes query, transform and downloadable visible rows", async () => {
  const { store, publisher } = await setup();
  const shown = store.create("Sow peas [crop::peas] [publish::public]");
  const hidden = store.create("PRIVATE_HARVEST [crop::peas]");
  const note = store.create('Garden [publish::public]\n\nBefore the table.\n\n::graph-table\n---\nquery: crop=peas\n---\n::\n\nAfter the table.');
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=html`, { headers: { accept: "text/html" } }), "public");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('class="sources-panel"');
  expect(html).toContain("Query");
  expect(html).toContain("Transform");
  expect(html).toContain("Result");
  expect(html).toContain('download="graph-table.csv"');
  expect(html).toContain('download="graph-table.json"');
  // On a phone (PIE-1409): the downloads sit right under the source's name, not inside its Result, each a 44 px tap target.
  const entry = /<details class="source-entry"[^>]*><summary>[\s\S]*?<\/summary>\s*<p class="source-downloads">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
  expect(entry).toContain('download="graph-table.csv"');
  expect(html).toMatch(/<details class="source-entry"[^>]* open><summary>/);
  expect(entry).toContain('download="graph-table.json"');
  expect(html).toMatch(/\.source-downloads a[^{]*\{[^}]*min-height:44px/);
  // A real URL, not a data: link a phone saves into a folder nobody sees (PIE-1383): the file, named, behind the note's own gate.
  expect(html).not.toContain('href="data:');
  // The source is named by its key in the note (the line it starts on) and its name, never its place in the list.
  const route = /href="([^"]+\/_sources\/[^"]+\.json)" download="graph-table.json"/.exec(html)?.[1];
  expect(route).toBe(`/share/p/${note.id}/_sources/4/graph-table.json`);
  const file = await publisher.handle(new Request(`http://127.0.0.1${route}`), "public");
  expect(file.status).toBe(200);
  expect(file.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(file.headers.get("content-disposition")).toBe('attachment; filename="graph-table.json"');
  expect(await file.json()).toEqual([{ id: shown.id, title: "Sow peas [crop::peas] [publish::public]" }]);
  const csv = await publisher.handle(new Request(`http://127.0.0.1/share/p/${note.id}/_sources/4/graph-table.csv`), "public");
  expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(await csv.text()).not.toContain("PRIVATE_HARVEST");
  expect(html).toContain(shown.id);
  expect(html).not.toContain(hidden.id);
  expect(html).not.toContain("PRIVATE_HARVEST");
  // Nothing past the panel's sources, and nothing of a note the public can't open.
  expect((await publisher.handle(new Request(`http://127.0.0.1/share/p/${note.id}/_sources/9/graph-table.json`), "public")).status).toBe(404);
  expect((await publisher.handle(new Request(`http://127.0.0.1/share/p/${note.id}/_sources/4/graph-other.json`), "public")).status).toBe(404);
  const closed = store.create("Kept close\n::graph-table\n---\nquery: crop=peas\n---\n::");
  expect((await publisher.handle(new Request(`http://127.0.0.1/share/p/${closed.id}/_sources/1/graph-table.json`), "public")).status).toBe(404);
  // Locked, it's gone from the owner's pages too.
  const locked = store.create("Locked [publish::never]\n::graph-table\n---\nquery: crop=peas\n---\n::");
  expect((await publisher.handle(new Request(`http://127.0.0.1/p/${locked.id}/_sources/1/graph-table.json`))).status).toBe(404);
  expect((await publisher.handle(new Request(`http://127.0.0.1/p/${closed.id}/_sources/1/graph-table.json`))).status).toBe(200);
});


test("published Sources withholds an unpublished output producer's id", async () => {
  const { store, publisher } = await setup();
  const producer = store.create("Private producer");
  const region = outputRegionText({ label: "Harvest", producer: producer.id, anchor: "out-harvest", body: "Public harvest" });
  const note = store.create(`Harvest report [publish::public]\n${region}`);
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=html`), "public");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Public harvest");
  expect(html).toContain("not shared");
  expect(html).not.toContain(producer.id);
});

test("published Sources omits outputs inside a false conditional, including downloads", async () => {
  const { store, publisher } = await setup();
  const region = (label: string, body: string) => outputRegionText({ label, anchor: `out-${label}`, body });
  const note = store.create(['Harvest [publish::public] [season::spring]',
    '::if{where="season=winter"}', region("Winter", "HIDDEN_HARVEST"), '::',
    '::if{where="season=spring"}', region("Spring", "VISIBLE_HARVEST"), '::'].join("\n"));
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${note.id}?view=html`), "public");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('download="Spring.json"');
  expect(html).not.toContain("HIDDEN_HARVEST");
  expect(html).not.toContain('download="Winter.');
});

test("a public collection never resolves an unpublished linked note's title", async () => {
  const { store, publisher } = await setup();
  const hidden = store.create("Secret notebook title [publish::never]");
  const visible = store.create("Open notebook [publish::public]");
  store.create(`Hidden review [type::flower-review] [publish::public] [note::${hidden.id}]`);
  store.create(`Open review [type::flower-review] [publish::public] [note::${visible.id}]`);
  const page = store.create('Reviews [publish::public]\n::graph-table{query="type=flower-review" columns="title, note"}\n::');
  const response = await publisher.handle(new Request(`http://127.0.0.1/p/${page.id}?view=html`), "public");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Open notebook");
  expect(html).not.toContain("Secret notebook title");
});

test.each(["automatic subtitle", "authored headers"])("graph-table keeps its %s", async (setting) => {
  const { store, page } = await setup();
  store.create("Aster [type::table-flower] [subtitle::Blooms in autumn]");
  const options = setting === "authored headers" ? '\ncolumns: [title, subtitle]\nheaders: [Flower, Season]' : "";
  const note = store.create(`Flower catalogue\n::graph-table\n---\nquery: type=table-flower${options}\n---\n::`);
  const html = (await page(`/p/${note.id}?view=html`)).match(/<figure[\s\S]*?<\/figure>/)![0];
  expect(html).toContain("Blooms in autumn");
  if (setting === "authored headers") {
    expect(html).toContain(">Flower</th>");
    expect(html).toContain(">Season</th>");
  }
});
