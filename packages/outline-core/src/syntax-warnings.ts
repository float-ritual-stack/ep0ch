// What a half-written note says about itself (PIE-669): each construct left open, on the line it's on, and how far
// its damage reaches. The grammar already keeps the damage there (an unclosed fence ends at its paragraph, an
// unclosed `[[` or `[key::` is text on its own line, an unclosed component or `<!-- literal -->` is plain text), so a
// warning never says "the rest of the note is lost": it says which construct is open and how to close it. Unclosed
// `((` is reference-warnings.ts's (a save's did-you-mean). Pure: no I/O.

import { codeBlocks } from "./code-fence";
import { COMPONENT_OPEN, componentBlocks } from "./component-block";
import { pageAddressReferences } from "./link-syntax";
import { offsetInRanges, protectedCodeRanges, scanLiteralRegions, scanPropertyLiteralRanges } from "./code-ranges";
import { isEscapedAt, propertyTokenMatches } from "./property-grammar";

export type SyntaxWarningKind = "fence" | "page-link" | "property" | "component" | "literal";

/** One construct left open: its kind, its line (0 is the title line), and a sentence saying what is read and how to close it. */
export interface SyntaxWarning {
  kind: SyntaxWarningKind;
  line: number;
  message: string;
}

const MAX_WRITTEN = 40;
const shown = (written: string) => (written.length > MAX_WRITTEN ? `${written.slice(0, MAX_WRITTEN - 1)}…` : written);

/** Every construct `text` leaves open, in line order. */
export function syntaxWarnings(text: string): SyntaxWarning[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) starts.push(at);
  const lineOf = (offset: number) => { let i = 0; while (i + 1 < starts.length && starts[i + 1]! <= offset) i++; return i; };
  const out: SyntaxWarning[] = [];

  // Fences outside components (a fence in a component is its question).
  const masked = [...lines];
  for (const c of componentBlocks(lines)) for (let j = c.start; j <= c.end; j++) masked[j] = "";
  for (const fence of codeBlocks(masked).fences) {
    if (fence.closed) continue;
    const mark = fence.fence.char.repeat(fence.fence.length);
    const reach = fence.end === fence.start ? "it holds no code yet"
      : `lines ${fence.start + 1}–${fence.end + 1} are code${fence.end < lines.length - 1 ? ", up to the blank line after them" : ""}`;
    out.push({ kind: "fence", line: fence.start, message: `the ${mark} on line ${fence.start + 1} isn't closed: ${reach}; close it with ${mark} on a line of its own` });
  }

  const code = protectedCodeRanges(text);
  const literal = scanPropertyLiteralRanges(text);

  // `[[` its line never closes: text.
  const links = pageAddressReferences(text, []);
  for (let at = text.indexOf("[["); at >= 0; at = text.indexOf("[[", at + 2)) {
    const link = links.find(l => at >= l.start && at < l.end);
    if (link) { at = link.end - 2; continue; }
    if (offsetInRanges(at, code)) continue;
    const lineEnd = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    // `[[[` reads its link from the last two brackets.
    if (text[at + 2] === "[") continue;
    const close = text.indexOf("]]", at);
    if (close >= 0 && close < lineEnd && !text.slice(at + 2, close).includes("[[")) continue; // a link no page can have: not unclosed
    const line = lineOf(at), next = text.indexOf("[[", at + 2);
    out.push({ kind: "page-link", line, message: `the ${shown(text.slice(at, next >= 0 && next < lineEnd ? next : lineEnd).trimEnd())} on line ${line + 1} isn't closed with ]]: it's text` });
  }

  // `[key::` with no `]` of its own on its line: text.
  const tokens = new Set(propertyTokenMatches(text).map(t => t.start));
  for (const head of text.matchAll(/\[([A-Za-z][A-Za-z0-9_.-]*)::/g)) {
    const at = head.index;
    if (tokens.has(at) || isEscapedAt(text, at) || offsetInRanges(at, literal) || offsetInRanges(at, code)) continue;
    const lineEnd = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    // `[key::]` (an empty value) is text by design, not a half-written token.
    if (text.slice(at + head[0].length).startsWith("]")) continue;
    const line = lineOf(at), next = text.slice(at + 1, lineEnd).search(/\[[A-Za-z][A-Za-z0-9_.-]*::/);
    out.push({ kind: "property", line, message: `the ${shown(text.slice(at, next >= 0 ? at + 1 + next : lineEnd).trimEnd())} on line ${line + 1} isn't closed with ]: it's text, not a property` });
  }

  // A `::name` opener nothing closes: plain text. One inside a component or a fence is that block's.
  const covered = new Set<number>();
  for (const c of componentBlocks(lines)) for (let j = c.start; j <= c.end; j++) covered.add(j);
  for (const f of codeBlocks(lines).fences) for (let j = f.start; j <= f.end; j++) covered.add(j);
  lines.forEach((raw, i) => {
    const open = COMPONENT_OPEN.exec(raw.replace(/\r$/, ""));
    if (!open || covered.has(i)) return;
    out.push({ kind: "component", line: i, message: `the ::${open[1]} on line ${i + 1} isn't closed with :: on a line of its own: it's plain text` });
  });

  const unterminated = scanLiteralRegions(text).unterminated;
  if (unterminated) {
    const line = lineOf(unterminated.start);
    out.push({ kind: "literal", line, message: `the <!-- literal --> on line ${line + 1} has no closing <!-- /literal --> line, so properties after it are still read` });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** One line for a save's status or an agent's reply: "saved; 2 things are left open: …"; "" when nothing is. */
export function describeSyntaxWarnings(warnings: readonly SyntaxWarning[], max = 3): string {
  if (!warnings.length) return "";
  const listed = warnings.slice(0, max).map(w => w.message).join(" · ");
  return `${warnings.length === 1 ? "one thing is" : `${warnings.length} things are`} left open: ${listed}${warnings.length > max ? ` · and ${warnings.length - max} more` : ""}`;
}
