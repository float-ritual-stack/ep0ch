// PIE-814: what a following reader follows is on its mode chip and set by one action, `reader.follow` (P, a click on
// the chip's picker, act): the current note, a tile with a selection (a link with the preview role, alt+l's one model,
// saved with the layout), or nothing (held). A tree in a shut dock that moves the current note is named on the chip;
// one starting with no current note there sets none. Scratch outline, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const leaf = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });

describe.skipIf(!outliner)("what a following reader follows (PIE-814)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const render = () => desk.render(D().ctx);
  const pane = (name: string): any => [...D().panes.entries()].find(([id]: any) => D().nameOf(id) === name)?.[1];
  const r = (name: string) => pane(name) as ReaderPane;
  const mine = (action: string, args: Record<string, unknown>, tile: string) => D().dispatch.act({ action, args, tile }, { kind: "user" });
  const act = (action: string, args: Record<string, unknown>, tile: string) => app.act({ action, args, tile, as: "follow-agent" }) as Promise<any>;
  const chip = (name: string) => { render(); const id = [...D().names].find(([, n]: any) => n === name)[0]; return D().headPresses.find((c: any) => c.id === id); };
  /** The chip's words, as the frame draws them (and checked to be on the frame). */
  const chipText = (name: string) => {
    const c = chip(name), text = r(name).headControls(60, D())?.[0]?.text ?? null;
    if (c && text) expect((D().render(D().ctx).lines[c.row] as string).replace(/\x1b\[[\d;]*m/g, "")).toContain(text);
    return text;
  };
  const notes: any[] = [];
  const spec = (open: boolean) => ({ name: "f", title: "f", layout: { focus: "a", root: { t: "split", dir: "row", weights: [0.25, 0.375, 0.375], kids: [
    { t: "dock", edge: "left", open, kid: leaf("tree", "tree") }, leaf("reader", "a"), leaf("reader", "b"),
  ] } } }) as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (const t of ["Prune the apple tree\nIn late winter.", "Mulch the beds\nBark, not straw.", "Fix the gate\nThe latch sticks."]) notes.push(await board.createBlock(null, t));
    const term = { info: { cols: 200, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { D()?.dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a tree in a shut dock sets no current note as it starts; one in sight does", async () => {
    desk = new Desk(spec(false)); app.push(desk); render();
    await until(() => pane("tree")?.list().length > 0, "the tree's rows");
    await Bun.sleep(150);
    expect(D().current).toBeNull();
    expect(r("a").msg).toBeFalsy();
    D().dispose(); app.pop?.();
    desk = new Desk(spec(true)); app.push(desk); render();
    await until(() => !!D().current, "the first root is the current note");
  }, 20_000);

  test("the chip says whether the reader shows the current note", async () => {
    D().setCurrent(notes[0], {});
    expect(chipText("a")).toBe("shows the current note");
    // The tree shut in its dock, its selection moving the current note (as its row did for Evan).
    await mine("tile.focus", {}, "a");
    await mine("tile.slide", { open: false }, "tree");
    D().setCurrent(notes[1], { from: pane("tree") });
    expect(D().shownNow(pane("tree"))).toBe(false);
    expect(chipText("a")).toBe("shows the current note");
  });

  test("reader.follow source=<tile>: a select wire; the tree's selection shows there, held from the current note", async () => {
    expect(await act("reader.follow", { source: "tree" }, "b")).toMatchObject({ source: "tree" });
    expect(D().layoutGet().tiles.find((t: any) => t.name === "tree").wires).toContainEqual({ verb: "select", to: D().layoutGet().tiles.find((t: any) => t.name === "b").id });
    expect(chipText("b")).toBe("stays put");
    const was = r("b").msg?.id;
    // The current note moved from elsewhere: b stays (it follows the tree, not the current note).
    D().setCurrent(notes[2], {});
    expect(r("b").msg?.id).toBe(was);
    expect(r("a").msg?.id).toBe(notes[2].id);
    // The tree's selection: b shows it.
    D().setCurrent(notes[0], { from: pane("tree") });
    await until(() => r("b").msg?.id === notes[0].id, "b shows the tree's selection");
    // Saved with the layout and back.
    const saved = D().layoutSpec();
    D().build(saved, false); render();
    expect(D().followSource(r("b"))?.name).toBe("tree");
    expect(chipText("b")).toBe("stays put");
    await until(() => r("b").msg?.id === notes[0].id, "b back on its note");
  });

  test("source=none holds it; source=current follows again and keeps its note; a bad source is refused with why", async () => {
    await act("reader.follow", { source: "none" }, "b");
    expect(chipText("b")).toBe("stays put");
    expect(D().layoutGet().tiles.find((t: any) => t.name === "tree").link).toBeFalsy();
    D().setCurrent(notes[1], { from: pane("tree") });
    expect(r("b").msg?.id).toBe(notes[0].id);
    await act("reader.follow", { source: "current" }, "b");
    expect(chipText("b")).toBe("shows the current note");
    // A refused source leaves it as it was: still following the current note, and a tile it follows stays followed.
    await expect(act("reader.follow", { source: "b" }, "b")).rejects.toThrow(/no selection to follow/);
    expect(r("b").followMode).toBe("follows");
    await act("reader.follow", { source: "tree" }, "b");
    await expect(act("reader.follow", { source: "nowhere" }, "b")).rejects.toThrow();
    await expect(act("reader.mode", { mode: "pinned" }, "b")).rejects.toThrow(/no page to pin/);
    expect(D().followSource(r("b"))?.name).toBe("tree");
    // A locked screen relinks nothing: refused before anything changes.
    await act("reader.follow", { source: "current" }, "b");
    await mine("layout.lock", { on: true }, "b");
    await expect(mine("reader.follow", { source: "tree" }, "b")).rejects.toThrow(/lock/);
    expect(r("b").followMode).toBe("follows");
    await mine("layout.lock", { on: false }, "b");
    await expect(act("reader.follow", {}, "b")).rejects.toThrow(/source=current, source=none or source=<tile>/);
  });

  test("P and the state chip open the policy panel; Shows changes the reader state", async () => {
    await mine("tile.focus", {}, "b");
    key({ kind: "char", ch: "P" });
    expect(D().overlaid()).toBe(true);
    key({ kind: "esc" } as Key);
    const c = chip("b");
    key({ kind: "mouse", action: "down", button: 0, x: c.from, y: c.row } as Key);
    key({ kind: "mouse", action: "up", button: 0, x: c.from, y: c.row } as Key);
    expect(D().overlays.top()?.name).toBe("policy");
    key({ kind: "enter" });
    await until(() => r("b").holding, "the Shows row makes b stay put");
    key({ kind: "esc" });
    expect(chipText("b")).toBe("stays put");
    // p lets go: it follows the current note again, keeping its note.
    const kept = r("b").msg?.id;
    key({ kind: "char", ch: "p" });
    await until(() => r("b").followMode === "follows", "follows");
    expect(D().followSource(r("b"))).toBeNull();
    expect(r("b").msg?.id).toBe(kept);
  });
  const regressionDesk = async (kids: any[]) => {
    if (desk) { desk.dispose(); app.pop(); }
    desk = new Desk({ name: "regressions", title: "regressions", layout: { root: { t: "split", dir: "row", weights: kids.map(() => 1), kids } } } as any);
    app.push(desk); render();
    await until(() => pane("tree")?.list().length > 0, "the source tree");
  };

  test("saved preview-role links still show selections after loading (wave 1)", async () => {
    for (const kind of ["tree", "backlinks"]) for (const role of [undefined, "preview", "target"]) {
      await regressionDesk([leaf("tree", "tree"), leaf(kind, "source", { link: "a", ...(role ? { linkRole: role } : {}) }), leaf("reader", "a", { mode: "held", note: notes[0].id })]);
      await mine("open", { id: notes[0].id }, "a");
      D().setCurrent(notes[1], { from: pane("source") });
      expect(r("a").msg?.id).toBe((role ?? (kind === "backlinks" ? "target" : "preview")) === "target" ? notes[0].id : notes[1].id);
    }
  });

  test("selecting while the target has a comment keeps the draft without opening a detail beside it (wave 2)", async () => {
    await regressionDesk([leaf("tree", "tree", { wires: [{ verb: "select", to: "a" }] }), leaf("reader", "a", { mode: "held", note: notes[0].id })]);
    await until(() => !!r("a").msg && !r("a").msg?.partial, "the whole note");
    await mine("passage.select", {}, "a");
    await mine("comment.write", { body: "Keep this thought" }, "a");
    const before = D().layoutGet().tiles.map((t: any) => t.name), kept = r("a").msg?.id;
    try {
      D().setCurrent(notes[1], { from: pane("tree") });
      expect(D().layoutGet().tiles.map((t: any) => t.name)).toEqual(before);
      expect(r("a").msg?.id).toBe(kept);
      expect((r("a") as any).surface.session.composer.text).toBe("Keep this thought");
    } finally { await mine("comment.close", { discard: true }, "a"); }
  });

  test("changing the reader's follow source stops selections from the former source (wave 5)", async () => {
    await regressionDesk([leaf("tree", "tree"), leaf("tree", "other"), leaf("reader", "a", { mode: "held", note: notes[0].id })]);
    await until(() => pane("other")?.list().length > 0, "the other source");
    await mine("reader.follow", { source: "tree" }, "a");
    await mine("reader.follow", { source: "other" }, "a");
    D().setCurrent(notes[1], { from: pane("other") });
    expect(r("a").msg?.id).toBe(notes[1].id);
    D().setCurrent(notes[2], { from: pane("tree") });
    expect(r("a").msg?.id).toBe(notes[1].id);
  });

});
