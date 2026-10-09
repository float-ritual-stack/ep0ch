// Text helpers shared by the BBS screens and the desk panes.
import { referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { balanceStyles, balanceTags, C, fg, fgRgb, glyphWidth, graphemes, MARKS, RESET, stripTags, styleMarks, width } from "./style";
import { theme } from "./theme";
import { replacePropertyTokens } from "@ep0ch/outline-core/property-grammar";

// ── what may reach the terminal (PIE-510) ──
// A note's title, an extension's name, a service error: any of them can hold bytes a terminal acts on (an OSC 52
// clipboard write, ESC[2J). `printable` is the one place they are taken out; the canvas and the row writer
// (term.ts rowBytes) apply it at the sink, so a source that forgets still draws nothing but text.
/**
 * A sequence a terminal acts on, taken out whole: a CSI (ESC [ or the 8-bit 0x9b) to its final byte; an OSC,
 * DCS, APC, PM or SOS string (7- or 8-bit) to its terminator, or to the end when it has none; any other ESC
 * with what it introduces.
 */
const ESCAPES = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]?|(?:\x1b[\]P_^X]|[\x90\x98\x9d\x9e\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[ -/]*[0-~]?/g;
const CONTROL_RUNS = /[\x00-\x1f\x7f-\x9f]+/g;
const LINE_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]+/g;
const HAS_CONTROL = /[\x00-\x1f\x7f-\x9f]/;

/**
 * `s` with nothing a terminal would act on: escape sequences gone whole (nothing in their place), and each run of other control
 * characters (C0, DEL, C1) as `sub` (nothing, or a space where words would run together). `lines`: keep
 * line breaks and tabs (a block's body; its reader lays them out).
 */
export function printable(s: unknown, sub = "", { lines = false } = {}): string {
  const t = typeof s === "string" ? s : String(s ?? "");
  if (!HAS_CONTROL.test(t)) return t;
  return t.replace(ESCAPES, "").replace(lines ? LINE_CONTROLS : CONTROL_RUNS, sub);
}

/** The door's own styling: an SGR (colour, bold), the only sequence a drawn line keeps. */
const SGR_PART = /(\x1b\[[\d;:]*m)/;
const UNSAFE = /[\x00-\x1a\x1c-\x1f\x7f-\x9f]|\x1b(?!\[[\d;:]*m)/;
/**
 * A drawn line as it may go to the terminal: its SGR styling kept, every other escape and control taken out.
 * The sink under every screen (term.ts rowBytes) and the canvas (canvas.ts) use it.
 */
export function paintable(line: string): string {
  if (!UNSAFE.test(line)) return line;
  return line.split(SGR_PART).map((part, i) => (i % 2 ? part : printable(part.replaceAll("\t", " ")))).join("");
}

/** How long ago `ms` was, as of `now`: `42s`, `5m`, `3h`, `2d`. */
export const ago = (ms: number, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
export const bbsDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${String(d.getFullYear()).slice(2)} (${p(d.getHours())}:${p(d.getMinutes())})`;
};

/** The first `w` cells of `s` (link tags ride along) and the rest; at least one glyph, so a wrap always moves on. */
function cut(s: string, w: number): [string, string] {
  const gs = graphemes(s);
  let n = 0, i = 0;
  for (; i < gs.length; i++) {
    const gw = glyphWidth(gs[i]!);
    if (n + gw > w && n > 0) break;
    n += gw;
  }
  return [gs.slice(0, i).join(""), gs.slice(i).join("")];
}

/** Cells: link tags and presentation marks (src/style.ts) take none, a wide glyph two. */
const len = (s: string) => Bun.stringWidth(NO_ROOM.test(s) ? stripTags(s).replace(MARKS, "") : s);
/** Stands in for a space that must not break a row (inside a property token) while `wrap` cuts it. */
const HELD = "\uE0FF";
const NO_ROOM = /[\uE000-\uE00A\u{100000}-\u{10FFFD}]/u;

/**
 * One line's rows (for colourBody: wrap's `code`) with each inline code span the wrap cut closed at the row's end and opened again on the next, so
 * colourBody, which colours a row alone, draws both halves as code and no backtick is left showing. A backtick with
 * no closer later in the line is text, left as it is.
 */
function balanceCode(rows: string[]): string[] {
  if (rows.length < 2 || !rows.some(r => r.includes("`"))) return rows;
  const ticks = rows.map(r => r.split("`").length - 1);
  let open = false, after = ticks.reduce((a, b) => a + b, 0);
  return rows.map((r, i) => {
    after -= ticks[i]!;
    let on = open;
    for (const ch of r) if (ch === "`") on = !on;
    const row = (open ? "`" : "") + r;
    open = on && after > 0;
    return open ? row + "`" : row;
  });
}

/**
 * `text` in rows of at most `w` cells. `code`: a body row colourBody will colour, whose code spans the wrap cut are
 * closed and reopened (balanceCode); the backticks it adds are taken out by colourBody, so only its callers ask. A width under 1 (a narrow pane, deep indentation) wraps at 1: `cut` must always make progress. */
export function wrap(text: string, w: number, { code = false }: { code?: boolean } = {}): string[] {
  w = w >= 1 ? Math.floor(w) : 1;
  const out: string[] = [];
  for (const whole of text.split("\n")) {
    if (!whole.length) { out.push(""); continue; }
    // A property token that fits a row is not broken across two: colourBody colours a row alone, so a half of a
    // chip would be drawn as plain text. Its spaces are held as NBSP-like placeholders while the line is cut.
    const raw = whole.includes("::") ? replacePropertyTokens(whole, t => (len(t.raw) <= w ? t.raw.replace(/\s/g, HELD) : t.raw)) : whole;
    // `n`: the line's width so far, kept as words are added (measuring the whole line for each word made a
    // long paragraph's wrap quadratic).
    let line = "", n = 0;
    const rows: string[] = [];
    for (const word of raw.split(/(\s+)/)) {
      const wl = len(word);
      if (n + wl > w && line.trim()) { rows.push(line.trimEnd()); line = word.trimStart(); n = len(line); }
      else { line += word; n += wl; }
      while (n > w) { const [head, tail] = cut(line, w); rows.push(head); line = tail; n = len(line); }
    }
    rows.push(line);
    const held = raw !== whole ? rows.map(r => r.replaceAll(HELD, " ")) : rows;
    out.push(...(code ? balanceCode(held) : held));
  }
  // A link cut by the wrap is closed at each line's end and re-opened on the next, and a bold or italic
  // span carries on, so each row stands alone.
  return balanceStyles(balanceTags(out));
}

/** Colour one body line the way a BBS message reader would: quotes, headings, links, properties. */
/** `literal`: the line is in a literal region (PIE-422), where `[key::value]` is text, not a property. */
export function colourBody(line: string, literal = false): string {
  if (/^#{1,6} /.test(line)) return fg(C.white) + styleMarks(line) + RESET;
  if (/^> ?/.test(line)) return fg(C.lgreen) + styleMarks(line) + RESET;
  if (/^\s*[-*] /.test(line)) line = line.replace(/^(\s*)([-*]) /, `$1${fg(C.lcyan)}∙${fg(C.grey)} `);
  // Property tokens first, on the plain line: their values hold links and brackets the escapes below would confuse.
  if (!literal) line = replacePropertyTokens(line, t => `${fg(C.dark)}[${fg(C.brown)}${t.key}${fg(C.dark)}::${fg(C.yellow)}${t.value}${fg(C.dark)}]${fg(C.grey)}`);
  return fg(C.grey) + line
    .replace(/\[\[([^\]]+)\]\]/g, `${fg(C.lcyan)}[[$1]]${fg(C.grey)}`)
    .replace(/\(\(([0-9a-f-]{8})[0-9a-f-]*\)\)/g, `${fg(C.cyan)}(($1…))${fg(C.grey)}`)
    .replace(/`([^`]+)`/g, `${fg(C.lmagenta)}$1${fg(C.grey)}`)
    // Links already resolved for read mode (src/refs.ts): the title or label, or an unlinked missing target.
    .replace(/\uE000/g, fg(C.lcyan)).replace(/\uE009/g, fgRgb(theme().external)).replace(/\uE002/g, fg(C.brown)).replace(/\uE001/g, fg(C.grey))
    // Inline Markdown (src/inline.ts): bold, italic, strikethrough, as Detail draws them.
    .replace(/[\uE003-\uE008]+/g, m => styleMarks(m)) + RESET;
}

export const rule = (w: number, label = "") => {
  const l = label ? `${fg(C.blue)}──(${fg(C.lcyan)} ${label} ${fg(C.blue)})` : "";
  return fg(C.blue) + l + "─".repeat(Math.max(0, w - width(l))) + RESET;
};

/** A note's id as given: a bare id, or a block reference as written (`((id))`, what a picker prints). */
export const blockIdOf = (s: string) => referencedBlock(s)?.blockId ?? s;

/** A command line as words, split on whitespace (the daily agent's EP0CH_DAILY_AGENT, $EDITOR for ctrl+e). */
export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
