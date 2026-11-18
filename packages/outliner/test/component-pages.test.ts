// outline-core/fixtures/component-pages.json: every built-in component's own example as the page `notes.page`
// answers of it, made again here on a scratch outline and compared (`bun scripts/component-pages.ts` writes it). A
// client's own tests draw these pages (the native window's coverage table), so a component that changes what it
// answers is seen there too.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { PAGE_PRIMITIVE_FIELDS, type PagePart, type PagePrimitive } from "@ep0ch/outline-core/note-page";
import { PRIMITIVE_TYPES } from "@ep0ch/outline-core/primitive";
import { componentPages, componentPagesFixture } from "../scripts/component-pages";

const fixture = () => readFileSync(join(import.meta.dir, "../../outline-core/fixtures/component-pages.json"), "utf8");

test("the fixture is what the service answers now, and holds every built-in component", async () => {
  expect(await componentPagesFixture()).toBe(fixture());
  const pages = await componentPages();
  expect(pages.map(p => p.id)).toEqual(BUILTIN_COMPONENT_SCHEMAS.map(s => s.id));
  // Every part says where it is written and draws as a primitive the catalogue or a page names.
  const known = new Set<string>([...PRIMITIVE_TYPES, ...Object.keys(PAGE_PRIMITIVE_FIELDS)]);
  const walk = (view: PagePrimitive, seen: string[]): string[] => {
    seen.push(view.type);
    if (view.type === "part") walk(view.view, seen);
    if ("children" in view) for (const child of view.children ?? []) walk(child as PagePrimitive, seen);
    return seen;
  };
  for (const page of pages) for (const part of page.page.parts) {
    expect(part).toMatchObject({ type: "part", block: expect.stringMatching(/^note-\d+$/) } satisfies Partial<Record<keyof PagePart, unknown>>);
    expect(page.page.text.slice(part.span.start, part.span.end).split("\n").length).toBeGreaterThan(0);
    for (const type of walk(part, [])) expect(known.has(type), `${page.id}: ${type}`).toBe(true);
  }
  // A few that say what the walk is for: a figure is primitives, a button a press with its line, a box holds its parts.
  const of = (id: string) => pages.find(p => p.id === id)!.page.parts;
  expect(of("graph-stat")[0]).toMatchObject({ kind: "figure", figure: "stat", view: { type: "row" } });
  expect(of("button")[0]).toMatchObject({ kind: "button", line: 1, view: { type: "button" } });
  expect(of("box")[0]).toMatchObject({ kind: "box", view: { type: "box", children: [{ type: "part", kind: "prose" }] } });
}, 60_000);
