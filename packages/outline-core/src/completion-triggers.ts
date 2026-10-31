// Which completion trigger the cursor is in (ADR 0004 §4, PIE-1340): the one detector the door's completer and the
// outliner's Detail ask, so both agree on what `[[`, `((`, `[file::`, `@`, `::`, `> [!`, `[key::` or a figure's YAML the
// cursor is in, its query, and the range a choice replaces. Also how a page or Work ID is written (`[[WORK-ID|title]]`,
// else `[[address]]`) and how a typed `((note#heading` / `((note^anchor` splits. Fragments themselves are the service's.
import { codeBlocks, codeFenceOpen, codeFenceInfo, SCRIPT_FENCE } from "./code-fence";
import { figureProps } from "./figure-props";
import { COMPONENT_CLOSE, componentAttributeAtCursor, componentBlocks } from "./component-block";
import { calloutTypeAtCursor } from "./callouts";
import { propertyAtCursor, yamlAtCursor } from "./component-schema";
import { codeSpanRanges, cursorInCode } from "./code-ranges";
import { buttonBodyEnd } from "./button-call";
import { referenceEnvelopeEnd } from "./addressable-resource";
import { HASHTAG_VALUE_PATTERN, isEscapedAt } from "./property-grammar";
import { workIdReferences as configuredWorkIds } from "./work-ids";

/**
 * `key` and `value`: a `[key::value]` property's key or value (PIE-618, from the component schemas); `yaml-key` and
 * `yaml-value` the same inside a component block's YAML. `tile`: a `%tile` in an ask line (the door's alone: its tiles).
 */
export type CompletionKind = "page" | "block" | "file" | "callout" | "agent" | "component" | "key" | "value" | "yaml-key" | "yaml-value" | "filter-key" | "filter-value" | "attribute" | "attribute-value" | "fence-setting" | "button-step" | "action" | "tile" | "formatter";

export interface CompletionTarget {
  kind: CompletionKind;
  /** Where the token starts on the line (its opening delimiter) and where a choice replaces up to. */
  start: number;
  end: number;
  /** What was typed after the opening delimiter, up to the cursor. */
  query: string;
  /** A value's property key; a YAML key's or value's component (`graph-meter`). */
  key?: string;
  component?: string;
  /** A filter's word: a value with a space can't be written in it. */
  words?: boolean;
  headingShort?: boolean;
  quote?: string;
  existingValue?: boolean;
  attrs?: { key: string; value: string }[];
}

const TARGET_SYNTAX: ReadonlyArray<{ kind: CompletionKind; opening: string; closing: string }> = [
  { kind: "page", opening: "[[", closing: "]]" },
  { kind: "block", opening: "((", closing: "))" },
  { kind: "file", opening: "[file::", closing: "]" },
];

/**
 * The innermost unclosed `[[`, `((` or `[file::` before the cursor, or a callout's type being typed (`> [!wa`,
 * PIE-538, by outline-core's callout grammar), or a property's key or value (`[head`, `[heading-pattern::wa`, PIE-618),
 * or with the draft's `lines` and `row`, a key or value in a component block's YAML; else null.
 */
export function completionTargetAtCursor(line: string, column: number, lines?: readonly string[], row?: number): CompletionTarget | null {
  const opening = codeFenceOpen(line);
  if (opening && SCRIPT_FENCE.languages.includes(codeFenceInfo(opening.info).language) &&
    (!lines || row === undefined || codeBlocks(lines).fences.some(f => f.start === row))) {
    const before = line.slice(0, column);
    const word = /\s([a-z-]*)$/.exec(before);
    if (word) return { kind: "fence-setting", start: column - word[1]!.length, end: column, query: word[1]! };
  }
  // Code is opaque (PIE-764): no popup in a fence, a code span, or one being typed (outline-core's cursorInCode).
  if (cursorInCode(lines ?? [line], row ?? 0, column)) return null;
  const callout = calloutTypeAtCursor(line, column);
  if (callout) return { kind: "callout", ...callout };
  const agent = agentAtCursor(line, column);
  if (agent) return { kind: "agent", ...agent };
  const yaml = lines && row !== undefined ? yamlAtCursor(lines, row, column) : null;
  if (yaml) {
    const parsed = figureProps(yaml.component, { yaml: yaml.yaml });
    const attrs = "error" in parsed ? [] : Object.entries(parsed.props).map(([key, value]) => ({ key, value: String(value) }));
    return { kind: yaml.kind === "key" ? "yaml-key" : "yaml-value", start: yaml.start, end: yaml.end, query: yaml.query, ...(yaml.kind === "value" ? { key: yaml.key } : {}), component: yaml.component, attrs };
  }
  const end = Math.max(0, Math.min(column, line.length));
  const beforeCursor = line.slice(0, end);
  const stage = /^\s*(?:[-*+]\s+)?(?:sh|nu)::.*\|\s+as\s+([\w-]*)$/.exec(beforeCursor);
  if (stage) return { kind: "formatter", start: end - stage[1]!.length, end: end + /^[\w-]*/.exec(line.slice(end))![0].length, query: stage[1]! };
  const handler = /^(\s*(?:[-*+]\s+)?)([a-z][\w-]*)::$/.exec(beforeCursor);
  if (handler) return { kind: "component", start: handler[1]!.length, end, query: handler[2]! };
  const draft = lines && row !== undefined ? [...lines.slice(0, row + 1), "::"] : null;
  const button = draft && row !== undefined && componentBlocks(draft).find(b => b.name === "button" && row > b.start && row <= buttonBodyEnd(draft, b.start));
  if (button && row === button.end && COMPONENT_CLOSE.test(line)) return null;
  const component = /^( {0,3})::([^{}\n]*)$/.exec(beforeCursor);
  if (component) return { kind: "component", start: component[1]!.length, end: end + /^[a-z0-9-]*/.exec(line.slice(end))![0].length, query: component[2]! };
  let target: CompletionTarget | null = null;
  // A `[[` or `((` in a code span earlier on the line is text: it opens nothing the cursor is in (PIE-764).
  const code = line.includes("`") ? codeSpanRanges(line) : [];
  const inCode = (at: number) => at >= 0 && code.some(r => r.start <= at && at < r.end);
  for (const syntax of TARGET_SYNTAX) {
    let searchFrom = beforeCursor.length, closedDepth = 0, start = -1;
    while (searchFrom > 0) {
      const opening = beforeCursor.lastIndexOf(syntax.opening, searchFrom - 1);
      const closing = beforeCursor.lastIndexOf(syntax.closing, searchFrom - 1);
      if (opening < 0) break;
      if (inCode(Math.max(opening, closing))) { searchFrom = Math.max(opening, closing); continue; }
      if (closing > opening) { closedDepth += 1; searchFrom = closing; }
      else if (closedDepth > 0) { closedDepth -= 1; searchFrom = opening; }
      else { start = opening; break; }
    }
    if (start < 0) continue;
    if (!target || start > target.start) {
      // A closing delimiter already after the cursor is replaced too, when only token text lies between.
      // A block title may carry its own parentheses: `((Rough edges (x)))` closes after `(x)`.
      const closing = syntax.kind === "block"
        ? Math.max(-1, referenceEnvelopeEnd(line, start + syntax.opening.length, true, end) - syntax.closing.length)
        : line.indexOf(syntax.closing, end);
      const intervening = closing >= 0 ? line.slice(end, closing) : "";
      const replacementEnd = closing >= 0 && !/[\[\]\r\n]|\(\(|\)\)/.test(intervening) ? closing + syntax.closing.length : end;
      target = { kind: syntax.kind, start, end: replacementEnd, query: beforeCursor.slice(start + syntax.opening.length) };
    }
  }
  if (button && (!target || target.kind === "block")) return { kind: "button-step", start: target?.start ?? 0, end: target?.end ?? line.length, query: target ? "((" + target.query : beforeCursor };
  if (target) return target;
  const attribute = componentAttributeAtCursor(line, column);
  if (attribute) return attribute;
  const heading = /^ {0,3}#{1,6}\s+.+\s+(::)([a-zA-Z0-9_-]*)$/.exec(beforeCursor);
  if (heading && end === line.length) return { kind: "value", key: "heading", headingShort: true, start: end - heading[1]!.length - heading[2]!.length, end, query: heading[2]! };

  const prop = propertyAtCursor(line, column);
  if (!prop) return null;
  return prop.kind === "key" ? { kind: "key", start: prop.start, end: prop.end, query: prop.query } : { kind: "value", start: prop.start, end: prop.end, query: prop.query, key: prop.key };
}

/**
 * `@na` at a line's start (after its indent and a list mark), the way a request to an agent is written (`@tidy`,
 * PIE-501): the name being typed, and the rest of the word after the cursor that a choice replaces (PIE-592).
 */
export function agentAtCursor(line: string, column: number): { start: number; end: number; query: string } | null {
  const before = line.slice(0, Math.max(0, Math.min(column, line.length)));
  const m = /^(\s*(?:[-*+]\s+)?)@([A-Za-z0-9_-]*)$/.exec(before);
  if (!m) return null;
  const rest = /^[A-Za-z0-9_-]*/.exec(line.slice(before.length))![0];
  return { start: m[1]!.length, end: before.length + rest.length, query: m[2]! };
}

/**
 * A filter's `key:value` word at the cursor (a river column's `/`: `type:hub -status:done word`, a leading `-` leaves
 * a clause out): the key being typed, or a key's value after its `:`. A bare word that isn't a key (`gardening`)
 * names nothing, and an empty word asks for nothing until `:` or a letter is typed. A choice replaces up to the word's end.
 */
export function filterTargetAtCursor(line: string, column: number): CompletionTarget | null {
  const cursor = Math.max(0, Math.min(column, line.length));
  const before = line.slice(0, cursor);
  let start = before.search(/\S*$/);
  if (before[start] === "-") start++;
  const word = before.slice(start);
  const end = cursor + /^\S*/.exec(line.slice(cursor))![0].length;
  const colon = word.indexOf(":");
  if (colon < 0) return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(word) ? { kind: "filter-key", start, end, query: word } : null;
  const key = word.slice(0, colon);
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(key) ? { kind: "filter-value", start: start + colon + 1, end, query: word.slice(colon + 1), key } : null;
}

// ── Work IDs ──────────────────────────────────────────────────────────────────

/** The outline's own Work IDs (`PIE-416`) in a text, given its configured prefix (none for a prefix no Work ID can have). */
export function workIdReferences(text: string, configuredPrefix: string): { workId: string; start: number; end: number }[] {
  try { return configuredWorkIds(text, configuredPrefix); } catch { return []; }
}

// ── pages and Work IDs ────────────────────────────────────────────────────────

/** A named address as `pages.complete` returns it. */
export interface PageAddressMatch { address: string; blockId: string; kind: string; title: string; subtitle?: string; score?: number }

/** What `pages.complete` is asked for: the part before `|`, or the one Work ID typed in a longer phrase. */
export function pageCompletionLookupQuery(authoredQuery: string, workIdPrefix: string | null): string {
  const separator = authoredQuery.indexOf("|");
  if (separator >= 0) return authoredQuery.slice(0, separator).trim();
  const workIds = workIdPrefix ? workIdReferences(authoredQuery, workIdPrefix) : [];
  return workIds.length === 1 ? workIds[0]!.workId : authoredQuery.trim();
}

/**
 * How a page or Work ID reads in the list and what choosing it writes: a Work ID as `[[WORK-ID|title]]`
 * (the label typed after `|`, or the phrase around it, when there was one), `[[WORK-ID]]` when the label
 * holds link delimiters; a page or alias as `[[address]]`.
 */
export function pageAddressCompletion(address: PageAddressMatch, authoredQuery: string, workIdPrefix: string | null): { label: string; insertion: string } {
  const title = address.title.trim();
  const t = title.toLocaleLowerCase(), a = address.address.toLocaleLowerCase();
  // The outliner separates with an em dash; the door's CP437 screens draw it as `·`.
  const label = address.kind === "work-id" && (t === a || t.startsWith(`${a} `)) ? title : `${address.address} · ${title}`;
  if (address.kind !== "work-id") return { label, insertion: `[[${address.address}]]` };
  const separator = authoredQuery.indexOf("|");
  const workIds = workIdPrefix ? workIdReferences(authoredQuery, workIdPrefix) : [];
  const authoredLabel = separator >= 0
    ? authoredQuery.slice(separator + 1).trim()
    : workIds.length === 1 && workIds[0]!.workId === address.address && authoredQuery.trim() !== address.address
      ? authoredQuery.trim()
      : title;
  const safe = authoredLabel && !/[\[\]\r\n]/.test(authoredLabel) && !/\(\(|\)\)/.test(authoredLabel) ? authoredLabel : null;
  return { label, insertion: safe ? `[[${address.address}|${safe}]]` : `[[${address.address}]]` };
}

// ── fragments ─────────────────────────────────────────────────────────────────
// What a fragment is, where it is and which anchors a note has are the service's (`fragments.candidates`,
// `fragments.read`, `fragments.ensure`, PIE-424): the door only splits what was typed.

/** `((garden#beds` (a heading) or `((garden^be` (an anchor id): the block part and the fragment part. */
export function parseFragmentCompletionQuery(query: string): { blockQuery: string; fragmentQuery: string; mode: "heading" | "id" } | null {
  const h = query.lastIndexOf("#"), i = query.lastIndexOf("^"), d = Math.max(h, i);
  if (d < 0) return null;
  return { blockQuery: query.slice(0, d).trim(), fragmentQuery: query.slice(d + 1).trim(), mode: d === h ? "heading" : "id" };
}

/**
 * Only a `[[`, `((` or `[file::` reference the cursor is in, or null (the published page's search box, a hashtag's
 * check): the same scan, without the property, component and agent triggers.
 */
export function referenceTargetAtCursor(line: string, column: number, lines?: readonly string[], row?: number): CompletionTarget | null {
  const t = completionTargetAtCursor(line, column, lines, row);
  return t && (t.kind === "page" || t.kind === "block" || t.kind === "file") ? t : null;
}

/** A `#tag` being typed before the cursor (at least one character after the `#`). */
export interface HashtagTarget { start: number; end: number; query: string }

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
  if (referenceTargetAtCursor(line, end, lines, row)) return null;
  // The rest of the word after the cursor is the tag's too: choosing one replaces it.
  const after = /^[\p{L}\p{M}\p{N}_\/-]*/u.exec(line.slice(end))?.[0].length ?? 0;
  return { start, end: end + after, query: match[1]! };
}
