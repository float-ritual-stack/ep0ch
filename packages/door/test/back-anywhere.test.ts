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

const leaf = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });
const char = (ch: string): Key => ({ kind: "char", ch } as Key);

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
  }, 30_000);
  afterAll(async () => { D()?.dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the preview changed from the links tile, from a link up top and after b: Back steps through each in order", async () => {
    // From the links tile: two backlinks picked, one after the other.
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.seeds.id) }, "links");
    await whole("preview", n.seeds.id);
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
