// PIE-1247 slice 2: `quote`, materialize(subject, where). An element of a note (by its anchor, or a line of it with no
// anchor yet) quoted into a new block, detached under `.detached` with no header, or dropped into another note's text as
// a reference or a copy with its query, through draft.patch. Made-up notes only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, QuoteReceipt } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

async function service() {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-quote-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const client = new OutlinerClient(socket);
  const quote = (input: unknown, actorId = "fern") => client.request<QuoteReceipt>({ action: "quote", input, mutation: { author: "agent", actorId } } as never);
  return { store, client, quote };
}

const PLAN = [
  "Raised beds plan [page::Raised beds plan]",
  "A long plan for the season.",
  "",
  "::graph-table",
  "---",
  "title: Bed jobs",
  'query: "parent:this"',
  "---",
  "::",
  "",
  "> [!tip] Water early",
  "> Before nine.",
  "",
  "- stake the peas",
].join("\n");

test("detach: a figure named by a line of it gets its anchor, and a block under .detached embeds it with no header", async () => {
  const { store, quote } = await service();
  const plan = store.create(PLAN, null, "user");
  const r = await quote({ subjects: [{ kind: "element", blockId: plan.id, line: 5, revision: plan.revision }], place: { kind: "detached" } }) as Extract<QuoteReceipt, { block: unknown }>;
  expect(store.get(plan.id)!.text.split("\n")[3]).toBe("::graph-table ^bed-jobs");
  expect(r.subjects).toEqual([expect.objectContaining({ ref: `${plan.id}^bed-jobs`, kind: "component", label: "Bed jobs", anchored: true })]);
  expect(r.block.text).toBe(`Bed jobs [header::none]\n[from::((${plan.id}^bed-jobs))]\n!((${plan.id}^bed-jobs))`);
  expect(r.block).toMatchObject({ author: "agent", actorId: "fern" });
  const holder = store.get(r.block.parentId!)!;
  expect(holder.text.split("\n")[0]).toBe(".detached [page::.detached]");
  // A second detach goes under the same page, after the first; an anchored element keeps its anchor.
  const again = await quote({ subjects: [{ kind: "element", blockId: plan.id, anchor: "bed-jobs" }], place: { kind: "detached" } }) as Extract<QuoteReceipt, { block: unknown }>;
  expect(again.block.parentId).toBe(holder.id);
  expect(store.children(holder.id).map((b: Block) => b.id)).toEqual([r.block.id, again.block.id]);
  expect(again.subjects[0]!.anchored).toBeUndefined();
});

test("into a note: a reference (!((…)) for a figure, ((…)) for a list item) or a copy of the figure with its query, after the drop's line", async () => {
  const { store, quote } = await service();
  const plan = store.create(PLAN, null, "user");
  const pad = store.create("Sticky pad\nKept beside the plan:\nThe end.", null, "user");
  const figure = await quote({ subjects: [{ kind: "element", blockId: plan.id, line: 3, revision: plan.revision }], place: { kind: "into", blockId: pad.id, line: 1 } });
  expect(figure).toMatchObject({ into: { blockId: pad.id, outcome: "applied" } });
  // A block of its own (PIE-1357): a blank line before and after it.
  expect(store.get(pad.id)!.text).toBe(`Sticky pad\nKept beside the plan:\n\n!((${plan.id}^bed-jobs))\n\nThe end.`);
  const plan2 = store.get(plan.id)!;
  await quote({ subjects: [{ kind: "element", blockId: plan.id, line: 13, revision: plan2.revision }], place: { kind: "into", blockId: pad.id, line: 3 } });
  expect(store.get(pad.id)!.text.split("\n").slice(3, 7)).toEqual([`!((${plan.id}^bed-jobs))`, "", `((${plan.id}^stake-the-peas))`, ""]);
  // A copy: the figure's own lines, its query with them, its anchor left in the plan.
  await quote({ subjects: [{ kind: "element", blockId: plan.id, anchor: "bed-jobs" }], place: { kind: "into", blockId: pad.id, line: 0 }, as: "copy" });
  expect(store.get(pad.id)!.text.split("\n").slice(1, 9)).toEqual(["", "::graph-table", "---", "title: Bed jobs", 'query: "parent:this"', "---", "::", ""]);
});

test("refused, nothing written: a stale line, a line no part holds, a note into itself, a mark copied", async () => {
  const { store, quote } = await service();
  const plan = store.create(PLAN, null, "user");
  await expect(quote({ subjects: [{ kind: "element", blockId: plan.id, line: 3, revision: plan.revision + 1 }], place: { kind: "detached" } })).rejects.toThrow(/changed since revision/);
  await expect(quote({ subjects: [{ kind: "element", blockId: plan.id, line: 2, revision: plan.revision }], place: { kind: "detached" } })).rejects.toThrow(/in no part/);
  const pad = store.create("Pad", null, "user");
  await expect(quote({ subjects: [{ kind: "element", blockId: plan.id, anchor: "nope" }], place: { kind: "into", blockId: pad.id, line: 0 } })).rejects.toThrow(/no \^nope/);
  await expect(quote({ subjects: [{ kind: "element", blockId: plan.id, anchor: "nope" }], place: { kind: "into", blockId: plan.id, line: 0 } })).rejects.toThrow(/into itself/);
  await expect(quote({ subjects: [{ kind: "mark", id: plan.id }], as: "copy" })).rejects.toThrow(/copy is for an element/);
  expect(store.get(plan.id)!.text).toBe(PLAN);
});

test("two parts of one note named at one revision both get their anchors; a refused quote into itself writes none; a drop line that moved is found where it is", async () => {
  const { store, quote } = await service();
  const plan = store.create(PLAN, null, "user");
  const pad = store.create("Pad\nFirst.\nSecond.", null, "user");
  const both = await quote({ subjects: [{ kind: "element", blockId: plan.id, line: 3, revision: plan.revision }, { kind: "element", blockId: plan.id, line: 13, revision: plan.revision }], place: { kind: "inbox" } }) as Extract<QuoteReceipt, { block: unknown }>;
  expect(both.subjects.map(s => s.ref)).toEqual([`${plan.id}^bed-jobs`, `${plan.id}^stake-the-peas`]);
  const before = store.get(plan.id)!;
  await expect(quote({ subjects: [{ kind: "element", blockId: plan.id, line: 10, revision: before.revision }], place: { kind: "into", blockId: plan.id, line: 0 } })).rejects.toThrow(/into itself/);
  expect(store.get(plan.id)!.revision).toBe(before.revision);
  // Dropped after "Second." (line 2), then a line written above it: it lands after "Second." where it is now.
  store.update(pad.id, "Pad\nNew line.\nFirst.\nSecond.", store.get(pad.id)!.revision, { author: "user" });
  await quote({ subjects: [{ kind: "element", blockId: plan.id, anchor: "bed-jobs" }], place: { kind: "into", blockId: pad.id, line: 2, observed: "Second." } });
  expect(store.get(pad.id)!.text).toBe(`Pad\nNew line.\nFirst.\nSecond.\n\n!((${plan.id}^bed-jobs))`);
});

test("a note with front-matter properties still has parts; a drop on a figure's opening line lands after the whole figure; a detached block's own words keep [header::none] on their first line", async () => {
  const { store, quote } = await service();
  const plan = store.create("Plan\n- re:: why\n\nIntro.\n\n::graph-stat ^beds\n- beds: 4\n::", null, "user");
  const pad = store.create("Pad\nKept here.\n\n::graph-rank\n- a: 1\n::\nThe end.", null, "user");
  const r = await quote({ subjects: [{ kind: "element", blockId: plan.id, line: 6, revision: plan.revision }], place: { kind: "detached" }, text: "Beds\nfor the winter" }) as Extract<QuoteReceipt, { block: unknown }>;
  expect(r.block.text.split("\n").slice(0, 2)).toEqual(["Beds [header::none]", "for the winter"]);
  await quote({ subjects: [{ kind: "element", blockId: plan.id, anchor: "beds" }], place: { kind: "into", blockId: pad.id, line: 3 } });
  expect(store.get(pad.id)!.text.split("\n").slice(3, 10)).toEqual(["::graph-rank", "- a: 1", "::", "", `!((${plan.id}^beds))`, "", "The end."]);
});
