// PIE-1697 (CodeRabbit on #1407): one leave is said once; a failure while leaving is the error that propagates, and the
// next leave is said on its own.
import { expect, test } from "bun:test";
import { DrawerKeep } from "../src/desk/drawer-keep";

/** A made-up drawer desk: it takes every tile, by its name. */
function drawer() {
  const tiles: { name: string; pane: object }[] = [];
  return {
    freeName: (n: string) => n,
    bringRefusal: () => null,
    bringIn: (m: { name: string; pane: object }) => { tiles.push({ name: m.name, pane: m.pane }); return { name: m.name }; },
    layoutGet: () => ({ tiles: tiles.map(t => ({ name: t.name })) }),
    pane: (n: string) => tiles.find(t => t.name === n)?.pane,
  };
}
const moved = (name: string) => ({ name, pane: { kind: "pty" }, spec: {}, from: "a section", typing: false }) as never;

test("a leave's keeps are said once, in the drawer's order", () => {
  const said: string[] = [], d = drawer();
  const keep = new DrawerKeep(() => d as never, { flash: m => said.push(m), redraw() {} });
  keep.together(() => { keep.keep([moved("pty")]); keep.keep([moved("pty2"), moved("pty3")]); });
  expect(said).toEqual(["pty, pty2, pty3 went into your drawer · alt+a shows them"]);
});

test("a failure while leaving propagates, not the saying's; the next leave is said on its own", () => {
  const d = drawer();
  let flashes = 0;
  const keep = new DrawerKeep(() => d as never, { flash: () => { flashes++; throw new Error("the status line failed"); }, redraw() {} });
  expect(() => keep.together(() => { keep.keep([moved("pty")]); throw new Error("a tile's dispose failed"); })).toThrow("a tile's dispose failed");
  expect(flashes).toBe(1);
  // Not left inside the failed leave: a keep now says itself.
  expect(() => keep.keep([moved("pty2")])).toThrow("the status line failed");
  expect(flashes).toBe(2);
});
