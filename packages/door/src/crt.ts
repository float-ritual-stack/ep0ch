// A CRT under the text: scanlines and a phosphor bloom drawn *below* the cells (z < 0),
// so every glyph above stays real, crisp, selectable terminal text.
import type { Placement } from "./kitty";
import type { TermInfo } from "./term";
import { theme } from "./theme";
import type { Rgba } from "./vga";

let cache: { key: string; img: Rgba } | null = null;

/** The tube in the theme's colours: its dark base, and the bloom added in the middle (classic: a blue glow). */
export function crtImage(pixelHeight: number, width = 96, { base, bloom: glow } = theme().crt): Rgba {
  const h = Math.max(2, pixelHeight);
  const data = new Uint8Array(width * h * 4);
  for (let y = 0; y < h; y++) {
    const ny = (y / (h - 1)) * 2 - 1;
    const scan = y % 3 === 2 ? 0.35 : 1;          // one dark line in three
    for (let x = 0; x < width; x++) {
      const nx = (x / (width - 1)) * 2 - 1;
      const r2 = nx * nx * 0.7 + ny * ny;
      const bloom = Math.max(0, 1 - r2) ** 1.6;     // brightest in the middle of the tube
      const o = (y * width + x) * 4;
      data[o] = Math.round(base[0] + glow[0] * bloom * scan);
      data[o + 1] = Math.round(base[1] + glow[1] * bloom * scan);
      data[o + 2] = Math.round(base[2] + glow[2] * bloom * scan);
      data[o + 3] = 255;
    }
  }
  return { width, height: h, data };
}

/** One placement covering the screen above the status bar; the narrow image is stretched sideways only. */
export function crtUnderlay(t: TermInfo): Placement {
  const rows = t.rows - 1;
  const key = `${rows}x${t.cellH}:${theme().name}`;
  if (cache?.key !== key) cache = { key, img: crtImage(rows * t.cellH) };
  return { key: "crt", image: cache.img, col: 0, row: 0, cols: t.cols, rows, z: -1073741830 };
}
