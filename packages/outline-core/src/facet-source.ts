import { normalizePropertyKey } from "./query-properties";
import { bindThis, compileQueryExpression, expressionPropertyKeys, parseQueryExpression } from "./query-expression";
import { questionFacets, questionGroups } from "./query-facets";
import { missingPropertyHint } from "./property-hint";
import type { QuestionFacet, QuestionGroup } from "./protocol";

/** A source row's identity belongs to that source: two visits of one note are two rows. */
export interface FacetRow {
  id: string;
  title: string;
  properties: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
  /** An extension row may open an existing door action. */
  open?: { action: string; args?: Record<string, unknown> };
}
export interface FacetRequest { where: string; limit: number; group?: string; sort?: string; facets?: boolean; excerpt?: boolean }
export interface FacetResult<T extends FacetRow = FacetRow> {
  facets: QuestionFacet[];
  rows: T[];
  matched: number;
  truncated: boolean;
  groups?: QuestionGroup[];
  hint?: string;
}

/** Local sources and service-backed sources share the views' expression evaluator and facet counter. */
export function facetRows<T extends FacetRow>(all: readonly T[], request: FacetRequest, now = Date.now()): FacetResult<T> {
  const expression = request.where.trim() ? bindThis(parseQueryExpression(request.where), undefined) : undefined;
  const holds = expression && compileQueryExpression(expression, now);
  const values = (row: T, key: string) => [...(row.properties[key] ?? []), ...(key === "tag" ? row.properties.tags ?? [] : [])];
  const matched = all.filter(row => !holds || holds({ ...row, text: row.title }, Object.entries(row.properties).flatMap(([key, vs]) => vs.map(value => ({ key, value })))));
  matched.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows = matched.slice(0, request.limit);
  const known = new Set(all.flatMap(row => Object.keys(row.properties)));
  const missing = expressionPropertyKeys(expression).filter(key => !known.has(key) && !(key === "tag" && known.has("tags")));
  return {
    facets: request.facets === false ? [] : questionFacets(matched, true, values, row => Object.keys(row.properties), 1000, 1000),
    rows, matched: matched.length, truncated: rows.length < matched.length,
    ...(request.group ? { groups: questionGroups(matched, rows, request.group, values, now) } : {}),
    ...(missing.length ? { hint: missing.map(key => missingPropertyHint(key, [...known])).join(" · ") } : {}),
  };
}

/** The extension's JSON is the boundary; typed rows after this use the ordinary source contract. */
export function readFacetRows(answer: string): FacetRow[] {
  const rows: unknown = JSON.parse(answer);
  if (!Array.isArray(rows)) throw new Error("a facet source answers a JSON array of rows");
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || typeof row.title !== "string" || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string"
      || !row.properties || typeof row.properties !== "object" || Array.isArray(row.properties)
      || Object.values(row.properties).some(v => !Array.isArray(v) || v.some(x => typeof x !== "string"))) {
      throw new Error("a facet row needs id, title, createdAt, updatedAt and properties mapping keys to string arrays");
    }
    const properties: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(row.properties as Record<string, string[]>)) {
      const normalized = normalizePropertyKey(key);
      (properties[normalized] ??= []).push(...values);
    }
    row.properties = properties;
    if (row.open !== undefined && (!row.open || typeof row.open.action !== "string" || (row.open.args !== undefined && (!row.open.args || typeof row.open.args !== "object" || Array.isArray(row.open.args))))) {
      throw new Error("a facet row's open is { action, args? }");
    }
  }
  return rows;
}
