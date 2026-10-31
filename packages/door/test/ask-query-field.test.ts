import { expect, test } from "bun:test";
import { asQuestion } from "../src/extensions";

test("a query field the power bar asks for is typed text, as a tag is", () => {
  const where = asQuestion<{ name: string; type: string; required: boolean; description?: string }>({ name: "where", type: "query", required: true });
  expect(where).toMatchObject({ name: "where", type: "text", free: true, required: true });
  expect(where.description).toContain("query");
  expect(asQuestion({ name: "label", type: "tag" })).toMatchObject({ type: "text", free: true });
  expect(asQuestion({ name: "status", type: "choice" }).type).toBe("choice");
});
