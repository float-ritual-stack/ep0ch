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
  expect(t.quotedNote.parts.map(p => p.view.type)).toEqual(["markdown", "picture", "markdown"]);
});
