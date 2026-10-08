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

  test("the query asks where the cursor is after a space at scale 2 and at scale 3; only columns 3 then 4 prove scale", () => {
    expect(SIZED_QUERY).toContain("\x1b]66;s=2; \x1b\\\x1b[6n");
    expect(SIZED_QUERY).toContain("\x1b]66;s=3; \x1b\\\x1b[6n");
    expect([sizedAnswer([3, 4]), sizedAnswer([1, 1]), sizedAnswer([3, 3]), sizedAnswer([3]), sizedAnswer([2, 2])]).toEqual([true, false, false, false, false]);
  });

  test("the cursor reports answer the probe only while probing; a key otherwise", () => {
    const run = (...cols: number[]) => {
      const info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false }, keys: Key[] = [];
      const d = new KeyDecoder(info); d.keyHandler = k => keys.push(k);
      d.probing = { kitty: null, done() {} };
      for (const c of cols) d.feed(`\x1b[1;${c}R`);
      return { sized: info.sized, keys };
    };
    // Real scale support: two cells, then three.
    expect(run(3, 4).sized).toBe(true);
    // A terminal that answers width only (both probes move two cells, or one): not sized.
    expect(run(3, 3).sized).toBe(false);
    expect(run(2, 2).sized).toBe(false);
    // A terminal that ignores the sequence.
    expect(run(1, 1).sized).toBe(false);
    expect(run(3, 4).keys).toEqual([]);
    const info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false };
    const d = new KeyDecoder(info); d.keyHandler = () => {};
    d.feed("\x1b[1;2R");
    expect(info.sized).toBeUndefined();
  });

  test("the hint: EP0CH_SIZED says outright; in Herdr, tmux or screen it is off without asking; elsewhere the terminal is asked", () => {
    expect([sizedHint({ EP0CH_SIZED: "1" }), sizedHint({ EP0CH_SIZED: "0" }), sizedHint({})]).toEqual([true, false, null]);
    expect(sizedHint({ HERDR_PANE_ID: "p_1" })).toBe(false);
    expect(sizedHint({ HERDR_ENV: "1" })).toBe(false);
    expect(sizedHint({ EP0CH_NEST: "ssh:pts/3 › herdr:w1:p_2" })).toBe(false);
    expect(sizedHint({ TMUX: "/tmp/tmux-1000/default,1,0" })).toBe(false);
    expect(sizedHint({ STY: "123.pts-0.host" })).toBe(false);
    expect(sizedHint({ TERM: "screen-256color" })).toBe(false);
    expect(sizedHint({ TERM: "tmux-256color" })).toBe(false);
    expect(sizedHint({ TERM: "xterm-kitty", SSH_TTY: "/dev/pts/1" })).toBeNull();
    // The override still forces it in a multiplexer.
    expect(sizedHint({ HERDR_PANE_ID: "p_1", EP0CH_SIZED: "1" })).toBe(true);
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

describe("wrapped links and chips (text.wrap)", () => {
  test("a link that wraps is coloured and tagged on every row; a property token that fits a row is not split", async () => {
    const { wrap, colourBody } = await import("../src/text");
    const { extractLinks, linkTag, LINK_END, visible } = await import("../src/style");
    const { LINK_ON, LINK_OFF, EXTERNAL_ON } = await import("../src/refs");
    for (const on of [LINK_ON, EXTERNAL_ON]) {
      const text = `see ${on}${linkTag(0)}End-of-day update for #rexall_internal · Oct 8 done, Oct 9 plan${LINK_END}${LINK_OFF} ok`;
      const rows = wrap(text, 24);
      expect(rows.length).toBeGreaterThan(2);
      const { ranges } = extractLinks(rows.map(r => colourBody(r)));
      // Every row that holds link text is one range of the link, and starts the colour mark of its kind.
      const withLink = new Set(ranges.map(r => r.line));
      for (let i = 0; i < rows.length - 1; i++) expect(withLink.has(i)).toBe(true);   // the last row may be only " ok"
      for (let i = 1; i < rows.length - 1; i++) expect(rows[i]!.includes(on)).toBe(true);   // the colour is opened again on each continuation row
      for (let i = 1; i < rows.length - 1; i++) expect(colourBody(rows[i]!)).not.toBe(colourBody(visible(rows[i]!)));
    }
    // A chip that fits moves to the next row whole; one longer than the width is cut (and loses its colour there).
    const rows = wrap("a long run of words before [status::in review] and after", 28);
    expect(rows.some(r => r.includes("[status::in review]"))).toBe(true);
    expect(colourBody(rows.find(r => r.includes("[status::"))!)).toContain("\x1b[38;");
  });
});
