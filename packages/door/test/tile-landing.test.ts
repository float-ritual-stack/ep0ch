// PIE-1559: a new tile beside another lands by one rule, asked once, the same for the person and an agent; and a tile
// joins and leaves a layout in one step, so the instances, the records kept by tile id and the LayoutState agree after
// every open, close, carry and build. The landing table runs on plain LayoutStates; the join/leave walk on a Desk with
// no App and no Scratch. Fictional tiles.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rect } from "../src/canvas";
import { Desk } from "../src/desk/desk";
import { MIN_ROWS } from "../src/desk/layout";
import { apply, init, leaf, type Beside, type Ctx, type LayoutState } from "../src/desk/screen-layout";
import type { Actor } from "../src/socket";

const PERSON: Actor = { kind: "user" };
const AGENT: Actor = { kind: "agent", id: "lander-1559" };
const ctxOf = (actor: Actor, area: Rect): Ctx => ({
  actor, standing: actor.kind === "user", protectTyping: actor.kind === "agent", area, tile: () => ({ kind: "reader", notes: true }),
  person: { focus: 1, typingIn: null, busy: false }, kinds: { all: ["reader", "keys"], notes: ["reader"] },
});
/** One tile filling a screen of `cols`×`rows`: what a new tile beside it, as `b` prefers, answers. */
function lands(cols: number, rows: number, b: Omit<Beside, "kind" | "target">, actor: Actor = PERSON): string {
  const s: LayoutState = init({ tree: leaf(1), names: new Map([[1, "hearth"]]) });
  const r = apply(s, { op: "open", tile: 2, kind: "keys", name: "kiln", at: { kind: "beside", target: 1, ...b } }, ctxOf(actor, { col: 0, row: 0, cols, rows }));
  return r.ok ? String(r.answer.where) : `refused: ${r.refused}`;
}

describe("where a new tile beside another lands: one rule, one try (PIE-1559)", () => {
  // Each opener's preference, as it was before the one rule (desk.ts: tile.open, tile.preview and pane.split,
  // the keys window and the trail's `sides`, ctrl+t's wide program, the tune inspector), at the sizes that tell them apart.
  const TABLE: [string, number, number, Omit<Beside, "kind" | "target">, string][] = [
    ["tile.open where=right", 120, 40, { prefers: "there", dir: "right" }, "right"],
    ["tile.open where=right, narrow: as asked", 40, 40, { prefers: "there", dir: "right" }, "right"],
    ["tile.open naming no place", 120, 40, { prefers: "beside" }, "right"],
    ["tile.open naming no place, too narrow beside: below", 40, 40, { prefers: "beside" }, "down"],
    ["tile.open naming no place, no room either way: a float", 40, 10, { prefers: "beside" }, "float"],
    ["tile.preview on a wide tile", 160, 40, { prefers: "axis", needs: { cols: 6, rows: MIN_ROWS } }, "right"],
    ["tile.preview on a tall tile", 80, 60, { prefers: "axis", needs: { cols: 6, rows: MIN_ROWS } }, "down"],
    ["the keys window beside a wide tile", 180, 40, { prefers: "width", needs: { cols: 40, rows: MIN_ROWS } }, "right"],
    ["the keys window beside a tall tile", 120, 40, { prefers: "width", needs: { cols: 40, rows: MIN_ROWS } }, "down"],
    ["the keys window beside a tile too narrow to halve", 70, 40, { prefers: "width", needs: { cols: 40, rows: MIN_ROWS } }, "down"],
    ["the keys window beside a tile narrower than it", 30, 40, { prefers: "width", needs: { cols: 40, rows: MIN_ROWS } }, "edge-down"],
    ["ctrl+t's picker beside a tall reader", 60, 40, { prefers: "width", needs: { cols: 6, rows: MIN_ROWS } }, "down"],
    ["ctrl+t's picker beside a wide reader", 200, 40, { prefers: "width", needs: { cols: 6, rows: MIN_ROWS } }, "right"],
    ["the tune inspector: under it", 80, 30, { prefers: "height", needs: { cols: 6, rows: MIN_ROWS } }, "down"],
    ["the tune inspector beside a short tile", 80, 5, { prefers: "height", needs: { cols: 6, rows: MIN_ROWS } }, "right"],
    ["an answer as a pair beside a 44-column reader: below, the reader keeping its width", 44, 30, { prefers: "width", dir: "right", pair: true, weight: 0.45 }, "down"],
    ["an answer as a pair beside a wide reader: the side last chosen", 177, 30, { prefers: "width", dir: "left", pair: true, weight: 0.45 }, "left"],
    ["an answer as a pair asked above a narrow reader: above", 44, 30, { prefers: "width", dir: "up", pair: true, weight: 0.45 }, "up"],
    ["an answer beside a 44×30 edit: below, the edit keeping room to type", 44, 30, { prefers: "width", dir: "right", pair: true, weight: 0.45, keeps: { cols: 28, rows: 11 }, tab: true }, "down"],
    ["an answer beside a 44×16 edit: a tab behind it, the edit kept whole", 44, 16, { prefers: "width", dir: "right", pair: true, weight: 0.45, keeps: { cols: 28, rows: 11 }, tab: true }, "tabs"],
    ["^T's picker (wide, dir right) beside a 44×40 reader: below, as before answers took a side (Codex on #1452)", 44, 40, { prefers: "width", dir: "right", needs: { cols: 6, rows: MIN_ROWS } }, "down"],
    ["an answer beside a 44×12 edit, below too short for the answer: a tab behind it, the edit kept whole (Codex on #1452)", 44, 12, { prefers: "width", dir: "right", pair: true, weight: 0.45, keeps: { cols: 28, rows: 11 }, tab: true }, "tabs"],
    ["an answer beside a 42×3 reader, nowhere reading: the place nearest reading, never 0 rows below", 42, 3, { prefers: "width", dir: "right", pair: true, weight: 0.45, keeps: { cols: 28, rows: 11 }, tab: true }, "right"],
    ["the trail as a pair: below a tall reader", 60, 40, { prefers: "width", needs: { cols: 18, rows: MIN_ROWS }, strict: true, pair: true, weight: 0.45 }, "down"],
  ];
  for (const [what, cols, rows, b, where] of TABLE) test(`${what} (${cols}×${rows}): ${where}`, () => {
    expect(lands(cols, rows, b)).toBe(where);
    // The same open by an agent lands the same way: one rule, whoever asks.
    expect(lands(cols, rows, b, AGENT)).toBe(where);
  });

  test("a trail with no room to read is refused before anything opens, and says how narrow", () => {
    expect(lands(30, 4, { prefers: "width", needs: { cols: 18, rows: MIN_ROWS }, strict: true, pair: true })).toMatch(/^refused: beside hearth it is \d+×\d+, under the 18×3 a tile reads at$/);
  });

  test("the answer says why it went where it did when that wasn't the first place weighed", () => {
    const s: LayoutState = init({ tree: leaf(1), names: new Map([[1, "hearth"]]) });
    const r = apply(s, { op: "open", tile: 2, kind: "reader", at: { kind: "beside", target: 1, prefers: "beside" } }, ctxOf(AGENT, { col: 0, row: 0, cols: 40, rows: 40 }));
    expect(r.ok && r.answer).toMatchObject({ where: "down", why: expect.stringMatching(/^beside hearth it is \d+×40, under the 28×6 a tile reads at, so it went below it$/) });
  });

  test("an open naming no place that no container beside takes floats, as before the one rule (a board's lanes)", () => {
    // Three lanes that take only query tiles, on a 100×24 board: beside one, a reader is refused either way; it floats.
    const lanes = { t: "split" as const, dir: "row" as const, kids: [leaf(1), leaf(3), leaf(4)], weights: [1, 1, 1], policy: { accepts: ["query"] } };
    const s: LayoutState = init({ tree: lanes, names: new Map([[1, "sow"], [3, "grow"], [4, "reap"]]) });
    const ctx = { ...ctxOf(AGENT, { col: 0, row: 0, cols: 100, rows: 24 }), tile: (id: number) => ({ kind: id === 2 ? "reader" : "query", notes: id === 2 }) };
    const r = apply(s, { op: "open", tile: 2, kind: "reader", at: { kind: "beside", target: 1, prefers: "beside" } }, ctx);
    expect(r.ok ? r.answer.where : r.refused).toBe("float");
    // Named, it is that place or the container's refusal.
    const named = apply(s, { op: "open", tile: 2, kind: "reader", at: { kind: "beside", target: 1, prefers: "there", dir: "right" } }, ctx);
    expect(named.ok ? named.answer.where : named.refused).toMatch(/takes only query/);
  });

  test("a zoomed tile is measured as it's drawn: zoomed on a 80×24 desk of four, a preview goes beside it", () => {
    const four = new Map([[1, "r1"], [3, "r3"], [4, "r4"], [5, "r5"]]);
    const s: LayoutState = { ...init({ tree: { t: "split", dir: "row", kids: [leaf(1), leaf(3), leaf(4), leaf(5)], weights: [1, 1, 1, 1] }, names: four }), zoom: 3 };
    for (const actor of [PERSON, AGENT]) {
      const r = apply(s, { op: "open", tile: 2, kind: "reader", at: { kind: "beside", target: 3, prefers: "axis", needs: { cols: 6, rows: MIN_ROWS } } }, ctxOf(actor, { col: 0, row: 0, cols: 80, rows: 24 }));
      expect(r.ok ? r.answer.where : r.refused).toBe("right");
    }
  });

  test("a place no container takes is skipped for the next, never caught by the caller", () => {
    // Only keys tiles in the row the target is in: beside it is refused, and the screen's edge takes it.
    const row = { t: "split" as const, dir: "row" as const, kids: [leaf(1), leaf(3)], weights: [1, 1], policy: { accepts: ["reader"] } };
    const s: LayoutState = init({ tree: { t: "split", dir: "col", kids: [row, leaf(4)], weights: [3, 1] }, names: new Map([[1, "hearth"], [3, "loft"], [4, "cellar"]]) });
    const ctx = ctxOf(PERSON, { col: 0, row: 0, cols: 100, rows: 40 });
    const r = apply(s, { op: "open", tile: 2, kind: "keys", at: { kind: "beside", target: 1, prefers: "width", needs: { cols: 20, rows: MIN_ROWS } } }, { ...ctx, tile: id => ({ kind: id === 2 ? "keys" : "reader", notes: id !== 2 }) });
    expect(r.ok ? r.answer.where : r.refused).toMatch(/^edge-/);
  });
});

describe("a tile joins and leaves a layout in one step (PIE-1559)", () => {
  let state = "";
  const was = process.env.EP0CH_STATE;
  beforeAll(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-joinleave-")); process.env.EP0CH_STATE = state; });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; rmSync(state, { recursive: true, force: true }); });
  const USER = { kind: "user" } as const;

  test("open, pick, group, close and an undo that builds the layout again leave nothing out of step", async () => {
    const d = new Desk();
    const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => d.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, USER);
    const steps: [string, () => Promise<unknown>][] = [
      ["open", () => act("tile.open", { kind: "reader", name: "ember", where: "right" }, "reader")],
      ["pick", () => act("tile.select", {}, "ember")],
      // Gathered, its tiles leave this layout whole (a carry) and the group joins in their place.
      ["group", () => act("tile.group", { with: "activity", name: "hob" }, "ember")],
      ["open another", () => act("tile.open", { kind: "reader", name: "cinder", where: "down" }, "hob")],
      ["pick it", () => act("tile.select", {}, "cinder")],
      // The layout built again without cinder (an undo is a build with reuse): its pick goes with it.
      ["undo", () => act("layout.undo")],
      ["close", () => act("tile.close", {}, "hob")],
    ];
    for (const [what, run] of steps) {
      await run();
      expect({ what, out: d.outOfStep() }).toEqual({ what, out: [] });
    }
    expect(d.layoutGet().tiles.map((t: { name: string }) => t.name)).not.toContain("cinder");
    (d as { dispose?: () => void }).dispose?.();
  });

});

// PIE-1757: an answer tile opens beside its reader as a pair. Beside a 44-column reader it went right and halved it, so
// the edit was 22 columns and the ask wrapped; it goes below instead, through the one placement, and the edit keeps its
// width. A wide reader keeps it beside, on the side last chosen.
describe("an answer tile keeps a narrow reader's width (PIE-1757)", () => {
  let state = "";
  const was = process.env.EP0CH_STATE;
  beforeAll(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-answer-width-")); process.env.EP0CH_STATE = state; });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; rmSync(state, { recursive: true, force: true }); });
  const ask = "@yo which notes are drafts";

  for (const [cols, rows, where] of [[44, 30, "down"], [177, 30, "right"]] as const) test(`a ${cols}×${rows} reader: the answer opens ${where}, the reader ${where === "down" ? "keeping all its columns" : "beside it"}`, async () => {
    const { ReaderPane } = await import("../src/desk/panes");
    const area = { col: 0, row: 0, cols, rows }, d = new Desk(undefined, { area });
    Object.assign(d as object, { rootArea: area });   // as a frame drawn at that size leaves it
    const reader = [...(d as unknown as { panes: Map<number, unknown> }).panes.values()].find(p => p instanceof ReaderPane) as InstanceType<typeof ReaderPane>;
    // One reader alone on the screen: the desk's other tiles closed.
    for (const t of d.layoutGet().tiles as { name: string; kind: string }[]) if (t.kind !== "reader" || (d as any).paneNamed(t.name) !== reader) await d.dispatch.act({ action: "tile.close", tile: t.name }, PERSON).catch(() => {});
    const before = (d.layoutGet().tiles as { kind: string; rect: Rect }[]).find(t => t.kind === "reader")!.rect;
    await d.answerTile(reader, ask, PERSON);
    const tiles = d.layoutGet().tiles as { kind: string; rect: Rect }[];
    const after = tiles.find(t => t.kind === "reader")!.rect, answer = tiles.find(t => t.kind === "answer")!.rect;
    const went = answer.row > after.row && answer.col === after.col ? "down" : answer.col > after.col ? "right" : "elsewhere";
    expect({ cols, went, reader: where === "down" ? after.cols : "beside" }).toEqual({ cols, went: where, reader: where === "down" ? before.cols : "beside" });
    (d as { dispose?: () => void }).dispose?.();
  });

  // Evan's shape: a 177-column desk of four readers about 44 wide. The answer opens below the one asked from, which keeps
  // its columns; its neighbours keep theirs.
  test("a 177×40 desk of four 44-column readers: the answer opens below the one asked from, every reader's width kept", async () => {
    const { ReaderPane } = await import("../src/desk/panes");
    const area = { col: 0, row: 0, cols: 177, rows: 40 }, d = new Desk(undefined, { area });
    Object.assign(d as object, { rootArea: area });
    const panes = () => [...(d as unknown as { panes: Map<number, unknown> }).panes.values()];
    const first = panes().find(p => p instanceof ReaderPane) as InstanceType<typeof ReaderPane>;
    const firstName = () => (d.layoutGet().tiles as { name: string; kind: string }[]).find(t => (d as any).paneNamed(t.name) === first)!.name;
    for (const t of d.layoutGet().tiles as { name: string; kind: string }[]) if (t.name !== firstName()) await d.dispatch.act({ action: "tile.close", tile: t.name }, PERSON).catch(() => {});
    for (const name of ["sow", "grow", "reap"]) await d.dispatch.act({ action: "tile.open", tile: firstName(), args: { kind: "reader", name, where: "right" } }, PERSON);
    await d.dispatch.act({ action: "layout.even" }, PERSON);
    const readers = () => (d.layoutGet().tiles as { name: string; kind: string; rect: Rect }[]).filter(t => t.kind === "reader");
    const before = new Map(readers().map(t => [t.name, t.rect.cols]));
    expect([...before.values()].every(c => c >= 40 && c <= 46), JSON.stringify([...before])).toBe(true);
    const grow = (d as any).paneNamed("grow") as InstanceType<typeof ReaderPane>;
    await d.answerTile(grow, ask, PERSON);
    const answer = (d.layoutGet().tiles as { kind: string; rect: Rect }[]).find(t => t.kind === "answer")!.rect;
    const asked = readers().find(t => t.name === "grow")!.rect;
    expect({ below: answer.row > asked.row && answer.col === asked.col, cols: answer.cols }).toEqual({ below: true, cols: asked.cols });
    expect(new Map(readers().map(t => [t.name, t.rect.cols]))).toEqual(before);
    expect(d.answerSide(grow)).toBe("down");
    (d as { dispose?: () => void }).dispose?.();
  });
});
