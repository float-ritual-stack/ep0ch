// PIE-1287: the one button part. What a person notices: a frame is three rows that line up, a default button still reads
// [label], and the button under the pointer is drawn lit (or reads its why) through the one Overflow pass.
import { describe, expect, test } from "bun:test";
import { Overflow } from "../src/overflow";
import { headOf, visible, width } from "../src/style";
import { buttonRows } from "../src/surface/button";

const plain = (rows: string[]) => rows.map(r => visible(r).replace(/\x1b\[[\d;]*m/g, ""));

describe("the button part", () => {
  test("a default button reads [label]; a framed one is three rows of one width", () => {
    expect(plain(buttonRows("Fold all"))).toEqual(["[Fold all]"]);
    const framed = buttonRows("Sync now", { glyph: "⟳", frame: "round" });
    expect(plain(framed)).toEqual(["╭────────────╮", "│ ⟳ Sync now │", "╰────────────╯"]);
    expect(new Set(framed.map(width)).size).toBe(1);
  });

  test("its state takes the glyph's place, and disabled is drawn in parentheses", () => {
    expect(plain(buttonRows("Sync", { glyph: "⟳", state: "running" }))).toEqual(["[◐ Sync…]"]);
    expect(plain(buttonRows("Sync", { glyph: "⟳", state: "failed", why: "it broke" }))).toEqual(["[! Sync]"]);
    // With no glyph its words stay as written while it runs and after (its colour says it); failed still says !.
    expect(plain(buttonRows("New game", { state: "done" }))).toEqual(["[New game]"]);
    expect(plain(buttonRows("New game", { state: "failed" }))).toEqual(["[! New game]"]);
    expect(plain(buttonRows("Lock", { state: "disabled", why: "no tile shed" }))).toEqual(["(Lock)"]);
  });

  test("under the pointer it is drawn lit; one that can't run reads its why in its place", () => {
    const o = new Overflow(), row = "say " + buttonRows("Go")[0] + " · " + buttonRows("Lock", { state: "disabled", why: "no tile called shed" })[0];
    o.draw([row], 40, 0);
    expect(o.hover(5, 0)).toBe(true);
    const lit = o.draw([row], 40, 0).lines[0]!;
    expect(lit).toContain("\x1b[1m");
    expect(visible(lit)).toBe("say [Go] · (Lock)");
    expect(o.hover(6, 0)).toBe(false);
    o.hover(13, 0);
    expect(visible(o.draw([row], 40, 0).lines[0]!)).toContain("no til");
  });

  test("a button half under a float lights only the cells still showing, and the row keeps its width", () => {
    const o = new Overflow(), row = "say " + headOf(buttonRows("Water the beds")[0]!, 6) + "│float│";
    o.draw([row], 40, 0);
    o.hover(5, 0);
    const lit = o.draw([row], 40, 0).lines[0]!;
    expect(lit).toContain("\x1b[1m");
    expect(visible(lit)).toBe(visible(row).replace(/\x1b\[[\d;]*m/g, ""));
  });
});
