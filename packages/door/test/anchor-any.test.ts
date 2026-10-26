// PIE-1247: any element's line takes an anchor, and a note embeds or links just that element, by id or by page. A
// long planning note's figure with no heading over it, drawn in a sticky pad, keeps answering its own note's relative
// query (PIE-745: `this` is the note the figure lives in, never the pad). Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("a sticky pad embeds one figure of a long note", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  const create = (text: string, parentId: string | null = null) => board.request<{ id: string }>("create", { parentId, text, author: "user" });

  test("![[page^anchor]] and !((id^anchor)) draw only the figure, whose parent:this reads the note it lives in", async () => {
    const plan = await create([
      "Allotment plan [page::Allotment plan]",
      "A long plan, with no heading over its figure.",
      "",
      "::graph-table ^jobs",
      "---",
      "title: Bed jobs",
      'query: "parent:this"',
      "---",
      "::",
      "",
      "> [!tip] Water early ^water",
      "> Before nine, so the leaves dry.",
      "",
      "Closing words nobody embeds.",
    ].join("\n"));
    await create("Stake the peas", plan.id);
    const pad = await create(`Sticky pad\n![[Allotment plan^jobs]]\n!((${plan.id}^water))\nSee [[Allotment plan^jobs]].`);
    // The pad has a child of its own: a `this` read in the pad would list it.
    await create("Pad scribble", pad.id);
    const drawn = (await drawNote(board, pad.id, 80))!.map(strip).join("\n");
    expect(drawn).toContain("BED JOBS");
    expect(drawn).toContain("Stake the peas");
    expect(drawn).not.toContain("Pad scribble");
    expect(drawn).toContain("Water early");
    expect(drawn).toContain("Before nine");
    // Only the anchored parts: none of the plan's other prose.
    expect(drawn).not.toContain("Closing words");
    expect(drawn).not.toContain("A long plan");
    // A page link into the page reads as the page and its anchor.
    expect(drawn).toContain("Allotment plan^jobs");
  }, 30_000);
});
