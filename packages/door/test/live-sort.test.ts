// A live figure sorted by a property: the door passes `sort:` and `direction:` to the service, which orders by the
// property (numbers as numbers, blocks without it last) or refuses a bad sort, and the figure shows the refusal.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("a live figure sorted by a property", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => {
    await scratch.start(); board = new SocketBoard(scratch.sock); await board.info();
    for (const [t, rank] of [["Mend the gate", "10"], ["Prune the apple", ""], ["Sow the leeks", "2"], ["Turn the heap", "1"]]) {
      await board.createBlock(null, `${t} [type::queue-job]${rank ? ` [due-rank::${rank}]` : ""}`, { kind: "user" });
    }
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  const figure = (sort: string[]) => board.createBlock(null, ["Queue", "", "::graph-table", "---", "title: The queue", 'query: "type=queue-job"', ...sort, "columns: [title, due-rank]", "---", "::"].join("\n"), { kind: "user" });

  test("sort: due-rank, direction: ASC: 1, 2, 10, then the job without one", async () => {
    const text = (await drawNote(board, (await figure(["sort: due-rank", "direction: ASC"])).id, 80))!.join("\n");
    const at = ["Turn the heap", "Sow the leeks", "Mend the gate", "Prune the apple"].map(t => text.indexOf(t));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  }, 20_000);

  test("a bad sort or direction is refused in the figure, naming its line, not read as updated", async () => {
    const bad = (await drawNote(board, (await figure(['sort: "[due-rank::]"'])).id, 160))!.join("\n");
    expect(bad).toContain("sort: [due-rank::] · Sort by due-rank, not [due-rank::]");
    const backwards = (await drawNote(board, (await figure(["sort: due-rank", "direction: up"])).id, 160))!.join("\n");
    expect(backwards).toContain("direction: up · Sort direction is asc or desc, not up");
  }, 20_000);
  test("stat items read block refs and pages and name the item when a page is missing", async () => {
    const view = await board.createBlock(null, "Queue [page::garden-jobs] [type::virtual-branch] [query::type=queue-job]", { kind: "user" });
    for (const source of [`((${view.id}))`, "[[garden-jobs]]", "[[garden-jobs|Jobs]]", "garden-jobs"]) {
      for (const item of [`  - { label: queued, view: ${source} }`, `  - label: queued\n    view: ${source}`]) {
        const note = await board.createBlock(null, `Counts\n\n::graph-stat\n---\nitems:\n${item}\n---\n::`, { kind: "user" });
        const text = (await drawNote(board, note.id, 160))!.join("\n").replace(/\x1b\[[\d;]*m/g, "");
        expect(text).not.toContain("?");
        expect(text).toMatch(/\b4\b/);
        expect(text).toContain("queued");
      }
    }
    const note = await board.createBlock(null, "Counts\n\n::graph-stat\n---\nitems:\n  - { label: queued, view: [[garden-job]] }\n---\n::", { kind: "user" });
    const text = (await drawNote(board, note.id, 160))!.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    expect(text).toContain("queued: view");
    expect(text).toContain("no page");
    expect(text).toContain("garden-job");
    expect(text).toContain("garden-jobs");
    expect(text).toContain("did you mean");
  }, 30_000);

});
