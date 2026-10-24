// The Deploys note install writes (PIE-941): its table figure draws the deploys at any width, and a table with
// nothing to draw says so rather than failing the figure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderGraph } from "../src/graphs";
import { drawNote } from "../src/notes-cli";
const DEPLOYS_NOTE = "Deploys [type::virtual-branch] [query::type=deploy machine=record]\n\n::graph-table\n---\nquery: type=deploy machine=record\ncolumns: [title, created]\n---\n::";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("a table figure with no columns or rows", () => {
  test.each([20, 60, 140])("draws a hint at %d columns, never a failure", w => {
    const out = renderGraph("table", { yaml: "", markdown: ["query: type=deploy", "columns: [title, created]"] }, w).map(strip).join("\n");
    expect(out).not.toContain("couldn't draw");
    expect(out).toContain("no columns");
  });
});

describe.skipIf(!outliner)("the Deploys note", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("shows the deploys at 60, 100 and 140 columns", async () => {
    const root = await board.createBlock(null, DEPLOYS_NOTE, { kind: "user" });
    await board.createBlock(root.id, "Deploy 2026-10-16T07:00:00.000Z on the-box [type::deploy] [machine::record]\n\nWhen: x", { kind: "user" });
    // The figure alone, in a plain note: the deploys under the virtual branch would show whatever the figure does.
    const copy = await board.createBlock(null, "Copy\n\n" + DEPLOYS_NOTE.slice(DEPLOYS_NOTE.indexOf("::graph-table")), { kind: "user" });
    for (const w of [60, 100, 140]) {
      const text = (await drawNote(board, copy.id, w))!.map(strip).join("\n");
      expect(text).not.toContain("couldn't draw");
      expect(text).toContain("Deploy 2026-10-16");
    }
  }, 30_000);
});
