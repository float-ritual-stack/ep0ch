// The generated files an extension's author and a client's tests read: both are made again here and compared, so the
// source is the only place either is written (`bun scripts/extension-types.ts` writes them).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTHOR_MODULES, extensionTypes, primitivesFixture } from "../scripts/extension-types";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "../fixtures", name), "utf8");

test("fixtures/extension-types.d.ts is what the source says now", () => {
  const made = extensionTypes();
  expect(made).toBe(fixture("extension-types.d.ts"));
  // Each author's module is there whole, with the shape it is read for.
  for (const name of AUTHOR_MODULES) expect(made).toContain(`declare module "@ep0ch/outline-core/${name}" {`);
  for (const shape of ["export interface ActionRow", "export interface ListRow", "export interface ListPrimitive", "export type Primitive ="]) expect(made).toContain(shape);
  // What they name of other modules is written too: nothing an author reads is left to guess.
  for (const named of ["export type RuleTone", "export interface SearchQuery"]) expect(made).toContain(named);
});

test("fixtures/primitives.json lists every primitive type with its fields", () => {
  expect(primitivesFixture()).toBe(fixture("primitives.json"));
  const { types, fields, page } = JSON.parse(fixture("primitives.json")) as { types: string[]; fields: Record<string, string[]>; page: Record<string, string[]> };
  expect(Object.keys(fields).sort()).toEqual([...types].sort());
  expect(Object.keys(page)).toEqual(["markdown", "picture", "source", "diff", "part"]);
});
