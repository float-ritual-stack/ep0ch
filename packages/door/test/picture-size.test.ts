// Pictures size the way you set them (PIE-1583): one caption under a fence's picture, saying how big its source is; a
// selection over the picture counts and copies that source; and [−] [+], + - and image.size write the fence's height=
// word through the note's save, attributed, so the note reopens at that size. Made-up notes on a scratch host.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetFencePictures } from "../src/diagrams";
import { type Msg } from "../src/board";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1422" height="800" viewBox="0 0 1422 800"><rect width="1422" height="800" fill="${fill}"/></svg>`;
const A = svg("#123"), B = `${svg("#512")}\n<!-- the second bed -->`;
const note = (text: string): Msg => ({ id: "bbbbbbbb-1111-4222-8333-444444444444", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 2, properties: [] });
const fenced = (info: string, body = A) => `Beds\n\nbefore\n\n\`\`\`${info}\n${body}\n\`\`\`\n\nafter`;

const copied: string[] = [];
const said: string[] = [];
const host = (): SurfaceHost => ({
  ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash(s: string) { said.push(s); }, copy(t: string) { copied.push(t); return true; }, t: { cols: 120, rows: 60, cellW: 9, cellH: 18, kitty: true }, graphics: true } as any,
  redraw() {}, navigate() {},
});

let dir = "";
const saved = process.env.EP0CH_STATE;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "ep0ch-picture-size-")); process.env.EP0CH_STATE = join(dir, "state"); forgetFencePictures(); });
afterAll(() => { if (saved === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = saved; rmSync(dir, { recursive: true, force: true }); });

/** A reader on `text`, its fence pictures made and read. */
async function reader(text: string, w = 90) {
  const s = new NoteSurface(), h = host();
  s.show(note(text), h);
  const draw = () => s.render(w, 60, h);
  for (let i = 0; i < 200; i++) {
    const v = draw();
    const waiting = v.lines.some(l => /drawing|loading/.test(plain(l)));
    if (!waiting && (v.placements?.length ?? 0) > 0) return { s, h, v, draw };
    await Bun.sleep(20);
  }
  throw new Error(`the picture never drew:\n${draw().lines.map(plain).join("\n")}`);
}
const captions = (lines: string[]) => lines.map(plain).filter(l => l.includes("▣ svg picture"));

describe("one caption, under its picture", () => {
  test("a fence alone: one caption, on the row under the picture, saying its source's size", async () => {
    const { v } = await reader(fenced("svg"));
    expect(captions(v.lines)).toHaveLength(1);
    expect(captions(v.lines)[0]).toContain(`${[...A].length} chars`);
    const p = v.placements![0]!, row = v.lines.findIndex(l => plain(l).includes("▣ svg picture"));
    expect(p.row + p.rows).toBe(row);
  });

  test("two fences of one size read apart: each caption says its own source's size", async () => {
    const { v } = await reader(`Beds\n\n\`\`\`svg\n${A}\n\`\`\`\n\n\`\`\`svg\n${B}\n\`\`\`\n\nafter`);
    const both = captions(v.lines);
    expect(both).toHaveLength(2);
    expect(both[0]).toContain(`${[...A].length} chars`);
    expect(both[1]).toContain(`${[...B].length} chars`);
  });
});

describe("a picture fence in a list item", () => {
  const item = (info: string) => `Beds\n\n- the plan\n- \`\`\`${info}\n  ${A}\n  \`\`\`\n\nafter`;
  test("draws, and a resize keeps the list mark", async () => {
    const { s, h, v } = await reader(item("svg"));
    expect(captions(v.lines)).toHaveLength(1);
    const saved: string[] = [];
    (h.ctx.board as any).get = async () => note(item("svg"));
    (h.ctx.board as any).update = async (_: string, text: string) => { saved.push(text); return { ...note(text), revision: 3 }; };
    await s.changeImage((await s.imageNamed({ n: 1 }, { kind: "user" } as any)), { height: "12" }, "height 12 rows", h, { kind: "user" } as any);
    expect(saved[0]).toContain("- ```svg height=12\n");
  });
});

describe("two fences that read alike", () => {
  test("a resize drawn before a fence was inserted above it is refused, never written on the other one", async () => {
    const both = `Beds\n\n\`\`\`svg\n${A}\n\`\`\`\n\n\`\`\`svg\n${A}\n\`\`\``;
    const { s, h } = await reader(both);
    const saved: string[] = [];
    // Someone puts a fence above the second: line 6 is now that one, and reads the same as the line drawn there.
    const moved = { ...note(`Beds\n\n\`\`\`svg\n${svg("#512")}\n\`\`\`\n\n\`\`\`svg\n${A}\n\`\`\`\n\n\`\`\`svg\n${A}\n\`\`\``), revision: 3 };
    (h.ctx.board as any).get = async () => moved;
    (h.ctx.board as any).update = async (_: string, text: string) => { saved.push(text); return { ...note(text), revision: 4 }; };
    const drawn = s.imagesIn(note(both))[1]!;
    await expect(s.changeImage(drawn, { height: "12" }, "height 12 rows", h, { kind: "user" } as any)).rejects.toThrow(/changed since it was drawn/);
    expect(saved).toEqual([]);
  });
});

describe("a selection over the picture says what it is over", () => {
  test("the rule counts the source, y and Y copy it, never 0 chars", async () => {
    const { s, h, v, draw } = await reader(fenced("svg"));
    const p = v.placements![0]!;
    s.press(p.col + 4, p.row + 1, h);
    s.drag(p.col + 20, p.row + 4, h);
    s.release(p.col + 20, p.row + 4, h);
    const rule = draw().lines.map(plain).find(l => l.includes("[y copy]"))!;
    expect(rule).toContain(`${[...A].length} chars`);
    copied.length = 0;
    expect(s.copySelection(false, h)?.text).toBe(A);
    expect(s.copySelection(true, h)?.text).toBe(A);
    expect(copied).toEqual([A, A]);
  });
});
