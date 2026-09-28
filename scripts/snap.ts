// Drive the real door against the live outline and snapshot what a Kitty terminal would show.
// src/mirror.ts consumes the exact bytes the door writes and composites them into a PNG.
//   bun scripts/snap.ts [cells] → out/snap-*.png
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { Mirror } from "../src/mirror";
import { App } from "../src/app";
import { Logon, MainMenu } from "../src/screens";
import { Desk } from "../src/desk/desk";
import { River } from "../src/river/river";
import { DeliveryBoard } from "../src/desk/delivery";
import { SocketBoard } from "../src/socket";
import type { Key, TermInfo } from "../src/term";

const scenario = process.argv[2] ?? "kitty";

// Scenarios that write seed their own board and edit it. They only ever run against a scratch service:
// an explicit EP0CH_SOCKET (never the default socket) under the temp dir, whose workspace is there too.
const WRITES = ["edit", "props", "move", "comment", "agent"];
const underTemp = (p: string) => {
  const real = (x: string) => { try { return realpathSync(x); } catch { return resolve(x); } };
  const r = real(p);
  return [...new Set([tmpdir(), "/tmp"].map(real))].some(t => r === t || r.startsWith(t + sep));
};
const refuse = (why: string) => { console.error(`${scenario} writes to the outline: ${why}`); process.exit(2); };
if (WRITES.includes(scenario)) {
  const sock = process.env.EP0CH_SOCKET;
  if (!sock) refuse("set EP0CH_SOCKET to a scratch service's socket (the default socket is never written to), and EP0CH_SNAP_WRITES=1");
  else if (!underTemp(sock)) refuse(`EP0CH_SOCKET must be a scratch service's socket under the temp dir (${tmpdir()}), not ${sock}`);
  else if (process.env.EP0CH_SNAP_WRITES !== "1") refuse("point EP0CH_SOCKET at a scratch service and set EP0CH_SNAP_WRITES=1");
}
process.env.EP0CH_STATE = "out/state";   // never touch the real desk / river layout
const wide = ["showcase", "select", "spines", "complete", "desk", "river", "river-write", "board", "board2", "board3", "doc", "float", "live", "edit", "move", "comment", "journey", "agent", "kanban", "props", "scroll", "fold", "elements"].includes(scenario);
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
// `showcase`, `select`, `spines`, `journey`, `kanban`, `river-write`, `scroll`, `complete`, `fold` and `elements` run their own scratch service (EP0CH_OUTLINER=<pi-herdr-outliner checkout>).
const scratch = scenario === "showcase" || scenario === "select" || scenario === "spines" || scenario === "journey" || scenario === "kanban" || scenario === "river-write" || scenario === "scroll" || scenario === "complete" || scenario === "fold" || scenario === "elements" ? await (async () => {
  const { outliner, Scratch } = await import("../test/scratch");
  if (!outliner) { console.error(`${scenario} starts its own scratch service: set EP0CH_OUTLINER to a pi-herdr-outliner checkout`); process.exit(2); }
  return new Scratch();
})() : null;
const board = new SocketBoard(scratch ? await scratch.start() : undefined);
const info = await board.info();
if (WRITES.includes(scenario) && !underTemp(info.workspace)) refuse(`the service at EP0CH_SOCKET serves ${info.workspace}, not a scratch workspace under the temp dir`);
const app = new App(fakeTerm as any, board, Date.now() - 6 * 3600_000, () => {});
app.host = info.host; app.workspace = info.workspace;
mkdirSync("out", { recursive: true });
const tag = scenario;
const snap = async (name: string, wait = 600) => {
  await Bun.sleep(wait);
  app.redraw();
  writeFileSync(`out/snap-${tag}-${name}.png`, emu.snapshot(fakeTerm.info));
  writeFileSync(`out/snap-${tag}-${name}.txt`, emu.text().join("\n") + "\n");
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
if (scenario === "showcase") {
  // PIE-439: the showcase on its own seeded outline (src/showcase/seed.ts, fictional), one snapshot per
  // section, then a few interactions: a section's own keys, a click on the index, an agent's act.
  const { seedShowcase } = await import("../src/showcase/seed");
  const { Showcase, SECTIONS } = await import("../src/showcase/showcase");
  await seedShowcase(board);
  board.subscribe(e => app.event(e));
  const sc = new Showcase();
  app.push(new MainMenu()); app.push(sc);
  await Bun.sleep(800);
  for (let i = 0; i < SECTIONS.length; i++) {
    ch(i === 9 ? "0" : String(i + 1));
    await snap(`${String(i + 1).padStart(2, "0")}-${SECTIONS[i]!.key}`, i === 4 || i === 7 ? 2500 : 1200);
  }
  ch("5"); press({ kind: "enter" }); ch("c");                                           // the board: collapse a lane to a spine
  await snap("11-board-spine", 1000);
  press({ kind: "esc" });                                                               // the board's own back key
  ch("3"); press({ kind: "enter" }); ch("e"); await Bun.sleep(600); for (const c of " [[Bike") ch(c);  // edit, and complete a page
  await snap("12-edit-complete", 1500);
  press({ kind: "esc" }); press({ kind: "esc" }); await Bun.sleep(200); press({ kind: "esc" }); ch("q");
  press({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 + 8 * 2 }); press({ kind: "mouse", action: "up", button: 0, x: 3, y: 2 + 8 * 2 });   // click section 9
  await snap("13-clicked-selection", 800);
  await app.act({ action: "section", args: { name: "service" }, as: "snap-agent" });
  await snap("14-agent-section", 1500);
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "spines") {
  // PIE-440 (its own scratch service, fictional cards): a lane, a detail holding an agent's draft and the
  // preview collapsed to spines, their titles rotated under Kitty graphics.
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Allotment board");
  for (const [lane, q] of [["Queued", "stage=queued"], ["Doing", "stage=doing"], ["Done", "stage=done"]]) await mk(hub.id, `${lane} [type::virtual-branch] [query::${q}]`);
  for (const [t, st] of [["Stake the beans", "queued"], ["Plant the squash", "queued"], ["Fix the gate", "doing"], ["Paint the shed", "done"]])
    await mk(null, `${t} [stage::${st}]\n${t}: the rake leans on the shed, the hose runs along the fence.`);
  const b = new DeliveryBoard(hub.id);
  app.push(new MainMenu()); app.push(b);
  await Bun.sleep(2500);
  press({ kind: "down" }); press({ kind: "enter" }); await Bun.sleep(800);             // a detail
  press({ kind: "esc" }); press({ kind: "right" }); press({ kind: "right" }); ch("c");  // collapse Done
  press({ kind: "left" }); press({ kind: "left" });
  const held = (b as any).details[0].msg;
  await app.act({ action: "edit.text", args: { text: `${held.text}\nOil the hinge before the frost.` }, reader: "detail1", as: "snap-agent" });
  await snap("1-open", 800);
  press({ kind: "tab" }); press({ kind: "tab" }); ch("c");                              // the detail, holding the agent's draft
  await snap("2-detail-spine", 800);
  press({ kind: "backtab" }); ch("c");                                                  // the preview
  await snap("3-preview-spine", 800);
  console.log(JSON.stringify((b as any).placed.map((x: any) => x.p.key)), JSON.stringify((app.describe() as any).state.collapsedReaders));
  press({ kind: "alt", ch: "c" });
  await snap("4-all-open", 800);
  await app.act({ action: "edit.close", args: { discard: true }, reader: "detail1", as: "snap-agent" });
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "kanban") {
  // PIE-406 on an All-work-shaped board (its own scratch service, fictional cards): OR lanes, moving into
  // them, a new card that must meet the group, checklist steps, trash and undo.
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const q = (stage: string) => `type=roadmap-item (project=pi-outliner OR project=ep0ch-door) work-stage=${stage}`;
  // Roadmap lanes create through the workboard's allocator: a Work-ID prefix and one work queue per project.
  await board.request("work-ids.configure", { prefix: "HOME" });
  const queue = await mk(null, "Door work queue [type::work-queue] [project::ep0ch-door]");
  await mk(null, "Outliner work queue [type::work-queue] [project::pi-outliner]");
  const hub = await mk(null, "All work Delivery Flow");
  await mk(hub.id, `Queued [type::virtual-branch] [query::${q("queued")}] [create::project=ep0ch-door]`);
  for (const st of ["doing", "review", "done"]) await mk(hub.id, `${st[0]!.toUpperCase()}${st.slice(1)} [type::virtual-branch] [query::${q(st)}]`);
  await mk(hub.id, "Everything [type::virtual-branch] [query::type=roadmap-item]");
  const shelf = await mk(queue.id, "Level the shelf [type::roadmap-item] [project::pi-outliner] [work-stage::queued] [priority::high]\n\n- [ ] find the spirit level\n- [ ] loosen the brackets\n- [x] clear the books");
  await mk(queue.id, "Descale the kettle [type::roadmap-item] [project::ep0ch-door] [work-stage::queued]");
  await mk(queue.id, "Swap the porch bulb [type::roadmap-item] [project::pi-outliner] [work-stage::doing]");
  const tap = await mk(queue.id, "Fix the dripping tap [type::roadmap-item] [project::ep0ch-door] [work-stage::review]");
  await mk(tap.id, "Washer size is 1/2 inch.");
  const club = await mk(null, "Plan the garden club rota [type::roadmap-item] [project::garden-club] [work-stage::queued]");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  const settle = async () => { for (let i = 0; i < 100 && (S.moving || S.lanes.some((l: any) => !l.items || l.want)); i++) await Bun.sleep(50); await Bun.sleep(400); };
  const ctrl = (c: string) => press({ kind: "char", ch: c, ctrl: true });
  const type = (t: string) => { for (const c of t) ch(c); };
  const said = () => console.log(`  status: ${(app as any).message || "(none)"} · refreshes ${JSON.stringify(S.refreshes)}`);
  const pick = (lane: string, id: string) => { S.focus = "lanes"; S.lane = S.lanes.findIndex((l: any) => l.name === lane); S.lanes[S.lane].sel = S.lanes[S.lane].items.findIndex((m: any) => m.id === id); S.follow(); app.redraw(); };
  const to = (lane: string) => { const t = S.lanes.findIndex((l: any) => l.name === lane); for (let i = 0; i < 10 && S.mover && S.mover.sel !== t; i++) ch(S.mover.sel < t ? "j" : "k"); };
  app.push(new MainMenu()); app.push(B);
  await snap("1-or-lanes", 2500);
  // A card outside the group: the picker says which term it doesn't meet.
  pick("Everything", club.id); ch("m"); to("Doing");
  await snap("2-or-refused", 600);
  press({ kind: "esc" });
  // A card in one of the projects: only work-stage is patched.
  pick("Queued", shelf.id); ch("m"); to("Doing");
  await snap("3-or-move-picker", 600);
  press({ kind: "enter" }); await settle();
  await snap("4-or-moved", 800); said();
  // A new roadmap item in Doing: no create:: default, so the text must meet the group, and the
  // allocator needs priority, arc and a track.
  ch("n"); await Bun.sleep(400); type("Replace the doormat [priority::low] [arc::home] [track::doors]");
  await snap("5-composer", 400);
  ctrl("s"); await Bun.sleep(600);
  await snap("6-composer-refused", 200); said();
  type(" [project::ep0ch-door]"); ctrl("s"); await settle();
  await snap("7-created", 800); said();
  // Review takes no new roadmap items: create in Queued or Doing, then move.
  pick("Review", tap.id); ch("n"); await Bun.sleep(200);
  await snap("7b-review-refused", 200); said();
  // Steps: check one off.
  pick("Doing", shelf.id); ch("s"); await Bun.sleep(500); ch(" "); await Bun.sleep(700);
  await snap("8-steps", 300); said();
  press({ kind: "esc" });
  // Trash with d d, then the banner offers u.
  pick("Review", tap.id); ch("d"); await Bun.sleep(300);
  await snap("9-trash-confirm", 200);
  ch("d"); await settle();
  await snap("10-trashed", 600); said();
  ch("u"); await settle();
  await snap("11-restored", 600); said();
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "scroll") {
  // PIE-411 on its own scratch service (fictional long notes): scroll indicators on docked readers, a
  // float and the desk; a comment session opened by m shows in the frame and hints; an agent's edit
  // doesn't take the person's keys until they enter it.
  const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const long = (t: string, st: string) => `${t} [stage::${st}]\n${Array.from({ length: 90 }, (_, i) => `${i % 12 === 0 ? `## Part ${i / 12 + 1}\n` : ""}${t} line ${i + 1}: the hose runs along the fence past the shed.`).join("\n")}`;
  const hub = await mk(null, "Garden board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  await mk(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
  for (const [t, st] of [["Stake the beans", "queued"], ["Plant the squash", "queued"], ["Fix the gate", "doing"]] as const) await mk(null, long(t, st));
  const gate = (await board.query("stage=doing", 5))[0]!;
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  const agent = (action: string, reader: string, args: Record<string, unknown> = {}) => app.act({ action, reader, args, as: "snap-agent" });
  const wheelAt = (region: string, n: number) => { const r = S.rects.get(region); for (let i = 0; i < n; i++) press({ kind: "mouse", action: "wheel-down", button: 0, x: r.col + 5, y: r.row + 5 }); };
  app.push(new MainMenu()); app.push(B);
  await snap("1-board", 2500);
  press({ kind: "enter" }); await Bun.sleep(600);
  press({ kind: "pgdn" }); press({ kind: "pgdn" }); wheelAt("preview", 4);
  await snap("2-scrolled", 600);
  ch("m"); await Bun.sleep(600);
  await snap("3-comments-mode", 400);
  wheelAt("preview", 6);
  await snap("4-wheel-while-commenting", 400);
  press({ kind: "esc" }); press({ kind: "esc" });
  await agent("edit", "preview");
  ch("j"); ch("j");
  await snap("5-agent-edit-lanes-keep-keys", 600);
  press({ kind: "tab" });
  await snap("6-agent-edit-focused", 400);
  await agent("edit.close", "preview", { discard: true });
  press({ kind: "esc" });
  await agent("open", "float", { id: gate.id }); await Bun.sleep(600);
  for (let i = 0; i < 3; i++) press({ kind: "pgdn" });
  await snap("7-float", 600);
  app.pop(); app.push(new Desk());
  await agent("open", "", { id: gate.id }); await Bun.sleep(800);
  press({ kind: "pgdn" }); press({ kind: "pgdn" });
  await snap("8-desk", 800);
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "complete") {
  // PIE-416 on its own scratch service (fictional notes): [[, (( and [file:: completion in the preview's
  // editor, and in a comment composer.
  const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const { mkdirSync: md, writeFileSync: wf } = await import("node:fs");
  md(`${info.workspace}/notes/beds`, { recursive: true }); wf(`${info.workspace}/notes/plan.md`, "the plan\n"); wf(`${info.workspace}/notes/seeds.md`, "beans\n");
  await board.request("work-ids.configure", { prefix: "HOME" });
  await mk(null, "Door work queue [type::work-queue] [project::garden]");
  for (const t of ["Oil the hinges", "Hang the shed door", "Fix the gate latch"]) await board.createRoadmapItem({ title: t, priority: "medium", project: "garden", arc: "home", tracks: ["doors"] });
  const hub = await mk(null, "Garden board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  await mk(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
  await mk(null, "Seed list [page::seeds]\nWhat to sow this spring.\n## Beans ^beans\nrunner beans");
  await mk(null, "Plant the squash [stage::queued]\nBy the compost heap.\n## Beds\nfour of them");
  await mk(null, "Turn the compost [stage::doing]\nEvery two weeks, bucket by the shed.");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id);
  const type = (s: string) => { for (const c of s) ch(c); };
  app.push(new MainMenu()); app.push(B);
  await Bun.sleep(2500);
  ch("e"); await Bun.sleep(600);
  press({ kind: "end" }); press({ kind: "down" }); press({ kind: "end" }); press({ kind: "enter" });
  type("see [[HOME");
  await snap("1-work-ids", 800);
  press({ kind: "down" }); await snap("2-chosen", 500);
  // The mouse: the wheel over the popup moves the choice back, a click on the last candidate inserts it.
  const rowOf = (t: string) => emu.text().findIndex(l => l.includes(t));
  press({ kind: "mouse", action: "wheel-up", button: 0, x: 20, y: rowOf("references") });
  press({ kind: "mouse", action: "down", button: 0, x: 20, y: rowOf("Fix the gate latch") });
  press({ kind: "mouse", action: "up", button: 0, x: 20, y: rowOf("Fix the gate latch") });
  await Bun.sleep(500);
  type(" and ((compo");
  await snap("3-blocks", 800);
  press({ kind: "enter" }); await Bun.sleep(500);
  type(" ((#be");
  await snap("4-own-heading", 800);
  press({ kind: "esc" }); await snap("5-dismissed", 300);
  press({ kind: "enter" }); type("[file::notes/");
  await snap("6-files", 800);
  press({ kind: "esc" }); press({ kind: "esc" }); press({ kind: "esc" });
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "select") {
  // PIE-419 on its own scratch service (a fictional planting note): a drag selects (the copy control
  // appears), the keyboard mode, an agent's selection in its own tint beside the person's, and the same
  // in cells video.
  const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Garden board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  const beans = await mk(null, "Stake the beans\nCanes along the fence.");
  const plan = await mk(null, `Plan the allotment [stage::queued]\nSow peas early, see ((${beans.id})) for the canes.\n\n## Water\nThe hose runs along the fence past the shed; **water the seedlings** every morning.\n\n- dig the bed\n- buy canes\n\n> [!note] Frost\n> Nothing out before mid May.`);
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  const at = (region: string, words: string) => {
    const r = S.rects.get(region), rows = emu.text();
    const y = rows.findIndex((l, i) => i > r.row && i < r.row + r.rows - 1 && [...l].slice(r.col, r.col + r.cols).join("").includes(words));
    if (y < 0) throw new Error(`no "${words}" in ${region}`);
    return { x: [...rows[y]!].join("").indexOf(words, r.col), y };
  };
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => press({ kind: "mouse", action, button: 0, x, y });
  app.push(new MainMenu()); app.push(B);
  await app.act({ action: "open", reader: "detail", args: { id: plan.id }, as: "snap-agent" });
  await snap("1-open", 2000);
  const a = at("detail0", "Sow peas"), z = at("detail0", "past the shed");
  mouse("down", a.x, a.y); mouse("drag", a.x + 1, a.y); mouse("drag", z.x + 12, z.y); mouse("up", z.x + 12, z.y);
  await snap("2-dragged", 300);
  ch("y"); await snap("3-copied", 300);
  press({ kind: "esc" });
  ch("v"); ch("j"); ch("l"); ch("l"); ch("l");
  await snap("4-keyboard-mode", 300);
  press({ kind: "esc" });
  const w = at("detail0", "dig the bed");
  mouse("down", w.x, w.y); mouse("drag", w.x + 3, w.y); mouse("up", w.x + 3, w.y);
  await app.act({ action: "select", reader: "detail", args: { text: "Nothing out before mid May" }, as: "snap-agent" });
  await snap("5-agent-and-person", 400);
  ch("V"); ch("V");
  await snap("6-cells", 400);
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "fold") {
  // PIE-410 on its own scratch service (a fictional planting note): fold a section by keys, a list item
  // by a click, and all sections at once; an edit elsewhere refreshes the reader and keeps the folds; an
  // agent unfolds through the registry; the desk's reader folds the same way.
  const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const beds = Array.from({ length: 14 }, (_, i) => `- bed ${i + 1}: beans, then squash\n  - edge it with boards\n  - two barrows of compost\n    well rotted, from the far heap`).join("\n");
  const text = `Plan the allotment [stage::queued]\nWhat goes where this year.\n\n## Beds\n${beds}\n\n### Soil\nLoam, mostly; lime the brassica bed.\n\n## Water\nThe hose runs along the fence past the shed.\n\`\`\`\n# not a heading: code\n\`\`\`\n\n## Paths\n- woodchip between the beds\n- a wider one to the shed\n\n# Later\nMulch in autumn.`;
  const hub = await mk(null, "Garden board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  const plan = await mk(null, text);
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  const agent = (action: string, reader: string, args: Record<string, unknown> = {}) => app.act({ action, reader, args, as: "snap-agent" });
  const clickOn = (region: string, words: string, dx = 4) => {
    const r = S.rects.get(region), rows = emu.text();
    const y = rows.findIndex((l, i) => i > r.row && i < r.row + r.rows - 1 && [...l].slice(r.col, r.col + r.cols).join("").includes(words));
    if (y < 0) throw new Error(`no "${words}" in ${region}`);
    press({ kind: "mouse", action: "down", button: 0, x: r.col + dx, y }); press({ kind: "mouse", action: "up", button: 0, x: r.col + dx, y });
  };
  app.push(new MainMenu()); app.push(B);
  await agent("open", "detail", { id: plan.id });
  await snap("1-unfolded", 2000);
  ch(")"); await snap("2-selected", 300);
  ch("f"); await snap("3-beds-folded", 300);
  ch("f"); ch(")"); ch(")");
  await snap("4-item-selected", 300);
  clickOn("detail0", "bed 2:", 2);
  await snap("5-item-clicked", 300);
  ch("F"); await snap("6-all-cleared", 300);
  ch("F"); await snap("7-all-folded", 300);
  const cur = (await board.get(plan.id))!;
  await board.update(plan.id, cur.text.replace("What goes where this year.", "What goes where this year (edited elsewhere)."), cur.revision!);
  await snap("8-edited-elsewhere-folds-kept", 1000);
  await agent("unfold", "detail", { text: "Water" });
  await snap("9-agent-unfolds", 400);
  app.pop(); app.push(new Desk());
  await agent("open", "", { id: plan.id }); await Bun.sleep(800);
  ch(")"); ch("f");
  await snap("10-desk", 800);
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "elements") {
  // PIE-441 on its own scratch service (fictional garden notes): [ ] walk a note's elements in the
  // preview with the reading ruler under the current one, ⏎ on a figure row opens a detail, the comment
  // mark opens its thread, and an agent's focus mark in the detail is tinted and named.
  const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const plan = (await board.request<any>("pages.follow", { address: "Garden plan", author: "agent" })).block;
  const beans = await mk(null, "Stake the beans\nCanes along the fence.");
  const shed = await mk(null, "Paint the shed\nTwo coats, green.");
  await mk(null, "Water the seedlings [type::garden-job]");
  await mk(null, "Turn the compost [type::garden-job]");
  const figure = `::graph-check\n---\ntitle: Garden jobs\nquery: "type=garden-job"\nsort: created\ndirection: asc\n---\n::`;
  const jobs = await mk(null, `Weekend jobs [stage::queued]\nFirst ((${beans.id})), then [[Garden plan]].\n\n## Beds\n- dig the north bed\n  - edge it with boards\n  - two barrows of compost\n\n${figure}\n\n!((${shed.id}))\n\n## Water\nThe hose runs along the fence past the shed.`);
  await board.comment(`snap-${crypto.randomUUID()}`, jobs.id, jobs.revision, "Use the long spade.", { quote: "dig the north bed", start: jobs.text.indexOf("dig the north bed") });
  void plan;
  const hub = await mk(null, "Garden board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  app.push(new MainMenu()); app.push(B);
  await snap("1-preview", 2000);
  S.focus = "preview";
  ch("]"); ch("]"); await snap("2-link-ruler", 300);
  for (let i = 0; i < 5; i++) ch("]");
  await snap("3-figure-row", 300);
  press({ kind: "enter" }); await snap("4-row-opens-detail", 800);
  S.focus = "preview";
  ch("["); ch("["); ch("["); await snap("5-comment-mark", 300);
  press({ kind: "enter" }); await snap("6-thread", 600);
  press({ kind: "esc" });
  await app.act({ action: "open", reader: "detail", args: { id: jobs.id }, as: "snap-agent" });
  await Bun.sleep(600);
  await app.act({ action: "focus.set", reader: "detail1", args: { quote: "The hose runs along the fence past the shed." }, as: "snap-agent" });
  await snap("7-agent-focus", 400);
  board.close(); await scratch!.dispose(); process.exit(0);
}
if (scenario === "journey") {
  // The integrated door, one pass: board → preview → edit with a property warning → move → comment →
  // another client edits → the service restarts. Its own scratch service and fictional notes only.
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Garden board");
  for (const l of ["Queued [type::virtual-branch] [query::stage=queued]", "Doing [type::virtual-branch] [query::stage=doing]",
    "Done [type::virtual-branch] [query::stage=done]", "Stuck [type::virtual-branch] [query::stage=blocked OR stage=waiting]"]) await mk(hub.id, l);
  const shed = await mk(null, "Paint the shed [stage::queued] [priority::high]\nTwo coats, green. Sand the door first.\n\n- [ ] buy sandpaper\n- [ ] pick a dry weekend");
  await mk(null, "Water the ferns [stage::queued] [priority::low]\nTwice a week, from the rain barrel.");
  const gate = await mk(null, "Oil the gate [stage::doing]\nIt squeaks when the wind turns.");
  await mk(null, "Sort the seed box [stage::done]\nDone last week.");
  await mk(null, "Mend the hose [stage::blocked]\nWaiting on a new washer.");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  const settle = async () => { for (let i = 0; i < 100 && (S.moving || S.lanes.some((l: any) => !l.items || l.want)); i++) await Bun.sleep(50); await Bun.sleep(400); };
  const ctrl = (c: string) => press({ kind: "char", ch: c, ctrl: true });
  const other = new SocketBoard(board.path);
  const said = () => console.log(`  status: ${(app as any).message || "(none)"} · refreshes ${JSON.stringify(S.refreshes)}`);
  app.push(new MainMenu()); app.push(B);
  await snap("1-board", 2500);
  console.log(`  service: ${[...(board.capabilities ?? ["(no capability list)"])].join(", ")} · lanes by ${S.lanes.map((l: any) => l.read?.by).join(",")}`);
  // The preview follows the selected card: Queued, Paint the shed.
  S.lane = S.lanes.findIndex((l: any) => l.name === "Queued"); S.lanes[S.lane].sel = S.lanes[S.lane].items.findIndex((m: any) => m.id === shed.id); S.follow(); app.redraw();
  await snap("2-preview", 1000);
  // Edit it: typing after the property on the subject line would make it text; the service says so first.
  ch("e"); await Bun.sleep(500);
  for (const c of " (retry)") ch(c);
  ctrl("s");
  await snap("3-property-warning", 1200); said();
  for (let i = 0; i < 8; i++) press({ kind: "backspace" });
  press({ kind: "down" }); press({ kind: "end" }); for (const c of " Oil-based paint.") ch(c);
  ctrl("s");
  await snap("4-saved", 1500); said();
  // Move it with the picker: Queued -> Doing. The Stuck lane (OR) is refused with its reason.
  press({ kind: "esc" }); await Bun.sleep(200);
  ch("m"); await Bun.sleep(200);
  for (let i = 0; i < 10 && S.mover && S.mover.sel !== S.lanes.findIndex((l: any) => l.name === "Doing"); i++) ch(S.mover.sel < S.lanes.findIndex((l: any) => l.name === "Doing") ? "j" : "k");
  await snap("5-move-picker", 500);
  press({ kind: "enter" }); await settle();
  await snap("6-moved", 600); said();
  // Comment on a passage from the preview.
  for (let i = 0; i < 6 && S.focus !== "preview"; i++) press({ kind: "tab" });
  ch("c"); await Bun.sleep(600);
  ch("j"); await Bun.sleep(100);
  await snap("7-quoting", 500);
  press({ kind: "enter" }); for (const c of "Which green? The shed or the gate green?") ch(c);
  ctrl("s");
  await snap("8-commented", 1500); said();
  press({ kind: "esc" }); await Bun.sleep(300);
  // Another client edits the note while it's open for editing: the draft is marked, never replaced.
  ch("e"); await Bun.sleep(500);
  for (const c of " Mine.") ch(c);
  const now = (await other.request("blocks.context", { blockId: shed.id })).selected;
  await other.request("update", { blockId: shed.id, text: now.text.replace("Sand the door first.", "Sand the door first, then prime."), expectedRevision: now.revision, mutation: { author: "agent", actorId: "snap-other-writer" } });
  await snap("9-changed-elsewhere", 1500); said();
  press({ kind: "esc" }); press({ kind: "esc" }); await Bun.sleep(200);
  press({ kind: "esc" });                                                   // back to the lanes
  // Another client moves a different card: only the lanes it touches are asked again.
  const before = S.asked.length;
  const g = (await other.request("blocks.context", { blockId: gate.id })).selected;
  await other.request("update", { blockId: gate.id, text: g.text.replace("[stage::doing]", "[stage::done]"), expectedRevision: g.revision, mutation: { author: "agent", actorId: "snap-other-writer" } });
  await snap("10-other-moved", 1800);
  console.log(`  lanes asked again after the other client's move: ${[...new Set(S.asked.slice(before))].join(", ") || "(none)"}`);
  // The service restarts. The door says it's offline, reconnects and catches up.
  other.close();
  await scratch!.stop();
  await snap("11-offline", 800);
  await scratch!.start();
  await snap("12-reconnected", 2500); said();
  const final = await new SocketBoard(board.path).request("blocks.context", { blockId: shed.id });
  console.log(`  service: shed at revision ${final.selected.revision}, ${final.selected.properties.map((p: any) => `${p.key}=${p.value}`).join(" ")}`);
  board.close(); await scratch!.dispose(); process.exit(0);
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
if (scenario === "props") {
  // Writes: seeds a board with a roadmap-like card, then the summary line, the property panel (inline,
  // full, copy, edit, a refused edit, follow) and every kind of transclusion. Scratch outlines only.
  if (process.env.EP0CH_SNAP_WRITES !== "1") { console.error("props writes to the outline: point EP0CH_SOCKET at a scratch service and set EP0CH_SNAP_WRITES=1"); process.exit(2); }
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Scratch roadmap board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::type=roadmap-item work-stage=queued]");
  await mk(hub.id, "Doing [type::virtual-branch] [query::type=roadmap-item work-stage=doing]\n[summary-properties::priority,track]");
  const plan = await mk(null, "Garden plan [page::garden]\nBeans along the fence, squash by the compost.\n\n## Beds ^beds\nTwo raised beds, one for herbs.");
  const shed = await mk(null, "Old shed notes"); await board.request("delete", { blockId: shed.id, author: "agent" });
  const chores = await mk(null, "Queued chores\n[type::virtual-branch]\n[query::type=chore stage=queued]\n[summary-properties::priority]");
  await mk(null, "Plant the beans [type::chore] [stage::queued] [priority::high]");
  await mk(null, "Turn the compost [type::chore] [stage::queued] [priority::low]");
  const batch = await mk(null, "Spring work batch [type::work-batch] [project::garden]");
  const card = await mk(null, [
    "GDN-12 — Build the compost bin",
    "[type::roadmap-item] [priority::high] [work-stage::queued] [project::garden]",
    `[arc::spring-beds] [track::soil] [track::tools] [work-batch::${batch.id}]`,
    `[related-to::${plan.id}] [work-id::GDN-12]`,
    "",
    "## Outcome",
    `A three-bay bin beside the beds in ((${plan.id})), sized for [[garden]]'s kitchen scraps. See ((${plan.id}^beds|the beds)) and [[GDN-99]].`,
    "owner:: the allotment group",
    "",
    "## Embedded",
    `!((${plan.id}))`,
    `!((${plan.id}^beds))`,
    `!((${chores.id}))`,
    `!((${plan.id}^compost))`,
    `!((${shed.id}))`,
    "!((0badc0de-0000-4000-8000-000000000000))",
  ].join("\n"));
  await mk(null, "GDN-13 — Rain barrel [type::roadmap-item] [priority::low] [work-stage::doing] [track::water]\nCatch the shed roof.");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  app.push(new MainMenu()); app.push(B);
  await Bun.sleep(2000);
  ch("l");                                                            // the Queued lane: the compost card
  await snap("1-summary", 1500);
  press({ kind: "tab" }); ch("i");
  await snap("2-panel", 1200);
  for (let i = 0; i < 8; i++) press({ kind: "tab" });                // related-to: a block value, shown by its title
  ch("I"); await snap("3-full", 800);
  ch("I"); for (let i = 0; i < 7; i++) press({ kind: "backtab" });   // priority
  press({ kind: "enter" }); for (let i = 0; i < 4; i++) press({ kind: "backspace" }); for (const c of "medium") ch(c);
  await snap("4-editing", 500);
  press({ kind: "enter" }); await snap("5-saved", 1500);
  // A second writer changes the note while a value is being typed: the save is refused, nothing is overwritten.
  press({ kind: "enter" }); for (const c of "-2") ch(c);
  const other = new SocketBoard();
  const now = (await other.request("blocks.context", { blockId: card.id })).selected;
  await other.update(card.id, now.text.replace("three-bay", "four-bay"), now.revision);
  await Bun.sleep(1200);
  press({ kind: "enter" }); await snap("6-refused", 1500);
  press({ kind: "esc" }); press({ kind: "esc" });
  press({ kind: "enter" });                                           // the card in a detail, tall enough for its embeds
  await snap("7-embeds", 2500);
  ch("i"); for (let i = 0; i < 8; i++) press({ kind: "tab" });
  ch("o"); await snap("8-followed", 1500);
  other.close(); board.close(); process.exit(0);
}
if (scenario === "move") {
  // Writes: seeds its own board and moves cards between lanes by key, picker and mouse. Scratch outlines only.
  if (process.env.EP0CH_SNAP_WRITES !== "1") { console.error("move writes to the outline: point EP0CH_SOCKET at a scratch service and set EP0CH_SNAP_WRITES=1"); process.exit(2); }
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Scratch move board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  await mk(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
  await mk(hub.id, "Review [type::virtual-branch] [query::stage=review track=door]");
  await mk(hub.id, "Done [type::virtual-branch] [query::stage=done]");
  await mk(hub.id, "Parked [type::virtual-branch] [query::stage=parked or stage=blocked]");
  const lamp = await mk(null, "Fix the lamp timer [stage::queued] [track::garden] [priority::high]\nThe porch lamp turns on at noon.");
  await mk(null, "Paint the shed [stage::queued] [track::door]\nTwo coats, green.");
  const gate = await mk(null, "Oil the gate hinge [stage::doing] [track::door]\nIt squeaks.");
  await mk(null, "Sort the seed box [stage::done]\nDone last week.");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id);
  const S = B as any;
  const mouse = (action: "down" | "up" | "drag", x: number, y: number) => press({ kind: "mouse", action, button: 0, x, y });
  const settle = async () => { for (let i = 0; i < 100 && (S.moving || S.lanes.some((l: any) => !l.items || l.want)); i++) await Bun.sleep(50); await Bun.sleep(300); };
  const laneOf = (name: string) => S.lanes.findIndex((l: any) => l.name === name);
  app.push(new MainMenu()); app.push(B);
  await snap("1-lanes", 2500);
  // Keyboard: the lamp card (Queued) → the picker shows every lane's patch, or why not.
  S.lane = laneOf("Queued"); S.lanes[S.lane].sel = S.lanes[S.lane].items.findIndex((m: any) => m.id === lamp.id); app.redraw();
  ch("m");
  while (S.mover.sel !== laneOf("Review")) ch(S.mover.sel < laneOf("Review") ? "j" : "k");
  await snap("2-picker", 400);
  press({ kind: "enter" }); await settle();
  await snap("3-moved-two-values", 300);
  ch("L"); await settle();                                                     // Review → Done: one value
  await snap("4-moved-right", 300);
  ch("L"); await settle();                                                     // Done → Parked: refused, OR isn't in the grammar
  await snap("5-refused", 300);
  // Mouse: drag the gate card from Doing and hover over Review, then drop.
  S.lane = laneOf("Doing"); S.lanes[S.lane].sel = 0; app.redraw(); await Bun.sleep(200);
  const from = S.laneRects.find((r: any) => r.lane === laneOf("Doing")).rect, to = S.laneRects.find((r: any) => r.lane === laneOf("Review")).rect;
  mouse("down", from.col + 4, from.row + 1); mouse("drag", to.col + 6, to.row + 4);
  await snap("6-dragging", 300);
  mouse("up", to.col + 6, to.row + 4); await settle();
  await snap("7-dropped", 300);
  // Someone else edits the card after the board drew it: the move is refused, nothing written.
  const other = new SocketBoard();
  const now = (await other.request("blocks.context", { blockId: gate.id })).selected;
  await other.request("update", { blockId: gate.id, text: now.text.replace("It squeaks.", "It squeaks less."), expectedRevision: now.revision, mutation: { author: "agent", actorId: "snap-other-writer" } });
  ch("L"); await settle();
  await snap("8-stale-refused", 300);
  for (const id of [lamp.id, gate.id]) {
    const b = (await other.request("blocks.context", { blockId: id })).selected;
    console.log(`${id.slice(0, 8)} revision ${b.revision} · ${b.properties.map((p: any) => `${p.key}=${p.value}`).join(" ")}\n  ${b.text.split("\n")[0]}`);
  }
  console.log(JSON.stringify(B.describe(), null, 1).split("\n").filter(l => /lastMove|result|"to"/.test(l)).join("\n"));
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
if (scenario === "agent") {
  // Writes: seeds its own board, then an agent drives it through the real control socket (the same JSON
  // `ep0ch-door act` sends): open, edit, save, quote and comment, reply, move. Scratch outlines only.
  if (process.env.EP0CH_SNAP_WRITES !== "1") { console.error("agent writes to the outline: point EP0CH_SOCKET at a scratch service and set EP0CH_SNAP_WRITES=1"); process.exit(2); }
  const { startControl } = await import("../src/control");
  const { connect } = await import("node:net");
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const hub = await mk(null, "Allotment board");
  await mk(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
  await mk(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
  await mk(hub.id, "Done [type::virtual-branch] [query::stage=done]");
  const beans = await mk(null, "Stake the beans [stage::queued] [priority::high]\nCanes along the fence.\n\nTie them loosely; the wind is strong there.");
  await mk(null, "Plant the squash [stage::queued]\nBy the compost heap.");
  await mk(null, "Fix the gate latch [stage::doing]\nIt swings open.");
  board.subscribe(e => app.event(e));
  const B = new DeliveryBoard(hub.id), S = B as any;
  app.push(new MainMenu()); app.push(B);
  const ctl = await startControl({ app, mirror: emu, info: () => fakeTerm.info }, "out/agent-door.sock");
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => new Promise<any>((res, rej) => {
    const c = connect(ctl.path, () => c.write(JSON.stringify({ cmd: "act", action, args, reader, as: "claude-demo" }) + "\n"));
    let buf = "";
    c.on("data", d => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { c.end(); const r = JSON.parse(buf.slice(0, i)); console.log(`  act ${action}${reader ? ` (${reader})` : ""} -> ${JSON.stringify(r.ok ? r.result : r.error).slice(0, 160)}`); res(r); } });
    c.on("error", rej);
  });
  await snap("1-board", 2500);
  await act("open", { id: beans.id }, "preview");
  await snap("2-opened", 1200);
  await act("edit.text", { text: "Stake the beans [stage::queued] [priority::high]\nCanes along the fence, two per plant.\n\nTie them loosely; the wind is strong there." });
  await snap("3-agent-typed", 500);
  await act("edit.save");
  await snap("4-agent-saved", 800);
  await act("passage.select", { quote: "the wind is strong there" });
  await snap("5-agent-quoting", 500);
  await act("comment.write", { body: "Soft twine, or it cuts the stems." });
  await act("comment.send");
  await snap("6-agent-commented", 1200);
  await act("comment.close");
  await act("card.move", { lane: "Doing", card: beans.id });
  await snap("7-agent-moved", 1500);
  const log = await new SocketBoard(board.path).request("activity.recent", { author: "agent", limit: 10 });
  for (const e of log.entries.filter((x: any) => x.block.id === beans.id)) console.log(`  service: ${e.kind} by ${e.author}/${e.actorId}`);
  ctl.close(); board.close(); process.exit(0);
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
if (scenario === "river-write") {
  // The river's columns host the note surface: edit, quote and comment from a column by keys, then an
  // agent does the same through the control socket, and another client edits under an open draft.
  // Its own scratch service and fictional notes only.
  const { startControl } = await import("../src/control");
  const { connect } = await import("node:net");
  const mk = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const plot = await mk(null, "Allotment plot 14 [type::hub]\nThe plot by the water tap.");
  const beans = await mk(plot.id, "Stake the beans [stage::queued]\nCanes along the fence.\n\nTie them loosely; the wind is strong there.");
  await mk(plot.id, "Plant the squash [stage::queued]\nBy the compost heap.");
  await mk(plot.id, "Fix the gate latch [stage::doing]\nIt swings open.");
  await mk(beans.id, "Canes bought\nTwenty, from the market.");
  board.subscribe(e => app.event(e));
  const R = new River(), S = R as any;
  app.push(new MainMenu()); app.push(R);
  const ctl = await startControl({ app, mirror: emu, info: () => fakeTerm.info }, "out/river-door.sock");
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => new Promise<any>((res, rej) => {
    const c = connect(ctl.path, () => c.write(JSON.stringify({ cmd: "act", action, args, reader, as: "claude-demo" }) + "\n"));
    let buf = "";
    c.on("data", d => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { c.end(); const r = JSON.parse(buf.slice(0, i)); console.log(`  act ${action}${reader ? ` (${reader})` : ""} -> ${JSON.stringify(r.ok ? r.result : r.error).slice(0, 160)}`); res(r); } });
    c.on("error", rej);
  });
  const ctrl = (c: string) => press({ kind: "char", ch: c, ctrl: true });
  await snap("1-library", 2500);
  await act("open", { id: plot.id });
  const opened = await act("open", { id: beans.id }, "2");
  const beansR = opened.result.reader;
  await snap("2-columns", 1500);
  // The agent's opens left the person in the Library; they walk over to the beans column.
  ch("l"); ch("l");
  ch("e"); await Bun.sleep(500);
  press({ kind: "down" }); press({ kind: "end" }); for (const c of " Two per plant.") ch(c);
  await snap("3-editing", 400);
  ctrl("s");
  await snap("4-saved", 1500);
  ch("c"); await Bun.sleep(600);
  ch("j"); ch("j"); ch("l"); for (let i = 0; i < 4; i++) ch("H");
  await snap("5-quoting", 400);
  press({ kind: "enter" }); for (const c of "Soft twine, or it cuts the stems.") ch(c);
  await snap("6-writing", 400);
  ctrl("s");
  await snap("7-sent", 1500);
  press({ kind: "esc" });
  // An agent drives the same column by its reader id.
  await act("comment", { quote: "Canes along the fence", body: "Hazel, not bamboo." }, beansR);
  await snap("8-agent-commented", 1200);
  await act("comment.close", {}, beansR);
  // Another client edits the note while the column holds a draft: marked, not replaced.
  await act("edit.text", { text: (await board.get(beans.id))!.text + "\nMine, unsaved." }, beansR);
  const other = new SocketBoard(board.path);
  const now = (await other.request("blocks.context", { blockId: beans.id })).selected;
  await other.request("update", { blockId: beans.id, text: now.text.replace("Canes", "Hazel canes"), expectedRevision: now.revision, mutation: { author: "agent", actorId: "snap-other-writer" } });
  await snap("9-changed-elsewhere", 1500);
  // Focus away: the agent's draft doesn't take the person's h, and the column holding it resists compression.
  ch("h"); ch("h");
  await snap("10-draft-kept-wide", 600);
  console.log(`  unsaved: ${R.unsaved()} · columns: ${JSON.stringify(S.describe().columns.map((c: any) => [c.n, c.cover]))}`);
  const kept = R.keepDrafts();
  console.log(`  kept: ${kept.join(", ")}`);
  const list = await other.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId: beans.id }, includeResolved: true } });
  for (const t of list) console.log(`  ${t.lifecycle} "${t.originalTarget.anchor.exact}": ${t.body} (${t.block.author}/${t.block.actorId})`);
  other.close(); ctl.close(); board.close(); await scratch!.dispose(); process.exit(0);
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
