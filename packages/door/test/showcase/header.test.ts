// PIE-1319: the showcase screen, a note with no header. Its dashboard says `[header::none]` on its first line, so the
// reader and the river column beside it draw its figures from their first row; `crumbs` and `title` leave out only
// those rows, and taking the property off brings the header back live. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import type { App } from "../../src/app";
import { SEED } from "../../src/showcase/seed";
import type { Showcase } from "../../src/showcase/showcase";
import type { SocketBoard } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

/** The dashboard's first figure's title, as its frame draws it. */
const FIGURE = "THE HOUSE THIS WEEK";
const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("the showcase screen: a note with no header (PIE-1319)", () => {
  const h = useShowcaseScreen();
  let board!: SocketBoard, app!: App, sc!: Showcase;
  beforeAll(() => { ({ board, app, sc } = h); });

  /** The rows inside the reader (tile 1) and inside the river column beside it (tile 2), under their top borders. */
  const tiles = () => {
    const lines = sc.render(app).lines.map(plain);
    const top = lines.findIndex(l => l.includes(" 1 Plot at a glance") && l.includes(" 2 Plot at a glance"));
    const head = lines[top]!, a = head.indexOf(" 1 Plot") - 2, b = head.indexOf(" 2 Plot") - 2, end = head.lastIndexOf("┐") + 1 || head.lastIndexOf("╗") + 1;
    const body = lines.slice(top + 1).filter(l => !/[└╚]/.test(l[a] ?? ""));
    return { reader: body.map(l => l.slice(a + 1, b - 1).trim()), column: body.map(l => l.slice(b + 1, end - 1).trim()) };
  };
  const dashboard = async () => (await board.get(h.S().notes.dashboard.id))!;
  const setText = async (first: string) => {
    const m = await dashboard();
    await board.update(m.id, [first, ...m.text.split("\n").slice(1)].join("\n"), m.revision!, { kind: "agent", id: "test-agent" });
  };

  test("[header::none]: the reader and the river column start on the figure; taking it off brings the header back", async () => {
    expect(await app.act({ action: "section", args: { name: "header" }, as: "test-agent" })).toMatchObject({ key: "header" });
    await until(() => tiles().reader.some(r => r.includes(FIGURE)), "the dashboard's figure", 8000);
    const { reader, column } = tiles();
    // The figure's frame is the first thing in the reader: no crumbs, no title, no byline, no blank row above it.
    expect(reader[0]).toContain(FIGURE);
    expect(reader.join("\n")).not.toContain(SEED.dashboard);
    expect(column.slice(0, 3).join("\n")).not.toContain(SEED.dashboard);
    // The byline's ways in are still in each tile's menu (the reader's and the column's), an agent's answer drawing nothing.
    for (const tile of ["1", "2"]) {
      const menu = (await app.act({ action: "tile.menu", tile, as: "test-agent" }) as any).rows.map((r: any) => r.label);
      expect(menu).toEqual(expect.arrayContaining(["comment on the whole note", "comments", "properties", "where this comes from (sources)"]));
    }

    // Only the crumbs left out, through the property panel's own edit (attributed): the title is the first row.
    await app.act({ action: "props.edit", args: { key: "header", value: "crumbs" }, tile: "1", as: "test-agent" });
    await until(() => tiles().reader[0]?.includes(SEED.dashboard) ?? false, "the title on the first row", 8000);
    // Only the title left out: the crumbs, then the byline.
    await app.act({ action: "props.edit", args: { key: "header", value: "title" }, tile: "1", as: "test-agent" });
    await until(() => !tiles().reader.slice(0, 3).some(r => r.includes(SEED.dashboard)) && !tiles().reader[0]!.includes(FIGURE), "the crumbs and byline back, the title gone", 8000);

    // Taken off from elsewhere (the service), the whole header comes back in both, live.
    await setText(SEED.dashboard);
    await until(() => tiles().reader.slice(0, 3).some(r => r.includes(SEED.dashboard)), "the reader's title back", 8000);
    await until(() => tiles().column.slice(0, 4).some(r => r.includes(SEED.dashboard)), "the column's header back", 8000);
    expect(tiles().reader[0]).not.toContain(FIGURE);
    // And put back: gone again.
    await setText(`${SEED.dashboard} [header::none]`);
    // The agent's edits are said on a row of their own (attribution), never a header row.
    await until(() => tiles().reader.slice(0, 3).some(r => r.includes(FIGURE)) && !tiles().reader.some(r => r.includes(SEED.dashboard)), "the figure first again", 8000);
    expect(tiles().reader.slice(0, tiles().reader.findIndex(r => r.includes(FIGURE))).filter(Boolean).every(r => r.startsWith("an agent (test-agent)"))).toBe(true);
  }, 60_000);
});
