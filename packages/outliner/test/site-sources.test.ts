// Scripts in their Site (PIE-956, S6b): `site.sources` lists every generated region of a note
// with what it read and when, its query, what shaped it and its result: handler lines, `::=`, `::use`, figures, `::fields`,
// `::if` and written output regions, from the one set of readers the page itself is drawn from.
// Scratch services in temp folders; every note and name is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { outputRegionText } from "@ep0ch/outline-core/output-region";
import type { SourcesAnswer } from "@ep0ch/outline-core/sources";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-script-site-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: join(root, "outline") });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80, ruleQuietMs: 20 });
  await server.start();
  const client = new OutlinerClient(socket, 15_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parent: string | null = null) => store.create(text, parent, "user");
  const extensionOf = async (name: string) => (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find(e => e.name === name)!;
  /** Runs a script by name, as a person would, with the note it is about and its slots. */
  const run = async (name: string, options: { blockId?: string; args?: Record<string, string>; line?: number } = {}) => {
    const extension = await extensionOf(name);
    const started = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", ...options });
    const note = () => store.get(started.written[0]!)!.text;
    await until(`${name} to finish`, () => !note().split("\n")[0]!.includes("· working"));
    return { text: note(), undo: started.undo, extension };
  };
  const output = (blockId: string) => store.extensionOutputs(blockId).map(row => (row.result as { markdown?: string } | null)?.markdown ?? row.error);
  return { store, client, create, extensionOf, run, output };
}


test("a note's generated regions are listed with their query, transform, result and when each read", async () => {
  const { create, client, output } = await setup();
  const script = create(`Beds table [script::beds-table] [mode::render]\n\`\`\`js\nreturn view.table({ columns: ["Owner", "Week"], rows: [[(await resolve("this.owner")).values[0], props.week[0]]] });\n\`\`\``);
  const template = create("Meeting template [type::template] [form-field::who text]\nWho: {{props.who}}");
  create("A task [crop::beans]");
  const region = outputRegionText({ label: "rota", producer: script.id, anchor: "out-rota-1", body: "- Mon: sam" });
  const text = ["Plot [owner::sam]", "", "Sowing [crop::peas]", "", "beds-table:: week=42", "::= (await resolve('this.owner')).values[0]", `::use{of=((${template.id})) who=Kit}`,
    "::fields{key=crop}", "::if{where=\"owner=sam\"}", "inside", "::", "::graph-table", "---", "query: crop=beans", "limit: 5", "---", "::", region].join("\n");
  const note = create(text);
  await client.request({ action: "resources.projection.read", blockId: note.id, materialize: true });
  await until("both lines", () => output(note.id).length >= 2);
  const a = await client.request<SourcesAnswer>({ action: "site.sources", blockId: note.id });
  expect(a.sources.map(s => [s.kind, s.name])).toEqual([["handler", "beds-table"], ["expr", "::="], ["use", `::use ((${template.id}))`], ["fields", "::fields crop"], ["if", "::if"], ["figure", "graph-table"], ["output", "rota"]]);
  const by = (kind: string) => a.sources.find(s => s.kind === kind)!;
  // handler: its slots as fields, its script as the transform (with a jump), its table as rows, when it ran.
  expect(by("handler").query).toMatchObject({ params: [{ key: "week", value: "42" }], text: "beds-table:: week=42", editable: true });
  expect(by("handler").transform).toMatchObject({ kind: "script", block: script.id });
  expect(by("handler").result).toMatchObject({ rows: 1, columns: ["Owner", "Week"], table: [["sam", "42"]] });
  expect(Date.parse(by("handler").readAt!)).toBeGreaterThan(0);
  expect(by("use").query.params).toEqual([{ key: "who", value: "Kit" }]);
  expect(by("use").transform).toMatchObject({ kind: "template", block: template.id });
  expect(by("use").result.text).toContain("Who: Kit");          // the result is what it drew, with the call's props in
  expect(by("fields").result.table?.[0]?.[0]).toBe("peas");
  expect(by("if").result.text).toContain("holds");
  expect(by("figure").query.params).toEqual(expect.arrayContaining([{ key: "query", value: "crop=beans" }]));
  expect(by("figure").transform.kind).toBe("figure");
  expect(by("figure").result.rows).toBeGreaterThanOrEqual(1);
  expect(by("output").transform).toMatchObject({ kind: "script", block: script.id });
  expect(by("output").key).toBe("#out-rota-1");
  // Reading writes nothing.
  expect((await client.request<SourcesAnswer>({ action: "site.sources", blockId: note.id })).revision).toBe(a.revision);
});
