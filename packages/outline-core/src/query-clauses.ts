// The facets selection writer, shared with query-word suggestions.
import { PROPERTY_KEY_SOURCE } from "./property-grammar";
import type { SiteValue } from "./site";

export interface Clause { key: string; value?: string; mode: "include" | "exclude"; path?: boolean }
const SAFE_VALUE = /^[\w./@*-]+$/u;
const queryValue = (value: string) => SAFE_VALUE.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`;

/** The whole, unquoted value operand the query parser binds from its Site. */
export const VALUE_OPERAND_SOURCE = `(${PROPERTY_KEY_SOURCE})(?:=|::)(\\{\\{[^\\n]*?\\}\\})`;

/** Operands to serialize for a query taken outside its Site; quoted literals stay literal. */
export function queryValueOperands(query: string) {
  const words = new RegExp(`"(?:[^"\\\\]|\\\\.)*"|(?<![^\\s(])${VALUE_OPERAND_SOURCE}(?=$|[\\s)])`, "g");
  return [...query.matchAll(words)].flatMap(m => m[1] ? [{ start: m.index!, end: m.index! + m[0].length, key: m[1], expression: m[2]!.slice(2, -2).trim() }] : []);
}

/** Write the service's resolved operands for a command, preserving its any-value and empty-list meanings. */
export function withQueryValues(query: string, operands: ReturnType<typeof queryValueOperands>, values: readonly SiteValue[]): string {
  let out = query;
  for (let i = operands.length - 1; i >= 0; i--) {
    const operand = operands[i]!, value = values[i];
    if (!value?.values || value.hidden) continue;
    const clauses = value.values.map(v => `${operand.key}=${queryValue(v)}`);
    const text = clauses.length === 1 ? clauses[0]! : clauses.length ? `(${clauses.join(" OR ")})` : `(${operand.key} AND NOT ${operand.key})`;
    out = out.slice(0, operand.start) + text + out.slice(operand.end);
  }
  return out;
}

/** One clause as the views' grammar writes it: `#tag` for a tag, `key=value` (quoted when it needs it, `/*` for a path). */
export function clauseText(c: Clause): string {
  // A path's `/*` goes inside the quotes with it: `"back garden/*"` (the grammar takes nothing after a closing quote).
  if (c.value === undefined) return c.mode === "exclude" ? `NOT ${c.key}` : c.key;
  const value = c.value + (c.path ? "/*" : "");
  const term = c.key === "tag" ? `#${c.value}` : `${c.key}=${queryValue(value)}`;
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

