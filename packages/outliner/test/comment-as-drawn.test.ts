// A comment on words as a reader drew them (the native window's selection, a page's, an agent quoting what it read
// rendered): the service finds the source they were drawn from (outline-core's drawn-passage.ts, the one owner) and the
// thread anchors to that span. A quote of the source as written still lands where it always did. Made-up garden notes.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
