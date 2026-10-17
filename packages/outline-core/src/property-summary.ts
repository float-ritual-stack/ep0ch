// The one-line property summary under a note's title (Detail's, the door's reader and its lists): chosen keys in order,
// repeated values joined, `work-stage` labelled `stage`, and a roadmap item's `status` left out (its lifecycle is
// work-stage). Each client passes its own `clean` (the terminal text it draws with). Pure: no I/O.
import { propertyValueHolds } from "./property-grammar";

export const DEFAULT_PROPERTY_SUMMARY_KEYS = ["status", "work-stage", "priority", "track"] as const;

export interface PropertySummarySegment {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly plain: string;
}

/** `a, B ,a` → `["a", "b"]`; undefined stays undefined (not set), "" is an explicit empty list (no summary). */
export function parsePropertySummaryKeys(value: string | undefined | null): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const keys: string[] = [];
  for (const candidate of value.split(",")) {
    const key = candidate.trim().toLowerCase();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function propertySummarySegments(
  properties: readonly { key: string; value: string }[],
  keys: readonly string[] = DEFAULT_PROPERTY_SUMMARY_KEYS,
  clean: (text: string) => string = text => text,
): PropertySummarySegment[] {
  const roadmap = properties.some(p => p.key === "type" && propertyValueHolds(p.value, "roadmap-item"));
  return keys.filter(key => !roadmap || key !== "status").flatMap(key => {
    const values = [...new Set(properties.filter(p => p.key.toLowerCase() === key).map(p => clean(p.value)).filter(Boolean))];
    if (!values.length) return [];
    const label = key === "work-stage" ? "stage" : key;
    const value = values.join(", ");
    return [{ key, label, value, plain: `${label} ${value}` }];
  });
}
