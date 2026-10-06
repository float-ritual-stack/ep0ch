// The Markdown a figure's rows can be written in (the ideas of mdxcn.dev's figures, none of its code): the lines of a
// `::graph-*` block after its `---` YAML, or the figure block's child bullets. One reading for every client, so the
// door's figures and the outliner's Detail agree on what a row says. Pure: no I/O.
//
//   **bold**        now, chosen, the accent row            *italic* / _italic_   next, rejected, receding
//   - label: value  a row (the label is everything before the first `: `)
//   x — note        a muted side note (an em dash between spaces)
//   a → b → c       a path (`->` too)
//   ok*40           a run of 40 in any list of values (`0 1 4 2 0*3`)
//   - [x] / - [ ]   a row that is done or not
//
// A figure's YAML stays its data form: when both give the same field, the YAML's wins (each kind says which fields
// its Markdown gives).

import { closesCodeFence, codeFenceOpen } from "./code-fence";

/** How a row is marked: bold (now, chosen, the accent) or italic (next, rejected, receding). */
export type FigureEmphasis = "strong" | "em" | null;

/** One row: a list item, or a child bullet's title. */
export interface FigureRow {
  /** Its line in the lines read (a child's: 0). */
  line: number;
  /** How deep its bullet is indented, in list levels (two spaces or a tab a level). */
  depth: number;
  /** Its number in an ordered list (`1.`), or null for a bullet. */
  ordinal: number | null;
  /** `[x]` true, `[ ]` false, no box null. */
  done: boolean | null;
  /** What it says, without its bullet, box, emphasis markers or side note. */
  text: string;
  /** Before the first `: `, or null when it has none. */
  label: string | null;
  /** After the first `: ` (the whole text when it has no label). */
  value: string;
  /** Bold or italic: the whole row, its label or its value written so. */
  emphasis: FigureEmphasis;
  /** After ` — `: a muted side note. */
  note: string | null;
  /** `a → b → c` (or `->`) in its value: the steps, or null. */
  path: string[] | null;
  /** Its value as a list (split on spaces and commas), each `x*n` run spelled out. */
  values: string[];
}

/** A fenced code block in the lines: its language and lines, and the line it opens on. */
export interface FigureFence { lang: string; lines: string[]; line: number }

/** What a figure's Markdown holds: its rows, its paragraphs (text that isn't a list item) and its fenced code. */
export interface FigureMarkdown { rows: FigureRow[]; paragraphs: string[]; fences: FigureFence[] }

/** The most a run spells out (`ok*1000000` is a typo, not a year of days). */
export const MAX_RUN = 1000;

const ITEM = /^([ \t]*)(?:([-*+])|(\d+)[.)])[ \t]+(.*)$/;
const BOX = /^\[([ xX])\][ \t]+/;
const NOTE = / — /;
const PATH = /\s*(?:→|->)\s*/;
const RUN = /^(.+?)\*(\d+)$/;

/** `s` without one pair of `**…**` (strong) or `*…*` / `_…_` (em) around all of it, and which it was. */
export function unwrapEmphasis(s: string): { text: string; emphasis: FigureEmphasis } {
  const t = s.trim();
  // One pair around all of it: `**a** and **b**` is two spans, not one.
  const strong = /^(\*\*|__)(?!\s)(.+?)(?<!\s)\1$/.exec(t);
  if (strong && !strong[2]!.includes(strong[1]!)) return { text: strong[2]!, emphasis: "strong" };
  const em = /^([*_])(?![*_\s])(.+?)(?<![\s*_])\1$/.exec(t);
  if (em && !em[2]!.includes(em[1]!)) return { text: em[2]!, emphasis: "em" };
  return { text: t, emphasis: null };
}

/** A list of values (split on spaces and commas), each `x*n` run spelled out as n of x. */
export function expandRuns(list: string): string[] {
  const out: string[] = [];
  for (const tok of list.split(/[\s,]+/).filter(Boolean)) {
    const run = RUN.exec(tok);
    const n = run ? Number(run[2]) : 1;
    if (run && n >= 0 && run[1] !== "*") { for (let i = 0; i < Math.min(n, MAX_RUN); i++) out.push(run[1]!); }
    else out.push(tok);
  }
  return out;
}

/**
 * One row from the text of a list item (without its bullet) or a child bullet's title. The order: the box, the side
 * note, emphasis around the whole row, the label, emphasis around the label or the value, the path, the values.
 */
export function figureRow(source: string, line = 0, depth = 0, ordinal: number | null = null): FigureRow {
  let rest = source.trim(), done: boolean | null = null;
  const box = BOX.exec(rest);
  if (box) { done = box[1] !== " "; rest = rest.slice(box[0].length); }
  // Emphasis around the whole row, its side note inside (`**a — b**`): the row is marked, the note still its own.
  const outer = unwrapEmphasis(rest);
  const wrapped = outer.emphasis && NOTE.test(outer.text) ? outer.emphasis : null;
  if (wrapped) rest = outer.text;
  let note: string | null = null;
  const dash = NOTE.exec(rest);
  if (dash) { note = rest.slice(dash.index + dash[0].length).trim() || null; rest = rest.slice(0, dash.index).trim(); }
  let { text, emphasis } = unwrapEmphasis(rest);
  emphasis ??= wrapped;
  // A row that starts with a bold or italic span (`**Raised beds** for the squash`) is marked as that span is.
  if (!emphasis) {
    const lead = /^(\*\*|__|\*|_)(?![*_\s])(.+?)(?<![\s*_])\1(?=[\s:])(.*)$/.exec(text);
    if (lead && !lead[2]!.includes(lead[1]!)) { emphasis = lead[1]!.length === 2 ? "strong" : "em"; text = lead[2]! + lead[3]!; }
  }
  let label: string | null = null, value = text;
  const colon = text.indexOf(": ");
  if (colon > 0) {
    const l = unwrapEmphasis(text.slice(0, colon)), v = unwrapEmphasis(text.slice(colon + 2));
    label = l.text; value = v.text;
    emphasis ??= l.emphasis ?? v.emphasis;
    text = `${label}: ${value}`;
  } else if (text.endsWith(":") && !text.includes(" ")) { label = text.slice(0, -1); value = ""; }
  const steps = value.split(PATH).map(s => s.trim());
  const path = steps.length > 1 && steps.every(Boolean) ? steps : null;
  return { line, depth, ordinal, done, text, label, value, emphasis, note, path, values: expandRuns(value) };
}

/**
 * The rows, paragraphs and fences of `lines` (a figure's Markdown, after its YAML). A list item is a row; a line
 * indented under one continues it; a blank line ends a paragraph; a ``` fence is kept whole.
 */
export function parseFigureMarkdown(lines: readonly string[]): FigureMarkdown {
  const rows: FigureRow[] = [], paragraphs: string[] = [], fences: FigureFence[] = [];
  let para: string[] = [];
  // The line the last row's text ended on (a continuation line moves it on), and its text as written so far.
  let rowEnd = -2, raw = "";
  const endPara = () => { if (para.length) paragraphs.push(para.join(" ")); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    // A fence may sit under a row at any depth: its lines are read from their first non-blank.
    const fence = codeFenceOpen(l.trimStart());
    if (fence) {
      endPara();
      const body: string[] = [], open = i;
      for (i++; i < lines.length && !closesCodeFence(lines[i]!.trimStart(), fence); i++) body.push(lines[i]!);
      fences.push({ lang: fence.info.split(/\s+/)[0] ?? "", lines: body, line: open });
      continue;
    }
    const item = ITEM.exec(l);
    if (item) {
      endPara();
      const indent = item[1]!.replace(/\t/g, "  ").length;
      rows.push(figureRow(item[4]!, i, Math.floor(indent / 2), item[3] ? Number(item[3]) : null));
      rowEnd = i; raw = item[4]!;
      continue;
    }
    if (!l.trim()) { endPara(); continue; }
    // A line indented under a row continues it (its text, read again as one).
    const last = rows.at(-1);
    if (last && /^\s+\S/.test(l) && !para.length && rowEnd === i - 1) {
      raw = `${raw.trimEnd()} ${l.trim()}`;
      rows[rows.length - 1] = figureRow(raw, last.line, last.depth, last.ordinal);
      rowEnd = i;
      continue;
    }
    para.push(l.trim());
  }
  endPara();
  return { rows, paragraphs, fences };
}

/** A row's numbers (its values that are numbers; `values` keeps every one). */
export const numbersOf = (r: FigureRow): number[] => r.values.map(Number).filter(n => Number.isFinite(n));
