// What a question answers besides its rows (ADR 0004 contract 1): its groups and facets, counted over every match,
// and the hint for a key no note carries. The service computes them once, here, so no client narrows, groups or
// counts rows itself and every terminal gets the same answer. Pure: the store passes the matches and how to read a
// match's values.
import { QUESTION_FACET_CAP, type QuestionFacet, type QuestionGroup } from "@ep0ch/outline-core/protocol";
import { dateGroupOf, expressionPropertyKeys, sortPropertyKey, valueOrder } from "./block-query";
import type { Block, NormalizedBlockSearchQuery } from "./types";

/** A match's values for `key` (a multi-valued property gives several), as the question's property scope reads them. */
export type ValuesOf = (block: Block, key: string) => string[];

const pad = (n: number) => String(n).padStart(2, "0");

/** The bucket an ISO time falls in: `2026-10-09`, `2026-W41` (ISO week) or `2026-10`, in UTC. */
export function dateBucket(iso: string, unit: "day" | "week" | "month"): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  if (unit === "day") return at.toISOString().slice(0, 10);
  if (unit === "month") return at.toISOString().slice(0, 7);
  // ISO week: the week with the year's first Thursday is week 1.
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${pad(week)}`;
}

/**
 * The groups of `matches` by `group` (a property, or a date bucket): each value's count over every match and the ids of
 * `rows` (the matches returned) in it, in the rows' order. A property's groups are in its value order (the workboard's
 * for `work-stage`, else numbers, then text), matches without it last; date buckets newest first.
 */
export function questionGroups(matches: readonly Block[], rows: readonly Block[], group: string, valuesOf: ValuesOf): QuestionGroup[] {
  const date = dateGroupOf(group);
  const keysOf = (block: Block): (string | null)[] => {
    if (date) return [dateBucket(block[date.field], date.unit)];
    const values = [...new Set(valuesOf(block, group).map(v => v.trim()).filter(Boolean))];
    return values.length ? values : [null];
  };
  const groups = new Map<string | null, QuestionGroup>();
  const at = (value: string | null) => {
    let g = groups.get(value);
    if (!g) groups.set(value, g = { value, count: 0, ids: [] });
    return g;
  };
  for (const block of matches) for (const value of keysOf(block)) at(value).count += 1;
  for (const block of rows) for (const value of keysOf(block)) at(value).ids.push(block.id);
  const order = valueOrder(date ? null : group, date ? -1 : 1);
  return [...groups.values()].sort((a, b) =>
    a.value === null || b.value === null ? (a.value === b.value ? 0 : a.value === null ? 1 : -1) : order(a.value, b.value));
}

/**
 * Value counts over every match: for `keys`, or (`true`) every key the matches carry. Keys by how many matches carry
 * them, then by name; values by count, then in the key's value order. At most QUESTION_FACET_CAP keys and values each;
 * a key's `more` says how many values were left out.
 */
export function questionFacets(matches: readonly Block[], keys: true | readonly string[], valuesOf: ValuesOf, keysOf: (block: Block) => string[]): QuestionFacet[] {
  const wanted = keys === true ? [...new Set(matches.flatMap(keysOf))] : [...keys];
  const facets = wanted.map((key): QuestionFacet => {
    const counts = new Map<string, number>();
    let count = 0;
    for (const block of matches) {
      const values = [...new Set(valuesOf(block, key).map(v => v.trim()).filter(Boolean))];
      if (!values.length) continue;
      count += 1;
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const order = valueOrder(key);
    const values = [...counts].sort((a, b) => b[1] - a[1] || order(a[0], b[0])).map(([value, n]) => ({ value, count: n }));
    return { key, count, values: values.slice(0, QUESTION_FACET_CAP), ...(values.length > QUESTION_FACET_CAP ? { more: values.length - QUESTION_FACET_CAP } : {}) };
  });
  return facets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, QUESTION_FACET_CAP);
}

/** Edit distance, for the nearest keys a hint names. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length]!;
}

/** The keys a question names: its clauses' (under NOT too), its group's, its sort's and its facets'. */
export function questionKeys(query: NormalizedBlockSearchQuery): string[] {
  const keys = [
    ...(query.filters ?? []).map(filter => filter.key),
    ...expressionPropertyKeys(query.predicate),
    ...(query.group && !dateGroupOf(query.group) ? [query.group] : []),
    ...(query.sort ? [sortPropertyKey(query.sort.field)].filter((key): key is string => key !== null) : []),
    ...(Array.isArray(query.facets) ? query.facets : []),
  ];
  return [...new Set(keys.filter(key => key !== "deleted"))];
}

/**
 * "no notes have <key>; nearest: <keys>" for each key the question names that no block in the outline carries
 * (`known`), the three nearest by spelling; undefined when every key is carried. A known key with no matches is no hint.
 */
export function questionHint(query: NormalizedBlockSearchQuery, known: ReadonlySet<string>): string | undefined {
  const missing = questionKeys(query).filter(key => !known.has(key));
  if (!missing.length) return undefined;
  return missing.map(key => {
    const nearest = [...known].map(k => ({ k, d: distance(key, k) })).sort((a, b) => a.d - b.d || a.k.localeCompare(b.k)).slice(0, 3).map(x => x.k);
    return `no notes have ${key}${nearest.length ? `; nearest: ${nearest.join(", ")}` : ""}`;
  }).join(" · ");
}
