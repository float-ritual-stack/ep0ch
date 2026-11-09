// The marks' atoms evaluated (PIE-1237): what `marked:`, `marked-by:` and `marked-since:` hold, read from the service's
// pocket marks (the `pocketMarks` relation), on the wall clock as every date in a query reads.
import { expect, test } from "bun:test";
import { compileQueryExpression, parseQueryExpression, type PocketMark, type QueryRelations } from "../src/query-expression";

const NOW = new Date(2026, 10, 9, 15, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
const marks = new Map<string, PocketMark[]>([
  ["bean-row", [{ at: at(9, 9), author: "user", actor: "user" }]],
  ["shed-roof", [{ at: at(8, 20), author: "agent", actor: "loki/claude-code@float-box" }]],
  ["compost", [{ at: at(1, 12), author: "user", actor: "user" }]],
]);
const relations = { resolve: () => "", linkSources: () => new Set<string>(), within: () => false, pocketMarks: () => marks } satisfies QueryRelations;
const holding = (query: string) => ["bean-row", "shed-roof", "compost", "gate"].filter(id =>
  compileQueryExpression(parseQueryExpression(query), NOW, relations)({ id, createdAt: "2026-01-01", updatedAt: "2026-01-01" }, []));

test("marked: reads a day or any; marked-since: from a day on; marked-by: the person or an actor", () => {
  expect(holding("marked:today")).toEqual(["bean-row"]);
  expect(holding("marked:yesterday")).toEqual(["shed-roof"]);
  expect(holding("marked:any")).toEqual(["bean-row", "shed-roof", "compost"]);
  expect(holding("marked:2026-11-01")).toEqual(["compost"]);
  expect(holding("marked-since:-7d")).toEqual(["bean-row", "shed-roof"]);
  expect(holding("marked-by:me")).toEqual(["bean-row", "compost"]);
  expect(holding("marked-by:loki")).toEqual(["shed-roof"]);
  expect(holding("marked-by:agent")).toEqual(["shed-roof"]);
  expect(holding("marked:any NOT marked-by:me")).toEqual(["shed-roof"]);
});

test("without the service's marks, no block is marked", () => {
  const bare = { resolve: () => "", linkSources: () => new Set<string>(), within: () => false } satisfies QueryRelations;
  expect(compileQueryExpression(parseQueryExpression("marked:any"), NOW, bare)({ id: "bean-row", createdAt: "x", updatedAt: "x" }, [])).toBe(false);
});
