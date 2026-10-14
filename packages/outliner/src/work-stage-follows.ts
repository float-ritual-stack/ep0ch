import { parseWorkId } from "./work-ids";
import { parsePropertyRecords, patchPropertyText } from "./properties";
import type { PropertyPatchOperation, PropertyRecord } from "./types";

// What moves with a roadmap item's work-stage (PIE-844). The workboard owns `work-stage`; these are the properties
// that follow it, and the store applies them on every write, so each path that moves a stage (work complete, a
// delivery sync, the Pi extension, an edit by hand) carries them without a copy of the rule:
// - into done: `[done-at::<day>]`, the day on this machine's clock, and `[needs::sysop]` (with or without its reason)
//   comes off;
// - out of done: `done-at` comes off;
// - a block that names an item with `[ticket::PIE-n]` (a request copy) carries `[ticket-stage::<its stage>]`.

/** An owner ask: `[needs::sysop]`, or with its reason, `[needs::sysop: a taste call]`. */
const OWNER_ASK = /^sysop(?![\w-])/i;

function blockRecords(text: string): PropertyRecord[] {
  return parsePropertyRecords(text).filter((property) => property.scope === "block");
}

function first(records: readonly PropertyRecord[], key: string): string | undefined {
  return records.find((property) => property.key === key)?.value;
}

/** `text` without the block-scoped properties `holds` picks, each with one space beside it, so no gap is left. */
function removeWhere(text: string, holds: (property: PropertyRecord) => boolean): string {
  const gone = blockRecords(text).filter(holds).sort((left, right) => right.start - left.start);
  let out = text;
  for (const { start, end } of gone) {
    const [from, to] = out[start - 1] === " " ? [start - 1, end] : out[end] === " " ? [start, end + 1] : [start, end];
    out = out.slice(0, from) + out.slice(to);
  }
  return out;
}

/** `text` with one `[key::value]`: the first replaced (any further one comes off), else appended. */
function setOne(text: string, key: string, value: string): string {
  let index = 0;
  const single = removeWhere(text, (property) => property.key === key && index++ > 0);
  const found = blockRecords(single).find((property) => property.key === key);
  if (found?.value === value) return single;
  const operation: PropertyPatchOperation = found ? { op: "replace", ordinal: found.ordinal, value } : { op: "append", key, value };
  return patchPropertyText(single, [operation]);
}

export function isRoadmapItemText(text: string): boolean {
  return blockRecords(text).some((property) => property.key === "type" && property.value.toLowerCase() === "roadmap-item");
}

/** A roadmap item's work-stage, lower-cased, or null for any other block. */
export function roadmapStageOf(text: string): string | null {
  const records = blockRecords(text);
  if (!records.some((property) => property.key === "type" && property.value.toLowerCase() === "roadmap-item")) return null;
  return first(records, "work-stage")?.toLowerCase() ?? null;
}

/** The day `done-at` records for a moment: its date on this machine's clock, as `due=today` reads it. */
export function doneDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * `next` with what a stage move carries: into done it gains `[done-at::<day>]` and loses `[needs::sysop]`; out of
 * done it loses `done-at`. Unchanged when the block isn't a roadmap item or its stage didn't move.
 */
export function stageMoveText(previous: string, next: string, day: string): string {
  const now = roadmapStageOf(next);
  if (now === null) return next;
  const was = roadmapStageOf(previous);
  if (was === now) return next;
  if (now === "done") {
    return setOne(removeWhere(next, (property) => property.key === "needs" && OWNER_ASK.test(property.value.trim())), "done-at", day);
  }
  return was === "done" ? removeWhere(next, (property) => property.key === "done-at") : next;
}

/** The Work ID a block's `[ticket::…]` names (`PIE-12`, `[[PIE-12]]`), canonical, or null. */
export function ticketOf(text: string): string | null {
  const value = first(blockRecords(text), "ticket");
  if (value === undefined) return null;
  return parseWorkId(value.trim().replace(/^\[\[(.*)\]\]$/, "$1").trim())?.workId ?? null;
}

/** `text` with `[ticket-stage::<stage>]`, or without one when `stage` is null; unchanged when it already says so. */
export function ticketStageText(text: string, stage: string | null): string {
  return stage === null ? removeWhere(text, (property) => property.key === "ticket-stage") : setOne(text, "ticket-stage", stage);
}
