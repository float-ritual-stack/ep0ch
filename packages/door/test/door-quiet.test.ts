// PIE-1546: a door asked the service for every list it keeps after every change in the outline. On pie one write made
// one door send 9 to 13 whole-outline reads at once (the status bar's note, the screen notes, the waiting asks, the held
// asks, the callout types, heading styles and style sheets, a drawn tile), a tool's bookkeeping included; they queued
// behind each other, and the person's own requests waited behind them for a second or more.
//
// Now those lists are watched (the service says when an answer changed, once for every door) and a change to a note a
// tool stamped `[machine::…]` is marked `hidden`, so nothing that leaves machinery out asks again. Fictional outline.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { calloutsOf } from "../src/callouts";
import { SocketBoard, type OutlineEvent } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const scratch = new Scratch();
let board: SocketBoard;
let writer: SocketBoard;
let app: App;
let state = "";
const events: OutlineEvent[] = [];
const saved: Record<string, string | undefined> = {};
/** What the door's own lists ask (never a reader's note or a tile's drawing): none of these after a change no list can see. */
const LISTS = ["blocks.query", "waiting.list", "agents.held", "callouts.types", "headings.styles", "styles.list"];
let records = "";

beforeAll(async () => {
  if (!outliner) return;
  const sock = await scratch.start();
  board = new SocketBoard(sock);
  writer = new SocketBoard(sock);
  await board.info();
  board.subscribe(e => { events.push(e); app?.event(e); });
  records = (await writer.request<any>("create", { parentId: null, text: "Greenhouse log [machine::record]", author: "agent" })).id;
  await writer.request<any>("create", { parentId: null, text: "Your status bar [status-bar::true]\n\n- clock", author: "user" });
  await writer.request<any>("create", { parentId: null, text: "Pick the seed tray [type::task] [needs::sysop: which tray?]", author: "user" });
  await writer.request<any>("create", { parentId: null, text: "Frost [callout-type::frost] [callout.icon::*]", author: "user" });
}, 30_000);
afterAll(async () => { board?.close(); writer?.close(); await scratch.dispose(); });
beforeEach(() => {
  for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
  state = mkdtempSync(join(tmpdir(), "ep0ch-quiet-"));
  process.env.EP0CH_STATE = state;
  process.env.EP0CH_DAILY_AGENT = "cat";
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

/** A door as door.ts starts one: its events, its lists seeded, its screens and status bar read. */
async function door() {
  const term: any = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
  app = new App(term, board, Date.now(), () => {});
  await Promise.all([app.heldAsks.seed(board), app.waitingAsks.seed(board), app.loadScreens(), app.statusNote.refresh([{ id: "clock", text: "12:00", place: "right" }])]);
  // The reader's lists (callout types), asked as a drawing asks them.
  calloutsOf({ board, redraw() {} });
  await board.watched.settled();
}

/** What the door's lists asked while `write` ran and the outline settled (past the service's watch pass and every debounce). */
async function askedAfter(write: () => Promise<unknown>): Promise<string[]> {
  await Bun.sleep(600);
  const from = board.sent.length;
  await write();
  await Bun.sleep(1500);
  await board.watched.settled();
  return board.sent.slice(from).filter(a => LISTS.includes(a));
}

test.skipIf(!outliner)("a tool's bookkeeping makes the door ask for none of its lists, and says so on the event", async () => {
  await door();
  try {
    const rev = (await writer.records([records])).records[0]!.revision!;
    const asked = await askedAfter(() => writer.update(records, "Greenhouse log [machine::record]\n- 06:00 18°C", rev, { kind: "agent", id: "thermo" }));
    expect(asked).toEqual([]);
    expect(events.filter(e => e.blockId === records && e.change?.kind === "edit").every(e => e.hidden === true)).toBe(true);
  } finally { app.quit(); }
}, 30_000);

test.skipIf(!outliner)("a person's write elsewhere asks none of them again, and one that changes a list is told", async () => {
  await door();
  try {
    expect(app.waitingAsks.count()).toBe(1);
    // A note no list holds: every answer is as it was, so nothing is asked again.
    // (The held asks are the service's memory, answered off nothing: read again after a person's write, as before.)
    expect((await askedAfter(() => writer.request("create", { parentId: null, text: "Water the beans", author: "user" }))).filter(a => a !== "agents.held")).toEqual([]);
    // An ask for Evan: the service says the waiting list changed, and the door's copy follows.
    await writer.request("create", { parentId: null, text: "Compost or burn? [type::task] [needs::sysop: compost?]", author: "user" });
    await until(() => app.waitingAsks.count() === 2, "the new ask in the door's waiting list");
    // The status bar's note edited: the bar reads it from the service's watched answer.
    const note = app.statusNote.note!;
    await writer.update(note.id, `${note.text}\n- video`, note.revision!, { kind: "user" });
    await until(() => app.statusNote.note?.revision !== note.revision, "the status bar's note as edited");
    expect(events.some(e => e.change?.kind === "edit" && !e.hidden)).toBe(true);
  } finally { app.quit(); }
}, 30_000);

// Review of round two (Codex): the views that stayed stale.
test.skipIf(!outliner)("the waiting asks come back by themselves after the service let go of their watch (past 64 on the connection)", async () => {
  await door();
  try {
    const before = app.waitingAsks.count();
    // A busy screen's figures: more watched questions than the service keeps for one connection.
    for (let i = 0; i < 70; i++) board.watched.read("blocks.query", { query: { where: `bed=${i}`, limit: 5 } }, r => r);
    await board.watched.settled();
    await writer.request("create", { parentId: null, text: `Mulch which bed? [type::task] [needs::sysop: mulch ${Date.now()}?]`, author: "user" });
    await until(() => app.waitingAsks.count() === before + 1, "the new ask in the door's waiting list", 10_000);
  } finally { app.quit(); }
}, 30_000);

test.skipIf(!outliner)("a tool's bookkeeping still tells what looks things up (a view that shows machinery, embedded) that something changed", async () => {
  await door();
  try {
    const { anyChangeSince, changeClock } = await import("../src/refs");
    const at = changeClock();
    app.event({ domain: "content", action: "create", sequence: 1, blockId: "rec-1", hidden: true, change: { kind: "create", blockId: "rec-1", parentId: records } } as any);
    expect(anyChangeSince(at)).toBe(true);
  } finally { app.quit(); }
}, 30_000);

test.skipIf(!outliner)("a second status-bar note breaks the bar; trashing it brings the bar's own entries back", async () => {
  await door();
  try {
    const items = () => app.statusNote.items([{ id: "clock", text: "12:00", place: "right" }]).map(i => i.id);
    await until(() => items().includes("clock") && app.statusNote.note !== null, "the bar read");
    const twin = (await writer.request<any>("create", { parentId: null, text: "Another bar [status-bar::true]\n\n- clock", author: "user" })).id;
    await until(() => app.statusNote.problems.length === 0 && (app.statusNote as any).read === null, "the bar refused two notes", 10_000);
    await writer.request("delete", { blockId: twin, mutation: { author: "user" } });
    await until(() => (app.statusNote as any).read !== null, "the bar's own note read again", 10_000);
  } finally { app.quit(); }
}, 30_000);
