// PIE-1798: Evan sends a tile to a drawer he hasn't opened yet, changes his mind with ^W B, and the drawer still has its
// shell when he opens it next. A real tmux pane over a scratch service (TallyDoors), his keys. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { TallyDoors, type Pane } from "./tally-pane";

type Tile = { tile: string; name: string; kind: string; focused: boolean };
type Layer = { drawer: boolean; screen: string; tiles: Tile[] };
const layers = (p: Pane) => JSON.parse(p.act("layout.get").out).layers as Layer[];
const names = (p: Pane) => layers(p).flatMap(l => l.tiles.map(t => `${l.drawer ? "drawer" : l.screen}/${t.name}`));

describe.skipIf(!outliner || !Bun.which("tmux"))("a fresh drawer keeps its shell (PIE-1798)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  for (const cols of [120, 44]) test(`^W a into a fresh drawer, then ^W B: the move goes back, the drawer's shell stays for the next alt+a (${cols} columns)`, async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", cols, 30);
    try {
      p.keys("C-w", "v"); await until(() => layers(p).find(l => !l.drawer)!.tiles.length === 2, "a preview");
      expect(layers(p).some(l => l.drawer)).toBe(false);   // the drawer never opened
      p.keys("C-w", "a");
      await until(() => names(p).includes("drawer/detail"), "detail in the drawer", 5000);
      p.keys("C-w", "B");
      await until(() => names(p).includes("detail/detail"), "detail back on the screen", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}`); });
      await Bun.sleep(600);
      p.keys("Escape");
      p.keys("M-a");   // alt+a: the drawer
      await Bun.sleep(1200);
      expect(names(p)).toContain("drawer/shell");
      expect(p.capture()).not.toContain("ep0ch · drawer");
    } finally { p.close(); }
  }, 60_000);

  // The same with a reader and its answer, which move as one (PIE-1794): the pair's own transaction took in the drawer's
  // making, so ^W B took the shell back with the move.
  test("a pair's first move into a fresh drawer, then ^W B: the drawer's shell stays", async () => {
    const p = await doors.pane(await doors.create("Pea sticks\ncut hazel"), "Pea sticks", 120, 30);
    try {
      p.keys("e"); await until(() => p.capture().includes("editing"), "the edit");
      await doors.ask(p, "@tally the sticks");
      p.keys("C-s"); await until(() => !p.capture().includes("editing"), "saved");
      await until(() => layers(p).find(l => !l.drawer)!.tiles.some(t => t.kind === "answer"), "its answer beside it");
      await Bun.sleep(2200);
      expect(p.act("tile.open", "kind=reader", "name=spare", "to=detail", "where=down").ok).toBe(true);
      await until(() => names(p).includes("detail/spare"), "a spare reader");
      expect(layers(p).some(l => l.drawer)).toBe(false);
      if (layers(p).find(l => !l.drawer)!.tiles.find(t => t.focused)?.name !== "detail") { await Bun.sleep(2200); expect(p.act("tile.focus", "tile=detail").ok).toBe(true); }
      await until(() => layers(p).find(l => !l.drawer)!.tiles.find(t => t.focused)?.name === "detail", "his keys on the reader");
      p.keys("C-w", "a");
      await until(() => names(p).includes("drawer/detail") && names(p).includes("drawer/answer"), "the pair in the drawer", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}`); });
      p.keys("C-w", "B");
      await until(() => names(p).includes("detail/detail") && names(p).includes("detail/answer"), "the pair back", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}`); });
      await Bun.sleep(600);
      p.keys("Escape");
      p.keys("M-a");
      await Bun.sleep(1200);
      expect(names(p)).toContain("drawer/shell");
      expect(p.capture()).not.toContain("ep0ch · drawer");
    } finally { p.close(); }
  }, 90_000);
});

