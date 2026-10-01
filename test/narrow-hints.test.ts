// PIE-509: the hint row on a narrow screen (120 columns), found by walking the door in a real pane. A row too long
// for the screen ends "? more", and ? (or a click on it) shows every part in a box above it; a ^W chord's row
// shows the box at once (^W o lists every tile kind). The keys a row names work on that screen: a float on the
// desk docks with ^W f (o and x are the board's), and a preset (the brief) doesn't offer alt+d. Moving the board's
// outline across with S keeps its width. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { DeliveryBoard } from "../src/desk/delivery";
import { Desk } from "../src/desk/desk";
import { drawerToEdge, splitOf, leaf, type LNode } from "../src/desk/layout";
import { Waiting } from "../src/hub/waiting";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const COLS = 120, ROWS = 40;

test("a drawer at an outer edge keeps its share when it moves to the other edge", () => {
  const root = splitOf("row", [{ t: "drawer", kid: leaf("tree"), edge: "left", open: false }, leaf("lanes")], [0.3, 0.7]) as LNode<string>;
  const moved = drawerToEdge(root, (root as any).kids[0], "right") as any;
  expect(moved.kids[1].edge).toBe("right");
  expect(moved.weights[1] / (moved.weights[0] + moved.weights[1])).toBeCloseTo(0.3, 5);
  // One from inside the layout takes the default.
  const inner = splitOf("row", [leaf("a"), splitOf("col", [{ t: "drawer", kid: leaf("b"), edge: "up", open: true }, leaf("c")], [0.5, 0.5])]) as any;
  const out = drawerToEdge(inner, inner.kids[1].kids[0], "left") as any;
  expect(out.kids[0].edge).toBe("left");
  expect(out.weights[0] / out.weights.reduce((a: number, w: number) => a + w, 0)).toBeCloseTo(0.26, 5);
});

describe.skipIf(!outliner)("hint rows at 120 columns", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, garden: any;
  let key: (k: Key) => void = () => {};
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
    const term = { info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("the desk's row is cut between parts and ends ? more; ? shows the rest in a box above it, and the next key puts it away", async () => {
    const desk = new Desk(undefined, { layout: "daily" });
    app.push(desk);
    const row = hintRow();
    expect(row).toContain("Tab/1-9 focus");
    expect(row).toMatch(/· \? more\s/);
    expect(row).not.toContain("q menu");
    key(char("?"));
    let all = lines();
    const box = all.findIndex(l => l.includes("─ keys "));
    expect(box).toBeGreaterThan(ROWS - 10);
    const shown = all.slice(box, ROWS - 2).join("\n");
    expect(shown).toContain("q menu");
    expect(shown).toContain("alt+k lock");
    expect(shown).toContain("any key closes");
    // Esc only puts it away; any other key puts it away and does what it does.
    key({ kind: "esc" });
    expect(lines().some(l => l.includes("─ keys "))).toBe(false);
    // A click on "? more" shows it too, as keys.more.
    const at = hintRow().indexOf("? more");
    key({ kind: "mouse", action: "down", button: 0, x: at + 1, y: ROWS - 2 });
    expect(lines().some(l => l.includes("─ keys "))).toBe(true);
    key({ kind: "mouse", action: "down", button: 0, x: at + 1, y: ROWS - 2 });
    expect(lines().some(l => l.includes("─ keys "))).toBe(false);
    // Another key puts it away and does its own job (Tab moves the keys on); a click elsewhere puts it away too.
    const d = screen() as any;
    key(char("?"));
    const was = d.focus;
    key({ kind: "tab" });
    expect(lines().some(l => l.includes("─ keys "))).toBe(false);
    expect(d.focus).not.toBe(was);
    key(char("?"));
    const r = d.layoutGet().tiles.find((t: any) => t.name === "now").rect;                  // a reader, not a terminal
    key({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y: r.row + 3 });
    key({ kind: "mouse", action: "up", button: 0, x: r.col + 3, y: r.row + 3 });
    expect(lines().some(l => l.includes("─ keys "))).toBe(false);
    // It's the person's view: an agent is told where the keys are instead.
    await expect(app.act({ action: "keys.more", args: {}, as: "hint-agent-509" })).rejects.toThrow(/actions/);
  });

  test("^W and ^W o show every part at once, above their row: every tile kind, with its key", () => {
    key(ctrl("w"));
    let all = lines();
    expect(hintRow()).toMatch(/· …\s/);
    let box = all.slice(all.findIndex(l => l.includes("─ keys ")), ROWS - 2).join("\n");
    expect(box).toContain("! shell");
    expect(box).toContain("x close");
    key(char("o"));
    all = lines();
    box = all.slice(all.findIndex(l => l.includes("─ keys ")), ROWS - 2).join("\n");
    for (const kind of ["t outline", "s shell", "f brief", "q query", "l backlinks"]) expect(box).toContain(kind);
    key({ kind: "esc" });
    expect(lines().some(l => l.includes("─ keys "))).toBe(false);
  });

  test("a float on the desk names the desk's keys for docking it, and they dock it", () => {
    const d = screen() as any;
    d.focus = [...d.names].find(([, v]: any) => v === "side")[0];
    key(ctrl("w")); key(char("f"));
    expect(d.layoutGet().floats.map((f: any) => f.tile)).toEqual(["side"]);
    const frame = lines().join("\n");
    expect(frame).toContain("^W f dock");
    expect(frame).not.toContain("o dock");
    key(ctrl("w")); key(char("f"));
    expect(d.layoutGet().floats).toEqual([]);
  });

  test("a drawer put at the top edge says so in words", async () => {
    const d = screen() as any;
    d.focus = [...d.names].find(([, v]: any) => v === "preview")[0];
    key(ctrl("w")); key(char("p"));
    expect(message()).toContain("in a drawer on the top");
    key(ctrl("w")); key(char("p"));
    app.pop();
  });

  test("a preset (Waiting) doesn't offer alt+d, which it refuses; its ? more lists the rest", () => {
    const w = new Waiting();
    app.push(w);
    key(char("?"));
    const all = lines().join("\n");
    expect(all).toContain("alt+k lock");
    expect(all).not.toContain("alt+d daily");
    key({ kind: "esc" });
    app.pop();
  });

  test("the board's outline keeps its width when S moves it to the other side", async () => {
    const b = new DeliveryBoard(garden.id, false);
    app.push(b);
    await until(() => (b as any).lanes.length === 2 && (b as any).lanes.every((l: any) => l.items), "the lanes", 10_000);
    const share = () => { const t = (b as any).layoutGet().tree; const d = t.kids.find((k: any) => k.drawer); return { edge: d.drawer, share: d.share }; };
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
