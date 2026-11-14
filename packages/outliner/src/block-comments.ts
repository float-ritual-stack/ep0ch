import type { OutlinerClient } from "./client";
import { blockAnnotationRepresentation } from "./annotation-representations";
import { createTextQuoteAnchor } from "./annotations";
import { findQuoted, quoteRefusal, type DrawnReads } from "@ep0ch/outline-core/drawn-passage";
import { isMiss } from "@ep0ch/outline-core/passage";
import { markdownListItems } from "./markdown-structure";
import { checklistItems } from "./checklist-items";
import { displayTitleOfText } from "./references";
import type { AnnotationBatchOperation, AnnotationBatchReceipt, AnnotationTarget, Block, BlockAuthor, BlockCommentInput,
  BlockCommentPassage, BlockProvenance } from "./types";

/**
 * Shared by source-aware readers and the service's simplified comment operation. `noteText`: the text of another
 * note of the outline, by its id, for a quote of words as drawn (a reference with no label is drawn as its note's title).
 */
export function blockCommentTarget(
  block: Pick<Block, "id" | "text" | "updatedAt">,
  passage?: BlockCommentPassage,
  noteText?: (blockId: string) => string | undefined,
): AnnotationTarget {
  const reads: DrawnReads = noteText ? { title: id => { const text = noteText(id); return text === undefined ? undefined : displayTitleOfText(text); } } : {};
  return { representation: blockAnnotationRepresentation(block), ...blockCommentSelection(block.text, passage, reads) };
}

/**
 * Preserve the reader's captured representation while resolving its canonical source selection. Where the quote is
 * in the text is outline-core's to say (`findQuoted`): as source text, or as a reader drew it (`reads`: what that
 * reader knew that this text doesn't say).
 */
export function blockCommentSelection(text: string, passage?: BlockCommentPassage, reads: DrawnReads = {}): Pick<AnnotationTarget, "anchor" | "listItemId"> {
  if (passage === undefined) return { anchor: { kind: "whole-subject" } };
  if (!passage || typeof passage.quote !== "string" || passage.quote.length === 0) {
    throw new Error("Comment quote must be non-empty exact source text; omit passage for a whole-block comment");
  }
  if (passage.start !== undefined && (!Number.isSafeInteger(passage.start) || passage.start < 0)) {
    throw new Error("Comment start must be a non-negative UTF-16 source offset");
  }
  if (passage.near !== undefined && (!Number.isSafeInteger(passage.near) || passage.near < 0)) {
    throw new Error("Comment near must be a non-negative UTF-16 source offset");
  }
  for (const key of ["prefix", "suffix", "itemId"] as const) {
    if (passage[key] !== undefined && typeof passage[key] !== "string") throw new Error(`Comment ${key} must be text`);
  }
  const within = passage.within;
  if (within !== undefined && !(within && Number.isSafeInteger(within.start) && Number.isSafeInteger(within.end) && within.start >= 0 && within.end > within.start)) {
    throw new Error("Comment within must be a span of the source: UTF-16 offsets, start before end");
  }
  let lower = 0, upper = text.length;
  let descendants: ReturnType<typeof markdownListItems> = [];
  if (passage.itemId !== undefined) {
    const items = checklistItems(text).filter(item => item.itemId === passage.itemId);
    if (items.length !== 1 || items[0]!.identity !== "unique") throw new Error("Comment checklist item is missing or ambiguous");
    lower = items[0]!.span.start; upper = items[0]!.span.end;
    descendants = markdownListItems(text).filter(child => child.parentStart === lower);
  }
  // The one quote lookup (outline-core: passage.ts for source text, drawn-passage.ts for words as a reader drew them):
  // found once in the range, with the context given, else why not. The anchor is the span of the source either way.
  const found = findQuoted(text, passage, {
    lower, upper,
    exclude: (start, end) => descendants.some(child => start < child.span.end && end > child.span.start),
  }, reads);
  if (isMiss(found)) throw quoteRefusal(found);
  return { anchor: createTextQuoteAnchor(text, found.start, found.end),
    ...(passage.itemId === undefined ? {} : { listItemId: passage.itemId }) };
}

export interface BlockCommentRequest {
  requestId: string;
  input: BlockCommentInput;
  author?: BlockAuthor;
  provenance?: BlockProvenance;
}

/** A whole-note comment (including a proposed create) keeps its identity when its parent is edited. */
export function commentRequestIdentity(operation: AnnotationBatchOperation): unknown {
  if (operation.type !== "block-comment" || operation.input.passage !== undefined) return operation;
  const { expectedRevision, ...input } = operation.input;
  return { ...operation, input };
}

/** The service resolves the quote and validates its revision inside the request ledger transaction. */
export function createBlockComment(client: Pick<OutlinerClient, "request">, request: BlockCommentRequest): Promise<AnnotationBatchReceipt> {
  return client.request({ action: "annotations.batch", requestId: request.requestId,
    operations: [{ operationId: "comment", type: "block-comment", input: request.input }],
    author: request.author, provenance: request.provenance });
}
