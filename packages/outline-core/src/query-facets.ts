import { QUESTION_FACET_CAP, type QuestionFacet, type QuestionGroup } from "./protocol";
import { matchesSearchText, prepareSearchQuery } from "./search-match";
import { readDate, fromWallClock, wallClock } from "./dates";
import { RECENT_BUCKETS, recentBucket } from "./date-buckets";
import { dateGroupOf, valueOrder, type DateUnit } from "./query-order";
/** A match's values for `key` (a multi-valued property gives several), as the question's property scope reads them. */
export interface FacetRecord { id: string; createdAt: string; updatedAt: string }
export type ValuesOf<T> = (row: T, key: string) => string[];

const pad = (n: number) => String(n).padStart(2, "0");

/** The bucket an ISO time falls in: `2026-10-09`, `2026-W41` (ISO week), `2026-10` or `2026`, read off the ISO as written (questionGroups hands it a block's time on this machine's wall clock); `recent`: recentBucket. */
export function dateBucket(iso: string, unit: DateUnit, now = Date.now()): string | null {
  if (unit === "recent") return recentBucket(iso, now);
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
export function questionGroups<T extends FacetRecord>(matches: readonly T[], rows: readonly T[], group: string, valuesOf: ValuesOf<T>, now = Date.now()): QuestionGroup[] {
  const [first, second] = group.split(",");
  if (second) {
    const parents = questionGroups(matches, matches, first!, valuesOf, now);
    const returned = new Set(rows.map(row => row.id));
    return parents.map(parent => {
      const members = new Set(parent.ids);
      const own = matches.filter(row => members.has(row.id));
      return { ...parent, ids: parent.ids.filter(id => returned.has(id)), groups: questionGroups(own, rows.filter(row => members.has(row.id)), second, valuesOf, now) };
    });
  }
  const date = dateGroupOf(group);
  const wall = wallClock(now);
  const keysOf = (block: T): (string | null)[] => {
    // A block's own time is bucketed by this machine's wall clock, as a property's dates are and as `today` reads (an
    // evening's edit in Toronto is that day's, not the next UTC day's).
    if (date && "field" in date) { const at = Date.parse(block[date.field]); return [Number.isFinite(at) ? dateBucket(date.unit === "recent" ? block[date.field] : new Date(wallClock(at)).toISOString(), date.unit, now) : null]; }
    if (date) {
      // A span's bucket is its first day's.
      const days = valuesOf(block, date.key).map(v => readDate(v, wall)).map(when => when && dateBucket(new Date(date.unit === "recent" ? fromWallClock(when.from) : when.from).toISOString(), date.unit, now));
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
  // Relative buckets go newest first whatever the key: the named ones in their order, then the months.
  const rank = (v: string) => { const i = (RECENT_BUCKETS as readonly string[]).indexOf(v); return i < 0 ? RECENT_BUCKETS.length : i; };
  const order = date?.unit === "recent" ? (a: string, b: string) => rank(a) - rank(b) || b.localeCompare(a) : valueOrder(date ? null : group, date && "field" in date ? -1 : 1);
  return [...groups.values()].sort((a, b) =>
    a.value === null || b.value === null ? (a.value === b.value ? 0 : a.value === null ? 1 : -1) : order(a.value, b.value));
}

/**
 * Value counts over every match: for `keys`, or (`true`) every key the matches carry. Keys by how many matches carry
 * them, then by name; values by count, then in the key's value order. At most QUESTION_FACET_CAP keys, and `valueCap` values each (QUESTION_FACET_CAP unless the question says);
 * a key's `more` says how many values were left out.
 */
export function questionFacets<T extends { updatedAt: string }>(matches: readonly T[], keys: true | readonly string[], valuesOf: ValuesOf<T>, keysOf: (block: T) => string[], valueCap = QUESTION_FACET_CAP, keyCap = QUESTION_FACET_CAP, search = ""): QuestionFacet[] {
  // One pass over the matches, each asked only for the keys it carries (PIE-1396: every key over every note took
  // seconds on pie). `tag` reads `tags` too, as block-query's tag clause does.
  const tally = new Map<string, { count: number; counts: Map<string, { n: number; last: string }> }>();
  const named = keys === true ? null : [...new Set(keys)];
  // A named key no match carries still answers, with a count of 0.
  if (named) for (const key of named) tally.set(key, { count: 0, counts: new Map() });
  const carried = keys === true ? matches.map(block => new Set(keysOf(block))) : [];
  const tagged = keys === true && carried.some(own => own.has("tag"));
  matches.forEach((block, at) => {
    let read: Iterable<string> = named ?? carried[at]!;
    if (tagged && carried[at]!.has("tags") && !carried[at]!.has("tag")) read = [...carried[at]!, "tag"];
    for (const key of read) {
      // A key a match carries answers even when none of its values are words (`[area::[]]`), with a count of 0.
      let facet = tally.get(key);
      if (!facet) tally.set(key, facet = { count: 0, counts: new Map() });
      const values = new Set(valuesOf(block, key).map(v => v.trim()).filter(Boolean));
      if (!values.size) continue;
      facet.count += 1;
      for (const value of values) {
        const seen = facet.counts.get(value);
        if (!seen) facet.counts.set(value, { n: 1, last: block.updatedAt });
        else { seen.n += 1; if (block.updatedAt > seen.last) seen.last = block.updatedAt; }
      }
    }
  });
  const words = search.split(/\s+/).filter(Boolean).map(word => prepareSearchQuery(word));
  const hits = new Map<string, boolean>();
  const hit = (value: string): boolean => {
    if (!words.length) return false;
    let found = hits.get(value);
    if (found === undefined) hits.set(value, found = words.some(word => matchesSearchText(word, [value])));
    return found;
  };
  // Keys are ranked before their values are sorted: only the keys kept pay for it.
  return [...tally].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, keyCap).map(([key, { count, counts }]): QuestionFacet => {
    const order = valueOrder(key);
    const values = [...counts].sort((a, b) => Number(hit(b[0])) - Number(hit(a[0])) || b[1].n - a[1].n || order(a[0], b[0])).map(([value, seen]) => ({ value, count: seen.n, last: seen.last }));
    return { key, count, values: values.slice(0, valueCap), ...(values.length > valueCap ? { more: values.length - valueCap } : {}) };
  });
}

