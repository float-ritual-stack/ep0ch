import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {Block, InternResourceReceipt, OutlinerClientRegistration, ResourceDescription} from "../../src/types";
import {runHerdrScenario} from "./herdr-runner";

const composed = process.argv.includes("--composed");
const ansi = process.argv.includes("--ansi");
const result = await runHerdrScenario({
  name: `local-preview${composed ? "-composed" : ansi ? "-ansi" : ""}`,
  layout: composed ? "composed" : "separate",
  async prepare(root) { await writeFile(join(root, "preview-resource.md"), "RESOURCE PREVIEW EXACT BYTES\n"); },
  async run(session) {
    const terminal = await session.attachClient();
    await terminal.resize(340, 60);
    const panes = ansi ? await session.openRemoteBrowsingContext({renderer: "ansi"}) : session.panes;
    const clients = await session.registrations();
    const tree = clients.find(c => c.runtime?.paneId === panes.tree && c.role === (composed ? "composed" : "tree"))!;
    const detail = clients.find(c => c.runtime?.paneId === panes.detail && c.role === (composed ? "composed" : "detail"))!;
    assert.ok(tree && detail);
    if (ansi) await session.client.request({action: "navigation.link.set", source: {clientId: tree.clientId, region: "tree"}, destination: {clientId: detail.clientId, region: "detail"}});
    const docs: Block[] = [];
    for (const text of ["RETAINED CURRENT", "INSPECTION ALPHA", "INSPECTION BETA", "INSPECTION GAMMA"]) docs.push(await session.client.request<Block>({action: "create", text: `${text}\n\n${Array.from({length: 70}, (_, i) => `${text} line ${i + 1}`).join("\n")}`}));
    const state = async () => (await session.registrations()).find(c => c.clientId === detail.clientId)!;
    const current = (c: OutlinerClientRegistration, id: string) => c.currentTarget?.kind === "block" && c.currentTarget.blockId === id;
    const preview = (c: OutlinerClientRegistration, id: string) => c.previewTarget?.kind === "block" && c.previewTarget.blockId === id;
    const focusDetail = async () => {
      await session.focus(panes.detail);
      if (composed) {
        await session.client.request({action: "ui.command.send", command: {command: "focus", targetClientId: detail.clientId, targetRegion: "detail"}});
        await session.waitFor("Detail region focused", state, c => c.focusedRegion === "detail");
      }
    };
    await session.revealTree(panes.tree, docs[0]!.id); await session.keys(panes.tree, "enter");
    await session.waitFor("Current explicitly opened", state, c => current(c, docs[0]!.id));
    await focusDetail(); await session.keys(panes.detail, "e"); await session.text(panes.detail, " DRAFT RETAINED ");
    await session.waitVisible(panes.detail, "DRAFT RETAINED");
    for (const doc of docs.slice(1)) {
      await session.revealTree(panes.tree, doc.id);
      await session.waitFor("local Preview updates", state, c => preview(c, doc.id));
      assert.ok(current(await state(), docs[0]!.id));
    }
    await session.checkpoint("01-current-draft-plus-preview");
    await focusDetail(); await terminal.resize(110, 38);
    await session.keys(panes.detail, "f7"); await session.waitFor("Preview visibly focused", () => session.visible(panes.detail), frame => frame.includes("● Preview"));
    await terminal.write("\x1b[13;3u");
    await session.waitVisible(panes.detail, "Finish or cancel");
    assert.ok(current(await state(), docs[0]!.id));
    await session.keys(panes.detail, "f7"); await session.waitVisible(panes.detail, "DRAFT");
    await session.keys(panes.detail, "ctrl+z");
    await session.keys(panes.detail, "escape");
    await focusDetail(); await session.keys(panes.detail, "f7");
    await terminal.write("\x1b[13;3u");
    await session.waitFor("Keep promotes Preview", state, c => current(c, docs[3]!.id) && !c.previewTarget);
    assert.equal((await session.client.request<Block>({action: "get", blockId: docs[0]!.id})).text, docs[0]!.text);
    await session.checkpoint("02-narrow-return-and-keep");
    await terminal.resize(340, 60);
    const interned = await session.client.request<InternResourceReceipt>({action: "resources.intern-filesystem", input: {path: join(session.projectRoot, "preview-resource.md")}});
    const base = {kind: "resource" as const, resourceId: interned.resource.id};
    const described = await session.client.request<ResourceDescription>({action: "resources.describe", destinationClientId: detail.clientId, target: base});
    const target = {...base, revision: described.filesystem!.revision};
    await session.client.request({action: "navigation.dispatch", sourceClientId: tree.clientId, intent: "preview", target});
    await session.waitFor("Resource Preview identity", state, c => c.previewTarget?.kind === "resource");
    assert.deepEqual((await state()).previewTarget, target);
    assert.ok(current(await state(), docs[3]!.id));
    await focusDetail(); await session.keys(panes.detail, "f7"); await session.waitVisible(panes.detail, "RESOURCE PREVIEW EXACT BYTES");
    await session.checkpoint("03-resource-preview-retains-current");
    await session.keys(panes.detail, "shift+f7");
    await session.waitFor("Preview released", state, c => !c.previewTarget);
    assert.ok(current(await state(), docs[3]!.id));
    await session.revealTree(panes.tree, docs[1]!.id); await session.keys(panes.tree, "enter");
    await session.waitFor("explicit Open still follows link", state, c => current(c, docs[1]!.id));
    await session.checkpoint("04-explicit-open-independent");
    await session.record("preview-evidence", {current: docs[1]!.id, resourceTarget: target, canonicalUnchanged: true, composed, ansi});
  },
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;
