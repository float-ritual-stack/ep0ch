import { firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import { headedTitle, workIdOf } from "@ep0ch/outline-core/work-id-title";
import { resolveFragment, stripFragmentAnchors } from "./fragments";
import { textMemo } from "./text-memo";
import type {
  Block,
  BlockReferenceResolution,
  ResolvedBlockReferences,
} from "./types";

export function blockReferenceDisplayText(reference: BlockReferenceResolution): string {
  const fragment = reference.fragmentId ? `^${reference.fragmentId}` : "";
  if (reference.status === "missing") {
    return `((${reference.blockId}${fragment}${reference.label !== undefined ? `|${reference.label}` : ""}))`;
  }
  const title = (reference.outline ? `${reference.outline} · ` : "") + (reference.label ?? reference.title ?? reference.blockId);
  const label = `${title}${reference.label === undefined ? fragment : ""}`;
  const suffix = reference.status === "deleted" ? " · Trash"
    : reference.status === "stale" ? " · Missing fragment"
    : reference.status === "duplicate" ? " · Duplicate fragment" : "";
  return `((${label}${suffix}))`;
}

// Asked for every reference of every note on each tree read, view and query: once per text.
export const displayTitleOfText = textMemo((text: string): string | undefined =>
  firstLineWithoutPropertyTokens(stripFragmentAnchors(text))?.replace(/\s{2,}/g, " ").trim() || undefined);

export function blockDisplayTitle(block: Block): string {
  return displayTitleOfText(block.text) ?? block.id;
}

/** A block's name where a list draws it (search, backlinks): its Work ID first, said once (outline-core's headedTitle, PIE-1356). */
export function blockHeadedTitle(block: Block): string {
  return headedTitle(blockDisplayTitle(block), workIdOf(block));
}

export function resolveBlockReferencesWithStatus(
  text: string,
  lookup: (blockId: string, outline?: string) => Block | null,
): ResolvedBlockReferences {
  const references: BlockReferenceResolution[] = [];
  let resolved = "";
  let cursor = 0;
  for (const { blockId, outline, fragmentId, label, start, end } of blockReferenceOccurrences(text)) {
    const block = lookup(blockId, outline);
    let status: BlockReferenceResolution["status"] = block ? "resolved" : "missing";
    if (block?.effectiveDeletedRootId) status = "deleted";
    else if (block && fragmentId) {
      const fragment = resolveFragment(block.text, fragmentId);
      if (fragment.status !== "resolved") status = fragment.status === "missing" ? "stale" : "duplicate";
    }
    const resolution: BlockReferenceResolution = {
      blockId: block?.id ?? blockId,
      ...(outline ? { requestedOutline: outline, outline } : {}),
      ...(fragmentId ? { fragmentId } : {}),
      ...(label !== undefined ? { label } : {}),
      status,
      ...(block ? { title: blockDisplayTitle(block) } : {}),
      ...(block?.effectiveDeletedRootId ? { deletionRootId: block.effectiveDeletedRootId } : {}),
    };
    references.push(resolution);
    resolved += text.slice(cursor, start) + blockReferenceDisplayText(resolution);
    cursor = end;
  }
  return { text: resolved + text.slice(cursor), references };
}

export function resolveBlockReferences(
  text: string,
  lookup: (blockId: string, outline?: string) => Block | null,
): string {
  return resolveBlockReferencesWithStatus(text, lookup).text;
}
