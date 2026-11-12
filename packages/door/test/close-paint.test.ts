// PIE-1769 (seen on main 1d1fb984): a click on an answer tile's × closed it, and the edit beside it stayed its old size
// over blank rows until the next key (7 s at 44×30, 2 s at 177). The frame after the release draws the new layout, every
// time: a real pane, SGR press and release on the ×, ten closes at each size, the answer back each time by a click on
// its row's `show ▸` as soon as it's there (PIE-1770: a quick second click on it is still a click). Real panes over a
// scratch service with a made-up agent; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { cellOf, TallyDoors } from "./tally-pane";

/** How long after the release the new layout must be on screen: a frame, plus tmux's own round trip. */
const PAINTED_MS = 400;

describe.skipIf(!outliner || !Bun.which("tmux"))("a × click repaints the room at once (PIE-1769)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  /** The answer tile's × (its single-line frame's `x┐`), 1-based for SGR; null when no such tile is drawn. */
  const closeAt = (frame: string): { col: number; row: number } | null => {
    const lines = frame.split("\n");
    for (let row = 0; row < lines.length; row++) {
      const cells = [...lines[row]!];
      for (let col = 1; col < cells.length; col++) if (cells[col] === "┐" && cells[col - 1] === "x" && cells.slice(0, col).includes("┌")) return { col, row: row + 1 };
    }
    return null;
  };

  // The edit fills the room: no single-line frame is left, and its own frame reaches the room's far edge.
  const fills = (frame: string, cols: number, rows: number) => {
    const lines = frame.split("\n");
    if (frame.includes("┌") || frame.includes("└")) return false;
    const top = lines.findIndex(l => l.includes("╔")), bottom = lines.findIndex(l => l.includes("╚"));
    return top >= 0 && bottom >= rows - 4 && [...lines[top]!].lastIndexOf("╗") >= cols - 2;
  };

  for (const [cols, rows] of [[44, 30], [177, 40]] as const) test(`${cols}×${rows}: ten × clicks on the answer tile, each painted at once`, async () => {
    const title = `Bean rows ${cols}`;
    const p = await doors.pane(await doors.create(`${title}\nstake the runners`), title, cols, rows);
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      await doors.ask(p, `@tally the stakes ${cols}`);
      const late: string[] = [];
      for (let i = 0; i < 10; i++) {
        let x: { col: number; row: number } | null = null;
        await until(() => !!(x = closeAt(p.capture())) && p.capture().includes(`counted: the stakes ${cols}`), "the answer tile and its ×", 15_000).catch(e => { throw new Error(`close ${i + 1}: ${e.message}\n${p.capture()}`); });
        const at = x!;
        // The pointer comes to the × as a real terminal reports it (hover: the door asks for any-event tracking), then
        // presses and lets go. The release lands while the close is still drawing its way (the motion, as Evan has it).
        for (const d of [3, 2, 1]) p.type(`\x1b[<35;${at.col - d};${at.row + 1}M`);
        p.type(`\x1b[<35;${at.col};${at.row}M`);
        p.click(at);
        let frame = "";
        await until(() => fills(frame = p.capture(), cols, rows), "the room filled", PAINTED_MS).catch(() => { late.push(`close ${i + 1}: not painted within ${PAINTED_MS} ms\n${frame}`); });
        // Late, the room waits for the next input to be drawn (as it did for Evan): a wheel at the edit's top brings it.
        if (!fills(frame, cols, rows)) { p.type(`\x1b[<64;4;6M`); await until(() => fills(p.capture(), cols, rows), "the room filled at last", 5000); }
        // The answer back beside or below, by its row's `show ▸`, at once: moments after the last click on it.
        let s: { col: number; row: number } | null = null;
        await until(() => !!(s = cellOf(p.capture(), "show ▸")), "the row's show ▸");
        p.click(s!);
      }
      expect(late).toEqual([]);
    } finally { p.close(); }
  }, 60_000);
});
