import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Block, InternResourceReceipt, NavigationLinkState, OutlinerClientRegistration, ResourceDescription } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

const composed = process.argv.includes("--composed");
const result = await runHerdrScenario({
  name: composed ? "linked-opens-composed" : "linked-opens", layout: composed ? "composed" : "separate",
  async prepare(root) { await writeFile(join(root, "linked-resource.md"), "LINKED RESOURCE PINNED BYTES\n"); await writeFile(join(root, "cancelled-resource.md"), "RESOURCE CHOOSER BYTES\n"); },
  async run(session) {
    const terminal = await session.attachClient();
    await terminal.resize(240, 64);
    const initial = await session.registrations();
    const a = initial.find(c => c.role === (composed ? "composed" : "tree"))!;
    const x = initial.find(c => c.role === (composed ? "composed" : "detail"))!;
    const second = await session.openRemoteBrowsingContext();
    const third = await session.openRemoteBrowsingContext({name: "third"});
    const clients = await session.registrations();
    const at = (pane: string, role: "tree" | "detail") => clients.find(c => c.runtime?.paneId === pane && c.role === role)!;
    const b = at(second.tree, "tree"), c = at(third.tree, "tree"), y = at(second.detail, "detail");
    assert.ok(a && b && c && x && y);
    const leaf = await session.client.request<Block>({action: "create", text: "LINKED Y TARGET\n\nY changes only on explicit Open"});
    const yInitial = await session.client.request<Block>({action: "create", text: "UNRELATED Y START"});
    const docs: Block[] = [];
    for (const name of ["A", "B", "C"]) docs.push(await session.client.request<Block>({action: "create", text: `LINKED ${name} DOCUMENT\n\n((${leaf.id}))`}));
    const current = async (id: string) => (await session.registrations()).find(c => c.clientId === id)?.currentTarget;
    const linkTree = async (source: OutlinerClientRegistration, pane: string) => {
      await session.focus(pane);
      await session.keys(pane, "?"); await session.text(pane, "Link destination"); await session.keys(pane, "enter");
      await session.waitVisible(pane, "Unlink destination");
      await session.text(pane, x.runtime!.paneId!); await session.keys(pane, "enter");
      await session.waitFor("Tree link set", () => session.client.request<NavigationLinkState>({action: "navigation.link.get", source: {clientId: source.clientId, region: "tree"}}), value => value.destination?.clientId === x.clientId);
    };
    // Initial creation explicitly links A to its new reader. Reconfigure B/C through the UI.
    for (const [source, pane] of [[b, second.tree], [c, third.tree]] as const) await linkTree(source, pane);
    await session.client.request({action: "ui.command.send", command: {targetClientId: x.clientId, targetRegion: "detail", command: "focus"}});
    await session.keys(session.panes.detail, "?"); await session.waitFor("Detail actions open", () => session.visible(session.panes.detail), text => text.includes("Find:")); await session.text(session.panes.detail, "Link destination"); await session.keys(session.panes.detail, "enter");
    await session.waitFor("Detail link destinations", () => session.visible(session.panes.detail), text => text.includes("Unlink destination"));
    await session.text(session.panes.detail, y.runtime!.paneId!); await session.keys(session.panes.detail, "enter");
    await session.waitFor("Detail link set", () => session.client.request<NavigationLinkState>({action: "navigation.link.get", source: {clientId: x.clientId, region: "detail"}}), state => state.destination?.clientId === y.clientId);
    // Passive Tree selection updates Preview while Y retains its Current document.
    await session.client.request({action: "ui.command.send", command: {targetClientId: y.clientId, command: "replace", target: {kind: "block", blockId: yInitial.id}}});
    await session.waitVisible(second.detail, "UNRELATED Y START");
    for (const [index, pane] of [session.panes.tree, second.tree, third.tree].entries()) {
      await session.revealTree(pane, docs[index]!.id);
      const yBefore = await current(y.clientId);
      await session.keys(pane, "enter");
      await session.waitFor("linked receiver document", () => current(x.clientId), target => target?.kind === "block" && target.blockId === docs[index]!.id);
      assert.deepEqual(await current(y.clientId), yBefore);
    }
    await session.checkpoint("01-three-sources-one-destination");
    await session.focus(session.panes.detail);
    if (composed) {
      await session.client.request({action: "ui.command.send", command: {targetClientId: x.clientId, targetRegion: "detail", command: "focus"}});
    }
    await session.keys(session.panes.detail, "o"); await session.waitVisible(session.panes.detail, "Choose destination"); await session.keys(session.panes.detail, "enter");
    await session.waitFor("X explicitly opens Y", () => current(y.clientId), target => target?.kind === "block" && target.blockId === leaf.id);
    assert.equal((await current(x.clientId))?.kind, "block");
    await session.checkpoint("02-explicit-chain-only");
    // One-off Tree menu leaves B's permanent X link unchanged.
    await session.revealTree(second.tree, docs[0]!.id);
    await session.keys(second.tree, "?"); await session.text(second.tree, "Open once"); await session.keys(second.tree, "enter");
    await session.waitFor("one-off destinations", () => session.visible(second.tree), frame => frame.includes("/ detail") && frame.includes("Find:")); await session.text(second.tree, y.runtime!.paneId!); await session.keys(second.tree, "enter");
    await session.waitFor("one-off Y", () => current(y.clientId), target => target?.kind === "block" && target.blockId === docs[0]!.id);
    assert.equal((await session.client.request<NavigationLinkState>({action: "navigation.link.get", source: {clientId: b.clientId, region: "tree"}})).destination?.clientId, x.clientId);
    const {resource} = await session.client.request<InternResourceReceipt>({action: "resources.intern-filesystem", input: {path: "linked-resource.md"}});
    const description = await session.client.request<ResourceDescription>({action: "resources.describe", destinationClientId: x.clientId, target: {kind: "resource", resourceId: resource.id}});
    const target = {kind: "resource" as const, resourceId: resource.id, revision: description.filesystem!.revision};
    await session.focus(session.panes.detail);
    await session.keys(session.panes.detail, "e"); await session.text(session.panes.detail, " UNSAVED LINKED DRAFT");
    await session.waitFor("draft protection registered", session.registrations, values => Boolean(values.find(v => v.clientId === x.clientId)?.navigationProtection));
    await session.revealTree(third.tree, docs[1]!.id); await session.keys(third.tree, "enter");
    await session.waitVisible(third.tree, "Destination is protected"); await session.waitVisible(session.panes.detail, "UNSAVED LINKED DRAFT");
    await assert.rejects(session.client.request({action:"navigation.dispatch",sourceClientId:b.clientId,intent:"open",target}),/protected/);
    await session.waitVisible(session.panes.detail,"UNSAVED LINKED DRAFT");
    await session.checkpoint("03-protected-draft-no-fallback");
    await session.focus(session.panes.detail); await session.keys(session.panes.detail, "escape");
    await session.waitFor("draft protection released", session.registrations, values => !values.find(v => v.clientId === x.clientId)?.navigationProtection);
    await session.client.request({action: "navigation.dispatch", sourceClientId: b.clientId, intent: "open", target});
    await session.waitVisible(session.panes.detail, "LINKED RESOURCE PINNED BYTES"); assert.deepEqual(await current(x.clientId), target);
    await session.checkpoint("04-resource-identity-and-revision");
    await session.focus(session.panes.detail);await session.keys(session.panes.detail,"v");
    await session.waitFor("exact source selection protected",session.registrations,values=>Boolean(values.find(v=>v.clientId===x.clientId)?.navigationProtection));
    await assert.rejects(session.client.request({action:"ui.command.send",command:{targetClientId:x.clientId,targetRegion:"detail",command:"replace",target:{kind:"block",blockId:docs[0]!.id}}}),/protected/);
    await assert.rejects(session.client.request({action:"navigation.dispatch",sourceClientId:b.clientId,intent:"open",target}),/protected/);
    assert.deepEqual(await current(x.clientId),target);
    await session.checkpoint("04a-resource-selection-preserved");
    await session.keys(session.panes.detail,"escape");
    await session.waitFor("source selection released",session.registrations,values=>!values.find(v=>v.clientId===x.clientId)?.navigationProtection);
    const resourceHost = await session.client.request<Block>({action: "create", text: "Cancellable Resource choice [file::cancelled-resource.md]"});
    await session.client.request({action: "ui.command.send", command: {targetClientId: x.clientId, targetRegion: "detail", command: "replace", target: {kind: "block", blockId: resourceHost.id}}});
    await session.waitVisible(session.panes.detail, "Cancellable Resource choice");
    const countResources = () => session.database.query("SELECT count(*) AS count FROM resources").get();
    const beforeChoice = countResources();
    await session.keys(session.panes.detail, "o"); await session.waitVisible(session.panes.detail, "Choose destination");
    await session.keys(session.panes.detail, "c");
    await session.waitFor("one-off Detail menu", () => session.visible(session.panes.detail), text => text.includes("Find:") && text.includes("Detail"));
    await session.keys(session.panes.detail, "escape");
    await session.waitFor("cancelled choice closed", () => session.visible(session.panes.detail), text => !text.includes("Choose destination") && !text.includes("Find:"));
    assert.deepEqual(countResources(), beforeChoice);
    assert.deepEqual(await current(x.clientId), {kind: "block", blockId: resourceHost.id});
    await session.keys(session.panes.detail, "o"); await session.waitVisible(session.panes.detail, "Choose destination"); await session.keys(session.panes.detail, "c");
    await session.waitFor("one-off Detail menu reopened", () => session.visible(session.panes.detail), text => text.includes("Find:") && text.includes("Detail"));
    await session.text(session.panes.detail, third.detail); await session.keys(session.panes.detail, "enter");
    await session.waitVisible(third.detail, "RESOURCE CHOOSER BYTES");
    const resourceOpened = await current(at(third.detail, "detail").clientId);
    assert.equal(resourceOpened?.kind, "resource");
    if (resourceOpened?.kind === "resource") assert.equal(resourceOpened.referenceContext?.sourceText, resourceHost.text);
    assert.equal((await session.client.request<NavigationLinkState>({action: "navigation.link.get", source: {clientId: x.clientId, region: "detail"}})).destination?.clientId, y.clientId);
    await session.checkpoint("05-resource-choice-cancel-and-one-off");
    await session.client.request({action: "navigation.link.set", source: {clientId: b.clientId, region: "tree"}, destination: {clientId: y.clientId, region: "detail"}});
    await session.moveDetachedToNewTab(second.detail);
    await terminal.resize(180, 48);
    await session.revealTree(second.tree, docs[2]!.id); await session.keys(second.tree, "enter");
    await session.waitFor("link survives move and resize", () => current(y.clientId), target => target?.kind === "block" && target.blockId === docs[2]!.id);
    await session.closeDetached(second.detail);
    await session.waitFor("closed destination removed", session.registrations, values => !values.some(value => value.clientId === y.clientId));
    await session.revealTree(second.tree, docs[1]!.id); await session.keys(second.tree, "enter");
    await session.waitVisible(second.tree, "No linked destination");
    await session.checkpoint("06-closed-destination-explicit-recovery");
    await session.record("links", {a, b, c, x, y, target});
    for (const block of docs) assert.ok(!(await session.client.request<Block>({action: "get", blockId: block.id})).text.includes("UNSAVED LINKED DRAFT"));
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
