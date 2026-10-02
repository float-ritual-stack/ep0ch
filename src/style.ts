// Palette styling for real terminal text, plus width-safe padding. Every UI colour comes through the active
// theme (src/theme.ts); ANSI art keeps true VGA (artLines).
import { glyph, VGA_RGB, type Cell } from "./ansi";
import { contrast, luminance, theme, type Rgb, type Theme } from "./theme";

const rgb = (i: number) => theme().palette[i & 15]!.join(";");
export const fg = (i: number) => `\x1b[38;2;${rgb(i)}m`;
export const bg = (i: number) => `\x1b[48;2;${rgb(i)}m`;
/** A colour that isn't a palette entry, as text or as a background. */
export const fgRgb = (c: Rgb) => `\x1b[38;2;${c.join(";")}m`;
export const bgRgb = (c: Rgb) => `\x1b[48;2;${c.join(";")}m`;
/** One of the theme's tints as a background: a selection, an agent's, the ruler, a thread, an embed, an idle row. */
export const tint = (name: keyof Theme["tint"]) => bgRgb(theme().tint[name]);
/**
 * A list's selected row, its background and text: white on the palette's blue while the list has the keys, on the
 * idle tint (`idleRow` for a search's or the backlinks' rows) while it doesn't.
 */
export const selected = (keys = true, idle: "idle" | "idleRow" = "idle") => (keys ? bg(C.blue) : tint(idle)) + fg(C.white);
/** A chip lighter than this (relative luminance) would be a bright patch: calm and night draw it as coloured text instead. */
export const CHIP_MAX_LUMINANCE = 0.3;
/**
 * A chip: `text` on a palette background. Where the theme keeps chips legible (calm, night): a light background
 * (yellow, light cyan) is never a bright patch, the chip is drawn as that colour's text on the idle tint; and when
 * `text` reads under 4.5:1 on the chip, the ground or white is drawn instead, whichever reads better. Classic draws
 * what was asked.
 */
export function chip(back: number, text: number = C.white): string {
  const t = theme();
  const b = t.palette[back & 15]!;
  let f = t.palette[text & 15]!;
  if (t.legibleChips && luminance(b) > CHIP_MAX_LUMINANCE) return bgRgb(t.tint.idle) + fgRgb(b);
  if (t.legibleChips && contrast(f, b) < 4.5) {
    const light = t.palette[C.white]!, dark = t.palette[C.black]!;
    f = contrast(light, b) >= contrast(dark, b) ? light : dark;
  }
  return bgRgb(b) + fgRgb(f);
}
export const RESET = "\x1b[0m";
/** Bold on and off, leaving the colour as it is. */
export const BOLD = "\x1b[1m", UNBOLD = "\x1b[22m";
/** Text in the quiet colour (a hint, a count, what's secondary). */
export const dim = (s: string) => fg(C.dark) + s + RESET;
/**
 * A sparkline's steps, lowest to highest, in glyphs the kitty+crt font has: it is CP437, which has no ▁▂▃▅▆▇
 * (they drew as ?, as ↳ and ⌕ did before #81). A shade ramp, the BBS way, over an underscore for the lowest.
 */
export const SPARK_STEPS = "_░▒▓█";
/** The cursor at the end of a line being typed (a search, a filter, a layout's name): CP437 has no ▁, and _ reads as typed. */
export const INPUT_CURSOR = "▌";

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

// ── presentation marks: a link's colour (src/refs.ts) and inline Markdown styles (src/inline.ts) ──
// Placed in read-mode text before it's wrapped, turned into colour and SGR styles after (colourBody), so
// a bold span or a link that wraps keeps its style on every row. Like link tags they take no room.
/** Every presentation mark: U+E000-U+E002 a link's colour, U+E003-U+E008 bold, italic and strike on/off. */
export const MARKS = /[\uE000-\uE008]/g;
export const stripMarks = (s: string) => s.replace(MARKS, "");
/** Inline Markdown style marks, on and off, as Detail's styles: strong, emphasis, strikethrough. */
export const STYLE = { bold: ["\uE003", "\uE004"], italic: ["\uE005", "\uE006"], strike: ["\uE007", "\uE008"] } as const;
const SGR: Record<string, string> = { "\uE003": "\x1b[1m", "\uE004": "\x1b[22m", "\uE005": "\x1b[3m", "\uE006": "\x1b[23m", "\uE007": "\x1b[9m", "\uE008": "\x1b[29m" };
/**
 * Style marks as SGR. `bold: false` keeps the text's own weight (a heading, already bold), so a strong span
 * inside it doesn't switch the rest of the heading off.
 */
export function styleMarks(s: string, { bold = true } = {}): string {
  return s.replace(/[\uE003-\uE008]/g, m => (!bold && (m === "\uE003" || m === "\uE004") ? "" : SGR[m]!));
}
/**
 * Rows cut from one marked text, each standing alone: a style still on at the end of a row is switched on
 * again at the start of the next (each row is drawn, and reset, by itself). Link colours are redone by
 * balanceTags' tags and by colourBody per row, so only the style marks are carried.
 */
export function balanceStyles(lines: string[]): string[] {
  const on = new Set<string>();
  const OFF: Record<string, string> = { "\uE004": "\uE003", "\uE006": "\uE005", "\uE008": "\uE007" };
  return lines.map(l => {
    const head = [...on].join("");
    for (const ch of l) { if (ch === "\uE003" || ch === "\uE005" || ch === "\uE007") on.add(ch); else if (OFF[ch]) on.delete(OFF[ch]!); }
    return head + l;
  });
}

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

export const visible = (s: string) => s.replace(ANSI_RE, "").replace(TAGS, "").replace(MARKS, "");

// ── terminal cells (PIE-510) ──
// A terminal lays text out in cells, not code points: a CJK character or an emoji takes two, a combining mark
// or a joiner none, and a joined emoji (👩‍💻) is one glyph. Everything the door measures, pads or cuts goes
// by cells, through `width` and `graphemes`, so a wide note title can't push a row past the screen's edge.
/** How many terminal cells `s` takes once drawn (its colour codes, link tags and marks take none). */
export const width = (s: string) => Bun.stringWidth(visible(s));
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Characters one cell wide that never join a neighbour: a run of them is one glyph per code point. */
const SIMPLE = /^[\x20-\x7e\xa0-\u02ff\u2010-\u205e\u2190-\u22ff\u2500-\u25fc]*$/;
/** `s` as the glyphs a terminal draws (grapheme clusters), plain text with no colour codes. */
export const graphemes = (s: string): string[] => (SIMPLE.test(s) ? [...s] : Array.from(SEGMENTER.segment(s), g => g.segment));
/** One glyph's cells: 0 for a link tag, a mark or a lone zero-width character, 2 for a wide one. */
export const glyphWidth = (g: string) => (isTag(g) || (g >= "\uE000" && g <= "\uE008") ? 0 : g.length === 1 && g < "\x7f" ? 1 : Bun.stringWidth(g));

/** Where a link is on screen: row `line`, columns `from` (inclusive) to `to` (exclusive), link `n`. */
export interface LinkRange { line: number; from: number; to: number; n: number }

/**
 * Tagged lines to plain ones plus where each link landed, in visible columns. Every row stands alone:
 * a link that wraps is closed at the end of one row and re-opened at the start of the next (wrap and
 * balanceTags do that), so a tag never carries into a neighbouring table cell, a border or the next row.
 */
export function extractLinks(lines: readonly string[]): { lines: string[]; ranges: LinkRange[] } {
  const ranges: LinkRange[] = [];
  const out = lines.map((l, line) => {
    if (!HAS_TAG.test(l)) return l;
    let col = 0, from = 0, text = "", open = -1;
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

/**
 * Lines cut from one tagged text, each made to stand alone: a link still open at the end of a line is
 * closed there and re-opened at the start of the next, after whatever indent or frame the caller adds.
 */
export function balanceTags(lines: string[]): string[] {
  let open = -1;
  return lines.map(l => {
    if (open < 0 && !HAS_TAG.test(l)) return l;
    const head = open >= 0 ? linkTag(open) : "";
    for (const ch of l) if (isTag(ch)) open = ch.codePointAt(0) === TAG_END ? -1 : ch.codePointAt(0)! - TAG0;
    return head + l + (open >= 0 ? LINK_END : "");
  });
}

/**
 * `s` (plain text and link tags, no colour) split after `n` visible characters, by code point, so a tag
 * (a surrogate pair) is never split. A link open at the cut is closed in the head and re-opened in the
 * tail; a tag that opens right at the cut goes with the tail, one that closes there with the head.
 */
export function splitVisible(s: string, n: number): [string, string] {
  const chars = [...s];
  let seen = 0, open = -1, i = 0;
  for (; i < chars.length; i++) {
    const ch = chars[i]!;
    if (isTag(ch)) {
      const end = ch.codePointAt(0) === TAG_END;
      if (seen >= n && !end) break;
      open = end ? -1 : ch.codePointAt(0)! - TAG0;
      continue;
    }
    if (seen >= n) break;
    seen++;
  }
  const head = chars.slice(0, i).join(""), tail = chars.slice(i).join("");
  if (open < 0) return [head, tail];
  return [head + LINK_END, tail ? linkTag(open) + tail : ""];
}

/** `trim` that sees through the link tags at either end (`\u{100000}  plan` → `\u{100000}plan`). */
export const trimTagged = (s: string) => s.trim().replace(/^([\u{100000}-\u{10FFFD}]*)\s+/u, "$1").replace(/\s+([\u{100000}-\u{10FFFD}]*)$/u, "$1");

/** `s` in exactly `w` cells: padded with spaces, or cut with `…` (never through a wide glyph or a joined one). */
export function pad(s: string, w: number): string {
  const n = width(s);
  if (n <= w) return s + " ".repeat(w - n);
  let out = "", seen = 0;
  const parts = s.split(/(\x1b\[[\d;]*m)/);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]!;
    if (part.startsWith("\x1b[")) { out += part; continue; }
    const gs = graphemes(part);
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i]!, gw = glyphWidth(g);
      if (!gw) { out += g; continue; }
      // Cut here; link tags past the cut still close what they opened. A wide glyph that would end past the
      // cut leaves a space instead.
      if (seen + gw > w - 1) return out + " ".repeat(Math.max(0, w - 1 - seen)) + "…" + RESET + tagsIn([...gs.slice(i), ...parts.slice(p + 1)].join(""));
      out += g; seen += gw;
    }
  }
  return out;
}

/** `s` cut to `w` cells, ending in `…`, when it's wider; never padded, never through a wide or joined glyph. */
export const ellipsize = (s: string, w: number): string => (width(s) <= w ? s : w < 1 ? "" : headOf(s, w - 1) + "…");

/**
 * The first `n` cells of a styled string, its colour codes kept, never half a wide glyph. Its link tags and
 * marks ride along.
 */
export function headOf(s: string, n: number): string {
  let out = "", seen = 0;
  for (const part of s.split(/(\x1b\[[\d;?]*[A-Za-z])/)) {
    if (part.startsWith("\x1b[")) { out += part; continue; }
    for (const g of graphemes(part)) {
      const gw = glyphWidth(g);
      if (seen + gw > n) return out;
      out += g; seen += gw;
    }
  }
  return out;
}

/**
 * A styled string after its first `n` cells: the colours in effect at the cut are set again first, and a wide
 * glyph the cut goes through leaves a space. `headOf(s, n) + other + tailFrom(s, n + w)` lays `other`
 * (`w` cells) over `s`.
 */
export function tailFrom(s: string, n: number): string {
  let out = "", seen = 0, state = "";
  for (const part of s.split(/(\x1b\[[\d;?]*[A-Za-z])/)) {
    if (part.startsWith("\x1b[")) {
      if (seen >= n) out += part;
      else if (part.endsWith("m")) state = part === RESET || part === "\x1b[m" ? "" : state + part;
      continue;
    }
    for (const g of graphemes(part)) {
      if (seen >= n) { out += g; continue; }
      seen += glyphWidth(g);
      if (seen > n) out += " ".repeat(seen - n);
    }
  }
  return state + out;
}

/**
 * A hint (a row of key parts joined by " · ") cut to `w` cells: between parts, never inside a key's, ending
 * with `more` (a "? more" chip, or a plain " …"). When even the first part is too wide it's cut at its last
 * space that fits. `at`: the cell where `more` starts, so a click on it can be found. Short enough: as it is.
 */
export function fitHint(s: string, w: number, more = ` ${fg(C.dark)}…`): { text: string; at: number; cut: boolean } {
  if (width(s) <= w) return { text: s, at: -1, cut: false };
  const room = Math.max(0, w - width(more));
  const gs = graphemes(visible(s));
  let col = 0, part = -1, space = -1;
  for (let i = 0; i < gs.length && col <= room; i++) {
    if (gs[i] === " " && gs[i + 1] === "·" && gs[i + 2] === " ") part = col;
    else if (gs[i] === " " && col > 0) space = col;
    col += glyphWidth(gs[i]!);
  }
  const at = part > 0 ? part : space > 0 ? space : room;
  return { text: headOf(s, at) + RESET + more + RESET, at, cut: true };
}
const tagsIn = (rest: string) => rest.match(TAGS)?.join("") ?? "";

export const center = (s: string, w: number) => " ".repeat(Math.max(0, Math.floor((w - width(s)) / 2))) + s;

/** Art as coloured terminal cells: the no-graphics fallback, and what cells mode shows. Always true VGA, whatever the theme. */
export function artLines(grid: Cell[][], left: number, top: number, cols: number, rows: number): string[] {
  const out: string[] = [];
  for (let r = top; r < top + rows; r++) {
    const line = grid[r];
    if (!line) { out.push(""); continue; }
    let s = "", last = "";
    for (let c = left; c < Math.min(line.length, left + cols); c++) {
      const cell = line[c]!;
      const sgr = `\x1b[38;2;${VGA_RGB[cell.fg & 15]!.join(";")}m\x1b[48;2;${VGA_RGB[cell.bg & 15]!.join(";")}m`;
      if (sgr !== last) { s += sgr; last = sgr; }
      s += glyph(cell.code);
    }
    out.push(s + RESET);
  }
  return out;
}

