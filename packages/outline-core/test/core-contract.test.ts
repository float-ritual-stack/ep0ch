// fixtures/core-contract.json: what this package's own rules answer, for a client that can't run it (the native
// window's cargo tests ask every row of its Rust copy of each rule). Made again here and compared, so the rules are the
// only place an answer is written (`bun scripts/core-contract.ts` writes it).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { actRequestOf, lineWords } from "../src/action-line";
import { CORE_CONTRACT, coreContract } from "../scripts/core-contract";

test("fixtures/core-contract.json is what the rules answer now", () => {
  expect(readFileSync(CORE_CONTRACT, "utf8"), "stale: bun packages/outline-core/scripts/core-contract.ts").toBe(coreContract());
});

test("a written line reads back as the request it was written from", () => {
  const { written } = JSON.parse(readFileSync(CORE_CONTRACT, "utf8")) as { written: { request: { action: string; args?: Record<string, unknown>; tile?: string }; line: string }[] };
  expect(written.length).toBeGreaterThan(8);
  for (const { request, line } of written) {
    const read = actRequestOf(lineWords(line));
    expect(read.action).toBe(request.action);
    expect(read.args).toEqual(Object.fromEntries(Object.entries(request.args ?? {}).map(([k, v]) => [k, String(v)])));
    expect(read.tile).toBe(request.tile);
  }
});

test("every table has rows, and the cases that matter are among them", () => {
  const t = JSON.parse(readFileSync(CORE_CONTRACT, "utf8")) as Record<string, { name?: string; rule?: number | null; groups?: unknown }[]> & { linkGroups: { all: string[] } };
  for (const name of ["written", "sections", "newNote", "targets", "terms", "links"]) expect(t[name]!.length, name).toBeGreaterThan(5);
  // A rule passed over, a rule that fits second, and none.
  expect(new Set(t.newNote!.map(r => r.rule))).toEqual(new Set([null, 0, 1]));
  expect(t.linkGroups.all).toEqual(["outlinks", "resources", "backlinks", "children"]);
  expect(t.links!.some(r => (r.groups as { bad?: string }).bad === "cousins")).toBe(true);
});

test("the quoted rows hold a passage found as written, one found as drawn, and each way one is refused", () => {
  const t = JSON.parse(readFileSync(CORE_CONTRACT, "utf8")) as { quotedNote: { text: string; parts: { span: { start: number; end: number }; view: { type: string; text: string } }[] }; quoted: { text?: string; passage: { drawn?: boolean; within?: unknown }; found?: { start: number; end: number; exact: string }; refused?: { kind: string } }[] };
  expect(t.quoted.length).toBeGreaterThan(8);
  expect(new Set(t.quoted.map(r => r.refused?.kind ?? "found"))).toEqual(new Set(["found", "ambiguous", "not-found"]));
  expect(t.quoted.some(r => r.passage.drawn && r.passage.within && r.found)).toBe(true);
  for (const row of t.quoted) if (row.found) expect((row.text ?? t.quotedNote.text).slice(row.found.start, row.found.end)).toBe(row.found.exact);
  // The note's parts are where its text has them, and its prose is drawn from that text.
  for (const part of t.quotedNote.parts) expect(t.quotedNote.text.slice(part.span.start, part.span.end).length).toBeGreaterThan(0);
  expect(t.quotedNote.parts.map(p => p.view.type)).toEqual(["markdown", "picture", "markdown", "picture", "markdown"]);
});

test("a found row says its passage as whole words, and the quoted note says where a thread's words are in a part's own text", () => {
  type Whole = { start: number; end: number; exact: string; quote: string; widened: boolean };
  const t = JSON.parse(readFileSync(CORE_CONTRACT, "utf8")) as {
    quotedNote: { text: string; thread: { id: string; start: number; end: number }; parts: { line: number; view: { text?: string } }[]; marked: { line: number; marks: { kind: string; id: string; start: number; end: number; act: string }[] }[] };
    quoted: { text?: string; passage: { quote: string }; found?: { start: number; end: number }; whole?: Whole }[];
  };
  const found = t.quoted.filter(row => row.found);
  for (const row of found) {
    const whole = row.whole!;
    expect((row.text ?? t.quotedNote.text).slice(whole.start, whole.end)).toBe(whole.exact);
    // Whole words hold what was found, and a passage that was whole is the asker's own words.
    expect(whole.start <= row.found!.start && whole.end >= row.found!.end).toBe(true);
    expect(whole.widened ? whole.quote !== row.passage.quote : whole.quote === row.passage.quote).toBe(true);
  }
  // One that starts inside a word, in a paragraph and in a list item, and ones that don't.
  expect(found.filter(row => row.whole!.widened).map(row => row.whole!.quote)).toEqual(["Sow the early peas in March", "Net the peas against pigeons. Stake the beans"]);
  expect(found.some(row => !row.whole!.widened)).toBe(true);
  // The thread's words, in the Markdown the part it is in is drawn from.
  const mark = t.quotedNote.marked[0]!.marks[0]!, part = t.quotedNote.parts.find(p => p.line === t.quotedNote.marked[0]!.line)!;
  expect([t.quotedNote.marked.length, mark.kind, mark.id, mark.act]).toEqual([1, "thread", t.quotedNote.thread.id, `thread.toggle thread="${t.quotedNote.thread.id}"`]);
  expect(part.view.text!.slice(mark.start, mark.end)).toBe("the last frost.\n\nWater the beds at dusk.");
  expect(t.quotedNote.text.slice(t.quotedNote.thread.start, t.quotedNote.thread.end)).toBe("the last frost.\n\nWater the beds at dusk.");
});

test("the indent rows hold a level in and out, tabs, a selection, and a press that moves nothing; each row's spans make its text", () => {
  const t = JSON.parse(readFileSync(CORE_CONTRACT, "utf8")) as { indent: { text: string; dir: number; anchor: number; cursor: number; spans: { start: number; end: number; replacement: string }[]; after: { text: string }; lines: number }[] };
  expect(t.indent.length).toBeGreaterThan(20);
  expect(new Set(t.indent.map(r => r.dir))).toEqual(new Set([1, -1]));
  expect(t.indent.some(r => r.lines === 0)).toBe(true);
  expect(t.indent.some(r => r.anchor !== r.cursor && r.lines > 2)).toBe(true);
  expect(t.indent.some(r => r.spans.some(s => s.replacement === "\t"))).toBe(true);
  for (const row of t.indent) {
    let text = row.text;
    for (const span of [...row.spans].reverse()) text = text.slice(0, span.start) + span.replacement + text.slice(span.end);
    expect(text).toBe(row.after.text);
    expect(row.spans.length).toBe(row.lines);
  }
});
