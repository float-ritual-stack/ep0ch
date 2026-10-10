// The extensions README's call reference (PIE-767) is what the types say: scripts/extension-calls-doc.ts writes it
// from src/extension-call-reference.ts (each call's request is the service's request type, its answer the return type
// of the store method that answers it). A field added, removed or retyped in a documented call, or in a type it
// names, fails here until the README is written again: `bun scripts/extension-calls-doc.ts`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderCallReference, README, writtenCallReference } from "../scripts/extension-calls-doc";

test("the README's call reference is what the types say (run bun scripts/extension-calls-doc.ts when it isn't)", () => {
  const wanted = renderCallReference();
  // What a cold-start agent needs is there: each call, and the fields the Readwise pull uses.
  for (const call of ["get", "children", "blocks.query", "pages.resolve", "create", "update", "annotations.list", "annotations.batch", "annotations.reply", "notes.address", "notes.render"]) {
    expect(wanted).toContain(`#### \`${call}\``);
  }
  for (const field of ["`subtreeRootId?`", "`expectedRevision`", "`requestId`", "`deduplicated`", "`permalink?`", "`includeResolved?`"]) expect(wanted).toContain(field);
  expect(writtenCallReference(readFileSync(README, "utf8"))).toBe(wanted);
}, 60_000);
