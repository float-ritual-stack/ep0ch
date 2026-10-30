// A render script is a component (note components): `[script::board] [mode::render]` with `[form-field::]` chips is a
// ComponentSchema like an extension's, and `::board{where="type=errand"}` is a second spelling of its `board::` line.
// This is the contract the service, completion and the write warnings share: the schema a script's note makes
// (`schemaOfScript`), one prop from one form field (`propSchemaOfField`), and the one-line calls a note's text holds
// (`oneLineCalls`). Pure: no I/O.

import { codeHides, scanPropertyLiteralRanges } from "./code-ranges";
import { COMPONENT_OPEN, componentAttrs, noteCodeFences } from "./component-block";
import { componentSchemaProblem, type ComponentSchema, type PropSchema } from "./component-schema";
import { isFormFieldProblem, MAX_FORM_FIELDS, parseFormField, type FormField } from "./form-fields";

/** The group a note component is listed under (completion, the library). */
export const NOTE_COMPONENT_GROUP = "this outline's";
/** A note component's origin: the note that holds its script. */
export const noteOrigin = (blockId: string) => `note:((${blockId}))`;
/** The built-in one-line components: never a note component's call, whatever names a set holds. */
const BUILT_IN_INLINE: ReadonlySet<string> = new Set(["use", "button"]);

/**
 * One prop from one form field (`[form-field::where query required]`): a `note` is a reference, a `choice` an enum of
 * its options, a `query` completes as a view's query does, a property (or `property:<key>`) is itself; the rest are
 * text. `meaning` is what completion says beside it (by default, what the field asks for).
 */
export function propSchemaOfField(field: FormField, meaning?: string): PropSchema {
  const t = field.type;
  const type: PropSchema["type"] = t === "property" || t.startsWith("property:") ? t as PropSchema["type"] : t === "note" ? "ref" : t === "choice" ? "enum" : t === "query" ? "query" : "text";
  return {
    key: field.name, where: "line", type,
    ...(t === "query" ? { complete: "query" as const } : {}),
    meaning: meaning ?? `${t === "query" ? "a query, in the saved views' grammar" : t === "note" ? "a note" : `a ${t}`}${field.required ? ", required" : ""}`,
    ...(field.options?.length ? { values: field.options.map(value => ({ value, meaning: value })) } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
    ...(field.required ? { required: true } : {}),
  };
}

/** What a render script's note says about itself, as the service reads it (outliner script-sources.ts). */
export interface ScriptComponentNote {
  /** The script's name (`[script::board]`): the component's id and what `::board{…}` calls. */
  name: string;
  /** The note's title. */
  title: string;
  /** The words above its fence: what it is. */
  intro: string;
  /** Its `[form-field::]` chips, as written or already read; a chip that can't be read is left out (the save warns). */
  fields: readonly (string | FormField)[];
  /** The note's own first `::name{…}` line (its demo), when it has one. */
  example?: string;
  /** The note holding the script. */
  blockId: string;
}

/**
 * The ComponentSchema a render script's note makes, origin `note:((id))`, checked as an extension's is
 * (`componentSchemaProblem`): a schema, or why it can't be one (a name that isn't a slug), said with the script's name.
 * Never throws.
 */
export function schemaOfScript(note: ScriptComponentNote): { schema?: ComponentSchema; problem?: string } {
  try {
    const { name, blockId } = note;
    const read = note.fields.map(f => typeof f === "string" ? parseFormField(f) : f).filter((f): f is FormField => !isFormFieldProblem(f));
    // A name twice, past the limit: left out, as formFields leaves them out of a run's arguments (declaredSlots).
    const fields = read.filter((f, i) => read.findIndex(g => g.name === f.name) === i).slice(0, MAX_FORM_FIELDS);
    const props = fields.map(f => propSchemaOfField(f));
    const keys = new Set(props.map(p => p.key));
    const demo = note.example ? COMPONENT_OPEN.exec(note.example.trim()) : null;
    const pairs = demo && demo[1] === name && demo[3] ? componentAttrs(demo[3].slice(1, -1)).pairs : [];
    const example = Object.fromEntries(pairs.filter(p => keys.has(p.key)).map(p => [p.key, p.value.slice(0, 300)]));
    const title = note.title.trim() || name;
    const schema: ComponentSchema = {
      id: name, title, group: NOTE_COMPONENT_GROUP,
      intro: (note.intro.trim() || title).slice(0, 2000),
      where: `\`::${name}{…}\` on its own line in any note: draws what the script ${name} returns under it`,
      props,
      source: { use: demo && demo[1] === name ? note.example!.trim() : `::${name}{}` },
      example, sweep: [], grids: [], space: [],
      origin: noteOrigin(blockId),
    };
    const problem = componentSchemaProblem(schema);
    return problem ? { problem: `script ${name}: ${problem}` } : { schema };
  } catch (error) {
    return { problem: `script ${note?.name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One `::name{…}` call of a note component, as a note's text holds it. */
export interface OneLineCall {
  name: string;
  /** Its attributes, in order (componentAttrs: a bare key's value is `on`). */
  attrs: { key: string; value: string }[];
  /** The line (from 0) it is written on. */
  line: number;
  /** Where the call starts (its `::`) and its line ends, as offsets in the text. */
  start: number;
  end: number;
  /** Its `^name`, when it has one. */
  id?: string;
}

/**
 * The calls `text` holds of the components `names` names: `::name{attrs}` on a line of its own (braces, empty or not:
 * `useCallAt`'s rule, a call closes with its line), outside code fences and property literals. `::use` and `::button`
 * are never one.
 */
export function oneLineCalls(text: string, names: ReadonlySet<string>): OneLineCall[] {
  if (!names.size || !text.includes("::")) return [];
  const lines = text.split("\n");
  const fenced = new Set<number>();
  for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) fenced.add(j);
  const literal = scanPropertyLiteralRanges(text);
  const out: OneLineCall[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) {
    if (fenced.has(i)) continue;
    const line = lines[i]!.replace(/\r$/, "");
    const open = COMPONENT_OPEN.exec(line);
    if (!open || !open[3] || BUILT_IN_INLINE.has(open[1]!) || !names.has(open[1]!)) continue;
    const start = at + line.indexOf("::"), end = at + line.length;
    if (codeHides({ start, end }, literal)) continue;
    out.push({ name: open[1]!, attrs: componentAttrs(open[3].slice(1, -1)).pairs, line: i, start, end, ...(open[4] ? { id: open[4] } : {}) });
  }
  return out;
}
