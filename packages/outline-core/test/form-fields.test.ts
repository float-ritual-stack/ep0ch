// A note's form fields (PIE-828): what a `[form-field::…]` chip means, and what a save says about one it can't read.
import { expect, test } from "bun:test";
import { formFields, parseFormField } from "../src/form-fields";
import { syntaxWarnings } from "../src/syntax-warnings";

test("a field chip reads as a declared argument does; one it can't read says what it may have meant", () => {
  expect(parseFormField("mood choice good|meh|rough default=meh")).toEqual({ name: "mood", type: "choice", options: ["good", "meh", "rough"], default: "meh" });
  expect(parseFormField("title text required")).toEqual({ name: "title", type: "text", required: true });
  expect(parseFormField("mood choise good|meh")).toMatchObject({ message: expect.stringContaining("did you mean choice?") });
  expect(parseFormField("pages number requird")).toMatchObject({ message: expect.stringContaining("did you mean required?") });
  expect(parseFormField("block text")).toMatchObject({ message: expect.stringContaining("the action's request already uses") });
  expect(parseFormField("mood choice")).toMatchObject({ message: expect.stringContaining("a choice needs its options") });
  expect(formFields(["a text", "a number"]).problems[0]!.message).toContain("already has a field a");
});

test("a save warns on the chip it can't read, on its line, and none in code", () => {
  const warned = syntaxWarnings("Reading log\n[form-field::book txt]\n`[form-field::x nope]`\n[form-field::pages number]");
  expect(warned.map(w => [w.kind, w.line])).toEqual([["form-field", 1]]);
  expect(warned[0]!.message).toContain("did you mean text?");
});
