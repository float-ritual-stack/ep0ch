import assert from "node:assert/strict";
import type { QuickCaptureDraft, VisibleBlockCollection } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

const result = await runHerdrScenario({
  name: "capture-shortcut",
  commandKeys: [{ key: "prefix+shift+c", command: "float.pi-outliner.capture" }],
  async prepare() {},
  async run(session) {
    const terminal = await session.attachClient();
    await session.waitFor("attached Herdr ready", () => terminal.visible(), screen => screen.includes("Outliner"));
    const prefixKey = async (key: string) => {
      await terminal.write("\x02");
      await session.waitFor("Herdr prefix mode", () => terminal.visible(), screen => screen.includes("PREFIX"));
      await terminal.write(key);
      await session.waitFor("Herdr command dispatched", () => terminal.visible(), screen => !screen.includes("PREFIX"));
    };
    await session.focus(session.panes.tree);
    // The fixture opens Tree to the right of its ordinary launcher shell.
    await prefixKey("h");
    await terminal.write("\x1b[200~printf 'CAPTURE_%s\\n' ORIGIN_SHELL\x1b[201~\r");
    await session.waitVisible(session.panes.launcher, "CAPTURE_ORIGIN_SHELL");
    const before = await session.client.request({ action: "selection.get" });
    const trees = (await session.registrations()).filter(client => client.role === "tree");
    const contexts = () => Promise.all(trees.map(tree => session.client.request({
      action: "browsing-context.get", contextId: tree.contextId!,
    })));
    const beforeContexts = await contexts();
    const draft = () => session.client.request<QuickCaptureDraft | null>({ action: "capture.draft.get" });
    const screenContains = (text: string) => session.waitFor(text,
      () => terminal.visible(), screen => screen.includes(text));
    const closed = () => session.waitFor("popup closed",
      () => terminal.visible(), screen => !screen.includes("Quick capture"));
    const open = async () => {
      await closed();
      await prefixKey("C");
      await session.waitForPluginAction("capture");
      await screenContains("Quick capture");
    };
    await open();
    await terminal.write("\x1b[200~Capture from an ordinary shell\x1b[201~");
    await terminal.write("\x1b");
    await closed();
    const retained = await draft();
    assert.equal(retained?.text, "Capture from an ordinary shell");
    assert.equal(retained?.capturedFromBlockId, undefined);
    await open();
    await screenContains("Capture from an ordinary shell");
    await session.checkpoint("01-global-capture-resumed");
    await terminal.write("\x13");
    await closed();
    await session.waitFor("saved draft cleared", draft, value => value === null);
    const captures = await session.client.request<VisibleBlockCollection>({
      action: "blocks.query", query: { filters: [{ key: "type", value: "capture" }], limit: 100 },
    });
    assert.equal(captures.completeness.kind, "complete");
    assert.equal(captures.blocks.filter(block => block.text.includes("Capture from an ordinary shell")).length, 1);
    assert.deepEqual(await session.client.request({ action: "selection.get" }), before);
    assert.deepEqual(await contexts(), beforeContexts);
    await terminal.write("\x1b[200~printf 'CAPTURE_%s\\n' RETURNED_TO_SHELL\x1b[201~\r");
    await session.waitVisible(session.panes.launcher, "CAPTURE_RETURNED_TO_SHELL");
    await session.record("capture-shortcut", { captures, beforeContexts, retained });
    await session.checkpoint("02-saved-and-returned");
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "passed") process.exitCode = 1;
