// The property summary line: the segments are outline-core's (property-summary.ts); this binds them to the sysop
// console's terminal text cleaning.
import { propertySummarySegments as segments, type PropertySummarySegment } from "@ep0ch/outline-core/property-summary";
import { sanitizeDynamicText } from "./terminal";
import type { BlockProperty } from "./types";

export { DEFAULT_PROPERTY_SUMMARY_KEYS, parsePropertySummaryKeys, type PropertySummarySegment } from "@ep0ch/outline-core/property-summary";

export const propertySummarySegments = (properties: readonly BlockProperty[], keys?: readonly string[]): PropertySummarySegment[] =>
  segments(properties, keys, sanitizeDynamicText);
