// Reference completion's pure half, ported from pi-herdr-outliner so the door inserts exactly what Tree,
// Detail and Quick Capture insert: which `[[`, `((` or `[file::` the cursor is in (src/completion.ts),
// how a page or Work-ID is written (`[[WORK-ID|title]]`, else `[[address]]`), Work-ID recognition
// (src/work-ids.ts), and the stable fragment anchors a `((block^id))` can point at (src/fragments.ts,
// without the Markdown parser: list items and fenced code are recognised by line).

export type CompletionKind = "page" | "block" | "file";

export interface CompletionTarget {
  kind: CompletionKind;
  /** Where the token starts on the line (its opening delimiter) and where a choice replaces up to. */
  start: number;
  end: number;
  /** What was typed after the opening delimiter, up to the cursor. */
  query: string;
}

const TARGET_SYNTAX: ReadonlyArray<{ kind: CompletionKind; opening: string; closing: string }> = [
  { kind: "page", opening: "[[", closing: "]]" },
  { kind: "block", opening: "((", closing: "))" },
  { kind: "file", opening: "[file::", closing: "]" },
];

/** The innermost unclosed `[[`, `((` or `[file::` before the cursor, or null. */
export function completionTargetAtCursor(line: string, column: number): CompletionTarget | null {
  const end = Math.max(0, Math.min(column, line.length));
  const beforeCursor = line.slice(0, end);
  let target: CompletionTarget | null = null;
  for (const syntax of TARGET_SYNTAX) {
    let searchFrom = beforeCursor.length, closedDepth = 0, start = -1;
    while (searchFrom > 0) {
      const opening = beforeCursor.lastIndexOf(syntax.opening, searchFrom - 1);
      const closing = beforeCursor.lastIndexOf(syntax.closing, searchFrom - 1);
      if (opening < 0) break;
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
  return target;
}

/** The rows of a list of `count` a window of `capacity` shows, keeping `selected` centred. */
export function completionWindow(count: number, selected: number, capacity: number): { start: number; end: number } {
  const n = Math.max(0, Math.min(count, capacity));
  if (!n) return { start: 0, end: 0 };
  const sel = Math.max(0, Math.min(selected, count - 1));
  const start = Math.max(0, Math.min(sel - Math.floor(n / 2), count - n));
  return { start, end: start + n };
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

const FRAGMENT_ANCHOR = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const LIST_ITEM = /^\s*(?:[-+*]|\d+[.)])\s+/;

export type FragmentKind = "heading" | "paragraph" | "list-item";
export interface FragmentAnchor { id: string; kind: FragmentKind; label: string; lineIndex: number }
export interface FragmentCandidate { kind: FragmentKind; label: string; lineIndex: number; fragmentId?: string }

const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
const beforeAnchor = (line: string, m: RegExpMatchArray | null) => (m ? line.slice(0, m.index).trimEnd() : line.trimEnd());

/** Lines inside fenced code, where `^id` is text, not an anchor. */
function fencedLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>();
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const m = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) { out.add(i); if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) fence = null; }
    else if (m) { fence = m[1]!; out.add(i); }
  });
  return out;
}

function paragraphLabel(lines: readonly string[], lineIndex: number, finalLine: string): string {
  let start = lineIndex;
  while (start > 0 && lines[start - 1]!.trim() !== "" && !beforeAnchor(lines[start - 1]!, lines[start - 1]!.match(FRAGMENT_ANCHOR)).match(HEADING)) start--;
  return [...lines.slice(start, lineIndex), finalLine].map(l => l.trim()).filter(Boolean).join(" ") || `Line ${lineIndex + 1}`;
}

/** Every `^id` anchor in a note's text, with what it anchors. */
export function fragmentAnchors(text: string): FragmentAnchor[] {
  const lines = text.split(/\r?\n/), code = fencedLines(lines), out: FragmentAnchor[] = [];
  lines.forEach((line, lineIndex) => {
    if (code.has(lineIndex)) return;
    const m = line.match(FRAGMENT_ANCHOR);
    if (!m) return;
    const content = beforeAnchor(line, m), heading = content.match(HEADING), item = content.match(LIST_ITEM);
    out.push({
      id: m[1]!, lineIndex,
      kind: item ? "list-item" : heading ? "heading" : "paragraph",
      label: item ? content.slice(item[0].length) : heading?.[2]?.trim() || paragraphLabel(lines, lineIndex, content),
    });
  });
  return out;
}

export function resolveFragment(text: string, fragmentId: string): "resolved" | "missing" | "duplicate" {
  const n = fragmentAnchors(text).filter(a => a.id === fragmentId).length;
  return n === 0 ? "missing" : n > 1 ? "duplicate" : "resolved";
}

/** `((garden#beds` (a heading) or `((garden^be` (an anchor id): the block part and the fragment part. */
export function parseFragmentCompletionQuery(query: string): { blockQuery: string; fragmentQuery: string; mode: "heading" | "id" } | null {
  const h = query.lastIndexOf("#"), i = query.lastIndexOf("^"), d = Math.max(h, i);
  if (d < 0) return null;
  return { blockQuery: query.slice(0, d).trim(), fragmentQuery: query.slice(d + 1).trim(), mode: d === h ? "heading" : "id" };
}

/** What a `((block#…` / `((block^…` can point at in one note: its headings (anchored or not) and its anchors. */
export function fragmentCandidates(text: string, query = "", mode: "heading" | "id" = "heading"): FragmentCandidate[] {
  const lines = text.split(/\r?\n/), anchors = fragmentAnchors(text), code = fencedLines(lines);
  const byLine = new Map(anchors.map(a => [a.lineIndex, a]));
  const out: FragmentCandidate[] = [];
  if (mode === "heading") lines.forEach((line, lineIndex) => {
    if (code.has(lineIndex)) return;
    const heading = beforeAnchor(line, line.match(FRAGMENT_ANCHOR)).match(HEADING);
    if (!heading) return;
    const a = byLine.get(lineIndex);
    out.push({ kind: "heading", label: heading[2]!.trim(), lineIndex, ...(a ? { fragmentId: a.id } : {}) });
  });
  for (const a of anchors) if (mode !== "heading" || a.kind !== "heading") out.push({ kind: a.kind, label: a.label, lineIndex: a.lineIndex, fragmentId: a.id });
  const q = normalize(query);
  return out.filter(c => !q || normalize(c.label).includes(q) || normalize(c.fragmentId ?? "").includes(q));
}

function fragmentSlug(label: string): string {
  const slug = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|-+$/g, "").slice(0, 48);
  return slug || "fragment";
}

/** The heading line with an anchor added (`## Beds ^beds`), unique in the note, or the one it has. */
export function ensureHeadingFragment(text: string, lineIndex: number): { line: string; fragmentId: string; created: boolean } {
  const line = text.split(/\r?\n/)[lineIndex];
  if (line === undefined) throw new Error(`the heading on line ${lineIndex + 1} is gone`);
  const existing = line.match(FRAGMENT_ANCHOR), content = beforeAnchor(line, existing), heading = content.match(HEADING);
  if (!heading) throw new Error(`line ${lineIndex + 1} is no longer a heading`);
  if (existing) return { line, fragmentId: existing[1]!, created: false };
  const used = new Set(fragmentAnchors(text).map(a => a.id));
  const base = fragmentSlug(heading[2]!);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base.slice(0, Math.max(1, 63 - String(n).length))}-${n}`;
  return { line: `${content} ^${id}`, fragmentId: id, created: true };
}
