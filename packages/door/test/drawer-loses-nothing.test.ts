// PIE-1792: Evan sends any tile to the drawer or gathers it into a group, and it's there when he looks, at 44 columns
// as at 177. Each case as he meets it: a real tmux pane over a scratch service (TallyDoors), by his keys, or an agent's
// act on the same door. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { beanDesk, TallyDoors, type Pane } from "./tally-pane";

type Tile = { tile: string; name: string; kind: string; focused: boolean; showing?: { title: string } };
const layers = (p: Pane) => JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; screen: string; tiles: Tile[] }[];
const names = (p: Pane) => layers(p).flatMap(l => l.tiles.map(t => `${l.drawer ? "drawer" : l.screen}/${t.name}`));

describe.skipIf(!outliner || !Bun.which("tmux"))("the drawer and groups never lose a tile (PIE-1792)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  // ^W a on an answer tile said "put answer in your drawer from the detail", and the answer closed itself there: its
  // reader stayed on the desk, out of the drawer's reach. Now the move is refused with why, and nothing closes.
  test("^W a on an answer tile keeps it: refused with why, the answer still beside its reader", async () => {
    const p = await beanDesk(doors);
    try {
      p.keys("Escape");
      await until(() => !p.capture().includes("editing"), "out of the edit");
      const answer = layers(p).find(l => !l.drawer)!.tiles.find(t => t.name === "answer")!;
      expect(p.act("tile.focus", `tile=${answer.tile}`).ok).toBe(true);
      await until(() => layers(p).find(l => !l.drawer)!.tiles.find(t => t.focused)?.name === "answer", "his keys on the answer");
      p.keys("C-w", "a");
      await Bun.sleep(1200);
      expect(names(p)).toContain("detail/answer");
      expect(p.capture()).toContain("goes with its reader");
    } finally { p.close(); }
  }, 90_000);

  // Inside a group of one (at 44 columns the common shape), ^W G asked nothing and nested a second group of one:
  // group/group/tile. Now it says why not, and nothing nests.
  test("^W G inside a group of one doesn't nest another", async () => {
    const p = await doors.pane(await doors.create("Leek trench\ndig it deep"), "Leek trench", 44, 30);
    try {
      const desk = () => layers(p).find(l => !l.drawer)!.tiles;
      for (let i = 0; i < 3 && desk().length < 3; i++) { p.keys("C-w", "v"); await Bun.sleep(800); }
      await until(() => desk().length >= 3, "three tiles");
      p.keys("C-w", "G"); await until(() => p.capture().includes("gather into a group"), "the question");
      p.keys("Enter"); await until(() => layers(p).some(l => l.screen === "group"), "a group of one");
      p.keys("C-w", "e"); await until(() => p.capture().includes("in the group"), "in the group");
      p.keys("C-w", "G");
      await Bun.sleep(1200);
      expect(layers(p).filter(l => l.screen === "group").length).toBe(1);
      expect(p.capture()).toContain("a group of one");
    } finally { p.close(); }
  }, 60_000);

  // The drawer's tab strip put the "*" (just opened here) by the shell while the note had landed in the preview: the
  // mark sat at the frame's corner, over the first tab, whatever tab it was for.
  test("the drawer's tab strip marks the tab a note just landed in, not the first tab", async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 120, 30);
    try {
      const drawer = () => layers(p).find(l => l.drawer)!;
      p.keys("C-w", "v"); await until(() => layers(p).find(l => !l.drawer)!.tiles.length === 2, "a preview");
      expect(p.act("tile.open", "kind=reader").ok).toBe(true);
      await until(() => layers(p).find(l => !l.drawer)!.tiles.length === 3, "a third tile");
      p.keys("C-w", "h"); await Bun.sleep(300);
      p.keys("C-w", "a"); await until(() => drawer().tiles.some(t => t.name === "detail"), "detail in the drawer");
      expect(p.act("tile.drawer", "tile=detail-preview").ok).toBe(true);
      await until(() => drawer().tiles.some(t => t.name === "detail-preview"), "its preview in the drawer");
      p.keys("C-w", "x");
      await until(() => drawer().tiles.find(t => t.focused)?.name === "detail-preview", "the preview in front with the note");
      await Bun.sleep(300);
      const strip = p.capture().split("\n").find(l => l.includes("sh |"))!;
      expect(strip).not.toContain("*sh");
      expect(strip).toContain("*Seed tray");
    } finally { p.close(); }
  }, 60_000);
});

