// PIE-1722 review (CodeRabbit on #1422): note.rename pressed by the person while they edit the note retitles their edit. It
// keeps their cursor and selection where they were, and a press that read another note or revision changes nothing.
import { expect, test } from "bun:test";
import { Draft } from "../src/edit";
import { renameInEdit } from "../src/desk/rename-in-edit";
import { USER } from "../src/socket";

/** A draft the person is typing in, "labels" selected on its last line. */
const typing = () => {
  const d = new Draft("note-1", 4, "Seed swap [type::plan]\n\nBring jars.\nAnd labels.");
  d.place(3, 4);
  d.place(3, 10, true);
  return d;
};

test("the title changes in the edit; the person's cursor and selection stay on what they had", () => {
  const d = typing();
  expect(d.selectedText()).toBe("labels");
  expect(renameInEdit(d, "Seed swap, Saturday", USER, { note: "note-1", revision: 4 })).toBe("Seed swap, Saturday");
  expect(d.text).toBe("Seed swap, Saturday [type::plan]\n\nBring jars.\nAnd labels.");
  expect(d.selectedText()).toBe("labels");
  expect([d.row, d.col]).toEqual([3, 10]);
});

test("a press that read another note, or the note at another revision, changes nothing", () => {
  for (const expect_ of [{ note: "note-2" }, { revision: 3 }]) {
    const d = typing(), before = d.text;
    expect(() => renameInEdit(d, "Elsewhere", USER, expect_)).toThrow(/another note|changed since/);
    expect(d.text).toBe(before);
  }
});
