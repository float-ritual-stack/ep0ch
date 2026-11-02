import { isQueryAtomWord } from "./query-atoms";
import { selectionQuery, type Clause } from "./query-clauses";

export interface QueryWordClause {
  clause: string;
  confidence: number;
  alternatives: string[];
  alternativePicks?: Record<string, Clause>;
  from: string[];
  pick?: Clause;
  widens?: true;
  learn?: false;
}

export interface QueryWords {
  id: string;
  input: string;
  base: string;
  where: string;
  clauses: QueryWordClause[];
  text: string[];
  /** The second offer: the same words without the current selection. */
  replacement?: string;
  grammar?: true;
  pending?: true;
  /** Acceptance was recorded, but some words could not be learned as aliases. */
  warning?: string;
}

export type QuerySuggestAnswer = QueryWords | { unavailable: string };
export interface QuerySuggestRequest {
  text: string;
  where?: string;
  zone?: string;
  /** The completer's first pass resolves aliases and cache; its paused pass may ask Jev. */
  semantic?: boolean;
  outcome?: "accepted" | "edited" | "ignored";
  suggestion?: QueryWords;
  /** A corrected clause, with its original words, becomes an alias too. */
  corrections?: { from: string[]; clause: string }[];
  acceptedWhere?: string;
  mutation?: { author: "user" | "agent" | "system"; actorId?: string; sessionId?: string; taskId?: string };
}

export const QUERY_WORDS_PAUSE_MS = 650;
export function queryWordsWhere(base: string, clauses: readonly QueryWordClause[]): string {
  const raw = clauses.filter(c => !c.pick);
  const query = selectionQuery(clauses.flatMap(c => c.pick ? [c.pick] : []), raw.map(c => raw.length > 1 ? `(${c.clause})` : c.clause).join(" AND "));
  return [base && `(${base})`, query && `(${query})`].filter(Boolean).join(" AND ");
}
export const queryWhy = (suggestion: QueryWords): string => suggestion.clauses.map(c =>
  `${c.from.join(" ")} → ${c.clause}${c.widens ? " · widens to the whole outline" : ""}${c.alternatives.length ? ` · or ${c.alternatives.join(" / ")}` : ""}`,
).join("\n");

/**
 * Whether a line is written as a query rather than words to search by (PIE-1497): a relation (`key=value`, `~`, `<`,
 * `>`), a whole-word AND, OR or NOT, or an atom with its head (`by:loki`, `under:`). Plain words aren't: the power bar
 * searches titles with them, and offers query words only on a line that reads like this or in its `=` scope.
 */
export function readsAsQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[=~<>]/.test(t)) return true;
  if (/(?:^|\s)(?:AND|OR|NOT)(?:\s|$)/.test(t)) return true;
  return t.split(/\s+/).some(word => !word.startsWith("#") && isQueryAtomWord(word));
}
