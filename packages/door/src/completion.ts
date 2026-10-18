// Reference completion's pure half, ported from pi-herdr-outliner so the door inserts exactly what Tree,
// Detail and Quick Capture insert: which `[[`, `((` or `[file::` the cursor is in (src/completion.ts),
// how a page or Work-ID is written (`[[WORK-ID|title]]`, else `[[address]]`), Work-ID recognition
// (src/work-ids.ts), and how a typed `((note#heading` / `((note^anchor` splits. Fragments themselves are
// the service's (see below).
import { calloutTypeAtCursor } from "@ep0ch/outline-core/callouts";
import { propertyAtCursor, yamlAtCursor } from "@ep0ch/outline-core/component-schema";
import { codeSpanRanges, cursorInCode } from "@ep0ch/outline-core/code-ranges";

/**
 * `key` and `value`: a `[key::value]` property's key or value (PIE-618, from the component schemas); `yaml-key` and
 * `yaml-value` the same inside a component block's YAML.
 */
export type CompletionKind = "page" | "block" | "file" | "callout" | "agent" | "component" | "key" | "value" | "yaml-key" | "yaml-value" | "filter-key" | "filter-value";

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
  propertyGap?: boolean;
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
  // Code is opaque (PIE-764): no popup in a fence, a code span, or one being typed (outline-core's cursorInCode).
  if (cursorInCode(lines ?? [line], row ?? 0, column)) return null;
  const callout = calloutTypeAtCursor(line, column);
  if (callout) return { kind: "callout", ...callout };
  const agent = agentAtCursor(line, column);
  if (agent) return { kind: "agent", ...agent };
  const yaml = lines && row !== undefined ? yamlAtCursor(lines, row, column) : null;
  if (yaml) return yaml.kind === "key" ? { kind: "yaml-key", start: yaml.start, end: yaml.end, query: yaml.query, component: yaml.component } : { kind: "yaml-value", start: yaml.start, end: yaml.end, query: yaml.query, key: yaml.key, component: yaml.component };
  const end = Math.max(0, Math.min(column, line.length));
  const beforeCursor = line.slice(0, end);
  const component = /^( {0,3})::([a-z][a-z0-9-]*|)$/.exec(beforeCursor);
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
      const closing = line.indexOf(syntax.closing, end);
      const intervening = closing >= 0 ? line.slice(end, closing) : "";
      const replacementEnd = closing >= 0 && !/[\[\]\r\n]|\(\(|\)\)/.test(intervening) ? closing + syntax.closing.length : end;
      target = { kind: syntax.kind, start, end: replacementEnd, query: beforeCursor.slice(start + syntax.opening.length) };
    }
  }
  if (target) return target;
  if (/^ {0,3}#{1,6}\s+.*\[heading::[^\]\n]+\]$/.test(beforeCursor)) return { kind: "key", start: end, end, query: "heading-", propertyGap: true };
  const heading = /^ {0,3}#{1,6}\s+.+\s+(::|heading::?)([a-zA-Z0-9_-]*)$/.exec(beforeCursor);
  if (heading) return { kind: "value", key: "heading", headingShort: true, start: end - heading[1]!.length - heading[2]!.length, end: end + /^[a-zA-Z0-9_-]*/.exec(line.slice(end))![0].length, query: heading[2]! };

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

const WORK_ID_PREFIX = /^[A-Z][A-Z0-9]{0,15}$/;
const WORK_ID = /^([A-Za-z][A-Za-z0-9]{0,15})-(\d+)$/;

function normalizeWorkIdPrefix(input: string): string | null {
  const p = input.trim().toUpperCase();
  return WORK_ID_PREFIX.test(p) ? p : null;
}

function isCanonicalWorkId(input: string): boolean {
  const m = WORK_ID.exec(input.trim());
  if (!m) return false;
  const n = Number(m[2]), p = normalizeWorkIdPrefix(m[1]!);
  return !!p && Number.isSafeInteger(n) && n >= 1 && `${p}-${String(n).padStart(3, "0")}` === input.trim();
}

/** The outline's own Work IDs (`PIE-416`) in a text, given its configured prefix. */
export function workIdReferences(text: string, configuredPrefix: string): { workId: string; start: number; end: number }[] {
  const prefix = normalizeWorkIdPrefix(configuredPrefix);
  if (!prefix) return [];
  const pattern = new RegExp(`(?<![A-Za-z0-9-])${prefix}-\\d{3,}(?![A-Za-z0-9-])`, "g");
  return [...text.matchAll(pattern)].flatMap(m => (isCanonicalWorkId(m[0]) ? [{ workId: m[0], start: m.index!, end: m.index! + m[0].length }] : []));
}

// ── pages and Work IDs ────────────────────────────────────────────────────────

/** A named address as `pages.complete` returns it. */
export interface PageAddressMatch { address: string; blockId: string; kind: string; title: string }

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
