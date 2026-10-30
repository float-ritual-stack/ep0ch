// A note's form draws the note's own button and says where an entry lands (PIE-1442); a target it can't read is said there.
import { expect, test } from "bun:test";
import { NoteForm } from "../src/surface/note-form";

const drawn = (source: string) => new NoteForm("b1", source).draw(60, false, (_, text) => text).join("\n").replace(/\x1b\[[0-9;]*m/g, "");

test("the button says the note's words and the form says where an entry lands", () => {
  const fields = "[form-field::tea text required]";
  expect(drawn(`Tea log\n${fields}`)).toContain("Fill in the form │");
  expect(drawn(`Tea log\n${fields}`)).toContain("each entry lands under this note");
  const inline = drawn(`Tea log [form-submit::Log tea] [form-into::inline]\n${fields}`);
  expect(inline).toContain("│ Log tea │");
  expect(inline).toContain("each entry is a line added to this note");
  expect(drawn(`Tea log [form-into::[[Tea shelf]]]\n${fields}`)).toContain("each entry lands under [[Tea shelf]]");
  // A typo draws today's button and says what the fill will refuse with.
  const typo = drawn(`Tea log [form-into::inlne]\n${fields}`);
  expect(typo.replace(/[│\s]+/g, " ")).toContain("did you mean inline?");
  expect(typo).not.toContain("each entry lands under this note");
});
