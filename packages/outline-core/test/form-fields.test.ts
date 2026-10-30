// A note's form fields (PIE-828): what a `[form-field::…]` chip means, and what a save says about one it can't read.
import { expect, test } from "bun:test";
import { formFields, formSettings, parseFormField } from "../src/form-fields";
import { syntaxWarnings } from "../src/syntax-warnings";

test("a field chip reads as a declared argument does; one it can't read says what it may have meant", () => {
  expect(parseFormField("mood choice good|meh|rough default=meh")).toEqual({ name: "mood", type: "choice", options: ["good", "meh", "rough"], default: "meh" });
  expect(parseFormField("title text required")).toEqual({ name: "title", type: "text", required: true });
  expect(parseFormField("mood choise good|meh")).toMatchObject({ message: expect.stringContaining("did you mean choice?") });
  expect(parseFormField("pages number requird")).toMatchObject({ message: expect.stringContaining("did you mean required?") });
  expect(parseFormField("block text")).toMatchObject({ message: expect.stringContaining("the action's request already uses") });
  expect(parseFormField("mood choice")).toMatchObject({ message: expect.stringContaining("a choice needs its options") });
  expect(formFields(["a text", "a number"]).problems[0]!.message).toContain("already has a field a");
  expect(parseFormField("constructor text")).toMatchObject({ message: expect.stringContaining("every object already has") });
});

test("a save warns on the chip it can't read, on its line, and none in code", () => {
  const warned = syntaxWarnings("Reading log\n[form-field::book txt]\n`[form-field::x nope]`\n[form-field::pages number]");
  expect(warned.map(w => [w.kind, w.line])).toEqual([["form-field", 1]]);
  expect(warned[0]!.message).toContain("did you mean text?");
  // A name twice is said on the second chip's line, as the action would refuse it.
  expect(syntaxWarnings("Log\n[form-field::book text]\n[form-field::book number]").map(w => [w.line, w.message.includes("already has a field book")])).toEqual([[2, true]]);
});

test("a field is held to a declared argument's bounds, and a save says so", () => {
  const many = Array.from({ length: 33 }, (_, i) => `o${i}`).join("|");
  expect(parseFormField(`size choice ${many}`)).toMatchObject({ message: expect.stringContaining("at most 32") });
  expect(parseFormField(`size choice small|${"x".repeat(61)}`)).toMatchObject({ message: expect.stringContaining("longer than 60") });
  expect(parseFormField(`note text default=${"y".repeat(201)}`)).toMatchObject({ message: expect.stringContaining("longer than 200") });
  expect(syntaxWarnings(`Sizes\n[form-field::size choice ${many}]`).map(w => [w.kind, w.line])).toEqual([["form-field", 1]]);
});

// PIE-1442: the form note says its button's words and where each entry lands, as chips beside its fields.
test("a form's button, target and line read from its chips; one it can't read says what it may have meant", () => {
  const fields = formFields(["book text required", "pages number"]).fields;
  const read = (values: [string, string][]) => formSettings(values.map(([key, value]) => ({ key, value })), fields);
  expect(read([]).settings).toEqual({ into: { kind: "child" } });
  expect(read([["form-submit", " Log it "], ["form-into", "[[Reading log]]"]]).settings).toEqual({ submit: "Log it", into: { kind: "page", address: "Reading log" } });
  expect(read([["form-into", "((0e1f2a3b-0000-4000-8000-000000000001))"]]).settings.into).toEqual({ kind: "block", id: "0e1f2a3b-0000-4000-8000-000000000001" });
  expect(read([["form-into", "inline"], ["form-line", "{book} · {pages} pages"]]).settings).toEqual({ into: { kind: "inline" }, line: "{book} · {pages} pages" });
  expect(read([["form-into", "inlne"]]).problems[0]!.message).toContain("did you mean inline?");
  expect(read([["form-into", "Reading log"]]).problems[0]!.message).toContain("did you mean [[Reading log]]?");
  expect(read([["form-into", "inline"], ["form-line", "{bok} on {pages}"]]).problems[0]!.message).toContain("did you mean {book}?");
  expect(read([["form-line", "{book}"]]).problems[0]!.message).toContain("[form-into::inline]");
  expect(read([["form-submit", "Log"], ["form-submit", "Save"]]).problems[0]!.message).toContain("already says");
  expect(read([["form-submit", "  "]]).problems[0]!.message).toContain("names no words");
  // A problem leaves today's form: a child, the default button.
  expect(read([["form-into", "inlne"]]).settings).toEqual({ into: { kind: "child" } });
});

test("a save warns on the target it can't read, on its line, and says nothing of a form without one", () => {
  const warned = syntaxWarnings("Reading log [form-into::inlne]\n[form-field::book text]");
  expect(warned.map(w => [w.kind, w.line])).toEqual([["form-field", 0]]);
  expect(warned[0]!.message).toContain("did you mean inline?");
  expect(syntaxWarnings("Reading log [form-into::inline] [form-line::{book}]\n[form-field::book text]")).toEqual([]);
  // A note with no form says nothing of a stray [form-line::] it holds as prose about forms: it has no fields.
  expect(syntaxWarnings("About forms: [form-line::{x}] is how a line is written")).toEqual([]);
});
