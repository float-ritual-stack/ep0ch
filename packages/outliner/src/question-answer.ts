export { dateBucket, questionFacets, questionGroups } from "@ep0ch/outline-core/query-facets";
export { RECENT_BUCKETS, recentBucket };
export type ValuesOf = import("@ep0ch/outline-core/query-facets").ValuesOf<Block>;
import { missingPropertyHint, missingWorkIdHint } from "@ep0ch/outline-core/property-hint";
import { expressionWorkIds, WORK_ID_KEY } from "@ep0ch/outline-core/query-expression";
// Service hints read the same query keys as the shared counter; the store supplies values in the requested scope.
import { RECENT_BUCKETS, recentBucket } from "@ep0ch/outline-core/date-buckets";
import { readBound, readDateBound, readNumber, valueHolds, wallClock } from "@ep0ch/outline-core/dates";
import { dateGroupOf, expressionPropertyKeys, sortParts, sortPropertyKey } from "./block-query";
import type { Block, NormalizedBlockSearchQuery, QueryExpression } from "./types";

/** The keys a question names: its clauses' (under NOT too), its group's, its sort's and its facets'. */
export function questionKeys(query: NormalizedBlockSearchQuery): string[] {
  const keys = [
    ...(query.filters ?? []).map(filter => filter.key),
    ...expressionPropertyKeys(query.predicate),
    ...(query.group?.split(",").map(group => { const date = dateGroupOf(group); return !date ? group : "key" in date ? date.key : null; }).filter((key): key is string => key !== null) ?? []),
    ...(query.sort ? sortParts(query.sort).map(s => sortPropertyKey(s.field)).filter((key): key is string => key !== null) : []),
    ...(Array.isArray(query.facets) ? query.facets : []),
  ];
  return [...new Set(keys.filter(key => key !== "deleted"))];
}

/**
 * "no notes have <key>; nearest: <keys>" for each key the question names that no block in the outline carries
 * (`known`), the three nearest by spelling; undefined when every key is carried. A known key with no matches is no hint.
 */
export function questionHint(query: NormalizedBlockSearchQuery, known: ReadonlySet<string>): string | undefined {
  const missing = questionKeys(query).filter(key => !known.has(key) && !(key === "tag" && known.has("tags")));
  if (!missing.length) return undefined;
  return missing.map(key => missingPropertyHint(key, [...known])).join(" · ");
}

/**
 * For a question that answered nothing: each Work ID it asked for by its item (`work-id=PIE-587`, or bare) that no item
 * has (`has`), named with the clause it was read as (PIE-1682), so an empty answer never reads as "no such key".
 */
export function questionWorkIdHint(query: NormalizedBlockSearchQuery, has: (workId: string) => boolean): string | undefined {
  const asked = [...(query.filters ?? []).flatMap(f => f.key === WORK_ID_KEY && f.value !== undefined ? [f.value] : []), ...expressionWorkIds(query.predicate)];
  return missingWorkIdHint([...new Set(asked)].filter(id => !has(id)));
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
