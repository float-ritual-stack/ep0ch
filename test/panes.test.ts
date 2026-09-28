// PIE-412: the board and the desk on one layout tree. The board's lanes, preview, details, drawers and
// floats are panes in the tree; its keys ({ } < > x o T B S alt+⏎), its border drags and the new pane.*
// actions change the tree; delivery.json and desk.json keep their formats. An agent's pane action is said
// on screen and never takes the person's pane or keys. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { DeliveryBoard } from "../src/desk/delivery";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
type Rect = { col: number; row: number; cols: number; rows: number };

describe.skipIf(!outliner)("the board on the layout tree, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any;
  let key: (k: Key) => void = () => {};
  const AS = "layout-agent-412";
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as = AS) => app.act({ action, args, reader, as });
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const message = () => (app as any).message as string;
  const layout = () => B().describe().layout;
  const rect = (region: string): Rect => { b.render(B().ctx); return B().rects.get(region); };
  const state = () => JSON.parse(readFileSync(join(scratch.root, "door", "delivery.json"), "utf8"));
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const drag = (x0: number, y0: number, x1: number, y1: number) => { b.render(B().ctx); mouse("down", x0, y0); mouse("drag", x1, y1); mouse("up", x1, y1); };
  const whole = (p: ReaderPane) => until(() => !!p.msg && !p.msg.partial, "the whole note");
  /** The panes in the readers row, by name, as peek shows them. */
  const row = () => {
    const find = (n: any): any => (n.key === "readers" ? n : n.kids?.map(find).find(Boolean));
    return find(layout().tree).kids.map((k: any) => k.pane);
  };
  /** A new board, the saved layout cleared first, lanes loaded, the preview on the first card. */
  const fresh = async (keep = false) => {
    if ((app as any).stack.at(-1) instanceof DeliveryBoard || (app as any).stack.at(-1) instanceof Desk) app.pop();
    if (!keep) writeFileSync(join(scratch.root, "door", "delivery.json"), JSON.stringify({ hubs: {} }));
    b = new DeliveryBoard(hub.id);
    app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items?.length), "the lanes", 10_000);
    await whole(B().preview);
  };
  /** The preview and two details, each on its own card; focus back on the lanes. */
  const withDetails = async () => {
    await fresh();
    key({ kind: "enter" }); key({ kind: "esc" });
    key(char("j")); key({ kind: "alt-enter" });
    await whole(B().details[0]); await whole(B().details[1]);
    key({ kind: "esc" });
    expect(B().focus).toBe("lanes");
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Orchard board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    await create(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
    const body = (t: string) => `${t}\n${Array.from({ length: 20 }, (_, i) => `${t} line ${i + 1}: the ladder leans on the pear tree.`).join("\n")}`;
    const prune = await create(null, body("Prune the apples [stage::queued]"));
    await create(null, body("Net the cherries [stage::queued]"));
    await create(null, body("Mend the fence [stage::doing]"));
    await create(null, `Orchard notes\nAbout ((${prune.id})).`);
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

  test("the board is one tree: the lanes over the readers row; alt+⏎ adds a detail to the row, x takes it out", async () => {
    await fresh();
    expect(layout().tree).toMatchObject({ split: "col", key: "board", kids: [{ pane: "lanes", share: 0.42 }, { split: "row", key: "readers", kids: [{ pane: "preview" }] }] });
    await withDetails();
    expect(row()).toEqual(["preview", "detail1", "detail2"]);
    expect(rect("preview").cols + rect("detail0").cols + rect("detail1").cols).toBe(180);
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(B().focus).toBe("detail0");
    const second = B().details[1];
    key(char("x"));
    expect(row()).toEqual(["preview", "detail1"]);
    expect(B().details).toEqual([second]);
    expect(B().focus).toBe("detail0");
  });

  test("{ } and < > change the tree's shares, and delivery.json keeps the fields it had", async () => {
    await withDetails();
    const lanesH = rect("preview").row;
    key(char("}"));
    expect(layout().tree.kids[0].share).toBeCloseTo(0.47);
    expect(rect("preview").row).toBeGreaterThan(lanesH);
    key(char("{")); key(char("{"));
    expect(state().laneFrac).toBeCloseTo(0.37);
    key({ kind: "tab" });                                              // the preview
    const w = rect("preview").cols;
    key(char(">")); key(char(">"));
    expect(rect("preview").cols).toBeGreaterThan(w);
    expect(state().readerWeights).toEqual([5, 3, 3]);                 // by place, as before
    expect(Object.keys(state()).slice(0, 7)).toEqual(["laneFrac", "previewFrac", "treeFrac", "linksFrac", "treeSide", "laneWeights", "readerWeights"]);
  });

  test("T pins the outline drawer into the tree (the readers make room); unpinned it slides over and nothing moves", async () => {
    await fresh();
    const col = rect("preview").col;
    key(char("t"));
    expect(layout().sliding).toEqual(["tree"]);
    expect(rect("preview").col).toBe(col);
    key(char("T"));
    expect(layout().sliding).toEqual([]);
    expect(layout().tree).toMatchObject({ split: "row", kids: [{ pane: "tree", share: 0.3 }, { key: "board" }] });
    expect(rect("preview").col).toBe(54);
    key(char("S"));                                                    // the other side, the same width
    expect(layout().tree.kids.map((k: any) => k.pane ?? k.key)).toEqual(["board", "tree"]);
    expect(rect("preview").col).toBe(0);
    key(char(">"));                                                    // < > on the drawer: its width
    expect(layout().tree.kids[1].share).toBeCloseTo(0.34);
    key(char("T"));
    expect(layout().sliding).toEqual(["tree"]);
    expect(state()).toMatchObject({ treePinned: false, treeSide: "right" });
    expect(state().treeFrac).toBeCloseTo(0.34);
    key(char("t"));
    expect(B().treeOpen).toBe(false);
    expect(layout().tree.key).toBe("board");
  });

  test("B pins the backlinks drawer under the readers; esc on it shut takes it out of the tree", async () => {
    await fresh();
    key({ kind: "tab" }); key(char("b"));
    await until(() => !!B().links?.data, "the backlinks");
    const full = rect("preview").rows;
    expect(layout().sliding).toEqual(["backlinks"]);
    key(char("B"));
    expect(layout().sliding).toEqual([]);
    expect(rect("preview").rows).toBeLessThan(full);
    const readersBlock = layout().tree.kids[1];
    expect(readersBlock).toMatchObject({ split: "col", kids: [{ key: "readers" }, { pane: "backlinks" }] });
    key(char("B"));
    key({ kind: "esc" });
    expect(B().links).toBeNull();
    expect(layout().tree.kids[1].key).toBe("readers");
  });

  test("a border between readers drags by either edge, and the edge grabbed stays under the pointer", async () => {
    await withDetails();
    const p = rect("preview"), d = rect("detail0");
    drag(p.col + p.cols - 1, p.row + 4, p.col + p.cols - 1 + 9, p.row + 4);   // the preview's own right edge
    expect(rect("preview").col + rect("preview").cols - 1).toBe(p.col + p.cols - 1 + 9);
    expect(rect("detail0").col + rect("detail0").cols).toBe(d.col + d.cols);   // only the pair shares anew
    const d2 = rect("detail0");
    drag(d2.col, d2.row + 4, d2.col - 5, d2.row + 4);                          // the detail's left edge
    expect(rect("detail0").col).toBe(d2.col - 5);
    expect(state().readerWeights.length).toBe(3);
    expect(B().focus).toBe("lanes");                                          // a press on a border moves no focus
  });

  test("the lanes' border and a pinned drawer's border drag through the tree", async () => {
    await fresh();
    const lanesBottom = rect("preview").row;                          // the readers start under the lanes
    drag(20, lanesBottom, 20, lanesBottom + 6);
    expect(rect("preview").row).toBe(lanesBottom + 6);
    expect(state().laneFrac).toBeCloseTo((lanesBottom + 6) / 48, 1);
    key(char("T"));
    const tree = rect("split:tree");
    drag(tree.col, 10, tree.col + 12, 10);
    expect(rect("split:tree").col).toBe(tree.col + 12);
    expect(layout().tree.kids[0].share).toBeCloseTo((tree.col + 13) / 180, 2);
    key(char("T")); key(char("t"));
  });

  test("the sliding backlinks drawer drags only by its own top edge: the row above it is still the reader's", async () => {
    await fresh();
    key({ kind: "tab" }); key(char("b"));
    await until(() => !!B().links?.data, "the backlinks");
    const top = rect("split:links").row, before = layout().tree.kids[1].kids[1].share;
    b.render(B().ctx);
    mouse("down", 30, top - 1);
    expect(B().drag?.kind).not.toBe("border");
    mouse("up", 30, top - 1);
    drag(30, top, 30, top - 4);
    expect(rect("split:links").row).toBe(top - 4);
    expect(layout().tree.kids[1].kids[1].share).toBeGreaterThan(before);
    key({ kind: "esc" });
  });

  test("o floats a detail out of the tree and docks it back: the same pane, its note kept", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" });
    const d = B().details[0];
    key(char("o"));
    expect(row()).toEqual(["preview", "detail1"]);
    expect(layout().floats).toHaveLength(1);
    expect(B().floats[0].pane).toBe(d);
    expect(B().focus).toBe("float0");
    key(char("o"));
    expect(row()).toEqual(["preview", "detail1", "detail2"]);
    expect(B().details[1]).toBe(d);
    expect(B().focus).toBe("detail1");
    expect(layout().floats).toHaveLength(0);
  });

  test("the next board builds the same tree from delivery.json, and reads one written before PIE-412", async () => {
    await fresh();
    key(char("}")); key(char("T")); key(char("S")); key({ kind: "esc" });
    const before = { lanes: rect("split:lanes"), preview: rect("preview"), tree: layout().tree };
    await fresh(true);
    expect(layout().tree).toEqual(before.tree);
    expect(rect("preview")).toEqual(before.preview);
    expect(rect("split:lanes")).toEqual(before.lanes);
    // A file as an older door wrote it: the same fields, nothing else.
    writeFileSync(join(scratch.root, "door", "delivery.json"), JSON.stringify({ laneFrac: 0.3, previewFrac: 0.4, treeFrac: 0.25, linksFrac: 0.5, treeSide: "left", laneWeights: {}, readerWeights: [2, 3, 3], treePinned: true, linksPinned: true, lane: 0, collapsed: [], hubs: {}, collapsedReaders: [] }));
    await fresh(true);
    expect(layout().tree).toMatchObject({ split: "row", kids: [{ pane: "tree", share: 0.25 }, { key: "board", kids: [{ pane: "lanes", share: 0.3 }, {}] }] });
    expect(B().linksPinned).toBe(true);
    key(char("T")); key(char("t"));
  });

  test("agents resize, pin, float and close panes by pane.* actions, said on screen", async () => {
    await withDetails();
    expect(B().actions().actions.map((a: any) => a.name)).toEqual(expect.arrayContaining(["pane.split", "pane.close", "pane.resize", "pane.zoom", "pane.float", "pane.pin"]));
    const w = rect("detail1").cols;
    await act("pane.resize", { by: 2 }, "detail2");
    expect(rect("detail1").cols).toBeGreaterThan(w);
    expect(message()).toContain(`an agent (${AS}) grew detail2`);
    await act("pane.resize", { by: 1, axis: "col" }, "lanes");
    expect(layout().tree.kids[0].share).toBeCloseTo(0.47);
    await act("pane.pin", {}, "tree");
    expect(B().treePinned && B().treeOpen).toBe(true);
    expect(B().focus).toBe("lanes");                                   // opening it pinned moved no focus
    expect(message()).toContain("pinned tree");
    await act("pane.pin", { on: false }, "tree");
    await act("pane.close", {}, "tree");
    expect(B().treeOpen).toBe(false);
    await expect(act("pane.zoom", {}, "preview")).rejects.toThrow(/no zoom yet/);
    await expect(act("pane.split", {}, "preview")).rejects.toThrow(/reader=new-detail/);
    await expect(act("pane.close", {}, "preview")).rejects.toThrow(/stay on the board/);
    await expect(act("pane.resize", { by: 0 })).rejects.toThrow(/whole number/);
  });

  test("an agent never takes the person's pane: it can't close or float the focused one, and closing another keeps them on theirs", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" }); key({ kind: "tab" });
    expect(B().focus).toBe("detail1");
    const mine = B().details[1], other = B().details[0];
    await expect(act("pane.close", {}, "detail2")).rejects.toThrow(/has the person's keys/);
    await expect(act("pane.float", {}, "focused")).rejects.toThrow(/has the person's keys/);
    expect(B().details).toEqual([other, mine]);
    await act("pane.close", {}, "detail1");
    expect(B().details).toEqual([mine]);
    expect(B().focus).toBe("detail0");                                 // the same pane, now first in the row
    expect(B().details[B().active]).toBe(mine);
    // Floating the preview's copy leaves the person where they are too.
    await act("pane.float", {}, "preview");
    expect(B().floats).toHaveLength(1);
    expect(B().focus).toBe("detail0");
    await act("pane.close", {}, "float1");
    expect(B().floats).toHaveLength(0);
    expect(message()).toContain(`an agent (${AS}) closed float1`);
  });

  test("a note an agent opens in a new detail without the keys (a link it followed) replaces the detail the person doesn't have", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(B().focus).toBe("detail0");
    const mine = B().details[0], other = B().details[1];
    B().setCurrent(B().lanes[1].items[0], { from: B().preview, fresh: true, agent: true });
    expect(B().details).toContain(mine);
    expect(B().details).not.toContain(other);
    expect(row()).toEqual(["preview", "detail1", "detail2"]);
    expect(B().focus).toBe("detail0");
    expect(B().details[0]).toBe(mine);
  });

});

describe.skipIf(!outliner)("the desk's pane actions, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "desk-agent-412";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const saved = () => JSON.parse(readFileSync(join(scratch.root, "door", "desk.json"), "utf8"));

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("create", { parentId: null, text: "Orchard notes\nThe pears ripen late.", author: "agent" });
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    desk.render(D().ctx);
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("an agent splits, resizes, zooms and closes desk panes; the person's pane and keys stay theirs", async () => {
    expect(D().describe().layout).toMatchObject({ split: "row", kids: [{ pane: "1" }, { split: "row" }] });
    const focus = D().focus;
    const n = D().describe().panes.length;
    const r = await act("pane.split", { kind: "reader", dir: "col" }, "2") as any;
    expect(D().describe().panes.length).toBe(n + 1);
    expect(D().focus).toBe(focus);                                      // the new pane didn't take the keys
    expect(r).toMatchObject({ kind: "reader", beside: "2" });
    expect(saved().root.t).toBe("split");
    expect(JSON.stringify(saved())).not.toContain("kids");            // pairs stay in the binary form older doors read
    await act("pane.resize", { by: 2 }, "1");
    expect(D().describe().layout.share).toBe(1);
    await expect(act("pane.close", {}, "focused")).rejects.toThrow(/has the person's keys/);
    const focusedN = String(D().describe().panes.find((p: any) => p.focused).n);
    const other = focusedN === "3" ? "2" : "3";
    await expect(act("pane.zoom", {}, other)).rejects.toThrow(/would hide pane/);
    await act("pane.zoom", {}, focusedN);
    expect(D().zoom).toBe(D().focus);
    await act("pane.zoom", { on: false }, focusedN);
    expect(D().zoom).toBeNull();
    await act("pane.close", {}, r.pane);
    expect(D().describe().panes.length).toBe(n);
    await expect(act("pane.float", {}, "1")).rejects.toThrow(/no floats yet/);
    await expect(act("pane.pin", {}, "1")).rejects.toThrow(/no drawers/);
  });

  test("^W x closes by the same path as pane.close: down to the last pane, which stays", async () => {
    while (D().describe().panes.length > 1) { key({ kind: "char", ch: "w", ctrl: true } as Key); key(char("x")); }
    await expect(act("pane.close", {}, "1")).rejects.toThrow(/last pane stays/);
    key({ kind: "char", ch: "w", ctrl: true } as Key); key(char("x"));
    expect(D().describe().panes.length).toBe(1);
    expect(saved().root.t).toBe("leaf");
  });
});
