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
const wide = ["desk", "river", "board", "board2", "board3", "doc", "float", "live", "edit", "comment"].includes(scenario);
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
  const text = ["Doc rendering demo", "[type::demo]", "",
    "> [!note] Notes (not part of the message): follows the 2:34 PM ask, no reply yet.", "> New reason since then: Milind holds Rexall's production eFax deploy until our dev end-to-end test.", "",
    "::graph-check", "---", "title: PC-762 path to prod", "items:", "  - { label: \"PR 1 and PR 2 merged\", done: true }", "  - { label: \"eFax values in dev Key Vault\", note: \"waiting on Sumit\" }", "  - { label: \"dev end-to-end test\" }", "---", "::", "",
    "::graph-timeline", "---", "title: shipped", "events:", "  - { date: \"Sep 24\", label: \"real registrar on dev\" }", "  - { date: \"Sep 25\", label: \"staging open for QA\", state: now }", "  - { date: \"Sep 29\", label: \"sprint ends\", state: next }", "---", "::", "",
    "::graph-stat", "---", "title: this week", "items:", "  - { value: \"18\", label: outbox }", "  - { value: \"8\", label: waiting }", "  - { value: \"2\", label: drafts }", "---", "::", "",
    "::graph-waterfall", "---", "title: margin", "items:", "  - { label: Revenue, value: 48 }", "  - { label: Refunds, value: -6 }", "  - { label: Hosting, value: -4 }", "  - { label: Profit, value: 38 }", "---", "::", "",
    "::graph-table", "---", "title: \"what the research cost\"", "headers: [Agent, Tokens, \"Tool calls\", Time]", "align: [left, right, right, right]", "rows:", "  - [\"Inks and paper\",\"115,207\",\"120\",\"16m\"]", "  - [\"Naming the patterns\",\"186,716\",\"112\",\"18m\"]", "footer: [Total, \"437,141\", \"396\", \"~50m\"]", "---", "::", "",
    "::graph-gantt", "---", "title: launch", "progress: 0.58", "ticks: [q1, q2, q3, q4]", "items:", "  - { label: design, start: 0, end: 0.35, complete: 1 }", "  - { label: build, start: 0.2, end: 0.75, complete: 0.55 }", "  - { label: ship, start: 0.85, end: 1, complete: 0 }", "---", "::", "",
    "pasted from the mdxcn docs:", "```", "+------------------- [ LAUNCH ] -------------------+", "|                                                  |", "| [x]  freeze tokens                               |", "| [ ]  write the postmortem  still open            |", "|                                                  |", "+--------------------------------------------------+", "```"].join("\n");
  const pane = new ReaderPane();
  const api: any = { ctx: app, current: null, setCurrent() {}, focusKind() {}, redraw: () => app.redraw() };
  pane.show({ id: "demo", text, parentId: null, childIds: [], createdAt: Date.now(), updatedAt: Date.now(), author: "you", props: {} }, api);
  onMediaChange(() => app.redraw());
  // Same note twice: a narrow reader beside a wide one.
  const narrow = new ReaderPane(); narrow.show((pane as any).msg, api);
  app.push({ title: "doc", render: (ctx: any) => {
    const n = narrow.render(46, ctx.t.rows - 3, true, api).lines, v = pane.render(ctx.t.cols - 54, ctx.t.rows - 3, true, api).lines;
    return { lines: Array.from({ length: ctx.t.rows - 1 }, (_, i) => " " + (n[i] ?? "") + "\x1b[0m" + " ".repeat(Math.max(0, 48 - [...(n[i] ?? "").replace(/\x1b\[[\d;]*m/g, "")].length)) + "  " + (v[i] ?? "")) };
  }, key() {} } as any);
  await snap("1-doc", 4000);
  board.close(); process.exit(0);
}
if (scenario === "live") {
  const { ReaderPane } = await import("../src/desk/panes");
  const text = ["Live figures", "", "::graph-check", "---", "title: PC-762 outbox", "query: \"type=outbox-item ticket=PC-762\"", "done: \"outbox=done\"", "note: waiting-on", "---", "::", "",
    "::graph-stat", "---", "title: outbox now", "items:", "  - { label: drafts, query: \"type=outbox-item outbox=draft\" }", "  - { label: waiting, query: \"type=outbox-item outbox=waiting\" }", "  - { label: done, query: \"type=outbox-item outbox=done\" }", "---", "::", "",
    "::graph-table", "---", "title: reply owed", "query: \"type=outbox-item outbox=waiting\"", "columns: [ticket, title, waiting-on, updated]", "headers: [Ticket, Message, \"Waiting on\", Sent]", "---", "::", "",
    "::graph-rank", "---", "title: outbox by ticket", "query: \"type=outbox-item\"", "group: ticket", "---", "::", "",
    "::graph-check", "---", "title: doing (saved view)", `view: ((${process.env.VIEW}))`, "note: ticket", "---", "::"].join("\n");
  const pane = new ReaderPane();
  const api: any = { ctx: app, current: null, setCurrent() {}, focusKind() {}, redraw: () => app.redraw() };
  pane.show({ id: "demo", text, parentId: null, childIds: [], createdAt: Date.now(), updatedAt: Date.now(), author: "you", props: {} }, api);
  app.push({ title: "live", render: (ctx: any) => ({ lines: pane.render(110, ctx.t.rows - 2, true, api).lines.map((l: string) => "  " + l) }), key() {} } as any);
  await snap("1-asking", 200);
  await snap("2-answered", 5000);
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
if (scenario === "edit") {
  // Writes: seeds its own board, edits a card, and races a second writer. Scratch outlines only.
  if (process.env.EP0CH_SNAP_WRITES !== "1") { console.error("edit writes to the outline: point EP0CH_SOCKET at a scratch service and set EP0CH_SNAP_WRITES=1"); process.exit(2); }
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Scratch delivery board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  await mk(hub.id, "Done [type::virtual-branch] [query::stage=done]");
  const card = await mk(null, "EPD-001 scratch card [stage::queued]\nEdit me from any reader.\n\n- [ ] typed in the door\n- [ ] saved with a revision check");
  await mk(null, "Already shipped [stage::done]\nA finished card.");
  board.subscribe(e => app.event(e));   // readers learn about the other writer the way the real door does
  app.push(new MainMenu()); app.push(new DeliveryBoard(hub.id));
  await snap("1-lanes", 2500);
  ch("e"); await Bun.sleep(500);
  for (const c of " (edited in the door)") ch(c);
  press({ kind: "down" }); press({ kind: "end" }); for (const c of " Typed here, in place.") ch(c);
  await snap("2-editing", 800);
  const other = new SocketBoard();
  const now = (await other.request("blocks.context", { blockId: card.id })).selected;
  await other.update(card.id, now.text.replace("Edit me", "Someone else edited me"), now.revision);
  await snap("3-changed-elsewhere", 1500);
  press({ kind: "char", ch: "s", ctrl: true });
  await snap("4-refused", 1200);
  press({ kind: "char", ch: "r", ctrl: true }); await Bun.sleep(600);
  for (const c of " (second try)") ch(c);
  press({ kind: "char", ch: "s", ctrl: true });
  await snap("5-saved", 1500);
  const final = (await other.request("blocks.context", { blockId: card.id })).selected;
  console.log(`service text now (revision ${final.revision}, actor ${final.actorId}):\n${final.text}`);
  other.close(); board.close(); process.exit(0);
}
if (scenario === "comment") {
  // Writes: seeds its own board, comments on a passage from the preview, replies, resolves, and has a
  // second writer move the note under an open comment. Scratch outlines only.
  if (process.env.EP0CH_SNAP_WRITES !== "1") { console.error("comment writes to the outline: point EP0CH_SOCKET at a scratch service and set EP0CH_SNAP_WRITES=1"); process.exit(2); }
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Scratch delivery board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  await mk(hub.id, "Done [type::virtual-branch] [query::stage=done]");
  const card = await mk(null, "EPD-004 scratch card [stage::queued]\nShip the release notes before Friday.\n\nThe release notes need a review before they go out.\n\n- [ ] ask for a second reader\n- [ ] post the notes");
  await mk(null, "Already shipped [stage::done]\nA finished card.");
  board.subscribe(e => app.event(e));
  const screen = new DeliveryBoard(hub.id);
  app.push(new MainMenu()); app.push(screen);
  await snap("1-lanes", 2500);
  for (let i = 0; i < 6 && (screen as any).focus !== "preview"; i++) press({ kind: "tab" });
  ch("c"); await Bun.sleep(500);
  ch("j"); ch("l"); for (let i = 0; i < 7; i++) ch("H");          // "release notes" on the second line that has it
  await snap("2-picking", 600);
  press({ kind: "enter" });
  for (const c of "Who reviews these? Needs a name before Friday.") ch(c);
  await snap("3-writing", 600);
  press({ kind: "char", ch: "s", ctrl: true });
  await snap("4-sent", 1500);
  ch("r"); for (const c of "Taking it: reading tonight.") ch(c);
  press({ kind: "char", ch: "s", ctrl: true });
  await snap("5-replied", 1500);
  ch("x");
  await snap("6-resolved", 1500);
  press({ kind: "esc" });
  await snap("7-reader", 1500);
  // A second writer moves the note while a new comment is being written.
  ch("c"); await Bun.sleep(500);
  press({ kind: "enter" }); for (const c of "Friday is tight.") ch(c);
  const other = new SocketBoard();
  const now = (await other.request("blocks.context", { blockId: card.id })).selected;
  await other.update(card.id, now.text.replace("\nShip", "\nScope moved to v2.\nShip"), now.revision);
  press({ kind: "char", ch: "s", ctrl: true });
  await snap("8-refused", 1500);
  press({ kind: "char", ch: "r", ctrl: true });
  await snap("9-found-again", 1200);
  press({ kind: "char", ch: "s", ctrl: true });
  await snap("10-sent-after-move", 1500);
  const list = await other.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId: card.id }, includeResolved: true } });
  for (const t of list) console.log(`${t.lifecycle} "${t.originalTarget.anchor.exact}" @${t.originalTarget.anchor.start}: ${t.body} (${t.replies.length} repl.)`);
  other.close(); board.close(); process.exit(0);
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
