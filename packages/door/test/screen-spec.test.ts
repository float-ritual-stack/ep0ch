// PIE-515: screens are specs on one screen host. A spec is plain data (containers with policy, tiles by kind, a key
// map naming actions, a hint, a band, where opens land); every screen the door knows is one; it reads back from data
// as it was written (ready to be stored as a note); and nothing subclasses the desk.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import "../src/screens";
import { Desk } from "../src/desk/desk";
import { readSpec, screenNames, screenSpec, specData, type ScreenSpec } from "../src/desk/screen-spec";
import { openScreen } from "../src/desk/screen-specs";
import { keyName } from "../src/surface/actions";
import { leaf, place, splitOf } from "../src/desk/layout";

describe("a screen is a spec", () => {
  test("every screen the door knows is a spec, and reads back from data as it was written", () => {
    expect(screenNames()).toEqual(expect.arrayContaining(["desk", "waiting", "welcome", "brief", "pinned"]));
    for (const name of screenNames()) {
      const spec = screenSpec(name)!;
      const data = JSON.parse(JSON.stringify(specData(spec)));
      expect(readSpec(data, true)).toEqual(spec);
    }
  });

  test("a screen made from its spec read back from data is that screen", () => {
    for (const name of ["waiting", "welcome", "brief", "pinned"]) {
      const d = new Desk(readSpec(specData(screenSpec(name)!)));
      const peek = d.describe() as { kind: string; panes: { name: string; kind: string }[] };
      expect(peek.kind).toBe(name);
      expect(d.name).toBe(name);
      expect(peek.panes.length).toBeGreaterThan(0);
    }
  });

  test("bad data is refused with what's wrong", () => {
    const ok: ScreenSpec = { name: "x", title: "x", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } };
    expect(() => readSpec(null)).toThrow(/is an object/);
    expect(() => readSpec({ ...ok, name: "9lives" })).toThrow(/a screen's name/);
    expect(() => readSpec({ ...ok, title: "" })).toThrow(/title/);
    expect(() => readSpec({ ...ok, layout: {} })).toThrow(/layout/);
    expect(() => readSpec({ ...ok, keys: [{ key: "enterr", action: "x" }] })).toThrow(/names no key/);
    expect(() => readSpec({ ...ok, keys: [{ key: "L" }] })).toThrow(/names no action/);
    expect(() => readSpec({ ...ok, layout: { root: { t: "leaf", kind: "no.such.kind", name: "x" } } }, true)).toThrow(/no tile kind no\.such\.kind/);
    // What it names by name is in its layout.
    expect(() => readSpec({ ...ok, keys: [{ key: "x", action: "keys.more", tile: "nope" }] })).toThrow(/runs in tile nope/);
    expect(() => readSpec({ ...ok, band: "nope" })).toThrow(/band is drawn by tile nope/);
    expect(() => readSpec({ ...ok, lands: "nope" })).toThrow(/lands names nope/);
    // A field it doesn't know is dropped, not kept: what a note holds is only what a screen is.
    expect(readSpec({ ...ok, stray: 1, frame: "fancy" })).toEqual(ok);
  });

  test("keys are named as a key map says them", () => {
    expect(keyName({ kind: "char", ch: "L" })).toBe("L");
    expect(keyName({ kind: "char", ch: "e", ctrl: true })).toBe("ctrl+e");
    expect(keyName({ kind: "alt", ch: "c" })).toBe("alt+c");
    expect(keyName({ kind: "enter" })).toBe("enter");
    expect(keyName({ kind: "char", ch: " " })).toBe("space");
    expect(keyName({ kind: "backtab" })).toBe("shift+tab");
    expect(keyName({ kind: "back" })).toBe("alt+left");                         // the mouse's back button is alt+←
    expect(keyName({ kind: "char", ch: "x", pasted: true })).toBeNull();
    expect(keyName({ kind: "enter", pasted: true })).toBeNull();
    // A key map names keys this way only: the old words are refused, not read as another key.
    expect(() => readSpec({ name: "x", title: "x", layout: { root: { t: "leaf", kind: "reader", name: "r" } }, keys: [{ key: "alt-left", action: "x" }] })).toThrow(/names no key/);
    for (const never of [" ", "ctrl+E"]) expect(() => readSpec({ name: "x", title: "x", layout: { root: { t: "leaf", kind: "reader", name: "r" } }, keys: [{ key: never, action: "x" }] })).toThrow(/names no key/);
    expect(readSpec({ name: "x", title: "x", layout: { root: { t: "leaf", kind: "reader", name: "r" } }, keys: [{ key: "alt+left", action: "x" }, { key: "space", action: "x" }, { key: "shift+tab", action: "x" }] }).keys!.length).toBe(3);
  });

  test("the desk is the only screen host: nothing in the door subclasses it", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
    walk(join(import.meta.dir, "../src"));
    const subclasses = files.filter(f => /\bextends\s+Desk\b/.test(readFileSync(f, "utf8"))).map(f => f.replace(/.*\/src\//, "src/"));
    expect(subclasses).toEqual([]);
  });
});

describe("what a spec says, the desk does", () => {
  const app = () => new App({ info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} } as any, { supports: () => false } as any, Date.now(), () => {});

  test("a key in its key map runs the action it names, as the person; not while the focused tile is one it excepts", () => {
    const spec: ScreenSpec = {
      name: "keys", title: "keys", hint: "|15 x|08 marks",
      keys: [{ key: "x", action: "keys.more" }, { key: "L", action: "keys.more", unless: ["reader"] }],
      layout: { root: { t: "leaf", kind: "reader", name: "reader" } },
    };
    const d = new Desk(spec), a = app();
    a.push(d);
    const ran: string[] = [];
    const press = d.dispatch.press.bind(d.dispatch);
    d.dispatch.press = (name, args, tile) => { ran.push(name); return press(name, args, tile); };
    d.key({ kind: "char", ch: "x" }, a);
    d.key({ kind: "char", ch: "L" }, a);
    expect(ran).toEqual(["keys.more"]);
    expect(d.render(a).lines.at(-1)!.replace(/\x1b\[[\d;]*m/g, "")).toContain("x marks");
  });

  test("a key map's alt+left runs on alt+← and on the mouse's back button alike", () => {
    const d = new Desk({ name: "back", title: "back", keys: [{ key: "alt+left", action: "keys.more" }], layout: { root: { t: "leaf", kind: "reader", name: "reader" } } }), a = app();
    a.push(d);
    const ran: string[] = [];
    const press = d.dispatch.press.bind(d.dispatch);
    d.dispatch.press = (name, args, tile) => { ran.push(name); return press(name, args, tile); };
    d.key({ kind: "alt-left" }, a);
    d.key({ kind: "back" }, a);
    expect(ran).toEqual(["keys.more", "keys.more"]);
  });

  test("a key may name the tile its action runs in, or the kinds it's for; screen.spec answers the spec as data", async () => {
    const spec: ScreenSpec = {
      name: "keys2", title: "keys2",
      keys: [{ key: "z", action: "tile.zoom", tile: "b" }, { key: "y", action: "tile.zoom", only: ["detail"] }],
      layout: { root: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "reader", name: "a" }, b: { t: "leaf", kind: "detail", name: "b" } } },
    };
    const d = new Desk(spec), a = app();
    a.push(d);
    d.key({ kind: "char", ch: "y" }, a);                                            // the reader has the keys: not for it
    await Bun.sleep(10);
    expect((d.describe() as any).zoom).toBeNull();
    d.key({ kind: "char", ch: "z" }, a);
    await Bun.sleep(10);
    expect((d.layoutGet() as any).zoom).toBe("b");
    expect(await d.dispatch.act({ action: "screen.spec" }, { kind: "agent", id: "spec-reader" })).toEqual({ spec: specData(spec) });
  });

  test("its frame, digits and title are its own; a screen that doesn't load layouts refuses them", async () => {
    const w = openScreen("welcome") as Desk;
    expect(w.title).toBe("welcome");
    expect(w.spec.frame).toBe("dotted");
    await expect(w.dispatch.act({ action: "layout.load", args: { name: "daily" } }, { kind: "user" })).rejects.toThrow(/keeps its own layout/);
  });
});

describe("a container held to its max gives its room back by weight", () => {
  test("the others keep their proportions, not the last one taking it all", () => {
    const t = splitOf("row", [{ t: "tabs", ids: ["list"], active: 0, policy: { max: 30 } }, leaf("detail"), leaf("preview")], [0.24, 0.4332, 0.3268]);
    const at160 = place(t, { col: 0, row: 0, cols: 160, rows: 40 }).rects;
    expect(at160.get("list")!.cols).toBe(30);
    expect(at160.get("detail")!.cols).toBe(74);
    expect(at160.get("preview")!.cols).toBe(56);
    // Narrow: under its max, it's its share as it always was.
    const at100 = place(t, { col: 0, row: 0, cols: 100, rows: 40 }).rects;
    expect([at100.get("list")!.cols, at100.get("detail")!.cols, at100.get("preview")!.cols]).toEqual([24, 43, 33]);
  });
});
