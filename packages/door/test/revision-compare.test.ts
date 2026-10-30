// The revision compare's controls row stays on one row whatever the title's length (PIE-1433): a second click lands.
import { expect, test } from "bun:test";
import { drawRevision, type RevisionView } from "../src/surface/revision-compare";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");
const view = (by: string): RevisionView => ({
  against: "next", top: 0,
  diff: { from: { revision: 3 }, to: { revision: 4, savedAt: "2026-10-12T14:05:00Z", author: "agent", actorId: by }, current: 5, rows: ["- old line", "+ new line"], list: { revision: 5, revisions: [] } } as never,
});

test("at 44 columns the controls row is the same row with a short title and a wrapping one", () => {
  const at = (v: RevisionView) => drawRevision(v, 44, 20).lines.map(plain).findIndex(l => l.includes("[« older]"));
  const short = view("ann"), long = view("a-very-long-agent-name-that-wraps@somewhere-far");
  expect(drawRevision(long, 44, 20).lines.map(plain).filter(l => l.includes("REVISION") || l.includes("somewhere")).length).toBeGreaterThan(0);
  expect(at(short)).toBe(at(long));
});
