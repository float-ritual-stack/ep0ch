// Whether a groom may park a roadmap item (PIE-1421), the one answer the cut (work-later.ts) and `work stage … later`
// (work-tools.ts) both ask. Pure, with no imports, so the core write path can ask it without loading the groom.
import type { Block } from "./types";

const DAY = 86_400_000;
/** An item younger than this is still being shaped: never parked. */
export const KEEP_DAYS = 14;

const propOf = (b: Pick<Block, "properties">, key: string) => b.properties.find(p => p.key === key)?.value;
const clip = (text: string, max: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat; };

/**
 * Why `item` must not be parked at `at`, or null when it may be: high priority, under KEEP_DAYS old, or decided. Decided
 * is what the note itself says: a ticked `- [x]` line (Evan's tick, a settled step), a `::graph-decision` whose status
 * is decided, or a `[decided::…]` property. Pure.
 */
export function keptBecause(item: Pick<Block, "text" | "properties" | "createdAt">, at: Date | number = Date.now()): string | null {
  const priority = propOf(item, "priority")?.toLowerCase();
  if (priority && ["high", "urgent", "critical"].includes(priority)) return `${priority} priority`;
  const age = (new Date(at).getTime() - new Date(item.createdAt).getTime()) / DAY;
  if (age >= 0 && age < KEEP_DAYS) return `${Math.floor(age)} days old (under ${KEEP_DAYS})`;
  if (propOf(item, "decided") !== undefined) return `decided: ${clip(propOf(item, "decided")!, 80)}`;
  const ticked = item.text.split("\n").slice(1).find(l => /^\s*[-*+]\s+\[[xX]\]\s+\S/.test(l));
  if (ticked) return `decided: ${clip(ticked.replace(/^\s*[-*+]\s+\[[xX]\]\s+/, ""), 80)}`;
  if (/::graph-decision[\s\S]*?^status:\s*decided\b/m.test(item.text)) return "decided: a decision figure says so";
  return null;
}
