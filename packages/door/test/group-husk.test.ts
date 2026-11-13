// PIE-1775: groups leave nothing behind, and an agent's open always finds the reader. On Evan's 44/44/44/45 desk, `^W a`
// from a gathered group took the edit to the drawer, its answer closed with it, and the group stayed on the desk with
// nothing in it, 115 columns drawn as the home card. And at 44×30, `^W v` then `^W x` left the preview as the screen's
// reader, and an agent's `act open` was refused ("the detail row is gone"): the screen's landing named the tile `detail`,
// gone into the group or the drawer or closed. Real panes over a scratch service with a made-up agent; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { beanDesk, cellOf, gather, TallyDoors, widths, type Pane } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("groups leave nothing behind (PIE-1775)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  const sum = (ws: string[]) => ws.reduce((n, w) => n + Number(w.split(" ")[1]), 0);
  const show = (p: Pane) => `${widths(p).join()} | drawer ${widths(p, true).join()}\n${p.capture()}`;
  /**
   * ^W a from the gathered group, until it's in the drawer and gone from the desk. The group holds just the edit and its
   * answer, so it goes whole (PIE-1794: a reader and its answer move as one; the answer no longer closes).
   */
  async function toDrawer(p: Pane) {
    p.keys("C-w", "a");
    await until(() => widths(p, true).some(w => w.startsWith("group ")), "the group in the drawer").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
    await until(() => !widths(p).some(w => w.startsWith("group")), "the group gone from the desk", 3000).catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
  }

  test("^W a from a gathered group: the group goes whole and gives its room back; the keys stay in the edit; ^W a brings it back", async () => {
    const p = await beanDesk(doors);
    try {
      await gather(p);
      expect(widths(p)).toEqual(["group 89", "detail2 44", "detail3 44"]);
      await toDrawer(p);
      // No husk: the two notes left have the desk's 177 columns between them, and nothing draws the home card.
      expect(widths(p).map(w => w.split(" ")[0])).toEqual(["detail2", "detail3"]);
      expect(sum(widths(p)) + 1).toBeGreaterThanOrEqual(177);
      expect(p.capture()).not.toContain("ep0ch · group");
      // The keys went with the edit, as they do from any tile.
      await until(() => p.capture().includes("╔═ editing"), "the keys in the drawer's edit").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      // And back: ^W a in the drawer takes the pair out onto the desk, its group whole (PIE-1794).
      p.keys("C-w", "a");
      await until(() => widths(p).some(w => w.startsWith("group ")), "the group back on the desk").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      expect(widths(p, true).some(w => w.startsWith("group"))).toBe(false);
    } finally { p.close(); }
  }, 40_000);

  test("^W B after the group went brings the group back with the edit in it, one copy, in one step", async () => {
    const p = await beanDesk(doors);
    try {
      await gather(p);
      await toDrawer(p);
      p.keys("C-w", "B");
      await until(() => widths(p)[0]?.startsWith("group ") ?? false, "the group back").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      expect(widths(p, true).some(w => w.startsWith("detail "))).toBe(false);
      const inside = (JSON.parse(p.act("layout.get").out).tiles as { name: string; path?: string }[]).filter(t => t.name === "detail");
      expect(inside).toHaveLength(1);
      await until(() => p.capture().includes("Bean rows"), "the edit drawn in the group").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
    } finally { p.close(); }
  }, 40_000);

  test("^W x on a group's reader: its answer closes, the emptied group goes, and ^W B brings the group back with the reader", async () => {
    const p = await beanDesk(doors);
    try {
      await gather(p);
      p.keys("C-s");
      await until(() => !p.capture().includes("editing"), "saved");
      p.keys("C-w", "x");
      await until(() => !widths(p).some(w => w.startsWith("group")), "the emptied group gone", 5000).catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      expect(widths(p).map(w => w.split(" ")[0])).toEqual(["detail2", "detail3"]);
      p.keys("C-w", "B");
      await until(() => widths(p)[0]?.startsWith("group ") ?? false, "the group back").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      await until(() => p.capture().includes("Bean rows"), "its reader drawn").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      const back = widths(p).join();
      await Bun.sleep(500);
      expect(widths(p).join()).toBe(back);
      expect(p.capture()).toContain("Bean rows");
    } finally { p.close(); }
  }, 40_000);

  test("an undo after a spill brings the group back as it last stood, its tiles at the shares they had", async () => {
    const p = await beanDesk(doors);
    /** The group's own tiles with their widths, as layout.get has its layer. */
    const inner = () => ((JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: { name: string; rect?: { cols: number } }[] }[]).filter(l => !l.drawer)[1]?.tiles ?? []).map(t => `${t.name} ${t.rect?.cols}`).join();
    try {
      await gather(p);
      const gathered = inner();
      // Gone in, the edit made wider inside the group; then out.
      p.keys("C-w", "e");
      await until(() => p.capture().includes("· in"), "in the group");
      p.keys("C-w", ">");
      await until(() => inner() !== gathered, "the edit wider inside").catch(e => { throw new Error(`${e.message}: ${inner()}`); });
      p.keys("Escape", "C-]");
      await until(() => !p.capture().includes("· in"), "out of the group");
      const stood = inner();
      p.keys("C-w", "G");
      await until(() => widths(p)[0]?.startsWith("detail ") ?? false, "spilled").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      p.keys("C-w", "B");
      await until(() => widths(p)[0]?.startsWith("group ") ?? false, "the group back").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      await until(() => inner() === stood, "its tiles as they last stood", 3000).catch(e => { throw new Error(`${e.message}: ${inner()}, was ${stood} (gathered ${gathered})`); });
    } finally { p.close(); }
  }, 40_000);

  test("gone into a group, ^W G offers to spill the group, not to gather the whole group again", async () => {
    const p = await beanDesk(doors);
    try {
      await gather(p);
      p.keys("C-w", "e");
      await until(() => p.capture().includes("· in"), "in the group");
      p.keys("C-w", "G");
      await until(() => p.capture().includes("spill the group"), "the question").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(p.capture()).not.toContain("the whole split");
      p.click(cellOf(p.capture(), "spill the group")!);
      await until(() => widths(p)[0]?.startsWith("detail ") ?? false, "spilled").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      expect(widths(p).map(w => w.split(" ")[0])).toEqual(["detail", "answer", "detail2", "detail3"]);
    } finally { p.close(); }
  }, 40_000);

  test("an agent's open lands in the screen's reader after a gather and after ^W a from the group", async () => {
    const honey = await doors.create("Jar the honey\nwarm the jars"), wax = await doors.create("Render the wax\nstrain it twice");
    const p = await beanDesk(doors);
    try {
      await gather(p);
      const gathered = p.act("open", `id=${honey}`);
      expect([gathered.ok, gathered.out]).toEqual([true, expect.any(String)]);
      await until(() => p.capture().includes("Jar the honey"), "the open after a gather").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
      await toDrawer(p);
      const drawn = p.act("open", `id=${wax}`);
      expect([drawn.ok, drawn.out]).toEqual([true, expect.any(String)]);
      await until(() => p.capture().includes("Render the wax"), "the open after ^W a").catch(e => { throw new Error(`${e.message}: ${show(p)}`); });
    } finally { p.close(); }
  }, 40_000);

  test("at 44×30, after ^W v then ^W x, an agent's open lands in the reader left", async () => {
    const hives = await doors.create("Check the hives\nLift each frame"), honey = await doors.create("Jar the honey\nwarm the jars");
    const p = await doors.pane(hives, "Check the hives", 44, 30);
    try {
      p.keys("C-w", "v");
      await until(() => widths(p).length === 2, "the preview beside");
      p.keys("C-w", "x");
      await until(() => widths(p).length === 1, "the reader closed");
      // Its note stays on screen, in the preview; the bar says what happened in tile names, never a tile's id.
      const r = p.act("open", `id=${honey}`);
      expect([r.ok, r.out]).toEqual([true, expect.any(String)]);
      await until(() => p.capture().includes("Jar the honey"), "the open drawn").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      // In the tile that's there, not a new one beside it.
      expect(widths(p)).toHaveLength(1);
    } finally { p.close(); }
  }, 40_000);

  test("closing the preview a reader opens into says the wire dropped in tile names, never a tile's id", async () => {
    const p = await doors.pane(await doors.create("Smoke the bees\ngently"), "Smoke the bees", 44, 30);
    try {
      p.keys("C-w", "v");
      await until(() => widths(p).length === 2, "the preview beside");
      p.keys("C-w", "l");
      await Bun.sleep(150);
      p.keys("C-w", "x");
      await until(() => widths(p).length === 1, "the preview closed");
      await until(() => p.capture().includes("wire dropped"), "the bar says so").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(p.capture()).toContain("detail: open wire dropped; detail-preview");
      expect(p.capture()).not.toMatch(/\(t-[0-9a-f]/);
    } finally { p.close(); }
  }, 40_000);
});
