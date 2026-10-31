// The facets selection writer, shared with query-word suggestions.
export interface Clause { key: string; value?: string; mode: "include" | "exclude"; path?: boolean }
const SAFE_VALUE = /^[\w./@*-]+$/u;

/** One clause as the views' grammar writes it: `#tag` for a tag, `key=value` (quoted when it needs it, `/*` for a path). */
export function clauseText(c: Clause): string {
  // A path's `/*` goes inside the quotes with it: `"back garden/*"` (the grammar takes nothing after a closing quote).
  if (c.value === undefined) return c.mode === "exclude" ? `NOT ${c.key}` : c.key;
  const value = c.value + (c.path ? "/*" : "");
  const term = c.key === "tag" ? `#${c.value}` : `${c.key}=${SAFE_VALUE.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`}`;
  return c.mode === "exclude" ? `NOT ${term}` : term;
}
/**
 * The selection as a query: each facet's included values ORed in a group, the facets ANDed, an excluded value a NOT.
 * `raw`: a query typed by hand, kept in front of the picks.
 */
export function selectionQuery(clauses: readonly Clause[], raw: string): string {
  const keys = [...new Set(clauses.map(c => c.key))];
  const terms = keys.flatMap(key => {
    const mine = clauses.filter(c => c.key === key);
    const inc = mine.filter(c => c.mode === "include" && c.value !== undefined).map(clauseText);
    return [...mine.filter(c => c.mode === "include" && c.value === undefined).map(clauseText), ...(inc.length > 1 ? [`(${inc.join(" OR ")})`] : inc), ...mine.filter(c => c.mode === "exclude").map(clauseText)];
  });
  return [raw.trim() ? (terms.length && /\b(?:OR|AND|NOT)\b/.test(raw) ? `(${raw.trim()})` : raw.trim()) : "", ...terms].filter(Boolean).join(" ");
}

