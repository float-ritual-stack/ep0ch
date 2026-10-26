// PIE-1357: a part dropped into the person's own draft: a block of its own, one undo step, and the cursor and a
// selection's other end (a backward one too) moved down with the lines above them. Made-up text.
import { expect, test } from "bun:test";
import { Draft } from "../src/edit";
import { USER } from "../src/socket";

test("insertBlock: blank lines around the part, one undo, a backward selection kept on its words", () => {
  const d = new Draft("n1", 1, "Pad\nA\nB\nC");
  // Select backward from C to A: the cursor on A, the other end on C.
  d.place(3, 1); d.place(1, 0, true);
  const selected = d.selectedText();
  d.insertBlock(2, "((n2^part))");
  expect(d.text).toBe("Pad\nA\nB\n\n((n2^part))\n\nC");
  expect(d.selectedText()).toBe(selected!.replace("B\nC", "B\n\n((n2^part))\n\nC"));
  d.undo(USER);
  expect(d.text).toBe("Pad\nA\nB\nC");
});
