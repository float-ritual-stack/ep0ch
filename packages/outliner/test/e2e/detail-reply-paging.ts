// Detail keeps its place through a long edit and a saved reply (PIE-1703): PgUp and PgDn page the editor by its drawn
// height, and a reply saved under a comment stays in view with its thread open, without `]` to find it again.
// PgUp/PgDn go through the attached terminal as a terminal sends them.
import assert from "node:assert/strict";
import type { AnnotationThread, Block } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

const PAGE_DOWN = "\x1b[6~", PAGE_UP = "\x1b[5~";
const rows = Array.from({ length: 90 }, (_, index) => `Furrow ${String(index + 1).padStart(2, "0")} of the long bed`);

const result = await runHerdrScenario({
  name: "detail-reply-paging",
  async prepare() {},
  async run(s) {
    const terminal = await s.attachClient();
    await terminal.resize(160, 40);
    const note = await s.client.request<Block>({ action: "create", parentId: null, text: `Long bed notes\n\n${rows.join("\n")}` });
    const tree = s.panes.tree, detail = s.panes.detail;
    await s.revealTree(tree, note.id);
    await s.keys(tree, "enter");
    await s.waitVisible(detail, "Furrow 01 of the long bed");
    await s.focus(detail);

    // Editing a long note (the cursor opens at its end): PgUp pages the editor back, PgDn pages it on.
    await s.keys(detail, "e");
    const opened = await s.waitFor("the editor is open at the end", () => s.visible(detail), frame => frame.includes("Editing") && /92 Furrow 90 of/.test(frame));
    await terminal.write(PAGE_UP);
    const up = await s.waitFor("PgUp paged the editor", () => s.visible(detail), frame => frame.includes("Editing") && !frame.includes("Furrow 90 of") && /Furrow [5-8]\d of/.test(frame));
    await s.checkpoint("01-editor-paged-up");
    for (let press = 0; press < 12; press += 1) await terminal.write(PAGE_UP);
    await s.waitFor("PgUp reached the top", () => s.visible(detail), frame => /\b1 Long bed notes/.test(frame));
    await terminal.write(PAGE_DOWN);
    await s.waitFor("PgDn paged on", () => s.visible(detail), frame => !/\b1 Long bed notes/.test(frame) && /Furrow \d\d of/.test(frame));
    await s.checkpoint("02-editor-paged-down");
    assert.notEqual(up, opened);
    await s.keys(detail, "esc");
    await s.waitFor("the edit is left unsaved", () => s.visible(detail), frame => !frame.includes("Editing"));
    assert.equal((await s.client.request<Block>({ action: "get", blockId: note.id })).text, note.text, "Paging changed no text");
    await s.focus(detail);

    // A comment on the whole note, then a reply to it, saved: the reply stays in view.
    await s.keys(detail, "c");
    await s.waitVisible(detail, "Comment on whole note");
    await s.text(detail, "Mulch the far end first");
    await s.keys(detail, "ctrl+s");
    const threads = () => s.client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note.id }, includeResolved: true } });
    await s.waitFor("the comment is saved", threads, all => all.some(thread => thread.body === "Mulch the far end first"));
    await s.waitFor("the composer closed", () => s.visible(detail), frame => !frame.includes("Comment on whole note"));
    // `]` once Detail has the thread (its save reloads them): a person's next key comes later than ours.
    await s.waitFor("] selects the comment", async () => {
      await s.keys(detail, "]");
      await Bun.sleep(300);
      return s.visible(detail);
    }, frame => frame.includes("Comment 1 of 1"));
    await s.keys(detail, "C");
    await s.waitVisible(detail, "Reply to");
    await s.text(detail, "Done on the third pass");
    await s.waitVisible(detail, "Done on the third pass");
    await s.keys(detail, "ctrl+s");
    await s.waitFor("the reply is saved", threads, all => all.some(thread => thread.replies.some(reply => reply.body === "Done on the third pass")));
    await s.waitVisible(detail, "Reply added");
    // No `]`: the reply shows where it was written, its thread open beside it.
    await s.waitFor("the saved reply is in view, its thread open", () => s.visible(detail),
      frame => frame.includes("Done on the third pass") && frame.includes("Mulch the far end first") && !frame.includes("Reply to"));
    await s.checkpoint("03-reply-saved");
  },
});
console.log(JSON.stringify(result)); if (result.status !== "passed") process.exitCode = 1;
