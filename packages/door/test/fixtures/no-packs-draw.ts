// Run by test/no-packs.test.ts with EP0CH_PACKS naming a folder with no packs (PACK_DIR is read as the door starts,
// so it is its own process): every screen that draws art draws without it, and its keys still work. Prints JSON.
import type { Ctx, Screen } from "../../src/app";
import { ArtPane } from "../../src/desk/panes";
import { FileAreas, Logon, MainMenu, MENU_SCREENS } from "../../src/screens";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const ctx = {
  t: { cols: 100, rows: 40, cellW: 9, cellH: 16, kitty: false }, graphics: false, video: "cells", events: 0, lastCall: 0, host: "node", workspace: "garden",
  push() {}, pop() {}, replace() {}, redraw() {}, flash() {}, quit() {}, cycleVideo() {},
} as unknown as Ctx;
const out: Record<string, string> = {};
const draw = (name: string, s: Screen) => { out[name] = s.render(ctx).lines.map(plain).join("\n"); };
draw("menu", new MainMenu());
const logon = new Logon(ctx); for (let i = 0; i < 400 && logon.tick?.(); i++); draw("logon", logon);
draw("files", new FileAreas());
const bulletin = MENU_SCREENS.find(([k]) => k === "B")![1](ctx)!;
bulletin.enter?.(ctx);
for (const ch of [".", ",", "i"]) bulletin.key!({ kind: "char", ch }, ctx);
bulletin.key!({ kind: "down" }, ctx);
draw("bulletin", bulletin);
const pane = new ArtPane();
out.pane = pane.render(60, 20, true, { ctx } as never).lines.map(plain).join("\n");
console.log(JSON.stringify(out));
