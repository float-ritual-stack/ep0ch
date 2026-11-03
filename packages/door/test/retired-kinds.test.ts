// PIE-1528: five tile kinds that were a second copy of another leave the code. A layout saved before (a desk.json
// holding a thread, tags, board, river and pinned tile) opens the same tiles under the kinds that serve them, and saves
// under the new names; tile.open with the old kinds still works, and ^W o #, k and v still open the tags, board and
// river. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { BacklinksPane } from "../src/desk/backlinks-pane";
import { Desk } from "../src/desk/desk";
import { FacetsPane } from "../src/desk/facets";
import { ReaderPane } from "../src/desk/panes";
import { ScreenTile } from "../src/desk/screen-tile";
import { openScreen } from "../src/desk/screen-specs";
import { canonSpec } from "../src/desk/tiles";
import { kindForKey, tileKind } from "../src/desk/tile-kinds";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

describe("canonSpec: the retired kinds read as the kinds that serve them", () => {
  test("thread, tags, board, river and pinned", () => {
    expect(canonSpec({ kind: "thread", name: "replies", source: "tile:reader" } as any)).toEqual({ kind: "backlinks", name: "replies", source: "tile:reader", linkGroups: "children" });
    expect(canonSpec({ kind: "thread", name: "r", subject: "held" } as any)).toMatchObject({ kind: "backlinks", linkGroups: "children", subject: "held" });
    expect(canonSpec({ kind: "tags", name: "tags", args: { share: 0.3 } } as any)).toEqual({ kind: "facets", name: "tags", args: { open: ["tag"], calendar: false, share: 0.3 } });
    // What a tags tile saved wins over the facet it opened on.
    expect(canonSpec({ kind: "tags", name: "tags", args: { open: ["tag", "plot"] } } as any).args).toEqual({ open: ["tag", "plot"], calendar: false });
    expect(canonSpec({ kind: "board", name: "board", preview: false } as any)).toEqual({ kind: "screen", name: "board", screen: "board", preview: false });
    expect(canonSpec({ kind: "river", name: "quay" } as any)).toEqual({ kind: "screen", name: "quay", screen: "river" });
    expect(canonSpec({ kind: "pinned", name: "pinned", page: "garden-now", label: "Garden · now" } as any)).toEqual({ kind: "reader", name: "pinned", mode: "pinned", page: "garden-now", label: "Garden · now" });
    // The names resolve in the registry too, so a check or a policy naming one finds the kind.
    expect(tileKind("thread")?.kind).toBe("backlinks");
    expect(tileKind("tags")?.kind).toBe("facets");
    expect(tileKind("board")?.kind).toBe("screen");
    expect(tileKind("river")?.kind).toBe("screen");
  });

  test("^W o #, k and v open the tags, the board and the river as before", () => {
    expect(kindForKey("#")).toMatchObject({ kind: { kind: "facets" }, key: { label: "tags" } });
    expect(kindForKey("#")!.key.spec!({ name: "x", pane: null as any })).toEqual({ args: { open: ["tag"], calendar: false } });
    expect(kindForKey("k")!.kind.kind).toBe("screen");
    expect(kindForKey("k")!.key.spec!({ name: "x", pane: null as any })).toEqual({ screen: "board" });
    expect(kindForKey("v")!.key.spec!({ name: "x", pane: null as any })).toEqual({ screen: "river" });
  });
});

describe.skipIf(!outliner)("a layout saved with the five retired kinds (PIE-1528)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let lamp: Msg, reply: Msg;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    lamp = await board.createBlock(null, "The lamp #porch\nIt flickers.");
    reply = await board.createBlock(lamp.id, "Swap the bulb");
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("each opens as the tile it was, and saves under its new kind", async () => {
    // The shape a desk.json had before the change: every leaf by its old kind.
    const desk = new Desk({ name: "old", title: "old", layout: { root: { t: "split", dir: "row", kids: [
      { t: "leaf", kind: "reader", name: "reader" },
      { t: "leaf", kind: "thread", name: "replies", source: "tile:reader" },
      { t: "leaf", kind: "tags", name: "tags", args: { share: 0.4, sort: "uses", open: ["tag"] } },
      { t: "split", dir: "col", kids: [{ t: "leaf", kind: "board", name: "board" }, { t: "leaf", kind: "river", name: "quay" }], weights: [0.5, 0.5] },
      { t: "leaf", kind: "pinned", name: "pinned", page: "garden-now", label: "Garden · now" },
    ], weights: [0.2, 0.2, 0.2, 0.2, 0.2] } as any } });
    app.push(desk);
    const D = desk as any;
    try {
      desk.render(D.ctx);
      // thread: the links tile with Children alone, following its reader.
      expect(desk.pane("replies")).toBeInstanceOf(BacklinksPane);
      (desk.pane("reader") as ReaderPane).hold(lamp, D);
      await until(() => (desk.pane("replies") as BacklinksPane).rows().some(r => JSON.stringify(r).includes(reply.id)), "the lamp's reply in the thread tile");
      // tags: the facets tile on the tags facet, with no calendar.
      const tags = desk.pane("tags") as FacetsPane;
      expect(tags).toBeInstanceOf(FacetsPane);
      expect(tags.calendar).toBe(false);
      await until(() => (tags.describe() as any).facets.find((f: any) => f.key === "tag")?.open === true, "the tags facet open");
      // board and river: the screen mount, on the board and the river.
      expect((desk.pane("board") as ScreenTile).mount.screen).toBe("board");
      expect((desk.pane("quay") as ScreenTile).mount.screen).toBe("river");
      // pinned: a reader pinned to its page, waiting for it to exist, then showing it.
      const pinned = desk.pane("pinned") as ReaderPane;
      expect(pinned).toBeInstanceOf(ReaderPane);
      expect(pinned.pinned).toBe(true);
      await until(() => pinned.pageMissing, "the page asked for");
      const page = await board.createBlock(null, "Garden now [page::garden-now]\nSow the peas.");
      await until(() => pinned.msg?.id === page.id, "the page, once it exists");
      // Saved: each under the kind that serves it, with what it was as its fields.
      const spec = (name: string) => D.specOf(D.idNamed(name));
      expect(spec("replies")).toMatchObject({ kind: "backlinks", linkGroups: "children", subject: "follows" });
      expect(spec("tags")).toMatchObject({ kind: "facets", args: { open: ["tag"], calendar: false } });
      expect(spec("board")).toMatchObject({ kind: "screen", screen: "board" });
      expect(spec("quay")).toMatchObject({ kind: "screen", screen: "river" });
      expect(spec("pinned")).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now", label: "Garden · now" });
    } finally { app.pop(); desk.dispose(); }
  }, 30_000);

  test("^W o # opens the facets tile on the tags, with no calendar; ^W o k and v the board and the river", async () => {
    const desk = new Desk({ name: "keys", title: "keys", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } });
    app.push(desk);
    const D = desk as any;
    try {
      desk.render(D.ctx);
      const press = async (ch: string) => { D.prefix = "add"; await D.command({ kind: "char", ch }); };
      await press("#");
      const f = [...D.panes.values()].find((p: unknown) => p instanceof FacetsPane) as FacetsPane;
      expect(f).toBeDefined();
      expect(f.calendar).toBe(false);
      await until(() => (f.describe() as any).facets.find((x: any) => x.key === "tag")?.open === true, "the tags facet open");
      await press("k");
      await press("v");
      const mounts = [...D.panes.values()].filter((p: unknown) => p instanceof ScreenTile).map((p: any) => p.mount.screen);
      expect(mounts).toEqual(expect.arrayContaining(["board", "river"]));
    } finally { app.pop(); desk.dispose(); }
  }, 30_000);

  test("tile.open kind=thread opens a links tile with Children alone (the command the old kind took)", async () => {
    const desk = new Desk({ name: "open-thread", title: "open-thread", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } });
    app.push(desk);
    const D = desk as any;
    try {
      desk.render(D.ctx);
      const r = await D.dispatch.act({ action: "tile.open", args: { kind: "thread", name: "replies", source: "tile:reader" }, tile: "reader" }, { kind: "user" });
      expect(r).toMatchObject({ name: "replies", kind: "backlinks" });
      expect(D.specOf(D.idNamed("replies"))).toMatchObject({ kind: "backlinks", linkGroups: "children" });
      (desk.pane("reader") as ReaderPane).hold(lamp, D);
      // Children alone, following the reader: the lamp's one reply, and no other group.
      // The fake terminal draws nothing by itself: draw as the screen would, so the opened tile starts.
      await until(() => { desk.render(D.ctx); return (desk.pane("replies") as BacklinksPane).target?.id === lamp.id && (desk.pane("replies") as any).describe().across?.children?.total === 1; }, "the lamp's reply in the opened thread tile");
      expect(Object.keys((desk.pane("replies") as any).describe().across)).toEqual(["children"]);
    } finally { app.pop(); desk.dispose(); }
  }, 30_000);

  test("a pinned page follows its address when [page::] moves to another note", async () => {
    const yesterday = await board.createBlock(null, "Monday [page::porch-today]\nSweep the porch.");
    const desk = new Desk({ name: "moved", title: "moved", layout: { root: { t: "leaf", kind: "reader", name: "today", mode: "pinned", page: "porch-today" } as any } });
    app.push(desk);
    const D = desk as any;
    try {
      desk.render(D.ctx);
      const r = desk.pane("today") as ReaderPane;
      await until(() => r.msg?.id === yesterday.id, "yesterday's note on the page");
      // The address moves: yesterday's note lets it go, today's takes it.
      const y = (await board.get(yesterday.id))!;
      await board.update(yesterday.id, y.text.replace(" [page::porch-today]", ""), y.revision!);
      const today = await board.createBlock(null, "Tuesday [page::porch-today]\nOil the hinge.");
      await until(() => r.msg?.id === today.id, "today's note, once the page moved to it");
      expect(D.specOf(D.idNamed("today"))).toMatchObject({ mode: "pinned", page: "porch-today" });
    } finally { app.pop(); desk.dispose(); }
  }, 30_000);

  test("screen.open name=pinned waits for its page in a pinned reader", async () => {
    const s = openScreen("pinned", { address: "porch-now", label: "Porch · now" }) as Desk;
    app.push(s);
    try {
      s.render((s as any).ctx);
      const r = s.pane("pinned") as ReaderPane;
      expect(r).toBeInstanceOf(ReaderPane);
      await until(() => r.pageMissing, "the page asked for");
      expect(s.render((s as any).ctx).lines.join("\n").replace(/\x1b\[[\d;]*[A-Za-z]/g, "")).toContain("No [[porch-now]] page on this outline yet.");
    } finally { app.pop(); s.dispose(); }
  }, 30_000);
});
