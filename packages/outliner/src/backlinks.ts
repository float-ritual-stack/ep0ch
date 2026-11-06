import type { SiteValue } from "@ep0ch/outline-core/site";
import { subtitleOf } from "@ep0ch/outline-core/block-record";
import {
  backlinkSourceFacets,
  DEFAULT_BACKLINK_FACET_RULES,
  type BacklinkFacetRules,
} from "./backlink-facets";
import { normalizePageAddress } from "@ep0ch/outline-core/link-syntax";
import { maskOutputRegions } from "@ep0ch/outline-core/output-region";
import { softLinkTokens } from "@ep0ch/outline-core/soft-links";
import { MACHINE_KEY } from "@ep0ch/outline-core/machinery";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import {
  outlinerReferenceOccurrences,
  propertyReferenceOccurrences,
  type OutlinerReferenceOccurrence,
  type PropertyReferenceOccurrence,
} from "./reference-occurrences";
import { blockDisplayTitle, blockHeadedTitle } from "./references";
import { workIdReferences, type TicketPrefixes } from "./work-ids";
import type {
  BacklinkCollection,
  BacklinkOccurrence,
  BacklinkQuery,
  BacklinkReferenceGroup,
  BacklinkSource,
  Block,
} from "./types";

const OCCURRENCE_PREVIEW_LIMIT = 3;
const SNIPPET_LIMIT = 180;

type BacklinkRelationOccurrence = OutlinerReferenceOccurrence | PropertyReferenceOccurrence;

export interface BacklinkRelationInput {
  query: BacklinkQuery;
  target: Block;
  orderedBlocks: readonly Block[];
  blocksById: ReadonlyMap<string, Block>;
  addressTargets: ReadonlyMap<string, string>;
  workIdPrefix: string | null;
  /** The prefixes a ticket key may have here (`work-ids.status`); the configured one alone when left out. */
  ticketPrefixes?: TicketPrefixes;
  facetRules?: BacklinkFacetRules;
  targetOutline?: string;
  valuesOf?: (id: string) => readonly SiteValue[];
  /** What counts as a soft mention of the target (PIE-408); left out, only what's linked by its own syntax is read. */
  soft?: SoftMentionsOf;
}

/** The target as soft links name it. */
export interface SoftMentionsOf {
  /** Its page addresses and aliases, normalized: a property's value that says one mentions it. */
  addresses: ReadonlySet<string>;
  /** The days it is the note of (its address is a date, or its `[day::…]`). */
  days: ReadonlySet<string>;
  /** Keys whose values aren't links. */
  ignore: readonly string[];
  /** The pull request it is the note about: no other number can land on it, so no other is looked up. */
  pr?: number;
  /** The read stopped looking before it had looked at every note holding the words. */
  truncated?: boolean;
  /** Whether `PR#number` written at this place lands on the target. */
  prLands(number: number, blockId: string, line: number): boolean;
}

/** The soft links in `source` that land on the target, as occurrences. */
export function softOccurrences(source: Pick<Block, "id" | "text">, soft: SoftMentionsOf): (OutlinerReferenceOccurrence & { target: undefined })[] {
  const text = maskOutputRegions(source.text);
  return softLinkTokens(text, { ignore: soft.ignore }).flatMap(token => {
    if (token.kind === "value" && !soft.addresses.has(normalizePageAddress(token.value).normalizedAddress)) return [];
    if (token.kind === "date" && !soft.days.has(token.day)) return [];
    if (token.kind === "pr" && (token.number !== soft.pr || !soft.prLands(token.number, source.id, text.slice(0, token.start).split("\n").length - 1))) return [];
    const address = token.kind === "value" ? token.value : token.kind === "date" ? token.day : `PR#${token.number}`;
    return [{ kind: "page" as const, address, normalizedAddress: normalizePageAddress(address).normalizedAddress, start: token.start, end: token.end, soft: true as const, target: undefined, ...(token.key ? { propertyKey: token.key } : {}) }];
  });
}

/** Written by convention rather than by a link's own syntax: a soft link, or a ticket key bare in the note's text. */
const isSoftOccurrence = (occurrence: BacklinkRelationOccurrence) =>
  occurrence.kind !== "property" && (occurrence.soft === true || (occurrence.kind === "work-id" && occurrence.propertyKey === undefined));

export function normalizeBacklinkQuery(query: BacklinkQuery): BacklinkQuery {
  if (!query.targetBlockId.trim()) throw new Error("Backlink target block ID cannot be empty");
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000) {
    throw new Error("Backlink limit must be an integer from 1 through 1000");
  }
  return {
    targetBlockId: query.targetBlockId.trim(),
    ...(query.includeDeleted ? { includeDeleted: true } : {}),
    ...(query.softMentions ? { softMentions: true } : {}),
    limit: query.limit,
  };
}

function occurrenceTarget(
  occurrence: BacklinkRelationOccurrence,
  addressTargets: ReadonlyMap<string, string>,
  workIdPrefix: string | null,
): string | undefined {
  if (occurrence.kind === "block" || occurrence.kind === "property") {
    return occurrence.blockId;
  }
  const normalizedAddress = occurrence.kind === "page"
    ? occurrence.normalizedAddress
    : normalizePageAddress(occurrence.address).normalizedAddress;
  const exact = addressTargets.get(normalizedAddress);
  if (exact || occurrence.kind !== "page" || !workIdPrefix) return exact;
  const embeddedWorkIds = workIdReferences(occurrence.address, workIdPrefix);
  return embeddedWorkIds.length === 1
    ? addressTargets.get(normalizePageAddress(embeddedWorkIds[0]!.workId).normalizedAddress)
    : undefined;
}

function occurrenceSnippet(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = text.indexOf("\n", end);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  const line = text.slice(lineStart, lineEnd).replace(/\s+/g, " ").trim();
  if (line.length <= SNIPPET_LIMIT) return line;

  const occurrenceStart = Math.max(0, start - lineStart);
  const windowStart = Math.max(0, Math.min(occurrenceStart - 60, line.length - SNIPPET_LIMIT));
  const windowEnd = Math.min(line.length, windowStart + SNIPPET_LIMIT);
  return `${windowStart > 0 ? "…" : ""}${line.slice(windowStart, windowEnd).trim()}${
    windowEnd < line.length ? "…" : ""
  }`;
}

function humanizedReferenceLabel(
  source: Block,
  occurrence: BacklinkRelationOccurrence,
  targetTitle: string,
): string {
  if (occurrence.kind === "block") {
    const visible = occurrence.label ?? targetTitle;
    return `((${visible}${
      occurrence.label === undefined && occurrence.fragmentId ? `^${occurrence.fragmentId}` : ""
    }))`;
  }
  if (occurrence.kind === "property") return `[${occurrence.propertyKey}::${targetTitle}]`;
  return source.text.slice(occurrence.start, occurrence.end);
}

function backlinkOccurrence(
  source: Block,
  occurrence: BacklinkRelationOccurrence,
  sourceOccurrences: readonly BacklinkRelationOccurrence[],
  target: Block,
): BacklinkOccurrence {
  const label = source.text.slice(occurrence.start, occurrence.end);
  const targetTitle = blockDisplayTitle(target);
  let snippet = occurrenceSnippet(source.text, occurrence.start, occurrence.end);
  for (const sourceOccurrence of sourceOccurrences) {
    const rawLabel = source.text.slice(sourceOccurrence.start, sourceOccurrence.end);
    snippet = snippet.replaceAll(
      rawLabel,
      humanizedReferenceLabel(source, sourceOccurrence, targetTitle),
    );
  }
  const base = {
    label,
    snippet,
    start: occurrence.start,
    end: occurrence.end,
  };
  // A link in a property's value is labelled by the property (PIE-874), as a value that is an id always was.
  const key = occurrence.propertyKey;
  return key !== undefined
    ? { kind: "property", propertyKey: key, ...base }
    : { kind: occurrence.kind as "block" | "page" | "work-id", ...(fragmentOf(occurrence) ? { fragmentId: fragmentOf(occurrence) } : {}), ...base };
}

/** The anchor a reference aims at (`((id^anchor))`, `[[page^anchor]]`, PIE-1247), if any. */
const fragmentOf = (occurrence: BacklinkRelationOccurrence): string | undefined =>
  "fragmentId" in occurrence ? occurrence.fragmentId : undefined;

function parentContext(block: Block, blocksById: ReadonlyMap<string, Block>): string {
  const titles: string[] = [];
  let parentId = block.parentId;
  while (parentId) {
    const parent = blocksById.get(parentId);
    if (!parent) break;
    titles.unshift(blockDisplayTitle(parent));
    parentId = parent.parentId;
  }
  return titles.join(" › ") || "Top level";
}

function referenceGroups(
  occurrences: readonly BacklinkRelationOccurrence[],
): BacklinkReferenceGroup[] {
  const groups = new Map<string, BacklinkReferenceGroup>();
  for (const occurrence of occurrences) {
    const propertyKey = occurrence.propertyKey;
    const fragmentId = propertyKey === undefined ? fragmentOf(occurrence) : undefined;
    const key = propertyKey !== undefined ? `property:${propertyKey}` : `${occurrence.kind}${fragmentId ? `^${fragmentId}` : ""}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else if (propertyKey !== undefined) {
      groups.set(key, { kind: "property", propertyKey, count: 1 });
    } else {
      groups.set(key, { kind: occurrence.kind as "block" | "page" | "work-id", ...(fragmentId ? { fragmentId } : {}), count: 1 });
    }
  }
  return [...groups.values()];
}

function backlinkSource(
  source: Block,
  target: Block,
  occurrences: readonly BacklinkRelationOccurrence[],
  blocksById: ReadonlyMap<string, Block>,
  facetRules: BacklinkFacetRules,
  soft = false,
): BacklinkSource {
  return {
    blockId: source.id,
    title: blockHeadedTitle(source),
    subtitle: subtitleOf(source),
    parentContext: parentContext(source, blocksById),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    occurrenceCount: occurrences.length,
    referenceGroups: referenceGroups(occurrences),
    occurrences: occurrences
      .slice(0, OCCURRENCE_PREVIEW_LIMIT)
      .map((occurrence) => backlinkOccurrence(source, occurrence, occurrences, target)),
    occurrencesTruncated: occurrences.length > OCCURRENCE_PREVIEW_LIMIT,
    ...(source.effectiveDeletedRootId
      ? { deletedRootId: source.effectiveDeletedRootId }
      : {}),
    facets: backlinkSourceFacets(source, target, blocksById, facetRules, soft),
  };
}

/** Every reference in one source block, in order, with the block it points at (undefined: nothing in this outline). */
/** Machinery (a script's run note, a toss, a receipt) is what a tool wrote for its own bookkeeping: its links are no backlinks. */
const isMachinerySource = (source: Block) => source.properties.some((property) => property.key === MACHINE_KEY && property.value.trim() !== "");

function sourceOccurrences(
  source: Block,
  addressTargets: ReadonlyMap<string, string>,
  workIdPrefix: string | null,
  ticketPrefixes: TicketPrefixes = workIdPrefix,
  values: readonly SiteValue[] = [],
): (BacklinkRelationOccurrence & { target: string | undefined })[] {
  const propertyRecords = parsePropertyRecords(source.text);
  return [
    ...outlinerReferenceOccurrences(source.text, ticketPrefixes, propertyRecords, values),
    ...propertyReferenceOccurrences(source.text, propertyRecords),
  ]
    .sort((left, right) => left.start - right.start)
    .map((occurrence) => ({ ...occurrence, target: occurrenceTarget(occurrence, addressTargets, workIdPrefix) }));
}

/**
 * For many targets at once, the ids of the active blocks that link to each (the same relation as
 * `resolveBacklinkRelation`, over the supplied candidates), in outline order.
 */
export function backlinkSourceIds(
  input: Omit<BacklinkRelationInput, "query" | "target" | "blocksById" | "facetRules">,
  targets: ReadonlySet<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>([...targets].map((id) => [id, []]));
  for (const source of input.orderedBlocks) {
    if (source.effectiveDeletedRootId || isMachinerySource(source)) continue;
    const linked = new Set(sourceOccurrences(source, input.addressTargets, input.workIdPrefix, input.ticketPrefixes, input.valuesOf?.(source.id)).map((o) => o.target));
    for (const target of linked) if (target && targets.has(target)) out.get(target)!.push(source.id);
  }
  return out;
}

/**
 * The active blocks `source` links to (`linkedfrom:`, ADR 0004): the same occurrences the backlink relation reads, from
 * the source's side, so `links:` and `linkedfrom:` agree. A link to nothing in this outline, or to a block in the Trash,
 * isn't a block it links to.
 */
export function linkTargetIds(
  input: Pick<BacklinkRelationInput, "blocksById" | "addressTargets" | "workIdPrefix" | "ticketPrefixes" | "valuesOf">,
  source: Block,
): Set<string> {
  const out = new Set<string>();
  for (const { target } of sourceOccurrences(source, input.addressTargets, input.workIdPrefix, input.ticketPrefixes, input.valuesOf?.(source.id))) {
    const block = target ? input.blocksById.get(target) : undefined;
    if (block && !block.effectiveDeletedRootId) out.add(block.id);
  }
  return out;
}

export function resolveBacklinkRelation(input: BacklinkRelationInput): BacklinkCollection {
  const query = normalizeBacklinkQuery(input.query);
  if (input.target.id !== query.targetBlockId) {
    throw new Error(`Backlink target mismatch: ${query.targetBlockId}`);
  }

  // Each its own budget (PIE-408): a hub's soft mentions never crowd its links out of the answer.
  const linked: BacklinkSource[] = [], mentions: BacklinkSource[] = [];
  const rules = input.facetRules ?? DEFAULT_BACKLINK_FACET_RULES;
  for (const source of input.orderedBlocks) {
    if (source.effectiveDeletedRootId && !query.includeDeleted) continue;
    if (isMachinerySource(source)) continue;
    const explicit = sourceOccurrences(source, input.addressTargets, input.workIdPrefix, input.ticketPrefixes, input.valuesOf?.(source.id))
      .filter((occurrence) => occurrence.target === input.target.id && (!("outline" in occurrence) || !occurrence.outline || occurrence.outline === input.targetOutline));
    const soft = input.soft && source.id !== input.target.id ? softOccurrences(source, input.soft) : [];
    const occurrences = [...explicit, ...soft].sort((left, right) => left.start - right.start);
    if (occurrences.length === 0) continue;
    const mention = !!query.softMentions && occurrences.every(isSoftOccurrence);
    (mention ? mentions : linked).push(backlinkSource(source, input.target, occurrences, input.blocksById, rules, mention));
    if (linked.length > query.limit && (!query.softMentions || mentions.length > query.limit)) break;
  }

  const truncated = linked.length > query.limit || mentions.length > query.limit || !!input.soft?.truncated;
  const matches = [...linked.slice(0, query.limit), ...mentions.slice(0, query.limit)];
  return {
    targetBlockId: input.target.id,
    ...(input.target.effectiveDeletedRootId
      ? { targetDeletedRootId: input.target.effectiveDeletedRootId }
      : {}),
    sources: matches,
    completeness: truncated
      ? { kind: "truncated", limit: query.limit }
      : { kind: "complete" },
  };
}
