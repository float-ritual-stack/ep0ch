import { standaloneListItemText, markdownSourceTokens, type MarkdownListItem, type MarkdownSourceToken } from "./markdown-structure";

import { FRAGMENT_ID_SOURCE, fragmentAnchorMatch } from "@ep0ch/outline-core/link-syntax";
import { outputHeader } from "@ep0ch/outline-core/output-region";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import type { FragmentKind } from "@ep0ch/outline-core/protocol";

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * The kinds are outline-core's (`protocol.ts`, on the wire). `component`: an anchor at the end of a component's opening
 * line (`::graph-timeline ^landed`, PIE-1247; the component's own `^name`, PIE-747), or (PIE-580) on a line of its own
 * right after its closing `::`, names that block (a figure, a `::links`), so `((id^landed))` lands on the figure and its
 * slice is the whole block.
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

type Component = { start: number; end: number; name: string };
interface ComponentMemo { all?: Component[]; byEnd?: Map<number, Component>; byStart?: Map<number, Component> }
const componentsOf = (lines: readonly string[], memo: ComponentMemo) => (memo.all ??= componentBlocks(lines));
/** The component blocks of `lines` by the line of their closing `::`, found once per parse. */
function componentsByEnd(lines: readonly string[], memo: ComponentMemo) {
  memo.byEnd ??= new Map(componentsOf(lines, memo).filter(c => c.end > c.start).map(c => [c.end, c]));
  return memo.byEnd;
}
/** The component blocks of `lines` by their opening line (a one-line `::links ((id))` too). */
function componentsByStart(lines: readonly string[], memo: ComponentMemo) {
  memo.byStart ??= new Map(componentsOf(lines, memo).map(c => [c.start, c]));
  return memo.byStart;
}
/** The component an anchor on line `lineIndex` (with `content` before it) names: on its opening line, or alone after its `::`. */
function anchoredComponent(lines: readonly string[], lineIndex: number, content: string, memo: ComponentMemo): Component | undefined {
  return componentsByStart(lines, memo).get(lineIndex) ?? (!content ? componentsByEnd(lines, memo).get(lineIndex - 1) : undefined);
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

/**
 * The quote or callout an anchor on line `lineIndex` names whole: one at the end of its last line (PIE-592), on a
 * callout's `> [!type] title` line (PIE-1247), or on an output region's header (PIE-956). One on another line of a quote
 * is that line's own.
 */
function quoteOfAnchor(note: ParsedNote, lines: readonly string[], lineIndex: number): Quote | undefined {
  return note.quotes.find(q => q.endLine === lineIndex || (q.startLine === lineIndex && (outputHeader(lines[lineIndex]!) !== null
    || CALLOUT_HEAD.test(contentBeforeAnchor(lines[lineIndex]!, fragmentAnchorMatch(lines[lineIndex]!))))));
}

function parseAnchors(text: string, note: ParsedNote): FragmentAnchor[] {
  const lines = text.split(/\r?\n/);
  const components: ComponentMemo = {};
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
    // An anchor on a component's opening line is the component's (PIE-1247), as is one alone on the line after its
    // `::` (PIE-580).
    const component = anchoredComponent(lines, lineIndex, content, components);
    // One at the end of a quote's last line, or on a callout's head, is the whole quote's or callout's.
    const quote = !component ? quoteOfAnchor(note, lines, lineIndex) : undefined;
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
    const q = quoteOfAnchor(parsedNote(text), lines, anchor.lineIndex)!;
    startLine = q.startLine; endLine = q.endLine;
  } else if (anchor.kind === "component") {
    // The whole block, from its `::name` line to its `::`; an anchor on a line of its own stays out of the slice.
    const block = anchoredComponent(lines, anchor.lineIndex, contentBeforeAnchor(lines[anchor.lineIndex]!, fragmentAnchorMatch(lines[anchor.lineIndex]!)), {})!;
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
 * The components, paragraphs, list items, quotes and callouts of `text` with no anchor yet, each on the line its anchor
 * would go on: a component's opening line, a list item's first line, a paragraph's last. Left out: code, the lines
 * inside a component, property-only lines, and a paragraph that runs into the note's first line (the title: link the
 * note itself).
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
  const component = new Set<number>(), inside: { start: number; end: number }[] = [];
  const out: FragmentCandidate[] = [];
  for (const c of componentBlocks(lines)) {
    // A component is one passage (PIE-1247), offered on its opening line, where its anchor goes; one inside another
    // component is part of that one, and one anchored already (on its opener, or after its `::`) is an anchor.
    const nested = inside.some(o => o.start < c.start && c.start <= o.end);
    inside.push(c);
    for (let l = c.start; l <= c.end + 1; l++) component.add(l);
    if (nested || c.id) continue;
    const after = lines[c.end + 1];
    if (c.end > c.start && after !== undefined && fragmentAnchorMatch(after) && !contentBeforeAnchor(after, fragmentAnchorMatch(after))) continue;
    out.push({ kind: "component", label: componentLabel(lines, c), lineIndex: c.start });
  }
  // A quote or callout is one passage (PIE-592), offered on its last line, where its anchor goes; its lines are its own.
  const quoted = new Set<number>();
  for (const q of note.quotes) {
    for (let l = q.startLine; l <= q.endLine; l++) quoted.add(l);
    // Anchored already on its last line or a callout's head (its own anchor); one on another line is that line's.
    if (fragmentAnchorMatch(lines[q.endLine] ?? "") || (quoteOfAnchor(note, lines, q.startLine) === q && fragmentAnchorMatch(lines[q.startLine] ?? ""))) continue;
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
 * Give the fragment on `lineIndex` its anchor: a heading (`## Beds ^beds`), or (PIE-762) a list item's first line, a
 * paragraph's last or (PIE-1247) a component's opening line (`::graph-timeline ^graph-timeline`), as
 * `fragmentCandidates` offers them in `passage` mode. A line that has one keeps it; anything else
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
    throw new Error(`Fragment target is not a heading, component, callout, quote, paragraph or list item that can take an anchor: line ${lineIndex + 1}`);
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

/** Every part of `text` a reference can take, with the lines it covers: one parse, the parts an anchor can't be written on left out. */
function partsOf(text: string): { c: FragmentCandidate; start: number; end: number }[] {
  const out: { c: FragmentCandidate; start: number; end: number }[] = [];
  for (const c of fragmentCandidates(text, "", "passage")) {
    let anchored: { text: string; id: string };
    try { anchored = c.fragmentId ? { text, id: c.fragmentId } : (() => { const a = ensureFragmentAnchor(text, c.lineIndex); return { text: a.text, id: a.fragmentId }; })(); }
    catch { continue; } // a line an anchor can't go on (a front-matter property): no part to take
    const r = resolveFragmentSlice(anchored.text, anchored.id);
    if (r.status === "resolved") out.push({ c, start: r.slice.startLine, end: r.slice.endLine });
  }
  return out;
}

/**
 * The element line `line` belongs to (PIE-1247: what a press, a drag or `element.detach` on that line means): the
 * innermost of the note's figures, callouts, quotes, list items, paragraphs and heading sections that holds it, with
 * its anchor when it has one, else the line its anchor would go on. With `next`, a line no part holds (a blank, the
 * title) means the first part that starts after it. Null when there is none. `start`, `end`: the lines it covers.
 */
export function elementAt(text: string, line: number, next = false): (FragmentCandidate & { start: number; end: number }) | null {
  const parts = partsOf(text);
  const holding = parts.filter(p => line >= p.start && line <= p.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  const found = holding ?? (next ? parts.filter(p => p.start > line).sort((a, b) => a.start - b.start || b.end - a.end)[0] : undefined);
  return found ? { ...found.c, start: found.start, end: found.end } : null;
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
