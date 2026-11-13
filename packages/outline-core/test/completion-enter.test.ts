// Whether Return is the field's or the completion list's (hydra sweep 3): one rule, `enterKeeps`, asked by the door's
// completer, the Detail's and the service's text-and-cursor form (which says the answer on each row for a window that
// reads no Blockdown).
import { expect, test } from "bun:test";
import { enterKeeps } from "../src/completion-source";

const at = (line: string, start: number, end: number, more: { chosen?: boolean; applies?: boolean } = {}) => ({ chosen: false, line, start, end, ...more });

test("Return takes the lit row, unless the row says it is the field's or would write nothing", () => {
  expect(enterKeeps({ insertion: "[[seed-list]]" }, at("See [[see", 4, 9))).toBeNull();
  // A row that says so (a figure's YAML, a property before anything is typed).
  expect(enterKeeps({ insertion: "title: ", enter: "new line" }, at("ti", 0, 2))).toBe("new line");
  // A row that would leave the line as it is typed.
  expect(enterKeeps({ insertion: "[[seed-list]]" }, at("See [[seed-list]]", 4, 17))).toBe("new line");
  // A page nobody wrote, and words offered for a question, are chosen on purpose.
  expect(enterKeeps({ insertion: "[[seed-list]]", newPage: true }, at("See [[see", 4, 9))).toBe("new line");
  expect(enterKeeps({ insertion: "stage=sown", querySuggestion: {} }, at("sown beds", 0, 9))).toBe("new line");
  // A one-line field applies what is typed.
  expect(enterKeeps({ insertion: "done", enter: "applies" }, at("stage:do", 6, 8, { applies: true }))).toBe("applies");
  expect(enterKeeps({ insertion: "[[seed-list]]" }, at("[[seed-list]]", 0, 13, { applies: true }))).toBe("applies");
});

test("a deliberate choice makes Return take the row, whatever the row says; no row is nothing to take", () => {
  expect(enterKeeps({ insertion: "title: ", enter: "new line" }, at("ti", 0, 2, { chosen: true }))).toBeNull();
  expect(enterKeeps({ insertion: "[[seed-list]]" }, at("See [[seed-list]]", 4, 17, { chosen: true }))).toBeNull();
  expect(enterKeeps(undefined, at("See", 0, 3))).toBeNull();
});
