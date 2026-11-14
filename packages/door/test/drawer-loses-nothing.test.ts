// PIE-1792: Evan sends any tile to the drawer or gathers it into a group, and it's there when he looks, at 44 columns
// as at 177. Each case as he meets it: a real tmux pane over a scratch service (TallyDoors), by his keys, or an agent's
// act on the same door. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until, untilAsync } from "./scratch";
import { beanDesk, TallyDoors, type Layer, type Pane, idle, layersOf as layers } from "./tally-pane";

// What the walk reads to see where the tiles are is the pane's own read (layout.get in this process, PIE-1804); what
// an agent does is `act`, the CLI.
const names = async (p: Pane) => (await layers(p)).flatMap(l => l.tiles.map(t => `${l.drawer ? "drawer" : l.screen}/${t.name}`));
/** `until` over the door's layers, read each time. */
const untilLayers = (p: Pane, ok: (l: Layer[]) => boolean, what: string) => untilAsync(async () => ok(await layers(p)), what, 5000);
/** The screen's tiles (`screen` names which, when a group has a layer of its own), the drawer's layer, and whether there's a group. */
const onScreen = (l: Layer[], screen?: string) => l.find(x => !x.drawer && (!screen || x.screen === screen))!.tiles;
const drawerOf = (l: Layer[]) => l.find(x => x.drawer)!;
const hasGroup = (l: Layer[]) => l.some(x => x.screen === "group");

describe.skipIf(!outliner || !Bun.which("tmux"))("the drawer and groups never lose a tile (PIE-1792)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  // ^W a on an answer tile (it closed itself in the drawer, out of its reader's reach), and its mirror on the reader
  // (round two): both now move the pair as one, test/answer-pair.test.ts (PIE-1794).

  // ^W G and ⏎ on "this tile or the whole split?" gathered the reader alone and its answer closed. The gather takes the
  // answer with it, and the row says so.
  test("^W G and ⏎ on the reader of an answer gathers both", async () => {
    const p = await beanDesk(doors);
    try {
      p.keys("Escape");
      await until(() => !p.capture().includes("editing"), "out of the edit");
      expect(p.act("tile.focus", `tile=${onScreen(await layers(p), "detail").find(t => t.name === "detail")!.tile}`).ok).toBe(true);
      await untilLayers(p, l => onScreen(l, "detail").find(t => t.focused)?.name === "detail", "his keys on the reader");
      p.keys("C-w", "G"); await until(() => p.capture().includes("whole split"), "the split question");
      expect(p.capture()).toContain("this tile · detail and its answer");
      p.keys("Enter");
      await untilLayers(p, hasGroup, "the group");
      expect(await names(p)).toEqual(expect.arrayContaining(["group/detail", "group/answer"]));
      expect(await names(p)).not.toContain("detail/answer");
    } finally { p.close(); }
  }, 90_000);

  // A group holding an answer, its reader outside the group: ^W a on the group carried the answer away from its
  // reader too (CodeRabbit on #1493). His keys inside the group take ^W a to the answer itself, so it's the group's own send. The carry asks every tile it takes, so it's refused the same way.
  test("a group holding an answer, sent to the drawer, keeps it: refused with why, nothing closes", async () => {
    const p = await beanDesk(doors);
    try {
      p.keys("Escape");
      await until(() => !p.capture().includes("editing"), "out of the edit");
      const screen = async () => onScreen(await layers(p), "detail");
      const answer = (await screen()).find(t => t.name === "answer")!;
      const grouped = p.act("tile.group", `tile=${answer.tile}`, "with=detail3");
      expect(grouped.ok).toBe(true);
      await untilLayers(p, l => !onScreen(l, "detail").some(t => t.name === "answer"), "the answer in a group");
      // The whole group goes (an agent's tile.drawer on it, or its frame's drawer press); his keys inside it take ^W a to
      // the answer itself, the case above.
      const group = (await screen()).find(t => t.kind === "screen")!;
      const sent = p.act("tile.drawer", `tile=${group.tile}`);
      expect(sent.ok).toBe(false);
      expect(sent.out).toContain("goes with its reader");
      await Bun.sleep(600);
      expect((await screen()).some(t => t.tile === group.tile)).toBe(true);
      expect(await names(p)).toContain("group/answer");
    } finally { p.close(); }
  }, 90_000);

  // Inside a group of one (at 44 columns the common shape), ^W G asked nothing and nested a second group of one:
  // group/group/tile. Now it says why not, and nothing nests.
  test("^W G inside a group of one doesn't nest another", async () => {
    const p = await doors.pane(await doors.create("Leek trench\ndig it deep"), "Leek trench", 44, 30);
    try {
      // ^W v until there are three: each press waited for by the tile it opens (or 800 ms, when it opens none).
      const tiles = async () => onScreen(await layers(p)).length;
      for (let i = 0; i < 3; i++) {
        const n = await tiles();
        if (n >= 3) break;
        p.keys("C-w", "v");
        await untilAsync(async () => (await tiles()) > n, "another tile", 800).catch(() => {});
      }
      await untilLayers(p, l => onScreen(l).length >= 3, "three tiles");
      p.keys("C-w", "G"); await until(() => p.capture().includes("gather into a group"), "the question");
      p.keys("Enter"); await untilLayers(p, hasGroup, "a group of one");
      p.keys("C-w", "e"); await until(() => p.capture().includes("in the group"), "in the group");
      expect(p.capture()).not.toContain("a group of one");
      p.keys("C-w", "G");
      // It says why not (what the wait is for), and then there is still one group.
      await until(() => p.capture().includes("a group of one"), "why it doesn't nest");
      expect((await layers(p)).filter(l => l.screen === "group").length).toBe(1);
    } finally { p.close(); }
  }, 60_000);

  // The drawer's tab strip put the "*" (just opened here) by the shell while the note had landed in the preview: the
  // mark sat at the frame's corner, over the first tab, whatever tab it was for.
  test("the drawer's tab strip marks the tab a note just landed in, not the first tab", async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 120, 30);
    try {
      p.keys("C-w", "v"); await untilLayers(p, l => onScreen(l).length === 2, "a preview");
      expect(p.act("tile.open", "kind=reader").ok).toBe(true);
      await untilLayers(p, l => onScreen(l).length === 3, "a third tile");
      p.keys("C-w", "h"); await Bun.sleep(300);
      p.keys("C-w", "a"); await untilLayers(p, l => drawerOf(l).tiles.some(t => t.name === "detail"), "detail in the drawer");
      expect(p.act("tile.drawer", "tile=detail-preview").ok).toBe(true);
      await untilLayers(p, l => drawerOf(l).tiles.some(t => t.name === "detail-preview"), "its preview in the drawer");
      const strip = () => p.capture().split("\n").find(l => l.includes("sh |")) ?? "";
      expect(strip()).not.toContain("*");
      p.keys("C-w", "x");
      await untilLayers(p, l => drawerOf(l).tiles.find(t => t.focused)?.name === "detail-preview", "the preview in front with the note");
      // The strip drawn with the mark (what the wait is for), then where the mark is.
      await until(() => strip().includes("*"), "the strip's mark");
      expect(strip()).not.toContain("*sh");
      expect(strip()).toContain("*Seed tray");
    } finally { p.close(); }
  }, 60_000);

  // ^W a (tile.drawer) inside a group in the drawer said "put detail in your drawer from the group" while it made the tile a drawer
  // tab of its own: it says what it did now.
  test("a move to the drawer from inside a drawer's group says it made the tile a tab of its own", async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 120, 30);
    try {
      p.keys("C-w", "v"); await untilLayers(p, l => onScreen(l).length === 2, "a preview");
      await idle();   // his keys idle, so an agent may lay the desk out
      expect([p.act("tile.open", "kind=reader")].map(r => [r.ok, r.out])[0]).toEqual([true, expect.any(String)]);   // the screen keeps a tile
      await untilLayers(p, l => onScreen(l).length === 3, "a third tile");
      expect([p.act("tile.focus", "tile=reader")].map(r => [r.ok, r.out])[0]).toEqual([true, expect.any(String)]);
      await untilLayers(p, l => onScreen(l).find(t => t.focused)?.name === "reader", "his keys on the third");
      for (const n of ["detail-preview", "detail"]) { const r = p.act("tile.drawer", `tile=${n}`); expect([n, r.ok, r.out]).toEqual([n, true, expect.any(String)]); await untilLayers(p, l => drawerOf(l).tiles.some(t => t.name === n), `${n} in the drawer`); }
      const inDrawer = drawerOf(await layers(p)).tiles, id = (n: string) => inDrawer.find(t => t.name === n)!.tile;
      const g = p.act("tile.group", `tile=${id("detail")}`, `with=${id("detail-preview")}`); expect([g.ok, g.out]).toEqual([true, expect.any(String)]);
      await untilLayers(p, hasGroup, "a group in the drawer");
      // An agent's move from inside the group (his keys stay on the screen), said on screen as the person's would be.
      const inGroup = (await layers(p)).find(l => l.screen === "group")!.tiles.find(t => t.name === "detail")!;
      expect([p.act("tile.drawer", `tile=${inGroup.tile}`)].map(r => [r.ok, r.out])[0]).toEqual([true, expect.any(String)]);
      await until(() => p.capture().includes("your drawer"), "what it did", 5000);
      expect(p.capture()).toContain("a tab of its own in your drawer");
    } finally { p.close(); }
  }, 60_000);

  // At 44 columns "this tile or the whole split?" didn't say what ⏎ picks: its foot row says it now.
  test("the split question at 44 columns says what ⏎ picks", async () => {
    const p = await doors.pane(await doors.create("Leek trench\ndig it deep"), "Leek trench", 44, 30);
    try {
      p.keys("C-w", "v"); await untilLayers(p, l => onScreen(l).length === 2, "a preview");
      p.keys("C-w", "G"); await until(() => p.capture().includes("whole split"), "the split question");
      expect(p.capture()).toContain("⏎ takes the lit row");
    } finally { p.close(); }
  }, 60_000);

  // CodeRabbit on #1495: a screen of only a reader and its answer let the reader go alone (the answer the one tile left),
  // and the answer closed. The pair goes together now, or not at all (the screen is never blank); either way nothing closes.
  test("a screen of only a reader and its answer: ^W a on the reader closes nothing", async () => {
    const p = await doors.pane(await doors.create("Pea sticks\ncut hazel"), "Pea sticks", 120, 30);
    try {
      p.keys("e"); await until(() => p.capture().includes("editing"), "the edit");
      await doors.ask(p, "@tally the sticks");
      p.keys("C-s"); await until(() => !p.capture().includes("editing"), "saved");
      await untilLayers(p, l => onScreen(l).map(t => t.name).join() === "detail,answer", "only the reader and its answer").catch(async e => { throw new Error(`${e.message}: ${(await names(p)).join()}`); });
      if (onScreen(await layers(p)).find(t => t.focused)?.name !== "detail") p.keys("C-w", "h");
      await untilLayers(p, l => onScreen(l).find(t => t.focused)?.name === "detail", "his keys on the reader");
      expect(p.capture()).not.toContain("move together");
      p.keys("C-w", "a");
      // It says the two move together (what the wait is for), and then both are still on the screen.
      await until(() => p.capture().includes("move together"), "why the reader stays");
      expect(await names(p)).toEqual(expect.arrayContaining(["detail/detail", "detail/answer"]));
    } finally { p.close(); }
  }, 60_000);

  // CodeRabbit on #1495: a gather that names its other tile (with=) or a container (node=) built the group from those
  // alone, so an answer the gather took along had no place in it and was lost. Refused with why now.
  test("a gather with= that would leave a reader's answer out is refused, and nothing is lost", async () => {
    const p = await beanDesk(doors);
    try {
      p.keys("Escape");
      await until(() => !p.capture().includes("editing"), "out of the edit");
      await idle();   // his keys idle, so an agent may lay the desk out
      expect(p.act("tile.focus", "tile=detail2").ok).toBe(true);   // his keys off the tiles it gathers
      await untilLayers(p, l => onScreen(l).find(t => t.focused)?.name === "detail2", "his keys on detail2");
      await idle();
      const r = p.act("tile.group", "tile=detail3", "with=detail");
      expect([r.ok, r.out]).toEqual([false, expect.stringContaining("its answer")]);
      expect(await names(p)).toEqual(expect.arrayContaining(["detail/detail", "detail/answer", "detail/detail3"]));
      expect(hasGroup(await layers(p))).toBe(false);
    } finally { p.close(); }
  }, 90_000);

  // CodeRabbit on #1495: from a drawer's group, a move to a split of the drawer (where=right) said "a tab of its own".
  test("a move from a drawer's group to a split there doesn't call it a tab", async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 120, 30);
    try {
      p.keys("C-w", "v"); await untilLayers(p, l => onScreen(l).length === 2, "a preview");
      await idle();
      expect(p.act("tile.open", "kind=reader").ok).toBe(true);
      await untilLayers(p, l => onScreen(l).length === 3, "a third tile");
      expect(p.act("tile.focus", "tile=reader").ok).toBe(true);
      for (const n of ["detail-preview", "detail"]) { expect(p.act("tile.drawer", `tile=${n}`).ok).toBe(true); await untilLayers(p, l => drawerOf(l).tiles.some(t => t.name === n), `${n} in the drawer`); }
      const inDrawer = drawerOf(await layers(p)).tiles, id = (n: string) => inDrawer.find(t => t.name === n)!.tile;
      expect(p.act("tile.group", `tile=${id("detail")}`, `with=${id("detail-preview")}`).ok).toBe(true);
      await untilLayers(p, hasGroup, "a group in the drawer");
      const inGroup = (await layers(p)).find(l => l.screen === "group")!.tiles.find(t => t.name === "detail")!;
      const r = p.act("tile.drawer", `tile=${inGroup.tile}`, "to=shell", "where=right");
      expect([r.ok, r.out]).toEqual([true, expect.any(String)]);
      await until(() => p.capture().includes("your drawer"), "what it did", 5000);
      expect(p.capture()).not.toContain("a tab of its own");
    } finally { p.close(); }
  }, 60_000);
});

