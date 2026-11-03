// PIE-1527: the reader's keys come from one table (src/surface/reader-keys.ts). The reader's key() is a lookup over it,
// and the keys window, the hint rows, the note actions' own keys, the desk's session keys and the keys an extension's
// line can't take read the same rows. The lookup is tested here with no desk and no service: a reader's state is the
// answer to each guard.
import { describe, expect, test } from "bun:test";
import "../src/app";
import { READER_GUARDS, READER_KEYS, READER_OWN_KEYS, readerBinding, sessionStart, STEP_KEYS, READING_KEYS, type ReaderGuard } from "../src/surface/reader-keys";
import { NOTE_ACTIONS } from "../src/surface/note";
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
    const all = bindings(), reader = all.filter(b => b.scope === "reader");
    expect(reader.find(b => b.key === "r" && b.action === "proposal.resolve")?.does).toContain("when");
    expect(reader.every(b => b.layer === "tile")).toBe(true);
    expect(conflicts(all).filter(g => g.some(b => b.scope === "reader"))).toEqual([]);
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
