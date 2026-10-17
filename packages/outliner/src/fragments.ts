import { standaloneListItemText, markdownSourceTokens, type MarkdownListItem, type MarkdownSourceToken } from "./markdown-structure";

import { FRAGMENT_ID_SOURCE, fragmentAnchorMatch } from "@ep0ch/outline-core/link-syntax";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import type { FragmentKind } from "@ep0ch/outline-core/protocol";

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * The kinds are outline-core's (`protocol.ts`, on the wire). `component` (PIE-580): an anchor on a line of its own right
 * after a component block's closing `::` names that block (a figure, a `::links`), so `((id^quadrant))` lands on the
 * figure and its slice is the whole block.
 */
export type { FragmentKind };

export interface FragmentAnchor {
  id: string;
  kind: FragmentKind;
  label: string;
  lineIndex: number;
  markerStart: number;
}

export interface FragmentCandidate {
  kind: FragmentKind;
  label: string;
  lineIndex: number;
  fragmentId?: string;
}

export type FragmentResolution =
  | { status: "resolved"; anchor: FragmentAnchor }
  | { status: "missing" }
  | { status: "duplicate"; anchors: FragmentAnchor[] };

export interface FragmentSlice {
  anchor: FragmentAnchor;
  text: string;
  startLine: number;
  endLine: number;
}

export type FragmentSliceResolution =
  | { status: "resolved"; slice: FragmentSlice }
  | { status: "missing" }
  | { status: "duplicate"; anchors: FragmentAnchor[] };

export interface FragmentCompletionQuery {
  blockQuery: string;
  fragmentQuery: string;
  mode: "heading" | "id";
}

/**
 * What a fragment search offers: `heading`, headings (anchored or not) and the other anchors; `id`, anchors only;
 * `passage` (PIE-762), everything a reference can point into: the anchors, then headings, paragraphs, list items,
 * quotes and callouts (PIE-592)
 * that have none yet, each with the anchor it would get.
 */
export type FragmentMode = "heading" | "id" | "passage";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    offsets.push(index + 1);
  }
  return offsets;
}

function contentBeforeAnchor(line: string, match: RegExpMatchArray | null): string {
  return match ? line.slice(0, match.index).trimEnd() : line.trimEnd();
}

function paragraphLabel(lines: readonly string[], lineIndex: number, finalLine: string, from?: number): string {
  let start = from ?? lineIndex;
  while (
    from === undefined &&
    start > 0 &&
    lines[start - 1]!.trim() !== "" &&
    !contentBeforeAnchor(
      lines[start - 1]!,
      fragmentAnchorMatch(lines[start - 1]!),
    ).match(HEADING_PATTERN)
  ) {
    start -= 1;
  }
  const paragraph = [...lines.slice(start, lineIndex), finalLine]
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return paragraph || `Line ${lineIndex + 1}`;
}

export function isFragmentId(value: string): boolean {
  return new RegExp(`^${FRAGMENT_ID_SOURCE}$`).test(value);
}

/**
 * One Markdown parse of a note's text, shared by everything this module answers about it: its list
 * items, its code lines and its anchors. The last few texts are kept, so asking about many fragments of
 * one note (an outline of slices, a reader's embeds) parses it once. Callers get copies.
 */
interface ParsedNote { listItems: MarkdownListItem[]; codeLines: Set<number>; quotes: Quote[]; anchors?: FragmentAnchor[] }
/** A blockquote outside any list item, its first and last lines: a callout when its first line is `> [!type] title`. */
interface Quote { startLine: number; endLine: number }
const PARSED_NOTES = 32;
const parsedNotes = new Map<string, ParsedNote>();
function parsedNote(text: string): ParsedNote {
  const hit = parsedNotes.get(text);
  if (hit) { parsedNotes.delete(text); parsedNotes.set(text, hit); return hit; }
  const listItems: MarkdownListItem[] = [];
  const codeLines = new Set<number>();
  const quotes: Quote[] = [];
  const visit = (nodes: readonly MarkdownSourceToken[], depth: number, parentStart?: number, inQuote = false): void => {
    for (const node of nodes) {
      if (node.token.type === "code") {
        for (let line = node.span.startLine; line <= node.span.endLine; line++) codeLines.add(line);
      } else if (node.token.type === "blockquote") {
        if (!inQuote && parentStart === undefined) quotes.push({ startLine: node.span.startLine, endLine: node.span.endLine });
        visit(node.children, depth, parentStart, true);
      } else if (node.token.type === "list_item") {
        listItems.push({ span: node.span, depth, ...(parentStart === undefined ? {} : { parentStart }) });
        visit(node.children, depth + 1, node.span.start, inQuote);
      } else visit(node.children, depth, parentStart, inQuote);
    }
  };
  visit(markdownSourceTokens(text), 0);
  const note = { listItems, codeLines, quotes };
  parsedNotes.set(text, note);
  if (parsedNotes.size > PARSED_NOTES) parsedNotes.delete(parsedNotes.keys().next().value!);
  return note;
}

/** The lines inside fenced or indented code: no anchor, heading, boundary or embed lives there (PIE-424). */
export function codeLineSet(text: string): Set<number> {
  // Without a fence or an indented line there's no code to find, and nothing to parse.
  if (!MAY_HOLD_CODE.test(text)) return new Set();
  return new Set(parsedNote(text).codeLines);
}
const MAY_HOLD_CODE = /^(?: {4}|\t| {0,3}(?:```|~~~))/m;

export function fragmentAnchors(text: string): FragmentAnchor[] {
  const note = parsedNote(text);
  note.anchors ??= parseAnchors(text, note);
  return note.anchors.map(anchor => ({ ...anchor }));
}

/** The component blocks of `lines` by the line of their closing `::`, found once per parse. */
function componentsByEnd(lines: readonly string[], memo: { map?: Map<number, { start: number; end: number; name: string }> }) {
  memo.map ??= new Map(componentBlocks(lines).filter(c => c.end > c.start).map(c => [c.end, c]));
  return memo.map;
}

/**
 * A component's name for a fragment list: its `title:` when its YAML header (between the `---` lines right after
 * the opener) has one, parsed as YAML, else `::graph-rank`.
 */
function componentLabel(lines: readonly string[], c: { start: number; end: number; name: string }): string {
  const body = lines.slice(c.start + 1, c.end);
  const open = body.findIndex(l => l.trim());
  if (open >= 0 && /^\s*---\s*$/.test(body[open]!)) {
    const close = body.findIndex((l, i) => i > open && /^\s*---\s*$/.test(l));
    if (close > open) {
      try {
        const yaml = Bun.YAML.parse(body.slice(open + 1, close).join("\n")) as { title?: unknown } | null;
        if (yaml && typeof yaml === "object" && typeof yaml.title === "string" && yaml.title.trim()) return yaml.title.trim();
      } catch { /* a bad header names the component by its kind */ }
    }
  }
  return `::${c.name}`;
}

const CALLOUT_HEAD = /^\s*>\s*\[!([^\]\s]+)\][+-]?\s*(.*)$/;

/**
 * A quote's kind and name for a fragment list (PIE-592): a callout by its title (else its type), a quote by its words,
 * the `>` marks and anchors left out.
 */
function quoteFragment(lines: readonly string[], q: Quote): { kind: "quote" | "callout"; label: string } {
  const head = contentBeforeAnchor(lines[q.startLine]!, fragmentAnchorMatch(lines[q.startLine]!)).match(CALLOUT_HEAD);
  if (head) return { kind: "callout", label: head[2]!.trim() || head[1]! };
  const words = lines.slice(q.startLine, q.endLine + 1)
    .map(line => contentBeforeAnchor(line, fragmentAnchorMatch(line)).replace(/^\s*(?:>\s?)+/, "").trim())
    .filter(Boolean).join(" ");
  return { kind: "quote", label: words || `Line ${q.startLine + 1}` };
}

function parseAnchors(text: string, note: ParsedNote): FragmentAnchor[] {
  const lines = text.split(/\r?\n/);
  const components: { map?: Map<number, { start: number; end: number; name: string }> } = {};
  const offsets = lineOffsets(text);
  const items = new Map(note.listItems.map(item => [item.span.startLine, item]));
  const codeLines = note.codeLines;
  const anchors: FragmentAnchor[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (codeLines.has(lineIndex)) continue;
    const line = lines[lineIndex]!;
    const match = fragmentAnchorMatch(line);
    if (!match) continue;
    const content = contentBeforeAnchor(line, match);
    const heading = content.match(HEADING_PATTERN);
    const item = items.get(lineIndex);
    // An anchor alone on the line after a component's `::` is the component's (PIE-580).
    const component = !content && componentsByEnd(lines, components).get(lineIndex - 1);
    // One at the end of a quote's last line is the whole quote's or callout's (PIE-592).
    const quote = !component ? note.quotes.find(q => q.endLine === lineIndex) : undefined;
    const quoted = quote ? quoteFragment(lines, quote) : null;
    anchors.push({
      id: match[1]!,
      kind: component ? "component" : quoted ? quoted.kind : item ? "list-item" : heading ? "heading" : "paragraph",
      label: component
        ? componentLabel(lines, component)
        : quoted
        ? quoted.label
        : item
        ? content.slice(item.span.start - offsets[lineIndex]!).replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
        : heading?.[2]?.trim() || paragraphLabel(lines, lineIndex, content),
      lineIndex,
      markerStart: offsets[lineIndex]! + match.index!,
    });
  }
  return anchors;
}

export function resolveFragment(text: string, fragmentId: string): FragmentResolution {
  const matches = fragmentAnchors(text).filter((anchor) => anchor.id === fragmentId);
  if (matches.length === 0) return { status: "missing" };
  if (matches.length > 1) return { status: "duplicate", anchors: matches };
  return { status: "resolved", anchor: matches[0]! };
}

export function resolveFragmentSlice(
  text: string,
  fragmentId: string,
): FragmentSliceResolution {
  const resolution = resolveFragment(text, fragmentId);
  if (resolution.status !== "resolved") return resolution;

  const lines = text.split(/\r?\n/);
  const anchor = resolution.anchor;
  let startLine = anchor.lineIndex;
  let endLine = anchor.lineIndex;
  if (anchor.kind === "quote" || anchor.kind === "callout") {
    // The whole quote or callout, every `>` line of it.
    const q = parsedNote(text).quotes.find(q => q.endLine === anchor.lineIndex)!;
    startLine = q.startLine; endLine = q.endLine;
  } else if (anchor.kind === "component") {
    // The whole block, from its `::name` line to its `::`; the anchor's own line stays out of the slice.
    const block = componentsByEnd(lines, {}).get(anchor.lineIndex - 1)!;
    startLine = block.start; endLine = block.end;
  } else if (anchor.kind === "list-item") {
    const item = parsedNote(text).listItems.find(item => item.span.startLine === anchor.lineIndex)!;
    endLine = item.span.endLine;
  } else if (anchor.kind === "heading") {
    const heading = contentBeforeAnchor(
      lines[anchor.lineIndex]!,
      fragmentAnchorMatch(lines[anchor.lineIndex]!),
    ).match(HEADING_PATTERN)!;
    const depth = heading[1]!.length;
    endLine = lines.length - 1;
    // A `#` line inside a code fence is code, not a heading: it never ends the section.
    const codeLines = parsedNote(text).codeLines;
    for (let lineIndex = anchor.lineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (codeLines.has(lineIndex)) continue;
      const candidate = contentBeforeAnchor(
        lines[lineIndex]!,
        fragmentAnchorMatch(lines[lineIndex]!),
      ).match(HEADING_PATTERN);
      if (candidate && candidate[1]!.length <= depth) {
        endLine = lineIndex - 1;
        break;
      }
    }
  } else {
    while (
      startLine > 0 &&
      lines[startLine - 1]!.trim() !== "" &&
      !contentBeforeAnchor(
        lines[startLine - 1]!,
        fragmentAnchorMatch(lines[startLine - 1]!),
      ).match(HEADING_PATTERN)
    ) {
      startLine -= 1;
    }
  }

  const sliceText = stripFragmentAnchors(lines.slice(startLine, endLine + 1).join("\n"))
    .trimEnd();
  return {
    status: "resolved",
    slice: { anchor, text: sliceText, startLine, endLine },
  };
}

export function fragmentCandidates(
  text: string,
  query = "",
  mode: FragmentMode = "heading",
): FragmentCandidate[] {
  const lines = text.split(/\r?\n/);
  const anchors = fragmentAnchors(text);
  const anchorsByLine = new Map(anchors.map((anchor) => [anchor.lineIndex, anchor]));
  const candidates: FragmentCandidate[] = [];

  if (mode !== "id") {
    const codeLines = codeLineSet(text);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (codeLines.has(lineIndex)) continue;
      const line = lines[lineIndex]!;
      const match = fragmentAnchorMatch(line);
      const heading = contentBeforeAnchor(line, match).match(HEADING_PATTERN);
      if (!heading) continue;
      const anchor = anchorsByLine.get(lineIndex);
      candidates.push({
        kind: "heading",
        label: heading[2]!.trim(),
        lineIndex,
        ...(anchor ? { fragmentId: anchor.id } : {}),
      });
    }
  }

  for (const anchor of anchors) {
    if (mode !== "id" && anchor.kind === "heading") continue;
    candidates.push({
      kind: anchor.kind,
      label: anchor.label,
      lineIndex: anchor.lineIndex,
      fragmentId: anchor.id,
    });
  }

  if (mode === "passage") candidates.push(...passages(text, lines));

  const normalizedQuery = normalize(query);
  // The anchors a note already has come first (PIE-762): they are valid targets as they stand. Then the rest, in
  // reading order, each with the anchor choosing it adds.
  const order = (c: FragmentCandidate) => (c.fragmentId ? 0 : 1);
  return candidates
    .filter((candidate) =>
      !normalizedQuery ||
      normalize(candidate.label).includes(normalizedQuery) ||
      normalize(candidate.fragmentId ?? "").includes(normalizedQuery))
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => order(a.candidate) - order(b.candidate) || a.candidate.lineIndex - b.candidate.lineIndex || a.index - b.index)
    .map(({ candidate }) => candidate);
}

/**
 * The paragraphs, list items, quotes and callouts of `text` with no anchor yet, each on the line its anchor would go on: a list item's
 * first line, a paragraph's last. Left out: code, component blocks, property-only lines, and a paragraph that runs into
 * the note's first line (the title: link the note itself).
 */
function passages(text: string, lines: readonly string[]): FragmentCandidate[] {
  const note = parsedNote(text);
  const offsets = lineOffsets(text);
  const items = new Map(note.listItems.map(item => [item.span.startLine, item]));
  // Each line's own list item, the innermost that holds it: an item's anchor can sit on any of its own lines.
  const ownerOf = new Map<number, number>();
  for (const item of [...note.listItems].sort((a, b) => a.span.startLine - b.span.startLine)) {
    for (let l = item.span.startLine; l <= item.span.endLine; l++) ownerOf.set(l, item.span.startLine);
  }
  const itemAnchored = new Set<number>();
  for (const [l, owner] of ownerOf) if (fragmentAnchorMatch(lines[l] ?? "")) itemAnchored.add(owner);
  const component = new Set<number>();
  for (const c of componentBlocks(lines)) for (let l = c.start; l <= c.end + 1; l++) component.add(l);
  // A quote or callout is one passage (PIE-592), offered on its last line, where its anchor goes; its lines are its own.
  const quoted = new Set<number>();
  const out: FragmentCandidate[] = [];
  for (const q of note.quotes) {
    for (let l = q.startLine; l <= q.endLine; l++) quoted.add(l);
    // Anchored already on its last line (its own anchor); one on an earlier line is that line's, not the quote's.
    if (fragmentAnchorMatch(lines[q.endLine] ?? "")) continue;
    out.push({ ...quoteFragment(lines, q), lineIndex: q.endLine });
  }
  const skip = (i: number) => note.codeLines.has(i) || component.has(i) || quoted.has(i);
  const heading = (line: string) => HEADING_PATTERN.test(contentBeforeAnchor(line, fragmentAnchorMatch(line)));
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (skip(lineIndex) || !line.trim() || fragmentAnchorMatch(line) || heading(line)) continue;
    if (!withoutPropertyTokens(line).trim()) continue;
    const item = items.get(lineIndex);
    if (item) {
      const label = line.trimEnd().slice(item.span.start - offsets[lineIndex]!).replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "").trim();
      if (label && !itemAnchored.has(lineIndex)) out.push({ kind: "list-item", label, lineIndex });
      continue;
    }
    if (ownerOf.has(lineIndex)) continue;
    const next = lines[lineIndex + 1];
    if (next !== undefined && next.trim() && !heading(next) && !items.has(lineIndex + 1) && !skip(lineIndex + 1)) continue;
    // Back to the paragraph's first line: a blank line, a heading, code, a component or a list item ends it. One
    // that reaches the title is the title's (link the note itself); one with an anchor on an earlier line has one.
    let start = lineIndex;
    const ends = (l: number) => !lines[l]!.trim() || heading(lines[l]!) || skip(l) || ownerOf.has(l);
    while (start > 0 && !ends(start - 1)) start -= 1;
    if (start === 0) continue;
    if (lines.slice(start, lineIndex).some(l => fragmentAnchorMatch(l))) continue;
    out.push({ kind: "paragraph", label: paragraphLabel(lines, lineIndex, line.trimEnd(), start), lineIndex });
  }
  return out;
}

function fragmentSlug(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 48);
  return slug || "fragment";
}

function uniqueFragmentId(base: string, usedIds: ReadonlySet<string>): string {
  if (!usedIds.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}-${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }
}

/**
 * Give the fragment on `lineIndex` its anchor: a heading (`## Beds ^beds`), or (PIE-762) a list item's first line or a
 * paragraph's last, as `fragmentCandidates` offers them in `passage` mode. A line that has one keeps it; anything else
 * is refused.
 */
export function ensureFragmentAnchor(
  text: string,
  lineIndex: number,
): { text: string; fragmentId: string; created: boolean } {
  const lines = text.split(/\r?\n/);
  const line = lines[lineIndex];
  if (line === undefined) throw new Error(`Fragment line is unavailable: ${lineIndex + 1}`);
  const existing = fragmentAnchorMatch(line);
  const content = contentBeforeAnchor(line, existing);
  const heading = content.match(HEADING_PATTERN);
  const passage = heading ? null : passages(text, lines).find(p => p.lineIndex === lineIndex);
  if (!heading && !passage && !existing) {
    throw new Error(`Fragment target is not a heading, paragraph or list item that can take an anchor: line ${lineIndex + 1}`);
  }
  if (existing) return { text, fragmentId: existing[1]!, created: false };
  // A front-matter property line (`- re:: why`): an anchor written after its value would become part of the value.
  if (lineIndex > 0 && parsePropertyRecords(text).some(p => p.line === lineIndex && p.scope === "block" && p.syntax !== "hashtag")) {
    throw new Error(`line ${lineIndex + 1} is a front-matter property, where an anchor would become part of its value: link the note, or anchor a line of the body`);
  }

  const usedIds = new Set(fragmentAnchors(text).map((anchor) => anchor.id));
  const fragmentId = uniqueFragmentId(heading ? fragmentSlug(heading[2]!) : passageSlug(passage!.label), usedIds);
  const start = lineOffsets(text)[lineIndex]!;
  return {
    text: text.slice(0, start) + `${content} ^${fragmentId}` +
      text.slice(start + line.length),
    fragmentId,
    created: true,
  };
}

/** A passage's anchor: its first three words, short enough to type (`^water-the-seedlings`). */
function passageSlug(label: string): string {
  const words = label.replace(/^\[[ xX~>-]\]\s*/, "").split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).slice(0, 3).join(" ");
  return fragmentSlug(words).slice(0, 24).replace(/[-_]+$/, "") || "passage";
}

/** `text` without its `^anchor` marker: the marker off its line, or the line itself when it's only the marker. */
export function withoutAnchor(text: string, anchor: string): string {
  const lines = text.split(/\r?\n/);
  const at = fragmentAnchors(text).find((found) => found.id === anchor);
  if (!at) return text;
  const line = lines[at.lineIndex]!;
  const match = fragmentAnchorMatch(line);
  if (!match) return text;
  const kept = line.slice(0, match.index).trimEnd();
  if (kept.trim()) lines[at.lineIndex] = kept;
  else lines.splice(at.lineIndex, 1);
  return lines.join("\n");
}

/** `text` with ` ^anchor` at the end of its last line that isn't blank. */
export function withAnchorAtEnd(text: string, anchor: string): string {
  const lines = text.split(/\r?\n/);
  let last = lines.length - 1;
  while (last >= 0 && !lines[last]!.trim()) last -= 1;
  if (last < 0) return text;
  lines[last] = `${lines[last]!.trimEnd()} ^${anchor}`;
  return lines.join("\n");
}

export function stripFragmentAnchors(text: string): string {
  return text.split(/\r?\n/).map((line) => contentBeforeAnchor(line, fragmentAnchorMatch(line))).join("\n");
}

export function parseFragmentCompletionQuery(query: string): FragmentCompletionQuery | null {
  const headingDelimiter = query.lastIndexOf("#");
  const idDelimiter = query.lastIndexOf("^");
  const delimiter = Math.max(headingDelimiter, idDelimiter);
  if (delimiter < 0) return null;
  return {
    blockQuery: query.slice(0, delimiter).trim(),
    fragmentQuery: query.slice(delimiter + 1).trim(),
    mode: delimiter === headingDelimiter ? "heading" : "id",
  };
}

export function fragmentPresentationText(slice: FragmentSlice): string {
  return slice.anchor.kind === "list-item" ? standaloneListItemText(slice.text) : slice.text;
}
