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
      const previousLogs = new Set((await session.pluginActionLogs()).map(log => log.logId));
      await prefixKey("C");
      const dispatched = await session.waitFor("new Capture plugin action completed", async () =>
        (await session.pluginActionLogs()).filter(log => log.actionId === "capture" && !previousLogs.has(log.logId)),
      logs => logs.some(log => log.status === "succeeded" || log.status === "failed"));
      assert.equal(dispatched.length, 1, "Each shortcut must dispatch exactly one new Capture action");
      assert.equal(dispatched[0]!.status, "succeeded");
      assert.equal(dispatched[0]!.exitCode, 0);
      await session.record("capture-action-dispatched", dispatched[0]);
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
    // Entry points load from the plugin checkout but global actions must use
    // the displayed workspace. Exercise both UI origins, not only a shell.
    for (const role of ["tree", "detail"] as const) {
      await session.focus(session.panes[role]);
      await open();
      await terminal.write(`\x1b[200~Capture from ${role}\x1b[201~`);
      await terminal.write("\x1b");
      await closed();
      assert.equal((await draft())?.text, `Capture from ${role}`);
      await open();
      await screenContains(`Capture from ${role}`);
      await terminal.write("\x13");
      await closed();
      await session.waitFor("saved draft cleared", draft, value => value === null);
      await session.checkpoint(`03-capture-from-${role}`);
    }
    assert.deepEqual(await session.client.request({ action: "selection.get" }), before);
    assert.deepEqual(await contexts(), beforeContexts);
    await session.record("capture-shortcut", { captures, beforeContexts, retained });
    await session.checkpoint("02-saved-and-returned");
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "passed") process.exitCode = 1;
