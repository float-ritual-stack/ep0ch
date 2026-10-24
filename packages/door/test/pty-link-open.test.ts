// PIE-1257: a link pressed in a program running in a terminal tile (Claude Code's reference press, the `door_open`
// tool) opens where that tile's open wire points. The program's half is real: the tile's program writes the EP0CH_TILE
// and EP0CH_TILE_ID the door gave it, the mod's own `doorTileOf` picks the tile it names, and the outliner's
// `door-open` (what the mod runs) asks the door's control socket. Only Claude Code's onPress can't be synthesized from
// the door's side (it forwards SGR bytes; the program turns a press into that call), so the test makes the call.
// Scratch host, fictional notes, a `cat` behind a three-line script.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { startControl } from "../src/control";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { Mirror } from "../src/mirror";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const OUTLINER_CLI = join(import.meta.dir, "../../outliner/src/cli.ts");
const mod = (file: string) => import(join(import.meta.dir, "../../claude-mod/hooks", file));
const USER = { kind: "user" } as const;
const AS = "pty-link-1257";

describe.skipIf(!outliner)("a link pressed in a terminal tile opens where the tile's open wire points (PIE-1257)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "ENVOUT"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-ptylink-"));
    process.env.EP0CH_STATE = state;
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  /** A program that tells the test the tile variables the door gave it, then stays up. */
  function program(name: string): { cmd: string[]; seen: () => { EP0CH_TILE: string; EP0CH_TILE_ID: string } } {
    const dir = join(state, "bin"), out = join(state, `${name}.env`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s|%s' "$EP0CH_TILE" "$EP0CH_TILE_ID" > ${out}\nexec cat\n`);
    chmodSync(path, 0o755);
    return { cmd: [path], seen: () => { const [EP0CH_TILE = "", EP0CH_TILE_ID = ""] = readFileSync(out, "utf8").split("|"); return { EP0CH_TILE, EP0CH_TILE_ID }; } };
  }

  async function door(tile: { name: string; cmd: string[] } | null) {
    const term: any = { info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const control = await startControl({ app, mirror: new Mirror(140, 40), info: () => ({ cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }) }, join(state, "door.sock"));
    if (tile) {
      await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: tile.cmd.join(" "), name: tile.name }, tile: "reader" }, USER);
      (app as any).paint();
      await until(() => (desk.pane(tile.name) as PtyPane | undefined)?.running === true, `${tile.name} runs`);
    }
    return { app, desk, control, close() { control.close(); app.quit(); } };
  }

  /** What the Claude mod does on a press, from the program's side: the tile its variables name, `door-open` as the mod runs it. */
  async function press(control: string, id: string, vars: { EP0CH_TILE: string; EP0CH_TILE_ID: string }) {
    const { doorTileOf } = await mod("where.ts");
    const from = doorTileOf(vars);
    const p = Bun.spawn(["bun", OUTLINER_CLI, "door-open", id, "--control", control, "--actor", AS, ...(from ? ["--from", from] : [])], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", EP0CH_OUTLINES: scratch.env.EP0CH_OUTLINES ?? "" } });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { from, code, stdout, stderr, answer: code === 0 ? JSON.parse(stdout) as { tile?: string; name?: string; reader?: string } : null };
  }
  const shown = (d: Desk) => Object.fromEntries(d.layoutGet().tiles.filter((t: any) => t.showing).map((t: any) => [t.name, t.showing.id]));
  const names = (d: Desk) => d.layoutGet().tiles.map((t: any) => t.name);

  test("a terminal on the screen wired to a reader of the screen", async () => {
    const prog = program("kettle");
    const d = await door({ name: "kettle", cmd: prog.cmd });
    try {
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the program saw its variables");
      const note = await board.createBlock(null, "A letter from the potting shed");
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "det" }, tile: "reader" }, USER);
      await d.desk.dispatch.act({ action: "tile.link", tile: "kettle", args: { to: "det" } }, USER);
      const before = { names: names(d.desk), shown: shown(d.desk), focus: d.desk.layoutGet().focus };
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
      expect(r.answer).toMatchObject({ name: "det" });
      expect(shown(d.desk)).toEqual({ ...before.shown, det: note.id });
      expect(names(d.desk)).toEqual(before.names);
      expect(d.desk.layoutGet().focus).toBe(before.focus);
    } finally { d.close(); }
  });

  test("a terminal in the drawer wired to a reader of the drawer", async () => {
    const prog = program("kettle");
    const d = await door({ name: "kettle", cmd: prog.cmd });
    try {
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the program saw its variables");
      const note = await board.createBlock(null, "A letter from the greenhouse");
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "det" } }, USER);
      await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { to: "det" } }, USER);
      await drawer.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      const before = { screen: shown(d.desk), drawer: names(drawer), screenNames: names(d.desk) };
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
      expect(r.answer).toMatchObject({ name: "det" });
      expect(shown(drawer)).toEqual({ det: note.id });
      expect(shown(d.desk)).toEqual(before.screen);
      expect(names(drawer)).toEqual(before.drawer);
      expect(names(d.desk)).toEqual(before.screenNames);
    } finally { d.close(); }
  });

  test("the drawer's own terminal (its program's name is not its tile's) wired to a reader of the drawer", async () => {
    const prog = program("potting-agent");
    process.env.EP0CH_DAILY_AGENT = prog.cmd[0]!;
    const d = await door(null);
    try {
      await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      (d.app as any).paint();
      await until(() => !!d.app.drawer.desk, "the drawer's desk");
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the drawer's program saw its variables");
      const note = await board.createBlock(null, "A letter from the compost heap");
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "det" } }, USER);
      await drawer.dispatch.act({ action: "tile.link", tile: "drawer.agent", args: { to: "det" } }, USER);
      await drawer.dispatch.act({ action: "tile.focus", tile: "drawer.agent" }, USER);
      const before = { screen: shown(d.desk), drawer: names(drawer), screenNames: names(d.desk) };
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr, from: r.from }).toMatchObject({ code: 0, stderr: "" });
      expect(r.answer).toMatchObject({ name: "det" });
      expect(shown(drawer)).toEqual({ det: note.id });
      expect(shown(d.desk)).toEqual(before.screen);
      expect(names(d.desk)).toEqual(before.screenNames);
    } finally { d.close(); }
  });

  test("the drawer's own terminal with no wire: the note opens on the screen, where an open from it always did", async () => {
    const prog = program("potting-agent");
    process.env.EP0CH_DAILY_AGENT = prog.cmd[0]!;
    const d = await door(null);
    try {
      await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      (d.app as any).paint();
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the drawer's program saw its variables");
      const note = await board.createBlock(null, "A letter from the water butt");
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
      expect(Object.values(shown(d.desk))).toContain(note.id);
    } finally { d.close(); }
  });

  for (const where of ["on the screen", "in the drawer"] as const) {
    test(`a terminal grouped with a reader ${where}, wired to it inside the group`, async () => {
      const prog = program("kettle");
      const d = await door({ name: "kettle", cmd: prog.cmd });
      try {
        await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the program saw its variables");
        const note = await board.createBlock(null, "A letter from the cold frame");
        await d.desk.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "det" }, tile: "reader" }, USER);
        await d.desk.dispatch.act({ action: "tile.group", args: { with: "det", name: "bundle" }, tile: "kettle" }, USER);
        const inner = (d.desk.pane("bundle") as any).inner as Desk;
        await inner.dispatch.act({ action: "tile.link", tile: "kettle", args: { to: "det" } }, USER);
        if (where === "in the drawer") await d.desk.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
        const before = { screen: shown(d.desk), inner: names(inner), screenNames: names(d.desk) };
        const r = await press(d.control.path, note.id, prog.seen());
        expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
        expect(r.answer).toMatchObject({ name: "det" });
        expect(shown(inner)).toEqual({ det: note.id });
        expect(names(inner)).toEqual(before.inner);
        expect(names(d.desk)).toEqual(before.screenNames);
        if (where === "in the drawer") expect(shown(d.desk)).toEqual(before.screen);
      } finally { d.close(); }
    });
  }

  test("the drawer's own terminal with no wire opens in a reader of the drawer when there is one", async () => {
    const prog = program("potting-agent");
    process.env.EP0CH_DAILY_AGENT = prog.cmd[0]!;
    const d = await door(null);
    try {
      await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      (d.app as any).paint();
      await until(() => !!d.app.drawer.desk, "the drawer's desk");
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the drawer's program saw its variables");
      const note = await board.createBlock(null, "A letter from the seed drill");
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "det" } }, USER);
      await drawer.dispatch.act({ action: "tile.focus", tile: "drawer.agent" }, USER);
      const screen = shown(d.desk);
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
      expect(shown(drawer)).toEqual({ det: note.id });
      expect(shown(d.desk)).toEqual(screen);
    } finally { d.close(); }
  });

  test("the drawer's own terminal put on the screen keeps its wire, while its tab holds a tile of the old name", async () => {
    const prog = program("potting-agent");
    process.env.EP0CH_DAILY_AGENT = prog.cmd[0]!;
    const d = await door(null);
    try {
      await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      (d.app as any).paint();
      await until(() => !!d.app.drawer.desk, "the drawer's desk");
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the drawer's program saw its variables");
      const note = await board.createBlock(null, "A letter from the cold store");
      const out = await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "reader", where: "right" }, tile: "drawer.agent" }, USER) as any;
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "det" }, tile: "reader" }, USER);
      await d.desk.dispatch.act({ action: "tile.link", tile: out.name, args: { to: "det" } }, USER);
      const before = { names: names(d.desk), shown: shown(d.desk) };
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
      expect(r.answer).toMatchObject({ name: "det" });
      expect(shown(d.desk)).toEqual({ ...before.shown, det: note.id });
      expect(names(d.desk)).toEqual(before.names);
    } finally { d.close(); }
  });

  test("a terminal grouped in the drawer with no wire and no reader opens the note on the screen", async () => {
    const prog = program("kettle");
    const d = await door({ name: "kettle", cmd: prog.cmd });
    try {
      await until(() => { try { prog.seen(); return true; } catch { return false; } }, "the program saw its variables");
      const note = await board.createBlock(null, "A letter from the glasshouse");
      await d.desk.dispatch.act({ action: "tile.group", args: { with: "tree", name: "bundle" }, tile: "kettle" }, USER);
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
      const r = await press(d.control.path, note.id, prog.seen());
      expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
      expect(Object.values(shown(d.desk))).toContain(note.id);
    } finally { d.close(); }
  });
});
