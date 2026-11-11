// CodeRabbit on #1428: the answer tile shows its ask's answer, and nothing else: a note with its ask gone, or a heading
// under the ask, has no answer to show.
import { expect, test } from "bun:test";
import { AnswerTile } from "../src/desk/answer-tile";

const ask = "@yo find the shed jobs";

test("the answer tile finds the answer under its ask, never another fold", () => {
  const tile = new AnswerTile("reader", ask);
  expect(tile.answer(["Shed", ask, "> [!note]+ @yo answered", "> 1 note"].join("\n"))?.line).toBe(2);
  // The ask taken out: nothing, never the note's first fold.
  expect(tile.answer(["# Shed", "Some words", "> [!note]+ @yo answered", "> 1 note"].join("\n"))).toBeUndefined();
  // A heading or a callout of the person's under the ask: not its answer.
  expect(tile.answer(["Shed", ask, "## Jobs", "- paint"].join("\n"))).toBeUndefined();
  expect(tile.answer(["Shed", ask, "> [!tip] mine", "> words"].join("\n"))).toBeUndefined();
});
