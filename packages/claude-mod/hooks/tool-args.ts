/**
 * Tool arguments for the mod's tools: `ref` for "which block or note", its aliases, and the corrective error.
 * Hooks can't import application code, so this is the same code as packages/outline-core/src/tool-args.ts below the
 * marker line; packages/door/test/tool-args-parity.test.ts fails when they differ. Edit the outline-core file, then
 * copy everything from the marker down.
 */

// --- tool-args shared code below this line ---

export interface ToolSchema {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Record<string, ToolSchema>;
  required?: readonly string[];
  items?: ToolSchema;
  minimum?: number;
  maximum?: number;
  anyOf?: readonly ToolSchema[];
  /** Alternatives that each name the arguments one of which must be given (`[{required:["uri"]},{required:["ref"]}]`). */
  oneOf?: readonly { required?: readonly string[] }[];
  description?: string;
  [key: string]: unknown;
}

export interface ToolArgsSpec {
  name: string;
  schema: ToolSchema;
  /** A call that works, with real-looking values. */
  example: Record<string, unknown>;
  /** More names a canonical argument answers to, beyond REF_ALIASES for `ref` (`{ ref: ["item"] }`). */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** Keys that arrive with the arguments but are not arguments (a plugin event's `tool`). */
  ignore?: readonly string[];
  /**
   * A name that is no argument and near none is dropped, not refused, when nothing else is wrong. For a host that hands
   * its own metadata in with the arguments (the Claude mod's tool events carry `agentId` in a subagent): a typo of an
   * argument, or an unknown name beside a missing one, is still answered.
   */
  dropUnknown?: true;
  /** Check names only (unknown, missing, conflicting): the surface coerces values itself (the door's `k=v` words are all text). */
  namesOnly?: true;
  /** A call as this surface writes it (`ep0ch act block.mark id=PIE-123`); default `name {json}`. */
  callText?: (name: string, args: Record<string, unknown>) => string;
}

/** The names models give "which block or note", besides `ref`. */
export const REF_ALIASES = ["id", "reference", "block", "blockId", "uri", "note"] as const;

export type ToolArgsResult =
  | { ok: true; args: Record<string, unknown>; renamed: readonly (readonly [string, string])[] }
  | { ok: false; error: string };

function typesOf(schema: ToolSchema): string[] {
  if (schema.type !== undefined) return [...(Array.isArray(schema.type) ? schema.type : [schema.type as string])];
  if (schema.const !== undefined) return [schema.const === null ? "null" : typeof schema.const];
  if (schema.anyOf) return [...new Set(schema.anyOf.flatMap(typesOf))];
  return [];
}

function isType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null": return value === null;
    default: return true;
  }
}

/** A schema as a short type: `string`, `integer 1-200`, `user|agent|system`, `string[]`. */
function typeLabel(schema: ToolSchema): string {
  const choices = schema.enum ?? (schema.anyOf?.every(member => member.const !== undefined) ? schema.anyOf.map(member => member.const) : undefined);
  if (choices) return choices.map(String).join("|");
  const types = typesOf(schema);
  if (types.length === 0) return "any";
  const label = types.map(type => type === "array" ? `${schema.items ? typeLabel(schema.items) : "any"}[]` : type).join("|");
  if (schema.minimum !== undefined && schema.maximum !== undefined) return `${label} ${schema.minimum}-${schema.maximum}`;
  if (schema.minimum !== undefined) return `${label} >= ${schema.minimum}`;
  if (schema.maximum !== undefined) return `${label} <= ${schema.maximum}`;
  return label;
}

function requiredAlternatives(schema: ToolSchema): string[][] {
  return (schema.oneOf ?? []).flatMap(alternative => alternative.required?.length ? [[...alternative.required]] : []);
}

/** The tool's arguments in one line: `ref (string, required) · depth (integer 0-6) · limit (integer 0-500)`. */
export function toolSchemaLine(spec: ToolArgsSpec): string {
  const required = new Set(spec.schema.required ?? []);
  const alternatives = requiredAlternatives(spec.schema).map(names => names[0]!);
  const parts = Object.entries(spec.schema.properties ?? {}).map(([name, schema]) => {
    const note = required.has(name) ? "required" : alternatives.includes(name) ? "one of these is required" : "";
    return `${name} (${typeLabel(schema)}${note ? `, ${note}` : ""})`;
  });
  return parts.length ? parts.join(" · ") : "no arguments";
}

const shorten = (value: unknown): unknown => typeof value === "string" && value.length > 60 ? `${value.slice(0, 57)}…` : value;

/** `name {"ref":"PIE-123"}`: a call as an agent writes it. */
export function toolCallText(name: string, args: Record<string, unknown>): string {
  return `${name} ${JSON.stringify(args)}`;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

/** The accepted name closest to `name` (case aside), if close enough to be a typo of it. */
function closest(name: string, candidates: readonly string[]): string | undefined {
  const lower = name.toLowerCase();
  let best: { name: string; d: number } | undefined;
  for (const candidate of candidates) {
    const d = distance(lower, candidate.toLowerCase());
    if (!best || d < best.d) best = { name: candidate, d };
  }
  return best && best.d <= Math.max(2, Math.floor(Math.max(name.length, best.name.length) / 3)) ? best.name : undefined;
}

/** Every name that means a declared argument: alias to canonical. */
function aliasTable(spec: ToolArgsSpec): Map<string, string> {
  const declared = spec.schema.properties ?? {};
  const table = new Map<string, string>();
  for (const [canonical, names] of Object.entries(spec.aliases ?? {})) for (const name of names) if (!(name in declared)) table.set(name, canonical);
  if ("ref" in declared) for (const name of REF_ALIASES) if (!(name in declared) && !table.has(name)) table.set(name, "ref");
  return table;
}

/**
 * The tool's input, checked: aliases renamed to the canonical argument, and every problem found at once. The error
 * is the whole answer for the agent (unknown names with the closest valid one, missing and mistyped arguments, the
 * schema line, the corrected call or an example), so a caller returns it as it is.
 */
export function checkToolArgs(spec: ToolArgsSpec, input: unknown): ToolArgsResult {
  const declared = spec.schema.properties ?? {};
  const aliases = aliasTable(spec);
  const ignore = new Set(spec.ignore ?? []);
  const problems: string[] = [];
  const fixes: [string, string][] = [];
  const args: Record<string, unknown> = {};
  const unknown: string[] = [];
  const renamed: [string, string][] = [];
  const conflicted = new Set<string>();
  const fail = (): ToolArgsResult => ({ ok: false, error: message(spec, problems, fixes, input, unknown) });

  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    problems.push(`The arguments are ${Array.isArray(input) ? "a list" : typeof input}, not an object of name: value.`);
    return fail();
  }
  const given = input as Record<string, unknown>;
  const from = new Map<string, string[]>();
  for (const [key, value] of Object.entries(given)) {
    if (ignore.has(key)) continue;
    if (value === undefined) continue;
    const canonical = key in declared ? key : aliases.get(key);
    if (canonical === undefined) { unknown.push(key); continue; }
    from.set(canonical, [...(from.get(canonical) ?? []), key]);
  }
  for (const [canonical, keys] of from) {
    const values = keys.map(key => given[key]);
    if (keys.length > 1 && !values.every(value => sameReference(value, values[0]))) {
      conflicted.add(canonical);
      problems.push(ambiguous(keys.map((key, i) => [key, values[i]] as const)));
      continue;
    }
    args[canonical] = values[0];
    for (const key of keys) if (key !== canonical) renamed.push([key, canonical]);
  }

  // A schema that declares both `ref` and another name for the note (the MCP tools' `uri`) holds them to the same rule.
  if ("ref" in declared && !conflicted.has("ref")) {
    const named = ["ref", ...REF_ALIASES.filter(name => name in declared)].filter(name => (name === "ref" ? args.ref : given[name]) !== undefined);
    const values = named.map(name => (name === "ref" ? args.ref : given[name]));
    if (named.length > 1 && !values.every(value => sameReference(value, values[0]))) {
      conflicted.add("ref");
      problems.push(ambiguous(named.map((key, i) => [key, values[i]] as const)));
    }
  }

  const missing = (spec.schema.required ?? []).filter(name => !conflicted.has(name) && (args[name] === undefined || (args[name] === null && !typesOf(declared[name] ?? {}).includes("null"))));
  const alternatives = requiredAlternatives(spec.schema);
  const lacksAlternative = alternatives.length > 0 && !conflicted.size && !alternatives.some(names => names.every(name => args[name] !== undefined));
  const lacking = [...missing, ...(lacksAlternative ? [alternatives.map(names => names.join("+"))[0]!.split("+")[0]!] : [])];

  // An unknown name beside one missing argument of the value's type is that argument, named wrongly.
  const names = [...Object.keys(declared), ...aliases.keys()];
  for (const key of unknown) {
    const near = closest(key, names);
    const target = near === undefined ? undefined : (aliases.get(near) ?? near);
    if (target !== undefined && args[target] === undefined) {
      problems.push(`\`${key}\` is not an argument of ${spec.name}; did you mean \`${target}\`?`);
      fixes.push([key, target]);
    } else if (!spec.dropUnknown && unknown.length === 1 && lacking.length === 1 && typesOf(declared[lacking[0]!] ?? {}).some(type => isType(given[key], type))) {
      problems.push(`\`${key}\` is not an argument of ${spec.name}; the required \`${lacking[0]}\` is missing, so you probably meant \`${lacking[0]}\`.`);
      fixes.push([key, lacking[0]!]);
    } else if (!spec.dropUnknown) {
      problems.push(`\`${key}\` is not an argument of ${spec.name}.`);
    }
  }
  const fixed = new Set(fixes.map(([, to]) => to));
  for (const name of missing) if (!fixed.has(name)) problems.push(`Missing required \`${name}\` (${typeLabel(declared[name] ?? {})}${declared[name]?.description ? `: ${declared[name]!.description}` : ""}).`);
  if (lacksAlternative && !alternatives.flat().some(name => fixed.has(name))) {
    problems.push(`Give one of ${alternatives.map(names => `\`${names.join(" + ")}\``).join(" or ")}.`);
  }

  for (const [name, value] of spec.namesOnly ? [] : Object.entries(args)) {
    const schema = declared[name];
    if (!schema || value === null && !typesOf(schema).includes("null")) continue;
    const types = typesOf(schema);
    if (types.length && !types.some(type => isType(value, type))) {
      problems.push(`\`${name}\` must be ${typeLabel(schema)}; got ${describe(value)}.`);
    } else if (schema.enum && !schema.enum.some(choice => choice === value)) {
      problems.push(`\`${name}\` must be one of ${schema.enum.map(String).join(", ")}; got ${JSON.stringify(shorten(value))}.`);
    } else if (typeof value === "number" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) {
      problems.push(`\`${name}\` must be ${typeLabel(schema)}; got ${value}.`);
    } else if (Array.isArray(value) && schema.items && typesOf(schema.items).length) {
      const bad = value.findIndex(item => !typesOf(schema.items!).some(type => isType(item, type)));
      if (bad >= 0) problems.push(`\`${name}\` is a list of ${typeLabel(schema.items)}; item ${bad} is ${describe(value[bad])}.`);
    }
  }
  return problems.length ? fail() : { ok: true, args, renamed };
}

/** A reference as compared for conflicts: the block it names, and the outline an `ep0ch://` URI names it in. */
function refKey(value: unknown): { id: string; where?: string } {
  if (typeof value !== "string") return { id: JSON.stringify(value) };
  let text = value.trim();
  const block = /^\(\(([^|)^]+)(?:[|^][^)]*)?\)\)$/.exec(text);
  if (block) text = block[1]!.trim();
  const uri = /^ep0ch:\/\/([^/]+)\/b\/([0-9a-f-]{36})$/i.exec(text);
  if (uri) return { id: uri[2]!.toLowerCase(), where: uri[1]!.toLowerCase() };
  return { id: /^[0-9a-f-]{36}$/i.test(text) ? text.toLowerCase() : text };
}

/**
 * Whether two spellings name the same block: `((id))`, `((id|label))` and the bare id are one; an `ep0ch://` URI is the
 * same block only in the same outline (UUIDs can repeat across a fork), and a bare id agrees with a URI of that id.
 */
export function sameReference(a: unknown, b: unknown): boolean {
  const [x, y] = [refKey(a), refKey(b)];
  return x.id === y.id && (x.where === undefined || y.where === undefined || x.where === y.where);
}

/** The refusal for references that disagree (`ref` and `id` naming different blocks), or null when they all agree. */
export function referenceConflict(spec: ToolArgsSpec, pairs: readonly (readonly [string, unknown])[]): string | null {
  if (pairs.length < 2 || pairs.every(([, value]) => sameReference(value, pairs[0]![1]))) return null;
  return message(spec, [ambiguous(pairs)], [], {}, []);
}

const ambiguous = (pairs: readonly (readonly [string, unknown])[]) =>
  `Ambiguous: ${pairs.map(([key, value]) => `\`${key}\` is ${JSON.stringify(shorten(value))}`).join(" but ")}. They name different things and none was used: pass one \`ref\`.`;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `${typeof value} ${JSON.stringify(shorten(value))}`;
}

function message(spec: ToolArgsSpec, problems: string[], fixes: [string, string][], input: unknown, unknown: string[]): string {
  const lines = [`${spec.name} did not run.`, ...problems];
  lines.push(`Arguments: ${toolSchemaLine(spec)}`);
  const given = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const ignore = new Set(spec.ignore ?? []);
  const kept = Object.entries(given).filter(([key, value]) => value !== undefined && !ignore.has(key));
  const exact = kept.every(([, value]) => JSON.stringify(value).length <= 160);
  const fixedArgs: Record<string, unknown> = {};
  for (const [key, value] of kept) fixedArgs[fixes.find(([from]) => from === key)?.[1] ?? key] = value;
  // The corrected call is offered only when it would itself pass.
  if (fixes.length && unknown.length === fixes.length && problems.length === fixes.length && exact && checkToolArgs(spec, fixedArgs).ok) {
    lines.push(`Call it as: ${(spec.callText ?? toolCallText)(spec.name, fixedArgs)}`);
  } else {
    lines.push(`Example: ${(spec.callText ?? toolCallText)(spec.name, spec.example)}`);
  }
  return lines.join("\n");
}
