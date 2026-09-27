import assert from "node:assert/strict";
import {visibleWidth} from "@earendil-works/pi-tui";
import type {Block, QuickCaptureDraft, VisibleBlockCollection} from "../../src/types";
import type {EditRecovery} from "../../src/edit-recovery";
import {runHerdrScenario} from "./herdr-runner";

const nvim = Bun.which("nvim");
if (!nvim) throw Error("Neovim is required for the capture editor journey");
const result = await runHerdrScenario({
  name: "capture-docking", editor: `${nvim} --clean`,
  commandKeys: [{key: "prefix+shift+n", command: "float.pi-outliner.capture-editor"}],
  async prepare() {},
  async run(session) {
    const terminal = await session.attachClient();
    await terminal.resize(160, 55);
    const wait = (text: string) => session.waitFor(text, () => terminal.visible(), frame => frame.includes(text));
    await wait("Outliner");
    await session.focus(session.panes.tree);
    const origin = await session.client.request<Block>({action: "create", text: "Capture browsing reference"});
    const draft = () => session.client.request<QuickCaptureDraft | null>({action: "capture.draft.get"});
    const open = async () => {
      await session.waitFor("previous capture surface closed", () => terminal.visible(), frame => !frame.includes("Quick capture"));
      await session.openCapturePopup(origin.id, session.client.socketPath);
      await wait("Quick capture");
    };
    const click = async (label: string) => {
      const frame = await wait(label);
      const rows = frame.split("\n");
      const y = rows.findIndex(row => row.includes(label));
      const x = rows[y]!.indexOf(label) + Math.floor(label.length / 2);
      await session.record("capture-click", {label, row: rows[y], x, y});
      await terminal.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
    };
    const before = await session.client.request({action: "selection.get"});
    await open();
    await session.checkpoint("01-visible-capture-controls");
    await terminal.write("\x05");
    await wait("draft.md");
    const prepared = await draft();
    assert.ok(prepared?.blockId, "External editing must allocate the note before launch");
    const read = () => session.client.request<Block>({action: "get", blockId: prepared.blockId!});
    assert.equal((await read()).text, "");
    await session.checkpoint("02-blank-protected-note-in-editor");
    const writing = "CAPTURE WRITING\n\n" + Array.from({length: 28}, (_, n) =>
      `- Observation ${n + 1}\n  - Preserve its nested detail`).join("\n") + "\n";
    await terminal.write("i");
    await wait("-- INSERT --");
    await terminal.write(`\x1b[200~${writing}\x1b[201~`);
    await wait("Observation 28");
    await session.checkpoint("02b-writing-in-editor");
    await terminal.write("\x1b:wq\r");
    await wait("Writing retained");
    const retained = await session.waitFor("editor writing retained in capture", draft, value => !!value?.text.includes("Observation 28"));
    assert.equal(retained!.blockId, prepared.blockId);
    assert.equal((await read()).text, retained!.text);
    assert.equal((await read()).properties.some(p => p.key === "status" && p.value === "unprocessed"), false);
    await session.checkpoint("03-editor-return-retains-without-submitting");
    await terminal.write("\x1b[1;2C");
    await terminal.write("\x0f");
    await wait("[→ Right]");
    await terminal.write("\x1b[C");
    await wait("[Popup]");
    const dock = await session.adoptCapture();
    await session.waitVisible(dock, "C▏APTURE WRITING");
    assert.equal((await draft())!.blockId, prepared.blockId);
    assert.deepEqual((await draft())!.selectionAnchor, {row: 0, column: 0});
    assert.equal((await draft())!.cursorColumn, 1);
    await session.checkpoint("03b-docked-exact-draft");
    await terminal.write("\x02");
    await wait("PREFIX");
    await terminal.write("h");
    await session.waitFor("browse in Tree beside Capture", () => session.focusedPane(), pane => pane === session.panes.tree);
    await terminal.write("\x1b[B");
    await session.waitVisible(session.panes.tree, "Workspace › Documentation");
    await terminal.write("\x02");
    await wait("PREFIX");
    await terminal.write("l");
    await session.waitFor("return to docked writing", () => session.focusedPane(), pane => pane === dock);
    await session.waitVisible(dock, "C▏APTURE WRITING");
    // Returning to popup must carry the same cursor/selection without writing a
    // second note or making a closing surface flush over the destination.
    await click("[Popup]");
    await session.waitFor("docked capture returned to popup", () => terminal.visible(), frame =>
      frame.includes("Quick capture") && !frame.includes("[Popup]"));
    assert.equal((await draft())!.blockId, prepared.blockId);
    assert.deepEqual((await draft())!.selectionAnchor, {row: 0, column: 0});
    await session.checkpoint("03c-returned-to-popup");
    for (const [side, key] of [["Left", "\x1b[D"], ["Bottom", "\x1b[B"]] as const) {
      await click("[Dock ^O]");
      await wait(side);
      await terminal.write(key);
      await wait("[Popup]");
      const moved = await session.adoptCapture();
      await session.waitVisible(moved, "C▏APTURE WRITING");
      assert.equal((await draft())!.blockId, prepared.blockId);
      assert.deepEqual((await draft())!.selectionAnchor, {row: 0, column: 0});
      await session.checkpoint(`03-docked-${side.toLowerCase()}`);
      await click("[Popup]");
      await session.waitFor("docked capture returned to popup", () => terminal.visible(), frame =>
        frame.includes("Quick capture") && !frame.includes("[Popup]"));
    }
    const popupWidth = (frame: string) => {
      const row = frame.split("\n").find(row => row.includes("┌Quick Capture"));
      return row ? row.indexOf("┐", row.indexOf("┌Quick Capture")) - row.indexOf("┌Quick Capture") : 0;
    };
    const beforeResize = popupWidth(await terminal.visible());
    await terminal.resize(110, 40);
    await session.waitFor("resized terminal layout", () => terminal.visible(), frame =>
      frame.split("\n").some(line => /[┐┘]$/.test(line) && visibleWidth(line) === 110) &&
      popupWidth(frame) > 0 && popupWidth(frame) < beforeResize);
    await click("[Retain]");
    await session.waitFor("retained popup exits", () => terminal.visible(), frame => !frame.includes("Quick capture"));
    assert.equal((await draft())!.blockId, prepared.blockId);
    assert.deepEqual(await session.client.request({action: "selection.get"}), before);
    await open();
    await wait("C▏APTURE WRITING");
    await session.checkpoint("04-reopened-writing-after-resize");
    await click("[Save to Inbox]");
    await session.waitFor("submitted draft cleared", draft, value => value === null);
    const saved = await read();
    assert.ok(saved.text.includes("Observation 28\n  - Preserve its nested detail"));
    assert.ok(saved.properties.some(p => p.key === "captured-from" && p.value === origin.id));
    const captures = await session.client.request<VisibleBlockCollection>({action: "blocks.query", query: {
      filters: [{key: "type", value: "capture"}], limit: 100,
    }});
    assert.equal(captures.completeness.kind, "complete");
    assert.deepEqual(captures.blocks.map(b => b.id), [prepared.blockId]);
    assert.deepEqual(await session.client.request({action: "selection.get"}), before);
    await session.record("same-note-submitted", {prepared, retained, saved});
    await session.checkpoint("05-one-submitted-capture");

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
    await session.waitFor("global capture surface exits", () => terminal.visible(), frame => !frame.includes("Quick capture"));
    await session.closeDetached(shell);
    await terminal.write("\x02");
    await wait("PREFIX");
    await terminal.write("1");
    await wait("Outliner");
    await session.focus(session.panes.tree);

    await open();
    await terminal.write("\x1b[200~SECOND CAPTURE\x1b[201~");
    await wait("SECOND CAPTURE");
    await click("[Editor ^E]");
    await wait("draft.md");
    const conflicting = (await draft())!;
    await terminal.write("GoWRITING FROM EDITOR");
    await wait("WRITING FROM EDITOR");
    const winner = await session.client.request<Block>({action: "update", blockId: conflicting.blockId!,
      text: "Writing from another surface", expectedRevision: conflicting.blockRevision!, mutation: {author: "user"}});
    await terminal.write("\x1b:wq\r");
    await wait("Capture note changed");
    const history = await session.waitFor("conflicting editor writing retained in note history", () =>
      session.client.request<EditRecovery[]>({action: "edit-recovery.list", blockId: conflicting.blockId!}),
    records => records.some(record => record.draftText.includes("WRITING FROM EDITOR")));
    assert.equal((await session.client.request<Block>({action: "get", blockId: winner.id})).text, winner.text);
    assert.equal((await draft())!.blockId, winner.id);
    await session.record("conflicting-writing-retained", {winner, history});
    await session.checkpoint("06-concurrent-writing-preserved");
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
