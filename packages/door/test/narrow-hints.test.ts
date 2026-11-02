// Narrow hint strips keep their full choices reachable; prefix panels still name the tile keys.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { boardScreen } from "./board-view";
import * as BV from "./board-view";
import { Desk } from "../src/desk/desk";
import { dockToEdge, splitOf, leaf, type LNode } from "../src/desk/layout";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const COLS = 120, ROWS = 40;

test("a dock at an outer edge keeps its share when it moves to the other edge", () => {
  const root = splitOf("row", [{ t: "dock", kid: leaf("tree"), edge: "left", open: false }, leaf("lanes")], [0.3, 0.7]) as LNode<string>;
  const moved = dockToEdge(root, (root as any).kids[0], "right") as any;
  expect(moved.kids[1].edge).toBe("right");
  expect(moved.weights[1] / (moved.weights[0] + moved.weights[1])).toBeCloseTo(0.3, 5);
  // One from inside the layout takes the default.
  const inner = splitOf("row", [leaf("a"), splitOf("col", [{ t: "dock", kid: leaf("b"), edge: "up", open: true }, leaf("c")], [0.5, 0.5])]) as any;
  const out = dockToEdge(inner, inner.kids[1].kids[0], "left") as any;
  expect(out.kids[0].edge).toBe("left");
  expect(out.weights[0] / out.weights.reduce((a: number, w: number) => a + w, 0)).toBeCloseTo(0.26, 5);
});

describe.skipIf(!outliner)("hint rows at 120 columns", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, garden: any;
  let key: (k: Key) => void = () => {};
  let painted: string[] = [];
  const frame = () => { app.redraw(); app.flush(); return painted.map(visible); };
  const message = () => (app as any).message as string;
  const screen = () => (app as any).stack.at(-1) as any;
  const lines = () => screen().render((screen() as any).ctx).lines.map(visible) as string[];
  const hintRow = () => lines()[ROWS - 2]!;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(scratch.root, "door", "draft.md");
    process.env.EDITOR = "tail -f";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    await make(null, "Sow the beans [type::job] [stage::todo]");
    await make(null, "Mend the gate [type::job] [stage::done]");
    garden = await make(null, "Garden jobs");
    await make(garden.id, "To do [type::virtual-branch] [query::type=job stage=todo]");
    await make(garden.id, "Done [type::virtual-branch] [query::type=job stage=done]");
    const term = { info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    // End the programs these tests started (the daily desk's tail -f): a desk left with one running is kept for D
    // (Desk.resume), and the next file's desk in this process would be this one. So the kept one is taken back and ended too.
    const end = async (s: any) => {
      for (const p of s.panes?.values?.() ?? []) p.kill?.();
      if (s instanceof Desk) await until(() => !s.holdsPrograms(), "its programs ended");
      s.dispose?.();
    };
    for (const s of (app as any).stack) await end(s);
    await end(Desk.resume());
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("a narrow hint strip opens every full hint and returns the keys to the same tile", async () => {
    const desk = new Desk(undefined, { layout: "daily" });
    app.push(desk);
    const before = desk.keys().address;
    try {
      (app as any).term.info.cols = 32;
      const row = frame()[ROWS - 2]!;
      expect(row).toContain("Tab/1-9 focus");
      const more = /\+\d+/.exec(row)!;
      expect(more).not.toBeNull();
      key({ kind: "mouse", action: "down", button: 0, x: more.index, y: ROWS - 2 });
      await until(() => frame().some(l => l.includes("all choices")), "the hint picker");
      expect(frame().join("\n")).toContain("q menu");
      expect(frame().join("\n")).toContain("^N new");
      key({ kind: "esc" });
      expect(frame().some(l => l.includes("all choices"))).toBe(false);
      expect(desk.keys().address).toBe(before);
      (app as any).term.info.cols = COLS;
      frame();
      await desk.dispatch.press("keys.more");
      expect(frame().some(l => l.includes("all choices"))).toBe(true);
      key({ kind: "esc" });
      await expect(app.act({ action: "keys.more", args: {}, as: "hint-agent-509" })).rejects.toThrow(/actions/);
    } finally { (app as any).term.info.cols = COLS; app.strips.close(); }
  });

  test("^W and ^W o show every part at once, above their row: every tile kind, with its key", () => {
    // Their panel opens after a pause (PIE-1304): none here, so it is there in the first frame.
    const was = process.env.EP0CH_KEY_PANEL_MS;
    process.env.EP0CH_KEY_PANEL_MS = "0";
    try {
      key(ctrl("w"));
      let all = lines();
      // The row says only the way out (PIE-704); the panel above it is the key table, a column per group.
      expect(hintRow()).toMatch(/\^W … · \? all keys · esc/);
      let box = all.slice(all.findIndex(l => l.includes("─ ^W  tile keys")), ROWS - 2).join("\n");
      expect(box).toMatch(/h +focus the tile to the left/);
      expect(box).toMatch(/x +close/);
      key(char("o"));
      all = lines();
      box = all.slice(all.findIndex(l => l.includes("─ ^W o  open beside")), ROWS - 2).join("\n");
      for (const [k, kind] of [["t", "outline"], ["s", "shell"], ["f", "brief"], ["q", "query"], ["l", "backlinks"]]) expect(box).toMatch(new RegExp(`${k} +${kind}`));
      key({ kind: "esc" });
      expect(lines().some(l => l.includes("tile keys") || l.includes("open beside"))).toBe(false);
    } finally { if (was === undefined) delete process.env.EP0CH_KEY_PANEL_MS; else process.env.EP0CH_KEY_PANEL_MS = was; }
  });

  test("a float on the desk names the desk's keys for putting it back, and they put it back", () => {
    const d = screen() as any;
    d.focus = [...d.names].find(([, v]: any) => v === "side")[0];
    key(ctrl("w")); key(char("f"));
    expect(d.layoutGet().floats.map((f: any) => f.name)).toEqual(["side"]);
    const frame = lines().join("\n");
    expect(frame).toContain("^W f back in");
    expect(frame).not.toContain("o back in");
    key(ctrl("w")); key(char("f"));
    expect(d.layoutGet().floats).toEqual([]);
  });

  test("a dock put at the top edge says so in words", async () => {
    const d = screen() as any;
    d.focus = [...d.names].find(([, v]: any) => v === "preview")[0];
    key(ctrl("w")); key(char("p"));
    expect(message()).toContain("docked preview to the top edge");
    key(ctrl("w")); key(char("p"));
    app.pop();
  });

  test("a preset (Waiting) doesn't offer alt+d, which it refuses; its keys window lists the rest", () => {
    const w = openScreen("waiting") as Desk;
    app.push(w);
    key(char("?"));
    const all = lines().join("\n");
    expect(all).toContain("^N new");
    expect(all).not.toContain("alt+d daily");
    key({ kind: "esc" });
    app.pop();
  });

  test("the board's outline keeps its width when S moves it to the other side", async () => {
    const b = boardScreen(garden.id, false);
    app.push(b);
    await until(() => BV.view(b).lanes.length === 2 && BV.view(b).lanes.every((l: any) => l.items), "the lanes", 10_000);
    const share = () => { const t: any = b.layoutGet().tree; const d = t.kids.find((k: any) => k.dock); return { edge: d.dock, share: d.share }; };
    expect(share()).toEqual({ edge: "left", share: 0.3 });
    key(char("t"));
    key(char("S"));
    await until(() => share().edge === "right", "the outline on the right");
    expect(share().share).toBeCloseTo(0.3, 2);
    key(char("S"));
    await until(() => share().edge === "left", "the outline back on the left");
    expect(share().share).toBeCloseTo(0.3, 2);
    app.pop();
  });
});
