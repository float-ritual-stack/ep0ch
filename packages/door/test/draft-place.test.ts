// The delicate contract (PIE-1560): an agent's patch landing in a draft never moves the person's place. Their cursor
// stays on the screen row it was on, and a view the wheel scrolled away keeps its top row's text, in the raw rows and
// in rich cells, whether or not a view drew the draft yet. Made-up notes; no service.
import { describe, expect, test } from "bun:test";
import { Draft } from "../src/edit";
import { draftView } from "../src/draft-view";
import { elementEdit as richView } from "../src/surface/element-editor";
import { visible } from "../src/style";
import type { Actor } from "../src/socket";

const TIDY: Actor = { kind: "agent", id: "tidy" };
const span = (text: string, observed: string, replacement: string) => {
  const start = text.indexOf(observed);
  if (start < 0) throw new Error(`no ${observed}`);
  return { observed, replacement, range: { start, end: start + observed.length }, unit: "utf16" as const };
};
/** Thirty paragraphs, a blank line apart, so a patch on one never touches the block the cursor is in. */
const LONG = Array.from({ length: 30 }, (_, i) => `seed tray ${i + 1}`).join("\n\n");
const W = 40, H = 8;

function typingAt(line: number, up = 0) {
  const d = new Draft("note-place", 4, LONG);
  d.place(line, 3);
  draftView(d).render(W, H);
  // Up a few lines: the cursor mid-screen, away from the scrolloff margins that would hide a jump.
  for (let i = 0; i < up; i++) d.key({ kind: "up" });
  return d;
}
const drawn = (d: Draft) => draftView(d).render(W, H).map(visible);
const cursorRow = (d: Draft) => { drawn(d); return draftView(d).cursorRow; };
const patch = (d: Draft, observed: string, replacement: string) =>
  expect(d.applyPatch({ patchId: `p-${observed}`, patches: [span(d.text, observed, replacement)], revision: 4 }, TIDY)).toEqual({ applied: true });

describe("an agent's patch keeps the person's place", () => {
  test("lines added far above: the cursor stays on its screen row", () => {
    const d = typingAt(40, 3);
    const row = cursorRow(d), line = d.row;
    expect(row).toBeGreaterThan(1); expect(row).toBeLessThan(H - 2);
    const was = drawn(d)[row];
    patch(d, "seed tray 2\n", "seed tray 2\nlabel it\nwater it\nmark the date\n");
    expect(d.row).toBe(line + 3);
    expect(cursorRow(d)).toBe(row);
    expect(drawn(d)[row]).toBe(was!);
  });

  test("lines added between the top row and the cursor: the cursor still stays put", () => {
    const d = typingAt(40, 3);
    const rows = drawn(d), row = draftView(d).cursorRow;
    const above = rows.slice(0, row).map(r => r.trim()).find(r => r.startsWith("seed tray"))!;
    patch(d, `${above}\n`, `${above}\none more line\n`);
    expect(cursorRow(d)).toBe(row);
  });

  test("the cursor on the last line, lines added below it: it doesn't move up the screen", () => {
    const d = typingAt(58);
    const row = cursorRow(d);
    patch(d, "seed tray 29\n", "seed tray 29\nthinned\n");
    d.place(d.row, d.col);                  // (the patch was above; now one below, in a block of its own)
    const row2 = cursorRow(d);
    expect(row2).toBe(row);
    expect(d.applyPatch({ patchId: "below", patches: [{ observed: "seed tray 30", replacement: "seed tray 30\n\nmore below\nand more\nand more" }], revision: 4, force: true }, TIDY).applied).toBe(true);
    expect(cursorRow(d)).toBe(row2);
  });

  test("the wheel scrolled away from the cursor: the top row keeps its text", () => {
    const d = typingAt(56);
    drawn(d);
    draftView(d).scrollBy(-8);
    if (!drawn(d)[0]!.trim()) draftView(d).scrollBy(-1);
    const rows = drawn(d), top = rows[0]!;
    expect(rows.join("\n")).not.toContain("seed tray 29");
    expect(top).toMatch(/seed tray (1\d|2\d)/);
    patch(d, "seed tray 1\n", "seed tray 1\nfirst\nsecond\n");
    expect(drawn(d)[0]).toBe(top!);
  });

  test("the wheel scrolled into a long wrapped paragraph: words added earlier in it keep the top row's text", () => {
    const para = Array.from({ length: 24 }, (_, i) => `bed ${i + 1} gets compost`).join(" ");
    const d = new Draft("note-wrap", 4, `${para}\n\n${LONG}`);
    d.place(d.lines.length - 1, 3);
    drawn(d);
    draftView(d).scrollBy(-200);
    draftView(d).scrollBy(4);              // the top row is the paragraph's fifth wrapped row
    const top = drawn(d)[0]!;
    expect(top).toMatch(/bed \d+/);
    patch(d, "bed 1 gets compost", "bed 1 gets compost and a mulch of leaves from the autumn heap");
    expect(drawn(d)[0]).toBe(top);
  });

  test("an ask's progress growing a row above the cursor leaves the cursor's row where it was", () => {
    const d = new Draft("note-ask", 4, `${"the plan so far\n".repeat(8)}@gardener plan the beds now please\n\nKeep typing here\n${"and after it\n".repeat(8)}`);
    // Mid-screen, away from the margins that would hide a jump.
    d.place(13, 3);
    drawn(d);
    d.place(10, 3);
    const row = cursorRow(d);
    expect(row).toBeGreaterThan(1); expect(row).toBeLessThan(H - 2);
    d.asks.set("@gardener plan the beds now please", { line: "@gardener plan the beds now please", state: "answer in the note", blocks: 2, beside: true });
    expect(drawn(d).join("\n")).toContain("answer in the note");
    expect(draftView(d).cursorRow).toBe(row);
    for (const c of " more") d.key({ kind: "char", ch: c });
    expect(cursorRow(d)).toBe(row);
    expect(drawn(d)[row]).toContain("more");
  });

  test("a note that fits shows all of it: its first line stays, and the typed row gives way", () => {
    const d = new Draft("note-ask-tall", 4, `Plan\n\n@gardener plan the beds now please\n\nKeep typing here`);
    d.place(4, 3);
    const v = draftView(d);
    v.render(W, 24);
    d.asks.set("@gardener plan the beds now please", { line: "@gardener plan the beds now please", state: "answer in the note", blocks: 2, beside: true });
    const rows = v.render(W, 24).map(visible);
    expect(rows[0]).toContain("Plan");
    // Grown from a narrow box too: what scrolled away for lack of room comes back.
    const n = new Draft("note-narrow", 4, Array.from({ length: 5 }, (_, i) => `row ${i + 1}`).join("\n"));
    n.place(4, 2);
    const nv = draftView(n);
    nv.render(W, 3);
    expect(nv.render(W, 12).map(visible)[0]).toContain("row 1");
  });

  test("a note that just fits keeps its first line whatever the cursor's margin says, and an agent's patch leaves it there", () => {
    const d = new Draft("note-just-fits", 4, ["Tansy", "", "two", "", "four", "", "six"].join("\n"));
    d.place(6, 3);
    const v = draftView(d);
    for (const h of [7, 8, 9, 10]) {
      const rows = v.render(W, h).map(visible);
      expect(rows[0]).toContain("Tansy");
      expect(rows[6]).toContain("six");
    }
    patch(d, "two", "two and a bit");
    expect(v.render(W, 8).map(visible)[0]).toContain("Tansy");
    // One row past the fit the margin is back.
    d.key({ kind: "enter" });
    expect(v.render(W, 7).map(visible)[0]).not.toContain("Tansy");
  });

  test("an open landing in view with only a drawing in view leaves the cursor where it was (PIE-1579)", () => {
    const d = new Draft("note-drawn", 4, ["Tansy", ...Array.from({ length: 10 }, (_, i) => `bed ${i + 1}`), "run the count", "after it"].join("\n"));
    const v = draftView(d);
    v.kept = line => (line === 11 ? Array.from({ length: 30 }, (_, i) => `drawn ${i + 1}`) : []);
    d.follow = false;
    v.render(W, H);
    v.scrollBy(14);
    expect(v.render(W, H).map(visible).every(l => l.includes("drawn"))).toBe(true);
    d.landInView = true;
    v.render(W, H);
    expect(d.row).toBe(0);
    expect(d.landed).toBeNull();
  });

  test("a note that fits draws from its first row with the view not following too: an open, seeded by the reader's top", () => {
    const d = new Draft("note-opened", 4, ["Tansy", "one", "two", "three", "four", "five", "six"].join("\n"));
    const v = draftView(d);
    v.render(W, 8);
    d.position.view = { line: 1, row: 0 };
    d.follow = false;
    expect(v.render(W, 8).map(visible)[0]).toContain("Tansy");
    const rich = richView(d), draw = (text: string) => ({ lines: text.split("\n"), source: text.split("\n").map((_, i) => i) });
    rich.open(TIDY);
    d.position.view = { line: 1, row: 0 };
    d.follow = false;
    expect(rich.render(W, 20, draw).map(visible).join("\n")).toContain("Tansy");
  });

  test("rich cells that fit show all of it once there's room again", () => {
    const d = new Draft("note-rich-fit", 4, `${Array.from({ length: 6 }, (_, i) => `row note ${i + 1}`).join("\n\n")}\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |`);
    const rich = richView(d);
    rich.open(TIDY);
    d.place(d.lines.length - 1, 3);
    const draw = (text: string) => ({ lines: text.split("\n"), source: text.split("\n").map((_, i) => i) });
    rich.render(W, 8, draw);
    expect(rich.render(W, 40, draw).map(visible).join("\n")).toContain("row note 1");
  });

  test("a rich status of three rows: an agent's patch still leaves the cell's row where it was", () => {
    const text = `${Array.from({ length: 6 }, (_, i) => `row note ${i + 1}`).join("\n\n")}\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |`;
    const d = new Draft("note-rich-said", 4, text);
    const rich = richView(d);
    d.place(d.lines.length - 1, 3);
    rich.open({ kind: "user" });
    d.status.say("a long thing the draft said that wraps across three rows of the rich editor's status so its body starts lower than it did");
    const draw = (t: string, w: number) => { const lines = t.split("\n").map(l => l.slice(0, w)); return { lines, source: lines.map((_, i) => i) }; };
    const at = () => rich.render(W, 16, draw).findIndex((l: string) => /[a-z]│[a-z]/.test(visible(l)));
    const row = at();
    expect(row).toBeGreaterThan(3);
    patch(d, "row note 5\n", "row note 5\nthinned\n");
    expect(at()).toBe(row);
  });

  test("in rich cells, too: lines added above keep the cursor's row", () => {
    const text = `${Array.from({ length: 12 }, (_, i) => `row note ${i + 1}`).join("\n\n")}\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |`;
    const d = new Draft("note-rich", 4, text);
    const rich = richView(d);
    d.place(d.lines.length - 1, 3);
    draftView(d).render(W, H);              // drawn raw first: the place it left is the raw view's
    rich.open({ kind: "user" });
    const draw = (t: string, w: number) => { const lines = t.split("\n").map(l => l.slice(0, w)); return { lines, source: lines.map((_, i) => i) }; };
    const at = () => rich.render(W, 12, draw).findIndex((l: string) => /[a-z]│[a-z]/.test(visible(l)));   // the cursor, inside "leek"
    const row = at();
    expect(row).toBeGreaterThan(1);
    patch(d, "row note 1\n", "row note 1\nmore\nand more\n");
    expect(at()).toBe(row);
    // A line added between the top row and the cursor's cell: the cell stays on its row too.
    rich.scroll(-3);                         // (the wheel: a few prose lines above the table come into view)
    const row2 = at(), shown = rich.render(W, 12, draw).map(visible);
    const above = shown.slice(2, row2).map(r => r.trim()).find(r => r.startsWith("row note"))!;
    patch(d, `${above}\n`, `${above}\nthinned\n`);
    expect(at()).toBe(row2);
  });
});
