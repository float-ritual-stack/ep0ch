import type { SiteValue } from "@ep0ch/outline-core/site";
import { valueLinkOccurrences } from "@ep0ch/outline-core/site-values";
import type { Database } from "bun:sqlite";
import { blockReferenceOccurrences, pageAddressReferences, normalizePageAddress } from "@ep0ch/outline-core/link-syntax";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { ticketKeyReferences } from "./work-ids";

/** Candidate addresses, not resolved edges: renaming a page or claiming a ticket needs no source rewrite.
 * The backlink resolver still owns protected regions, prefix scope and all other semantic decisions.
 */
export function replaceReferenceIndex(database: Database, blockId: string, text: string, values: readonly SiteValue[] = []): void {
  const built = valueLinkOccurrences(text, values);
  const literal = (r: { start: number; end: number }) => !built.some(b => b.start < r.end && r.start < b.end);
  const addresses = new Set<string>([
    ...blockReferenceOccurrences(text).filter(literal).map(reference => reference.blockId),
    ...pageAddressReferences(text).filter(literal).map(reference => reference.normalizedAddress),
    ...parsePropertyRecords(text).map(property => property.value),
  ]);
  // Collect a superset of prefixes, then let the shared ticket scanner recognize the keys. Include keys inside
  // page links too: a page address containing one Work ID can resolve through that ID when unclaimed.
  const prefixesInUse = [...text.matchAll(/[A-Z][A-Z0-9]*-/g)].map(match => match[0].slice(0, -1));
  for (const reference of ticketKeyReferences(text, { prefix: null, prefixesInUse })) {
    addresses.add(normalizePageAddress(reference.workId).normalizedAddress);
  }
  for (const { link } of built) {
    if (link?.kind === "block") addresses.add(link.blockId);
    else if (link?.kind === "page") addresses.add(link.normalizedAddress);
  }
  database.query("DELETE FROM block_reference_candidates WHERE block_id = ?").run(blockId);
  const insert = database.query("INSERT INTO block_reference_candidates (address, block_id) VALUES (?, ?)");
  for (const address of addresses) insert.run(address, blockId);
}
