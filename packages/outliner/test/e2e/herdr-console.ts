// The sysop console takes a paste, a click and a dead host (PIE-1649, PIE-1650), through the attached terminal:
// a paste is the host terminal's bracketed paste, a click its SGR report, as Evan's terminal sends them.
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";

const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const click = (column: number, row: number) => `\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`;

const result = await runHerdrScenario({
  name: "herdr-console",
  async prepare() {},
  async run(s) {
    const terminal = await s.attachClient();
    const create = (text: string, parentId: string | null = null) => s.client.request<Block>({ action: "create", parentId, text });
    const root = await create("Paste fixtures");
    await create("Saffron alpha", root.id);
    await create("Saffron beta", root.id);
    const target = await create("Peek target\n\nPEEK-TARGET-BODY");
    const one = await create(`Clove source one\n\nIt names ((${target.id})).\n\nCLOVE-ONE-BODY`);
    await create(`Clove source two\n\nIt names ((${target.id})) too.\n\nCLOVE-TWO-BODY`);
    const tree = s.panes.tree, detail = s.panes.detail;

    // Tree's own search: a newline in a paste is part of the query, never an Enter.
    await s.revealTree(tree, root.id);
    await s.focus(tree);
    await s.keys(tree, "/");
    await s.waitVisible(tree, "Find in branch:");
    await terminal.write(paste("saffron\nbeta"));
    const filtered = await s.waitFor("Tree's search holds the whole paste", () => s.visible(tree), frame => frame.includes("Find in branch: saffron beta"));
    assert.ok(filtered.includes("Saffron beta") && !filtered.includes("Saffron alpha"), "The pasted query filters the branch");
    await s.checkpoint("01-tree-search-paste");
    await s.keys(tree, "escape");
    await s.waitFor("Tree's search closed", () => s.visible(tree), frame => !frame.includes("Find in branch:"));

    // Tree's action menu Find.
    await s.keys(tree, "?");
    await s.waitVisible(tree, "Find:");
    await terminal.write(paste("tree\nchrome"));
    await s.waitFor("Tree's Find holds the whole paste", () => s.visible(tree), frame => frame.includes("Find: tree chrome"));
    await s.checkpoint("02-tree-find-paste");
    await s.keys(tree, "escape");
    await s.waitFor("Tree's menu closed", () => s.visible(tree), frame => !frame.includes("Find:"));

    // Detail's action-menu Find.
    await s.revealTree(tree, target.id);
    await s.keys(tree, "enter");
    await s.waitVisible(detail, "PEEK-TARGET-BODY");
    await s.focus(detail);
    await s.keys(detail, "?");
    await s.waitVisible(detail, "Find:");
    await terminal.write(paste("close\npreview"));
    await s.waitFor("Detail's Find holds the whole paste", () => s.visible(detail), frame => frame.includes("Find: close preview"));
    await s.checkpoint("03-detail-find-paste");
    await s.keys(detail, "escape");
    await s.waitFor("Detail's menu closed", () => s.visible(detail), frame => !frame.includes("Find:"));

    // The backlink peek takes clicks: the title opens the chooser, a chooser control opens the backlink.
    const peek = async () => {
      const frame = await terminal.visible();
      return frame.includes("Backlink 1/2") || frame.includes("Backlink 2/2") ? frame : "";
    };
    await s.openBacklinkPeek(target.id, one.id);
    let frame = await s.waitFor("backlink peek open", peek, text => text.includes("CLOVE-ONE-BODY"));
    const at = (text: string, label: string) => {
      const lines = text.split("\n"), row = lines.findIndex(line => line.includes(label));
      assert.ok(row >= 0, `${label} is on screen`);
      return { row, column: visibleWidth(lines[row]!.slice(0, lines[row]!.indexOf(label))) };
    };
    // Newest first: the second source is 1/2, the first (selected) 2/2.
    const prev = at(frame, "‹");
    await terminal.write(click(prev.column, prev.row));
    frame = await s.waitFor("‹ peeks the other backlink", peek, text => text.includes("Backlink 1/2") && text.includes("CLOVE-TWO-BODY"));
    const next = at(frame, "›");
    await terminal.write(click(next.column, next.row));
    frame = await s.waitFor("› peeks back", peek, text => text.includes("Backlink 2/2") && text.includes("CLOVE-ONE-BODY"));
    const title = at(frame, "Clove source one");
    await terminal.write(click(title.column + 2, title.row));
    frame = await s.waitFor("a click on the backlink opens the chooser", peek, text => text.includes("Choose destination"));
    await s.checkpoint("04-peek-chooser-by-click");
    const here = at(frame, "replace here");
    await terminal.write(click(here.column + 1, here.row));
    await s.waitFor("the peek closes", terminal.visible, text => !text.includes("Backlink 1/2"));
    await s.waitVisible(detail, "CLOVE-ONE-BODY");
    await s.checkpoint("05-peek-opened-by-click");

    // A peek whose host can't be reached says why and what to run, and stays up until a key closes it.
    await s.focus(detail);
    await s.openBacklinkPeek(target.id, one.id, { EP0CH_SOCKET: join(tmpdir(), `nobody-serves-this-${process.pid}.sock`) });
    frame = await s.waitFor("the dead-host peek says why", terminal.visible, text => text.includes("Backlink peek could not start"));
    assert.ok(frame.includes(`nobody-serves-this-${process.pid}.sock`), "The reason names the socket");
    assert.ok(frame.includes("EP0CH_SOCKET"), "The hint names what to check");
    await new Promise(resolve => setTimeout(resolve, 1_000));
    assert.ok((await terminal.visible()).includes("Backlink peek could not start"), "The popup stays up to be read");
    await s.checkpoint("06-peek-dead-host");
    await terminal.write("\x1b");
    await s.waitFor("Esc closes it", terminal.visible, text => !text.includes("Backlink peek could not start"));
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
