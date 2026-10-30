// PIE-1207, round two: opens into the readers on a desk never crush the other columns, never halve a pinned reader while
// a free one sits idle, and a pinned reader's hint row names the tile its opens go to. The desk: a tree wired to its
// reader, that reader, a second reader nothing feeds, and a column of replies over activity, each about a quarter.
// Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { OPEN_READS } from "../src/desk/screen-layout";
import { register } from "../src/desk/screen-notes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const leaf = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });

describe.skipIf(!outliner)("opens into the desk's readers keep every column readable", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const term = { info: { cols: 177, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
  const D = () => desk as any;
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.act({ action, args, tile }, { kind: "user" });
  const get = () => D().layoutGet() as { tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const names = () => get().tiles.map((t: any) => t.name as string);
  const pane = (name: string): ReaderPane => D().paneNamed(name);
  const message = () => (app as any).message as string;
  const notes: Record<string, any> = {};
  let n = 0;

  /** A fresh desk on the four-column layout, at `cols` wide. */
  const open = async (cols: number) => {
    if (desk) { app.pop(); D().dispose(); }
    term.info.cols = cols;
    const name = `room-${++n}`;
    register({
      name, title: name, id: `00000000-0000-4000-8000-00000000${String(1300 + n).padStart(4, "0")}`, revision: 1,
      spec: { name, title: name, layouts: true, layout: { focus: "tree", root: { t: "split", dir: "row", weights: [0.25, 0.25, 0.25, 0.25], kids: [
        leaf("tree", "tree", { wires: [{ verb: "select", to: "reader" }, { verb: "open", to: "reader" }] }), leaf("reader", "reader"), leaf("reader", "reader2"),
        { t: "split", dir: "col", weights: [0.58, 0.42], kids: [leaf("backlinks", "replies", { source: "tile:reader", linkGroups: "children", subject: "follows" }), leaf("activity", "activity")] },
      ] } } } as any,
    });
    desk = new Desk(undefined, { layout: name });
    app.push(desk);
    desk.render(D().ctx);
  };
  /** Every tile on the screen reads at OPEN_READS or wider, a spine excepted. */
  const unreadable = () => get().tiles.filter((t: any) => !t.collapsed && t.rect && (t.rect.cols < OPEN_READS.cols || t.rect.rows < OPEN_READS.rows)).map((t: any) => `${t.name} ${t.rect.cols}×${t.rect.rows}`);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = async (text: string) => (await board.get((await board.request<any>("create", { parentId: null, text, author: "agent" })).id))!;
    notes.shed = await mk("Bike shed\nThe door sticks in the rain.");
    notes.peas = await mk("Pea packet\nSow by the fence in March.");
    notes.rake = await mk("Rake handle\nSand it before the oil.");
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    D()?.dispose();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  for (const [cols, spines] of [[177, true], [120, false]] as const) test(`at ${cols} columns, a second search open into the reader nothing feeds ${spines ? "keeps a spine beside it" : "replaces, said once"} and crushes no column`, async () => {
    await open(cols);
    await mine("tile.focus", {}, "reader2");
    await mine("open", { id: notes.shed.id });
    expect(pane("reader2").msg?.id).toBe(notes.shed.id);
    await mine("tile.focus", {}, "reader2");
    await mine("open", { id: notes.peas.id });
    expect(pane("reader2").msg?.id).toBe(notes.peas.id);
    expect(unreadable()).toEqual([]);
    const spine = get().tiles.find((t: any) => t.collapsed);
    if (spines) {
      expect(spine?.showing.id).toBe(notes.shed.id);
      // The spine sits beside the reader it came from, not inside the replies and activity column.
      expect(spine.rect.col).toBe(tile("reader2").rect.col + tile("reader2").rect.cols);
      expect(message()).toContain("Bike shed kept as a spine");
    } else {
      // No room for a spine: the open replaced, said with it, the old note a step back.
      expect(spine).toBeUndefined();
      expect(message()).toContain("no room for a spine · alt← returns Bike shed");
      await mine("tile.focus", {}, "reader2");
      await mine("back", {}, "reader2");
      await until(() => pane("reader2").msg?.id === notes.shed.id, "back to the note it showed");
    }
  });

  test("an open aimed at a pinned reader uses the idle reader beside it before any split", async () => {
    await open(177);
    await mine("tile.focus", {}, "reader");
    await mine("open", { id: notes.shed.id }, undefined);
    await mine("reader.pin", { on: true }, "reader");
    const before = names().length;
    await mine("tile.focus", {}, "reader");
    await mine("open", { id: notes.peas.id });
    expect(pane("reader").msg?.id).toBe(notes.shed.id);
    expect(pane("reader2").msg?.id).toBe(notes.peas.id);
    expect(names().length).toBe(before);
    expect(tile("reader").rect.cols).toBeGreaterThanOrEqual(40);
    expect(message()).toContain("reader is pinned");
    expect(message()).toContain("reader2");
  });

  test("a pinned reader's hint row names the tile its opens go to, readable at 44 columns", async () => {
    await open(177);
    await mine("tile.focus", {}, "reader");
    await mine("open", { id: notes.rake.id });
    await mine("reader.pin", { on: true }, "reader");
    desk.render(D().ctx);
    const hint = pane("reader").hint();
    expect(hint.slice(0, 44)).toContain("pinned · opens → reader2 · p unpins");
    // With no idle reader on the screen, it says the open goes beside it.
    await mine("tile.focus", {}, "reader2");
    await mine("open", { id: notes.peas.id });
    await mine("reader.pin", { on: true }, "reader2");
    desk.render(D().ctx);
    expect(pane("reader").hint().slice(0, 44)).toContain("pinned · opens → beside it · p unpins");
  });
});
