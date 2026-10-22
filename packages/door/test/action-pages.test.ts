// PIE-1032: an action's page is drawn with components, with real examples. Every built-in action that takes arguments
// has one or two examples (ActionDef.examples), each a line `ep0ch act` takes for that action: its name, arguments it
// has, of their types. The page (src/surface/action-page.ts) is the lead, its keys as keycaps (::graph-keys), its
// arguments as a properties table (::graph-props) and its examples (::graph-example), drawn by the readers' renderers.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReaderPane } from "../src/desk/panes";
import { Desk } from "../src/desk/desk";
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
  const pages = builtIns().filter(a => (a.scope === "tile" && ["layout.move", "tile.open", "tile.link"].includes(a.name)) || (a.scope === "reader" && a.name === "reader.mode") || (a.scope === "desk" && a.name === "open"));
  for (const page of pages) for (const example of page.examples ?? []) test(example.act, async () => {
    const note = await h.board.createBlock(null, "Seed swap [page::garden]\nBring beans and peas.");
    const file = join(h.scratch.root, "garden-plan.md");
    writeFileSync(file, "# Garden plan\nSow peas by the fence.\n");
    const d = new Desk({ name: "example", title: "Example", layout: { root: { t: "split", dir: "row", weights: [1, 1, 1, 1, 1], kids: [
      { t: "leaf", kind: "tree", name: "tree" },
      { t: "leaf", kind: "reader", name: "reader", mode: "held", note: note.id },
      { t: "leaf", kind: "reader", name: "replies", mode: "held", note: note.id },
      { t: "leaf", kind: "activity", name: "activity" },
      { t: "leaf", kind: "preview", name: "preview", source: "tile:tree" },
    ] } } });
    h.app.push(d);
    const cwd = process.cwd();
    try {
      process.chdir(h.scratch.root);
      const line = example.act.replaceAll("7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", note.id).replaceAll("/tmp/garden-plan.md", file);
      const answer = await h.app.dispatch.act(actRequestOf(lineWords(line)), USER) as { tile: string; name: string };
      expect(answer.tile).toBeString();
      const info = await h.app.dispatch.act({ action: "tile.info", tile: answer.tile }, USER) as { tile: string; name: string };
      expect(info.tile).toBe(answer.tile);
      expect(info.name).toBe(answer.name);
      if (page.name === "tile.open" && line.includes("kind=reader")) {
        await until(() => d.tileInfo(answer.tile).showing?.id === note.id, "the example's held note");
        expect((d.pane(answer.tile) as ReaderPane).followMode).toBe("held");
      }
    } finally {
      process.chdir(cwd);
      h.app.pop(); d.dispose();
      await h.board.trash(note.id);
    }
  });
});
