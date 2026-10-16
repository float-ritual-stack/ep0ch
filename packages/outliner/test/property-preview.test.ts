import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient, type RequestInput } from "../src/client";
import { PROPERTY_PARSER_VERSION } from "../src/properties";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { PropertyParsePreview, VisibleBlockCollection } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startService() {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-property-preview-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, client: new OutlinerClient(socket) };
}

const drafts = {
  trailing: "Card title [stage::queued]",
  typedAfterTrailing: "Card title [stage::queued] still typing",
  preamble: "Card title\n[type::note] [stage::doing]\n\nBody mentions [owner::sam] inline",
  lineScoped: "Card title\n\nSome prose\nfollow-up:: later",
  literal: "Card title `[stage::queued]`",
};

test("previews block properties and token placement with the save-time parser", async () => {
  const { client } = await startService();
  const preview = (text: string) => client.request<PropertyParsePreview>({ action: "properties.preview", text });

  const trailing = await preview(drafts.trailing);
  expect(trailing.parserVersion).toBe(PROPERTY_PARSER_VERSION);
  expect(trailing.properties).toEqual([{ key: "stage", value: "queued" }]);
  expect(trailing.tokens).toMatchObject([{
    key: "stage", value: "queued", raw: "[stage::queued]", ordinal: 0,
    line: 0, column: 11, start: 11, end: 26,
    placement: "trailing-metadata", scope: "block", syntax: "bracket",
  }]);

  // Prose in front matter does not end block scope.
  const typed = await preview(drafts.typedAfterTrailing);
  expect(typed.properties).toEqual([{ key: "stage", value: "queued" }]);
  expect(typed.tokens).toMatchObject([{ key: "stage", placement: "inline", scope: "block", line: 0 }]);

  const preamble = await preview(drafts.preamble);
  expect(preamble.properties).toEqual([{ key: "type", value: "note" }, { key: "stage", value: "doing" }]);
  expect(preamble.tokens.map(({ key, line, placement, scope }) => ({ key, line, placement, scope }))).toEqual([
    { key: "type", line: 1, placement: "metadata-line", scope: "block" },
    { key: "stage", line: 1, placement: "metadata-line", scope: "block" },
    { key: "owner", line: 3, placement: "inline", scope: "inline" },
  ]);

  const lineScoped = await preview(drafts.lineScoped);
  expect(lineScoped.properties).toEqual([]);
  expect(lineScoped.tokens).toMatchObject([{ key: "follow-up", value: "later", syntax: "bare", scope: "line", line: 3 }]);

  expect(await preview(drafts.literal)).toEqual({ parserVersion: PROPERTY_PARSER_VERSION, properties: [], tokens: [] });
});

test("preview agrees with what a save indexes and changes nothing", async () => {
  const { store, client } = await startService();
  const existing = store.create("Existing card [stage::queued]");
  const readIds = async () => (await client.request<VisibleBlockCollection>({
    action: "blocks.query", query: { limit: 1000 },
  })).blocks.map((block) => block.id);
  const idsBefore = await readIds();
  const sequenceBefore = store.sequence;

  const previews: PropertyParsePreview[] = [];
  for (const text of Object.values(drafts)) {
    previews.push(await client.request<PropertyParsePreview>({ action: "properties.preview", text }));
  }
  expect(store.sequence).toBe(sequenceBefore);
  expect(await readIds()).toEqual(idsBefore);
  expect(store.require(existing.id).revision).toBe(existing.revision);

  // Saving the same drafts indexes exactly the previewed block properties.
  for (const [index, text] of Object.values(drafts).entries()) {
    expect(store.create(text).properties).toEqual(previews[index]!.properties);
  }
});

test("rejects a preview without text", async () => {
  const { client } = await startService();
  await expect(
    client.request({ action: "properties.preview" } as unknown as RequestInput),
  ).rejects.toThrow("properties.preview requires text");
});

test("front matter keeps raw garden notes and finds every explicit list value", async () => {
  const { client } = await startService();
  const text = "## Early sowing\n- [ctx::evening] - [project::garden]\nA thought about seedlings\n- connectTo:: ['beans', 'frost']\n- tags:: [neat, spring]\n- description:: cool, dry\n\nBody with [inline::data]\n- key:: stuff";
  const saved = await client.request<{ id: string; text: string }>({ action: "create", text });
  expect(saved.text).toBe(text);
  const preview = await client.request<PropertyParsePreview>({ action: "properties.preview", text });
  expect(preview.tokens.find(p => p.key === "connectto")?.scope).toBe("block");
  expect(preview.tokens.find(p => p.key === "inline")?.scope).toBe("inline");
  expect(preview.tokens.find(p => p.key === "key")?.scope).toBe("line");
  const query = (where: string, extra = {}) => client.request<VisibleBlockCollection & { groups?: { value: string | null; ids: string[] }[] }>({ action: "blocks.query", query: { where, ...extra } });
  for (const where of ["connectTo=beans", "connectto=frost", "tag=neat", "tags=spring", 'description="cool, dry"']) {
    expect((await query(where)).blocks.map(b => b.id)).toContain(saved.id);
  }
  expect((await query("description=cool")).blocks).toHaveLength(0);
  expect((await query("#neat")).blocks.map(b => b.id)).toContain(saved.id);
  const view = await client.request<{ id: string }>({ action: "create", text: "Sowing list [type::virtual-branch] [query::project=garden]" });
  expect((await query("connectto=beans", { rankViewId: view.id })).blocks.map(b => b.id)).toContain(saved.id);
  const grouped = await query("project=garden", { group: "connectTo" });
  expect(grouped.groups).toEqual([{ value: "beans", count: 1, ids: [saved.id] }, { value: "frost", count: 1, ids: [saved.id] }]);
  const repeated = await client.request<{ id: string }>({ action: "create", text: "Later sowing [project::garden] [connectto::zucchini] [connectto::asparagus] [tag::neat]" });
  expect((await query("project=garden", { sort: "connectto" })).blocks.map(b => b.id)).toEqual([saved.id, repeated.id]);
  expect((await query("connectto=asparagus")).blocks.map(b => b.id)).toEqual([repeated.id]);
  expect((await query("tag=neat")).blocks.map(b => b.id)).toContain(repeated.id);
  const tagged = await client.request<{ id: string }>({ action: "create", text: "A #spring plan [ctx::evening] #epic\r\n\r\nKeep the poles dry." });
  const records = await client.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [saved.id, tagged.id] });
  expect(records.records[0]!.properties.find(p => p.key === "connectto")?.values).toEqual(["beans", "frost"]);
  expect(records.records[1]!.title).toBe("A #spring plan");
  expect(records.records[1]!.text).toContain("#epic");
  const quoted = await client.request<{ id: string }>({ action: "create", text: 'Tray labels [labels::["a]b", "c"]]' });
  expect((await query("labels=c")).blocks.map(b => b.id)).toContain(quoted.id);
  const firstTag = await client.request<{ id: string }>({ action: "create", text: "Apricot bed [project::garden] [tags::[apricot, summer]]" });
  expect((await query("project=garden", { sort: "tag" })).blocks.map(b => b.id)).toEqual([firstTag.id, saved.id, repeated.id]);



});
