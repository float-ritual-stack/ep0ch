// The one placeholder grammar (PIE-533 §4.2): `{{ path || default }}`. A path is `head(.key | [n])*` (resolve-path.ts
// parses it and answers it), optionally followed by `| <query atoms>` (a filter the service applies) and a default after
// `||`. A rule's label, an action line's slot, a component's `use` snippet and a note's text all read it here, and no
// other `{…}` form expands anything: `{pad=1}` after a component name is attributes (component-block.ts), `${…}` is a
// shell's, and a producer's own lookalike takes another sigil. Pure: no I/O.
//
//   interpolationSpans(text)         where the placeholders are, with their paths (the service, clients, the sweep)
//   interpolate(text, answers)       substitution; `answers` reads one span, the caller decides what a missing one means
//   interpolateWith(text, site)      the same through `resolvePath`
//
// Literal by default: a `{{` in a code span, a fence or a `<!-- literal -->` region stays as written; `\{{` is a
// literal `{{` anywhere. A producer that owns its fences as templates (an `actions` fence, a runbook step) says so with
// `fences: "template"`, which leaves only literal regions alone.
import { offsetInRanges, protectedCodeRanges, scanLiteralRegions, type SourceRange } from "./code-ranges";
import { parsePath, resolvePath, isReferenceHead, splitTail, type ParsedPath, type PathScope, type PathStep, type PathTail } from "./resolve-path";
import type { Site } from "./site";

export interface InterpolationPolicy {
  /** `literal` (default): code spans, fences and literal regions are text. `template`: only literal regions are. */
  fences?: "literal" | "template";
}

/** One `{{ … }}` in a text. */
export interface InterpolationSpan {
  /** Offsets of the whole `{{ … }}`. */
  start: number;
  end: number;
  /** The text inside the braces, as written. */
  expression: string;
  /** The path, without its filter or default. */
  path: string;
  /** `| status=todo`: the filter's query atoms, for the service to apply. */
  filter?: string;
  /** Steps after the filter (`| status=todo .count`). */
  then?: PathStep[];
  /** `|| none`: what to write when nothing answers. */
  default?: string;
  /** The path read (null when it isn't a path: the span is a problem to show, not to guess at). */
  parsed: ParsedPath | null;
  /** The note it names when the head is a reference (`((id))`, `[[page]]`, a Work ID). */
  reference?: string;
}

/** Offsets where a placeholder may not start. */
function literalRanges(text: string, policy: InterpolationPolicy): SourceRange[] {
  const regions = scanLiteralRegions(text).regions.map(r => ({ start: r.start, end: r.end }));
  return policy.fences === "template" ? regions : [...protectedCodeRanges(text, false), ...regions];
}

const OPEN = /\{\{([^\n]+?)\}\}/g;

function parseExpression(expression: string): Pick<InterpolationSpan, "path" | "filter" | "then" | "default"> {
  const dflt = expression.indexOf("||");
  const head = (dflt < 0 ? expression : expression.slice(0, dflt)).trim();
  const bar = head.indexOf("|");
  const tail = bar >= 0 ? splitTail(head.slice(bar + 1)) : {};
  return {
    path: (bar < 0 ? head : head.slice(0, bar)).trim(),
    ...(bar >= 0 ? { filter: tail.filter ?? "" } : {}),
    ...(tail.then ? { then: tail.then } : {}),
    ...(dflt >= 0 ? { default: expression.slice(dflt + 2).trim() } : {}),
  };
}

/** Every placeholder in `text`, in order, but those in literal text or escaped (`\{{`). */
export function interpolationSpans(text: string, policy: InterpolationPolicy = {}): InterpolationSpan[] {
  if (!text.includes("{{")) return [];
  const literal = literalRanges(text, policy);
  const spans: InterpolationSpan[] = [];
  for (const m of text.matchAll(OPEN)) {
    const start = m.index!;
    // `\{{` is escaped; `${{` is someone else's (a GitHub Actions expression, a shell's), never ours.
    if (text[start - 1] === "\\" || text[start - 1] === "$" || offsetInRanges(start, literal)) continue;
    const expression = m[1]!;
    if (!expression.trim()) continue;
    const parts = parseExpression(expression);
    const parsed = parts.path ? parsePath(parts.path) : null;
    spans.push({ start, end: start + m[0].length, expression, ...parts, parsed, ...(parsed && isReferenceHead(parsed.head) ? { reference: parsed.head } : {}) });
  }
  return spans;
}

/** What answers a span: its values (a list joins with `, `), or `undefined` when nothing does. May throw to refuse. */
export type SpanAnswer = (span: InterpolationSpan) => readonly string[] | undefined;

/**
 * `text` with each placeholder replaced by its answer's values joined with `, `. Nothing answering writes the span's
 * `|| default`, else (`missing`) leaves the placeholder as written (`keep`, the default) or writes nothing (`empty`);
 * a caller that must refuse makes `answers` throw. `\{{` becomes a literal `{{`.
 */
export function interpolate(text: string, answers: SpanAnswer, policy: InterpolationPolicy & { missing?: "keep" | "empty" } = {}): string {
  if (!text.includes("{{")) return text;
  let out = "", at = 0;
  for (const span of interpolationSpans(text, policy)) {
    const values = answers(span);
    const written = values && values.length ? values.join(", ") : span.default ?? (values ? "" : policy.missing === "empty" ? "" : text.slice(span.start, span.end));
    out += text.slice(at, span.start).replaceAll("\\{{", "{{") + written;
    at = span.end;
  }
  return out + text.slice(at).replaceAll("\\{{", "{{");
}

/** `interpolate` over a Site: each path through `resolvePath`; a path it can't answer is missing. */
export function interpolateWith(text: string, site: Site, scope: PathScope = {}, policy: InterpolationPolicy & { missing?: "keep" | "empty" } = {}): string {
  return interpolate(text, span => {
    if (!span.parsed) return undefined;
    const answer = resolvePath(span.parsed, site, scope, spanTail(span));
    return answer.ok ? answer.values : undefined;
  }, policy);
}

/** What a span adds to its path: the filter, and the steps after it. */
export const spanTail = (span: InterpolationSpan): PathTail | undefined =>
  span.filter || span.then ? { ...(span.filter ? { filter: span.filter } : {}), ...(span.then ? { then: span.then } : {}) } : undefined;

/** `text` with every `{{` escaped, so what a producer writes into prose never starts resolving there. */
export const escapeInterpolation = (text: string): string => text.replaceAll("{{", "\\{{");
