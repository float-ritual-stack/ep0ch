import {Lexer, type Token} from "marked";
import { codeHides, protectedCodeRanges } from "@ep0ch/outline-core/code-ranges";
import { pageAddressReferences, pageLinkRanges } from "@ep0ch/outline-core/link-syntax";
import { propertyValueLinks } from "@ep0ch/outline-core/property-grammar";
import { isResourcePropertyKey } from "./resource-references";
import { parsePropertyRecords } from "./properties";
import type { PropertyRecord } from "./types";
import { blockReferenceEnvelopeRanges, blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import { ticketKeyReferences, type TicketPrefixes } from "./work-ids";

export interface TextRange {
  start: number;
  end: number;
}

/**
 * A reference in a note's text, or (with `propertyKey`) inside one of its property values (PIE-874: `[via::[[X-2]]]`,
 * `[ticket::PC-1]`), an edge labelled by that property.
 */
export type OutlinerReferenceOccurrence = { propertyKey?: string } & (
  | {
      kind: "block";
      blockId: string;
      fragmentId?: string;
      label?: string;
      start: number;
      end: number;
    }
  | {
      kind: "page";
      address: string;
      normalizedAddress: string;
      label?: string;
      start: number;
      end: number;
    }
  | {
      kind: "work-id";
      address: string;
      start: number;
      end: number;
    });

export interface PropertyReferenceOccurrence {
  kind: "property";
  propertyKey: string;
  blockId: string;
  start: number;
  end: number;
}

export function rangesOverlap(left: TextRange, right: TextRange): boolean {
  return left.start < right.end && right.start < left.end;
}

export function protectedMarkdownRanges(text: string): TextRange[] {
  return [...protectedCodeRanges(text), ...markdownLinkRanges(text)];
}

/** The Markdown links and images of `text` (where a reference or Work ID is the link's text, not a link of its own). */
function markdownLinkRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\([^)\n]*\)/g)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  // Match the reader's Markdown URL boundaries, including punctuation and
  // links nested in emphasis. Do not manufacture a second URL grammar.
  const visit = (source:string, tokens:Token[], base:number):void => {
    let cursor=0;
    for(const token of tokens){
      const start=source.indexOf(token.raw,cursor);
      if(start<0)continue;
      const end=start+token.raw.length;
      if(token.type==='link' || token.type==='image')ranges.push({start:base+start,end:base+end});
      else if('tokens' in token && Array.isArray(token.tokens))visit(token.raw,token.tokens,base+start);
      cursor=end;
    }
  };
  visit(text,Lexer.lexInline(text),0);
  return ranges;
}

/** Where page-link syntax is: each `[[…]]` whole, its brackets counted (outline-core), and a `[[` left open to its line's end. */
export function pageSyntaxRanges(text: string): TextRange[] {
  const closed = pageLinkRanges(text), ranges: TextRange[] = [...closed];
  let next = 0;
  for (let at = text.indexOf("[["); at >= 0; at = text.indexOf("[[", at + 2)) {
    while (next < closed.length && closed[next]!.end <= at) next += 1;
    const inside = closed[next] && closed[next]!.start <= at ? closed[next]! : undefined;
    if (inside) { at = inside.end - 2; continue; }
    const newline = text.indexOf("\n", at), lineEnd = newline < 0 ? text.length : newline - (text[newline - 1] === "\r" ? 1 : 0);
    ranges.push({ start: at, end: lineEnd });
    at = Math.max(at, lineEnd - 2);
  }
  return ranges;
}

export function propertyReferenceOccurrences(
  text: string,
  propertyRecords: readonly PropertyRecord[] = parsePropertyRecords(text),
): PropertyReferenceOccurrence[] {
  return propertyRecords.map((token) => ({
    kind: "property",
    propertyKey: token.key,
    blockId: token.value,
    start: token.start,
    end: token.end,
  }));
}

export function outlinerReferenceOccurrences(
  text: string,
  workIdPrefix: TicketPrefixes = null,
  propertyRecords: readonly PropertyRecord[] = parsePropertyRecords(text),
): OutlinerReferenceOccurrence[] {
  const blockReferences = blockReferenceOccurrences(text);
  const blockReferenceRanges = blockReferenceEnvelopeRanges(text);
  const candidates: OutlinerReferenceOccurrence[] = blockReferences.map(
    (reference) => ({ kind: "block", ...reference }),
  );
  for (const reference of pageAddressReferences(text)) {
    candidates.push({
      kind: "page",
      address: reference.displayAddress,
      normalizedAddress: reference.normalizedAddress,
      ...(reference.label ? { label: reference.label } : {}),
      start: reference.start,
      end: reference.end,
    });
  }

  const pageRanges = pageSyntaxRanges(text);
  for (const reference of ticketKeyReferences(text, workIdPrefix)) {
    const range = { start: reference.start, end: reference.end };
    if (pageRanges.some((pageRange) => rangesOverlap(range, pageRange))) continue;
    candidates.push({
      kind: "work-id",
      address: reference.workId,
      ...range,
    });
  }

  const protectedRanges = [
    ...markdownLinkRanges(text),
    ...propertyRecords.map((token) => ({ start: token.start, end: token.end })),
  ];
  // Code is opaque (PIE-764): outline-core's one rule, which the link scans above already applied to their own.
  const code = protectedCodeRanges(text);
  const inText = candidates.filter((candidate) =>
    (candidate.kind === "block" ||
      !blockReferenceRanges.some((range) => rangesOverlap(candidate, range))) &&
    !protectedRanges.some((range) => rangesOverlap(candidate, range)) &&
    !codeHides(candidate, code)
  );
  return [...inText, ...propertyValueOccurrences(text, workIdPrefix, propertyRecords)].sort((left, right) => left.start - right.start);
}

/**
 * The references inside property values (PIE-874), each labelled by its property: outline-core's one scan of values
 * (`propertyValueLinks`: references, page links, an item that is exactly a ticket key), and the outline's Work IDs
 * written inside a value's words (`[waiting-on::review of PIE-12]`), as they are in a note's text.
 */
function propertyValueOccurrences(text: string, workIdPrefix: TicketPrefixes, propertyRecords: readonly PropertyRecord[]): OutlinerReferenceOccurrence[] {
  // A Resource's key (`[jira::PC-7]`, `[file::…]`) names a Resource: its value is the Resource path's, never an outline link.
  const records = propertyRecords.filter((record) => record.syntax !== "hashtag");
  return propertyValueLinks(text, records, { prefixes: workIdPrefix, skip: (key) => isResourcePropertyKey(key) }).map((link): OutlinerReferenceOccurrence => {
    const propertyKey = link.key;
    if (link.kind === "block") return { kind: "block", ...link.reference, propertyKey };
    if (link.kind === "page") return { kind: "page", address: link.reference.displayAddress, normalizedAddress: link.reference.normalizedAddress, ...(link.reference.label ? { label: link.reference.label } : {}), start: link.reference.start, end: link.reference.end, propertyKey };
    return { kind: "work-id", address: link.workId, ...link.reference, propertyKey };
  });
}
