// PIE-1388: a live table's cell that names a note (a record's `note::<uuid>`) draws that note's title, and is its link.
import { expect, test } from "bun:test";
import { tableOf } from "@ep0ch/outline-core/figure-live";
import { renderGraph } from "../src/graphs";

const NOTE = "8a1c2b3d-1111-4222-8333-444455556666";
const RECORD = "1b2c3d4e-5555-4666-8777-888899990000";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("a cell naming a note is drawn as its title and links it; the row's other cells link the row's note", () => {
  const item = { id: RECORD, title: "review-finding 1", properties: [{ key: "note", values: [NOTE] }, { key: "rubric", values: ["dense"] }], createdAt: 0, updatedAt: 0, author: "agent" } as never;
  const t = tableOf({ columns: ["note", "rubric"] }, [item], { [NOTE]: "Status tonight" });
  expect(t.rows).toEqual([["Status tonight", "dense"]]);
  expect(t.cellBlocks).toEqual([[NOTE, null]]);
  // `link: note`: the row opens the note it's about, not the record.
  expect(tableOf({ columns: ["note", "rubric"], link: "note" }, [item], { [NOTE]: "Status tonight" }).blocks).toEqual([NOTE]);
  // Without its title (the page may not show that note), the id stays as written.
  expect(tableOf({ columns: ["note"] }, [item], {}).rows).toEqual([[NOTE]]);

  const link = (block: string, text: string) => `<${block.slice(0, 4)}>${text}</>`;
  const lines = renderGraph("table", `headers: [note, rubric]\nrows: [[Status tonight, dense]]\nblocks: [${RECORD}]\ncellBlocks: [[${NOTE}, null]]`, 80, link).map(strip);
  const row = lines.find(l => l.includes("Status tonight"))!;
  expect(row).toContain("<8a1c>Status tonight");
  expect(row).toContain("<1b2c>dense");
});

// PIE-1402: at 44 columns (Evan's desk tile) a table of records hid the passage, what was said and what the writer did
// behind "+4 columns". Narrow, a row is a card: its title first, every other cell under it, labelled and wrapped.
test("a narrow table draws each row as a card with every cell, labelled, linked as its row is", () => {
  const link = (block: string, text: string) => `<${block.slice(0, 4)}>${text}</>`;
  const said = "line 3 stacks 3 points in one item: a bullet is one point; make each its own item";
  const props = `headers: [note, rubric, said, passage, writer, patch]\nrows: [["Status tonight", dense, "${said}", "The swap table went up at nine and the jars were sorted", loki, ready], ["Seed swap", context, "line 4 leans on today's context", "As discussed", kitty, none]]\nblocks: [${RECORD}, ${RECORD}]\ncellBlocks: [[${NOTE}, null, null, null, null, null], [${NOTE}, null, null, null, null, null]]`;
  const lines = renderGraph("table", props, 44, link).map(strip);
  const text = lines.join("\n");
  expect(text).not.toContain("columns · widen to see");
  expect(text).toContain("<8a1c>Status tonight");
  for (const cell of ["rubric: dense", "said: line 3 stacks 3 points", "passage: The swap table", "writer: loki", "patch: ready", "said: line 4 leans on today's"]) expect(text).toContain(cell);
  // Each line is its row's: the said cell links the record, its note the note.
  expect(lines.find(l => l.includes("rubric: dense"))).toContain("<1b2c>");
  // Nothing past the frame.
  expect(Math.max(...lines.map(l => l.replace(/<[^>]*>/g, "").length))).toBeLessThanOrEqual(44);
  // Wide, it is a table still.
  expect(renderGraph("table", props, 120, link).map(strip).join("\n")).toContain(" ┊ ");
});
