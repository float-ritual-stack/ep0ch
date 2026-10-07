// Images (PIE-532, PIE-494): the media line's grammar and its rewrite, the layout of a sized, placed or header
// image, the scaling that turns PNG, JPEG, WebP and GIF into PNGs no bigger than the box they're drawn in (with no
// system tool), and the dimming that keeps a bright image dark-first. Fictional images, drawn here; no outline is written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { heroBox, imageBox, coverCrop, mediaLines, renderDoc, type DocEnv } from "../src/doc";
import { inWindow } from "../src/kitty";
import { brightness, cellColours, MAX_MEAN, media, mediaCache, parseFocus, parseMediaLine, rewriteMediaLine, sized, type ReadyMedia } from "../src/media";
import { backgroundAfter, HERO_MEAN, HERO_PEAK, heroStep, overColours, useHeroHeader } from "../src/surface/hero-header";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const dir = mkdtempSync(join(tmpdir(), "ep0ch-images-"));
const state = mkdtempSync(join(tmpdir(), "ep0ch-images-state-"));
const was = process.env.EP0CH_STATE;
const file = (name: string) => join(dir, name);
const drawn = { create: { width: 1200, height: 600, channels: 3 as const, background: { r: 40, g: 30, b: 60 } } };
const ready = async (f: string) => { await until(() => media(file(f), "img").state !== "loading", f, 10_000); const m = media(file(f), "img"); if (m.state !== "ready") throw new Error(m.state === "error" ? m.reason : "loading"); return m; };
const meanOf = async (png: Buffer) => { const c = (await sharp(png).stats()).channels; return (0.2126 * c[0]!.mean + 0.7152 * c[1]!.mean + 0.0722 * c[2]!.mean) / 255; };

beforeAll(async () => {
  process.env.EP0CH_STATE = state;
  await sharp(drawn).png().toFile(file("wide.png"));
  await sharp(drawn).jpeg().toFile(file("wide.jpg"));
  await sharp(drawn).webp().toFile(file("wide.webp"));
  await sharp(drawn).gif().toFile(file("wide.gif"));
  await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 60, b: 20 } } }).png().toFile(file("small.png"));
  // A fictional sunset: bright and saturated.
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 250, g: 120, b: 30 } } }).png().toFile(file("sunset.png"));
  // A fictional night sky with one bright moon: dark on the whole, a small white patch.
  await sharp({ create: { width: 1000, height: 100, channels: 3, background: { r: 4, g: 6, b: 12 } } }).composite([{ input: { create: { width: 40, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } } }, left: 480, top: 30 }]).png().toFile(file("moon.png"));
  // A fictional page of paper: nearly white.
  await sharp({ create: { width: 800, height: 450, channels: 3, background: { r: 240, g: 236, b: 226 } } }).png().toFile(file("paper.png"));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; });

describe("the media line", () => {
  test("a path and the layout beside it, in any order, after an optional list mark", () => {
    expect(parseMediaLine("- [img::/p/a b.png] [size::40%] [align::center] [layout::hero] [fit::contain] [dim::0.6] [alt::the plot]")).toEqual({
      kind: "img", path: "/p/a b.png", size: { percent: 40 }, align: "center", layout: "hero", fit: "contain", dim: 0.6, alt: "the plot", problems: [],
    });
    expect(parseMediaLine("[height::8] [video:: ~/v.mp4]")).toMatchObject({ kind: "video", path: "~/v.mp4", height: 8 });
    expect(parseMediaLine("img:: /p/x.jpg")).toMatchObject({ kind: "img", path: "/p/x.jpg" });
    expect(parseMediaLine("[img::/p/x.jpg] [size::full]")!.size).toBe("full");
    expect(parseMediaLine("[img::/p/x.jpg] [size::30]")!.size).toEqual({ cells: 30 });
  });

  test("a path with brackets, an anchor at the end, the img:: form with layout after it, a key written twice", () => {
    expect(parseMediaLine("[img::shots/a [1].png]")).toMatchObject({ path: "shots/a [1].png" });
    expect(parseMediaLine("[img::a.png] ^abc")).toMatchObject({ path: "a.png" });
    expect(parseMediaLine("img:: a.png [size::40%]")).toMatchObject({ path: "a.png", size: { percent: 40 } });
    const twice = parseMediaLine("[img::a.png] [size::40%] [size::60%]")!;
    expect(twice.size).toEqual({ percent: 40 });
    expect(twice.problems).toEqual(["size is written twice: the first counts"]);
  });

  test("anything else on the line, or another property, makes it text; a bad value is said", () => {
    expect(parseMediaLine("look: [img::/p/x.jpg]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg] [type::note]")).toBeNull();
    expect(parseMediaLine("[img::/a.png] [img::/b.png]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg][size::40]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg] [size::huge] [align::up] [dim::2]")!.problems).toEqual(["size::huge isn't a size (cells, N% or full)", "align::up isn't left, center or right", "dim::2 isn't a number from 0 to 1"]);
  });

  test("rewritten: values replaced in place, new ones after, null takes one out, a second of a key goes; the anchor stays", () => {
    expect(rewriteMediaLine("  - [img::/a.png] [size::25%] [alt::x]", { size: "50%", align: "right" })).toBe("  - [img::/a.png] [size::50%] [alt::x] [align::right]");
    expect(rewriteMediaLine("[img::/a.png] [layout::hero]", { layout: null })).toBe("[img::/a.png]");
    expect(rewriteMediaLine("img:: /a.png", { size: "40" })).toBe("[img::/a.png] [size::40]");
    expect(rewriteMediaLine("img:: a.png [size::40%]", { size: "50%" })).toBe("[img::a.png] [size::50%]");
    expect(rewriteMediaLine("[img::a.png] [size::40%] [size::60%]", { size: "50%" })).toBe("[img::a.png] [size::50%]");
    expect(rewriteMediaLine("[img::shots/a [1].png] ^abc", { align: "center" })).toBe("[img::shots/a [1].png] [align::center] ^abc");
    expect(rewriteMediaLine("not an image", { size: "40" })).toBeNull();
  });

  test("one scan: not inside a fence or a figure; the first header counts", () => {
    const found = mediaLines(["[img::a.png] [layout::hero]", "```", "[img::b.png]", "```", "[img::c.png] [layout::hero]"]);
    expect([...found.keys()]).toEqual([0, 4]);
    expect(found.get(4)!.layout).toBeUndefined();
    expect(found.get(4)!.problems).toEqual(["another image is the header already"]);
  });
});

describe("layout", () => {
  const env: DocEnv = { width: 100, cellW: 10, cellH: 20, graphics: true, maxImageRows: 30, unfold: true };
  const m: ReadyMedia = { state: "ready", path: "/x", kind: "img", key: "k", width: 1000, height: 500, mean: 0.1 };
  const spec = (s: string) => parseMediaLine(`[img::/x] ${s}`)!;

  test("width as cells, a share or full; height in rows; aspect kept; capped; aligned", () => {
    expect(imageBox(m, spec("[size::50%]"), 100, env)).toEqual({ col: 0, cols: 50, rows: 13 });
    expect(imageBox(m, spec("[size::40] [align::right]"), 100, env)).toEqual({ col: 60, cols: 40, rows: 10 });
    expect(imageBox(m, spec("[size::full]"), 100, env)).toEqual({ col: 0, cols: 100, rows: 25 });
    expect(imageBox(m, spec("[height::5] [align::center]"), 100, env)).toEqual({ col: 40, cols: 20, rows: 5 });
    expect(imageBox(m, spec("[size::full] [height::10]"), 100, env)).toEqual({ col: 0, cols: 40, rows: 10 });
    expect(imageBox(m, spec("[size::full]"), 100, { ...env, maxImageRows: 10 })).toEqual({ col: 0, cols: 40, rows: 10 });
  });

  test("a header: whole when it fits under its cap; taller, cropped to fill, or whole and centred with fit::contain", () => {
    // 100 cells of 10 px: 1000 × 500 px, 25 rows of 20 px.
    expect(heroBox(m, spec(""), 100, 30, 10, 20)).toEqual({ col: 0, cols: 100, rows: 25 });
    expect(heroBox(m, spec(""), 100, 10, 10, 20)).toEqual({ col: 0, cols: 100, rows: 10, crop: { x: 0, y: 0.3, w: 1, h: 0.4 } });
    expect(heroBox(m, spec("[fit::contain]"), 100, 10, 10, 20)).toEqual({ col: 30, cols: 40, rows: 10 });
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
      const m = await ready(f);
      expect([m.width, m.height]).toEqual([1200, 600]);
      expect(brightness(m.mean)).toBe(1);                  // dark already: as it is
      // Ready with its first look made: a box 600 px wide is drawn from the 640 step at once.
      expect(sized(m, 600, 300)!.width).toBe(640);
      // A box 300 px wide is drawn from the 320 step; one 2000 px wide from the image's own 1200 (the 1280 step's).
      await until(() => sized(m, 300, 150)?.width === 320, "the 320 step", 10_000);
      await until(() => sized(m, 2000, 1000)?.width === 1200, "its own size, not bigger", 10_000);
      expect(sized(m, 300, 150)!.png.readUInt32BE(0)).toBe(0x89504e47);
      // The cache names each scaled PNG by the file's content, its step and its look, and leaves no part-written file.
      const names = readdirSync(mediaCache());
      expect(names.some(n => n.startsWith(`${m.key}-320-a`))).toBe(true);
      expect(names.some(n => n.endsWith(".tmp.png"))).toBe(false);
    });
  }

  test("its size is known from its header before it's decoded: its rows are kept while it loads, so nothing moves", async () => {
    await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toFile(file("fresh.jpg"));
    const env: DocEnv = { width: 80, cellW: 10, cellH: 20, graphics: true, maxImageRows: 40, unfold: true };
    const text = `Before\n[img::${file("fresh.jpg")}] [size::40]\nAfter`;
    const loading = renderDoc(text, env);
    expect(media(file("fresh.jpg"), "img")).toMatchObject({ state: "loading", width: 640, height: 480 });
    await ready("fresh.jpg");
    const loaded = renderDoc(text, env);
    expect(loaded.lines.length).toBe(loading.lines.length);
    expect(loaded.lines.findIndex(l => plain(l).includes("After"))).toBe(loading.lines.findIndex(l => plain(l).includes("After")));
    expect(loading.images).toHaveLength(0);
    expect(loaded.images).toHaveLength(1);
  });

  test("a PNG already small enough, and dark, is drawn as it is", async () => {
    const m = await ready("small.png");
    const png = sized(m, 400, 200)!;
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(existsSync(join(mediaCache(), `${png.key}.png`))).toBe(false);
  });

  test("a bright image is dimmed in the same step, never drawn bright first; dim:: says how much instead", async () => {
    const m = await ready("paper.png");
    expect(m.mean).toBeGreaterThan(0.85);
    expect(brightness(m.mean)).toBeCloseTo(MAX_MEAN / m.mean, 1);
    // The first look is already dimmed: no PNG of it at full brightness was ever made.
    expect(await meanOf(sized(m, 600, 340)!.png)).toBeLessThanOrEqual(MAX_MEAN + 0.03);
    expect(sized(m, 600, 340, { dim: 0 })).toBeNull();
    // [dim::0] keeps it as it is; [dim::0.6] draws it at 40%.
    expect(brightness(m.mean, 0)).toBe(1);
    expect(brightness(m.mean, 0.6)).toBe(0.4);
    await until(() => !!sized(m, 600, 340, { dim: 0.6 }), "dim 0.6", 10_000);
    expect(await meanOf(sized(m, 600, 340, { dim: 0.6 })!.png)).toBeCloseTo(m.mean * 0.4, 1);
  });

  test("the cap is measured over the part drawn (a header's crop), a transparent pixel counting as the dark ground", async () => {
    // A white sky over a black field: dark on the whole, bright where a header crops it.
    const sky = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#000"/><rect width="400" height="100" fill="#fff"/></svg>`);
    await sharp(sky).png().toFile(file("sky.png"));
    const m = await ready("sky.png");
    expect(brightness(m.mean)).toBe(1);
    const crop = { x: 0, y: 0, w: 1, h: 0.25 };
    await until(() => !!sized(m, 400, 100, { crop }), "the sky, cropped", 10_000);
    const top = await sharp(sized(m, 400, 100, { crop })!.png).extract({ left: 0, top: 0, width: 400, height: 100 }).png().toBuffer();
    expect(await meanOf(top)).toBeLessThanOrEqual(MAX_MEAN + 0.03);
    // White at 30% opacity shows as a dim grey on the door's ground: not dimmed further.
    await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.3 } } }).png().toFile(file("veil.png"));
    const veil = await ready("veil.png");
    expect(veil.mean).toBeCloseTo(0.3, 1);
    expect(brightness(veil.mean)).toBeGreaterThan(0.95);
  });

  test("a file changed on disk is read again", async () => {
    const m = await ready("small.png");
    await sharp({ create: { width: 300, height: 100, channels: 3, background: { r: 10, g: 60, b: 20 } } }).png().toFile(file("small.png"));
    utimesSync(file("small.png"), new Date(), new Date(Date.now() + 5000));
    await until(() => { const x = media(file("small.png"), "img"); return x.state === "ready" && x.width === 300; }, "the new size", 10_000);
    expect(m.width).toBe(200);
    // The old reading draws nothing any more: never the old picture for the new file.
    expect(sized(m, 400, 200)).toBeNull();
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
  const body = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

  test("full width, at most a third of the pane, cropped to fill; the note under it; its line only a caption", async () => {
    await ready("wide.jpg");
    const s = new NoteSurface(), h = host(true), m = note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\nBeans.`);
    s.show(m as any, h);
    // Its rows are kept dark until the PNG dimmed for the part it shows is ready.
    await until(() => !!s.render(100, 42, h).placements?.length, "the header, scaled", 10_000);
    const v = s.render(100, 42, h);
    const hero = v.placements![0]!;
    // 25 rows tall at the full width, the cap 14: cropped to fill, around its middle.
    expect(hero).toMatchObject({ col: 0, row: 0, cols: 100, rows: 14 });
    expect(hero.crop!.w).toBe(hero.image.width);
    expect(hero.crop!.h / hero.image.height).toBeCloseTo(14 / 25, 1);
    const lines = v.lines.map(plain);
    expect(lines.length).toBeLessThanOrEqual(42);
    expect(lines.slice(0, 14).every(l => !l.trim())).toBe(true);
    expect(lines[14]).toContain("Plot");
    expect(lines.find(l => l.includes("▀ header wide.jpg"))).toContain("[▀ ✓]");
    expect(v.placements).toHaveLength(1);
    // A click on the header makes its image the [ ] position.
    expect(s.click(5, 3, h)).toBe(true);
    // A pane too short for it, or no graphics: the header is drawn where it's written, or only named.
    expect(s.render(100, 12, h).lines.map(plain)[0]).toContain("Plot");
    const off = new NoteSurface(), ho = host(false);
    off.show(m as any, ho);
    expect(off.render(100, 42, ho).lines.map(plain).join("\n")).toContain("▀ header wide.jpg · no Kitty graphics in this terminal · 1200×600");
  });

  test("it scrolls away with the top of the note, and the note still scrolls to its last line", async () => {
    await ready("wide.jpg");
    const s = new NoteSurface(), h = host(true);
    s.show(note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\n${body(60)}`) as any, h);
    await until(() => !!s.render(100, 42, h).placements?.length, "the header, scaled", 10_000);
    const first = s.render(100, 42, h).placements![0]!;
    (s as any).scroll = 4;
    s.render(100, 42, h);
    const sv = s.render(100, 42, h), top = sv.placements![0]!;
    expect(top).toMatchObject({ row: 0, rows: 10 });
    expect(top.crop!.y).toBeGreaterThan(first.crop!.y);
    expect(plain(sv.lines[10]!)).toContain("Plot");
    // Clicks land on the rows drawn: the header's 10 rows are above the title.
    expect(s.sourceLineAt(10 + 5)).not.toBeNull();
    (s as any).scroll = 1e6;
    const end = s.render(100, 42, h).lines.map(plain);
    expect(end[0]).toContain("Plot");
    expect(end.join("\n")).toContain("line 59");
    // A short note scrolls only as far as its last line shows, whatever its length.
    for (let n = 20; n <= 46; n++) {
      const short = new NoteSurface();
      short.show(note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\n${body(n)}`) as any, h);
      short.render(100, 42, h);
      (short as any).scroll = 1e6;
      const sl = short.render(100, 42, h).lines.map(plain);
      expect(sl.join("\n")).toContain(`line ${n - 1}`);
    }
  });

  test("without a reader (a river column, ep0ch show) the header is drawn where it is written, full width", async () => {
    await ready("wide.jpg");
    const env: DocEnv = { width: 80, cellW: 10, cellH: 20, graphics: true, maxImageRows: 8, unfold: true };
    const d = renderDoc(`[img::${file("wide.jpg")}] [layout::hero]`, env);
    expect(d.images[0]).toMatchObject({ col: 0, cols: 80, rows: 8, crop: { x: 0, w: 1 } });
    expect(d.media[0]!.image).toBe(0);
    expect(d.hero).toBeUndefined();
  });
});

describe("the header takes the hero image as it scrolls under (PIE-598)", () => {
  const note = (text: string) => ({ id: "41111111-2222-4333-8444-666666666666", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} });
  const host = (graphics: boolean): SurfaceHost => ({
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cols: 100, rows: 40, cellW: 10, cellH: 20, kitty: graphics }, graphics } as any,
    redraw() {}, navigate() {},
  });
  const body = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  const backdropOf = (v: { placements?: { key: string }[] }) => v.placements?.find(p => p.key.startsWith("hero-backdrop:")) as any;
  const saturation = async (png: Buffer) => { const c = (await sharp(png).stats()).channels; return Math.max(c[0]!.mean, c[1]!.mean, c[2]!.mean) - Math.min(c[0]!.mean, c[1]!.mean, c[2]!.mean); };

  test("hero-focus: a point as fractions or percents; a crop keeps it in view, inside the image", () => {
    expect(parseFocus("0.8,0.25")).toEqual({ x: 0.8, y: 0.25 });
    expect(parseFocus("80%, 25%")).toEqual({ x: 0.8, y: 0.25 });
    expect(parseFocus("2,0")).toBeNull();
    expect(parseFocus("0.5")).toBeNull();
    expect(parseMediaLine("- [img::a.png] [hero-focus::0.9,0.1]")).toMatchObject({ focus: { x: 0.9, y: 0.1 }, problems: [] });
    expect(parseMediaLine("img:: a.png [hero-focus::0.9,0.1]")).toMatchObject({ path: "a.png", focus: { x: 0.9, y: 0.1 } });
    expect(parseMediaLine("[img::a.png] [hero-focus::left]")!.problems).toEqual(["hero-focus::left isn't a point (x,y: 0 to 1, or percents)"]);
    expect(coverCrop({ width: 1000, height: 500 }, 1000, 250, { x: 0.5, y: 0.9 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
    expect(coverCrop({ width: 1000, height: 500 }, 1000, 250, { x: 0.5, y: 0.4 })!.y).toBeCloseTo(0.15, 5);
    expect(coverCrop({ width: 1000, height: 500 }, 500, 500, { x: 0, y: 0.5 })).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });

  test("it comes in by steps as the image goes under", () => {
    expect([0, 0.01, 0.33, 0.34, 0.66, 0.67, 1].map(heroStep)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  test("Kitty: a muted, dimmed crop under the header's text once a first-block image scrolls under it; plain before, and with reader.hero off", async () => {
    await ready("sunset.png");
    const s = new NoteSurface(), h = host(true);
    s.show(note(`Plot\n- [img::${file("sunset.png")}] [size::full]\n\n${body(80)}`) as any, h);
    await until(() => !!s.render(100, 40, h).placements?.length, "the image, scaled", 10_000);
    expect(backdropOf(s.render(100, 40, h))).toBeUndefined();
    expect(s.headerBackdrop().backdrop).toMatchObject({ image: "sunset.png", line: 2, step: 0 });
    // A few rows under: the first step, a third opaque, the ground showing through the rest.
    (s as any).scroll = 3;
    await until(() => backdropOf(s.render(100, 40, h))?.key.includes("o33") ?? false, "the first step, made", 10_000);
    expect(s.headerBackdrop().backdrop).toMatchObject({ step: 1, drawn: "kitty" });
    expect((await sharp(backdropOf(s.render(100, 40, h)).image.png).stats()).channels[3]!.mean).toBeCloseTo(255 / 3, -1);
    (s as any).scroll = 200;
    await until(() => !!backdropOf(s.render(100, 40, h)), "the backdrop, made", 10_000);
    const v = s.render(100, 40, h), b = backdropOf(v);
    // The title, the byline and the crumbs: three rows, the full width, under the text.
    expect(b).toMatchObject({ col: 0, row: 0, cols: 100, rows: 3, z: -2 });
    expect(plain(v.lines[0]!)).toContain("Plot");
    expect(s.headerBackdrop().backdrop).toMatchObject({ step: 3, drawn: "kitty" });
    // Dark and muted: its mean held to HERO_MEAN, most of its colour gone; the original is never changed.
    expect(await meanOf(b.image.png)).toBeLessThanOrEqual(HERO_MEAN + 0.02);
    expect(await saturation(b.image.png)).toBeLessThan(30);
    expect(await meanOf(await Bun.file(file("sunset.png")).bytes().then(x => Buffer.from(x)))).toBeGreaterThan(0.5);
    useHeroHeader({ on: false });
    try {
      expect(backdropOf(s.render(100, 40, h))).toBeUndefined();
      expect(s.headerBackdrop()).toEqual({ backdrop: null, on: false, mode: "first" });
    } finally { useHeroHeader(null); }
  });

  test("a small bright patch on a dark picture is held down too, and a picture's own [dim::…] still darkens it", async () => {
    const m = await ready("moon.png");
    await until(() => !!cellColours(m, 50, 5, { mean: HERO_MEAN, peak: HERO_PEAK, mute: true }), "the grid", 10_000);
    const lum = ([r, g, b]: readonly number[]) => (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    const brightest = (g: readonly (readonly (readonly number[])[])[]) => Math.max(...g.flat().map(lum));
    expect(brightest(cellColours(m, 50, 5, { mean: HERO_MEAN, peak: HERO_PEAK, mute: true })!)).toBeLessThanOrEqual(HERO_PEAK + 0.01);
    const png = await (async () => { let p = null; await until(() => !!(p = sized(m, 500, 50, { mean: HERO_MEAN, peak: HERO_PEAK, mute: true })), "the PNG", 10_000); return p!; })() as { png: Buffer };
    const { data, info } = await sharp(png.png).raw().toBuffer({ resolveWithObject: true });
    let most = 0;
    for (let i = 0; i < data.length; i += info.channels) most = Math.max(most, lum([data[i]!, data[i + 1]!, data[i + 2]!]));
    expect(most).toBeLessThanOrEqual(HERO_PEAK + 0.02);
    // [dim::1] on its line: black, as the picture itself is drawn.
    await until(() => !!cellColours(m, 50, 5, { dim: 1, mean: HERO_MEAN, peak: HERO_PEAK, mute: true }), "the dimmed grid", 10_000);
    expect(brightest(cellColours(m, 50, 5, { dim: 1, mean: HERO_MEAN, peak: HERO_PEAK, mute: true })!)).toBe(0);
  });

  test("follow: each picture takes over as it scrolls under, fading in over the one before (Kitty: a layer above it; cells: mixed over it)", async () => {
    await ready("sunset.png"); await ready("wide.jpg");
    const text = `Plot\n- [img::${file("sunset.png")}] [size::full]\n\n${body(10)}\n\n[img::${file("wide.jpg")}] [size::full]\n\n${body(80)}`;
    // A placement drawn from sunset.png's content (its media key), the first picture.
    const m0Key = (_p: unknown) => (media(file("sunset.png"), "img") as ReadyMedia).key;
    const backdrops = (v: { placements?: { key: string }[] }) => (v.placements ?? []).filter(p => p.key.startsWith("hero-backdrop:")) as any[];
    useHeroHeader({ on: true, mode: "follow" });
    try {
      const s = new NoteSurface(), h = host(true);
      s.show(note(text) as any, h);
      await until(() => !!s.render(100, 40, h).placements?.length && (s as any).drawn.doc.images.length === 2, "the images, read", 10_000);
      const second = (s as any).drawn.doc.images[1];
      // Its first rows under: two layers, the first picture at full under the second at a third.
      (s as any).scroll = second.line + 1;
      await until(() => backdrops(s.render(100, 40, h)).length === 2 && backdrops(s.render(100, 40, h))[1].key.includes("o33"), "the crossfade", 10_000);
      const [under, over] = backdrops(s.render(100, 40, h));
      expect([under.z, over.z]).toEqual([-3, -2]);
      expect(under.key).not.toContain("-o");
      expect(s.headerBackdrop().backdrop).toMatchObject({ image: "wide.jpg", step: 1, mode: "follow", over: "sunset.png", drawn: "kitty" });
      // All the way under: the second alone.
      (s as any).scroll = second.line + second.rows + 1;
      await until(() => backdrops(s.render(100, 40, h)).length === 1, "the second alone", 10_000);
      expect(s.headerBackdrop().backdrop).toMatchObject({ image: "wide.jpg", step: 3 });
      expect(s.headerBackdrop().backdrop!.over).toBeUndefined();
      // A jump straight past a picture not made yet: the one before stays until it's drawn at full, never plain.
      await sharp(file("wide.jpg")).toFile(file("wide-cold.jpg"));
      await ready("wide-cold.jpg");
      const j = new NoteSurface();
      j.show(note(text.replace("wide.jpg", "wide-cold.jpg")) as any, h);
      j.render(100, 40, h);
      (j as any).scroll = second.line + second.rows + 1;
      const first = backdrops(j.render(100, 40, h));
      expect(first.length).toBeGreaterThanOrEqual(1);
      if (first.length === 1) expect(first[0].key).toContain(m0Key(first[0]));
      await until(() => backdrops(j.render(100, 40, h)).length === 1 && j.headerBackdrop().backdrop?.over === undefined, "the new one at full, alone", 10_000);
      // Cells: the header's colours mixed over the first picture's, never the plain ground between them.
      const c = new NoteSurface(), hc = host(false);
      c.show(note(text) as any, hc);
      c.render(100, 40, hc);
      const caption = (c as any).drawn.doc.media[1].row;
      (c as any).scroll = caption + 1;
      await until(() => c.render(100, 40, hc).lines[0]!.includes("\x1b[48;2;") && c.headerBackdrop().backdrop?.drawn === "cells", "the cells crossfade", 10_000);
      expect(c.headerBackdrop().backdrop).toMatchObject({ image: "wide.jpg", step: 1, over: "sunset.png" });
    } finally { useHeroHeader(null); }
    // First mode keeps the hero however far it scrolls.
    const f = new NoteSurface(), hf = host(true);
    f.show(note(text) as any, hf);
    f.render(100, 40, hf);
    (f as any).scroll = 200;
    await until(() => backdropOf(f.render(100, 40, hf)) !== undefined, "the hero", 10_000);
    expect(f.headerBackdrop().backdrop).toMatchObject({ image: "sunset.png", mode: "first" });
  }, 30_000);

  test("Kitty: the header image above the title becomes the backdrop as it scrolls away", async () => {
    await ready("wide.jpg");
    const s = new NoteSurface(), h = host(true);
    s.show(note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero] [hero-focus::0.2,0.5]\n\n${body(60)}`) as any, h);
    await until(() => !!s.render(100, 42, h).placements?.length, "the header, scaled", 10_000);
    expect(backdropOf(s.render(100, 42, h))).toBeUndefined();
    (s as any).scroll = 30;
    await until(() => !!backdropOf(s.render(100, 42, h)), "the backdrop, made", 10_000);
    const v = s.render(100, 42, h), b = backdropOf(v);
    expect(b).toMatchObject({ row: 0, rows: 3, cols: 100 });
    expect(plain(v.lines[0]!)).toContain("Plot");
    // Its crop is the header's box (100 × 3 cells of 10 × 20 px) around the focus, at the left of the picture.
    expect(b.crop.x).toBe(0);
    expect(b.crop.w / b.crop.h).toBeCloseTo((100 * 10) / (3 * 20), 0);
  });

  test("cells: each header cell coloured from the crop, dark, its text on top; a background the line sets wins", async () => {
    const m = await ready("sunset.png");
    await until(() => !!cellColours(m, 10, 2, { mean: HERO_MEAN, mute: true }), "the grid", 10_000);
    const grid = cellColours(m, 10, 2, { mean: HERO_MEAN, mute: true })!;
    expect(grid).toHaveLength(2);
    expect(grid[0]).toHaveLength(10);
    for (const c of grid.flat()) expect(Math.max(...c)).toBeLessThan(80);
    const row = overColours("\x1b[38;2;255;255;255mHi\x1b[0m", 4, [[10, 20, 30], [11, 21, 31], [12, 22, 32], [13, 23, 33]]);
    expect(plain(row)).toBe("Hi  ");
    expect(row).toContain("\x1b[48;2;10;20;30mH");
    expect(row).toContain("\x1b[48;2;13;23;33m ");
    const ruled = overColours("\x1b[48;2;1;2;3mAB\x1b[0mC", 3, [[9, 9, 9], [9, 9, 9], [9, 9, 9]]);
    expect(ruled).toContain("\x1b[48;2;1;2;3mAB");
    expect(ruled).toContain("\x1b[48;2;9;9;9mC");
    // A foreground's own numbers are never read as a background; 49 and a reset among other parameters let one go.
    expect(overColours("\x1b[38;2;40;41;42mA", 1, [[9, 9, 9]])).toContain("\x1b[48;2;9;9;9mA");
    expect(overColours("\x1b[44mA\x1b[49mB", 2, [[9, 9, 9], [8, 8, 8]])).toContain("\x1b[48;2;8;8;8mB");
    expect([backgroundAfter("\x1b[0;31m", true), backgroundAfter("\x1b[1;44m", false), backgroundAfter("\x1b[48;5;17m", false), backgroundAfter("\x1b[58;2;1;2;3m", false), backgroundAfter("\x1b[m", true)]).toEqual([false, true, true, false, false]);
    // In the reader: scrolled past a first-block image's line, the header's rows carry the colours.
    const s = new NoteSurface(), h = host(false);
    s.show(note(`Plot\n- [img::${file("sunset.png")}]\n\n${body(80)}`) as any, h);
    s.render(100, 40, h);
    (s as any).scroll = 10;
    await until(() => s.render(100, 40, h).lines[0]!.includes("\x1b[48;2;"), "the header's colours", 10_000);
    const v = s.render(100, 40, h);
    expect(plain(v.lines[0]!)).toContain("Plot");
    expect(v.lines.slice(0, 3).every(l => l.includes("\x1b[48;2;"))).toBe(true);
    expect(v.lines[4]).not.toContain("\x1b[48;2;");
    expect(s.headerBackdrop().backdrop).toMatchObject({ step: 3, drawn: "cells" });
  });
});
