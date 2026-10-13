import { isOpenBacklinkStage } from "./backlink-facets";
import { matchesSearchText, prepareSearchQuery, type SearchQuery } from "@ep0ch/outline-core/search-match";
import {
  BACKLINK_STAGE_BUCKETS,
  type BacklinkCollection,
  type BacklinkSource,
  type BacklinkStageBucket,
} from "./types";

/**
 * Presentation of a backlink collection from the service's facets: default
 * hiding, filters, grouping by kind and ordering. Detail and Backlink Peek use
 * this one function so a Peek snapshot matches the panel it came from.
 */

/** Detail and Peek read the same bounded source set so their counts agree. */
export const BACKLINK_QUERY_LIMIT = 200;

export type BacklinkSortField = "updated" | "created" | "title";
export type BacklinkSortDirection = "asc" | "desc";
/**
 * The Stage filter (PIE-819): `all`, `open` (any value in an open family), a family (`waiting`, `draft`, `active`,
 * `done`), or a value as the notes write it (`answered`), matched case-insensitively.
 */
export type BacklinkStageFilter = string;
export const BACKLINK_STAGE_FILTERS: readonly BacklinkStageFilter[] = [
  "all",
  "open",
  ...BACKLINK_STAGE_BUCKETS,
];
export const BACKLINK_SORT_ORDER: ReadonlyArray<readonly [BacklinkSortField, BacklinkSortDirection]> = [
  ["updated", "desc"],
  ["updated", "asc"],
  ["created", "desc"],
  ["created", "asc"],
  ["title", "asc"],
  ["title", "desc"],
];

export interface BacklinkViewOptions {
  filter: string;
  sortField: BacklinkSortField;
  sortDirection: BacklinkSortDirection;
  /** Show the target itself and its descendants. */
  showRelated: boolean;
  /** Show resolved comments and replies in resolved threads. */
  showResolved: boolean;
  /** Only this kind, or every kind. */
  kind: string | null;
  stage: BacklinkStageFilter;
}

export const DEFAULT_BACKLINK_VIEW_OPTIONS: Readonly<BacklinkViewOptions> = {
  filter: "",
  sortField: "updated",
  sortDirection: "desc",
  showRelated: false,
  showResolved: false,
  kind: null,
  stage: "all",
};

export type BacklinkStageCounts = Partial<Record<BacklinkStageBucket, number>>;

export interface BacklinkViewGroup {
  kind: string;
  label: string;
  /** Every matching source in the group, open first, then by the chosen sort. */
  sources: BacklinkSource[];
  stageCounts: BacklinkStageCounts;
  /** Each stage value its sources carry, as written (first spelling seen), with its family and count (PIE-819). */
  stageValues: BacklinkStageValue[];
  openCount: number;
}

/** A stage value as the notes write it, its family (none when the outline's rules don't place it) and how many carry it. */
export interface BacklinkStageValue { value: string; bucket?: BacklinkStageBucket; count: number }

export interface BacklinkView {
  /** False when the service returned no facets; the view is then one flat list. */
  faceted: boolean;
  total: number;
  /** Sources hidden by default rules, reported so the counts add up. */
  hiddenRelated: number;
  hiddenResolved: number;
  /** Sources excluded by the text, kind or stage filter. */
  filtered: number;
  groups: BacklinkViewGroup[];
  /** Matching sources in display order: groups in order, each group's sources in order. */
  matching: BacklinkSource[];
  /** Kinds present after default hiding, in group order, for the kind toggle. */
  kinds: Array<{ kind: string; label: string }>;
  /** Stage values present after default hiding, families in order, for the Stage filter (PIE-819: what the rows have). */
  stages: BacklinkStageValue[];
}

function matchesText(source: BacklinkSource, query: SearchQuery | null): boolean {
  return matchesSearchText(query, [
    source.title,
    source.parentContext,
    source.facets?.kindLabel ?? "",
    source.facets?.stage?.value ?? "",
    ...source.referenceGroups.map((group) =>
      group.kind === "property" ? group.propertyKey : group.kind
    ),
    ...source.occurrences.map((occurrence) => occurrence.snippet),
  ]);
}

function matchesStage(source: BacklinkSource, stage: BacklinkStageFilter): boolean {
  return stageMatches(source.facets?.stage, stage);
}

/** The Stage filter's form for a value spelled like one of its keywords (`value:open`), so each stays a choice. */
export const STAGE_VALUE = "value:";
const STAGE_KEYWORDS: readonly string[] = ["all", "open", ...BACKLINK_STAGE_BUCKETS];

/** Whether a stage (its value as written and its family) passes the Stage filter: a family's name, open, or the value itself. */
export function stageMatches(stage: { value: string; bucket?: BacklinkStageBucket } | undefined, filter: BacklinkStageFilter): boolean {
  const f = filter.trim().toLowerCase();
  // `value:open`: the value as written, where it's spelled like a keyword (a status `open` a rule put in done).
  if (f.startsWith(STAGE_VALUE)) return !!stage && stage.value.trim().toLowerCase() === f.slice(STAGE_VALUE.length);
  if (f === "all") return true;
  if (f === "open") return isOpenBacklinkStage(stage?.bucket);
  if ((BACKLINK_STAGE_BUCKETS as readonly string[]).includes(f)) return stage?.bucket === f;
  return !!stage && stage.value.trim().toLowerCase() === f;
}

/** Stage values in their families' order (waiting, draft, active, done, then unplaced), most first, then by name. */
export function orderStageValues(values: Iterable<BacklinkStageValue>): BacklinkStageValue[] {
  const rank = (b: BacklinkStageBucket | undefined) => (b ? BACKLINK_STAGE_BUCKETS.indexOf(b) : BACKLINK_STAGE_BUCKETS.length);
  return [...values].sort((a, b) => rank(a.bucket) - rank(b.bucket) || b.count - a.count || a.value.localeCompare(b.value));
}

/** Count `sources`' stage values as written, one entry per value (case folded, first spelling kept). */
function countStageValues(sources: readonly BacklinkSource[]): BacklinkStageValue[] {
  const by = new Map<string, BacklinkStageValue>();
  for (const source of sources) {
    const stage = source.facets?.stage;
    if (!stage) continue;
    const key = stage.value.trim().toLowerCase();
    const had = by.get(key);
    if (had) had.count += 1;
    else by.set(key, { value: stage.value.trim(), ...(stage.bucket ? { bucket: stage.bucket } : {}), count: 1 });
  }
  return orderStageValues(by.values());
}

function compareSources(options: BacklinkViewOptions, faceted: boolean) {
  const direction = options.sortDirection === "asc" ? 1 : -1;
  const field = options.sortField;
  return (left: BacklinkSource, right: BacklinkSource): number => {
    if (faceted) {
      const open = Number(isOpenBacklinkStage(right.facets?.stage?.bucket)) -
        Number(isOpenBacklinkStage(left.facets?.stage?.bucket));
      if (open) return open;
    }
    const primary = field === "title"
      ? left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      : left[field === "created" ? "createdAt" : "updatedAt"]
        .localeCompare(right[field === "created" ? "createdAt" : "updatedAt"]);
    return direction * primary ||
      left.title.localeCompare(right.title) ||
      left.blockId.localeCompare(right.blockId);
  };
}

export function backlinkView(
  collection: BacklinkCollection | null,
  options: Readonly<BacklinkViewOptions>,
): BacklinkView {
  const all = collection?.sources ?? [];
  const faceted = all.length > 0 && all.every((source) => source.facets !== undefined);
  const query = prepareSearchQuery(options.filter);
  let hiddenRelated = 0;
  let hiddenResolved = 0;
  const shown: BacklinkSource[] = [];
  for (const source of all) {
    if (faceted && !options.showRelated && source.facets!.placement !== "other") hiddenRelated += 1;
    else if (faceted && !options.showResolved && source.facets!.comment?.resolved) hiddenResolved += 1;
    else shown.push(source);
  }
  const compare = compareSources(options, faceted);
  if (!faceted) {
    const matching = shown.filter((source) => matchesText(source, query)).sort(compare);
    return {
      faceted,
      total: all.length,
      hiddenRelated,
      hiddenResolved,
      filtered: shown.length - matching.length,
      groups: [],
      matching,
      kinds: [],
      stages: [],
    };
  }

  const group = (sources: readonly BacklinkSource[]): Map<string, BacklinkViewGroup> => {
    const groups = new Map<string, BacklinkViewGroup>();
    for (const source of sources) {
      const facets = source.facets!;
      let entry = groups.get(facets.kind);
      if (!entry) {
        entry = { kind: facets.kind, label: facets.kindLabel, sources: [], stageCounts: {}, stageValues: [], openCount: 0 };
        groups.set(facets.kind, entry);
      }
      entry.sources.push(source);
      const bucket = facets.stage?.bucket;
      if (bucket) entry.stageCounts[bucket] = (entry.stageCounts[bucket] ?? 0) + 1;
      if (isOpenBacklinkStage(bucket)) entry.openCount += 1;
    }
    return groups;
  };
  const byKind = group(shown.filter((source) =>
    (options.kind === null || source.facets!.kind === options.kind) &&
    matchesStage(source, options.stage) &&
    matchesText(source, query)
  ));
  const latest = (group: BacklinkViewGroup): string =>
    group.sources.reduce((max, source) => source.updatedAt > max ? source.updatedAt : max, "");
  const orderGroups = (left: BacklinkViewGroup, right: BacklinkViewGroup): number =>
    Number(right.openCount > 0) - Number(left.openCount > 0) ||
    latest(right).localeCompare(latest(left)) ||
    left.label.localeCompare(right.label);
  const groups = [...byKind.values()].sort(orderGroups);
  for (const group of groups) {
    group.sources.sort(compare);
    group.stageValues = countStageValues(group.sources);
  }
  const matching = groups.flatMap((group) => group.sources);
  return {
    faceted,
    total: all.length,
    hiddenRelated,
    hiddenResolved,
    filtered: shown.length - matching.length,
    groups,
    matching,
    kinds: [...group(shown).values()].sort(orderGroups).map(({ kind, label }) => ({ kind, label })),
    stages: countStageValues(shown),
  };
}

/** Sources that render as rows: an expanded group lists every source; a collapsed one only its open sources. */
export function backlinkGroupRows(group: BacklinkViewGroup, expanded: boolean): BacklinkSource[] {
  return expanded
    ? group.sources
    : group.sources.filter((source) => isOpenBacklinkStage(source.facets?.stage?.bucket));
}

export function nextBacklinkSort(
  field: BacklinkSortField,
  direction: BacklinkSortDirection,
): readonly [BacklinkSortField, BacklinkSortDirection] {
  const current = BACKLINK_SORT_ORDER.findIndex(([candidateField, candidateDirection]) =>
    candidateField === field && candidateDirection === direction
  );
  return BACKLINK_SORT_ORDER[(current + 1) % BACKLINK_SORT_ORDER.length]!;
}

/**
 * The Stage filter's next step: all, open, then each value the rows actually have (`stages`, PIE-819: facets, not a
 * fixed list), round again. Without `stages`, the families (all, open, waiting, draft, active, done).
 */
export function nextBacklinkStageFilter(stage: BacklinkStageFilter, stages?: readonly { value: string; bucket?: BacklinkStageBucket }[]): BacklinkStageFilter {
  // A value spelled like a keyword is its own choice, `value:open`, unless it is that very family (`done` in done);
  // each value once, whatever its case.
  const values = (stages ?? []).filter((x, i, all) => all.findIndex((y) => y.value.toLowerCase() === x.value.toLowerCase()) === i)
    .map((s) => {
      const v = s.value.toLowerCase();
      return STAGE_KEYWORDS.includes(v) && v !== s.bucket ? `${STAGE_VALUE}${s.value}` : s.value;
    });
  const list = stages ? ["all", "open", ...values] : BACKLINK_STAGE_FILTERS;
  const index = list.findIndex((x) => x.toLowerCase() === stage.toLowerCase());
  return list[(index + 1) % list.length]!;
}

export function nextBacklinkKindFilter(kind: string | null, kinds: readonly { kind: string }[]): string | null {
  if (kinds.length === 0) return null;
  const index = kind === null ? -1 : kinds.findIndex((candidate) => candidate.kind === kind);
  return index + 1 < kinds.length ? kinds[index + 1]!.kind : null;
}

/** Validates options carried across a process boundary (Backlink Peek's launch). */
export function parseBacklinkViewOptions(input: unknown): BacklinkViewOptions {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Backlink view options must be an object");
  }
  const value = input as Record<string, unknown>;
  const sort = BACKLINK_SORT_ORDER.find(([field, direction]) =>
    field === value.sortField && direction === value.sortDirection
  );
  if (!sort) throw new Error("Backlink sort must be updated, created or title with asc or desc");
  if (typeof value.filter !== "string") throw new Error("Backlink filter must be text");
  if (typeof value.showRelated !== "boolean" || typeof value.showResolved !== "boolean") {
    throw new Error("Backlink showRelated and showResolved must be booleans");
  }
  if (value.kind !== null && typeof value.kind !== "string") throw new Error("Backlink kind must be text or null");
  if (typeof value.stage !== "string" || !value.stage.trim()) {
    throw new Error(`Backlink stage must be ${BACKLINK_STAGE_FILTERS.join(", ")} or a stage value as written`);
  }
  return {
    filter: value.filter,
    sortField: sort[0],
    sortDirection: sort[1],
    showRelated: value.showRelated,
    showResolved: value.showResolved,
    kind: value.kind as string | null,
    stage: value.stage as BacklinkStageFilter,
  };
}
