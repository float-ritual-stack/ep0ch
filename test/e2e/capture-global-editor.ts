import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Block, CaptureOwner, QuickCaptureDraft} from "../../src/types";
import {runHerdrScenario} from "./herdr-runner";
const nvim = Bun.which("nvim");
if (!nvim) throw Error("Neovim is required for the global capture journey");
const editorRoot = await mkdtemp(join(tmpdir(), "capture-editor-"));
const editorScript = join(editorRoot, "editor.sh");
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(editorScript, `#!/bin/sh
if [ ! -e ${shellQuote(join(editorRoot, "attempted"))} ]; then
  touch ${shellQuote(join(editorRoot, "attempted"))}
  exit 19
fi
exec ${shellQuote(nvim)} --clean "$@"
`);
try {
const result = await runHerdrScenario({
  name: "capture-global-editor", editor: `sh ${shellQuote(editorScript)}`,
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
    // Two launch actions before either destination is ready must converge.
    await terminal.write("N\x02N");
    const launches = await session.waitFor("both initial capture shortcuts succeed", () => session.pluginActionLogs(), logs => {
      const captures = logs.filter(log => log.actionId === "capture-editor");
      return captures.length === 2 && captures.every(log => log.status === "succeeded");
    });
    await session.record("concurrent-capture-launches", launches);
    await wait("exited with status 19");
    const failedLaunchDraft = (await draft())!;
    assert.ok(failedLaunchDraft.blockId);
    await session.record("editor-failure-retains-draft", failedLaunchDraft);
    await session.checkpoint("editor-launch-failure");
    await terminal.write("\x05");
    await wait("draft.md");
    assert.equal((await draft())!.blockId, failedLaunchDraft.blockId);
    const globalDraft = (await draft())!;
    assert.ok(globalDraft.blockId);
    assert.equal(globalDraft.capturedFromBlockId, undefined);
    const globalDock = await session.adoptCapture();
    await session.checkpoint("06-global-editor-from-shell");
    await terminal.write("i");
    await wait("-- INSERT --");
    await terminal.write("\x1b[200~GLOBAL SIDEBAR NOTE\x1b[201~");
    await wait("GLOBAL SIDEBAR NOTE");
    // Invoke the global command from the shell while nvim still owns unsaved
    // writing. It must focus that editor, never prepare a stale second draft.
    const ownerBefore = await session.client.request<CaptureOwner>({action: "capture.owner.get"});
    const draftBefore = await draft();
    await terminal.write("\x02"); await wait("PREFIX"); await terminal.write("h");
    await session.waitFor("shell while editor is open", () => session.focusedPane(), pane => pane === shell);
    await terminal.write("\x02"); await wait("PREFIX"); await terminal.write("N");
    await session.waitFor("global shortcut returns to the existing editor", () => session.focusedPane(), pane => pane === globalDock);
    await wait("GLOBAL SIDEBAR NOTE");
    assert.deepEqual(await draft(), draftBefore);
    assert.deepEqual(await session.client.request({action: "capture.owner.get"}), ownerBefore);
    await session.checkpoint("repeated-global-entry-preserves-unsaved-editor");
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
    // Server focus can precede the attached client's matching rendered frame.
    // Wait for Capture's visible cursor, not a delay or another application key.
    const captureColumn = (await wait("GLOBAL SIDEBAR NOTE")).split("\n")
      .find(row => row.includes("GLOBAL SIDEBAR NOTE"))!.indexOf("GLOBAL SIDEBAR NOTE");
    assert.ok(captureColumn > 0);
    await session.waitFor("Capture focus is rendered", () => terminal.cursor(), cursor => cursor.column >= captureColumn);
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

} finally {await rm(editorRoot, {recursive: true, force: true});}
