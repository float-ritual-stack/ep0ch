// PIE-453: back and forward in readers. A follow (⏎ or a click on a link, `u`, a link action, or an open
// into the reader, an agent's too) leaves the reader's place behind: its note, how far down, and its `[ ]`
// position. Back (alt+←, backspace, the mouse's back button, a click on the `← back` row) restores it, so
// ⏎ and alt+⏎ act on the same element at once; forward goes again. An agent's back and forward are refused
// on the reader the person has focused. Fictional notes, against a throwaway outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { boardScreen } from "../src/desk/screen-specs";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { Term, type Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("the keys", () => {
  const keysOf = (input: string) => {
    const t = new Term(), keys: Key[] = [];
    t.onKey(k => keys.push(k));
    (t as any).feed(input);
    return keys;
  };

  test("alt+← and alt+→ arrive as their own keys, in each encoding terminals send", () => {
    expect(keysOf("\x1b[1;3D")).toEqual([{ kind: "alt-left" }]);
    expect(keysOf("\x1b[1;3C")).toEqual([{ kind: "alt-right" }]);
    expect(keysOf("\x1b[1;9D")).toEqual([{ kind: "alt-left" }]);
    expect(keysOf("\x1b\x1b[D")).toEqual([{ kind: "alt-left" }]);
    expect(keysOf("\x1b[D")).toEqual([{ kind: "left" }]);                     // a plain arrow is unchanged
  });

  test("the mouse's side buttons are back and forward, not a left click", () => {
    expect(keysOf("\x1b[<128;10;5M\x1b[<128;10;5m")).toEqual([{ kind: "back" }]);
    expect(keysOf("\x1b[<129;10;5M\x1b[<129;10;5m")).toEqual([{ kind: "forward" }]);
    expect(keysOf("\x1b[<0;10;5M")).toEqual([{ kind: "mouse", action: "down", button: 0, x: 9, y: 4 }]);
  });
});

describe("a reader's history, without a service", () => {
  const id = (n: number) => `${n}1111111-2222-4333-8444-555555555555`;
  const note = (n: number, text: string, parentId: string | null = null) => ({ id: id(n), text, parentId, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} });
  // The allotment: a long page with a link far down, the note it links to, and the page's parent.
  const filler = Array.from({ length: 30 }, (_, i) => `Row ${i + 1} of the plot.`).join("\n");
  const notes = [
    note(1, `Allotment diary\n${filler}\nSee ((${id(2)})) for the beans.\n## Water\nThe hose.`, id(3)),
    note(2, "Stake the beans\nCanes along the fence."),
    note(3, "Garden"),
  ];
  const flashes: string[] = [];
  /** A host where links open in place, as a board detail's do. */
  const host = (s: NoteSurface, more: Partial<SurfaceHost> = {}): SurfaceHost => {
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async (x: string) => notes.find(m => m.id === x) ?? null }, flash: (f: string) => flashes.push(f), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate: m => { s.show(m, h); }, ...more,
    };
    return h;
  };
  const current = (s: NoteSurface) => s.describe().elements?.current ?? null;
  const settle = () => Bun.sleep(5);

  test("⏎ follows in place; alt+← comes back scrolled to the link, with [ ] on it, so alt+⏎ works at once; alt+→ goes again", async () => {
    const s = new NoteSurface(), h = host(s);
    s.show(notes[0] as any, h);
    s.render(60, 12, h);
    s.key(char("]"), h);
    s.render(60, 12, h);
    expect(current(s)).toMatchObject({ kind: "link", target: id(2) });
    const scrolled = s.scroll;
    expect(scrolled).toBeGreaterThan(0);                                   // the link is far down
    s.key({ kind: "enter" }, h);
    await until(() => s.msg?.id === id(2), "the beans note");
    s.render(60, 12, h);
    expect(current(s)).toBeNull();
    expect(s.describe().history).toEqual({ back: [{ id: id(1), title: "Allotment diary" }], forward: [] });
    s.key({ kind: "alt-left" }, h);
    await until(() => s.msg?.id === id(1), "back on the diary");
    s.render(60, 12, h);
    // As far down as it was, or a row further when the history row now under the note would hide the link.
    expect(s.scroll - scrolled).toBeGreaterThanOrEqual(0);
    expect(s.scroll - scrolled).toBeLessThanOrEqual(1);
    expect(current(s)).toMatchObject({ kind: "link", target: id(2) });
    expect(s.key({ kind: "alt-enter" }, h)).toBe(true);                    // the [ ] position is live again
    await until(() => s.msg?.id === id(2), "alt+⏎ opened the link");
    // alt+⏎ opened it too (in place, with this host): back, then forward.
    s.key({ kind: "backspace" }, h);
    await until(() => s.msg?.id === id(1), "backspace went back");
    s.key({ kind: "alt-right" }, h);
    await until(() => s.msg?.id === id(2), "forward");
    expect(s.describe().history.forward).toEqual([]);
    s.key({ kind: "alt-right" }, h);
    await settle();
    expect(flashes.at(-1)).toContain("nothing ahead");
  });

  test("u is part of the history: back returns from the parent", async () => {
    const s = new NoteSurface(), h = host(s);
    s.show(notes[0] as any, h);
    s.render(60, 12, h);
    s.key(char("u"), h);
    await until(() => s.msg?.id === id(3), "the parent");
    s.key({ kind: "back" }, h);                                            // the mouse's back button
    await until(() => s.msg?.id === id(1), "back from the parent");
  });

  test("the last row says where back and forward go, and a click on each goes there", async () => {
    const s = new NoteSurface(), h = host(s);
    s.show(notes[0] as any, h);
    expect(s.render(60, 12, h).lines.map(plain).join("\n")).not.toContain("← back");
    expect(s.hint()).not.toContain("back");
    s.key(char("u"), h);
    await until(() => s.msg?.id === id(3), "the parent");
    let lines = s.render(60, 12, h).lines.map(plain);
    expect(lines).toHaveLength(12);
    expect(lines[11]!.trim()).toBe("← back · Allotment diary");
    expect(s.hint()).toContain("alt← back");
    expect(s.click(3, 11, h)).toBe(true);
    await until(() => s.msg?.id === id(1), "the click went back");
    lines = s.render(60, 12, h).lines.map(plain);
    expect(lines[11]).toContain("Garden · forward →");
    expect(s.click(58, 11, h)).toBe(true);
    await until(() => s.msg?.id === id(3), "the click went forward");
  });

  test("a new follow after back drops what was ahead", async () => {
    const s = new NoteSurface(), h = host(s);
    s.show(notes[0] as any, h);
    s.render(60, 12, h);
    s.key(char("u"), h);
    await until(() => s.msg?.id === id(3), "the parent");
    s.key({ kind: "alt-left" }, h);
    await until(() => s.msg?.id === id(1), "back");
    expect(s.describe().history.forward).toHaveLength(1);
    s.render(60, 12, h);
    s.key(char("]"), h); s.render(60, 12, h);
    s.key({ kind: "enter" }, h);
    await until(() => s.msg?.id === id(2), "a new follow");
    expect(s.describe().history).toMatchObject({ back: [{ id: id(1) }], forward: [] });
  });

  test("an agent's back is refused on the reader the person has focused, and goes elsewhere", async () => {
    const agent = { kind: "agent" as const, id: "test-agent-453" };
    for (const focused of [true, false]) {
      const s = new NoteSurface(), h = host(s, { focused });
      s.show(notes[0] as any, h);
      s.render(60, 12, h);
      s.key(char("u"), h);
      await until(() => s.msg?.id === id(3), "the parent");
      const r = s.act("back", {}, h, agent);
      if (focused) {
        await expect(r).rejects.toThrow("has the person's keys");
        expect(s.msg?.id).toBe(id(3));
      } else {
        expect(await r).toMatchObject({ went: "back", showing: { id: id(1) } });
        expect(s.agent?.did).toBe("went back here");
      }
    }
  });
});

describe("an agent's scroll and back, where the view doesn't say the reader isn't focused (PIE-506)", () => {
  const id = (n: number) => `${n}2222222-2222-4333-8444-555555555555`;
  const filler = Array.from({ length: 40 }, (_, i) => `Bed ${i + 1} of the plot.`).join("\n");
  const notes = [
    { id: id(1), text: `Seed tray log\nSee ((${id(2)})) first.\n${filler}`, parentId: id(2), childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} },
    { id: id(2), text: "Greenhouse", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} },
  ];
  const agent = { kind: "agent" as const, id: "test-agent-506" };
  const host = (s: NoteSurface, more: Partial<SurfaceHost> = {}): SurfaceHost => {
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async (x: string) => notes.find(m => m.id === x) ?? null }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate: m => { s.show(m, h); }, ...more,
    };
    return h;
  };

  test("a reader whose host doesn't set focused (the message reader, the board's, the river's) is the person's: scroll and back are refused", async () => {
    const s = new NoteSurface(), h = host(s);
    s.show(notes[0] as any, h);
    s.render(60, 12, h);
    s.key(char("]"), h);
    s.render(60, 12, h);
    const at = s.describe().elements?.current;
    expect(at).toMatchObject({ kind: "link" });
    const asAgent = (name: string, args: Record<string, unknown>) => Promise.resolve().then(() => s.act(name, args, h, agent));
    await expect(asAgent("scroll", { by: 5 })).rejects.toThrow("has the person's keys");
    await expect(asAgent("back", {})).rejects.toThrow("has the person's keys");
    expect(s.scroll).toBe(0);
    expect(s.describe().elements?.current).toEqual(at);
  });

  test("on a reader the person isn't in, an agent's scroll moves the view and never lets go of their [ ] position", async () => {
    const s = new NoteSurface(), h = host(s, { focused: false });
    s.show(notes[0] as any, h);
    s.render(60, 12, h);
    s.key(char("]"), h);
    s.render(60, 12, h);
    const at = s.describe().elements?.current;
    await s.act("scroll", { by: 5 }, h, agent);
    expect(s.scroll).toBe(5);
    expect(s.describe().elements?.current).toEqual(at);
    // The person's own scroll lets go of it, as it always did.
    s.key(char("j"), h);
    expect(s.describe().elements?.current ?? null).toBeNull();
  });
});

describe.skipIf(!outliner)("back and forward in the board's and the desk's readers, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk, hub: any;
  const n: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const B = () => BV.view(b);
  const AS = "test-agent-453";
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as?: string) => app.act({ action, args, tile: reader, as });
  const whole = (p: ReaderPane, id?: string) => until(() => !!p.msg && !p.msg.partial && (!id || p.msg.id === id), `the whole note${id ? ` ${id.slice(0, 8)}` : ""}`);
  const frame = () => b.render(B().ctx).lines;
  const current = (p: ReaderPane) => p.surface.describe().elements?.current ?? null;
  const stepTo = (p: ReaderPane, label: string, draw = frame) => {
    for (let i = 0; i < 20; i++) { key(char("]")); draw(); if (current(p)?.label.startsWith(label)) return; }
    throw new Error(`[ ] never reached ${label}`);
  };
  /** A fresh board with the jobs card in detail 1, its links drawn, the keys there. */
  const detail = async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    b = boardScreen(hub.id);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1, "the lane", 10_000);
    await whole(B().preview, n.jobs.id);
    BV.at(b, "lanes");
    key({ kind: "enter" });
    const d = B().details[0] as ReaderPane;
    await whole(d, n.jobs.id);
    await until(() => frame().map(plain).join("\n").includes("Stake the beans"), "the link drawn as its title");
    expect(BV.where(b)).toBe("detail0");
    return d;
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.beans = await create(null, "Stake the beans\nCanes along the fence.");
    n.shed = await create(null, "Paint the shed\nTwo coats, green.");
    n.jobs = await create(null, `Weekend jobs [stage::queued]\nFirst ((${n.beans.id})), then ((${n.shed.id})).\n\n## Beds\n- dig the north bed`);
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  }, 20_000);

  test("the board: ⏎ on a link in a detail follows in place; alt+← comes back with [ ] on it, alt+⏎ opens it at once; alt+→ goes again", async () => {
    const d = await detail();
    stepTo(d, "Paint the shed");
    key({ kind: "enter" });
    await whole(d, n.shed.id);
    expect(B().details).toHaveLength(1);                                   // in place
    expect(frame().map(plain).join("\n")).toContain("← back · Weekend jobs");
    key({ kind: "alt-left" });
    await whole(d, n.jobs.id);
    frame();
    expect(current(d)).toMatchObject({ kind: "link", label: "Paint the shed" });
    key({ kind: "alt-enter" });                                            // no ] needed first
    await until(() => B().details.length === 2 && B().details[1].msg?.id === n.shed.id, "a second detail on the shed");
    BV.at(b, "detail0");
    key({ kind: "alt-right" });
    await whole(d, n.shed.id);
    expect(d.surface.describe().history).toMatchObject({ back: [{ id: n.jobs.id }], forward: [] });
  }, 30_000);

  test("the board: a click on the link follows; a click on ← back comes back", async () => {
    const d = await detail();
    const at = (text: string) => {
      const lines = frame().map(plain), r = BV.rectOf(b, "detail0");
      for (let y = r.row; y < r.row + r.rows; y++) { const x = lines[y]!.indexOf(text, r.col); if (x >= r.col) return { x: x + 1, y }; }
      throw new Error(`"${text}" isn't drawn in detail0`);
    };
    const click = (p: { x: number; y: number }) => { key({ kind: "mouse", action: "down", button: 0, x: p.x, y: p.y }); key({ kind: "mouse", action: "up", button: 0, x: p.x, y: p.y }); };
    click(at("Stake the beans"));
    await whole(d, n.beans.id);
    click(at("← back"));
    await whole(d, n.jobs.id);
    expect(d.surface.describe().history.forward).toEqual([{ id: n.beans.id, title: "Stake the beans" }]);
  }, 30_000);

  test("the board: an agent's open into the person's detail is in their history; they go back from it", async () => {
    const d = await detail();
    // Not while they read it (round 3, C3): the agent opens into it once their keys are on the lanes.
    await expect(act("open", { id: n.beans.id }, "detail1", AS)).rejects.toThrow(/detail1 has the person's keys; opening a note there/);
    BV.at(b, "lanes");
    await act("open", { id: n.beans.id }, "detail1", AS);
    await whole(d, n.beans.id);
    BV.at(b, "detail0");
    key({ kind: "alt-left" });
    await whole(d, n.jobs.id);
  }, 30_000);

  test("the board: an agent's back is refused on the detail the person has focused, and works in another", async () => {
    const d = await detail();
    stepTo(d, "Stake the beans");
    key({ kind: "enter" });
    await whole(d, n.beans.id);
    await expect(act("back", {}, "detail1", AS)).rejects.toThrow("has the person's keys");
    expect(d.msg!.id).toBe(n.beans.id);
    BV.at(b, "lanes");                                                    // the person moves to the lanes
    expect(await act("back", {}, "detail1", AS)).toMatchObject({ reader: "detail1", went: "back", showing: { id: n.jobs.id } });
    await whole(d, n.jobs.id);
    expect(BV.where(b)).toBe("lanes");
  }, 30_000);

  test("the desk: ⏎ follows in place, alt+← comes back with [ ] on the link, alt+→ goes again", async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    const desk = new Desk(), D = desk as any;
    app.push(desk);
    try {
      await act("open", { id: n.jobs.id }, undefined, AS);
      const r0 = ([...D.panes.values()].filter((x: any) => x.kind === "reader") as ReaderPane[])[0]!;
      await whole(r0, n.jobs.id);
      D.focus = [...D.panes.entries()].find(([, x]: any) => x === r0)![0];
      const draw = () => desk.render(D.ctx).lines;
      await until(() => draw().map(plain).join("\n").includes("Paint the shed"), "the link drawn as its title");
      stepTo(r0, "Paint the shed", draw);
      key({ kind: "enter" });
      await whole(r0, n.shed.id);
      key({ kind: "alt-left" });
      await whole(r0, n.jobs.id);
      draw();
      expect(current(r0)).toMatchObject({ kind: "link", label: "Paint the shed" });
      key({ kind: "alt-right" });
      await whole(r0, n.shed.id);
    } finally { app.pop(); }
  }, 30_000);
});
