import { normalizePropertyFilter } from "./block-query";
import { createHash, randomBytes } from "node:crypto";
import { fragmentAnchors } from "./fragments";
import { markdownListItems } from "./markdown-structure";
import { matchesFilters, parsePropertyRecords } from "./properties";
import type { ChecklistIdentityChange, ChecklistItem, ChecklistQuery, ChecklistStatus, ChecklistUpdateInput, PropertyRecord } from "./types";
import { boxStatus, CHECKLIST_MARKS, CHECKLIST_STATUSES, isChecklistStatus, STEP_BOX_CHARS } from "@ep0ch/outline-core/checklist-marks";
import { figureSteps } from "@ep0ch/outline-core/figure-props";

// The box grammar is outline-core's (checklist-marks.ts, PIE-811): read here, written back canonical.
export { CHECKLIST_MARKS };

function requireStatus(value: unknown): asserts value is ChecklistStatus {
  if (!isChecklistStatus(value)) throw new Error(`Checklist status must be ${CHECKLIST_STATUSES.join(", ")}`);
}

const STEP_MARK = new RegExp(`^([ \\t]*(?:[-+*]|\\d+[.)])[ \\t]+)\\[([${STEP_BOX_CHARS}])\\](?=[ \\t\\r\\n]|$)`);

/**
 * Parse actual Markdown list nodes, never legends, fences or checkbox-shaped prose. `figures` (PIE-864): a
 * `::graph-check` figure's rows with a box are steps too (`figure: true`), each one line, never given an id: a figure's
 * lines keep their text as written, so a status change rewrites only the box. Off for the readers that address steps by id.
 */
export function checklistItems(text: string, properties = parsePropertyRecords(text), { figures = false }: { figures?: boolean } = {}): ChecklistItem[] {
  const listed = listChecklistItems(text, properties);
  if (!figures || !text.includes("::graph-check")) return listed;
  return [...listed, ...figureChecklistItems(text, properties)].sort((a, b) => a.span.start - b.span.start);
}

/** A `::graph-check` figure's rows with a box, as steps (outline-core's figureSteps finds them). */
function figureChecklistItems(text: string, properties: PropertyRecord[]): ChecklistItem[] {
  const lines = text.split("\n"), starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) starts.push(at);
  return figureSteps(lines).map(({ line, box }) => {
    const source = lines[line]!.replace(/\r$/, ""), start = starts[line]!, end = start + source.length;
    return {
      identity: "unassigned" as const, status: boxStatus(source.slice(box, box + 3))!, figure: true as const,
      evidence: createHash("sha256").update(source.trimEnd()).digest("hex"),
      span: { start, end, startLine: line, endLine: line }, markerStart: start + box,
      depth: Math.floor(source.replace(/\t/g, "  ").search(/\S/) / 2), text: source.trimEnd(),
      properties: properties.filter(property => property.start >= start && property.end <= end),
    };
  });
}

function listChecklistItems(text: string, properties: PropertyRecord[]): ChecklistItem[] {
  const lists = markdownListItems(text);
  const anchors = fragmentAnchors(text);
  const anchorByLine = new Map(anchors.filter(anchor => anchor.kind === "list-item").map(anchor => [anchor.lineIndex, anchor]));
  const counts = new Map<string, number>();
  for (const anchor of anchors) counts.set(anchor.id, (counts.get(anchor.id) ?? 0) + 1);
  const items: ChecklistItem[] = [];
  for (const list of lists) {
    const source = text.slice(list.span.start, list.span.end);
    const mark = STEP_MARK.exec(source);
    if (!mark) continue;
    const status = boxStatus(mark[2]!)!;
    const anchor = anchorByLine.get(list.span.startLine);
    // A nested plain list also owns its properties; do not leak them into an ancestor task.
    const children = lists.filter(child => child.parentStart === list.span.start);
    const ownProperties = properties.filter(property => property.start >= list.span.start && property.end <= list.span.end &&
      !children.some(child => property.start >= child.span.start && property.start < child.span.end));
    items.push({
      ...list,
      ...(anchor ? {itemId: anchor.id} : {}),
      identity: !anchor ? "unassigned" : counts.get(anchor.id) === 1 ? "unique" : "duplicate",
      status,
      evidence: createHash("sha256").update(source.trimEnd()).digest("hex"),
      markerStart: list.span.start + mark[1]!.length,
      text: source.trimEnd(),
      properties: ownProperties,
    });
  }
  return items;
}

export function queryChecklistItems(text: string, query: ChecklistQuery, properties: PropertyRecord[], options: { figures?: boolean } = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new Error("Checklist query is required");
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000) {
    throw new Error("Checklist query limit must be between 1 and 1000");
  }
  if (query.nested !== undefined && query.nested !== "include" && query.nested !== "top-level") {
    throw new Error("Checklist nested mode must be include or top-level");
  }
  for (const statuses of [query.statuses, query.excludeStatuses]) {
    if (statuses !== undefined && !Array.isArray(statuses)) throw new Error("Checklist statuses must be an array");
    for (const status of statuses ?? []) requireStatus(status);
  }
  if (query.filters !== undefined && !Array.isArray(query.filters)) throw new Error("Checklist filters must be an array");
  const filters = (query.filters ?? []).map(normalizePropertyFilter);
  const matches = checklistItems(text, properties, options).filter(item =>
    (query.nested !== "top-level" || item.depth === 0) &&
    (!query.statuses || query.statuses.includes(item.status)) &&
    !query.excludeStatuses?.includes(item.status) &&
    // The marker owns status, even if the item contains conflicting status prose/metadata.
    matchesFilters([...item.properties.filter(property => property.key !== "status"),
      {key: "status", value: item.status}], filters, "all"));
  return {
    items: matches.slice(0, query.limit),
    completeness: matches.length > query.limit
      ? {kind: "truncated" as const, limit: query.limit} : {kind: "complete" as const},
  };
}

const SHORT_ID_PREFIX = "t-";
const SHORT_ID_LENGTH = 6;

/**
 * A short generated item ID, unique among all anchors in the note. On collision the
 * same random hex is extended one digit at a time, so IDs stay short and readable.
 */
export function shortChecklistItemId(usedIds: ReadonlySet<string>, random = () => randomBytes(16).toString("hex")): string {
  for (;;) {
    const hex = random();
    for (let length = SHORT_ID_LENGTH; length <= hex.length; length++) {
      const candidate = `${SHORT_ID_PREFIX}${hex.slice(0, length)}`;
      if (!usedIds.has(candidate)) return candidate;
    }
  }
}

/** Produces a minimal source edit after checking the current item, not the whole-note hash. */
export function updateChecklistText(text: string, revision: number, input: ChecklistUpdateInput,
  random?: () => string): {text: string; itemId?: string; start: number} {
  if (!input || typeof input !== "object") throw new Error("Checklist update input is required");
  const target = input.target;
  if (!target || typeof target !== "object") throw new Error("Checklist update target is required");
  const items = checklistItems(text, undefined, {figures: true});
  let item: ChecklistItem | undefined;
  if ("itemId" in target) {
    const matches = items.filter(candidate => candidate.itemId === target.itemId);
    if (matches.length > 1 || matches[0]?.identity === "duplicate") throw new Error(`Duplicate checklist item ID: ${target.itemId}`);
    item = matches[0];
  } else {
    // Missing or malformed coordinates are caller errors, not evidence of a concurrent edit.
    if (target.start === undefined) throw new Error("Checklist target.start is required to address an unassigned item; use the start returned by checklist.query");
    if (!Number.isSafeInteger(target.start) || target.start < 0) throw new Error("Checklist target.start must be a non-negative integer");
    if (target.expectedRevision === undefined) throw new Error("Checklist target.expectedRevision is required to address an unassigned item; use the revision returned by checklist.query");
    if (target.expectedRevision !== revision) {
      throw new Error("Checklist location changed; query the current note before addressing an unassigned item");
    }
    item = items.find(candidate => candidate.span.start === target.start);
  }
  if (!item) throw new Error("Checklist item is missing; query the current note before retrying");
  if (item.identity === "duplicate") throw new Error(`Duplicate checklist item ID: ${item.itemId}`);
  if (item.evidence !== input.expectedEvidence) throw new Error("Checklist item changed; query and review the current item before retrying");
  if (input.change.kind !== "ensure-id" && input.change.kind !== "status") throw new Error("Unknown checklist change");
  if (input.change.kind === "status") requireStatus(input.change.status);
  if (item.figure) {
    // A figure's row keeps its line as written (no anchor): only its box changes, and it's addressed by where it starts.
    if (input.change.kind === "ensure-id") throw new Error("A ::graph-check row can't take an id of its own: its figure's lines stay as written. Link the figure (an anchor after its ::), or make the row a checklist step");
    return {text: text.slice(0, item.markerStart) + CHECKLIST_MARKS[input.change.status] + text.slice(item.markerStart + 3), start: item.span.start};
  }
  let next = text;
  const usedIds = new Set(fragmentAnchors(text).map(anchor => anchor.id));
  let itemId = item.itemId;
  if (!itemId) {
    itemId = shortChecklistItemId(usedIds, random);
    const newline = text.indexOf("\n", item.span.start);
    const end = newline < 0 ? text.length : newline;
    const header = text.slice(item.span.start, end);
    const insertion = item.span.start + header.trimEnd().length;
    next = text.slice(0, insertion) + ` ^${itemId}` + text.slice(insertion);
  }
  if (input.change.kind === "status") {
    next = next.slice(0, item.markerStart) + CHECKLIST_MARKS[input.change.status] + next.slice(item.markerStart + 3);
  }
  return {text: next, itemId, start: item.span.start};
}

/** Whole-note writes must not silently discard list-item addresses used by links and comments. */
export function removedListItemIds(before: string, after: string): string[] {
  if (!before.includes("^")) return [];
  const next = new Set(fragmentAnchors(after).filter(anchor => anchor.kind === "list-item").map(anchor => anchor.id));
  return [...new Set(fragmentAnchors(before).filter(anchor => anchor.kind === "list-item" && !next.has(anchor.id)).map(anchor => anchor.id))];
}

export function validateChecklistIdentityChanges(before: string, after: string, changes: readonly ChecklistIdentityChange[] = []): void {
  if (!Array.isArray(changes)) throw new Error("identityChanges must be an array");
  if (!before.includes("^") && !after.includes("^") && changes.length === 0) return;
  const previous = fragmentAnchors(before);
  const next = fragmentAnchors(after);
  const nextListIds = new Set(next.filter(anchor => anchor.kind === "list-item").map(anchor => anchor.id));
  const previousIds = new Set(previous.filter(anchor => anchor.kind === "list-item").map(anchor => anchor.id));
  const nextCounts = new Map<string, number>();
  for (const anchor of next) nextCounts.set(anchor.id, (nextCounts.get(anchor.id) ?? 0) + 1);
  const listIds = new Set([...previousIds, ...next.filter(anchor => anchor.kind === "list-item").map(anchor => anchor.id)]);
  const duplicated = [...listIds].filter(id => (nextCounts.get(id) ?? 0) > 1);
  if (duplicated.length) throw new Error(`Duplicate list-item IDs: ${duplicated.join(", ")}. Give each item its own ID before saving.`);
  const declared = new Set<string>();
  const destinations = new Set<string>();
  for (const change of changes) {
    if (!change || (change.kind !== "remove" && change.kind !== "rename") ||
      !previousIds.has(change.itemId) || declared.has(change.itemId)) {
      throw new Error("Each identityChanges entry must name one existing list-item ID exactly once");
    }
    if (nextListIds.has(change.itemId)) throw new Error(`Identity change declared but ^${change.itemId} is still present`);
    if (change.kind === "rename") {
      if (!nextListIds.has(change.to) || nextCounts.get(change.to) !== 1 || previous.some(anchor => anchor.id === change.to) || destinations.has(change.to)) {
        throw new Error(`Identity rename for ^${change.itemId} must name one new, unique destination ID`);
      }
      destinations.add(change.to);
    }
    declared.add(change.itemId);
  }
  const missing = [...previousIds].filter(id => !nextListIds.has(id) && !declared.has(id));
  if (missing.length) throw new Error(
    `List-item IDs would be removed: ${missing.map(id => `^${id}`).join(", ")}. ` +
    "Links, embeds and comments using these addresses may become unresolved. Preserve the IDs, or declare each intentional remove/rename in identityChanges with the current block revision.",
  );
}
