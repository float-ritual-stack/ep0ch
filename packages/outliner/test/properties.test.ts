import { expect, test } from "bun:test";
import { patchPropertyText, validateProperty } from "../src/properties";
import type { PropertyPatchOperation } from "../src/types";

test("preserves bare property syntax when patching", () => {
  expect(patchPropertyText("Title\nowner:: evan", [
    { op: "replace", ordinal: 0, value: "daisy" },
  ])).toBe("Title\nowner:: daisy");
});


test("patches exact tokens and appends to an existing metadata line", () => {
  const text = [
    "Title [type::feedback]",
    "[status::open]",
    "Body [project::skippy] remains",
  ].join("\n");
  const patched = patchPropertyText(text, [
    { op: "replace", ordinal: 0, value: "bug" },
    { op: "remove", ordinal: 2 },
    { op: "append", key: "priority", value: "high" },
    { op: "append", key: "owner", value: "evan" },
  ]);

  expect(patched).toBe([
    "Title [type::bug]",
    "[status::open] [priority::high] [owner::evan]",
    "Body  remains",
  ].join("\n"));
});

test("inserts a new metadata line after the title", () => {
  expect(patchPropertyText("Title\nBody", [{ op: "append", key: "status", value: "open" }])).toBe(
    "Title\n[status::open]\nBody",
  );
  expect(patchPropertyText("Title", [{ op: "append", key: "status", value: "open" }])).toBe(
    "Title\n[status::open]",
  );
});

test("preserves CRLF line endings while appending metadata", () => {
  expect(patchPropertyText("Title\r\n[status::open]\r\nBody", [
    { op: "append", key: "owner", value: "evan" },
  ])).toBe("Title\r\n[status::open] [owner::evan]\r\nBody");
  expect(patchPropertyText("Title\r\nBody", [
    { op: "append", key: "status", value: "open" },
  ])).toBe("Title\r\n[status::open]\r\nBody");
});

test("patch ordinals exclude literal tokens and preserve exact adjacent source", () => {
  const text = "`[literal::one]`[status::open] [owner::evan]";
  expect(patchPropertyText(text, [
    { op: "replace", ordinal: 0, value: "done" },
    { op: "remove", ordinal: 1 },
  ])).toBe("`[literal::one]`[status::done] ");
});

test("appends to eligible metadata instead of property-shaped literals", () => {
  const text = "Title\n`[fake::literal]`\n[status::open]\nBody";
  expect(patchPropertyText(text, [{ op: "append", key: "owner", value: "evan" }])).toBe(
    "Title\n`[fake::literal]`\n[status::open] [owner::evan]\nBody",
  );
});

test("inserts metadata before a code-only first-line fence", () => {
  const text = "```ts\r\n[example::literal]\r\n```";
  expect(patchPropertyText(text, [{ op: "append", key: "status", value: "open" }])).toBe(
    "[status::open]\r\n```ts\r\n[example::literal]\r\n```",
  );
});

test("rejects invalid values and conflicting token edits", () => {
  expect(() => validateProperty("bad key", "value")).toThrow("Invalid property key");
  expect(() => validateProperty("status", "bad]value")).toThrow("balanced brackets");
  expect(() => patchPropertyText("[status::open]", [{ op: "remove", ordinal: 9 }])).toThrow(
    "Property token not found",
  );
  expect(() => patchPropertyText("[status::open]", [
    { op: "remove", ordinal: 0 },
    { op: "replace", ordinal: 0, value: "done" },
  ])).toThrow("patched more than once");
  expect(() => patchPropertyText("[status::open]", [
    { op: "bogus", ordinal: 0 } as unknown as PropertyPatchOperation,
  ])).toThrow("Unknown property patch operation");
});
