// PIE-1407: only the overlay answers the pointer. A tile's cut-short value (a reader's byline) or a lit button runs on
// under the power bar, a float or a toast; the frame is composed by splicing rows, and the hit map (Overflow) is read
// from the composed cells. A value's mark must end where the overlay starts, or hovering the overlay reveals the tile
// behind it, drawn in full across the overlay (Evan's screenshot, Oct 29).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { overBar } from "../src/bar/bar";
import { overlayBox } from "../src/surface/composer";
import { buttonRows } from "../src/surface/button";
import { clipText, Overflow } from "../src/overflow";
import { headOf, pad, tailFrom, visible } from "../src/style";
import { App, withToast } from "../src/app";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

setDefaultTimeout(60_000);

const BYLINE = "claude-code:float-box · 10-26-26 (18:17) · 9 properties · type note";
// A reader tile 60 cells wide whose byline is cut short on both its rows, then the rest of the row (another tile).
const row = () => pad(clipText(BYLINE, 60), 60) + "│" + " ".repeat(19);
const behind = () => [row(), row()];
const bar = { rect: { col: 10, row: 0, cols: 50, rows: 2 }, lines: [pad("> run neat", 50), pad("  neat · run neat", 50)] };

type Cells = { row: number; from: number; to: number }[];
const overlays: [string, (lines: string[]) => string[], Cells][] = [
  ["the power bar", lines => overBar(lines, bar), [{ row: 0, from: 10, to: 60 }, { row: 1, from: 10, to: 60 }]],
  ["a float or menu", lines => { const out = [...lines]; overlayBox(out, bar.lines, 0, 10, 80); return out; }, [{ row: 0, from: 10, to: 60 }, { row: 1, from: 10, to: 60 }]],
  // Two rows: the toast sits on row 0, centred (cells 31 to 49).
  ["a toast", lines => withToast(lines, "saved the note", 80), [{ row: 0, from: 31, to: 49 }]],
];

/** Every cell of the frame with the pointer at (x, y), against the frame with no pointer. */
function hovered(lines: string[], x: number, y: number) {
  const o = new Overflow();
  const still = o.draw(lines, 80, 0).lines.map(visible);
  o.hover(x, y);
  return { still, moved: o.draw(lines, 80, 0).lines.map(visible) };
}

describe("only the overlay answers the pointer (PIE-1407)", () => {
  for (const [name, over, cells] of overlays) {
    test(`hovering ${name} leaves every cell of the frame as it was`, () => {
      const lines = over(behind());
      for (const { row: y, from, to } of cells) for (let x = from; x < to; x++) {
        const { still, moved } = hovered(lines, x, y);
        expect({ x, y, frame: moved }).toEqual({ x, y, frame: still });
      }
    });
  }

  test("the part of the byline still showing beside the bar reads in full in its own cells, never across the bar", () => {
    const lines = overBar(behind(), bar), o = new Overflow();
    o.draw(lines, 80, 0);
    o.hover(3, 0);
    o.draw(lines, 80, 0);
    // Two seconds on, the value has scrolled inside the ten cells left of the bar; the bar's cells are its own.
    const read = visible(o.draw(lines, 80, 2000).lines[0]!);
    expect(read.slice(0, 10)).not.toBe(visible(lines[0]!).slice(0, 10));
    expect(read.slice(10)).toBe(visible(lines[0]!).slice(10));
  });

  test("a button half under the bar lights only its own cells", () => {
    const row = pad("say " + buttonRows("Water the beds and the paths")[0], 80);
    const lines = overBar([row, " ".repeat(80)], { rect: { col: 8, row: 0, cols: 20, rows: 1 }, lines: [pad("bar", 20)] });
    const o = new Overflow();
    o.draw(lines, 80, 0);
    o.hover(12, 0);
    expect(o.draw(lines, 80, 0).lines[0]).toBe(o.draw(lines, 80, 0).lines[0]);
    const plainOver = new Overflow();
    expect(plainOver.draw(lines, 80, 0).lines[0]).toBe(o.draw(lines, 80, 0).lines[0]);
  });

  test("a splice never leaves a value's mark open: headOf closes it, tailFrom reopens what still shows", () => {
    const cut = clipText(BYLINE, 30);
    expect(headOf(cut, 10)).toMatch(/\x1b\[778m$/);
    expect(visible(headOf(cut, 10) + "BAR" + tailFrom(cut, 13))).toBe(visible(cut).slice(0, 10) + "BAR" + visible(cut).slice(13));
  });
});

// The same, in a door: Evan's 177×60 desk and a 40-column river, a reader behind the bar, the pointer swept over every
// cell of the bar. What it reads in full is only ever a value the bar drew; nothing of the tile behind lights or shows.
describe.skipIf(!outliner)("in a door, the pointer over the power bar reads only the bar (PIE-1407)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, painted: string[] = [];
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
  }, 30_000);
  afterAll(async () => {
    board?.close(); await scratch.dispose();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  for (const [screen, cols, rows] of [["desk", 177, 60], ["river", 40, 30]] as const) {
    test(`${screen} at ${cols}×${rows}`, async () => {
      let key: (k: Key) => void = () => {};
      const term: any = {
        info: { cols, rows, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; },
        invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {},
      };
      const app = new App(term, board, Date.now(), () => {});
      try {
        // Evan's desk: four 44-column tiles, a reader leftmost whose byline is cut short there and runs on under the bar.
        const note = await board.createBlock(null, `Seed swap at the allotment [kind::plan] [season::spring] [plot::north-bed] [crop::beans] [owner::committee] [type::note]\nbring jars`, { kind: "agent", id: "claude-code:allotment-box" });
        const reader = (name: string) => ({ t: "leaf" as const, kind: "reader", name, note: note.id });
        const s = screen === "river" ? openScreen("river") as Desk
          : new Desk({ name: "four", title: "four", layout: { focus: "a", root: { t: "split", dir: "row", weights: [1, 1, 1, 1], kids: [reader("a"), reader("b"), { t: "leaf", kind: "tree", name: "tree" }, { t: "leaf", kind: "activity", name: "activity" }] } } });
        app.push(s);
        await Bun.sleep(150);
        // The frame as composed, before the hit map reads it (what's painted has the marks taken out).
        let composed: string[] = [];
        const overflow = (app as any).overflow as Overflow, draw = overflow.draw.bind(overflow);
        overflow.draw = (lines, c, now) => { composed = lines; return draw(lines, c, now); };
        (app as any).paint(true);
        const before = new Overflow();
        before.draw(composed, cols, 0);
        key({ kind: "char", ch: "k", ctrl: true });
        const paint = () => { (app as any).paint(true); return painted; };
        const bar = (app as any).bar.draw(cols, rows - 1) as { rect: { col: number; row: number; cols: number; rows: number }; lines: string[] };
        // The values the bar drew itself, where the bar drew them.
        const own = new Overflow();
        own.draw(overBar(Array.from({ length: rows - 1 }, () => " ".repeat(cols)), bar), cols, 0);
        const ownAt = (own as any).cuts.map((c: { x: number; y: number }) => `${c.x}:${c.y}`) as string[];
        const { col, row, cols: w, rows: h } = bar.rect;
        // The case is real on the desk: the reader's byline starts left of the bar and is cut short under where it opens.
        // (At 40 columns the bar takes the row from its second column; the sweep still holds.)
        if (screen === "desk") expect((before as any).cuts.some((c: { x: number; y: number; end: number }) => c.y >= row && c.y < row + h && c.x < col && c.end > col)).toBe(true);
        for (let y = row; y < row + h; y++) for (let x = col; x < col + w; x++) {
          // The frame with no pointer, painted just before (a clock on screen moves on its own).
          (app as any).overflow.clear();
          const still = paint().map(visible);
          key({ kind: "mouse", action: "drag", button: 3, x, y } as Key);
          (app as any).flushHover?.();
          const frame = paint().map(visible);
          const reading = (app as any).overflow.describe().reading as { x: number; y: number } | null;
          if (reading) expect({ x, y, reads: `${reading.x}:${reading.y}`, own: ownAt.includes(`${reading.x}:${reading.y}`) }).toEqual({ x, y, reads: `${reading.x}:${reading.y}`, own: true });
          // Outside the bar, nothing moves while the pointer is on it.
          for (let r = 0; r < rows - 1; r++) {
            // A running clock ("· 0s", "· 1s", "90s" to "2m": a cell narrower) may tick between the two paints; that's time, not the pointer.
            const outside = (l: string) => (r < row || r >= row + h ? l : visible(l).slice(0, col) + visible(l).slice(col + w)).replace(/ *\b\d+(?:ms|s|m)\b */g, " # ");
            if (outside(frame[r]!) !== outside(still[r]!)) expect({ x, y, r, frame: frame[r] }).toEqual({ x, y, r, frame: still[r] });
          }
        }
      } finally { app.drawer.tile?.kill(); }
    });
  }
});
