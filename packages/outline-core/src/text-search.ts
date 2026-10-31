/** Source line numbers count from one, including the note's header. */
export interface MatchingLine { line: number; text: string; before?: string; after?: string }
export interface GrepQuery { pattern: string; flags?: string; limit?: number; offset?: number }
export interface GrepResult {
  matches: { id: string; title: string; line: number; text: string }[];
  more: boolean;
  nextOffset?: number;
}

export const quotedPhrases = (query: string): string[] =>
  [...query.matchAll(/"((?:\\.|[^"\\])+)"/g)].map(m => m[1]!.replace(/\\(["\\])/g, "$1").toLowerCase());

/** Exact source text, with one adjacent line on each side; semantic-only hits have no matching lines. */
export function matchingLines(text: string, terms: readonly string[]): MatchingLine[] {
  const lines = text.split("\n");
  return lines.flatMap((text, index) => terms.some(term => text.toLowerCase().includes(term)) ? [{
    line: index + 1, text,
    ...(index > 0 ? { before: lines[index - 1] } : {}),
    ...(index + 1 < lines.length ? { after: lines[index + 1] } : {}),
  }] : []);
}

export interface GotoSearchMatch {
  subtitle?: string;
  block: { id: string; revision: number };
  title: string;
  path: string;
  snippet: string;
  lines?: MatchingLine[];
  exact: boolean;
  /** Jev's Score for it (0 to 3), on a ranked search (PIE-1198). */
  score?: number;
  /** What a ranked search reads beside its text (PIE-1199): its type, its length in characters, when it last changed. */
  facts?: { type?: string; length: number; updated: string };
  /** Found by meaning, not words (the deep pass, PIE-1200). */
  deep?: true;
  /**
   * An empty query asked from a note (`contextBlockId`) lists, in order: what its parent and siblings link to
   * (`linked`), notes near it (`near`), the person's own recent edits (`yours`).
   */
  reason?: "linked" | "near" | "yours";
}
