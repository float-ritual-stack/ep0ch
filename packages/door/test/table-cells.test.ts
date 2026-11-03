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
  // `row: record` (PIE-1539): the row opens its own record, and the note's cell opens the note at `at:`'s revision.
  const own = tableOf({ columns: ["note", "rubric"], link: "note", row: "record", at: "revision" }, [{ ...(item as object), properties: [...(item as { properties: unknown[] }).properties, { key: "revision", values: ["3"] }] } as never], { [NOTE]: "Status tonight" });
  expect(own.blocks).toEqual([RECORD]);
  expect(own.aboutBlocks).toEqual([NOTE]);
  expect(own.rowRevisions).toEqual([3]);
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

// PIE-1524: at 60 columns a cell whose word is longer than its column was cut inside the code span's colour code: its
// first row came out empty and its second began `;204;146;214m`. The cut sees through colour, which takes no room.
test("a wrapped cell's long styled word is cut between glyphs, never inside a colour code", () => {
  const props = `headers: [Cut, Where, Instead]\nrows: [["thread tile kind", "\`door/src/desk/builtin-tiles.ts:195\`", "an alias"]]`;
  const lines = renderGraph("table", props, 60, undefined, undefined, { present: t => t }).map(strip);
  const at = lines.findIndex(l => l.includes("thread tile kind"));
  const where = lines.slice(at, at + 2).map(l => l.split("┊")[2]!.trim());
  expect(where.join("").replace("…", "")).toMatch(/^door\/src\/desk\/builtin-tiles\.ts:/);
  for (const l of lines) expect(l).not.toMatch(/\d+m|\x1b/);
  // Every row of the table keeps its columns lined up.
  const seps = [lines[at - 2]!, lines[at]!, lines[at + 1]!].map(l => [...l].map((c, i) => (c === "┊" ? i : -1)).filter(i => i >= 0).join());
  expect(new Set(seps).size).toBe(1);
});

// PIE-1541: Jev's findings page in a 66-column tile drew each row's problem in about 10 characters ("fix: / line 4 …"):
// the widest columns gave way first, and the problem was the widest. The title column gives way last and wraps whole.
test("a record table at 66 columns keeps the title column whole, wrapped; the other columns give way first", async () => {
  const { primitiveLines } = await import("../src/components");
  const problem = "fix: line 4 types a count a query keeps true (\"2 queued\" is stage=queued)";
  const passage = "- Board: 2 queued and 1 in review, with more coming tomorrow.";
  const lines = primitiveLines({ type: "table", title: 0, columns: ["title", "note", "passage", "after", "outcome", "writer"],
    rows: [[problem, "Shed status tonight", passage, "- **Roof on** at nine; the felt was cut to size.", "followed", "moss"]] }, 65).map(strip);
  expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(65);
  const title = lines.slice(2).map(l => l.split("  ")[0]!.trim()).join(" ");
  expect(title.replace(/\s+/g, " ")).toBe(problem);
  // A table with no title column keeps the widest-first rule: both columns share the room.
  const plain = primitiveLines({ type: "table", columns: ["a", "b"], rows: [["x".repeat(40), "y".repeat(40)]] }, 41).map(strip);
  expect(plain[1]).toBe(`${"─".repeat(19)}  ${"─".repeat(20)}`);
});
