// PIE-727: a refused key or click is said on the focused tile's frame (and the status bar), loud when the same key is
// refused again, until a different key; and q leaves a desk holding only a group, as on any desk. Scratch services and
// the showcase's fictional seed only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App, pressOf } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

test("a press is a key whole, or a click by where it landed; a release, a drag or the wheel is no press", () => {
  expect(pressOf({ kind: "char", ch: "q" })).toBe(pressOf({ kind: "char", ch: "q" }));
  expect(pressOf({ kind: "char", ch: "q" })).not.toBe(pressOf({ kind: "char", ch: "x" }));
  expect(pressOf({ kind: "mouse", action: "down", button: 0, x: 3, y: 4 })).toBe("click:0:3,4");
  expect(pressOf({ kind: "mouse", action: "up", button: 0, x: 3, y: 4 })).toBeNull();
  expect(pressOf({ kind: "mouse", action: "wheel-down", button: 0, x: 3, y: 4 })).toBeNull();
});

describe.skipIf(!outliner)("refusals and a desk holding only a group, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const A = () => app as any;
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.press(action, args, tile) as Promise<any>;
  const press = (...ks: Key[]) => { for (const k of ks) key(k); };
  const frame = () => desk.render(app).lines.map(plain).join("\n");
  const top = () => A().stack.at(-1);
  const names = () => (D().layoutGet().tiles as any[]).map(t => t.name);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await scratch.seedShowcase();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    frame();
  }, 30_000);
  afterAll(async () => { D()?.dispose?.(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a desk holding only a group: Esc is refused on the group's focused tile, loud the second time, gone on another key; q leaves", async () => {
    // The person gathers every tile into one group (picked, then ^W G's tile.group selected=true).
    const all = names();
    expect(all.length).toBeGreaterThan(1);
    for (const n of all) await mine("tile.select", { on: true }, n);
    await mine("tile.group", { selected: true });
    frame();
    expect(names()).toHaveLength(1);
    expect(D().pane(names()[0]).group).toBe(true);
    // Esc with nothing to close: said on the focused tile inside the group, in the warning tone, and on the status bar.
    press({ kind: "esc" });
    expect(app.refusal()).toEqual({ text: "nothing to close · q leaves", loud: false });
    expect(frame()).toContain("✗ nothing to close · q leaves");
    expect(A().message).toBe("nothing to close · q leaves");
    // Said once: the group's own frame (the tile holding the screen) doesn't repeat it.
    expect(frame().split("✗ nothing to close").length).toBe(2);
    // The same key again: loud, and it doesn't time out.
    press({ kind: "esc" });
    expect(app.refusal()).toEqual({ text: "nothing to close · q leaves", loud: true });
    expect(A().messageUntil).toBe(Infinity);
    const raw = desk.render(app).lines.find(l => plain(l).includes("✗ nothing to close"))!;
    expect(raw).toContain("\x1b[1m");                         // bold
    expect(raw).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);           // on the warning surface
    // A different key: gone, the status bar's copy too.
    press({ kind: "char", ch: "j" });
    expect(app.refusal()).toBeNull();
    expect(A().message).not.toBe("nothing to close · q leaves");
    expect(frame()).not.toContain("✗ nothing to close");
    // The same key with a different one between (esc j esc) starts over: quiet.
    press({ kind: "esc" });
    expect(app.refusal()).toMatchObject({ loud: false });
    press({ kind: "char", ch: "j" }, { kind: "esc" });
    expect(app.refusal()).toMatchObject({ loud: false });
    // A refusal that lands after the person moved on (an action's promise) is said on the status bar alone.
    await Bun.sleep(50);                                       // the j's own answer (this group's reader shows no note) lands
    const at = app.pressNow();
    press({ kind: "tab" });
    app.refuse("a late refusal", at);
    expect(app.refusal()).toBeNull();
    expect(A().message).toBe("a late refusal");
    // An agent's refusal is the agent's: thrown to it, said with who it is, never on the person's tile.
    await expect(app.act({ action: "tile.zoom", tile: "nowhere-727", args: {}, as: "refusal-agent-727" })).rejects.toThrow();
    expect(app.refusal()).toBeNull();
    expect(A().message).toContain("refusal-agent-727");
    // Inside the group (^W e, mount.enter), q comes out of it; the screen stays.
    const g = D().pane(names()[0]);
    press({ kind: "char", ch: "w", ctrl: true }, { kind: "char", ch: "e" });
    expect(g.inside).toBe(true);
    press({ kind: "char", ch: "q" });
    expect(g.inside).toBe(false);
    expect(top()).toBe(desk);
    // q leaves the screen, as on any desk (it was refused: "the group is a tile").
    press({ kind: "char", ch: "q" });
    expect(top()).toBeInstanceOf(MainMenu);
    expect(A().message).not.toContain("is a tile");
  });

  test("a refused click says why on the focused tile too: a dimmed row of the tile menu", async () => {
    desk = new Desk();
    app.push(desk);
    frame();
    // The tile menu of the focused tile (its ⋯, ^W .); a row it would refuse is dimmed, and a click on it says why.
    const menu = () => press({ kind: "char", ch: "w", ctrl: true }, { kind: "char", ch: "." });
    menu();
    expect(D().overlays.top()?.name).toBe("tile menu");
    const rows = D().overlays.top().items as { label: string; refused?: string }[];
    const no = rows.find(r => r.refused);
    expect(no).toBeDefined();
    const lines = desk.render(app).lines.map(plain), y = lines.findIndex(l => l.includes(` ${no!.label}`));
    expect(y).toBeGreaterThan(0);
    const x = lines[y]!.indexOf(` ${no!.label}`) + 2;
    const click = () => press({ kind: "mouse", action: "down", button: 0, x, y }, { kind: "mouse", action: "up", button: 0, x, y });
    click();
    expect(app.refusal()).toEqual({ text: no!.refused!, loud: false });
    expect(frame()).toContain(`✗ ${no!.refused!.slice(0, 20)}`);
    // The same again, by the person's keys and click (^W ., the same row): loud.
    menu();
    frame();
    click();
    expect(app.refusal()).toEqual({ text: no!.refused!, loud: true });
    // A key: gone.
    press({ kind: "char", ch: "j" });
    expect(app.refusal()).toBeNull();
  });
});
