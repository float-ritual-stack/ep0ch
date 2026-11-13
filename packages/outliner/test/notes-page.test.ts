// `notes.page` (ADR 0002): a note as parts a client draws, for one that can't run outline-core. A scratch service in a
// temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actOf } from "@ep0ch/outline-core/list-row";
import type { NotePage, PagePart, PagePrimitive } from "@ep0ch/outline-core/note-page";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-notes-page-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const page = (blockId: string) => client.request<NotePage>({ action: "notes.page", blockId });
  return { client, create, page, socket };
}

const part = (page: NotePage, kind: PagePart["kind"], title?: string) => page.parts.find(p => p.kind === kind && (title === undefined || p.title === title))!;
/** A part's view as the primitive type it is said to be. */
const view = <T extends PagePrimitive["type"]>(p: PagePart, type: T) => { expect(p.view.type).toBe(type); return p.view as Extract<PagePrimitive, { type: T }>; };
/** A part as it was written: its note's text at its span. */
const written = (page: NotePage, p: PagePart) => page.text.slice(p.span.start, p.span.end);

test("a page is the title, the chips and the body in order: prose as Markdown, each component with the service's answer", async () => {
  const { create, page } = await setup();
  const shed = await create("Shed [type::place]\nWhere the tools live.");
  const onions = await create("Lift the onions [type::chore] [area::plot] [state::todo]", shed.id);
  await create("Water the beans [type::chore] [area::plot] [state::done]", shed.id);
  const plan = await create([
    "Plan for Saturday [type::plan] #weekend",
    `Start at the ((${shed.id})), then ((${onions.id}|the onions)) and the [[Seed list]].`,
    "A second line.",
    "",
    "::links{query=\"type=chore area=plot\" title=\"On the plot\"}",
    "::",
    "",
    "> [!tip] Bring gloves",
    "> The brambles are back.",
    "",
    "```",
    `((${shed.id})) stays as written in code`,
    "```",
    "",
    "::graph-stat",
    "---",
    "title: Chores",
    "items: [{ label: to do, query: \"type=chore state=todo\" }, { label: done, query: \"type=chore state=done\" }]",
    "---",
    "::",
    "",
    "::graph-table",
    "---",
    "title: Every chore",
    "query: type=chore",
    "columns: [state]",
    "---",
    "::",
    "",
    "::links{query=\"type!=chore\" title=\"Not chores\"}",
    "::",
    "",
    "::button{label=\"Sweep\" act=\"note.new\"}",
    "",
    "::box{pad.x=1}",
    "Inside the box.",
    "::graph-meter",
    "---",
    "limit: 10",
    "---",
    "- beds: 4",
    "::",
    "::",
    "",
    "::trellis",
    "nobody answers this",
    "::",
    "",
    "The last word.",
  ].join("\n"));

  const p = await page(plan.id);
  expect(p).toMatchObject({ blockId: plan.id, revision: plan.revision, title: "Plan for Saturday", chips: [{ key: "type", value: "plan" }], text: plan.text });
  expect(p.properties).toContainEqual({ key: "type", value: "plan" });
  expect(p.author).toBe("user");
  expect(p.parts.map(x => x.kind)).toEqual(["prose", "links", "prose", "figure", "view", "links", "button", "box", "component", "prose"]);
  // Every part says where it is written: the note, its first line, and its place in the note's text.
  for (const x of p.parts) expect(x).toMatchObject({ type: "part", block: plan.id, line: p.text.slice(0, x.span.start).split("\n").length - 1 });

  // Prose: references and page links as Markdown links, two written lines two lines, a callout's header a lead, code untouched.
  const prose = p.parts.filter(x => x.kind === "prose").map(x => view(x, "markdown").text);
  expect(prose[0]).toBe(`Start at the [Shed](ep0ch:b/${shed.id}), then [the onions](ep0ch:b/${onions.id}) and the [Seed list](ep0ch:p/Seed%20list).  \nA second line.`);
  // A page link whose page exists is written to its note; the one above has no page yet and keeps its address.
  const list = await create("Seed list [page::Seed list]");
  expect((await page(plan.id)).parts[0]).toMatchObject({ view: { type: "markdown", text: expect.stringContaining(`[Seed list](ep0ch:b/${list.id})`) } });
  expect(prose[1]).toMatch(/^> \*\*.+ Bring gloves\*\*  \n> The brambles are back\./);
  expect(prose[1]).toContain(`\`\`\`\n((${shed.id})) stays as written in code\n\`\`\``);
  expect(prose[2]).toBe("The last word.");

  // A `::links` query: the matches, each the note it opens.
  const plot = part(p, "links", "On the plot"), list0 = view(plot, "list");
  expect(plot).toMatchObject({ name: "links", query: "type=chore area=plot", status: "live · 2 matches" });
  expect(list0.groups).toEqual([{ name: "Matches", label: "Matches", glyph: "≡", count: 2 }]);
  expect(list0.rows.map(r => [r.group, r.label]).sort()).toEqual([["Matches", "Lift the onions"], ["Matches", "Water the beans"]]);
  expect(list0.rows.find(r => r.label === "Lift the onions")!.do).toEqual({ open: onions.id });
  // Every row says the act line a pick runs, by the one rule (outline-core's actOf), and is keyed by the note it opens:
  // a client that parses no activation reads `act` and nothing else.
  expect(list0.rows.find(r => r.label === "Lift the onions")).toMatchObject({ id: onions.id, act: `open id="${onions.id}"` });
  expect(list0.rows.every(r => !r.do || r.act === actOf(r.do))).toBe(true);
  expect(written(p, plot)).toBe("::links{query=\"type=chore area=plot\" title=\"On the plot\"}\n::");

  // A figure: the primitives it draws as, from the props the outline answered.
  const stat = part(p, "figure");
  expect(stat).toMatchObject({ name: "graph-stat", figure: "stat", title: "Chores" });
  expect(view(stat, "row").children).toEqual([{ type: "stat", label: "to do", value: "1" }, { type: "stat", label: "done", value: "1" }]);

  // A query-backed table is a view: the view's own list.
  const table = part(p, "view");
  expect(table).toMatchObject({ name: "graph-table", title: "Every chore", query: "type=chore" });
  expect(view(table, "list").rows.map(r => r.label).sort()).toEqual(["Lift the onions", "Water the beans"]);

  // A query the service can't read: its words, and the source to show.
  const bad = part(p, "links", "Not chores");
  expect(view(bad, "list").rows).toEqual([]);
  expect(bad.error).toMatch(/NOT/);

  // A button: a labelled press, with the line a press names it by.
  const sweep = part(p, "button");
  expect(sweep).toMatchObject({ name: "button", line: p.text.split("\n").indexOf("::button{label=\"Sweep\" act=\"note.new\"}"), view: { type: "button", label: "Sweep", act: "note.new" } });
  expect(sweep).not.toHaveProperty("sequence");

  // A box: the parts written inside it, each with its own place.
  const box = view(part(p, "box"), "box");
  expect(box.children.map(c => c.type === "part" && [c.kind, c.view.type])).toEqual([["prose", "markdown"], ["figure", "stack"]]);
  expect(box.children[1]).toMatchObject({ figure: "meter", view: { children: [{ type: "bar", label: "beds", value: 4, max: 10 }] } });
  expect(written(p, box.children[0] as PagePart)).toBe("Inside the box.");

  // A component the service answers nothing for: as written.
  expect(part(p, "component")).toMatchObject({ name: "trellis", view: { type: "source", text: "::trellis\nnobody answers this\n::" } });
});

test("the service's word on a button: a look it doesn't read stops no press, a slot left empty is what it needs", async () => {
  const { create, page } = await setup();
  const note = await create([
    "Shed jobs [type::plan]",
    "::button{label=\"Fold\" act=\"dock.toggle side=right\" tone=sparkly}",
    "",
    "::button{label=\"Open a bed\" act=\"open id={bed}\" bed=}",
    "",
    "::button{label=\"Open another\" act=\"open id={bed}\" bed= tone=sparkly}",
  ].join("\n"));
  const [look, slot, both] = (await page(note.id)).parts;
  // The look is said and the button is still a press: the door runs it too (its `runPress` stops only a button that names nothing).
  expect(look).toMatchObject({ kind: "button", error: expect.stringContaining("tone=sparkly"), view: { type: "button", label: "Fold", act: "dock.toggle side=right" } });
  expect(look).not.toHaveProperty("needs");
  // An empty slot is what a press has nothing to fill: the part names it, and says what to write first.
  expect(slot).toMatchObject({ kind: "button", needs: ["bed"], error: "no bed yet: write bed= on its line", view: { type: "button", label: "Open a bed" } });
  expect(both).toMatchObject({ needs: ["bed"], error: expect.stringMatching(/^no bed yet: write bed= on its line · the button doesn't read tone=sparkly/) });
});

test("a note with no body has no parts; one in Trash is refused; the request needs its note", async () => {
  const { client, create, page } = await setup();
  const bare = await create("Just a title [type::stub]");
  expect(await page(bare.id)).toMatchObject({ title: "Just a title", parts: [] });
  await client.request({ action: "delete", blockId: bare.id });
  await expect(page(bare.id)).rejects.toThrow("in Trash");
  await expect(client.request({ action: "notes.page" } as never)).rejects.toThrow("notes.page needs blockId");
});

test("the page is whole: the notes above, under and linking to it, each as every list names a note", async () => {
  const { client, create, page } = await setup();
  const plot = await create("Plot [type::place]");
  const shed = await create("Shed [type::place]\n[room::north]", plot.id);
  const onions = await create("Lift the onions [type::chore]", shed.id);
  await create("Take the fork", onions.id);
  await create("Water the beans", shed.id);
  const plan = await create(`Plan [type::plan]\nStart at the ((${shed.id})).`);
  const p = await page(shed.id);
  expect(p.ancestors).toEqual([{ id: plot.id, title: "Plot", hasChildren: true }]);
  expect(p.children).toEqual([{ id: onions.id, title: "Lift the onions", hasChildren: true }, { id: expect.any(String), title: "Water the beans" }]);
  expect(p.backlinks).toEqual([{ id: plan.id, title: "Plan", context: "Top level" }]);
  // The notes under it are the one list too: a row says what it shows and the act line a pick runs. A note with none has no list.
  expect(p.under).toMatchObject({ type: "list", title: "Under this note · 2", rows: [{ id: onions.id, label: "Lift the onions", folds: true, act: `open id="${onions.id}"` }, { label: "Water the beans", act: expect.stringMatching(/^open id="/) }] });
  expect((await page(plan.id)).under).toBeUndefined();
  // A comment on the note is a block under it, and is not listed as a note of it: its threads list it.
  await client.request({ action: "annotations.batch", requestId: "c1", operations: [{ operationId: "1", type: "block-comment", input: { blockId: plan.id, expectedRevision: plan.revision, body: "Which shed?", source: "user" } }], author: "user" });
  const commented = await page(plan.id);
  expect([commented.children, commented.under]).toEqual([[], undefined]);
  expect((await client.request<{ list: { rows: { label: string }[] } }>({ action: "lists.read", from: "threads", of: plan.id })).list.rows.map(r => r.label)).toEqual(["Which shed?"]);
  // The body's properties too, as the service read them.
  expect(p.properties).toEqual([{ key: "type", value: "place" }, { key: "room", value: "north" }]);
});

test("a watched page is told when its answer changes, whatever changed it, and is asked again by generation", async () => {
  const { create, client, socket } = await setup();
  const shed = await create("Shed [type::place]");
  const onions = await create("Lift the onions [type::chore] [state::todo]", shed.id);
  const plan = await create("Plan [type::plan]\n\n::links{query=\"type=chore state=todo\" title=\"To do\"}\n::");

  // One connection, as a client keeps it: its asks answered by id, the service's events between them.
  const said: any[] = [];
  const line = connect(socket);
  cleanups.push(() => { line.destroy(); });
  let buffer = "";
  line.on("data", chunk => { buffer += chunk; for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) { said.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); } });
  const until = async <T>(find: () => T | undefined): Promise<T> => { for (let i = 0; i < 400; i++) { const found = find(); if (found !== undefined) return found; await Bun.sleep(10); } throw new Error("nothing came"); };
  const ask = async (id: string, more: Record<string, unknown> = {}) => { line.write(JSON.stringify({ id, action: "notes.page", blockId: plan.id, watch: "page", ...more }) + "\n"); return until(() => said.find(m => m.id === id)); };
  const todo = (m: any) => (m.result.parts as PagePart[]).flatMap(part => part.view.type === "list" ? part.view.rows.map(r => r.label) : []);

  const first = await ask("a");
  expect(first.result.generation).toBe(0);
  expect(todo(first)).toEqual(["Lift the onions"]);

  // A note the page only lists changes: no edit to the page's own note.
  await client.request({ action: "update", blockId: onions.id, text: "Lift the onions [type::chore] [state::done]", expectedRevision: onions.revision, mutation: { author: "user" } });
  const told = await until(() => said.find(m => m.event?.action === "queries.changed" && m.event.changes.some((c: any) => c.key === "page")));
  const generation = told.event.changes.find((c: any) => c.key === "page").generation;
  expect(generation).toBe(1);
  const second = await ask("b", { generation });
  expect(second.result.generation).toBe(1);
  expect(todo(second)).toEqual([]);

  // A change that leaves the page as it was says nothing.
  const quiet = said.length;
  await create("Unrelated");
  await Bun.sleep(700);
  expect(said.slice(quiet).filter(m => m.event?.action === "queries.changed")).toEqual([]);
}, 20_000);

test("blocks.read lists the notes under a note, or the top level, in order, as rows a tree shows", async () => {
  const { client, create } = await setup();
  const plot = await create("Plot [type::place]");
  const shed = await create("Shed [type::place]", plot.id);
  await create("Lift the onions", shed.id);
  await create("Beds", plot.id);
  const under = (parent: string | null) => client.request<{ blocks: { id: string; title?: string; hasChildren?: boolean }[] }>({ action: "blocks.read", under: parent, fields: ["title", "hasChildren"] });
  expect((await under(plot.id)).blocks.map(b => [b.title, b.hasChildren])).toEqual([["Shed", true], ["Beds", false]]);
  expect((await under(null)).blocks.map(b => b.title)).toContain("Plot");
  expect((await under(shed.id)).blocks.map(b => b.title)).toEqual(["Lift the onions"]);
});

test("pictures: a media line where it stands, an svg fence as its own text, and the header image as the page's hero", async () => {
  const { create, page } = await setup();
  const note = await create([
    "Plot plan [type::plan]",
    "[img::banner.png] [layout::hero] [fit::cover] [hero-focus::25%,50%] [dim::0.3] [alt::The beds in June]",
    "Before the picture.",
    "[img::beds.svg] [size::full] [height::9] [alt::Four beds]",
    "Between them.",
    "```svg height=6",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg>",
    "```",
    "[artifact::rota.html]",
    "After.",
  ].join("\n"));
  const p = await page(note.id);
  // The first `[layout::hero]` line is the header: above the title, so not among the parts.
  expect(p.hero).toEqual({ path: "banner.png", width: "fit", alt: "The beds in June", fit: "cover", focus: { x: 0.25, y: 0.5 }, dim: 0.3 });
  expect(p.parts.map(x => x.kind)).toEqual(["prose", "picture", "prose", "picture", "prose"]);
  expect(p.parts[1]!.view).toEqual({ type: "picture", path: "beds.svg", width: "full", height: 9, alt: "Four beds" });
  expect(written(p, p.parts[1]!)).toBe("[img::beds.svg] [size::full] [height::9] [alt::Four beds]");
  // A picture fence is the picture: its text, with no file to read.
  expect(p.parts[3]).toMatchObject({ kind: "picture", view: { type: "picture", width: "fit", height: 6, svg: expect.stringContaining("<rect") } });
  expect(p.parts[3]!.view).not.toHaveProperty("path");
  // An artifact line isn't a picture: it stays in the prose as written.
  expect(p.parts[4]).toMatchObject({ kind: "prose", view: { type: "markdown", text: expect.stringContaining("[artifact::rota.html]") } });
});
