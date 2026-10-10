// The link grammar of a note: block references `((id))`, `((id^fragment|label))`, page links `[[address|label]]`,
// embeds `!((id^fragment))`, Markdown links and the fragment anchor `^id` at a line's end. The service indexes and
// resolves what these scans find; every client draws a link where they find one, so a link the service reads is the
// link the reader shows, label and all. Code is opaque (PIE-764): a link written in a code span or fenced code is text,
// so every scan here leaves code out (`CodeScope`). Pure: no I/O.

import { BLOCK_ID_PATTERN, referenceEnvelopeEnd } from "./addressable-resource";
import { codeHides, codeSpanRanges, protectedCodeRanges, type SourceRange } from "./code-ranges";

/**
 * Where a scan finds code, whose links are text (PIE-764): `"note"` (the default), `text` is a whole note: its fences,
 * indented code and code spans (`protectedCodeRanges`); `"inline"`, `text` is a line or a slice of one: only its code
 * spans (a caller that drew its fences already); or ranges the caller computed over the whole note. `[]` is the raw
 * grammar, for text that is never a note (a property value's own structure, a re-scan of resolved text).
 */
export type CodeScope = "note" | "inline" | readonly SourceRange[];

/**
 * Whether `text` can hold code at all: without a backtick, a tilde, an indented line or a component's `::` opening a
 * line (its YAML is literal), it can't, so nothing's computed.
 */
const mayHoldCode = (text: string) => /[`~]|(?:^|\n)(?: {4}|[ ]{0,3}\t| {0,3}::)/.test(text);

/** The code ranges of `text` under `scope`. */
export function codeRangesOf(text: string, scope: CodeScope = "note"): readonly SourceRange[] {
  if (typeof scope !== "string") return scope;
  if (!mayHoldCode(text)) return [];
  return scope === "inline" ? codeSpanRanges(text) : protectedCodeRanges(text);
}

/** `found` without what code hides. */
function outsideCode<T extends SourceRange>(text: string, found: T[], scope: CodeScope | undefined): T[] {
  if (!found.length) return found;
  const code = codeRangesOf(text, scope);
  return code.length ? found.filter(f => !codeHides(f, code)) : found;
}

/** A fragment id: what `^id` names in a note and `((id^fragment))` points at. */
export const FRAGMENT_ID_SOURCE = String.raw`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`;

// ── block references ─────────────────────────────────────────────────────────────────────────────────────────

const BLOCK_REFERENCE_HEAD_SOURCE = String.raw`\(\(([A-Za-z0-9_-]{8,})(?:\^(${FRAGMENT_ID_SOURCE}))?(?=\)\)|\|)`;

/** A `((…))` as the service reads it: its target, its label as written (one line, parentheses balanced), its offsets. */
export interface BlockReferenceOccurrence {
  blockId: string;
  fragmentId?: string;
  label?: string;
  start: number;
  end: number;
}

function blockReferenceMatches(text: string): BlockReferenceOccurrence[] {
  const matches: BlockReferenceOccurrence[] = [];
  const pattern = new RegExp(BLOCK_REFERENCE_HEAD_SOURCE, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const head = match.index + match[0].length;
    let end = head + 2;
    let label: string | undefined;
    if (text[head] === "|") {
      // A label is one line and needs at least one character.
      end = referenceEnvelopeEnd(text, head + 1, true, head + 2);
      if (end < 0) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      label = text.slice(head + 1, end - 2);
    }
    matches.push({
      blockId: match[1]!,
      ...(match[2] ? { fragmentId: match[2] } : {}),
      ...(label !== undefined ? { label } : {}),
      start: match.index,
      end,
    });
    pattern.lastIndex = end;
  }
  return matches;
}

/**
 * Every block reference in `text`, in order. A label runs to the `))` that balances its parentheses
 * (`((id|Rough edges (x)))` is labelled "Rough edges (x)"); a blank label (`((id| ))`) makes no reference.
 */
export function blockReferenceOccurrences(text: string, code?: CodeScope): BlockReferenceOccurrence[] {
  return outsideCode(text, blockReferenceMatches(text).filter(match => match.label === undefined || match.label.trim()), code);
}

/**
 * The block `input` names, when it is a block id or one block reference written whole (`((id))`, `((id^fragment))`,
 * `((id|label))`, blanks around it ignored), or null: what a value, a field or an argument naming a block unwraps
 * with, by the same scan that finds references in a note, so an id's first 8+ characters work as they do there.
 * An exact address (a URI, an MCP argument, a stored reference) that must be a full UUID is addressable-resource.ts's
 * `parseBlockRef`, which refuses anything else.
 */
export function referencedBlock(input: string): { blockId: string; fragment?: string } | null {
  const text = input.trim();
  if (BLOCK_ID_PATTERN.test(text)) return { blockId: text };
  const [ref] = blockReferenceOccurrences(text);
  if (!ref || ref.start !== 0 || ref.end !== text.length) return null;
  return { blockId: ref.blockId, ...(ref.fragmentId ? { fragment: ref.fragmentId } : {}) };
}

export function blockReferenceIds(text: string, code?: CodeScope): string[] {
  return blockReferenceOccurrences(text, code).map(reference => reference.blockId);
}

/** A `((…))` envelope: where it starts and the offset after its closing `))`. */
export interface BlockReferenceEnvelope {
  start: number;
  end: number;
}

/** Where each `((…))` envelope is, shared by reference parsing and every re-scan of resolved text. */
export function blockReferenceEnvelopeRanges(text: string): BlockReferenceEnvelope[] {
  const ranges: BlockReferenceEnvelope[] = [];
  for (let start = text.indexOf("(("); start >= 0; start = text.indexOf("((", start)) {
    const end = referenceEnvelopeEnd(text, start + 2);
    if (end < 0) break;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

// ── embeds ───────────────────────────────────────────────────────────────────────────────────────────────────

/** `!((id))` and `!((id^fragment))`: a transclusion (no label). */
export const EMBED_PATTERN_SOURCE = String.raw`!\(\(([A-Za-z0-9_-]{8,})(?:\^(${FRAGMENT_ID_SOURCE}))?\)\)`;
export const embedPattern = () => new RegExp(EMBED_PATTERN_SOURCE, "g");

// ── page links ───────────────────────────────────────────────────────────────────────────────────────────────

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const PAGE_ADDRESS_PATTERN = /\[\[([^\]\r\n]+)\]\]/g;

export const PAGE_ADDRESS_MAX_LENGTH = 512;

export interface NormalizedPageAddress {
  displayAddress: string;
  normalizedAddress: string;
}

export interface PageAddressReference extends NormalizedPageAddress {
  label?: string;
  start: number;
  end: number;
}

/** A page address as written and as compared (caseless, NFKC, one space). Throws on one no page can have. */
export function normalizePageAddress(input: string): NormalizedPageAddress {
  const displayAddress = input.trim();
  if (!displayAddress) throw new Error("Page address cannot be empty");
  if (displayAddress.length > PAGE_ADDRESS_MAX_LENGTH) {
    throw new Error(`Page address cannot exceed ${PAGE_ADDRESS_MAX_LENGTH} characters`);
  }
  if (CONTROL_PATTERN.test(displayAddress)) {
    throw new Error("Page address contains control characters");
  }
  if (displayAddress.includes("]")) {
    throw new Error("Page address cannot contain ]");
  }
  // Upper-then-lower performs stable caseless canonicalization for forms such as ß and final sigma.
  const normalizedAddress = displayAddress
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .toUpperCase()
    .toLowerCase();
  return { displayAddress, normalizedAddress };
}

export function tryNormalizePageAddress(input: string): NormalizedPageAddress | null {
  try {
    return normalizePageAddress(input);
  } catch {
    return null;
  }
}

/**
 * Every page link in `text`, in order: `[[address]]` or `[[address|label]]`. A blank label (`[[Garden| ]]`) or an
 * address no page can have makes no link: it stays visible as text.
 */
export function pageAddressReferences(text: string, code?: CodeScope): PageAddressReference[] {
  const references: PageAddressReference[] = [];
  for (const match of text.matchAll(PAGE_ADDRESS_PATTERN)) {
    const authored = match[1]!;
    const separator = authored.indexOf("|");
    const target = separator < 0 ? authored : authored.slice(0, separator);
    const label = separator < 0 ? undefined : authored.slice(separator + 1).trim();
    if (separator >= 0 && !label) continue;
    const address = tryNormalizePageAddress(target);
    if (!address) continue;
    references.push({ ...address, ...(label ? { label } : {}), start: match.index, end: match.index + match[0].length });
  }
  return outsideCode(text, references, code);
}

// ── Markdown links ───────────────────────────────────────────────────────────────────────────────────────────

/** A Markdown link, `[text](destination)`, not an image. */
export const MARKDOWN_LINK_SOURCE = String.raw`(?<!!)\[([^\[\]\r\n]*)\]\(([^)\r\n]*)\)`;
const MARKDOWN_LINK_OR_IMAGE = /!?\[[^\]\n]*\]\([^)\n]*\)/g;

// ── fragment anchors ─────────────────────────────────────────────────────────────────────────────────────────

const FRAGMENT_ANCHOR_PATTERN = new RegExp(String.raw`(?:^|\s)\^(${FRAGMENT_ID_SOURCE})\s*$`);

/**
 * The fragment anchor at the end of `line` (`## Beds ^beds`, `- [ ] stake the peas ^t-8a6d7f`): `[1]` its id,
 * `index` where it starts (with the blank before it). A line that is only an anchor names the line above it.
 */
export function fragmentAnchorMatch(line: string): RegExpMatchArray | null {
  return line.match(FRAGMENT_ANCHOR_PATTERN);
}

/** `line` without its fragment anchor (and the blanks before it), as a reader shows it. */
export function withoutFragmentAnchor(line: string): string {
  const match = fragmentAnchorMatch(line);
  return match ? line.slice(0, match.index).trimEnd() : line;
}

// ── a note's links, in reading order ─────────────────────────────────────────────────────────────────────────

export type LinkOccurrence =
  | ({ kind: "block"; embed: boolean } & BlockReferenceOccurrence)
  | ({ kind: "page" } & PageAddressReference)
  | { kind: "markdown"; text: string; url: string; start: number; end: number };

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/**
 * The links of `text` in reading order, none overlapping: Markdown links, block references (`embed`: an unlabelled
 * one written `!((…))`, whose `start` is its `!`) and page links. Where a Markdown link or image and a reference
 * overlap, the one that holds the other is the link (`[see ((id))](url)` is a web link, `((id|[docs](url)))` a
 * reference); a page link inside a `((…))` is the reference's label. A link in code is text (`CodeScope`: a whole note
 * by default; a caller scanning one line passes `"inline"`).
 */
export function linkOccurrences(text: string, code?: CodeScope): LinkOccurrence[] {
  const refs = blockReferenceOccurrences(text, []);
  const holds = (outer: { start: number; end: number }, inner: { start: number; end: number }) => outer.start <= inner.start && inner.end <= outer.end;
  const free = (m: { start: number; end: number }) => !refs.some(ref => holds(ref, m) && !holds(m, ref));
  // What Markdown claims (links and images, as the service protects them), less what a reference's label holds.
  const markdown = [...text.matchAll(MARKDOWN_LINK_OR_IMAGE)].map(m => ({ start: m.index, end: m.index + m[0].length })).filter(free);
  const out: LinkOccurrence[] = [...text.matchAll(new RegExp(MARKDOWN_LINK_SOURCE, "g"))]
    .map(m => ({ kind: "markdown" as const, text: m[1]!, url: m[2]!, start: m.index, end: m.index + m[0].length }))
    .filter(free);
  for (const ref of refs) {
    if (markdown.some(range => overlaps(ref, range))) continue;
    const embed = ref.label === undefined && text[ref.start - 1] === "!";
    out.push({ kind: "block", embed, ...ref, start: embed ? ref.start - 1 : ref.start });
  }
  const envelopes = blockReferenceEnvelopeRanges(text);
  for (const page of pageAddressReferences(text, [])) {
    if (markdown.some(range => overlaps(page, range)) || envelopes.some(range => overlaps(page, range))) continue;
    out.push({ kind: "page", ...page });
  }
  return outsideCode(text, out, code).sort((a, b) => a.start - b.start);
}
