// PIE-1798: Evan sends a tile to a drawer he hasn't opened yet, changes his mind with ^W B, and the drawer still has its
// shell when he opens it next. A real tmux pane over a scratch service (TallyDoors), his keys. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { cellOf, TallyDoors, type Pane } from "./tally-pane";

type Tile = { tile: string; name: string; kind: string; focused: boolean; rect?: { col: number; row: number; cols: number; rows: number } };
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

  /** A reader "detail" with its answer beside it and a spare reader, at 120×30, his keys on the reader. */
  async function pairPane() {
    const p = await doors.pane(await doors.create("Pea sticks\ncut hazel"), "Pea sticks", 120, 30);
    p.keys("e"); await until(() => p.capture().includes("editing"), "the edit");
    await doors.ask(p, "@tally the sticks");
    p.keys("C-s"); await until(() => !p.capture().includes("editing"), "saved");
    await until(() => layers(p).find(l => !l.drawer)!.tiles.some(t => t.kind === "answer"), "its answer beside it");
    await Bun.sleep(2200);
    expect(p.act("tile.open", "kind=reader", "name=spare", "to=detail", "where=down").ok).toBe(true);
    await until(() => names(p).includes("detail/spare"), "a spare reader");
    return p;
  }

  // A drag of the reader onto the drawer chip refused ("goes with its answer") what ^W a does with the same reader: the
  // drop asks what tile.drawer will do, so the pair goes in together.
  test("a drag of a reader onto the drawer chip moves it with its answer, as ^W a does", async () => {
    const p = await pairPane();
    try {
      const head = layers(p).find(l => !l.drawer)!.tiles.find(t => t.name === "detail")!.rect!;
      const frame = p.capture(), chip = (cellOf(frame, "▲") ?? cellOf(frame, "▼"))!;   // the drawer's chip on the status bar
      expect(chip).not.toBeNull();
      const at = (c: number, r: number, b: number, up = false) => p.type(`\x1b[<${b};${c};${r}${up ? "m" : "M"}`);
      at(head.col + 5, head.row + 1, 0);
      at(head.col + 10, head.row + 3, 32);
      at(chip.col, chip.row, 32);
      await Bun.sleep(300);
      // The status line redraws while a tile is dragged, so the chip may have moved: over it where it is now.
      const there = cellOf(p.capture(), "▲") ?? chip;
      at(there.col, there.row, 32);
      await Bun.sleep(300);
      expect(p.capture()).not.toContain("goes with its answer");
      at(there.col, there.row, 0, true);
      await until(() => names(p).includes("drawer/detail") && names(p).includes("drawer/answer"), "the pair in the drawer", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}\n${p.capture().split("\n").slice(-2).join("\n")}`); });
    } finally { p.close(); }
  }, 90_000);

  // After a pair's move the bar named only the reader, even with his keys on the answer: it names the pair.
  test("the bar names the pair a move took, from the answer as from the reader", async () => {
    const p = await pairPane();
    try {
      const answer = layers(p).find(l => !l.drawer)!.tiles.find(t => t.kind === "answer")!;
      expect(p.act("tile.focus", `tile=${answer.tile}`).ok).toBe(true);
      await until(() => layers(p).find(l => !l.drawer)!.tiles.find(t => t.focused)?.kind === "answer", "his keys on the answer");
      p.keys("C-w", "a");
      await until(() => names(p).includes("drawer/detail"), "the pair in the drawer", 5000);
      await until(() => p.capture().includes("detail and its answer"), "the bar naming both", 3000).catch(e => { throw new Error(`${e.message}: ${p.capture().split("\n").slice(-2).join(" | ")}`); });
    } finally { p.close(); }
  }, 90_000);
});

