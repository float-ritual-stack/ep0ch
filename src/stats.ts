// Activity heatmap: 7 days × 24 hours. Pixels under Kitty, shade glyphs otherwise.
import type { Placement } from "./kitty";
import { fg, RESET } from "./style";
import { theme } from "./theme";
import type { TermInfo } from "./term";
import type { Rgba } from "./vga";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// black → blue → cyan → white, the ramp every VGA plasma effect used, in the theme's colours.
function ramp(v: number): [number, number, number] {
  const t = theme(), p = t.palette;
  const RAMP = [t.heatLow, p[1]!, p[3]!, p[11]!, p[15]!];
  const x = Math.max(0, Math.min(1, v)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = RAMP[i]!, b = RAMP[i + 1]!;
  return [0, 1, 2].map(k => Math.round(a[k]! + (b[k]! - a[k]!) * f)) as [number, number, number];
}

export function buckets(times: number[]): number[][] {
  const grid = DAYS.map(() => new Array(24).fill(0) as number[]);
  for (const t of times) { const d = new Date(t); grid[d.getDay()]![d.getHours()]!++; }
  return grid;
}

export function heatmap(times: number[], t: TermInfo, graphics: boolean, at: { col: number; row: number }) {
  const grid = buckets(times);
  const max = Math.max(1, ...grid.flat());
  const hourWidth = Math.max(1, Math.min(4, Math.floor((t.cols - 10) / 24)));
  const labels = DAYS;
  if (!graphics) {
    const shades = [" ", "░", "▒", "▓", "█"];
    const lines = grid.map(row => row.map(n => {
      const v = Math.sqrt(n / max);
      const [r, g, b] = ramp(v);
      return `\x1b[38;2;${r};${g};${b}m${shades[Math.min(4, Math.ceil(v * 4))]!.repeat(hourWidth)}`;
    }).join("") + RESET);
    return { lines, labels, placements: [] as Placement[], hourWidth };
  }
  // One bucket = hourWidth cells × 1 row, rendered at real pixel size with a 1px gutter.
  const cw = t.cellW * hourWidth, ch = t.cellH;
  const width = cw * 24, height = ch * 7;
  const data = new Uint8Array(width * height * 4);
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const [r, g, b] = ramp(Math.sqrt(grid[d]![h]! / max));
    for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
      const o = ((d * ch + y) * width + h * cw + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  const image: Rgba = { width, height, data };
  return {
    lines: grid.map(() => fg(0) + " ".repeat(24 * hourWidth) + RESET),
    labels,
    placements: [{ key: "heatmap", image, col: at.col, row: at.row, cols: 24 * hourWidth, rows: 7, z: -1 }],
    hourWidth,
  };
}
