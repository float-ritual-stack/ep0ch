import { subtitleOf } from "@ep0ch/outline-core/block-record";
import { rankBlockFocusMatches } from "./block-focus";
import { type NormalizedPageAddress } from "@ep0ch/outline-core/link-syntax";
import { blockDisplayTitle } from "./references";
import { headedTitle, workIdOf } from "@ep0ch/outline-core/work-id-title";
import { searchTextTerms } from "@ep0ch/outline-core/search-match";
import { ancestorPath, contextList, searchContext, sortByContext, type ContextReason } from "./search-context";
import type { Block, GotoSearchCollection, GotoSearchMatch } from "./types";

export const GOTO_CANDIDATE_LIMIT = 80;
export const GOTO_RESULT_LIMIT = 30;

export interface GotoSearchOptions {
  /** The block a named address in the query resolves to: it is offered first. */
  exactAddressId?: string;
  limit?: number;
  /** The note being edited (`contextBlockId`): nearer notes first inside each rung, and an empty query's list. */
  contextBlockId?: string;
  /** What a `[[address]]` in a nearby note names, for an empty query's list. */
  resolveAddress?: (address: NormalizedPageAddress) => string | undefined;
}

/** A disposable projection of canonical blocks, never a second content store. */
export function gotoCandidates(blocks: readonly Block[], query: string, options: GotoSearchOptions = {}): GotoSearchCollection {
  if (typeof query !== "string" || query.length > 500) throw new Error("Goto query must be at most 500 characters");
  const limit = options.limit ?? GOTO_CANDIDATE_LIMIT;
  const live = blocks.filter(block => !block.effectiveDeletedRootId && !block.deletedAt);
  const byId = new Map(live.map(block => [block.id, block]));
  const context = searchContext(byId, options.contextBlockId);
  let ranked: { block: Block; title: string; kind: string; reason?: ContextReason }[];
  if (query.trim() && context) ranked = live.length ? sortByContext(rankBlockFocusMatches(live, query.trim(), live.length), context) : [];
  else if (query.trim()) ranked = rankBlockFocusMatches(live, query.trim(), limit + 1);
  else if (context) ranked = contextList(live, byId, context, limit + 1, options.resolveAddress ?? (() => undefined))
    .map(({ block, reason }) => ({ block, title: blockDisplayTitle(block), kind: "recent", reason }));
  else ranked = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, limit + 1).map(block => ({ block, title: blockDisplayTitle(block), kind: "recent" }));
  const address = options.exactAddressId ? byId.get(options.exactAddressId) : undefined;
  if (address && ranked[0]?.kind !== "exact-id") {
    const index = ranked.findIndex(match => match.block.id === address.id);
    if (index >= 0) ranked.splice(index, 1);
    ranked.unshift({ block: address, title: blockDisplayTitle(address), kind: "exact-address" });
  }
  // The words of the query (split as blocks.query splits it), for the snippet.
  const terms = searchTextTerms(query).filter(term => term.length >= 3);
  return {
    matches: ranked.slice(0, limit).map(({ block, title, kind, reason }) => ({
      ...gotoMatch(block, byId, terms, title),
      exact: kind === "exact-id" || kind === "exact-address" || kind === "id-prefix" || kind === "exact-title",
      ...(reason ? { reason } : {}),
    })),
    completeness: ranked.length > limit ? { kind: "truncated", limit } : { kind: "complete" },
    semantic: { status: "lexical" },
    ...(context ? { context: { blockId: context.block.id, ...context.note } } : {}),
  };
}

/** A note as a search's row: its title, path, the snippet for `terms` and the facts Jev reads (not exact). */
export function gotoMatch(block: Block, byId: ReadonlyMap<string, Block>, terms: readonly string[], title = blockDisplayTitle(block)): GotoSearchMatch {
  const type = block.properties.find(p => p.key === "type")?.value;
  return {
    block: { id: block.id, revision: block.revision }, title: headedTitle(title, workIdOf(block)).slice(0, 250), subtitle: subtitleOf(block),
    path: ancestorPath(block, byId),
    snippet: snippetOf(block.text, terms),
    // What Jev reads beside the text (PIE-1199): a long log that mentions the subject isn't the note about it.
    facts: { ...(type ? { type } : {}), length: block.text.length, updated: block.updatedAt.slice(0, 10) },
    exact: false,
  };
}

/** How much of a note the snippet shows. */
export const SNIPPET_LENGTH = 1000;

/**
 * The part of a note a search shows and Jev reads (PIE-1199): the window holding the most distinct words of the query,
 * not the first place one appears (a log's first mention of a word is rarely where the note is about it). The start
 * when none appears, or when the note is short enough to read whole.
 */
export function snippetOf(text: string, terms: readonly string[]): string {
  if (text.length <= SNIPPET_LENGTH || !terms.length) return text.slice(0, SNIPPET_LENGTH);
  const lower = text.toLowerCase();
  const hits = terms.flatMap(term => { const at: { at: number; term: string }[] = []; for (let i = lower.indexOf(term); i >= 0 && at.length < 50; i = lower.indexOf(term, i + 1)) at.push({ at: i, term }); return at; }).sort((a, b) => a.at - b.at);
  if (!hits.length) return text.slice(0, SNIPPET_LENGTH);
  let best = { start: 0, count: 0 };
  for (const h of hits) {
    const start = Math.max(0, h.at - 160);
    const count = new Set(hits.filter(x => x.at >= start && x.at < start + SNIPPET_LENGTH).map(x => x.term)).size;
    if (count > best.count) best = { start, count };
  }
  return text.slice(best.start, best.start + SNIPPET_LENGTH);
}

export function visibleGotoResults(result: GotoSearchCollection, limit = GOTO_RESULT_LIMIT): GotoSearchCollection {
  return {
    ...result,
    matches: result.matches.slice(0, limit),
    completeness: result.matches.length > limit ? { kind: "truncated", limit } : result.completeness,
  };
}

export {rankSearchWithJev as rankGotoWithJev} from './search-ranking';
