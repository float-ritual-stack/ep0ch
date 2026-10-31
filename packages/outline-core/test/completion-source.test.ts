// The one merge every completion list is made with (PIE-1340): sources' rows ranked together by the search matcher,
// picks first among equals, a source's own order kept, one row per insert. Made-up rows.
import { expect, test } from "bun:test";
import { frecency, mergeSourceAnswers, pickKey, recordPick, sourceAnswers, triggerOf, type SourceAnswer } from "../src/completion-source";
import { searchMatchSpans } from "../src/search-match";
import { completionTargetAtCursor, hashtagAtCursor, referenceTargetAtCursor } from "../src/completion-triggers";

const src = (id: string, more: Partial<SourceAnswer["source"]> = {}) => ({ id, title: id, by: "test", ...more });
const labels = (rows: { label: string }[]) => rows.map(r => r.label);

test("rows from two sources interleave by how well they match, not by which source answered", () => {
  const pages: SourceAnswer = { source: src("pages", { priority: 10 }), rows: [{ label: "Old seed packets", insert: "[[packets]]" }, { label: "Compost heap", insert: "[[compost]]" }] };
  const issues: SourceAnswer = { source: src("issues"), rows: [{ label: "Seed swap sheet", insert: "#15" }, { label: "Turn the compost", insert: "#16" }] };
  // The issue's title starts with the word and the page's only holds it: the issue first, though the page's source is asked first.
  expect(labels(mergeSourceAnswers([pages, issues], "seed"))).toEqual(["Seed swap sheet", "Old seed packets"]);
  expect(labels(mergeSourceAnswers([pages, issues], "compost"))).toEqual(["Compost heap", "Turn the compost"]);
});

test("a ranked source keeps its order; an equal match goes to the higher priority; a fallback comes last", () => {
  const ranked: SourceAnswer = { source: src("blocks", { ranked: true, priority: 10 }), rows: [
    { label: "Plum log", insert: "((b))" }, { label: "Plum tree", insert: "((a))" }, { label: "new page · plum", insert: "[[plum]]", fallback: true },
  ] };
  const other: SourceAnswer = { source: src("ext"), rows: [{ label: "Plum jam", insert: "#2" }] };
  expect(labels(mergeSourceAnswers([other, ranked], "plum"))).toEqual(["Plum log", "Plum tree", "Plum jam", "new page · plum"]);
});

test("a row's priority wins an equal match before the limit, except in a ranked source", () => {
  for (const ranked of [false, true]) {
    const answer: SourceAnswer = { source: src("seeds", { ranked }), rows: [
      { label: "Seed", insert: "ordinary", priority: 1 },
      { label: "Seed", insert: "preferred", priority: 20 },
    ] };
    expect(mergeSourceAnswers([answer], "seed", { limit: 1 }).map(row => row.insert)).toEqual([ranked ? "ordinary" : "preferred"]);
  }
});

test("in a ranked source an incidental row never sinks the strong ones after it, and a pick rises among equals", () => {
  const blocks: SourceAnswer = { source: src("blocks", { ranked: true, priority: 10 }), rows: [
    { label: "Seed swap", insert: "((a))" }, { label: "  ^p1  # Prices", insert: "((a^p1))", filter: "Seed swap", under: true },
    { label: "Seed library", insert: "((b))" }, { label: "Seed list", insert: "((c))" },
  ] };
  const ext: SourceAnswer = { source: src("ext"), rows: [{ label: "Old seed packets", insert: "#9" }] };
  expect(labels(mergeSourceAnswers([blocks, ext], "seed"))).toEqual(["Seed swap", "  ^p1  # Prices", "Seed library", "Seed list", "Old seed packets"]);
  const now = new Date("2026-10-26T12:00:00Z");
  const picks = recordPick({}, "((", "((c))", now)["(("];
  expect(labels(mergeSourceAnswers([blocks], "seed", { picks, now })).slice(0, 3)).toEqual(["Seed list", "Seed swap", "  ^p1  # Prices"]);
  // The anchor moves with its note.
  const swap = recordPick({}, "((", "((a))", now)["(("];
  expect(labels(mergeSourceAnswers([blocks], "seed", { picks: swap, now })).slice(0, 2)).toEqual(["Seed swap", "  ^p1  # Prices"]);
});

test("picked more often and more lately comes first among equals, a preselected row before everything", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const a: SourceAnswer = { source: src("a"), rows: [{ label: "alpha", insert: "a" }, { label: "beta", insert: "b" }, { label: "gamma", insert: "g", preselect: true }] };
  let picks = recordPick({}, "key::x", "b", now);
  expect(labels(mergeSourceAnswers([a], "", { picks: picks["key::x"], now }))).toEqual(["gamma", "beta", "alpha"]);
  picks = recordPick(picks, "key::x", "a", now); picks = recordPick(picks, "key::x", "a", now);
  expect(picks["key::x"]!.a!.n).toBe(2);
  expect(labels(mergeSourceAnswers([a], "", { picks: picks["key::x"], now }))).toEqual(["gamma", "alpha", "beta"]);
  // Two weeks halve a pick.
  expect(frecency({ n: 4, at: "2026-10-12T12:00:00Z" }, now)).toBeCloseTo(2);
});

test("an insert two sources both answer is kept once, the better-ranked one", () => {
  const one: SourceAnswer = { source: src("one"), rows: [{ label: "garden", insert: "[[garden]]" }] };
  const two: SourceAnswer = { source: src("two"), rows: [{ label: "Garden (page)", insert: "[[garden]]" }] };
  expect(mergeSourceAnswers([one, two], "gard")).toHaveLength(1);
});

test("a source answers its triggers, and a value only for its keys; picks are kept per trigger and key", () => {
  expect(sourceAnswers({ triggers: ["[["] }, { trigger: "[[" })).toBe(true);
  expect(sourceAnswers({ triggers: ["key::"], keys: ["issue"] }, { trigger: "key::", key: "status" })).toBe(false);
  expect(sourceAnswers({ triggers: ["key::"], keys: ["issue"] }, { trigger: "key::", key: "Issue" })).toBe(true);
  expect(triggerOf("filter-key")).toBe("filter-key");
  expect(triggerOf("fence-setting")).toBeNull();
  expect(pickKey({ trigger: "key::", kind: "value", key: "issue" })).toBe("key::issue");
  expect(pickKey({ trigger: "[[", kind: "page" })).toBe("[[");
});

test("the matched letters the lists light are the matcher's: a word where it sits, else its letters in order", () => {
  expect(searchMatchSpans("Seed swap sheet", "swap")).toEqual([5, 6, 7, 8]);
  expect(searchMatchSpans("Greenhouse", "gh")).toEqual([0, 5]);
  expect(searchMatchSpans("Greenhouse", "")).toEqual([]);
});

test("one detector: a reference keeps a title's own parentheses, and a hashtag is never inside a reference", () => {
  expect(completionTargetAtCursor("((Rough edges (x)))", 6)).toMatchObject({ kind: "block", end: 19 });
  expect(referenceTargetAtCursor("> [!no", 6)).toBeNull();
  expect(completionTargetAtCursor("> [!no", 6)).toMatchObject({ kind: "callout" });
  expect(hashtagAtCursor("see #gard", 9)).toMatchObject({ query: "gard" });
  expect(hashtagAtCursor("((note#gard", 11)).toBeNull();
});

test("a handler line (`name:: slot=value`) is an attribute trigger like a component call's (PIE-1472)", async () => {
  const { completionTargetAtCursor } = await import("../src/completion-triggers");
  const line = 'lens:: query="type=meeting AND un';
  expect(completionTargetAtCursor(line, line.length)).toMatchObject({ kind: "attribute-value", component: "lens", key: "query", query: "type=meeting AND un", quote: '"' });
  expect(completionTargetAtCursor("lens:: ", 7)).toMatchObject({ kind: "attribute", component: "lens", query: "" });
  expect(completionTargetAtCursor("- lens:: col", 12)).toMatchObject({ kind: "attribute", component: "lens", query: "col" });
  expect(completionTargetAtCursor('lens:: query="x" colu', 21)).toMatchObject({ kind: "attribute", query: "colu", attrs: [{ key: "query", value: "x" }] });
  // A closed quote is finished; a property or prose line is no handler line.
  expect(completionTargetAtCursor('lens:: query="x"', 16)).toBeNull();
  expect(completionTargetAtCursor("Notes about lens:: foo", 22)).toBeNull();
  // A property chip inside a handler line (or a bare `key:: value` line) is the property's to complete.
  for (const line of ["img:: /tmp/flower.jpg [size::4", "status:: done [owner::a", "lens:: query=\"x\" [mood::"]) {
    expect(completionTargetAtCursor(line, line.length)).toMatchObject({ kind: "value" });
  }
  expect(completionTargetAtCursor("img:: /tmp/flower.jpg [si", 25)).toMatchObject({ kind: "key" });
});
