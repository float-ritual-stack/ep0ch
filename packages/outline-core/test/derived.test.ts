// What the notes under a note are (hydra sweep 3): one reading, written twice in one file's hands. `isNoteUnder` reads
// a block's type; `CHILDREN_QUERY` asks the same of the service. A list that filters blocks it holds and a list that
// asks the question leave out the same blocks.
import { expect, test } from "bun:test";
import { BESIDE_TYPES, derivedKindOf, isNoteUnder } from "../src/derived";
import { CHILDREN_QUERY } from "../src/figure-live";

test("a comment, a reply and a proposal are blocks under a note and no notes of it; anything else is one", () => {
  for (const type of ["annotation", "annotation-reply", "draft-proposal", " Annotation "]) expect(isNoteUnder(type)).toBe(false);
  for (const type of [undefined, null, "", "bed", "delivery", "screen"]) expect(isNoteUnder(type)).toBe(true);
});

test("the question that lists a note's children is made from the same types", () => {
  expect(CHILDREN_QUERY).toBe("parent:this NOT type=annotation NOT type=annotation-reply NOT type=draft-proposal");
  for (const type of BESIDE_TYPES) expect(CHILDREN_QUERY).toContain(`NOT type=${type}`);
  // Each is a block that only exists because of another (the kinds a list of changes folds into their note).
  for (const type of BESIDE_TYPES) expect(derivedKindOf(type)).toBeDefined();
});
