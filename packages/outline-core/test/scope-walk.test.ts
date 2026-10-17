import { expect, test } from "bun:test";
import { resolveContextKey, type ContextBlock, type ContextKeyMatcher } from "../src/scope-walk";

// Fictional tickets: the matcher reads `ACME-n` keys in text and in a `jira` property.
const acme: ContextKeyMatcher = {
  propertyKey: "jira",
  keysIn: (text) => [...text.matchAll(/\bACME-\d+\b/g)].map((m) => ({ key: m[0], start: m.index, end: m.index + m[0].length })),
  keyFromProperty: (value) => /^ACME-\d+$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null,
};

function resolve(text: string, line: number, ancestors: ContextBlock[] = [], explicitKey?: string) {
  return resolveContextKey({ block: { id: "self", text }, line, ancestors, matcher: acme, ...(explicitKey ? { explicitKey } : {}) });
}

test("context resolution walks nearest first and stops at the first level with a key", () => {
  // 1. An explicit key wins over everything.
  expect(resolve("ACME-1\njira::", 1, [], "ACME-9")).toMatchObject({ kind: "resolved", key: "ACME-9", site: { step: "explicit" } });
  // 2. A key on the line itself.
  expect(resolve("ACME-1\nsee ACME-2 jira::", 1)).toMatchObject({ key: "ACME-2", site: { step: "line" } });
  // 3. The nearest earlier line at the same or a shallower indent; deeper lines are skipped.
  expect(resolve("Subject ACME-1\n- ACME-2 vendor call\n  - aside ACME-3\n- jira:: --comments", 3))
    .toMatchObject({ key: "ACME-2", site: { step: "preceding-line", line: 1 } });
  // 4. The block's own property beats its subject line.
  expect(resolve("Subject ACME-1 [jira::ACME-5]\nnotes\njira::", 2))
    .toMatchObject({ key: "ACME-5", site: { step: "block-property" } });
  // 5. The subject line.
  expect(resolve("Subject ACME-1\nnotes\njira::", 2)).toMatchObject({ key: "ACME-1", site: { step: "subject-line", line: 0 } });
  // 6. Ancestors, nearest first: property, then subject.
  const parent = { id: "parent", text: "Parent ACME-20\nnotes ACME-21" };
  const grandparent = { id: "grandparent", text: "Page [jira::ACME-30]" };
  expect(resolve("Child\njira::", 1, [parent, grandparent]))
    .toMatchObject({ key: "ACME-20", site: { step: "ancestor-subject", blockId: "parent" } });
  expect(resolve("Child\njira::", 1, [{ id: "plain", text: "No key" }, grandparent]))
    .toMatchObject({ key: "ACME-30", site: { step: "ancestor-property", blockId: "grandparent" } });
  expect(resolve("Child\njira::", 1, [{ id: "plain", text: "No key" }])).toEqual({ kind: "none" });
});

test("two different keys at the nearest level are ambiguous; the walk does not skip past them", () => {
  expect(resolve("Subject ACME-1\ncompare ACME-2 with ACME-3\njira::", 2)).toEqual({
    kind: "ambiguous",
    keys: ["ACME-2", "ACME-3"],
    site: { step: "preceding-line", blockId: "self", line: 1 },
  });
  // The same key twice is one ticket.
  expect(resolve("Subject\nACME-2 then ACME-2 again\njira::", 2)).toMatchObject({ kind: "resolved", key: "ACME-2" });
  expect(resolve("Page [jira::ACME-1] [jira::ACME-2]\njira::", 1)).toMatchObject({ kind: "ambiguous", keys: ["ACME-1", "ACME-2"] });
});

test("the resolver is provider-agnostic: a matcher supplies the key grammar", () => {
  const issues: ContextKeyMatcher = {
    propertyKey: "gh",
    keysIn: (text) => [...text.matchAll(/#(\d+)\b/g)].map((match) => ({ key: match[0], start: match.index, end: match.index + match[0].length })),
    keyFromProperty: (value) => /^#\d+$/.test(value) ? value : null,
  };
  expect(resolveContextKey({ block: { id: "b", text: "Fix the crash #482\ngh::" }, line: 1, ancestors: [], matcher: issues }))
    .toMatchObject({ kind: "resolved", key: "#482", site: { step: "subject-line" } });
});

test("the walk leaves a section through its heading rather than entering an earlier section", () => {
  const sections = ["Subject", "Section A", "  item ACME-2", "Section B", "  jira::"].join("\n");
  expect(resolve(sections, 4)).toEqual({ kind: "none" });
  // Siblings at the same indent, and items in the same section, still resolve.
  expect(resolve(["Subject", "Section B", "  item ACME-3", "  jira::"].join("\n"), 3))
    .toMatchObject({ key: "ACME-3", site: { step: "preceding-line", line: 2 } });
  expect(resolve(["Subject", "Section ACME-4", "  notes", "  jira::"].join("\n"), 3))
    .toMatchObject({ key: "ACME-4", site: { step: "preceding-line", line: 1 } });
});

test("ancestors are read through their preamble only", () => {
  const preamble = { id: "page", text: "Parent page\n[jira::ACME-8] [owner::me]\n\nbody mentions ACME-99" };
  expect(resolve("Child\njira::", 1, [preamble])).toMatchObject({ key: "ACME-8", site: { step: "ancestor-property" } });
  expect(resolve("Child\njira::", 1, [{ id: "body", text: "Parent\n\nbody mentions ACME-99 [jira::ACME-98]" }])).toEqual({ kind: "none" });
});
