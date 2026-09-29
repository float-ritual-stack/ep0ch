// A terminal mirror: consumes the exact bytes the door writes (cursor moves, SGR colour,
// Kitty upload / place / crop / delete) and can dump the screen as text or composite it
// into a PNG with the VGA font. Used by the snapshot harness and by `ep0ch-door snap`.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { CP437_HIGH } from "./ansi";
import { decodePng } from "./png-decode";
import type { TermInfo } from "./term";
import { encodePng, GLYPH_H, GLYPH_W } from "./vga";

const font = new Uint8Array(readFileSync(new URL("../assets/vga9x16.bin", import.meta.url)));
const toCp437 = new Map<string, number>([...CP437_HIGH].map((c, i) => [c, 128 + i]));
// The VGA font's low glyphs: arrows and triangles the door draws (a tile's link →, the tree's ▸ ▾, a drawer's ⇤).
for (const [c, n] of [["☺", 1], ["♦", 4], ["◆", 4], ["•", 7], ["►", 16], ["▸", 16], ["◄", 17], ["◂", 17], ["↕", 18], ["‼", 19], ["↑", 24], ["↓", 25], ["→", 26], ["←", 27], ["↔", 29], ["▲", 30], ["▼", 31], ["▾", 31], ["⇤", 27], ["⇐", 27], ["⇒", 26], ["⇓", 25], ["⠿", 254], ["▭", 254], ["⌖", 15]] as const) if (!toCp437.has(c)) toCp437.set(c, n);

interface TCell { ch: string; fg: number[]; bg: number[] | null }
export class Mirror {
  constructor(public cols: number, public rows: number) { this.cells = Array.from({ length: rows }, () => this.blankRow()); }
  /** Keep the grid the same size as the terminal. */
  resize(cols: number, rows: number) { if (cols === this.cols && rows === this.rows) return; this.cols = cols; this.rows = rows; this.cells = Array.from({ length: rows }, () => this.blankRow()); }
  cells: TCell[][];
  images = new Map<number, { w: number; h: number; data: Uint8Array }>();
  placements = new Map<string, { id: number; col: number; row: number; c: number; r: number; z: number; cx: number; cy: number; cw: number; ch: number }>();
  x = 0; y = 0; sx = 0; sy = 0; fg = [170, 170, 170]; bg: number[] | null = null;
  private chunks = new Map<number, string>();
  private lastId = 0;
  blankRow(): TCell[] { return Array.from({ length: this.cols }, () => ({ ch: " ", fg: [170, 170, 170], bg: null })); }
  write(s: string) {
    let i = 0;
    while (i < s.length) {
      if (s.startsWith("\x1b_G", i)) {
        const end = s.indexOf("\x1b\\", i);
        this.apc(s.slice(i + 3, end)); i = end + 2; continue;
      }
      if (s.startsWith("\x1b]", i)) {
        // OSC (the clipboard, a title): nothing on screen. Ends at BEL or ST.
        const bel = s.indexOf("\x07", i), st = s.indexOf("\x1b\\", i);
        const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
        i = end < 0 ? s.length : end + (end === st ? 2 : 1); continue;
      }
      if (s[i] === "\x1b") {
        if (s[i + 1] === "7") { this.sx = this.x; this.sy = this.y; i += 2; continue; }
        if (s[i + 1] === "8") { this.x = this.sx; this.y = this.sy; i += 2; continue; }
        const m = s.slice(i).match(/^\x1b\[([\d;?]*)([A-Za-z])/);
        if (m) { this.csi(m[1]!, m[2]!); i += m[0].length; continue; }
        i++; continue;
      }
      const ch = [...s.slice(i, i + 2)][0]!;
      if (this.y < this.rows && this.x < this.cols) this.cells[this.y]![this.x] = { ch, fg: this.fg, bg: this.bg };
      this.x++; i += ch.length;
    }
  }
  csi(p: string, f: string) {
    const n = p.split(";").map(Number);
    if (f === "H") { this.y = (n[0] || 1) - 1; this.x = (n[1] || 1) - 1; }
    else if (f === "K" && this.y < this.rows) {
      // Erase in line: to the right of the cursor (none or 0), to its left (1), or the whole row (2).
      const row = this.cells[this.y]!, blank = this.blankRow();
      const [from, to] = p === "2" ? [0, this.cols] : p === "1" ? [0, this.x + 1] : [this.x, this.cols];
      for (let x = from; x < Math.min(to, this.cols); x++) row[x] = blank[x]!;
    }
    else if (f === "J" && p === "2") this.cells = Array.from({ length: this.rows }, () => this.blankRow());
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
        const bytes = Buffer.from(this.chunks.get(this.lastId)!, "base64");
        if (meta.f === "100") { const d = decodePng(bytes); this.images.set(this.lastId, { w: d.w, h: d.h, data: d.data }); }
        else this.images.set(this.lastId, { w: Number(meta.s), h: Number(meta.v), data: inflateSync(bytes) });
        this.chunks.delete(this.lastId);
      }
    } else if (kv.a === "p") {
      this.placements.set(`${id}:${kv.p}`, { id, col: this.x, row: this.y, c: Number(kv.c), r: Number(kv.r), z: Number(kv.z ?? 0), cx: Number(kv.x ?? 0), cy: Number(kv.y ?? 0), cw: Number(kv.w ?? 0), ch: Number(kv.h ?? 0) });
    } else if (kv.a === "d") {
      if (kv.d === "i") this.placements.delete(`${id}:${kv.p}`);
      if (kv.d === "I") { this.images.delete(id); for (const k of this.placements.keys()) if (k.startsWith(`${id}:`)) this.placements.delete(k); }
    }
  }
  text(): string[] { return this.cells.map(r => r.map(c => c.ch).join("").trimEnd()); }

  snapshot(t: TermInfo): Uint8Array {
    const W = this.cols * t.cellW, H = this.rows * t.cellH;
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
          const o = (dy * W + dx) * 4, al = (img.data[so + 3] ?? 255) / 255;
          px[o] = px[o]! * (1 - al) + img.data[so]! * al; px[o + 1] = px[o + 1]! * (1 - al) + img.data[so + 1]! * al; px[o + 2] = px[o + 2]! * (1 - al) + img.data[so + 2]! * al;
        }
      }
    };
    drawImages(z => z < -1073741824);                         // under cell backgrounds
    this.cells.forEach((row, r) => row.forEach((c, k) => { if (c.bg) fill(k * t.cellW, r * t.cellH, t.cellW, t.cellH, c.bg); }));
    drawImages(z => z >= -1073741824 && z < 0);                // over backgrounds, under text
    this.cells.forEach((row, r) => row.forEach((c, k) => {
      if (c.ch === " " || c.ch === "\u200b") return;
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

