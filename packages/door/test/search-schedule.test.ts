// PIE-1382: one search scheduler. The power bar, the completer and the desk's query tiles ask the host as the person
// types or the outline changes; each went through its own timer and generation counter, and each decided differently
// (the completer asked on every key, the bar never stopped a search it had sent). Fake boards, no host.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PowerBar } from "../src/bar/bar";
import type { BarHost } from "../src/bar/source";
import { QueryPane } from "../src/desk/query";
import { BacklinksPane } from "../src/desk/backlinks-pane";
import { FacetsPane } from "../src/desk/facets";
import { Lanes } from "../src/desk/lanes";
import { ReaderPane } from "../src/desk/panes";
import { TreePane } from "../src/desk/tree";
import { HeldAsks } from "../src/held-asks";
import type { DeskApi } from "../src/desk/panes";
import { Draft } from "../src/edit";
import { completerFor, completionKey } from "../src/surface/completer";
import type { Key } from "../src/term";
import { FakeSearchClock, RELOAD_PAUSE_MS, SearchSchedule, TYPING_PAUSE_MS, useSearchClock } from "../src/search-schedule";
import { hostTraffic, SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const never = <T>() => new Promise<T>(() => {});

let clock: FakeSearchClock, put: () => void;
beforeEach(() => { clock = new FakeSearchClock(); put = useSearchClock(clock); });
afterEach(() => put());

describe("the schedule", () => {
  test("a pause runs once typing stops, and only the newest", () => {
    const s = new SearchSchedule(TYPING_PAUSE_MS), ran: string[] = [];
    s.pause(() => ran.push("g"));
    clock.advance(TYPING_PAUSE_MS - 1);
    s.pause(() => ran.push("ga"));
    clock.advance(TYPING_PAUSE_MS - 1);
    expect(ran).toEqual([]);
    clock.advance(1);
    expect(ran).toEqual(["ga"]);
  });

  test("cancel drops a waiting pause", () => {
    const s = new SearchSchedule(TYPING_PAUSE_MS), ran: string[] = [];
    s.pause(() => ran.push("dropped"));
    s.cancel();
    expect(clock.runOut()).toBe(false);
    expect(ran).toEqual([]);
  });

  test("a new turn aborts the one before and drops its later work; settled waits on the new one", async () => {
    const s = new SearchSchedule(TYPING_PAUSE_MS), ran: string[] = [];
    const first = s.begin();
    first.asking("notes");
    first.after(300, () => ran.push("jev"));
    const waiting = s.settled();
    const second = s.begin();
    second.asking("ext");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    clock.runOut();
    expect(ran).toEqual([]);
    let done = false;
    void waiting.then(() => { done = true; });
    await Bun.sleep(0);
    expect(done).toBe(false);
    second.answered("ext");
    expect(await waiting).toEqual([]);
  });

  test("settled resolves when the last pending ask answers", async () => {
    const s = new SearchSchedule(TYPING_PAUSE_MS), t = s.begin();
    t.asking("a"); t.asking("b");
    const waiting = s.settled();
    t.answered("a");
    t.answered("b");
    expect(await waiting).toEqual([]);
  });
});

describe("each path asks the host the same way", () => {
  test("the completer waits for typing to pause: four keys typed at once ask the service once", async () => {
    const asked: { query: string; signal?: AbortSignal }[] = [];
    const board = {
      completePages: async () => ({ addresses: [], completeness: { kind: "complete" } }),
      searchBlocks: async () => ({ matches: [], completeness: { kind: "complete" } }),
      completeFiles: async () => [],
      completionRows: async (r: { target: { query: string } }, signal?: AbortSignal) => { asked.push({ query: r.target.query, signal }); return { answers: [], picks: {} }; },
    };
    const d = new Draft("note-1", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((garden") completionKey(d, char(ch), c);
    expect(asked).toEqual([]);
    clock.runOut();
    await until(() => !!c.state && !c.state.loading, "the lookup");
    expect(asked.map(a => a.query)).toEqual(["garden"]);
  });

  test("ctrl+space asks the service at once, with no pause", async () => {
    const asked: string[] = [];
    const board = {
      completePages: async () => ({ addresses: [], completeness: { kind: "complete" } }),
      searchBlocks: async () => ({ matches: [], completeness: { kind: "complete" } }),
      completeFiles: async () => [],
      completionRows: async (r: { target: { query: string } }) => { asked.push(r.target.query); return { answers: [], picks: {} }; },
    };
    const d = new Draft("note-1", 1, "((garden");
    d.place(0, 8);
    const c = completerFor(d, board, () => {})!;
    completionKey(d, { kind: "char", ch: " ", ctrl: true } as Key, c);
    await until(() => asked.length === 1, "the lookup");
    expect(clock.pending).toBe(0);
    expect(asked).toEqual(["garden"]);
  });

  test("the power bar stops the search it sent when the person types on", async () => {
    const searches: { q: string; signal?: AbortSignal }[] = [];
    const board = { search: (q: string, _n: number, o: { signal?: AbortSignal } = {}) => { searches.push({ q, signal: o.signal }); return never(); } };
    const host = { ctx: { board, redraw() {} }, runs: [], dispatch: {}, screens: () => [], kept: () => [], near: () => null, note: async () => null } as unknown as BarHost;
    const bar = new PowerBar(host, () => {}, { scope: "notes", query: "garden" });
    clock.runOut();
    await until(() => searches.length === 1, "the first search");
    bar.input.splice(0, bar.query.length, "gardens");
    bar.refresh();
    clock.runOut();
    await until(() => searches.length === 2, "the second search");
    expect(searches[0]!.signal?.aborted).toBe(true);
    expect(searches[1]!.signal?.aborted).toBe(false);
    bar.close();
    expect(searches[1]!.signal?.aborted).toBe(true);
  });

  test("a query tile's read the next one replaces is stopped, and only the newer answer is drawn", async () => {
    const reads: { signal?: AbortSignal; answer: (notes: { id: string; text: string }[]) => void }[] = [];
    const board = { queryNotes: (_q: string, _n: number, _m?: unknown, signal?: AbortSignal) => new Promise(r => reads.push({ signal, answer: notes => r({ notes, truncated: false }) })) };
    const desk = { ctx: { board, flash() {} }, redraw() {} } as unknown as DeskApi;
    const pane = new QueryPane("v", "#garden");
    const first = pane.load(desk);
    const second = pane.load(desk);
    expect(reads[0]!.signal?.aborted).toBe(true);
    reads[1]!.answer([{ id: "b2", text: "Runner beans" }]);
    reads[0]!.answer([{ id: "b1", text: "Old answer" }]);
    await Promise.all([first, second]);
    expect(pane.items?.map(m => m.id)).toEqual(["b2"]);
  });

  test("a query tile put away while it reads finishes its load, drawing nothing", async () => {
    let answer: (v: { notes: never[]; truncated: boolean }) => void = () => {};
    const board = { queryNotes: () => new Promise(r => { answer = r; }) };
    const desk = { ctx: { board, flash() {} }, redraw() {} } as unknown as DeskApi;
    const pane = new QueryPane("v", "#garden");
    const loading = pane.load(desk);
    pane.dispose();
    answer({ notes: [], truncated: false });
    await loading;
    expect(pane.items).toBeNull();
  });

  test("a burst of outline changes reads a query tile once, a pause after the last", () => {
    let reads = 0;
    const board = { queryNotes: () => { reads++; return never(); } };
    const desk = { ctx: { board, flash() {} }, redraw() {} } as unknown as DeskApi;
    const pane = new QueryPane("v", "#garden");
    for (let i = 0; i < 5; i++) { pane.onEvent(desk); clock.advance(RELOAD_PAUSE_MS - 1); }
    expect(reads).toBe(0);
    clock.advance(1);
    expect(reads).toBe(1);
    pane.onEvent(desk);
    pane.dispose();
    clock.runOut();
    expect(reads).toBe(1);
  });
});

describe("a query tile reads what changed without piling reads on the host (PIE-1413)", () => {
  test("changes while its read is out read once more when it lands, never a second read beside it", async () => {
    const reads: ((v: { notes: never[]; truncated: boolean }) => void)[] = [];
    const board = { queryNotes: () => new Promise<{ notes: never[]; truncated: boolean }>(r => { reads.push(r); }) };
    const desk = { ctx: { board, flash() {} }, redraw() {} } as unknown as DeskApi;
    const pane = new QueryPane("v", "#garden");
    const first = pane.refresh(desk);
    for (let i = 0; i < 4; i++) void pane.refresh(desk);
    expect(reads.length).toBe(1);
    reads[0]!({ notes: [], truncated: false });
    await until(() => reads.length === 2, "the one read after");
    reads[1]!({ notes: [], truncated: false });
    await first;
    expect(reads.length).toBe(2);
  });

  test("a tile put away while a change waits to be read asks nothing more", async () => {
    const reads: ((v: { notes: never[]; truncated: boolean }) => void)[] = [];
    const board = { queryNotes: () => new Promise<{ notes: never[]; truncated: boolean }>(r => { reads.push(r); }) };
    const desk = { ctx: { board, flash() {} }, redraw() {} } as unknown as DeskApi;
    const pane = new QueryPane("v", "#garden");
    const first = pane.refresh(desk);
    void pane.refresh(desk);
    pane.dispose();
    reads[0]!({ notes: [], truncated: false });
    await first;
    await Bun.sleep(20);
    expect(reads.length).toBe(1);
  });

  test("off the screen (the desk's frame doesn't hold it), it reads behind, at most every 10 s, and at once when drawn", async () => {
    let reads = 0, shown = false, redraws = 0;
    const board = { queryNotes: () => { reads++; return Promise.resolve({ notes: [], truncated: false }); } };
    const desk = { ctx: { board, flash() {} }, redraw() { redraws++; }, shows: () => shown } as unknown as DeskApi;
    const pane = new QueryPane("v", "#garden");
    await pane.load(desk);
    // Behind the tiles on screen: read once, in the door's one read for what's off the screen; and a frame asked for.
    await pane.refresh(desk);
    await until(() => reads === 2, "the read behind");
    expect(redraws).toBeGreaterThan(0);
    // Changed again within its 10 s: nothing asked, until it is drawn.
    await pane.refresh(desk);
    await Bun.sleep(150);
    expect(reads).toBe(2);
    shown = true;
    pane.render(40, 10, false);
    pane.render(40, 10, false);
    await until(() => reads === 3, "the read when it was drawn");
    await Bun.sleep(50);
    expect(reads).toBe(3);
  });
});

describe("every reload in the door goes through a SearchSchedule (PIE-1395)", () => {
  // Each path that reads again after an outline change: a burst of changes reads once, a pause after the last, on the
  // door's one clock (so parity's fake clock reaches it), and a path put away while a pause waits reads nothing.
  const desk = { ctx: { board: {}, flash() {} }, redraw() {} } as unknown as DeskApi;
  const content = { domain: "content", action: "update", change: { kind: "edit", blockId: "b1" } } as never;
  function burst(poke: () => void, pause: number, reads: () => number, put: () => void) {
    for (let i = 0; i < 5; i++) { poke(); clock.advance(pause - 1); }
    expect(reads()).toBe(0);
    clock.advance(1);
    expect(reads()).toBe(1);
    poke();
    put();
    clock.runOut();
    expect(reads()).toBe(1);
  }

  test("the facets tile", () => {
    const pane = new FacetsPane();
    let reads = 0;
    pane.refresh = async () => { reads++; return true; };
    burst(() => pane.onEvent(desk), 400, () => reads, () => pane.dispose());
  });

  test("the links tile", () => {
    const pane = new BacklinksPane("links");
    let reads = 0;
    (pane as any).target = { id: "b1", text: "Runner beans" };
    pane.load = async () => { reads++; };
    burst(() => pane.onEvent(desk, content), 500, () => reads, () => pane.dispose());
  });

  test("the tree", () => {
    const pane = new TreePane();
    let reads = 0;
    (pane as any).reread = async () => { reads++; };
    burst(() => pane.onEvent(desk), 300, () => reads, () => pane.dispose());
  });

  test("a reader pinned to a page", () => {
    const pane = new ReaderPane(true);
    let reads = 0;
    pane.pinTo("Today");
    (pane as any).surface.onEvent = () => {};
    pane.host = () => ({}) as never;
    pane.resolvePin = async () => { reads++; };
    burst(() => pane.onEvent(desk), 400, () => reads, () => pane.dispose());
  });

  test("the board's lanes", async () => {
    const lane = new QueryPane("v1", "#garden");
    const host = { ctx: { board: { get: async () => null }, workspace: "w", flash() {} }, supplied: () => [lane], focusedPane: () => null, redraw() {}, save() {} };
    const lanes = new Lanes(host as never, "c", null);
    await Bun.sleep(0);
    let reads = 0;
    lanes.loadLanes = async () => { reads++; };
    burst(() => (lanes as any).markLanes([lane]), 150, () => reads, () => lanes.dispose());
  });

  test("a lane plan a newer burst replaced is planned again with it, whether it answered or failed", async () => {
    const lane = new QueryPane("v1", "#garden");
    lane.read = { status: "ready", items: [], limit: 200, truncated: false, errors: [] } as never;
    lane.items = [];
    const plans: { id: string; settle: (ok: boolean) => void }[] = [];
    const board = { get: async () => null, planMoves: (_v: string[], id: string) => new Promise((res, rej) => plans.push({ id, settle: ok => ok ? res({ revision: 1, plans: new Map() }) : rej(new Error("socket dropped")) })) };
    const host = { ctx: { board, workspace: "w", flash() {} }, supplied: () => [lane], focusedPane: () => null, redraw() {}, save() {} };
    const lanes = new Lanes(host as never, "c", null);
    await Bun.sleep(0);
    lanes.loadLanes = async () => {};
    for (const ok of [true, false]) {
      plans.length = 0;
      (lanes as any).planning.add("b1"); (lanes as any).armReload(); clock.advance(150);
      (lanes as any).planning.add("b2"); (lanes as any).armReload(); clock.advance(150);
      expect(plans.map(p => p.id)).toEqual(["b1", "b2"]);
      plans[0]!.settle(ok);
      await Bun.sleep(0);
      clock.advance(150);
      expect({ ok, asked: plans.map(p => p.id) }).toEqual({ ok, asked: ["b1", "b2", "b1"] });
    }
    lanes.dispose();
  });

  test("a list the service answers (the held asks)", async () => {
    let reads = 0;
    const list = new HeldAsks();
    await list.seed({ heldAsks: async () => { reads++; return []; } } as never);
    expect(reads).toBe(1);
    burst(() => list.heard(content), 400, () => reads - 1, () => list.stop());
  });

  test("a held-asks read the next one replaces keeps nothing, and stop drops one still out", async () => {
    const answers: ((rows: { blockId: string }[]) => void)[] = [];
    const list = new HeldAsks();
    const board = { heldAsks: () => new Promise<never[]>(r => answers.push(r as never)) };
    const seeded = list.seed(board as never);
    answers[0]!([{ blockId: "a1" }]);
    await seeded;
    list.heard(content); clock.advance(400);
    list.heard(content); clock.advance(400);
    answers[2]!([{ blockId: "a3" }]);
    answers[1]!([{ blockId: "a2-old" }]);
    await Bun.sleep(0);
    expect(list.list().map(r => r.blockId)).toEqual(["a3"]);
    list.heard(content); clock.advance(400);
    list.stop();
    answers[3]!([{ blockId: "after-stop" }]);
    await Bun.sleep(0);
    expect(list.list().map(r => r.blockId)).toEqual(["a3"]);
  });
});

describe.skipIf(!outliner)("a turn's signal on the socket, on a scratch service", () => {
  const scratch = new Scratch();
  afterAll(async () => { await scratch.dispose(); });

  test("an aborted search stops waiting at once, and the board answers the next one", async () => {
    const board = new SocketBoard(await scratch.start());
    try {
      await board.request("create", { parentId: null, text: "Quince beds", author: "agent" });
      const ctl = new AbortController(), waiting = hostTraffic.waiting;
      const first = board.search("quince", 10, { signal: ctl.signal });
      ctl.abort();
      expect(await first.then(() => "answered", e => (e as Error).name)).toBe("AbortError");
      expect(hostTraffic.waiting).toBe(waiting);
      expect((await board.search("quince", 10)).map(m => m.text)).toEqual(["Quince beds"]);
      await expect(board.search("quince", 10, { signal: ctl.signal })).rejects.toThrow();
    } finally { board.close(); }
  });
});
