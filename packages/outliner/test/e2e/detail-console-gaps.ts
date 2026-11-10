// The sysop console without dead ends: a [web::…pdf] reads as a PDF in Detail (PIE-1702); Detail keeps its place
// through a long edit and a saved reply (PIE-1703): PgUp and PgDn page the editor by its drawn height, and a reply
// saved under a comment stays in view with its thread open, without `]` to find it again. PgUp/PgDn go through the
// attached terminal as a terminal sends them; the PDF is served by a local HTTP server. Made-up notes throughout.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AnnotationThread, Block, InternResourceReceipt } from "../../src/types";
import { createPdfFixture } from "../pdf-fixture";
import { runHerdrScenario } from "./herdr-runner";

const PAGE_DOWN = "\x1b[6~", PAGE_UP = "\x1b[5~";
const rows = Array.from({ length: 90 }, (_, index) => `Furrow ${String(index + 1).padStart(2, "0")} of the long bed`);

const result = await runHerdrScenario({
  name: "detail-console-gaps",
  async prepare() {},
  async run(s) {
    const terminal = await s.attachClient();
    await terminal.resize(160, 40);
    const tree = s.panes.tree, detail = s.panes.detail;

    // A [web::…pdf] reads its text in Detail, as a [file::…pdf] does.
    const paper = createPdfFixture([{ width: 300, height: 400, lines: [{ text: "Compost turns in nine weeks", x: 36, y: 350 }] }]);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/pdf");
      response.end(paper);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/compost.pdf`;
      await s.client.request<Block>({ action: "create", parentId: null, text: `Compost paper [web::${url}]` });
      const { resource } = await s.client.request<InternResourceReceipt>({ action: "resources.follow-authored", reference: { kind: "web", url } });
      const treeClient = (await s.registrations()).find(c => c.role === "tree")!;
      await s.client.request({ action: "navigation.dispatch", sourceClientId: treeClient.clientId, target: { kind: "resource", resourceId: resource.id }, intent: "open" });
      await s.focus(detail);
      await s.waitFor("Detail opened the web PDF", () => s.visible(detail), frame => frame.includes("compost.pdf") || frame.includes("Compost"));
      await s.keys(detail, "r");
      const read = await s.waitVisible(detail, "Compost turns in nine weeks");
      assert.ok(!read.includes("unsupported media type"), "The PDF is read, not refused");
      await s.checkpoint("00-web-pdf-read");
    } finally {
      server.close();
    }

    const note = await s.client.request<Block>({ action: "create", parentId: null, text: `Long bed notes\n\n${rows.join("\n")}` });
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
    // At once, as a person presses it: the saved comment is there for `]`.
    await s.keys(detail, "]");
    await s.waitVisible(detail, "Comment 1 of 1");
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
