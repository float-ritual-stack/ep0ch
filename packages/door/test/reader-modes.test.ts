// PIE-705: one reader kind with three modes (follows, held, pinned to a page) in place of reader and detail.
// A `detail` in a saved layout or a screen spec reads as a held reader (pinned when it names a page); `p`, a click on
// the mode chip and `reader.mode` switch a reader's mode, a former detail's too; the refusal "reader.hold is for readers"
// a detail used to get is gone. Scratch services and fictional notes only.
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

describe("a detail in a saved layout reads as a held reader", () => {
  test("detail becomes a reader that starts held, pinned when it names a page; a reader is left alone", () => {
    expect(canonSpec({ kind: "detail", name: "a", note: "n1" })).toMatchObject({ kind: "reader", name: "a", mode: "held", note: "n1" });
    expect(canonSpec({ kind: "detail", name: "b", page: "garden-now" })).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now" });
    expect(canonSpec({ kind: "reader", name: "c" })).toEqual({ kind: "reader", name: "c" });
    expect(canonSpec({ kind: "tree", name: "t" })).toEqual({ kind: "tree", name: "t" });
  });
});

describe.skipIf(!outliner)("one reader kind with three modes, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "reader-agent-705";
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
  const pane = (name: string): ReaderPane => [...D().panes.entries()].find(([id]: any) => D().nameOf(id) === name)![1];
  const message = () => (app as any).message as string;
  const mouse = (action: "down" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
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
    // A layout written when `detail` was a kind of its own: a held one on a note, a pinned one on a page, an empty one.
    register({
      name: "old-details", title: "old-details", id: "00000000-0000-4000-8000-0000000007a5", revision: 1,
      spec: {
        name: "old-details", title: "old-details", layouts: true,
        layout: { focus: "tree", rule: "current", root: { t: "split", dir: "row", weights: [0.25, 0.25, 0.25, 0.25], kids: [
          leaf("tree", "tree"), leaf("reader", "follower"), leaf("detail", "keeps", { note: notes.beans.id }), leaf("detail", "now", { page: "garden-now" }),
        ] } },
      } as any,
    });
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: "old-details" });
    app.push(desk);
    render();
    await until(() => pane("keeps").msg?.id === notes.beans.id && pane("now").msg?.id === notes.now.id, "the held and the pinned reader on their notes");
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("a former detail is a reader tile in mode held, a former detail with a page one in mode pinned", () => {
    expect(tile("follower")).toMatchObject({ kind: "reader", mode: "follows" });
    expect(tile("keeps")).toMatchObject({ kind: "reader", mode: "held", showing: { id: notes.beans.id } });
    expect(tile("now")).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now", showing: { id: notes.now.id } });
    // It saves as a reader in the new form: the note it keeps, or the page it is pinned to and no note.
    const leaves = JSON.parse(JSON.stringify(D().layoutSpec().root)).kids;
    expect(leaves.find((l: any) => l.name === "keeps")).toMatchObject({ kind: "reader", mode: "held", note: notes.beans.id });
    const pinned = leaves.find((l: any) => l.name === "now");
    expect(pinned).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now" });
    expect(pinned.note).toBeUndefined();
  });

  test("p on a former detail follows the current note, and p again holds the note it shows; the current note moves only a following reader", async () => {
    await mine("tile.focus", {}, "keeps");
    expect(get().focus).toBe("keeps");
    D().setCurrent(notes.shed, {});
    expect(pane("keeps").msg?.id).toBe(notes.beans.id);     // held: the current note does not move it
    expect(pane("follower").msg?.id).toBe(notes.shed.id);
    key(char("p"));                                          // follow
    await until(() => tile("keeps").mode === "follows", "keeps follows");
    expect(pane("keeps").msg?.id).toBe(notes.shed.id);
    D().setCurrent(notes.plan, {});
    expect(pane("keeps").msg?.id).toBe(notes.plan.id);      // it follows now: a detail used to stay on its note after being let go
    key(char("p"));                                          // hold
    await until(() => tile("keeps").mode === "held", "keeps is held again");
    D().setCurrent(notes.shed, {});
    expect(pane("keeps").msg?.id).toBe(notes.plan.id);
    expect(pane("keeps").hint()).toContain("p follow");
  });

  test("reader.mode works on every reader, a former detail too, and the 'for readers' refusal is gone", async () => {
    const held = await act("reader.mode", { mode: "held" }, "follower") as any;
    expect(held).toMatchObject({ tile: "follower", mode: "held", held: true });
    expect(message()).toContain("held the reader on its note");
    const back = await act("reader.mode", { mode: "follows" }, "keeps") as any;
    expect(back).toMatchObject({ tile: "keeps", mode: "follows", held: false });
    expect(message()).toContain("let the reader follow the current note");
    // Left out, it is p's toggle.
    expect(await act("reader.mode", {}, "keeps")).toMatchObject({ mode: "held" });
    expect(await act("reader.mode", {}, "keeps")).toMatchObject({ mode: "follows" });
    await expect(act("reader.mode", { mode: "stuck" }, "keeps")).rejects.toThrow(/mode is follows, held or pinned, not stuck/);
    await expect(act("reader.hold", { on: true }, "keeps")).rejects.toThrow(/reader\.hold is now reader\.mode .*act reader\.mode tile=<reader> mode=held/);
    await expect(act("reader.mode", {}, "tree")).rejects.not.toThrow(/readers only|is for readers/);
    await act("reader.mode", { mode: "held" }, "keeps");
  });

  test("pinned: to a named page, to the shown note's own page, and refused where there is none, with the command", async () => {
    await act("open", { id: notes.plan.id }, "keeps");
    expect(pane("keeps").msg?.id).toBe(notes.plan.id);
    await expect(act("reader.mode", { mode: "pinned" }, "keeps")).rejects.toThrow(/that note has no page to pin to .* act reader\.mode mode=pinned page=<name>/);
    await expect(act("reader.mode", { mode: "pinned", page: "no-such-page" }, "keeps")).rejects.toThrow(/no page no-such-page in this outline/);
    expect(await act("reader.mode", { mode: "pinned", page: "garden-now" }, "keeps")).toMatchObject({ mode: "pinned", page: "garden-now" });
    expect(pane("keeps").msg?.id).toBe(notes.now.id);
    expect(tile("keeps")).toMatchObject({ mode: "pinned", page: "garden-now" });
    // On the page's own note, pinning needs no name.
    await act("reader.mode", { mode: "follows" }, "keeps");
    await act("open", { id: notes.now.id }, "keeps");
    expect(await act("reader.mode", { mode: "pinned" }, "keeps")).toMatchObject({ mode: "pinned", page: "garden-now" });
    // p on a pinned reader lets it follow again.
    await mine("tile.focus", {}, "keeps");
    key(char("p"));
    await until(() => tile("keeps").mode === "follows", "p lets a pinned reader follow");
    expect(pane("keeps").hint()).toContain("p hold");
    await act("reader.mode", { mode: "held" }, "keeps");
  });

  test("an open that names no tile never lands in a reader pinned to a page; naming it, or a link to it, does", async () => {
    await act("reader.mode", { mode: "pinned", page: "garden-now" }, "now");
    await act("reader.mode", { mode: "held" }, "keeps");
    await mine("tile.focus", {}, "tree");
    const out = await act("open", { id: notes.plan.id }) as any;
    expect(out.reader).not.toBe("now");
    expect(tile("now")).toMatchObject({ mode: "pinned", page: "garden-now" });
    expect(pane("now").msg?.id).toBe(notes.now.id);
  });

  test("a pin that is still looking its page up gives way to a mode chosen meanwhile", async () => {
    await act("reader.mode", { mode: "held" }, "keeps");
    const p = pane("keeps");
    const pending = p.setMode("pinned", D(), "garden-now").then(() => "pinned", (e: Error) => e.message);
    const now = await p.setMode("follows", D());
    expect(now.mode).toBe("follows");
    expect(await pending).toMatch(/mode changed again while the page was looked up/);
    expect(p.followMode).toBe("follows");
    await act("reader.mode", { mode: "held" }, "keeps");
  });

  test("an explicit link into a held reader shows the note there and keeps it held; into a pinned one it leaves the page and holds", async () => {
    await act("open", { id: notes.shed.id }, "keeps");
    expect(pane("keeps").msg?.id).toBe(notes.shed.id);
    expect(tile("keeps").mode).toBe("held");
    expect(pane("now").followMode).toBe("pinned");
    await act("open", { id: notes.shed.id }, "now");
    expect(pane("now").msg?.id).toBe(notes.shed.id);
    expect(tile("now")).toMatchObject({ mode: "held" });
    expect(tile("now").page).toBeUndefined();
    // Opening the page's own note into a pinned one keeps the pin.
    await act("reader.mode", { mode: "pinned", page: "garden-now" }, "now");
    await act("open", { id: notes.now.id }, "now");
    expect(tile("now")).toMatchObject({ mode: "pinned", page: "garden-now" });
  });

  test("a reader linked to a held reader and to a pinned one: a link followed in it lands there (alt+l, tile.link), the page leaves the pin only for another note", async () => {
    await act("reader.mode", { mode: "held" }, "keeps");
    await act("reader.mode", { mode: "follows" }, "follower");
    D().setCurrent(notes.plan, {});
    await until(() => pane("follower").msg?.id === notes.plan.id, "the follower on the plan");
    await mine("tile.link", { to: "keeps" }, "follower");
    expect(tile("follower").link).toBe("keeps");
    await act("link.follow", { n: 1 }, "follower");
    await until(() => pane("keeps").msg?.id === notes.beans.id, "the link landed in the held reader");
    expect(pane("follower").msg?.id).toBe(notes.plan.id);            // the linking reader keeps what it shows
    expect(tile("keeps").mode).toBe("held");
    // Into the pinned one: another note than its page leaves the pin and holds; nothing else is touched.
    await act("reader.mode", { mode: "pinned", page: "garden-now" }, "now");
    await mine("tile.link", { to: "now" }, "follower");
    expect(tile("follower").link).toBe("now");
    await act("link.follow", { n: 2 }, "follower");
    await until(() => pane("now").msg?.id === notes.shed.id, "the link landed in the pinned reader");
    expect(tile("now")).toMatchObject({ mode: "held" });
    await mine("tile.link", {}, "follower");
    await act("reader.mode", { mode: "pinned", page: "garden-now" }, "now");
  });

  test("^W o d opens a reader started held (a detail), ^W o r one that follows; both switch with p", async () => {
    await mine("tile.focus", {}, "tree");
    const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
    const before = new Set(get().tiles.map((t: any) => t.name));
    key(ctrl("w")); key(char("o")); key(char("d"));
    const made = () => get().tiles.find((t: any) => !before.has(t.name));
    await until(() => !!made(), "the detail ^W o d opened");
    expect(made()).toMatchObject({ kind: "reader", mode: "held", name: "detail" });
    const name = made().name;
    before.add(name);
    key(ctrl("w")); key(char("o")); key(char("r"));
    await until(() => !!made(), "the reader ^W o r opened");
    expect(made()).toMatchObject({ kind: "reader", mode: "follows" });
    expect(get().tiles.find((t: any) => t.name === name)).toMatchObject({ kind: "reader", mode: "held" });
    // The detail's p: the same toggle a reader has.
    await mine("tile.focus", {}, name);
    key(char("p"));
    await until(() => tile(name).mode === "follows", "p on the new detail");
    await mine("tile.close", {}, name);
    await mine("tile.close", {}, made().name);
  });

  test("the mode chip is on the frame, says the mode, and a click on it switches the mode", async () => {
    await act("reader.mode", { mode: "follows" }, "follower");
    D().setCurrent(notes.plan, {});
    expect(pane("follower").msg?.id).toBe(notes.plan.id);
    render();
    const chips = () => D().headPresses as { id: number; row: number; from: number; to: number }[];
    const idOf = (name: string) => [...D().names].find(([, n]: any) => n === name)[0] as number;
    const chipOf = (name: string) => { render(); return chips().find(c => c.id === idOf(name))!; };
    const c = chipOf("follower");
    expect(c).toBeDefined();
    mouse("down", c.from, c.row); mouse("up", c.from, c.row);
    await until(() => tile("follower").mode === "held", "a click on follows holds");
    const h = chipOf("follower");
    mouse("down", h.from, h.row); mouse("up", h.from, h.row);
    await until(() => tile("follower").mode === "follows", "a click on held follows (the note has no page to pin)");
    // A held reader on a note with a page goes on to pinned.
    await act("open", { id: notes.now.id }, "follower");
    const p1 = chipOf("follower");
    mouse("down", p1.from, p1.row); mouse("up", p1.from, p1.row);
    await until(() => tile("follower").mode === "held", "held");
    const p2 = chipOf("follower");
    mouse("down", p2.from, p2.row); mouse("up", p2.from, p2.row);
    await until(() => tile("follower").mode === "pinned", "a click on held pins it to the note's page");
    expect(tile("follower").page).toBe("garden-now");
    await act("reader.mode", { mode: "follows" }, "follower");
  });

  test("a saved layout in the old form (kind detail, with and without page=) comes back as readers in their modes, with their history", async () => {
    await act("reader.mode", { mode: "held" }, "keeps");
    await act("open", { id: notes.beans.id }, "keeps");
    await act("open", { id: notes.shed.id }, "keeps");
    const saved = JSON.parse(readFileSync(join(scratch.root, "door", "desk.json"), "utf8"));
    const old = JSON.parse(JSON.stringify(saved));
    const walk = (n: any): any[] => (n.t === "leaf" ? [n] : (n.kids ?? []).flatMap(walk));
    const keeps = walk(old.root).find((l: any) => l.name === "keeps"), now = walk(old.root).find((l: any) => l.name === "now");
    expect(keeps.nav).toBeDefined();
    // As the old DetailPane wrote it: kind detail, its note and history; the pinned one its page alone.
    for (const l of [keeps, now]) { l.kind = "detail"; delete l.mode; }
    delete now.note; delete now.nav;
    const again = new Desk(undefined, { saved: old, layout: undefined });
    const A = again as any;
    app.push(again);
    A.render(A.ctx);
    const aget = () => A.layoutGet() as { tiles: any[] };
    const at = (n: string) => aget().tiles.find((t: any) => t.name === n);
    expect(at("keeps")).toMatchObject({ kind: "reader", mode: "held" });
    expect(at("now")).toMatchObject({ kind: "reader", mode: "pinned", page: "garden-now" });
    await until(() => at("keeps").showing?.id === notes.shed.id && at("now").showing?.id === notes.now.id, "both restored on their notes");
    const rd = (n: string) => [...A.panes.entries()].find(([id]: any) => A.nameOf(id) === n)![1] as ReaderPane;
    expect(rd("keeps").surface.saveNav()).toEqual(keeps.nav);
    app.pop();
    A.dispose();
  });
  // PIE-761: a reader that follows holds its note while a comment is open there; the status line says so, once.
  test("a following reader with a comment open stays on its note as the current note changes and an agent opens one; it follows again once the comment closes", async () => {
    await mine("reader.mode", { mode: "follows" }, "follower");
    D().setCurrent(notes.beans, {});
    expect(pane("follower").msg?.id).toBe(notes.beans.id);
    await mine("passage.select", {}, "follower");
    await mine("comment.write", { body: "Two to a hole, or three?" }, "follower");
    expect(pane("follower").editing).toBe(true);
    D().setCurrent(notes.shed, { from: pane("keeps"), reveal: true });
    expect(pane("follower").msg?.id).toBe(notes.beans.id);
    expect(message()).toContain("keeps the comment on “Sow the beans”");
    await act("open", { id: notes.plan.id }).catch(() => null);
    expect(pane("follower").msg?.id).toBe(notes.beans.id);
    expect(pane("follower").surface.session?.composer?.text).toBe("Two to a hole, or three?");
    await mine("comment.close", { discard: true }, "follower");
    D().setCurrent(notes.plan, {});
    expect(pane("follower").msg?.id).toBe(notes.plan.id);
  });
});
