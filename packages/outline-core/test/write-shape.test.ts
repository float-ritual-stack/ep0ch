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

// PIE-1388: a bullet carrying several points is a wall too, a count a query keeps true is a figure, a bare id is a link,
// and a note past a screen has headings. Each comes with the fix made, where code can make it exactly.
test("a list item stacking several points is told, and its patch makes one item a point", () => {
  const note = ["Swap day", "", "- **Tables:** two went up at nine. The third had a wobbly leg; we swapped it. Nothing was lost.", "- one short point"].join("\n");
  const [stacked] = writeShape(note);
  expect(stacked).toMatchObject({ rule: "stacked", line: 3 });
  expect(stacked!.say).toContain("4 points in one item");
  expect(stacked!.patch![0]!.replacement).toBe(["- **Tables:**", "  - two went up at nine.", "  - The third had a wobbly leg; we swapped it.", "  - Nothing was lost."].join("\n"));
  expect(writeShape(stacked!.patch!.reduce((t, p) => t.replace(p.observed, p.replacement), note))).toEqual([]);
  expect(writeShape("Swap day\n\n- one point, with a clause, and another clause.\n- Two sentences. Still fine.")).toEqual([]);
});

test("a patch keeps the passage's properties where they were", () => {
  const note = "Shed\n\n- The roof is on [status::blocked] and leaking. The felt ran out. We stopped at six.";
  const [found] = writeShape(note);
  expect(found!.patch![0]!.replacement).toBe("- The roof is on [status::blocked] and leaking.\n- The felt ran out.\n- We stopped at six.");
});

test("a wall paragraph's patch is a list of its sentences", () => {
  const [found] = writeShape(`Seeds\n\n${wall}`);
  expect(found!.patch![0]!.replacement.split("\n")).toHaveLength(5);
  expect(found!.patch![0]!.replacement).toStartWith("- Seeds were sorted by hand on Tuesday.\n- The borlotti");
});

test("a number before a value the outline holds is a count for a live figure; other numbers aren't", () => {
  const facets = [{ key: "stage", value: "queued" }, { key: "type", value: "seed-packet" }];
  const note = "Shed\n\n14 queued and 3 seed packets left, version 2.5 out, PR 912 merged, 3 sentences long, on 2026-10-29.";
  const found = writeShape(note, { facets });
  expect(found.map(f => f.rule)).toEqual(["count"]);
  expect(found[0]!.say).toContain(`"14 queued" is stage=queued, "3 seed packets" is type=seed-packet`);
  // No ready patch: only the writer knows whether the count means the live one.
  expect(found[0]!.patch).toBeUndefined();
  expect(found[0]!.say).toContain(`::graph-stat with items: [{ label: "queued", query: "stage=queued" }`);
  expect(writeShape(note)).toEqual([]);
});

test("a bare id is told to be a reference; one in a reference, a property or code is fine", () => {
  const id = "8a1c2b3d-1111-4222-8333-444455556666";
  const [found] = writeShape(`Links\n\nSee ${id} for the plan.`);
  expect(found).toMatchObject({ rule: "bare-id" });
  expect(found!.patch![0]!.replacement).toBe(`See ((${id})) for the plan.`);
  expect(writeShape(`Links [from::${id}]\n\nSee ((${id})) and \`${id}\`.`)).toEqual([]);
});

test("a note past a screen with no heading is told to have sections", () => {
  const long = Array.from({ length: SHAPE_LIMITS.screen + 1 }, (_, i) => `- point ${i}`).join("\n");
  expect(writeShape(`Notes\n\n${long}`).map(f => f.rule)).toEqual(["headings"]);
  expect(writeShape(`Notes\n\n## Part one\n${long}`)).toEqual([]);
});

test("a long title's patch keeps the name and moves the rest under it; a buried question's moves to the top", () => {
  const [title] = writeShape("Seed swap: the whole story of how the jars were sorted, counted and labelled [type::event]\n\nBody.");
  expect(title!.patch![0]!.replacement).toBe("Seed swap [type::event]\n\nThe whole story of how the jars were sorted, counted and labelled");
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  const note = `Notes\n\n${filler}\n\nShould we ask Evan which table to book?`;
  const [question] = writeShape(note);
  const moved = question!.patch!.reduce((t, p) => t.replace(p.observed, p.replacement), note);
  expect(moved).toStartWith("Notes [needs::sysop: Should we ask Evan which table to book?]\n\n- [ ] Should we ask Evan which table to book?");
  expect(writeShape(moved)).toEqual([]);
});

// loki's reshape run on real notes (Oct 29): a split inside parentheses cut a code span from its sentence, and a labelled
// ep0ch:// link's id was told to be a reference. A ready patch never drops or moves content between sentences.
test("a stacked patch splits only at sentence ends outside parentheses, code, quotes and brackets, and keeps every character", () => {
  const rule = "Rules\n\n- **Never share it:** a note marked `[publish::never]` stays home (no page, no link. Not even a share). Readers never see it. Agents still do.";
  const [found] = writeShape(rule);
  const replacement = found!.patch![0]!.replacement;
  expect(replacement).toBe("- **Never share it:**\n  - a note marked `[publish::never]` stays home (no page, no link. Not even a share).\n  - Readers never see it.\n  - Agents still do.");
  const code = "Rules\n\n- Run `ep0ch find. --ids` first. Then \"read it. All of it\" twice [see. this] now. Done.";
  const [c] = writeShape(code);
  expect(c!.patch![0]!.replacement).toBe("- Run `ep0ch find. --ids` first.\n- Then \"read it. All of it\" twice [see. this] now.\n- Done.");
});

test("an id in a labelled ep0ch:// link or any URL isn't a bare id", () => {
  expect(writeShape("Links\n\nSee [the plan](ep0ch://pie@float-2/b/8a1c2b3d-1111-4222-8333-444455556666) for it.")).toEqual([]);
  expect(writeShape("Links\n\nSee ep0ch://pie@float-2/b/8a1c2b3d-1111-4222-8333-444455556666 for it.")).toEqual([]);
});
