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

import { RULE_TONES, type RuleTone } from "./rules";

/** The keys the annotation store writes for its own bookkeeping: never shown as an annotation's properties. */
export const ANNOTATION_OWN_KEYS: ReadonlySet<string> = new Set(["type", "annotation-source", "annotation-status", "parent-annotation", "promoted-block"]);

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
