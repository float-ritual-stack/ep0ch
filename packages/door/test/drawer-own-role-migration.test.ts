// PIE-1286: the one-off that gives a layout saved by an older door its drawer's-own-program role (the leaf in Evan's
// drawer-tiles.json: a plain terminal named for its program, known only by the key it runs under).
import { describe, expect, test } from "bun:test";
import { migrateLayout } from "../scripts/migrations/drawer-own-role";

const leaf = (o: Record<string, unknown>) => ({ t: "leaf", ...o });
describe("drawer-own-role", () => {
  test("the leaf run under the drawer's own key becomes the drawer's own tile, in its own file", () => {
    const saved = { root: { t: "tabs", tabs: [leaf({ kind: "pty", name: "shell", role: "shell", kept: "drawer.json:drawer.agent", cmd: ["/bin/bash"] }), leaf({ kind: "reader", name: "notes", role: "notes" })], active: 0 } };
    const { value, changed } = migrateLayout(saved, true);
    expect(changed).toBe(1);
    expect((value as any).root.tabs[0]).toMatchObject({ kind: "drawer.own", name: "drawer.agent", slot: "drawer.agent", role: "agent", kept: "drawer.json:drawer.agent" });
    expect((value as any).root.tabs[1]).toEqual(saved.root.tabs[1]);
  });
  test("a program that left for a screen and came back (a numbered key), on a screen, only gets its role", () => {
    const { value, changed } = migrateLayout({ root: leaf({ kind: "pty", name: "claude", kept: "drawer.json#3:drawer.agent" }) }, false);
    expect(changed).toBe(1);
    expect((value as any).root).toMatchObject({ kind: "pty", name: "claude", role: "agent" });
  });
  test("a layout with no such leaf, or one that already has the role, is left alone", () => {
    expect(migrateLayout({ root: leaf({ kind: "pty", name: "kettle", kept: "desk.json:t-1" }) }, false).changed).toBe(0);
    expect(migrateLayout({ root: leaf({ kind: "drawer.own", name: "drawer.agent", role: "agent", kept: "drawer.json:drawer.agent" }) }, true).changed).toBe(0);
  });
});
