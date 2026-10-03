// Minimal PNG decoder for the snapshot emulator: 8-bit RGB/RGBA/gray, non-interlaced.
import { inflateSync } from "node:zlib";
export function decodePng(b: Buffer): { w: number; h: number; data: Uint8Array } {
  let o = 8, w = 0, h = 0, ct = 0, depth = 0;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString("ascii", o + 4, o + 8), body = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]!; ct = body[9]!; }
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error(`png depth ${depth} unsupported`);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch]! : 0, up = prev[x]!, c = x >= ch ? prev[x - ch]! : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? up : c) : 0;
      cur[x] = (line[x]! + pred) & 255;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = (y * w + x) * 4;
      if (ch >= 3) { out[d] = cur[s]!; out[d + 1] = cur[s + 1]!; out[d + 2] = cur[s + 2]!; } else { out[d] = out[d + 1] = out[d + 2] = cur[s]!; }
      out[d + 3] = ch === 4 ? cur[s + 3]! : ch === 2 ? cur[s + 1]! : 255;
    }
    prev = cur;
  }
  return { w, h, data: out };
}
