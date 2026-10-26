// PIE-1302: what the 40-column snap found, drawn through the shared parts (`ep0ch show`'s drawNote, renderGraph's
// figures, rowLines). Nothing is cut that the next line has room for, and no source leaks. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { primitiveLines } from "../src/components";
import { foldPoints, renderDoc } from "../src/doc";
import { figureSource, renderGraph } from "../src/graphs";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import { rowLines } from "../src/text";
import { outliner, Scratch } from "./scratch";

const plain = (s: string) => visible(s).trimEnd();
const figure = (kind: string, lines: string[], w = 40) => renderGraph(kind, figureSource(lines), w).map(plain);

describe("figures at 40 columns", () => {
  test("a checklist row is never cut: its words wrap onto every row they take, in the figure and the component alike (PIE-1348)", () => {
    const step = "Order the seed trays for the north beds before the frost comes in";
    const out = figure("check", ["---", "title: Before the frost", "---", `- [ ] ${step}`]).join("\n");
    expect(out).not.toContain("…");
    expect(out.replace(/[┊\s]+/g, " ")).toContain(step);
    // A component's checklist is the same drawing: the same box, gap and hang, the same rows.
    const component = primitiveLines({ type: "checklist", items: [{ label: step, done: false }] }, 36).map(plain);
    const inFigure = out.split("\n").filter(l => /\[ \]|^┊ {7}\S/.test(l)).map(l => l.slice(2, -1).trimEnd());
    expect(component).toEqual(inFigure);
    expect(component[0]).toMatch(/^\[ \]  Order/);
  });

  test("a table cell's next row starts at the cell's edge, not under a Work ID's indent", () => {
    const out = figure("table", ["---", "headers: [Ticket, Who]", "rows:", "  - [PC-12 / acceptance of the intake flow, Ana]", "---"]);
    const at = out.findIndex(l => l.includes("PC-12 /"));
    expect(at).toBeGreaterThan(-1);
    // The row under it: the cell's words go on where "PC-12" starts (it hung six cells in, under "PC-12 ").
    const col = out[at]!.indexOf("PC-12");
    expect(out[at + 1]!.slice(col)).toMatch(/^intake flow/);
  });

  test("a Work ID hangs only a title it leads, never other text after it", () => {
    expect(rowLines("PC-12 / the intake flow", 12, Infinity)).toEqual(["PC-12 / the", "intake flow"]);
    expect(rowLines("PC-12 · the intake flow", 16, Infinity)).toEqual(["PC-12 · the", "        intake", "        flow"]);
    // A note's label in the power bar: the id, then its title (noteLabel).
    expect(rowLines("PC-12 the intake flow", 16, Infinity)).toEqual(["PC-12 the intake", "      flow"]);
  });
});

describe("a plain heading at 40 columns (PIE-1348)", () => {
  const ENV = { width: 40, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false };
  test("wraps whole under its words, past its #s, and a copy takes it joined as written", () => {
    const body = "## Order the seed trays for the raised beds before the frost\nx";
    const doc = renderDoc(body, { ...ENV, folds: { points: foldPoints(body), folded: new Set() } });
    const lines = doc.lines.map(plain), first = lines.findIndex(l => l.startsWith("▾ ## Order"));
    expect(lines.slice(first, first + 2)).toEqual(["▾ ## Order the seed trays for the raised", "     beds before the frost"]);
    expect(lines.join("\n")).not.toContain("…");
    expect(doc.trims.get(first + 1)?.cuts).toContainEqual([0, 5]);
    expect(doc.wraps?.get(first + 1)).toBe(" ");
    // Without folds (an embed, ep0ch show's first pass) the same, past the #s alone.
    const flat = renderDoc(body, ENV).lines.map(plain);
    expect(flat.slice(0, 2)).toEqual(["## Order the seed trays for the raised", "   beds before the frost"]);
  });
});

describe.skipIf(!outliner)("a note at 40 columns (ep0ch show)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, id = "";
  const draw = async (w: number) => (await drawNote(board, id, w, { quiet: 150, max: 4000 }))!.map(plain);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const text = [
      "Seed plan for the north beds [type::plan] [owner::ana] [stage::queued] [priority::medium] [track::garden] [due::2026-11-02] [area::north] [crop::beans] [kind::list] [size::small] [season::spring] [plot::4] [water::drip]",
      "",
      "## Due Monday [heading::band]",
      "",
      "- [ ] Order the seed trays",
    ].join("\n");
    id = (await board.request<{ id: string }>("create", { parentId: null, text, author: "agent" })).id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a band heading too narrow for its band draws its words, never the source's ##", async () => {
    const out = await draw(40);
    const row = out.find(l => l.includes("Due Monday"));
    expect(row).toBeDefined();
    expect(row).not.toContain("#");
    expect(row).not.toContain("heading::");
    // Wide, the band draws it, lettered.
    expect((await draw(79)).join("\n")).toContain("D U E   M O N D A Y");
  });

  test("the byline's property count goes to the next line whole, rather than cut", async () => {
    const out = await draw(40);
    expect(out.join("\n")).not.toContain("propert…");
    expect(out).toContain("i 14 properties");
    // Where it fits, it stays on the byline.
    expect((await draw(79)).some(l => /\(\d\d:\d\d\) · i 14 properties/.test(l))).toBe(true);
  });
});
