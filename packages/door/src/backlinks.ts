import { drawEllipsized, width } from "./style";
import {
  BACKLINK_SORT_ORDER, BACKLINK_STAGE_FILTERS, backlinkReferenceLabel, backlinkView, backlinkGroupRows, stagesFrom, type BacklinkSource, type BacklinkView, type BacklinkViewGroup,
  type BacklinkViewOptions, type BacklinkStageValue,
} from "@ep0ch/outline-core/backlink-view";

// Backlinks as Detail presents them (PIE-442): the computation (`backlinkView`, the sort, stage and kind cycles) is
// outline-core's `backlink-view.ts`, the one copy Detail and the door share; this file is the door's presentation of
// it: Detail's panel rules and text (`src/detail-controller.ts`, `src/detail-pi-preview.ts`), the door's rows and
// what `peek` reports. The door never derives a facet: against a service without them the view is one flat list.

export * from "@ep0ch/outline-core/backlink-view";


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

/**
 * " (1 open · 2 answered)": each stage value as the notes write it (PIE-819), families in order; "" for a group
 * without stages. A value the outline's rules don't place is named too, never lumped as "no stage".
 */
export function backlinkStageSummary(group: BacklinkViewGroup): string {
  const named = group.stageValues.filter(v => !v.other), other = group.stageValues.filter(v => v.other);
  // The values a list's `stages=` doesn't name: said once, as "other: parked 1, told 2" (PIE-819), never hidden.
  const parts = [...named.map(v => `${v.count} ${v.value}`), ...(other.length ? [`other: ${other.map(v => `${v.value} ${v.count}`).join(", ")}`] : [])];
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

/** A collapsed group's rows are its open sources: how many more it holds, said on its header (`· 2 more`). */
export function backlinkGroupHidden(group: BacklinkViewGroup, expanded: boolean): number {
  return expanded ? 0 : group.sources.length - backlinkGroupRows(group, false).length;
}

/** A row's dim suffix: stage, resolved, this note, the breadcrumb, Trash, then each reference kind ×N. */
export function backlinkRowSuffix(source: BacklinkSource, where = ""): string {
  const facets = source.facets;
  return [
    ...(facets?.stage ? [facets.stage.value] : []),
    ...(facets?.comment?.resolved ? ["resolved"] : []),
    ...(facets && facets.placement !== "other" ? [facets.placement === "self" ? "this note" : "inside this note"] : []),
    // The line that links here and its anchor (PIE-884), after the facts about the note and before where it sits.
    ...(where ? [where] : []),
    source.parentContext,
    ...(source.deletedRootId ? ["Trash"] : []),
    ...source.referenceGroups.map(backlinkReferenceLabel),
  ].join(" · ");
}

/** A control in the status line: clicking it (or its key) does what `control` names. */
/** `groups`: the links tile's counters, a click on which chooses the groups it lists (PIE-693; the door's own, Detail has no groups). */
export type BacklinkControl = "filter" | "kind" | "stage" | "resolved" | "related" | "sort" | "groups";
/** `slot`: where the links tile places it (src/desk/backlinks-pane.ts): counts, the groups' counts, the filter, a control, or a note. */
export interface BacklinkStatusPart { text: string; control?: BacklinkControl; slot?: "count" | "by" | "filter" | "kind" | "stage" | "sort" | "note" }

/**
 * How the filters narrowed all three groups of the links tile (src/links.ts `linkAcross`): the counts the status
 * line reports, group by group (null: that group isn't there or isn't read), and the kinds present in any.
 */
export interface BacklinkAcross {
  matching: number; total: number; filtered: number;
  /** Each group listed (a group the list doesn't show has no key): its counts, or null while it isn't read. */
  by: Partial<Record<"outlinks" | "resources" | "backlinks" | "children" | "matches" | "parents", { matching: number; total: number; filtered: number } | null>>;
  kinds: Array<{ kind: string; label: string }>;
  /** The stage values present anywhere, as written, families in order (the Stage filter's choices, PIE-819). */
  stages: BacklinkStageValue[];
}
/** "→2/21 ♦0/2 ←3/8 ↓1/4": matching of all, per group listed (… while a group isn't read). */
export function acrossWords(a: BacklinkAcross): string {
  const marks = [["outlinks", "→"], ["resources", "♦"], ["backlinks", "←"], ["children", "↓"], ["matches", "≡"], ["parents", "↑"]] as const;
  return marks.filter(([g]) => g in a.by).map(([g, mark]) => { const x = a.by[g]; return `${mark}${x ? `${x.matching}/${x.total}` : "…"}`; }).join(" ");
}

/**
 * The status line, part by part, in Detail's order (`backlinkStatusLine`): the filter, "N of M match",
 * "N filtered", this note and resolved (hidden or shown), kind, stage, sort. `filter` is the text being
 * typed while the filter is open. Against a service without facets it says nothing is grouped.
 */
export function backlinkStatusParts(view: BacklinkView, options: Readonly<BacklinkViewOptions>, filter = options.filter, across?: BacklinkAcross): BacklinkStatusPart[] {
  const direction = options.sortDirection === "asc" ? "↑" : "↓";
  const sort = options.sortField === "created" ? "Created" : options.sortField === "title" ? "Title" : "Updated";
  // Sources that match, not rows shown: a collapsed group folds its done rows.
  // Across all three groups of the links tile when it says so; the backlinks alone otherwise (Detail's).
  const matching = across?.matching ?? view.matching.length, total = across?.total ?? view.total, filtered = across?.filtered ?? view.filtered;
  const parts: BacklinkStatusPart[] = [{ text: `${matching} of ${total} match`, slot: "count" }];
  if (across) parts.push({ text: acrossWords(across), slot: "by" });
  if (filter) parts.unshift({ text: `Filter: ${filter}`, control: "filter", slot: "filter" });
  if (filtered) parts.push({ text: `${filtered} filtered`, slot: "note" });
  if (view.faceted || (across && across.kinds.length > 0)) {
    if (view.hiddenRelated) parts.push({ text: `${view.hiddenRelated} this note hidden`, control: "related", slot: "note" });
    else if (options.showRelated) parts.push({ text: "this note shown", control: "related", slot: "note" });
    if (view.hiddenResolved) parts.push({ text: `${view.hiddenResolved} resolved hidden`, control: "resolved", slot: "note" });
    else if (options.showResolved) parts.push({ text: "resolved shown", control: "resolved", slot: "note" });
    const kind = (across?.kinds ?? view.kinds).find(candidate => candidate.kind === options.kind)?.label ?? options.kind;
    parts.push({ text: `Kind: ${kind ?? "all"}`, control: "kind", slot: "kind" });
    parts.push({ text: `Stage: ${options.stage}`, control: "stage", slot: "stage" });
  } else if (view.total > 0) {
    // The door's own words: Detail's panel shows nothing here.
    parts.push({ text: "not grouped: this service sends no facets", slot: "note" });
  }
  parts.push({ text: `Sort: ${sort} ${direction}`, control: "sort", slot: "sort" });
  return parts;
}

/** Fit `title — suffix` into `columns` (terminal cells, where Detail counts characters), shortening the suffix before the title (`fitBacklinkRow`). */
export function fitBacklinkRow(title: string, suffix: string, columns: number): { title: string; suffix: string } {
  const separator = 3;
  const titleWidth = width(title);
  const suffixWidth = width(suffix);
  if (!suffix || titleWidth + separator + suffixWidth <= columns) return { title: fitColumns(title, columns), suffix };
  const room = columns - separator;
  if (room < 12) return { title: fitColumns(title, columns), suffix: "" };
  const suffixMinimum = Math.min(suffixWidth, Math.max(8, Math.floor(room * 0.35)));
  const fittedTitle = fitColumns(title, room - suffixMinimum);
  return { title: fittedTitle, suffix: fitColumns(suffix, room - width(fittedTitle)) };
}

const fitColumns = (text: string, columns: number) => drawEllipsized(text, Math.max(1, columns));

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
export function describeBacklinkView(view: BacklinkView, options: Readonly<BacklinkViewOptions>, expandedKinds: ReadonlySet<string>, selected?: number, across?: BacklinkAcross) {
  const rows = backlinkRows(view, options, expandedKinds);
  return {
    faceted: view.faceted,
    status: backlinkStatusParts(view, options, options.filter, across).map(p => p.text).join(" · "),
    total: across?.total ?? view.total, matching: across?.matching ?? view.matching.length, hiddenRelated: view.hiddenRelated, hiddenResolved: view.hiddenResolved, filtered: across?.filtered ?? view.filtered,
    ...(across ? { across: across.by } : {}),
    options: { ...options },
    kinds: (across?.kinds ?? view.kinds).map(k => k.kind),
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
export function backlinkOptionsFrom(base: Readonly<BacklinkViewOptions>, args: { filter?: string; kind?: string; stage?: string; stages?: string; resolved?: boolean; related?: boolean; sort?: string }, kinds: readonly { kind: string; label: string }[]): BacklinkViewOptions {
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
  // The values the list names (`stages=next,doing,waiting`; `all` or empty: every value its rows carry).
  if (args.stages !== undefined) o.stages = stagesFrom(args.stages);
  if (args.stage !== undefined) {
    // A family, open, all, or a value as the notes write it (PIE-819: properties are open).
    if (!args.stage.trim()) throw new Error(`stage is ${BACKLINK_STAGE_FILTERS.join(", ")} or a stage value as the notes write it`);
    o.stage = args.stage.trim();
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

/**
 * Why an agent may not fold or open a group of links: which groups are folded is the person's view of a links list. (A
 * note's own sections are another thing: `fold text=` folds one for someone, in a reader they aren't typing in.)
 */
export const LINK_GROUPS_ARE_THE_PERSONS = "which link groups are folded is the person's view (a note's sections an agent may fold: fold text=) · an agent reads every row with backlinks.view or peek";
