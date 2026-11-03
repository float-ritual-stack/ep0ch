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
