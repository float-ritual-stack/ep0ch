// `notes.page` (ADR 0002): a note as parts a client draws, for one that can't run outline-core. A scratch service in a
// temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotePage, PagePart } from "@ep0ch/outline-core/note-page";
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

const part = <K extends PagePart["kind"]>(page: NotePage, kind: K, title?: string) =>
  page.parts.find((p): p is Extract<PagePart, { kind: K }> => p.kind === kind && (title === undefined || ("title" in p && p.title === title)))!;

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
    "The last word.",
  ].join("\n"));

  const p = await page(plan.id);
  expect(p).toMatchObject({ blockId: plan.id, revision: plan.revision, title: "Plan for Saturday", chips: [{ key: "type", value: "plan" }], text: plan.text });
  expect(p.properties).toContainEqual({ key: "type", value: "plan" });
  expect(p.author).toBe("user");
  expect(p.parts.map(x => x.kind)).toEqual(["prose", "rows", "prose", "figure", "view", "rows", "component", "prose"]);

  // Prose: references and page links as Markdown links, two written lines two lines, a callout's header a lead, code untouched.
  const prose = p.parts.filter(x => x.kind === "prose").map(x => x.markdown);
  expect(prose[0]).toBe(`Start at the [Shed](ep0ch:b/${shed.id}), then [the onions](ep0ch:b/${onions.id}) and the [Seed list](ep0ch:p/Seed%20list).  \nA second line.`);
  // A page link whose page exists is written to its note; the one above has no page yet and keeps its address.
  const list = await create("Seed list [page::Seed list]");
  expect((await page(plan.id)).parts[0]).toMatchObject({ markdown: expect.stringContaining(`[Seed list](ep0ch:b/${list.id})`) });
  expect(prose[1]).toMatch(/^> \*\*.+ Bring gloves\*\*  \n> The brambles are back\./);
  expect(prose[1]).toContain(`\`\`\`\n((${shed.id})) stays as written in code\n\`\`\``);
  expect(prose[2]).toBe("The last word.");

  // A `::links` query: the matches, each the note it opens.
  const plot = part(p, "rows", "On the plot");
  expect(plot).toMatchObject({ name: "links", query: "type=chore area=plot", status: "live · 2 matches" });
  expect(plot.groups.map(g => [g.name, g.rows.map(r => r.text).sort()])).toEqual([["Matches", ["Lift the onions", "Water the beans"]]]);
  expect(plot.groups[0]!.rows.find(r => r.text === "Lift the onions")!.id).toBe(onions.id);
  expect(plot.source).toBe("::links{query=\"type=chore area=plot\" title=\"On the plot\"}\n::");

  // A figure: the props it draws from, answered, and the same results as Markdown.
  const stat = part(p, "figure");
  expect(stat).toMatchObject({ name: "graph-stat", figure: "stat", title: "Chores" });
  expect((stat.props.items as { label: string; value: string }[]).map(i => [i.label, i.value])).toEqual([["to do", "1"], ["done", "1"]]);
  expect(stat.markdown).toContain("to do");

  // A query-backed table is a view: the view's own list.
  const table = part(p, "view");
  expect(table).toMatchObject({ name: "graph-table", title: "Every chore", query: "type=chore" });
  expect(table.view.rows.map(r => r.label).sort()).toEqual(["Lift the onions", "Water the beans"]);

  // A query the service can't read: its words, and the source to show.
  const bad = part(p, "rows", "Not chores");
  expect(bad.groups).toEqual([]);
  expect(bad.error).toMatch(/NOT/);

  // A component the service answers nothing for: as written.
  expect(part(p, "component")).toEqual({ kind: "component", name: "button", source: "::button{label=\"Sweep\" act=\"note.new\"}" });
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
  const { create, page } = await setup();
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
  const todo = (m: any) => (m.result.parts as PagePart[]).flatMap(part => part.kind === "rows" ? part.groups.flatMap(g => g.rows.map(r => r.text)) : []);

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
  expect(p.parts[1]).toEqual({ kind: "picture", source: "[img::beds.svg] [size::full] [height::9] [alt::Four beds]", path: "beds.svg", width: "full", height: 9, alt: "Four beds" });
  // A picture fence is the picture: its text, with no file to read.
  expect(p.parts[3]).toMatchObject({ kind: "picture", width: "fit", height: 6, svg: expect.stringContaining("<rect") });
  expect(p.parts[3]).not.toHaveProperty("path");
  // An artifact line isn't a picture: it stays in the prose as written.
  expect(p.parts[4]).toMatchObject({ kind: "prose", markdown: expect.stringContaining("[artifact::rota.html]") });
});
