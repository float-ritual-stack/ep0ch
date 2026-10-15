// What a question answers besides its rows (ADR 0004 contract 1): its groups and facets, counted over every match,
// and the hint for a key no note carries. The service computes them once, here, so no client narrows, groups or
// counts rows itself and every terminal gets the same answer. Pure: the store passes the matches and how to read a
// match's values.
import { QUESTION_FACET_CAP, type QuestionFacet, type QuestionGroup } from "@ep0ch/outline-core/protocol";
import { readBound, readDate, readDateBound, readNumber, valueHolds, wallClock } from "@ep0ch/outline-core/dates";
import { dateGroupOf, expressionPropertyKeys, sortPropertyKey, valueOrder, type DateUnit } from "./block-query";
import type { Block, NormalizedBlockSearchQuery, QueryExpression } from "./types";

/** A match's values for `key` (a multi-valued property gives several), as the question's property scope reads them. */
export type ValuesOf = (block: Block, key: string) => string[];

const pad = (n: number) => String(n).padStart(2, "0");

/** The bucket an ISO time falls in: `2026-10-09`, `2026-W41` (ISO week), `2026-10` or `2026`, in UTC. */
export function dateBucket(iso: string, unit: DateUnit): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  if (unit === "day") return at.toISOString().slice(0, 10);
  if (unit === "month") return at.toISOString().slice(0, 7);
  if (unit === "year") return at.toISOString().slice(0, 4);
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
 * for `work-stage`, else numbers, dates, then text), matches without it last; a block's own time's buckets newest
 * first, a property's dates' (`due:week`) soonest first, with values that aren't dates in the last group (null).
 */
export function questionGroups(matches: readonly Block[], rows: readonly Block[], group: string, valuesOf: ValuesOf, now = Date.now()): QuestionGroup[] {
  const date = dateGroupOf(group);
  const wall = wallClock(now);
  const keysOf = (block: Block): (string | null)[] => {
    if (date && "field" in date) return [dateBucket(block[date.field], date.unit)];
    if (date) {
      // A span's bucket is its first day's.
      const days = valuesOf(block, date.key).map(v => readDate(v, wall)).map(when => when && dateBucket(new Date(when.from).toISOString(), date.unit));
      const buckets = [...new Set(days.filter((d): d is string => !!d))];
      return buckets.length ? buckets : [null];
    }
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
  const order = valueOrder(date ? null : group, date && "field" in date ? -1 : 1);
  return [...groups.values()].sort((a, b) =>
    a.value === null || b.value === null ? (a.value === b.value ? 0 : a.value === null ? 1 : -1) : order(a.value, b.value));
}

/**
 * Value counts over every match: for `keys`, or (`true`) every key the matches carry. Keys by how many matches carry
 * them, then by name; values by count, then in the key's value order. At most QUESTION_FACET_CAP keys, and `valueCap` values each (QUESTION_FACET_CAP unless the question says);
 * a key's `more` says how many values were left out.
 */
export function questionFacets(matches: readonly Block[], keys: true | readonly string[], valuesOf: ValuesOf, keysOf: (block: Block) => string[], valueCap = QUESTION_FACET_CAP, keyCap = QUESTION_FACET_CAP): QuestionFacet[] {
  const wanted = keys === true ? [...new Set(matches.flatMap(keysOf))] : [...keys];
  const facets = wanted.map((key): QuestionFacet => {
    const counts = new Map<string, { n: number; last: string }>();
    let count = 0;
    for (const block of matches) {
      const values = [...new Set(valuesOf(block, key).map(v => v.trim()).filter(Boolean))];
      if (!values.length) continue;
      count += 1;
      for (const value of values) {
        const seen = counts.get(value);
        if (!seen) counts.set(value, { n: 1, last: block.updatedAt });
        else { seen.n += 1; if (block.updatedAt > seen.last) seen.last = block.updatedAt; }
      }
    }
    const order = valueOrder(key);
    const values = [...counts].sort((a, b) => b[1].n - a[1].n || order(a[0], b[0])).map(([value, seen]) => ({ value, count: seen.n, last: seen.last }));
    return { key, count, values: values.slice(0, valueCap), ...(values.length > valueCap ? { more: values.length - valueCap } : {}) };
  });
  return facets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, keyCap);
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
    ...(query.group ? [((date) => !date ? query.group! : "key" in date ? date.key : null)(dateGroupOf(query.group))].filter((key): key is string => key !== null) : []),
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

/** The comparisons a question makes as dates or numbers: `due <= +3d`, `rating > 3`, `due=today` (under NOT too). */
function typedClauses(expression: QueryExpression | undefined, now: number): { key: string; kind: "date" | "number" }[] {
  if (!expression) return [];
  switch (expression.kind) {
    case "compare": {
      const bound = readBound(expression.value, now);
      return bound.kind === "text" ? [] : [{ key: expression.key, kind: bound.kind }];
    }
    case "property":
      return expression.value !== undefined && readNumber(expression.value) === null && readDateBound(expression.value, now)
        ? [{ key: expression.key, kind: "date" }] : [];
    case "not": return typedClauses(expression.operand, now);
    case "and":
    case "or": return expression.operands.flatMap(operand => typedClauses(operand, now));
    default: return [];
  }
}

/**
 * The question with each date or number comparison loosened to "has the key" (`type=plot-date due <= +3d` becomes
 * `type=plot-date due`): the notes it holds for are the ones a warning is about, never every note with the key.
 */
export function loosenTyped(expression: QueryExpression, now = Date.now(), negated = false): QueryExpression {
  const wall = wallClock(now);
  switch (expression.kind) {
    case "compare":
    case "property": {
      if (!typedClauses(expression, wall).length) return expression;
      // Under NOT it loosens to NOT key, so the NOT around it still reads "has the key".
      const has: QueryExpression = { kind: "property", key: expression.key };
      return negated ? { kind: "not", operand: has } : has;
    }
    case "not": return { kind: "not", operand: loosenTyped(expression.operand, now, !negated) };
    case "and":
    case "or": return { kind: expression.kind, operands: expression.operands.map(operand => loosenTyped(operand, now, negated)) };
    default: return expression;
  }
}

const QUOTED_MAX = 3;

/**
 * What a question compared as dates or numbers and couldn't read (PIE-769: capture is more reliable than
 * interpretation, so such a note is never refused; it just doesn't match, and the answer says so): "due: 2 notes have a
 * value that isn't a date: “Ocotber 20”, “soon”". `valuesOf` gives the values for a key of the notes the question
 * loosened (`loosenTyped`) holds for, with their ids.
 */
export function questionValueWarning(query: NormalizedBlockSearchQuery, valuesOf: (key: string) => readonly { id: string; value: string }[], now = Date.now()): string | undefined {
  const wall = wallClock(now);
  const seen = new Set<string>();
  const said: string[] = [];
  for (const { key, kind } of typedClauses(query.predicate, wall)) {
    if (seen.has(`${key}\0${kind}`)) continue;
    seen.add(`${key}\0${kind}`);
    const probe = kind === "date" ? readBound("today", wall) : readBound("0", wall);
    const unread = valuesOf(key).filter(({ value }) => value.trim() && valueHolds(value, "=", probe, wall) === null);
    if (!unread.length) continue;
    const notes = new Set(unread.map(u => u.id)).size;
    const values = [...new Set(unread.map(u => u.value.trim()))];
    const shown = values.slice(0, QUOTED_MAX).map(v => `“${v}”`).join(", ") + (values.length > QUOTED_MAX ? ` and ${values.length - QUOTED_MAX} more` : "");
    const how = kind === "date" ? "; write a date like 2026-10-20, Oct 20, 10/20 or 20 Oct (a span: 2026-10-20..2026-10-24)" : "";
    said.push(`${key}: ${notes === 1 ? "1 note has a value" : `${notes} notes have values`} that ${notes === 1 ? "isn't" : "aren't"} ${kind === "date" ? "a date" : "a number"}: ${shown}${how}`);
  }
  return said.length ? said.join(" · ") : undefined;
}
