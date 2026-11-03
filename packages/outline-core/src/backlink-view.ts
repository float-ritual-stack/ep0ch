import type { AwayMachine } from "./outline-away";
import { matchesSearchText, prepareSearchQuery, type SearchQuery } from "./search-match";

// Backlinks as Detail and the door present them (PIE-442, PIE-710): the service's facets (kind, stage, placement,
// resolved comment) turned into the default view: this note and its descendants hidden, resolved comments hidden,
// grouped by kind with stage counts, open items first, then by date. Pure, so Detail, Backlink Peek and the door's
// links tile compute one answer from the same sources; each client draws its own rows and status line.

export const BACKLINK_STAGE_BUCKETS = ["waiting", "draft", "active", "done"] as const;
/** Normalized lifecycle bucket; waiting, draft and active are open. */
export type BacklinkStageBucket = (typeof BACKLINK_STAGE_BUCKETS)[number];

/** The service's meaning of one source (`references.backlinks.facets`). */
export interface BacklinkSourceFacets {
  /** Stable kind key, e.g. `comment`, `day-page`, `note` or a normalized `type::` value. */
  kind: string;
  /** Human label for the kind, e.g. "Outbox item". */
  kindLabel: string;
  /** Where the source sits relative to the queried target. */
  placement: "self" | "descendant" | "other";
  /** The first configured stage property the source declares. `bucket` is absent for an unmapped value. */
  stage?: { property: string; value: string; bucket?: BacklinkStageBucket };
  /** Present for comments and replies; a reply takes its thread's lifecycle. */
  comment?: { resolved: boolean };
}

export type BacklinkReferenceGroup =
  | { kind: "block" | "page" | "work-id"; fragmentId?: string; count: number }
  | { kind: "property"; propertyKey: string; count: number };

export type BacklinkOccurrence =
  | { kind: "block" | "page" | "work-id"; fragmentId?: string; label: string; snippet: string; start: number; end: number }
  | { kind: "property"; propertyKey: string; label: string; snippet: string; start: number; end: number };

/** One source as `references.backlinks` sends it (timestamps are ISO strings). */
export interface BacklinkSource {
  outline?: string; machine?: string;
  subtitle?: string;
  blockId: string;
  title: string;
  parentContext: string;
  createdAt: string;
  updatedAt: string;
  occurrenceCount: number;
  referenceGroups: BacklinkReferenceGroup[];
  occurrences: BacklinkOccurrence[];
  occurrencesTruncated: boolean;
  deletedRootId?: string;
  /** Absent from services without `references.backlinks.facets`. */
  facets?: BacklinkSourceFacets;
}

/** A collection as the door holds it; `backlinkView` reads only `sources` (the outliner's own collection has a stricter `completeness`). */
export interface BacklinkCollection {
  away?: AwayMachine[];
  targetBlockId: string;
  targetDeletedRootId?: string;
  sources: BacklinkSource[];
  completeness: { kind: "complete" } | { kind: "truncated"; limit: number } | { kind: string; limit?: number };
}

export function isOpenBacklinkStage(bucket: BacklinkStageBucket | undefined): boolean {
  return bucket === "waiting" || bucket === "draft" || bucket === "active";
}

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
  /**
   * The stage values this list names, in order (a tile's or `::backlinks`' `stages=`), or null for every value its rows
   * carry. Rows with another value stay listed; their values are said as "other" (PIE-819).
   */
  stages?: readonly string[] | null;
}

export const DEFAULT_BACKLINK_VIEW_OPTIONS: Readonly<BacklinkViewOptions> = {
  filter: "",
  sortField: "updated",
  sortDirection: "desc",
  showRelated: false,
  showResolved: false,
  kind: null,
  stage: "all",
  stages: null,
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
export interface BacklinkStageValue { value: string; bucket?: BacklinkStageBucket; count: number; other?: true }

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
      group.kind === "property" ? group.propertyKey : `${group.kind}${group.fragmentId ? ` ^${group.fragmentId}` : ""}`
    ),
    ...source.occurrences.map((occurrence) => occurrence.snippet),
  ]);
}

function matchesStage(source: BacklinkSource, stage: BacklinkStageFilter, subset: readonly string[] | null): boolean {
  return stageMatches(source.facets?.stage, stage, subset);
}

/** Whether `value` is one the list names (`stages=`, case folded); every value is, without a list. */
export function namedStage(value: string, subset: readonly string[] | null | undefined): boolean {
  return !subset?.length || subset.some((x) => x.trim().toLowerCase() === value.trim().toLowerCase());
}

/** The Stage filter's form for a value spelled like one of its keywords (`value:open`), so each stays a choice. */
export const STAGE_VALUE = "value:";
/** The Stage filter's step for the values a list's `stages=` doesn't name. */
export const STAGE_OTHER = "other";
const STAGE_KEYWORDS: readonly string[] = ["all", "open", "other", ...BACKLINK_STAGE_BUCKETS];

/** Whether a stage (its value as written and its family) passes the Stage filter: a family's name, open, or the value itself. */
export function stageMatches(stage: { value: string; bucket?: BacklinkStageBucket } | undefined, filter: BacklinkStageFilter, subset: readonly string[] | null = null): boolean {
  const f = filter.trim().toLowerCase();
  // `other`, where the list names its values: a row whose value it doesn't name.
  if (subset?.length && f === STAGE_OTHER) return !!stage && !namedStage(stage.value, subset);
  // `value:open`: the value as written, where it's spelled like a keyword (a status `open` a rule put in done).
  if (f.startsWith(STAGE_VALUE)) return !!stage && stage.value.trim().toLowerCase() === f.slice(STAGE_VALUE.length);
  if (f === "all") return true;
  if (f === "open") return isOpenBacklinkStage(stage?.bucket);
  if ((BACKLINK_STAGE_BUCKETS as readonly string[]).includes(f)) return stage?.bucket === f;
  return !!stage && stage.value.trim().toLowerCase() === f;
}

/** Stage values in their families' order (waiting, draft, active, done, then unplaced), most first, then by name. */
export function orderStageValues(values: Iterable<BacklinkStageValue>, subset: readonly string[] | null = null): BacklinkStageValue[] {
  const rank = (b: BacklinkStageBucket | undefined) => (b ? BACKLINK_STAGE_BUCKETS.indexOf(b) : BACKLINK_STAGE_BUCKETS.length);
  const all = [...values];
  if (!subset?.length) return all.sort((a, b) => rank(a.bucket) - rank(b.bucket) || b.count - a.count || a.value.localeCompare(b.value));
  // The values the list names, in its order; then the rest, each marked other (said as "other: parked 1").
  const at = (v: BacklinkStageValue) => subset.findIndex((x) => x.trim().toLowerCase() === v.value.toLowerCase());
  const named = all.filter((v) => at(v) >= 0).sort((a, b) => at(a) - at(b));
  const rest = orderStageValues(all.filter((v) => at(v) < 0)).map((v) => ({ ...v, other: true as const }));
  return [...named, ...rest];
}

/** Count `sources`' stage values as written, one entry per value (case folded, first spelling kept). */
export function countStageValues(sources: readonly BacklinkSource[], subset: readonly string[] | null = null): BacklinkStageValue[] {
  const by = new Map<string, BacklinkStageValue>();
  for (const source of sources) {
    const stage = source.facets?.stage;
    if (!stage) continue;
    const key = stage.value.trim().toLowerCase();
    const had = by.get(key);
    if (had) had.count += 1;
    else by.set(key, { value: stage.value.trim(), ...(stage.bucket ? { bucket: stage.bucket } : {}), count: 1 });
  }
  return orderStageValues(by.values(), subset);
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
  collection: { sources: readonly BacklinkSource[] } | null,
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
    matchesStage(source, options.stage, options.stages ?? null) &&
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
    group.stageValues = countStageValues(group.sources, options.stages ?? null);
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
    stages: countStageValues(shown, options.stages ?? null),
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
export function nextBacklinkStageFilter(stage: BacklinkStageFilter, stages?: readonly { value: string; bucket?: BacklinkStageBucket; other?: true }[]): BacklinkStageFilter {
  // A value spelled like a keyword is its own choice, `value:open`, unless it is that very family (`done` in done);
  // each value once, whatever its case.
  const values = (stages ?? []).filter((x, i, all) => all.findIndex((y) => y.value.toLowerCase() === x.value.toLowerCase()) === i)
    .map((s) => {
      if (s.other) return STAGE_OTHER;
      const v = s.value.toLowerCase();
      return STAGE_KEYWORDS.includes(v) && v !== s.bucket ? `${STAGE_VALUE}${s.value}` : s.value;
    });
  const list = stages ? [...new Set(["all", "open", ...values])] : BACKLINK_STAGE_FILTERS;
  const index = list.findIndex((x) => x.toLowerCase() === stage.toLowerCase());
  return list[(index + 1) % list.length]!;
}

export function nextBacklinkKindFilter(kind: string | null, kinds: readonly { kind: string }[]): string | null {
  if (kinds.length === 0) return null;
  const index = kind === null ? -1 : kinds.findIndex((candidate) => candidate.kind === kind);
  return index + 1 < kinds.length ? kinds[index + 1]!.kind : null;
}

/** A `stages=` list as written (`next, doing, waiting`, `[next, doing]`), or null for none (every value the rows carry). */
export function stagesFrom(spec: unknown): string[] | null {
  if (Array.isArray(spec)) spec = spec.join(",");
  if (typeof spec !== "string") return null;
  const list = spec.replace(/^\s*\[|\]\s*$/g, "").split(",").map(x => x.trim()).filter(Boolean);
  return list.length && !(list.length === 1 && list[0]!.toLowerCase() === "all") ? list : null;
}
