// The one line field (PIE-1290), as a person types in it: a rename prompt (the picker's line, the same field as the
// power bar's, a filter's and a property value's), typed into, selected with the mouse, a phrase deleted, undone,
// pasted, and erased a character at a time where a character is several code units. No service needed.
import { describe, expect, test } from "bun:test";
import { Canvas } from "../src/canvas";
import { LineField } from "../src/surface/line";
import { linePrompt } from "../src/surface/picker";
import { visible } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Msg } from "../src/board";
import type { Key } from "../src/term";

const ctrl = (ch: string, shift = false): Key => ({ kind: "char", ch, ctrl: true, ...(shift ? { shift } : {}) });
const mouse = (action: "down" | "drag" | "up", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });

/** A rename prompt on a 60 by 16 screen, as the desk's ^W n opens one, and the keys a person presses in it. */
function rename(name: string) {
  let done: string | null = null;
  const p = linePrompt<null>({ name: "rename", title: "rename the tile", text: name, doing: t => `rename to ${t}`, done: t => { done = t; } });
  const input = p.spec.input!;
  const draw = () => { const c = new Canvas(60, 16); p.draw(c, { col: 0, row: 0, cols: 60, rows: 16 }); return c.lines().map(visible); };
  const type = (s: string) => { for (const ch of s) p.key({ kind: "char", ch }, null); };
  const press = (k: Key) => p.key(k, null);
  /** Where `text` is drawn on screen: its row and first column. */
  const at = (text: string) => { const lines = draw(); const y = lines.findIndex(l => l.includes(text)); return { y, x: lines[y]!.indexOf(text) }; };
  return { p, input, draw, type, press, at, done: () => done };
}

describe("one line field, as a person types in it", () => {
  test("type, select a phrase with the mouse, delete it, undo, paste over it, enter keeps it", () => {
    const r = rename("notes");
    // A prefilled name: the first key typed replaces it.
    r.type("garden plan for spring");
    expect(r.input.text).toBe("garden plan for spring");
    // Drag across "plan " with the mouse, then delete it.
    const { x, y } = r.at("garden plan for spring");
    r.press(mouse("down", x + 7, y)); r.press(mouse("drag", x + 12, y)); r.press(mouse("up", x + 12, y));
    expect(r.input.selectedText()).toBe("plan ");
    r.press({ kind: "backspace" });
    expect(r.input.text).toBe("garden for spring");
    // ctrl+z brings it back; ctrl+y takes it away again.
    r.press(ctrl("z"));
    expect(r.input.text).toBe("garden plan for spring");
    r.press(ctrl("y"));
    expect(r.input.text).toBe("garden for spring");
    // A double click selects a word; a paste replaces it, its line break a space.
    const w = r.at("garden for spring");
    r.press(mouse("down", w.x + 11, w.y)); r.press(mouse("up", w.x + 11, w.y));
    r.press(mouse("down", w.x + 11, w.y)); r.press(mouse("up", w.x + 11, w.y));
    expect(r.input.selectedText()).toBe("spring");
    r.press({ kind: "paste", text: "the\nautumn\n" });
    expect(r.input.text).toBe("garden for the autumn");
    // ctrl+w erases the word before the cursor; enter chooses what's left.
    r.press(ctrl("w"));
    expect(r.input.text).toBe("garden for the ");
    r.press({ kind: "enter" });
    expect(r.done()).toBe("garden for the");
  });

  test("backspace and delete take a whole character: a family emoji, a flag, an accent", () => {
    for (const ch of ["👨‍👩‍👧", "🇨🇦", "é"]) {
      const l = new LineField("ab" + ch);
      l.take({ kind: "backspace" });
      expect([ch, l.text]).toEqual([ch, "ab"]);
      const d = new LineField(ch + "cd");
      d.take({ kind: "home" }); d.take({ kind: "delete" });
      expect([ch, d.text]).toEqual([ch, "cd"]);
      const m = new LineField("x" + ch + "y");
      m.take({ kind: "left" }); m.take({ kind: "left" }); m.take({ kind: "char", ch: "_" });
      expect([ch, m.text]).toEqual([ch, "x_" + ch + "y"]);
    }
  });

  test("shift selects by keys; cmd+c copies the selection; ctrl+x cuts it", () => {
    const copied: string[] = [];
    const l = new LineField("seed swap saturday");
    l.copy = t => copied.push(t);
    l.take({ kind: "home" });
    for (let i = 0; i < 4; i++) l.take({ kind: "right", shift: true });
    expect(l.selectedText()).toBe("seed");
    l.take(ctrl("x"));
    expect([l.text, copied]).toEqual([" swap saturday", ["seed"]]);
  });

  test("the keys it doesn't take stay the caller's: enter, esc, tab, up, down, another screen's ctrl key", () => {
    const l = new LineField("x");
    for (const k of [{ kind: "enter" }, { kind: "esc" }, { kind: "tab" }, { kind: "up" }, { kind: "down" }, ctrl("n"), ctrl("s"), ctrl("p")] as Key[]) expect([k, l.take(k)]).toEqual([k, false]);
    expect(l.text).toBe("x");
  });
});

describe("a property's value is the same field (the reader's panel)", () => {
  const note = (text: string): Msg => ({ id: "0e1f2a3b-1111-4222-8333-444455556666", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, properties: [{ key: "stage", value: "queued for spring" }] } as Msg);
  const host = (): SurfaceHost => ({ ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });

  test("click into the value, select a word with a double click, type over it, ctrl+w, undo: nothing typed is lost", () => {
    const s = new NoteSurface(), h = host();
    s.show(note("Seed potatoes [stage::queued for spring]\nChit them in the shed."), h);
    s.openPanel(false);
    s.editValue(s.rows(s.msg!)[0]!);
    const f = s.panel!.field!.input;
    const lines = s.render(70, 20, h).lines.map(visible);
    const y = lines.findIndex(l => l.includes("queued for spring")), x = lines[y]!.indexOf("spring");
    expect(y).toBeGreaterThanOrEqual(0);
    // A double click on "spring" selects it; typing replaces it.
    s.press(x + 1, y, h); s.release(x + 1, y, h); s.press(x + 1, y, h); s.release(x + 1, y, h);
    expect(f.selectedText()).toBe("spring");
    for (const ch of "autumn") s.key({ kind: "char", ch }, h);
    expect(f.text).toBe("queued for autumn");
    // ctrl+w erases the word (the desk's ^W waits while a line has the keys), ctrl+z brings it back.
    s.key(ctrl("w"), h);
    expect(f.text).toBe("queued for ");
    s.key(ctrl("z"), h);
    expect(f.text).toBe("queued for autumn");
  });
});

// PIE-1405: a line wider than its field scrolls sideways, the cursor in view; it never shows only its last wrapped piece.
test("a long line in a narrow field shows the cells up to the cursor, and a click lands on the character under it", () => {
  const link = "https://my.ep0ch.sh/pub/o/garden/p/0b5c2d11-7e4f-4a3b-9c8d-1e2f3a4b5c6d";
  const l = new LineField(link, false, { complete: false });
  const shown = visible(l.render(20, 1)[0]!);
  expect(shown).toBe(link.slice(-19) + " ");
  // Home: the start shows again.
  l.take({ kind: "home" });
  expect(visible(l.render(20, 1)[0]!)).toStartWith(link.slice(0, 19));
  // End, then a click on the field's first cell places the cursor on the character drawn there.
  l.take({ kind: "end" });
  l.render(20, 1);
  l.drawnAt(0, 0, 20);
  l.take({ kind: "mouse", action: "down", x: 0, y: 0, button: 0 } as Key);
  expect(l.cursor).toBe(link.length - 19);
});
