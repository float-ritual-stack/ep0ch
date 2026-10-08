// Kitty's text sizing (OSC 66), checked byte by byte: no terminal here has it, so what the door sends is what is tested.
import { describe, expect, test } from "bun:test";
import { Painter } from "../src/display";
import { Rows, KeyDecoder, type Key, type TermInfo } from "../src/term";
import { SIZED_QUERY, SizedLayer, sizedAnswer, sizedBytes, sizedHint, sizedPlacement } from "../src/text-sizing";

const title = sizedPlacement("title", "Build the bin", "\x1b[1m", 0, 1, 13);
const rows = (...r: string[]) => [...r, ...Array(25 - r.length).fill("")];
const base = (): string[] => rows("top level", "\x1b[1mBuild the bin\x1b[0m", "", "meta");

function terminal(sized: boolean) {
  const out: string[] = [], info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: true, sized };
  const r = new Rows(s => out.push(s), info);
  return { out, painter: new Painter(r, "kitty"), take: () => out.splice(0).join("") };
}

describe("sized text", () => {
  test("the bytes: cursor to the cell, the style, OSC 66 with the scale and the text, the cursor given back", () => {
    expect(sizedBytes(title as never)).toBe("\x1b7\x1b[2;1H\x1b[1m\x1b]66;s=2;Build the bin\x1b\\\x1b[0m\x1b8");
    expect(title).toMatchObject({ col: 0, row: 1, cols: 26, rows: 2 });
    // Nothing but text goes into the sequence: a control character is dropped, never sent.
    expect(sizedBytes(sizedPlacement("t", "a\x1b]0;x\x07b", "", 0, 0, 2) as never)).toBe("\x1b7\x1b[1;1H\x1b]66;s=2;a]0;xb\x1b\\\x1b[0m\x1b8");
  });

  test("the query asks where the cursor is after two cells of sized-width text; column 3 is yes, column 1 is no", () => {
    expect(SIZED_QUERY).toContain("\x1b]66;s=2; \x1b\\\x1b[6n");
    expect([sizedAnswer(3), sizedAnswer(1), sizedAnswer(2)]).toEqual([true, false, false]);
    expect([sizedHint({ EP0CH_SIZED: "1" }), sizedHint({ EP0CH_SIZED: "0" }), sizedHint({})]).toEqual([true, false, null]);
    const info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false }, keys: Key[] = [];
    const d = new KeyDecoder(info); d.keyHandler = k => keys.push(k);
    d.probing = { kitty: null, done() {} };
    d.feed("\x1b[1;3R");
    expect(info.sized).toBe(true);
    d.feed("\x1b[1;1R");
    expect(info.sized).toBe(false);
    expect(keys).toEqual([]);
    // Not probing, the same bytes are a key (shift+F3), not an answer.
    d.probing = null; info.sized = undefined;
    d.feed("\x1b[1;2R");
    expect(info.sized).toBeUndefined();
  });

  test("the layer paints a title when it is new, again when either of its rows went out, never when nothing changed", () => {
    const out: string[] = [], layer = new SizedLayer(s => out.push(s));
    const restored: number[][] = [];
    const at = (re: number[]) => layer.sync([title], base(), r => re.includes(r), rows => restored.push(rows));
    at([]); expect(out.splice(0).length).toBe(1);
    at([]); expect(out.length).toBe(0);
    at([0, 3]); expect(out.length).toBe(0);                 // other rows rewritten: the title's cells untouched
    at([2]); expect(out.splice(0).length).toBe(1);          // the blank row under it was written: its half is gone
    at([1]); expect(out.splice(0).length).toBe(1);
    // Something over its cells (a float, a toast): not drawn over it, and its rows are named to be written again.
    const covered = base(); covered[2] = "a float";
    layer.sync([title], covered, () => true, rows => restored.push(rows));
    expect(restored.at(-1)).toEqual([1, 2]);
    expect(out.length).toBe(0);
    // Only the right half of the enlarged title's top row covered: still not drawn over.
    layer.forget(); at([]); out.splice(0);
    const half = base(); half[1] = "\x1b[1mBuild the bin\x1b[0m" + " ".repeat(4) + "popup";
    layer.sync([title], half, () => true, () => {});
    expect(out.length).toBe(0);
    layer.forget(); at([]); expect(out.splice(0).length).toBe(1);
  });

  test("two titles on the same rows: one going leaves the other drawn again, after its rows are written", () => {
    const out: string[] = [], layer = new SizedLayer(s => out.push(s)), order: string[] = [];
    const a = sizedPlacement("a", "Build the bin", "", 0, 1, 13), b = sizedPlacement("b", "Other note", "", 40, 1, 10);
    const lines = rows("", "Build the bin" + " ".repeat(27) + "Other note", "", "");
    layer.sync([a, b], lines, () => false, () => {}); out.splice(0);
    layer.sync([b], lines, () => false, r => order.push(`restore ${r.join(",")}`));
    expect(order).toEqual(["restore 1,2"]);
    expect(out.join("")).toContain("Other note");
  });

  test("the painter draws it only on a terminal that has it, once, and writes the rows again when it goes", () => {
    const yes = terminal(true), no = terminal(false);
    yes.painter.show(base(), [title]); no.painter.show(base(), [title]);
    const first = yes.take();
    expect(first).toContain("\x1b]66;s=2;Build the bin\x1b\\");
    expect(no.take()).not.toContain("\x1b]66");
    yes.painter.show(base(), [title]);
    expect(yes.take()).not.toContain("\x1b]66");                          // nothing changed: nothing sent
    const other = base(); other[3] = "meta, changed";
    yes.painter.show(other, [title]);
    const edit = yes.take();
    expect(edit).toContain("meta, changed");
    expect(edit).not.toContain("\x1b]66");                                // its own rows were not touched
    yes.painter.show(rows("top level", "\x1b[1mBuild the bin\x1b[0m", "a float", "meta"), [title]);
    expect(yes.take()).not.toContain("\x1b]66");                          // the row under it holds something now: not sized over it
    yes.painter.show(base(), [title]);
    expect(yes.take()).toContain("\x1b]66;s=2;");                         // blank again: drawn again
    yes.painter.show(base(), []);                                         // placement gone, rows unchanged
    const gone = yes.take();
    expect(gone).toContain("\x1b[2;1H");                                  // row 2 and row 3 written again, which clears the sized cells
    expect(gone).toContain("\x1b[3;1H");
    expect(gone).not.toContain("\x1b]66");
  });
});
