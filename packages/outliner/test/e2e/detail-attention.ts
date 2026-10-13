// Detail's Seen / Bring back (PIE-791) in a private Herdr session: a comment on a note, selected in Detail, put away
// with D and brought back with D, then put away again by a click on its Seen control. The service's lifecycle follows
// each, and the control's word follows the lifecycle.
import assert from "node:assert/strict";
import type { AnnotationBatchReceipt, AnnotationThread, Block } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

const result = await runHerdrScenario({
  name: "detail-attention",
  layout: "separate",
  async prepare() { /* nothing on disk: the note and its comment are made through the service */ },
  async run(s) {
    const terminal = await s.attachClient();
    const { tree, detail } = s.panes;
    const text = "Pump rota\n\nSam waters the beds on Thursdays.";
    const note = await s.client.request<Block>({ action: "create", parentId: null, text });
    const quote = "waters the beds on Thursdays";
    const made = await s.client.request<AnnotationBatchReceipt>({
      action: "annotations.batch", requestId: crypto.randomUUID(), author: "user",
      operations: [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "Swap in August?", source: "user", passage: { quote, start: text.indexOf(quote) } } }],
    });
    const id = made.annotations[0]!.block.id;
    const lifecycle = async () => (await s.client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note.id }, includeResolved: true } })).find((t) => t.block.id === id)!.lifecycle;

    await s.revealTree(tree, note.id);
    await s.keys(tree, "enter");
    await s.focus(detail);
    await s.waitVisible(detail, "Swap in August?");
    await s.keys(detail, "]");
    await s.waitVisible(detail, "Seen");
    await s.checkpoint("01-thread-selected");

    await s.keys(detail, "D");
    await s.waitFor("seen by D", lifecycle, (value) => value === "seen");
    await s.waitVisible(detail, "Bring back");
    await s.checkpoint("02-seen-by-key");

    await s.keys(detail, "D");
    await s.waitFor("back by D", lifecycle, (value) => value === "open");
    await s.waitVisible(detail, "Seen");
    await s.checkpoint("03-back-by-key");

    // The pointer: a click on the Seen control does what D does.
    const frame = await s.waitFor("the Seen control drawn", () => terminal.visible(), (visible) => /· Seen\b/.test(visible));
    const lines = frame.split("\n");
    const row = lines.findIndex((line) => /· Seen\b/.test(line));
    const column = lines[row]!.indexOf("Seen");
    await s.record("seen-click", { row, column, frame });
    await terminal.write(`\u001b[<0;${column + 2};${row + 1}M`);
    await terminal.write(`\u001b[<0;${column + 2};${row + 1}m`);
    await s.waitFor("seen by a click", lifecycle, (value) => value === "seen");
    await s.waitVisible(detail, "Bring back");
    await s.checkpoint("04-seen-by-click");
    assert.equal(await lifecycle(), "seen");
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exit(1);
