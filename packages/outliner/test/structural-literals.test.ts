import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords, PROPERTY_PARSER_VERSION } from "../src/properties";
import { outlinerReferenceOccurrences } from "../src/reference-occurrences";
import { OutlinerStore } from "../src/store";

// PIE-690: a component's YAML and a fence inside a callout or quote are literal, like a top-level fence.

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function makeStore(): { store: OutlinerStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-structural-literals-"));
  const path = join(directory, "outliner.sqlite");
  const fixture = { store: new OutlinerStore(path), path };
  cleanups.push(() => { fixture.store.close(); rmSync(directory, { recursive: true, force: true }); });
  return fixture;
}

const keys = (text: string) => parsePropertyRecords(text).map(r => `${r.key}=${r.value}`);
const refs = (text: string) => outlinerReferenceOccurrences(text).map(r => (r.kind === "block" ? r.blockId : r.kind === "page" ? r.address : r.kind));

const STAT = [
  "Hub #open [status::live]",
  "",
  "::graph-stat",
  "---",
  "label: Requests",
  "query: tag=pie-request #pie-request [x::y]",
  "link: [[Hidden Page]] ((00000000-0000-4000-8000-000000000001))",
  "---",
  "::",
  "",
  "After #kept [[Visible Page]]",
].join("\n");

test("tags, properties and links inside component YAML are not indexed; text around it still is", () => {
  expect(keys(STAT)).toEqual(["tag=open", "status=live", "tag=kept"]);
  expect(refs(STAT)).toEqual(["Visible Page"]);
});

test("a fence inside a callout or a quote is literal", () => {
  const callout = [
    "Note #real",
    "> [!note] Skill",
    "> ```md",
    "> See [[YYYY-MM-DD]] and ((proposal)) #fake [k::v]",
    "> ```",
    "> after #inside",
    "",
    "> plain quote",
    "> ~~~",
    "> [[slug]] #fake2",
    "> ~~~",
  ].join("\n");
  expect(keys(callout)).toEqual(["tag=real", "tag=inside"]);
  expect(refs(callout)).toEqual([]);
});

test("an unclosed quoted fence ends with its quote and an unclosed component swallows nothing", () => {
  const quote = ["> ```", "> #fenced", "", "Then #free [[Page One]]"].join("\n");
  expect(keys(quote)).toEqual(["tag=free"]);
  expect(refs(quote)).toEqual(["Page One"]);
  const unclosed = ["::graph-stat", "---", "query: #notliteral", "", "## Next", "Body #after [[Page Two]]"].join("\n");
  expect(keys(unclosed)).toEqual(["tag=notliteral", "tag=after"]);
  expect(refs(unclosed)).toEqual(["Page Two"]);
});

test("re-indexing on open removes tags an older parser stored from component YAML", () => {
  const fixture = makeStore();
  const hub = fixture.store.create(STAT);
  fixture.store.database.exec(`
    INSERT INTO block_properties (block_id, key, value, ordinal, raw, start, end, line, column, placement, scope, syntax)
    VALUES ('${hub.id}', 'tag', 'pie-request', 9, '#pie-request', 0, 0, 5, 0, 'inline', 'inline', 'hashtag');
    UPDATE metadata SET value = '${PROPERTY_PARSER_VERSION - 1}' WHERE key = 'property_parser_version';
  `);
  const stale = () => (fixture.store.database.query("SELECT block_id FROM block_properties WHERE key = 'tag' AND value = 'pie-request'").all() as { block_id: string }[]).map(r => r.block_id);
  expect(stale()).toEqual([hub.id]);
  fixture.store.close();
  fixture.store = new OutlinerStore(fixture.path);
  expect(stale()).toEqual([]);
  expect(fixture.store.require(hub.id).text).toBe(STAT);
});
