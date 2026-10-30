import { Canvas } from "../src/canvas";
import { visible } from "../src/style";
// PIE-815/917: a note's whole title reads in its reader's header, wrapped, never cut; the border identifies the tile,
// and says the title whole in the status line when the person's keys come to the tile. Scratch outline, made-up titles.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { Selection } from "../src/surface/selection";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, showIn, until } from "./scratch";

const QUESTION = "When the allotment committee moves the spring seed swap to the community hall, who carries the trestle tables over, and does the borrowed urn still need returning to the church by Sunday?";

describe.skipIf(!outliner)("a note's full title in its header (PIE-815)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  const D = () => desk as any;
  const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/\x1b_[^\x1b]*\x1b\\/g, "");
  let note: any;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("work-ids.configure", { prefix: "PLOT" });
    note = await board.createBlock(null, `${QUESTION} [work-id::PLOT-007]\nAsk Morag; she has the hall key.`);
    await board.comment(crypto.randomUUID(), note.id, note.revision, "Check the hall booking.", null);
  }, 30_000);
  afterAll(async () => { app?.quit(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  for (const cols of [80, 160]) test(`at ${cols} columns the header reads every word of a 30-word question; the calm frame keeps its controls`, async () => {
    const term = { info: { cols, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk({ name: "q", title: "q", layout: { focus: "tree", root: { t: "split", dir: "row", weights: [0.3, 0.7], kids: [{ t: "leaf", kind: "tree", name: "tree" }, { t: "leaf", kind: "reader", name: "reader" }] } } } as any);
    app.push(desk);
    showIn(desk, note);
    const r = () => D().pane("reader") as ReaderPane;
    await until(() => r().msg?.id === note.id, "the reader on the note");
    const lines = () => (desk.render(D().ctx).lines as string[]).map(plain);
    await until(() => lines().some(l => l.includes("PLOT-007 ·")), "the header drawn");
    const all = lines(), rect = D().rectOf(r());
    // The reader header keeps every word when the frame must cut the title.
    const at = all.findIndex((l, i) => i > rect.row && /PLOT-007 · When the allotment/.test(l));
    expect(at).toBeGreaterThan(rect.row);
    // The title's rows, read back inside the reader's box: every word, in order, none cut.
    const rows = all.slice(at, at + 6).map(l => [...l].slice(rect.col + 1, rect.col + rect.cols - 1).join("").trim());
    const joined = rows.join(" ").replace(/\s+/g, " ");
    expect(joined).toContain(`PLOT-007 · ${QUESTION}`);
    expect(joined).not.toContain("…");
    // A long title gives way to controls on the frame.
    expect(all[rect.row]).toContain("\u2261");
    expect(all[rect.row]).toContain("PLOT-007 · When the allotm");
    // The keys come to the reader: the whole title in the status line.
    await D().dispatch.act({ action: "tile.focus", args: {}, tile: "reader" }, { kind: "user" });
    expect((app as any).message).toBe(`PLOT-007 · ${QUESTION}`);
    // A selection on the title's second row is the note's subject line, as on its first (copy source, a passage).
    const s = r().surface as any, second = at - rect.row; // the header's rows count from the reader's first inner row
    const src = s.sourceOf(new Selection({ row: second, col: 0 }, { row: second, col: 3 }));
    expect(src).not.toBeNull();
    expect(src.lines).toEqual([0, 0]);
    await r().surface.loadComments(r().host(desk));
    const titleBefore = r().render(300, 40, true, desk).lines[1]!;
    await D().dispatch.press("margin", { mode: "off" }, "reader");
    const titleAfter = r().render(300, 40, true, desk).lines[1]!;
    expect(plain(titleAfter)).toContain("[+]");
    expect(titleAfter).toStartWith(titleBefore.slice(0, titleBefore.indexOf(" · ")));
    await D().dispatch.press("edit", {}, "reader");
    await until(() => !!r().surface.draft, "the editor covers the header");
    expect(lines()[rect.row]).toContain("editing");
    D().dispose(); app.quit();
  }, 30_000);

  for (const sized of [false, true]) for (const tile of [
    { kind: "reader" },
    { kind: "preview", source: "tile:detail" },
    { kind: "reader", mode: "pinned" },
    { kind: "reader", mode: "pinned", name: "research-notes-for-the-next-planning-session", cols: 60 },
    { kind: "welcome.detail", source: "tile:welcome" },
    { kind: "welcome.preview", source: "tile:detail" },
    { kind: "river.column" },
  ]) test(`${tile.kind} ${"mode" in tile ? tile.mode : ""}: one normal-width title at ${"cols" in tile ? tile.cols : 120} columns with sizing ${sized} (PIE-917)`, async () => {
    const short = await board.createBlock(null, "The orchard gate\n\nBring the spare key.");
    let key: (k: any) => void = () => {};
    const term = { info: { cols: "cols" in tile ? tile.cols : 120, rows: 40, cellW: 9, cellH: 16, kitty: true, sized }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const name = "name" in tile ? tile.name : "reader";
    const spec = { t: "leaf", ...tile, name, ...(tile.kind === "river.column" ? { source: `block:${short.id}` } : {}) };
    desk = new Desk({ name: "once", title: "once", layout: { focus: name, root: spec } } as any);
    app.push(desk);
    const reader = D().pane(name) as ReaderPane;
    if (tile.kind !== "river.column") reader.show(short, desk);
    await until(() => (desk.render(D().ctx).lines as string[]).map(plain).some(l => l.includes("Bring the spare key.")), "the note drawn");
    if (tile.kind === "welcome.preview") await until(() => plain(reader.surface.render(100, 30, reader.host(desk)).lines[0]!).includes("top level"), "breadcrumb");
    const all = (desk.render(D().ctx).lines as string[]).map(plain);
    if ("cols" in tile) expect(all[0]).toContain("▣ pinned");
    expect(all.slice(1).join("\n").match(/The orchard gate/g)?.length).toBe(1);
    expect(all[0]).toContain("\u2261");
    const titleRow = all.findIndex((l, i) => i > 0 && l.includes("The orchard gate"));
    expect(all[titleRow + 1]).toContain("[comment]");
    if (tile.kind === "welcome.preview") {
      expect(all.join("\n")).toContain("top level");
      expect(all.join("\n")).toContain("read here");
    }
    if ("cols" in tile) {
      // A click on the pin chip lets it go (reader.pin), as p does.
      const x = all[0]!.indexOf("▣ pinned");
      key({ kind: "mouse", action: "down", button: 0, x, y: 0 });
      key({ kind: "mouse", action: "up", button: 0, x, y: 0 });
      await until(() => !reader.pinned, "the chip unpins it");
      await D().dispatch.press("edit", {}, name);
      expect(plain((desk.render(D().ctx).lines as string[])[0]!)).toContain("editing");
    }
    D().dispose(); app.quit();
  }, 30_000);
});

test("a frame title stays in its one-line band and marks the omitted words", () => {
  const canvas = new Canvas(30, 6);
  canvas.box({ col: 0, row: 0, cols: 30, rows: 6 }, "", "Carry the tables across the garden before dusk");
  const rows = canvas.lines().map(visible);
  expect(rows[0]).toContain("…");
  expect(rows[1]).not.toContain("garden");
});
