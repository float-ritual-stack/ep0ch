import { authoredTextDigest } from "../src/authored-links";
import { firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { blockReferenceDisplayText, resolveBlockReferencesWithStatus } from "../src/references";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import type { TreeView } from "../src/tree-controller";
import type { Block, TreeIndexBlock, VisibleBlock } from "../src/types";

/** A mode's data, when the view is in that mode. */
export const menuOf = (view: TreeView) => view.mode === "action-menu" ? view.menu : undefined;
export const quickOf = (view: TreeView) => "quick" in view ? view.quick : undefined;
export const viewerOf = (view: TreeView) => view.mode === "viewer" ? view.viewer : undefined;
export const gotoOf = (view: TreeView) => view.mode === "goto" ? view.goto : undefined;

// Controller/renderer fixtures retain source documents outside their compact
// wire/view objects. Exact text is available only through their read effects.
export function treeIndexFixture(
  { text, displayText, propertyMatches: _matches, ...metadata }: VisibleBlock,
  lookup: (id: string) => Block | null,
): TreeIndexBlock {
  const title = metadata.properties.length
    ? firstLineWithoutPropertyTokens(displayText)?.trim() || metadata.id
    : displayText.replace(/\r?\n/g, " ↵ ");
  const source = metadata.properties.length
    ? firstLineWithoutPropertyTokens(text)?.trim() || metadata.id
    : text.replace(/\r?\n/g, " ↵ ");
  const occurrences = blockReferenceOccurrences(source);
  const previewEnd = title.length > 512 ? 511 : title.length;
  let offset = 0;
  const references = resolveBlockReferencesWithStatus(source, lookup).references.flatMap((reference, index) => {
    const occurrence = occurrences[index]!;
    const start = occurrence.start + offset;
    const end = start + blockReferenceDisplayText(reference).length;
    offset += end - start - (occurrence.end - occurrence.start);
    if (start >= previewEnd) return [];
    return [{
      start,
      end: Math.min(end, previewEnd),
      target: end <= previewEnd && (reference.status === "resolved" || reference.status === "deleted")
        ? { blockId: reference.blockId, ...(reference.fragmentId ? { fragmentId: reference.fragmentId } : {}) }
        : null,
    }];
  });
  return {
    ...metadata,
    preview: title.length > 512 ? `${title.slice(0, 511)}…` : title,
    previewReferences: references,
    textDigest: authoredTextDigest(text),
  };
}
