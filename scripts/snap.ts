// Drive the real door against the live outline and snapshot what a Kitty terminal would show.
// A tiny emulator consumes the exact bytes the door writes (cursor moves, SGR colour,
// Kitty upload/place/delete), then composites images + text into a PNG with the VGA font.
//   bun scripts/snap.ts [cells] → out/snap-*.png
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { CP437_HIGH } from "../src/ansi";
import { App } from "../src/app";
import { Logon, MainMenu } from "../src/screens";
import { Desk } from "../src/desk/desk";
import { River } from "../src/river/river";
import { DeliveryBoard } from "../src/desk/delivery";
import { SocketBoard } from "../src/socket";
import type { Key, TermInfo } from "../src/term";
import { encodePng, GLYPH_H, GLYPH_W } from "../src/vga";
import { readFileSync } from "node:fs";

const scenario = process.argv[2] ?? "kitty";
process.env.EP0CH_STATE = "out/state";   // never touch the real desk / river layout
const wide = ["desk", "river", "board", "board2"].includes(scenario);
const COLS = wide ? 200 : 120, ROWS = wide ? 60 : 40;
const kitty = scenario !== "cells";
const font = new Uint8Array(readFileSync(new URL("../assets/vga9x16.bin", import.meta.url)));
const toCp437 = new Map<string, number>([...CP437_HIGH].map((c, i) => [c, 128 + i]));

interface TCell { ch: string; fg: number[]; bg: number[] | null }
class Emu {
  cells: TCell[][] = Array.from({ length: ROWS }, () => this.blankRow());
  images = new Map<number, { w: number; h: number; data: Uint8Array }>();
  placements = new Map<string, { id: number; col: number; row: number; c: number; r: number; z: number; cx: number; cy: number; cw: number; ch: number }>();
  x = 0; y = 0; sx = 0; sy = 0; fg = [170, 170, 170]; bg: number[] | null = null;
  private chunks = new Map<number, string>();
  private lastId = 0;
  blankRow(): TCell[] { return Array.from({ length: COLS }, () => ({ ch: " ", fg: [170, 170, 170], bg: null })); }
  write(s: string) {
    let i = 0;
    while (i < s.length) {
      if (s.startsWith("\x1b_G", i)) {
        const end = s.indexOf("\x1b\\", i);
        this.apc(s.slice(i + 3, end)); i = end + 2; continue;
      }
      if (s[i] === "\x1b") {
        if (s[i + 1] === "7") { this.sx = this.x; this.sy = this.y; i += 2; continue; }
        if (s[i + 1] === "8") { this.x = this.sx; this.y = this.sy; i += 2; continue; }
        const m = s.slice(i).match(/^\x1b\[([\d;?]*)([A-Za-z])/);
        if (m) { this.csi(m[1]!, m[2]!); i += m[0].length; continue; }
        i++; continue;
      }
      const ch = [...s.slice(i, i + 2)][0]!;
      if (this.y < ROWS && this.x < COLS) this.cells[this.y]![this.x] = { ch, fg: this.fg, bg: this.bg };
      this.x++; i += ch.length;
    }
  }
  csi(p: string, f: string) {
    const n = p.split(";").map(Number);
    if (f === "H") { this.y = (n[0] || 1) - 1; this.x = (n[1] || 1) - 1; }
    else if (f === "K" && p === "2") this.cells[this.y] = this.blankRow();
    else if (f === "J" && p === "2") this.cells = Array.from({ length: ROWS }, () => this.blankRow());
    else if (f === "m") {
      for (let k = 0; k < n.length; k++) {
        const v = n[k] || 0;
        if (v === 0) { this.fg = [170, 170, 170]; this.bg = null; }
        else if (v === 38 && n[k + 1] === 2) { this.fg = [n[k + 2]!, n[k + 3]!, n[k + 4]!]; k += 4; }
        else if (v === 48 && n[k + 1] === 2) { this.bg = [n[k + 2]!, n[k + 3]!, n[k + 4]!]; k += 4; }
      }
    }
  }
  apc(body: string) {
    const [ctl, payload = ""] = body.split(";");
    const kv = Object.fromEntries(ctl!.split(",").map(p => p.split("=")));
    const id = Number(kv.i ?? this.lastId);
    if (kv.a === "t" || (!kv.a && this.chunks.has(this.lastId))) {
      if (kv.a === "t") { this.lastId = id; this.chunks.set(id, ""); (this as any)[`meta${id}`] = kv; }
      this.chunks.set(this.lastId, this.chunks.get(this.lastId)! + payload);
      if (kv.m === "0") {
        const meta = (this as any)[`meta${this.lastId}`];
        const raw = inflateSync(Buffer.from(this.chunks.get(this.lastId)!, "base64"));
        this.images.set(this.lastId, { w: Number(meta.s), h: Number(meta.v), data: raw });
        this.chunks.delete(this.lastId);
      }
    } else if (kv.a === "p") {
      this.placements.set(`${id}:${kv.p}`, { id, col: this.x, row: this.y, c: Number(kv.c), r: Number(kv.r), z: Number(kv.z ?? 0), cx: Number(kv.x ?? 0), cy: Number(kv.y ?? 0), cw: Number(kv.w ?? 0), ch: Number(kv.h ?? 0) });
    } else if (kv.a === "d") {
      if (kv.d === "i") this.placements.delete(`${id}:${kv.p}`);
      if (kv.d === "I") { this.images.delete(id); for (const k of this.placements.keys()) if (k.startsWith(`${id}:`)) this.placements.delete(k); }
    }
  }
  snapshot(t: TermInfo): Uint8Array {
    const W = COLS * t.cellW, H = ROWS * t.cellH;
    const px = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { px[i * 4 + 3] = 255; }
    const fill = (x0: number, y0: number, w: number, h: number, c: number[]) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const o = (y * W + x) * 4; px[o] = c[0]!; px[o + 1] = c[1]!; px[o + 2] = c[2]!; }
    };
    const drawImages = (pred: (z: number) => boolean) => {
      for (const p of [...this.placements.values()].filter(p => pred(p.z)).sort((a, b) => a.z - b.z)) {
        const img = this.images.get(p.id); if (!img) continue;
        const bw = p.c * t.cellW, bh = p.r * t.cellH;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          const cw = p.cw || img.w, chh = p.ch || img.h;
          const sx = p.cx + Math.floor((x / bw) * cw), sy = p.cy + Math.floor((y / bh) * chh);
          const so = (sy * img.w + sx) * 4, dx = p.col * t.cellW + x, dy = p.row * t.cellH + y;
          if (dx >= W || dy >= H) continue;
          const o = (dy * W + dx) * 4; px[o] = img.data[so]!; px[o + 1] = img.data[so + 1]!; px[o + 2] = img.data[so + 2]!;
        }
      }
    };
    drawImages(z => z < -1073741824);                         // under cell backgrounds
    this.cells.forEach((row, r) => row.forEach((c, k) => { if (c.bg) fill(k * t.cellW, r * t.cellH, t.cellW, t.cellH, c.bg); }));
    drawImages(z => z >= -1073741824 && z < 0);                // over backgrounds, under text
    this.cells.forEach((row, r) => row.forEach((c, k) => {
      if (c.ch === " ") return;
      const code = c.ch.charCodeAt(0) < 128 ? c.ch.charCodeAt(0) : toCp437.get(c.ch) ?? 63;
      for (let gy = 0; gy < GLYPH_H; gy++) for (let gx = 0; gx < GLYPH_W; gx++) {
        const bit = (code * GLYPH_H + gy) * GLYPH_W + gx;
        if (((font[bit >> 3]! >> (7 - (bit & 7))) & 1) === 0) continue;
        const o = ((r * t.cellH + gy) * W + k * t.cellW + gx) * 4;
        px[o] = c.fg[0]!; px[o + 1] = c.fg[1]!; px[o + 2] = c.fg[2]!;
      }
    }));
    drawImages(z => z >= 0);
    return encodePng({ width: W, height: H, data: px });
  }
}

const emu = new Emu();
let keyFn: (k: Key) => void = () => {};
let last: string[] = [];
const fakeTerm = {
  info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty } as TermInfo,
  write: (s: string) => { bytes += s.length; emu.write(s); },
  paint(lines: string[]) { lines.forEach((l, r) => { if (last[r] !== l) this.write(`\x1b[${r + 1};1H\x1b[0m\x1b[2K${l}\x1b[0m`); }); last = lines; },
  invalidate() { last = []; },
  onKey(fn: (k: Key) => void) { keyFn = fn; },
  onResize() {},
};
let bytes = 0;
const board = new SocketBoard();
const info = await board.info();
const app = new App(fakeTerm as any, board, Date.now() - 6 * 3600_000, () => {});
app.host = info.host; app.workspace = info.workspace;
mkdirSync("out", { recursive: true });
const tag = scenario;
const snap = async (name: string, wait = 600) => {
  await Bun.sleep(wait);
  app.redraw();
  writeFileSync(`out/snap-${tag}-${name}.png`, emu.snapshot(fakeTerm.info));
  console.log(`${name}: ${bytes} bytes written so far, ${emu.placements.size} placement(s), ${emu.images.size} image(s)`);
};
const press = (k: Key) => keyFn(k);
const ch = (c: string) => press({ kind: "char", ch: c });

if (scenario === "board2") {
  const mouse = (action: "down" | "up" | "drag", x: number, y: number) => press({ kind: "mouse", action, button: 0, x, y });
  app.push(new MainMenu()); app.push(new DeliveryBoard());
  await Bun.sleep(6000);
  press({ kind: "right" }); press({ kind: "right" }); press({ kind: "right" }); ch("c");   // collapse Review
  press({ kind: "left" }); press({ kind: "left" }); press({ kind: "left" });
  press({ kind: "down" }); press({ kind: "enter" }); await Bun.sleep(1500);
  mouse("down", 60, 25); mouse("drag", 60, 18); mouse("up", 60, 18);          // drag the lanes/readers border up
  await snap("1-collapsed-resized", 1500);
  ch("o"); await Bun.sleep(300);                                               // pop the detail out as a float
  mouse("down", 70, 7); mouse("drag", 110, 4); mouse("up", 110, 4);            // drag it by its title
  await snap("2-float", 1000);
  press({ kind: "esc" }); ch("S");                                             // outline drawer on the right
  press({ kind: "down" }); press({ kind: "down" });
  await snap("3-tree-right", 3000);
  press({ kind: "esc" }); ch("b");
  press({ kind: "down" });
  await snap("4-backlink-preview", 5000);
  board.close(); process.exit(0);
}
if (scenario === "board") {
  app.push(new MainMenu()); app.push(new DeliveryBoard());
  await snap("1-lanes", 6000);
  press({ kind: "down" }); press({ kind: "down" });
  await snap("2-preview", 2000);
  press({ kind: "enter" }); await Bun.sleep(1500);
  press({ kind: "tab" });   // detail → lanes
  press({ kind: "right" }); press({ kind: "alt-enter" });
  await snap("3-two-details", 2500);
  ch("b");
  await snap("4-backlinks", 4000);
  press({ kind: "esc" }); ch("t");
  await snap("5-tree-drawer", 3000);
  board.close(); process.exit(0);
}
if (scenario === "river") {
  app.push(new MainMenu()); app.push(new River());
  await snap("1-library", 3000);
  press({ kind: "enter" });                         // Pi Outliner Workboard beside Library
  await snap("2-opened", 3000);
  press({ kind: "down" }); press({ kind: "down" }); press({ kind: "down" }); ch(" ");   // replies in place
  await snap("3-thread", 3000);
  press({ kind: "enter" }); await Bun.sleep(2500);
  press({ kind: "enter" }); await Bun.sleep(2500);
  await snap("4-compressed", 1500);
  ch("/"); for (const c of "PIE-367") ch(c);
  await snap("5-palette", 12000);
  press({ kind: "enter" });
  await snap("6-jumped", 3000);
  board.close(); process.exit(0);
}
if (scenario === "desk") {
  app.push(new MainMenu()); app.push(new Desk());
  await snap("1-open", 4000);
  press({ kind: "down" }); press({ kind: "down" }); press({ kind: "right" });
  await snap("2-expanded", 3000);
  press({ kind: "tab" }); press({ kind: "tab" });
  await snap("3-thread-focus", 1500);
  press({ kind: "char", ch: "w", ctrl: true }); ch("o"); ch("b");
  await snap("4-added-art", 1500);
  press({ kind: "char", ch: "w", ctrl: true }); ch("L");
  await snap("5-docked-right", 800);
  ch("/"); for (const c of "PIE-367") ch(c);
  await snap("6-search", 3500);
  press({ kind: "enter" });
  await snap("7-after-search", 3000);
  board.close(); process.exit(0);
}
app.push(new Logon(app));
await snap("1-logon", 3000);
press({ kind: "enter" });
await snap("2-menu");
ch("N"); await snap("3-newscan", 1500);
press({ kind: "enter" }); await snap("4-reader", 1500);
ch("q"); ch("q");
ch("W"); await snap("5-who", 1500); ch("q");
ch("L"); await snap("6-lastcallers", 2000); ch("q");
ch("F"); await snap("7-files", 800);
press({ kind: "down" }); press({ kind: "down" }); press({ kind: "enter" });
await snap("8-viewer", 2500);
ch("q"); ch("q");
ch("S"); await snap("9-stats", 2500); ch("q");
await snap("10-menu-again", 200);
board.close();
process.exit(0);
