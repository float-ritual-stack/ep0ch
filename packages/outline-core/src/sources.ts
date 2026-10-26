// Sources (PIE-956, S6b): every generated region a note holds, named, with what it read and when, what shaped it and what it
// answered: the one answer the door's Sources inspector draws (a published page's read-only panel is a follow-up: PIE-996), so a second client agrees with it. A page
// shows none of it by default (generated output reads as the note's own content); this is what "where this comes from"
// opens. Pure: no I/O. The service fills it (outliner `site-sources.ts`, the `site.sources` request).
import { buttonCallAt, type ButtonCall } from "./button-call";
import { slotPairs } from "./action-line";
import { codeBlocks } from "./code-fence";
import { componentAttrs, componentBlocks } from "./component-block";
import { figureProps, figureSource, graphKind } from "./figure-props";
import { siteBlockAt } from "./site-blocks";
import { findOutputRegions } from "./output-region";
import { useCallAt } from "./template-use";

/** What produced the region: a handler line (`weekly:: week=42`), a `::=` line, a `::use`, a `::graph-*` figure, `::fields`, `::if`, or a written `[!output]` callout. */
export type SourceKind = "button" | "handler" | "expr" | "use" | "figure" | "fields" | "if" | "output";

export interface SourceParam { key: string; value: string }

/** One generated region of a note. */
export interface SourceEntry {
  /** Stable in the note: the line it starts on (`12`), or `#anchor` for a written output region. */
  key: string;
  kind: SourceKind;
  /** What the person calls it: the handler's name, `::use meeting-template`, `graph-table`, the region's label. */
  name: string;
  /** The note lines (from 0) it spans, inclusive. */
  line: number;
  endLine: number;
  /** When it last read or ran (ISO); absent when it has no read of its own (a written region reads when its producer ran: its hash says whether it is still that). */
  readAt?: string;
  /** Read live: it is drawn again when what it read changes. */
  live: boolean;
  /** Query: its parameters as written, and whether the line can be rewritten from them (`sources.set`). */
  query: { params: SourceParam[]; text: string; editable: boolean };
  /** Transform: the code, YAML or template that shaped the result, with the note to jump to. */
  transform: { kind: "script" | "extension" | "template" | "figure" | "expression" | "none"; label: string; text?: string; block?: string };
  /** Result: what it answered, as rows when it is a table. */
  result: { rows: number; columns?: string[]; table?: string[][]; text: string; propertyNames?: string[] };
  /** What is wrong with it, in the words the region shows. */
  problem?: string;
}

/** `site.sources`' question. */
export interface SourcesRequest { blockId: string; hidden?: string[] }

/** `site.sources`' answer. */
export interface SourcesAnswer {
  blockId: string;
  revision: number;
  /** When the service read them (ISO). */
  readAt: string;
  sources: SourceEntry[];
}

/** A generated line found in a note's text, before the service has answered it. */
export interface SourceCall {
  kind: Exclude<SourceKind, "handler" | "expr">;
  line: number; endLine: number;
  name: string;
  params: SourceParam[];
  text: string;
  /** For a figure: its kind (`table` of `graph-table`) and where its YAML is (the lines between `---`). */
  figure?: { kind: string; yaml: string };
  button?: ButtonCall;
  /** For a `::use`: the template as written. For `::fields`: the key. For `::if`: the query. For an output region: its producer's block id. */
  of?: string;
  /** For an output region: its anchor and whether its person edited it. */
  region?: { anchor?: string; edited: boolean; hash?: string; producer?: string; body: string };
}

const pairsOf = (attrs: string | undefined) => (attrs ? componentAttrs(attrs.replace(/^\{|\}$/g, "")).pairs : []);

/** The generated lines of `text` that the note itself answers for (everything but handler and `::=` lines, which the extension registry knows): in line order. */
export function sourceCalls(text: string): SourceCall[] {
  const lines = text.split("\n");
  const out: SourceCall[] = [];
  const fenced = new Set<number>();
  // By the fence grammar over every line: code inside a component's body is still code.
  for (const f of codeBlocks(lines).fences) for (let j = f.start; j <= f.end; j++) fenced.add(j);
  const blocks = new Map(componentBlocks(lines).map(c => [c.start, c]));
  const regions = findOutputRegions(text);
  const inRegion = new Set(regions.flatMap(r => Array.from({ length: r.endLine - r.startLine + 1 }, (_, i) => r.startLine + i)));
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i) || inRegion.has(i)) continue;
    const button = buttonCallAt(lines, i);
    // A sequence, or a button with a slot (PIE-1298): its slots are parameters the Sources inspector and `sources.set` write.
    if (button?.sequence || button?.slots.length) {
      out.push({ kind: "button", line: i, endLine: button.endLine, name: button.label, params: button.slots, text: lines.slice(i, button.endLine + 1).join("\n"), button });
      i = button.endLine;
      continue;
    }
    const use = useCallAt(lines, i);
    if (use) {
      out.push({ kind: "use", line: i, endLine: i, name: `::use ${use.of ?? "(no template)"}`, params: use.props, text: lines[i]!, ...(use.of ? { of: use.of } : {}) });
      continue;
    }
    const sb = siteBlockAt(lines, i, blocks);
    if (sb) {
      const params = sb.kind === "fields" ? [{ key: "key", value: sb.spec.key }, ...(sb.spec.of ? [{ key: "of", value: sb.spec.of }] : [])] : [{ key: "where", value: sb.spec.where }];
      out.push({ kind: sb.kind, line: i, endLine: sb.end, name: sb.kind === "fields" ? `::fields ${sb.spec.key}` : "::if", params, text: lines[i]!, of: sb.kind === "fields" ? sb.spec.key : sb.spec.where });
      continue;
    }
    const block = blocks.get(i), kind = block && graphKind(block);
    if (block && kind) {
      const body = lines.slice(i + 1, block.end);
      const yaml = figureSource(body).yaml;
      out.push({ kind: "figure", line: i, endLine: block.end, name: `graph-${kind}`, params: pairsOf(block.attrs), text: lines[i]!, figure: { kind, yaml } });
      i = block.end;
    }
  }
  for (const r of regions) {
    out.push({ kind: "output", line: r.startLine, endLine: r.endLine, name: r.label || "output", params: [], text: lines[r.startLine]!, region: { body: r.body, ...(r.anchor ? { anchor: r.anchor } : {}), edited: r.edited, ...(r.hash ? { hash: r.hash } : {}), ...(r.producer ? { producer: r.producer } : {}) } });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The top-level `key: value` pairs of a figure's YAML (a nested or listed value is left as the line says): its query's parameters. */
export function yamlParams(yaml: string): SourceParam[] {
  const parsed = figureProps("", { yaml });
  if ("error" in parsed) return [];
  return Object.entries(parsed.props).map(([key, value]) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value) }));
}

/** The sources' list as plain text, one per line: what the header and an agent say (`3 sources · beds-table, ::use meeting, graph-table`). */
export const sourcesSummary = (a: SourcesAnswer): string => (a.sources.length ? `${a.sources.length} source${a.sources.length === 1 ? "" : "s"} · ${a.sources.map(s => s.name).join(", ")}` : "no generated regions");

/** The slot words of a handler line (`weekly:: week=42 tag="a b"`) as written, each with its value (a repeat is another word), and where the line's arguments start. */
function slotWords(line: string): { head: string; words: SourceParam[] } | null {
  const m = /^(\s*[^\s:]+::(?:\s+|$))(.*)$/.exec(line.replace(/\r$/, ""));
  if (!m) return null;
  return { head: m[1]!, words: slotPairs(m[2]) };
}

/**
 * A handler line with `props` written onto its slots: the first slot of a name already there takes the new value (the rest of the
 * line, quoted words and spacing included, is left as written), a new one is added at the end. A value with a space or a quote is
 * written in quotes. Null when the line isn't a handler line, or a value can't be written on one line (it holds a line break).
 */
export function withSlotProps(line: string, props: Record<string, string>): string | null {
  const read = slotWords(line);
  if (!read || Object.values(props).some(v => v.includes("\n"))) return null;
  const say = (k: string, v: string) => (/^\S+$/.test(v) && !v.includes('"') ? `${k}=${v}` : `${k}="${v.replace(/(["\\])/g, "\\$1")}"`);
  const rest = line.slice(read.head.length);
  const done = new Set<string>();
  const rewritten = rest.replace(/([A-Za-z_][\w-]*)=(?:"(?:[^"\\]|\\.)*"|\S*)/g, (whole, key: string) => {
    if (!Object.hasOwn(props, key) || done.has(key)) return whole;
    done.add(key);
    return say(key, props[key]!);
  });
  const added = Object.entries(props).filter(([k]) => !done.has(k)).map(([k, v]) => say(k, v));
  const tail = [rewritten.trimEnd(), ...added].filter(Boolean).join(" ");
  return `${read.head.trimEnd()}${tail ? " " : ""}${tail}`.trimEnd();
}


/** The inspector's raw rows, shared by file downloads in the door and on a page. */
export function sourceDownload(result: SourceEntry["result"], format: "csv" | "json"): string {
  const columns = result.columns ?? ["text"];
  const rows = result.table ?? [[result.text]];
  if (format === "json") return JSON.stringify(rows.map(row => Object.fromEntries(columns.map((key, i) => [key, row[i] ?? ""]))), null, 2) + "\n";
  const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  return [columns, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
