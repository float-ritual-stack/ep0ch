// CodeRabbit on #1428: the answer tile shows its ask's answer, and nothing else: a note with its ask gone, or a heading
// under the ask, has no answer to show.
import { expect, test } from "bun:test";
import { AnswerTile, ANSWER_TILE } from "../src/desk/answer-tile";
import { ReaderPane, type DeskApi } from "../src/desk/panes";

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

// CodeRabbit on #1435: a reader still reading its note (a door just restored) has no text yet: its answer tile isn't
// said gone, and a save then keeps it.
test("an answer tile beside a reader still reading its note is kept, and not said gone", () => {
  const reader = new ReaderPane(), tile = new AnswerTile("reader", ask);
  const desk = { paneNamed: (n: string) => (n === "reader" ? reader : undefined), redraw() {} } as unknown as DeskApi;
  expect(ANSWER_TILE.kept!(tile, desk)).toBe(true);
  expect(tile.render(40, 6, false, desk).lines.join(" ")).not.toContain("gone");
});

// PIE-1741: `f` folds the answer where it is (the edit open on its note, else the reader's callout): its description
// names both in the words the tile's hint row uses (the hint itself is drawn in showcase/ask-yo.test.ts).
test("answer.fold's description says what f folds: the answer in the edit, else in the note", async () => {
  const { ANSWER_ACTIONS, FOLD_WHERE } = await import("../src/desk/answer-tile");
  const summary = ANSWER_ACTIONS.def("answer.fold")!.summary;
  expect(summary).toContain(FOLD_WHERE.edit);
  expect(summary).toContain(FOLD_WHERE.note);
});

// PIE-1741 (the walk on #1442): the answer tile's footer is cut to its width, and in a 38-to-44-column tile only `↑/↓
// scroll …` showed. What f folds comes first, so it reads in the narrowest tile.
test("the answer tile's hint row says what f folds first, whole in a 38-column tile", async () => {
  const { fitHint, visible } = await import("../src/style");
  const tile = new AnswerTile("reader", ask);
  for (const cols of [38, 44]) expect([cols, visible(fitHint(tile.hint(), cols - 4).text)]).toEqual([cols, expect.stringContaining("f fold/unfold in the reader")]);
});

// CodeRabbit on #1498: a pair's move can rename the reader where it lands (or its undo give the old name back), and an
// answer reading it by the old name closed. It follows the reader it moved with, under the name it has now.
test("an answer whose reader was renamed by a move finds it again and doesn't close", async () => {
  const tile = new AnswerTile("detail", ask), reader = Object.create(ReaderPane.prototype) as ReaderPane;
  tile.goesWith(reader);
  let dismissed = 0;
  const desk = { paneNamed: (n: string) => (n === "detail2" ? reader : undefined), pane: () => undefined, nameOfPane: (p: unknown) => (p === reader ? "detail2" : ""), dismiss: () => { dismissed++; } } as unknown as DeskApi;
  tile.readerLeft(desk);
  await Promise.resolve();
  expect(dismissed).toBe(0);
  expect(tile.source).toBe("detail2");
});
