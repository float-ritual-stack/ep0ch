// `resolvePath(path, site, scope)` (PIE-533): the one pure resolver for a path like `this.owner`, `parent.project`,
// `props.week`, `this.fields.storyTime` or a bare `project`. The service, every client and every host call (a script's
// `resolve`, the runbook, rule labels) read values through it; nobody walks a note's properties on their own.
//
// A path is `head(.key | [n])*`, optionally ending in `.count`. Heads this file answers without reading anything else:
// `this`, `parent`, `self` (records), `props` (the call site's arguments) and a bare key, which walks the scope
// (scope-walk.ts: the line, then the note, then each ancestor, nearest first). A head that names another note (`((id))`,
// `[[page]]`, a Work ID), `now`, `caller`, `match`, link-following and the `| filter` tail need the service: they come
// with the Site read (S1). Pure: no I/O.
import type { BlockRecord } from "./block-record";
import { splitPropertyValue } from "./property-grammar";
import { parsePropertyRecords } from "./property-parse";
import { createContextResolver, type ContextBlock, type ContextKeyMatcher } from "./scope-walk";
import type { Site } from "./site";
import { closest } from "./tool-args";

/** A path, read: its head and the keys and indexes after it. */
export interface ParsedPath { head: string; steps: ({ key: string } | { index: number })[] }

/** Where the Site's own line sits: what a bare key's scope walk starts from. */
export interface PathScope {
  /** The line, as an index into `site.this`'s text, the walk starts at. Default: the first line. */
  line?: number;
  /** The note's ancestors, nearest (the parent) first. */
  ancestors?: readonly ContextBlock[];
  /** The note's parent as a record, for `parent.key`. */
  parent?: BlockRecord;
}

/** The answer: every value (always a list), or why there is none, with the nearest keys. */
export type PathAnswer =
  | { ok: true; values: string[]; /** For `.fields.key`: the line each value was written on. */ lines?: number[] }
  | { ok: false; problem: { message: string; didYouMean: string[] } };

/** A head: a name, or a reference to another note (`((id))`, `[[page]]`, a Work ID such as `PIE-533`). */
const HEAD = /^(?:\(\([^()\n]+\)\)|\[\[[^\[\]\n]+\]\]|[A-Z][A-Z0-9]*-\d+(?![\w-])|[A-Za-z_][\w-]*)/;

/** Whether a head names another note, which only the service can read. */
export const isReferenceHead = (head: string): boolean => /^(?:\(\(|\[\[|[A-Z][A-Z0-9]*-\d+$)/.test(head);

/** `this.tasks[0].title` → head `this`, steps. Null when the text isn't a path. */
export function parsePath(path: string): ParsedPath | null {
  const text = path.trim();
  const head = HEAD.exec(text)?.[0];
  if (!head) return null;
  const steps: ParsedPath["steps"] = [];
  let rest = text.slice(head.length);
  while (rest) {
    const key = /^\.([A-Za-z_][\w-]*)/.exec(rest);
    const index = /^\[(\d+)\]/.exec(rest);
    if (key) { steps.push({ key: key[1]! }); rest = rest.slice(key[0].length); }
    else if (index) { steps.push({ index: Number(index[1]) }); rest = rest.slice(index[0].length); }
    else return null;
  }
  return { head, steps };
}

const fail = (message: string, candidates: readonly string[], asked: string): PathAnswer => {
  const near = closest(asked, candidates);
  return { ok: false, problem: { message: near ? `${message}; did you mean \`${near}\`?` : message, didYouMean: near ? [near] : [] } };
};

/** The record's own fields a path can name besides a property. */
const RECORD_KEYS = ["id", "parent", "title", "body", "text", "children", "created", "updated", "author", "actor", "revision"] as const;

function recordField(record: BlockRecord, key: string): string[] | undefined {
  switch (key) {
    case "id": case "title": case "body": case "text": case "created": case "updated": case "author": case "revision":
      return [String(record[key])];
    case "parent": return record.parent ? [record.parent] : [];
    case "actor": return record.actor ? [record.actor] : [];
    case "children": return [...record.children];
  }
  return undefined;
}

/** Block-scope values of `key`, in order. */
const blockValues = (record: BlockRecord, key: string) => record.properties.filter(p => p.key === key).flatMap(p => p.values);

/**
 * Every value of `key` on a note: block scope first (front matter, header chips, hashtags: what queries match), then each
 * occurrence in the note's fields (line and inline) in document order. A value is what the list rule says one is
 * (`splitPropertyValue`: a plain value's commas are part of it, `[a, b]` is two).
 */
export function noteValues(record: BlockRecord, key: string): string[] {
  const k = key.toLowerCase();
  return [...blockValues(record, k), ...record.fields.filter(f => f.key === k).flatMap(f => splitPropertyValue(f.value))];
}

const keysOf = (record: BlockRecord) => [...new Set([...record.properties.map(p => p.key), ...record.fields.map(f => f.key)])];

function inRecord(record: BlockRecord, steps: ParsedPath["steps"], label: string): PathAnswer {
  const [first, ...rest] = steps;
  if (!first) return { ok: true, values: [record.title] };
  if ("index" in first) return { ok: false, problem: { message: `\`${label}\` is a note, not a list`, didYouMean: [] } };
  const key = first.key.toLowerCase();
  if (key === "block" || key === "fields") {
    const next = rest[0];
    if (!next || "index" in next) return { ok: false, problem: { message: `\`${label}.${key}\` needs a key after it: \`${label}.${key}.${keysOf(record)[0] ?? "key"}\``, didYouMean: [] } };
    const wanted = next.key.toLowerCase();
    if (key === "block") return finish({ ok: true, values: blockValues(record, wanted) }, rest.slice(1));
    const found = record.fields.filter(f => f.key === wanted).flatMap(f => splitPropertyValue(f.value).map(value => ({ value, line: f.line })));
    return finish({ ok: true, values: found.map(f => f.value), lines: found.map(f => f.line) }, rest.slice(1));
  }
  const field = recordField(record, key);
  if (field) return finish({ ok: true, values: field }, rest);
  // A key the note writes with no value (`[tags::[]]`) is there, as an empty list.
  if (keysOf(record).includes(key)) return finish({ ok: true, values: noteValues(record, key) }, rest);
  return fail(`no \`${first.key}\` on ${label === "this" ? "this note" : `\`${label}\``}`, [...keysOf(record), ...RECORD_KEYS], first.key);
}

/** `[n]` picks one value; `.count` counts them; anything else after a list of plain values is a problem. */
function finish(answer: Extract<PathAnswer, { ok: true }>, steps: ParsedPath["steps"]): PathAnswer {
  let current = answer;
  for (const step of steps) {
    if ("index" in step) {
      const at = current.values[step.index];
      current = { ok: true, values: at === undefined ? [] : [at], ...(current.lines && current.lines[step.index] !== undefined ? { lines: [current.lines[step.index]!] } : {}) };
    } else if (step.key.toLowerCase() === "count") current = { ok: true, values: [String(current.values.length)] };
    else return { ok: false, problem: { message: `a value has no \`${step.key}\`; a link value continues into its note once the service reads it`, didYouMean: [] } };
  }
  return current;
}

/** The scope walk's matcher for one property key: its values, wherever the text writes them. */
const matcherFor = (key: string): ContextKeyMatcher => ({
  propertyKey: key,
  keysIn: text => parsePropertyRecords(text).filter(r => r.key === key).map(r => ({ key: r.value, start: r.start, end: r.end })),
  keyFromProperty: value => value.trim() || null,
});

function bare(key: string, steps: ParsedPath["steps"], site: Site, scope: PathScope): PathAnswer {
  const here = site.this;
  if (!here) return { ok: false, problem: { message: `no note to look \`${key}\` up from; this run has no note`, didYouMean: [] } };
  const k = key.toLowerCase();
  const found = createContextResolver({ block: { id: here.id, text: here.text }, ancestors: scope.ancestors ?? [], matcher: matcherFor(k) }).resolve(scope.line ?? 0);
  // Two different values at the nearest level are a list: that level supplies them all.
  const raw = found.kind === "resolved" ? [found.key] : found.kind === "ambiguous" ? found.keys : [];
  if (!raw.length) {
    const nearby = [...keysOf(here), ...(scope.ancestors ?? []).flatMap(a => parsePropertyRecords(a.text).map(r => r.key))];
    return fail(`no \`${key}\` here or in its parents`, [...new Set(nearby)], key);
  }
  return finish({ ok: true, values: raw.flatMap(splitPropertyValue) }, steps);
}

/** `match.text`, `match.level`, `match[N]` (a text pattern's captures): what a rule matched. */
function matched(steps: ParsedPath["steps"], site: Site): PathAnswer {
  const m = site.match;
  if (!m) return { ok: false, problem: { message: "`match` is what a rule matched; only a rule's label has one", didYouMean: [] } };
  const [first, ...rest] = steps;
  if (!first) return { ok: true, values: [m.text] };
  if ("index" in first) return finish({ ok: true, values: [m.captures[first.index] ?? ""] }, rest);
  const key = first.key.toLowerCase();
  if (key === "text") return finish({ ok: true, values: [m.text] }, rest);
  if (key === "level") return finish({ ok: true, values: m.level === undefined ? [] : [String(m.level)] }, rest);
  return fail(`\`match\` has no \`${first.key}\``, ["text", "level"], first.key);
}

/** Resolve one path against a Site. */
export function resolvePath(path: string | ParsedPath, site: Site, scope: PathScope = {}): PathAnswer {
  const parsed = typeof path === "string" ? parsePath(path) : path;
  if (!parsed) return { ok: false, problem: { message: `\`${String(path)}\` isn't a path: write head.key, such as this.owner`, didYouMean: [] } };
  const { head, steps } = parsed;
  switch (head) {
    case "this": return site.this ? inRecord(site.this, steps, "this") : { ok: false, problem: { message: "this run has no note; pass at= or run it from a note", didYouMean: [] } };
    case "self": return site.self ? inRecord(site.self, steps, "self") : { ok: false, problem: { message: "there is no `self` here: only a script, template or component has one", didYouMean: [] } };
    case "parent": return scope.parent ? inRecord(scope.parent, steps, "parent") : { ok: false, problem: { message: "this note has no parent", didYouMean: [] } };
    case "props": {
      const [first, ...rest] = steps;
      if (!first || "index" in first) return { ok: false, problem: { message: "`props` needs a name: props.week", didYouMean: [] } };
      const values = Object.hasOwn(site.props, first.key) ? site.props[first.key] : undefined;
      if (values) return finish({ ok: true, values: [...values] }, rest);
      return fail(`no prop \`${first.key}\` was passed`, Object.keys(site.props), first.key);
    }
    case "match": return matched(steps, site);
    case "caller": case "now":
      return { ok: false, problem: { message: `\`${head}\` is answered by the service (the Site read)`, didYouMean: [] } };
    default:
      if (isReferenceHead(head)) return { ok: false, problem: { message: `\`${head}\` names another note; the service reads it (the Site read)`, didYouMean: [] } };
      return bare(head, steps, site, scope);
  }
}
