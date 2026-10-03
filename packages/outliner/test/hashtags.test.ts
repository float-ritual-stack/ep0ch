import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  firstLineWithoutPropertyTokens,
  parseProperties,
  parsePropertyRecords,
  patchPropertyText,
  stripProperties,
} from "../src/properties";
import { createPropertyInspectorModel, propertyInspectorAuthoredText } from "../src/property-inspector";
import { OutlinerStore } from "../src/store";

const fixtures: Array<{ store: OutlinerStore; directory: string }> = [];

function makeStore(): OutlinerStore {
  const directory = mkdtempSync(join(tmpdir(), "outliner-hashtags-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  fixtures.push({ store, directory });
  return store;
}

afterEach(() => {
  for (const { store, directory } of fixtures.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hashtags share tag properties without taking the scope of neighboring prose", () => {
  const text = "Title [type::note] #Rabbit-Hole\n\nBelongs to #y2026/q1, discussed #café and #2026/q1. [status::historical]";
  expect(parseProperties(text)).toEqual([
    { key: "type", value: "note" },
    { key: "tag", value: "Rabbit-Hole" },
    { key: "tag", value: "y2026/q1" },
    { key: "tag", value: "café" },
    { key: "tag", value: "2026/q1" },
  ]);
  expect(parsePropertyRecords(text).at(-1)).toMatchObject({ key: "status", scope: "inline" });
});

test("hashtags ignore code, escapes, headings, link destinations, and property values", () => {
  const text = [
    "# Heading and ## another heading",
    "PR #134 and word#fragment; https://example.test/#remote and www.example.test/#url",
    "[fragment](#heading) [nested](https://example.test/a(b)#fragment) [[Page#section]] ((block-id|#label))",
    "[ref]: #reference-fragment",
    "[value::#inside-property]",
    "ctx:: keep #inside-bare-value",
    "`#inline-code` and ``#multi",
    "line-code``",
    "~~~text",
    "#fenced",
    "~~~",
    String.raw`\#escaped \\#even-escape \\\#escaped-again`,
    "Keep (#real-tag), #another/tag.",
  ].join("\n");
  expect(parsePropertyRecords(text).filter(record => record.key === "tag").map(record => record.value))
    .toEqual(["even-escape", "real-tag", "another/tag"]);
});

test("hashtags retain UTF-16 CRLF source positions for inspector edits", () => {
  const text = "😀 #Café\r\n\r\nRead (#y2026/q1).";
  const records = parsePropertyRecords(text);
  expect(records).toEqual([
    expect.objectContaining({ key: "tag", value: "Café", start: 3, end: 8, line: 0, column: 3, ordinal: 0, syntax: "hashtag", scope: "block" }),
    expect.objectContaining({ key: "tag", value: "y2026/q1", start: text.indexOf("#y2026"), end: text.indexOf("#y2026") + 9, line: 2, column: 6, ordinal: 1, syntax: "hashtag", scope: "block" }),
  ]);
  for (const record of records) expect(text.slice(record.start, record.end)).toBe(record.raw);
  expect(createPropertyInspectorModel("note-id", text).entries.map(entry => entry.raw))
    .toEqual(["#Café", "#y2026/q1"]);
});

test("tags in nested fences and indented code stay literal while nested list prose is indexed", () => {
  const text = [
    "Title",
    "",
    "    #indented-code",
    "    still #code",
    "",
    "- Parent",
    "  - #nested-list-prose",
    "    ~~~text",
    "    #nested-fence",
    "    ~~~",
    "    Continued #list-prose",
    "",
    "Outside #ordinary-prose",
  ].join("\n");
  expect(parseProperties(text)).toEqual([
    { key: "tag", value: "nested-list-prose" },
    { key: "tag", value: "list-prose" },
    { key: "tag", value: "ordinary-prose" },
  ]);
});

test("inspector patches preserve hashtag spelling or fall back to an explicit property", () => {
  const text = "Title\n\nKeep (#rabbit-hole), #y2026/q1.";
  const replaced = patchPropertyText(text, [{ op: "replace", ordinal: 0, value: "Rabbit-Hole/Ideas" }]);
  expect(replaced).toBe("Title\n\nKeep (#Rabbit-Hole/Ideas), #y2026/q1.");
  expect(patchPropertyText(replaced, [{ op: "remove", ordinal: 1 }])).toBe("Title\n\nKeep (#Rabbit-Hole/Ideas), .");
  const spaced = patchPropertyText(text, [{ op: "replace", ordinal: 0, value: "two words" }]);
  expect(spaced).toBe("Title\n[tag::two words]\n\nKeep (), #y2026/q1.");
  expect(parseProperties(spaced)).toContainEqual({ key: "tag", value: "two words" });
  const renamed = patchPropertyText(text, [{ op: "replace", ordinal: 0, key: "topic", value: "navigation" }]);
  expect(renamed).toBe("Title\n[topic::navigation]\n\nKeep (), #y2026/q1.");
  expect(parseProperties(renamed)).toContainEqual({ key: "topic", value: "navigation" });
  const appended = patchPropertyText(replaced, [{ op: "append", key: "tag", value: "navigation" }]);
  expect(appended).toContain("[tag::navigation]");
  expect(parseProperties(appended).filter(record => record.key === "tag").map(record => record.value))
    .toEqual(["navigation", "Rabbit-Hole/Ideas", "y2026/q1"]);
});

test("a hashtag-only body line cannot redirect an appended property out of the preamble", () => {
  const text = "Title\n\nBody paragraph\n#rabbit-hole\nMore discussion";
  const patched = patchPropertyText(text, [{ op: "append", key: "type", value: "note" }]);
  expect(patched).toBe("Title\n[type::note]\n\nBody paragraph\n#rabbit-hole\nMore discussion");
  expect(parseProperties(patched)).toEqual([
    { key: "type", value: "note" },
    { key: "tag", value: "rabbit-hole" },
  ]);
});

test("authored hashtags remain readable while structural metadata is hidden", () => {
  const text = "A #rabbit-hole [type::note]\n[tag::navigation]\n\nRemember #y2026/q1.";
  expect(propertyInspectorAuthoredText(text)).toBe("A #rabbit-hole\n\nRemember #y2026/q1.");
  expect(firstLineWithoutPropertyTokens(text)?.trim()).toBe("A #rabbit-hole");
  expect(stripProperties("#rabbit-hole [type::note]")).toBe("#rabbit-hole");
  const store = makeStore();
  const block = store.create(text);
  expect(store.readTreeIndex().blocks.find(entry => entry.id === block.id)?.preview).toBe("A #rabbit-hole");
});

test("an imported quarter tag is queryable independently of storage dates and uses exact matching", () => {
  const store = makeStore();
  const imported = store.create("Old journal\n\nWritten during #y2020/q1.");
  const bracketed = store.create("Quarter reference [tag::y2020/q1]");
  const nested = store.create("Week details #y2020/q1/week2");
  expect(imported.createdAt.startsWith("2020-")).toBe(false);
  expect(store.queryBlocks({ filters: [{ key: "tag", value: "Y2020/Q1" }], limit: 20 }).blocks.map(block => block.id))
    .toEqual([imported.id, bracketed.id]);
  expect(store.queryBlocks({ filters: [{ key: "tag", value: "y2020" }], limit: 20 }).blocks).toEqual([]);
  expect(store.queryBlocks({ filters: [{ key: "tag", value: "y2020/q1/week2" }], limit: 20 }).blocks.map(block => block.id))
    .toEqual([nested.id]);

  const edited = store.patchProperties(imported.id, imported.revision, [{ op: "replace", ordinal: 0, value: "y2020/q2" }]);
  expect(edited.text).toContain("#y2020/q2");
  expect(edited.createdAt).toBe(imported.createdAt);
  expect(store.queryBlocks({ filters: [{ key: "tag", value: "y2020/q2" }], limit: 20 }).blocks.map(block => block.id))
    .toEqual([imported.id]);
});

