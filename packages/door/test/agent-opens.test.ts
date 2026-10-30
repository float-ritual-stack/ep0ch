// PIE-1444: an agent opens a tile on the person's desk while they work. Their focus stays where it was (on the desk, in a
// group, while they type in the drawer), the new tile lands wide enough to read or somewhere it can be (placement()'s
// readable minimum), and the agent reads the layout as a summary, the whole tree only on asking. A scratch outline,
// made-up notes, a 177x60 terminal with six tiles, every step through `act` as an agent.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { OPEN_READS } from "../src/desk/screen-layout";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const AS = "opener-1444";

describe.skipIf(!outliner)("an agent's open on the person's desk (PIE-1444)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (const t of ["Seed order [job::task] [plot::beds]", "Shed audit [job::task] [plot::shed]", "Standup [job::meeting]"]) await board.request<any>("create", { parentId: null, text: t, author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-agentopens-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  /** A door on the desk at 177x60 with six tiles side by side, the person's keys on `r1`. */
  async function door(yolo = false) {
    const term: any = { info: { cols: 177, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    (app as any).paint();
    const have = () => desk.layoutGet().tiles.length;
    let n = 0;
    while (have() < 6) await desk.dispatch.act({ action: "tile.open", args: { kind: "reader", name: `r${++n}`, where: "right" }, tile: desk.layoutGet().tiles.at(-1)!.name }, USER);
    await desk.dispatch.act({ action: "tile.focus", tile: "r1" }, USER);
    // Yolo: the person handed agents the door (no guard holds them back), and still their focus is theirs.
    if (yolo) app.event({ domain: "agents", action: "agents.yolo", yolo: true, sequence: 1 } as any);
    (app as any).paint();
    const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.act({ action, args, ...(tile ? { tile } : {}), as: AS }) as Promise<any>;
    return { app, desk, act, focus: () => desk.layoutGet().focus, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
  }

  test("layout.get answers a summary an agent can read: tiles, names, kinds, rects, wires; full=true the whole of each", async () => {
    const d = await door();
    try {
      await d.act("tile.open", { kind: "facets", name: "nav", where: "down" }, "reader");
      await until(() => ((d.desk as any).describe().panes.find((p: any) => p.name === "nav")?.facets ?? []).length > 0, "the facets");
      const brief = await d.act("layout.get");
      const full = await d.act("layout.get", { full: true });
      const nav = (a: any) => a.tiles.find((t: any) => t.name === "nav");
      // Every tile: its id, name, kind, path and rect; a wire says where it goes.
      for (const t of brief.tiles) expect([t.tile, t.name, t.kind, t.path].map(v => typeof v)).toEqual(["string", "string", "string", "string"]);
      expect(brief.tiles.filter((t: any) => t.rect).length).toBeGreaterThan(5);
      expect(brief.tree).toEqual(full.tree);
      // The facets tile in brief: its selection and counts; its lists only on asking (facets.get, or full=true).
      expect(nav(brief)).toMatchObject({ kind: "facets", query: "", facets: expect.any(Number) });
      expect(nav(brief).notes).toBeUndefined();
      expect(Array.isArray(nav(full).facets)).toBe(true);
      expect(brief.layers.every((l: any) => Array.isArray(l.tiles) && l.tree)).toBe(true);
      expect(brief.brief).toContain("full=true");
      expect(JSON.stringify(brief).length).toBeLessThan(JSON.stringify(full).length / 2);
    } finally { d.quit(); }
  });

  test("peek carries the layout in brief, as layout.get does; full=true the whole (PIE-1447)", async () => {
    const d = await door();
    try {
      await d.act("tile.open", { kind: "facets", name: "nav", where: "down" }, "reader");
      await until(() => ((d.desk as any).describe().panes.find((p: any) => p.name === "nav")?.facets ?? []).length > 0, "the facets");
      const nav = (a: any) => a.tiles.find((t: any) => t.name === "nav");
      const peek = d.app.describe() as any, whole = d.app.describe({ full: true }) as any;
      const brief = peek.layout, full = whole.layout;
      // The screen's own tiles (state.panes) the same: in brief unless full.
      expect(nav({ tiles: peek.state.panes }).notes).toBeUndefined();
      expect(Array.isArray(nav({ tiles: whole.state.panes }).facets)).toBe(true);
      expect(brief).toEqual(await d.act("layout.get"));
      expect(nav(brief).notes).toBeUndefined();
      expect(Array.isArray(nav(full).facets)).toBe(true);
      expect(JSON.stringify(brief).length).toBeLessThan(JSON.stringify(full).length / 2);
    } finally { d.quit(); }
  });

  test("a group's tiles hear the person's whereabouts as the desk does: yolo and idle (PIE-1447)", async () => {
    const d = await door(true);
    try {
      await d.desk.dispatch.act({ action: "tile.group", args: { with: "r2", name: "pair" }, tile: "r1" }, USER);
      const group = d.desk.pane("pair") as any;
      const desk = d.desk.dispatch.where(), inner = group.inner.dispatch.where();
      // Before the group is first drawn too: the shell's one answer, read through, not the inner desk's keys alone.
      expect(group.inner.ctx).toBeUndefined();
      expect(desk.yolo).toBe(true);
      expect(inner.yolo).toBe(true);
      expect(Math.abs(inner.idle - desk.idle)).toBeLessThan(1000);
      expect({ away: inner.away, screen: inner.screen, keys: inner.keys }).toEqual({ away: desk.away, screen: desk.screen, keys: desk.keys });
    } finally { d.quit(); }
  });

  for (const yolo of [false, true]) describe(yolo ? "in yolo" : "agents held back", () => {
  test("on the desk: the person's focus stays on their tile", async () => {
    const d = await door(yolo);
    try {
      expect(d.focus()).toBe("r1");
      // Beside r1 (12 columns) it would be 6, and no where= named a place: it floats, readable, and the answer says why.
      const r = await d.act("tile.open", { kind: "facets", name: "nav" });
      expect(r).toMatchObject({ name: "nav", where: "float", why: expect.stringContaining("beside r1 it is 6×") });
      const nav = d.desk.layoutGet().floats.find((f: any) => f.name === "nav")!;
      expect(nav.rect!.cols).toBeGreaterThanOrEqual(OPEN_READS.cols);
      expect(d.focus()).toBe("r1");
    } finally { d.quit(); }
  });

  test("a place the agent named is where it goes, narrow or not, and the answer says it's narrow", async () => {
    const d = await door(yolo);
    try {
      const r = await d.act("tile.open", { kind: "facets", name: "nav", where: "right" }, "r1");
      expect(r).toMatchObject({ name: "nav", where: "right", why: expect.stringContaining("as asked") });
      expect(d.desk.layoutGet().tiles.find((t: any) => t.name === "nav")!.float).toBeUndefined();
      expect(d.focus()).toBe("r1");
    } finally { d.quit(); }
  });

  test("beside a tile with room: it opens there, as asked, and the focus stays", async () => {
    const d = await door(yolo);
    try {
      const r = await d.act("tile.open", { kind: "facets", name: "nav", where: "down" }, "reader");
      expect(r).toMatchObject({ name: "nav", where: "down" });
      expect(r.why).toBeUndefined();
      const nav = d.desk.layoutGet().tiles.find((t: any) => t.name === "nav")!;
      expect(nav.rect!.cols).toBeGreaterThanOrEqual(OPEN_READS.cols);
      expect(d.focus()).toBe("r1");
    } finally { d.quit(); }
  });

  test("the person's own open beside a narrow tile is theirs: it splits, as asked, and takes their keys", async () => {
    const d = await door(yolo);
    try {
      const r = await d.desk.dispatch.act({ action: "tile.open", args: { kind: "facets", name: "mine" }, tile: "r1" }, USER) as any;
      expect(r.where).toBe("right");
      expect(d.focus()).toBe("mine");
    } finally { d.quit(); }
  });

  test("while the person types in the drawer: the desk's focus stays, and the keys stay in the drawer", async () => {
    const d = await door(yolo);
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      expect(d.app.drawer.entered).toBe(true);
      await d.act("tile.open", { kind: "facets", name: "nav" });
      expect(d.desk.pane("nav")).toBeDefined();
      expect(d.focus()).toBe("r1");
      expect(d.app.drawer.entered).toBe(true);
    } finally { d.quit(); }
  });

  test("in a group: the focus inside the group stays on the person's tile", async () => {
    const d = await door(yolo);
    try {
      await d.desk.dispatch.act({ action: "tile.group", args: { with: "r2", name: "pair" }, tile: "r1" }, USER);
      const group = d.desk.pane("pair") as any;
      expect(d.focus()).toBe("pair");
      const inner = () => group.inner.layoutGet().focus;
      const was = inner();
      await d.act("tile.open", { kind: "facets", name: "nav" }, "pair/r2");
      expect(group.inner.pane("nav")).toBeDefined();
      expect(inner()).toBe(was);
      expect(d.focus()).toBe("pair");
    } finally { d.quit(); }
  });
  });
});
