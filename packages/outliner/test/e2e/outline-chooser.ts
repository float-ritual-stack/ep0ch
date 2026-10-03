import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OutlinerClient } from "../../src/client";
import { listLiveClients } from "../../src/client-target";
import { visibleWidth } from "@earendil-works/pi-tui";
import { runHerdrScenario } from "./herdr-runner";

// PIE-530: opening from a folder that names no outline (no EP0CH_WS, no .ep0ch) asks which outline to use (pick,
// new or import) and creates nothing by a guess; a choice writes the folder's .ep0ch, so the next open is direct.
const result = await runHerdrScenario({
  name: "outline-chooser",
  commandKeys: [{ key: "prefix+u", command: "float.pi-outliner.open-here" }],
  async prepare() {},
  async run(s) {
    const runRoot = dirname(s.projectRoot);
    const outlines = join(runRoot, "outlines");
    const socket = join(outlines, ".host", "host.sock");
    const host = new OutlinerClient(socket);
    const names = async () => (await host.request<{ outlines: { name: string }[] }>({ action: "outlines.list" })).outlines.map(outline => outline.name);
    const outlineEntries = () => readdirSync(outlines).filter(entry => entry.endsWith(".sqlite")).sort();
    const [jam, attic, fern] = ["jam-shelf", "quiet-attic", "fern-ledger"].map(name => join(runRoot, name));
    for (const folder of [jam, attic, fern]) await mkdir(folder!);
    const terminal = await s.attachClient();
    await terminal.resize(160, 48);
    const baseline = outlineEntries();

    // The chooser is a Herdr popup: read and drive it through the attached terminal, as the goto journey does.
    const popup = () => terminal.visible();
    const closed = (label: string) => s.waitFor(label, popup, frame => !frame.includes("No outline is named for"));
    const openChooser = async (folder: string) => {
      const shell = await s.openShellTab(folder);
      await s.waitFor(`shell in ${folder}`, () => s.visible(shell), text => text.trim().length > 0);
      const output = await s.invokeAction("open-here");
      assert.deepEqual(output, { outline: "missing", chooser: "choose-outline", workspaceRoot: folder, rootSource: "the invoking pane's foreground cwd" });
      const frame = await s.waitFor("outlines listed", popup, text => text.includes("+ New outline") && !text.includes("Looking for outlines"));
      assert.ok(frame.includes(`No outline is named for ${folder}`), frame);
      assert.ok(frame.includes("Resolved from the invoking pane's foreground cwd"), frame);
      // Showing the chooser created no outline and wrote no .ep0ch.
      assert.deepEqual(outlineEntries(), baseline);
      assert.equal(existsSync(join(folder, ".ep0ch")), false);
      return { shell, frame };
    };
    const outlineClient = (name: string) => new OutlinerClient(socket, 3_000, name);
    const treeIds = async (client: OutlinerClient) => new Set((await listLiveClients(client, "tree").catch(() => [])).map(c => c.clientId));
    const newTree = async (client: OutlinerClient, before: Set<string>, label: string) => {
      const trees = await s.waitFor(label, () => listLiveClients(client, "tree").catch(() => []), clients => clients.some(c => !before.has(c.clientId)));
      return trees.find(c => !before.has(c.clientId))!;
    };

    // 1. Pick the project's outline by mouse: a click on its row chooses it and names the folder's outline.
    const first = await openChooser(jam!);
    await s.record("chooser-jam-shelf", first.frame);
    await s.checkpoint("00-chooser-shown");
    assert.ok(first.frame.includes('Named "jam-shelf"'), first.frame);
    const lines = first.frame.split("\n");
    const row = lines.findIndex(line => line.includes("project") && line.includes("open"));
    assert.ok(row >= 0, first.frame);
    const column = visibleWidth(lines[row]!.slice(0, lines[row]!.indexOf("project")));
    const project = outlineClient("project");
    const before = await treeIds(project);
    await s.record("click project row", { row, column });
    await terminal.write(`\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`);
    await closed("chooser closed after click");
    const jamTree = await newTree(project, before, "Tree opened on the picked outline");
    assert.equal(readFileSync(join(jam!, ".ep0ch"), "utf8"), 'ws = "project"\n');
    const jamPane = await s.adoptDetached(jamTree.clientId, "tree", project);
    await s.waitVisible(jamPane, "Tree [Note]");
    await s.checkpoint("01-mouse-pick-opened-tree");

    // 2. Ctrl-b u again in that folder opens directly, without a chooser.
    // Focus the shell by clicking its prompt, as a person would, then press Ctrl-b u.
    const prompt = await s.waitFor("shell prompt", popup, text => text.includes("jam-shelf$"));
    const promptRow = prompt.split("\n").findIndex(line => line.includes("jam-shelf$"));
    const promptColumn = visibleWidth(prompt.split("\n")[promptRow]!.slice(0, prompt.split("\n")[promptRow]!.indexOf("jam-shelf$")));
    await terminal.write(`\x1b[<0;${promptColumn + 1};${promptRow + 1}M\x1b[<0;${promptColumn + 1};${promptRow + 1}m`);
    const beforeAgain = await treeIds(project);
    await terminal.write("\x02");
    await s.waitFor("prefix", terminal.visible, text => text.includes("PREFIX"));
    await terminal.write("u");
    const again = await newTree(project, beforeAgain, "Ctrl-b u opened directly");
    const againPane = await s.adoptDetached(again.clientId, "tree", project);
    await s.waitVisible(againPane, "Tree [Note]");
    const logs = await s.pluginActionLogs();
    assert.equal(logs.find(log => log.actionId === "open-here")?.status, "succeeded");
    await s.checkpoint("02-second-open-direct");

    // 3. Esc closes the chooser and creates nothing.
    await openChooser(attic!);
    await terminal.write("\x1b");
    await closed("chooser closed by Esc");
    assert.deepEqual(outlineEntries(), baseline);
    assert.equal(existsSync(join(attic!, ".ep0ch")), false);

    // 4. "+ New outline" by keys: Enter offers the folder's name to edit, Enter again creates it.
    const third = await openChooser(fern!);
    await s.record("chooser-fern-ledger", third.frame);
    await s.waitFor("project listed first", popup, text => text.includes("› project"));
    await terminal.write("j");
    await s.waitFor("new outline selected", popup, text => text.includes("› + New outline"));
    await terminal.write("\r");
    await s.waitFor("name offered", popup, text => text.includes("+ New outline: fern-ledger"));
    await terminal.write("\r");
    await closed("chooser closed after Enter");
    const fernClient = outlineClient("fern-ledger");
    await newTree(fernClient, new Set(), "Tree opened on the new outline");
    assert.deepEqual(await names(), ["fern-ledger", "project"]);
    assert.equal(readFileSync(join(fern!, ".ep0ch"), "utf8"), 'ws = "fern-ledger"\n');
    await s.record("outlines-after", { entries: outlineEntries(), baseline });
    assert.deepEqual(outlineEntries(), [...baseline, "fern-ledger.sqlite"].sort());
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
