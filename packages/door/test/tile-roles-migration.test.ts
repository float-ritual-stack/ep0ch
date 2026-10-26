// PIE-1286: the one-off that moves a layout saved by an older door to the registry's words (a leaf's old `role`, the slot its
// spec gave it, is now `slot`) and gives the drawer's own program's leaf (in Evan's drawer-tiles.json: a plain terminal named
// for its program, known only by the key it runs under) its role.
import { describe, expect, test } from "bun:test";
import { migrateLayout } from "../scripts/migrations/tile-roles";

const leaf = (o: Record<string, unknown>) => ({ t: "leaf", ...o });
const layout = (root: unknown, extra: Record<string, unknown> = {}) => ({ root, focus: 0, ...extra });
describe("tile-roles", () => {
  test("the leaf run under the drawer's own key becomes the drawer's own tile, in its own file; another leaf's old role becomes its slot", () => {
    const saved = layout({ t: "tabs", tabs: [leaf({ kind: "pty", name: "shell", role: "shell", kept: "drawer.json:drawer.agent", cmd: ["/bin/bash"] }), leaf({ kind: "reader", name: "notes", role: "notes" })], active: 0 });
    const { value, changed } = migrateLayout(saved, true);
    expect(changed).toBe(3);                                                   // the two leaves and the layout's mark
    const v = value as any;
    expect(v.records).toBe(1);
    expect(v.root.tabs[0]).toMatchObject({ kind: "drawer.own", name: "drawer.agent", slot: "drawer.agent", role: "agent", kept: "drawer.json:drawer.agent" });
    expect(v.root.tabs[1]).toEqual({ t: "leaf", kind: "reader", name: "notes", slot: "notes" });
  });
  test("a program that left for a screen and came back (a numbered key), on a screen, only gets its role", () => {
    const { value } = migrateLayout(layout(leaf({ kind: "pty", name: "claude", kept: "drawer.json#3:drawer.agent" })), false);
    expect((value as any).root).toMatchObject({ kind: "pty", name: "claude", role: "agent" });
  });
  test("running it again, or after the new door has saved, changes nothing: the agent keeps its role", () => {
    const once = migrateLayout(layout(leaf({ kind: "pty", name: "claude", kept: "drawer.json#3:drawer.agent" })), false).value;
    const again = migrateLayout(once, false);
    expect(again.changed).toBe(0);
    expect((again.value as any).root).toMatchObject({ name: "claude", role: "agent" });
    expect((again.value as any).root.slot).toBeUndefined();
    // What the new door saves for an agent out on a screen: a role, no slot, and the mark.
    const saved = layout(leaf({ kind: "pty", name: "claude", id: "t-11111111-2222-4333-8444-555555555555", role: "agent", kept: "drawer.json:drawer.agent" }), { records: 1 });
    expect(migrateLayout(saved, false)).toEqual({ value: saved, changed: 0 });
  });
  test("a mounted screen's own layout inside a leaf is migrated by its own mark", () => {
    const { value } = migrateLayout(layout(leaf({ kind: "screen", name: "board", role: "board", inner: layout(leaf({ kind: "reader", name: "r", role: "reader" })) }), { records: 1 }), false);
    const v = value as any;
    expect(v.root).toMatchObject({ kind: "screen", name: "board", role: "board" });   // the outer one was saved by the new door: its role is its role
    expect(v.root.inner.root).toEqual({ t: "leaf", kind: "reader", name: "r", slot: "reader" });
    expect(v.root.inner.records).toBe(1);
  });
  test("a door that started on the new code before this ran saved the old leaf with its old role and the mark: the own program still becomes the agent (Evan's pie door, Oct 25)", () => {
    const saved = layout(leaf({ kind: "pty", name: "shell", role: "shell", slot: "shell", kept: "drawer.json:drawer.agent" }), { records: 1 });
    const { value, changed } = migrateLayout(saved, true);
    expect(changed).toBe(1);
    expect((value as any).root).toMatchObject({ role: "agent", kind: "drawer.own", name: "drawer.agent" });
    expect(migrateLayout(value, true).changed).toBe(0);
  });
  test("a file with no layout in it is left alone", () => {
    expect(migrateLayout({ open: true, share: 0.5, out: true }, false)).toEqual({ value: { open: true, share: 0.5, out: true }, changed: 0 });
  });
});
