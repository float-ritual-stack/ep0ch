// Document components: a fenced block whose language is `component:<name>` (```component:status) drawn
// by a renderer installed on the reader's host, as Detail draws it. A mirror of pi-herdr-outliner
// src/document-components.ts: the same registry (`OUTLINER_DOCUMENT_RENDERERS`, else
// `$XDG_CONFIG_HOME/pi-herdr-outliner/document-renderers.json`), the same bounded reads and schema, the
// same `label :: value` rows and the same reasons when it can't draw one. test/components.test.ts checks it
// against the service's own function. There is one layout, `labelled-values`; no plugin code runs.
//
// The second half draws a rich component's view (an extension's `component` handler line, pi-herdr-outliner
// PIE-507): the shared primitives (card, box, stack, row, text, badge, stat, bar, table, checklist,
// sparkline) in the terminal, as the service's `terminal` target lays them out, with tone as colour. The
// service checks the view against the catalogue; this draws what it sent and nothing else.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { C, fg, pad, RESET, SPARK_STEPS, width as vwidth } from "./style";
import { wrap } from "./text";

const IDENTIFIER = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const LIMIT = 32 * 1024;

export type DocumentComponent =
  | { kind: "labelled-values"; entries: { label: string; value: string }[] }
  | { kind: "unavailable"; reason: string };

type Definition = { id: string; layout: "labelled-values" } | { kind: "unavailable"; reason: string };

/** A bounded local file: a regular file of at most 32 KiB, read without blocking on a FIFO. */
function readDefinition(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error("invalid definition");
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > LIMIT) throw new Error("invalid definition");
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally { closeSync(fd); }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** The registry's shape, strictly (no extra keys, no conversion), as the service's TypeBox schema. */
function registryOf(v: unknown): Record<string, { manifest: string; enabled: boolean }> {
  if (!isObject(v) || !exactKeys(v, ["version", "renderers"]) || v.version !== 1 || !isObject(v.renderers)) throw new Error("invalid registry");
  const renderers = v.renderers;
  if (Object.keys(renderers).length > 64) throw new Error("invalid registry");
  for (const r of Object.values(renderers))
    if (!isObject(r) || !exactKeys(r, ["manifest", "enabled"]) || typeof r.manifest !== "string" || !r.manifest.length || typeof r.enabled !== "boolean") throw new Error("invalid registry");
  return renderers as Record<string, { manifest: string; enabled: boolean }>;
}

function manifestOf(v: unknown): { id: string; layout: "labelled-values" } {
  if (!isObject(v) || !exactKeys(v, ["contract", "id", "version", "renderer"]) || v.contract !== 1
    || typeof v.id !== "string" || !IDENTIFIER.test(v.id) || !Number.isInteger(v.version) || (v.version as number) < 1
    || !isObject(v.renderer) || !exactKeys(v.renderer, ["layout"]) || v.renderer.layout !== "labelled-values") throw new Error("invalid manifest");
  return { id: v.id, layout: "labelled-values" };
}

/**
 * The renderers one note load uses: each is resolved once, the first time a fence names it, and kept while
 * the note is read (a resize or a fold never reads the files again). Reopening the note starts a new one,
 * so an installation change shows then, as in Detail.
 */
export class ComponentCatalog {
  private readonly definitions = new Map<string, Definition>();
  private readonly registryPath = process.env.OUTLINER_DOCUMENT_RENDERERS
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi-herdr-outliner", "document-renderers.json");

  resolve(name: string): Definition {
    let d = this.definitions.get(name);
    if (!d) { d = this.load(name); this.definitions.set(name, d); }
    return d;
  }

  private load(name: string): Definition {
    try {
      const registry = registryOf(readDefinition(this.registryPath));
      if (!Object.hasOwn(registry, name)) return { kind: "unavailable", reason: "renderer is not installed" };
      const install = registry[name]!;
      if (!install.enabled) return { kind: "unavailable", reason: "renderer is disabled" };
      if (!isAbsolute(install.manifest)) throw new Error("invalid manifest path");
      return manifestOf(readDefinition(install.manifest));
    } catch {
      return { kind: "unavailable", reason: "renderer installation is unavailable or invalid" };
    }
  }
}

/**
 * A fence's component, or null when its language isn't `component:…` (ordinary code). `body`: the lines
 * between the fences, as typed. Each nonblank line is `label :: value`; at most 64 of them and 16 KiB.
 */
export function documentComponent(language: string, body: string, catalog: ComponentCatalog): DocumentComponent | null {
  if (!language.startsWith("component:")) return null;
  const name = language.slice("component:".length);
  if (!IDENTIFIER.test(name)) return { kind: "unavailable", reason: "invalid renderer name" };
  const d = catalog.resolve(name);
  if ("kind" in d) return d;
  if (Buffer.byteLength(body, "utf8") > 16 * 1024) return { kind: "unavailable", reason: "component input exceeds 16 KiB" };
  const entries: { label: string; value: string }[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const m = /^(\s*)(\S(?:.*?\S)?)(\s+::\s+)(\S(?:.*?\S)?)\s*$/.exec(line);
    if (!m || entries.length >= 64) return { kind: "unavailable", reason: "expected up to 64 “label :: value” rows" };
    entries.push({ label: m[2]!, value: m[4]! });
  }
  return entries.length ? { kind: d.layout, entries } : { kind: "unavailable", reason: "component has no labelled values" };
}

// ── a rich component's view ───────────────────────────────────────────────────────────────────────

/** The service's primitives (src/component-primitives.ts PRIMITIVE_TYPES): what `primitiveLines` draws. */
export const PRIMITIVES = ["text", "badge", "stat", "bar", "table", "checklist", "sparkline", "card", "box", "stack", "row"] as const;

/** A primitive this door doesn't draw (a newer catalogue), or a view past the catalogue's bounds. */
export class PrimitiveUnknown extends Error {}

const TONE: Readonly<Record<string, number>> = { default: C.white, good: C.lgreen, warn: C.yellow, bad: C.lred, dim: C.dark, accent: C.lcyan };
const toned = (tone: unknown) => TONE[String(tone ?? "default")] ?? C.white;
/** One line of extension text: no control characters (no escape reaches the terminal). */
const one = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");
const BOLD = "\x1b[1m", UNBOLD = "\x1b[22m";
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
      const top = fg(C.dark) + "┌─" + fg(C.lcyan) + [...title].slice(0, Math.max(0, w - 4)).join("") + fg(C.dark) + "─".repeat(Math.max(0, w - 3 - vwidth(title))) + "┐" + RESET;
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
