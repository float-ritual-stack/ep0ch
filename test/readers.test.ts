// PIE-411: every reader scrolls, by keys and by the wheel, and focus is never trapped. Keys follow the
// editor: only the focused reader's edit, comment or property panel takes them, and only one the person
// is in (they opened it by key, or entered it with e or ⏎), so an agent's session never takes their keys.
// The wheel goes where the pointer is, whatever holds a reader. Frames show where a long note is.
// Against a throwaway outliner service (never a real outline).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Canvas } from "../src/canvas";
import { Desk } from "../src/desk/desk";
import { DeliveryBoard } from "../src/desk/delivery";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
/** A long fictional note: 120 body lines, far more than any reader shows. */
const long = (title: string, stage: string) => `${title} [stage::${stage}]\n${Array.from({ length: 120 }, (_, i) => `${title} line ${i + 1}: the hose runs along the fence past the shed.`).join("\n")}`;

describe("the scroll thumb", () => {
  test("its length is the share in view and its place how far down; none when it all fits", () => {
    const at = (top: number) => {
      const c = new Canvas(10, 12);
      c.box({ col: 0, row: 0, cols: 10, rows: 12 }, "");
      c.thumb({ col: 0, row: 0, cols: 10, rows: 12 }, { top, room: 10, total: 40 }, "");
      return c.lines().map(l => plain(l)[9]).slice(1, 11).join("");
    };
    expect(at(0)).toBe("███│││││││");                                          // 10 of 40 lines in view: a quarter
    expect(at(15)).toBe("││││███│││");
    expect(at(30)).toBe("│││││││███");
    const fits = new Canvas(10, 12);
    fits.thumb({ col: 0, row: 0, cols: 10, rows: 12 }, { top: 0, room: 10, total: 8 }, "");
    expect(fits.lines().join("")).not.toContain("█");
  });
});

describe.skipIf(!outliner)("readers always scroll, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any;
  const cards: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const AS = "test-agent-411";
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const message = () => (app as any).message as string;
  const scrollOf = (p: ReaderPane) => p.surface.scroll;
  const frame = () => b.render(B().ctx).lines.map(plain);
  const hints = () => frame().at(-1)!;
  const rect = (region: string) => { b.render(B().ctx); return B().rects.get(region); };
  const wheel = (r: { col: number; row: number; cols: number; rows: number }, action: "wheel-down" | "wheel-up" = "wheel-down") =>
    key({ kind: "mouse", action, button: 0, x: r.col + Math.floor(r.cols / 2), y: r.row + Math.floor(r.rows / 2) });
  const whole = (p: ReaderPane, id?: string) => until(() => !!p.msg && !p.msg.partial && (!id || p.msg.id === id), "the whole note");
  /** A new board on the same hub, the lanes loaded and the preview on the first Queued card. */
  const fresh = async () => {
    if ((app as any).stack.at(-1) instanceof DeliveryBoard || (app as any).stack.at(-1) instanceof Desk) app.pop();
    b = new DeliveryBoard(hub.id);
    app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items?.length), "the lanes", 10_000);
    await whole(B().preview);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    await create(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
    cards.beans = await create(null, long("Stake the beans", "queued"));
    cards.squash = await create(null, long("Plant the squash", "queued"));
    cards.gate = await create(null, long("Fix the gate", "doing"));
    cards.shed = await create(null, long("Paint the shed", "doing"));
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("m or c in a detail (meant as move or collapse) opens comments there: the frame and hints say so, and the wheel still scrolls the preview", async () => {
    for (const k of ["m", "c"]) {
      await fresh();
      key({ kind: "enter" });
      const d = B().details[0] as ReaderPane;
      await whole(d);
      key(char(k));
      await until(() => !!d.session, "the comment session");
      await Bun.sleep(30);
      expect(B().focus).toBe("detail0");
      const title = frame()[rect("detail0").row]!;
      expect(title).toContain(k === "m" ? "comments" : "quoting");
      expect(hints()).toContain(`detail 1 · ${k === "m" ? "comments" : "quoting"}`);
      expect(message()).toStartWith(`detail 1 · ${k === "m" ? "comments" : "quoting"}`);
      // The wheel over the preview scrolls the preview, not the session's reader.
      wheel(rect("preview"));
      expect(scrollOf(B().preview)).toBe(3);
      key({ kind: "esc" }); if (d.session) key({ kind: "esc" });
      expect(d.session).toBeNull();
      // Reading again: j, PgDn, space and the wheel scroll the detail.
      key({ kind: "down" }); key({ kind: "pgdn" }); key(char(" "));
      expect(scrollOf(d)).toBe(31);
      wheel(rect("detail0"));
      expect(scrollOf(d)).toBe(34);
    }
  });

  test("e then esc before the note is read: no draft opens behind the person, and j moves the lanes", async () => {
    await fresh();
    const get = board.get.bind(board);
    (board as any).get = async (...a: Parameters<SocketBoard["get"]>) => { await Bun.sleep(250); return get(...a); };
    try {
      key(char("e"));
      expect(B().focus).toBe("preview");
      key({ kind: "esc" });
      expect(B().focus).toBe("lanes");
      await Bun.sleep(450);
      expect(B().preview.draft).toBeNull();
      const sel = B().lanes[B().lane].sel;
      key(char("j"));
      expect(B().lanes[B().lane].sel).toBe(sel + 1);
      // The same in a detail: e, then esc to the lanes.
      key({ kind: "enter" });
      const d = B().details[0] as ReaderPane;
      await whole(d);
      key(char("e")); key({ kind: "esc" });
      await Bun.sleep(450);
      expect(d.draft).toBeNull();
      // And a comment's passage picker (c reads the note first too).
      key({ kind: "tab" }); key({ kind: "tab" });
      expect(B().focus).toBe("detail0");
      key(char("c")); key({ kind: "tab" });
      await Bun.sleep(450);
      expect(d.session).toBeNull();
    } finally { (board as any).get = get; }
    // With the service answering, e opens the edit and the person is in it: keys type.
    B().focus = "detail0";
    const d = B().details[0] as ReaderPane;
    key(char("e"));
    await until(() => !!d.draft, "the draft");
    await Bun.sleep(20);
    key({ kind: "end" }); key(char("!"));
    expect(d.draft!.dirty).toBe(true);
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(d.draft).toBeNull();
  });

  test("an agent's edit in the preview while the person is in the lanes doesn't take their keys", async () => {
    await fresh();
    expect(B().focus).toBe("lanes");
    await act("edit", {}, "preview");
    const p = B().preview as ReaderPane;
    expect(p.draft).not.toBeNull();
    const text = p.draft!.text;
    const sel = B().lanes[B().lane].sel;
    key(char("j"));
    expect(B().lanes[B().lane].sel).toBe(sel + 1);                             // the lanes moved
    expect(p.draft!.text).toBe(text);                                         // nothing typed into the agent's draft
    expect(B().focus).toBe("lanes");
    // Tab to it: the frame and hints say whose it is and how to get in; j scrolls, doesn't type.
    key({ kind: "tab" });
    expect(B().focus).toBe("preview");
    expect(hints()).toContain("preview · editing · e ⏎ enter the edit");
    expect(frame()[rect("preview").row]).toContain("editing (e enters)");
    key(char("j")); key(char("x"));
    expect(p.draft!.text).toBe(text);
    expect(p.draft).not.toBeNull();                                           // x on it refuses rather than closing it
    expect(message()).toContain("not closed");
    // e enters it: now keys type.
    key(char("e"));
    key(char("?"));
    expect([p.draft!.text.length, p.draft!.text.includes("?"), p.draft!.dirty]).toEqual([text.length + 1, true, true]);
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(p.draft).toBeNull();
    expect(B().focus).toBe("preview");
  });

  test("an agent's comment session in a detail: tab and esc still move the person; the wheel scrolls where the pointer is", async () => {
    await fresh();
    key({ kind: "enter" });
    const d = B().details[0] as ReaderPane;
    await whole(d);
    key({ kind: "esc" });
    await act("threads", {}, "detail1");
    expect(d.session).not.toBeNull();
    expect(B().focus).toBe("lanes");
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(B().focus).toBe("detail0");
    key({ kind: "tab" });
    expect(B().focus).toBe("lanes");                                           // tab went round, not into the thread list
    wheel(rect("preview"));
    expect(scrollOf(B().preview)).toBe(3);
    await act("comment.close", {}, "detail1");
  });

  test("the wheel is never swallowed by an open edit: it scrolls the reader under the pointer", async () => {
    await fresh();
    key({ kind: "enter" });
    const d = B().details[0] as ReaderPane;
    await whole(d);
    key(char("e"));
    await until(() => !!d.draft, "the draft");
    await Bun.sleep(20);
    wheel(rect("preview"));
    expect(scrollOf(B().preview)).toBe(3);
    // A click elsewhere still can't strand the edit.
    const r = rect("preview");
    key({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y: r.row + 3 });
    expect(B().focus).toBe("detail0");
    expect(message()).toContain("finish the edit first");
    key({ kind: "esc" });
    expect(d.draft).toBeNull();
  });

  test("with the property panel open, PgDn, space and the wheel scroll the note", async () => {
    await fresh();
    key(char("i"));
    const p = B().preview as ReaderPane;
    expect(p.surface.panel).not.toBeNull();
    expect(B().focus).toBe("preview");
    b.render(B().ctx);
    key({ kind: "pgdn" }); key(char(" "));
    b.render(B().ctx);
    expect(scrollOf(p)).toBe(30);
    wheel(rect("preview"));
    expect(scrollOf(p)).toBe(33);
    key({ kind: "esc" });
    expect(p.surface.panel).toBeNull();
  });

  test("docking a float never drops a detail holding an edit", async () => {
    await fresh();
    key({ kind: "enter" });                                                    // detail 1
    const d0 = B().details[0] as ReaderPane;
    await whole(d0);
    key({ kind: "esc" }); key(char("j")); key({ kind: "alt-enter" });          // detail 2
    expect(B().details.length).toBe(2);
    await act("edit", {}, "detail1");                                          // an agent's edit, left open in detail 1
    await act("open", { id: cards.gate.id }, "float");
    expect(B().focus).toBe("float0");
    key(char("o"));                                                            // dock it
    expect(B().floats.length).toBe(0);
    expect(B().details).toContain(d0);
    expect(d0.draft).not.toBeNull();
    expect(B().details.at(-1).msg.id).toBe(cards.gate.id);
    // Both details editing: docking is refused, and says why.
    await act("open", { id: cards.shed.id }, "float");
    await act("edit", {}, B().details.indexOf(d0) === 0 ? "detail2" : "detail1");
    B().focus = "float0";
    key(char("o"));
    expect(B().floats.length).toBe(1);
    expect(message()).toContain("not docked: both details hold edits or comments");
    for (const r of ["detail1", "detail2"]) await act("edit.close", { discard: true }, r);
  });

  test("an agent's card.move leaves the person's lane, selection and preview alone", async () => {
    await fresh();
    const queued = B().lanes.findIndex((l: any) => l.name === "Queued");
    B().lane = queued; B().lanes[queued].sel = 0; B().follow();
    const picked = B().lanes[queued].items[0].id;
    await whole(B().preview, picked);
    expect(await act("card.move", { lane: "Queued", card: cards.gate.id })).toMatchObject({ lane: "Queued" });
    await until(() => !B().moving && B().lanes.every((l: any) => l.items && !l.want), "the lanes", 8000);
    await Bun.sleep(300);
    expect(B().lane).toBe(queued);
    expect(B().lanes[queued].items[B().lanes[queued].sel].id).toBe(picked);
    expect(B().preview.msg.id).toBe(picked);
    expect(B().focus).toBe("lanes");
    await act("card.move", { lane: "Doing", card: cards.gate.id });
    await until(() => !B().moving, "the move");
  });

  test("frames show how far down a long note is: a thumb on the right border and · NN% in the title", async () => {
    await fresh();
    key({ kind: "enter" });
    await whole(B().details[0]);
    key({ kind: "pgdn" });
    const lines = frame(), r = rect("detail0"), pv = rect("preview");
    expect(lines[r.row]).toMatch(/detail 1 · \d+%/);
    expect(lines[pv.row]).toMatch(/preview · follows the board · \d+%/);
    const border = Array.from({ length: r.rows - 2 }, (_, i) => lines[r.row + 1 + i]![r.col + r.cols - 1]).join("");
    expect(border).toContain("█");
    expect(border.indexOf("█")).toBeGreaterThan(0);                             // scrolled: the thumb isn't at the top
    // The float and the desk's reader do the same.
    await act("open", { id: cards.gate.id }, "float");
    await whole(B().floats[0].pane);
    const f = B().floats[0].rect, fl = frame();
    expect(fl[f.row]).toMatch(/\d+%/);
    expect(Array.from({ length: f.rows - 2 }, (_, i) => fl[f.row + 1 + i]![f.col + f.cols - 1]).join("")).toContain("█");
  });

  test("the desk: an agent's edit doesn't take the person's keys, and the wheel still scrolls the pane under it", async () => {
    const desk = new Desk();
    if ((app as any).stack.at(-1) instanceof DeliveryBoard) app.pop();
    app.push(desk);
    const D = desk as any;
    try {
      await act("open", { id: cards.beans.id });
      const rd = [...D.panes.values()].find((p: any) => p.kind === "reader") as ReaderPane;
      await whole(rd, cards.beans.id);
      const readerId = D.focus;
      // Reading: keys and the wheel scroll it; the frame says how far down.
      key({ kind: "pgdn" });
      expect(scrollOf(rd)).toBe(15);
      desk.render(D.ctx);
      const r = D.placed.rects.get(readerId);
      wheel(r);
      expect(scrollOf(rd)).toBe(18);
      expect(plain(desk.render(D.ctx).lines[r.row]!)).toMatch(/\d+%/);
      // An agent opens an edit there: the person's tab still moves focus, their j doesn't type.
      await act("edit");
      const text = rd.draft!.text;
      key(char("j"));
      expect(rd.draft!.text).toBe(text);
      key({ kind: "tab" });
      expect(D.focus).not.toBe(readerId);
      // The person's own edit: every key is its, but the wheel scrolls the pane under the pointer.
      D.focus = readerId;
      key(char("e"));                                                          // enters the agent's edit
      key(char("!"));
      expect([rd.draft!.text.length, rd.draft!.text.includes("!")]).toEqual([text.length + 1, true]);
      const tree = [...D.placed.rects].find(([id]: any) => D.panes.get(id).kind === "tree");
      const before = D.panes.get(tree[0]).sel;
      wheel(tree[1]);
      expect(D.panes.get(tree[0]).sel).not.toBe(before);
      expect(D.focus).toBe(readerId);
      key({ kind: "esc" }); key({ kind: "esc" });
      expect(rd.draft).toBeNull();
    } finally { app.pop(); }
  });
});
