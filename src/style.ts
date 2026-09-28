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

// ── link tags: where a rendered link is, carried through wrapping, padding and colour (PIE-415) ──
// A link drawn in a reader is bracketed by an open tag naming it (its index in the renderer's link list)
// and a close tag. They take no room (width, wrap and pad skip them) and extractLinks turns them into
// cell ranges before the lines are drawn. Plane 16's private use area: nothing a note holds lives there.
const TAG0 = 0x100000, TAG_END = 0x10fffd;
export const TAGS = /[\u{100000}-\u{10FFFD}]/gu;
const HAS_TAG = /[\u{100000}-\u{10FFFD}]/u;
export const linkTag = (n: number) => String.fromCodePoint(TAG0 + n);
export const LINK_END = String.fromCodePoint(TAG_END);
export const stripTags = (s: string) => s.replace(TAGS, "");
const isTag = (ch: string) => { const c = ch.codePointAt(0)!; return c >= TAG0 && c <= TAG_END; };

export const visible = (s: string) => s.replace(ANSI_RE, "").replace(TAGS, "");
export const width = (s: string) => [...visible(s)].length;

/** Where a link is on screen: row `line`, columns `from` (inclusive) to `to` (exclusive), link `n`. */
export interface LinkRange { line: number; from: number; to: number; n: number }

/**
 * Tagged lines to plain ones plus where each link landed, in visible columns. A link whose text wraps
 * stays open onto the next line, so every piece of it is the same target.
 */
export function extractLinks(lines: readonly string[]): { lines: string[]; ranges: LinkRange[] } {
  const ranges: LinkRange[] = [];
  let open = -1;
  const out = lines.map((l, line) => {
    if (open < 0 && !HAS_TAG.test(l)) return l;
    let col = 0, from = 0, text = "";
    const end = () => { if (open >= 0 && col > from) ranges.push({ line, from, to: col, n: open }); };
    for (const part of l.split(/(\x1b\[[\d;]*m)/)) {
      if (part.startsWith("\x1b[")) { text += part; continue; }
      for (const ch of part) {
        if (!isTag(ch)) { text += ch; col++; continue; }
        end();
        open = ch.codePointAt(0) === TAG_END ? -1 : ch.codePointAt(0)! - TAG0;
        from = col;
      }
    }
    end();
    return text;
  });
  return { lines: out, ranges };
}

export function pad(s: string, w: number): string {
  const n = width(s);
  if (n <= w) return s + " ".repeat(w - n);
  let out = "", seen = 0;
  const parts = s.split(/(\x1b\[[\d;]*m)/);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]!;
    if (part.startsWith("\x1b[")) { out += part; continue; }
    const chars = [...part];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      if (isTag(ch)) { out += ch; continue; }
      // Cut here; link tags past the cut still close what they opened.
      if (seen >= w - 1) return out + "…" + RESET + tagsIn([...chars.slice(i), ...parts.slice(p + 1)].join(""));
      out += ch; seen++;
    }
  }
  return out;
}
const tagsIn = (rest: string) => rest.match(TAGS)?.join("") ?? "";

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

