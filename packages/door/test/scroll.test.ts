// Scrolling (src/scroll.ts): a wheel report scrolls a fixed number of rows whenever it comes, through the
// terminal's real input path (Term's reads, App's one paint per chunk) into a reader. The streams are the
// shapes a terminal sends: Ghostty turns a trackpad's travel into one report per cell height, a notch of a
// mouse wheel into three; ssh coalesces reports into fewer reads.
import { describe, expect, test } from "bun:test";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { follow, RowView, scrolled, scrollRows, SCROLL_ROWS } from "../src/scroll";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { Term, type Key } from "../src/term";

const DOWN = "\x1b[<65;10;20M", UP = "\x1b[<64;10;20M";
const note = (lines: number): Msg => ({
  id: "11111111-2222-4333-8444-555555555555", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {},
  text: ["Harbour log", ...Array.from({ length: lines }, (_, i) => `L${i + 1} the keeper counts the gulls on the breakwater, see [[Tide table]]`)].join("\n"),
});

/**
 * A door on a fake terminal with a reader of a long note, fed through a real Term's decoding: `read(bytes)`
 * is one read from the terminal. `tops` is the reader's scroll position at each paint.
 */
function door(m = note(400)) {
  const t = new Term();
  let key: (k: Key) => void = () => {}, batch: (run: () => void) => void = run => run();
  const fake = {
    info: { cols: 80, rows: 30, cellW: 9, cellH: 16, kitty: false },
    write() {}, paint() {}, invalidate() {}, onResize() {},
    onKey(f: (k: Key) => void) { key = f; }, onBatch(f: (run: () => void) => void) { batch = f; },
  };
  t.onKey(k => key(k));
  t.onBatch(run => batch(run));
  const app = new App(fake as any, {} as any, Date.now(), () => {});
  const surface = new NoteSurface();
  const host: SurfaceHost = { ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: fake.info, graphics: false } as any, redraw: () => app.redraw(), navigate() {} };
  const tops: number[] = [];
  let layouts = 0, laid: unknown = null;
  app.push({
    title: "reader",
    render: () => {
      const v = surface.render(80, 29, host);
      tops.push(v.scroll?.top ?? 0);
      if ((surface as any).laid !== laid) { layouts++; laid = (surface as any).laid; }
      return { lines: v.lines };
    },
    key(k: Key) {
      if (k.kind === "mouse" && (k.action === "wheel-down" || k.action === "wheel-up")) surface.wheel(k.action === "wheel-down" ? 1 : -1, host);
      else surface.key(k, host);
    },
  } as any);
  surface.show(m, host);
  (app as any).paint();
  tops.length = 0; layouts = 0;
  const read = (bytes: string) => (t as any).batch(() => (t as any).feed(bytes));
  return { app, surface, tops, read, layouts: () => layouts, quit: () => app.quit() };
}

/** Each frame's step from the one before (the first from 0). */
const steps = (tops: number[]) => tops.map((v, i) => v - (i ? tops[i - 1]! : 0));

describe("the scroll model", () => {
  test("a position moves by rows within its content, and nothing else", () => {
    expect(scrolled(5, 3, 100)).toBe(8);
    expect(scrolled(5, -9, 100)).toBe(0);
    expect(scrolled(98, 3, 100)).toBe(100);
    expect(scrolled(4, 1, -2)).toBe(0);           // content shorter than the view: it stays at the top
    expect(follow(12, 0, 10)).toBe(3);
    expect(follow(5, 0, 10)).toBe(0);
  });

  test("EP0CH_SCROLL_ROWS: a whole number from 1 to 20, else 1 (the default)", () => {
    expect(SCROLL_ROWS).toBe(scrollRows(process.env.EP0CH_SCROLL_ROWS));
    expect(scrollRows(undefined)).toBe(1);
    expect(scrollRows("3")).toBe(3);
    for (const bad of ["0", "-2", "2.5", "x", "", "21"]) expect(scrollRows(bad)).toBe(1);
  });

  test("a selected row comes into view when it moves, never when the view was scrolled away from it", () => {
    const v = new RowView();
    expect(v.place(0, 50, 10)).toBe(0);
    v.scroll(7);
    expect(v.place(0, 50, 10)).toBe(7);           // a repaint keeps the scroll: the selection isn't pulled back
    expect(v.place(2, 50, 10)).toBe(2);           // the selection moved: it's brought into view
    v.scroll(100);
    expect(v.place(2, 50, 10)).toBe(40);          // within the content
    expect(v.place(2, 50, 6)).toBe(2);            // the view got shorter: the selection is brought back into it
    v.scroll(5);
    v.reveal();                                   // j at the end of the list: back to the selection though it didn't move
    expect(v.place(2, 50, 6)).toBe(2);
    // A selection several rows tall: its last row comes into view, then its first.
    expect(v.place(3, 50, 6, [20, 23])).toBe(18);
    expect(v.place(4, 50, 6, [30, 40])).toBe(30);
  });
});

describe("wheel reports into a reader, through the real input path", () => {
  // These assume the default, one row a report (the suite runs without EP0CH_SCROLL_ROWS).
  const R = SCROLL_ROWS;

  test("a slow trackpad read (one report every 5–40ms): one paint a report, every step the same, never back", async () => {
    const d = door();
    try {
      const gaps = [5, 31, 12, 40, 22, 9, 38, 17, 26, 33, 8, 19, 36, 14, 28, 24, 11, 39, 21, 30];
      for (const g of gaps) { await Bun.sleep(g); d.read(DOWN); }
      expect(steps(d.tops)).toEqual(gaps.map(() => R));
      expect(d.tops.at(-1)).toBe(gaps.length * R);
    } finally { d.quit(); }
  });

  test("a fast swipe (2–5 reports a read): each read is one paint of their sum, and it stops when they stop", () => {
    const d = door();
    try {
      const reads = [5, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1];
      for (const n of reads) d.read(DOWN.repeat(n));
      expect(steps(d.tops)).toEqual(reads.map(n => n * R));
      const total = reads.reduce((a, n) => a + n, 0) * R;
      expect(d.tops.at(-1)).toBe(total);
      d.app.redraw();                              // nothing left to move: the next paint is where it stopped
      expect(d.tops.at(-1)).toBe(total);
    } finally { d.quit(); }
  });

  test("a mouse wheel in Ghostty (three reports a notch, in one read) scrolls three rows a notch", () => {
    const d = door();
    try {
      for (let i = 0; i < 5; i++) d.read(DOWN.repeat(3));
      expect(steps(d.tops)).toEqual([3, 3, 3, 3, 3].map(n => n * R));
      d.read(UP.repeat(3));
      expect(steps(d.tops).at(-1)).toBe(-3 * R);
    } finally { d.quit(); }
  });

  test("over a slow ssh link, reports coalesced into one read scroll by their sum", () => {
    const d = door();
    try {
      const reads = [2, 1, 3, 2, 2, 4, 1];
      for (const n of reads) d.read(DOWN.repeat(n));
      expect(d.tops).toEqual(reads.map((_, i) => reads.slice(0, i + 1).reduce((a, n) => a + n, 0) * R));
      d.read(DOWN + UP + UP);                      // turned around within one read: the sum
      expect(steps(d.tops).at(-1)).toBe(-R);
    } finally { d.quit(); }
  });

  test("the end of the note stops the wheel; the first report back moves it back at once", () => {
    const d = door(note(40));
    try {
      d.read(DOWN.repeat(200));
      const end = d.tops.at(-1)!;
      expect(end).toBeGreaterThan(0);
      d.read(DOWN.repeat(5));
      expect(d.tops.at(-1)).toBe(end);
      d.read(UP);
      expect(d.tops.at(-1)).toBe(end - R);
    } finally { d.quit(); }
  });

  test("a frame of nothing but wheel reports moves the last layout; anything else lays the note out again", () => {
    const d = door();
    try {
      d.read(DOWN); d.read(DOWN); d.read(DOWN.repeat(3));
      expect(d.layouts()).toBe(0);
      // A fold key in the same read as the wheel: that frame is laid out again.
      d.read(DOWN + "F");
      expect(d.layouts()).toBe(1);
      // Something asked for a paint from outside input (a note loaded, a tile's output): laid out again.
      d.app.redraw(); (d.app as any).paint();
      expect(d.layouts()).toBe(2);
      d.read(DOWN);
      expect(d.layouts()).toBe(2);
    } finally { d.quit(); }
  });
});
