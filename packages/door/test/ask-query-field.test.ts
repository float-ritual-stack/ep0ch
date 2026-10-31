import { expect, test } from "bun:test";
import { asQuestion } from "../src/extensions";

test("a query field the power bar asks for is typed text, as a tag is", () => {
  const where = asQuestion<{ name: string; type: string; required: boolean; description?: string }>({ name: "where", type: "query", required: true });
  expect(where).toMatchObject({ name: "where", type: "text", free: true, required: true });
  expect(where.description).toContain("query");
  expect(asQuestion({ name: "label", type: "tag" })).toMatchObject({ type: "text", free: true });
  expect(asQuestion({ name: "status", type: "choice" }).type).toBe("choice");
});

test("a query field given the outline's catalog suggests what the grammar can say (PIE-1472)", async () => {
  const catalog = async (key: string | undefined, prefix: string) => [{ key: "type", value: "meeting", count: 2 }].filter(r => (key ? r.key === key : r.key.startsWith(prefix)));
  const q = asQuestion<{ name: string; type: string }>({ name: "where", type: "query" }, catalog) as unknown as { suggest: (t: string) => Promise<{ value: string }[]> };
  expect((await q.suggest("type=meeting AND under:t")).map(r => r.value)).toEqual(["type=meeting AND under:this"]);
  expect((await q.suggest("updated >= to")).map(r => r.value)).toEqual(["updated >= today", "updated >= tomorrow"]);
});
