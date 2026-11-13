// PIE-1780: each desk question has one decider. Where two deciders gave different answers (desk-split's inventory,
// PIE-1778), the case is here as Evan meets it: a real tmux pane over a scratch service (TallyDoors), by his keys, or an
// agent's act on the same door. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import "../src/screens";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard, type Actor } from "../src/socket";
import { INVITES } from "../src/surface/invite";
import { outliner, Scratch, until } from "./scratch";
import { TallyDoors } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("one decider per desk question (PIE-1780)", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  // Which tile a ^W key acts on: the ^W table asked tileId(focus), which threw on an emptied drawer and took the door
  // down (^W z: "the door crashed: WeakMap keys must be objects"), where focusId says none. And tileNamed and
  // tileNumbered looked a tile up the same way with two refusals; the second said "no tile undefined on the screen".
  test("an emptied drawer says it's empty to ^W z, as to every tile key", async () => {
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 120, 30);
    try {
      const drawerTiles = () => (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: { tile: string }[] }[]).find(l => l.drawer)?.tiles ?? [];
      // His keys into the drawer's shell; the shell ended, its tile closed: the drawer is empty, his keys still in it.
      p.keys("M-a");
      await until(() => drawerTiles().length > 0, "the drawer's shell");
      await Bun.sleep(500);
      p.type("exit"); p.keys("Enter");
      await Bun.sleep(800);
      for (let i = 0; i < 4 && drawerTiles().length; i++) { p.keys("C-w", "x"); await Bun.sleep(400); }
      expect(drawerTiles()).toEqual([]);
      p.keys("C-w", "z");
      await Bun.sleep(600);
      const frame = p.capture();
      expect(frame).not.toContain("the door crashed");
      expect(frame).not.toContain("no tile undefined");
      expect(frame).toContain("this screen is empty");
    } finally { p.close(); }
  }, 60_000);

  // An agent leaves the tile the person's keys are on alone, and only where they are: close, take, gather and spill
  // asked that, float asked only "is it the screen's focus", so with his keys in the drawer an agent's float of the
  // desk's tile was refused as his.
  test("with his keys in the drawer, an agent floats the desk's tile as it closes or gathers it", async () => {
    const p = await doors.pane(await doors.create("Cold frame\nprop the lid"), "Cold frame", 120, 30);
    try {
      const desk = () => (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: { tile: string; name: string; focused: boolean }[] }[]).find(l => !l.drawer)!.tiles;
      p.keys("C-w", "v");   // a second tile, so there's one to float over
      await until(() => desk().length === 2, "the tile beside");
      const reader = desk().find(t => t.focused)!;
      p.keys("M-a");
      await until(() => p.capture().includes("typing in shell"), "his keys in the drawer's shell");
      const floated = p.act("tile.float", `tile=${reader.tile}`);
      expect({ ok: floated.ok, said: floated.ok ? "" : floated.out.trim() }).toEqual({ ok: true, said: "" });
    } finally { p.close(); }
  }, 60_000);

  // Who gets the keys after the tree's ⏎: placement's answer, and the tree's own focusKind("reader") on top of it, which
  // went to the first reader not pinned, whether or not the note landed there. With that reader folded to a spine the
  // note opened in the other one and his keys went to the spine.
  test("the tree's ⏎ gives the keys to the reader the note lands in, not a folded one before it", async () => {
    await doors.create("Potting shed\nsort the pots");
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 160, 34);
    try {
      type T = { tile: string; name: string; kind: string; focused: boolean; showing?: { title: string } };
      const desk = () => (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: T[] }[]).find(l => !l.drawer)!.tiles;
      const first = desk().find(t => t.kind === "reader")!;
      expect(p.act("tile.open", "kind=reader").ok).toBe(true);
      expect(p.act("tile.open", "kind=tree").ok).toBe(true);
      await until(() => desk().length === 3, "a second reader and a tree");
      const tree = desk().find(t => t.kind === "tree")!;
      expect(p.act("tile.focus", `tile=${tree.tile}`).ok).toBe(true);
      await until(() => desk().find(t => t.focused)?.kind === "tree", "his keys on the tree");
      const folded = p.act("tile.collapse", `tile=${first.tile}`, "on=true");
      expect([folded.ok, folded.out.split("\n")[0]]).toEqual([true, expect.anything()]);
      p.keys("Enter");
      await until(() => desk().some(t => t.kind === "reader" && t.tile !== first.tile && t.showing), "the note opened");
      await Bun.sleep(300);
      const focused = desk().find(t => t.focused)!;
      expect({ focused: focused.tile === first.tile ? "the folded reader" : focused.kind, showing: !!focused.showing }).toEqual({ focused: "reader", showing: true });
    } finally { p.close(); }
  }, 60_000);

  // Which reader the person's open lands in, naming none: placement's rule (a wire, the screen's rule, else the first
  // reader not pinned, never a folded one), and openBy's own pickReader beside it, which took the first reader not
  // pinned in any state. From the power bar, with the first reader folded, the note opened in the spine.
  test("the person's open from the power bar lands where opens land, not in a folded reader", async () => {
    await doors.create("Potting shed\nsort the pots");
    const p = await doors.pane(await doors.create("Seed tray\nsow the leeks"), "Seed tray", 160, 34);
    try {
      type T = { tile: string; kind: string; focused: boolean; showing?: { title: string } };
      const desk = () => (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: T[] }[]).find(l => !l.drawer)!.tiles;
      const first = desk().find(t => t.kind === "reader")!;
      expect(p.act("tile.open", "kind=reader").ok).toBe(true);
      await until(() => desk().length === 2, "a second reader");
      expect(p.act("tile.open", "kind=tree").ok).toBe(true);
      await until(() => desk().length === 3, "a tree");
      const tree = desk().find(t => t.kind === "tree")!;
      expect(p.act("tile.focus", `tile=${tree.tile}`).ok).toBe(true);
      await until(() => desk().find(t => t.focused)?.kind === "tree", "his keys on the tree");
      expect(p.act("tile.collapse", `tile=${first.tile}`, "on=true").ok).toBe(true);
      p.keys("C-k");
      await Bun.sleep(400);
      p.type("Potting shed");
      await until(() => p.capture().includes("Potting shed"), "the bar's match");
      await Bun.sleep(600);
      p.keys("Enter");
      await until(() => desk().some(t => t.showing?.title === "Potting shed"), "the note opened");
      const at = desk().find(t => t.showing?.title === "Potting shed")!;
      expect(at.tile === first.tile ? "the folded reader" : "where opens land").toBe("where opens land");
    } finally { p.close(); }
  }, 60_000);
});

// What a press invites acts fully as the person (surface/invite.ts): a run the person's click started may open the prompt,
// the picker, the panel or the menu a key would. Five desk actions asked `actor.kind` instead, so a pressed script got
// "screen.save needs name=" and no ^W panel. One decider, the dispatcher's takesKeys, answers them all.
describe.skipIf(!outliner)("a pressed run opens what the person's key opens (PIE-1780)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  const D = () => desk as any;
  const pressed = (): Actor => ({ kind: "agent", id: "script:tidy", run: "run-1780", invitation: INVITES.mint("you") });
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    desk.render(D().ctx);
    await until(() => D().panes.size > 0, "the desk's tiles");
  }, 30_000);
  afterAll(async () => { D().dispose(); board.close(); await scratch.dispose(); });

  test("keys.panel from a press opens the ^W panel on screen; an unpressed agent gets the groups as data", async () => {
    await app.dispatch.act({ action: "keys.panel", args: { prefix: "^W" } }, { kind: "agent", id: "plain-agent" });
    expect(D().prefix).toBe("");
    await app.dispatch.act({ action: "keys.panel", args: { prefix: "^W" } }, pressed());
    expect(D().prefix).toBe("wm");
    D().prefix = "";
  });
  test("screen.save with no name from a press opens the name prompt, as the person's ^W w does", async () => {
    await app.dispatch.act({ action: "screen.save", args: {} }, pressed());
    expect(D().overlaid()).toBe(true);
    D().overlays.key({ kind: "esc" }, desk);
  });
});
