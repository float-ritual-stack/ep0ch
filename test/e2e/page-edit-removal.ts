import assert from "node:assert/strict";
import type {Block, PageAddressResolution} from "../../src/types";
import {runHerdrScenario} from "./herdr-runner";

const ansi = process.argv.includes("--ansi");
const composed = process.argv.includes("--composed");
const nvim = Bun.which("nvim");
if (!nvim) throw Error("Neovim is required for this journey");
const result = await runHerdrScenario({
  name: `page-edit-removal-${composed ? "composed" : ansi ? "ansi" : "pi"}`,
  layout: composed ? "composed" : "separate",
  detailRenderer: ansi ? "ansi" : "pi-tui",
  editor: `${nvim} --clean`,
  async prepare() {},
  async run(s) {
    const terminal = await s.attachClient();
    await terminal.resize(140, 45);
    const page = await s.client.request<Block>({action: "create", text: "PAGE EDIT JOURNEY\n[page::pie]\n\nKeep my writing"});
    await s.client.request({action: "pages.alias", blockId: page.id, address: "scratch-alias"});
    await s.revealTree(s.panes.tree, page.id);
    await s.keys(s.panes.tree, "alt+enter");
    await s.waitVisible(s.panes.detail, "Keep my writing");
    await s.focus(s.panes.detail);
    if (composed) await s.waitFor("Detail region ready for editor", s.registrations, entries => entries.some(c => c.runtime?.paneId === s.panes.detail && c.focusedRegion === "detail"));
    await s.checkpoint("01-page-before-edit");
    await s.keys(s.panes.detail, "ctrl+e");
    await s.waitVisible(s.panes.detail, "draft.md");
    // Delete the declaration in the actual editor, retaining the note body.
    await terminal.write(":2d\rGoMore writing\x1b:wq\r");
    await s.waitVisible(s.panes.detail, "Imported $EDITOR changes");
    await s.checkpoint("02-page-removed-in-draft");
    await s.keys(s.panes.detail, "ctrl+s");
    await s.waitFor("human save removes page declaration", () => s.client.request<Block>({action: "get", blockId: page.id}),
      b => b.text === "PAGE EDIT JOURNEY\n\nKeep my writing\nMore writing\n");
    assert.equal((await s.client.request<PageAddressResolution>({action: "pages.resolve", address: "pie"})).status, "missing");
    assert.equal((await s.client.request<PageAddressResolution>({action: "pages.resolve", address: "scratch-alias"})).block?.id, page.id);
    await s.checkpoint("03-saved-with-alias-intact");
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
