// Live tabs figures (`::graph-tabs`) and a table's density: how the results are grouped and ordered, how a title
// wraps with a hanging indent, and how `ep0ch show` prints every tab. The reader's switching (figure.tab,
// figure.density by keys, click and act) is driven in the showcase's tabs section (test/showcase.test.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderGraph, titleLines, type FigureInfo } from "../src/graphs";
import { setLiveSource } from "../src/live";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { extractLinks, LINK_END, linkTag, width } from "../src/style";
import { outliner, Scratch } from "./scratch";

const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("a title's lines (density)", () => {
  test("cozy wraps to two lines, hanging past a work id; only the last line is cut", () => {
    const t = "PIE-541 — this is a long title and stuff and its two lines and then some more words";
    const out = titleLines(t, 30, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("PIE-541 — this is a long title");
    expect(out[1]!.startsWith(" ".repeat(width("PIE-541 — ")))).toBe(true);
    expect(out[1]!.endsWith("…")).toBe(true);
    expect(out.every(l => width(l) <= 30)).toBe(true);
    // Fits in one: one line, whatever the density.
    expect(titleLines("PIE-1 — short", 30, 3)).toEqual(["PIE-1 — short"]);
    // Compact: one line, cut.
    expect(titleLines(t, 30, 1)).toEqual([t.slice(0, 29) + "…"]);
  });
  test("a title with no id prefix continues at the column's edge; wide glyphs count as two cells", () => {
    expect(titleLines("plain words that wrap onto another line", 20, 2)[1]!.startsWith("wrap")).toBe(true);
    const wide = titleLines("KEY-9 · 漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字", 16, 3);
    expect(wide.every(l => width(l) <= 16)).toBe(true);
    expect(wide.length).toBeGreaterThan(1);
  });
});

describe("::graph-tabs from the outline", () => {
  const block = (id: string, title: string, props: Record<string, string>) => ({ id, parentId: null, text: title, author: "user", createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z", properties: Object.entries(props).map(([key, value]) => ({ key, value })) });
  const results = [
    block("a", "Fix the gate", { type: "job", stage: "queued" }), block("b", "Sow beans", { type: "job", stage: "doing" }),
    block("c", "Dig the bed", { type: "job", stage: "blocked" }), block("d", "Lift onions", { type: "job", stage: "queued" }),
    block("e", "Mend the net", { type: "job" }), block("f", "Order seed", { type: "job", stage: "queued" }),
  ];
  beforeAll(() => {
    setLiveSource({
      request: async () => ({ blocks: results, completeness: { kind: "complete" } }),
      toMsgs: (bs: any[]) => bs.map(b => ({ id: b.id, text: b.text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: Object.fromEntries(b.properties.map((x: any) => [x.key, x.value])) })),
    } as any, () => {});
  });
  const yaml = 'title: Jobs\nquery: "type=job"\ngroup: stage\norder: [doing, review]\ncolumns: [title]\nlimit: 2';
  // A layout makes a fresh FiguresEnv each time (its counts start again): so does each draw here.
  const draw = async (figures?: any) => { renderGraph("tabs", yaml, 70, undefined, figures && { ...figures }); await Bun.sleep(5); return renderGraph("tabs", yaml, 70, undefined, figures && { ...figures }).map(strip); };

  test("order first (empty ones kept), the rest alphabetically, no value last; counts on every label; limit is per tab", async () => {
    const seen: FigureInfo[] = [];
    const out = await draw({ seen: (f: FigureInfo) => seen.push(f) });
    expect(out.join("\n")).toContain("doing 1 · review 0 · blocked 1 · queued 3 · — 1");
    expect(seen.at(-1)).toMatchObject({ key: "Jobs#0", kind: "tabs", tab: "doing", density: "compact" });
    // The first tab's rows only.
    expect(out.join("\n")).toContain("Sow beans");
    expect(out.join("\n")).not.toContain("Fix the gate");
  });

  test("the reader's chosen tab is drawn, underlined; past limit it says how many more", async () => {
    const out = await draw({ ui: () => ({ tab: "queued" }) });
    const bar = out.findIndex(l => l.includes("queued 3")), col = out[bar]!.indexOf("queued 3");
    expect(out[bar + 1]!.slice(col, col + 8)).toBe("▀".repeat(8));
    expect(out.join("\n")).toContain("Fix the gate");
    expect(out.join("\n")).toContain("1 more · limit: 2 a tab");
    // A tab that has gone (no results now) falls back to the first; the choice is kept for when it's back.
    expect((await draw({ ui: () => ({ tab: "gone" }) })).join("\n")).toContain("Sow beans");
    // An empty tab listed in order says so.
    expect((await draw({ ui: () => ({ tab: "review" }) })).join("\n")).toContain("nothing in review");
  });

  test("printed (show): every tab in turn under a heading, no controls", async () => {
    const text = (await draw({ all: true })).join("\n");
    for (const h of ["▸ DOING · 1", "▸ REVIEW · 0", "▸ BLOCKED · 1", "▸ QUEUED · 3", "▸ — · 1"]) expect(text).toContain(h);
    expect(text.indexOf("Sow beans")).toBeLessThan(text.indexOf("Fix the gate"));
    expect(text).not.toContain("≡");
  });

  test("tabs and the density are controls a reader tags; a static table at compact draws as it always did", async () => {
    const tags: any[] = [];
    await draw({ tag: (c: any, t: string) => { tags.push(c); return t; } });
    expect(tags.filter(c => c.tab !== undefined).map(c => c.tab).slice(-5)).toEqual(["doing", "review", "blocked", "queued", "—"]);
    expect(tags.some(c => c.density)).toBe(true);
    const table = "title: T\nheaders: [a, b]\nrows:\n  - [one, two]";
    expect(renderGraph("table", table + "\ndensity: compact", 40)).toEqual(renderGraph("table", table, 40));
  });
});

test("figures are keyed by title and how many before had it, counted across a layout (callouts' bodies too)", () => {
  const seen: FigureInfo[] = [], env = { seen: (f: FigureInfo) => seen.push(f) };
  for (const t of ["A", "B", "A"]) renderGraph("table", `title: ${t}\nheaders: [x]\nrows:\n  - [y]`, 40, undefined, env);
  expect(seen.map(f => [f.n, f.key])).toEqual([[1, "A#0"], [2, "B#0"], [3, "A#1"]]);
});

test("a link after a wide glyph is found where it's drawn (cells, not code points)", () => {
  const { ranges } = extractLinks([`${linkTag(0)}日本 2${LINK_END} · ${linkTag(1)}done 1${LINK_END}`]);
  expect(ranges.map(r => [r.from, r.to])).toEqual([[0, 6], [9, 15]]);
});

describe.skipIf(!outliner)("ep0ch show prints a tabs figure's every group", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("each stage's rows under its own heading", async () => {
    for (const [t, s] of [["Paint the fence", "doing"], ["Fix the tap", "queued"], ["Sweep the yard", "done"]]) await board.createBlock(null, `${t} [type::yard-job] [stage::${s}]`, { kind: "user" });
    const note = await board.createBlock(null, ["Yard", "", "::graph-tabs", "---", "title: Yard jobs", 'query: "type=yard-job"', "group: stage", "order: [doing, queued]", "---", "::"].join("\n"), { kind: "user" });
    const text = (await drawNote(board, note.id, 80))!.join("\n");
    expect(text).toContain("doing 1 · queued 1 · done 1");
    for (const [h, row] of [["▸ DOING · 1", "Paint the fence"], ["▸ QUEUED · 1", "Fix the tap"], ["▸ DONE · 1", "Sweep the yard"]]) {
      expect(text).toContain(h!);
      expect(text.indexOf(row!)).toBeGreaterThan(text.indexOf(h!));
    }
    expect(text).not.toContain("≡");
  }, 20_000);
});
