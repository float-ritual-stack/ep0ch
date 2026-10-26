// PIE-1286: the tile registry is the one place a tile's id, role, opener and copy lineage live.
import { describe, expect, test } from "bun:test";
import { tileRegistry } from "../src/desk/tile-registry";
import { ReaderPane } from "../src/desk/panes";
import { Desk } from "../src/desk/desk";

const pane = () => new ReaderPane(true);

describe("the tile registry", () => {
  test("a tile's id is minted once and kept; asking for it never changes it", () => {
    const p = pane();
    expect(tileRegistry.knownId(p)).toBeUndefined();
    const id = tileRegistry.idOf(p);
    expect(id).toMatch(/^t-[0-9a-f-]{36}$/);
    expect(tileRegistry.idOf(p)).toBe(id);
    expect(tileRegistry.knownId(p)).toBe(id);
  });
  test("a role is the one set on the tile, else its kind's: a rename or a move never touches it", () => {
    const p = pane();
    expect(tileRegistry.roleOf(p)).toBe("reader");
    tileRegistry.setRole(p, "stage");
    expect(tileRegistry.roleOf(p)).toBe("stage");
    expect(tileRegistry.saved(p)).toEqual({ role: "stage" });
    tileRegistry.setRole(p, undefined);
    expect(tileRegistry.roleOf(p)).toBe("reader");
    expect(tileRegistry.saved(p)).toEqual({});
  });
  test("a saved tile comes back with its id, role and opener; one that already has an id keeps it", () => {
    const p = pane(), q = pane(), kept = tileRegistry.idOf(q);
    tileRegistry.restore(p, { id: "t-11111111-2222-4333-8444-555555555555", role: "agent", openedFrom: "t-aaaaaaaa-2222-4333-8444-555555555555" });
    expect(tileRegistry.idOf(p)).toBe("t-11111111-2222-4333-8444-555555555555");
    expect(tileRegistry.saved(p)).toEqual({ role: "agent", openedFrom: "t-aaaaaaaa-2222-4333-8444-555555555555" });
    tileRegistry.restore(q, { id: "t-99999999-2222-4333-8444-555555555555" });
    expect(tileRegistry.idOf(q)).toBe(kept);
  });
  test("a role set before the saved id comes back doesn't fix a new id: the saved one still wins (a restart keeps a program's key)", () => {
    const p = pane();
    tileRegistry.setRole(p, "agent");
    expect(tileRegistry.knownId(p)).toBeUndefined();
    tileRegistry.restore(p, { id: "t-77777777-2222-4333-8444-555555555555" });
    expect(tileRegistry.idOf(p)).toBe("t-77777777-2222-4333-8444-555555555555");
  });
  test("a saved arrangement loaded twice in one door: the second copy gets fresh ids, remembers where it came from, and its openers follow", () => {
    const door = {}, a1 = pane(), a2 = pane(), b2 = pane();
    tileRegistry.restore(a1, { id: "t-01010101-2222-4333-8444-555555555555" });
    expect([...tileRegistry.claim(door, [a1])]).toEqual([]);
    tileRegistry.restore(a2, { id: "t-01010101-2222-4333-8444-555555555555" });
    tileRegistry.restore(b2, { id: "t-02020202-2222-4333-8444-555555555555", openedFrom: "t-01010101-2222-4333-8444-555555555555" });
    const remapped = tileRegistry.claim(door, [a2, b2]);
    expect(remapped.get("t-01010101-2222-4333-8444-555555555555")).toBe(tileRegistry.idOf(a2));
    expect(tileRegistry.idOf(a2)).not.toBe("t-01010101-2222-4333-8444-555555555555");
    expect(tileRegistry.copiedFrom(a2)).toBe("t-01010101-2222-4333-8444-555555555555");
    tileRegistry.followRemap([b2], remapped);
    expect(tileRegistry.openerOf(b2)).toBe(tileRegistry.idOf(a2));
    expect(tileRegistry.paneIn(door, tileRegistry.idOf(a2))).toBe(a2);
  });
  test("a desk keeps no id of its own: its tile's id is the registry's", () => {
    const d = new Desk(undefined, { layout: "desk" });
    const layout = d.layoutGet() as { tiles: { name: string; tile: string }[] };
    for (const t of layout.tiles) expect(tileRegistry.knownId(d.pane(t.name)!)).toBe(t.tile);
  });
});
