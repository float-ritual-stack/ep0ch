// A note as the native app draws it: the title, the chips, and the body as parts, each either prose (Markdown, the
// render target Rune's Markdown component draws) or a component the app draws itself (a query's rows as a table, a
// figure's results). Every grammar here is outline-core's and every answer the service's: the app parses nothing.
import type { SocketBoard } from "@ep0ch/door/src/socket";
import { pageWithResults } from "@ep0ch/door/src/page-results";
import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, quoteDepth } from "@ep0ch/outline-core/callouts";
import { componentAttrs, componentBlocks, noteCodeFences, type ComponentBlock } from "@ep0ch/outline-core/component-block";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { linkOccurrences } from "@ep0ch/outline-core/link-syntax";
import { viewSpec, viewWords } from "@ep0ch/outline-core/view-spec";

/** A block as a list asks for it (`blocks.query` and `blocks.read` with fields). */
export interface Listed { id: string; title?: string; hasChildren?: boolean; updatedAt?: string; properties?: { key: string; value: string }[] }

/** A note in a list: a child, a query's row, a backlink. */
export interface Row { id: string; title: string; hasChildren?: boolean; context?: string; props?: Record<string, string> }

export type Part =
  | { kind: "prose"; markdown: string }
  | {
    kind: "component"; name: string; title?: string;
    /** The lines as written, drawn when the app has nothing better. */
    source: string;
    /** A query-backed component (`::view`, `::graph-table` with a query, `::links`): what it asked and what the service answered. */
    query?: string; columns?: string[]; rows?: Row[]; more?: boolean; error?: string;
    /** A figure's results as Markdown (the door's page copy gives the same lines). */
    results?: string;
  };

export interface Page {
  id: string; revision: number; title: string; path: string;
  /** The Blockdown source: what the editor opens on and a save sends back. */
  text: string;
  chips: { key: string; value: string }[];
  /** Every property the note carries, as the service read them (the header's and the body's). */
  properties: { key: string; value: string }[];
  updated: string; author: string;
  parts: Part[];
  children: Row[];
  backlinks: Row[];
}

/** The address a link in prose opens: a block id, or a page address the bridge resolves when it's followed. */
export const blockHref = (id: string) => `ep0ch:b/${id}`;
export const pageHref = (address: string) => `ep0ch:p/${encodeURIComponent(address)}`;

const mdLabel = (s: string) => s.replace(/([\[\]\\])/g, "\\$1");

/** `text` with its Blockdown links written as Markdown links (`titles`: what an unlabelled reference reads as). */
export function proseMarkdown(text: string, titles: ReadonlyMap<string, string>): string {
  let out = "", at = 0;
  for (const l of linkOccurrences(text)) {
    if (l.kind === "markdown" || l.kind === "url") continue;
    if (l.kind === "page" && l.nested) continue;
    if (l.start < at) continue;
    const md = l.kind === "block"
      ? `[${mdLabel(l.label ?? titles.get(l.blockId) ?? l.blockId.slice(0, 8))}](${blockHref(l.blockId)})`
      : `[${mdLabel(l.label ?? l.displayAddress)}](${pageHref(l.displayAddress)})`;
    out += text.slice(at, l.start) + md;
    at = l.end;
  }
  return hardBreaks(calloutMarkdown(out + text.slice(at)));
}

/**
 * A note's lines are lines: where Markdown would run two written lines into one paragraph, the first ends in a hard
 * break. Code fences are left as written.
 */
function hardBreaks(text: string): string {
  const lines = text.split("\n");
  const code = new Set(noteCodeFences(lines).flatMap(f => Array.from({ length: f.end - f.start + 1 }, (_, i) => f.start + i)));
  return lines.map((line, i) => !code.has(i) && line.trim() && lines[i + 1]?.trim() && !code.has(i + 1) && !line.endsWith("  ") ? `${line}  ` : line).join("\n");
}

/** A callout's `[!type] title` line as a bold lead in its quote, which is all a Markdown renderer knows of one. */
function calloutMarkdown(text: string): string {
  const lines = text.split("\n");
  for (const c of calloutBlocks(lines)) {
    const type = BUILTIN_CALLOUT_REGISTRY.style(c.type);
    const quote = lines[c.line]!.slice(0, lines[c.line]!.length - quoteDepth(lines[c.line]!).content.length);
    lines[c.line] = `${quote}**${type.icon} ${c.title || type.title}**`;
  }
  return lines.join("\n");
}

/** The ids prose refers to without a label: the bridge reads their titles in one request. */
export function unlabelled(text: string): string[] {
  return [...new Set(linkOccurrences(text).flatMap(l => l.kind === "block" && l.label === undefined ? [l.blockId] : []))];
}

interface Asked { where: string; columns: string[]; limit: number; sort?: string; title?: string }

/** What a query-backed component asks, read as the views read it; null for any other component. */
function asked(block: ComponentBlock, lines: readonly string[]): Asked | { error: string } | null {
  const spec = viewSpec(block, lines);
  if (spec) {
    if (spec.error) return { error: spec.error };
    const p = spec.props;
    if (typeof p.query !== "string") return null;
    return { where: p.query, columns: viewWords(p["summary-properties"] ?? p.columns), limit: Number(p.limit) || 50, ...(typeof p.sort === "string" ? { sort: p.sort } : {}), ...(typeof p.title === "string" ? { title: p.title } : {}) };
  }
  if (block.name !== "links") return null;
  const attrs = Object.fromEntries(componentAttrs(block.attrs ?? "").pairs.map(p => [p.key, p.value]));
  return attrs.query ? { where: attrs.query, columns: [], limit: Number(attrs.limit) || 50, ...(attrs.title ? { title: attrs.title } : {}) } : null;
}

async function component(board: SocketBoard, note: string, block: ComponentBlock, lines: readonly string[]): Promise<Part> {
  const source = lines.slice(block.start, block.end + 1).join("\n");
  const part: Extract<Part, { kind: "component" }> = { kind: "component", name: block.name, source };
  const q = asked(block, lines);
  if (q && "error" in q) return { ...part, error: q.error };
  if (q) {
    try {
      const r = await board.request("blocks.query", { query: { where: q.where, limit: Math.min(200, q.limit), ...(q.sort ? { sort: q.sort } : {}) }, fields: ["id", "title", "properties", "hasChildren"] });
      const rows = (r.blocks as Listed[]).map(b => ({ id: b.id, title: b.title ?? "(untitled)", hasChildren: !!b.hasChildren, props: Object.fromEntries((b.properties ?? []).map(p => [p.key, p.value])) }));
      return { ...part, query: q.where, columns: q.columns, rows, more: r.completeness?.kind === "truncated", ...(q.title ? { title: q.title } : {}) };
    } catch (e) {
      // A query the service can't read is said where the rows would be: the service's own words.
      return { ...part, query: q.where, error: (e as Error).message, ...(q.title ? { title: q.title } : {}) };
    }
  }
  if (block.name.startsWith("graph-")) {
    const drawn = await pageWithResults(board, source, note, { outline: board.outline ?? "", at: Date.now() }, 3000).catch(() => null);
    const results = drawn?.text.slice(source.length).trim();
    if (results) return { ...part, results: proseMarkdown(results, new Map()) };
  }
  return part;
}

/** The page of `id`, read now. */
export async function page(board: SocketBoard, id: string): Promise<Page> {
  const { records, unavailable } = await board.records([id]);
  const record = records[0];
  if (!record) throw new Error(unavailable[0]?.status === "trashed" ? `${id} is in the Trash` : `no note ${id}`);
  const text = record.text;
  const header = headerLine(text);
  // The body is every line after the header line: the title and its chips are drawn above it.
  const lines = text.split("\n");
  const body = lines.slice(header.line + 1);
  const blocks = componentBlocks(body);

  const ids = unlabelled(body.join("\n"));
  const titles = new Map<string, string>();
  if (ids.length) for (const b of (await board.request("blocks.read", { ids, fields: ["id", "title"] })).blocks) titles.set(b.id, b.title ?? "");

  const parts: Part[] = [];
  const prose = (from: number, to: number) => {
    const md = body.slice(from, to).join("\n").replace(/^\n+|\n+$/g, "");
    if (md.trim()) parts.push({ kind: "prose", markdown: proseMarkdown(md, titles) });
  };
  let at = 0;
  // Top-level components only: one inside a box is its box's source.
  for (const b of blocks) {
    if (b.start < at) continue;
    prose(at, b.start);
    parts.push(await component(board, id, b, body));
    at = b.end + 1;
  }
  prose(at, body.length);

  const kids = record.children.length ? (await board.request("blocks.read", { ids: record.children, fields: ["id", "title", "hasChildren"] })).blocks : [];
  const back = await board.backlinks(id, 50).catch(() => null);
  return {
    id: record.id, revision: record.revision, title: record.title || "(untitled)", path: record.path ?? "", text,
    chips: record.header.map(c => ({ key: c.key, value: c.value })),
    properties: record.properties.flatMap(p => p.values.map(value => ({ key: p.key, value }))),
    updated: record.updated, author: record.actor ?? record.author,
    parts,
    children: kids.map(b => ({ id: b.id, title: b.title ?? "(untitled)", hasChildren: !!b.hasChildren })),
    backlinks: (back?.sources ?? []).filter(s => s.blockId !== id).map(s => ({ id: s.blockId, title: s.title, context: s.parentContext })),
  };
}
