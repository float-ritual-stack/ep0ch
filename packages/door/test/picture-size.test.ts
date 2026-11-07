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
  const twins = `Beds\n\n\`\`\`svg\n${A}\n\`\`\`\n\n\`\`\`svg\n${A}\n\`\`\``;
  const fakeBoard = (h: SurfaceHost, now: () => Msg, saved: string[]) => {
    (h.ctx.board as any).get = async () => now();
    (h.ctx.board as any).update = async (_: string, text: string, revision: number) => { saved.push(text); return { ...note(text), revision: revision + 1 }; };
  };

  test("a resize drawn before another picture went in above lands on the same twin", async () => {
    const { s, h } = await reader(twins);
    const saved: string[] = [];
    // Someone puts a fence above: the line drawn for the second twin is now the first twin, reading exactly the same.
    const moved = `Beds\n\n\`\`\`svg\n${svg("#512")}\n\`\`\`\n\n\`\`\`svg\n${A}\n\`\`\`\n\n\`\`\`svg\n${A}\n\`\`\``;
    fakeBoard(h, () => ({ ...note(moved), revision: 3 }), saved);
    await s.changeImage(s.imagesIn(note(twins))[1]!, { height: "12" }, "height 12 rows", h, { kind: "user" } as any);
    expect(saved).toHaveLength(1);
    const fences = saved[0]!.split("\n").filter(l => l.startsWith("```svg"));
    expect(fences).toEqual(["```svg", "```svg", "```svg height=12"]);
  });

  test("the twins resize one at a time: a resize leaves the other twin who it is", async () => {
    const { s, h } = await reader(twins);
    const saved: string[] = [];
    let now = twins;
    (h.ctx.board as any).get = async () => ({ ...note(now), revision: 2 + saved.length });
    (h.ctx.board as any).update = async (_: string, text: string) => { now = text; saved.push(text); return { ...note(text), revision: 2 + saved.length }; };
    const [first, second] = s.imagesIn(note(twins));
    await s.changeImage(second!, { height: "12" }, "height 12 rows", h, { kind: "user" } as any);
    await s.changeImage(first!, { height: "8" }, "height 8 rows", h, { kind: "user" } as any);
    await s.changeImage(second!, { height: "14" }, "height 14 rows", h, { kind: "user" } as any);
    expect(now.split("\n").filter(l => l.startsWith("```svg"))).toEqual(["```svg height=8", "```svg height=14"]);
  });

  test("a twin that went in while the door hadn't redrawn: said, nothing written (which twin is it now?)", async () => {
    const { s, h } = await reader(twins);
    const saved: string[] = [];
    fakeBoard(h, () => ({ ...note(`${twins}\n\n\`\`\`svg\n${A}\n\`\`\``), revision: 3 }), saved);
    await expect(s.changeImage(s.imagesIn(note(twins))[1]!, { height: "12" }, "height 12 rows", h, { kind: "user" } as any)).rejects.toThrow(/changed since it was drawn/);
    expect(saved).toEqual([]);
  });

  test("an undo follows its picture past an insert above it", async () => {
    const { s, h } = await reader(twins);
    let now = twins, revision = 2;
    (h.ctx.board as any).get = async () => ({ ...note(now), revision });
    (h.ctx.board as any).update = async (_: string, text: string) => { now = text; revision += 1; return { ...note(text), revision }; };
    await s.changeImage(s.imagesIn(note(twins))[1]!, { height: "12" }, "height 12 rows", h, { kind: "user" } as any);
    now = `First\n\n\`\`\`svg\n${svg("#512")}\n\`\`\`\n\n${now}`; revision += 1;
    await s.undoImage(h, { kind: "user" } as any);
    expect(now.split("\n").filter(l => l.startsWith("```svg"))).toEqual(["```svg", "```svg", "```svg"]);
  });
});

describe("one step, stopping at the full fit (PIE-1584)", () => {
  const live = async (text: string, w = 90) => {
    const r = await reader(text, w);
    const saved: string[] = [];
    (r.h.ctx.board as any).get = async () => note(text);
    (r.h.ctx.board as any).update = async (_: string, t: string) => { saved.push(t); return { ...note(t), revision: 3 }; };
    return { ...r, saved };
  };
  const USER = { kind: "user" } as any;

  test("[+] at the fit goes to the full width (PIE-1630), and at the full width says so and leaves the source alone", async () => {
    for (let w = 86; w <= 92; w++) {
      const { s, h, v, saved } = await live(fenced("svg height=24"), w);
      const p = v.placements![0]!, d = (s as any).drawn;
      if (d.w - d.bx - (s as any).bxRight - d.mcols !== 87) continue;
      expect(p.rows).toBe(24);
      await s.act("image.size", { n: 1, by: 1 }, h, USER);
      expect(saved[0]).toContain("```svg size=full\n");
      const full = await live(fenced("svg size=full"), w);
      said.length = 0;
      await expect(full.s.act("image.size", { n: 1, by: 1 }, full.h, USER)).rejects.toThrow(/the full width already/);
      expect(full.saved).toEqual([]);
      expect(said.at(-1)).toMatch(/the full width already/);
      return;
    }
    throw new Error("no width gave a body of 87 columns");
  });

  test("[-] from the fit steps down from what's drawn", async () => {
    const { s, h, saved } = await live(fenced("svg height=24"));
    await s.act("image.size", { n: 1, by: -1 }, h, USER);
    expect(saved[0]).toContain("```svg height=22");
  });

  test("an [img::] line held by the most rows (200): [+] that changes nothing stops too", async () => {
    const tall = `Beds\n\n[img::${dir}/tall.svg] [size::50%]\n\nafter`;
    await Bun.write(`${dir}/tall.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="4000"><rect width="400" height="4000" fill="#123"/></svg>`);
    const { s, h, saved } = await live(tall);
    await expect(s.act("image.size", { n: 1, by: 1 }, h, USER)).rejects.toThrow(/as big as it gets/);
    expect(saved).toEqual([]);
  });
});

describe("the same words read everywhere", () => {
  const USER = { kind: "user" } as any;
  test("to= on a fence writes size=, and that size is what draws (PIE-1584 said it was dead: it isn't)", async () => {
    const { s, h } = await reader(fenced("svg"));
    const saved: string[] = [];
    (h.ctx.board as any).get = async () => note(fenced("svg"));
    (h.ctx.board as any).update = async (_: string, t: string) => { saved.push(t); return { ...note(t), revision: 3 }; };
    await s.act("image.size", { n: 1, to: "26" }, h, USER);
    expect(saved[0]).toContain("```svg size=26");
    const { v } = await reader(saved[0]!);
    expect(v.placements![0]).toMatchObject({ cols: 26, rows: 7 });
  });

  test("a digest draws a fence as the reader does, and its [+] names it by who it is", async () => {
    const small = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90" viewBox="0 0 360 90"><rect width="360" height="90" fill="#123"/></svg>`;
    const text = `Beds\n\n\`\`\`svg\n${small}\n\`\`\`\n\n\`\`\`svg\n${small}\n\`\`\``;
    const { s, h, v } = await reader(text);
    const body = new NoteSurface();
    body.show(note(text), h);
    body.digest(note(text), 90, h);
    for (let i = 0; i < 100 && (body as any).digested.doc.images.length < 2; i++) { await Bun.sleep(20); body.digest(note(text), 90, h); }
    expect((body as any).digested.doc.images.map((i: { cols: number }) => i.cols)).toEqual([v.placements![0]!.cols, v.placements![1]!.cols]);
    const ids = s.imagesIn(note(text)).map(x => x.id);
    const links = (body as any).elems.flatMap((e: any) => e.link?.image ? [e.link.image.id] : []);
    expect(links).toEqual(ids);
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

// PIE-1630: [+] fills the width, a caption says the size drawn (in the reader and in an edit's preview), a narrow
// picture has no band round it, and what librsvg can't draw is named. Made-up SVGs: a 1600×1000 spread, an arc of text.
describe("as big as asked, and said truly (PIE-1630)", () => {
  const USER = { kind: "user" } as any;
  const spread = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000"><rect width="1600" height="1000" fill="#1a2233"/><text x="80" y="200" font-family="monospace" font-size="90" fill="#9ab">THE SPREAD</text></svg>`;
  const arc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 350"><defs><path id="curve" d="M35 250Q350 100 665 250"/></defs><rect width="700" height="350" fill="#20242c"/><text font-size="25" fill="#ccd"><textPath href="#curve" startOffset="50%">Words along a curve</textPath></text></svg>`;

  test("unsized it's held by the reader's rows; [+] steps on past them to the full width", async () => {
    const text = fenced("svg", spread);
    const { s, h, v } = await reader(text, 160);
    const d = (s as any).drawn, body = d.w - d.bx - (s as any).bxRight - d.mcols, p = v.placements![0]!;
    expect(p.cols).toBeLessThan(body);
    let now = text;
    (h.ctx.board as any).get = async () => note(now);
    (h.ctx.board as any).update = async (_: string, t: string) => { now = t; return { ...note(t), revision: 3 }; };
    for (let i = 0; i < 20 && !now.includes("size=full"); i++) { await s.act("image.size", { n: 1, by: 1 }, h, USER); s.show(note(now), h); s.render(160, 60, h); }
    expect(now).toContain("```svg size=full\n");
    const { v: full } = await reader(now, 160);
    expect(full.placements![0]!.cols).toBe(body);
    expect(full.placements![0]!.rows).toBeGreaterThan(60 * 0.8);
  });

  test("the caption's rows are the rows drawn, in the reader and in an edit's preview, with what's wrong kept", async () => {
    const text = fenced("svg height=800", spread);
    const { v } = await reader(text, 120);
    const p = v.placements![0]!, said = captions(v.lines)[0]!;
    expect(said).toContain(`${p.rows} rows · full width (200 asked)`);
    expect(said).toContain("⚠ height=800 is past the most, 200 rows");
    expect(said).not.toContain("drawn at");
    // The edit's preview (snippetDoc, pictures on): its own narrower drawing, its caption saying that drawing's rows.
    const s = new NoteSurface(), h = host();
    s.show(note(text), h);
    let preview = s.snippetDoc(text, 44, h, [], true);
    for (let i = 0; i < 200 && !preview.images.length; i++) { await Bun.sleep(20); preview = s.snippetDoc(text, 44, h, [], true); }
    const shown = captions(preview.lines)[0]!;
    expect(shown).toContain(`${preview.images[0]!.rows} rows`);
    expect(shown).toContain("⚠");
  });

  test("text on a curve is named as librsvg's limit, on the caption", async () => {
    const { v } = await reader(fenced("svg", arc), 160);
    expect(captions(v.lines)[0]).toContain("text on a path (<textPath>) isn't drawn");
  });

  test("the band round a narrow picture is a thin bar on the edge, the rest of its rows the ground", async () => {
    const { s, h } = await reader(fenced("svg size=25%", spread), 120);
    const pic = (s as any).elems.find((e: any) => e.link?.image);
    (s as any).cur = pic.key;
    const v = s.render(120, 60, h), p = v.placements![0]!;
    const { RULER_BG } = await import("../src/surface/selection");
    const ink = RULER_BG.replace("\x1b[48;", "\x1b[38;");
    for (let r = p.row; r < p.row + p.rows; r++) {
      expect(v.lines[r]).not.toContain(RULER_BG);
      expect(v.lines[r]).toContain(ink + "▎");
    }
    // The caption's row, the element's own, still carries the band.
    expect(v.lines[p.row + p.rows]).toContain(RULER_BG);
  });
});
