// PIE-1382: one search scheduler. The power bar, the completer and the desk's query tiles ask the host as the person
// types or the outline changes; each went through its own timer and generation counter, and each decided differently
// (the completer asked on every key, the bar never stopped a search it had sent). Fake boards, no host.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PowerBar } from "../src/bar/bar";
import type { BarHost } from "../src/bar/source";
import { QueryPane } from "../src/desk/query";
import type { DeskApi } from "../src/desk/panes";
import { Draft } from "../src/edit";
import { completerFor, completionKey } from "../src/surface/completer";
import type { Key } from "../src/term";
import { FakeSearchClock, RELOAD_PAUSE_MS, SearchSchedule, TYPING_PAUSE_MS, useSearchClock } from "../src/search-schedule";
import { until } from "./scratch";

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

  test("now runs the waiting pause at once; cancel drops it", () => {
    const s = new SearchSchedule(TYPING_PAUSE_MS), ran: string[] = [];
    expect(s.now()).toBe(false);
    s.pause(() => ran.push("now"));
    expect(s.now()).toBe(true);
    s.pause(() => ran.push("dropped"));
    s.cancel();
    expect(clock.runOut()).toBe(false);
    expect(ran).toEqual(["now"]);
  });

  test("a new turn aborts the one before, drops its later work, and lets its waiters go", async () => {
    const s = new SearchSchedule(TYPING_PAUSE_MS), ran: string[] = [];
    const first = s.begin();
    first.asking("notes");
    first.after(300, () => ran.push("jev"));
    const waiting = s.settled();
    const second = s.begin();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    clock.runOut();
    expect(ran).toEqual([]);
    expect(await waiting).toEqual(["notes"]);
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
