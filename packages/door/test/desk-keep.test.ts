// PIE-1783, PIE-1782, PIE-1777: Evan's desk comes back after a deploy exactly as he left it, and every group and drawer
// move keeps his tiles where he put them. Each case as he meets it: a real tmux pane over a scratch service (TallyDoors),
// by his keys, or an agent's act on the same door. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { beanDesk, TallyDoors, type Pane } from "./tally-pane";

type Tile = { tile: string; name: string; kind: string; focused: boolean; wires: { verb: string; to: string }[]; showing?: { title: string } };
const layers = (p: Pane) => JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; screen: string; tiles: Tile[] }[];
const deskOf = (p: Pane) => layers(p).find(l => !l.drawer)!.tiles;

describe.skipIf(!outliner || !Bun.which("tmux"))("the desk keeps what Evan made (PIE-1783, PIE-1782, PIE-1777)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  // A tile wired to open into another came back from desk.json with a select wire beside it: the save wrote the open
  // wire as the old `link`, which reads back as a preview's link (open and select).
  test("a desk revived from its save has the wires it was saved with, no more", async () => {
    const note = await doors.create("Seed potatoes\nchit them");
    const desk = ["--screen", "desk"];
    const p = await doors.pane(note, "ep0ch", 160, 34, { state: "keep", screen: desk });
    let before: Tile[];
    try {
      await until(() => deskOf(p).length > 0, "the desk's tiles");
      for (let i = 0; i < 2 && deskOf(p).filter(t => t.kind === "reader").length < 2; i++) expect(p.act("tile.open", "kind=reader").ok).toBe(true);
      await until(() => deskOf(p).filter(t => t.kind === "reader").length >= 2, "two readers");
      const [a, b] = deskOf(p).filter(t => t.kind === "reader");
      expect(p.act("tile.link", `tile=${a!.tile}`, "verb=open", `to=${b!.tile}`).ok).toBe(true);
      await until(() => deskOf(p).find(t => t.tile === a!.tile)!.wires.some(w => w.verb === "open"), "the open wire");
      before = deskOf(p);
      await Bun.sleep(1500);   // the save
    } finally { p.close(); }
    const again = await doors.pane(note, "ep0ch", 160, 34, { state: "keep", screen: desk });
    try {
      await until(() => deskOf(again).length === before!.length, "the revived desk");
      const wires = (ts: Tile[]) => ts.map(t => `${t.name}: ${t.wires.map(w => `${w.verb}→${ts.find(x => x.tile === w.to)?.name ?? w.to}`).sort().join(", ")}`).sort();
      expect(wires(deskOf(again))).toEqual(wires(before!));
    } finally { again.close(); }
  }, 90_000);

  // An agent's tile.group naming the answer tile and a reader answered "grouped answer, detail3", and the group held only
  // detail3: the answer was gone from the screen. Evan's own gather of the edit and its answer keeps it.
  test("an agent's group of the answer tile and a reader holds both", async () => {
    const p = await beanDesk(doors);
    try {
      p.keys("Escape");
      await until(() => !p.capture().includes("editing"), "out of the edit");
      const grouped = p.act("tile.group", "tile=answer", "with=detail3");
      expect(grouped.ok).toBe(true);
      await Bun.sleep(500);
      const ls = layers(p), group = ls.find(l => l.screen === "group");
      console.log(JSON.stringify(ls.map(l => [l.screen, l.tiles.map(t => t.name)])));
      expect(group?.tiles.map(t => t.name).sort()).toEqual(["answer", "detail3"]);
    } finally { p.close(); }
  }, 90_000);
});

