// PIE-1356: a note with a Work ID shows it first wherever its name is drawn, as its reader's header does: the tile bar,
// a spine, a list row (the outline tile), `((` completion. A title that starts with its ID isn't said twice, and a
// short room cuts the title from its end, never the ID. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { Draft } from "../src/edit";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import { completerFor, completionKey, renderCompletion } from "../src/surface/completer";
import { outliner, Scratch, showIn, until } from "./scratch";

const TITLE = "PC-582 acceptance summary for the intake desk: invited patients and their follow-up calls";
const plain = (s: string) => visible(s);

describe.skipIf(!outliner)("a Work ID first wherever a note's title is drawn (PIE-1356)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, note: any, dashed: any;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("work-ids.configure", { prefix: "HUB" });
    note = await board.createBlock(null, `${TITLE} [work-id::HUB-062]\nThe desk signed off on Tuesday.`);
    dashed = await board.createBlock(null, "HUB-063 — Water butts by the shed [work-id::HUB-063]\nTwo of them leak.");
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  for (const cols of [80, 40]) describe(`at ${cols} columns`, () => {
    let app: App, desk: Desk, key: (k: any) => void = () => {};
    const D = () => desk as any;
    const lines = () => (desk.render(D().ctx).lines as string[]).map(plain);
    beforeAll(async () => {
      const term = { info: { cols, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
      app = new App(term as any, board, Date.now(), () => {});
      app.push(new MainMenu());
      desk = new Desk({ name: "w", title: "w", layout: { focus: "tree", root: { t: "split", dir: "col", weights: [0.5, 0.5], kids: [{ t: "leaf", kind: "tree", name: "tree" }, { t: "leaf", kind: "reader", name: "reader" }] } } } as any);
      app.push(desk);
    }, 30_000);
    afterAll(() => { app?.quit(); });

    test("the tile bar and the outline tile's row say HUB-062 first; a dashed title isn't doubled", async () => {
      showIn(desk, note);
      const r = () => D().pane("reader") as ReaderPane;
      await until(() => r().msg?.id === note.id, "the reader on the note");
      await until(() => lines().some(l => l.includes("PC-5")), "the note drawn");
      const all = lines(), rect = D().rectOf(r()), tree = D().rectOf(D().pane("tree"));
      // The reader's bar: the ID first, whole; the title after it cut from its end.
      const bar = [...all[rect.row]!].slice(rect.col, rect.col + rect.cols).join("");
      expect(bar).toContain("HUB-062 · PC-5");
      // The outline tile lists the note by the same name.
      const rows = all.slice(tree.row + 1, tree.row + tree.rows - 1).map(l => [...l].slice(tree.col, tree.col + tree.cols).join(""));
      expect(rows.some(l => l.includes("HUB-062 · PC-5"))).toBe(true);
      // A title that already starts with its ID reads it once.
      expect(rows.some(l => l.includes("HUB-063 · Wat"))).toBe(true);
      expect(rows.join("\n")).not.toContain("HUB-063 · HUB-063");
      expect(rows.join("\n")).not.toContain("HUB-063 —");
    });

    test("folded to a spine, the reader's spine says HUB-062 first", async () => {
      await D().dispatch.act({ action: "tile.collapse", args: { dir: "h" }, tile: "reader" }, { kind: "user" });
      key({ kind: "esc" });                     // the fold's hint card
      const all = lines();
      const spines = D().spines as [number, any][];
      expect(spines.length).toBeGreaterThan(0);
      const [, s] = spines[0]!;
      const row = [...all[s.row]!].slice(s.col, s.col + s.cols).join("");
      expect(row).toContain("HUB-062 · PC-5");
      await D().dispatch.act({ action: "tile.expand", args: {}, tile: "reader" }, { kind: "user" });
    });
  });

  for (const w of [80, 40]) test(`(( completion at ${w} columns: the row reads HUB-062 · PC-582…`, async () => {
    const d = new Draft("x", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "see ((intake desk") completionKey(d, { kind: "char", ch }, c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the lookup");
    const row = c.state!.items.find(i => i.insertion === `((${note.id}))`);
    expect(row?.label).toStartWith("HUB-062 · PC-582");
    const drawn = renderCompletion(c.state!, w, 8).map(plain).join("\n");
    expect(drawn).toContain("HUB-062 · PC-5");
  });

  test("the doubled-ID note's completion row reads its ID once", async () => {
    const d = new Draft("x", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((water butts") completionKey(d, { kind: "char", ch }, c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the lookup");
    expect(c.state!.items.find(i => i.insertion === `((${dashed.id}))`)?.label).toBe("HUB-063 · Water butts by the shed");
  });
});
