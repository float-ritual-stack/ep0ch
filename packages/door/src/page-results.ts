// A page with its live figures' results (PIE-1355): what copying a page (the reader's Y, `note.copy`) and `ep0ch show
// --markdown` give, so an agent without the outline's MCP can read a live page. The text stays as written; under each
// live figure go its results as Markdown, from the rows the reader draws (graphs.ts figureResults, outline-core's
// figure-results.ts), never a question of their own.
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { RESULTS_BUDGET, RESULTS_CAP, type ResultsContext } from "@ep0ch/outline-core/figure-results";
import { useCallsOf, type TemplateUseAnswer } from "@ep0ch/outline-core/template-use";
import type { SiteAnswer } from "@ep0ch/outline-core/site";
import { titleLine } from "./board";
import { figureResults, figureSource, graphKind, withFigureBoard, type FigureSource } from "./graphs";
import { liveSettled } from "./live";
import { metadataLines } from "./props";
import type { SocketBoard } from "./socket";
import { bodySite, MAX_USE_DEPTH, type UseSite } from "./template-use";

/** The `::graph-*` figures in `text` (outside code fences): each one's kind, its lines (from 0, inclusive), and its source as the reader reads it. */
export function noteFigures(text: string, note: string): { kind: string; from: number; to: number; source: FigureSource }[] {
  const lines = text.split("\n");
  // The note's figure block, as the reader finds it (surface/note.ts readableSource): the first line with text below
  // the title and its property lines.
  const start = Math.max(0, titleLine(text).line) + 1, meta = metadataLines(text, null);
  const blockLine = lines.findIndex((l, i) => i >= start && !meta.has(i) && l.trim());
  return componentBlocks(lines).flatMap(c => {
    const kind = graphKind(c);
    return kind ? [{ kind, from: c.start, to: c.end, source: figureSource(lines.slice(c.start + 1, c.end), note, c.start === blockLine, c.attrs) }] : [];
  });
}

/**
 * A page with its live figures' results (withFigureResults): the text, how many figures carry results, how many of those
 * were cut and how many the outline didn't answer in time (said in their place).
 */
export interface PageResults { text: string; figures: number; cut: number; unanswered: number; waiting: boolean }

/** Keep a template's figures at its invocation, with the same props and host the reader draws them in. */
async function pageFigures(board: SocketBoard, text: string, note: string, site: UseSite = {}, depth = 0): Promise<ReturnType<typeof noteFigures>> {
  const figures = noteFigures(text, note).map(f => ({ ...f, source: { ...f.source, ...site } }));
  if (depth < MAX_USE_DEPTH) for (const call of useCallsOf(text)) {
    const answer = await board.request<TemplateUseAnswer>("template.use", { block: note, line: call.line, ...site });
    if (!answer.template) continue;
    const body = bodySite(answer);
    // The copied query must carry its values outside the template's Site, including the command for the rest.
    const filled = await board.request<SiteAnswer>("site.answer", { blockId: answer.template.id, ...body, interpolate: { text: answer.template.text, fences: "template" } });
    const expanded = await pageFigures(board, filled.interpolated!.text, answer.template.id, body, depth + 1);
    figures.push(...expanded.map(f => ({ ...f, from: call.line, to: call.line })));
  }
  return figures.sort((a, b) => a.from - b.from);
}

/**
 * `text` as written, with each live figure's results under it as Markdown (PIE-1355: a page copy, `ep0ch show
 * --markdown`): graphs.ts figureResults, from the rows the reader draws. Each figure carries at most RESULTS_CAP rows and
 * the page RESULTS_BUDGET together; a cut figure says so with the command that reads the rest. `waiting`: some answer
 * hasn't come yet (ask again once liveSettled has waited), unless `final`: then each one says it wasn't answered in time.
 * Figures that ask nothing are left as written.
 */
export function withFigureResults(text: string, note: string, ctx: Omit<ResultsContext, "cap" | "note">, final = false, sources = noteFigures(text, note)): PageResults {
  const lines = text.split("\n"), placed: { at: number; lines: string[] }[] = [];
  let budget = RESULTS_BUDGET, figures = 0, cut = 0, unanswered = 0, waiting = false;
  for (const f of sources) {
    const r = figureResults(f.kind, f.source, { ...ctx, note, cap: Math.min(RESULTS_CAP, budget) }, final);
    if (!r) continue;
    if (r.waiting) { waiting = true; continue; }
    budget = Math.max(0, budget - r.shown);
    if (r.unanswered) unanswered++; else figures++;
    if (r.cut) cut++;
    // A blank line either side, unless the note has one there already.
    placed.push({ at: f.to + 1, lines: ["", ...r.lines, ...(lines[f.to + 1]?.trim() === "" ? [] : [""])] });
  }
  for (const p of placed.reverse()) lines.splice(p.at, 0, ...p.lines);
  return { text: lines.join("\n"), figures, cut, unanswered, waiting };
}

/**
 * The page with its figures' results once their answers have come (at most `ms`), asked of `board` as its reader asks
 * (lent for the asking, withFigureBoard: the reader's own when the door has it).
 */
export async function pageWithResults(board: SocketBoard, text: string, note: string, ctx: Omit<ResultsContext, "cap" | "note">, ms = 10_000): Promise<PageResults> {
  const figures = await pageFigures(board, text, note);
  const read = (final: boolean) => withFigureBoard(board, () => {}, () => withFigureResults(text, note, { ...ctx, at: Date.now() }, final, figures));
  const first = read(false);
  if (!first.waiting) return first;
  await liveSettled(ms, board);
  return read(true);
}
