// PIE-1382: one search scheduler. The power bar, the completer and the desk's query tiles ask the host as the person
// types or the outline changes; each went through its own timer and generation counter, and each decided differently
// (the completer asked on every key, the bar never stopped a search it had sent). Fake boards, no host.
import { describe, expect, test } from "bun:test";
import { PowerBar } from "../src/bar/bar";
import type { BarHost } from "../src/bar/source";
import { QueryPane } from "../src/desk/query";
import type { DeskApi } from "../src/desk/panes";
import { Draft } from "../src/edit";
import { completerFor, completionKey } from "../src/surface/completer";
import type { Key } from "../src/term";
import { until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const never = <T>() => new Promise<T>(() => {});

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
    await until(() => !!c.state && !c.state.loading, "the lookup");
    expect(asked.map(a => a.query)).toEqual(["garden"]);
  });

  test("the power bar stops the search it sent when the person types on", async () => {
    const searches: { q: string; signal?: AbortSignal }[] = [];
    const board = { search: (q: string, _n: number, o: { signal?: AbortSignal } = {}) => { searches.push({ q, signal: o.signal }); return never(); } };
    const host = { ctx: { board, redraw() {} }, runs: [], dispatch: {}, screens: () => [], kept: () => [], near: () => null, note: async () => null } as unknown as BarHost;
    const bar = new PowerBar(host, () => {}, { scope: "notes", query: "garden" });
    await until(() => searches.length === 1, "the first search");
    bar.input.splice(0, bar.query.length, "gardens");
    bar.refresh();
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
});
