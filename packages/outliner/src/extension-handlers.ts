import { createHash } from "node:crypto";
import type { ExtensionHandler, ExtensionOptionSpec } from "./extension-manifest";
import type { BoundHandler } from "./extension-registry";
import { splitWords } from "@ep0ch/outline-core/component-block";
import { offsetInRanges, scanPropertyLiteralRanges, sourceLines } from "@ep0ch/outline-core/code-ranges";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { oneLineCalls } from "@ep0ch/outline-core/script-component";
import { FORM_FIELD_KEY, formFields } from "@ep0ch/outline-core/form-fields";
import { parsePropertyDirectiveLines, parsePropertyRecords } from "@ep0ch/outline-core/property-parse";

/**
 * Handler lines: `key:: [argument] [--option[=value]]` for a key an
 * extension serves (one grammar for every extension; the extension never
 * parses its own line). The host checks the argument and the options against
 * the manifest and hands the extension typed values.
 *
 * - **fetch** options (the default scope) are part of the call: two lines that
 *   differ by one are two calls.
 * - **display** options never reach the extension: lines that differ only by
 *   one share a result (PIE-445's thrash rule).
 * - An unknown `--flag` is a warning, not a failure.
 */

export type OptionValue = boolean | number | string;

export interface HandlerCall {
  readonly extensionId: string;
  readonly handlerKey: string;
  readonly kind: ExtensionHandler["kind"];
  readonly effects: ExtensionHandler["effects"];
  /** The words that aren't options, or null when there are none. */
  readonly argument: string | null;
  readonly options: Readonly<Record<string, OptionValue>>;
  readonly display: Readonly<Record<string, OptionValue>>;
  readonly unknown: readonly string[];
  /** Why the line can't run as written; empty when it can. */
  readonly problems: readonly string[];
  /** Whether the argument (a data handler's key) is well formed, whatever the options say. */
  readonly argumentOk: boolean;
  /** Identifies the call within its block: handler, argument and fetch options. */
  readonly callKey: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly indent: string;
}

export interface HandlerTable {
  handler(key: string): BoundHandler | undefined;
  handlerKeys(): ReadonlySet<string>;
}

const MAX_CALLS = 16;

function optionValue(name: string, spec: ExtensionOptionSpec, raw: string | undefined): OptionValue | string[] {
  if (spec.type === "boolean") {
    if (raw === undefined || raw === "true") return true;
    if (raw === "false") return false;
    return [`--${name} takes true or false`];
  }
  if (raw === undefined) {
    if (spec.default !== undefined && typeof spec.default !== "boolean") return spec.default;
    return [`--${name} needs a value (--${name}=…)`];
  }
  if (spec.type === "integer") {
    if (!/^-?[0-9]{1,9}$/.test(raw)) return [`--${name} takes a whole number`];
    const value = Number(raw);
    if (spec.min !== undefined && value < spec.min) return [`--${name} is at least ${spec.min}`];
    if (spec.max !== undefined && value > spec.max) return [`--${name} is at most ${spec.max}`];
    return value;
  }
  if (raw.length > 200) return [`--${name} is longer than 200 characters`];
  if (spec.pattern && !new RegExp(spec.pattern, "u").test(raw)) return [`--${name} doesn't match ${spec.pattern}`];
  return raw;
}

/** The handler lines in a block's text that a registered extension serves, in order. */
export function handlerCalls(text: string, table: HandlerTable): HandlerCall[] {
  const keys = table.handlerKeys();
  if (!keys.size || !text.includes("::")) return [];
  const calls: HandlerCall[] = [];
  for (const line of parsePropertyDirectiveLines(text, keys)) {
    const bound = table.handler(line.key);
    if (!bound || bound.handler.kind === "resource") continue;
    const { handler, extension } = bound;
    const words = splitWords(line.value, false, false).flat();
    const positional: string[] = [];
    const options: Record<string, OptionValue> = {};
    const display: Record<string, OptionValue> = {};
    const unknown: string[] = [];
    const problems: string[] = [];
    for (const { value: word, raw } of words) {
      const option = /^--([a-z][a-z0-9-]{0,31})(?:=(.*))?$/.exec(word);
      if (!option) {
        // The argument is the text as written: a quote in it is the person's own (`Bob's`), not an option's.
        positional.push(raw);
        continue;
      }
      const spec = handler.options?.[option[1]!];
      if (!spec) {
        unknown.push(word);
        continue;
      }
      const value = optionValue(option[1]!, spec, option[2]);
      if (Array.isArray(value)) problems.push(...value);
      else (spec.scope === "display" ? display : options)[option[1]!] = value;
    }
    for (const [name, spec] of Object.entries(handler.options ?? {})) {
      const target = spec.scope === "display" ? display : options;
      if (target[name] === undefined && spec.default !== undefined) target[name] = spec.default;
    }
    const argument = positional.length ? positional.join(" ") : null;
    const name = handler.argument?.name ?? "an argument";
    const argumentProblems: string[] = [];
    if (argument === null && (handler.argument?.required || handler.kind === "data")) argumentProblems.push(`${handler.key}:: needs ${name}`);
    const pattern = handler.kind === "data" ? handler.keyPattern ?? handler.argument?.pattern : handler.argument?.pattern;
    if (argument !== null && pattern && !new RegExp(pattern, "u").test(argument)) argumentProblems.push(`${argument} isn't ${handler.argument?.description ?? `a ${name} ${handler.key}:: knows`}`);
    if (argument !== null && argument.length > 500) argumentProblems.push(`${name} is longer than 500 characters`);
    problems.push(...argumentProblems);
    const sorted = Object.fromEntries(Object.entries(options).sort(([left], [right]) => left.localeCompare(right)));
    calls.push({
      extensionId: extension.id,
      handlerKey: handler.key,
      kind: handler.kind,
      effects: handler.effects,
      argument,
      options: sorted,
      display,
      unknown,
      problems,
      argumentOk: argumentProblems.length === 0,
      callKey: createHash("sha256").update(JSON.stringify([handler.key, argument, sorted])).digest("hex").slice(0, 32),
      line: line.line,
      start: line.start,
      end: line.end,
      indent: line.indent,
    });
    if (calls.length >= MAX_CALLS) break;
  }
  return calls;
}

/** The extension id and handler key of a `::=` line: a built-in handler of the host, a one-line render-mode script. */
export const PIPELINE = "pipeline";

const PIPELINE_LINE = /^([ \t]*)((?:[-*+][ \t]+)?)::=[ \t]*(\S.*?)[ \t]*$/;

/**
 * The `::=` lines of a block (PIE-533): `::= (await q("parent:this")).blocks.map(b => b.title).join(", ")`. The line's
 * expression is a render-mode script (`this`, `props`, `q`, `read`, `resolve`), drawn under the line and again when what
 * it read changes. It is the argument of the call, so two lines with different expressions are two calls.
 */
export function pipelineCalls(text: string): HandlerCall[] {
  if (!text.includes("::=")) return [];
  const literal = scanPropertyLiteralRanges(text);
  const calls: HandlerCall[] = [];
  sourceLines(text).forEach((line, lineIndex) => {
    const match = PIPELINE_LINE.exec(text.slice(line.start, line.contentEnd));
    if (!match || offsetInRanges(line.start + match[1]!.length, literal) || calls.length >= MAX_CALLS) return;
    const argument = match[3]!;
    calls.push({
      extensionId: PIPELINE, handlerKey: PIPELINE, kind: "output", effects: "read", argument, options: {}, display: {}, unknown: [],
      problems: argument.length > 500 ? ["the expression is longer than 500 characters"] : [], argumentOk: true,
      callKey: createHash("sha256").update(JSON.stringify([PIPELINE, argument, {}])).digest("hex").slice(0, 32),
      line: lineIndex, start: line.start + match[1]!.length + match[2]!.length, end: line.contentEnd, indent: match[1]!,
    });
  });
  return calls;
}

/** The built-in components: a `::callout{…}` is never a script's, whatever a script calls itself. */
const BUILT_IN_COMPONENTS: ReadonlySet<string> = new Set(BUILTIN_COMPONENT_SCHEMAS.map(schema => schema.id));

/** The words a call hands its script: each `name="value"` as `slotProps` reads it back. */
const slotWord = (key: string, value: string) => `${key}="${value.replace(/[\\"]/g, "\\$&")}"`;

/** The slots a script declares (script-sources.ts declaredSlots, read here without the service's modules): its note's chips, or a file's opening comments. */
function slotsOf(script: NonNullable<BoundHandler["extension"]["script"]>) {
  const lines = script.file ? script.code.split(/\r?\n/) : [];
  const end = lines.findIndex(line => !/^\s*\/\//.test(line));
  const comments = (end < 0 ? lines : lines.slice(0, end)).join("\n");
  return formFields(script.fields ?? parsePropertyRecords(comments).filter(p => p.key === FORM_FIELD_KEY).map(p => p.value)).fields;
}

/**
 * The `::name{…}` lines of a block whose name a render script serves (note components): `::board{where="type=errand"}`
 * is a second spelling of `board:: where="type=errand"`, so it draws the same way, under its line. The argument is its
 * attributes as written, then the defaults its `[form-field::]` chips give for the rest; a required one left out is the
 * call's problem.
 */
export function componentCalls(text: string, table: HandlerTable): HandlerCall[] {
  if (!text.includes("::")) return [];
  const names = new Set([...table.handlerKeys()].filter(key => !BUILT_IN_COMPONENTS.has(key) && table.handler(key)?.extension.script?.render));
  const calls: HandlerCall[] = [];
  for (const call of oneLineCalls(text, names)) {
    if (calls.length >= MAX_CALLS) break;
    const { handler, extension } = table.handler(call.name)!;
    const given = new Set(call.attrs.map(a => a.key));
    const slots = slotsOf(extension.script!);
    const words = [...call.attrs.map(a => slotWord(a.key, a.value)),
      ...slots.flatMap(slot => !given.has(slot.name) && slot.default !== undefined ? [slotWord(slot.name, slot.default)] : [])];
    const argument = words.length ? words.join(" ") : null;
    const missing = slots.filter(slot => slot.required && !given.has(slot.name) && slot.default === undefined).map(slot => slot.name);
    const problems = [...missing.length ? [`::${call.name} needs ${missing.join(" and ")}`] : [], ...argument && argument.length > 500 ? ["its props are longer than 500 characters"] : []];
    const lineStart = text.lastIndexOf("\n", call.start - 1) + 1;
    calls.push({
      extensionId: extension.id, handlerKey: handler.key, kind: handler.kind, effects: handler.effects, argument, options: {}, display: {}, unknown: [],
      problems, argumentOk: problems.length === 0,
      callKey: createHash("sha256").update(JSON.stringify([handler.key, argument])).digest("hex").slice(0, 32),
      line: call.line, start: call.start, end: call.end, indent: text.slice(lineStart, call.start),
    });
  }
  return calls;
}

/**
 * Cheap guard for readers: could this text hold a handler line (any `key::`
 * line, a `::name{…}` call) or an agent request (an `@name` line)? The service decides.
 */
export function mayHaveHandlerLines(text: string): boolean {
  return /^(?:[ \t]*)(?:`{3,}|~{3,})(?:sh|bash|zsh)\s+run\s*$/m.test(text) || (text.includes("::") && /^[ \t]*(?:[-*+][ \t]+)?(?:[A-Za-z][A-Za-z0-9_.-]*::|::=|::[a-z][a-z0-9-]*\{)/m.test(text)) ||
    (text.includes("@") && /^[ \t]*(?:[-*+][ \t]+)?@[a-z]/m.test(text));
}
