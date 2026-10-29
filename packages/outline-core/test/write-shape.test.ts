import { expect, test } from "bun:test";
import { asksAt, FIX_BEFORE_DONE, SHAPE_LIMITS, sentenceCount, shapeNext, shapeWarnings, writeShape } from "../src/write-shape";

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

// Live on pie (loki, Oct 29): a roadmap item's title patch moved its name into the body, leaving "PIE-1397 [type::…]".
test("a work item's title is measured after its Work ID and never moved down", () => {
  const item = "PIE-1397 — A deploy restarts the outline host only when the code it runs changed [type::roadmap-item] [work-id::PIE-1397]\n\nBody.";
  expect(writeShape(item)).toEqual([]);
  const long = "PIE-1398 — A deploy restarts the outline host only when the code it runs has changed since the last deploy, and says so [type::roadmap-item]\n\nBody.";
  const [found] = writeShape(long);
  expect(found).toMatchObject({ rule: "title" });
  expect(found!.patch).toBeUndefined();
});

// PIE-1402, found in use: the buried question's patch cut its chip mid-word, left "…, and" behind, and glued the
// checkbox to the first paragraph; the wall's patch left bullets of 250–600 characters. Every patch applied as written
// must leave a note the next review has nothing to say about.
const apply = (text: string, patch: readonly { observed: string; replacement: string }[]) => patch.reduce((t, p) => t.replace(p.observed, p.replacement), text);

test("the wall with its ask in the last sentence: both patches, as written, leave nothing to fix", () => {
  const note = [
    "Shed roof notes",
    "",
    "The felt went on this morning and the roof over the potting bench no longer drips onto the seed trays, which means the trays can stay where they are through the winter, and the bucket that caught the leak is back with the compost, though the far corner still lets in a little light where the batten split last spring. We checked it twice after the rain and both times the bench stayed dry, so the felt is doing its job. The gutter came down for cleaning and went back up. The ladder went back to the shed. Evan, should we replace the split batten now, which means a second trip to the timber yard, or leave it until the spring sweep?",
  ].join("\n");
  let text = note;
  const question = writeShape(text).find(f => f.rule === "question")!;
  text = apply(text, question.patch!);
  // The chip holds the whole ask, cut only at a word, and the checkbox is its own paragraph.
  expect(text.split("\n")[0]).toMatch(/^Shed roof notes \[needs::sysop: Evan, should we replace the split batten now, which means a second trip to the…\]$/);
  expect(text.split("\n").slice(1, 4)).toEqual(["", expect.stringMatching(/^- \[ \] Evan, should we replace .* spring sweep\?$/), ""]);
  // The wall's first sentence is too long for any bullet: no patch, and the finding names it (a patch that left a
  // 280-character bullet would be told again, PIE-1402).
  const wall = writeShape(text).find(f => f.rule === "wall")!;
  expect(wall.patch).toBeUndefined();
  expect(wall.say).toContain("too long for one bullet");
});

test("a buried ask whose line holds little else moves whole; one under a title with no blank line stays its own paragraph", () => {
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  const note = `Notes\nFirst line of the body.\n\n${filler}\n\nSo, Evan, should we book the long table?`;
  const [q] = writeShape(note);
  const moved = apply(note, q!.patch!);
  expect(moved).toStartWith("Notes [needs::sysop: So, Evan, should we book the long table?]\n\n- [ ] So, Evan, should we book the long table?\n\nFirst line of the body.");
  expect(moved).not.toContain("\nSo,\n");
  expect(writeShape(moved)).toEqual([]);
});

test("a stacked item whose one sentence is too long comes with no patch, and says which to cut", () => {
  const item = "- The new shelves hold every jar from the old cupboard and the two crates from the shed, which means the floor by the door is clear again, and the labels face out so a jar can be found without lifting the others, though the top shelf is still too high to reach without the step.";
  const [found] = writeShape(`Pantry\n\n${item}`);
  expect(found).toMatchObject({ rule: "stacked" });
  expect(found!.patch).toBeUndefined();
  expect(found!.say).toContain("is one item of 276 characters: a bullet is one short point; cut it");
});

// Found by a verifier using #1025 (Oct 29): each patch, applied as written, must leave a note the next review is quiet on.
test("a question in the paragraph right under the title moves out without swallowing the rest of it", () => {
  const filler = Array.from({ length: 4 }, (_, i) => `The gutter on the north side sagged at joint ${i} after the storm.`).join(" ");
  const note = `Gutter repair update [type::note]\n${filler} Evan, should we replace the whole run or patch the two joints?`;
  const q = writeShape(note).find(f => f.rule === "question")!;
  const fixed = apply(note, q.patch!);
  const lines = fixed.split("\n");
  expect(lines[0]).toStartWith("Gutter repair update [type::note] [needs::sysop:");
  expect(lines.slice(1, 4)).toEqual(["", expect.stringMatching(/^- \[ \] Evan, should we replace/), ""]);
  expect(writeShape(fixed).filter(f => f.rule === "stacked")).toEqual([]);
});

test("a title whose chips are on the line under it keeps them there: the box goes below the chips", () => {
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  const note = `Gutter repair update\n[type::note] [area::north]\n\n${filler}\n\nEvan, should we replace the whole run?`;
  const q = writeShape(note).find(f => f.rule === "question")!;
  const fixed = apply(note, q.patch!);
  expect(fixed.split("\n").slice(0, 4)).toEqual(["Gutter repair update [needs::sysop: Evan, should we replace the whole run?]", "[type::note] [area::north]", "", "- [ ] Evan, should we replace the whole run?"]);
});

test("a dotted key on the chip line is the title's too", () => {
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  const note = `Gutter repair update\n[plot.row::north]\n\n${filler}\n\nEvan, should we replace the whole run?`;
  const fixed = apply(note, writeShape(note).find(f => f.rule === "question")!.patch!);
  expect(fixed.split("\n")[1]).toBe("[plot.row::north]");
});

test("a wall's patch splits at sentences only; one with a sentence too long for a bullet comes with no patch", () => {
  const ok = `Seedlings\n\n${"The trays went out at nine. The frame stayed shut. The cat stayed off. The watering can was refilled. Nobody tripped."}`;
  const [wall] = writeShape(ok);
  const fixed = apply(ok, wall!.patch!);
  expect(fixed).not.toMatch(/^[ \t]+- /m);
  expect(writeShape(fixed)).toEqual([]);
  const long = `Seedlings\n\nThe trays went out at nine and the frame stayed shut all morning while the sun came round onto the bench, which meant the seedlings warmed slowly, and somebody had left the watering can full by the door so nobody needed to go back to the tap before the second round of potting began after lunch. The frame stayed shut. The cat stayed off. Nobody tripped.`;
  const [w2] = writeShape(long);
  expect(w2!.patch).toBeUndefined();
  expect(w2!.say).toContain("too long for one bullet");
});

// PIE-1419, found by a verifier walking five notes with every patch applied as written (Oct 29): the patched note keeps
// its chips as chips, a stacked item of clauses has a patch, the words say what's wrong, and a question at the bottom
// is buried whether or not it names Evan.
test("a wall under a chip line: the patch leaves the chips on their own line, and the patched note is quiet", () => {
  const note = ["Seed swap recap", "[type::note] [area::garden]", "The swap opened at nine and the tables filled within the hour. Most people brought beans and squash. The labels ran out halfway. Then the second box arrived and nothing was lost."].join("\n");
  const wall = writeShape(note).find(f => f.rule === "wall")!;
  expect(wall.patch![0]!.observed).not.toContain("[type::note]");
  const fixed = apply(note, wall.patch!);
  expect(fixed.split("\n").slice(0, 4)).toEqual(["Seed swap recap", "[type::note] [area::garden]", "", "- The swap opened at nine and the tables filled within the hour."]);
  expect(writeShape(fixed)).toEqual([]);
});

test("a stacked item of clauses joined by semicolons and dashes comes with a patch, one clause a bullet, and the patched note is quiet", () => {
  const note = ["Shed tidy", "", "- Tools: the spades are back on the north wall; the forks are in the barrel by the door; the hoses are coiled under the bench — and the broken rake is in the skip.", "- Done by noon."].join("\n");
  const stacked = writeShape(note).find(f => f.rule === "stacked")!;
  expect(stacked.say).toContain("(the patch makes the items)");
  const fixed = apply(note, stacked.patch!);
  expect(fixed.split("\n").slice(2)).toEqual(["- Tools:", "  - the spades are back on the north wall", "  - the forks are in the barrel by the door", "  - the hoses are coiled under the bench", "  - and the broken rake is in the skip.", "- Done by noon."]);
  expect(writeShape(fixed)).toEqual([]);
});

test("a wall's words say what's wrong with it: its sentences when there are too many, its length when it's long", () => {
  const many = writeShape(`Seeds\n\n${wall}`).find(f => f.rule === "wall")!;
  expect(many.say).toContain("is a paragraph of 5 sentences (keep one to 3)");
  const one = "The trays went out at nine and the frame stayed shut all morning while the sun came round onto the bench, " + "and the seedlings warmed slowly while the watering can stood full by the door, ".repeat(5) + "until lunch.";
  const long = writeShape(`Seedlings\n\n${one}`).find(f => f.rule === "wall")!;
  expect(long.say).not.toMatch(/\b1 sentences\b/);
  expect(long.say).toContain(`is one sentence of ${one.length} characters (keep a paragraph under ${SHAPE_LIMITS.paragraphChars})`);
  expect(long.say).toContain("too long for one bullet: shorten it by hand");
});

test("a question at the bottom is buried whether or not it names Evan; one answered in its own line, or in a table, isn't", () => {
  const note = ["Compost bins moved", "", "The three bins now sit behind the shed, out of the wind.", "", "The old spot by the fence is bare and can take the new bed. The ground is heavy, so it wants grit first. Do we order the grit this week or wait for spring?"].join("\n");
  const q = writeShape(note).find(f => f.rule === "question")!;
  expect(q.passage).toBe("Do we order the grit this week or wait for spring?");
  const fixed = apply(note, q.patch!);
  expect(fixed.split("\n").slice(0, 3)).toEqual(["Compost bins moved [needs::sysop: Do we order the grit this week or wait for spring?]", "", "- [ ] Do we order the grit this week or wait for spring?"]);
  expect(writeShape(fixed)).toEqual([]);
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  expect(writeShape(`Notes\n\n${filler}\n\nWhy did the bins move? The wind took the lids twice.`)).toEqual([]);
  expect(writeShape(`Notes\n\n${filler}\n\n| Moved? | yes |\n| --- | --- |`)).toEqual([]);
  expect(writeShape(`Notes\n\n${filler}\n\n## Why move them?\n\nThe wind.`)).toEqual([]);
  expect(writeShape(`Notes\n\n${filler}\n\n- [x] Order the grit now or in spring?`)).toEqual([]);
});

test("review findings on round three: a callout keeps its list, an aside between dashes is never cut, a bold question with its answer under it isn't buried", () => {
  const callout = `Seeds\n\n> [!tip] Sorting\n> ${wall}`;
  const inCallout = writeShape(callout).find(f => f.rule === "wall")!;
  if (inCallout.patch) expect(apply(callout, inCallout.patch)).not.toContain("[!tip] Sorting\n\n");
  const aside = "Hosts\n\nThe host — the one in the shed by the north fence, past the water butts and the compost — restarts every night at two, and nobody needs to touch it after that. The second host stays up. The third one sleeps. The fourth was retired.";
  const cut = writeShape(aside).find(f => f.rule === "wall")!;
  expect(cut.patch?.[0]?.replacement ?? "").not.toContain("- the one in the shed");
  const filler = Array.from({ length: SHAPE_LIMITS.top }, (_, i) => `- point ${i}`).join("\n");
  expect(writeShape(`Why one gate\n\n${filler}\n\n**Why one test gate?**\nTwo gates cost twice the CI.`)).toEqual([]);
  expect(writeShape(`Why one gate\n\n${filler}\n\nWhy one test gate?\nTwo gates cost twice the CI.`)).toEqual([]);
});

test("a long item of two points is told its length, not that it stacks", () => {
  const item = `- Board: ${"the first sentence runs on about the beds and the fence and the water ".repeat(2).trim()}. ${"The second sentence runs on about the shed and the tools ".repeat(2).trim()}.`;
  const found = writeShape(`Notes\n\n${item}`).find(f => f.rule === "stacked")!;
  expect(found.say).toContain(`is one item of ${item.length - 2} characters`);
  expect(found.say).not.toContain("stacks 2 points");
});

// PIE-1428, seen in use (Oct 29): an answered checkbox was called a buried ask, and its patch put `[needs::sysop]` back
// on a done ticket; the checkbox patch left a double blank line where the box had been.
test("a ticked checkbox question is answered, not an ask, wherever it sits and whatever Jev says", () => {
  const top = "PIE-9 · Downloads work on a phone [type::roadmap-item]\n\n- [x] Does Save to Files appear when you tap CSV? Evan, Oct 29: \"sharing that way works\".\n\n## Why\nThe link was a data URL.";
  expect(writeShape(top).map(f => f.rule)).not.toContain("question");
  const low = ["Hedge plan", "", "The hedge is cut.", "", "The ladder is back.", "", "The clippings are in the bay.", "", "- [x] Evan, should we borrow the long ladder again?"].join("\n");
  expect(writeShape(low).map(f => f.rule)).not.toContain("question");
  // Jev's yes is about the words; the box says it was answered.
  expect(asksAt(low.split("\n"), 8, "yes")).toBe(false);
  expect(asksAt(low.replace("- [x]", "- [ ]").split("\n"), 8)).toBe(true);
});

test("a buried checkbox moved to the top leaves no double blank line, mid-note or last", () => {
  for (const after of ["\n\nThe cutting can wait a week.", ""]) {
    const note = `Hedge trimming plan\n\nThe hedge along the east fence needs cutting.\n\nNobody has the ladder yet.\n\nThe clippings go in the bay.\n\n- [ ] who has the long ladder, and can it be back by Friday?${after}`;
    const q = writeShape(note).find(f => f.rule === "question")!;
    const moved = apply(note, q.patch!);
    expect(moved).not.toContain("\n\n\n");
    expect(moved.endsWith("\n")).toBe(false);
    expect(moved.split("\n").slice(0, 3)).toEqual(["Hedge trimming plan [needs::sysop: who has the long ladder, and can it be back by Friday?]", "", "- [ ] who has the long ladder, and can it be back by Friday?"]);
  }
});

// PIE-1417: a build log's time still to come, written as if it had happened (loki, Oct 29, three times in a morning).
test("a timeline time later than now on today's note is a finding with the time now; one already past is not", () => {
  const now = new Date(2026, 9, 29, 9, 40);
  const log = (time: string, day = "2026-10-29") => `Build log, Oct 29 [type::build-log] [day::${day}]\n\n::graph-timeline\n---\ntitle: what landed\n---\n- 9:00 AM: the hedge cut\n- ${time}: the ladder back\n::`;
  const ahead = writeShape(log("9:50 AM"), { now }).filter(f => f.rule === "time");
  expect(ahead).toHaveLength(1);
  expect(ahead[0]!.line).toBe(8);
  expect(ahead[0]!.say).toContain("9:50 AM");
  expect(ahead[0]!.say).toContain("9:40 AM");
  expect(writeShape(log("9:30 AM"), { now }).map(f => f.rule)).not.toContain("time");
  expect(writeShape(log("**10:15 PM**"), { now }).map(f => f.rule)).toContain("time");
  // Another day's log, and no clock to read, say nothing.
  expect(writeShape(log("9:50 AM", "2026-10-28"), { now }).map(f => f.rule)).not.toContain("time");
  expect(writeShape(log("9:50 AM")).map(f => f.rule)).not.toContain("time");
});

test("a time in the note's own [day::] that hasn't come yet is a finding", () => {
  const now = new Date(2026, 9, 29, 9, 40);
  expect(writeShape("Garden walk [day::2026-10-29 10:30 AM]\n\nThe beds were weeded.", { now }).map(f => f.rule)).toContain("time");
  expect(writeShape("Garden walk [day::2026-10-29T10:30]\n\nThe beds were weeded.", { now }).map(f => f.rule)).toContain("time");
  expect(writeShape("Garden walk [day::2026-10-29T09:10]\n\nThe beds were weeded.", { now }).map(f => f.rule)).not.toContain("time");
  // A day alone is a day to plan for: no finding.
  expect(writeShape("Garden walk [day::2026-10-30]\n\nWeed the beds.", { now }).map(f => f.rule)).not.toContain("time");
});
