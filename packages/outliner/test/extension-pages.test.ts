// Every extension's page and its demo notes (src/extension-pages.ts, src/extension-demo.ts), on a scratch service: the
// Extensions hub, a page per installed extension, demo notes written once as the extension, install and uninstall.
// Everything is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { readDemo, rewriteDemoReferences } from "../src/extension-demo";
import { inertDocument } from "../src/extension-pages";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

interface Listed { hub?: string; pages: Record<string, string>; available: { id: string; name: string }[]; extensions: { id: string; state: string }[] }

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-ext-pages-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  for (const id of ["notify", "runbook"]) cpSync(join(import.meta.dir, "..", "extensions", id), join(outline, "extensions", id), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state"), scheduleTickMs: 3_600_000 });
  server.setOutline({ name: "pages-scratch" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const list = () => client.request<Listed>({ action: "extensions.list", reload: true });
  const children = async (id: string) => (await client.request<Block[]>({ action: "children", parentId: id }));
  return { root, outline, store, client, list, children };
}

test("the demo folder: one note per file, nested by folder or parent:, ids from front matter, a bad one said", () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-demo-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "demo", "02-board"), { recursive: true });
  writeFileSync(join(root, "demo", "01-intro.md"), "Intro\nSee ((lane|the lane)) and !((lane)).\n");
  writeFileSync(join(root, "demo", "02-board.md"), "Board [page::demo-board]\n");
  writeFileSync(join(root, "demo", "02-board", "01-lane.md"), "---\nid: lane\n---\nLane [type::virtual-branch] [query::kind=x]\n");
  writeFileSync(join(root, "demo", "03-loose.md"), "---\nparent: intro\n---\nUnder the intro\n");
  const demo = readDemo(root, "demo");
  expect(demo.problem).toBeUndefined();
  expect(demo.notes.map((note) => [note.key, note.id, note.parent ?? null])).toEqual([
    ["intro", "intro", null], ["board", "board", null], ["board/lane", "lane", "board"], ["loose", "loose", "intro"],
  ]);
  expect(rewriteDemoReferences(demo.notes[0]!.text, new Map([["lane", "0000-new"]]))).toBe("Intro\nSee ((0000-new|the lane)) and !((0000-new)).");
  writeFileSync(join(root, "demo", "03-loose.md"), "---\nparent: nowhere\n---\nLost\n");
  expect(readDemo(root, "demo").problem).toBe("demo: loose: parent nowhere is no note in the demo");
  expect(readDemo(root, "missing").problem).toBe("demo folder missing/ isn't there");
});

test("a README drawn as a page stays words: no handler line, no @name request, no property, fences as written", () => {
  expect(inertDocument("moon:: 2026-10-26\n@tidy tidy this\nA [mood::calm] day, `[kept::as code]`\n```text\nmoon:: 2026-10-26\n```"))
    .toBe("moon:‍: 2026-10-26\n@‍tidy tidy this\nA \\[mood::calm] day, `[kept::as code]`\n```text\nmoon:: 2026-10-26\n```");
});

test("installed extensions get a hub, a page each and their demo notes once, as the extension, with references rewritten", async () => {
  const { list, children, store, client } = await setup();
  const listed = await list();
  expect(listed.hub).toBeString();
  const hub = store.require(listed.hub!);
  expect(hub.text.split("\n")[0]).toBe("Extensions [page::extensions]");
  expect(hub.author).toBe("system");
  // The hub: each installed one a link to its page; what the repo has that isn't installed, with how to install it.
  expect(hub.text).toContain(`((${listed.pages.notify}|Notifications hub)) \`notify\` v2`);
  expect(listed.available.map((entry) => entry.id)).toContain("moon");
  expect(listed.available.map((entry) => entry.id)).not.toContain("notify");
  expect(hub.text).toMatch(/\*\*Moon\*\* `moon` v\d/);
  // The page: README body (its # title is the page's), what it adds, the changelog's newest entry, the demo under it.
  const page = store.require(listed.pages.runbook!);
  expect(page.parentId).toBe(hub.id);
  expect(page.text.split("\n")[0]).toBe("Runbook [ext.page::runbook] [page::ext-runbook]");
  expect(page.text).toContain("A note is a runbook.");
  expect(page.text).not.toContain("# Runbook");
  expect(page.text).toContain("- Action **Run this step** (`ext.runbook.run-step`, on a `run::` line, key `x`, writes)");
  expect(page.text).toContain("### 2 (2026-10-10)");
  expect(page.text).not.toContain("### 1 (2026-10-10)");
  const [runbook] = await children(page.id);
  expect(runbook!.text.split("\n")[0]).toBe("Ship the demo widget [type::runbook] [env::scratch]");
  expect(store.require(runbook!.id)).toMatchObject({ author: "agent", actorId: "ext:runbook" });
  const steps = await children(runbook!.id);
  expect(steps.map((step) => step.text.split("\n")[0])).toEqual(["Check the widget", "Stage with the demo token", "A step that fails"]);
  // References inside the demo point at the notes it wrote.
  expect(runbook!.text).toContain(`((${steps[0]!.id}|Check the widget))`);
  expect(runbook!.text).not.toContain("((check|");
  // The notify demo's boards: views the service answers, the lanes a start-here note links to.
  const notifyDemo = await children(listed.pages.notify!);
  expect(notifyDemo.map((note) => note.text.split("\n")[0])).toEqual([
    "Start here: your notifications on two boards", "Notifications by read state [page::notifications-state]", "Notifications by source [page::notifications-source]",
  ]);
  const lanes = await children(notifyDemo[1]!.id);
  expect(notifyDemo[0]!.text).toContain(`((${lanes[0]!.id}|Unread))`);
  // Reading again writes nothing more: no second demo, no second page.
  const before = store.changes.since(0, 1000);
  await list();
  const after = store.changes.since(0, 1000);
  expect(after.kind === "changes" && before.kind === "changes" ? after.changes.length - before.changes.length : -1).toBe(0);
  expect(await children(listed.pages.notify!)).toHaveLength(3);
  void client;
});

test("install from the repo, reinstall keeps your edits and adds nothing twice, uninstall asks what becomes of the demo", async () => {
  const { list, children, store, client } = await setup();
  const listed = await list();
  // A person edits a demo note.
  const [start] = await children(listed.pages.notify!);
  await client.request({ action: "update", blockId: start!.id, expectedRevision: start!.revision, text: `${start!.text}\n\nMy own line.`, mutation: { author: "user" } });
  // Reinstalling (an update from the repo) doesn't write the demo again or touch the edit.
  const again = await client.request<{ page?: string; lines: string[] }>({ action: "extensions.install", extension: "notify", where: "outline" });
  expect(again.lines[0]).toStartWith("updated notify");
  expect(again.page).toBe(listed.pages.notify);
  expect(await children(listed.pages.notify!)).toHaveLength(3);
  expect(store.require(start!.id).text).toContain("My own line.");
  // A built-in from the repo: installed, with its page, and the hub says so.
  const moon = await client.request<{ page?: string; hub?: string; state?: string }>({ action: "extensions.install", extension: "moon" });
  expect(moon.state).toBe("active");
  expect(store.require(moon.page!).text.split("\n")[0]).toBe("Moon [ext.page::moon] [page::ext-moon]");
  expect(store.require(moon.hub!).text).toContain(`((${moon.page}|Moon)) \`moon\``);
  expect((await list()).available.map((entry) => entry.id)).not.toContain("moon");
  await expect(client.request({ action: "extensions.install", extension: "no-such" })).rejects.toThrow(/No extension no-such in the repo's folder/);
  // Uninstalling needs the demo's fate said.
  await expect(client.request({ action: "extensions.uninstall", extension: "notify" })).rejects.toThrow(/needs demo: keep/);
  const kept = await client.request<{ removed: boolean; demo: { left: number }; lines: string[] }>({ action: "extensions.uninstall", extension: "notify", demo: "keep" });
  expect(kept).toMatchObject({ removed: true, demo: { left: 9 } });
  expect(kept.lines.at(-1)).toBe("kept its 9 demo notes under its page: ep0ch ext remove notify --demo remove moves them to Trash");
  const gone = await list();
  expect(gone.extensions.map((entry) => entry.id)).not.toContain("notify");
  expect(store.require(gone.pages.notify!).text).toContain("`notify` · not installed.");
  expect(store.require(gone.hub!).text).toContain("## Removed, notes kept");
  // Then the demo too: what no one changed goes to Trash; the edited note stays, named; the page stays while it does.
  const removed = await client.request<{ removed: boolean; demo: { trashed: number; kept: string[]; left: number } }>({ action: "extensions.uninstall", extension: "notify", demo: "remove" });
  expect(removed).toMatchObject({ removed: false, demo: { trashed: 2, kept: ["Start here: your notifications on two boards"], left: 0 } });
  expect((await children(gone.pages.notify!)).map((note) => note.id)).toEqual([start!.id]);
  // The runbook's demo, unchanged: all of it goes, and its page with it.
  const runbookPage = gone.pages.runbook!;
  await client.request({ action: "extensions.uninstall", extension: "runbook", demo: "remove" });
  const after = await list();
  expect(after.pages.runbook).toBeUndefined();
  expect(store.require(runbookPage).effectiveDeletedRootId).toBeString();
  // Back among the available ones.
  expect(store.require(after.hub!).text).toContain("- **Runbook** `runbook` v2");
  expect(store.require(after.hub!).text).not.toContain("|Runbook))");
});
