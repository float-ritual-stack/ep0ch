// A form's fields written in the note it's used on (PIE-828): `[form-field::mood choice good|meh|rough]`, one chip per
// field. An extension action that declares `fieldsFrom: "block"` asks for the fields of the block it runs on, beside
// any it declares itself, and the service checks the answers as it checks declared arguments. A chip is a property
// like any other (it saves, lists and facets as one); this is what its value means. A chip that can't be read is a
// warning on the note (syntax-warnings.ts) with a did-you-mean, never a refusal of the save; the action it would feed
// refuses, saying the same. Pure: no I/O.

import { codeHides, scanPropertyLiteralRanges } from "./code-ranges";
import { isEscapedAt, propertyTokenMatches } from "./property-grammar";
import { parsePropertyRecords } from "./property-parse";
import { RESERVED_PROPS } from "./site";
import { closest } from "./tool-args";

/** The property key a form field is written under. */
export const FORM_FIELD_KEY = "form-field";
/**
 * What a field asks for: the types an action's declared arguments have (PIE-784), and the two a template's props add
 * (PIE-533 S4): `note` (a note, picked by its words) and `tag` (a #tag). A template's props are these fields (props-spec.ts).
 */
export const FORM_FIELD_TYPES = ["text", "number", "choice", "property", "note", "tag"] as const;
export type FormFieldType = typeof FORM_FIELD_TYPES[number];
/** A field's name: what the action's `args` holds it under (the declared arguments' rule). */
export const FORM_FIELD_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
/** Names an action's request already uses: neither a declared argument nor a note's field may be one. */
export const RESERVED_ARG_NAMES: ReadonlySet<string> = new Set(["block", "line", "with", "quote", "near", "tile", "action", "color"]);
/**
 * How much a field (or a declared argument, extension-manifest.ts ActionArg) may hold: its choices, each choice's
 * length, and its default's length. One set of bounds, so a note's field is checked as a declared argument is.
 */
export const FORM_FIELD_LIMITS = { options: 32, option: 60, default: 200 } as const;
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

/**
 * A `form-field` value read: `<name> <type> [<options>] [required] [default=<value>]`, words split by spaces.
 * `<options>` are a choice's values (or a property's fixed choices), split by `|` (`good|meh|rough`): one word each,
 * so a value with a space is written with `-` or `_`. Anything else is a problem, said with what it may have meant.
 */
export function parseFormField(value: string, reserved: ReadonlySet<string> = RESERVED_ARG_NAMES): FormField | FormFieldProblem {
  const written = value.trim();
  const words = written.split(/\s+/).filter(Boolean);
  const bad = (message: string): FormFieldProblem => ({ written, message: `[${FORM_FIELD_KEY}::${written}]: ${message}` });
  const [name, type, ...rest] = words;
  if (!name) return bad(`it names no field: write [${FORM_FIELD_KEY}::<name> <type>], a type one of ${FORM_FIELD_TYPES.join(", ")}`);
  if (!FORM_FIELD_NAME.test(name)) return bad(`${name} isn't a field name (lowercase letters, digits, - and _, starting with a letter)`);
  // `constructor` and the like: every answers object a client builds already has one, so it could never be asked.
  if (name in Object.prototype) return bad(`${name} is a name every object already has; call the field something else`);
  if (reserved.has(name)) return bad(`${name} is a name ${reserved === RESERVED_ARG_NAMES ? "the action's request already uses" : "the call already uses"} (${[...reserved].join(", ")}); call the field something else`);
  if (!type) return bad(`it says no type: add one of ${FORM_FIELD_TYPES.join(", ")} after ${name}`);
  if (!(FORM_FIELD_TYPES as readonly string[]).includes(type)) {
    const near = closest(type, FORM_FIELD_TYPES);
    return bad(`${type} isn't a field type (${FORM_FIELD_TYPES.join(", ")})${near ? `; did you mean ${near}?` : ""}`);
  }
  const field: FormField = { name, type: type as FormFieldType };
  for (const word of rest) {
    if (word === "required") field.required = true;
    else if (word.startsWith("default=")) field.default = word.slice("default=".length);
    else if ((field.type === "choice" || field.type === "property") && !field.options && !word.includes("=")) field.options = word.split("|").filter(Boolean);
    else {
      const near = closest(word.replace(/=.*/, "="), FLAGS);
      return bad(`${word} isn't read here (after the type: ${field.type === "choice" || field.type === "property" ? "its options a|b|c, " : ""}required, default=<value>)${near ? `; did you mean ${near === "default=" ? "default=<value>" : near}?` : ""}`);
    }
  }
  if (field.options && field.options.length > FORM_FIELD_LIMITS.options) return bad(`it has ${field.options.length} options; a field holds at most ${FORM_FIELD_LIMITS.options}`);
  const long = field.options?.find(option => option.length > FORM_FIELD_LIMITS.option);
  if (long) return bad(`the option ${long.slice(0, 20)}… is longer than ${FORM_FIELD_LIMITS.option} characters`);
  if (field.default !== undefined && field.default.length > FORM_FIELD_LIMITS.default) return bad(`its default is longer than ${FORM_FIELD_LIMITS.default} characters`);
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
export function formFields(values: readonly string[], reserved: ReadonlySet<string> = RESERVED_ARG_NAMES): { fields: FormField[]; problems: (FormFieldProblem & { index: number })[] } {
  const fields: FormField[] = [], problems: (FormFieldProblem & { index: number })[] = [];
  values.forEach((value, index) => {
    const read = parseFormField(value, reserved), written = value.trim();
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
  // A template's fields are its props, named on the `::use` line: the names reserved there are the call-site words (`with` is fine).
  const template = parsePropertyRecords(text).some(r => r.syntax !== "hashtag" && ((r.key === "type" && r.value.trim().toLowerCase() === "template") || r.key === "template-for"));
  return formFields(chips.map(chip => chip.value), template ? new Set<string>(RESERVED_PROPS) : RESERVED_ARG_NAMES).problems.map(({ index, ...problem }) => ({ start: chips[index]!.start, problem }));
}
