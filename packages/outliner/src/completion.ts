import { cursorInCode } from "@ep0ch/outline-core/code-ranges";
import type { PageAddressMatch } from "./types";
import { referenceEnvelopeEnd } from "@ep0ch/outline-core/addressable-resource";
import { workIdReferences } from "./work-ids";
import { HASHTAG_VALUE_PATTERN, isEscapedAt } from "@ep0ch/outline-core/property-grammar";

export type CompletionTargetKind = "page" | "block" | "file";

export interface CompletionTarget {
  kind: CompletionTargetKind;
  start: number;
  end: number;
  query: string;
}

const TARGET_SYNTAX: ReadonlyArray<{
  kind: CompletionTargetKind;
  opening: string;
  closing: string;
}> = [
  { kind: "page", opening: "[[", closing: "]]" },
  { kind: "block", opening: "((", closing: "))" },
  { kind: "file", opening: "[file::", closing: "]" },
];
export interface PageAddressCompletion {
  label: string;
  insertion: string;
}

export function pageCompletionLookupQuery(
  authoredQuery: string,
  workIdPrefix: string | null,
): string {
  const separator = authoredQuery.indexOf("|");
  if (separator >= 0) return authoredQuery.slice(0, separator).trim();
  const workIds = workIdPrefix ? workIdReferences(authoredQuery, workIdPrefix) : [];
  return workIds.length === 1 ? workIds[0]!.workId : authoredQuery.trim();
}

export function pageAddressCompletion(
  address: PageAddressMatch,
  authoredQuery: string,
  workIdPrefix: string | null,
): PageAddressCompletion {
  const title = address.title.trim();
  const normalizedTitle = title.toLocaleLowerCase();
  const normalizedAddress = address.address.toLocaleLowerCase();
  const label = address.kind === "work-id" &&
      (
        normalizedTitle === normalizedAddress ||
        normalizedTitle.startsWith(`${normalizedAddress} `)
      )
    ? title
    : `${address.address} — ${title}`;
  if (address.kind !== "work-id") {
    return { label, insertion: `[[${address.address}]]` };
  }

  const separator = authoredQuery.indexOf("|");
  const workIds = workIdPrefix ? workIdReferences(authoredQuery, workIdPrefix) : [];
  const authoredLabel = separator >= 0
    ? authoredQuery.slice(separator + 1).trim()
    : workIds.length === 1 &&
        workIds[0]!.workId === address.address &&
        authoredQuery.trim() !== address.address
      ? authoredQuery.trim()
      : title;
  const safeLabel = authoredLabel && !/[\[\]\r\n]/.test(authoredLabel) && !/\(\(|\)\)/.test(authoredLabel)
    ? authoredLabel
    : null;
  return {
    label,
    insertion: safeLabel
      ? `[[${address.address}|${safeLabel}]]`
      : `[[${address.address}]]`,
  };
}


/**
 * The innermost unclosed `[[`, `((` or `[file::` before the cursor, or null. With the note's `lines` and the cursor's
 * `row`, null in code too (PIE-764, outline-core's `cursorInCode`): a fence, a code span, or one being typed.
 */
export function completionTargetAtCursor(
  line: string,
  column: number,
  lines?: readonly string[],
  row?: number,
): CompletionTarget | null {
  if (cursorInCode(lines ?? [line], row ?? 0, column)) return null;
  const end = Math.max(0, Math.min(column, line.length));
  const beforeCursor = line.slice(0, end);
  let target: CompletionTarget | null = null;

  for (const syntax of TARGET_SYNTAX) {
    let searchFrom = beforeCursor.length;
    let closedDepth = 0;
    let start = -1;

    while (searchFrom > 0) {
      const opening = beforeCursor.lastIndexOf(syntax.opening, searchFrom - 1);
      const closing = beforeCursor.lastIndexOf(syntax.closing, searchFrom - 1);
      if (opening < 0) break;
      if (closing > opening) {
        closedDepth += 1;
        searchFrom = closing;
      } else if (closedDepth > 0) {
        closedDepth -= 1;
        searchFrom = opening;
      } else {
        start = opening;
        break;
      }
    }

    if (start < 0) continue;
    if (!target || start > target.start) {
      // A block title may carry its own parentheses: `((Rough edges (x)))` closes after `(x)`.
      const closing = syntax.kind === "block"
        ? Math.max(-1, referenceEnvelopeEnd(line, start + syntax.opening.length, true, end) - syntax.closing.length)
        : line.indexOf(syntax.closing, end);
      const intervening = closing >= 0 ? line.slice(end, closing) : "";
      const replacementEnd = closing >= 0 && !/[\[\]\r\n]|\(\(|\)\)/.test(intervening)
        ? closing + syntax.closing.length : end;
      target = {
        kind: syntax.kind,
        start,
        end: replacementEnd,
        query: beforeCursor.slice(start + syntax.opening.length),
      };
    }
  }

  return target;
}

/** A `#tag` being typed before the cursor (at least one character after the `#`). */
export interface HashtagTarget {
  start: number;
  end: number;
  query: string;
}

const HASHTAG_BEFORE_CURSOR = new RegExp(`#(${HASHTAG_VALUE_PATTERN.source})$`, "u");

/**
 * The `#tag` the cursor is at the end of, or null: written where the property parser takes a hashtag (it starts a word:
 * the line's start, a space or an opening bracket or quote before it, not escaped), outside code and outside a `[[`/`((`
 * reference (where `#` is a heading: `((note#heading`). Its letters needn't be there yet: `#20` may become `#2025-plan`.
 */
export function hashtagAtCursor(line: string, column: number, lines?: readonly string[], row?: number): HashtagTarget | null {
  if (cursorInCode(lines ?? [line], row ?? 0, column)) return null;
  const end = Math.max(0, Math.min(column, line.length));
  const match = HASHTAG_BEFORE_CURSOR.exec(line.slice(0, end));
  if (!match) return null;
  const start = match.index;
  if (isEscapedAt(line, start) || (start > 0 && !/[\s([{"'“‘]/u.test(line[start - 1]!))) return null;
  if (completionTargetAtCursor(line, end, lines, row)) return null;
  // The rest of the word after the cursor is the tag's too: choosing one replaces it.
  const after = /^[\p{L}\p{M}\p{N}_\/-]*/u.exec(line.slice(end))?.[0].length ?? 0;
  return { start, end: end + after, query: match[1]! };
}

export interface CompletionWindow {
  start: number;
  end: number;
}

export function completionWindow(
  itemCount: number,
  selectedIndex: number,
  capacity: number,
): CompletionWindow {
  const visibleCount = Math.max(0, Math.min(itemCount, capacity));
  if (visibleCount === 0) {
    return { start: 0, end: 0 };
  }

  const clampedSelectedIndex = Math.max(
    0,
    Math.min(selectedIndex, itemCount - 1),
  );
  const centeredStartIndex =
    clampedSelectedIndex - Math.floor(visibleCount / 2);
  const start = Math.max(
    0,
    Math.min(centeredStartIndex, itemCount - visibleCount),
  );

  return { start, end: start + visibleCount };
}
