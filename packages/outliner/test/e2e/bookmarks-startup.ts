import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OutlinerStore } from "../../src/store";
import type { Block, NavigationLinkState } from "../../src/types";
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
    const rootBefore = await session.client.request<Block>({ action: "get", blockId: rootId });
    const targetBefore = await session.client.request<Block>({ action: "get", blockId: targetId });
    const recordsBefore = await session.client.request<Block[]>({action: "children", parentId: rootId});
    assert.equal(rootBefore.text, editedText);
    const clientsBefore = await session.registrations();
    const tree = clientsBefore.find(client => client.runtime?.paneId === session.panes.tree && client.role === "tree")!;
    const detail = clientsBefore.find(client => client.runtime?.paneId === session.panes.detail && client.role === "detail")!;
    assert.ok(tree && detail);
    assert.notDeepEqual(detail.currentTarget, {kind: "block", blockId: targetId});
    await session.revealTree(session.panes.tree, targetId);
    await session.focus(session.panes.tree);
    await session.keys(session.panes.tree, "shift+m");
    await session.waitFor("Bookmarks opens after the edited root survives restart", () => terminal.visible(),
      frame => frame.includes("Bookmarks · split") && frame.includes("BOOKMARK-SURVIVES-PRESENTATION-EDIT"));
    const popup = await session.waitFor("bookmark popup observer registered", session.registrations,
      clients => clients.some(client => client.role === "observer" && !clientsBefore.some(before => before.clientId === client.clientId)));
    const observer = popup.find(client => client.role === "observer" && !clientsBefore.some(before => before.clientId === client.clientId))!;
    const link = await session.client.request<NavigationLinkState>({action: "navigation.link.get", source: {clientId: tree.clientId, region: "tree"}});
    assert.deepEqual(link.destination, {clientId: detail.clientId, region: "detail"});
    assert.ok(!link.destinations.some(candidate => candidate.view.clientId === observer.clientId));
    await session.checkpoint("01-bookmarks-open-after-restart");
    await terminal.write("\r");
    await session.waitFor("bookmark destination chooser", terminal.visible, frame => frame.includes("Choose destination"));
    await terminal.write("\r");
    await session.waitFor("bookmark opened in linked Detail", session.registrations, clients =>
      clients.some(client => client.clientId === detail.clientId && client.currentTarget?.kind === "block" && client.currentTarget.blockId === targetId));
    await session.waitVisible(session.panes.detail, "BOOKMARK-SURVIVES-PRESENTATION-EDIT");
    assert.deepEqual(await session.client.request<Block[]>({action: "children", parentId: rootId}), recordsBefore);
    assert.deepEqual(await session.client.request<Block>({action: "get", blockId: rootId}), rootBefore);
    assert.deepEqual(await session.client.request<Block>({action: "get", blockId: targetId}), targetBefore);
    await session.record("bookmark-open-evidence", {observer, link, recordsBefore, targetId, destinationClientId: detail.clientId});
    await session.checkpoint("01b-bookmark-open-keeps-records");
    if ((await terminal.visible()).includes("Bookmarks · split")) await terminal.write("\u001b");
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
