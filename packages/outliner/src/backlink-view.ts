import {
  BACKLINK_SORT_ORDER, BACKLINK_STAGE_FILTERS, type BacklinkStageFilter, type BacklinkViewOptions,
} from "@ep0ch/outline-core/backlink-view";

/**
 * Presentation of a backlink collection from the service's facets: default hiding, filters, grouping by kind and
 * ordering. The computation is outline-core's (`backlink-view.ts`), shared with the door; Detail and Backlink Peek
 * use this one function so a Peek snapshot matches the panel it came from.
 */
export * from "@ep0ch/outline-core/backlink-view";

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
    // An empty list names nothing: every value, as no list.
    ...(Array.isArray(value.stages) && value.stages.every((x) => typeof x === "string") ? { stages: value.stages.length ? value.stages as string[] : null } : value.stages === null ? { stages: null } : {}),
  };
}
