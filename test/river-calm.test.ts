// The river is calm: focus moves the keys and nothing else; the layout moves only on an explicit shift
// (w, a click on a column's header, `widen`, an open that needs it); a peek column shows its note covered
// like a drawer, dimmed; back and forward go between the columns a follow opened. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { view } from "./river-view";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe.skipIf(!outliner)("a calm river, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, river: Desk;
  let key: (k: Key) => void = () => {};
  const notes: Record<string, any> = {};
  const AS = "calm-agent-1";
  const V = () => view(river);
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const draw = (): string[] => river.render(river.ctx).lines;
  /** Every column's place and how it shows, and every scroll, as drawn now. */
  const geometry = () => { draw(); return JSON.stringify(V().tiles.map(c => [c.titleOf(), river.rectOf(c), V().coverOf(c), c.top])); };
  const focusedTitle = () => V().focusedTitle();
  const wideTitle = () => V().wideTitle();
  const coverOfTitle = (t: string) => { draw(); return V().coverOf(t); };
  const rectOf = (t: string) => { draw(); return V().rectOf(t); };
  const click = (x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };
  /** The person's go to (`g`, the desk's search) a note by title: it opens in the next column, as ⏎ does. */
  const jump = async (title: string) => {
    key(char("g"));
    for (const c of title) key(char(c));
    await until(() => plain(draw().join("\n")).includes(title), `${title} found`);
    await Bun.sleep(400);
    key({ kind: "enter" });
    await until(() => focusedTitle() === title, `the ${title} column`);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    const para = (n: number) => `Paragraph ${n}. The keeper logs the tide at dawn and at dusk, the colour of the water and the gulls.`;
    notes.log = await create(null, `Harbour log\n${Array.from({ length: 20 }, (_, i) => para(i + 1)).join("\n\n")}`);
    notes.mail = await create(null, "Mailroom\nWhere quick notes land.");
    notes.door = await create(notes.mail.id, `Paint the boathouse door\nBlue, like the old one. See ((${notes.log.id})).`);
    notes.ferry = await create(notes.mail.id, "Ask about the ferry\nWinter hours start next month.");
    notes.guide = await create(null, "How the Mailroom works\nQuick notes land beneath Mailroom. A sorter files each one where it belongs.");
    const term = { info: { cols: 220, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    river = openScreen("river") as Desk;
    app.push(new MainMenu()); app.push(river);
    await until(() => (V().column(1)?.items?.length ?? 0) >= 3, "the Library", 10_000);
    // Evan's sequence: several columns open, the last one wide.
    await jump("Mailroom");
    await jump("Harbour log");
    await jump("How the Mailroom works");
    draw();
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("an open keeps the column the person was reading full beside the new one", () => {
    expect(wideTitle()).toBe("How the Mailroom works");
    expect(coverOfTitle("Harbour log")).toBe("full");           // the source: not collapsed
    expect(coverOfTitle("Mailroom")).toBe("peek");
  });

  test("a click in a column moves the keys only: every column and pane rect, and every scroll, stays cell for cell", () => {
    for (const t of ["Harbour log", "Mailroom", "Library"]) {
      const before = geometry(), r = rectOf(t);
      click(r.col + 3, r.row + 12);                              // the body, not the header
      expect(focusedTitle()).toBe(t);
      expect(geometry()).toBe(before);
      expect(wideTitle()).toBe("How the Mailroom works");
    }
    // h and l too.
    const before = geometry();
    key(char("l")); key(char("l")); key(char("h"));
    expect(geometry()).toBe(before);
  });

  test("a peek column draws its note's text at reading width, covered by its neighbour like a drawer, and dimmed", () => {
    const g = rectOf("How the Mailroom works");
    click(g.col + 3, g.row + 12);                                // the keys elsewhere: the peek is fully dimmed
    const lines = draw(), r = V().rectOf("Mailroom");
    expect(coverOfTitle("Mailroom")).toBe("peek");
    const slice = (l: string) => plain(l).slice(r.col, r.col + r.cols);
    const body = lines.slice(r.row + 1, r.row + r.rows - 1).map(slice).join("\n");
    expect(body).toContain("Where quick notes land");        // the note's body, not only headings
    expect(body).toContain("Paint the boathouse door");
    expect(body).toContain("Blue, like the old one");           // its replies' text too
    // The drawer's edge down the covered side.
    for (let y = r.row; y < r.row + r.rows; y++) expect(plain(lines[y]!)[r.col + r.cols - 1]).toBe("▒");
    // Dimmed: the note's text is drawn darker than the same kind of text in a full column.
    const fgBefore = (l: string, text: string) => {
      const at = l.indexOf(text);
      const m = [...l.slice(0, at).matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].at(-1);
      return m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0;
    };
    const dim = fgBefore(lines.find(l => plain(l).slice(r.col, r.col + r.cols).includes("Where quick notes"))!, "Where quick notes");
    const full = fgBefore(lines.find(l => l.includes("Paragraph 1."))!, "Paragraph 1.");
    expect(dim).toBeGreaterThan(0);
    expect(dim).toBeLessThan(full * 0.7);
  });

  test("the shift is explicit: w, a click on a column's header, or widen; the column read before stays full", () => {
    const r = rectOf("Harbour log");
    click(r.col + 3, r.row + 10);                                // read the log (focus only)
    const m = rectOf("Mailroom");
    click(m.col + 3, m.row + 10);                                // then focus the Mailroom: nothing moves
    expect(wideTitle()).toBe("How the Mailroom works");
    key(char("w"));                                              // the shift
    expect(wideTitle()).toBe("Mailroom");
    expect(focusedTitle()).toBe("Mailroom");
    expect(coverOfTitle("Mailroom")).toBe("full");
    expect(coverOfTitle("Harbour log")).toBe("full");           // what the person was reading stays
    // The header click: focus and shift in one, on the column's top border.
    const h = rectOf("How the Mailroom works");
    click(h.col + 4, h.row);
    expect(wideTitle()).toBe("How the Mailroom works");
    expect(focusedTitle()).toBe("How the Mailroom works");
    expect(coverOfTitle("Mailroom")).toBe("full");               // it was the one being read
  });

  test("an agent's river actions never move the person's focus; its widen shifts the layout, attributed", async () => {
    const r = rectOf("Harbour log");
    click(r.col + 3, r.row + 10);
    const focus = () => V().focused;
    const was = focus();
    const opened: any = await act("open", { id: notes.ferry.id, from: V().name(V().column(1)) });
    expect(focus()).toBe(was);
    expect(await act("tile.widen", {}, opened.reader)).toMatchObject({ wide: true });
    expect(focus()).toBe(was);
    expect(wideTitle()).toBe("Ask about the ferry");
    expect((app as any).message as string).toContain(`an agent (${AS}) widened`);
    await act("tile.dock", { on: true }, V().name(V().column(2)));
    await act("column.select", { id: notes.door.id }, V().name(V().byTitle("Mailroom")!));
    await act("column.replies", { open: true }, V().name(V().column(1)));
    await act("tile.close", {}, opened.reader);
    expect(focus()).toBe(was);
    await act("tile.dock", { on: false }, V().name(V().column(2)));
  });

  test("back and forward go between the columns a follow opened; back to a full column moves only the keys", async () => {
    const m = rectOf("Mailroom");
    click(m.col, m.row);                                         // widen the Mailroom by its header
    const mail = V().byNote(notes.mail.id)!;
    await until(() => !!mail.items?.length, "the replies");
    mail.sel = mail.flat().findIndex(x => x.m.id === notes.door.id);
    key({ kind: "enter" });                                      // open the door note beside
    await until(() => focusedTitle() === "Paint the boathouse door", "the door column");
    await until(() => !!V().focused.surface.msg, "its note");
    draw();
    key(char("]")); key({ kind: "enter" });                     // follow its link to the log
    await until(() => focusedTitle() === "Harbour log" && V().focus > V().columns.findIndex(c => c.titleOf() === "Paint the boathouse door"), "the followed log");
    expect(plain(draw().join("\n"))).toContain("← back · Paint the boathouse door");
    const before = geometry();
    key({ kind: "backspace" });
    expect(focusedTitle()).toBe("Paint the boathouse door");
    expect(geometry()).toBe(before);                             // it was full: only the keys moved
    key({ kind: "alt-right" });
    expect(focusedTitle()).toBe("Harbour log");
  });

  test("w or a header click on the column that's already wide moves nothing", () => {
    // The keys in a peek, then in the wide column: before, a widen here made the peek the kept column.
    const peek = V().columns.find(c => V().coverOf(c) === "peek")!.titleOf();
    const p = rectOf(peek);
    click(p.col + 3, p.row + 10);
    const wide = wideTitle(), r = rectOf(wide);
    click(r.col + 3, r.row + 10);
    const before = geometry();
    key(char("w"));
    expect(geometry()).toBe(before);
    click(r.col + 4, r.row);
    expect(geometry()).toBe(before);
    expect(wideTitle()).toBe(wide);
  });

  test("a click anywhere on a spine widens it: a spine is all title strip, as a board spine opens on a click", () => {
    const t = (app as any).term.info, was = t.cols;
    t.cols = 120;                                                // narrow enough for spines
    try {
      draw();
      const spine = V().columns.find(c => V().coverOf(c) === "spine")!.titleOf();
      const s = rectOf(spine);
      click(s.col + 1, s.row + 15);                              // the middle of the spine, not its top cell
      expect(focusedTitle()).toBe(spine);
      expect(wideTitle()).toBe(spine);
      expect(coverOfTitle(spine)).toBe("full");
    } finally { t.cols = was; draw(); }
  });

  test("a peek reuses its note's digest from frame to frame, and a change to the note still shows", async () => {
    const p = V().columns.find(c => V().coverOf(c) === "peek" && c.source.kind === "block")!;
    expect(p).toBeTruthy();
    const s = p.surface as any;
    const real = s.digest.bind(s);
    let calls = 0;
    s.digest = (...a: any[]) => { calls++; return real(...a); };
    try {
      draw(); calls = 0;
      for (let n = 0; n < 5; n++) draw();
      expect(calls).toBe(0);                                     // nothing changed: the peek's note isn't rendered again
      // Another client's edit of that note reaches the covered column.
      const id = (p.source as { id: string }).id, now = (await board.request("blocks.context", { blockId: id })).selected;
      await board.request("update", { blockId: id, text: now.text + "\n\nA line added from the quay.", expectedRevision: now.revision, mutation: { author: "agent", actorId: "calm-writer" } });
      await until(() => plain(draw().join("\n")).includes("A line added from"), "the edit in the peek", 5000);
      expect(calls).toBeGreaterThan(0);
    } finally { s.digest = real; }
  });
});
