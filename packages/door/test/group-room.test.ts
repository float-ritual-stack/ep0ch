// PIE-1771: Evan's desk is four tiles of 44 columns (an edit, its answer, two notes). Gathering the edit and its answer
// into a group (^W space, a shift-click on the answer's title, ^W G) kept the group at one tile's 44 columns and gave
// the answer's room to the others, then split the 44 by the old splits' weights: a 9-column edit. The group takes the
// room its tiles had, split as they had it, and ^W > on it grows it whole. Real panes over a scratch service with a
// made-up agent; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { TallyDoors, type Pane } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("a group gathered on a desk of 44-column tiles (PIE-1771)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  /** Each tile on the screen with its width, as layout.get has them (`drawer`: the drawer's layer instead). */
  const widths = (p: Pane, drawer = false) => ((JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: { name: string; rect?: { cols: number } }[] }[]).find(l => l.drawer === drawer)?.tiles ?? []).map(t => `${t.name} ${t.rect?.cols}`);
  const cols = (p: Pane, name: string) => Number(widths(p).find(w => w.startsWith(`${name} `))?.split(" ")[1] ?? 0);
  /** The edit's frame as drawn, from its ╔ to its ╗. */
  const editCols = (frame: string) => { const line = [...(frame.split("\n").find(l => l.includes("╔═ editing")) ?? "")]; const at = line.indexOf("╔"); return at < 0 ? 0 : line.indexOf("╗", at) - at + 1; };

  /** Evan's desk, made up: an edit with its answer beside, two notes, four tiles of 44 columns in 177; the keys in the edit. */
  async function desk() {
    const marrow = await doors.create("Marrow bed\nnet it"), runner = await doors.create("Runner beans\ntie them in");
    const p = await doors.pane(await doors.create("Bean rows\nstake the runners"), "Bean rows", 177, 40);
    p.keys("e");
    await until(() => p.capture().includes("editing"), "the edit");
    await doors.ask(p, "@tally the stakes");
    // Opened while he types, they land beside.
    for (const [n, note] of [[3, marrow], [4, runner]] as const) { expect(p.act("open", `id=${note}`).ok).toBe(true); await until(() => widths(p).length === n, `tile ${n} open`); }
    // Saved, so an agent may lay the desk out (it never resizes the tile the person types in); with no room for four at
    // 177 some folded to spines, opened again here. Then back into the edit.
    p.keys("C-s");
    await until(() => !p.capture().includes("editing"), "saved");
    const quarter = () => { for (const a of [["layout.even"], ["layout.resize", "split=s1", "border=0", "share=0.25"]]) expect([a.join(" "), p.act(...a).ok]).toEqual([a.join(" "), true]); };
    quarter();
    for (const w of widths(p)) if (Number(w.split(" ")[1]) < 10) expect(p.act("tile.expand", `tile=${w.split(" ")[0]}`).ok).toBe(true);
    quarter();
    await until(() => widths(p).join() === "detail 44,answer 44,detail2 44,detail3 45", "the 44/44/44/45 desk", 5000).catch(e => { throw new Error(`${e.message}: ${widths(p).join()}`); });
    p.keys("e");
    await until(() => p.capture().includes("editing"), "the edit again");
    return p;
  }
  /** ^W space on the edit, a shift-click on the answer's title, ^W G: the person's gather. */
  async function gather(p: Pane) {
    p.keys("C-w", " ");
    await until(() => p.capture().includes("gathering"), "the edit picked");
    p.click({ col: 52, row: 1 }, 4);
    await Bun.sleep(200);
    p.keys("C-w", "G");
    await until(() => widths(p)[0]?.startsWith("group ") ?? false, "the group", 5000);
  }

  test("a gathered edit and its answer keep the room they had, ^W > grows the group, and a spill and an undo give it back", async () => {
    const p = await desk();
    try {
      await gather(p);
      // The group has both tiles' room, split as they had it: the edit is as wide as before.
      expect(widths(p)).toEqual(["group 89", "detail2 44", "detail3 44"]);
      await until(() => editCols(p.capture()) >= 44, "the edit drawn 44 wide").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      // The hint row says how to grow it; ^W > grows the group as a whole, and > again, in resize mode.
      expect(p.capture()).toContain("wider group");
      p.keys("C-w", ">");
      await until(() => cols(p, "group") > 89, "the group grown");
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

  test("from a gathered group, ^W a takes the edit to the drawer whole, with room to type", async () => {
    const p = await desk();
    try {
      await gather(p);
      // ^W acts on the tile inside, as it did before: the edit goes alone, and has the drawer's room to type in.
      p.keys("C-w", "a");
      await until(() => widths(p, true).some(w => w.startsWith("detail ")), "the edit in the drawer").catch(e => { throw new Error(`${e.message}: ${widths(p, true).join()}\n${p.capture()}`); });
      expect(Number(widths(p, true).find(w => w.startsWith("detail "))!.split(" ")[1])).toBeGreaterThanOrEqual(28);
      await until(() => p.capture().includes("@tally the stakes · answered"), "its ask drawn in the drawer").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
    } finally { p.close(); }
  }, 40_000);
});
