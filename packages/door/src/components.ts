// A rich component's view (an extension's `component` handler line, pi-herdr-outliner
// PIE-507), and a rule's decoration (PIE-600): the shared primitives (card, box, stack, row, text, badge, stat, bar,
// table, checklist, sparkline, and band and track for headings and dividers) in the terminal, as the service's `terminal` target lays them out, with tone as colour. The
// service checks the view against the catalogue; this draws what it sent and nothing else.
import { BOLD, C, fg, headOf, pad, RESET, SPARK_STEPS, UNBOLD, width as vwidth } from "./style";
import { printable, wrap } from "./text";
import { BAND_ALIGNS, BAND_PATTERNS, BAND_ROWS, BUILTIN_HEADING_STYLE_REGISTRY, type HeadingStyle, type HeadingStyleRegistry } from "@ep0ch/outline-core/heading-styles";
import type { CalloutTone } from "@ep0ch/outline-core/callouts";
import { bandLetters, drawBand, drawTrack, withMargin } from "./figures/banner";
import { TONE as CALLOUT_TONE } from "./callouts";

/** The service's primitives (src/component-primitives.ts PRIMITIVE_TYPES): what `primitiveLines` draws. */
export const PRIMITIVES = ["text", "blockdown", "badge", "stat", "bar", "table", "checklist", "sparkline", "card", "box", "stack", "row", "band", "track"] as const;

/** A primitive this door doesn't draw (a newer catalogue), or a view past the catalogue's bounds. */
export class PrimitiveUnknown extends Error {}

const TONE: Readonly<Record<string, number>> = { default: C.white, good: C.lgreen, warn: C.yellow, bad: C.lred, dim: C.dark, accent: C.lcyan };
const toned = (tone: unknown) => TONE[String(tone ?? "default")] ?? C.white;
/** One line of extension text: no control characters (no escape reaches the terminal). */
const one = (v: unknown) => printable(v, " ");
const MAX_DEPTH = 8;

function meter(value: number, max: number, n: number, tone: unknown): string {
  const k = Math.max(0, Math.min(n, Math.round((value / max) * n)));
  return fg(toned(tone ?? "accent")) + "█".repeat(k) + fg(C.dark) + "░".repeat(n - k) + RESET;
}

function spark(values: readonly number[]): string {
  const lo = Math.min(...values), hi = Math.max(...values);
  return values.map(v => SPARK_STEPS[hi === lo ? 2 : Math.round(((v - lo) / (hi - lo)) * (SPARK_STEPS.length - 1))]).join("");
}

/** Lines `w` wide side by side, `gap` apart. */
function beside(cols: string[][], widths: number[], gap = 3): string[] {
  const h = Math.max(0, ...cols.map(c => c.length));
  return Array.from({ length: h }, (_, r) => cols.map((c, i) => (i === cols.length - 1 ? c[r] ?? "" : pad(c[r] ?? "", widths[i]!))).join(" ".repeat(gap)));
}

// ── band and track (PIE-600): drawn by the heading styles' own drawer (PIE-599, src/figures/banner.ts) ─────────

/** A primitive's tone as a heading style's (the callouts' tone families): the band's words take it. */
const STYLE_TONE: Readonly<Record<string, CalloutTone>> = { good: "green", warn: "amber", bad: "coral", accent: "blue" };

/**
 * The heading style a `band` or `track` primitive draws with: the one it names (`style`, through the outline's
 * heading styles), else `fallback` ("band", "fade"), with what the primitive says itself (pattern, align, row, tone)
 * over it. One drawing path for a styled heading and a rule's decoration.
 */
export function primitiveStyle(n: Record<string, unknown>, headings: HeadingStyleRegistry, fallback: string): HeadingStyle {
  const base = (typeof n.style === "string" ? headings.style(n.style) : null) ?? headings.style(fallback) ?? BUILTIN_HEADING_STYLE_REGISTRY.style(fallback)!;
  const pick = <T extends string>(v: unknown, all: readonly T[]): T | undefined => (all.includes(v as T) ? v as T : undefined);
  const tone = typeof n.tone === "string" ? STYLE_TONE[n.tone] : undefined;
  return {
    ...base,
    ...(pick(n.pattern, BAND_PATTERNS) ? { pattern: pick(n.pattern, BAND_PATTERNS)! } : {}),
    ...(pick(n.align, BAND_ALIGNS) ? { align: pick(n.align, BAND_ALIGNS)! } : {}),
    ...(pick(n.row, BAND_ROWS) ? { row: pick(n.row, BAND_ROWS)! } : {}),
    ...(tone ? { tone } : {}),
  };
}

/** The row of a view drawn `w` wide that holds a band's words, or undefined for any other view. */
export function primitiveHeadRow(view: unknown, w: number, headings: HeadingStyleRegistry = BUILTIN_HEADING_STYLE_REGISTRY): number | undefined {
  const n = view as Record<string, unknown> | null;
  if (!n || typeof n !== "object" || n.type !== "band") return undefined;
  return bandOf(n, Math.max(8, Math.floor(w)), headings).headRow;
}

/** A band's rows `w` wide: the style's band with the words in it, or (narrow, or words too long) the plain heading. */
function bandRows(n: Record<string, unknown>, w: number, headings: HeadingStyleRegistry): string[] {
  return bandOf(n, w, headings).rows;
}

function bandOf(n: Record<string, unknown>, w: number, headings: HeadingStyleRegistry): { rows: string[]; headRow: number } {
  const words = n.text !== undefined ? one(n.text).trim() : "";
  const level = n.level === 1 || n.level === 3 ? n.level : 2;
  const style = primitiveStyle(n, headings, "band");
  const ink = style.tone !== "neutral" ? CALLOUT_TONE[style.tone] : level <= 1 ? C.lcyan : level === 2 ? C.white : C.grey;
  const label = words ? BOLD + fg(ink) + bandLetters(words, style.letters) + UNBOLD + RESET : null;
  const band = drawBand(style, w, level, label, words || "band");
  if (band) return { rows: band.rows, headRow: band.textRow };
  const plain = withMargin(style.margin, words ? wrap(`${"#".repeat(level)} ${words}`, w).map(l => fg(ink) + BOLD + l + UNBOLD + RESET) : [fg(C.dark) + "─".repeat(w) + RESET], 0);
  return { rows: plain.rows, headRow: plain.textRow };
}

type Node = Record<string, unknown>;
const kids = (n: Node): unknown[] => (Array.isArray(n.children) ? n.children : []);

/** What the reader lends a view's drawing. */
export interface PrimitiveDraw {
  /** Tags a card's or a table row's block (`link` and `links` in the view): the reader's `[ ]` stops on it, a click opens it. */
  link?(block: string, text: string): string;
  /** A `blockdown` primitive drawn as the reader draws a note's body, `width` wide. Without it, its lines as written. */
  blockdown?(text: string, width: number): string[];
  headings?: HeadingStyleRegistry;
}

/** The narrowest a row's child is drawn when the view doesn't say (the service's ROW_MIN_WIDTH). */
const ROW_MIN_WIDTH = 12;

/**
 * A component's view as terminal lines, `w` wide, each line already coloured.
 * Throws PrimitiveUnknown for a primitive outside the catalogue: the reader falls back to the line's markdown.
 */
export function primitiveLines(view: unknown, w: number, draw: PrimitiveDraw = {}, depth = 0): string[] {
  w = Math.max(8, Math.floor(w));
  if (depth > MAX_DEPTH) throw new PrimitiveUnknown(`the view nests deeper than ${MAX_DEPTH}`);
  if (!view || typeof view !== "object" || Array.isArray(view)) throw new PrimitiveUnknown("a primitive is an object");
  const n = view as Node;
  const { link } = draw, headings = draw.headings ?? BUILTIN_HEADING_STYLE_REGISTRY;
  const inner = (v: unknown, width: number) => primitiveLines(v, width, draw, depth + 1);
  const tag = (block: unknown, text: string) => (link && typeof block === "string" ? link(block, text) : text);
  switch (n.type) {
    case "text":
      // Its lines are its own, as the service's terminal target keeps them; each wraps to the width.
      return String(n.text ?? "").split("\n").flatMap(t => wrap(one(t), w)).map(l => fg(toned(n.tone ?? "default")) + (n.strong ? BOLD + l + UNBOLD : l) + RESET);
    case "blockdown": {
      const text = String(n.text ?? "");
      return draw.blockdown ? draw.blockdown(text, w) : text.split("\n").flatMap(t => wrap(one(t), w)).map(l => fg(C.white) + l + RESET);
    }
    case "badge":
      return [fg(toned(n.tone ?? "accent")) + `[${one(n.label)}]` + RESET];
    case "stat": {
      const value = `${one(n.value)}${n.unit !== undefined ? ` ${one(n.unit)}` : ""}`;
      return wrap(`${one(n.label)}  ${value}`, w).map((l, i) => (i ? fg(toned(n.tone)) + l : l.replace(/^(.*?)( {2})/, `${fg(C.grey)}$1$2${fg(toned(n.tone))}${BOLD}`) + UNBOLD) + RESET);
    }
    case "bar": {
      const value = Number(n.value), max = Number(n.max);
      if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) throw new PrimitiveUnknown("a bar needs value and max");
      const label = one(n.label), tail = `${value}/${max}`;
      const room = Math.max(4, Math.min(20, w - vwidth(label) - vwidth(tail) - 4));
      return [pad(`${fg(C.grey)}${label}  ${meter(value, max, room, n.tone)}  ${fg(toned(n.tone))}${tail}${RESET}`, w)];
    }
    case "sparkline": {
      const values = Array.isArray(n.values) ? n.values.map(Number).filter(Number.isFinite) : [];
      if (!values.length) throw new PrimitiveUnknown("a sparkline needs values");
      const label = n.label !== undefined ? `${one(n.label)}  ` : "";
      const room = Math.max(1, w - vwidth(label));
      return [fg(C.grey) + label + fg(C.lcyan) + spark(values.slice(-room)) + RESET];
    }
    case "checklist": {
      const items = Array.isArray(n.items) ? n.items as Node[] : [];
      return items.flatMap(it => {
        const box = it.done ? fg(C.lcyan) + "[x]" : fg(C.dark) + "[ ]";
        return wrap(one(it.label), w - 4).map((l, i) => (i ? "    " : box + RESET + " ") + fg(it.done ? C.dark : C.white) + l + RESET);
      });
    }
    case "table": {
      const columns = (Array.isArray(n.columns) ? n.columns : []).map(one);
      const rows = (Array.isArray(n.rows) ? n.rows as unknown[][] : []).map(r => (Array.isArray(r) ? r : []).map(one));
      const links = Array.isArray(n.links) ? n.links : [];
      if (!columns.length) throw new PrimitiveUnknown("a table needs columns");
      const widths = columns.map((c, i) => Math.max(vwidth(c), ...rows.map(r => vwidth(r[i] ?? ""))));
      // Too wide: the widest columns give room first, down to 4 cells each.
      while (widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1) > w) {
        const i = widths.indexOf(Math.max(...widths));
        if (widths[i]! <= 4) break;
        widths[i]!--;
      }
      const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? pad(c, widths[i]!).trimEnd() : pad(c, widths[i]!))).join("  ");
      return [
        fg(C.grey) + BOLD + line(columns) + UNBOLD + RESET,
        fg(C.dark) + widths.map(x => "─".repeat(x)).join("  ") + RESET,
        ...rows.map((r, k) => { const text = line(columns.map((_, i) => r[i] ?? "")); return fg(C.white) + tag(links[k], text) + RESET; }),
      ];
    }
    case "card": {
      const badge = n.badge && typeof n.badge === "object" ? n.badge as Node : null;
      const title = tag(n.link, one(n.title));
      const head = `${fg(C.lcyan)}▌ ${fg(C.white)}${BOLD}${title}${UNBOLD}${badge ? `  ${fg(toned(badge.tone ?? "accent"))}[${one(badge.label)}]` : ""}${RESET}`;
      return [head, ...(n.subtitle !== undefined ? wrap(one(n.subtitle), w - 2).map(l => `${fg(C.lcyan)}▌ ${fg(C.dark)}${l}${RESET}`) : []),
        ...kids(n).flatMap(c => inner(c, w - 2).map(l => `  ${l}`))];
    }
    case "box": {
      const title = n.title !== undefined ? ` ${one(n.title)} ` : "";
      const body = kids(n).flatMap(c => inner(c, w - 4));
      const top = fg(C.dark) + "┌─" + fg(C.lcyan) + headOf(title, Math.max(0, w - 4)) + fg(C.dark) + "─".repeat(Math.max(0, w - 3 - vwidth(title))) + "┐" + RESET;
      return [top, ...body.map(l => fg(C.dark) + "│ " + RESET + pad(l, w - 4) + fg(C.dark) + " │" + RESET), fg(C.dark) + "└" + "─".repeat(w - 2) + "┘" + RESET];
    }
    case "stack":
      return kids(n).flatMap(c => inner(c, w));
    case "band":
      return bandRows(n, w, headings);
    case "track":
      return drawTrack(primitiveStyle(n, headings, "fade"), w) ?? [fg(C.dark) + "─".repeat(w) + RESET];
    case "row": {
      const cs = kids(n);
      if (!cs.length) return [];
      const each = Math.floor((w - 3 * (cs.length - 1)) / cs.length);
      // Too narrow to sit side by side (the view's `minWidth`): one under the other, a blank line between.
      // Never under 8: the narrowest any primitive here draws.
      const min = typeof n.minWidth === "number" && Number.isFinite(n.minWidth) ? Math.max(8, n.minWidth) : ROW_MIN_WIDTH;
      if (each < min) return cs.flatMap((c, i) => [...(i ? [""] : []), ...inner(c, w)]);
      const cols = cs.map(c => inner(c, each));
      return beside(cols, cols.map(() => each));
    }
    default:
      throw new PrimitiveUnknown(`no primitive ${one(n.type)} here (this door draws ${PRIMITIVES.join(", ")})`);
  }
}
