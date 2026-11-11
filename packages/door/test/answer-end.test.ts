// PIE-1741: writing after a saved yo answer. ctrl+End under an answer that ends the note lands on a line of its own
// after it, the answer still one folded row; an answer the cursor opened shuts when the cursor leaves it, one opened by
// hand stays until shut by hand; a ctrl+z after its window says the window passed; an answered ask's row reads the same
// in every door, wherever the cursor is. Drawn at 44 and 177 columns, keys pressed as a person does. Made-up notes.
import { describe, expect, setSystemTime, test } from "bun:test";
import { AGAIN_MS } from "../src/arm";
import { Draft } from "../src/edit";
import { draftView } from "../src/draft-view";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { wrap } from "../src/text";

const ASK = "@yo which notes are drafts";
const ANSWER = ["> [!note]+ @yo answered", "> 1 note: `status=draft`", '> ::button{label="▸ save as a view"}'];
const LAST = ["Garden notes", "", ASK, ...ANSWER].join("\n");
const char = (ch: string): Key => ({ kind: "char", ch });
const type = (d: Draft, s: string) => { for (const c of s) d.key(char(c)); };
const drawn = (d: Draft, w: number) => draftView(d).render(w, 20).map(visible).join("\n");
const raw = (d: Draft, w: number) => /\[!note\]|::button/.test(drawn(d, w));

describe("ctrl+End under an answer that ends the note (PIE-1741)", () => {
  for (const w of [44, 177]) test(`lands on a new line after it, the answer folded, at ${w}`, () => {
    const d = new Draft("n1", 3, LAST);
    d.land("doc-start");
    drawn(d, w);
    d.key({ kind: "end", ctrl: true });
    expect([d.row, d.col]).toEqual([LAST.split("\n").length, 0]);
    expect(raw(d, w)).toBe(false);
    expect(drawn(d, w)).toContain("· answered");
    // The line is where writing goes, not a change of its own: nothing to save until something is typed on it.
    expect(d.dirty).toBe(false);
    // Again: still there, no second line.
    d.key({ kind: "end", ctrl: true });
    expect(d.lines.length).toBe(LAST.split("\n").length + 1);
    type(d, "and the beds are dug");
    expect(d.text).toBe(`${LAST}\nand the beds are dug`);
    expect(raw(d, w)).toBe(false);
  });

  test("an answer opened by hand: ctrl+End goes to its end, inside it", () => {
    const d = new Draft("n2", 3, LAST);
    d.land("doc-start");
    d.toggleAnswer(d.answerFolds()[0]!);
    d.key({ kind: "end", ctrl: true });
    expect(d.row).toBe(LAST.split("\n").length - 1);
    expect(d.lines.length).toBe(LAST.split("\n").length);
  });
});

describe("leaving an answer the cursor opened shuts it (PIE-1741)", () => {
  const MID = ["Garden notes", ASK, ...ANSWER, "and the beds are dug"].join("\n");
  for (const w of [44, 177]) test(`→ in opens it; ↑ or ↓ out shuts it, at ${w}`, () => {
    const d = new Draft("n3", 3, MID);
    d.place(1, ASK.length);
    expect(raw(d, w)).toBe(false);
    d.key({ kind: "right" });
    expect(raw(d, w)).toBe(true);
    d.key({ kind: "up" });
    expect(d.row).toBe(1);
    expect(raw(d, w)).toBe(false);
    // In again and down through it, out the bottom: shut, the cursor on the line after it, in view.
    d.key({ kind: "right" });
    for (let i = 0; i < ANSWER.length; i++) { drawn(d, w); d.key({ kind: "down" }); }
    expect(d.row).toBe(MID.split("\n").length - 1);
    const rows = draftView(d).render(w, 20).map(visible);
    expect(rows.join("\n")).not.toMatch(/\[!note\]|::button/);
    expect(rows[draftView(d).cursorRow]).toContain("and the beds are dug");
  });

  test("a selection reaching into it keeps it open; let go outside, it shuts", () => {
    const d = new Draft("n4", 3, MID);
    d.place(2, 3);
    d.key({ kind: "up", shift: true });
    expect(d.row).toBe(1);
    expect(d.hiddenAnswerLines().size).toBe(0);
    d.key({ kind: "left" });
    expect(d.hiddenAnswerLines().size).toBeGreaterThan(0);
  });

  test("opened by hand (its fold row, f, fold.toggle) it stays open as the cursor comes and goes; shut by hand it shuts", () => {
    const d = new Draft("n5", 3, MID);
    d.place(1, ASK.length);
    const fold = d.answerFolds()[0]!;
    expect(d.toggleAnswer(fold)).toBe(false);
    d.key({ kind: "up" });
    expect(d.hiddenAnswerLines().size).toBe(0);
    d.place(3, 0);
    d.key({ kind: "up" }); d.key({ kind: "up" });
    expect(d.hiddenAnswerLines().size).toBe(0);
    expect(d.toggleAnswer(fold)).toBe(true);
    expect(d.hiddenAnswerLines().size).toBeGreaterThan(0);
  });

  test("an agent's fold never moves the person's cursor: with it in the answer, its shut is refused", () => {
    const d = new Draft("n6a", 3, MID);
    d.place(3, 2);
    expect(() => d.toggleAnswer(d.answerFolds()[0]!, { kind: "agent", id: "tidy" })).toThrow(/cursor is in this answer/);
    expect([d.row, d.col, d.hiddenAnswerLines().size]).toEqual([3, 2, 0]);
    // Away from it, an agent folds and unfolds it as the person would.
    d.place(0, 0);
    expect(d.toggleAnswer(d.answerFolds()[0]!, { kind: "agent", id: "tidy" })).toBe(false);
    expect(d.toggleAnswer(d.answerFolds()[0]!, { kind: "agent", id: "tidy" })).toBe(true);
    expect([d.row, d.col]).toEqual([0, 0]);
  });

  test("the cursor in it, shut by hand: shut, the cursor back on its ask", () => {
    const d = new Draft("n6", 3, MID);
    d.place(3, 0);
    expect(d.hiddenAnswerLines().size).toBe(0);
    expect(d.toggleAnswer(d.answerFolds()[0]!)).toBe(true);
    expect(d.row).toBe(1);
    expect(d.hiddenAnswerLines().size).toBeGreaterThan(0);
  });
});

describe("a ctrl+z after its window says the window passed (PIE-1741)", () => {
  test("late: said so, and asked again; at 44 the line still fits two rows with the longest what", () => {
    setSystemTime(new Date(2_000_000));
    try {
      const d = new Draft("n7", 1, "Sowing");
      d.undos = [{ what: "your save and yo's removal of its answer", before: "Sow", after: "Sowing", at: 0, caret: 6, by: { kind: "user" }, open: false, saved: 3 } as never];
      d.key({ kind: "char", ch: "z", ctrl: true });
      expect(d.note).toBe("saved · ctrl+z again in 5s undoes your save and yo's removal of its answer");
      setSystemTime(new Date(2_000_000 + AGAIN_MS + 2_000));
      expect(d.note).toBe("");
      d.key({ kind: "char", ch: "z", ctrl: true });
      expect(d.text).toBe("Sowing");
      expect(d.note).toBe("late · saved · ctrl+z again in 5s undoes your save and yo's removal of its answer");
      // Two rows of a 44-column reader's 42 cells, the save still said.
      expect(wrap(d.note, 42).length).toBe(2);
      // Any other key between the window and the press: a fresh ask, nothing to say about a window.
      setSystemTime(new Date(2_000_000 + 2 * AGAIN_MS + 4_000));
      expect(d.note).toBe("");
      d.key({ kind: "right" });
      d.key({ kind: "char", ch: "z", ctrl: true });
      expect(d.note).toBe("saved · ctrl+z again in 5s undoes your save and yo's removal of its answer");
    } finally { setSystemTime(); }
  });
});

describe("an answered ask's row reads one way (PIE-1741)", () => {
  const MID = ["Garden notes", ASK, ...ANSWER, "and the beds are dug"].join("\n");
  test("the door that watched it land and a fresh door say the same", () => {
    const fresh = new Draft("n8", 3, MID), watched = new Draft("n8", 3, MID);
    watched.progress({ line: ASK, state: "applied", warning: "found 1 note", blocks: 1, beside: true });
    expect(watched.askStatus(ASK, Infinity, 1)).toBe(fresh.askStatus(ASK, Infinity, 1));
    expect(fresh.askStatus(ASK, Infinity, 1)).toBe(" · answered");
    // Still under way (asked again), its progress speaks.
    watched.progress({ line: ASK, state: "working", blocks: 2, beside: true });
    expect(watched.askStatus(ASK, Infinity, 1)).toContain("working");
    // Asked again and failed: it says so over the old answer.
    watched.progress({ line: ASK, state: "failed", warning: "@yo took too long" });
    expect(watched.askStatus(ASK, Infinity, 1)).toContain("took too long");
  });

  for (const w of [44, 177]) test(`the row is the same words with the cursor at the ask's end or elsewhere, at ${w}`, () => {
    const d = new Draft("n9", 3, MID);
    d.place(0, 0);
    const away = drawn(d, w).split("\n").find(l => l.includes(ASK))!;
    d.place(1, ASK.length);
    const at = drawn(d, w).split("\n").find(l => l.includes(ASK))!;
    expect(at.trimEnd()).toBe(away.trimEnd());
    expect(away).toContain(`${ASK} · answered`);
  });
});
