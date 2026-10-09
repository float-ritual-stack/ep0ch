// PIE-704: the ^W keys come from one table (src/desk/wkeys.ts). The hint, the keys box, the tile menu and the power bar's
// ^W list are generated from it, so they agree; `^W ?` (or a click on "all keys") opens the bar's actions scope on the
// ^W prefix, a list to filter, ⏎ running the key's action. Scratch services, fictional notes.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { W_GROUPS, W_KEYS, wBoxLines, wKey, wRows, type WKey } from "../src/desk/wkeys";
import type { Msg } from "../src/board";
import { openScreen } from "../src/desk/screen-specs";
import { SocketBoard } from "../src/socket";
import type { MenuRow } from "../src/surface/dispatch";
import { paint, visible } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const ch = (c: string): Key => ({ kind: "char", ch: c });
const ctrlW: Key = { kind: "char", ch: "w", ctrl: true };
setDefaultTimeout(30_000);
const plain = (s: string) => visible(s).replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("the ^W key table", () => {
  test("a key is in it once, in a known group, and has an action", () => {
    const keys = (W_KEYS as readonly WKey[]).map(e => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of W_KEYS as readonly WKey[]) {
      expect(W_GROUPS).toContain(e.group);
      expect(e.action).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(wKey(e.key)).toBe(e);
    }
  });

  test("the keys box is a line per group of the most-used keys, with keys of one word sharing it", () => {
    const rows = wRows(() => undefined);
    const lines = wBoxLines(rows.map(r => ({ ...r })));
    expect(lines.length).toBeGreaterThan(3);
    const text = lines.map(l => plain(paint(l))).join("\n");
    expect(text).toContain("focus & move · hjkl focus · m move · t into tabs");
    expect(text).toContain("< > - + size");
    expect(text).toContain("? all keys");
    // Only the most-used: the mounts and the drawer are one ? away.
    expect(text).not.toContain("mounts & groups");
    expect(text).not.toContain("drawer");
  });
});

describe.skipIf(!outliner)("^W keys, the keys box and the ^W list (PIE-704)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, painted: string[] = [];
  let key: (k: Key) => void = () => {};
  const notes: Record<string, Msg> = {};
  const saved: Record<string, string | undefined> = {};
  const frame = () => { (app as any).paint(); return painted.map(plain); };
  const peek = () => app.describe() as any;
  const type = (s: string) => { for (const c of s) key(ch(c)); };
  const AS = "wkeys-agent-704";
  let desk: Desk;
  const D = () => desk as any;
  const away = () => { if ((app as any).bar) key({ kind: "esc" }); if (D().prefix) key({ kind: "esc" }); };

  beforeAll(async () => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    cpSync(join(outliner!, "extensions", "glyphs"), join(scratch.outlines, scratch.name, "extensions", "glyphs"), { recursive: true });
    board = new SocketBoard(await scratch.start());
    await board.info();
    notes.garden = await board.createBlock(null, "Garden plan\nbeds and paths");
    const term: any = {
      info: { cols: 140, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; },
      invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {},
    };
    app = new App(term, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    await app.loadExtensions(true);
    desk = openScreen("desk") as Desk;
    app.push(desk);
    desk.setCurrent(notes.garden!);
    await Bun.sleep(100);
  }, 30_000);
  beforeEach(away);
  afterAll(async () => {
    app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  test("the keys the desk has always bound after ^W are all in the table, running what they ran", () => {
    const was: Record<string, string> = {
      h: "tile.focus", j: "tile.focus", k: "tile.focus", l: "tile.focus", m: "layout.move", t: "layout.move", T: "layout.move", H: "layout.move", J: "layout.move", K: "layout.move", L: "layout.move",
      "[": "tab.select", "]": "tab.select", "<": "tile.resize", ">": "tile.resize", "+": "tile.resize", "-": "tile.resize", "=": "layout.even", z: "tile.zoom", o: "tile.open", O: "tile.open",
      v: "tile.preview", V: "tile.preview", p: "tile.dock", d: "tile.slide", c: "tile.collapse", W: "tile.widen", f: "tile.float", P: "layout.policy", g: "tile.agent", r: "layout.load", w: "screen.save",
      x: "tile.close", a: "tile.drawer", A: "tile.drawer", s: "layout.swap", ".": "tile.menu", "!": "screen.shell", G: "tile.group", e: "mount.enter", u: "mount.out", M: "screen.mount", I: "screen.part",
    };
    for (const [k, action] of Object.entries(was)) expect(wKey(k)?.action, `^W ${k}`).toBe(action);
    // The keys the old hint list lacked.
    for (const k of ["G", "e", "u", "M", "I", "?"]) expect(wKey(k), `^W ${k}`).toBeDefined();
  });

  test("no key is bound after ^W that the table doesn't list, and every special key has its handler", () => {
    for (const e of W_KEYS as readonly WKey[]) if (e.how.k === "special") expect(typeof D().wSpecial[e.key]).toBe("function");
    // Every printable key that isn't in the table does nothing after ^W: no overlay, no prefix, no layout change.
    const before = JSON.stringify(D().layoutGet());
    for (let c = 33; c < 127; c++) {
      const k = String.fromCharCode(c);
      if (wKey(k) || "hjkl".includes(k)) continue;
      key(ctrlW); key(ch(k));
      expect(D().prefix).toBe("");
      expect(D().overlays.top()).toBeFalsy();
    }
    expect(JSON.stringify(D().layoutGet())).toBe(before);
  });

  test("after ^W the keys box lists the grouped keys once, and the hint row says only the way out", () => {
    key(ctrlW);
    const lines = frame();
    const text = lines.join("\n");
    expect(text).toContain("focus & move");
    expect(text).toContain("hjkl focus");
    expect(text).toContain("size & shape");
    // The hint row below the box: no second copy of the list.
    const hint = lines.find(l => l.includes("all keys") && l.includes("esc")) ?? "";
    expect(hint).toContain("^W");
    expect(hint).not.toContain("focus");
    expect(lines.filter(l => l.includes("hjkl focus")).length).toBe(1);
    // Every key the old hand-written list lacked is one ? away, not in the short box.
    expect(text).not.toContain("gather into a group");
  });

  test("the tile menu's ^W rows are the table's: the same key, the same action", async () => {
    const menu = D().dispatch.menu("focused", { kind: "user" }) as MenuRow[];
    const rows = wRows(n => D().dispatch.defOf(n));
    const withKey = menu.filter(m => m.key?.startsWith("ctrl+w "));
    expect(withKey.length).toBeGreaterThan(8);
    for (const m of withKey) {
      const r = rows.find(x => x.chord === m.key);
      expect(r, `${m.key} (${m.label}) is in the ^W table`).toBeDefined();
      expect(r!.action).toBe(m.action);
    }
    // And a key the table gives a menu row to labels the same.
    for (const r of rows) {
      const m = menu.find(x => x.key === r.chord && x.action === r.action);
      if (m && !(W_KEYS as readonly WKey[]).find(e => e.key === r.key)?.label) expect(r.label).toBe(m.label);
    }
  });

  test("an agent's bar.open on the ^W prefix lists every table key, in the table's words, grouped, and the menu's keys are among them", async () => {
    const out = await app.act({ action: "bar.open", args: { scope: "actions", query: "^W " }, as: AS }) as any;
    const rows = out.rows as { key: string; label: string; keycap: string; group?: string }[];
    const table = wRows(n => D().dispatch.defOf(n));
    for (const t of table) {
      const r = rows.find(x => x.key === `w:${t.key}`);
      expect(r, `^W ${t.key}`).toBeDefined();
      expect(r!.keycap).toBe(t.chord);
      expect(r!.label).toBe(t.label);
      expect(r!.group).toBe(t.group);
    }
    // The kinds' open keys follow ^W o.
    expect(rows.some(r => r.keycap.startsWith("ctrl+w o "))).toBe(true);
    // Every ^W key of the tile menu is listed.
    const menu = D().dispatch.menu("focused", { kind: "user" }) as MenuRow[];
    for (const m of menu.filter(x => x.key?.startsWith("ctrl+w "))) expect(rows.some(r => r.keycap === m.key), m.key).toBe(true);
  });

  test("^W ? opens the bar's actions scope on ^W; typing filters it fuzzily; ⏎ runs the lit key's action", async () => {
    key(ctrlW); key(ch("?"));
    await until(() => peek().bar?.scope === "actions", "the ^W list opened");
    expect(peek().bar.query).toBe("^W ");
    expect(app.person().busy).toBe(true);
    const all = peek().bar.rows as any[];
    expect(all.every(r => r.source === "actions" && r.keycap)).toBe(true);
    // Empty filter: grouped, in the table's order.
    expect(all[0].group).toBe("focus & move");
    expect(new Set(all.map(r => r.group))).toEqual(new Set(W_GROUPS));
    type("zoom");
    await until(() => peek().bar.rows[0]?.keycap === "ctrl+w z", "zoom first");
    expect(peek().bar.rows.length).toBeLessThan(all.length);
    key({ kind: "enter" });
    await until(() => !!D().layoutGet().zoom, "zoomed by ⏎");
    expect(peek().bar).toBeUndefined();
    key(ctrlW); key(ch("z"));
    await until(() => !D().layoutGet().zoom, "unzoomed by its key");
  });

  test("a click on 'all keys' in the hint row opens the same list", async () => {
    key(ctrlW);
    const lines = frame();
    const y = lines.findIndex(l => l.includes("all keys") && l.includes("esc"));
    const x = lines[y]!.indexOf("?");
    expect(x).toBeGreaterThanOrEqual(0);
    key({ kind: "mouse", action: "down", button: 0, x, y });
    key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => peek().bar?.scope === "actions", "the list opened by a click");
    expect(peek().bar.query).toBe("^W ");
  });

  test("a key found by its letters, a mount key the old list lacked, runs through the list", async () => {
    key(ctrlW); key(ch("?"));
    await until(() => peek().bar?.scope === "actions", "open");
    type("gather");
    await until(() => peek().bar.rows[0]?.keycap === "ctrl+w G", "gather into a group first");
    expect(peek().bar.rows[0].label).toMatch(/group/);
    const tiles = D().all().length;
    key({ kind: "enter" });
    await until(() => D().all().some((id: number) => D().isGroup(D().nameOf(id))), "the focused tile gathered into a group by ⏎");
    expect(D().all().length).toBe(tiles);
    key(ctrlW); key(ch("G"));
    await until(() => !D().all().some((id: number) => D().isGroup(D().nameOf(id))), "spilled by its key");
  });

  test("a key that waits for another leaves the desk waiting for it when picked", async () => {
    key(ctrlW); key(ch("?"));
    await until(() => peek().bar?.scope === "actions", "open");
    type("move beside");
    await until(() => peek().bar.rows[0]?.keycap === "ctrl+w m", "move first");
    key({ kind: "enter" });
    await until(() => D().prefix === "move", "waiting for a direction");
    key({ kind: "esc" });
  });

  test("an agent picks a ^W row as itself, never the person's keys; a person's chord is refused with the action to use", async () => {
    const before = D().layoutGet().focus;
    const r = await app.act({ action: "bar.pick", args: { query: "^W zoom", scope: "actions" }, as: AS }) as any;
    expect(r.picked.keycap).toBe("ctrl+w z");
    await until(() => !!D().layoutGet().zoom, "zoomed by the agent");
    expect(D().layoutGet().focus).toBe(before);
    expect((app as any).message).toMatch(/agent/);
    await app.act({ action: "tile.zoom", args: { on: false }, as: AS });
    await expect(app.act({ action: "bar.pick", args: { query: "^W move beside", scope: "actions" }, as: AS })).rejects.toThrow(/person's key chord|layout.move/);
  });
});
