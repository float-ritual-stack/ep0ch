import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OutlinerStore } from "../../src/store";
import type { Block } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

let rootId: string;
let targetId: string;
let editedText: string;
const result = await runHerdrScenario({
  name: "bookmarks-startup",
  async prepare(projectRoot, paths) {
    // Force in-terminal delivery in this isolated fixture, without a desktop daemon.
    await writeFile(join(projectRoot, "..", "xdg-config", "herdr", "config.toml"),
      'onboarding = false\n[ui.toast]\ndelivery = "herdr"\n');
    const store = new OutlinerStore(paths.database, { workspaceRoot: projectRoot });
    try {
      const target = store.create("BOOKMARK-SURVIVES-PRESENTATION-EDIT");
      targetId = target.id;
      store.toggleBookmark(targetId, null);
      const root = store.bookmarksRoot();
      rootId = root.id;
      editedText = root.text.replace("target,bookmark-created", "target");
      store.update(rootId, editedText, root.revision, { author: "user", actorId: "fixture" });
    } finally { store.close(); }
  },
  async run(session) {
    const terminal = await session.attachClient();
    assert.equal((await session.client.request<Block>({ action: "get", blockId: rootId })).text, editedText);
    await session.revealTree(session.panes.tree, targetId);
    await session.focus(session.panes.tree);
    await session.keys(session.panes.tree, "shift+m");
    await session.waitFor("Bookmarks opens after the edited root survives restart", () => terminal.visible(),
      frame => frame.includes("Bookmarks · split") && frame.includes("BOOKMARK-SURVIVES-PRESENTATION-EDIT"));
    await session.checkpoint("01-bookmarks-open-after-restart");
    await terminal.write("\u001b");
    const rejected = await session.rejectCompetingService();
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /Outliner service failed to start/);
    assert.match(rejected.stderr, /service-startup-error\.log/);
    await session.waitFor("failed startup is visible in the attached Herdr client", () => terminal.visible(),
      frame => frame.includes("Outliner service failed to start"));
    await session.record("startup-diagnostics", { rejected, rootId, targetId, editedText });
    await session.client.request({ action: "ping" });
    await session.checkpoint("02-owner-still-running-after-rejected-start");
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
