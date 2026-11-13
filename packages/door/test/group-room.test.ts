// PIE-1771: Evan's desk is four tiles of 44 columns (an edit, its answer, two notes). Gathering the edit and its answer
// into a group (^W space, a shift-click on the answer's title, ^W G) kept the group at one tile's 44 columns and gave
// the answer's room to the others, then split the 44 by the old splits' weights: a 9-column edit. The group takes the
// room its tiles had, split as they had it, and ^W > on it grows it whole. Real panes over a scratch service with a
// made-up agent; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { beanDesk, cellOf, cols, gather, TallyDoors, widths } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("a group gathered on a desk of 44-column tiles (PIE-1771)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  /** The edit's frame as drawn, from its ╔ to its ╗. */
  const editCols = (frame: string) => { const line = [...(frame.split("\n").find(l => l.includes("╔═ editing")) ?? "")]; const at = line.indexOf("╔"); return at < 0 ? 0 : line.indexOf("╗", at) - at + 1; };

  const desk = () => beanDesk(doors);

  test("a gathered edit and its answer keep the room they had, ^W > grows the group, and a spill and an undo give it back", async () => {
    const p = await desk();
    try {
      await gather(p);
      // The group has both tiles' room, split as they had it: the edit is as wide as before.
      expect(widths(p)).toEqual(["group 89", "detail2 44", "detail3 44"]);
      await until(() => editCols(p.capture()) >= 44, "the edit drawn 44 wide").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      // The hint row says how to grow it, and a click on it grows the group as a whole (CodeRabbit on #1471: it grew the
      // tile inside); ^W > does too, and > again, in resize mode.
      p.click(cellOf(p.capture(), "wider group")!);
      await until(() => cols(p, "group") > 89, "the group grown by the hint's click").catch(e => { throw new Error(`${e.message}: ${widths(p).join()}`); });
      const clicked = cols(p, "group");
      p.keys("C-w", ">");
      await until(() => cols(p, "group") > clicked, "the group grown");
      const once = cols(p, "group");
      p.keys(">");
      await until(() => cols(p, "group") > once, "the group grown again");
      p.keys("Escape");
      // Spilled, its tiles come back with the group's room between them; undo (^W B) is one step back to the group.
      const room = cols(p, "group");
      p.keys("C-w", "G");
      await until(() => widths(p)[0]?.startsWith("detail ") ?? false, "spilled");
      expect(cols(p, "detail") + cols(p, "answer")).toBe(room);
      p.keys("C-w", "B");
      await until(() => widths(p)[0]?.startsWith("group ") ?? false, "the group back by one undo");
      expect(cols(p, "group")).toBe(room);
    } finally { p.close(); }
  }, 40_000);

  test("the ^W panel says the group's words on a group and the tile's inside it, as the hint row does (PIE-1773)", async () => {
    const p = await desk();
    try {
      await gather(p);
      // Paused after ^W on the group: its resize keys size the group, and the panel says so, as the hint row does.
      p.keys("C-w");
      await until(() => p.capture().includes("narrower group"), "the panel's group words").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      for (const words of ["wider group", "shorter group", "taller group"]) expect(p.capture()).toContain(words);
      p.keys("Escape");
      await until(() => !p.capture().includes("narrower group"), "the panel closed");
      // Gone in (^W e), the keys size a tile inside: the panel says the tile's words, and the hint row no longer offers the group's.
      p.keys("C-w", "e");
      await until(() => p.capture().includes("· in"), "in the group");
      p.keys("C-w");
      await until(() => /narrower(?! group)/.test(p.capture()), "the panel's tile words").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      for (const words of ["narrower group", "wider group", "shorter group", "taller group"]) expect(p.capture()).not.toContain(words);
    } finally { p.close(); }
  }, 40_000);

  test("from a gathered group, ^W a takes the edit to the drawer whole, with room to type", async () => {
    const p = await desk();
    try {
      await gather(p);
      // ^W a from the edit: the group holds just it and its answer, so it goes whole (PIE-1794), and the edit has room to
      // type in there.
      p.keys("C-w", "a");
      await until(() => widths(p, true).some(w => w.startsWith("group ")), "the group in the drawer").catch(e => { throw new Error(`${e.message}: ${widths(p, true).join()}\n${p.capture()}`); });
      const inner = (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; screen: string; tiles: { name: string; rect?: { cols: number } }[] }[]).find(l => l.drawer && l.screen === "group")!.tiles;
      expect(inner.find(t => t.name === "detail")?.rect?.cols ?? 0).toBeGreaterThanOrEqual(28);
      await until(() => p.capture().includes("@tally the stakes · answered"), "its ask drawn in the drawer").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
    } finally { p.close(); }
  }, 40_000);
});
