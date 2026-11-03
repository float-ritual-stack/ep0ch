import { blockDisplayTitle } from "./references";
import type { Block } from "./types";
import { BLOCK_ID_PATTERN, looksLikeBlockId } from "@ep0ch/outline-core/addressable-resource";

export const BOOKMARK_TYPE = "bookmark";
export const BOOKMARKS_SYSTEM_VIEW = "bookmarks";
const CANONICAL_BLOCK_ID_PATTERN = BLOCK_ID_PATTERN;

export interface BookmarkRecord {
  record: Block;
  targetBlockId: string;
  createdAt: string;
  label: string;
}

export interface BookmarksRoot {
  root: Block;
}

function directValues(block: Block, key: string): string[] {
  return block.properties
    .filter((property) => property.key.toLowerCase() === key)
    .map((property) => property.value.trim());
}

function exactlyOne(block: Block, key: string, kind = "Bookmark record"): string {
  const values = directValues(block, key);
  if (values.length !== 1 || !values[0]) {
    throw new Error(`${kind} ${block.id} must contain exactly one [${key}::…]`);
  }
  return values[0];
}

export function parseBookmarksRoot(block: Block): BookmarksRoot {
  const kind = "Bookmarks root";
  const type = exactlyOne(block, "type", kind).toLowerCase();
  const systemView = exactlyOne(block, "system-view", kind).toLowerCase();
  // Queries, row limits, and summary columns describe the projection, not its records.
  if (
    type !== "virtual-branch" ||
    systemView !== BOOKMARKS_SYSTEM_VIEW
  ) {
    throw new Error(`Bookmarks root ${block.id} has invalid reserved configuration`);
  }
  return { root: block };
}

/**
 * A bookmark record, checked. `write` (a record made now) wants a canonical target id; `read` (one already stored) takes
 * any UUID's shape, so an id written before the outline minted v4s still reads.
 */
export function parseBookmarkRecord(block: Block, mode: "write" | "read" = "write"): BookmarkRecord {
  const type = exactlyOne(block, "type").toLowerCase();
  if (type !== BOOKMARK_TYPE) {
    throw new Error(`Bookmark record ${block.id} has invalid type: ${type}`);
  }
  const targetBlockId = exactlyOne(block, "target");
  if (!(mode === "read" ? looksLikeBlockId(targetBlockId) : CANONICAL_BLOCK_ID_PATTERN.test(targetBlockId))) {
    throw new Error(`Bookmark record ${block.id} has invalid canonical target ID`);
  }
  const createdAt = exactlyOne(block, "bookmark-created");
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error(`Bookmark record ${block.id} has invalid bookmark-created timestamp`);
  }
  if (createdAt !== block.createdAt) {
    throw new Error(`Bookmark record ${block.id} bookmark-created must equal its canonical createdAt`);
  }
  const labels = directValues(block, "bookmark-label");
  if (labels.length > 1) {
    throw new Error(`Bookmark record ${block.id} may contain at most one [bookmark-label::…]`);
  }
  return {
    record: block,
    targetBlockId,
    createdAt,
    label: labels[0] || blockDisplayTitle(block),
  };
}

export function bookmarkRecordText(
  target: Block,
  createdAt: string,
  label?: string,
): string {
  const requestedLabel = label?.trim();
  if (requestedLabel && /[\r\n[\]]/.test(requestedLabel)) {
    throw new Error("Bookmark label cannot contain line breaks or property delimiters");
  }
  const effectiveLabel = requestedLabel || blockDisplayTitle(target);
  const labelProperty = requestedLabel ? ` [bookmark-label::${requestedLabel}]` : "";
  return `${effectiveLabel}\n[type::bookmark] [target::${target.id}] [bookmark-created::${createdAt}]${labelProperty}`;
}
