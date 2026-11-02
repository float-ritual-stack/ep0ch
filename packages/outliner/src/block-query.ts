import { MACHINE_KEY, parseMachineryMode } from "@ep0ch/outline-core/machinery";
import { BlockQueryError, BlockQuerySyntaxError, bindThis, normalizePropertyFilter, normalizePropertyQueryScope, normalizeQueryExpression, parseSearchExpression, titleOf, type ValueBinder } from "@ep0ch/outline-core/query-expression";
import { DATE_GROUP, valueOrder } from "@ep0ch/outline-core/query-order";
import { VIEW_SORT_FIELDS } from "@ep0ch/outline-core/view-fields";
import { StillCounting } from "./site-budget";
export * from "@ep0ch/outline-core/query-expression";
export { dateGroupOf, valueOrder, type DateGroup, type DateUnit } from "@ep0ch/outline-core/query-order";

import { isPropertyKey } from "@ep0ch/outline-core/property-grammar";
import { QUESTION_DEFAULT_LIMIT, QUESTION_MAX_LIMIT } from "@ep0ch/outline-core/protocol";
import type {
  Block,
  BlockQuerySort,
  BlockSearchQuery,
  NormalizedBlockSearchQuery,
  OutlinerRequestProblem,
  PropertyFilter,
  QueryExpression
} from "./types";

export const MAX_BLOCK_QUERY_LIMIT = QUESTION_MAX_LIMIT;
/**
 * The date buckets a group can name: `created:day`, `updated:month`, and any property's (`due:week`, `sent:year`);
 * `recent` is relative to now (Today, Yesterday, Previous 7 days, Previous 30 days, then the month: PIE-1443).
 */

const GROUP_FORMS = "a property name, or a date bucket: <property>:day|week|month|year|recent (due:week), created:month or updated:recent";

/** A group as the service keeps it: a property key lowercased, or a date bucket. Throws why it can't be one. */
export function normalizeGroupField(group: unknown): string {
  if (typeof group !== "string" || !group.trim()) throw new BlockQueryError(`group is ${GROUP_FORMS}`);
  if (group.includes(",")) {
    const keys = group.split(",");
    if (keys.length !== 2) throw new BlockQueryError("group takes one or two property names, like area,owner");
    return keys.map(normalizeGroupField).join(",");
  }
  const trimmed = group.trim().toLowerCase();
  if (DATE_GROUP.test(trimmed)) return trimmed;
  const key = trimmed.startsWith(SORT_PROPERTY) ? trimmed.slice(SORT_PROPERTY.length).trim() : trimmed;
  if (!isPropertyKey(key)) {
    throw new BlockQueryError(`group is ${GROUP_FORMS} (a property name is a letter, then letters, digits, _ . or -), not ${group}`);
  }
  return key;
}

/** `"<field>[ asc|desc]"` (asc unless said) or `{ field, direction }`, checked and normalized. */
export function normalizeSort(sort: unknown, defaultDirection = "asc"): BlockQuerySort | string {
  if (typeof sort === "string" && sort.includes(",")) return sort.split(",").map(part => sortText(normalizeSort(part, defaultDirection))).join(", ");
  let field: unknown, direction: unknown;
  if (typeof sort === "string") {
    const words = sort.trim().split(/\s+/);
    if (!words[0] || words.length > 2) throw new Error(`Sort is "<property|created|updated|title>[ asc|desc]", not ${sort}`);
    field = words[0];
    direction = words[1] ?? defaultDirection;
  } else if (sort && typeof sort === "object" && !Array.isArray(sort)) {
    ({ field, direction } = sort as { field?: unknown; direction?: unknown });
  } else {
    throw new Error("Block search sort must be an object or \"<field>[ asc|desc]\"");
  }
  const normalized = normalizeSortField(field);
  if (normalized === null) throw new Error(sortFieldProblem(field));
  const dir = typeof direction === "string" ? direction.trim().toLowerCase() : direction;
  if (dir !== "asc" && dir !== "desc") {
    throw new Error(`Sort direction is asc or desc, not ${String(direction)}: asc puts the smallest first`);
  }
  return { field: normalized, direction: dir };
}

export function normalizeBlockSearchQuery(
  query: BlockSearchQuery,
  values?: ValueBinder,
): NormalizedBlockSearchQuery {
  if (!query || typeof query !== "object")
    throw new Error("Block search query is required");
  if ("expression" in query) {
    throw new Error("blocks.query's expression is now where: send { where: \"type=task\" }; a structured predicate is predicate");
  }
  if (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0)) throw new Error("Block search offset must be a non-negative integer");
  const limit = query.limit ?? QUESTION_DEFAULT_LIMIT;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_BLOCK_QUERY_LIMIT
  ) {
    throw new Error(
      `Block search limit must be an integer from 1 through ${MAX_BLOCK_QUERY_LIMIT}`,
    );
  }
  if (query.filters !== undefined && !Array.isArray(query.filters)) {
    throw new Error("Block search filters must be an array");
  }
  for (const [index, filter] of (query.filters ?? []).entries()) {
    if (
      !filter ||
      typeof filter !== "object" ||
      typeof filter.key !== "string"
    ) {
      throw new Error(`Block search filter ${index + 1} requires a string key`);
    }
    if (filter.value !== undefined && typeof filter.value !== "string") {
      throw new Error(
        `Block search filter ${index + 1} value must be a string`,
      );
    }
  }
  for (const [field, value] of [
    ["text", query.text],
    ["subtreeRootId", query.subtreeRootId],
    ["rankViewId", query.rankViewId],
    ["this", query.this],
  ] as const) {
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Block search ${field} must be a string`);
    }
  }

  if (query.where !== undefined && typeof query.where !== "string") {
    throw new Error("Block search where must be query text, like \"type=task NOT links:this\"; a structured predicate is predicate");
  }
  const thisId = query.this?.trim() || undefined;
  const parts: QueryExpression[] = [];
  // Plain clause lists keep their filter meaning, including deleted=true.
  let parsedExpression: ReturnType<typeof parseSearchExpression> | null = null;
  try {
    parsedExpression = query.where?.trim() ? parseSearchExpression(query.where) : null;
  } catch (error) {
    if (error instanceof BlockQuerySyntaxError) error.field = "where";
    throw error;
  }
  if (parsedExpression?.where) parts.push(bindThis(parsedExpression.where, thisId, values));
  if (query.predicate !== undefined) parts.push(bindThis(normalizeQueryExpression(query.predicate), thisId, values));
  const predicate = parts.length === 0 ? undefined
    : parts.length === 1 ? parts[0]! : { kind: "and" as const, operands: parts };

  const sort = query.sort === undefined ? undefined : normalizeSort(query.sort);
  const group = query.group === undefined ? undefined : normalizeGroupField(query.group);
  let facets: true | string[] | undefined;
  if (query.facets !== undefined) {
    if (query.facets === true) facets = true;
    else if (Array.isArray(query.facets) && query.facets.every(key => typeof key === "string" && isPropertyKey(key.trim().toLowerCase()))) {
      facets = [...new Set(query.facets.map(key => key.trim().toLowerCase()))];
    } else throw new BlockQueryError("facets is true (every key the matches carry) or a list of property names");
  }

  if (query.facetValues !== undefined && !(Number.isInteger(query.facetValues) && query.facetValues >= 1 && query.facetValues <= QUESTION_MAX_LIMIT)) {
    throw new BlockQueryError(`facetValues is how many values each facet lists, 1 to ${QUESTION_MAX_LIMIT}`);
  }
  if (query.facetKeys !== undefined && !(Number.isInteger(query.facetKeys) && query.facetKeys >= 1 && query.facetKeys <= QUESTION_MAX_LIMIT)) {
    throw new BlockQueryError(`facetKeys is how many keys facets lists, 1 to ${QUESTION_MAX_LIMIT}`);
  }
  if (query.facetSearch !== undefined && typeof query.facetSearch !== "string") throw new BlockQueryError("facetSearch is text to match against every value");
  const facetValues = facets && query.facetValues !== undefined ? query.facetValues : undefined;
  const facetKeys = facets && query.facetKeys !== undefined ? query.facetKeys : undefined;

  const filters: PropertyFilter[] = [];
  const seen = new Set<string>();
  let includeDeleted = query.includeDeleted;
  for (const candidate of [...(query.filters ?? []), ...(parsedExpression?.filters ?? [])]) {
    const filter = normalizePropertyFilter(candidate);
    if (filter.key === "deleted" && filter.value?.toLowerCase() === "true") {
      includeDeleted ??= "roots";
      continue;
    }
    const identity = `${filter.key}\0${filter.value === undefined ? "presence" : `value:${filter.value.toLowerCase()}`}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    filters.push(filter);
  }

  if (
    includeDeleted !== undefined &&
    includeDeleted !== "roots" &&
    includeDeleted !== "all"
  ) {
    throw new Error(`Invalid deleted-content mode: ${String(includeDeleted)}`);
  }
  const text = query.text?.trim() || undefined;
  const subtreeRootId = query.subtreeRootId?.trim() || undefined;
  const rankViewId = query.rankViewId?.trim() || undefined;
  const propertyScope = query.propertyScope === undefined
    ? undefined
    : normalizePropertyQueryScope(query.propertyScope);
  if (rankViewId && sort) {
    throw new Error("Block search cannot combine rankViewId with sorting");
  }

  // A question that names `machine` in its own clauses (`machine=echonet`, `NOT machine`) is answered as written.
  const mode = query.machinery === undefined ? undefined : parseMachineryMode(query.machinery, "machinery");
  const machinery = mode && !namesKey(predicate, filters, MACHINE_KEY) ? mode : undefined;

  return {
    ...(filters.length > 0 ? { filters } : {}),
    ...(predicate ? { predicate } : {}),
    ...(machinery ? { machinery } : {}),
    ...(machinery === "hide" && query.countMachinery === true ? { countMachinery: true } : {}),
    ...(text ? { text } : {}),
    ...(subtreeRootId ? { subtreeRootId } : {}),
    ...(rankViewId ? { rankViewId } : {}),
    ...(propertyScope ? { propertyScope } : {}),
    ...(includeDeleted ? { includeDeleted } : {}),
    ...(sort ? { sort } : {}),
    ...(group ? { group } : {}),
    ...(facets ? { facets } : {}),
    ...(facetValues ? { facetValues } : {}),
    ...(query.facetSearch ? { facetSearch: query.facetSearch } : {}),
    ...(facetKeys ? { facetKeys } : {}),
    limit,
    ...(query.offset !== undefined ? { offset: query.offset } : {}),
  };
}

/** Whether a question's own clauses name the property `key`: a presence or value clause, or a comparison. */
function namesKey(predicate: QueryExpression | undefined, filters: readonly PropertyFilter[], key: string): boolean {
  if (filters.some(filter => filter.key === key)) return true;
  const walk = (e: QueryExpression | undefined): boolean => {
    if (!e) return false;
    switch (e.kind) {
      case "property": case "compare": return e.key === key;
      case "not": return walk(e.operand);
      case "and": case "or": return e.operands.some(walk);
      default: return false;
    }
  };
  return walk(predicate);
}

const SORT_PROPERTY = "property:";

/** The sort fields that aren't properties: `property:<name>` names a property so called. */
const SORT_BUILTINS = new Set(VIEW_SORT_FIELDS.map(f => f.value));

/**
 * A sort field as the service keeps it: `created`, `updated`, `title`, a property key lowercased, or `property:<key>`
 * for a property called created, updated or title (any other `property:<key>` is just the key). Null when it is none
 * of them.
 */
export function normalizeSortField(field: unknown): string | null {
  if (typeof field !== "string") return null;
  const trimmed = field.trim().toLowerCase();
  const key = trimmed.startsWith(SORT_PROPERTY) ? trimmed.slice(SORT_PROPERTY.length).trim() : null;
  if (key !== null) return isPropertyKey(key) ? (SORT_BUILTINS.has(key) ? `${SORT_PROPERTY}${key}` : key) : null;
  return isPropertyKey(trimmed) ? trimmed : null;
}

/** Why `field` can't be a sort, with the fix: the key it seems to mean, when there is one. */
export function sortFieldProblem(field: unknown): string {
  // The key it seems to mean: the one key-like word in it (`[rank::]` means rank), kept under `property:`.
  const text = typeof field === "string" ? field.trim() : "";
  const prefixed = text.toLowerCase().startsWith(SORT_PROPERTY), rest = prefixed ? text.slice(SORT_PROPERTY.length) : text;
  const words = [...rest.matchAll(/[A-Za-z][A-Za-z0-9_.-]*/g)].map(m => m[0]);
  const meant = words.length === 1 && !/\s/.test(rest.trim()) ? `${prefixed ? SORT_PROPERTY : ""}${words[0]!.toLowerCase()}` : undefined;
  return meant
    ? `Sort by ${meant}, not ${String(field)}: a sort is created, updated, title or a property key`
    : `Sort is created, updated, title or a property key (a letter, then letters, digits, _ . or -), not ${String(field)}`;
}

/** The property key a sort field names, or null for a timestamp or title sort. */
export function sortPropertyKey(field: string): string | null {
  if (SORT_BUILTINS.has(field)) return null;
  return field.startsWith(SORT_PROPERTY) ? field.slice(SORT_PROPERTY.length) : field;
}

/**
 * A property's own value order, where a part owns the key's meaning: `work-stage` is the workboard's
 * (ROADMAP_WORK_STAGES). Any other key orders as numbers, then text.
 */
/**
 * Orders matched blocks by a normalized sort. Timestamps break ties by creation, then id. A property sort compares
 * `valueOf(block, key)` (by default its block-scoped value): decimal numbers as numbers, before any text value in
 * either direction; text without case; blocks without the property last in either direction; ties keep the order
 * they came in (outline order).
 */
export const sortParts = (sort: BlockQuerySort | string): BlockQuerySort[] => typeof sort === "string" ? sort.split(/\s*,\s*/).map(part => { const [field, direction] = part.trim().split(/\s+/); return { field: field!, direction: direction as "asc" | "desc" }; }) : [sort];
export const sortText = (sort: BlockQuerySort | string): string => typeof sort === "string" ? sort : sortParts(sort).map(s => `${s.field} ${s.direction}`).join(", ");

export function sortQueriedBlocks<T extends Pick<Block, "id" | "createdAt" | "updatedAt" | "properties"> & { text?: string }>(
  blocks: T[], sort: BlockQuerySort | string,
  valueOf: (block: T, key: string) => string | undefined = (block, key) => block.properties.find(p => p.key === key)?.value,
): void {
  const parts = sortParts(sort);
  const comparisons = parts.map(part => {
    const direction = part.direction === "asc" ? 1 : -1, key = sortPropertyKey(part.field);
    if (part.field === "title") {
      const titles = new Map(blocks.map(block => [block.id, titleOf(block.text ?? "").toLowerCase()]));
      return (left: T, right: T) => direction * titles.get(left.id)!.localeCompare(titles.get(right.id)!);
    }
    if (key === null) {
      const field = part.field === "created" ? "createdAt" : "updatedAt";
      return (left: T, right: T) => direction * left[field].localeCompare(right[field]);
    }
    const values = new Map(blocks.map(block => [block.id, valueOf(block, key)?.trim() || null])), order = valueOrder(key, direction);
    return (left: T, right: T) => {
      const a = values.get(left.id)!, b = values.get(right.id)!;
      return a === null || b === null ? a === b ? 0 : a === null ? 1 : -1 : order(a, b);
    };
  });
  blocks.sort((left, right) => {
    for (const compare of comparisons) { const order = compare(left, right); if (order) return order; }
    const first = parts[0]!;
    if (sortPropertyKey(first.field) !== null) return 0;
    return (first.field === "title" ? 0 : (first.direction === "asc" ? 1 : -1) * left.createdAt.localeCompare(right.createdAt)) || left.id.localeCompare(right.id);
  });
}

/** One page of an ordered query; the same continuation for graph and ranked reads. */
export function blockQueryPage<T>(blocks: T[], query: { limit: number; offset?: number }, counted = false) {
  const end = (query.offset ?? 0) + query.limit, more = blocks.length > end;
  return {
    blocks: blocks.slice(query.offset ?? 0, end), more,
    ...(more ? { nextOffset: end } : {}),
    completeness: more ? { kind: "truncated" as const, limit: query.limit, ...(counted ? { matched: blocks.length } : {}) } : { kind: "complete" as const },
  };
}

/**
 * Structured detail for a rejected query. A syntax position is reported only with
 * the request field it indexes; syntax errors from other text (for example a
 * saved definition) carry just the message.
 */
export function queryRequestProblem(error: unknown): OutlinerRequestProblem | undefined {
  if (error instanceof BlockQuerySyntaxError) {
    return {
      code: "query-syntax", message: error.message,
      ...(error.field ? { field: error.field, position: error.index } : {}),
    };
  }
  if (error instanceof BlockQueryError) return { code: "query-invalid", message: error.message };
  if (error instanceof StillCounting) return error.problem;
  return undefined;
}
