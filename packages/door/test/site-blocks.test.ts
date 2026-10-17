// PIE-533 S3 in the reader, against a scratch service: one figure copied onto two pages lists each page's own,
// `::fields` lists a key's occurrences and gains a row when a line is saved, `::if` draws its body only while `this`
// matches. Drawn by `ep0ch show`'s drawNote, the reader's own renderer, from the service's `site.answer`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const FIGURE = ["::graph-table", "---", "query: type=ticket project={{this.project}}", "columns: [title]", "---", "::"].join("\n");

describe.skipIf(!outliner)("::fields, ::if and a figure over this, drawn from site.answer", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const user = { kind: "user" } as const;
  const make = async (text: string) => (await board.createBlock(null, text, user)).id;
  const show = async (id: string) => (await drawNote(board, id, 80))!.map(strip).join("\n");
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("the same figure on two project pages lists each page's own tickets", async () => {
    for (const [t, p] of [["Sort the bricks", "lego-night"], ["Build the tower", "lego-night"], ["Water the beans", "garden"]]) await make(`${t} [type::ticket] [project::${p}]`);
    const lego = await make(`Lego night [project::lego-night]\n\n${FIGURE}`);
    const garden = await make(`Garden [project::garden]\n\n${FIGURE}`);
    const a = await show(lego), b = await show(garden);
    expect(a).toContain("Sort the bricks");
    expect(a).toContain("Build the tower");
    expect(a).not.toContain("Water the beans");
    expect(b).toContain("Water the beans");
    expect(b).not.toContain("Sort the bricks");
  }, 20_000);

  test("::fields lists one row per occurrence, with its line, and a saved line adds a row", async () => {
    const id = await make(["Vent rail demo", "", "- first pass [connectTo::demonstrating by doing]", "- second pass [connectTo::shacks not cathedrals]", "", "::fields{key=connectTo}"].join("\n"));
    const before = await show(id);
    expect(before).toContain("demonstrating by doing");
    expect(before).toContain("shacks not cathedrals");
    expect(before).toContain("line 3");
    expect(before).toContain("live · 2 occurrences");
    const note = (await board.get(id))!;
    await board.update(id, `${note.text}\n- third pass [connectTo::trust the drift]`, note.revision!);
    // The key written on the note's lines but not before the ::fields block (it has its own line now): the new row.
    const after = await show(id);
    expect(after).toContain("trust the drift");
    expect(after).toContain("live · 3 occurrences");
  }, 20_000);

  test("::fields of a key nobody wrote says so; an unknown option is said, not guessed", async () => {
    const id = await make("Empty\n\n::fields{key=connectTo}\n\n::fields{key=x colour=red}");
    const text = await show(id);
    expect(text).toContain("no connectTo written in this note's lines yet");
    expect(text).toContain("colour isn't one of ::fields' keys");
  }, 20_000);

  test("::if draws its body while this matches, and nothing when it doesn't; both follow a saved change", async () => {
    const id = await make(["Rail [status::active]", "", "before", "", "::if{where=\"status=active\"}", "shown when active", "::", "", "::if{where=\"status=paused\"}", "shown when paused", "::", "", "after"].join("\n"));
    const first = await show(id);
    expect(first).toContain("before");
    expect(first).toContain("shown when active");
    expect(first).not.toContain("shown when paused");
    expect(first).not.toContain("::if");
    expect(first).toContain("after");
    const note = (await board.get(id))!;
    await board.update(id, note.text.replace("[status::active]", "[status::paused]"), note.revision!);
    const second = await show(id);
    expect(second).not.toContain("shown when active");
    expect(second).toContain("shown when paused");
  }, 20_000);

  test("an ::if whose query can't be read says so where its body would be", async () => {
    const id = await make(["Rail", "", "::if{where=\"deleted=true\"}", "hidden", "::"].join("\n"));
    const text = await show(id);
    expect(text).not.toContain("hidden");
    expect(text).toMatch(/deleted/);
  }, 20_000);
});
