// Component schemas (PIE-618): `components.schemas` answers every component's properties in one read: outline-core's
// built-ins with the outline's own heading styles and callout types among their values, then the schemas extensions ship
// in `extension.json`. Scratch services in temp folders; every note and extension is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const MOOD: ComponentSchema = {
  id: "mood", title: "Mood", intro: "How a standup went, on its note.", where: "`[mood::…]` on a standup's note",
  props: [
    { key: "mood", where: "line", type: "enum", meaning: "how it went", values: [{ value: "calm", meaning: "nothing on fire" }, { value: "stormy", meaning: "something is" }] },
    { key: "mood-note", where: "line", type: "text", meaning: "a word on why", samples: ["the shelf fell"] },
  ],
  source: { use: "Standup [mood::{mood}]" }, example: { mood: "calm" }, sweep: ["mood"], grids: [], space: ["mood"],
};

async function setup(components: unknown[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-components-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlineFolder = join(root, "outline");
  const ext = join(outlineFolder, "extensions", "moods");
  mkdirSync(ext, { recursive: true });
  writeFileSync(join(ext, "extension.json"), JSON.stringify({ contract: 2, id: "moods", version: 1, name: "Moods", components }));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const client = new OutlinerClient(socket);
  await client.request({ action: "extensions.list", reload: true });
  return client;
}

type Answer = { schemas: ComponentSchema[]; problems: string[]; complete: boolean };

test("components.schemas: the built-ins, the outline's own style and type among their values, an extension's schema after", async () => {
  const client = await setup([MOOD]);
  const before = await client.request<Answer>({ action: "components.schemas" });
  expect(before.schemas.map(s => s.id)).toEqual([...BUILTIN_COMPONENT_SCHEMAS.map(s => s.id), "mood"]);
  expect(before.schemas.at(-1)).toMatchObject({ id: "mood", origin: "ext:moods", props: MOOD.props });
  const plot = await client.request<Block>({ action: "create", text: "Plot style [heading-style::plot] [heading-pattern::dots]" });
  const recipe = await client.request<Block>({ action: "create", text: "Recipe [callout-type::recipe] [callout-icon::♨] [callout-tone::green]" });
  await client.request<Block>({ action: "create", text: "Broken [heading-style::Not A Name]" });
  // A style declared on a line of a note (PIE-619) joins too, as headings.styles reads it.
  await client.request<Block>({ action: "create", text: "Bed notes\n\n# Bed style [heading-style::beds] [heading-pattern::waffle]" });
  const r = await client.request<Answer>({ action: "components.schemas" });
  const heading = r.schemas.find(s => s.id === "heading-style")!.props.find(p => p.key === "heading")!;
  expect(heading.values!.slice(-2).map(v => v.value)).toEqual(["plot", "beds"]);
  expect(heading.values!.at(-2)).toMatchObject({ value: "plot", declared: plot.id });
  expect(r.schemas.find(s => s.id === "callout")!.props[0]!.values!.at(-1)).toMatchObject({ value: "recipe", declared: recipe.id });
  expect(r.problems).toEqual([expect.stringContaining("isn't a name")]);
  expect(r.complete).toBe(true);
});

test("an extension.json whose component isn't a schema doesn't load, and says which field", async () => {
  const client = await setup([{ ...MOOD, sweep: ["weather"] }]);
  const list = await client.request<ExtensionsListResult>({ action: "extensions.list" });
  expect(list.extensions.find(e => e.id === "moods")).toMatchObject({ state: "failed", error: "extension.json: components/0: sweep is a list of its props' keys" });
  const r = await client.request<Answer>({ action: "components.schemas" });
  expect(r.schemas.map(s => s.id)).not.toContain("mood");
});

test("rules.preview: what a rule note, never saved, draws on a sample note's text, as the engine draws a block's", async () => {
  const client = await setup([MOOD]);
  type Preview = { decorations: { name: string; place: string; status: string; hit: { at: string; line: number }; view: { type: string; text?: string; label?: string }; markdown: string }[]; problems: string[] };
  const text = "Planning call [type::meeting]\n\n## Decisions\nShip the shelf !!today!!";
  const band = await client.request<Preview>({ action: "rules.preview", note: "Card [rule-name::card] [rule-kind::heading:2] [rule-decorate::band] [rule-tone::accent]", text });
  expect(band.decorations).toHaveLength(1);
  expect(band.decorations[0]).toMatchObject({ name: "card", place: "replace", status: "ready", hit: { at: "construct", line: 2 }, view: { type: "band", text: "Decisions", tone: "accent" } });
  const shout = await client.request<Preview>({ action: "rules.preview", note: "Shout [rule-name::shout] [rule-text::!!(.+)!!] [rule-decorate::badge]", text });
  expect(shout.decorations[0]).toMatchObject({ place: "above", hit: { at: "text", line: 3 }, view: { type: "badge", label: "today" } });
  const broken = await client.request<Preview>({ action: "rules.preview", note: "Nothing [rule-name::nothing] [rule-decorate::band]", text });
  expect(broken).toEqual({ decorations: [], problems: [expect.stringContaining("matches nothing")] });
  // Nothing is written: the outline has no rule notes.
  expect((await client.request<{ rules: unknown[] }>({ action: "extensions.list" })).rules).toEqual([]);
});
