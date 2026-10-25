// What a written live figure returns (PIE-1270): a write that holds a `::graph-*` with a `query:` or `view:` is answered
// with its row count, and a figure that returns none, or can't be asked, is a warning to fix before the write is called
// done. An agent can't see a figure draw over MCP, so the count is how it finds out that the query matched nothing.
//
// The service answers the question (`site.answer` with a `figure` producer, the same ask the publisher and the door
// make: outline-core's figure-live.ts says what each kind asks); nothing here evaluates a query. Only figures the write
// added or changed are asked, so an edit elsewhere in a note isn't told about a figure it didn't touch. Never throws:
// the write has landed, so a service that can't answer just says nothing.
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { askProps, asksPerItem, figureQuestion, liveAsk } from "@ep0ch/outline-core/figure-live";
import { figureProps, figureSource, graphKind } from "@ep0ch/outline-core/figure-props";
import type { SiteAnswer } from "@ep0ch/outline-core/site";
import { FIX_BEFORE_DONE } from "@ep0ch/outline-core/write-shape";

/** At most this many figures are asked per write, and the whole ask waits at most this long. */
const MAX_FIGURES = 8;
const BUDGET_MS = 2000;

export interface FigureRowsClient { request<T>(request: Record<string, unknown>): Promise<T> }

/** What the figures a write added or changed returned: a line each for the answer's `figures`, and the ones to fix. */
export interface FigureRowReport { figures: string[]; warnings: string[] }

interface LiveFigure { line: number; kind: string; name: string; source: string; props: Record<string, unknown>; args?: Record<string, string> }

/** The live figures in `text` (a `query:` or `view:`, or a stat's items that ask), with the lines they were written as. */
function liveFigures(text: string, id: string): LiveFigure[] {
  const lines = text.split("\n");
  const found: LiveFigure[] = [];
  for (const block of componentBlocks(lines)) {
    const kind = graphKind(block);
    if (!kind || block.end <= block.start) continue;
    const read = figureProps(kind, figureSource(lines.slice(block.start + 1, block.end), id, undefined, block.attrs));
    if ("error" in read) continue;
    if (!(read.props.query || read.props.view || asksPerItem(kind, read.props))) continue;
    found.push({ line: block.start + 1, kind, name: block.name, source: lines.slice(block.start, block.end + 1).join("\n"), props: read.props, ...(read.args ? { args: read.args } : {}) });
  }
  return found.slice(0, MAX_FIGURES);
}

const askedOf = (props: Record<string, unknown>) => {
  const q = props.query ?? props.view;
  return typeof q === "string" ? ` (${props.query ? "query" : "view"}: ${q.length > 60 ? `${q.slice(0, 59)}…` : q})` : "";
};

interface RowsOf { line: string; fix?: string }

async function rowsOf(client: FigureRowsClient, id: string, text: string, f: LiveFigure): Promise<RowsOf> {
  const where = `the ${f.name} on line ${f.line}`;
  const asking = liveAsk(f.kind, f.props);
  const perItem = asksPerItem(f.kind, f.props);
  if (!perItem) {
    if (asking.error) return { line: `${f.name} on line ${f.line}: not asked`, fix: `${where} can't be asked: ${asking.error}` };
    const question = figureQuestion(asking.ask, asking.group);
    if (!question) return { line: "" };
    if ("error" in question) return { line: `${f.name} on line ${f.line}: not asked`, fix: `${where} can't be asked: ${question.error}` };
  }
  const props = f.args && Object.keys(f.args).length ? Object.fromEntries(Object.entries(f.args).map(([k, v]) => [k, [v]])) : undefined;
  const answer = await client.request<SiteAnswer>({ action: "site.answer", blockId: id, draft: { text }, produce: { kind: "figure", figure: f.kind, props: askProps(f.props) }, ...(props ? { props } : {}) });
  const got = answer.produced?.kind === "figure" ? answer.produced : null;
  if (!got) return { line: "" };
  if (perItem) {
    const items = (f.props.items as Record<string, unknown>[]).map((item, k) => ({ label: String(item?.label ?? `item ${k + 1}`), c: got.counts?.[k], asks: !!(item?.query || item?.view) })).filter(i => i.asks);
    const counts = items.map(i => i.c?.error ? "?" : `${i.c?.ids.length ?? 0}${i.c?.truncated ? "+" : ""}`);
    const bad = items.find(i => i.c?.error), empty = items.filter(i => i.c && !i.c.error && !i.c.ids.length);
    const fix = bad ? `${where}: the item "${bad.label}" can't be asked: ${bad.c!.error}`
      : empty.length ? `${where} has ${empty.length === 1 ? "an item" : "items"} that matched 0 rows (${empty.map(i => `"${i.label}"`).join(", ")}): check ${empty.length === 1 ? "its" : "their"} query with outline_find` : undefined;
    return { line: `${f.name} on line ${f.line}: ${counts.join(", ")} rows`, ...(fix ? { fix } : {}) };
  }
  const n = got.blocks.length;
  const rows = `${n}${got.truncated ? "+" : ""} row${n === 1 && !got.truncated ? "" : "s"}`;
  const trouble = got.error ?? (n === 0 ? got.hint : undefined);
  const fix = got.error && !n ? `${where}${askedOf(f.props)} can't be asked: ${got.error}`
    : n === 0 ? `${where}${askedOf(f.props)} returned 0 rows${trouble ? `: ${trouble}` : ": check the query with outline_find (hasKey names a property)"}` : undefined;
  return { line: `${f.name} on line ${f.line}: ${rows}`, ...(fix ? { fix } : {}) };
}

/**
 * The row counts of the live figures `text` holds that `before` didn't, asked of the service as the note `id`; empty when
 * there are none or the service can't answer in time.
 */
export async function figureRowReport(client: FigureRowsClient, id: string, text: string, before?: string): Promise<FigureRowReport> {
  const had = new Set(before === undefined ? [] : liveFigures(before, id).map(f => f.source));
  const asked = liveFigures(text, id).filter(f => !had.has(f.source));
  if (!asked.length) return { figures: [], warnings: [] };
  const ask = async () => {
    const out = await Promise.all(asked.map(f => rowsOf(client, id, text, f).catch((): RowsOf => ({ line: "" }))));
    return { figures: out.map(o => o.line).filter(Boolean), warnings: out.flatMap(o => o.fix ? [FIX_BEFORE_DONE + o.fix] : []) };
  };
  return Promise.race([ask().catch(() => ({ figures: [], warnings: [] })), Bun.sleep(BUDGET_MS).then(() => ({ figures: [], warnings: [] }))]);
}
