// Backlinks as Detail presents them (PIE-442): the service's facets (kind, stage, placement, resolved
// comment) turned into Detail's default view: this note and its descendants hidden, resolved comments
// hidden, grouped by kind with stage counts, open items first, then by date, and a status line that makes
// the counts add up.
//
// A mirror of pi-herdr-outliner `src/backlink-view.ts` (`backlinkView`, `backlinkGroupRows`, the sort,
// stage and kind cycles), `isOpenBacklinkStage` (`src/backlink-facets.ts`), `subsequenceScore`
// (`src/block-focus.ts`), the group-expanded rule in `src/detail-controller.ts`, and the row and status
// text in `src/detail-pi-preview.ts`, line for line, so the board's drawer shows what Detail shows.
// test/backlinks.test.ts checks it against the service's own functions. The door never derives a facet:
// against a service without them the view is one flat list, as Detail's is.

export const BACKLINK_STAGE_BUCKETS = ["waiting", "draft", "active", "done"] as const;
/** Normalized lifecycle bucket; waiting, draft and active are open. */
export type BacklinkStageBucket = (typeof BACKLINK_STAGE_BUCKETS)[number];

/** The service's meaning of one source (`references.backlinks.facets`). */
export interface BacklinkSourceFacets {
  kind: string;
  kindLabel: string;
  placement: "self" | "descendant" | "other";
  stage?: { property: string; value: string; bucket?: BacklinkStageBucket };
  comment?: { resolved: boolean };
}

export type BacklinkReferenceGroup =
  | { kind: "block" | "page" | "work-id"; count: number }
  | { kind: "property"; propertyKey: string; count: number };

export type BacklinkOccurrence =
  | { kind: "block" | "page" | "work-id"; label: string; snippet: string; start: number; end: number }
  | { kind: "property"; propertyKey: string; label: string; snippet: string; start: number; end: number };

/** One source as `references.backlinks` sends it (timestamps are ISO strings, compared as Detail compares them). */
export interface BacklinkSource {
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

export interface BacklinkCollection {
  targetBlockId: string;
  targetDeletedRootId?: string;
  sources: BacklinkSource[];
  completeness: { kind: "complete" } | { kind: "truncated"; limit: number } | { kind: string; limit?: number };
}

/** Detail and Peek read the same bounded source set so their counts agree; the door reads the same. */
export const BACKLINK_QUERY_LIMIT = 200;

export type BacklinkSortField = "updated" | "created" | "title";
export type BacklinkSortDirection = "asc" | "desc";
export type BacklinkStageFilter = "all" | "open" | BacklinkStageBucket;
export const BACKLINK_STAGE_FILTERS: readonly BacklinkStageFilter[] = ["all", "open", ...BACKLINK_STAGE_BUCKETS];
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
  openCount: number;
}

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
}

export function isOpenBacklinkStage(bucket: BacklinkStageBucket | undefined): boolean {
  return bucket === "waiting" || bucket === "draft" || bucket === "active";
}

/** The Goto search's fuzzy match (pi-herdr-outliner `subsequenceScore`); ≥ 900 counts as a match here. */
export function subsequenceScore(query: string, candidate: string): number {
  if (!query || query.length > candidate.length) return 0;
  let queryIndex = 0;
  let previousMatch = -1;
  let gaps = 0;
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) continue;
    if (previousMatch >= 0) gaps += index - previousMatch - 1;
    previousMatch = index;
    queryIndex += 1;
  }
  if (queryIndex !== query.length || gaps > query.length * 2) return 0;
  return Math.max(1, 1_000 - gaps - Math.max(0, candidate.length - query.length));
}

function normalizeFilter(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesText(source: BacklinkSource, query: string): boolean {
  if (!query) return true;
  const fields = [
    source.title,
    source.parentContext,
    source.facets?.kindLabel ?? "",
    source.facets?.stage?.value ?? "",
    ...source.referenceGroups.map(group => group.kind === "property" ? group.propertyKey : group.kind),
    ...source.occurrences.map(occurrence => occurrence.snippet),
  ].map(normalizeFilter);
  return fields.some(field => field.includes(query) || subsequenceScore(query, field) >= 900);
}

function matchesStage(source: BacklinkSource, stage: BacklinkStageFilter): boolean {
  if (stage === "all") return true;
  const bucket = source.facets?.stage?.bucket;
  return stage === "open" ? isOpenBacklinkStage(bucket) : bucket === stage;
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

export function backlinkView(collection: BacklinkCollection | null, options: Readonly<BacklinkViewOptions>): BacklinkView {
  const all = collection?.sources ?? [];
  const faceted = all.length > 0 && all.every(source => source.facets !== undefined);
  const query = normalizeFilter(options.filter);
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
    const matching = shown.filter(source => matchesText(source, query)).sort(compare);
    return { faceted, total: all.length, hiddenRelated, hiddenResolved, filtered: shown.length - matching.length, groups: [], matching, kinds: [] };
  }

  const group = (sources: readonly BacklinkSource[]): Map<string, BacklinkViewGroup> => {
    const groups = new Map<string, BacklinkViewGroup>();
    for (const source of sources) {
      const facets = source.facets!;
      let entry = groups.get(facets.kind);
      if (!entry) {
        entry = { kind: facets.kind, label: facets.kindLabel, sources: [], stageCounts: {}, openCount: 0 };
        groups.set(facets.kind, entry);
      }
      entry.sources.push(source);
      const bucket = facets.stage?.bucket;
      if (bucket) entry.stageCounts[bucket] = (entry.stageCounts[bucket] ?? 0) + 1;
      if (isOpenBacklinkStage(bucket)) entry.openCount += 1;
    }
    return groups;
  };
  const byKind = group(shown.filter(source =>
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
  for (const group of groups) group.sources.sort(compare);
  const matching = groups.flatMap(group => group.sources);
  return {
    faceted, total: all.length, hiddenRelated, hiddenResolved, filtered: shown.length - matching.length, groups, matching,
    kinds: [...group(shown).values()].sort(orderGroups).map(({ kind, label }) => ({ kind, label })),
  };
}

/** Sources that render as rows: an expanded group lists every source; a collapsed one only its open sources. */
export function backlinkGroupRows(group: BacklinkViewGroup, expanded: boolean): BacklinkSource[] {
  return expanded ? group.sources : group.sources.filter(source => isOpenBacklinkStage(source.facets?.stage?.bucket));
}

export function nextBacklinkSort(field: BacklinkSortField, direction: BacklinkSortDirection): readonly [BacklinkSortField, BacklinkSortDirection] {
  const current = BACKLINK_SORT_ORDER.findIndex(([f, d]) => f === field && d === direction);
  return BACKLINK_SORT_ORDER[(current + 1) % BACKLINK_SORT_ORDER.length]!;
}

export function nextBacklinkStageFilter(stage: BacklinkStageFilter): BacklinkStageFilter {
  const index = BACKLINK_STAGE_FILTERS.indexOf(stage);
  return BACKLINK_STAGE_FILTERS[(index + 1) % BACKLINK_STAGE_FILTERS.length]!;
}

export function nextBacklinkKindFilter(kind: string | null, kinds: readonly { kind: string }[]): string | null {
  if (kinds.length === 0) return null;
  const index = kind === null ? -1 : kinds.findIndex(candidate => candidate.kind === kind);
  return index + 1 < kinds.length ? kinds[index + 1]!.kind : null;
}

// ── Detail's panel rules (detail-controller.ts) ──────────────────────────────────────────────────────

/** A text, kind or stage filter narrows the view; then every group is open (`backlinkNarrowingActive`). */
export function backlinkNarrowingActive(options: Readonly<BacklinkViewOptions>): boolean {
  return options.filter !== "" || options.kind !== null || options.stage !== "all";
}

/** Groups start collapsed; one the reader opened, or any while narrowing, is open (`detailBacklinkGroupExpanded`). */
export function backlinkGroupExpanded(options: Readonly<BacklinkViewOptions>, expandedKinds: ReadonlySet<string>, kind: string): boolean {
  return expandedKinds.has(kind) || backlinkNarrowingActive(options);
}

// ── Detail's panel text (detail-pi-preview.ts) ───────────────────────────────────────────────────────

/** "Work ID ×2", "block reference ×1", "page link ×1", "related property ×1" (`backlinkGroupLabel`). */
export function backlinkReferenceLabel(group: BacklinkReferenceGroup): string {
  if (group.kind === "property") return `${group.propertyKey} property ×${group.count}`;
  let label = "Work ID";
  if (group.kind === "block") label = "block reference";
  else if (group.kind === "page") label = "page link";
  return `${label} ×${group.count}`;
}

/** " (2 waiting · 1 draft · 7 done)", with "N no stage" for the rest; "" for a group without stages. */
export function backlinkStageSummary(group: BacklinkViewGroup): string {
  const parts = BACKLINK_STAGE_BUCKETS.filter(bucket => group.stageCounts[bucket]).map(bucket => `${group.stageCounts[bucket]} ${bucket}`);
  if (parts.length === 0) return "";
  const staged = BACKLINK_STAGE_BUCKETS.reduce((sum, bucket) => sum + (group.stageCounts[bucket] ?? 0), 0);
  const unstaged = group.sources.length - staged;
  if (unstaged > 0) parts.push(`${unstaged} no stage`);
  return ` (${parts.join(" · ")})`;
}

/** A row's dim suffix: stage, resolved, this note, the breadcrumb, Trash, then each reference kind ×N. */
export function backlinkRowSuffix(source: BacklinkSource): string {
  const facets = source.facets;
  return [
    ...(facets?.stage ? [facets.stage.value] : []),
    ...(facets?.comment?.resolved ? ["resolved"] : []),
    ...(facets && facets.placement !== "other" ? [facets.placement === "self" ? "this note" : "inside this note"] : []),
    source.parentContext,
    ...(source.deletedRootId ? ["Trash"] : []),
    ...source.referenceGroups.map(backlinkReferenceLabel),
  ].join(" · ");
}

/** A control in the status line: clicking it (or its key) does what `control` names. */
export type BacklinkControl = "filter" | "kind" | "stage" | "resolved" | "related" | "sort";
export interface BacklinkStatusPart { text: string; control?: BacklinkControl }

/**
 * The status line, part by part, in Detail's order (`backlinkStatusLine`): the filter, "N of M match",
 * "N filtered", this note and resolved (hidden or shown), kind, stage, sort. `filter` is the text being
 * typed while the filter is open. Against a service without facets it says nothing is grouped.
 */
export function backlinkStatusParts(view: BacklinkView, options: Readonly<BacklinkViewOptions>, filter = options.filter): BacklinkStatusPart[] {
  const direction = options.sortDirection === "asc" ? "↑" : "↓";
  const sort = options.sortField === "created" ? "Created" : options.sortField === "title" ? "Title" : "Updated";
  // Sources that match, not rows shown: a collapsed group folds its done rows.
  const parts: BacklinkStatusPart[] = [{ text: `${view.matching.length} of ${view.total} match` }];
  if (filter) parts.unshift({ text: `Filter: ${filter}`, control: "filter" });
  if (view.filtered) parts.push({ text: `${view.filtered} filtered` });
  if (view.faceted) {
    if (view.hiddenRelated) parts.push({ text: `${view.hiddenRelated} this note hidden`, control: "related" });
    else if (options.showRelated) parts.push({ text: "this note shown", control: "related" });
    if (view.hiddenResolved) parts.push({ text: `${view.hiddenResolved} resolved hidden`, control: "resolved" });
    else if (options.showResolved) parts.push({ text: "resolved shown", control: "resolved" });
    const kind = view.kinds.find(candidate => candidate.kind === options.kind)?.label ?? options.kind;
    parts.push({ text: `Kind: ${kind ?? "all"}`, control: "kind" });
    parts.push({ text: `Stage: ${options.stage}`, control: "stage" });
  } else if (view.total > 0) {
    // The door's own words: Detail's panel shows nothing here, but the drawer used to look the same.
    parts.push({ text: "not grouped: this service sends no facets" });
  }
  parts.push({ text: `Sort: ${sort} ${direction}`, control: "sort" });
  return parts;
}

/** Fit `title — suffix` into `columns`, shortening the suffix before the title (`fitBacklinkRow`). */
export function fitBacklinkRow(title: string, suffix: string, columns: number): { title: string; suffix: string } {
  const separator = 3;
  const titleWidth = cells(title);
  const suffixWidth = cells(suffix);
  if (!suffix || titleWidth + separator + suffixWidth <= columns) return { title: fitColumns(title, columns), suffix };
  const room = columns - separator;
  if (room < 12) return { title: fitColumns(title, columns), suffix: "" };
  const suffixMinimum = Math.min(suffixWidth, Math.max(8, Math.floor(room * 0.35)));
  const fittedTitle = fitColumns(title, room - suffixMinimum);
  return { title: fittedTitle, suffix: fitColumns(suffix, room - cells(fittedTitle)) };
}

const cells = (s: string) => [...s].length;
function fitColumns(text: string, columns: number): string {
  const n = Math.max(1, columns), chars = [...text];
  return chars.length <= n ? text : chars.slice(0, n - 1).join("") + "…";
}

// ── the door's rows ──────────────────────────────────────────────────────────────────────────────────

/** A row as drawn: a kind group's header, or a source. A flat view (no facets) has only sources. */
export type BacklinkRow =
  | { kind: "group"; group: BacklinkViewGroup; expanded: boolean }
  | { kind: "source"; source: BacklinkSource };

/** Rows in display order, as Detail's panel lays them out (`detailBacklinkSections`). */
export function backlinkRows(view: BacklinkView, options: Readonly<BacklinkViewOptions>, expandedKinds: ReadonlySet<string>): BacklinkRow[] {
  if (!view.faceted) return view.matching.map(source => ({ kind: "source", source }));
  return view.groups.flatMap(group => {
    const expanded = backlinkGroupExpanded(options, expandedKinds, group.kind);
    return [{ kind: "group", group, expanded } as BacklinkRow, ...backlinkGroupRows(group, expanded).map(source => ({ kind: "source", source }) as BacklinkRow)];
  });
}

// ── what `peek` and the `backlinks` action report ───────────────────────────────────────────────────

/** The view in words and ids, for `peek` and agents: the status line, the groups, and each row as drawn. */
export function describeBacklinkView(view: BacklinkView, options: Readonly<BacklinkViewOptions>, expandedKinds: ReadonlySet<string>, selected?: number) {
  const rows = backlinkRows(view, options, expandedKinds);
  return {
    faceted: view.faceted,
    status: backlinkStatusParts(view, options).map(p => p.text).join(" · "),
    total: view.total, matching: view.matching.length, hiddenRelated: view.hiddenRelated, hiddenResolved: view.hiddenResolved, filtered: view.filtered,
    options: { ...options },
    kinds: view.kinds.map(k => k.kind),
    groups: view.groups.map(g => ({ kind: g.kind, label: g.label, count: g.sources.length, open: g.openCount, stages: { ...g.stageCounts }, expanded: backlinkGroupExpanded(options, expandedKinds, g.kind) })),
    rows: rows.map((r, i) => ({
      ...(r.kind === "group"
        ? { group: r.group.kind, text: `${r.expanded ? "−" : "+"} ${r.group.label} ${r.group.sources.length}${backlinkStageSummary(r.group)}` }
        : { id: r.source.blockId, text: `${r.source.title} — ${backlinkRowSuffix(r.source)}`, kind: r.source.facets?.kind, stage: r.source.facets?.stage?.bucket }),
      ...(i === selected ? { selected: true } : {}),
    })),
  };
}

/**
 * Options named on the wire (`backlinks filter=… kind=… stage=… resolved=… related=… sort=…`) over `base`.
 * `sort` is a field (updated, created, title: its usual direction) or field-direction (`title-desc`);
 * `kind` is a kind or its label, or `all`. Throws with the reason for anything else.
 */
export function backlinkOptionsFrom(base: Readonly<BacklinkViewOptions>, args: { filter?: string; kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string }, kinds: readonly { kind: string; label: string }[]): BacklinkViewOptions {
  const o = { ...base };
  if (args.filter !== undefined) o.filter = args.filter.trim();
  if (args.kind !== undefined) {
    const want = args.kind.trim().toLowerCase();
    if (want === "all" || want === "") o.kind = null;
    else {
      const k = kinds.find(k => k.kind.toLowerCase() === want || k.label.toLowerCase() === want);
      if (!k) throw new Error(`no ${args.kind} among these backlinks; kinds: ${kinds.map(k => k.kind).join(", ") || "none (no facets, or nothing shown)"}`);
      o.kind = k.kind;
    }
  }
  if (args.stage !== undefined) {
    if (!BACKLINK_STAGE_FILTERS.includes(args.stage as BacklinkStageFilter)) throw new Error(`stage is one of ${BACKLINK_STAGE_FILTERS.join(", ")}, not ${args.stage}`);
    o.stage = args.stage as BacklinkStageFilter;
  }
  if (args.resolved !== undefined) o.showResolved = args.resolved;
  if (args.related !== undefined) o.showRelated = args.related;
  if (args.sort !== undefined) {
    const [field, dir] = args.sort.trim().toLowerCase().split(/[-\s]+/);
    const pick = BACKLINK_SORT_ORDER.find(([f, d]) => f === field && (dir ? d === dir : true));
    if (!pick) throw new Error(`sort is updated, created or title, optionally -asc or -desc, not ${args.sort}`);
    [o.sortField, o.sortDirection] = pick;
  }
  return o;
}
