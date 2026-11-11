// `notes.page` (ADR 0002): a note as parts a client draws, for one that can't run outline-core. A scratch service in a
// temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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
  return { client, create, page };
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
  expect(p.parts.map(x => x.kind)).toEqual(["prose", "rows", "prose", "figure", "view", "rows", "component", "prose"]);

  // Prose: references and page links as Markdown links, two written lines two lines, a callout's header a lead, code untouched.
  const prose = p.parts.filter(x => x.kind === "prose").map(x => x.markdown);
  expect(prose[0]).toBe(`Start at the [Shed](ep0ch:b/${shed.id}), then [the onions](ep0ch:b/${onions.id}) and the [Seed list](ep0ch:p/Seed%20list).  \nA second line.`);
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
