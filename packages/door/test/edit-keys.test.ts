// A Mac editor's keys in the one editor (PIE-1607): each chord as the terminal sends it (a real byte sequence through the
// decoder), in a note's draft, then the same keys in a line field. Made-up text.
import { describe, expect, test } from "bun:test";
import { Draft, DRAFT_ACTIONS, DRAFT_KEYS } from "../src/edit";
import { parseReport, reportKey } from "../src/kbd";
import { chordName, exactKeyName, keyCaption, keyName, keyOfName } from "../src/surface/actions";
import { LineField } from "../src/surface/line";
import { USER } from "../src/socket";
import type { Key } from "../src/term";

/** The key `seq` decodes to, as `Term` hands it over. */
const key = (seq: string): Key => reportKey(parseReport(seq)!)!;
const CMD_SHIFT_LEFT = "\x1b[1;10D", CMD_SHIFT_RIGHT = "\x1b[1;10C", OPT_SHIFT_LEFT = "\x1b[1;4D", OPT_SHIFT_RIGHT = "\x1b[1;4C", OPT_UP = "\x1b[1;3A", OPT_DOWN = "\x1b[1;3B", OPT_SHIFT_DOWN = "\x1b[1;4B";
const draftOf = (text: string, row = 0, col = 0) => { const d = new Draft("b1", 1, text); d.place(row, col); return d; };
const typed = (d: Draft, s: string) => { for (const ch of s) d.key({ kind: "char", ch }); };
const selecting = (d: Draft, from: number, to: number, row = 0) => { d.place(row, from); d.place(row, to, true); };

describe("the chords decode, and screens read them as before", () => {
  test("cmd+shift+← is its own name; a screen still reads it as alt+←, ctrl+← as ←", () => {
    expect(exactKeyName(key(CMD_SHIFT_LEFT))).toBe("super+shift+left");
    expect(keyName(key(CMD_SHIFT_LEFT))).toBe("alt+left");
    expect(exactKeyName(key("\x1b[1;5D"))).toBe("ctrl+left");
    expect(keyName(key("\x1b[1;5D"))).toBe("left");
    expect(exactKeyName(key(OPT_SHIFT_LEFT))).toBe("alt+shift+left");
    expect(exactKeyName(key("\x1b[1;5H"))).toBe("ctrl+home");
    expect(exactKeyName(key("\x1b[1;6F"))).toBe("ctrl+shift+end");
    expect(exactKeyName(key("\x1b[127;9u"))).toBe("super+backspace");
    expect(exactKeyName(key("\x1b[3;3~"))).toBe("alt+delete");
  });

  test("every row's key has one name: chordName, keyOfName and the exact name agree", () => {
    for (const row of DRAFT_KEYS) {
      const k = keyOfName(row.key);
      expect(k).not.toBeNull();
      expect(exactKeyName(k!)).toBe(row.key);
      expect(chordName(row.key)).toBe(row.key);
    }
    expect(chordName("cmd+shift+left")).toBe("super+shift+left");
    expect(keyCaption("super+shift+left")).toBe("super+shift+←");
  });

  test("no key is on two rows, and every row's action exists", () => {
    const seen = DRAFT_KEYS.map(r => r.key);
    expect(new Set(seen).size).toBe(seen.length);
    for (const r of DRAFT_KEYS) if (r.action.startsWith("draft.") && !["draft.pick", "draft.image"].includes(r.action)) expect(DRAFT_ACTIONS.has(r.action)).toBe(true);
  });
});

describe("in a note's draft", () => {
  test("cmd+shift+←/→ select to the line's edges from the cursor, on either side", () => {
    const d = draftOf("sow the early peas\nnext", 0, 8);
    d.key(key(CMD_SHIFT_RIGHT));
    expect(d.selectedText()).toBe("early peas");
    const e = draftOf("sow the early peas\nnext", 0, 8);
    e.key(key(CMD_SHIFT_LEFT));
    expect(e.selectedText()).toBe("sow the ");
    expect(e.text).toBe("sow the early peas\nnext");
  });

  test("the twins: shift+Home, shift+End, alt+H, alt+E; cmd+← alone moves and lets go", () => {
    for (const [k, want] of [[{ kind: "home", shift: true }, "sow "], [{ kind: "alt", ch: "H" }, "sow "], [{ kind: "end", shift: true }, "peas"], [{ kind: "alt", ch: "E" }, "peas"]] as [Key, string][]) {
      const d = draftOf("sow peas", 0, 4);
      d.key(k);
      expect(d.selectedText()).toBe(want);
    }
    const d = draftOf("sow peas", 0, 4);
    d.key(key(CMD_SHIFT_RIGHT)); d.key(key("\x1b[1;9D"));
    expect([d.col, d.selection()]).toEqual([0, null]);
  });

  test("a line, or the selected lines, moves up and down, one undo step each", () => {
    const d = draftOf("one\ntwo\nthree", 1, 2);
    d.key(key(OPT_UP));
    expect(d.text).toBe("two\none\nthree");
    expect([d.row, d.col]).toEqual([0, 2]);
    d.key(key(OPT_UP));                      // at the top: nothing
    expect(d.text).toBe("two\none\nthree");
    d.key({ kind: "char", ch: "z", ctrl: true });
    expect(d.text).toBe("one\ntwo\nthree");

    const s = draftOf("one\ntwo\nthree\nfour", 0, 1);
    s.place(1, 1, true);
    s.key(key(OPT_DOWN));
    expect(s.text).toBe("three\none\ntwo\nfour");
    expect(s.selectedText()).toBe("ne\nt");
    // A selection ending at a line's very start leaves that line where it is.
    const e = draftOf("one\ntwo\nthree", 0, 0);
    e.place(1, 0, true);
    e.key(key(OPT_DOWN));
    expect(e.text).toBe("two\none\nthree");
  });

  test("document edges: go and select, by cmd, ctrl+Home and the twins", () => {
    for (const k of [key("\x1b[1;5F"), key("\x1b[1;9B"), { kind: "alt", ch: ">" } as Key]) {
      const d = draftOf("one\ntwo\nthree", 1, 1);
      d.key(k);
      expect([d.row, d.col, d.selection()]).toEqual([2, 5, null]);
    }
    for (const k of [key("\x1b[1;6H"), key("\x1b[1;10A"), { kind: "alt", ch: "{" } as Key]) {
      const d = draftOf("one\ntwo\nthree", 1, 1);
      d.key(k);
      expect(d.selectedText()).toBe("one\nt");
    }
  });

  test("words: alt+arrows, Ghostty's alt+b and alt+f, select with shift, across lines at the edge", () => {
    const d = draftOf("sow the peas\nnext row", 0, 4);
    d.key({ kind: "alt", ch: "f" });
    expect(d.col).toBe(7);
    d.key(key("\x1b[1;3C"));
    expect(d.col).toBe(12);
    d.key(key("\x1b[1;3C"));
    expect([d.row, d.col]).toEqual([1, 4]);
    d.key(key("\x1b[1;3D"));
    expect([d.row, d.col]).toEqual([1, 0]);
    d.key(key("\x1b[1;3D"));
    expect([d.row, d.col]).toEqual([0, 8]);
    d.key(key(OPT_SHIFT_RIGHT));
    expect(d.selectedText()).toBe("peas");
    d.key({ kind: "alt", ch: "B" });
    d.key({ kind: "alt", ch: "B" });
    expect(d.selectedText()).toBe("the ");
  });

  test("line keys: copy, delete; select word, line, all; erase; cut", () => {
    const c = draftOf("one\ntwo", 0, 1);
    c.key(key(OPT_SHIFT_DOWN));
    expect(c.text).toBe("one\none\ntwo");
    expect(c.row).toBe(1);
    c.key({ kind: "alt", ch: "D" });
    expect(c.text).toBe("one\ntwo");

    const s = draftOf("sow peas\nnext", 0, 5);
    s.key({ kind: "alt", ch: "W" });
    expect(s.selectedText()).toBe("peas");
    s.key({ kind: "alt", ch: "L" });
    expect(s.selectedText()).toBe("sow peas");
    s.key({ kind: "alt", ch: "L" });
    expect(s.selectedText()).toBe("sow peas\nnext");
    s.key({ kind: "alt", ch: "S" });
    expect(s.selectedText()).toBe(s.text);

    const e = draftOf("sow the peas", 0, 7);
    e.key({ kind: "alt-backspace" });
    expect(e.text).toBe("sow  peas");
    e.key({ kind: "char", ch: "u", ctrl: true });
    expect(e.text).toBe(" peas");
    e.key(key("\x1b[3;3~"));
    expect(e.text).toBe("");

    let clipped = "";
    const x = draftOf("sow peas", 0, 0);
    x.clip = t => { clipped = t; };
    selecting(x, 0, 4);
    x.key({ kind: "alt", ch: "x" });
    expect([x.text, clipped]).toEqual(["peas", "sow "]);
    x.key({ kind: "char", ch: "z", ctrl: true });
    expect(x.text).toBe("sow peas");
  });

  test("cmd+s saves, cmd+z undoes, cmd+shift+z redoes, an unbound cmd key still types nothing", () => {
    const d = draftOf("peas", 0, 4);
    typed(d, "!");
    expect(d.key({ kind: "super", ch: "s" })).toBe("save");
    d.key({ kind: "super", ch: "z" });
    expect(d.text).toBe("peas");
    d.key({ kind: "super", ch: "Z" });
    expect(d.text).toBe("peas!");
    d.key({ kind: "super", ch: "j" });
    expect(d.text).toBe("peas!");
  });
});

describe("wrapping a selection", () => {
  test("[[ over a selection links it; the text stays selected; ctrl+z takes each back", () => {
    const d = draftOf("sow early peas", 0, 0);
    selecting(d, 4, 9);
    typed(d, "[[");
    expect(d.text).toBe("sow [[early]] peas");
    expect(d.selectedText()).toBe("early");
    d.key({ kind: "char", ch: "z", ctrl: true });
    expect(d.text).toBe("sow [early] peas");
    d.key({ kind: "char", ch: "z", ctrl: true });
    expect(d.text).toBe("sow early peas");
  });

  test("each key wraps with its closer; a selection made backward stays backward; across lines too", () => {
    for (const [ch, want] of [["(", "(pea)"], ["[", "[pea]"], ["{", "{pea}"], ['"', '"pea"'], ["'", "'pea'"], ["`", "`pea`"], ["*", "*pea*"], ["_", "_pea_"], ["~", "~pea~"]] as const) {
      const d = draftOf("pea", 0, 0);
      selecting(d, 0, 3);
      typed(d, ch);
      expect(d.text).toBe(want);
    }
    const back = draftOf("a pea b", 0, 5);
    back.place(0, 2, true);
    typed(back, "**");
    expect(back.text).toBe("a **pea** b");
    expect([back.col, back.selectedText()]).toEqual([4, "pea"]);
    const many = draftOf("one\ntwo", 0, 1);
    many.place(1, 2, true);
    typed(many, "(");
    expect(many.text).toBe("o(ne\ntw)o");
    expect(many.selectedText()).toBe("ne\ntw");
  });

  test("with nothing selected it's the character; any other key still replaces the selection", () => {
    const d = draftOf("pea", 0, 3);
    typed(d, "[");
    expect(d.text).toBe("pea[");
    const r = draftOf("pea", 0, 0);
    selecting(r, 0, 3);
    typed(r, "x");
    expect(r.text).toBe("x");
  });

  test("what the door selected for typing over is replaced, never wrapped: a snippet's slot, a completion's value, a prefilled line", () => {
    const c = draftOf("", 0, 0);
    c.splice(0, 0, "due=value", {}, USER, { start: 4, end: 9 });
    typed(c, "(");
    expect(c.text).toBe("due=(");
    const line = new LineField("garden", true);
    line.take({ kind: "char", ch: "[" });
    expect(line.text).toBe("[");
  });

  test("draft.wrap names a whole opener, and says what to do with nothing selected", async () => {
    const d = draftOf("sow peas", 0, 0);
    selecting(d, 4, 8);
    await DRAFT_ACTIONS.run("draft.wrap", { with: "[[" }, d, USER);
    expect(d.text).toBe("sow [[peas]]");
    d.place(0, 0);
    expect(() => DRAFT_ACTIONS.run("draft.wrap", { with: "(" }, d, USER)).toThrow("nothing is selected");
    // By key, the refusal is said on the status line, never thrown.
    d.key({ kind: "alt", ch: "x" });
    expect(d.note).toContain("nothing is selected");
  });
});

describe("in a line field", () => {
  test("selecting to the edges, word motions, wrap, erase and cut work; a line's move is the caller's", () => {
    const l = new LineField("sow the peas");
    l.place(0, 4);
    expect(l.take(key(CMD_SHIFT_RIGHT))).toBe(true);
    expect(l.selectedText()).toBe("the peas");
    expect(l.take({ kind: "char", ch: "[" })).toBe(true);
    expect(l.text).toBe("sow [the peas]");
    l.place(0, 0);
    expect(l.take({ kind: "alt", ch: "f" })).toBe(true);
    expect(l.col).toBe(3);
    expect(l.take(key(OPT_SHIFT_RIGHT))).toBe(true);
    expect(l.selectedText()).toBe(" [the");
    expect(l.take({ kind: "alt", ch: "x" })).toBe(true);
    expect(l.text).toBe("sow peas]");
    expect(l.take(key(OPT_UP))).toBe(false);
    expect(l.take({ kind: "alt", ch: "D" })).toBe(false);
    l.take({ kind: "alt", ch: ">" });
    expect(l.col).toBe(l.text.length);
    l.take({ kind: "alt", ch: "{" });
    expect(l.selectedText()).toBe(l.text);
  });

  test("ctrl+u still clears a line, and ctrl+w still erases the word before", () => {
    const l = new LineField("sow the peas");
    l.place(0, 7);
    l.take({ kind: "char", ch: "w", ctrl: true });
    expect(l.text).toBe("sow  peas");
    l.take({ kind: "char", ch: "u", ctrl: true });
    expect(l.text).toBe("");
  });
});
