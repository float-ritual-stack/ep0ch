// PIE-1426: Back in any tile goes to what that tile showed before, whichever tile or key changed it. Evan's layout: a
// detail up top whose opens and selection are wired to a preview below, a links tile beside the preview whose
// selection shows there too. The preview changed from the links tile, from a link in the detail and after `b` steps
// back through each in order; the links tile's own subject, changed by `b`, steps back too. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { BacklinksPane } from "../src/desk/backlinks-pane";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import { historyRow } from "../src/surface/note";
const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");

const leaf = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });
const char = (ch: string): Key => ({ kind: "char", ch } as Key);

test("a narrow reader's back row drops the title, then the words, never cutting back or forward short", () => {
  for (let w = 8; w <= 44; w++) {
    const row = historyRow(w, "Paint the potting shed", "Weekend jobs")!;
    const text = plain(row.line);
    expect(text).toContain("←");
    expect(text).toContain("→");
    expect(text).not.toMatch(/← ba?c?k?…|f?o?r?w?a?r?d?… →|…→/);
    expect(row.hits.map(h => h.dir)).toEqual(w >= 40 ? [-1, 0, 1] : [-1, 1]);
  }
  expect(plain(historyRow(20, "Paint the potting shed", null)!.line)).toContain("← back · Paint");
});

describe.skipIf(!outliner)("Back goes back in every tile, whichever tile changed it (PIE-1426)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const n: Record<string, any> = {};
  const D = () => desk as any;
  const render = () => desk.render(D().ctx).lines;
  const pane = (name: string): any => [...D().panes.entries()].find(([id]: any) => D().nameOf(id) === name)?.[1];
  const r = (name: string) => pane(name) as ReaderPane;
  const L = () => pane("links") as BacklinksPane;
  const mine = (action: string, args: Record<string, unknown>, tile: string) => D().dispatch.act({ action, args, tile }, { kind: "user" });
  const whole = (name: string, id: string) => until(() => r(name).msg?.id === id && !r(name).msg?.partial, `${name} shows ${id.slice(0, 8)}`);
  /** The links tile's row that opens `id` (a backlink's source or an outlink's target), 1-based as list.pick takes it. */
  const rowOf = (id: string) => {
    const i = L().rows().findIndex((row: any) => (row.kind === "backlink" && row.source.blockId === id) || (row.kind === "outlink" && row.link.target?.blockId === id) || (row.kind === "outlink" && (row.link as any).blockId === id));
    if (i < 0) throw new Error(`no row for ${id.slice(0, 8)} in ${JSON.stringify(L().rows().map((x: any) => x.kind))}`);
    return i + 1;
  };
  const backTitles = (name: string) => r(name).surface.describeHistory().back.map((s: any) => s.title ?? s);

  /** Evan's layout, fresh: the detail on the hub, its links listed beside the preview. */
  const build = async () => {
    if (desk) { D().dispose(); app.pop(); }
    desk = new Desk({ name: "evan", title: "evan", layout: { focus: "detail", root: { t: "split", dir: "column", weights: [0.5, 0.5], kids: [
      leaf("reader", "detail", { mode: "held", note: n.hub.id, wires: [{ verb: "open", to: "preview" }, { verb: "select", to: "preview" }] }),
      { t: "split", dir: "row", weights: [0.5, 0.5], kids: [
        leaf("backlinks", "links", { source: "tile:detail", groups: "open", wires: [{ verb: "select", to: "preview" }, { verb: "open", to: "preview" }] }),
        leaf("preview", "preview"),
      ] },
    ] } } } as any);
    app.push(desk);
    render();
    await whole("detail", n.hub.id);
    await until(() => L().target?.id === n.hub.id && !!L().data && L().rows().some((row: any) => row.kind === "backlink"), "the links tile lists the hub's links");
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.beans = await board.createBlock(null, "Stake the beans\nCanes along the fence.");
    n.shed = await board.createBlock(null, "Paint the shed\nTwo coats, green.");
    n.hub = await board.createBlock(null, `Weekend jobs\nFirst ((${n.beans.id})), then ((${n.shed.id})).`);
    n.seeds = await board.createBlock(null, `Seed order\nFor ((${n.hub.id})).`);
    n.rain = await board.createBlock(null, `Rain gauge\nCheck before ((${n.hub.id})).`);
    n.canes = await board.createBlock(null, `Bamboo canes\nBought for ((${n.beans.id})).`);
    const term = { info: { cols: 177, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    await build();
  }, 30_000);
  test("a walk through the list with j or k is one stop: Back goes to what the preview showed before it", async () => {
    await build();
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.seeds.id) }, "links");
    await whole("preview", n.seeds.id);
    await Bun.sleep(1200);                                              // a pick, then a pause: the walk starts after it
    const before = backTitles("preview").length;
    for (let i = 0; i < 4; i++) { key({ kind: "char", ch: "k" } as Key); await Bun.sleep(80); }
    await until(() => r("preview").msg?.id !== n.seeds.id, "the walk moved the preview");
    expect(backTitles("preview")).toHaveLength(before + 1);
    expect(backTitles("preview")[0]).toBe("Seed order");
    await mine("back", {}, "preview");
    await whole("preview", n.seeds.id);
  }, 30_000);

  test("giving the links tile the keys leaves the preview, and its forward, as they were", async () => {
    await build();
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.seeds.id) }, "links");
    await whole("preview", n.seeds.id);
    await Bun.sleep(1200);
    await mine("list.pick", { n: rowOf(n.rain.id) }, "links");
    await whole("preview", n.rain.id);
    await mine("tile.focus", {}, "preview");
    await mine("back", {}, "preview");
    await whole("preview", n.seeds.id);
    // Tab (or a click) into the list: focus alone changes nothing it shows elsewhere.
    await mine("tile.focus", {}, "links");
    key({ kind: "tab" } as Key); key({ kind: "backtab" } as Key);
    await Bun.sleep(300);
    expect(r("preview").msg?.id).toBe(n.seeds.id);
    expect(r("preview").surface.describeHistory().forward.map((s: any) => s.title)).toEqual(["Rain gauge"]);
  }, 30_000);

  test("forward onto the detail's own note shows it in the preview: the layout and the wires stay", async () => {
    await build();
    const tiles = () => (D().layoutAll().tiles as any[]).map(t => t.name).sort();
    const wires = () => JSON.stringify({ tree: D().layout.tree, wires: D().layout.wires });
    const before = { tiles: tiles(), wires: wires() };
    // A pick of the shed up top shows it in the preview; b there lists the shed's links, whose first pick is the hub.
    await mine("tile.focus", {}, "detail");
    for (let i = 0; i < 20 && !String(r("detail").surface.describe().elements?.current?.label ?? "").startsWith("Paint the shed"); i++) { key(char("]")); render(); }
    key({ kind: "enter" } as Key);
    await whole("preview", n.shed.id);
    await mine("tile.focus", {}, "preview");
    key(char("b"));
    await until(() => L().target?.id === n.shed.id && !!L().data, "the links tile lists the shed's links");
    await whole("preview", n.hub.id);
    await mine("tile.focus", {}, "preview");
    key({ kind: "alt-left" } as Key);
    await whole("preview", n.shed.id);
    key({ kind: "alt-right" } as Key);
    await whole("preview", n.hub.id);
    render();
    expect(tiles()).toEqual(before.tiles);
    expect(wires()).toBe(before.wires);
    expect(D().nameOf(D().focus)).toBe("preview");
    // Held (p), the same: back onto the shed, forward onto the hub, and the preview stays where it is.
    key(char("p"));
    key({ kind: "alt-left" } as Key);
    await whole("preview", n.shed.id);
    key({ kind: "alt-right" } as Key);
    await whole("preview", n.hub.id);
    render();
    expect(tiles()).toEqual(before.tiles);
    expect(wires()).toBe(before.wires);
  }, 30_000);

  afterAll(async () => { D()?.dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the preview changed from the links tile, from a link up top and after b: Back steps through each in order", async () => {
    await build();
    // From the links tile: two backlinks picked, one after the other.
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.seeds.id) }, "links");
    await whole("preview", n.seeds.id);
    await Bun.sleep(1200);                                              // two picks, not one walk
    await mine("list.pick", { n: rowOf(n.rain.id) }, "links");
    await whole("preview", n.rain.id);
    expect(backTitles("preview")).toEqual(["Seed order"]);

    // From a link in the detail up top: its open lands in the preview.
    await mine("tile.focus", {}, "detail");
    for (let i = 0; i < 20 && !String(r("detail").surface.describe().elements?.current?.label ?? "").startsWith("Stake the beans"); i++) { key(char("]")); render(); }
    key({ kind: "enter" } as Key);
    await whole("preview", n.beans.id);
    expect(r("detail").msg?.id).toBe(n.hub.id);
    expect(backTitles("preview")).toEqual(["Rain gauge", "Seed order"]);

    // b in the preview aims the links tile at its note; the links tile's pick then shows in the preview.
    await mine("tile.focus", {}, "preview");
    key(char("b"));
    await until(() => L().target?.id === n.beans.id && !!L().data && L().rows().some((row: any) => row.kind === "backlink"), "the links tile lists the beans' links");
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.canes.id) }, "links");
    await whole("preview", n.canes.id);

    // Back in the preview: each in turn.
    await mine("back", {}, "preview");
    await whole("preview", n.beans.id);
    await mine("back", {}, "preview");
    await whole("preview", n.rain.id);
    await mine("back", {}, "preview");
    await whole("preview", n.seeds.id);
    await mine("forward", {}, "preview");
    await whole("preview", n.rain.id);
  }, 30_000);

  test("the links tile: b changed what it lists; Back there lists the one before, forward again", async () => {
    expect(L().target?.id).toBe(n.beans.id);
    expect(L().trail?.stops().back.map(s => s.title)).toEqual(["Weekend jobs"]);
    await mine("tile.focus", {}, "links");
    key({ kind: "alt-left" } as Key);
    await until(() => L().target?.id === n.hub.id, "the links tile lists the hub's links again");
    expect(L().trail?.stops().forward.map(s => s.title)).toEqual(["Stake the beans"]);
    await mine("tile.travel", { dir: "forward" }, "links");
    await until(() => L().target?.id === n.beans.id, "forward lists the beans' links again");
  }, 30_000);
});
