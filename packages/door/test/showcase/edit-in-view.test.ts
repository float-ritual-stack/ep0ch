// PIE-1579: an edit opened after the wheel or PageDown puts its cursor on a row in view. The bytes a terminal sends go
// through the real decoder into the showcase's reader; the first key typed lands where the person is looking, and the
// view doesn't move. Made-up notes on a scratch outline.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { App } from "../../src/app";
import type { Desk } from "../../src/desk/desk";
import type { ReaderPane } from "../../src/desk/panes";
import { draftView } from "../../src/draft-view";
import { SECTIONS, type Showcase } from "../../src/showcase/showcase";
import type { SocketBoard } from "../../src/socket";
import { KeyDecoder } from "../../src/term";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
/** No line of it holds an `x`, so the one typed is easy to find; every paragraph wraps in a narrow tile. */
const LONG = Array.from({ length: 40 }, (_, i) => `Cane ${i + 1}: tie the runner beans to the frame before the wind gets up, and mulch the bed around them well.`).join("\n\n");
const PGDN = "\x1b[6~";

const cols = 44; // narrow, so a paragraph wraps and the wheel can stop inside one; one seed, as this file's cost is the seed
describe.skipIf(!outliner)("an edit opened where you're reading", () => {
  const h = useShowcaseScreen(cols);
  const { screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase;
  beforeAll(() => { ({ board, app, sc } = h); });

  let last: { desk: Desk; reader: ReaderPane; note: { id: string }; feed: (bytes: string) => void; wheel: string; x: number; y: number } | undefined;
  const rows = () => sc.render(app).lines.map(plain);
  /** The one-place section's reader on a new long note, its keys given to it. */
  async function reading(title: string, body = LONG) {
    if (S().focus !== "stage") {
      (app as any).lastInput = 0;
      await app.act({ action: "section", args: { name: "one-place" }, as: "place-check" });
      screen();
      h.press({ kind: "enter" });
      await until(() => S().focus === "stage", "the keys in the section");
    }
    screen();
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "one-place")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    const note = await board.createBlock(null, `${title}\n\n${body}`);
    await desk.dispatch.press("open", { id: note.id }, "reader");
    await until(() => reader.msg?.id === note.id && !reader.msg.partial && screen().includes("Cane 1"), "the long note");
    await desk.dispatch.press("tile.focus", {}, "reader");
    const decoder = new KeyDecoder(app.terminalSize); decoder.keyHandler = h.press;
    const ls = rows(), y = ls.findIndex(l => l.includes("Cane 1")), x = ls[y]!.indexOf("Cane 1");
    return last = { desk, reader, note, feed: (bytes: string) => { decoder.feed(bytes); screen(); }, wheel: `\x1b[<65;${x + 1};${y + 1}M`, x, y };
  }
  /** `e`, and `e` again for the arming; back with the draft drawn. */
  async function opened(r: NonNullable<typeof last>) {
    r.feed("e"); r.feed("e");
    await until(() => { screen(); return !!r.reader.surface.draft; }, "the edit");
    screen();
    return r.reader.surface.draft!;
  }
  /** Types `x` and asserts it's in view, off the title, and that nothing above it on screen moved. */
  function typesInView(r: NonNullable<typeof last>, title: string) {
    const d = r.reader.surface.draft!, v = draftView(d), top = v.scrollFigure.top, before = rows();
    expect(d.position.caret ?? null).not.toBeNull();         // the cursor's line is on screen, where it was drawn
    expect(d.row).toBeGreaterThan(0);
    r.feed("x");
    expect(d.lines[0]).toBe(title);
    expect(d.text).toContain("x");
    expect(v.scrollFigure.top).toBe(top);
    const after = rows();
    expect(after.some(l => l.includes("x") && !before.includes(l))).toBe(true);
    return { line: d.lines[d.row]!, row: v.cursorRow };
  }
  // Out of the edit, back to reading (what was typed is put aside on its own note).
  afterEach(async () => {
    const reader = last?.reader;
    for (let i = 0; i < 4 && reader?.surface.editing; i++) { h.press({ kind: "esc" }); screen(); await Bun.sleep(20); }
    await until(() => { screen(); return !reader?.surface.editing; }, "the edit closed");
  });

  test("the wheel, then e, then x: the x lands on a row in view and the view stays", async () => {
    const title = `Wheel beans ${cols}`, r = await reading(title);
    for (let i = 0; i < 30; i++) r.feed(r.wheel);
    expect(r.reader.surface.position.reading).toBe(0);     // the wheel leaves the reading line where it was
    expect(r.reader.surface.viewport()!.first!).toBeGreaterThan(1);
    const was = rows(), sample = was.find(l => /Cane \d+:/.test(l))!.match(/Cane \d+:/)![0];
    await opened(r);
    expect(rows().findIndex(l => l.includes(sample))).toBe(was.findIndex(l => l.includes(sample)));
    typesInView(r, title);
  });

  test("typed on the edit's top row and saved: the line stays below the reader's header, in view (PIE-1585)", async () => {
    const title = `Top row beans ${cols}`, r = await reading(title);
    for (let i = 0; i < 30; i++) r.feed(r.wheel);
    const d = await opened(r);
    for (let i = 0; i < 40 && draftView(d).cursorRow > 0; i++) h.press({ kind: "up" });
    screen();
    expect(draftView(d).cursorRow).toBe(0);
    for (const c of "zq") h.press({ kind: "char", ch: c });
    screen();
    h.press({ kind: "char", ch: "s", ctrl: true });
    await until(() => { screen(); return !r.reader.surface.editing; }, "the save");
    await until(() => rows().some(l => l.includes("zq")), "the line typed on the top row, in view");
  });

  test("saved at the end of a note whose answers the reader draws taller than the edit: the line typed stays in view (PIE-1585)", async () => {
    // Answers to an agent this outline doesn't have: folded as yo's are, and nobody is asked. Twelve @yo lines asked yo
    // twelve times at once on the save, which held the door for seconds and turned the tests after this one red (PIE-1763).
    const answered = Array.from({ length: 12 }, (_, i) => `Cane ${i + 1}\n@plover how do I tie cane ${i + 1}\n> [!note]- @plover answered\n> one\n> two\n> three\n> four`).join("\n\n");
    const title = `Answered beans ${cols}`, r = await reading(title, answered);
    const d = await opened(r);
    // ctrl+End under the shut answer that ends the note goes to a line of its own after it (PIE-1741); one ⏎ more is
    // the blank line between it and the paragraph typed.
    h.press({ kind: "end", ctrl: true });
    h.press({ kind: "enter" });
    for (const c of "the last line x") h.press({ kind: "char", ch: c });
    screen();
    expect(d.text.endsWith("> four\n\nthe last line x")).toBe(true);
    h.press({ kind: "char", ch: "s", ctrl: true });
    await until(() => { screen(); return !r.reader.surface.editing; }, "the save");
    await until(() => rows().some(l => l.includes("the last line x")), "the line typed last, in view");
  });

  test("the wheel stopped inside a wrapped paragraph: the cursor is on the row at the top, not above it", async () => {
    const title = `Wrapped beans ${cols}`, r = await reading(title);
    const doc = () => (r.reader.surface as any).drawn.doc.source as number[];
    let turned = 0;
    for (; turned < 60; turned++) {
      r.feed(r.wheel);
      const at = r.reader.surface.viewport()!.top;
      if (at > 1 && doc()[at] === doc()[at - 1]) break;
    }
    expect(turned).toBeLessThan(60);
    await opened(r);
    typesInView(r, title);
  });

  test("PageDown, then e, then x: the same", async () => {
    const title = `Paged beans ${cols}`, r = await reading(title);
    r.feed(PGDN); r.feed(PGDN);
    expect(r.reader.surface.position.reading).toBe(0);
    await opened(r);
    typesInView(r, title);
  });

  test("keeps: j then e opens on the line j reached, the cursor at its start", async () => {
    const title = `Stepped beans ${cols}`, r = await reading(title);
    for (let i = 0; i < 3; i++) r.feed("j");
    const line = r.reader.surface.readingSourceLine();
    expect(line).toBeGreaterThan(0);
    const d = await opened(r);
    expect(d.row).toBe(line);
    expect(d.col).toBe(0);
  });

  test("keeps: a click on a line in view, then e, opens on that line", async () => {
    const title = `Clicked beans ${cols}`, r = await reading(title);
    for (let i = 0; i < 12; i++) r.feed(r.wheel);
    const ls = rows(), y = ls.findIndex((l, i) => i > r.y && /Cane \d+:/.test(l)), label = ls[y]!.match(/Cane \d+:/)![0];
    h.press({ kind: "mouse", action: "down", button: 0, x: ls[y]!.indexOf(label), y });
    h.press({ kind: "mouse", action: "up", button: 0, x: ls[y]!.indexOf(label), y });
    screen();
    const d = await opened(r);
    expect(d.lines[d.row]).toStartWith(label);
  });

  const closed = async (r: NonNullable<typeof last>) => {
    for (let i = 0; i < 4 && r.reader.surface.editing; i++) { h.press({ kind: "esc" }); screen(); await Bun.sleep(20); }
    await until(() => { screen(); return !r.reader.surface.editing; }, "the edit closed");
  };

  test("the wheel, e, esc with nothing done: the reading line stays where it was, so the next j starts from the view's top", async () => {
    const r = await reading(`Left beans ${cols}`);
    for (let i = 0; i < 30; i++) r.feed(r.wheel);
    const place = r.reader.surface.position.reading, first = r.reader.surface.viewport()!.first!;
    const d = await opened(r);
    expect(d.row).toBeGreaterThan(0);                      // the open placed the cursor in view
    await closed(r);
    expect(r.reader.surface.position.reading).toBe(place);
    r.feed("j");
    expect(r.reader.surface.readingSourceLine()).toBeGreaterThanOrEqual(first - 1);
  });

  test("the wheel, e, a move, esc: the reading line goes where the person took the cursor", async () => {
    const r = await reading(`Moved beans ${cols}`);
    for (let i = 0; i < 30; i++) r.feed(r.wheel);
    const d = await opened(r);
    r.feed("\x1b[B");                                      // ↓: the person's own move
    const row = d.row;
    await closed(r);
    expect(r.reader.surface.readingSourceLine()).toBe(row);
  });

  test("the reading line left below, then wheeled back to the top: the edit opens on the title", async () => {
    const title = `Topped beans ${cols}`, r = await reading(title);
    for (let i = 0; i < 40; i++) r.feed("j");
    expect(r.reader.surface.readingSourceLine()).toBeGreaterThan(10);
    await r.desk.dispatch.press("scroll", { to: "top" }, "reader");
    screen();
    const d = await opened(r);
    expect(d.row).toBe(0);
    expect(draftView(d).scrollFigure.top).toBe(0);
  });
});
