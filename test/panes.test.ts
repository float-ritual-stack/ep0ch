// PIE-511: the board is a screen preset on the desk's one layout engine. Its lanes are query tiles in a columns
// container filled from the hub (the hub source); the outline and the backlinks are the desk's drawer containers;
// its floats are the desk's floats; its keys ({ } < > x o T B S alt+⏎), its border drags and the pane.* actions
// change that one tree; delivery.json keeps the board's layout. An agent's pane action is said on screen and never
// takes the person's tile or keys. Scratch services and fictional notes only.
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
/** A layout tree as describeTree gives it, without the ids (a board built again gives new ones). */
const shape = (t: unknown) => JSON.parse(JSON.stringify(t, (k, v) => (k === "id" ? undefined : v)));

describe.skipIf(!outliner)("the board on the desk's engine, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any, queued: any;
  let key: (k: Key) => void = () => {};
  const AS = "layout-agent-511";
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as = AS) => app.act({ action, args, reader, as });
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const message = () => (app as any).message as string;
  /** The tree as `peek` shows it: tiles by name, containers with their keys and shares. */
  const tree = () => B().describe().layout.tree;
  const rect = (name: string): Rect => { b.render(B().ctx); return B().rectsNow().get(B().idNamed(name)); };
  const focus = () => B().describe().focus as string;
  const state = () => JSON.parse(readFileSync(join(scratch.root, "door", "delivery.json"), "utf8"));
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const drag = (x0: number, y0: number, x1: number, y1: number) => { b.render(B().ctx); mouse("down", x0, y0); mouse("drag", x1, y1); mouse("up", x1, y1); };
  const whole = (p: ReaderPane) => until(() => !!p.msg && !p.msg.partial, "the whole note");
  const find = (n: any, key: string): any => (n.key === key ? n : [...(n.kids ?? []), ...(n.kid ? [n.kid] : [])].map((k: any) => find(k, key)).find(Boolean));
  /** The tiles in the readers row, by name. */
  // The preview sits in a tab set of one, the holder of its policy (PIE-510): its place stays, it doesn't close.
  const row = () => find(tree(), "readers").kids.map((k: any) => k.pane ?? (k.tabs?.length === 1 ? k.tabs[0] : k.tabs));
  const panesIn = (n: any): string[] => (n.pane ? [n.pane] : n.tabs ? n.tabs : [...(n.kids ?? []), ...(n.kid ? [n.kid] : [])].flatMap(panesIn));
  const lanesNode = () => find(tree(), "lanes");
  const details = () => B().details;
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
    await whole(details()[0]); await whole(details()[1]);
    key({ kind: "esc" });
    expect(focus()).toBe("lanes");
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Orchard board");
    queued = await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
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

  test("the board is one tree: the outline drawer, then the lanes' columns over the readers row, the backlinks drawer under them", async () => {
    await fresh();
    expect(shape(tree())).toMatchObject({
      split: "row", kids: [
        { drawer: "left", open: false, kid: { split: "col", key: "outline", policy: { draggable: false }, kids: [{ pane: "tree" }, { pane: "tree-preview" }] } },
        { split: "col", key: "board", kids: [
          { columns: `hub:${hub.id}`, key: "lanes", policy: { draggable: false, accepts: ["query"], opensInto: "preview" }, kids: [{ pane: "Doing" }, { pane: "Queued" }] },
          { split: "row", key: "readers", kids: [{ tabs: ["preview"], policy: { draggable: false, droppable: false, closable: false } }] },
          { drawer: "down", open: false, policy: { stays: true }, kid: { split: "row", key: "links", policy: { draggable: false }, kids: [{ pane: "backlinks" }, { pane: "backlinks-preview" }] } },
        ] },
      ],
    });
    // The lanes are query tiles, one per view under the hub, each with its own cursor.
    expect(B().layoutGet().tiles.filter((t: any) => t.kind === "query").map((t: any) => [t.name, t.view])).toEqual([["Doing", expect.any(String)], ["Queued", queued.id]]);
    await withDetails();
    expect(row()).toEqual(["preview", "detail1", "detail2"]);
    expect(rect("preview").cols + rect("detail1").cols + rect("detail2").cols).toBe(180);
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(focus()).toBe("detail1");
    const second = details()[1];
    key(char("x"));
    // The detail left keeps its name (PIE-491): an agent's detail2 is still that tile.
    expect(row()).toEqual(["preview", "detail2"]);
    expect(details()).toEqual([second]);
    expect(focus()).toBe("detail2");
    await expect(act("edit.close", { discard: true }, "detail1")).rejects.toThrow(/no reader detail1/);
  });

  test("{ } and < > change the tree's shares: the lanes' height, a lane's width in the columns, a reader's in the row", async () => {
    await withDetails();
    const lanesH = rect("preview").row;
    key(char("}"));
    expect(rect("preview").row).toBeGreaterThan(lanesH);
    key(char("{")); key(char("{"));
    expect(rect("preview").row).toBeLessThan(lanesH);
    const q = rect("Doing").cols;
    key(char(">"));
    expect(rect("Doing").cols).toBeGreaterThan(q);
    key({ kind: "tab" });                                              // the preview
    const w = rect("preview").cols;
    key(char(">")); key(char(">"));
    expect(rect("preview").cols).toBeGreaterThan(w);
    // The sizes are the layout's, kept in delivery.json with the rest of it.
    expect(shape(state().layout.root)).toMatchObject({ t: "split" });
  });

  test("t slides the outline drawer over (nothing moves); T pins it into the layout; S puts it on the other side; T and t put it away", async () => {
    await fresh();
    const col = rect("preview").col;
    key(char("t"));
    expect(B().describe().tree).toMatchObject({ open: true, pinned: false, side: "left" });
    expect(focus()).toBe("tree");
    expect(rect("preview").col).toBe(col);
    key(char("T"));
    expect(B().describe().tree).toMatchObject({ open: true, pinned: true });
    expect(rect("preview").col).toBe(54);                              // the readers make room
    key(char("S"));
    expect(B().describe().tree).toMatchObject({ pinned: true, side: "right" });
    expect(rect("preview").col).toBe(0);
    key(char("T"));
    expect(B().describe().tree).toMatchObject({ pinned: false, side: "right" });
    expect(JSON.stringify(state().layout.root)).toContain(`"t":"drawer","edge":"right"`);
    key(char("t"));
    expect(B().describe().tree.open).toBe(false);
  });

  test("b slides the backlinks drawer up on a reader's note and it stays while the keys go elsewhere; B pins it; esc shuts it", async () => {
    await fresh();
    key({ kind: "tab" }); key(char("b"));
    await until(() => !!B().linksTile.data, "the backlinks");
    expect(focus()).toBe("backlinks");
    const full = rect("preview").rows;
    key({ kind: "tab" });
    expect(B().describe().backlinks).toMatchObject({ from: "preview", pinned: false });   // it stays (policy: stays)
    key({ kind: "tab" });
    key(char("B"));
    expect(B().describe().backlinks.pinned).toBe(true);
    expect(rect("preview").rows).toBeLessThan(full);
    key(char("B"));
    expect(B().describe().backlinks.pinned).toBe(false);
    while (focus() !== "backlinks") key({ kind: "tab" });
    key({ kind: "esc" });
    expect(B().describe().backlinks).toBeNull();
    expect(rect("preview").rows).toBe(full);
  });

  test("borders drag through the one tree: between lanes (the columns'), between readers, under the lanes", async () => {
    await withDetails();
    const q = rect("Doing"), d = rect("Queued");
    drag(q.col + q.cols - 1, 5, q.col + q.cols + 9, 5);
    expect(rect("Doing").cols).toBe(q.cols + 10);
    expect(rect("Queued").col + rect("Queued").cols).toBe(d.col + d.cols);
    const p = rect("preview");
    drag(p.col + p.cols - 1, p.row + 4, p.col + p.cols + 8, p.row + 4);
    expect(rect("preview").cols).toBe(p.cols + 9);
    // The readers' top edge: the bare line after a header's title (the title itself is the grip that moves a tile).
    const top = rect("preview").row, x = rect("preview").col + rect("preview").cols - 4;
    drag(x, top, x, top + 4);
    expect(rect("preview").row).toBe(top + 4);
    expect(focus()).toBe("lanes");                                     // a press on a border moves no focus
  });

  test("o floats a detail out of the tree and docks it back: the same tile, its name and note kept", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" });
    const d = details()[0];
    key(char("o"));
    expect(row()).toEqual(["preview", "detail2"]);
    expect(B().describe().floats).toEqual([expect.objectContaining({ reader: "detail1" })]);
    expect(focus()).toBe("detail1");
    // Its title moves it, as H J K L do (float.place, the desk's).
    const f = B().describe().floats[0].rect;
    drag(f.col + 6, f.row, f.col + 16, f.row + 2);
    expect(B().describe().floats[0].rect).toMatchObject({ col: f.col + 10, row: f.row + 2 });
    key(char("H"));
    expect(B().describe().floats[0].rect.col).toBe(f.col + 6);
    key(char("o"));
    expect(row()).toEqual(["preview", "detail2", "detail1"]);
    expect(details()[1]).toBe(d);
    expect(focus()).toBe("detail1");
    expect(B().describe().floats).toHaveLength(0);
  });

  test("a float docks only where the board's containers take it: refused with why, and no detail closed for it", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" });
    key(char("o"));
    expect(B().describe().floats).toHaveLength(1);
    // Both details were open: docking would close one to take its place. A screen that takes only query tiles refuses
    // first, so nothing closes; the person's o says why.
    // A second detail docked beside the first: now docking the float would close one.
    key({ kind: "esc" });
    expect(focus()).toBe("lanes");
    key(char("j")); key({ kind: "alt-enter" });
    await until(() => row().length === 3, "two details docked");
    key({ kind: "esc" });
    while (focus() !== "detail1") key({ kind: "tab" });
    await act("layout.policy", { node: "screen", accepts: "query" });
    const before = row();
    key(char("o"));
    expect(message()).toMatch(/takes only query: not detail1/);
    expect(row()).toEqual(before);
    expect(B().describe().floats).toHaveLength(1);
    await act("layout.policy", { node: "screen", clear: "accepts" });
    key(char("o"));
    expect(B().describe().floats).toHaveLength(0);
  });

  test("the next board builds the same tree from delivery.json; a file from before PIE-511 keeps the board's shape where the preset has a home for it", async () => {
    await fresh();
    key(char("}")); key(char("T")); key(char("S")); key({ kind: "esc" });
    const before = shape(tree()), preview = rect("preview");
    await fresh(true);
    expect(shape(tree())).toEqual(before);
    expect(rect("preview")).toEqual(preview);
    // A file as the board wrote it before it was a preset (6d3f0f6): sizes as shares, drawers pinned or not, lanes by name.
    writeFileSync(join(scratch.root, "door", "delivery.json"), JSON.stringify({
      laneFrac: 0.3, previewFrac: 0.4, treeFrac: 0.25, linksFrac: 0.45, treeSide: "right", laneWeights: { Doing: 2.5 }, readerWeights: [4, 3, 3],
      treePinned: true, linksPinned: false, lane: 1, collapsed: ["Queued"], collapsedReaders: [], hubs: { [B().ctx.workspace]: hub.id },
    }));
    if ((app as any).stack.at(-1) instanceof DeliveryBoard) app.pop();
    b = new DeliveryBoard(hub.id); app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items?.length), "the lanes", 10_000);
    // The outline on the right, pinned (docked), at its width; the lanes at their share of the board.
    expect(B().describe().tree).toMatchObject({ open: true, pinned: true, side: "right" });
    const t = tree();
    expect(panesIn(t.kids.at(-1))).toEqual(["tree", "tree-preview"]);
    expect(t.kids.at(-1).share).toBeCloseTo(0.25, 2);
    expect(find(t, "board").kids[0].share / (find(t, "board").kids[0].share + find(t, "board").kids[1].share)).toBeCloseTo(0.3, 2);
    // The lanes: Doing at its weight, Queued folded to a spine, the cursor on the second lane.
    const lanes = lanesNode().kids;
    const doing = lanes.find((k: any) => k.pane === "Doing"), queuedLane = lanes.find((k: any) => k.pane === "Queued");
    expect(doing.share / queuedLane.share).toBeCloseTo(2.5, 1);
    expect(B().layoutGet().tiles.find((x: any) => x.name === "Queued").collapsed).toBe(true);
    expect(B().describe().lanes.find((l: any) => l.focused)?.name).toBe(B().lanes[1].name);
    // The next save writes the new shape: the old fields are gone.
    await act("tile.collapse", { on: false }, "Queued");
    const saved = state();
    expect(saved.layout).toBeDefined();
    for (const k of ["laneFrac", "treeFrac", "laneWeights", "treePinned", "collapsed"]) expect(saved[k]).toBeUndefined();
  });

  test("agents resize, pin, float, zoom and close tiles by pane.* actions, said on screen", async () => {
    await withDetails();
    const listed = B().actions().actions as { name: string; aliases?: string[] }[];
    expect(listed.map(a => a.name)).toEqual(expect.arrayContaining(["pane.split", "tile.close", "tile.resize", "tile.zoom", "tile.float", "tile.pin", "tile.collapse", "float.place"]));
    // The older pane.* names are aliases: listed once, with the tile action they run (A4, PIE-510).
    const aliasOf = (n: string) => listed.find(a => a.aliases?.includes(n))?.name;
    expect(["pane.close", "pane.resize", "pane.zoom", "pane.float", "pane.pin"].map(aliasOf)).toEqual(["tile.close", "tile.resize", "tile.zoom", "tile.float", "tile.pin"]);
    expect(listed.filter(a => a.name.startsWith("pane.")).map(a => a.name)).toEqual(["pane.split"]);
    const w = rect("detail2").cols;
    await act("pane.resize", { by: 2 }, "detail2");
    expect(rect("detail2").cols).toBeGreaterThan(w);
    expect(message()).toContain(`an agent (${AS})`);
    const top = rect("preview").row;
    await act("pane.resize", { by: 1, axis: "col" }, "lanes");
    expect(rect("preview").row).toBeGreaterThan(top);
    await act("pane.pin", {}, "tree");
    expect(B().describe().tree).toMatchObject({ open: true, pinned: true });
    expect(focus()).toBe("lanes");                                   // opening it pinned moved no focus
    await act("pane.pin", { on: false }, "tree");
    await act("pane.close", {}, "tree");
    expect(B().describe().tree.open).toBe(false);
    // The board is on the desk's engine: zoom is the desk's (an agent's never hides the person's tile).
    await expect(act("pane.zoom", {}, "detail2")).rejects.toThrow(/would hide/);
    await expect(act("pane.close", {}, "preview")).rejects.toThrow(/preview stays: .*closable off/);
    await expect(act("pane.resize", { by: 0 })).rejects.toThrow(/whole number/);
  });

  test("an agent never takes the person's tile: it can't close or float the focused one, and closing another keeps them on theirs", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" }); key({ kind: "tab" });
    expect(focus()).toBe("detail2");
    const mine = details()[1], other = details()[0];
    await expect(act("pane.close", {}, "detail2")).rejects.toThrow(/has the person's keys/);
    await expect(act("pane.float", {}, "focused")).rejects.toThrow(/has the person's keys/);
    expect(details()).toEqual([other, mine]);
    await act("pane.close", {}, "detail1");
    expect(details()).toEqual([mine]);
    expect(focus()).toBe("detail2");
    // Floating the preview's copy leaves the person where they are too.
    const f = await act("pane.float", {}, "preview") as any;
    expect(B().describe().floats).toHaveLength(1);
    expect(focus()).toBe("detail2");
    await act("pane.close", {}, f.now);
    expect(B().describe().floats).toHaveLength(0);
    expect(message()).toContain(`an agent (${AS}) closed ${f.now}`);
  });

  test("review: an agent's quiet open never replaces the person's focused detail, even when it's the only one free", async () => {
    await withDetails();
    await act("edit.text", { text: "Prune the apples [stage::queued]\nAn agent's draft." }, "detail2");
    await until(() => !!details()[1].draft, "the agent's draft");
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(focus()).toBe("detail1");
    const mine = details()[0], held = details()[1];
    B().setCurrent(B().lanes[1].items[0], { from: B().preview, fresh: true, agent: true });
    expect(details()).toEqual([mine, held]);
    expect(focus()).toBe("detail1");
    expect(message()).toContain("not opened");
    await act("edit.close", { discard: true }, "detail2");
  });

  test("a note an agent opens in a new detail without the keys (a link it followed) replaces the detail the person doesn't have", async () => {
    await withDetails();
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(focus()).toBe("detail1");
    const mine = details()[0], other = details()[1];
    B().setCurrent(B().lanes[1].items[0], { from: B().preview, fresh: true, agent: true });
    expect(details()).toContain(mine);
    expect(details()).not.toContain(other);
    expect(row()).toEqual(["preview", "detail1", "detail3"]);                // the new detail's name is new
    expect(focus()).toBe("detail1");
  });

  test("interchangeable, subject to policy: a lane leaves the columns only once they let it; a desk tile goes beside them, not in", async () => {
    await fresh();
    // The lanes keep their tiles (draggable off): a header drag and layout.move are refused, and say why.
    await expect(act("layout.move", { to: "preview", where: "right" }, "Doing")).rejects.toThrow(/keeps its tiles \(draggable off\)/);
    // Only query tiles join the columns; another kind goes beside them.
    await expect(act("tile.open", { kind: "activity", to: "Doing", where: "right" })).rejects.toThrow(/takes only query/);
    const opened = await act("tile.open", { kind: "activity", name: "recent", where: "edge-right" }) as any;
    expect(opened).toMatchObject({ tile: "recent" });
    await act("tile.close", {}, "recent");
    // Let them go, and the lane moves beside the preview: still a lane of the board, refilled where it is.
    const cid = lanesNode().id ?? B().lanesNode().id;
    await act("layout.policy", { node: cid, draggable: true });
    await act("layout.move", { to: "preview", where: "right" }, "Doing");
    expect(panesIn(find(tree(), "readers"))).toEqual(["preview", "Doing"]);
    expect(B().lanes.map((l: any) => l.name)).toEqual(["Queued", "Doing"]);
    await B().fillColumns();
    expect(panesIn(find(tree(), "readers"))).toEqual(["preview", "Doing"]);
    const card = B().lanes[0].items[0].id;
    await act("card.move", { lane: "Doing", card });
    await until(() => B().lanes[1].items?.some((m: any) => m.id === card), "the card in Doing");
  });

  test("review: a delivery.json whose layout is broken, of the wrong type or missing pieces gives the board as it first opens", async () => {
    for (const layout of [{ root: { t: "split", dir: "row", kids: "x", weights: null } }, { root: { t: "leaf", kind: "tree", name: "tree" } }, "wide", { root: null }]) {
      writeFileSync(join(scratch.root, "door", "delivery.json"), JSON.stringify({ hubs: {}, layout }));
      await fresh(true);
      expect(shape(tree())).toMatchObject({ split: "row", kids: [{ drawer: "left" }, { key: "board", kids: [{ key: "lanes" }, { key: "readers" }, { drawer: "down" }] }] });
      for (const r of ["preview", "Doing"].map(rect)) for (const v of Object.values(r)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    }
  });

  test("review: a drawer docked when the board was saved slides as before when it's put back (B, a restart, B)", async () => {
    await fresh();
    key({ kind: "tab" }); key(char("b"));
    await until(() => !!B().linksTile.data, "the backlinks");
    key(char("B"));
    expect(B().describe().backlinks.pinned).toBe(true);
    await fresh(true);                                                  // the next board, the backlinks docked
    expect(B().linksPinned).toBe(true);
    await act("pane.pin", { on: false }, "backlinks", "you");
    const down = (n: any): any => (n.drawer === "down" ? n : [...(n.kids ?? []), ...(n.kid ? [n.kid] : [])].map(down).find(Boolean));
    expect(down(B().layoutGet().tree)).toMatchObject({ drawer: "down", policy: { stays: true } });
    await act("pane.close", {}, "backlinks", "you");
  });

  test("review: a click inside a sliding drawer is the drawer's, even over a border hidden under it", async () => {
    await withDetails();
    key(char("t"));                                                    // the outline slides over the lanes' border
    const tr = rect("tree"), border = rect("preview").row;
    expect(border).toBeLessThan(tr.row + tr.rows - 1);
    const before = shape(tree());
    b.render(B().ctx);
    mouse("down", tr.col + 5, border); mouse("drag", tr.col + 5, border + 4); mouse("up", tr.col + 5, border + 4);
    expect(shape(tree())).toEqual(before);                            // not the lanes' border under it
    expect(focus()).toBe("tree");
    key({ kind: "esc" });
  });

  test("review: the sliding backlinks drawer drags only by its own top edge: the row above it is still the reader's", async () => {
    await fresh();
    key({ kind: "tab" }); key(char("b"));
    await until(() => !!B().linksTile.data, "the backlinks");
    const top = rect("backlinks").row, x = rect("backlinks").col + rect("backlinks").cols - 4;
    drag(x, top - 1, x, top - 5);                                      // the preview's own row: nothing moves
    expect(rect("backlinks").row).toBe(top);
    drag(x, top, x, top - 4);                                          // its own top edge
    expect(rect("backlinks").row).toBe(top - 4);
    while (focus() !== "backlinks") key({ kind: "tab" });
    key({ kind: "esc" });
  });

  test("review: ^W x and tile.close leave the board's own tiles: a lane and the preview stay, a drawer's list shuts its drawer", async () => {
    await fresh();
    const W = () => key({ kind: "char", ch: "w", ctrl: true } as Key);
    W(); key(char("x"));                                                // on a lane
    expect(B().lanes.length).toBe(2);
    expect(message()).toMatch(/Doing stays: hub:\S+ supplies it/);
    await expect(act("tile.close", {}, "preview")).rejects.toThrow(/preview stays/);
    key(char("t"));
    W(); key(char("x"));                                                // in the outline: it shuts
    expect(B().describe().tree.open).toBe(false);
    expect(B().idNamed("tree")).toBeDefined();
    b.render(B().ctx);                                                  // and the board still draws
  });

  test("review: a query tile the person drops into the lanes stays through a refill; a detail moved anywhere isn't saved", async () => {
    await fresh();
    const other = await create(null, "Odd jobs [type::virtual-branch] [query::stage=someday]");   // a view under no hub
    await act("tile.open", { kind: "query", view: other.id, name: "odd", to: "Queued", where: "right" });
    await B().fillColumns();
    expect(panesIn(lanesNode())).toEqual(["Doing", "Queued", "odd"]);
    key({ kind: "enter" }); key({ kind: "esc" });                       // a detail
    await act("layout.move", { to: "Doing", where: "edge-right" }, "detail1");
    b.render(B().ctx);
    expect(JSON.stringify(state().layout)).not.toContain(`"kind":"detail"`);
    await act("tile.close", {}, "odd");
  });

  test("review: tile.collapse folds only a tile side by side with others, where policy lets it, never the person's tile for an agent", async () => {
    await withDetails();
    await expect(act("tile.collapse", {}, "lanes")).rejects.toThrow(/has the person's keys/);
    expect(await act("tile.collapse", {}, "detail2")).toMatchObject({ tile: "detail2", collapsed: true });
    await act("tile.collapse", { on: false }, "detail2");
    await expect(act("tile.collapse", {}, "tree")).rejects.toThrow(/isn't side by side/);
    const cid = B().lanesNode().id;
    await act("layout.policy", { node: cid, collapsible: false });
    await expect(act("lane.collapse", { lane: "Queued" })).rejects.toThrow(/collapsible off/);
    await act("layout.policy", { node: cid, clear: "collapsible" });
    // stays: the backlinks drawer's, set and read as any policy field.
    expect(await act("layout.policy", {}, "backlinks")).toMatchObject({ effective: expect.any(Object) });
    const d = B().layoutGet().tree.kids[1].kids[2];
    expect(d).toMatchObject({ drawer: "down", policy: { stays: true } });
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
    board.subscribe(e => app.event(e));
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
    // Normalised (PIE-413): the desk's nested rows are one row of three, the last a column.
    expect(D().describe().layout).toMatchObject({ split: "row", kids: [{ pane: "1" }, { pane: "2" }, { split: "col" }] });
    const focus = D().focus;
    const n = D().describe().panes.length;
    const r = await act("pane.split", { kind: "reader", dir: "col" }, "2") as any;
    expect(D().describe().panes.length).toBe(n + 1);
    expect(D().focus).toBe(focus);                                      // the new pane didn't take the keys
    expect(r).toMatchObject({ kind: "reader", beside: "2" });
    expect(saved().root.t).toBe("split");
    expect(JSON.stringify(saved())).toContain(`"ratio"`);             // pairs stay in the binary form older doors read
    await act("pane.resize", { by: 2 }, "1");
    expect(D().describe().layout.share).toBe(1);
    await expect(act("pane.close", {}, "focused")).rejects.toThrow(/has the person's keys/);
    const focusedN = String(D().describe().panes.find((p: any) => p.focused).n);
    const other = focusedN === "3" ? "2" : "3";
    await expect(act("pane.zoom", {}, other)).rejects.toThrow(/would hide tile/);
    await act("pane.zoom", {}, focusedN);
    expect(D().zoom).toBe(D().focus);
    await act("pane.zoom", { on: false }, focusedN);
    expect(D().zoom).toBeNull();
    await act("pane.close", {}, r.pane);
    expect(D().describe().panes.length).toBe(n);
    // A float (PIE-511): the tile out of the tree with its own rectangle, then docked back beside the person's tile.
    const fl = await act("pane.float", {}, "1") as any;
    expect(fl).toMatchObject({ floated: true });
    expect(D().layoutGet().floats).toEqual([expect.objectContaining({ tile: fl.now })]);
    expect(saved().floats).toEqual([expect.objectContaining({ tile: expect.objectContaining({ name: fl.now }) })]);
    await act("float.place", { dx: 3, cols: 50 }, fl.now);
    expect(D().layoutGet().floats[0].rect.cols).toBe(50);
    expect(await act("pane.float", {}, fl.now)).toMatchObject({ floated: false });
    expect(D().layoutGet().floats).toEqual([]);
    // Any tile slides over as a drawer now (PIE-413): pane.pin is tile.pin.
    expect(await act("pane.pin", { on: false }, "1")).toMatchObject({ pinned: false });
    await act("pane.pin", { on: true }, "1");
  });

  test("a query tile on the desk (PIE-511): a saved view's cards with its own cursor, followed by a preview, refreshed as the outline changes", async () => {
    const hub = await board.request<any>("create", { parentId: null, text: "Shed jobs", author: "agent" });
    const view = await board.request<any>("create", { parentId: hub.id, text: "Open [type::virtual-branch] [query::shed=open]", author: "agent" });
    const a = await board.request<any>("create", { parentId: null, text: "Oil the mower [shed::open]", author: "agent" });
    await board.request<any>("create", { parentId: null, text: "Sharpen the shears [shed::open]", author: "agent" });
    const t = await act("tile.open", { kind: "query", view: view.id, name: "shed", where: "right" }) as any;
    expect(t).toMatchObject({ tile: "shed", kind: "query" });
    await until(() => D().describe().panes.find((p: any) => p.name === "shed")?.count === 2, "the view's cards");
    expect(D().describe().panes.find((p: any) => p.name === "shed")).toMatchObject({ lane: "Open", view: view.id });
    await act("tile.open", { kind: "preview", source: "tile:shed", name: "shed-card" }, "shed");
    await act("query.pick", { n: 2 }, "shed");                         // an agent's pick: its own, the cursor stays
    expect(D().describe().panes.find((p: any) => p.name === "shed").selected.title).toBe("Oil the mower");
    await act("query.pick", { id: a.id }, "shed");
    // The person's pick moves the cursor, and the preview following the tile shows the card.
    D().focusTile("shed", { kind: "person" } as any);
    key(char("j"));
    await until(() => D().describe().panes.find((p: any) => p.name === "shed-card")?.showing?.title === "Sharpen the shears", "the preview on the card");
    // A card added that the view lists: the tile reads it again by itself on a desk.
    await board.request<any>("create", { parentId: null, text: "Mend the hose [shed::open]", author: "agent" });
    await until(() => D().describe().panes.find((p: any) => p.name === "shed")?.count === 3, "the new card listed");
    await expect(act("tile.open", { kind: "query" })).rejects.toThrow(/needs view=/);
    D().focusTile("1", { kind: "person" } as any);
    await act("tile.close", {}, "shed-card"); await act("tile.close", {}, "shed");
  }, 20_000);

  test("^W c folds the tile to a spine and opens it; ^W f floats it and docks it: the keys run tile.collapse and pane.float", async () => {
    const W = () => key({ kind: "char", ch: "w", ctrl: true } as Key);
    const me = () => D().describe().panes.find((p: any) => p.focused);
    D().focusTile("1", { kind: "person" } as any);
    W(); key(char("c"));
    expect(me()).toMatchObject({ collapsed: true });
    expect(D().layoutGet().tree).toBeTruthy();
    key({ kind: "enter" });                                            // ⏎ on a spine opens it
    expect(me().collapsed).toBeUndefined();
    W(); key(char("f"));
    expect(D().layoutGet().floats).toEqual([expect.objectContaining({ tile: me().name })]);
    W(); key(char("f"));
    expect(D().layoutGet().floats).toEqual([]);
  });

  test("^W x closes by the same path as pane.close: down to the last pane, which stays", async () => {
    while (D().describe().panes.length > 1) { key({ kind: "char", ch: "w", ctrl: true } as Key); key(char("x")); }
    await expect(act("pane.close", {}, "1")).rejects.toThrow(/last tile stays/);
    key({ kind: "char", ch: "w", ctrl: true } as Key); key(char("x"));
    expect(D().describe().panes.length).toBe(1);
    expect(saved().root.t).toBe("leaf");
  });
});
