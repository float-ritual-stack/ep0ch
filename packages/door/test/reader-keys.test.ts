// PIE-1527: the reader's keys come from one table (src/surface/reader-keys.ts). The reader's key() is a lookup over it,
// and the keys window, the hint rows, the note actions' own keys, the desk's session keys and the keys an extension's
// line can't take read the same rows. The lookup is tested here with no desk and no service: a reader's state is the
// answer to each guard.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../src/app";
import { READER_GUARDS, READER_KEYS, READER_OWN_KEYS, readerBinding, sessionStart, STEP_KEYS, READING_KEYS, type ReaderGuard } from "../src/surface/reader-keys";
import { NOTE_ACTIONS, NoteSurface, type OpenHow, type SurfaceHost } from "../src/surface/note";
import { keymapPath, reloadKeymap, setKeys } from "../src/surface/keymap";
import { declaredKeys, keyOfName } from "../src/surface/actions";
import { bindings, conflicts } from "../src/surface/key-catalog";
import type { Key } from "../src/term";

const key = (name: string): Key => keyOfName(name)!;
/** A reader where exactly these guards hold. */
const reader = (...hold: ReaderGuard[]) => (g: ReaderGuard) => hold.includes(g);
const run = (name: string, ...hold: ReaderGuard[]) => { const r = readerBinding(key(name), reader(...hold)); return r && { action: r.action, args: r.args ?? {} }; };

describe("the reader's key table", () => {
  test("r resolves a proposal that can be resolved, and fetches the tickets again otherwise: the guard picks", () => {
    expect(run("r", "note", "outline", "resolvable")).toEqual({ action: "proposal.resolve", args: {} });
    expect(run("r", "note", "outline")).toEqual({ action: "projection.refresh", args: {} });
    expect(run("r", "note")).toBeUndefined();
  });

  test("esc lets go of the element, then of a focus mark, then of a zoom; with none of them, it isn't the reader's", () => {
    expect(run("esc", "element", "tinted", "zoomed", "whole", "outline")?.action).toBe("element.select");
    expect(run("esc", "tinted", "zoomed", "whole", "outline")?.action).toBe("block.untint");
    expect(run("esc", "zoomed", "whole", "outline")).toEqual({ action: "element.zoom", args: { on: false } });
    expect(run("esc", "whole", "outline")).toBeUndefined();
  });

  test("a list preview's ↑ ↓ scroll it; elsewhere they step the reading", () => {
    expect(run("down", "preview")).toEqual({ action: "list.preview.scroll", args: { by: 1 } });
    expect(run("down")).toEqual({ action: "reading.step", args: { by: 1 } });
    expect(run("e", "preview", "note")?.action).toBe("list.preview.edit");
    expect(run("e", "note")?.action).toBe("edit.arm");
  });

  test("the proposal keys run the proposal actions through the table, only on a proposal", () => {
    expect(run("A", "note", "proposal")?.action).toBe("proposal.apply");
    expect(run("X", "note", "proposal")?.action).toBe("proposal.dismiss");
    expect(run("A", "note")).toBeUndefined();
  });

  test("two rows on one key: every one but the last has a guard, so no row is dead", () => {
    const byKey = new Map<string, typeof READER_KEYS[number][]>();
    for (const r of READER_KEYS) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
    const dead = [...byKey].flatMap(([k, rows]) => rows.slice(0, -1).filter(r => !r.when?.length).map(r => `${k} ${r.action}`));
    expect(dead).toEqual([]);
    for (const r of READER_KEYS) for (const g of r.when ?? []) expect(Object.keys(READER_GUARDS)).toContain(g);
  });

  test("the keys window lists each reader key with what picks it, and finds no fight among them", () => {
    const all = bindings(), reader = all.filter(b => b.scope === "note" && b.from === "table");
    expect(reader.find(b => b.key === "r" && b.action === "proposal.resolve")?.does).toContain("when");
    expect(reader.every(b => b.layer === "tile")).toBe(true);
    expect(conflicts(all).filter(g => g.some(b => b.scope === "note" && b.from === "table"))).toEqual([]);
  });

  test("what reads the reader's keys reads the table: the actions' own keys, the session keys, the hint, the extensions' reserve", () => {
    for (const r of READER_KEYS) {
      const k = r.key === "space" ? "space" : r.key;
      for (const a of [r.action, ...(r.runs ?? [])]) { const d = NOTE_ACTIONS.def(a as never); if (d) expect([a, declaredKeys(d.keys).has(k)]).toEqual([a, true]); }
    }
    expect(sessionStart(key("C"))).toBe("comment");
    expect(sessionStart(key("ctrl+e"))).toBe("external");
    expect(sessionStart(key("j"))).toBeNull();
    expect(STEP_KEYS.every(r => READER_KEYS.includes(r as never))).toBe(true);
    expect(READING_KEYS.map(r => r.key)).toEqual(["f", "M", "R", "t", "i", "z", "u", "C", "m"]);
    for (const k of ["r", "A", "X", "K", "W", "[", "~", " "]) expect(READER_OWN_KEYS.has(k)).toBe(true);
    expect(READER_OWN_KEYS.has("w")).toBe(false);
  });
});

// Codex's review of #1228 (loki, Nov 2): the aliases the if-chain matched by kind, and the person's keymap.
describe("the reader's keys, as the person's keymap and terminal give them", () => {
  const was = process.env.EP0CH_KEYMAP;
  beforeAll(() => { process.env.EP0CH_KEYMAP = join(mkdtempSync(join(tmpdir(), "reader-keymap-")), "keybindings.json"); reloadKeymap(); });
  afterEach(() => { writeFileSync(keymapPath(), "{}\n"); reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });

  test("shift+↑ ↓ step the reading, and shift+⏎ ctrl+⏎ act as ⏎", () => {
    const on = (k: Key) => { const r = readerBinding(k, () => false); return r && { action: r.action, args: r.args ?? {} }; };
    expect(on({ kind: "up", shift: true } as Key)).toEqual({ action: "reading.step", args: { by: -1 } });
    expect(on({ kind: "down", shift: true } as Key)).toEqual({ action: "reading.step", args: { by: 1 } });
    expect(run("shift+enter")?.action).toBe("element.open");
    expect(run("ctrl+enter")).toEqual({ action: "element.open", args: {} });
  });

  test("a binding with arguments the table has no row for runs where the reader has the key", async () => {
    setKeys("scroll by=3", ["alt+j"]);
    // The file's arguments are words, as `act` takes them; the dispatcher reads `by` as a number.
    expect(run("alt+j")).toEqual({ action: "scroll", args: { by: "3" } });
    // In a reader: the note scrolls three rows.
    const s = new NoteSurface(), text = `Long page\n${Array.from({ length: 40 }, (_, i) => `Row ${i + 1}.`).join("\n")}`;
    const h: SurfaceHost = { ctx: { board: { ancestors: async () => [], comments: async () => [], get: async () => null }, flash: () => {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} };
    s.show({ id: "71111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, properties: [] } as any, h);
    s.render(60, 12, h);
    expect(s.key({ kind: "alt", ch: "j" }, h)).toBe(true);
    for (let i = 0; i < 100 && s.scroll !== 3; i++) await Bun.sleep(5);
    expect(s.scroll).toBe(3);
  });

  test("a key the person moves a reader action to is the reader's: an extension's line key doesn't take it", () => {
    expect(READER_OWN_KEYS.has("w")).toBe(false);
    setKeys("sources.open", ["w"]);
    expect(READER_OWN_KEYS.has("w")).toBe(true);
  });

  test("element.open fresh=true on a key of the person's opens the link fresh, as alt+⏎ does", async () => {
    const id = (n: number) => `${n}1111111-2222-4333-8444-555555555555`;
    const note = (n: number, text: string) => ({ id: id(n), text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, properties: [] });
    const notes = [note(1, `Allotment diary\nSee ((${id(2)})) for the beans.`), note(2, "Stake the beans\nCanes along the fence.")];
    const opened: (OpenHow | undefined)[] = [];
    const s = new NoteSurface();
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async (x: string) => notes.find(m => m.id === x) ?? null }, flash: () => {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate: (_m, how) => { opened.push(how); },
    };
    setKeys("element.open fresh=true", ["alt+x"]);
    s.show(notes[0] as any, h);
    s.render(60, 12, h);
    s.key({ kind: "char", ch: "]" }, h);
    s.render(60, 12, h);
    expect(s.key({ kind: "alt", ch: "x" }, h)).toBe(true);
    for (let i = 0; i < 100 && !opened.length; i++) await Bun.sleep(5);
    expect(opened[0]?.fresh).toBe(true);
  });
});
