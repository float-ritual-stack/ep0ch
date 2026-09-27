// VGA-palette styling for real terminal text, plus width-safe padding.
import { glyph, VGA_RGB, type Cell } from "./ansi";

const rgb = (i: number) => VGA_RGB[i]!.join(";");
export const fg = (i: number) => `\x1b[38;2;${rgb(i)}m`;
export const bg = (i: number) => `\x1b[48;2;${rgb(i)}m`;
export const RESET = "\x1b[0m";

// Palette names, BBS style: the numbers artists typed as |07 or \x1b[1;36m.
export const C = {
  black: 0, blue: 1, green: 2, cyan: 3, red: 4, magenta: 5, brown: 6, grey: 7,
  dark: 8, lblue: 9, lgreen: 10, lcyan: 11, lred: 12, lmagenta: 13, yellow: 14, white: 15,
} as const;

/** `paint("|11[|15N|11]|07ew scan")`: pipe codes, the way PCBoard/Renegade menus were written. */
export function paint(s: string): string {
  return s.replace(/\|(\d\d)/g, (_, n) => fg(Number(n) & 15)) + RESET;
}

const ANSI_RE = /\x1b\[[\d;]*m/g;
export const visible = (s: string) => s.replace(ANSI_RE, "");
export const width = (s: string) => [...visible(s)].length;

export function pad(s: string, w: number): string {
  const n = width(s);
  if (n <= w) return s + " ".repeat(w - n);
  let out = "", seen = 0;
  for (const part of s.split(/(\x1b\[[\d;]*m)/)) {
    if (part.startsWith("\x1b[")) { out += part; continue; }
    for (const ch of part) { if (seen >= w - 1) return out + "…" + RESET; out += ch; seen++; }
  }
  return out;
}

export const center = (s: string, w: number) => " ".repeat(Math.max(0, Math.floor((w - width(s)) / 2))) + s;

/** Art as coloured terminal cells: the no-graphics fallback, and what cells mode shows. */
export function artLines(grid: Cell[][], left: number, top: number, cols: number, rows: number): string[] {
  const out: string[] = [];
  for (let r = top; r < top + rows; r++) {
    const line = grid[r];
    if (!line) { out.push(""); continue; }
    let s = "", last = "";
    for (let c = left; c < Math.min(line.length, left + cols); c++) {
      const cell = line[c]!;
      const sgr = fg(cell.fg) + bg(cell.bg);
      if (sgr !== last) { s += sgr; last = sgr; }
      s += glyph(cell.code);
    }
    out.push(s + RESET);
  }
  return out;
}

