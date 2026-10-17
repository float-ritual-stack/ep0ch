// A producer's props (PIE-533 S4, §4.6): one declaration, `PropsSpec` (site.ts), compiled from what a template note
// writes as `[form-field::status choice active|paused default=active]` chips (form-fields.ts reads the chip), and one
// check of a call against it: every client that draws or runs a call (the live `::use`, a stamp, an extension's run
// arguments) says the same words when a prop is unknown, missing or not one of its choices. A prop's `default` is text and
// may itself be a `{{ }}` path (the service fills it in the caller's Site). Pure: no I/O.
import { formFields, FORM_FIELD_KEY, type FormField } from "./form-fields";
import { RESERVED_PROPS, type PropsSpec, type SiteProblem } from "./site";
import { closest } from "./tool-args";

const RESERVED: ReadonlySet<string> = new Set(RESERVED_PROPS);

/** The kind of prop a field declares (a `property` field is a property's name: free text with its fixed options). */
const KIND: Record<FormField["type"], PropsSpec[string]["kind"]> = { text: "text", number: "number", choice: "choice", property: "text", note: "note", tag: "tag" };

/**
 * The props a template's values declare (its `form-field` property values, in order), and what is wrong with the
 * declaration: a chip that can't be read, or a field named like a reserved attribute (`of`, `as`, `for`…), which the
 * call-site words already mean.
 */
export function propsSpecOf(values: readonly string[]): { spec: PropsSpec; problems: string[] } {
  // A prop is called by its name on the line, so the call-site words are the names it can't take (not an action request's: `with` is a fine prop).
  const { fields, problems } = formFields(values, RESERVED);
  const spec: PropsSpec = {};
  const said = problems.map(problem => problem.message);
  for (const field of fields) {
    spec[field.name] = {
      kind: KIND[field.type],
      ...(field.options?.length ? { choices: field.options } : {}),
      ...(field.default !== undefined ? { default: field.default } : {}),
      ...(field.required ? { required: true } : {}),
    };
  }
  return { spec, problems: said };
}

/** A prop the call leaves out that the template needs. */
export interface MissingProp { name: string; kind: PropsSpec[string]["kind"]; choices?: string[]; example: string }

/** One call checked against a template's spec. */
export interface PropsCheck {
  /** The values the template reads as `props.*`: those given, then the defaults of those left out. */
  values: Record<string, string[]>;
  /** Props taken from their default (a default holding `{{ }}` is for the caller's Site to fill). */
  defaulted: string[];
  /** Everything wrong, in the words of an unresolved `{{ }}`: why, the nearest names, a call that works. */
  problems: (SiteProblem & { prop: string; kind: "unknown" | "missing" | "invalid" })[];
  /** The required props not given, with what asks for each (a picker of the prop's kind). */
  missing: MissingProp[];
}

const exampleOf = (name: string, spec: PropsSpec[string]): string =>
  `${name}=${spec.choices?.[0] ?? (spec.kind === "number" ? "1" : spec.kind === "note" ? "[[a note]]" : spec.kind === "tag" ? "#tag" : "text")}`;

/**
 * `given` (the call's props, already read) against `spec`. `template`: the template's name, for the messages; `of`: how
 * the call names it, for the example. A prop the
 * spec doesn't declare is unknown (with the nearest declared one); a required one with no value and no default is
 * missing; a choice's value must be one of its options, a number a number.
 */
export function checkProps(spec: PropsSpec, given: readonly { key: string; value: string }[], template: string, of = `[[${template}]]`): PropsCheck {
  const names = Object.keys(spec);
  const values: Record<string, string[]> = {};
  const problems: PropsCheck["problems"] = [];
  const call = (extra: string) => `::use{of=${of}${extra ? ` ${extra}` : ""}}`;
  for (const { key, value } of given) {
    const declared = names.find(name => name.toLowerCase() === key.toLowerCase());
    if (!declared) {
      const near = closest(key, names);
      problems.push({
        prop: key, kind: "unknown", didYouMean: near ? [near] : [],
        message: names.length ? `${template} has no prop \`${key}\`${near ? `; did you mean \`${near}\`?` : `; its props are ${names.map(n => `\`${n}\``).join(", ")}`}` : `${template} declares no props, so \`${key}\` is not one: add [${FORM_FIELD_KEY}::${key} text] to the template`,
        example: names.length ? call(exampleOf(near ?? names[0]!, spec[near ?? names[0]!]!)) : `[${FORM_FIELD_KEY}::${key} text]`,
      });
      continue;
    }
    const field = spec[declared]!;
    if (field.kind === "choice" && field.choices && !field.choices.includes(value)) {
      const near = closest(value, field.choices);
      problems.push({ prop: declared, kind: "invalid", didYouMean: near ? [near] : field.choices.slice(0, 3), message: `${declared}=${value} isn't one of ${field.choices.join(", ")}${near ? `; did you mean \`${near}\`?` : ""}`, example: call(`${declared}=${near ?? field.choices[0]}`) });
      continue;
    }
    if (field.kind === "number" && !Number.isFinite(Number(value))) {
      problems.push({ prop: declared, kind: "invalid", didYouMean: [], message: `${declared}=${value} isn't a number`, example: call(`${declared}=1`) });
      continue;
    }
    (values[declared] ??= []).push(value);
  }
  const defaulted: string[] = [];
  const missing: MissingProp[] = [];
  for (const name of names) {
    if (values[name]) continue;
    const field = spec[name]!;
    if (field.default !== undefined) { values[name] = [field.default]; defaulted.push(name); continue; }
    if (!field.required) continue;
    missing.push({ name, kind: field.kind, ...(field.choices ? { choices: field.choices } : {}), example: exampleOf(name, field) });
    problems.push({
      prop: name, kind: "missing", didYouMean: field.choices ?? [],
      message: `${template} needs \`${name}\`${field.choices ? ` (${field.choices.join(", ")})` : ""}; the call gives none`,
      example: call(exampleOf(name, field)),
    });
  }
  return { values, defaulted, problems, missing };
}
