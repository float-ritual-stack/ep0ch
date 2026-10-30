// PIE-1207: there is no current note. A reader keeps what's opened into it; `p` (the pin chip, `reader.pin`) pins it,
// and every open aimed at a pinned reader lands in the reader beside it, said once, the hint row naming where. A saved
// `detail` is a reader (pinned when it names a page); a saved reader that followed the old current note loads on the
// note it showed, the screen's first list wired to it, said once. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { register } from "../src/desk/screen-notes";
import { canonSpec } from "../src/desk/tiles";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });

describe("the reader modes before the pin, as saved layouts and agents wrote them", () => {
  test("detail is a reader, pinned when it names a page; held is no pin; follows and a note-less place are a former follower", () => {
    expect(canonSpec({ kind: "detail", name: "a", note: "n1" })).toEqual({ kind: "reader", name: "a", note: "n1" });
    expect(canonSpec({ kind: "detail", name: "b", page: "garden-now" })).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now" });
    expect(canonSpec({ kind: "reader", name: "c", mode: "held", note: "n1" } as any)).toEqual({ kind: "reader", name: "c", note: "n1" });
    expect(canonSpec({ kind: "reader", name: "d", mode: "follows" } as any)).toEqual({ kind: "reader", name: "d", wasFollowing: true });
    expect(canonSpec({ kind: "reader", name: "e", nav: { v: 1 } })).toMatchObject({ kind: "reader", wasFollowing: true });
    expect(canonSpec({ kind: "reader", name: "f" })).toEqual({ kind: "reader", name: "f" });
    expect(canonSpec({ kind: "query", name: "q", mode: "held" })).toMatchObject({ kind: "query", mode: "held" });
  });
});

describe.skipIf(!outliner)("a reader's pin, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "reader-agent-1207";
  const D = () => desk as any;
  /** An agent's action (nobody is at the keys when it runs). */
  const act = async (action: string, args: Record<string, unknown> = {}, reader?: string) => {
    if (get().focus !== "tree") await mine("tile.focus", {}, "tree");     // the person's keys are on the outline, not the reader
    (app as any).lastInput = 0;
    return app.act({ action, args, tile: reader, as: AS });
  };
  /** The person's own action. */
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, tile: reader }, { kind: "user" });
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const names = () => get().tiles.map((t: any) => t.name as string);
  const pane = (name: string): ReaderPane => [...D().panes.entries()].find(([id]: any) => D().nameOf(id) === name)![1];
  const message = () => (app as any).message as string;
  const notes: Record<string, any> = {};
  const leaf = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = async (text: string) => (await board.get((await board.request<any>("create", { parentId: null, text, author: "agent" })).id))!;
    notes.shed = await mk("Mend the shed roof\nBuy tacks and felt.");
    notes.beans = await mk("Sow the beans\nTwo to a hole.");
    notes.now = await mk("Garden, right now [page::garden-now]\nThe beans are in; the shed waits for felt.");
    notes.plan = await mk(`Week plan\nFirst ((${notes.beans.id})), then ((${notes.shed.id})).`);
    // A layout written when `detail` was a kind of its own, and the open rule `current`: a reader, a detail on a note, one on a page.
    register({
      name: "old-details", title: "old-details", id: "00000000-0000-4000-8000-0000000007a5", revision: 1,
      spec: {
        name: "old-details", title: "old-details", layouts: true,
        layout: { focus: "tree", rule: "current", root: { t: "split", dir: "row", weights: [0.25, 0.25, 0.25, 0.25], kids: [
          leaf("tree", "tree", { wires: [{ verb: "select", to: "reader" }, { verb: "open", to: "reader" }] }), leaf("reader", "reader"), leaf("detail", "keeps", { note: notes.beans.id }), leaf("detail", "now", { page: "garden-now" }),
        ] } },
      } as any,
    });
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: "old-details" });
    app.push(desk);
    render();
    await until(() => pane("keeps").msg?.id === notes.beans.id && pane("now").msg?.id === notes.now.id, "the detail and the pinned reader on their notes");
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("a former detail is a reader, one with a page a pinned reader; each saves in the new form", () => {
    expect(tile("keeps")).toMatchObject({ kind: "reader", showing: { id: notes.beans.id } });
    expect(tile("keeps").pinned).toBeUndefined();
    expect(tile("now")).toMatchObject({ kind: "reader", pinned: true, showing: { id: notes.now.id } });
    const leaves = JSON.parse(JSON.stringify(D().layoutSpec().root)).kids;
    expect(leaves.find((l: any) => l.name === "keeps")).toMatchObject({ kind: "reader", note: notes.beans.id });
    expect(leaves.find((l: any) => l.name === "keeps").mode).toBeUndefined();
    const pinned = leaves.find((l: any) => l.name === "now");
    expect(pinned).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now" });
    expect(pinned.note).toBeUndefined();
    expect(D().layoutSpec().rule).toBe("reader");
  });

  test("p pins a reader: an open aimed at it lands in a reader beside it, said once, and the next reuses that one; p lets it go", async () => {
    await mine("tile.focus", {}, "keeps");
    key(char("p"));
    await until(() => pane("keeps").pinned, "keeps pinned");
    render();
    expect(pane("keeps").hint()).toContain("pinned: opens land in a reader beside it");
    const before = new Set(names());
    await act("open", { id: notes.plan.id }, "keeps");
    const beside = names().find(n => !before.has(n))!;
    expect(beside).toBeTruthy();
    expect(tile(beside).showing.id).toBe(notes.plan.id);
    expect(pane("keeps").msg?.id).toBe(notes.beans.id);
    expect(message()).toContain("keeps is pinned: opened beside it");
    render();
    expect(pane("keeps").hint()).toContain(`pinned: opens land in ${beside}`);
    await act("open", { id: notes.shed.id }, "keeps");
    expect(tile(beside).showing.id).toBe(notes.shed.id);
    expect(names().length).toBe(before.size + 1);
    await mine("tile.focus", {}, "keeps");
    key(char("p"));
    await until(() => !pane("keeps").pinned, "keeps let go");
    await act("open", { id: notes.plan.id }, "keeps");
    expect(pane("keeps").msg?.id).toBe(notes.plan.id);
    await mine("tile.close", {}, beside);
  });

  test("reader.pin by an agent: attributed, on a named page, refused with why", async () => {
    expect(await act("reader.pin", {}, "reader")).toMatchObject({ name: "reader", pinned: true });
    expect(message()).toContain(AS);
    expect(await act("reader.pin", { on: false }, "reader")).toMatchObject({ pinned: false });
    await expect(act("reader.pin", { page: "no-such-page" }, "keeps")).rejects.toThrow(/no page no-such-page in this outline/);
    expect(await act("reader.pin", { page: "garden-now" }, "keeps")).toMatchObject({ pinned: true, page: "garden-now" });
    expect(pane("keeps").msg?.id).toBe(notes.now.id);
    await expect(act("reader.pin", {}, "tree")).rejects.toThrow();
    await expect(act("reader.mode", {}, "keeps")).rejects.toThrow();
    await act("reader.pin", { on: false }, "keeps");
  });

  test("a pin still looking its page up gives way to a pin chosen meanwhile", async () => {
    const p = pane("keeps");
    const pending = p.setPin(true, D(), "garden-now").then(() => "pinned", (e: Error) => e.message);
    expect((await p.setPin(false, D())).pinned).toBe(false);
    expect(await pending).toMatch(/pin changed again while the page was looked up/);
    expect(p.pinned).toBe(false);
  });

  test("the tree's ⏎ and select land by its wires; an open naming no tile goes to the first reader not pinned", async () => {
    await mine("tile.focus", {}, "tree");
    const kept = pane("keeps").msg?.id;
    D().showFrom(D().paneNamed("tree"), notes.beans);
    expect(pane("reader").msg?.id).toBe(notes.beans.id);
    expect(pane("keeps").msg?.id).toBe(kept);                  // nothing selects into keeps: it keeps its note
    await act("reader.pin", { on: true }, "reader");
    D().showFrom(D().paneNamed("tree"), notes.shed);
    expect(pane("reader").msg?.id).toBe(notes.beans.id);       // pinned: the select wire waits
    await act("reader.pin", { on: false }, "reader");
    await mine("tile.focus", {}, "tree");
    const out = await act("open", { id: notes.shed.id }) as any;
    expect(out.name).not.toBe("now");
    expect(pane("now").msg?.id).toBe(notes.now.id);
  });

  test("^W o d and ^W o r open readers, neither pinned; p pins either", async () => {
    await mine("tile.focus", {}, "tree");
    const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
    const before = new Set(names());
    key(ctrl("w")); key(char("o")); key(char("d"));
    const made = () => get().tiles.find((t: any) => !before.has(t.name));
    await until(() => !!made(), "the detail ^W o d opened");
    expect(made()).toMatchObject({ kind: "reader" });
    expect(made().pinned).toBeUndefined();
    const name = made().name;
    await act("open", { id: notes.beans.id }, name);
    await mine("tile.focus", {}, name);
    key(char("p"));
    await until(() => tile(name).pinned === true, "p on the new detail");
    await mine("tile.close", {}, name);
  });

  test("a pin survives a restart; the desk's tree is wired to its reader", async () => {
    await act("reader.pin", { on: true }, "keeps");
    const kept = pane("keeps").msg?.id;
    D().save();
    const saved = JSON.parse(readFileSync(join(scratch.root, "door", "desk.json"), "utf8"));
    const walk = (n: any): any[] => (n.t === "leaf" ? [n] : (n.kids ?? []).flatMap(walk));
    expect(walk(saved.root).find((l: any) => l.name === "keeps")).toMatchObject({ mode: "pinned", note: kept });
    const again = new Desk(undefined, { saved, layout: undefined });
    const A = again as any;
    app.push(again);
    A.render(A.ctx);
    const at = (n: string) => (A.layoutGet().tiles as any[]).find((t: any) => t.name === n);
    await until(() => at("keeps")?.showing?.id === kept, "the pinned reader back on its note");
    expect(at("keeps").pinned).toBe(true);
    app.pop();
    A.dispose();
  });

  test("a screen saved with a reader following the old current note loads it on the note it showed, the first list wired to it, said once", async () => {
    const nav = pane("reader").surface.saveNav(), showed = pane("reader").msg?.id;
    expect(nav).toBeDefined();
    // As a screen note written before the pin kept a following reader: its place and no note, its list unwired.
    const old = new Desk({ name: "older", title: "older", layout: { focus: "tree", root: { t: "split", dir: "row", weights: [0.4, 0.6], kids: [
      leaf("tree", "tree"), leaf("reader", "reader", { nav }),
    ] } } } as any);
    const O = old as any;
    app.push(old);
    O.render(O.ctx);
    const at = (n: string) => (O.layoutGet().tiles as any[]).find((t: any) => t.name === n);
    await until(() => at("reader").showing?.id === showed, "the former follower on the note it showed");
    expect(message()).toContain("following the current note is gone");
    expect(message()).toContain("tree → reader");
    expect(at("tree").wires).toContainEqual({ verb: "select", to: at("reader").tile });
    app.pop();
    O.dispose();
  });
});
