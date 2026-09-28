// Drive the real door against the live outline and snapshot what a Kitty terminal would show.
// src/mirror.ts consumes the exact bytes the door writes and composites them into a PNG.
//   bun scripts/snap.ts [cells] → out/snap-*.png
import { mkdirSync, writeFileSync } from "node:fs";
import { Mirror } from "../src/mirror";
import { App } from "../src/app";
import { Logon, MainMenu } from "../src/screens";
import { Desk } from "../src/desk/desk";
import { River } from "../src/river/river";
import { DeliveryBoard } from "../src/desk/delivery";
import { SocketBoard } from "../src/socket";
import type { Key, TermInfo } from "../src/term";

const scenario = process.argv[2] ?? "kitty";
process.env.EP0CH_STATE = "out/state";   // never touch the real desk / river layout
const wide = ["desk", "river", "board", "board2", "board3", "doc", "float"].includes(scenario);
const COLS = wide ? 200 : 120, ROWS = wide ? 60 : 40;
const kitty = scenario !== "cells";

const emu = new Mirror(COLS, ROWS);
let keyFn: (k: Key) => void = () => {};
let last: string[] = [];
const fakeTerm = {
  info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty } as TermInfo,
  write: (s: string) => { bytes += s.length; emu.write(s); },
  paint(lines: string[]) { lines.forEach((l, r) => { if (last[r] !== l) this.write(`\x1b[${r + 1};1H\x1b[0m\x1b[2K${l}\x1b[0m`); }); last = lines; },
  invalidate() { last = []; },
  onKey(fn: (k: Key) => void) { keyFn = fn; },
  onResize() {},
};
let bytes = 0;
const board = new SocketBoard();
const info = await board.info();
const app = new App(fakeTerm as any, board, Date.now() - 6 * 3600_000, () => {});
app.host = info.host; app.workspace = info.workspace;
mkdirSync("out", { recursive: true });
const tag = scenario;
const snap = async (name: string, wait = 600) => {
  await Bun.sleep(wait);
  app.redraw();
  writeFileSync(`out/snap-${tag}-${name}.png`, emu.snapshot(fakeTerm.info));
  console.log(`${name}: ${bytes} bytes written so far, ${emu.placements.size} placement(s), ${emu.images.size} image(s)`);
};
const press = (k: Key) => keyFn(k);
const ch = (c: string) => press({ kind: "char", ch: c });

if (scenario === "doc") {
  // A fake note through the real reader: callouts, a wrapped table, code, and a screenshot.
  const { ReaderPane } = await import("../src/desk/panes");
  const { onMediaChange } = await import("../src/media");
  const shot = "/opt/float/bbs/inbox/screenshots/Screenshot\\ 2026-09-27\\ at\\ 8.05.26 PM.png";
  const text = ["Doc rendering demo", "[type::demo]", "", "> [!summary] Where the work is", "> Two tickets in flight. PC-762 waits on Sumit's eFax keys; PC-985 is ready for QA on staging.",
    "", "> [!warning]- Folded until z", "> hidden detail", "", "| Ticket | State | Waiting on | Notes |", "|---|:-:|---|---|",
    "| PC-762 | waiting | Sumit | Three eFax values into dev's Key Vault before the dev end-to-end test can run; Milind holds prod until then. |",
    "| PC-985 | QA | Felipe, Adam | Registration works on dev and staging; the sign-up form stays hidden behind a CMS flag. |",
    "", "## Screenshot", "", `img:: ${shot}`, "", "```ts", "const board = await readView(sock, def);", "```"].join("\n");
  const pane = new ReaderPane();
  const api: any = { ctx: app, current: null, setCurrent() {}, focusKind() {}, redraw: () => app.redraw() };
  pane.show({ id: "demo", text, parentId: null, childIds: [], createdAt: Date.now(), updatedAt: Date.now(), author: "you", props: {} }, api);
  onMediaChange(() => app.redraw());
  app.push({ title: "doc", render: (ctx: any) => { const v = pane.render(ctx.t.cols - 4, ctx.t.rows - 3, true, api); return { lines: v.lines.map((l: string) => "  " + l), placements: (v.placements ?? []).map((p: any) => ({ ...p, col: p.col + 2 })) }; }, key() {} } as any);
  await snap("1-doc", 4000);
  board.close(); process.exit(0);
}
if (scenario === "float") {
  app.push(new MainMenu()); app.push(new DeliveryBoard(process.env.HUB));
  await Bun.sleep(5000);
  await app.openBlock(process.env.BLOCK!); await Bun.sleep(4000);
  await snap("1-detail", 500);
  console.log("focus", (app as any).stack.at(-1).focus, (app as any).stack.at(-1).title); ch("o"); await snap("2-float", 1500);
  console.log(JSON.stringify((app as any).stack.at(-1).placed.map((x: any) => [x.layer, x.p.key, x.p.row, x.p.rows])));
  board.close(); process.exit(0);
}
if (scenario === "board3") {
  const mouse = (action: "down" | "up" | "drag", x: number, y: number) => press({ kind: "mouse", action, button: 0, x, y });
  app.push(new MainMenu()); app.push(new DeliveryBoard());
  await Bun.sleep(6000);
  press({ kind: "enter" }); await Bun.sleep(1200); press({ kind: "tab" });   // open a detail, back to lanes
  const edgeX = (app as any).stack.at(-1).laneEdges[0].x;
  mouse("down", edgeX, 10); mouse("drag", edgeX + 30, 10); mouse("up", edgeX + 30, 10);          // widen the first lane
  const rEdge = (app as any).stack.at(-1).readerEdges[0].x;
  mouse("down", rEdge, 40); mouse("drag", rEdge - 25, 40); mouse("up", rEdge - 25, 40);           // narrow the preview
  await snap("1-dragged", 1500);
  console.log("lane edge", edgeX, "→", (app as any).stack.at(-1).laneEdges[0].x, "reader edge", rEdge, "→", (app as any).stack.at(-1).readerEdges[0].x);
  board.close(); process.exit(0);
}
if (scenario === "board2") {
  const mouse = (action: "down" | "up" | "drag", x: number, y: number) => press({ kind: "mouse", action, button: 0, x, y });
  app.push(new MainMenu()); app.push(new DeliveryBoard());
  await Bun.sleep(6000);
  press({ kind: "right" }); press({ kind: "right" }); press({ kind: "right" }); ch("c");   // collapse Review
  press({ kind: "left" }); press({ kind: "left" }); press({ kind: "left" });
  press({ kind: "down" }); press({ kind: "enter" }); await Bun.sleep(1500);
  mouse("down", 60, 25); mouse("drag", 60, 18); mouse("up", 60, 18);          // drag the lanes/readers border up
  await snap("1-collapsed-resized", 1500);
  ch("o"); await Bun.sleep(300);                                               // pop the detail out as a float
  mouse("down", 70, 7); mouse("drag", 110, 4); mouse("up", 110, 4);            // drag it by its title
  await snap("2-float", 1000);
  press({ kind: "esc" }); ch("S");                                             // outline drawer on the right
  press({ kind: "down" }); press({ kind: "down" });
  await snap("3-tree-right", 3000);
  press({ kind: "esc" }); ch("b");
  press({ kind: "down" });
  await snap("4-backlink-preview", 5000);
  board.close(); process.exit(0);
}
if (scenario === "board") {
  app.push(new MainMenu()); app.push(new DeliveryBoard());
  await snap("1-lanes", 6000);
  press({ kind: "down" }); press({ kind: "down" });
  await snap("2-preview", 2000);
  press({ kind: "enter" }); await Bun.sleep(1500);
  press({ kind: "tab" });   // detail → lanes
  press({ kind: "right" }); press({ kind: "alt-enter" });
  await snap("3-two-details", 2500);
  ch("b");
  await snap("4-backlinks", 4000);
  press({ kind: "esc" }); ch("t");
  await snap("5-tree-drawer", 3000);
  board.close(); process.exit(0);
}
if (scenario === "river") {
  app.push(new MainMenu()); app.push(new River());
  await snap("1-library", 3000);
  press({ kind: "enter" });                         // Pi Outliner Workboard beside Library
  await snap("2-opened", 3000);
  press({ kind: "down" }); press({ kind: "down" }); press({ kind: "down" }); ch(" ");   // replies in place
  await snap("3-thread", 3000);
  press({ kind: "enter" }); await Bun.sleep(2500);
  press({ kind: "enter" }); await Bun.sleep(2500);
  await snap("4-compressed", 1500);
  ch("/"); for (const c of "PIE-367") ch(c);
  await snap("5-palette", 12000);
  press({ kind: "enter" });
  await snap("6-jumped", 3000);
  board.close(); process.exit(0);
}
if (scenario === "desk") {
  app.push(new MainMenu()); app.push(new Desk());
  await snap("1-open", 4000);
  press({ kind: "down" }); press({ kind: "down" }); press({ kind: "right" });
  await snap("2-expanded", 3000);
  press({ kind: "tab" }); press({ kind: "tab" });
  await snap("3-thread-focus", 1500);
  press({ kind: "char", ch: "w", ctrl: true }); ch("o"); ch("b");
  await snap("4-added-art", 1500);
  press({ kind: "char", ch: "w", ctrl: true }); ch("L");
  await snap("5-docked-right", 800);
  ch("/"); for (const c of "PIE-367") ch(c);
  await snap("6-search", 3500);
  press({ kind: "enter" });
  await snap("7-after-search", 3000);
  board.close(); process.exit(0);
}
app.push(new Logon(app));
await snap("1-logon", 3000);
press({ kind: "enter" });
await snap("2-menu");
ch("N"); await snap("3-newscan", 1500);
press({ kind: "enter" }); await snap("4-reader", 1500);
ch("q"); ch("q");
ch("W"); await snap("5-who", 1500); ch("q");
ch("L"); await snap("6-lastcallers", 2000); ch("q");
ch("F"); await snap("7-files", 800);
press({ kind: "down" }); press({ kind: "down" }); press({ kind: "enter" });
await snap("8-viewer", 2500);
ch("q"); ch("q");
ch("S"); await snap("9-stats", 2500); ch("q");
await snap("10-menu-again", 200);
board.close();
process.exit(0);
