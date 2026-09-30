// PIE-496: the shared draft writes nested lists comfortably. Enter keeps the level, Tab and Shift+Tab move
// it, long lines wrap at words under the item's text, the wheel scrolls without moving the cursor, a click
// places it, and no way out of a draft loses the text. Pure model tests: no service, no terminal; the
// state dir is a temp dir (test/preload.ts and EP0CH_STATE below).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Draft, DRAFT_ACTIONS, listLead, unsent, unsentAll, wrapRows } from "../src/edit";
import { editHint, renderEditor } from "../src/surface/editor";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { cellsOf } from "../src/surface/selection";
import { USER, type Actor } from "../src/socket";

const AGENT: Actor = { kind: "agent", id: "test-agent-7" };
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const type = (d: Draft, s: string) => { for (const c of s) d.key(char(c)); };
const enter = (d: Draft) => d.key({ kind: "enter" });
/** A draft of `text` with the cursor at its end, as after typing it. */
const at_end = (text: string, base = 1) => { const d = new Draft("n1", base, text); d.place(d.lines.length - 1, Infinity); return d; };
const plain = (lines: string[]) => lines.map(l => cellsOf(l).join("").trimEnd());

let state: string;
beforeAll(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-496-")); process.env.EP0CH_STATE = state; });
afterAll(() => { delete process.env.EP0CH_STATE; rmSync(state, { recursive: true, force: true }); });

describe("Enter keeps the list going", () => {
  test("a bullet at any indent continues with the same marker", () => {
    const d = at_end("- nesty nest nest");
    enter(d); type(d, "second");
    expect(d.lines).toEqual(["- nesty nest nest", "- second"]);
    d.key({ kind: "tab" }); type(d, " is nested"); enter(d); type(d, "and so is this");
    expect(d.lines).toEqual(["- nesty nest nest", "  - second is nested", "  - and so is this"]);
    for (const m of ["*", "+"]) { const e = at_end(`    ${m} deep`); enter(e); expect(e.lines[1]).toBe(`    ${m} `); }
  });
  test("numbers count up, with the same closer; a checklist continues unchecked", () => {
    const d = at_end("1. first");
    enter(d); expect(d.lines[1]).toBe("2. ");
    const p = at_end("  9) ninth"); enter(p); expect(p.lines[1]).toBe("  10) ");
    const c = at_end("- [x] done step"); enter(c); expect(c.lines[1]).toBe("- [ ] ");
    const t = at_end("  * [ ] open step"); enter(t); expect(t.lines[1]).toBe("  * [ ] ");
  });
  test("Enter mid-item carries the rest of the text into the next item", () => {
    const d = at_end("- lantern oil");
    d.place(0, "- lantern".length); enter(d);
    expect(d.lines).toEqual(["- lantern", "- oil"]);
    expect(d.col).toBe(2);
  });
  test("Enter on an empty item goes up to its parent's level, continuing its numbers; at the top the list ends", () => {
    const d = at_end("1. pack\n   - rope\n   - ");
    enter(d);
    expect(d.lines).toEqual(["1. pack", "   - rope", "2. "]);
    enter(d);
    expect(d.lines).toEqual(["1. pack", "   - rope", ""]);
    const b = at_end("- a\n  - b\n    - ");
    enter(b); expect(b.lines.at(-1)).toBe("  - ");
    enter(b); expect(b.lines.at(-1)).toBe("- ");
    enter(b); expect(b.lines.at(-1)).toBe("");
  });
  test("an indented line keeps its indent; a line of spaces steps back out", () => {
    const d = at_end("    under the item");
    enter(d); expect(d.lines[1]).toBe("    ");
    enter(d); expect(d.lines[1]).toBe("  ");
  });
  test("alt+enter, a pasted line break and a paste are plain: pasted text is never reformatted", () => {
    const d = at_end("- item");
    d.key({ kind: "alt-enter" }); expect(d.lines).toEqual(["- item", ""]);
    const p = at_end("- item");
    p.key({ kind: "enter", pasted: true }); p.key({ kind: "tab", pasted: true }); type(p, "x");
    expect(p.lines).toEqual(["- item", "\tx"]);
    const q = at_end("- item");
    q.key({ kind: "paste", text: "\n- a\n\t- b\n1. c" });
    expect(q.lines).toEqual(["- item", "- a", "\t- b", "1. c"]);
    expect(q.dirty).toBe(true);
  });
  test("a marker typed by hand on a continued item replaces it, never doubles it", () => {
    const d = at_end("  - a");
    enter(d); type(d, "- b");
    expect(d.lines[1]).toBe("  - b");
    enter(d); type(d, "1. c");
    expect(d.lines[2]).toBe("  1. c");
    enter(d); type(d, "- [ ] d");
    expect(d.lines[3]).toBe("  - [ ] d");
  });
  test("the lead is read as Markdown reads it", () => {
    expect(listLead("- x")?.marker).toBe("-");
    expect(listLead("12. x")?.marker).toBe("12.");
    expect(listLead("- [ ] x")?.box).toBe("[ ] ");
    for (const not of ["-x", "**bold**", "plain", "-"]) expect(listLead(not)).toBeNull();
  });
});

describe("Tab and Shift+Tab move the level", () => {
  test("an item goes under the item above it, and back out to its parent", () => {
    const d = at_end("- a\n- b");
    d.place(1, 3);
    d.key({ kind: "tab" }); expect(d.lines[1]).toBe("  - b");
    d.key({ kind: "backtab" }); expect(d.lines[1]).toBe("- b");
    // Out goes to the level of the item it's nested in.
    const e = at_end("- a\n  - c\n      - b");
    e.key({ kind: "backtab" }); expect(e.lines[2]).toBe("  - b");
    d.key({ kind: "backtab" }); expect(d.lines[1]).toBe("- b");
    const n = at_end("1. a\n2. b");
    n.place(1, 4);
    n.key({ kind: "tab" }); expect(n.lines[1]).toBe("   2. b");
  });
  test("the cursor stays on its text", () => {
    const d = at_end("- a\n- bee");
    d.place(1, 4); d.key({ kind: "tab" });
    expect(d.col).toBe(6); expect(d.lines[1]!.slice(d.col)).toBe("e");
  });
  test("a selection moves every line it touches, nesting kept", () => {
    const d = at_end("- a\n- b\n  - c\n- d");
    d.place(1, 1); d.place(2, 3, true);
    d.key({ kind: "tab" });
    expect(d.lines).toEqual(["- a", "  - b", "    - c", "- d"]);
    expect(d.selection()).not.toBeNull();
    d.key({ kind: "backtab" });
    expect(d.lines).toEqual(["- a", "- b", "  - c", "- d"]);
  });
  test("typing over a selection replaces it; backspace takes it away; esc lets go first", () => {
    const d = at_end("one two three");
    d.place(0, 4); d.place(0, 7, true);
    type(d, "2"); expect(d.text).toBe("one 2 three");
    d.place(0, 0); d.place(0, 4, true); d.key({ kind: "backspace" });
    expect(d.text).toBe("2 three");
    d.place(0, 0); d.place(0, 2, true);
    expect(d.key({ kind: "esc" })).toBe("keep");
    expect(d.selection()).toBeNull();
  });
});

describe("soft wrap at words, hung under the item's text", () => {
  test("rows break after spaces, never mid-word, and continuations hang under the text", () => {
    const line = "  - like first thought is simply when writing out a list and nested";
    const d = new Draft("n1", 1, line);
    const rows = plain(d.render(30, 10));
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]).toBe("  - like first thought is");
    for (const r of rows.slice(1)) expect(r.startsWith("    ") && r[4] !== " ").toBe(true);
    // Every word is whole on one row: joined back, the text is the line.
    expect(rows.map(r => r.trim()).join(" ")).toBe(line.trim());
    expect(d.text).toBe(line);                                   // display only
  });
  test("a word longer than a row is cut; a plain line wraps to its own indent", () => {
    expect(wrapRows([..."abcdefghij"], 4, 0).map(r => r.end)).toEqual([4, 8, 10]);
    const d = at_end("    four spaces then some words that wrap");
    expect(plain(d.render(20, 10)).slice(1).every(r => r.startsWith("    "))).toBe(true);
  });
  test("up and down move by drawn rows, keeping the column", () => {
    const d = at_end("- aaaa bbbb cccc dddd\n- e");
    d.render(12, 10);
    d.place(0, 3);
    d.key({ kind: "down" });
    expect(d.row).toBe(0);                                      // the next drawn row of the same line
    expect(d.col).toBeGreaterThan(3);
    d.key({ kind: "down" }); d.key({ kind: "down" }); d.key({ kind: "down" });
    expect(d.row).toBe(1);
  });
});

describe("the mouse: the wheel scrolls, a click places the cursor", () => {
  const long = Array.from({ length: 40 }, (_, i) => `- item ${i + 1}`).join("\n");
  test("the wheel scrolls the view and the cursor stays; typing brings it back", () => {
    const d = new Draft("n1", 1, long);                          // the cursor starts on line 1
    d.place(39, 5);
    let rows = plain(d.render(30, 10));
    expect(rows.at(-1)).toContain("item 40");
    void DRAFT_ACTIONS.run("draft.scroll", { by: -20 }, d, USER);
    rows = plain(d.render(30, 10));
    expect(rows[0]).toBe("- item 11");
    expect([d.row, d.col]).toEqual([39, 5]);                    // the cursor didn't move
    type(d, "!");
    rows = plain(d.render(30, 10));
    expect(rows.some(r => r.includes("- ite!m 40"))).toBe(true);
  });
  test("a click places the cursor on the text under it, a hung row included", () => {
    const d = at_end("- one two three four five six");
    d.render(14, 10);                                           // "- one two", "  three four", …
    const p = d.posAt(4, 1);
    d.place(p.row, p.col);
    expect(d.lines[0]!.slice(d.col)).toStartWith("ree four");
    const past = d.posAt(40, 0);                                // past a row's end: the end of that row
    expect(d.lines[0]!.slice(0, past.col)).toBe("- one two");
  });
  test("the edit frame says where the text is and where its preview control is", () => {
    const d = at_end("- a");
    const lines = renderEditor(d, { title: "comment · Lantern", status: ["ok"], preview: t => [`preview of ${t}`] }, 60, 12);
    expect(d.frame?.row).toBe(3);
    const ctl = d.frame!.controls[0]!;
    expect(cellsOf(lines[ctl.row]!).slice(ctl.from, ctl.to).join("")).toContain("preview");
    void DRAFT_ACTIONS.run("draft.preview", {}, d, USER);
    const shown = renderEditor(d, { title: "comment · Lantern", status: ["ok"], preview: t => [`preview of ${t}`] }, 60, 12).map(l => cellsOf(l).join(""));
    expect(shown.some(l => l.includes("preview of - a"))).toBe(true);
    expect(editHint(d, { save: "send" })).toContain("tab indent");
  });
});

describe("no way out of a draft loses its text", () => {
  test("esc twice puts the draft aside as unsent, with a copy; opening it again brings it back", () => {
    const d = new Draft("comment", 0, "");
    d.shelf = { key: "comment:note-lantern", back: "C brings it back", label: "lantern-comment" };
    type(d, "- keep the brass ones");
    expect(d.key({ kind: "esc" })).toBe("keep");
    expect(d.note).toContain("puts it aside");
    expect(d.key({ kind: "esc" })).toBe("close");
    expect(d.closedWith).toContain("put aside as unsent · C brings it back");
    const u = unsent("comment:note-lantern")!;
    expect(u.text).toBe("- keep the brass ones");
    expect(readFileSync(u.copy!, "utf8")).toBe("- keep the brass ones\n");
    const again = new Draft("comment", 0, "");
    again.shelf = { key: "comment:note-lantern", back: "C brings it back" };
    expect(again.restore()).toBe(true);
    expect(again.text).toBe("- keep the brass ones");
    expect(unsent("comment:note-lantern")).toBeNull();
    // Esc twice on the brought-back text, unchanged: it's dropped, and its copy still says where.
    again.key({ kind: "esc" }); expect(again.note).toContain("drops");
    again.key({ kind: "esc" });
    expect(again.closedWith).toContain("dropped the unsent draft · a copy stays at");
    expect(unsentAll().some(x => x.key === "comment:note-lantern")).toBe(false);
  });
  test("an edit put aside on an older revision isn't laid over the newer note; it says where the copy is", () => {
    const d = new Draft("note-a", 3, "Title\nold body");
    d.shelf = { key: "edit:note-a", back: "e brings it back" };
    type(d, " more");
    d.key({ kind: "esc" }); d.key({ kind: "esc" });
    const u = unsent("edit:note-a")!;
    expect(existsSync(u.copy!)).toBe(true);
    const newer = new Draft("note-a", 4, "Title\nnew body");
    newer.shelf = { key: "edit:note-a", back: "e brings it back" };
    expect(newer.restore()).toBe(false);
    expect(newer.text).toBe("Title\nnew body");
    expect(newer.note).toContain(u.copy!);
  });
  test("a screen closing or the door quitting keeps the draft the same way", () => {
    const d = new Draft("note-b", 1, "x");
    d.shelf = { key: "edit:note-b", back: "e brings it back" };
    type(d, "y");
    const copy = d.keep();
    expect(unsent("edit:note-b")?.copy).toBe(copy);
  });
});

describe("agents", () => {
  test("an agent can indent in a draft it alone writes, never in the person's", async () => {
    const mine = at_end("- a\n- b");
    mine.wrote(AGENT);
    await DRAFT_ACTIONS.runUntyped("draft.indent", { from: 2 }, mine, AGENT);
    expect(mine.lines[1]).toBe("  - b");
    const theirs = at_end("- a\n- b");
    type(theirs, "!");
    expect(() => DRAFT_ACTIONS.runUntyped("draft.indent", { from: 2 }, theirs, AGENT)).toThrow("someone else is typing");
    expect(theirs.lines[1]).toBe("- b!");
  });
});

describe("in a reader: the note surface hosts it (keys, mouse, act)", () => {
  const TEXT = "Lantern workshop\nWhat it needs before Saturday.";
  const msg = (text = TEXT) => ({ id: "0a1b2c3d-1111-4222-8333-444455556666", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 5, props: {} });
  const setup = () => {
    const flashes: string[] = [];
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async () => msg() }, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate() {},
    };
    const s = new NoteSurface();
    s.show(msg(), h);
    return { s, h, flashes };
  };
  const text = (lines: string[]) => lines.map(l => cellsOf(l).join(""));

  test("esc twice puts the edit aside, the reader says so, and e brings it back", async () => {
    const { s, h, flashes } = setup();
    await s.edit(h);
    s.key({ kind: "down" }, h); s.key({ kind: "end" }, h); s.key({ kind: "enter" }, h);
    for (const c of "- brass lanterns") s.key(char(c), h);
    s.key({ kind: "esc" }, h); s.key({ kind: "esc" }, h);
    expect(s.draft).toBeNull();
    expect(flashes.at(-1)).toContain("put aside as unsent · e brings it back · a copy is at");
    expect(text(s.render(60, 20, h).lines).some(l => l.includes("■ unsent edit from") && l.includes("e brings it back"))).toBe(true);
    await s.edit(h);
    expect(s.draft!.text).toBe(`${TEXT}\n- brass lanterns`);
    expect(s.draft!.note).toContain("brought back your unsent draft");
    expect(text(s.render(60, 20, h).lines).some(l => l.includes("■ unsent edit"))).toBe(false);
  });

  test("the wheel scrolls the draft without moving the cursor; a click places it; ctrl+p shows the preview", async () => {
    const { s, h } = setup();
    await s.edit(h);
    s.draft!.replace(Array.from({ length: 30 }, (_, i) => `- step ${i + 1}`).join("\n"));
    s.draft!.place(29, 3);
    s.render(40, 12, h);
    const at = [s.draft!.row, s.draft!.col];
    s.wheel(-1, h); s.wheel(-1, h);
    const shown = text(s.render(40, 12, h).lines);
    expect(shown.some(l => l.includes("step 30"))).toBe(false);
    expect([s.draft!.row, s.draft!.col]).toEqual(at);
    // A click on a row of the text puts the cursor there.
    const f = s.draft!.frame!;
    const row = shown.findIndex((l, i) => i >= f.row && l.includes("- step 20"));
    expect(s.click(f.col + 4, row, h)).toBe(true);
    expect(s.draft!.row).toBe(19);
    s.key({ kind: "char", ch: "p", ctrl: true }, h);
    expect(text(s.render(40, 30, h).lines).some(l => l.includes("preview · ctrl+p hides"))).toBe(true);
  });

  test("agents: draft.* runs in a draft the agent alone writes, and is refused in the person's", async () => {
    const { s, h } = setup();
    await s.act("edit.text", { text: "- a\n- b" }, h, AGENT);
    expect(await s.act("draft.indent", { from: 2 }, h, AGENT)).toEqual({ lines: 1 });
    expect(s.draft!.text).toBe("- a\n  - b");
    s.key(char("!"), h);
    expect(() => s.act("draft.outdent", { from: 2 }, h, AGENT)).toThrow();
  });
});
