// `lists.read`'s lists about one note and about the asker's own parts (src/about-producers.ts): one test a producer,
// over a scratch service in a temp folder. Every note is made up (a garden: a bed, a seed list).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionRow } from "@ep0ch/outline-core/action-row";
import type { ListAnswer, ListCell } from "@ep0ch/outline-core/list-row";
import type { DiffPrimitive } from "@ep0ch/outline-core/note-page";
import { OutlinerClient } from "../src/client";
import { listSources } from "../src/list-producers";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { textDiff } from "../src/text-diff";
import type { AnnotationBatchReceipt, Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const AGENT = { author: "agent" as const, actorId: "tidy-agent" };

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-about-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const list = (from: string, more: Record<string, unknown> = {}) => client.request<ListAnswer>({ action: "lists.read", from, ...more } as never);
  const bed = await create("North bed [type::bed]\nPeas go in first.\nThe beans go in May.\nWater at dusk.");
  return { client, create, list, bed };
}

const cellsOf = (cells: ListCell[] | undefined) => (cells ?? []).map(cell => typeof cell === "object" ? [cell.text, cell.act] : [String(cell)]);

test("threads: a note's comments, a row a thread with its passage and replies under it, and reply and resolve as its presses", async () => {
  const { client, list, bed } = await setup();
  expect((await list("threads", { of: bed.id })).list).toMatchObject({ rows: [], empty: "No comments on this note yet." });
  const made = await client.request<AnnotationBatchReceipt>({ action: "annotations.batch", requestId: "comment-1", author: "user", operations: [
    { operationId: "1", type: "block-comment", input: { blockId: bed.id, expectedRevision: bed.revision, body: "June is safer for the beans.\nThe frost came late last year.", source: "user", passage: { quote: "The beans go in May." } } },
  ] } as never);
  const thread = made.annotations[0]!.block.id;
  await client.request({ action: "annotations.reply", requestId: "reply-1", author: "agent", provenance: { actorId: "tidy-agent" }, input: { annotationId: thread, body: "Moved to June in the plan.", source: "agent" } } as never);
  const open = await list("threads", { of: bed.id });
  expect(open.list.groups).toMatchObject([{ name: "open", label: "Open", count: 1 }]);
  expect(open.list.rows).toHaveLength(1);
  const row = open.list.rows[0]!;
  expect(row).toMatchObject({ id: thread, label: "June is safer for the beans.", group: "open" });
  expect(row.detail).toContain("you");
  expect(row.detail).toContain("1 reply");
  expect(row.detail).toContain("on “The beans go in May.”");
  // Its own presses are cells, each with the line it runs, by the door's names: a client writes none.
  expect(cellsOf(row.cells)).toEqual([["Reply", `reply thread="${thread}"`], ["Resolve", `resolve thread="${thread}"`]]);
  // Under it: the passage, the comment whole, then the reply and who wrote it.
  const said = (row.view as { children: { type: string; text: string }[] }).children.map(child => child.text);
  expect(said[0]).toBe("“The beans go in May.”");
  expect(said[2]).toBe("June is safer for the beans.\nThe frost came late last year.");
  expect(said[3]).toContain("tidy-agent");
  expect(said[4]).toBe("Moved to June in the plan.");
  // Resolved, it is an earlier one, and its press reopens it.
  await client.request({ action: "annotations.lifecycle", input: { annotationId: thread, lifecycle: "resolved" }, mutation: { author: "user" } } as never);
  const earlier = await list("threads", { of: bed.id });
  expect(earlier.list.rows[0]).toMatchObject({ group: "earlier", mark: "resolved" });
  expect(cellsOf(earlier.list.rows[0]!.cells)[1]).toEqual(["Reopen", `resolve thread="${thread}" open="true"`]);
  await expect(list("threads")).rejects.toThrow("is about one note");
});

test("proposals: the edits waiting beside a note, each with its change as lines and apply and dismiss as its presses", async () => {
  const { client, list, bed } = await setup();
  expect((await list("proposals", { of: bed.id })).list.rows).toEqual([]);
  const proposed = await client.request<{ outcome: string; proposalId: string }>({ action: "draft.patch", propose: true, blockId: bed.id, revision: bed.revision, patches: [{ observed: "The beans go in May.", replacement: "The beans go in June." }], mutation: AGENT } as never);
  expect(proposed.outcome).toBe("proposed");
  const listed = await list("proposals", { of: bed.id });
  expect(listed.list.rows).toHaveLength(1);
  const row = listed.list.rows[0]!;
  expect(row).toMatchObject({ id: proposed.proposalId, label: "An edit from tidy-agent" });
  expect(cellsOf(row.cells)).toEqual([["Apply", `proposal.apply id="${proposed.proposalId}"`], ["Dismiss", `proposal.dismiss id="${proposed.proposalId}"`]]);
  // The change is the service's to find: the passage against what it becomes, under where it is in the note now.
  expect(row.view).toEqual({ type: "diff", from: "the note now", to: "with the edit", added: 1, removed: 1, lines: [
    { op: "skip", text: "line 3 of 4" }, { op: "del", text: "The beans go in May." }, { op: "add", text: "The beans go in June." },
  ] } satisfies DiffPrimitive);
  // Dismissed on the wire, it is listed no longer.
  await client.request({ action: "draft.proposal.dismiss", proposalId: proposed.proposalId, mutation: { author: "user" } } as never);
  expect((await list("proposals", { of: bed.id })).list.rows).toEqual([]);
});

test("revisions: the texts a note had, newest first; an open one carries its change against the note now and restore as its press", async () => {
  const { client, list, bed } = await setup();
  const second = await client.request<Block>({ action: "update", blockId: bed.id, text: bed.text.replace("May", "June"), expectedRevision: bed.revision, mutation: AGENT } as never);
  const folded = await list("revisions", { of: bed.id });
  expect(folded.list.rows.map(r => [r.id, r.folds ?? false, r.open ?? false])).toEqual([[String(second.revision), false, false], [String(bed.revision), true, false]]);
  expect(folded.list.rows[0]!.label).toBe(`Revision ${second.revision} · the note now`);
  expect(folded.list.rows[0]!.detail).toContain("by tidy-agent");
  expect(folded.list.rows[1]!.detail).toContain("North bed");
  expect(folded.list.rows.every(r => r.view === undefined)).toBe(true);
  expect(cellsOf(folded.list.rows[1]!.cells)).toEqual([["Restore", `revision.restore revision="${bed.revision}"`]]);
  // Named in `open`, the earlier one carries what was there and what came since; the one the note is at never folds.
  const opened = await list("revisions", { of: bed.id, open: [String(bed.revision), String(second.revision)] });
  expect(opened.open).toEqual([String(bed.revision)]);
  expect(opened.list.rows[1]).toMatchObject({ open: true, view: { type: "diff", from: `revision ${bed.revision}`, to: `the note now (revision ${second.revision})`, added: 1, removed: 1 } });
  const lines = (opened.list.rows[1]!.view as DiffPrimitive).lines;
  expect(lines.filter(line => line.op !== "same")).toEqual([{ op: "del", text: "The beans go in May." }, { op: "add", text: "The beans go in June." }]);
  expect(opened.list.rows[0]!.view).toBeUndefined();
});

test("a change is found once, by the service: a long run both sides share is said, not listed", () => {
  const before = Array.from({ length: 20 }, (_, n) => `row ${n + 1}`);
  const after = before.map((line, n) => n === 9 ? "row ten" : line);
  const diff = textDiff(before.join("\n"), after.join("\n"), { from: "then", to: "now" });
  expect(diff).toMatchObject({ type: "diff", from: "then", to: "now", added: 1, removed: 1 });
  expect(diff.lines.map(line => `${line.op} ${line.text}`)).toEqual([
    "skip 6 lines the same", "same row 7", "same row 8", "same row 9", "del row 10", "add row ten", "same row 11", "same row 12", "same row 13", "skip 7 lines the same",
  ]);
  expect(textDiff("a\nb", "a\nb").lines).toEqual([{ op: "skip", text: "The same text." }]);
});

/** A window's actions as it would hand them over: made up, in outline-core's shape. */
const ROWS: ActionRow[] = [
  { id: "bed.dig", summary: "dig the bed over", args: {}, touches: "nothing", keys: [{ keys: "mod+d", does: "dig the bed" }] },
  { id: "bed.sow", summary: "sow a crop", args: { crop: { type: "string", about: "what to sow" }, rows: { type: "number", optional: true, about: "how many rows" } }, touches: "nothing",
    keys: [{ keys: "s", on: "bed", does: "sow peas", args: { crop: "peas" } }, { keys: "shift+s", on: "bed", does: "sow, asking what", says: "sow something" }, { via: "the seed list's row" }] },
  { id: "shed.lock", summary: "lock the shed", args: {}, touches: "nothing", keys: [{ via: "the padlock" }] },
];

test("actions: the asker's own rows as the ways to press them, a table whose lines are written by the one writer", async () => {
  const { list } = await setup();
  const keys = await list("actions", { actions: ROWS });
  expect(keys.list).toMatchObject({ arrange: "table", columns: ["keys", "act", "where", "does"], title: "Keys · 3 bound" });
  expect(keys.list.groups).toEqual([{ name: "everywhere", label: "everywhere", count: 1 }, { name: "bed", label: "bed", count: 2 }, { name: "no key", label: "no key", count: 1 }]);
  expect(keys.list.rows.map(r => r.cells)).toEqual([
    ["mod+d", "bed.dig", "everywhere", "dig the bed"],
    ["s", 'bed.sow crop="peas"', "bed", "sow peas"],
    ["shift+s", "bed.sow", "bed", "sow, asking what"],
    ["", "shed.lock", "the padlock", "lock the shed"],
  ]);
  // A pick runs the line; one that leaves out an argument its action can't run without runs nothing.
  expect(keys.list.rows.map(r => r.act)).toEqual(["bed.dig", 'bed.sow crop="peas"', undefined, "shed.lock"]);
  // Words narrow it: a key, an action, what it does.
  expect((await list("actions", { actions: ROWS, query: "sow" })).list.rows.map(r => r.id)).toEqual(["bed.sow#0", "bed.sow#1"]);
  await expect(list("actions")).rejects.toThrow("hand them over as actions=");
});

test("components: every component under its group, a row that folds; an open one carries its example as written and as drawn", async () => {
  const { list } = await setup();
  const all = await list("components");
  expect(all.list.rows.length).toBeGreaterThan(30);
  expect(all.list.rows.every(r => r.folds && !r.open && r.view === undefined)).toBe(true);
  expect(all.list.groups!.map(g => g.count).reduce((a, b) => a + b, 0)).toBe(all.list.rows.length);
  const callout = all.list.rows.find(r => r.id === "callout")!;
  expect(callout).toMatchObject({ label: "Callouts", mark: "callout", group: "layout" });
  const stat = await list("components", { open: ["graph-stat"], query: "stat" });
  expect(stat.open).toEqual(["graph-stat"]);
  const row = stat.list.rows.find(r => r.id === "graph-stat")!;
  const [intro, written, drawn] = (row.view as { children: { type: string; title?: string; text?: string; children?: { type: string; kind?: string; view?: { type: string } }[] }[] }).children;
  expect(intro).toMatchObject({ type: "blockdown" });
  expect(written).toMatchObject({ type: "box", title: "As written", children: [{ type: "source" }] });
  // Drawn as a page draws it: the parts `notes.page` would answer for a note that held the example.
  expect(drawn).toMatchObject({ type: "box", title: "As drawn" });
  expect(drawn!.children!.some(part => part.type === "part" && part.kind === "figure" && part.view!.type === "row")).toBe(true);
});

test("each says what it reads, so a tile is handed its parameters by name", () => {
  const by = Object.fromEntries(listSources().map(s => [s.from, s.params.map(p => `${p.name}${p.required ? "" : "?"}`)]));
  expect(by).toMatchObject({ threads: ["of"], proposals: ["of"], revisions: ["of", "open?"], actions: ["actions", "query?"], components: ["query?", "open?", "of?"] });
});
