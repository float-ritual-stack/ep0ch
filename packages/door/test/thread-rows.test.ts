// PIE-944: the thread panel's rows: what folds, what a fold hides, where the note's replies go. Made-up posts.
import { expect, test } from "bun:test";
import { threadRows, type ChildLink, type ThreadData } from "../src/links";
import type { Msg } from "../src/board";

const post = (id: string, at: number): ChildLink => ({ block: { id, text: id, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "ana", properties: [] } as Msg });
const names = (t: ThreadData, open = new Set<string>()) => threadRows(t, open).map(r => r.kind === "fold" ? `┄${r.count} ${r.what}` : `${"  ".repeat(r.depth)}${r.kind === "child" && r.thread?.here ? "►" : ""}${r.kind === "child" ? r.child.block.id : r.kind}`);
const thread = (depth: number, siblings: number, replies: number): ThreadData => {
  const chain = Array.from({ length: depth }, (_, i) => post(`c${i}`, 1000 + i));
  const levels = chain.map((c, i) => i === 0 ? [c] : [...Array.from({ length: siblings }, (_, j) => post(`s${i}.${j}`, j % 2 ? 100 + j : 2000 + j)), c].sort((a, b) => a.block.createdAt - b.block.createdAt));
  return { chain, levels, replies: Array.from({ length: replies }, (_, i) => post(`r${i}`, 200 + i)), truncated: false };
};

test("a short thread shows every post, the note marked, its replies right under it", () => {
  expect(names(thread(2, 1, 2))).toEqual(["c0", "  ►c1", "    r0", "    r1", "  s1.0"]);
});

test("a long chain folds its middle into one row, and opening it shows the parents", () => {
  const t = thread(8, 0, 0);
  expect(names(t)).toEqual(["c0", "┄3 parents", "        c4", "          c5", "            c6", "              ►c7"]);
  expect(names(t, new Set(["chain > c0"])).map(n => n.trim())).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "►c7"]);
});

test("a long run of replies folds after eight with a count; opening it shows them all", () => {
  const t = thread(1, 0, 12);
  expect(names(t).filter(n => n.startsWith("┄"))).toEqual(["┄4 replies"]);
  expect(names(t, new Set(["replies > c0"])).filter(n => /r\d/.test(n))).toHaveLength(12);
});

test("a busy level folds around the note's own post, earlier and later each with a count", () => {
  const t = thread(2, 12, 0);
  const rows = names(t).filter(n => n.startsWith("  ") || n.startsWith("┄"));
  expect(rows.some(n => /┄\d+ earlier/.test(n))).toBe(true);
  expect(rows.some(n => /┄\d+ later/.test(n))).toBe(true);
  expect(rows.filter(n => n.includes("►"))).toHaveLength(1);
});
