// PIE-1631: a header picture keeps its shape at every tile width: the part of the PNG a placement shows has the shape of
// the cells it fills, so a circle stays a circle. Made-up SVGs (a 1600×400 band with a disc), a scratch state dir.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { type Msg } from "../src/board";
import { forgetFencePictures } from "../src/diagrams";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Placement } from "../src/kitty";
import type { PngRef } from "../src/media";

const CW = 9, CH = 18;
const band = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400" width="1600" height="400"><rect width="1600" height="400" fill="#101826"/><circle cx="800" cy="200" r="60" fill="#4fb3c7"/></svg>`;
const note = (text: string): Msg => ({ id: "cccccccc-1111-4222-8333-444444444444", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 2, properties: [] });
/** A desk tile's reader: `pad` cells of the tile's padding round the body, which a header bleeds into (heroBounds). */
const host = (cols: number, pad = 0): SurfaceHost => ({
  ...(pad ? { heroBounds: { col: -pad, row: -pad, cols: cols + 2 * pad } } : {}),
  ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, copy() { return true; }, t: { cols, rows: 60, cellW: CW, cellH: CH, kitty: true }, graphics: true } as any,
  redraw() {}, navigate() {},
});

let dir = "";
const saved = process.env.EP0CH_STATE;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "ep0ch-hero-aspect-")); process.env.EP0CH_STATE = join(dir, "state"); forgetFencePictures(); writeFileSync(join(dir, "band.svg"), band); });
afterAll(() => { if (saved === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = saved; rmSync(dir, { recursive: true, force: true }); });

/** Every placement of `text` drawn `w` wide, once its pictures are made and settled at that size. */
async function placed(text: string, w: number, h = 60, pad = 0): Promise<Placement[]> {
  const s = new NoteSurface(), hs = host(w, pad);
  s.show(note(text), hs);
  let last = "";
  for (let i = 0; i < 300; i++) {
    const ps = s.render(w, h, hs).placements ?? [];
    const now = JSON.stringify(ps.map(p => [p.key, p.cols, p.rows, p.crop, p.image.width, p.image.height]));
    if (ps.length && now === last) return ps;
    last = now;
    await Bun.sleep(30);
  }
  throw new Error("the pictures never settled");
}

/** How much the part a placement shows is stretched across, drawn into its cells: 1 is its own shape. */
const stretch = (p: Placement) => {
  const c = p.crop ?? { x: 0, y: 0, w: p.image.width, h: p.image.height };
  return (p.cols * CW / (p.rows * CH)) / (c.w / c.h);
};

/** Its own shape, within what whole cells allow: half a row (or column) either way. */
const round = (p: Placement, got: number, measured = 0.02) => expect(Math.abs(got - 1)).toBeLessThanOrEqual(0.5 / Math.min(p.rows, p.cols) + measured);
/** The disc as measured in pixels: its antialiased edge is a pixel or two either way at a small size. */
const disc = async (p: Placement) => round(p, await discShape(p), 0.1);

/** The disc's width over its height, as drawn: the PNG's part, scaled into the cells. */
async function discShape(p: Placement): Promise<number> {
  const c = p.crop ?? { x: 0, y: 0, w: p.image.width, h: p.image.height };
  const { data, info } = await sharp((p.image as PngRef).png).extract({ left: c.x, top: c.y, width: c.w, height: c.h }).resize({ width: p.cols * CW, height: p.rows * CH, fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x]! > 90) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return (x1 - x0 + 1) / (y1 - y0 + 1);
}

describe("a header keeps its shape at every width (PIE-1631)", () => {
  for (const [what, words] of [["cover (the default)", "[height::12]"], ["contain", "[height::12] [fit::contain]"], ["its own rows", ""]] as const) {
    for (const w of [160, 60, 30]) {
      test(`a 1600×400 file header, ${what}, ${w} columns: the disc is round`, async () => {
        const [hero] = (await placed(`Band\n[img::${join(dir, "band.svg")}] [layout::hero] ${words}\n\nwords`, w)).filter(p => p.key.startsWith("hero"));
        expect(hero, "a header placed").toBeDefined();
        round(hero!, stretch(hero!));
        await disc(hero!);
      });
    }
  }

  // In a desk tile the header bleeds into the tile's padding (its rows grow by the padding's): the rows it's drawn in
  // must be the rows it's laid out for, or the picture is stretched to fill them, a disc an oval (Evan's, Nov 7).
  for (const [what, words] of [["cover (the default)", "[height::12]"], ["contain", "[height::12] [fit::contain]"], ["its own rows", ""]] as const) {
    for (const w of [160, 30]) {
      test(`in a desk tile with a cell of padding, a header, ${what}, ${w} columns: the disc is round`, async () => {
        const [hero] = (await placed(`Band\n[img::${join(dir, "band.svg")}] [layout::hero] ${words}\n\nwords`, w, 60, 1)).filter(p => p.key.startsWith("hero"));
        round(hero!, stretch(hero!));
        await disc(hero!);
      });
    }
  }

  for (const [what, info] of [["size=full", "svg size=full"], ["size=full with a height", "svg size=full height=6"]] as const) {
    for (const w of [160, 30]) {
      test(`a fence, ${what}, ${w} columns: the disc is round`, async () => {
        const ps = await placed(`Band\n\n\`\`\`${info}\n${band}\n\`\`\`\n\nwords`, w);
        round(ps[0]!, stretch(ps[0]!));
        await disc(ps[0]!);
      });
    }
  }

  for (const w of [160, 30]) {
    test(`a cover crop on a media line (fit=cover, size=full, height=N), ${w} columns: the disc is round`, async () => {
      const ps = await placed(`Band\n\n[img::${join(dir, "band.svg")}] [size::full] [fit::cover] [height::10]\n\nwords`, w);
      round(ps[0]!, stretch(ps[0]!));
      await disc(ps[0]!);
    });
  }
});

// Codex on #1347: contained, the whole picture shows, at widths where its box meets the tile's (100) and fills it (60).
describe("a contained header in a padded tile shows all of itself (PIE-1631)", () => {
  for (const w of [100, 60]) test(`${w} columns: no crop, round, inside the header's rows`, async () => {
    const [hero] = (await placed(`Band\n[img::${join(dir, "band.svg")}] [layout::hero] [height::12] [fit::contain]\n\nwords`, w, 60, 2)).filter(p => p.key.startsWith("hero"));
    expect(hero!.crop).toBeUndefined();
    expect(hero!.col + hero!.cols).toBeLessThanOrEqual(w + 2);
    round(hero!, stretch(hero!));
    await disc(hero!);
  });
});
