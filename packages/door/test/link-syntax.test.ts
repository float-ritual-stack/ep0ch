// Links and anchors as the service reads them: the door finds them with outline-core's scans (link-syntax.ts), so a
// label, a page link and an anchor read here as the outliner reads them (its test/references.test.ts runs the same
// notes), and an answer from the real service is found for the link it belongs to.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Msg } from "../src/board";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { readableSource } from "../src/surface/note";
import { ANCHOR_LINES, ANCHOR_NOTE, BLANK_LABEL_NOTE, PAINT_ID, PAREN_LABEL, PAREN_LABEL_NOTE } from "../../outline-core/test/fixtures/link-notes";
import { outliner, Scratch } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const note = (text: string): Msg => ({ id: "eeeeeeee-5555-4555-8555-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} });

test("the reader hides each fragment anchor the service finds, and keeps it as the line's anchor (shared fixture)", () => {
  const { text, anchors } = readableSource(note(ANCHOR_NOTE), null);
  expect(anchors.filter(Boolean)).toEqual(ANCHOR_LINES.flatMap(([, id]) => (id ? [id] : [])));
  expect(text.split("\n")).toEqual(["## Beds", "Sow the leeks", "Stake the peas", "Water the beans", "", "Ratio 2^8", "Ends ^bad!"]);
});

describe.skipIf(!outliner)("links drawn as the service reads them (shared fixture, scratch host)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); });
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  const draw = async (text: string) => (await drawNote(board, (await board.createBlock(null, text)).id, 100))!.map(plain).join("\n");

  test("((id|Rough edges (x))): the whole label is the link, and the service's answer for it is found", async () => {
    const paint = await board.createBlock(null, "Paint the shed");
    await board.trash(paint.id);
    expect(await draw(PAREN_LABEL_NOTE.replace(PAINT_ID, paint.id))).toContain(`Sand the ${PAREN_LABEL} · Trash before the first coat.`);
  });

  test("[[Garden| ]] is no link: it stays as typed, and the labelled one beside it is drawn as its label", async () => {
    const drawn = await draw(BLANK_LABEL_NOTE);
    expect(drawn).toContain("The [[Garden| ]] stays text, and the garden");
  });
});
