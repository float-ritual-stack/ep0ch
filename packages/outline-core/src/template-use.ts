// `::use{of=[[meeting-template]] date=2026-10-14 with=Jay}` (PIE-533 S4): a template drawn live in the note that
// writes the line. The line is a one-line component with attributes (component-block.ts reads the braces: `componentAttrs`
// is the one reader of `{k=v k2="two words"}`), so this module only says which attribute is the template and which are
// the call's props. Reading the line is pure; the service resolves the template, the prop values and the checks
// (`template.use`, outliner src/template-use.ts), and every client draws that answer. Pure: no I/O.
import { COMPONENT_OPEN, componentAttrs, noteCodeFences } from "./component-block";
import { parsePath, isReferenceHead } from "./resolve-path";
import type { MissingProp } from "./props-spec";
import { RESERVED_PROPS, type PropsSpec, type SiteLink, type SiteProblem } from "./site";

/** The component's name. */
export const USE_NAME = "use";

/** One `::use` line of a note. */
export interface UseCall {
  /** The line (from 0) it is written on. */
  line: number;
  /** The template as written (`[[meeting-template]]`, `((id))`, a Work ID, an id, or `type:meeting`); null when the line names none. */
  of: string | null;
  /** The call's props, in the order written: every attribute but the reserved ones (`of`, `act`, `as`…). */
  props: { key: string; value: string }[];
  /** Reserved attributes written on the line that `::use` doesn't take (`as=new`, `freeze=all`), for a message. */
  reserved: { key: string; value: string }[];
  /** The line couldn't be read as a call (no template named): what to write. */
  problem?: string;
}

const RESERVED: ReadonlySet<string> = new Set(RESERVED_PROPS);
/** The reserved keys a `::use` itself reads: `of` (the template). The rest belong to other producers. */
const USE_KEYS: ReadonlySet<string> = new Set(["of"]);

/**
 * The `::use` starting at line `i`, or null. `::use{of=[[x]] k=v}` is its own line; `::use [[x]] k=v` (the template as the
 * argument) reads the same.
 */
export function useCallAt(lines: readonly string[], i: number): UseCall | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  if (!open || open[1] !== USE_NAME) return null;
  // Only a one-line call: it has attributes or an argument, so it closes with its line (component-block.ts).
  if (!open[2] && !open[3]) {
    return { line: i, of: null, props: [], reserved: [], problem: "::use needs the template it draws: ::use{of=[[meeting-template]]}" };
  }
  const props: UseCall["props"] = [], reserved: UseCall["reserved"] = [];
  let of: string | null = null;
  const pairs = open[3] ? componentAttrs(open[3].slice(1, -1)).pairs : [];
  // `::use [[x]] date=…`: the first word is the template, the rest read as attributes.
  const argument = open[2]?.trim();
  if (argument) {
    const words = componentAttrs(argument).pairs;
    const first = /^\S+/.exec(argument)?.[0];
    if (first && !first.includes("=")) of = first;
    pairs.push(...words);
  }
  for (const { key, value } of pairs) {
    const k = key.toLowerCase();
    if (k === "of") of = value;
    else if (RESERVED.has(k) && !USE_KEYS.has(k)) reserved.push({ key: k, value });
    else props.push({ key, value });
  }
  const problem = of === null || !of.trim() ? "::use needs the template it draws: ::use{of=[[meeting-template]]}" : undefined;
  return { line: i, of: of?.trim() || null, props, reserved, ...(problem ? { problem } : {}) };
}

/** Every `::use` a note's text holds, in order (outside code fences): what a client checks a drawn call against. */
export function useCallsOf(text: string): UseCall[] {
  if (!text.includes("::use")) return [];
  const lines = text.split("\n");
  const fenced = new Set<number>();
  for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) fenced.add(j);
  const out: UseCall[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const call = useCallAt(lines, i);
    if (call) out.push(call);
  }
  return out;
}

/**
 * How a prop value is read: text as written; or a path. `{{ … }}` inside it is interpolated in the caller's Site before
 * the call (`status={{parent.status}}`), and a bare path headed by a reference, written as a person writes it
 * (`owner=[[evan]].name`, `ref=((id)).status`), resolves too. Anything else is the words themselves.
 */
export function propValueSource(value: string): { kind: "text" } | { kind: "template" } | { kind: "path"; path: string } {
  if (value.includes("{{")) return { kind: "template" };
  const parsed = parsePath(value);
  // A reference alone (`[[evan]]`) is the link as text; only `[[evan]].key` reads through it.
  if (parsed && isReferenceHead(parsed.head) && parsed.steps.length > 0 && value.trim().startsWith(parsed.head)) return { kind: "path", path: value.trim() };
  return { kind: "text" };
}

/** A prop's value as an attribute word: bare when it is one word, else quoted as a shell's words are. */
export function attrWord(key: string, value: string): string {
  return /^[^\s"'\\{}]+$/.test(value) || (/^\{\{[^\n]*\}\}$/.test(value) && !/\s/.test(value)) ? `${key}=${value}` : `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A `::use` line with props added to its call (`owner=ada`): inside the braces, or at the end of the argument form. A prop the
 * line already has is replaced by the new value. The words of a braced call are written again from what they read as
 * (so a quote style may change, never a value). Null when the line isn't a `::use`.
 */
export function withUseProps(line: string, props: Record<string, string>): string | null {
  const open = COMPONENT_OPEN.exec(line.replace(/\r$/, ""));
  if (!open || open[1] !== USE_NAME) return null;
  const added = Object.entries(props);
  if (!added.length) return line;
  if (!open[3]) return `${line.trimEnd()} ${added.map(([key, value]) => attrWord(key, value)).join(" ")}`;
  const had = new Set(added.map(([key]) => key.toLowerCase()));
  const { classes, pairs } = componentAttrs(open[3].slice(1, -1));
  const words = [...classes.map(c => `.${c}`), ...pairs.filter(p => !had.has(p.key.toLowerCase())).map(p => attrWord(p.key, p.value)), ...added.map(([key, value]) => attrWord(key, value))];
  const at = line.indexOf(open[3]);
  return `${line.slice(0, at)}{${words.join(" ")}}${line.slice(at + open[3].length)}`;
}

// ── the wire: `template.use` ──

/** `template.use`'s question: the `::use` written on `line` of note `block`, as drawn. */
export interface TemplateUseRequest {
  /** The note the line is written in (an id, ((id)), a Work ID or a [[page]]). */
  block: string;
  /** The line of that note (from 0) holding the `::use`. */
  line: number;
  /** The unsaved text of `block` (a draft being typed): the line is read from it. */
  draft?: { text: string };
  /** Where `block` is itself drawn (a `::use` in a template, an embed): the invocations from the outermost host in. */
  chain?: SiteLink[];
  /** The call's props `block` is drawn with, when it is itself a template body (`props.*`). */
  props?: Record<string, string[]>;
}

/** One thing wrong with a call, said as an unresolved `{{ }}` is: why, the nearest names, a call that works. */
export type UseProblem = SiteProblem & { kind: "of" | "cycle" | "spec" | "unknown" | "missing" | "invalid" | "path"; prop?: string };

/** `template.use`'s answer: what to draw, and the Site to draw it in. */
export interface TemplateUseAnswer {
  /** The note the call is written in, and its line. */
  host: string;
  line: number;
  /** The template, with its text (the body is drawn from it); absent when `of` names none. */
  template?: { id: string; title: string; revision: number; text: string; how: string };
  /** The chain to draw the template's body in (`site.answer`'s, `produce`'s): the host's, then this use. */
  chain: SiteLink[];
  /** The call's props as the template reads them (`props.*`): given (paths resolved), then defaults. */
  props: Record<string, string[]>;
  /** The props the template declares. */
  spec: PropsSpec;
  /** What is wrong with the call, in the order a person would fix it. */
  problems: UseProblem[];
  /** Required props the call leaves out: a press asks for each in the picker of its kind. */
  missing: MissingProp[];
  /** How it was found: the template's resolver, each prop's source. */
  route: string[];
  /** The notes the answer was computed from: it changes only when one of them does. */
  deps: string[];
  anyChange?: true;
  clock?: "minute";
  generation?: number;
}
