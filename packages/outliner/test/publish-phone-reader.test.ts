// PIE-1590: a published page reads whole on the phone. The markup the door draws is markup on the web too, wherever a
// line's address (publish-anchors.ts) lands beside it, and a wide table stays in the page's width. Scratch service in a
// temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher, renderMarkdownHtml } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-publish-phone-")));
  const workspace = join(root, "garden");
  mkdirSync(workspace);
  const paths = scratchOutline(root, { folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const publisher = new Publisher({ client: new OutlinerClient(paths.socket) });
  await publisher.start();
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const page = async (id: string) => (await publisher.handle(new Request(`http://127.0.0.1/p/${id}?view=html`, { headers: { accept: "text/html" } }))).text();
  return { store, page };
}

/** The article's own markup, with the anchors (which hold no text) out of the way. */
const article = (html: string) => (/<article\b[\s\S]*<\/article>/.exec(html)?.[0] ?? html).replace(/<span class="(?:line-anchor|bk)"[^>]*><\/span>/g, "");

test("a link and bold in a callout, and bold that opens or ends a list item, are drawn, not left as source", async () => {
  const { store, page } = await setup();
  const yesterday = store.create("Yesterday's shed log [page::shed-log-yesterday] [publish::true]");
  const note = store.create([
    "Shed log [publish::true]",
    "",
    "> [!summary] The roof went on at nine. Yesterday's log: [[shed-log-yesterday]].",
    "",
    "> [!note] Shed count",
    "> See [the count](/pub/p/shed-count) for it.",
    "> **Bold ending the line:**",
    "> - **Whole item in bold:**",
    "> - [the plan](https://shed.example/plan)",
    "",
    "- **9:14 AM, roof on, batch 191:** the ladder came back",
    "- **9:30 AM, gutters on:**",
    "- **Gutters**",
    "- *Slanted, closed by a colon:*",
    "- ~~Struck, closed by a colon:~~",
    "- `the ladder`",
    "1. **Numbered, in bold:**",
    "- [x] **Ticked, in bold:**",
    "",
    "**Bold paragraph, ending in a colon:**",
    "",
    "Ends in a link to [the plan](https://shed.example/plan)",
  ].join("\n"));
  const html = article(await page(note.id));
  expect(yesterday.id).toBeTruthy();
  expect(html).not.toContain("**");
  expect(html).not.toMatch(/\]\(\//);
  expect(html).toMatch(/<a href="[^"]*shed-log-yesterday[^"]*">/);
  expect(html).toContain('<a href="/pub/p/shed-count">the count</a>');
  expect(html).toContain('<a href="https://shed.example/plan">the plan</a>');
  for (const bold of ["Bold ending the line:", "Whole item in bold:", "9:14 AM, roof on, batch 191:", "9:30 AM, gutters on:", "Gutters", "Numbered, in bold:", "Ticked, in bold:", "Bold paragraph, ending in a colon:"]) {
    expect(html).toContain(`<strong>${bold}</strong>`);
  }
  expect(html).toContain("<em>Slanted, closed by a colon:</em>");
  expect(html).toContain("<del>Struck, closed by a colon:</del>");
  expect(html).toContain("<code>the ladder</code>");
});

test("a sentinel beside a delimiter never decides whether emphasis opens or closes", () => {
  // Private-use characters, as an anchor or a mark rides through the renderer: after a closer, before one, before an opener.
  expect(renderMarkdownHtml("**Roof on:**\uE300")).toContain("<strong>Roof on:</strong>");
  expect(renderMarkdownHtml("**Roof on\uE300**")).toContain("<strong>Roof on\uE300</strong>");
  expect(renderMarkdownHtml("\uE300**Roof on:** then")).toContain("<strong>Roof on:</strong> then");
});

test("a table in a callout stays a table, and a wide one scrolls inside the page's width", async () => {
  const { store, page } = await setup();
  const note = store.create([
    "Shed parts [publish::true]",
    "",
    "> [!tip] Parts",
    ">",
    "> | part | where | built | missing |",
    "> |---|---|---|---|",
    "> | rain barrel | by the gutter | barrel, tap | an overflow |",
  ].join("\n"));
  const raw = await page(note.id);
  const html = article(raw);
  expect(html).toContain("<th>missing");
  expect(html).toContain("<td>rain barrel</td>");
  expect(html).not.toContain("|---");
  expect(raw).toMatch(/table\{[^}]*display:block;max-width:100%;overflow-x:auto/);
});
