import assert from "node:assert/strict";
import type {Block, QuickCaptureDraft} from "../../src/types";
import {runHerdrScenario} from "./herdr-runner";
const nvim = Bun.which("nvim");
if (!nvim) throw Error("Neovim is required for the global capture journey");
const result = await runHerdrScenario({
  name: "capture-global-editor", editor: `${nvim} --clean`,
  commandKeys: [{key: "prefix+shift+n", command: "float.pi-outliner.capture-editor"}],
  async prepare() {},
  async run(session) {
    const terminal = await session.attachClient();
    await terminal.resize(110, 40);
    const wait = (text: string) => session.waitFor(text, () => terminal.visible(), frame => frame.includes(text));
    const draft = () => session.client.request<QuickCaptureDraft | null>({action: "capture.draft.get"});
    const click = async (label: string) => {
      const rows = (await wait(label)).split("\n");
      const y = rows.findIndex(row => row.includes(label));
      const x = rows[y]!.indexOf(label) + Math.floor(label.length / 2);
      await session.record("capture-click", {label, row: rows[y], x, y});
      await terminal.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
    };
    await wait("Outliner");
    const shell = await session.openShellTab();
    await session.waitFor("shell tab has no Outliner surface", () => terminal.visible(), frame =>
      frame.includes("Capture from shell") && !frame.includes("Quick capture") && !frame.includes("Outliner"));
    await terminal.write("\x02");
    await wait("PREFIX");
    await terminal.write("N");
    await wait("draft.md");
    const globalDraft = (await draft())!;
    assert.ok(globalDraft.blockId);
    assert.equal(globalDraft.capturedFromBlockId, undefined);
    const globalDock = await session.adoptCapture();
    await session.checkpoint("06-global-editor-from-shell");
    await terminal.write("i");
    await wait("-- INSERT --");
    await terminal.write("\x1b[200~GLOBAL SIDEBAR NOTE\x1b[201~");
    await wait("GLOBAL SIDEBAR NOTE");
    await terminal.write("\x1b:wq\r");
    await wait("Writing retained");
    assert.equal((await draft())!.blockId, globalDraft.blockId);
    await terminal.write("\x02");
    await wait("PREFIX");
    await terminal.write("h");
    await session.waitFor("back to the ordinary shell", () => session.focusedPane(), pane => pane === shell);
    await terminal.write("printf 'BROWSING_%s\\n' CONTINUES\r");
    await session.waitVisible(shell, "BROWSING_CONTINUES");
    await terminal.write("\x02");
    await wait("PREFIX");
    await terminal.write("l");
    await session.waitFor("back to the global capture", () => session.focusedPane(), pane => pane === globalDock);
    await click("[Save to Inbox]");
    await session.waitFor("global capture submitted", draft, value => value === null);
    const globalNote = await session.client.request<Block>({action: "get", blockId: globalDraft.blockId!});
    assert.ok(globalNote.text.includes("GLOBAL SIDEBAR NOTE"));
    await session.record("global-capture-submitted", globalNote);

    await session.checkpoint("global-capture-submitted");
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
