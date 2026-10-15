// The power bar's row filter (PIE-656), shared by every list that filters rows the door holds (the tile menu, PIE-879):
// outline-core's matcher over each row's fields, those whose label starts with what's typed, then holds it, first.
import { matchesSearchText, prepareSearchQuery } from "@ep0ch/outline-core/search-match";

/**
 * Rows kept whose fields match `q` (outline-core's matcher, as every filter over rows the door holds); those whose
 * label starts with what's typed, then holds it, come first, the rest keeping their order.
 */
export function filtered<R extends { label: string }>(rows: R[], q: string, fields: (r: R) => string[]): R[] {
  const query = prepareSearchQuery(q);
  if (!query) return rows;
  // No typo forgiveness over names and keys: a short tile name or action is matched as typed.
  const kept = rows.filter(r => matchesSearchText(query, fields(r), { typos: false })), t = q.trim().toLowerCase();
  const rank = (r: R) => (r.label.toLowerCase().startsWith(t) ? 0 : r.label.toLowerCase().includes(t) ? 1 : 2);
  return kept.map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.r);
}

/** The positions in `label` the words of `q` light: each word where it sits whole, else its letters in order. */
export function litCells(label: string, q: string): Set<number> {
  const lit = new Set<number>(), low = [...label.toLowerCase()];
  for (const word of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = low.join("").indexOf(word);
    if (at >= 0) { for (let i = 0; i < [...word].length; i++) lit.add(at + i); continue; }
    let from = 0;
    const found: number[] = [];
    for (const c of word) { const j = low.indexOf(c, from); if (j < 0) { found.length = 0; break; } found.push(j); from = j + 1; }
    for (const j of found) lit.add(j);
  }
  return lit;
}
