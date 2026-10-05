// `blocks.records` (PIE-534): blocks as records, outline-core's one shape (block-record.ts), built here from what the
// service already owns: the parser's properties and literal ranges, children in outline order, the checklist, the
// authored links and resources (`blocks.authored-links`' reading), and backlinks (`references.backlinks`' relation). Reads only.
import { blockRecord, type BlockRecord, type BlockRecordInput } from "@ep0ch/outline-core/block-record";
import { readAuthoredLinks, type AuthoredLinksDataSource } from "./authored-links";
import { checklistItems } from "./checklist-items";
import { outlinerReferenceOccurrences, type OutlinerReferenceOccurrence } from "./reference-occurrences";
import { parsePropertyRecords } from "./properties";
import { scanPropertyLiteralRanges } from "@ep0ch/outline-core/code-ranges";
import { blockDisplayTitle } from "./references";
import type { Block } from "./types";

/** At most this many ids a request. */
export const MAX_BLOCK_RECORD_IDS = 200;

export interface BlockRecordSource extends AuthoredLinksDataSource {
  children(parentId: string | null): Block[];
  backlinkSources(ids: readonly string[]): Map<string, string[]>;
}

export interface BlockRecordRead {
  records: BlockRecord[];
  unavailable: { id: string; status: "missing" | "trashed" }[];
}

/** What an occurrence names, so the places one link is written are one group. */
const occurrenceKey = (o: OutlinerReferenceOccurrence) =>
  o.kind === "block" ? `block:${o.blockId}^${o.fragmentId ?? ""}` : o.kind === "page" ? `page:${o.normalizedAddress}` : `work-id:${o.address.toUpperCase()}`;

export function readBlockRecords(source: BlockRecordSource, ids: unknown): BlockRecordRead {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BLOCK_RECORD_IDS || ids.some(id => typeof id !== "string" || !id)) {
    throw new Error(`Block records need ids: 1 through ${MAX_BLOCK_RECORD_IDS} block IDs`);
  }
  // Backlinks for every id in one pass over the outline (the relation `references.backlinks` answers one at a time).
  const asked = [...new Set(ids as string[])];
  const linking = source.backlinkSources(asked);
  const records: BlockRecord[] = [];
  const unavailable: BlockRecordRead["unavailable"] = [];
  for (const id of asked) {
    const block = source.get(id);
    if (!block) { unavailable.push({ id, status: "missing" }); continue; }
    if (block.effectiveDeletedRootId) { unavailable.push({ id, status: "trashed" }); continue; }
    const text = block.text;
    const properties = parsePropertyRecords(text);
    const truncated: string[] = [];
    const authored = readAuthoredLinks(source, id);
    const links: BlockRecordInput["links"] = [];
    const resources: BlockRecord["resources"] = [];
    if (authored.kind === "ready") {
      // Every place each link is written: the occurrences authored links read, grouped by what they name.
      const occurrences = outlinerReferenceOccurrences(text, source.workIdAllocatorStatus().prefix, properties);
      const groups = new Map<string, [number, number][]>();
      for (const o of occurrences) { const k = occurrenceKey(o); groups.set(k, [...(groups.get(k) ?? []), [o.start, o.end]]); }
      for (const e of authored.outlinks.entries) {
        const r = e.resolution;
        const first = occurrences.find(o => o.start === e.firstSpan.start);
        links.push({
          kind: e.referenceKind, text: text.slice(e.firstSpan.start, e.firstSpan.end), label: e.label, status: r.kind,
          target: r.kind === "ready" ? r.target.blockId : r.kind === "deleted" ? r.blockId : null,
          spans: first ? groups.get(occurrenceKey(first)) ?? [] : [[e.firstSpan.start, e.firstSpan.end]],
        });
      }
      for (const e of authored.resources.entries) {
        const r = e.resolution;
        resources.push({
          text: text.slice(e.firstSpan.start, e.firstSpan.end), label: e.label, status: r.kind,
          provider: r.kind === "ready" ? r.provider : null, resource: e.resourceId ?? null,
        });
      }
      if (authored.outlinks.completeness.kind !== "complete") truncated.push("links");
      if (authored.resources.completeness.kind !== "complete") truncated.push("resources");
    } else if (authored.kind === "source-too-large") truncated.push("links", "resources");
    records.push(blockRecord({
      block,
      title: blockDisplayTitle(block),
      properties,
      literal: scanPropertyLiteralRanges(text),
      children: source.children(id).map(child => child.id),
      tasks: checklistItems(text, properties).map(item => ({
        status: item.status, line: item.span.startLine, id: item.itemId ?? null,
        // The item's first line after its `[ ]`, without its `^anchor` (that is `id`).
        text: (text.slice(item.markerStart + 3).split("\n")[0] ?? "").replace(/[ \t]+\^[0-9A-Za-z_-]+[ \t]*$/, "").trim(),
      })),
      links,
      backlinks: linking.get(id) ?? [],
      resources,
      truncated,
    }));
  }
  return { records, unavailable };
}
