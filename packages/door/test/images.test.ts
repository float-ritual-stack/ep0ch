// Images (PIE-532, PIE-494): the media line's grammar and its rewrite, the layout of a sized, placed or header
// image, and the scaling that turns PNG, JPEG, WebP and GIF into PNGs no bigger than the box they're drawn in,
// with no system tool. Fictional images, drawn here; no outline is written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { coverCrop, imageBox, renderDoc, type DocEnv } from "../src/doc";
import { inWindow } from "../src/kitty";
import { media, mediaCache, parseMediaLine, rewriteMediaLine, sized } from "../src/media";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const dir = mkdtempSync(join(tmpdir(), "ep0ch-images-"));
const state = mkdtempSync(join(tmpdir(), "ep0ch-images-state-"));
const was = process.env.EP0CH_STATE;
const file = (name: string) => join(dir, name);
const drawn = { create: { width: 1200, height: 600, channels: 3 as const, background: { r: 40, g: 30, b: 60 } } };

beforeAll(async () => {
  process.env.EP0CH_STATE = state;
  await sharp(drawn).png().toFile(file("wide.png"));
  await sharp(drawn).jpeg().toFile(file("wide.jpg"));
  await sharp(drawn).webp().toFile(file("wide.webp"));
  await sharp(drawn).gif().toFile(file("wide.gif"));
  await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 60, b: 20 } } }).png().toFile(file("small.png"));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; });

describe("the media line", () => {
  test("a path and the layout beside it, in any order, after an optional list mark", () => {
    expect(parseMediaLine("- [img::/p/a b.png] [size::40%] [align::center] [layout::hero] [alt::the plot]")).toEqual({
      kind: "img", path: "/p/a b.png", size: { percent: 40 }, align: "center", layout: "hero", alt: "the plot", problems: [],
    });
    expect(parseMediaLine("[height::8] [video:: ~/v.mp4]")).toMatchObject({ kind: "video", path: "~/v.mp4", height: 8 });
    expect(parseMediaLine("img:: /p/x.jpg")).toMatchObject({ kind: "img", path: "/p/x.jpg" });
    expect(parseMediaLine("[img::/p/x.jpg] [size::full]")!.size).toBe("full");
    expect(parseMediaLine("[img::/p/x.jpg] [size::30]")!.size).toEqual({ cells: 30 });
  });

  test("anything else on the line, or another property, makes it text; a bad value is said", () => {
    expect(parseMediaLine("look: [img::/p/x.jpg]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg] [type::note]")).toBeNull();
    expect(parseMediaLine("[img::/a.png] [img::/b.png]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg] [size::huge] [align::up]")!.problems).toEqual(["size::huge isn't a size (cells, N% or full)", "align::up isn't left, center or right"]);
  });

  test("rewritten: values replaced in place, new ones after, null takes one out; img:: becomes a token", () => {
    expect(rewriteMediaLine("  - [img::/a.png] [size::25%] [alt::x]", { size: "50%", align: "right" })).toBe("  - [img::/a.png] [size::50%] [alt::x] [align::right]");
    expect(rewriteMediaLine("[img::/a.png] [layout::hero]", { layout: null })).toBe("[img::/a.png]");
    expect(rewriteMediaLine("img:: /a.png", { size: "40" })).toBe("[img::/a.png] [size::40]");
    expect(rewriteMediaLine("not an image", { size: "40" })).toBeNull();
  });
});

describe("layout", () => {
  const env: DocEnv = { width: 100, cellW: 10, cellH: 20, graphics: true, maxImageRows: 30, unfold: true };
  const m = { state: "ready", path: "/x", kind: "img", width: 1000, height: 500, image: { png: Buffer.alloc(0), width: 1000, height: 500, key: "k" } } as const;
  const spec = (s: string) => parseMediaLine(`[img::/x] ${s}`)!;

  test("width as cells, a share or full; height in rows; aspect kept; capped; aligned", () => {
    expect(imageBox(m, spec("[size::50%]"), 100, env)).toEqual({ col: 0, cols: 50, rows: 13 });
    expect(imageBox(m, spec("[size::40] [align::right]"), 100, env)).toEqual({ col: 60, cols: 40, rows: 10 });
    expect(imageBox(m, spec("[size::full]"), 100, env)).toEqual({ col: 0, cols: 100, rows: 25 });
    expect(imageBox(m, spec("[height::5] [align::center]"), 100, env)).toEqual({ col: 40, cols: 20, rows: 5 });
    // Both: inside both. Taller than the reader allows: capped, narrower.
    expect(imageBox(m, spec("[size::full] [height::10]"), 100, env)).toEqual({ col: 0, cols: 40, rows: 10 });
    expect(imageBox(m, spec("[size::full]"), 100, { ...env, maxImageRows: 10 })).toEqual({ col: 0, cols: 40, rows: 10 });
  });

  test("a cover crop keeps the box's shape, around the middle", () => {
    expect(coverCrop({ width: 1000, height: 500 }, 1000, 250)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 });
    expect(coverCrop({ width: 1000, height: 500 }, 500, 500)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(coverCrop({ width: 1000, height: 500 }, 200, 100)).toBeUndefined();
  });

  test("cut to a window, a cropped image is cut inside its crop", () => {
    const p = { key: "a", image: { width: 400, height: 400, png: Buffer.alloc(0), key: "k" }, col: 0, row: 0, cols: 10, rows: 10, crop: { x: 0, y: 100, w: 400, h: 200 } };
    expect(inWindow(p, 5, 20)!.crop).toEqual({ x: 0, y: 200, w: 400, h: 100 });
    expect(inWindow(p, 0, 20)!.crop).toEqual(p.crop);
  });
});

describe("scaling, with no system tool (PIE-494)", () => {
  for (const f of ["wide.png", "wide.jpg", "wide.webp", "wide.gif"]) {
    test(`${f}: read, its size known, drawn from a PNG scaled down for the box (never up)`, async () => {
      await until(() => media(file(f), "img").state !== "loading", f, 10_000);
      const m = media(file(f), "img");
      if (m.state !== "ready") throw new Error(m.state === "error" ? m.reason : "loading");
      expect([m.width, m.height]).toEqual([1200, 600]);
      expect(m.image.png.readUInt32BE(0)).toBe(0x89504e47);
      expect(m.image.width).toBe(640);
      // A box 300 px wide is drawn from the 320 step; one 2000 px wide from the image's own 1200 (the 1280 step's).
      sized(m, 300, 150);
      await until(() => sized(m, 300, 150).width === 320, "the 320 step", 10_000);
      await until(() => sized(m, 2000, 1000).width === 1200, "its own size, not bigger", 10_000);
      // The cache names each scaled PNG by the file and its step.
      expect(readdirSync(mediaCache()).filter(n => /-(320|640)\.png$/.test(n)).length).toBeGreaterThan(0);
    });
  }

  test("a PNG already small enough is drawn as it is", async () => {
    await until(() => media(file("small.png"), "img").state === "ready", "small", 10_000);
    const m = media(file("small.png"), "img");
    if (m.state !== "ready") throw new Error("not ready");
    expect([m.image.width, m.image.height]).toEqual([200, 100]);
    expect(existsSync(join(mediaCache(), `${m.image.key}.png`))).toBe(false);
  });

  test("a missing file says so", () => {
    expect(media(file("nope.png"), "img")).toMatchObject({ state: "error", reason: "file not found" });
  });
});

describe("the reader draws the header image above the title", () => {
  const note = (text: string) => ({ id: "41111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} });
  const host = (graphics: boolean): SurfaceHost => ({
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cols: 100, rows: 40, cellW: 10, cellH: 20, kitty: graphics }, graphics } as any,
    redraw() {}, navigate() {},
  });

  test("full width, a third of the pane, cropped to fill; the note under it; its line only a caption", async () => {
    await until(() => media(file("wide.jpg"), "img").state === "ready", "the jpeg", 10_000);
    const s = new NoteSurface(), h = host(true), m = note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\nBeans.`);
    s.show(m as any, h);
    const v = s.render(100, 42, h);
    const hero = v.placements![0]!;
    expect(hero).toMatchObject({ col: 0, row: 0, cols: 100, rows: 14 });
    // 1000 × 280 px of a 2:1 image: its middle 0.357 of the height.
    expect(hero.crop!.w).toBe(hero.image.width);
    expect(hero.crop!.h / hero.image.height).toBeCloseTo(280 / 500, 1);
    const lines = v.lines.map(plain);
    expect(lines.slice(0, 14).every(l => !l.trim())).toBe(true);
    expect(lines[14]).toContain("Plot");
    expect(lines.find(l => l.includes("▀ header wide.jpg"))).toContain("[▀ ✓]");
    expect(v.placements).toHaveLength(1);
    // It scrolls away with the top of the note: a row off its top for each row scrolled, cropped from the top.
    const long = note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\n${Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n")}`);
    s.show(long as any, h);
    s.render(100, 42, h);
    (s as any).scroll = 4;
    const sv = s.render(100, 42, h), top = sv.placements![0]!;
    expect(top).toMatchObject({ row: 0, rows: 10 });
    expect(top.crop!.y).toBeGreaterThan(hero.crop!.y);
    expect(plain(sv.lines[10]!)).toContain("Plot");
    (s as any).scroll = 20;
    const gone = s.render(100, 42, h);
    expect(plain(gone.lines[0]!)).toContain("Plot");
    expect(gone.placements!.some(p => p.key.startsWith("hero:"))).toBe(false);
    // A pane too short for it, or no graphics: the header is drawn where it's written, or only named.
    expect(s.render(100, 12, h).lines.map(plain)[0]).toContain("Plot");
    const off = new NoteSurface(), ho = host(false);
    off.show(m as any, ho);
    expect(off.render(100, 42, ho).lines.map(plain).join("\n")).toContain("▀ header wide.jpg · 1200×600");
  });

  test("without a reader (a river column, ep0ch show) the header is drawn where it is written, full width", async () => {
    await until(() => media(file("wide.jpg"), "img").state === "ready", "the jpeg", 10_000);
    const env: DocEnv = { width: 80, cellW: 10, cellH: 20, graphics: true, maxImageRows: 8, unfold: true };
    const d = renderDoc(`[img::${file("wide.jpg")}] [layout::hero]`, env);
    expect(d.images[0]).toMatchObject({ col: 0, cols: 80, rows: 8, crop: { x: 0, w: 1 } });
    expect(d.hero).toBeUndefined();
  });
});
