// PIE-1501: a collection scrolls and steps like the live tables beside it. The wheel over a tall collection scrolls its
// rows first, then the note; j k [ ] and clicks move through its rows as through a ::graph-table's, with no in/out mode.
// Fictional notes, against a throwaway outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("a collection scrolls and steps like a live table (PIE-1501)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk;
  let key: (k: Key) => void = () => {};
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const B = () => BV.view(b);
  const frame = () => b.render(B().ctx).lines;
  const text = () => plain(frame().join("\n"));
  const where = (lines: string[], t: string) => {
    for (let y = 0; y < lines.length; y++) { const x = plain(lines[y] ?? "").indexOf(t); if (x >= 0) return { x: x + 1, y }; }
    throw new Error(`"${t}" isn't drawn`);
  };
  const whole = (p: ReaderPane, id: string) => until(() => !!p.msg && !p.msg.partial && p.msg.id === id, `the whole note ${id.slice(0, 8)}`);
  const n: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (let i = 1; i <= 40; i++) await create(null, `Parcel ${String(i).padStart(2, "0")} [type::parked-parcel] [stage::parked]\nLeft at the depot.`);
    n.feed = await create(null, "Parked [type::virtual-branch] [query::type=parked-parcel] [layout::feed, table, board] [sort::title asc]");
    n.table = await create(null, `Parcel table\nBefore the table.\n\n::graph-table\n---\ntitle: Parcels\nquery: "type=parked-parcel"\nsort: title\n---\n::\n\nAfter the table.`);
    const term = { info: { cols: 120, rows: 30, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  const open = async (id: string) => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    b = openScreen("detail", { note: id, persist: false }) as Desk;
    app.push(b);
    const d = b.pane("detail") as ReaderPane;
    await whole(d, id);
    return d;
  };

  test("the wheel over a saved feed opened as its own note scrolls the note", async () => {
    const d = await open(n.feed.id);
    await until(() => text().includes("Parcel 01"), "the feed's rows", 8000);
    await until(() => !text().includes("reading…"), "the cards' bodies", 8000);
    const at = where(frame(), "Parcel 03");
    for (let i = 0; i < 3; i++) { key({ kind: "mouse", action: "wheel-down", button: 0, ...at }); frame(); }
    expect(d.surface.scroll).toBe(3);
    expect(text()).toContain("Parcel 04");
    for (let i = 0; i < 3; i++) { key({ kind: "mouse", action: "wheel-up", button: 0, ...at }); frame(); }
    expect(d.surface.scroll).toBe(0);
    expect(text()).not.toContain("Parcel 04");
  }, 20_000);

  test("j from the top of a saved view opened as its own note lands on its first row; esc lets go; j resumes; k walks back out", async () => {
    const d = await open(n.feed.id);
    await until(() => text().includes("Parcel 01"), "the feed's rows", 8000);
    const list = () => d.surface.listsDrawn.find((l: any) => l.collection)! as any;
    const picked = () => list().view.picked()?.label as string | undefined;
    const onRow = () => !!d.surface.selectedElement()?.link?.listRow?.row;
    key(char("j")); frame();
    expect(onRow()).toBe(true);
    expect(picked()).toBe("Parcel 01");
    expect(d.surface.contextualHint()).toContain("Parcel 01");
    expect(d.surface.contextualHint()).toContain("pick");
    expect(d.surface.contextualHint()).not.toContain("leave");
    key(char("j")); key(char("j")); frame();
    expect(picked()).toBe("Parcel 03");
    key({ kind: "esc" }); frame();
    expect(onRow()).toBe(false);
    expect(d.surface.contextualHint()).toBeNull();
    key(char("j")); frame();
    expect(onRow()).toBe(true);
    expect(picked()).toBe("Parcel 03");
    key(char("k")); key(char("k")); key(char("k")); frame();
    expect(onRow()).toBe(false);
    key(char("k")); frame();
    expect(picked()).toBe("Parcel 40");
    expect(onRow()).toBe(true);
    // [ ] walk the rows as elements; Tab is the screen's, not a way out.
    key(char("[")); frame();
    expect(picked()).toBe("Parcel 39");
    key(char("]")); frame();
    expect(picked()).toBe("Parcel 40");
    key({ kind: "tab" }); frame();
    expect(picked()).toBe("Parcel 40");
    expect(onRow()).toBe(true);
  }, 20_000);

  test("the wheel over a live table scrolls its rows first, then the note", async () => {
    const d = await open(n.table.id);
    await until(() => text().includes("Parcel 40"), "the table's rows", 8000);
    const list = () => [...(d.surface as any).inlineLists.values()][0] as any;
    const at = where(frame(), "Parcel 38");
    key({ kind: "mouse", action: "wheel-down", button: 0, ...at }); frame();
    expect(list().view.top).toBe(1);
    expect(d.surface.scroll).toBe(0);
    for (let i = 0; i < 40; i++) { key({ kind: "mouse", action: "wheel-down", button: 0, ...at }); frame(); }
    expect(list().view.top).toBe(list().view.maxTop);
    expect(d.surface.scroll).toBeGreaterThan(0);
  }, 20_000);
});
