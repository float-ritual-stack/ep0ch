// A form's fields written in the note it's used on (PIE-828): `[form-field::mood choice good|meh|rough]`, one chip per
// field. An extension action that declares `fieldsFrom: "block"` asks for the fields of the block it runs on, beside
// any it declares itself, and the service checks the answers as it checks declared arguments. A chip is a property
// like any other (it saves, lists and facets as one); this is what its value means. A chip that can't be read is a
// warning on the note (syntax-warnings.ts) with a did-you-mean, never a refusal of the save; the action it would feed
// refuses, saying the same. Pure: no I/O.

import { codeHides, scanPropertyLiteralRanges } from "./code-ranges";
import { isEscapedAt, propertyTokenMatches } from "./property-grammar";

/** The property key a form field is written under. */
export const FORM_FIELD_KEY = "form-field";
/** What a field asks for: the types an action's declared arguments have (PIE-784). */
export const FORM_FIELD_TYPES = ["text", "number", "choice", "property"] as const;
export type FormFieldType = typeof FORM_FIELD_TYPES[number];
/** A field's name: what the action's `args` holds it under (the declared arguments' rule). */
export const FORM_FIELD_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
/** Names an action's request already uses: neither a declared argument nor a note's field may be one. */
export const RESERVED_ARG_NAMES: ReadonlySet<string> = new Set(["block", "line", "with", "quote", "near", "tile", "action", "color"]);
/** At most this many fields are read from one note. */
export const MAX_FORM_FIELDS = 16;

/** A field as an action's declared argument says it (the same shape, so the service checks both one way). */
export interface FormField {
  name: string;
  type: FormFieldType;
  options?: string[];
  required?: boolean;
  default?: string;
}

/** One chip that couldn't be read: what was written and why, with the nearest word it may have meant. */
export interface FormFieldProblem { written: string; message: string }

const FLAGS = ["required", "default="] as const;

/** The nearest of `words` to `typed` (at most two edits away), or undefined. */
function nearest(typed: string, words: readonly string[]): string | undefined {
  let best: string | undefined, score = 3;
  for (const word of words) {
    const d = distance(typed.toLowerCase(), word);
    if (d < score) { best = word; score = d; }
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * A `form-field` value read: `<name> <type> [<options>] [required] [default=<value>]`, words split by spaces.
 * `<options>` are a choice's values (or a property's fixed choices), split by `|` (`good|meh|rough`): one word each,
 * so a value with a space is written with `-` or `_`. Anything else is a problem, said with what it may have meant.
 */
export function parseFormField(value: string): FormField | FormFieldProblem {
  const written = value.trim();
  const words = written.split(/\s+/).filter(Boolean);
  const bad = (message: string): FormFieldProblem => ({ written, message: `[${FORM_FIELD_KEY}::${written}]: ${message}` });
  const [name, type, ...rest] = words;
  if (!name) return bad(`it names no field: write [${FORM_FIELD_KEY}::<name> <type>], a type one of ${FORM_FIELD_TYPES.join(", ")}`);
  if (!FORM_FIELD_NAME.test(name)) return bad(`${name} isn't a field name (lowercase letters, digits, - and _, starting with a letter)`);
  // `constructor` and the like: every answers object a client builds already has one, so it could never be asked.
  if (name in Object.prototype) return bad(`${name} is a name every object already has; call the field something else`);
  if (RESERVED_ARG_NAMES.has(name)) return bad(`${name} is a name the action's request already uses (${[...RESERVED_ARG_NAMES].join(", ")}); call the field something else`);
  if (!type) return bad(`it says no type: add one of ${FORM_FIELD_TYPES.join(", ")} after ${name}`);
  if (!(FORM_FIELD_TYPES as readonly string[]).includes(type)) {
    const near = nearest(type, FORM_FIELD_TYPES);
    return bad(`${type} isn't a field type (${FORM_FIELD_TYPES.join(", ")})${near ? `; did you mean ${near}?` : ""}`);
  }
  const field: FormField = { name, type: type as FormFieldType };
  for (const word of rest) {
    if (word === "required") field.required = true;
    else if (word.startsWith("default=")) field.default = word.slice("default=".length);
    else if ((field.type === "choice" || field.type === "property") && !field.options && !word.includes("=")) field.options = word.split("|").filter(Boolean);
    else {
      const near = nearest(word.replace(/=.*/, "="), FLAGS);
      return bad(`${word} isn't read here (after the type: ${field.type === "choice" || field.type === "property" ? "its options a|b|c, " : ""}required, default=<value>)${near ? `; did you mean ${near === "default=" ? "default=<value>" : near}?` : ""}`);
    }
  }
  if (field.type === "choice" && !field.options?.length) return bad(`a choice needs its options after the type, split by | (${name} choice yes|no)`);
  if (field.default !== undefined && field.type === "choice" && !field.options!.includes(field.default)) return bad(`default=${field.default} isn't one of its options (${field.options!.join(", ")})`);
  if (field.default !== undefined && field.type === "number" && !Number.isFinite(Number(field.default))) return bad(`default=${field.default} isn't a number`);
  return field;
}

export const isFormFieldProblem = (x: FormField | FormFieldProblem): x is FormFieldProblem => "message" in x;

/**
 * The fields a note's values declare (each `form-field` property's value, in the note's order), and the chips that
 * couldn't be read, each with its index in `values`. A name written twice is a problem the second time; past
 * MAX_FORM_FIELDS the rest are one.
 */
export function formFields(values: readonly string[]): { fields: FormField[]; problems: (FormFieldProblem & { index: number })[] } {
  const fields: FormField[] = [], problems: (FormFieldProblem & { index: number })[] = [];
  values.forEach((value, index) => {
    const read = parseFormField(value), written = value.trim();
    if (isFormFieldProblem(read)) problems.push({ ...read, index });
    else if (fields.some(f => f.name === read.name)) problems.push({ written, index, message: `[${FORM_FIELD_KEY}::${written}]: the note already has a field ${read.name}; rename one or remove it` });
    else if (fields.length >= MAX_FORM_FIELDS) problems.push({ written, index, message: `[${FORM_FIELD_KEY}::${written}]: a note's form holds at most ${MAX_FORM_FIELDS} fields; remove one` });
    else fields.push(read);
  });
  return { fields, problems };
}

/**
 * The `[form-field::…]` chips of `text` that can't be read, each at its offset: what a save says about the note
 * (syntax-warnings.ts), as the action that reads the form would (`formFields`: a name twice, too many). Chips in code
 * and literal regions aren't properties, so they aren't read.
 */
export function formFieldChipProblems(text: string): { start: number; problem: FormFieldProblem }[] {
  const literal = scanPropertyLiteralRanges(text);
  const chips = propertyTokenMatches(text).filter(token => token.key.toLowerCase() === FORM_FIELD_KEY && !isEscapedAt(text, token.start) && !codeHides(token, literal));
  return formFields(chips.map(chip => chip.value)).problems.map(({ index, ...problem }) => ({ start: chips[index]!.start, problem }));
}
