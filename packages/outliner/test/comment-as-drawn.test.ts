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
  type Row = { name: string; text?: string; passage: BlockCommentPassage; found?: { start: number; end: number; exact: string }; whole?: { start: number; end: number; exact: string; quote: string; widened: boolean }; refused?: { kind: string; error: string } };
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
    // Asked before anything is written (`passages.find`): the same passage as whole words, or the same refusal.
    const asked = c.request<Record<string, unknown>>({ action: "passages.find", blockId: on.id, passage: row.passage, whole: "words" });
    if (row.refused) await expect(asked, row.name).rejects.toMatchObject({ kind: row.refused.kind, message: row.refused.error });
    else expect(await asked, row.name).toEqual({ blockId: on.id, revision: on.revision, ...row.whole! });
    const sent = createBlockComment(c, { requestId: crypto.randomUUID(), author: "user", input: { blockId: on.id, expectedRevision: on.revision, body: "Here.", source: "user", passage: row.passage } });
    if (row.refused) await expect(sent, row.name).rejects.toMatchObject({ kind: row.refused.kind, message: row.refused.error });
    else expect((await sent).annotations[0]!.originalTarget.anchor, row.name).toMatchObject({ kind: "text-quote", start: row.found!.start, end: row.found!.end, exact: row.found!.exact });
  }
}));

// A passage picked by hand is whole words. A press on a first letter lands past its middle as often as not, and the
// selection then starts after it: asked with `whole: "words"`, the service answers the passage the person meant, with
// the quote to send for it, whether it starts a paragraph, a list item or a styled run. One that was whole is
// answered with the asker's own words, and without `whole` nothing is widened.
test("a passage that starts or ends inside a word is found as the whole words", () => fixture(async c => {
  const peas = await c.request<Block>({ action: "create", text: "Early peas [type::crop]\nSown under glass." });
  const text = ["North bed [type::bed]", "Action Define looks the words up.", "", "- PDF and web pages are read here.", `- **Peas** and the ((${peas.id})) go in first.`].join("\n");
  const bed = await c.request<Block>({ action: "create", text });
  const find = (quote: string, whole?: "words") => c.request<{ start: number; end: number; exact: string; quote: string; widened: boolean }>({ action: "passages.find", blockId: bed.id, passage: { quote, drawn: true }, ...(whole ? { whole } : {}) });
  // The first letter of a paragraph and of a list item, each one press late; the last word cut short.
  expect(await find("ction Define looks the wor", "words")).toMatchObject({ exact: "Action Define looks the words", quote: "Action Define looks the words", widened: true, start: text.indexOf("Action") });
  expect(await find("DF and web pages", "words")).toMatchObject({ exact: "PDF and web pages", quote: "PDF and web pages", widened: true });
  // Across two list items, as a Markdown view copies them: the passage is the source of both, the quote their words.
  expect(await find("DF and web pages are read here.\n- Peas and the Early pea", "words")).toMatchObject({ exact: `PDF and web pages are read here.\n- **Peas** and the ((${peas.id}))`, quote: "PDF and web pages are read here. Peas and the Early peas", widened: true });
  // A word in a styled run takes its marks with it, as a passage found whole does.
  expect(await find("eas and the", "words")).toMatchObject({ exact: "**Peas** and the", quote: "Peas and the", widened: true });
  // Whole already: the asker's own words, untouched. Not asked for: found as it came.
  expect(await find("Define looks", "words")).toMatchObject({ exact: "Define looks", quote: "Define looks", widened: false });
  expect(await find("ction Define")).toMatchObject({ exact: "ction Define", quote: "ction Define", widened: false });
  // What isn't there is said in the comment's own words, before a comment is written.
  await expect(find("Action Refine", "words")).rejects.toMatchObject({ kind: "not-found" });
  await expect(c.request({ action: "passages.find", blockId: bed.id, passage: { quote: "Action" }, whole: "lines" })).rejects.toThrow("whole= is words");
}));

// The words a thread is on are marked where a page draws them: each part its passage reaches into carries a mark,
// with where those words are in the text the part's view is drawn from (outline-core's part-anchor.ts) and the act a
// press on them runs. A client tints that range and reads no source. A thread resolved, or whose words are gone,
// marks nothing; a comment on the whole note marks nothing either.
test("a note's page marks the words its open threads are on, in each part's own text", () => fixture(async c => {
  type Mark = { kind: string; id: string; start?: number; end?: number; act?: string; from?: string };
  type Part = { kind: string; line: number; marks?: Mark[]; view: { type: string; text?: string; children?: Part[] } };
  const contract = JSON.parse(readFileSync(join(import.meta.dir, "../../outline-core/fixtures/core-contract.json"), "utf8")) as
    { quotedNote: { text: string; thread: { id: string; start: number; end: number }; marked: { line: number; marks: Mark[] }[] } };
  const note = await c.request<Block>({ action: "create", text: contract.quotedNote.text });
  const page = () => c.request<{ parts: Part[] }>({ action: "notes.page", blockId: note.id });
  expect((await page()).parts.some(part => part.marks)).toBe(false);
  // The contract's made-up thread, made: the page marks it as the contract says, by the thread's own id.
  const { start, end } = contract.quotedNote.thread;
  const receipt = await createBlockComment(c, { requestId: crypto.randomUUID(), author: "user", input: { blockId: note.id, expectedRevision: note.revision, body: "Which frost?", source: "user", passage: { quote: contract.quotedNote.text.slice(start, end), start } } });
  const thread = receipt.annotations[0]!.block.id;
  const renamed = (text: string) => text.replaceAll(contract.quotedNote.thread.id, thread);
  const marked = (await page()).parts.filter(part => part.marks).map(part => ({ line: part.line, marks: part.marks }));
  expect(marked).toEqual(JSON.parse(renamed(JSON.stringify(contract.quotedNote.marked))));
  const first = (await page()).parts[0]!, mark = first.marks![0]!;
  expect(first.view.text!.slice(mark.start, mark.end)).toBe("the last frost.\n\nWater the beds at dusk.");
  expect(mark.act).toBe(`thread.toggle thread="${thread}"`);
  // A passage across a link and bold is marked across both, in the Markdown the part is drawn from; one in a
  // box is marked on the part written in the box; a figure its words reach is marked whole.
  const bed = await c.request<Block>({ action: "create", text: ["West bed [type::bed]", "Sow the [[seed list]] peas **before** dusk.", "", "::box", "Net them against pigeons.", "::", "", "::graph-stat", "- beds: 4", "- sown: 3", "::"].join("\n") });
  const on = async (quote: string) => (await createBlockComment(c, { requestId: crypto.randomUUID(), author: "user", input: { blockId: bed.id, expectedRevision: (await c.request<Block>({ action: "get", blockId: bed.id })).revision, body: "Here.", source: "user", passage: { quote } } })).annotations[0]!.block.id;
  const linked = await on("the [[seed list]] peas **before** dusk"), boxed = await on("against pigeons"), figure = await on("sown: 3");
  const parts = (await c.request<{ parts: Part[] }>({ action: "notes.page", blockId: bed.id })).parts;
  const prose = parts.find(part => part.kind === "prose")!, box = parts.find(part => part.kind === "box")!, stat = parts.find(part => part.kind === "figure")!;
  expect(prose.marks!.map(m => [m.id, prose.view.text!.slice(m.start, m.end)])).toEqual([[linked, "the [seed list](ep0ch:p/seed%20list) peas **before** dusk"]]);
  expect(box.marks).toBeUndefined();
  expect(box.view.children![0]!.marks!.map(m => [m.id, box.view.children![0]!.view.text!.slice(m.start, m.end)])).toEqual([[boxed, "against pigeons"]]);
  expect(stat.marks).toEqual([{ kind: "thread", id: figure, act: `thread.toggle thread="${figure}"`, from: "threads" }]);
  // Resolved, a thread leaves the margin and its mark goes; the note's words gone, so does the other's.
  await c.request({ action: "annotations.lifecycle", input: { annotationId: linked, lifecycle: "resolved" } });
  const now = await c.request<Block>({ action: "get", blockId: bed.id });
  await c.request({ action: "update", blockId: bed.id, expectedRevision: now.revision, text: now.text.replace("Net them against pigeons.", "Net them."), mutation: { author: "user" } });
  const after = (await c.request<{ parts: Part[] }>({ action: "notes.page", blockId: bed.id })).parts;
  expect(after.find(part => part.kind === "prose")!.marks).toBeUndefined();
  expect(after.find(part => part.kind === "box")!.view.children![0]!.marks).toBeUndefined();
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
  // Where a span of the source is in a text written from it, and a passage as whole words, are that owner's too: the
  // page asks the first for its marks, `passages.find` the second, and neither reads a text itself.
  expect(holding("spanIn(")).toEqual(["outline-core/src/drawn-passage.ts", "outliner/src/note-page.ts"]);
  expect(holding("wholePassage(")).toEqual(["outline-core/src/drawn-passage.ts", "outliner/src/passage-find.ts"]);
  // The page's finder walks no text itself: its places are the owner's (`drawnPlaces`, passage.ts's `quotePlaces`).
  const page = files.find(f => f.file === "outliner/src/publish-passage.ts")!.text;
  expect(page.includes(".indexOf(") || page.includes("matchAll(") || page.includes("propertyTokenMatches")).toBe(false);
  expect(page).toContain("drawnPlaces(drawn, selection.quote)");
  const owner = files.find(f => f.file === "outline-core/src/drawn-passage.ts")!.text;
  expect(owner).toContain("findPassage(drawn.text, words");
  expect(owner).toContain("quotePlaces(drawn.text, words");
});
