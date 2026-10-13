// PIE-794: every spine names what it holds. A river of many columns squeezes most of them to spines; under Kitty
// graphics each spine's title is a rotated image, and a dock sliding over the lower rows (your drawer) cuts a long
// title short rather than taking the whole image away (it did: long titles' spines showed blank). Scratch outline,
// fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { uncovered } from "../src/kitty";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { spineImage } from "../src/spine";
import { outliner, Scratch, until } from "./scratch";
import { view } from "./river-view";

test("a placement a dock covers at the bottom is cut short; one covered elsewhere goes; one not covered stays", () => {
  const image = spineImage("A very long column title that runs down past the drawer's edge", 11);
  const p = { key: "spine:1", image, col: 10, row: 2, cols: 2, rows: 40, z: -1 };
  expect(uncovered(p, { col: 30, row: 0, cols: 10, rows: 50 })).toBe(p);
  const cut = uncovered(p, { col: 0, row: 30, cols: 100, rows: 20 })!;
  expect(cut.rows).toBe(28);
  expect(cut.crop).toEqual({ x: 0, y: 0, w: image.width, h: Math.floor((image.height * 28) / 40) });
  expect(uncovered(p, { col: 11, row: 10, cols: 5, rows: 5 })).toBeNull();
});

describe.skipIf(!outliner)("a river of many columns: every spine names its note, a long one under a dock too", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, river: Desk;
  let key: (k: any) => void = () => {};
  const saved = process.env.EP0CH_DAILY_AGENT;
  const V = () => view(river);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "cat";          // your drawer's own tab: a harmless program
    board = new SocketBoard(await scratch.start());
    const term = { info: { cols: 200, rows: 50, cellW: 9, cellH: 16, kitty: true }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    river = openScreen("river") as Desk;
    app.push(new MainMenu()); app.push(river);
    await until(() => !!V().column(1)?.items?.length || true, "the Library", 10_000);
  }, 30_000);
  afterAll(async () => {
    app?.quit(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE;
    if (saved === undefined) delete process.env.EP0CH_DAILY_AGENT; else process.env.EP0CH_DAILY_AGENT = saved;
  });

  test("nine columns: each squeezed one is a spine with its note's title, in cells and as a Kitty image", async () => {
    const titles = Array.from({ length: 9 }, (_, i) => `Column ${i + 1}: a long title about the allotment's north beds and the water butts by the shed`);
    for (const t of titles) {
      const n = await board.request<any>("create", { parentId: null, text: `${t}\nA line.`, author: "agent" });
      await app.act({ action: "open", args: { id: n.id, fresh: true }, as: "spine-agent" });
    }
    await until(() => V().columns.length >= 10, "ten columns", 10_000);
    const D = river as any;
    const spineIds = () => { D.render(D.ctx); return D.spines.map(([id]: [number]) => id) as number[]; };
    await until(() => spineIds().length >= 5, "most columns squeezed to spines", 5000);
    // In cells: the title's letters down the spine.
    (app as any).video = "cells";
    const lines = (D.render(D.ctx).lines as string[]).map(l => l.replace(/\x1b\[[\d;]*m/g, ""));
    for (const [, r] of D.spines as [number, any][]) {
      const down = lines.slice(r.row, r.row + r.rows).map(l => [...l][r.col] ?? " ").join("").replace(/[·×■✎¶ ]/g, "");
      expect(down.length).toBeGreaterThan(3);
    }
    // Under Kitty graphics: each spine places its title, the long ones too.
    (app as any).video = "kitty";
    try {
      const placed = (D.render(D.ctx).placements as any[]).map(p => p.key);
      for (const id of spineIds()) expect(placed).toContain(`spine:${id}`);
      // Your drawer up over the bottom rows: each spine's title is cut at its edge, never taken away whole.
      let shown: any[] = [];
      (app as any).display.show = (_l: string[], ps: any[]) => { shown = ps; };
      key({ kind: "alt", ch: "a" });
      await until(() => { (app as any).paint(); return !!(app as any).drawer.shown; }, "the drawer up", 5000);
      (app as any).paint();
      const top = (app as any).drawer.rect.row as number;
      const spines = shown.filter(p => String(p.key).startsWith("spine:"));
      for (const id of spineIds()) expect(spines.map(p => p.key)).toContain(`spine:${id}`);
      for (const p of spines) expect(p.row + p.rows).toBeLessThanOrEqual(top);
      expect(spines.some(p => p.crop)).toBe(true);
    } finally { (app as any).video = "cells"; }
  }, 30_000);
});
