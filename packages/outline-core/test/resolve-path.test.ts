import { expect, test } from "bun:test";
import { blockRecord, type BlockRecord } from "../src/block-record";
import { parsePath, resolvePath, noteValues } from "../src/resolve-path";
import { parsePropertyRecords } from "../src/property-parse";
import { scanPropertyLiteralRanges } from "../src/code-ranges";
import type { Site } from "../src/site";

// Fictional notes. The first is the design's fixture: a header, then (after the blank line, where front matter ends) inline values and a bare line.
const recordOf = (id: string, text: string, parentId: string | null = null): BlockRecord =>
  blockRecord({
    block: { id, parentId, text, revision: 1, author: "user", createdAt: "2026-10-16T09:00:00Z", updatedAt: "2026-10-16T09:00:00Z" },
    title: text.split("\n")[0]!.replace(/\s*\[[^\]]*\]/g, "").replace(/^# /, ""),
    properties: parsePropertyRecords(text), literal: scanPropertyLiteralRanges(text),
    children: [], tasks: [], links: [], backlinks: [], resources: [],
  });

const vent = recordOf("vent", [
  "# Vent rail demo [target::https://example.test/vent] [status::active] [owner::evan]",
  "",
  "Play it at {{this.target}}.",
  "- first pass [connectTo::demonstrating by doing]",
  "- second pass [connectTo::shacks not cathedrals]",
  "storyTime:: remember when",
  "and [storyTime::this and that]",
].join("\n"));
const site = (over: Partial<Site> = {}): Site => ({ at: { block: "vent" }, this: vent, props: {}, actor: { id: "tester", author: "user" }, ...over });
const values = (path: string, s = site(), scope = {}) => {
  const a = resolvePath(path, s, scope);
  return a.ok ? a.values : a.problem;
};

test("a path is a head, keys and indexes", () => {
  expect(parsePath("this.tasks[0].title")).toEqual({ head: "this", steps: [{ key: "tasks" }, { index: 0 }, { key: "title" }] });
  expect(parsePath("this.")).toBeNull();
  // Another note's id, page or Work ID is a head too; only the service reads it.
  expect(parsePath("((9db884d1)).query")).toEqual({ head: "((9db884d1))", steps: [{ key: "query" }] });
  expect(parsePath("PIE-533.title")).toEqual({ head: "PIE-533", steps: [{ key: "title" }] });
});

test("this.key: block scope first, then every occurrence in document order, each key a list", () => {
  expect(values("this.target")).toEqual(["https://example.test/vent"]);
  expect(values("this.connectTo")).toEqual(["demonstrating by doing", "shacks not cathedrals"]);
  expect(noteValues(vent, "storyTime")).toEqual(["remember when", "this and that"]);
  expect(values("this.storyTime[0]")).toEqual(["remember when"]);
  expect(values("this.storyTime.count")).toEqual(["2"]);
  expect(values("this.title")).toEqual(["Vent rail demo"]);
});

test("this.block.key is block scope alone; this.fields.key has the line each value was written on", () => {
  expect(values("this.block.storyTime")).toEqual([]);
  expect(values("this.block.status")).toEqual(["active"]);
  const a = resolvePath("this.fields.connectTo", site());
  expect(a).toMatchObject({ ok: true, values: ["demonstrating by doing", "shacks not cathedrals"], lines: [3, 4], from: "vent" });
});

test("a plain value's commas are one value; an explicit bracket list is several (#604)", () => {
  const note = recordOf("n", "Page [blocks::PIE-12, PIE-14] [tags::[a, b]]");
  expect(noteValues(note, "blocks")).toEqual(["PIE-12, PIE-14"]);
  expect(noteValues(note, "tags")).toEqual(["a", "b"]);
});

test("a missing key is a problem that names the nearest key, never an empty string", () => {
  expect(values("this.ownr")).toEqual({ message: "no `ownr` on this note; did you mean `owner`?", didYouMean: ["owner"], example: "{{this.owner}}" });
  expect(values("this.zzzzzz")).toEqual({ message: "no `zzzzzz` on this note", didYouMean: [] });
});

test("props are the call site's, apart from the note's own values", () => {
  const s = site({ props: { status: ["paused"] } });
  expect(values("props.status", s)).toEqual(["paused"]);
  expect(values("this.status", s)).toEqual(["active"]);
  expect(values("props.statuz", s)).toMatchObject({ didYouMean: ["status"] });
});

test("edges: a key with an empty list is there, a list keeps its repeats, a prop name is only the call site's", () => {
  const note = recordOf("n", "Page [tags::[]] [dup::[a, a, b]]");
  expect(values("this.tags.count", site({ this: note }))).toEqual(["0"]);
  expect(values("this.dup", site({ this: note }))).toEqual(["a", "a", "b"]);
  expect(values("dup", site({ this: note }))).toEqual(["a", "a", "b"]);
  expect(values("props.constructor")).toMatchObject({ message: expect.stringContaining("no prop") });
  // A near miss is suggested from the parents too.
  expect(values("ownr", site({ this: recordOf("c", "Bricks") }), { ancestors: [{ id: "p", text: "Lego [owner::sam]" }] })).toMatchObject({ didYouMean: ["owner"] });
});

test("parent.key reads the parent alone", () => {
  const parent = recordOf("p", "Lego night [project::lego-night]");
  const child = recordOf("c", "Bricks", "p");
  expect(values("parent.project", site({ this: child }), { parent })).toEqual(["lego-night"]);
  expect(values("parent.project", site({ this: child }))).toEqual({ message: "this note has no parent", didYouMean: [] });
});

test("a bare key walks the line, then the note, then each ancestor, nearest first", () => {
  const child = recordOf("c", "Bricks\nplan [project::duplo]");
  const ancestors = [{ id: "p", text: "Lego night [project::lego-night]" }];
  expect(values("project", site({ this: child }), { line: 1, ancestors })).toEqual(["duplo"]);
  expect(values("project", site({ this: recordOf("c", "Bricks") }), { line: 0, ancestors })).toEqual(["lego-night"]);
  expect(values("project", site({ this: recordOf("c", "Bricks") }), { line: 0 })).toMatchObject({ message: "no `project` here or in its parents" });
  // The bare key never reads props.
  expect(values("week", site({ props: { week: ["42"] } }))).toMatchObject({ message: expect.stringContaining("no `week`") });
});

test("a head that needs the service says so, and a run with no note says that", () => {
  expect(values("now.date")).toMatchObject({ message: expect.stringContaining("service") });
  expect(values("this.owner", site({ this: undefined }))).toMatchObject({ message: expect.stringContaining("no note") });
});

test("a quoted key is one step, with its dots; a filter's trailing steps are split off", async () => {
  const { splitTail } = await import("../src/resolve-path");
  expect(parsePath('this["echo.node"].x')).toEqual({ head: "this", steps: [{ key: "echo.node" }, { key: "x" }] });
  expect(parsePath("this['a b']")).toEqual({ head: "this", steps: [{ key: "a b" }] });
  expect(parsePath("this.$created")).toEqual({ head: "this", steps: [{ key: "$created" }] });
  expect(parsePath("now.date+7d")).toEqual({ head: "now", steps: [{ key: "date+7d" }] });
  expect(splitTail("status=todo .count")).toEqual({ filter: "status=todo", then: [{ key: "count" }] });
  expect(splitTail("status=todo")).toEqual({ filter: "status=todo" });
  expect(splitTail(".count")).toEqual({ then: [{ key: "count" }] });
  expect(splitTail('title~"a.b" .owner[0]')).toEqual({ filter: 'title~"a.b"', then: [{ key: "owner" }, { index: 0 }] });
});

test("without a world, the heads that need the service say so; the rest answer", () => {
  expect(resolvePath("((9db884d1)).query", site()).ok).toBe(false);
  const clock = resolvePath("now.date", site());
  expect(clock.ok).toBe(false);
  expect(!clock.ok && clock.problem.message).toContain("service's clock");
  // Everything the Site itself holds still reads: no lookup needed.
  const nested = { ...site(), caller: { block: "host", line: 4, mark: "::use" }, props: { week: ["42"] } };
  expect(resolvePath("caller.line", nested)).toMatchObject({ ok: true, values: ["4"], from: "host" });
  expect(resolvePath("props.week", nested)).toMatchObject({ ok: true, values: ["42"] });
});

// PIE-979: front matter, header chips and hashtags are block scope; ::fields lists them too, each with its line.
const sowing = recordOf("sow", [
  "## Early sowing notes [type::note] #garden",
  "- [ctx::2026-10-15 @ 10:19:21 PM] - [project::plot]",
  "- re:: whether to sow early",
  "- connectTo:: ['beans', 'frost']",
  "- tags:: ['neat']",
  "",
  "Sheltered with #spring and [inline::data] in the notebook.",
  "",
  "- key:: stuff",
  "",
  "anotherkey:: stuff",
].join("\n"));

test("this.fields.key lists front matter lines, list values one row each, header chips and hashtags, with their lines", () => {
  const s = site({ this: sowing, at: { block: "sow" } });
  const rows = (key: string) => { const a = resolvePath(`this.fields.${key}`, s); return a.ok ? { values: a.values, lines: a.lines } : a.problem; };
  expect(rows("re")).toEqual({ values: ["whether to sow early"], lines: [2] });
  expect(rows("connectTo")).toEqual({ values: ["beans", "frost"], lines: [3, 3] });
  expect(rows("tags")).toEqual({ values: ["neat"], lines: [4] });
  expect(rows("tag")).toEqual({ values: ["garden", "spring"], lines: [0, 6] });
  expect(rows("type")).toEqual({ values: ["note"], lines: [0] });
  expect(rows("project")).toEqual({ values: ["plot"], lines: [1] });
  expect(rows("key")).toEqual({ values: ["stuff"], lines: [8] });
  // this.key does not count a block-scope value twice
  expect(noteValues(sowing, "re")).toEqual(["whether to sow early"]);
});
