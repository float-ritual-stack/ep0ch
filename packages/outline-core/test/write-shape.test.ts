import { expect, test } from "bun:test";
import { FIX_BEFORE_DONE, SHAPE_LIMITS, sentenceCount, shapeNext, shapeWarnings, writeShape } from "../src/write-shape";

const wall = "Seeds were sorted by hand on Tuesday. The borlotti came in two sizes. Nobody counted the small ones. The jars ran out before the lentils did. We reordered at noon.";

const tidy = [
  "Seed swap, Saturday [type::event]",
  "",
  "- [ ] **Which table does Evan want?** Pick one before the swap.",
  "",
  "> [!tip] Bring labels",
  "> Jars are provided.",
  "",
  "::graph-stat",
  "---",
  "title: sign-ups",
  "---",
  "- 14 | going",
  "::",
].join("\n");

test("a well-shaped note has no findings", () => {
  expect(writeShape(tidy)).toEqual([]);
  expect(shapeWarnings(tidy)).toEqual([]);
});

test("a title line of a paragraph and a wall of sentences each say what to fix", () => {
  const title = "Seed swap: " + "the whole story of how the jars were sorted and counted ".repeat(4).trim();
  const found = writeShape(`${title} [type::event]\n\n${wall}\n`);
  expect(found.map(f => f.rule)).toEqual(["title", "wall"]);
  expect(found[0]!.say).toContain(`under ${SHAPE_LIMITS.title}`);
  expect(found[1]!.say).toContain("line 3");
  const warnings = shapeWarnings(`${title}\n\n${wall}`);
  expect(warnings).toHaveLength(2);
  expect(warnings.every(w => w.startsWith(FIX_BEFORE_DONE))).toBe(true);
});

test("three sentences are a paragraph; code, links, numbers and abbreviations aren't sentence ends", () => {
  expect(sentenceCount("One. Two. Three.")).toBe(3);
  expect(sentenceCount("One. Two. Three. Four.")).toBe(4);
  expect(sentenceCount("See `a.b.c` and ((abc|the note)) at https://x.test/a. Version 3.5 shipped, e.g. today.")).toBe(2);
  expect(writeShape("Seeds\n\nOne. Two. Three.")).toEqual([]);
});

test("a long paragraph with few full stops is a wall too, and a callout's body counts", () => {
  const long = `Seeds ${"sorted by hand and counted twice and jarred ".repeat(14)}`;
  expect(writeShape(`Seeds\n\n${long}`).map(f => f.rule)).toEqual(["wall"]);
  expect(writeShape(`Seeds\n\n> [!note] Why\n> ${wall}`).map(f => f.rule)).toEqual(["wall"]);
});

test("lists, tables, headings and code are not paragraphs", () => {
  const text = ["Seeds", "", "## One. Two. Three. Four. Five.", "", "| a | b |", "| - | - |", "", "```", wall, "```", "", "- short", "- also short"].join("\n");
  expect(writeShape(text)).toEqual([]);
});

test("a long run of prose with no component is told to use one; a component in the note changes the count", () => {
  const prose = Array.from({ length: SHAPE_LIMITS.proseAlone }, (_, i) => `Line ${i} says a small thing`).join("\n");
  const found = writeShape(`Seeds\n\n${prose}`);
  expect(found.map(f => f.rule)).toEqual(["prose"]);
  expect(found[0]!.say).toContain("no figure, callout or view");
  expect(writeShape(`Seeds\n\n${prose}\n\n> [!tip] One\n> Two`)).toEqual([]);
});

test("a callout inside a callout is told to become a heading", () => {
  const found = writeShape("Seeds\n\n> [!note] Outer\n> Some words.\n> > [!warning] Inner\n> > More words.");
  expect(found.map(f => f.rule)).toEqual(["callout-nesting"]);
  expect(found[0]!.say).toContain("line 5");
  expect(writeShape("Seeds\n\n> [!note] One\n> words\n\n> [!warning] Two\n> words")).toEqual([]);
});

test("a question for Evan below the top needs [needs::sysop]; at the top, or marked, it is fine", () => {
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  const buried = `Notes\n\n${filler}\n\nShould we ask Evan which table to book?`;
  const found = writeShape(buried);
  expect(found.map(f => f.rule)).toEqual(["question"]);
  expect(found[0]!.say).toContain("[needs::sysop");
  expect(writeShape(`Notes [needs::sysop: table]\n\n${filler}\n\nShould we ask Evan which table to book?`)).toEqual([]);
  expect(writeShape(`Notes\n\n- [ ] Evan: which table?\n\n${filler}`)).toEqual([]);
  expect(writeShape(`Notes\n\n${filler}\n\nThe table was booked by Evan on Friday.`)).toEqual([]);
});

test("a comment is measured for walls alone", () => {
  const title = "x".repeat(200);
  expect(writeShape(`${title}\n\nShould Evan decide which?`, { kind: "comment" }).map(f => f.rule)).toEqual([]);
  expect(writeShape(wall, { kind: "comment" }).map(f => f.rule)).toEqual(["wall"]);
});

test("an edit is told what it added, not what the note already was", () => {
  const before = `Seed swap\n\n${wall}`;
  expect(shapeWarnings(`${before}\n\nA new line.`, before)).toEqual([]);
  expect(shapeWarnings(`${before}\n\n${wall.replace("Tuesday", "Wednesday")}`, before)).toHaveLength(1);
});

test("the next check names the note", () => {
  expect(shapeNext("abc")).toContain("ep0ch show abc");
});

// Codex review of PIE-1270: four ways the first version nagged on a note that was fine, or stayed quiet on one that wasn't.
test("titles of address aren't sentence ends, and a property's value is not prose", () => {
  expect(sentenceCount("Dr. Green met Mr. Brown. They spoke to Dr. White. All agreed.")).toBe(3);
  const url = `https://example.test/${"a".repeat(600)}`;
  expect(writeShape(`Notes [type::note]\n- [source::${url}]\n\nShort.`)).toEqual([]);
});

test("a completed statement about Evan below the top isn't a question; a word fixed inside a wall is the same wall; a second copy is new", () => {
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  expect(writeShape(`Notes\n\n${filler}\n\nEvan explained which table was booked.`)).toEqual([]);
  const before = `Seed swap\n\n${wall}`;
  expect(shapeWarnings(before.replace("Tuesday", "Wednesday"), before)).toEqual([]);
  expect(shapeWarnings(`${before}\n\n${wall}`, before)).toHaveLength(1);
});
