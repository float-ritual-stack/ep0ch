// A half-written note parses safely (PIE-669): a construct left open mid-note (a fence, `[[`, `((`, `[key::`, a
// component, a literal region) keeps its damage to itself. Each prefix of each construct is written into a made-up
// note at every place a person could be typing, and what the service reads on every other line is checked against
// the note as it was: an inline construct costs only its own line, a fence only its own paragraph.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerStore } from "../src/store";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { blockReferenceOccurrences, pageAddressReferences } from "@ep0ch/outline-core/link-syntax";
import { protectedCodeRanges } from "@ep0ch/outline-core/code-ranges";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { calloutBlocks } from "@ep0ch/outline-core/callouts";
import { syntaxWarnings } from "@ep0ch/outline-core/syntax-warnings";
import { presentReaderHeadings } from "../src/document-presentation";
import { generatedDocument } from "../src/document-provenance";
import { renderMarkdownHtml } from "../src/publish";

const NOTE = [
  "Seed swap plan [status::draft] [owner::Ilse]",
  "",
  "We trade at the hall on [[Market Day]], see ((0f3c9a2e-1b7d-4c55-9e21-7a4b2c8d9e10)) for last year.",
  "- [ ] label the jars [due::2031-03-02]",
  "- [ ] ask [[Beds|the bed group]] about squash",
  "",
  "```ts",
  "const swap = \"[not::a property]\";",
  "",
  "const link = \"[[Not A Link]]\";",
  "```",
  "",
  "> [!note] Bring",
  "> envelopes, a pen, [[Seed Library]]",
  "",
  "::graph-stat",
  "---",
  "query: type=seed #tag",
  "---",
  "::",
  "",
  "After the figure [phase::two] #seeds and ((0f3c9a2e-1b7d-4c55-9e21-7a4b2c8d9e10|the list)).",
  "Last line #swap [[Closing]]",
].join("\n");

/** What the service reads on each line: properties, page links, references, which lines are code, components, callouts. */
function reading(text: string): string[][] {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) starts.push(at);
  const lineOf = (offset: number) => { let i = 0; while (i + 1 < starts.length && starts[i + 1]! <= offset) i++; return i; };
  const out = lines.map((): string[] => []);
  for (const p of parsePropertyRecords(text)) out[lineOf(p.start)]!.push(`prop ${p.key}=${p.value}`);
  for (const p of pageAddressReferences(text)) out[lineOf(p.start)]!.push(`page ${p.displayAddress}${p.label ? `|${p.label}` : ""}`);
  for (const r of blockReferenceOccurrences(text)) out[lineOf(r.start)]!.push(`ref ${r.blockId}${r.label ? `|${r.label}` : ""}`);
  for (const c of protectedCodeRanges(text)) for (let i = lineOf(c.start); i <= lineOf(Math.max(c.start, c.end - 1)); i++) if (c.end - c.start >= lines[i]!.length) out[i]!.push("code");
  for (const c of componentBlocks(lines)) for (let i = c.start; i <= c.end; i++) out[i]!.push(`component ${c.name}`);
  for (const c of calloutBlocks(lines)) out[c.line]!.push(`callout ${c.type}`);
  return out.map(row => [...new Set(row)].sort());
}

const BASE = reading(NOTE);
const LINES = NOTE.split("\n");
const CONSTRUCTS = {
  fence: ["```ts", "~~~"],
  inline: ["[[Seed tr", "((0f3c9a2e-1b7d", "[status::", "::graph-stat", "<!-- literal -->"],
};
const prefixes = (construct: string) => Array.from({ length: construct.length }, (_, n) => construct.slice(0, n + 1));

// Where a person could be typing: between lines outside the note's fence and its figure (typing in code is code).
const placesBetween = (() => {
  const inside = new Set<number>();
  BASE.forEach((row, i) => { if (row.includes("code") || row.some(r => r.startsWith("component"))) inside.add(i); });
  return Array.from({ length: LINES.length }, (_, k) => k + 1).filter(k => !inside.has(k) || !inside.has(k - 1));
})();

/** Baseline line `i`'s reading must be the same at `j` in `after`. */
function sameAt(after: string[][], i: number, j: number, context: string): void {
  expect({ context, line: LINES[i], read: after[j] }).toEqual({ context, line: LINES[i], read: BASE[i] });
}

test("an inline construct left open on a line of its own costs that line only, at every place and every prefix", () => {
  for (const construct of CONSTRUCTS.inline) for (const typed of prefixes(construct)) for (const k of placesBetween) {
    const text = [...LINES.slice(0, k), typed, ...LINES.slice(k)].join("\n");
    const after = reading(text);
    for (let i = 0; i < LINES.length; i++) sameAt(after, i, i < k ? i : i + 1, `${JSON.stringify(typed)} before line ${k + 1}`);
  }
});

test("an inline construct typed at a line's start or end leaves what the line already read, and every other line", () => {
  for (const construct of CONSTRUCTS.inline.filter(c => !c.startsWith("::") && !c.startsWith("<!--"))) for (const typed of prefixes(construct)) {
    for (let k = 0; k < LINES.length; k++) {
      if (BASE[k]!.includes("code") || BASE[k]!.some(r => r.startsWith("component"))) continue;
      for (const edited of [`${typed} ${LINES[k]}`, `${LINES[k]} ${typed}`]) {
        const after = reading([...LINES.slice(0, k), edited, ...LINES.slice(k + 1)].join("\n"));
        for (let i = 0; i < LINES.length; i++) {
          if (i !== k) sameAt(after, i, i, `${JSON.stringify(edited)} on line ${k + 1}`);
          // The line typed on keeps every link and property it had (typing at its start may make it a paragraph, not
          // a quote, and the half-typed token may read some of the line as its value: the damage is on its own line).
          else expect(after[k]).toEqual(expect.arrayContaining(BASE[k]!.filter(r => /^(prop|page|ref) /.test(r))));
        }
      }
    }
  }
});

test("a fence left open costs its own paragraph only: every line after the next blank line reads as before", () => {
  for (const construct of CONSTRUCTS.fence) for (const typed of prefixes(construct)) for (const k of placesBetween) {
    const lines = [...LINES.slice(0, k), typed, ...LINES.slice(k)];
    const after = reading(lines.join("\n"));
    const blank = lines.findIndex((line, at) => at > k && !line.trim());
    for (let i = 0; i < LINES.length; i++) {
      const j = i < k ? i : i + 1;
      // With no blank line after it, the rest of the note is its paragraph.
      if (j < k || (blank >= 0 && j > blank)) sameAt(after, i, j, `${JSON.stringify(typed)} before line ${k + 1}`);
    }
  }
});

test("each open construct is said, on its own line, with how to close it", () => {
  const text = [
    "Seed swap [status::draft]",
    "Ask [[Beds and [[Seed Library]] today",
    "[due:: friday [owner::Ilse]",
    "```ts",
    "const a = 1",
    "",
    "After [phase::two]",
    "::graph-stat",
    "## Next",
  ].join("\n");
  expect(syntaxWarnings(text).map(w => [w.kind, w.line, w.message])).toEqual([
    ["page-link", 1, "the [[Beds and on line 2 isn't closed with ]]: it's text"],
    ["property", 2, "the [due:: friday on line 3 isn't closed with ]: it's text, not a property"],
    ["fence", 3, "the ``` on line 4 isn't closed: lines 4–5 are code, up to the blank line after them; close it with ``` on a line of its own"],
    ["component", 7, "the ::graph-stat on line 8 isn't closed with :: on a line of its own: it's plain text"],
  ]);
  // And what follows each is read.
  const read = reading(text);
  expect(read[1]).toEqual(["page Seed Library"]);
  expect(read[2]).toEqual(["prop owner=Ilse"]);
  expect(read[6]).toEqual(["prop phase=two"]);
  expect(syntaxWarnings(NOTE)).toEqual([]);
});

test("Detail closes a fence left open at its paragraph, so its Markdown draws what follows as the note", () => {
  const presented = presentReaderHeadings(generatedDocument("Seed swap\n```ts\nconst a = 1\n\n## Bring\nenvelopes [[Seed Library]]", "test"));
  expect(presented.text.split("\n")).toEqual(["# Seed swap", "```ts", "const a = 1", "```", "", "## Bring", "envelopes [[Seed Library]]"]);
});

test("the published page draws a fence left open as code to its paragraph's end, and what follows as the note", () => {
  const html = renderMarkdownHtml("Seed swap\n\n```ts\nconst a = 1\n\nBring envelopes");
  expect(html).toContain("const a = 1");
  expect(html).toContain("<p>Bring envelopes</p>");
});

test("a new outline's own notes leave no construct open, so its first reader shows no ⚠", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-partial-safe-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  try {
    const all = (store as unknown as { database: { query(sql: string): { all(): { id: string; text: string }[] } } }).database
      .query("SELECT id, text FROM blocks WHERE effective_deleted_root_id IS NULL").all();
    expect(all.length).toBeGreaterThan(10);
    expect(all.flatMap(b => syntaxWarnings(b.text).map(w => `${b.text.split("\n")[0]}: ${w.message}`))).toEqual([]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
