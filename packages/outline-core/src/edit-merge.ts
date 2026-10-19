import { parsePropertyRecords } from "./property-parse";

export interface EditHunk { start: number; end: number; text: string }
export interface EditMerge {
  text: string;
  conflicts: Array<{ local: EditHunk; latest: EditHunk }>;
  incomplete: boolean;
  propertyConflicts?: string[];
  parts?: MergePart[];
}

export interface MergeConflict {
  region_base: string;
  region_ours: string;
  region_theirs: string;
}
export type MergePart = string | MergeConflict;

/** A bounded diff never substitutes a coarser range when it runs out of work. */
export function editHunks(base: string, changed: string, words = false): EditHunk[] | null {
  const tokens = (text: string) => text.match(words
    ? /[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_]/gu
    : /[^\n]*\n|[^\n]+$/g) ?? [];
  const old = tokens(base), next = tokens(changed);
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const rows = old.length - head - tail, cols = next.length - head - tail;
  // Reuse the compare's LCS, bounded by cells rather than a coarse replacement
  // window: unchanged words must never become conflict evidence for the model.
  const width = cols + 1;
  if ((rows + 1) * width > 16_000_000) return null;
  const lcs = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      lcs[row * width + col] = old[head + row] === next[head + col]
        ? lcs[(row + 1) * width + col + 1]! + 1
        : Math.max(lcs[(row + 1) * width + col]!, lcs[row * width + col + 1]!);
    }
  }
  const result: EditHunk[] = [];
  let row = 0, col = 0, offset = old.slice(0, head).join("").length;
  let pending: EditHunk | undefined;
  while (row < rows || col < cols) {
    if (row < rows && col < cols && old[head + row] === next[head + col]) {
      if (pending) result.push(pending);
      pending = undefined;
      offset += old[head + row++]!.length;
      col++;
    } else {
      pending ??= {start: offset, end: offset, text: ""};
      if (col < cols && (row === rows || lcs[row * width + col + 1]! >= lcs[(row + 1) * width + col]!)) {
        pending.text += next[head + col++];
      } else {
        offset += old[head + row++]!.length;
        pending.end = offset;
      }
    }
  }
  if (pending) result.push(pending);
  return result;
}

function overlaps(a: EditHunk, b: EditHunk): boolean {
  // Two insertions at the same boundary have no unambiguous order. An insertion
  // on the edge of a replacement is also left for explicit review.
  if (a.start === a.end) return a.start >= b.start && a.start <= b.end;
  if (b.start === b.end) return b.start >= a.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

/** Exact text merging only. An overlap preserves the local draft for review. */
export function mergeEdits(base: string, local: string, latest: string, options: {refine?: boolean} = {}): EditMerge {
  const exact = (text: string): EditMerge => ({text, conflicts: [], incomplete: false, ...(options.refine ? {parts: [text]} : {})});
  if (local === latest || latest === base) return exact(local);
  if (local === base) return exact(latest);
  // An editor commonly adds the missing EOF line ending. Merge that exact
  // additive edit without treating indentation or Markdown hard breaks as noise.
  if (!base.endsWith("\n")) {
    for (const ending of ["\r\n", "\n"]) {
      const other = local === base + ending ? latest : latest === base + ending ? local : null;
      if (other !== null && other.startsWith(base + ending) &&
          (!other.endsWith("\n") || other.endsWith(ending))) {
        return exact(other.endsWith(ending) ? other : other + ending);
      }
    }
  }
  const properties=(text:string)=>{
    const values=new Map<string,string[]>();
    for(const record of parsePropertyRecords(text))if(record.scope==="block")values.set(record.key,[...(values.get(record.key)??[]),record.value]);
    return new Map([...values].map(([key,value])=>[key,JSON.stringify(value.sort())]));
  };
  const baseProperties=properties(base),localProperties=properties(local),latestProperties=properties(latest);
  const propertyConflicts=[...new Set([...baseProperties.keys(),...localProperties.keys(),...latestProperties.keys()])].filter(key=>
    localProperties.get(key)!==baseProperties.get(key)&&latestProperties.get(key)!==baseProperties.get(key)&&localProperties.get(key)!==latestProperties.get(key));
  const merged = combine(base, local, latest, options.refine === true);
  if (merged.incomplete) return {text: local, conflicts: [], incomplete: true};
  const conflicts = merged.conflicts;
  if (options.refine) return {text: conflicts.length ? local : merged.parts.join(""), conflicts, incomplete: false, parts: merged.parts};
  if (conflicts.length || propertyConflicts.length) return {text: local, conflicts, ...(propertyConflicts.length ? {propertyConflicts} : {}), incomplete: false};
  return {text: merged.parts.join(""), conflicts, incomplete: false};
}

/** One overlap/combine path for editor recovery and proposal resolution. Only resolution refines line conflicts. */
function combine(base: string, local: string, latest: string, refine: boolean, words = false): {parts: MergePart[]; conflicts: EditMerge["conflicts"]; incomplete: boolean} {
  const ours = editHunks(base, local, words), theirs = editHunks(base, latest, words);
  if (!ours || !theirs) return {parts: [], conflicts: [], incomplete: true};
  const changes = [
    ...ours.map(h => ({...h, side: "local" as const})),
    ...theirs.map(h => ({...h, side: "latest" as const})),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: MergePart[] = [], conflicts: EditMerge["conflicts"] = [];
  let cursor = 0;
  for (let index = 0; index < changes.length;) {
    const group = [changes[index++]!];
    while (index < changes.length && group.some(h => overlaps(h, changes[index]!))) group.push(changes[index++]!);
    const start = group[0]!.start, end = Math.max(...group.map(h => h.end));
    parts.push(base.slice(cursor, start));
    const region = base.slice(start, end);
    const version = (side: "local" | "latest") => {
      let text = region;
      for (const h of group.filter(h => h.side === side).sort((a, b) => b.start - a.start)) {
        text = text.slice(0, h.start - start) + h.text + text.slice(h.end - start);
      }
      return text;
    };
    const left = version("local"), right = version("latest");
    if (left === right) parts.push(left);
    else if (left === region) parts.push(right);
    else if (right === region) parts.push(left);
    else if (refine && !words) {
      const refined = combine(region, left, right, true, true);
      if (refined.incomplete) return refined;
      parts.push(...refined.parts);
      conflicts.push(...refined.conflicts);
    } else {
      parts.push({region_base: region, region_ours: left, region_theirs: right});
      for (const a of group.filter(h => h.side === "local")) for (const b of group.filter(h => h.side === "latest")) {
        if (overlaps(a, b) && !(a.start === b.start && a.end === b.end && a.text === b.text)) conflicts.push({local: a, latest: b});
      }
    }
    cursor = end;
  }
  parts.push(base.slice(cursor));
  return {parts, conflicts, incomplete: false};
}
