import assert from "node:assert/strict";
import {visibleWidth} from "@earendil-works/pi-tui";
import type {Block} from "../../src/types";
import {runHerdrScenario} from "./herdr-runner";

const composed = process.argv.includes("--composed");
const result = await runHerdrScenario({
  name: "tree-indentation", layout: composed ? "composed" : "separate",
  // The indentation badge is a pinned Tree bar button. Composed Tree is a narrow column whose bar keeps only the
  // pins that fit (the chrome budget, PIE-525, a0af73f53), so there the badge is pinned alone.
  uiConfig: {bar: {tree: composed ? ["tree.indentation.toggle"] : ["tree.menu.note", "tree.menu.view", "tree.indentation.toggle"]}},
  async prepare() {},
  async run(s) {
    const terminal = await s.attachClient();
    await terminal.resize(composed ? 420 : 180, 52);
    const tree = s.panes.tree;
    const root = await s.client.request<Block>({action: "create", text: "Indent root"});
    let selected = root;
    for (let i = 1; i <= 6; i++) selected = await s.client.request<Block>({action: "create", parentId: selected.id, text: `Indent level ${i}`});
    await s.client.request({action: "create", text: "Other shallow row"});
    await s.revealTree(tree, selected.id);
    // The Tree row: its glyph right before the title. Composed, the same line also holds Current and Preview, whose
    // own text can name the selected note beside a seeded row's ‹.
    const titleLine = (frame: string, title: string) => frame.split("\n").find(line => line.includes(`• ${title}`) || line.includes(`▾ ${title}`) || line.includes(`▸ ${title}`) || line.includes(`‹ ${title}`));
    await s.waitFor("deep child in viewport", () => s.visible(tree), frame => !!titleLine(frame, "Indent level 6"));
    const before = await s.visible(tree);
    const originalColumn = titleLine(before, "Indent level 6")!.indexOf("Indent level 6");
    assert.ok(titleLine(before, "Indent root"), "shallow ancestor remains visible");
    await s.keys(tree, "alt+i");
    // The badge can be drawn a frame before the rows take the new indentation: wait for both.
    const following = await s.waitFor("Tree follows the selection's indentation", () => s.visible(tree), frame =>
      frame.includes("[Indent: selection]") && !!titleLine(frame, "Indent root")?.includes("‹"));
    assert.ok(titleLine(following, "Indent level 6")!.indexOf("Indent level 6") < originalColumn);
    await s.checkpoint("01-selection-follows-with-shallow-rows-visible");
    // Native click on the badge must toggle this same Tree without changing its root.
    await s.focus(tree);
    const frame = await s.waitFor("attached selection badge", () => terminal.visible(), text => text.includes("[Indent: selection]"));
    const lines = frame.split("\n");
    const row = lines.findIndex(line => line.includes("[Indent: selection]"));
    const column = visibleWidth(lines[row]!.slice(0, lines[row]!.indexOf("[Indent: selection]"))) + 2;
    await terminal.write(`\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`);
    const restored = await s.waitVisible(tree, "[Indent: viewport]");
    assert.equal(titleLine(restored, "Indent level 6")!.indexOf("Indent level 6"), originalColumn);
    await s.checkpoint("02-badge-restores-viewport-alignment");
    assert.equal((await s.client.request<Block>({action: "get", blockId: selected.id})).revision, selected.revision);
    await s.record("indentation-evidence", {selected: selected.id, originalColumn, composed, canonicalUnchanged: true});
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
