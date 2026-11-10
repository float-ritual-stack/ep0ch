// What a new roadmap item may say (`roadmap.create`, `work_create`): its priority, its starting stage, plain one-line
// text, canonical block ids for depends-on and related-to, and no property the workboard writes itself in its title
// or body. `OutlinerStore` checks a request with these before it writes the item.
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import type { RoadmapItemPriority, RoadmapWorkStage } from "./types";

export const ROADMAP_PRIORITIES: Record<RoadmapItemPriority, true> = {
  high: true,
  medium: true,
  low: true,
};
export const ROADMAP_CREATE_STAGES: Record<Exclude<RoadmapWorkStage, "done" | "superseded">, true> = {
  unprioritized: true,
  queued: true,
  doing: true,
  review: true,
  validate: true,
  later: true,
};
const RESERVED_ROADMAP_PROPERTY_KEYS: Record<string, true> = {
  type: true,
  status: true,
  priority: true,
  "work-stage": true,
  "work-batch": true,
  project: true,
  arc: true,
  track: true,
  "depends-on": true,
  "related-to": true,
  "source-block": true,
  "work-id": true,
};

const CANONICAL_BLOCK_ID_PATTERN = BLOCK_ID_PATTERN;

export function normalizeRoadmapText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must be a single printable line`);
  }
  return normalized;
}

export function normalizeRoadmapValues(values: unknown, label: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must contain at least one value`);
  }

  return [...new Set(values.map((value) => normalizeRoadmapText(value, label)))];
}

export function normalizeRoadmapRelationshipId(value: unknown, label: string): string {
  const blockId = normalizeRoadmapText(value, label);
  if (!CANONICAL_BLOCK_ID_PATTERN.test(blockId)) {
    throw new Error(`${label} must contain canonical block UUIDs: ${blockId}`);
  }
  return blockId;
}

export function normalizeRoadmapRelationshipIds(
  values: unknown,
  label: string,
): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  return [...new Set(values.map((value) => normalizeRoadmapRelationshipId(value, label)))];
}

export function assertNoReservedRoadmapProperties(title: string, body: string): void {
  const reservedProperty = parsePropertyRecords(`${title}\n${body}`).find(
    (property) => RESERVED_ROADMAP_PROPERTY_KEYS[property.key] === true,
  );
  if (reservedProperty) {
    throw new Error(
      `Roadmap title and body cannot include reserved property: ${reservedProperty.key}`,
    );
  }
}
