import { PROPERTY_KEY_SOURCE } from "./property-grammar";
import { readDate, wallClock } from "./dates";
import { ROADMAP_WORK_STAGES } from "./work-stage";
export const DATE_GROUP = new RegExp(`^(${PROPERTY_KEY_SOURCE}):(day|week|month|year|recent)$`);
export type DateUnit = "day" | "week" | "month" | "year" | "recent";
/** A group's date bucket: of a block's own time (`created:month`), or of a property's dates (`due:week`, PIE-769). */
export type DateGroup = { field: "createdAt" | "updatedAt"; unit: DateUnit } | { key: string; unit: DateUnit };

/** The date bucket a group names, or null for a property. */
export function dateGroupOf(group: string): DateGroup | null {
  const match = DATE_GROUP.exec(group);
  if (!match) return null;
  const unit = match[2] as DateUnit;
  return match[1] === "created" ? { field: "createdAt", unit } : match[1] === "updated" ? { field: "updatedAt", unit } : { key: match[1]!, unit };
}

const OWNED_ORDERS: ReadonlyMap<string, readonly string[]> = new Map([["work-stage", ROADMAP_WORK_STAGES]]);

/**
 * How `key`'s values compare, `direction` 1 (asc) or -1 (desc): values in its owned order first, in that order; then
 * decimal numbers as numbers; then dates as dates, however written (outline-core `dates.ts`: `Oct 20` before
 * `2026-11-02`); then text without case. The classes keep their places in either direction; the direction orders within
 * each. A value that is empty is the caller's to place (last).
 */
export function valueOrder(key: string | null, direction: 1 | -1 = 1, now = Date.now()): (left: string, right: string) => number {
  const owned = key ? OWNED_ORDERS.get(key) : undefined;
  const wall = wallClock(now);
  const classed = (value: string): [number, number | string] => {
    const at = owned ? owned.indexOf(value.trim().toLowerCase()) : -1;
    if (at >= 0) return [0, at];
    const v = sortValue(value) ?? "";
    if (typeof v === "number") return [1, v];
    const when = readDate(value, wall);
    return when ? [2, when.from] : [3, v];
  };
  return (left, right) => {
    const [ca, a] = classed(left), [cb, b] = classed(right);
    if (ca !== cb) return ca - cb;
    return direction * (typeof a === "number" ? a - (b as number) : (a as string).localeCompare(b as string));
  };
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function sortValue(value: string | undefined): number | string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Only a decimal number is a number (0x10 and 1e3 are text).
  return DECIMAL.test(trimmed) ? Number(trimmed) : trimmed.toLowerCase();
}

