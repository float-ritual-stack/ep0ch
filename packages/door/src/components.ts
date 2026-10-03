// A rich component's view (an extension's `component` handler line, pi-herdr-outliner
// PIE-507): the shared primitives (card, box, stack, row, text, badge, stat, bar, table, checklist,
// sparkline) in the terminal, as the service's `terminal` target lays them out, with tone as colour. The
// service checks the view against the catalogue; this draws what it sent and nothing else.
import { BOLD, C, fg, headOf, pad, RESET, SPARK_STEPS, UNBOLD, width as vwidth } from "./style";
import { printable, wrap } from "./text";

/** The service's primitives (src/component-primitives.ts PRIMITIVE_TYPES): what `primitiveLines` draws. */
export const PRIMITIVES = ["text", "badge", "stat", "bar", "table", "checklist", "sparkline", "card", "box", "stack", "row"] as const;

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

type Node = Record<string, unknown>;
const kids = (n: Node): unknown[] => (Array.isArray(n.children) ? n.children : []);

/**
 * A component's view as terminal lines, `w` wide, each line already coloured. `link` tags a card's or a
 * table row's block (`link` and `links` in the view), so the reader's `[ ]` stops on it and a click opens it.
 * Throws PrimitiveUnknown for a primitive outside the catalogue: the reader falls back to the line's markdown.
 */
export function primitiveLines(view: unknown, w: number, link?: (block: string, text: string) => string, depth = 0): string[] {
  w = Math.max(8, Math.floor(w));
  if (depth > MAX_DEPTH) throw new PrimitiveUnknown(`the view nests deeper than ${MAX_DEPTH}`);
  if (!view || typeof view !== "object" || Array.isArray(view)) throw new PrimitiveUnknown("a primitive is an object");
  const n = view as Node;
  const inner = (v: unknown, width: number) => primitiveLines(v, width, link, depth + 1);
  const tag = (block: unknown, text: string) => (link && typeof block === "string" ? link(block, text) : text);
  switch (n.type) {
    case "text":
      // Its lines are its own, as the service's terminal target keeps them; each wraps to the width.
      return String(n.text ?? "").split("\n").flatMap(t => wrap(one(t), w)).map(l => fg(toned(n.tone ?? "default")) + (n.strong ? BOLD + l + UNBOLD : l) + RESET);
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
    case "row": {
      const cs = kids(n);
      if (!cs.length) return [];
      const each = Math.floor((w - 3 * (cs.length - 1)) / cs.length);
      // Too narrow to sit side by side: one under the other.
      if (each < 12) return cs.flatMap(c => inner(c, w));
      const cols = cs.map(c => inner(c, each));
      return beside(cols, cols.map(() => each));
    }
    default:
      throw new PrimitiveUnknown(`no primitive ${one(n.type)} here (this door draws ${PRIMITIVES.join(", ")})`);
  }
}
