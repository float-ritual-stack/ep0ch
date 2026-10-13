// Highlights and margin notes (ADR 0004, contract 6): what every client reads off an annotation to draw it.
//
// An annotation is a block (`type::annotation`, a child of the note it's on, or of the system root for a Resource),
// and its properties are ordinary properties: open, queryable, written by whoever wrote it. Marginalia's kit writes
// three conventions, and every client and query reads them the same way here:
//
// - `kind`: highlight, note, question, define, explain, or anything else someone writes;
// - `tags`: any number of them;
// - `color`: a theme tone name (`warn`, `good`, `accent`…), never a raw colour, so each client draws it in its
//   own palette, capped dark in the door.
//
// A **highlight** is an annotation with no body. It's drawn as a span (`place: span`) on its words; an annotation
// with a body is drawn as a span too, and as a card in the margin (`place: margin`). Pure: no I/O.

import { propertyTokensInLine, withoutPropertyTokens } from "./property-grammar";
import { RULE_TONES, type RuleTone } from "./rules";

/** The store's own key for when a comment or reply was edited after it was posted (an ISO time; PIE-763's `annotations.update`). */
export const ANNOTATION_EDITED_KEY = "annotation-edited";

/** The keys the annotation store writes for its own bookkeeping: never shown as an annotation's properties. */
export const ANNOTATION_OWN_KEYS: ReadonlySet<string> = new Set(["type", "annotation-source", "annotation-status", "parent-annotation", "promoted-block", ANNOTATION_EDITED_KEY]);

/** The tone a kind is drawn in when the annotation names no `color`: conventions, not a closed list. */
const KIND_TONES: Readonly<Record<string, RuleTone>> = { highlight: "warn", question: "accent", define: "good", explain: "good", note: "default" };

/** An annotation's own properties (open: whatever was written), each key with its values, the store's keys left out. */
export function annotationProperties(properties: readonly { key: string; value: string }[]): Record<string, string[]> {
  // Open keys: `constructor` or `toString` is a property like any other, so no prototype to collide with.
  const out: Record<string, string[]> = Object.create(null);
  for (const p of properties) {
    if (ANNOTATION_OWN_KEYS.has(p.key)) continue;
    if (Object.hasOwn(out, p.key)) out[p.key]!.push(p.value); else out[p.key] = [p.value];
  }
  return { ...out };
}

/** The tone to draw an annotation in: its `color` when that names a theme tone, else its kind's, else `default`. */
export function annotationTone(props: Readonly<Record<string, readonly string[]>>): RuleTone {
  const color = Object.hasOwn(props, "color") ? props.color?.[0]?.trim().toLowerCase() : undefined;
  if (color && (RULE_TONES as readonly string[]).includes(color)) return color as RuleTone;
  const kind = Object.hasOwn(props, "kind") ? props.kind?.[0]?.trim().toLowerCase() ?? "" : "";
  return Object.hasOwn(KIND_TONES, kind) ? KIND_TONES[kind]! : "default";
}

/** What an annotation is, in a word: its `kind`, else `highlight` with no body, else `comment`. */
export function annotationKind(props: Readonly<Record<string, readonly string[]>>, body: string): string {
  const kind = Object.hasOwn(props, "kind") && Array.isArray(props.kind) ? props.kind[0]?.trim() : undefined;
  return kind || (body.trim() ? "comment" : "highlight");
}

/**
 * The properties an annotation is written with, checked: keys as properties take them, values on one line with no
 * brackets, `color` one of the theme's tones. Why not, else null.
 */
export function annotationPropertyProblem(props: Readonly<Record<string, string | readonly string[]>>): string | null {
  for (const [key, raw] of Object.entries(props)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) return `"${key}" isn't a property name (a letter, then letters, digits, _ . -)`;
    if (ANNOTATION_OWN_KEYS.has(key)) return `${key} is the annotation store's own; it can't be given`;
    const values = typeof raw === "string" ? [raw] : raw;
    if (!Array.isArray(values) || values.length > 16) return `${key} takes a value or a list of at most 16`;
    for (const v of values) {
      if (typeof v !== "string" || !v.trim() || v.length > 200 || /[\[\]\r\n]/.test(v)) return `${key}'s value ${JSON.stringify(v)} must be text on one line, up to 200 characters, with no [ or ]`;
    }
    if (key === "color" && !(RULE_TONES as readonly string[]).includes(values[0]!.trim().toLowerCase())) {
      return `color is a theme tone: one of ${RULE_TONES.join(", ")} (never a raw colour)`;
    }
  }
  return null;
}

/** A mark's generated heading line: `Comment on “…”`, `Highlight on “…”`, `Question on “…”`, or its kind alone. */
export const MARK_HEADING = /^(?:Comment on |[A-Z][a-z-]{0,23}(?: on “|$))/;

const MARK_TYPES: ReadonlySet<string> = new Set(["annotation", "annotation-reply"]);

/**
 * A mark's title (a highlight, comment, question or reply): its own words, never the generated heading, whose quote is
 * the anchored passage's raw Blockdown cut short (`Comment on “Then:** netmail…”`). The first line of its body with
 * its properties taken out; a mark with no body (a highlight) is its heading with the passage's emphasis marks
 * dropped. `line` is the line the title is on. Null when the text isn't a mark: a generated heading, then the
 * store's `[type::annotation]` or `[type::annotation-reply]` line.
 */
export function markTitleLine(text: string): { line: number; text: string } | null {
  const lines = text.split("\n");
  if (!MARK_HEADING.test(lines[0]!)) return null;
  const meta = lines[1] ?? "";
  if (!propertyTokensInLine(meta).some((token) => token.key.toLowerCase() === "type" && MARK_TYPES.has(token.value.trim()))) return null;
  for (let i = 2; i < lines.length; i++) {
    const words = withoutPropertyTokens(lines[i]!).replace(/\s+/g, " ").trim();
    if (words) return { line: i, text: words };
  }
  return { line: 0, text: lines[0]!.replace(/\*\*|__|`+/g, "").replace(/\s+/g, " ").trim() };
}

// ── Attention (PIE-791): how present a mark is, not whether it's closed ─────────────────────────────────────────────
//
// A mark's lifecycle (`annotation-status`) says how present it is on its page: `open` (it's there), `seen` (put away
// on the Earlier shelf; a new reply brings it back), `kept` (it stays whatever else is put away) and `resolved` (a
// ticket closed: reads as seen). A TL;DR is a reply with `[kind::tldr]`: the newest is the thread's face. Every client
// (the door, Detail, the web) asks these, so they put away and bring back the same marks.

export type MarkLifecycle = "open" | "seen" | "kept" | "resolved";
export const MARK_LIFECYCLES: readonly MarkLifecycle[] = ["open", "seen", "kept", "resolved"];
export const isMarkLifecycle = (value: unknown): value is MarkLifecycle => (MARK_LIFECYCLES as readonly unknown[]).includes(value);

/** Whether a mark is in its page's margin by default (current): open and kept are; seen and resolved are earlier. */
export function markCurrent(lifecycle: string | undefined): boolean {
  return lifecycle !== "seen" && lifecycle !== "resolved";
}

/** A reply that's a thread's TL;DR (`[kind::tldr]`): its summary, written by @margin or by the person. */
export const TLDR_KIND = "tldr";
export function isTldr(props: Readonly<Record<string, readonly string[]>> | undefined): boolean {
  return !!props && Object.hasOwn(props, "kind") && props.kind?.[0]?.trim().toLowerCase() === TLDR_KIND;
}
