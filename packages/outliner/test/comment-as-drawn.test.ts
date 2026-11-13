// A comment on words as a reader drew them (the native window's selection, a page's, an agent quoting what it read
// rendered): the service finds the source they were drawn from (outline-core's drawn-passage.ts, the one owner) and the
// thread anchors to that span. A quote of the source as written still lands where it always did. Made-up garden notes.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_CALLOUT_REGISTRY } from "@ep0ch/outline-core/callouts";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { createBlockComment } from "../src/block-comments";
import { findPagePassage } from "../src/publish-passage";
import type { AnnotationThread, Block, BlockCommentPassage, WorkspaceSnapshot } from "../src/types";

async function fixture(run: (client: OutlinerClient) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "comment-as-drawn-")), socket = join(root, "service.sock");
  const store = new OutlinerStore(join(root, "outline.sqlite")); const server = new OutlinerServer(store, socket);
  await server.start();
  try { await run(new OutlinerClient(socket)); }
  finally { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
}

/** A comment on `passage` of `block`: the source its thread is anchored to. */
async function anchored(c: OutlinerClient, block: Block, passage: BlockCommentPassage): Promise<string> {
  const now = await c.request<Block>({ action: "get", blockId: block.id });
  const receipt = await createBlockComment(c, { requestId: crypto.randomUUID(), author: "user", input: { blockId: block.id, expectedRevision: now.revision, body: "Here.", source: "user", passage } });
  const anchor = receipt.annotations[0]!.originalTarget.anchor;
  if (anchor.kind !== "text-quote" || anchor.start === null || anchor.end === null) throw new Error(`not anchored to a span: ${JSON.stringify(anchor)}`);
  expect(now.text.slice(anchor.start, anchor.end)).toBe(anchor.exact);
  return anchor.exact;
}

test("a comment on a selection across a link, across bold and across two paragraphs lands on the source it was drawn from", () => fixture(async c => {
  const peas = await c.request<Block>({ action: "create", text: "Early peas [type::crop]\nSown under glass." });
  const bed = await c.request<Block>({ action: "create", text: [
    "North bed [type::bed]",
    `Sow the [early peas](https://seeds.example/peas) in March, then the ((${peas.id}|maincrop)) and what the [[seed list]] says.`,
    `The ((${peas.id})) come up in ten days.`,
    "",
    "Water **before dusk**, never at noon.",
    "",
    "The beans go in May.",
  ].join("\n") });
  // Each form a link is written in: the passage is the whole link, with the words either side.
  expect(await anchored(c, bed, { quote: "the early peas in March", drawn: true })).toBe("the [early peas](https://seeds.example/peas) in March");
  expect(await anchored(c, bed, { quote: "then the maincrop and", drawn: true })).toBe(`then the ((${peas.id}|maincrop)) and`);
  expect(await anchored(c, bed, { quote: "the seed list says", drawn: true })).toBe("the [[seed list]] says");
  // A reference with no label is drawn as the title of the note it names, which the service knows.
  expect(await anchored(c, bed, { quote: "The Early peas come up", drawn: true })).toBe(`The ((${peas.id})) come up`);
  // Bold, and two paragraphs (one line break between them as a Markdown view copies them, two as written).
  expect(await anchored(c, bed, { quote: "Water before dusk, never", drawn: true })).toBe("Water **before dusk**, never");
  expect(await anchored(c, bed, { quote: "never at noon.\n\nThe beans go", drawn: true })).toBe("never at noon.\n\nThe beans go");
  expect(await anchored(c, bed, { quote: "never at noon.\nThe beans go", drawn: true })).toBe("never at noon.\n\nThe beans go");
  // Every one of them is a thread of the note.
  const threads = await c.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: bed.id }, includeResolved: true } });
  expect(threads.length).toBe(7);
}));

test("a chip, a callout's line and a list are found as either reader draws them", () => fixture(async c => {
  const tip = BUILTIN_CALLOUT_REGISTRY.style("tip");
  const note = await c.request<Block>({ action: "create", text: [
    "Autumn jobs [type::plan]",
    "Mulch the beds [due::friday] before the frost.",
    "",
    "> [!tip] Before the rain",
    "> Net the **brassicas** first.",
    "",
    "- [ ] Stake the beans",
    "- Lift the garlic",
  ].join("\n") });
  // A page hides the token and a Markdown view shows it as written: the passage covers it either way.
  expect(await anchored(c, note, { quote: "the beds before the frost", drawn: true })).toBe("the beds [due::friday] before the frost");
  expect(await anchored(c, note, { quote: "the beds [due::friday] before", drawn: true })).toBe("the beds [due::friday] before");
  expect(await anchored(c, note, { quote: `${tip.icon} Before the rain\nNet the brassicas first.`, drawn: true })).toBe("[!tip] Before the rain\n> Net the **brassicas** first.");
  // A list as a Markdown view copies it (each item with its marker) and as a page selects it (without).
  expect(await anchored(c, note, { quote: "- [ ] Stake the beans\n- Lift the garlic", drawn: true })).toBe("Stake the beans\n- Lift the garlic");
}));

test("a selection across a rule, and across a reference to a note whose title has marks, lands on the source it was drawn from", () => fixture(async c => {
  const seeds = await c.request<Block>({ action: "create", text: "`seed_list` notes [type::list]\nWhat was bought." });
  const bed = await c.request<Block>({ action: "create", text: [
    "Far bed [type::bed]",
    "Peas go in first.",
    "",
    "---",
    "",
    `The beans go in May: see the ((${seeds.id})) first.`,
  ].join("\n") });
  // A reader draws the rule as a line with no words: the selection is the two paragraphs, a blank line between.
  expect(await anchored(c, bed, { quote: "Peas go in first.\n\nThe beans go in May", drawn: true })).toBe("Peas go in first.\n\n---\n\nThe beans go in May");
  // The reference is drawn as its note's title, through Markdown: the title's code ticks are marks, not words.
  expect(await anchored(c, bed, { quote: "see the seed_list notes first.", drawn: true })).toBe(`see the ((${seeds.id})) first.`);
}));

test("the same words drawn twice are refused as a source quote's repeats are, and what the reader knows picks one", () => fixture(async c => {
  const text = "Watering [type::rule]\n**Water** the beds at dusk.\n\nWater the beds at dawn too.";
  const note = await c.request<Block>({ action: "create", text });
  const before = await c.request<WorkspaceSnapshot>({ action: "workspace.snapshot" });
  const comment = (passage: BlockCommentPassage) => createBlockComment(c, { requestId: crypto.randomUUID(), author: "user", input: { blockId: note.id, expectedRevision: note.revision, body: "Which?", source: "user", passage } });
  // Drawn twice: refused, in the words a source quote found twice is refused in, and nothing is written.
  await expect(comment({ quote: "Water the beds", drawn: true })).rejects.toThrow('Comment quote is ambiguous; supply start, prefix/suffix or a unique checklist itemId ("Water the beds" is there 2 times');
  await expect(comment({ quote: "Water the beds", drawn: true })).rejects.toMatchObject({ kind: "ambiguous" });
  // Words that are not in the note, as written or as drawn: refused with why and the nearest words there are.
  await expect(comment({ quote: "Water the paths at dusk", drawn: true })).rejects.toThrow('Comment quote or context was not found; read the current source and select it again ("Water the paths at dusk" isn\'t in the text now (nearest: "**Water** the" at 22))');
  await expect(comment({ quote: "Water the paths at dusk", drawn: true })).rejects.toMatchObject({ kind: "not-found" });
  await expect(comment({ quote: "Water the paths at dusk" })).rejects.toMatchObject({ kind: "not-found" });
  expect(await c.request<WorkspaceSnapshot>({ action: "workspace.snapshot" })).toEqual(before);
  // The part of the note the words were drawn in (its span of the source), or the offset to be nearest.
  const first = text.indexOf("**Water**"), second = text.indexOf("Water the beds at dawn");
  expect(await anchored(c, note, { quote: "Water the beds", drawn: true, within: { start: first, end: first + 27 } })).toBe("**Water** the beds");
  expect(await anchored(c, note, { quote: "Water the beds", drawn: true, within: { start: second, end: text.length } })).toBe("Water the beds");
  expect(await anchored(c, note, { quote: "Water the beds", drawn: true, near: 0 })).toBe("**Water** the beds");
}));

test("a quote of the source as written lands where it always did, and one that says nothing of how it was read is found as drawn", () => fixture(async c => {
  const text = "Watering [type::rule]\n**Water** the beds at dusk. Water the beds at dawn. Net the [peas](https://seeds.example/peas) too.";
  const note = await c.request<Block>({ action: "create", text });
  const comment = (passage: BlockCommentPassage) => createBlockComment(c, { requestId: crypto.randomUUID(), author: "agent", input: { blockId: note.id, expectedRevision: note.revision, body: "Noted.", source: "agent", passage } });
  // The source has these words once, as written: an exact quote is that place, whatever a reader would draw elsewhere.
  const exact = await comment({ quote: "Water the beds" });
  expect(exact.annotations[0]!.originalTarget.anchor).toMatchObject({ kind: "text-quote", start: text.indexOf("Water the beds at dawn"), exact: "Water the beds" });
  // A quote with its marks is source text, found as written.
  expect((await comment({ quote: "**Water** the beds" })).annotations[0]!.originalTarget.anchor).toMatchObject({ start: text.indexOf("**Water**"), exact: "**Water** the beds" });
  // An agent quoting what it read rendered says nothing of how: not in the source as written, it is read as drawn.
  expect((await comment({ quote: "Net the peas too." })).annotations[0]!.originalTarget.anchor).toMatchObject({ start: text.indexOf("Net the"), exact: "Net the [peas](https://seeds.example/peas) too." });
  // A quote that names its place in the source is source text and nothing else: a source-aware reader's miss stays one.
  await expect(comment({ quote: "Net the peas too.", start: text.indexOf("Net the") })).rejects.toMatchObject({ kind: "not-found" });
  await expect(comment({ quote: "Net the peas too.", prefix: "at dawn. " })).rejects.toMatchObject({ kind: "not-found" });
  // What a span must be is said when it isn't one.
  await expect(comment({ quote: "Water", within: { start: 9, end: 3 } })).rejects.toThrow("Comment within must be a span of the source");
}));

// The rows a stand-in host answers a comment from (outline-core's core-contract.json `quoted`, which the native
// window's cargo tests run) are about a made-up note served as a page: that page is what this service answers for its
// text, and each row is what this service does with the passage.
test("the contract's quoted note is the page the service answers, and each quoted row is what the service does", () => fixture(async c => {
  type Row = { name: string; text?: string; passage: BlockCommentPassage; found?: { start: number; end: number; exact: string }; refused?: { kind: string; error: string } };
  const contract = JSON.parse(readFileSync(join(import.meta.dir, "../../outline-core/fixtures/core-contract.json"), "utf8")) as
    { quotedNote: { text: string; title: string; chips: unknown; parts: { kind: string; line: number; span: unknown; view: unknown }[] }; quoted: Row[] };
  const note = await c.request<Block>({ action: "create", text: contract.quotedNote.text });
  const page = await c.request<{ title: string; chips: unknown; text: string; parts: { kind: string; line: number; span: unknown; view: unknown }[] }>({ action: "notes.page", blockId: note.id });
  expect(page.parts.map(({ kind, line, span, view }) => ({ kind, line, span, view }))).toEqual(contract.quotedNote.parts.map(({ kind, line, span, view }) => ({ kind, line, span, view })));
  expect([page.title, page.chips, page.text]).toEqual([contract.quotedNote.title, contract.quotedNote.chips, contract.quotedNote.text]);
  const notes = new Map<string, Block>([[contract.quotedNote.text, note]]);
  for (const row of contract.quoted) {
    const text = row.text ?? contract.quotedNote.text;
    if (!notes.has(text)) notes.set(text, await c.request<Block>({ action: "create", text }));
    const on = await c.request<Block>({ action: "get", blockId: notes.get(text)!.id });
    const sent = createBlockComment(c, { requestId: crypto.randomUUID(), author: "user", input: { blockId: on.id, expectedRevision: on.revision, body: "Here.", source: "user", passage: row.passage } });
    if (row.refused) await expect(sent, row.name).rejects.toMatchObject({ kind: row.refused.kind, message: row.refused.error });
    else expect((await sent).annotations[0]!.originalTarget.anchor, row.name).toMatchObject({ kind: "text-quote", start: row.found!.start, end: row.found!.end, exact: row.found!.exact });
  }
}));

// One owner: a text is read as drawn in outline-core's drawn-passage.ts and nowhere else, and a drawn quote is looked
// up there with passage.ts's own lookup. The service's comment asks through `findQuoted`; the published page asks the
// same owner for its places and keeps only what is a page's own (which of its blocks, by the drawn words around).
test("where a drawn passage is in the source has one owner", () => {
  const src = (pkg: string) => readdirSync(join(import.meta.dir, "../..", pkg, "src")).filter(name => /\.(ts|js|jsx)$/.test(name))
    .map(name => ({ file: `${pkg}/src/${name}`, text: readFileSync(join(import.meta.dir, "../..", pkg, "src", name), "utf8").split("\n").filter(line => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n") }));
  const files = [...src("outline-core"), ...src("outliner")];
  const holding = (needle: string) => files.filter(f => f.text.includes(needle)).map(f => f.file).sort();
  expect(holding("function drawnText(")).toEqual(["outline-core/src/drawn-passage.ts"]);
  expect(holding("drawnText(")).toEqual(["outline-core/src/drawn-passage.ts", "outliner/src/publish-passage.ts"]);
  expect(holding("findDrawnPassage(")).toEqual(["outline-core/src/drawn-passage.ts"]);
  expect(holding("findQuoted(")).toEqual(["outline-core/src/drawn-passage.ts", "outliner/src/block-comments.ts"]);
  // The page's finder walks no text itself: its places are the owner's (`drawnPlaces`, passage.ts's `quotePlaces`).
  const page = files.find(f => f.file === "outliner/src/publish-passage.ts")!.text;
  expect(page.includes(".indexOf(") || page.includes("matchAll(") || page.includes("propertyTokenMatches")).toBe(false);
  expect(page).toContain("drawnPlaces(drawn, selection.quote)");
  const owner = files.find(f => f.file === "outline-core/src/drawn-passage.ts")!.text;
  expect(owner).toContain("findPassage(drawn.text, words");
  expect(owner).toContain("quotePlaces(drawn.text, words");
});

// A selection's edge may be mid-line: what a line would start with (a list's number, a dash) is words there. The
// service's comment and the published page's finder read the quote, and the words around it, the same two ways.
test("a selection that starts on a year and its full stop is the whole of it, in a comment and on a published page", () => fixture(async c => {
  const text = "The frost came late in 2026. Then it rained for a week.\n\nThen it rained again in May.";
  const bed = await c.request<Block>({ action: "create", text: `Rain log\n${text}` });
  expect(await anchored(c, bed, { quote: "2026. Then it rained", drawn: true })).toBe("2026. Then it rained");
  const page = findPagePassage([{ id: bed.id, revision: bed.revision, text: bed.text }], { quote: "2026. Then it rained" });
  expect(page.ok && page.passage.quote).toBe("2026. Then it rained");
  // The words after a selection say which repeat it is, a year among them.
  const twice = "the beds in 2026. Then it rained.\n\nthe beds in 2027. Then it rained.";
  const second = findPagePassage([{ id: "b", revision: 1, text: twice }], { quote: "the beds in", prefix: "", suffix: " 2027. Then it" });
  expect(second.ok && second.passage.start).toBe(twice.lastIndexOf("the beds"));
}));
