// PIE-1794 / PIE-1792 round three: a reader and its answer move as one. ^W a on either sends both to the drawer (a group
// holding just the two goes whole), one ^W B brings both back, and no path closes the answer. Each path as Evan meets
// it: a real tmux pane over a scratch service (TallyDoors), his keys, or an agent's act. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { TallyDoors, type Pane } from "./tally-pane";

type Tile = { tile: string; name: string; kind: string; focused: boolean };
type Layer = { drawer: boolean; screen: string; tiles: Tile[] };
const layers = (p: Pane) => JSON.parse(p.act("layout.get").out).layers as Layer[];
const where = (l: Layer) => (l.screen === "group" ? "group" : l.drawer ? "drawer" : l.screen);   // a group's own layer, in the drawer or not
const names = (p: Pane) => layers(p).flatMap(l => l.tiles.map(t => `${where(l)}/${t.name}`));
const answers = (p: Pane) => layers(p).flatMap(l => l.tiles.filter(t => t.kind === "answer").map(t => `${where(l)}/${t.name}`));
const screen = (p: Pane) => layers(p).find(l => !l.drawer && l.screen === "detail")!.tiles;

describe.skipIf(!outliner || !Bun.which("tmux"))("a reader and its answer move as one (PIE-1794)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  /** A detail screen at `cols`: the reader "detail" with its answer beside it, and a spare reader so the screen keeps a tile. */
  async function pairDesk(cols: number) {
    const p = await doors.pane(await doors.create("Pea sticks\ncut hazel"), "Pea sticks", cols, 40);
    p.keys("e"); await until(() => p.capture().includes("editing"), "the edit");
    await doors.ask(p, "@tally the sticks");
    p.keys("C-s"); await until(() => !p.capture().includes("editing"), "saved");
    await until(() => answers(p).length === 1, "its answer beside it");
    await Bun.sleep(2200);   // his keys idle, so an agent may lay the desk out
    expect(p.act("tile.open", "kind=reader", "name=spare", "to=detail", "where=down").ok).toBe(true);
    await until(() => screen(p).some(t => t.name === "spare"), "a spare reader");
    return p;
  }
  /** His keys on tile `name` of layer `screenName` (an act, then waited for). */
  async function keysOn(p: Pane, name: string, screenName = "detail") {
    const t = layers(p).find(l => l.screen === screenName)!.tiles.find(x => x.name === name)!;
    await Bun.sleep(2200);   // his keys idle since his last key, so the act may move them
    expect(p.act("tile.focus", `tile=${t.tile}`).ok).toBe(true);
    await until(() => layers(p).find(l => l.screen === screenName)!.tiles.find(x => x.focused)?.name === name, `his keys on ${name}`);
  }
  /** Both in the drawer, one answer anywhere, then one ^W B and both back on the screen. */
  async function bothThereAndBack(p: Pane, there: (n: string[]) => boolean, back: (n: string[]) => boolean) {
    await until(() => there(names(p)), "both moved", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}\n${p.capture().split("\n").slice(-2).join("\n")}`); });
    await Bun.sleep(500);
    expect(answers(p)).toHaveLength(1);
    expect(there(names(p))).toBe(true);
    p.keys("C-w", "B");
    await until(() => back(names(p)), "both back in one ^W B", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}`); });
    await Bun.sleep(500);
    expect(answers(p)).toHaveLength(1);
  }
  const onScreen = (n: string[]) => n.includes("detail/detail") && n.some(x => x.startsWith("detail/answer"));
  const inDrawer = (n: string[]) => n.includes("drawer/detail") && n.some(x => x.startsWith("drawer/answer"));
  const groupInDrawer = (n: string[]) => n.some(x => x.startsWith("drawer/group")) && n.includes("group/detail") && n.some(x => x.startsWith("group/answer"));
  const groupOnScreen = (n: string[]) => n.some(x => x.startsWith("detail/group")) && n.includes("group/detail") && n.some(x => x.startsWith("group/answer"));
  /** ^W G on the reader (and ⏎ on "this tile", which takes its answer): the pair in a group of its own on the screen. */
  async function gatherPair(p: Pane) {
    await keysOn(p, "detail");
    p.keys("C-w", "G");
    await Bun.sleep(400);
    if (p.capture().includes("whole split")) p.keys("Enter");
    await until(() => groupOnScreen(names(p)), "the pair gathered", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}`); });
  }

  for (const cols of [177, 44]) test(`^W a on the reader sends both to the drawer, ^W B brings both back (${cols} columns)`, async () => {
    const p = await pairDesk(cols);
    try {
      await keysOn(p, "detail");
      p.keys("C-w", "a");
      await bothThereAndBack(p, inDrawer, onScreen);
    } finally { p.close(); }
  }, 90_000);

  test("^W a on the answer sends both to the drawer, ^W B brings both back", async () => {
    const p = await pairDesk(177);
    try {
      await keysOn(p, answers(p)[0]!.split("/")[1]!);
      p.keys("C-w", "a");
      await bothThereAndBack(p, inDrawer, onScreen);
    } finally { p.close(); }
  }, 90_000);

  for (const on of ["reader", "answer"] as const) test(`^W a on the ${on} inside their group sends the group whole`, async () => {
    const p = await pairDesk(177);
    try {
      await gatherPair(p);
      await keysOn(p, on === "reader" ? "detail" : answers(p)[0]!.split("/")[1]!, "group");
      p.keys("C-w", "a");
      await bothThereAndBack(p, groupInDrawer, groupOnScreen);
    } finally { p.close(); }
  }, 90_000);

  test("an agent's tile.drawer on the pair's group sends it whole, and from the drawer's group ^W a closes nothing", async () => {
    const p = await pairDesk(177);
    try {
      await gatherPair(p);
      await keysOn(p, "spare");
      await Bun.sleep(2200);
      const group = screen(p).find(t => t.kind === "screen")!;
      const r = p.act("tile.drawer", `tile=${group.tile}`);
      expect([r.ok, r.out]).toEqual([true, expect.any(String)]);
      await until(() => groupInDrawer(names(p)), "the group in the drawer", 5000).catch(e => { throw new Error(`${e.message}: ${names(p).join()}`); });
      expect(answers(p)).toHaveLength(1);
      // In the drawer's group, ^W a on the reader: the pair goes on together (out of the drawer, the group whole), or is
      // refused with why; never the answer closing.
      await keysOn(p, "detail", "group");
      p.keys("C-w", "a");
      await Bun.sleep(1500);
      expect(answers(p)).toHaveLength(1);
      expect(names(p)).toContain("group/detail");
    } finally { p.close(); }
  }, 90_000);
});
