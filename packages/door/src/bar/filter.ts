// The power bar's row filter (PIE-656), shared by every list that filters rows the door holds (the tile menu, PIE-879):
// outline-core's matcher over each row's fields, those whose label starts with what's typed, then holds it, first.
import { matchesSearchText, prepareSearchQuery, searchMatchSpans } from "@ep0ch/outline-core/search-match";

/**
 * Rows kept whose fields match `q` (outline-core's matcher, as every filter over rows the door holds); those with a field
 * that is what's typed, then whose label starts with it, then holds it, come first, the rest keeping their order.
 */
export function filtered<R extends { label: string }>(rows: R[], q: string, fields: (r: R) => string[]): R[] {
  const query = prepareSearchQuery(q);
  if (!query) return rows;
  // No typo forgiveness over names and keys: a short tile name or action is matched as typed.
  const kept = rows.filter(r => matchesSearchText(query, fields(r), { typos: false })), t = q.trim().toLowerCase();
  // A field typed whole (a tile's name, `%tree`) comes before a label that only starts with it (PIE-1460: a detail listed
  // first took ⏎ from the tile named tree).
  const rank = (r: R) => (fields(r).some(f => f.toLowerCase() === t) ? -1 : r.label.toLowerCase().startsWith(t) ? 0 : r.label.toLowerCase().includes(t) ? 1 : 2);
  return kept.map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.r);
}

/** The positions in `label` the words of `q` light: outline-core's matcher's spans (`searchMatchSpans`). */
export const litCells = (label: string, q: string): Set<number> => new Set(searchMatchSpans(label, q));
