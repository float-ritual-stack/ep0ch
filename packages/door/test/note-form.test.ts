// A note's form draws the note's own button and says where an entry lands (PIE-1442); a target it can't read is said there.
import { expect, test } from "bun:test";
import { NoteForm } from "../src/surface/note-form";
import { USER } from "../src/socket";

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

test("a submit that lands clears what it sent; an answer typed while it was landing stays (PIE-1445)", () => {
  const f = new NoteForm("b1", "Tea log\n[form-field::tea text required] [form-field::cups number] [form-field::brew choice green|black default=green]");
  f.set("tea", "Sencha", USER); f.set("cups", "2", USER); f.set("brew", "black", USER);
  const sent = f.values(USER);
  f.set("cups", "3", USER);                                  // typed while the fill was on its way
  f.focus = 2;
  f.reset(USER, sent);
  expect(f.values(USER)).toEqual({ tea: "", cups: "3", brew: "green" });
  expect(f.focus).toBe(2);                                   // still where they were typing
  f.reset(USER, f.values(USER));
  expect(f.values(USER)).toEqual({ tea: "", cups: "", brew: "green" });
  expect(f.focus).toBe(0);                                   // all cleared: the first field, for the next entry
});
