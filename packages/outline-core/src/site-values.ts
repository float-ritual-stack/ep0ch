// How a `{{ }}` of a note reads in a drawing (PIE-533 S2). The service answers (`site.answer`); every reader draws that
// answer with these words and finds the placeholders in the text it draws with the same scan, so the door, Detail, the
// publisher and an agent's read agree on what a value says and what an unresolved one says. Pure: no I/O.
import { interpolationSpans, type InterpolationPolicy } from "./interpolation";
import type { SiteValue } from "./site";

/** The most `{{ }}` a read of one note asks about (a note holding more draws the rest as written). */
export const MAX_NOTE_VALUES = 200;

/** A placeholder of a text, with the answer the service gave for it (absent when the answer has none yet). */
export interface PairedValue { start: number; end: number; expression: string; value?: SiteValue }

/**
 * The placeholders of `text`, located (never resolved: that is the service's), each paired with its answer. `values` are
 * the service's, in the order of the note's own placeholders; `text` may be a cut or a cleaned copy of the note's, so a
 * placeholder is paired by position when the expression agrees, else by expression: the same expression in one Site
 * reads the same.
 */
export function pairValues(text: string, values: readonly SiteValue[], policy?: InterpolationPolicy): PairedValue[] {
  const spans = interpolationSpans(text, policy);
  const byExpression = new Map<string, SiteValue>();
  for (const v of values) if (!byExpression.has(v.expression)) byExpression.set(v.expression, v);
  return spans.map((span, i) => {
    const at = values[i];
    const value = at && at.expression === span.expression ? at : byExpression.get(span.expression);
    return { start: span.start, end: span.end, expression: span.expression, ...(value ? { value } : {}) };
  });
}

/** One line: a value's words are on one row of a drawing, whatever they were written across. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

/** What a value draws as: its values joined, each link-valued one by its note's title. Empty for a list with none. */
export function valueWords(v: SiteValue): string {
  const titles = new Map((v.links ?? []).map(l => [l.text, l.title]));
  return oneLine((v.values ?? []).map(x => titles.get(x) ?? x).join(", "));
}

/** An unresolved placeholder's words: why, and the nearest key, as the service said them. */
export function problemWords(v: SiteValue): string {
  const p = v.problem;
  if (!p) return "";
  // The service's message usually says the nearest keys already; add them when it doesn't.
  const near = p.didYouMean.slice(0, 3).map(k => `\`${k}\``);
  return oneLine(/did you mean/i.test(p.message) || !near.length ? p.message : `${p.message}; did you mean ${near.join(" or ")}?`);
}

/**
 * The plain words a reader draws for a placeholder written as `raw`: its values, or for one with no answer what was typed
 * and the nearest key. What a drawn selection is compared with to find the `{{ }}` it was made on.
 */
export function readerWords(raw: string, v: SiteValue): string {
  if (hasWords(v)) return valueWords(v) || EMPTY_VALUE;
  const near = nearestKey(v);
  return `${raw} · ${near ? `did you mean ${near}?` : v.problem?.message ?? "no value"}`;
}

/** A value that is a list with nothing in it. */
export const EMPTY_VALUE = "∅";

/** The key a did-you-mean offers first, for a status line that says "did you mean owner?". */
export const nearestKey = (v: SiteValue): string | undefined => v.problem?.didYouMean[0];

/** A placeholder with a value to draw: it resolved, or a `|| default` filled in (the problem is then the note's to read). */
export const hasWords = (v: SiteValue | undefined): boolean => !!v && v.values !== undefined && !v.hidden;

/**
 * The note's text with each placeholder it can read replaced by its words, for a surface that draws text (Detail's
 * preview, the publisher). `onProblem` says what an unresolved or hidden one becomes (default: as written). Replacing
 * never adds a line: a value's words are one row.
 */
export function substituteValues(
  text: string, values: readonly SiteValue[],
  how: { words?: (words: string, value: SiteValue) => string; problem?: (expression: string, value: SiteValue) => string; hidden?: (expression: string) => string; policy?: InterpolationPolicy } = {},
): string {
  const pairs = pairValues(text, values, how.policy);
  let out = "", at = 0;
  for (const pair of pairs) {
    const v = pair.value;
    if (!v) continue;
    const raw = text.slice(pair.start, pair.end);
    const words = v.hidden ? (how.hidden ? how.hidden(pair.expression) : "") : hasWords(v) ? (how.words ? how.words(valueWords(v) || EMPTY_VALUE, v) : valueWords(v)) : how.problem ? how.problem(pair.expression, v) : raw;
    out += text.slice(at, pair.start) + words;
    at = pair.end;
  }
  return out + text.slice(at);
}
