import { PROPERTY_KEY_PATTERN, propertyValueHolds } from "./property-grammar";
import type { BlockProperty } from "./protocol";
import type { PropertyRecord } from "./property-parse";
import type { PropertyFilter, PropertyQueryScope } from "./query-types";
export function normalizePropertyKey(key: string): string {
  const normalized = key.trim();
  if (!PROPERTY_KEY_PATTERN.test(normalized)) throw new Error(`Invalid property key: ${key}`);
  return normalized.toLowerCase();
}

export function matchesFilters(
  properties: readonly (BlockProperty | PropertyRecord)[],
  filters: readonly PropertyFilter[],
  propertyScope: PropertyQueryScope = "block",
): boolean {
  // Asked of every note on each query and view read: no arrays made per note.
  return filters.every((filter) =>
    properties.some(
      (property) =>
        (property.key === filter.key || filter.key === "tag" && property.key === "tags") &&
        (propertyScope === "all" || ("scope" in property ? property.scope : "block") === propertyScope) &&
        (filter.value === undefined || propertyValueHolds(property.value, filter.value)),
    )
  );
}

