// Note components: a render script is a component, and `::board{where="type=errand"}` in any note is a second spelling of
// its `board::` line. It draws under its line with `this` the note it is written in, its [form-field::] defaults fill
// what the call leaves out, a required one left out is said, and Detail and the web page draw the region as a `board::`
// line's. Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { projectDetailRead } from "../src/detail-embeds";
import { Publisher } from "../src/publish";
import { componentCalls, mayHaveHandlerLines } from "../src/extension-handlers";
import { setup, until } from "./script-harness";

const BOARD = [
  "Errand board [script::board] [mode::render] [form-field::where query required] [form-field::group property default=status] [publish::public]",
  "Lanes of what a query holds, one row per note.",
  "",
  "::board{where=\"type=errand\" group=status}",
  "",
  "```js",
  "const rows = [];",
  "for (const b of (await q(props.where[0])).blocks) {",
  "  const note = await read(b.id, { depth: 0 });",
  "  rows.push([note.title, note.properties.find(p => p.key === props.group[0])?.values[0] ?? \"none\"]);",
  "}",
  "return view.table({ columns: [\"Note\", props.group[0]], rows: rows.sort() });",
  "```",
].join("\n");

test("::board{…} in another note draws the script's view under its line, the defaults filling what it leaves out", async () => {
  const { store, create, draw, client } = await setup();
  create(BOARD);
  const errands = create("Errands");
  create("Post the parcel [type::errand] [status::open] [owner::wren]", errands.id);
  create("Fix the gate [type::errand] [status::doing] [owner::ash]", errands.id);
  const daily = create("Thursday\n\n::board{where=\"type=errand\"}");
  await draw(daily.id);
  const row = await until("the call drawn", () => store.extensionOutputs(daily.id).find(r => r.result));
  const result = row.result as { markdown: string; view?: { type: string } };
  expect(result.view?.type).toBe("table");
  // `group` was left out: its default (status) is the column.
  expect(result.markdown).toContain("status");
  expect(result.markdown).toContain("Post the parcel");
  expect(result.markdown).toContain("doing");
  // It is listed among the components, from its note.
  const schemas = await client.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" });
  expect(schemas.schemas.find(s => s.id === "board")?.group).toBe("this outline's");
});

test("two notes calling the same component with parent:this each draw their own children", async () => {
  const { store, create, draw } = await setup();
  create(BOARD);
  const north = create("North bed\n::board{where=\"parent:this\" group=owner}");
  const south = create("South bed\n::board{where=\"parent:this\" group=owner}");
  create("Weed the leeks [owner::wren]", north.id);
  create("Water the beans [owner::ash]", south.id);
  for (const note of [north, south]) await draw(note.id);
  const drawn = async (id: string) => (await until(`${id} drawn`, () => store.extensionOutputs(id).find(r => r.result))).result as { markdown: string };
  const [n, s] = [await drawn(north.id), await drawn(south.id)];
  expect(n.markdown).toContain("Weed the leeks");
  expect(n.markdown).not.toContain("Water the beans");
  expect(s.markdown).toContain("Water the beans");
  expect(s.markdown).not.toContain("Weed the leeks");
});

test("a required prop left out is the call's problem, said where the drawing would be", async () => {
  const { store, create, client } = await setup();
  create(BOARD);
  const daily = create("Friday\n::board{group=owner}");
  await client.request({ action: "extensions.list", reload: true });
  const read = await client.request<{ projections: unknown[] }>({ action: "resources.projection.read", blockId: daily.id, materialize: true });
  expect(JSON.stringify(read.projections)).toContain("::board needs where");
  expect(store.extensionOutputs(daily.id).filter(r => r.result)).toEqual([]);
});

test("Detail and the published page draw a ::board{…} region as they draw a board:: line's", async () => {
  const { store, create, draw, client } = await setup();
  create(BOARD);
  create("Return the ladder [type::errand] [status::open] [publish::public]");
  const page = create("Shed page [publish::public:shed-page]\n\n::board{where=\"type=errand\"}");
  await draw(page.id);
  await until("the call drawn", () => store.extensionOutputs(page.id).find(r => r.result));
  const projected = await projectDetailRead(client, page.text, { hostBlockId: page.id, hostRevision: page.revision });
  expect(projected.resourceProjections?.length).toBe(1);
  expect(projected.resourceProjections![0]!.anchor.line).toBe(2);
  expect(JSON.stringify(projected.resourceProjections)).toContain("Return the ladder");
  const publisher = new Publisher({ client });
  await publisher.start();
  try {
    const html = await (await publisher.handle(new Request("http://127.0.0.1/p/shed-page?view=html", { headers: { accept: "text/html" } }))).text();
    expect(html).toContain("Return the ladder");
  } finally {
    await publisher.stop();
  }
});

test("a note holding only ::count{} draws in Detail; the readers' guard sees a call", async () => {
  const { store, create, draw, client } = await setup();
  create("Count [script::count] [mode::render]\n```js\nreturn 'COUNTED ' + this.title;\n```");
  const note = create("::count{}");
  expect(mayHaveHandlerLines(note.text)).toBe(true);
  expect(mayHaveHandlerLines("Just words\n::callout\nmore")).toBe(false);
  await draw(note.id);
  await until("the call drawn", () => store.extensionOutputs(note.id).find(r => r.result));
  const projected = await projectDetailRead(client, note.text, { hostBlockId: note.id, hostRevision: note.revision });
  expect(JSON.stringify(projected.resourceProjections)).toContain("COUNTED");
});

test("componentCalls: only a bound render script's name, never a built-in's, a fence's or ::use", () => {
  const render = { extension: { id: "script-1", script: { render: true, fields: ["group property default=status"], code: "", effects: "read", revision: 1, author: { author: "user" } } },
    handler: { key: "board", kind: "output", effects: "read" } };
  const plain = { extension: { id: "script-2", script: { code: "", effects: "read", revision: 1, author: { author: "user" } } }, handler: { key: "plain", kind: "output", effects: "read" } };
  const table = { handler: (key: string) => ({ board: render, plain, links: { ...render, handler: { ...render.handler, key: "links" } } } as Record<string, unknown>)[key] as never, handlerKeys: () => new Set(["board", "plain", "links"]) };
  const text = ["::board{where=\"type=errand\"}", "::plain{}", "::links{}", "```", "::board{}", "```", "::use{of=x}", "  ::board{group=owner} ^b1"].join("\n");
  const calls = componentCalls(text, table);
  expect(calls.map(c => [c.line, c.argument, c.indent])).toEqual([[0, "where=\"type=errand\" group=\"status\"", ""], [7, "group=\"owner\"", "  "]]);
  // The same props are the same call.
  expect(componentCalls("::board{group=status}", table)[0]!.callKey).toBe(componentCalls("::board{}", table)[0]!.callKey);
});
