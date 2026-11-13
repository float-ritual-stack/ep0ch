// PIE-1780: each desk question has one decider. Where two deciders gave different answers (desk-split's inventory,
// PIE-1778), the case is here as Evan meets it: a real tmux pane over a scratch service (TallyDoors), by his keys, or an
// agent's act on the same door. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { TallyDoors } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("one decider per desk question (PIE-1780)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  // Which tile a ^W key acts on: the ^W table asked tileId(focus), which threw on an emptied drawer and took the door
  // down (^W z: "the door crashed: WeakMap keys must be objects"), where focusId says none. And tileNamed and
  // tileNumbered looked a tile up the same way with two refusals; the second said "no tile undefined on the screen".
  test("an emptied drawer says it's empty to ^W z, as to every tile key", async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 120, 30);
    try {
      const drawerTiles = () => (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: { tile: string }[] }[]).find(l => l.drawer)?.tiles ?? [];
      // His keys into the drawer's shell; the shell ended, its tile closed: the drawer is empty, his keys still in it.
      p.keys("M-a");
      await until(() => drawerTiles().length > 0, "the drawer's shell");
      await Bun.sleep(500);
      p.type("exit"); p.keys("Enter");
      await Bun.sleep(800);
      for (let i = 0; i < 4 && drawerTiles().length; i++) { p.keys("C-w", "x"); await Bun.sleep(400); }
      expect(drawerTiles()).toEqual([]);
      p.keys("C-w", "z");
      await Bun.sleep(600);
      const frame = p.capture();
      expect(frame).not.toContain("the door crashed");
      expect(frame).not.toContain("no tile undefined");
      expect(frame).toContain("this screen is empty");
    } finally { p.close(); }
  }, 60_000);
});
