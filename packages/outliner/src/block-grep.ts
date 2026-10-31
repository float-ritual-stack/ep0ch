import type { GrepQuery, GrepResult } from "@ep0ch/outline-core/text-search";
import { blockDisplayTitle } from "./references";
import type { Block } from "./types";

/** The service scans liveBlocks once, in outline and source-line order. No implicit result cap. */
export function grepBlocks(blocks: readonly Block[], query: GrepQuery): GrepResult {
  if (typeof query.pattern !== "string") throw new Error("blocks.grep needs a regex pattern, for example { pattern: \"seed.*packet\" }");
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1)) throw new Error("blocks.grep limit must be a positive integer");
  if (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0)) throw new Error("blocks.grep offset must be a non-negative integer");
  const pattern = new RegExp(query.pattern, query.flags ?? "");
  const matches: GrepResult["matches"] = [], offset = query.offset ?? 0;
  let skipped = 0;
  for (const block of blocks) {
    const lines = block.text.split("\n");
    let title: string | undefined;
    for (let index = 0; index < lines.length; index++) {
      pattern.lastIndex = 0;
      if (!pattern.test(lines[index]!)) continue;
      if (skipped++ < offset) continue;
      if (query.limit !== undefined && matches.length === query.limit) return { matches, more: true, nextOffset: offset + matches.length };
      title ??= blockDisplayTitle(block);
      matches.push({ id: block.id, title, line: index + 1, text: lines[index]! });
    }
  }
  return { matches, more: false };
}
