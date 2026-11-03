// PIE-1521: one walk through every row container. A note holds a live table, a ::links list, a collection and an embedded
// saved view (an inline list); j walks down through all of them and k back up, each container stepping its own rows and
// handing the walk on past its edge. Fictional notes, against a throwaway outliner service only.
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

describe.skipIf(!outliner)("one walk through every row container (PIE-1521)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk;
  let key: (k: Key) => void = () => {};
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const frame = () => b.render(BV.view(b).ctx).lines;
  const text = () => plain(frame().join("\n"));
  const n: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (const kind of ["crate", "letter", "seed", "parcel"]) for (let i = 1; i <= 3; i++) await create(null, `${kind[0]!.toUpperCase()}${kind.slice(1)} ${i} [type::walk-${kind}]`);
    n.parcels = await create(null, "Parcels [type::virtual-branch] [query::type=walk-parcel] [sort::title] [direction::asc]");
    n.note = await create(null, [
      "Row walk", "Before the rows.", "",
      "::graph-table", "---", "title: Crates", 'query: "type=walk-crate"', "sort: title", "---", "::", "",
      "Between the table and the links.", "",
      '::links{query="type=walk-letter" title="Letters"}', "::", "",
      "Between the links and the view.", "",
      '::view{query="type=walk-seed" layout=table sort="title asc"}', "::", "",
      "Between the view and the embed.", "",
      `!((${n.parcels.id}))`, "",
      "After everything.",
    ].join("\n"));
    const term = { info: { cols: 160, rows: 200, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 60_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  const walked = [
    "Before the rows.", "Crate 3", "Crate 2", "Crate 1", "Between the table and the links.", "Letter 1", "Letter 2", "Letter 3",
    "Between the links and the view.", "Seed 1", "Seed 2", "Seed 3", "Between the view and the embed.", "Parcel 1", "Parcel 2", "Parcel 3",
    "After everything.",
  ];
  for (const cols of [160, 44]) test(`j walks every container's rows in order and on past each, k back the same way, at ${cols} columns`, async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    (app as any).term.info.cols = cols;
    b = openScreen("detail", { note: n.note.id, persist: false }) as Desk;
    app.push(b);
    const d = b.pane("detail") as ReaderPane;
    await until(() => !!d.msg && !d.msg.partial && d.msg.id === n.note.id, "the note");
    await until(() => ["Crate 3", "Letter 3", "Seed 3", "Parcel 3"].every(t => text().includes(t)), "every container's rows", 10_000);
    expect(Math.max(...frame().map(l => [...plain(l)].length))).toBeLessThanOrEqual(cols);
    expect(Math.max(...frame().map(l => [...plain(l)].length))).toBeGreaterThan(cols - 10);
    const lines = d.msg!.text.split("\n");
    // Where the walk is: the row the [ ] position is on, else the reading line's text.
    const at = () => { const e = d.surface.selectedElement(); return e ? e.label.match(/(Crate|Letter|Seed|Parcel) \d/)![0] : lines[d.surface.readingSourceLine()]!.trim(); };
    const go = (c: string, times: number) => Array.from({ length: times }, () => { key(char(c)); frame(); return at(); });
    expect(go("j", walked.length)).toEqual(walked);
    // Nothing further down: the walk stays where it is.
    expect(go("j", 1)).toEqual(["After everything."]);
    expect(go("k", walked.length - 1)).toEqual(walked.slice(0, -1).reverse());
    expect(go("k", 1)).toEqual(["Before the rows."]);
    // esc lets go of a row; j goes back into the container the reading line is on, from its first row.
    go("j", 3);
    key({ kind: "esc" }); frame();
    expect(d.surface.selectedElement()).toBeUndefined();
    expect(go("j", 1)).toEqual(["Crate 3"]);
    // through: the walk passes the container the position is in instead of stepping it.
    await b.dispatch.act({ action: "reading.step", args: { by: 1, through: true }, tile: "detail" }, { kind: "user" }); frame();
    expect(at()).toBe("Between the table and the links.");
  }, 30_000);
});
