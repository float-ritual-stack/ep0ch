// PIE-534: blocks as records (`blocks.records`, outline-core's block-record.ts) and the header line the parser, titles
// and Detail's property table share. Fictional notes, a temp store.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordJson, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { OutlinerClient } from "../src/client";
import { firstLineWithoutPropertyTokens, parsePropertyRecords } from "../src/properties";
import { createPropertyInspectorModel, propertyInspectorAuthoredText } from "../src/property-inspector";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

const scope = (text: string) => parsePropertyRecords(text).map(r => `${r.key}:${r.scope}`);

test("` - ` between header chips: every chip is the block's, and the title leaves the separators out", () => {
  expect(scope("Seed order - [type::errand] - [area::garden]")).toEqual(["type:block", "area:block"]);
  expect(firstLineWithoutPropertyTokens("Seed order - [type::errand] - [area::garden]")?.trim()).toBe("Seed order");
  // Chips only, separated: no "-" title; the title comes from the next line, as for a chips-only line.
  expect(scope("[type::list] - [area::kitchen]\nTea and oats")).toEqual(["type:block", "area:block"]);
  expect(firstLineWithoutPropertyTokens("[type::list] - [area::kitchen]\nTea and oats")?.trim()).toBe("Tea and oats");
  // A hashtag among the chips keeps the run going, and stays in the title.
  expect(scope("Shed jobs [type::list] #bikes [area::shed]")).toEqual(["type:block", "tag:block", "area:block"]);
  expect(firstLineWithoutPropertyTokens("Shed jobs [type::list] #bikes [area::shed]")?.replace(/\s+/g, " ").trim()).toBe("Shed jobs #bikes");
  // Spaces, as before.
  expect(scope("Seed order [type::errand] [area::garden]")).toEqual(["type:block", "area:block"]);
  // Something after a chip makes it an aside, as before.
  expect(scope("Ask [who::Sam] about it")).toEqual(["who:inline"]);
});

test("Detail's property table marks the header line's chips, and only those", () => {
  const text = "Seed order [type::errand] - [area::garden]\nAsk [who::Sam] first.\n[due::Friday]";
  const model = createPropertyInspectorModel("b1", text);
  expect(model.entries.map(e => [e.key, e.scope, e.header])).toEqual([
    ["type", "block", true], ["area", "block", true], ["who", "inline", false], ["due", "inline", false],
  ]);
  // Detail's reading of the note: the chips and the ` - ` between them leave line 1, the aside stays.
  expect(propertyInspectorAuthoredText(text).split("\n").slice(0, 2)).toEqual(["Seed order", "Ask [who::Sam] first."]);
});

test("blocks.records: a block as one record, built by the service; missing and trashed ids said, not records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-block-records-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });

  const plot = store.create("Allotment plot [type::place]");
  const note = store.create([
    "Seed order for the plot [type::errand] [ctx::2026-03-09 @ 09:27:29 AM] [tag::seeds] [tag::spring]",
    `Broad beans for ((${plot.id}|the plot)), and \`[x::1]\` stays text.`,
    "when:: before Friday",
    "- [ ] order the beans",
    "- [x] measure the bed",
  ].join("\n"), plot.id, "agent", { actorId: "planner" });
  const child = store.create("Ask the neighbour about netting", note.id);
  const fan = store.create(`Garden list: ((${note.id}))`);
  const gone = store.create("Old note");
  store.delete(gone.id);

  const client = new OutlinerClient(socket);
  const read = await client.request<{ records: BlockRecord[]; unavailable: unknown[] }>({ action: "blocks.records", ids: [note.id, "nope", gone.id] });
  expect(read.unavailable).toEqual([{ id: "nope", status: "missing" }, { id: gone.id, status: "trashed" }]);
  const r = read.records[0]!;
  expect(r).toMatchObject({
    id: note.id, parent: plot.id, title: "Seed order for the plot", author: "agent", actor: "planner",
    header: [{ key: "type", value: "errand" }, { key: "ctx", value: "2026-03-09 @ 09:27:29 AM" }, { key: "tag", value: "seeds" }, { key: "tag", value: "spring" }],
    properties: [{ key: "type", values: ["errand"] }, { key: "ctx", values: ["2026-03-09 @ 09:27:29 AM"] }, { key: "tag", values: ["seeds", "spring"] }],
    fields: [{ key: "when", value: "before Friday", scope: "line", line: 2 }],
    children: [child.id],
    tasks: [{ status: "todo", text: "order the beans", line: 3, id: null }, { status: "done", text: "measure the bed", line: 4, id: null }],
    links: [{ kind: "block", target: plot.id, status: "ready", text: `((${plot.id}|the plot))` }],
    backlinks: [fan.id],
    resources: [],
  });
  expect(r.body.split("\n")[0]).toBe("Seed order for the plot");
  expect(r.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(r.truncated).toBeUndefined();
  // Deterministic: the same read, the same bytes; keys sorted.
  const again = await client.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [note.id] });
  expect(recordJson(again.records[0])).toBe(recordJson(r));
  expect(Object.keys(JSON.parse(recordJson(r)))).toEqual(Object.keys(r).sort());
  await expect(client.request({ action: "blocks.records", ids: [] })).rejects.toThrow(/1 through 200/);
});

test("blocks.records: a property naming a block's id is a link, so links and backlinks are each other's inverse", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-block-records-property-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });

  const survey = store.create("Hedge survey");
  const report = store.create(`Hedge report [source-block::${survey.id}] [reviewed-by::${survey.id}] [type::report]\nSee ((${survey.id})) too.`);
  const tally = store.create(`Bird tally [source-block::${survey.id}] [status::open]`);
  const client = new OutlinerClient(socket);
  const read = await client.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [survey.id, report.id, tally.id] });
  const [s, r, t] = read.records;
  // The text already links the survey: no second, property link for it.
  expect(r!.links.map(l => [l.kind, l.target])).toEqual([["block", survey.id]]);
  const chip = `[source-block::${survey.id}]`;
  expect(t!.links).toEqual([{ kind: "property", key: "source-block", text: chip, label: "source-block", target: survey.id, status: "ready", spans: [["Bird tally ".length, "Bird tally ".length + chip.length]], bodySpans: [] }]);
  // A value that isn't a block's id ([status::open]) isn't a link.
  expect(s!.backlinks).toEqual([report.id, tally.id].sort());
  for (const record of read.records) for (const link of record.links) expect(read.records.find(x => x.id === link.target)?.backlinks ?? [record.id]).toContain(record.id);
});

test("query.matches narrows by text and subtree as blocks.query does, keeping the order asked", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-query-matches-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const plot = store.create("Allotment plot [type::place]");
  const beans = store.create("Order the beans [type::errand]", plot.id);
  const compost = store.create("Turn the compost [type::errand]");
  const ids = [compost.id, beans.id, plot.id];
  expect(store.matchQuery("type=errand", ids).blockIds).toEqual([compost.id, beans.id]);
  expect(store.matchQuery(undefined, ids, { subtreeRootId: plot.id }).blockIds).toEqual([beans.id, plot.id]);
  expect(store.matchQuery("type=errand", ids, { text: "BEANS order" }).blockIds).toEqual([beans.id]);
  expect(() => store.matchQuery(undefined, ids)).toThrow(/needs a query expression/);
  expect(() => store.matchQuery(undefined, ids, { subtreeRootId: "nope" })).toThrow(/Block not found: nope/);
});
