// The themes (src/theme.ts) on real screens: every (text, background) pair the door actually draws, read off the
// terminal mirror after each screen paints, is checked against WCAG 2 contrast. calm and night must keep every
// text cell at 4.5:1 or more and their brightest text under a cap (calm 15:1, night 10:1); classic is reported,
// never failed (it is the exact VGA palette, kept as it was). Border and rule glyphs (box drawing, block
// elements) are allowed lower: they're lines, not words. And the art is the same in every theme, byte for byte.
// A scratch service with the showcase outline (fictional notes) only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, type Screen } from "../src/app";
import type { Msg } from "../src/board";
import { Mirror } from "../src/mirror";
import { artNamed } from "../src/packs";
import { VGA_RGB } from "../src/ansi";
import { readFileSync } from "node:fs";
import { chip, CHIP_MAX_LUMINANCE } from "../src/style";
import { MainMenu, MENU_SCREENS } from "../src/screens";
import { SEED } from "../src/showcase/seed";
import { SocketBoard, type Actor } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { rowBytes, type Key } from "../src/term";
import { contrast, groundSeq, luminance, setTheme, THEME_NAMES, THEMES, type Rgb, type ThemeName } from "../src/theme";
import { outliner, Scratch, until } from "./scratch";

/** The glyphs that draw lines and areas, not words: box drawing (U+2500-257F) and block elements (U+2580-259F). */
const BORDER = /^[\u2500-\u259f]$/u;
/**
 * Rules drawn with text glyphs in the frame colour (`C.blue`): the logos' dotted frame (canvas.ts DOTTED_BOX, `. :`)
 * and the welcome tabs' rail (`[= … =]`). Lines, not words.
 */
const RULE = /^[.:=[\]]$/;
const isBorder = (ch: string, fg: Rgb, t: ThemeName) => BORDER.test(ch) || (RULE.test(ch) && fg.join() === THEMES[t].palette[1]!.join());
/** Each theme's limits for text: the lowest a word may read at, and the brightest text may be. classic: none. */
const LIMITS: Record<ThemeName, { min: number; max: number } | null> = { calm: { min: 4.5, max: 15 }, night: { min: 4.5, max: 10 }, classic: null };

interface Pair { fg: Rgb; bg: Rgb; ratio: number; text: string; where: string }

/** Every text and border cell the mirror shows, with its colours (an uncoloured cell sits on the ground). */
function pairsOf(m: Mirror, where: string, theme: ThemeName): { text: Pair[]; border: Pair[] } {
  const text: Pair[] = [], border: Pair[] = [];
  m.cells.forEach((row, y) => row.forEach(c => {
    if (!c.ch || c.ch === " " || c.ch === "\u200b") return;
    const { fg, bg } = m.colours(c);
    const p: Pair = { fg: fg as unknown as Rgb, bg: bg as unknown as Rgb, ratio: contrast(fg as unknown as Rgb, bg as unknown as Rgb), text: row.map(x => x.ch).join("").trim().slice(0, 60), where: `${where} row ${y}` };
    (isBorder(c.ch, p.fg, theme) ? border : text).push(p);
  }));
  return { text, border };
}

describe.skipIf(!outliner)("the themes on real screens (WCAG 2 contrast)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let reading: Msg;
  const found = new Map<ThemeName, { text: Pair[]; border: Pair[] }>();

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    const seeded = await scratch.seedShowcase();
    // A welcome note, so the welcome screen has something to show; and a note with links, a comment and an
    // agent's proposal for the reader.
    const user: Actor = { kind: "user" };
    await board.createBlock(null, `Start here [welcome::1]\nThe house board is [[${SEED.hub}]]; the bikes are in [[${SEED.shed}]].`, user);
    const plan = await board.createBlock(null, `Weekend plan\nThe peas   climb  the net, by [[${SEED.shed}]].\n\nSee ((${seeded.notes.recipe.id}|the soup)).`, user);
    const read = (await board.get(plan.id))!;
    const observed = "The peas   climb  the net", start = read.text.indexOf(observed);
    await board.update(plan.id, read.text.replace("Weekend plan", "Weekend plan, revised"), read.revision!);
    await board.request("draft.patch", {
      blockId: plan.id, revision: read.revision, mutation: { author: "agent", actorId: "tidy" },
      patches: [{ observed, replacement: "The peas climb the net", range: { start, end: start + observed.length }, unit: "utf16", before: read.text.slice(0, start), after: read.text.slice(start + observed.length, start + observed.length + 20) }],
    });
    reading = (await board.get(seeded.notes.shed.id))!;
    for (const name of THEME_NAMES) found.set(name, await collect(name, [reading, (await board.get(plan.id))!]));
    setTheme("calm");
  }, 240_000);

  afterAll(async () => { setTheme("calm"); board?.close(); await scratch.dispose(); });

  /** A door in `name` over a mirror: the main menu and every screen the menu opens, then a reader, each painted. */
  async function collect(name: ThemeName, notes: Msg[]) {
    setTheme(name);
    const cols = 160, rows = 48;
    const mirror = new Mirror(cols, rows);
    let last: string[] = [];
    const term = {
      info: { cols, rows, cellW: 9, cellH: 16, kitty: true },
      write: (s: string) => mirror.write(s),
      paint(lines: string[]) { lines.forEach((l, r) => { if (last[r] !== l) mirror.write(rowBytes(r, l, cols)); }); last = lines; },
      invalidate() { last = []; }, onKey() {}, onResize() {}, stop() {}, resume() {},
    };
    const app = new App(term as any, board, Date.now(), () => {});
    const A = app as any;
    const out = { text: [] as Pair[], border: [] as Pair[] };
    const look = async (where: string) => {
      // Painted until it holds still: what a screen reads from the service comes in over a few frames.
      let was = "";
      for (let i = 0; i < 40; i++) {
        await Bun.sleep(i < 3 ? 120 : 60);
        A.paint();
        const now = mirror.text().join("\n");
        if (now === was && i >= 2) break;
        was = now;
      }
      const p = pairsOf(mirror, `${name} ${where}`, name);
      out.text.push(...p.text); out.border.push(...p.border);
    };
    A.stack.push(new MainMenu());
    await look("main menu");
    for (const [key, open] of MENU_SCREENS) {
      if ("G!BJLWF".includes(key)) continue;      // goodbye and the shell end things; the art viewer is art; the rest are lists like N's
      const s = open(app) as Screen | null;
      if (!s) continue;
      app.push(s);
      await look(`menu ${key} (${s.title})`);
      // The screens with lanes, tiles and columns: once more with the keys moved (a selection, the focus on another tile).
      if ("DKQC".includes(key)) for (const k of ["tab", "down"] as const) { A.key({ kind: k } as Key); await look(`menu ${key} (${s.title}) after ${k}`); }
      try { s.dispose?.(); } catch { /* gone */ }
      A.stack.splice(1);
    }
    app.quit();
    // A reader: links, comment marks, a proposal's controls, the reading ruler on an element, a selection.
    for (const m of notes) {
      const surface = new NoteSurface();
      const host: SurfaceHost = { ctx: { board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} };
      surface.show(m, host);
      const page = new Mirror(110, 40);
      page.write(groundSeq());
      const draw = () => surface.render(110, 40, host).lines.forEach((l, r) => page.write(rowBytes(r, l, 110)));
      await until(() => { draw(); return surface.describeElements().length > 0; }, "the reader's elements", 10_000).catch(() => {});
      await Bun.sleep(300); draw();
      for (const k of [{ kind: "char", ch: "]" }, { kind: "char", ch: "]" }, { kind: "char", ch: "v" }, { kind: "char", ch: "j" }] as Key[]) {
        surface.key(k, host); draw();
        const p = pairsOf(page, `${name} reader ${m.text.split("\n")[0]} after ${JSON.stringify(k)}`, name);
        out.text.push(...p.text); out.border.push(...p.border);
      }
    }
    return out;
  }

  test("calm and night: every text cell reads at 4.5:1 or more, and nothing is brighter than the theme's cap", () => {
    for (const name of ["calm", "night"] as const) {
      const { text } = found.get(name)!, lim = LIMITS[name]!;
      expect(text.length).toBeGreaterThan(2000);
      // What was drawn reached the bars, a selection, the reading ruler and an embed's band, not only the ground.
      const backs = new Set(text.map(p => p.bg.join()));
      const t = THEMES[name];
      for (const c of [t.palette[1]!, t.tint.select, t.tint.ruler, t.tint.embed]) expect(backs).toContain(c.join());
      const low = text.filter(p => p.ratio < lim.min), high = text.filter(p => p.ratio > lim.max);
      const say = (ps: Pair[]) => [...new Map(ps.map(p => [`${p.fg}|${p.bg}`, `${p.ratio.toFixed(2)} ${p.fg} on ${p.bg}: ${p.where}: ${p.text}`])).values()];
      expect(say(low)).toEqual([]);
      expect(say(high)).toEqual([]);
    }
  });

  test("the numbers, for the README and for classic (reported, not failed)", () => {
    for (const name of THEME_NAMES) {
      const { text, border } = found.get(name)!;
      const ratios = text.map(p => p.ratio).sort((a, b) => a - b);
      const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))]!.toFixed(2);
      const under = text.filter(p => p.ratio < 4.5).length;
      console.log(`  ${name}: ${text.length} text cells · lowest ${q(0)} · 5% ${q(0.05)} · median ${q(0.5)} · highest ${q(1)} · under 4.5:1: ${under} (${((100 * under) / text.length).toFixed(1)}%) · ${border.length} border cells, lowest ${border.length ? Math.min(...border.map(p => p.ratio)).toFixed(2) : "-"}`);
    }
    const bgs = new Map<string, number>();
    for (const p of found.get("calm")!.text) bgs.set(p.bg.join(), (bgs.get(p.bg.join()) ?? 0) + 1);
    console.log(`  calm backgrounds under text: ${[...bgs].map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
    // classic keeps the VGA palette exactly.
    expect(THEMES.classic.palette.map(c => c.join(","))).toContain("85,85,85");
  });
});

describe("the palettes themselves (every background, not only the ones these screens drew)", () => {
  const TEXT = [7, 8, 9, 10, 11, 12, 13, 14, 15];   // grey, dark and the light accents: drawn as words on anything
  const STATUS = [2, 3, 4, 5, 6];                   // green, cyan, red, magenta, brown: words on the ground, and chips under text
  for (const name of ["calm", "night"] as const) {
    test(`${name}: words read at 4.5:1 on the ground, the bars and every tint; body text and the brightest within the theme's range`, () => {
      const t = THEMES[name], lim = LIMITS[name]!, ground = t.ground!;
      const backs: [string, Rgb][] = [["ground", ground], ["bar", t.palette[1]!], ...Object.entries(t.tint) as [string, Rgb][]];
      const low: string[] = [];
      for (const i of TEXT) for (const [b, c] of backs) if (contrast(t.palette[i]!, c) < lim.min) low.push(`${i} on ${b}: ${contrast(t.palette[i]!, c).toFixed(2)}`);
      for (const i of STATUS) if (contrast(t.palette[i]!, ground) < lim.min) low.push(`${i} on the ground: ${contrast(t.palette[i]!, ground).toFixed(2)}`);
      expect(low).toEqual([]);
      for (const i of [...TEXT, ...STATUS]) expect(contrast(t.palette[i]!, ground)).toBeLessThanOrEqual(lim.max);
      // Body text (grey): calm 11-13:1 and at least 7:1 on the bars; night lower, under its cap.
      if (name === "calm") {
        expect(contrast(t.palette[7]!, ground)).toBeGreaterThanOrEqual(11);
        expect(contrast(t.palette[7]!, t.palette[1]!)).toBeGreaterThanOrEqual(7);
      }
      // Dim text stays dimmer than body text, so it still reads as dim.
      expect(contrast(t.palette[8]!, ground)).toBeLessThan(contrast(t.palette[7]!, ground) - 2);
      // A chip's text is chosen to read: whatever it asks for, on any palette colour it is drawn on.
      setTheme(name);
      try {
        for (const back of [1, 2, 3, 4, 5, 6, 8, 11, 14]) for (const want of [0, 15]) {
          const [f, b] = [...chip(back, want).matchAll(/\x1b\[[34]8;2;(\d+);(\d+);(\d+)m/g)].map(m => [1, 2, 3].map(k => Number(m[k])) as unknown as Rgb).reverse();
          expect(contrast(f!, b!)).toBeGreaterThanOrEqual(4.5);
        }
      } finally { setTheme("calm"); }
    });
  }
  test("all three are dark: no theme's ground, bars or tints is light", () => {
    for (const t of Object.values(THEMES)) for (const c of [t.ground ?? [0, 0, 0], t.palette[0]!, t.palette[1]!, ...Object.values(t.tint)] as Rgb[]) expect(contrast(c, [0, 0, 0])).toBeLessThan(3);
  });
  test("no light surface: a chip on a light colour is that colour's text on a dark tint, and no screen paints a light background", () => {
    for (const name of ["calm", "night"] as const) {
      setTheme(name);
      try {
        for (let back = 0; back < 16; back++) for (const want of [0, 15]) {
          const b = [...chip(back, want).matchAll(/\x1b\[48;2;(\d+);(\d+);(\d+)m/g)].map(m => [1, 2, 3].map(k => Number(m[k])) as unknown as Rgb)[0]!;
          expect(luminance(b)).toBeLessThanOrEqual(CHIP_MAX_LUMINANCE);
        }
      } finally { setTheme("calm"); }
    }
    // A background in a light palette colour, drawn straight (not through chip): only the one-cell text cursor.
    const CURSOR = new Set(["src/edit.ts", "src/surface/props-panel.ts"]);
    const light = /bg\(C\.(dark|grey|white|yellow|lcyan|lgreen|lred|lmagenta|lblue)\)/;
    const found: string[] = [];
    for (const f of new Bun.Glob("src/**/*.ts").scanSync(".")) {
      if (CURSOR.has(f)) continue;
      readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (light.test(l)) found.push(`${f}:${i + 1}`); });
    }
    expect(found).toEqual([]);
  });
  test("classic is the VGA palette, exactly", () => {
    expect(THEMES.classic.palette).toBe(VGA_RGB);
    expect(THEMES.classic.ground).toBeNull();
  });
});

describe("the art keeps true VGA in every theme", () => {
  test("the main menu's art: the same cells (cells mode) and the same image (Kitty) whichever theme", async () => {
    const shots = new Map<ThemeName, { cells: string; images: string[] }>();
    for (const name of THEME_NAMES) {
      setTheme(name);
      const art: string[] = [], images: string[] = [];
      for (const kitty of [false, true]) {
        const mirror = new Mirror(120, 40);
        let last: string[] = [];
        const term = {
          info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty },
          write: (s: string) => mirror.write(s),
          paint(lines: string[]) { lines.forEach((l, r) => { if (last[r] !== l) mirror.write(rowBytes(r, l, 120)); }); last = lines; },
          invalidate() { last = []; }, onKey() {}, onResize() {}, stop() {}, resume() {},
        };
        const app = new App(term as any, {} as SocketBoard, Date.now(), () => {});
        if (!kitty) app.video = "cells";
        (app as any).stack.push(new MainMenu());
        (app as any).paint();
        // The art's rows: everything above the key line, but the slots' live text (UI text, drawn in the theme).
        if (!kitty) for (const row of mirror.cells.slice(0, artNamed("SHY-EMNU.ANS")!.rows.length)) art.push(row.map(c => (c.bg === null && c.ch === " " ? " " : `${c.ch}${c.fg}/${c.bg}`)).join(""));
        else for (const img of mirror.images.values()) if (img.w > 400) images.push(`${img.w}x${img.h}:${Bun.hash(img.data)}`);
        app.quit();
      }
      shots.set(name, { cells: art.join("\n"), images });
    }
    setTheme("calm");
    const classic = shots.get("classic")!;
    expect(classic.images.length).toBeGreaterThan(0);
    for (const name of ["calm", "night"] as const) {
      expect(shots.get(name)!.images).toEqual(classic.images);
      expect(shots.get(name)!.cells).toEqual(classic.cells);
    }
  });
});
