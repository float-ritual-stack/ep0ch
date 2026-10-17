// What a half-written note says about itself (PIE-669): each construct left open, on the line it's on, and how far
// its damage reaches. The grammar already keeps the damage there (an unclosed fence ends at its paragraph, an
// unclosed `[[` or `[key::` is text on its own line, an unclosed component or `<!-- literal -->` is plain text), so a
// warning never says "the rest of the note is lost": it says which construct is open and how to close it. Unclosed
// `((` is reference-warnings.ts's (a save's did-you-mean). Pure: no I/O.

import { codeBlocks } from "./code-fence";
import { COMPONENT_OPEN, componentBlocks } from "./component-block";
import { LINK_BLOCK_KINDS } from "./link-blocks";
import { pageLinkSpans } from "./link-syntax";
import { offsetInRanges, protectedCodeRanges, scanLiteralRegions, scanPropertyLiteralRanges } from "./code-ranges";
import { isEscapedAt, PROPERTY_KEY_SOURCE, propertyTokenMatches } from "./property-grammar";
import { formFieldChipProblems } from "./form-fields";
import { USE_NAME, useCallsOf } from "./template-use";
import { graphKind, propsWithoutRules } from "./figure-props";

export type SyntaxWarningKind = "fence" | "page-link" | "property" | "component" | "literal" | "form-field" | "figure";

/** One construct left open: its kind, its line (0 is the title line), and a sentence saying what is read and how to close it. */
export interface SyntaxWarning {
  kind: SyntaxWarningKind;
  line: number;
  message: string;
  /** The last line of the construct, when it spans lines (a figure's closing `::`); a generated note about it can follow there. */
  end?: number;
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

  // `[[` its line never closes (pageLinkSpans: the bracket count, so a nested link is no unclosed one): text.
  const opened = new Set(pageLinkSpans(text, code).map(span => span.start));
  for (let at = text.indexOf("[["); at >= 0; at = text.indexOf("[[", at + 1)) {
    if (opened.has(at) || offsetInRanges(at, code)) continue;
    // `[[[` opens its link at the last two brackets; `[[ ` and a blank is prose about the syntax, not a link begun.
    if (text[at + 2] === "[" || text[at + 2] === " " || opened.has(at + 1)) continue;
    const lineEnd = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    const line = lineOf(at), next = text.indexOf("[[", at + 2);
    out.push({ kind: "page-link", line, message: `the ${shown(text.slice(at, next >= 0 && next < lineEnd ? next : lineEnd).trimEnd())} on line ${line + 1} isn't closed with ]]: it's text` });
  }

  // `[key::` with no `]` of its own on its line: text.
  const tokens = new Set(propertyTokenMatches(text).map(t => t.start));
  for (const head of text.matchAll(new RegExp(String.raw`\[(${PROPERTY_KEY_SOURCE})::`, "g"))) {
    const at = head.index;
    if (tokens.has(at) || isEscapedAt(text, at) || offsetInRanges(at, literal) || offsetInRanges(at, code)) continue;
    const lineEnd = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    // `[key::]` (an empty value) is text by design, not a half-written token.
    if (text.slice(at + head[0].length).startsWith("]")) continue;
    const line = lineOf(at), next = text.slice(at + 1, lineEnd).search(new RegExp(String.raw`\[${PROPERTY_KEY_SOURCE}::`));
    out.push({ kind: "property", line, message: `the ${shown(text.slice(at, next >= 0 ? at + 1 + next : lineEnd).trimEnd())} on line ${line + 1} isn't closed with ]: it's text, not a property` });
  }

  // A `::name` opener nothing closes: plain text. One inside a component or a fence is that block's.
  const covered = new Set<number>();
  for (const c of componentBlocks(lines)) for (let j = c.start; j <= c.end; j++) covered.add(j);
  for (const f of codeBlocks(lines).fences) for (let j = f.start; j <= f.end; j++) covered.add(j);
  lines.forEach((raw, i) => {
    const open = COMPONENT_OPEN.exec(raw.replace(/\r$/, ""));
    // `::links` and its kind alone on a line is that component, unclosed by design (link-blocks.ts); so is `::fields` (site-blocks.ts)
    // and a `::use{…}` call, which is one line (template-use.ts).
    if (!open || covered.has(i) || (LINK_BLOCK_KINDS as readonly string[]).includes(open[1]!) || open[1] === "fields" || open[1] === USE_NAME) return;
    out.push({ kind: "component", line: i, message: `the ::${open[1]} on line ${i + 1} isn't closed with :: on a line of its own: it's plain text` });
  });

  // A `::use` that names no template (PIE-533 S4): drawn as nothing, so it says so. (The template's props are the service's to check.)
  for (const call of useCallsOf(text)) if (call.problem) out.push({ kind: "component", line: call.line, message: `the ::use on line ${call.line + 1} names no template: ${call.problem.replace(/^::use needs /, "write ")}` });

  // A form's field chip that can't be read (PIE-828): saved as written, its action says the same when it runs.
  for (const { start, problem } of formFieldChipProblems(text)) {
    const line = lineOf(start);
    out.push({ kind: "form-field", line, message: `${problem.message} (line ${line + 1})` });
  }

  // A figure whose props are written without their `---` lines (PIE-941): drawn as Markdown rows, so it says so.
  for (const c of componentBlocks(lines)) {
    const kind = c.end > c.start ? graphKind(c) : null;
    const problem = kind ? propsWithoutRules(kind, lines.slice(c.start + 1, c.end)) : null;
    if (problem) out.push({ kind: "figure", line: c.start, end: c.end, message: `${problem} (line ${c.start + 1})` });
  }

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
