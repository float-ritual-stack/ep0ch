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
