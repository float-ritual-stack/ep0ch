// The labels a tree index carries for each note (`tree.index`, `tree.query`): the one-line preview Tree and the door
// draw, where each reference in it points, and the text digest. A label is a pure function of a note's text and the
// notes it references, so `OutlinerStore` keeps them per outline (`TreeLabels`) and makes one again only when the
// text or a target changed. Which notes a tree index holds and its snapshot shape are here too.
import { literalMarkerLineRanges } from "@ep0ch/outline-core/code-ranges";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import { titlePropertyRanges } from "@ep0ch/outline-core/property-parse";
import { authoredTextDigest } from "./authored-links";
import { blockReferenceDisplayText, resolveBlockReferencesWithStatus } from "./references";
import type {
  Block,
  ResolvedBlockReferences,
  TreeIndexBlock,
  TreeIndexSnapshot,
  VisibleBlock,
  WorkspaceSnapshot,
} from "./types";

const treeLabelSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function boundedTreeLabel(text: string): string {
  if (text.length <= 512) return text;
  const boundary = treeLabelSegmenter.segment(text).containing(511)!.index;
  return `${text.slice(0, boundary)}…`;
}

/** The notes a tree index labels: every physical note, then any visible one not among them, each once. */
export function treeIndexMembers(snapshot: WorkspaceSnapshot): VisibleBlock[] {
  const members = new Map(snapshot.physical.blocks.map(block => [block.id, block]));
  for (const block of snapshot.visible.blocks) if (!members.has(block.id)) members.set(block.id, block);
  return [...members.values()];
}

export function treeIndexOf(snapshot: WorkspaceSnapshot, labels: ReadonlyMap<string, TreeIndexBlock>): TreeIndexSnapshot {
  return {
    blocks: [...labels.values()],
    physicalBlockIds: snapshot.physical.blocks.map(block => block.id),
    visible: {
      rows: snapshot.visible.blocks.map(({ id, depth, propertyMatches }) => ({
        id,
        depth,
        ...(propertyMatches ? { propertyMatches } : {}),
      })),
      completeness: snapshot.visible.completeness,
    },
    selectedBlockId: snapshot.selection.selected?.id ?? null,
    virtualOccurrenceRanks: snapshot.virtualOccurrenceRanks,
    sequence: snapshot.sequence,
    ...(snapshot.workIdPrefix ? { workIdPrefix: snapshot.workIdPrefix } : {}),
    ...(snapshot.ticketPrefixes ? { ticketPrefixes: snapshot.ticketPrefixes } : {}),
  };
}

type TreeLabel = Pick<TreeIndexBlock, "preview" | "previewReferences" | "textDigest">;
/** Per-outline labels retain their source and dependencies, so reads check source text and targets before parsing bodies. */
export type TreeLabels = Map<string, { text: string; hasProperties: boolean; dependencies: Map<string, Block | null>; label: TreeLabel }>;

export function compactTreeBlock(
  { text, displayText: _displayText, propertyMatches, ...withMatches }: VisibleBlock,
  lookup: (blockId: string) => Block | null,
  labels: TreeLabels,
): TreeIndexBlock {
  // A view that reads line chips (PIE-1277) keeps where each row matched: the door opens the row at that line.
  const metadata = propertyMatches?.some(match => match.scope !== "block") ? { ...withMatches, propertyMatches } : withMatches;
  const cached = labels.get(metadata.id);
  const hasProperties = metadata.properties.length > 0;
  if (cached && cached.text === text && cached.hasProperties === hasProperties && [...cached.dependencies].every(([id, before]) => {
    const now = lookup(id);
    return before?.text === now?.text && before?.effectiveDeletedRootId === now?.effectiveDeletedRootId;
  })) return { ...metadata, ...cached.label };
  const dependencies = new Map<string, Block | null>();
  const resolved = resolveBlockReferencesWithStatus(text, id => {
    const block = lookup(id);
    dependencies.set(id, block);
    return block;
  });
  const label = treeLabel(text, resolved, metadata);
  labels.set(metadata.id, { text, hasProperties, dependencies, label });
  return { ...metadata, ...label };
}

function treeLabel(text: string, resolved: ResolvedBlockReferences, metadata: Pick<VisibleBlock, "id" | "properties">): TreeLabel {
  let offset = 0;
  let spans = blockReferenceOccurrences(text).map((occurrence, index) => {
    const reference = resolved.references[index]!;
    const start = occurrence.start + offset;
    const end = start + blockReferenceDisplayText(reference).length;
    offset = end - occurrence.end;
    return {
      start,
      end,
      target: reference.status === "resolved" || reference.status === "deleted"
        ? { blockId: reference.blockId, ...(reference.fragmentId ? { fragmentId: reference.fragmentId } : {}) }
        : null,
    };
  });
  let title = resolved.text;
  const replaceRanges = (ranges: Array<{ start: number; end: number }>, replacement: string) => {
    const parts: string[] = [];
    let cursor = 0;
    for (const range of [...ranges, { start: title.length, end: title.length }]) {
      parts.push(title.slice(cursor, range.start));
      if (range.end > range.start) parts.push(replacement);
      cursor = range.end;
    }
    const mapPosition = (position: number): number => {
      let delta = 0;
      for (const range of ranges) {
        if (position <= range.start) break;
        if (position < range.end) return range.start + delta;
        delta += replacement.length - (range.end - range.start);
      }
      return position + delta;
    };
    spans = spans.flatMap(span => {
      const start = mapPosition(span.start);
      const end = mapPosition(span.end);
      if (start >= end) return [];
      // Removing an inner label token preserves the reference. Cutting either
      // delimiter preserves only nonactionable provenance for the visible text.
      const clipped = ranges.some(range =>
        (range.start <= span.start && span.start < range.end) ||
        (range.start < span.end && span.end <= range.end));
      return [{ start, end, target: clipped ? null : span.target }];
    });
    title = parts.join("");
  };
  // Matched literal-region marker lines are hidden in Detail, so the label skips
  // them too. They are removed with the property tokens in one pass: a region
  // stops protecting its text once a marker is gone.
  const markerLines = literalMarkerLineRanges(title);
  if (metadata.properties.length) {
    replaceRanges([
      ...titlePropertyRanges(title),
      ...markerLines,
    ].sort((left, right) => left.start - right.start), "");
    let lineStart = 0;
    for (const line of title.split("\n")) {
      if (line.trim()) {
        const start = lineStart + line.length - line.trimStart().length;
        const end = lineStart + line.trimEnd().length;
        replaceRanges([{ start: 0, end: start }, { start: end, end: title.length }], "");
        break;
      }
      lineStart += line.length + 1;
    }
    if (!title.trim()) {
      title = metadata.id;
      spans = [];
    }
  } else {
    if (markerLines.length) replaceRanges(markerLines, "");
    replaceRanges(Array.from(title.matchAll(/\r?\n/g), match => ({
      start: match.index, end: match.index + match[0].length,
    })), " ↵ ");
  }
  const preview = boundedTreeLabel(title);
  const visibleEnd = preview === title ? title.length : preview.length - 1;
  const previewReferences = spans.filter(span => span.start < visibleEnd).map(({ start, end, target }) => Object.freeze({
    start,
    end: Math.min(end, visibleEnd),
    target: end <= visibleEnd ? target : null,
  }));
  // Shared by every read that asks for this label: nobody changes it.
  return Object.freeze({
    preview,
    previewReferences: Object.freeze(previewReferences) as TreeIndexBlock["previewReferences"],
    textDigest: authoredTextDigest(text),
  });
}
