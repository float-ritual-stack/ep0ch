// PIE-1032: an action's page is drawn with components, with real examples. Every built-in action that takes arguments
// has one or two examples (ActionDef.examples), each a line `ep0ch act` takes for that action: its name, arguments it
// has, of their types. The page (src/surface/action-page.ts) is the lead, its keys as keycaps (::graph-keys), its
// arguments as a properties table (::graph-props) and its examples (::graph-example), drawn by the readers' renderers.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReaderPane } from "../src/desk/panes";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { USER } from "../src/socket";
import { outliner, until } from "./scratch";
import { useShowcaseScreen } from "./showcase/harness";
import { describe, expect, test } from "bun:test";
import "../src/app";
import "../src/screens";
import { actRequestOf, allActionSets, coerceActionArgs, lineWords, type ActionInfo } from "../src/surface/actions";
import { actionPage, exampleSafe } from "../src/surface/action-page";
import { draftPreview } from "../src/surface/note";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
const NVIM = process.env.EP0CH_TEST_NVIM || Bun.which("nvim");

/** Every built-in action once, by its set's scope and name. */
function builtIns(): ActionInfo[] {
  const seen = new Set<string>();
  return allActionSets().flatMap(s => s.list()).filter(a => !a.name.startsWith("ext.") && (seen.has(`${a.scope}:${a.name}`) ? false : (seen.add(`${a.scope}:${a.name}`), true)));
}

describe("an action's examples", () => {
  test("every action that takes arguments has one to three, each a call `ep0ch act` takes for it", () => {
    const wrong: string[] = [];
    for (const a of builtIns()) {
      const examples = a.examples ?? [];
      if (Object.keys(a.args).length && !examples.length) { wrong.push(`${a.scope}:${a.name}: no examples`); continue; }
      if (examples.length > 3) wrong.push(`${a.scope}:${a.name}: ${examples.length} examples (one or two, three at most)`);
      for (const ex of examples) {
        if (!ex.does.trim()) wrong.push(`${a.name}: \`${ex.act}\` says nothing about what it does`);
        try {
          const req = actRequestOf(lineWords(ex.act));
          if (req.action !== a.name) wrong.push(`${a.name}: \`${ex.act}\` runs ${req.action}`);
          else if (req.as !== undefined) wrong.push(`${a.name}: \`${ex.act}\` names as=; examples run as whoever reads them`);
          else coerceActionArgs(a.name, a.args, req.args ?? {});
        } catch (e) { wrong.push(`${a.name}: \`${ex.act}\`: ${(e as Error).message}`); }
        // Safe is what an agent may run as it is: never one a restarted door would ask before running again.
        if (ex.safe && a.replay !== "safe") wrong.push(`${a.name}: \`${ex.act}\` is marked safe, but the action is replay: ask`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("an action's page", () => {
  const move = () => builtIns().find(a => a.name === "layout.move")!;

  test("layout.move's page: its lead, its keys as keycaps, its arguments as a table, its examples as act lines", () => {
    const page = actionPage(move());
    expect(page).toStartWith("**layout.move** · move");
    expect(page).toContain("::graph-keys");
    expect(page).toContain("::graph-props");
    expect(page).toContain("::graph-example");
    const drawn = draftPreview(page, 80, null).map(plain).join("\n");
    // Keycaps, from the action's own keys: ^W m then h j k l.
    expect(drawn).toContain("[^W] [m] then [h] [j] [k] [l]");
    // The arguments' table: a row per argument, what each means under it.
    expect(drawn).toMatch(/name\s+values/);
    // A fixed list of values is its values (PIE-1031), a tile its kind.
    expect(drawn).toMatch(/where\s+left, right, up, down, tabs/);
    expect(drawn).toMatch(/into\s+a tile/);
    expect(drawn).toContain("the tile it goes beside");
    // An example as the line an agent types, and what it does under it.
    const ex = move().examples![0]!;
    expect(drawn).toContain(`ep0ch act ${ex.act}`);
    expect(drawn).toContain(`→ ${ex.does.slice(0, 30)}`);
  });

  test("a page fits its width, narrow as wide", () => {
    for (const w of [40, 60, 100]) {
      const lines = draftPreview(actionPage(move()), w, null).map(plain);
      expect(lines.filter(l => [...l].length > w)).toEqual([]);
    }
  });

  test("an example that only reads is marked safe; one that changes the layout isn't", () => {
    const open = builtIns().find(a => a.name === "bar.open")!;
    expect(open.examples?.length).toBeGreaterThan(0);
    expect(open.examples!.every(ex => exampleSafe(open, ex))).toBe(true);
    expect(draftPreview(actionPage(open), 80, null).map(plain).join("\n")).toContain("safe");
    expect(move().examples!.some(ex => exampleSafe(move(), ex))).toBe(false);
  });

  test("what a summary writes as a property, a component or a link stays words on the page", () => {
    const page = actionPage({ name: "x.y", summary: "open [[garden]] or ((7d9a1f40)) with ::graph-keys and [k::v]", args: {}, scope: "x", touches: "nothing", replay: "safe" });
    expect(page).toContain("`[[garden]]`");
    expect(page).toContain("`((7d9a1f40))`");
    expect(page).toContain("`::graph-keys`");
    expect(page).toContain("`[k::v]`");
  });
});

// These pages describe the contract changed by PIE-1194. Their sample ids and files are bound to this scratch
// outline; the calls themselves go through the same dispatcher as a pasted example in the door.
describe.skipIf(!outliner)("action-contract pages execute against an outline", () => {
  const h = useShowcaseScreen();
  const pages = builtIns().filter(a => (["tile", "reader", "pane", "tree", "activity", "hint", "tune", "query", "library", "new"].includes(a.scope)) || (a.scope === "desk" && a.name === "open"));
  for (const page of pages) for (const example of page.examples ?? []) {
    const needsNvim = page.name === "block.mark" && example.act.includes("line=");
    if (needsNvim && !NVIM) console.warn(`Skipping example (nvim is not on PATH): ${example.act}`);
    test.skipIf(needsNvim && !NVIM)(example.act, async () => {
    const note = await h.board.createBlock(null, `Seed swap [page::garden]${page.name === "tree.depth" ? " [type::virtual-branch] [query::page=garden]" : ""}\nseed swap: bring beans and peas.\n` + "Water the beds.\n".repeat(45));
    if (page.name === "tree.depth") await h.board.move(note.id, null, USER, 1);
    const file = join(h.scratch.root, "garden-plan.md");
    writeFileSync(file, "# Garden plan\nSow peas by the fence.\n");
    const reader = (name: string) => ({ t: "leaf" as const, kind: "reader", name, mode: "held" as const, note: note.id });
    const d = page.name === "screen.mount" ? openScreen("board", { hub: h.seeded.notes.hub.id }) as Desk
      : new Desk({ name: "example", title: "Example", layout: { root: page.name === "tile.travel" || page.name === "tile.hold"
        ? { t: "flow", kids: [reader("reader"), reader("card"), reader("next")], trail: [{ col: 1, from: 0, ahead: 2 }] }
        : { t: "split", dir: "row", weights: [1, 3, 1], kids: [
          { t: "leaf", kind: "tree", name: "tree" },
          { t: "split", dir: "col", weights: [2, 1], kids: [
            { t: "split", dir: "row", weights: [1, 1, 1], kids: [reader("reader"), reader("replies"), { t: "leaf", kind: "activity", name: "activity" }] },
            { t: "leaf", kind: "preview", name: "preview", source: "tile:tree" },
          ] }, needsNvim
            ? { t: "leaf", kind: "pty", name: "shed-notes", cmd: [NVIM!, "--clean", file], file } : reader("shed-notes"),
        ] } } });
    h.app.push(d);
    const cwd = process.cwd();
    try {
      process.chdir(h.scratch.root);
      const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => h.app.dispatch.act({ action, args, tile }, USER);
      if (page.name === "screen.mount") await until(() => { d.render(h.app); return d.layoutGet().tiles.some(t => t.kind === "query"); }, "the example board");
      else await until(() => d.tileInfo("reader").showing?.id === note.id, "the example reader");
      if (page.scope === "library") {
        await act("tile.open", { kind: "library", name: "library" }, "reader");
        await act("library.component", { name: "callout" }, "library");
        await act("library.part", { part: "space" }, "library");
        d.render(h.app);
      }
      if (page.scope === "tune") {
        await act("tile.open", { kind: "tune", name: "tune", source: "tile:reader" }, "reader");
        d.render(h.app);
        if (page.name === "tune.resetlevel") {
          await act("tune.level", { level: "screen" }, "tune");
          await act("tune.set", { row: "measure", value: "72" }, "tune");
        }
      }
      if (page.scope === "query") {
        await h.board.createBlock(note.id, "Second seed #garden");
        await h.board.createBlock(note.id, "Third seed #garden");
        await act("tile.open", { kind: "query", name: "query", query: "page=garden OR #garden" }, "reader");
        await until(() => (d.pane("query") as import("../src/desk/query").QueryPane).describe().count! >= 3, "the example query");
      }
      if (page.name === "tree.depth") await act("tree.fold", { id: note.id, open: true }, "tree");
      if (page.name === "tile.collapse" && example.act.includes("dir=h")) await act("layout.move", { to: "reader", where: "down" }, "replies");
      if (page.name === "float.place") await act("tile.float", { on: true }, "activity");
      if (page.name === "tile.slide") await act("tile.dock", { on: true }, "tree");
      if (page.name === "tab.select") await act("layout.move", { to: "reader", where: "tabs" }, "activity");
      if (page.name === "tile.into" || (page.name === "tile.group" && example.act.includes("on=false"))) await act("tile.group", { with: "replies", name: "thread" }, "reader");
      if (page.name === "tile.drawer" && example.act.includes("on=false")) await act("tile.drawer", { on: true }, "activity");
      if (page.name === "block.unmark") {
        await act("block.mark", { id: h.seeded.notes.hub.id, reason: "first mark" });
        await act("block.mark", { id: note.id, reason: "second mark" });
      }
      if (needsNvim) await until(() => !!(d.pane("shed-notes") as import("../src/desk/pty").PtyPane).nvim, "the example nvim socket");
      if (page.name === "note.untrash") await act("note.trash", { ref: note.id, confirm: note.id });
      if (page.name === "screen.delete" || page.name === "layout.load") await act("screen.save", { name: "garden planning" });
      let line = example.act.replaceAll("7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", note.id).replaceAll("7d9a1f40", note.id.slice(0, 8))
        .replaceAll("3b8e6c21-5f4a-4d7b-9c02-a1e8d4f7b650", note.id).replaceAll("4c1e9a73-8d20-4f65-b3a9-6e7d2c0f1b84", note.id).replaceAll("/tmp/garden-plan.md", file);
      if (line.includes("split=s1")) line = line.replace("split=s1", `split=${d.layoutGet().tree.id}`);
      const answer = await h.app.dispatch.act(actRequestOf(lineWords(line)), USER) as { tile: string; name: string };
      if (answer?.tile && !(page.name === "tile.group" && line.includes("on=false"))) {
      expect(answer.tile).toBeString();
      const info = await h.app.dispatch.act({ action: "tile.info", tile: answer.tile }, USER) as { tile: string; name: string };
      expect(info.tile).toBe(answer.tile);
      expect(info.name).toBe(answer.name);
      }
      if (page.name === "tile.open" && line.includes("kind=reader")) {
        await until(() => d.tileInfo(answer.tile).showing?.id === note.id, "the example's held note");
        expect((d.pane(answer.tile) as ReaderPane).followMode).toBe("held");
      }
    } finally {
      process.chdir(cwd);
      while (h.app.screens().at(-1) !== h.sc) h.app.pop();
      d.dispose();
      if (page.name !== "note.trash") await h.board.trash(note.id);
    }
  });
  }
});
