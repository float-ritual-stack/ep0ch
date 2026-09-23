import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Block } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

const result = await runHerdrScenario({
  name: "composed-boundaries", layout: "composed",
  async prepare(root) { await writeFile(join(root, "generated.md"), "GENERATED-RESOURCE-CONTENT"); },
  async run(session) {
    const terminal = await session.attachClient();
    const pane = session.panes.tree;
    await session.focus(pane);
    const [primary] = await session.registrations();
    assert.ok(primary && primary.role === "composed");
    const first = await session.client.request<Block>({action: "create", parentId: null, text: "PIE283 draft owner A"});
    const second = await session.client.request<Block>({action: "create", parentId: null, text: "PIE283 publication B"});
    const third = await session.client.request<Block>({action: "create", parentId: null, text: "PIE283 publication C"});
    await session.revealTree(pane, first.id);
    await session.keys(pane, "enter");
    await session.waitFor("A Current ready", session.registrations, values => values[0]?.currentTarget?.kind === "block" && values[0].currentTarget.blockId === first.id && values[0].focusedRegion === "detail");
    await session.keys(pane, "q");
    await session.waitFor("Tree ready for publication race", session.registrations, values => values[0]?.focusedRegion === "tree");
    await session.checkpoint("01-original-owner");
    await session.enableComposedResponseBarriers();
    const publicationB = session.holdComposedResponse({action: "browsing-context.publish", contains: second.id});
    const publicationC = session.holdComposedResponse({action: "browsing-context.publish", contains: third.id});
    const editProtection = session.holdComposedResponse({action: "clients.update", contains: '"navigationProtection":"active edit or source selection"'});
    await session.keys(pane, "down");
    await session.waitFor("publication B held", () => publicationB.state, value => value === "held");
    await session.keys(pane, "down");
    await terminal.write("\u001b[17~");
    await session.keys(pane, "e");
    await session.waitFor("edit protection reply held", () => editProtection.state, value => value === "held");
    await session.record("interleaving-before-publication-release", {publicationB: publicationB.state, publicationC: publicationC.state, editProtection: editProtection.state});
    publicationB.release();
    // The pump starts C only after B's publication returns. This is a positive
    // completion barrier while the protection reply is held, not a timing sleep.
    await session.waitFor("publication B finished while edit protection reply remains held", () => publicationC.state, value => value === "held");
    assert.equal(editProtection.state, "held");
    const held = (await session.registrations())[0]!;
    await session.record("interleaving-after-publication-release", {publicationB: publicationB.state, publicationC: publicationC.state, editProtection: editProtection.state, registration: held});
    await session.checkpoint("02-publication-finished-draft-protected");
    editProtection.release();
    await session.waitVisible(pane, "Editing");
    await session.text(pane, " SAVED-TO-A");
    await terminal.write("\u0013");
    const after = await session.waitFor("edit saved", () => Promise.all([first, second, third].map(block => session.client.request<Block>({action: "get", blockId: block.id}))), blocks => blocks.some(block => block.text.endsWith(" SAVED-TO-A")));
    await session.record("saved-draft-owners", {before: [first, second, third], after});
    await session.checkpoint("03-draft-save-owner");
    assert.deepEqual(held.currentTarget, {kind: "block", blockId: first.id});
    assert.equal(after[0]!.text, `${first.text} SAVED-TO-A`);
    assert.equal(after[1]!.text, second.text);
    assert.equal(after[2]!.text, third.text);
    publicationC.release();

    // Generated Resources and Outlinks preserve the Tree occurrence while
    // replacing the primary Detail. No independent reader is needed.
    await session.keys(pane, "q");
    await session.waitFor("Tree focused after save", session.registrations, values => values[0]?.focusedRegion === "tree" && !values[0]?.navigationProtection);
    await session.client.request({action: "resources.intern-filesystem", input: {path: "generated.md"}});
    const host = await session.client.request<Block>({action: "create", parentId: null, text: `PIE283 generated links\n[file::generated.md]\n((${second.id}))`});
    await session.revealTree(pane, host.id);
    await session.keys(pane, "?");
    await session.waitVisible(pane, "Find:");
    await session.text(pane, "Show authored links");
    await session.keys(pane, "enter");
    await session.waitVisible(pane, "Authored links shown");
    await session.keys(pane, "down", "down");
    let selection = await session.waitFor("generated Outlink selected", session.registrations, values => values[0]?.treeSelection?.target.kind === "block" && values[0].treeSelection.target.blockId === second.id && values[0].treeSelection.rowId !== second.id);
    const beforeLink = selection[0]!.treeSelection;
    await session.keys(pane, "enter");
    await session.waitFor("generated Outlink opened locally", session.registrations, values => values[0]?.currentTarget?.kind === "block" && values[0].currentTarget.blockId === second.id && values[0].focusedRegion === "detail");
    assert.deepEqual((await session.registrations())[0]!.treeSelection, beforeLink);
    assert.equal((await session.registrations()).length, 1);
    await session.checkpoint("04-generated-outlink-local");
    await session.setRegistryUnavailable(true);
    await session.waitFor("registry unavailable", session.registrations, values => !values[0]?.runtime?.paneId);
    await session.keys(pane, "q", "down", "down");
    selection = await session.waitFor("generated Resource selected", session.registrations, values => values[0]?.treeSelection?.target.kind === "resource");
    const beforeResource = selection[0]!.treeSelection;
    await session.keys(pane, "enter");
    await session.waitFor("generated Resource opened without discovery", session.registrations, values => values[0]?.currentTarget?.kind === "resource" && values[0].focusedRegion === "detail");
    await session.waitVisible(pane, "GENERATED-RESOURCE-CONTENT");
    assert.deepEqual((await session.registrations())[0]!.treeSelection, beforeResource);
    assert.equal((await session.registrations()).length, 1);
    await session.checkpoint("05-generated-resource-without-discovery");
    await session.keys(pane, "q", "up", "up", "enter");
    await session.waitFor("generated Outlink opened without discovery", session.registrations, values => values[0]?.currentTarget?.kind === "block" && values[0].currentTarget.blockId === second.id && values[0].focusedRegion === "detail");
    assert.deepEqual((await session.registrations())[0]!.treeSelection, beforeLink);
    await session.checkpoint("06-generated-outlink-without-discovery");
    await session.setRegistryUnavailable(false);
    await session.waitFor("registry restored", session.registrations, values => values[0]?.runtime?.paneId === pane);
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
