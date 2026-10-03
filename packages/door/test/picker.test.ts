// The list picker and the line input (src/surface/picker.ts, src/surface/line.ts): the one way a box over the screen
// lets someone pick from a list or type a line, by keys and by mouse. No service needed.
import { describe, expect, test } from "bun:test";
import { Canvas } from "../src/canvas";
import { LineInput } from "../src/surface/line";
import { Modes } from "../src/surface/modes";
import { ListPicker, pickRow } from "../src/surface/picker";
import { visible, width } from "../src/style";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const click = (x: number, y: number): Key => ({ kind: "mouse", action: "down", button: 0, x, y });

function picker(n: number, more: Partial<ConstructorParameters<typeof ListPicker<string, null>>[0]> = {}) {
  const said: string[] = [];
  const items = Array.from({ length: n }, (_, i) => `fictional item ${i + 1}`);
  const p = new ListPicker<string, null>({
    name: "test", items: () => items, closers: "q",
    row: (it, _i, on, w) => [pickRow(` ${it}`, on, w)],
    choose: it => said.push(`chose ${it}`), closed: () => said.push("closed"),
    frame: a => ({ rect: { col: 2, row: 1, cols: 30, rows: 8 }, title: "pick", foot: "⏎ · esc" }),
    ...more,
  });
  return { p, said, draw: () => { const c = new Canvas(40, 12); p.draw(c, { col: 0, row: 0, cols: 40, rows: 12 }); return c.lines().map(visible); } };
}

describe("a list picker", () => {
  test("j k ↑ ↓ Home End and the wheel move its cursor; ⏎ chooses; esc and its closing letter put it away", () => {
    const { p, said } = picker(5);
    p.key(char("j"), null); p.key({ kind: "down" }, null); p.key({ kind: "mouse", action: "wheel-down", button: 0, x: 0, y: 0 }, null);
    expect(p.sel).toBe(3);
    p.key({ kind: "end" }, null); p.key(char("j"), null);
    expect(p.sel).toBe(4);                                  // it stops at the end
    p.key({ kind: "home" }, null); p.key(char("k"), null);
    expect(p.sel).toBe(0);
    p.key({ kind: "enter" }, null); p.key({ kind: "esc" }, null); p.key(char("q"), null);
    expect(said).toEqual(["chose fictional item 1", "closed", "closed"]);
    expect(p.key(char("z"), null)).toBe(true);             // it holds every key while it's open
  });

  test("a click on a row moves the cursor there, a double click or an alt-click chooses it, one outside puts it away; a long list scrolls with its cursor", () => {
    const { p, said, draw } = picker(20);
    let lines = draw();
    expect(lines[2]).toContain("fictional item 1");
    p.key(click(5, 4), null);                               // the box's third row
    expect(said).toEqual([]);
    expect(p.sel).toBe(2);
    p.key(click(5, 4), null);                               // again at once: a double click
    expect(said).toEqual(["chose fictional item 3"]);
    const alt = picker(5);
    alt.draw();
    alt.p.key({ ...click(5, 3), mods: 8 } as Key, null);
    expect(alt.said).toEqual(["chose fictional item 2"]);
    for (let i = 0; i < 15; i++) p.key(char("j"), null);
    lines = draw();
    expect(lines.join("\n")).toContain("fictional item 18");
    expect(lines.join("\n")).not.toContain("fictional item 1 ");
    p.key(char("k"), null);
    expect(draw().join("\n")).toContain("fictional item 18"); // moving up doesn't move the view
    p.key(click(39, 11), null);
    expect(said.at(-1)).toBe("closed");
  });

  test("a choice or esc puts it away and its stack lets it go; one that stays is put away by esc only", () => {
    const a = picker(3);
    a.p.key({ kind: "enter" }, null);
    expect(a.p.ended()).toBe(true);
    const b = picker(3, { stays: true }), stack = new Modes<null, ListPicker<string, null>>();
    stack.push(b.p);
    b.p.key({ kind: "enter" }, null);
    expect(stack.top()).toBe(b.p);
    b.p.key({ kind: "esc" }, null);
    expect(stack.top()).toBeNull();
    expect(b.said).toEqual(["chose fictional item 1", "closed"]);
  });

  test("one that wraps goes round; its own keys come first", () => {
    const { p, said } = picker(3, { wraps: true, keys: k => (k.kind === "char" && k.ch === "x" ? (said.push("x"), true) : false) });
    p.key(char("k"), null);
    expect(p.sel).toBe(2);
    p.key(char("x"), null);
    expect(said).toEqual(["x"]);
  });

  test("with a line typed above it, letters are the line's and the list moves on ↑ ↓", () => {
    const input = new LineInput();
    let typed = 0;
    const { p, said } = picker(4, { input, typed: () => typed++ });
    for (const c of "jq") p.key(char(c), null);
    expect([input.text, typed, p.sel, said]).toEqual(["jq", 2, 0, []]);
    p.key({ kind: "down" }, null);
    expect(p.sel).toBe(1);
  });

  test("on a mode stack: the newest takes the keys, and drops away", () => {
    const s = new Modes<null, ListPicker<string, null>>();
    const a = picker(2).p, b = picker(2, { name: "other" }).p;
    s.push(a); s.push(b);
    expect(s.top()).toBe(b);
    s.drop(b);
    expect(s.top()).toBe(a);
  });
});

describe("a line input", () => {
  test("types, moves, erases and clears; ⏎ and esc stay the caller's", () => {
    const l = new LineInput("plan");
    for (const k of [{ kind: "left" }, { kind: "left" }, char("x"), { kind: "backspace" }, { kind: "delete" }] as Key[]) l.key(k);
    expect([l.text, l.cursor]).toEqual(["pln", 2]);
    l.key({ kind: "char", ch: "a", ctrl: true }); l.key(char(">"));
    expect(l.text).toBe(">pln");
    l.key({ kind: "char", ch: "e", ctrl: true }); l.key(char("!"));
    expect(l.text).toBe(">pln!");
    expect([l.key({ kind: "enter" }), l.key({ kind: "esc" })]).toEqual([false, false]);
    l.key({ kind: "char", ch: "u", ctrl: true });
    expect(l.text).toBe("");
  });

  test("a prefilled line: the first key replaces it, backspace empties it", () => {
    const a = new LineInput("desk", true);
    expect(visible(a.show(30))).toContain("⏎ keeps it");
    a.key(char("m"));
    expect(a.text).toBe("m");
    const b = new LineInput("desk", true);
    b.key({ kind: "backspace" });
    expect(b.text).toBe("");
  });

  test("shown with its cursor, scrolled to it, in the width it's given, wide glyphs whole", () => {
    const l = new LineInput("会議メモ");
    expect(visible(l.show(20))).toBe("会議メモ▌");
    expect(l.plain()).toBe("会議メモ▌");
    l.key({ kind: "home" });
    expect(visible(l.show(20, "block"))).toBe("会議メモ");
    const long = new LineInput("x".repeat(50));
    expect(width(long.show(10))).toBeLessThanOrEqual(10);
  });
});
