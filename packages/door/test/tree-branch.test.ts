// A virtual branch in the outline tree (PIE-882): a hub that is both a folder and a file. Opened, it shows its physical
// children, then what its query matches (the service's `views.read`: its limit and child-depth), each match opened to
// its children as far as the view says; `D` (`tree.depth`) overrides how far, a `more` row reads the next page. By keys,
// the mouse and `act`. Against a throwaway outliner, with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { TreePane } from "../src/desk/tree";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("the tree's virtual branches, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const n = {} as Record<"hub" | "readme" | "beans" | "leeks" | "kale" | "sow" | "stake" | "other", Msg>;
  const D = () => desk as any;
  const tree = () => [...D().panes.values()].find((p: any) => p.kind === "tree") as TreePane;
  const rows = () => tree().describe().rows;
  const words = () => rows().map(r => `${"  ".repeat(r.depth)}${r.text}`);
  const rowOf = (text: string) => { const r = rows().find(x => x.text.includes(text)); if (!r) throw new Error(`no row "${text}" in:\n${words().join("\n")}`); return r; };
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const selectRow = (text: string) => tree().selectRow(rowOf(text).n - 1, desk);
  const lines = () => desk.render(D().ctx).lines.map(plain);
  const treeRect = () => { desk.render(D().ctx); return D().placed.rects.get([...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0]); };
  const clickRow = (rowN: number, mark = false) => {
    const r = treeRect(), row = rows()[rowN - 1]!;
    const at = { x: r.col + 1 + row.depth * 2 + (mark ? 0 : 3) + 1, y: r.row + 1 + rowN - 1 - (tree() as any).view.top };
    press({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
    press({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y });
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const create = (parentId: string | null, text: string) => board.createBlock(parentId, text);
    // The hub: a note with a child of its own, and a query over the chores, two to a page, children one level down.
    n.hub = await create(null, "Garden hub [type::virtual-branch] [query::type=chore] [limit::2] [child-depth::1]\nWhat to do in the beds.");
    n.readme = await create(n.hub.id, "Hub readme\nThe hub holds this note and lists the chores.");
    const beds = await create(null, "Beds");
    n.beans = await create(beds.id, "Stake the beans [type::chore]");
    n.sow = await create(n.beans.id, "Sow the second row");
    n.stake = await create(n.sow.id, "Fetch the long canes");
    n.leeks = await create(beds.id, "Plant out the leeks [type::chore]");
    n.kale = await create(beds.id, "Net the kale [type::chore]");
    n.other = await create(beds.id, "Compost bin lid");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    await until(() => rows().length > 0, "the tree's top level", 8000);
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
  }, 60_000);

  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("opening a hub shows its physical children, then its matches within the view's limit, with a row that reads the next page", async () => {
    selectRow("Garden hub");
    ch("l");
    await until(() => rows().some(r => r.role === "more"), "the matches");
    const at = rowOf("Garden hub").n;
    expect(words().slice(at, at + 3)).toEqual(["  Hub readme", "  3 matches · children to depth 1", expect.stringMatching(/^ {2}\S/)]);
    expect(rows()[at + 4]!.text).toBe("… 1 more · ⏎ reads the next 2");
    const matches = rows().filter(r => r.match);
    expect(matches.map(r => r.text)).toHaveLength(2);
    expect(matches.every(r => r.matchOf === n.hub.id)).toBe(true);
    // The physical child comes before the matches, and is not one.
    expect(rowOf("Hub readme").match).toBeUndefined();
    expect(rowOf("Hub readme").n).toBeLessThan(rowOf("matches · ").n);
    const drawn = lines().join("\n");
    expect(drawn).toContain("V:3");
    expect(drawn).toContain("◇ 3 matches");
    ch("l"); // no-op on a row already open
  }, 60_000);

  test("⏎ on the more row reads the next page; a match opens to its children as far as child-depth, and no further", async () => {
    selectRow("more · ⏎");
    press({ kind: "enter" });
    await until(() => !rows().some(r => r.role === "more") && rows().filter(r => r.match).length === 3, "the third match");
    selectRow("Stake the beans");
    ch("l");
    await until(() => rows().some(r => r.text.includes("Sow the second row")), "the match's child");
    // child-depth 1: the child's own child is out of reach.
    const sow = rowOf("Sow the second row");
    expect(sow.matchOf).toBe(n.hub.id);
    selectRow("Sow the second row");
    ch("l");
    await Bun.sleep(300);
    expect(rows().some(r => r.text.includes("Fetch the long canes"))).toBe(false);
  }, 60_000);

  test("D steps the depth for this view: results only, then deeper; the property is never written", async () => {
    const before = board.sent.length;
    selectRow("Stake the beans");
    ch("D");                                    // authored → results only
    await until(() => rowOf("matches · ").text.includes("results only"), "results only");
    expect(rows().some(r => r.text.includes("Sow the second row"))).toBe(false);
    ch("D"); ch("D");                           // 1, then 2
    await until(() => rowOf("matches · ").text.includes("depth 2"), "depth 2");
    selectRow("Sow the second row");
    ch("l");
    await until(() => rows().some(r => r.text.includes("Fetch the long canes")), "the grandchild at depth 2");
    expect(board.sent.slice(before).filter(a => a === "update" || a.startsWith("properties."))).toEqual([]);
    // The results line is where a click changes it, too.
    clickRow(rowOf("matches · ").n);
    press({ kind: "enter" });
    await until(() => rowOf("matches · ").text.includes("depth 3"), "the next step");
  }, 60_000);

  test("an agent sets the depth by act and cannot take the person's selection; a row that is no view's is refused", async () => {
    const sel = tree().selectedRow;
    const out = await app.act({ action: "tree.depth", args: { id: n.hub.id, depth: "authored" }, as: "walker-7" }) as any;
    expect(out).toMatchObject({ view: n.hub.id, depth: 1, authored: true });
    expect(tree().selectedRow).toBe(sel);
    await until(() => rowOf("matches · ").text.includes("children to depth 1") && !rowOf("matches · ").text.includes("(D)"), "the view's own depth");
    await app.act({ action: "tree.depth", args: { id: n.hub.id, depth: "0" }, as: "walker-7" });
    expect(rowOf("matches · ").text).toContain("results only");
    await expect(app.act({ action: "tree.depth", args: { id: n.hub.id, depth: "9" }, as: "walker-7" })).rejects.toThrow("0 (results only) to 8");
    await expect(app.act({ action: "tree.depth", args: { id: n.readme.id }, as: "walker-7" })).rejects.toThrow("no virtual branch's");
  }, 60_000);

  test("a change in the outline updates the matches: a new chore appears, one that stops matching goes", async () => {
    await app.act({ action: "tree.depth", args: { id: n.hub.id, depth: "authored" }, as: "walker-7" });
    const fresh = await board.createBlock(null, "Water the squash [type::chore]");
    await until(() => rows().some(r => r.text.includes("Water the squash")) || rows().some(r => r.role === "more"), "the new match or its page");
    const kale = (await board.get(n.kale.id))!;
    await board.update(kale.id, "Net the kale", kale.revision!);
    await until(() => !rows().some(r => r.text.includes("Net the kale") && r.match), "kale gone from the matches");
    expect(fresh.id).toBeTruthy();
  }, 60_000);
});
