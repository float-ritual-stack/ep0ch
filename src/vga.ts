// Rasterize a cell grid with the 9×16 VGA font lifted from ep0ch.html, and encode PNGs.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { VGA_RGB, type Cell } from "./ansi";

export const GLYPH_W = 9;
export const GLYPH_H = 16;

let font: Uint8Array | null = null;
function bits(): Uint8Array {
  font ??= new Uint8Array(readFileSync(new URL("../assets/vga9x16.bin", import.meta.url)));
  return font;
}

function on(code: number, x: number, y: number): boolean {
  const i = (code * GLYPH_H + y) * GLYPH_W + x;
  return ((bits()[i >> 3]! >> (7 - (i & 7))) & 1) === 1;
}

export interface Rgba { width: number; height: number; data: Uint8Array }

/** Render rows[top..top+rows) × cols[left..left+cols) to RGBA at native 9×16 pixels per cell. */
export function rasterize(grid: Cell[][], left: number, top: number, cols: number, rows: number, opts: { clearBg?: boolean } = {}): Rgba {
  const width = cols * GLYPH_W, height = rows * GLYPH_H;
  const data = new Uint8Array(width * height * 4);
  for (let cy = 0; cy < rows; cy++) {
    const line = grid[top + cy];
    for (let cx = 0; cx < cols; cx++) {
      const cell = line?.[left + cx] ?? { code: 32, fg: 7, bg: 0 };
      const f = VGA_RGB[cell.fg]!, b = VGA_RGB[cell.bg]!;
      for (let gy = 0; gy < GLYPH_H; gy++) {
        let o = ((cy * GLYPH_H + gy) * width + cx * GLYPH_W) * 4;
        for (let gx = 0; gx < GLYPH_W; gx++, o += 4) {
          const ink = on(cell.code, gx, gy);
          const c = ink ? f : b;
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = ink || !opts.clearBg ? 255 : 0;
        }
      }
    }
  }
  return { width, height, data };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (const b of p) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32([head.subarray(4), body]), 0);
  return Buffer.concat([head, body, tail]);
}

export function encodePng(img: Rgba): Buffer {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array()),
  ]);
}

/** Turn an image a quarter clockwise, so text reads top to bottom (CSS vertical-rl). */
export function rotateCW(img: Rgba): Rgba {
  const w = img.height, h = img.width, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * 4, d = (x * w + (w - 1 - y)) * 4;
    data[d] = img.data[s]!; data[d + 1] = img.data[s + 1]!; data[d + 2] = img.data[s + 2]!; data[d + 3] = img.data[s + 3]!;
  }
  return { width: w, height: h, data };
}
