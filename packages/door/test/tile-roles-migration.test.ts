// PIE-1286: the one-off that gives a layout saved by an older door its drawer's-own-program role (the leaf in Evan's
// drawer-tiles.json: a plain terminal named for its program, known only by the key it runs under).
import { describe, expect, test } from "bun:test";
import { migrateLayout } from "../scripts/migrations/tile-roles";

const leaf = (o: Record<string, unknown>) => ({ t: "leaf", ...o });
describe("tile-roles", () => {
  test("a leaf's old role (the slot its screen's spec gave it) becomes its slot; one already in the new words is left alone", () => {
    const { value, changed } = migrateLayout({ root: { t: "split", kids: [leaf({ kind: "preview", name: "side", role: "preview" }), leaf({ kind: "reader", name: "notes", slot: "notes" }), leaf({ kind: "pty", name: "cat", slot: "cat", role: "agent" })] } }, false);
    expect(changed).toBe(1);
    const kids = (value as any).root.kids;
    expect(kids[0]).toEqual({ t: "leaf", kind: "preview", name: "side", slot: "preview" });
    expect(kids[1]).toEqual({ t: "leaf", kind: "reader", name: "notes", slot: "notes" });
    expect(kids[2]).toMatchObject({ slot: "cat", role: "agent" });
  });
  test("the leaf run under the drawer's own key becomes the drawer's own tile, in its own file", () => {
    const saved = { root: { t: "tabs", tabs: [leaf({ kind: "pty", name: "shell", role: "shell", kept: "drawer.json:drawer.agent", cmd: ["/bin/bash"] }), leaf({ kind: "reader", name: "notes", role: "notes" })], active: 0 } };
    const { value, changed } = migrateLayout(saved, true);
    expect(changed).toBe(2);
    expect((value as any).root.tabs[0]).toMatchObject({ kind: "drawer.own", name: "drawer.agent", slot: "drawer.agent", role: "agent", kept: "drawer.json:drawer.agent" });
    expect((value as any).root.tabs[1]).toEqual({ t: "leaf", kind: "reader", name: "notes", slot: "notes" });
  });
  test("a program that left for a screen and came back (a numbered key), on a screen, only gets its role", () => {
    const { value, changed } = migrateLayout({ root: leaf({ kind: "pty", name: "claude", kept: "drawer.json#3:drawer.agent" }) }, false);
    expect(changed).toBe(1);
    expect((value as any).root).toMatchObject({ kind: "pty", name: "claude", role: "agent" });
  });
  test("a layout with no such leaf, or one that already has the role, is left alone", () => {
    expect(migrateLayout({ root: leaf({ kind: "pty", name: "kettle", kept: "desk.json:t-1" }) }, false).changed).toBe(0);
    expect(migrateLayout({ root: leaf({ kind: "drawer.own", name: "drawer.agent", slot: "drawer.agent", role: "agent", kept: "drawer.json:drawer.agent" }) }, true).changed).toBe(0);
  });
});
