// The river is calm: focus moves the keys and nothing else; the layout moves only on an explicit shift
// (w, a click on a column's header, `widen`, an open that needs it); a peek column shows its note covered
// like a drawer, dimmed; back and forward go between the columns a follow opened. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { River } from "../src/river/river";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe.skipIf(!outliner)("a calm river, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, river: River;
  let key: (k: Key) => void = () => {};
  const notes: Record<string, any> = {};
  const AS = "calm-agent-1";
  const R = () => river as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const draw = (): string[] => R().render(app).lines;
  /** Every column's place and every pane's clickable place, as drawn now. */
  const geometry = () => { draw(); return JSON.stringify({ cols: R().colRects, panes: R().hits.map((h: any) => [h.col, h.pane, h.rect, h.cover]), tops: R().panes().map((p: any) => p.top) }); };
  const cols = () => (app.describe() as any).state.columns as any[];
  const titleAt = (n: number) => cols()[n - 1].panes[0].title as string;
  const focusedTitle = () => cols().find(c => c.focused).panes[0].title as string;
  const wideTitle = () => cols().find(c => c.wide).panes[0].title as string;
  const coverOfTitle = (t: string) => cols().find(c => c.panes[0].title === t)?.cover;
  const rectOf = (t: string) => { draw(); const i = cols().findIndex(c => c.panes[0].title === t); return R().colRects.find((c: any) => c.col === i).rect; };
  const click = (x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };
  /** The person's jump (`/`) to a note by title: it opens beside the focused column, as ⏎ does. */
  const jump = async (title: string) => {
    key(char("/"));
    for (const c of title) key(char(c));
    key({ kind: "enter" });
    await until(() => cols().some(c => c.panes[0].title === title && c.focused), `the ${title} column`);
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
    river = new River();
    app.push(new MainMenu()); app.push(river);
    await until(() => (R().cols[0]?.panes[0].items?.length ?? 0) >= 3, "the Library", 10_000);
    await until(() => R().idx.loaded, "the index", 10_000);
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
    const lines = draw(), i = cols().findIndex(c => c.panes[0].title === "Mailroom");
    const r = R().colRects.find((c: any) => c.col === i).rect;
    expect(cols()[i].cover).toBe("peek");
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
    const focus = () => R().cols[R().focus].uid;
    const was = focus();
    const opened: any = await act("open", { id: notes.ferry.id }, "1");
    expect(focus()).toBe(was);
    expect(await act("widen", {}, opened.reader)).toMatchObject({ wide: true });
    expect(focus()).toBe(was);
    expect(wideTitle()).toBe("Ask about the ferry");
    expect((app as any).message as string).toContain(`an agent (${AS}) widened`);
    await act("pin", { docked: true }, "2");
    await act("select", { id: notes.door.id }, cols().findIndex(c => c.panes[0].title === "Mailroom") + 1 + "");
    await act("replies", { open: true }, "1");
    await act("close", {}, opened.reader);
    expect(focus()).toBe(was);
    await act("pin", { docked: false }, "2");
  });

  test("back and forward go between the columns a follow opened; back to a full column moves only the keys", async () => {
    const m = rectOf("Mailroom");
    click(m.col, m.row);                                         // widen the Mailroom by its header
    await until(() => R().cols.some((c: any) => c.panes[0].items?.length), "the replies");
    const mail = R().cols.findIndex((c: any) => c.panes[0].source.id === notes.mail.id);
    R().cols[mail].panes[0].sel = R().flat(R().cols[mail].panes[0]).findIndex((x: any) => x.m.id === notes.door.id);
    key({ kind: "enter" });                                      // open the door note beside
    await until(() => focusedTitle() === "Paint the boathouse door", "the door column");
    await until(() => !!R().cols[R().focus].panes[0].surface.msg, "its note");
    draw();
    key(char("]")); key({ kind: "enter" });                     // follow its link to the log
    await until(() => focusedTitle() === "Harbour log" && R().cols[R().focus].from !== undefined, "the followed log");
    expect(plain(draw().join("\n"))).toContain("← back · Paint the boathouse door");
    const before = geometry();
    key({ kind: "backspace" });
    expect(focusedTitle()).toBe("Paint the boathouse door");
    expect(geometry()).toBe(before);                             // it was full: only the keys moved
    key({ kind: "alt-right" });
    expect(focusedTitle()).toBe("Harbour log");
  });
});
