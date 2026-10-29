// `resolvePath(path, site, scope)` (PIE-533): the one pure resolver for a path like `this.owner`, `parent.project`,
// `props.week`, `this.fields.storyTime`, `((id)).query`, `person.firstName` or a bare `project`. The service, every
// client and every host call (a script's `resolve`, an extension's command, rule labels) read values through it; nobody walks a
// note's properties on their own.
//
// A path is `head(.key | [n] | ["dotted.key"])*`, optionally followed by a filter (`| status=todo`) and more steps.
//
// Heads:
//   this, parent, self   records (the note, its parent, the producer's definition)
//   props, match, caller the call's arguments, what a rule matched, where the call was written
//   now                  the clock: `now.date`, `now.week`, `now.time`, and `now.date-1d` / `now.date+7d`
//   ((id)) [[page]] PIE-1  another note, read through the world (below)
//   a bare key           the scope walk (scope-walk.ts): the line, then the note, then each ancestor, nearest first
//
// What the resolver can't read itself (another note, the clock, a query's matcher) it asks of a `PathWorld`: the
// service builds one over the store, a test builds one over a few records. So there is one resolver, in outline-core,
// and the service only supplies lookups. Pure: no I/O.
//
// Keys. A written property always wins over the record's own field of the same name (`[created::…]` and `[actor::…]`
// are Evan's properties, hundreds of them): `this.created` is the property when the note writes one, else the record's
// creation time. `this.$created` is always the record's field. A property key with a dot in it (`echo.node`) is
// `this.echo.node` (steps are joined back when the note has that key) or `this["echo.node"]`.
//
// Links. A value is a link when it is exactly one `((id))`, `[[page]]` or Work ID, when it contains exactly one
// `((id))` / `[[page]]`, or when it looks like an id (8 or more hex characters and dashes) and names exactly one
// note. A link continues the path into its note (`person.firstName`); a value that names no note, or more than one,
// stays plain text, silently, unless it was written as a `((id))` or `[[page]]` and a key was asked of it.
//
// Every answer carries its `route`: which head, which resolver answered, which fallback was taken ("the how matters").
import { valuesOf, type BlockRecord } from "./block-record";
import { stepClosed } from "./checklist-marks";
import { isoDay, readDateBound, wallClock } from "./dates";
import { blockReferenceOccurrences, pageLinkRanges } from "./link-syntax";
import { splitPropertyValue } from "./property-grammar";
import { parsePropertyRecords, stripProperties } from "./property-parse";
import { createContextResolver, type ContextBlock, type ContextKeyMatcher } from "./scope-walk";
import type { Site } from "./site";
import { closest } from "./tool-args";

/** One step after the head: `.key` (a quoted `["a.b"]` is a key too) or `[n]`. */
export type PathStep = { key: string } | { index: number };

/** A path, read: its head and the keys and indexes after it. */
export interface ParsedPath { head: string; steps: PathStep[] }

/** A note the world found for a reference. `how` says which resolver answered (the route shows it). */
export type NoteLookup =
  | { kind: "found"; record: BlockRecord; how: string }
  | { kind: "ambiguous"; matches: { id: string; title: string }[]; message: string }
  | { kind: "missing"; message: string; didYouMean: string[] }
  | { kind: "hidden"; message: string };

/** One row a filter reads: a note or a task, as the views' matcher sees it. */
export interface FilterRow { id?: string; text: string; properties: { key: string; value: string }[] }

/** What a path may ask of the service. */
export interface PathWorld {
  /** The clock, in epoch milliseconds. */
  now(): number;
  /**
   * The note a reference names. `reference`: it was written to be a note (`((id))`, `[[page]]`, a Work ID as a head), so
   * a miss is worth saying; `value`: it is a property's value that may be a link, so a miss is plain text.
   */
  note(ref: string, as: "reference" | "value"): NoteLookup;
  /** A note's children as records, in outline order (at most 200): read only when a path asks for `children`. */
  children?(id: string): BlockRecord[];
  /** Which of `rows` the views' query `filter` holds for, or why it can't be read. */
  filter?(rows: readonly FilterRow[], filter: string): { ok: true; keep: boolean[] } | { ok: false; message: string; didYouMean?: string[] };
}

/** Where the Site's own line sits: what a bare key's scope walk starts from. */
export interface PathScope {
  /** The line, as an index into `site.this`'s text, the walk starts at. Default: the first line. */
  line?: number;
  /** The note's ancestors, nearest (the parent) first. */
  ancestors?: readonly ContextBlock[];
  /** The note's parent as a record, for `parent.key` (a function: read only when a path says `parent`). */
  parent?: BlockRecord | (() => BlockRecord | undefined);
  /** The service's lookups: another note, the clock, a query's matcher. Without one, those heads say so. */
  world?: PathWorld;
}

/** What follows a path in a span: `| status=todo .count` is a filter, then steps. */
export interface PathTail { filter?: string; then?: PathStep[] }

/** Why a path has no answer, with the nearest keys and a path that works. */
export interface PathProblem { message: string; didYouMean: string[]; example?: string }

/** A value that is a link to a note, as the world found it. */
export interface ResolvedLink { text: string; id: string; title: string; how: string }

/**
 * The answer: every value (always a list), or why there is none. `route` says how: which head, which resolver
 * answered, which fallback was taken. It is on a problem too (how far the path got).
 */
export type PathAnswer =
  | {
    ok: true; values: string[];
    /** For `.fields.key`: the line each value was written on, and that line's text. */
    lines?: number[]; marks?: string[];
    /** For `.fields.key`: where each value's field starts in the note's text (to open the line lit). */
    offsets?: number[];
    /** The note the values were read from. */
    from?: string;
    /** The values that are links to a note (shown by the note's title). */
    links?: ResolvedLink[];
    /** The answer depends on the clock alone (`now.time`): a watch of it needs the minute's tick. */
    clock?: "minute";
    route: string[];
  }
  | { ok: false; problem: PathProblem; route: string[] };

type Failed = Extract<PathAnswer, { ok: false }>;

/** A head: a name or a Work ID such as `PIE-533`; a link head (`((id))`, `[[page]]`) is the link grammar's (`linkTokens`). */
const HEAD = /^(?:[A-Z][A-Z0-9]*-\d+(?![\w-])|[A-Za-z_][\w-]*)/;
const KEY_STEP = /^\.([A-Za-z_$][\w+-]*)/;
const QUOTED_STEP = /^\[(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\]/;
const INDEX_STEP = /^\[(\d+)\]/;

/** Whether a head names another note, which only the world can read. */
export const isReferenceHead = (head: string): boolean => /^(?:\(\(|\[\[|[A-Z][A-Z0-9]*-\d+$)/.test(head);

/** Steps from `.a[0]["b.c"]` text, or null when the text isn't only steps. */
export function parseSteps(text: string): PathStep[] | null {
  const steps: PathStep[] = [];
  let rest = text.trim();
  while (rest) {
    const key = KEY_STEP.exec(rest), quoted = QUOTED_STEP.exec(rest), index = INDEX_STEP.exec(rest);
    if (key) { steps.push({ key: key[1]! }); rest = rest.slice(key[0].length); }
    else if (quoted) { steps.push({ key: (quoted[1] ?? quoted[2])!.replace(/\\(.)/g, "$1") }); rest = rest.slice(quoted[0].length); }
    else if (index) { steps.push({ index: Number(index[1]) }); rest = rest.slice(index[0].length); }
    else return null;
  }
  return steps;
}

/** `this.tasks[0].title` → head `this`, steps. Null when the text isn't a path. */
export function parsePath(path: string): ParsedPath | null {
  const text = path.trim();
  const link = linkTokens(text)[0];
  const head = link?.start === 0 ? text.slice(0, link.end) : HEAD.exec(text)?.[0];
  if (!head) return null;
  const steps = parseSteps(text.slice(head.length));
  return steps ? { head, steps } : null;
}

/**
 * What a span's text after `|` holds: the query atoms, then optionally more steps (`status=todo .count`). The steps are
 * the trailing whitespace-separated `.key` / `[n]` words.
 */
export function splitTail(text: string): PathTail {
  const m = /(?:^|\s)((?:\.[A-Za-z_$][\w-]*|\[\d+\])(?:\s*(?:\.[A-Za-z_$][\w-]*|\[\d+\]))*)\s*$/.exec(text);
  const then = m ? parseSteps(m[1]!.replace(/\s+/g, "")) : null;
  const filter = (m && then ? text.slice(0, m.index) : text).trim();
  return { ...(filter ? { filter } : {}), ...(then?.length ? { then } : {}) };
}

// --- problems ---

const problem = (message: string, route: string[], didYouMean: string[] = [], example?: string): Failed =>
  ({ ok: false, problem: { message, didYouMean, ...(example ? { example } : {}) }, route });

const fail = (message: string, candidates: readonly string[], asked: string, route: string[], example?: (near: string) => string): Failed => {
  const near = closest(asked, candidates);
  return problem(near ? `${message}; did you mean \`${near}\`?` : message, route, near ? [near] : [], near && example ? example(near) : undefined);
};

/** The record's own fields a path can name besides a property. */
export const RECORD_KEYS = ["id", "parent", "title", "body", "text", "children", "tasks", "created", "updated", "author", "actor", "revision"] as const;

// --- the cursor: what a path has reached ---

type TaskRow = BlockRecord["tasks"][number];
type Cursor =
  | { kind: "values"; values: string[]; lines?: number[]; marks?: string[]; offsets?: number[]; from?: string }
  | { kind: "notes"; notes: BlockRecord[]; list: boolean; /** How the note was reached (`this`), for messages. */ label?: string }
  | { kind: "tasks"; tasks: TaskRow[]; list: boolean; of: BlockRecord };

interface Cx { site: Site; scope: PathScope; route: string[]; tail?: PathTail; budget: { left: number }; clock?: { minute: boolean } }

/** At most this many notes one path reads (a list of children, the notes a link value follows, each step of it). */
const MAX_NOTES = 1000;
/** At most this many notes one path visits in all, however it branches. */
const MAX_VISITS = 5000;
type Stepped = { cursor: Cursor; next: number } | { failed: Failed };

const keysOf = (record: BlockRecord) => [...new Set([...record.properties.map(p => p.key), ...record.fields.map(f => f.key)])];

/**
 * Every value of `key` on a note: block scope first (front matter, header chips, hashtags: what queries match), then each
 * occurrence in the note's fields (line and inline) in document order. A value is what the list rule says one is
 * (`splitPropertyValue`: a plain value's commas are part of it, `[a, b]` is two). `valuesOf` (block-record.ts) is the
 * block-scope half; this adds the fields. Two names, two jobs.
 */
export function noteValues(record: BlockRecord, key: string): string[] {
  const k = key.toLowerCase();
  return [...valuesOf(record, k), ...record.fields.filter(f => f.key === k && f.scope !== "block").flatMap(f => splitPropertyValue(f.value))];
}

const titleOf = (r: BlockRecord) => r.title || r.id;
const short = (id: string) => id.slice(0, 8);

// --- links ---

/** The block references and outermost page links in `text`, by outline-core's link grammar, in order. */
function linkTokens(text: string): { start: number; end: number }[] {
  return [...blockReferenceOccurrences(text, []), ...pageLinkRanges(text)].sort((a, b) => a.start - b.start);
}
const WORK_ID = /^[A-Z][A-Z0-9]*-\d+$/;
/** 8 or more hex characters and dashes: the shortest id prefix the service resolves. */
const ID_LIKE = /^[0-9a-f][0-9a-f-]{7,}$/i;

/** The reference a value is, contains or looks like; null when it isn't one. `written`: it was written as a link. */
export function linkTokenOf(value: string): { token: string; written: boolean } | null {
  const v = value.trim();
  if (WORK_ID.test(v) || ID_LIKE.test(v)) return { token: v, written: false };
  const tokens = linkTokens(v);
  return tokens.length === 1 ? { token: v.slice(tokens[0]!.start, tokens[0]!.end), written: true } : null;
}

/** The notes a list of values names, and why the others weren't. */
function followValues(values: readonly string[], cx: Cx): { notes: BlockRecord[]; misses: string[] } {
  const world = cx.scope.world;
  const notes: BlockRecord[] = [], misses: string[] = [];
  for (const value of values) {
    const link = world ? linkTokenOf(value) : null;
    if (!link) { misses.push(`\`${value}\` is text, not a note`); continue; }
    const found = world!.note(link.token, link.written ? "reference" : "value");
    if (found.kind === "found") {
      if (!notes.some(n => n.id === found.record.id)) notes.push(found.record);
      cx.route.push(`link ${value} → ((${short(found.record.id)})) by ${found.how}`);
    } else if (found.kind === "ambiguous" || found.kind === "hidden") misses.push(found.message);
    else misses.push(link.written ? found.message : `\`${value}\` names no note`);
  }
  return { notes, misses };
}

// --- records ---

/** A cursor for a record's own field, `tooMany` when it holds more notes than a path reads, or null when the record has none by that name. */
function recordField(record: BlockRecord, key: string, cx: Cx): Cursor | { tooMany: true } | null {
  switch (key) {
    case "id": case "title": case "body": case "text": case "created": case "updated": case "author": case "revision":
      return { kind: "values", values: [String(record[key])], from: record.id };
    case "parent": return { kind: "values", values: record.parent ? [record.parent] : [], from: record.id };
    case "subtitle": return { kind: "values", values: record.subtitle ? [record.subtitle] : [], from: record.id };
    case "actor": return { kind: "values", values: record.actor ? [record.actor] : [], from: record.id };
    case "tasks": return { kind: "tasks", tasks: record.tasks, list: true, of: record };
    case "children": {
      const world = cx.scope.world;
      if (!world?.children) return { kind: "values", values: [...record.children], from: record.id };
      const notes = world.children(record.id);
      return notes.length > MAX_NOTES ? { tooMany: true } : { kind: "notes", notes, list: true };
    }
  }
  return null;
}

/** The longest run of key steps from `i` that, joined with dots, is one of `keys` (case-insensitive): `echo.node`. */
function joinedKey(steps: readonly PathStep[], i: number, keys: readonly string[]): { key: string; used: number } | null {
  let run = 0;
  while (i + run < steps.length && "key" in steps[i + run]!) run += 1;
  const have = new Set(keys.map(k => k.toLowerCase()));
  for (let n = run; n >= 1; n -= 1) {
    const key = steps.slice(i, i + n).map(s => (s as { key: string }).key).join(".").toLowerCase();
    if (have.has(key)) return { key, used: n };
  }
  return null;
}

const tooManyChildren = (label: string, cx: Cx): Failed =>
  problem(`${label === "this" ? "this note" : `\`${label}\``} has more than ${MAX_NOTES} children; a path reads at most ${MAX_NOTES}. Ask a question instead: a query such as parent:this, with a filter`, cx.route, [], "where: parent:this type=task");

const NAME = (label: string) => (label === "this" ? "this note" : `\`${label}\``);

/** One step into one record. */
function inRecord(record: BlockRecord, steps: readonly PathStep[], i: number, label: string, cx: Cx): Stepped {
  const first = steps[i];
  if (!first) return { cursor: { kind: "values", values: [titleOf(record)], from: record.id }, next: i };
  if ("index" in first) return { failed: problem(`\`${label}\` is a note, not a list`, cx.route) };
  const keys = keysOf(record);
  const lower = first.key.toLowerCase();

  // `block.key`: block scope alone. `fields.key`: each occurrence with its line.
  if (lower === "block" || lower === "fields") {
    const next = steps[i + 1];
    if (!next || "index" in next) {
      return { failed: problem(`\`${label}.${lower}\` needs a key after it: \`${label}.${lower}.${keys[0] ?? "key"}\``, cx.route, [], `{{${label}.${lower}.${keys[0] ?? "key"}}}`) };
    }
    const joined = joinedKey(steps, i + 1, keys) ?? { key: next.key.toLowerCase(), used: 1 };
    if (lower === "block") {
      cx.route.push(`${label}.block.${joined.key}: block scope (what queries match)`);
      return { cursor: { kind: "values", values: valuesOf(record, joined.key), from: record.id }, next: i + 1 + joined.used };
    }
    const found = record.fields.filter(f => f.key === joined.key).flatMap(f => splitPropertyValue(f.value).map(value => ({ value, line: f.line, offset: f.offset })));
    const lines = record.text.split("\n");
    cx.route.push(`${label}.fields.${joined.key}: each occurrence with its line`);
    return {
      cursor: { kind: "values", values: found.map(f => f.value), lines: found.map(f => f.line), marks: found.map(f => lines[f.line] ?? ""), offsets: found.map(f => f.offset), from: record.id },
      next: i + 1 + joined.used,
    };
  }

  // `$created`: the record's own field, whatever properties the note writes.
  if (first.key.startsWith("$")) {
    const name = first.key.slice(1).toLowerCase();
    const field = recordField(record, name, cx);
    if (field && "tooMany" in field) return { failed: tooManyChildren(label, cx) };
    if (field) { cx.route.push(`${label}.$${name}: the record's own field`); return { cursor: field, next: i + 1 }; }
    return { failed: fail(`${NAME(label)} has no record field \`${first.key}\``, RECORD_KEYS.map(k => `$${k}`), first.key, cx.route, near => `{{${label}.${near}}}`) };
  }

  // A property the note writes wins over a record field of the same name; dotted keys are joined back.
  const property = joinedKey(steps, i, keys);
  if (property) {
    cx.route.push(`${label}.${property.key}: ${valuesOf(record, property.key).length ? "block scope, then each occurrence in the text" : "each occurrence in the text"}`);
    return { cursor: { kind: "values", values: noteValues(record, property.key), from: record.id }, next: i + property.used };
  }
  const field = recordField(record, lower, cx);
  if (field && "tooMany" in field) return { failed: tooManyChildren(label, cx) };
  if (field) {
    cx.route.push(`${label}.${lower}: the record's field (the note writes no \`${lower}\` property; \`$${lower}\` always means the field)`);
    return { cursor: field, next: i + 1 };
  }
  // `this.echo.node` when the key is `echo.node`: a prefix of dotted keys names them.
  const dotted = keys.filter(k => k.startsWith(`${lower}.`));
  if (dotted.length) {
    return { failed: problem(`no \`${first.key}\` on ${NAME(label)}, but it has ${dotted.map(k => `\`${k}\``).join(", ")}; write ${label}.${dotted[0]} or ${label}["${dotted[0]}"]`, cx.route, dotted, `{{${label}.${dotted[0]}}}`) };
  }
  return { failed: fail(`no \`${first.key}\` on ${NAME(label)}`, [...keys, ...RECORD_KEYS], first.key, cx.route, near => `{{${label}.${near}}}`) };
}

// --- tasks ---

/** A task's text without its chips (the parser's own stripping: a chip may hold a `[[link]]` or a list). */
const taskText = (t: TaskRow) => stripProperties(t.text);

/**
 * A task as a row the views' matcher reads: its chips, `status` (the chip when it has one, else the box), `box` (the
 * box itself: todo, done, waiting, problem, approved, rejected) and `state` (`done` when the box is closed, else `open`).
 * Only 2 of 105 checkbox lines in a real outline carry a status chip: the box has to count.
 */
export function taskRow(task: TaskRow, of: BlockRecord): FilterRow {
  const chips = parsePropertyRecords(task.text).map(p => ({ key: p.key, value: p.value }));
  const synthetic = [
    ...(chips.some(c => c.key === "status") ? [] : [{ key: "status", value: task.status }]),
    { key: "box", value: task.status },
    { key: "state", value: stepClosed(task.status) ? "done" : "open" },
  ];
  return { text: task.text, properties: [...chips, ...synthetic], ...(task.id ? { id: `${of.id}^${task.id}` } : {}) };
}

/** A step into tasks: each one's text, box, line, id or a chip. */
function inTask(tasks: readonly TaskRow[], of: BlockRecord, steps: readonly PathStep[], i: number, cx: Cx): Stepped {
  const first = steps[i];
  if (!first || "index" in first) return { failed: problem("a task needs a key: text, status, box, state, line or a chip such as owner", cx.route, [], "{{this.tasks.text}}") };
  const key = first.key.toLowerCase();
  const rows = tasks.map(t => taskRow(t, of));
  const chips = [...new Set(rows.flatMap(r => r.properties.map(p => p.key)))];
  if (!["text", "line", "id"].includes(key) && !chips.includes(key)) {
    return { failed: fail(`no task has \`${first.key}\``, ["text", "line", "id", ...chips], first.key, cx.route, near => `{{this.tasks.${near}}}`) };
  }
  const values = key === "text" ? tasks.map(taskText)
    : key === "line" ? tasks.map(t => String(t.line))
    : key === "id" ? tasks.flatMap(t => t.id ? [t.id] : [])
    : rows.flatMap(r => r.properties.filter(p => p.key === key).map(p => p.value));
  cx.route.push(`tasks.${key}: read from the checkbox lines`);
  return { cursor: { kind: "values", values, from: of.id }, next: i + 1 };
}

// --- the clock ---

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NOW_KEY = /^(date|week|time|iso|year|month|day|weekday)(?:([+-]\d{1,6}[dwhm]))?$/i;
const pad = (n: number) => String(n).padStart(2, "0");

/** The ISO week and its year, `2026-W42`. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

function nowAnswer(steps: readonly PathStep[], cx: Cx): PathAnswer {
  const world = cx.scope.world;
  if (!world) return problem("`now` is the service's clock; this read has none", cx.route);
  const first = steps[0];
  const wall = wallClock(world.now());
  cx.route.push(`now: the host's clock (${new Date(world.now()).toISOString()}) in the host's time zone`);
  if (!first || "index" in first) return problem("`now` needs a part: now.date, now.week, now.time, or now.date-1d", cx.route, [], "{{now.date}}");
  const m = NOW_KEY.exec(first.key);
  if (!m) return fail(`\`now\` has no \`${first.key}\``, ["date", "week", "time", "iso", "year", "month", "day", "weekday"], first.key, cx.route, near => `{{now.${near}}}`);
  let at = wall;
  // Every clock part can roll over without an outline change.
  cx.clock = { minute: true };
  if (m[2]) {
    const bound = readDateBound(m[2], wall);
    if (!bound) return problem(`\`${m[2]}\` isn't an offset: write -1d, +7d, -2w, -3h or -30m`, cx.route, [], "{{now.date-1d}}");
    at = bound.from;
    cx.route.push(`offset ${m[2]} (whole calendar days for d and w, an instant for h and m)`);
  }
  const d = new Date(at);
  const part = m[1]!.toLowerCase();
  const day = isoDay({ from: at, to: at });
  const text = part === "date" ? day
    : part === "week" ? isoWeek(d)
    : part === "time" ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    : part === "iso" ? `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    : part === "year" ? String(d.getUTCFullYear())
    : part === "month" ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
    : part === "day" ? String(d.getUTCDate())
    : WEEKDAYS[d.getUTCDay()]!;
  return finish({ kind: "values", values: [text] }, steps, 1, cx);
}

// --- caller, match, props ---

function callerAnswer(steps: readonly PathStep[], cx: Cx): PathAnswer {
  const caller = cx.site.caller;
  if (!caller) return problem("there is no `caller` here: only a template, script or component is called from a line", cx.route);
  cx.route.push(`caller: the line that invoked this, in ((${short(caller.block)}))`);
  const first = steps[0];
  if (!first) return finish({ kind: "values", values: [caller.mark ?? caller.block], from: caller.block }, steps, 0, cx);
  if ("index" in first) return problem("`caller` is a place, not a list", cx.route);
  const key = first.key.toLowerCase();
  const own: Record<string, string | undefined> = {
    block: caller.block, anchor: caller.anchor, mark: caller.mark, page: caller.page,
    line: caller.line === undefined ? undefined : String(caller.line),
  };
  if (key in own) return finish({ kind: "values", values: own[key] === undefined ? [] : [own[key]!], from: caller.block }, steps, 1, cx);
  const found = cx.scope.world?.note(caller.block, "reference");
  if (found?.kind === "found") return finish({ kind: "notes", notes: [found.record], list: false }, steps, 0, cx);
  return fail(`\`caller\` has no \`${first.key}\``, ["block", "anchor", "mark", "line", "page"], first.key, cx.route, near => `{{caller.${near}}}`);
}

/** `match.text`, `match.level`, `match[N]` (a text pattern's captures): what a rule matched. */
function matched(steps: readonly PathStep[], cx: Cx): PathAnswer {
  const m = cx.site.match;
  if (!m) return problem("`match` is what a rule matched; only a rule's label has one", cx.route);
  const [first] = steps;
  cx.route.push("match: what the rule matched");
  if (!first) return finish({ kind: "values", values: [m.text] }, steps, 0, cx);
  if ("index" in first) return finish({ kind: "values", values: [m.captures[first.index] ?? ""] }, steps, 1, cx);
  const key = first.key.toLowerCase();
  if (key === "text") return finish({ kind: "values", values: [m.text] }, steps, 1, cx);
  if (key === "level") return finish({ kind: "values", values: m.level === undefined ? [] : [String(m.level)] }, steps, 1, cx);
  return fail(`\`match\` has no \`${first.key}\``, ["text", "level"], first.key, cx.route, near => `{{match.${near}}}`);
}

function propsAnswer(steps: readonly PathStep[], cx: Cx): PathAnswer {
  const props = cx.site.props;
  const first = steps[0];
  if (!first || "index" in first) return problem("`props` needs a name: props.week", cx.route, [], "{{props.week}}");
  const names = Object.keys(props);
  const joined = joinedKey(steps, 0, names);
  if (joined) {
    const original = names.find(n => n.toLowerCase() === joined.key)!;
    cx.route.push(`props.${original}: the call's argument`);
    return finish({ kind: "values", values: [...props[original]!] }, steps, joined.used, cx);
  }
  return fail(`no prop \`${first.key}\` was passed`, names, first.key, cx.route, near => `{{props.${near}}}`);
}

// --- the bare key ---

/** The scope walk's matcher for one property key: its values, wherever the text writes them. */
const matcherFor = (key: string): ContextKeyMatcher => ({
  propertyKey: key,
  keysIn: text => parsePropertyRecords(text).filter(r => r.key === key).map(r => ({ key: r.value, start: r.start, end: r.end })),
  keyFromProperty: value => value.trim() || null,
});

function bare(head: string, steps: readonly PathStep[], cx: Cx): PathAnswer {
  const { site, scope } = cx;
  const here = site.this;
  if (!here) return problem(`no note to look \`${head}\` up from; this run has no note`, cx.route);
  const ancestors = scope.ancestors ?? [];
  // `margin.x` is one key when the walk finds a value for it; otherwise `margin` and a step.
  let run = 0;
  while (run < steps.length && "key" in steps[run]!) run += 1;
  for (let used = run; used >= 0; used -= 1) {
    const key = [head, ...steps.slice(0, used).map(s => (s as { key: string }).key)].join(".").toLowerCase();
    const found = createContextResolver({ block: { id: here.id, text: here.text }, ancestors, matcher: matcherFor(key) }).resolve(scope.line ?? 0);
    // Two different values at the nearest level are a list: that level supplies them all.
    const raw = found.kind === "resolved" ? [found.key] : found.kind === "ambiguous" ? found.keys : [];
    if (found.kind === "none" || !raw.length) continue;
    const at = found.site;
    cx.route.push(`bare \`${key}\`: scope walk, nearest first → ${at.step} of ((${short(at.blockId)})), line ${at.line}`);
    return finish({ kind: "values", values: raw.flatMap(splitPropertyValue), from: at.blockId }, steps, used, cx);
  }
  const key = head.toLowerCase();
  cx.route.push("bare key: the scope walk found nothing (the line, this note, each ancestor's header)");
  // A key written lower in an ancestor isn't what a bare key reads (only the header and the lines after it): say where it is.
  const deeper = ancestors.find(a => parsePropertyRecords(a.text).some(r => r.key === key));
  if (deeper) return problem(`no \`${head}\` in the header of this note or its parents; it is written lower in ((${short(deeper.id)})), which a bare key doesn't read: ask for it with ((${short(deeper.id)})).${head}`, cx.route, [], `{{((${short(deeper.id)})).${head}}}`);
  const nearby = [...keysOf(here), ...ancestors.flatMap(a => parsePropertyRecords(a.text).map(r => r.key))];
  return fail(`no \`${head}\` here or in its parents`, [...new Set(nearby)], head, cx.route, near => `{{${near}}}`);
}

// --- walking the steps ---

const sizeOf = (c: Cursor) => (c.kind === "values" ? c.values.length : c.kind === "notes" ? c.notes.length : c.tasks.length);

function pick(c: Cursor, index: number): Cursor {
  if (c.kind === "values") {
    const at = c.values[index];
    return {
      kind: "values", values: at === undefined ? [] : [at], ...(c.from ? { from: c.from } : {}),
      ...(c.lines?.[index] !== undefined ? { lines: [c.lines[index]!] } : {}), ...(c.marks?.[index] !== undefined ? { marks: [c.marks[index]!] } : {}),
      ...(c.offsets?.[index] !== undefined ? { offsets: [c.offsets[index]!] } : {}),
    };
  }
  if (c.kind === "notes") return { kind: "notes", notes: c.notes[index] ? [c.notes[index]!] : [], list: false };
  return { kind: "tasks", tasks: c.tasks[index] ? [c.tasks[index]!] : [], list: false, of: c.of };
}

/** The answers of several notes, one cursor: notes joined (each once), tasks joined, otherwise their values. */
function join(cursors: readonly Cursor[]): { cursor: Cursor } | { failed: string } {
  const first = cursors[0]!;
  if (cursors.every(c => c.kind === "notes")) {
    const notes: BlockRecord[] = [];
    for (const c of cursors) for (const n of (c as Extract<Cursor, { kind: "notes" }>).notes) if (!notes.some(m => m.id === n.id)) notes.push(n);
    return notes.length > MAX_NOTES ? { failed: `that is ${notes.length} notes; a path reads at most ${MAX_NOTES}: narrow it with a filter` } : { cursor: { kind: "notes", notes, list: true } };
  }
  if (cursors.every(c => c.kind === "tasks")) {
    const tasks = cursors.flatMap(c => (c as Extract<Cursor, { kind: "tasks" }>).tasks);
    return { cursor: { kind: "tasks", tasks, list: true, of: (first as Extract<Cursor, { kind: "tasks" }>).of } };
  }
  return { cursor: { kind: "values", values: cursors.flatMap(valuesOfCursor) } };
}

/** Run `steps` from `from` over a cursor. */
function walk(start: Cursor, steps: readonly PathStep[], from: number, cx: Cx): { cursor: Cursor } | { failed: Failed } {
  let cursor = start, i = from;
  while (i < steps.length) {
    const step = steps[i]!;
    const isList = cursor.kind === "values" || cursor.list;
    if (isList && "index" in step) { cursor = pick(cursor, step.index); i += 1; continue; }
    // A list counts; a single note's `count` is a key like any other.
    if (isList && "key" in step && step.key.toLowerCase() === "count") { cursor = { kind: "values", values: [String(sizeOf(cursor))] }; i += 1; continue; }
    if (cursor.kind === "values") {
      if ("index" in step) return { failed: problem("a value has no index; this isn't a list", cx.route) };
      const { notes, misses } = followValues(cursor.values, cx);
      if (!notes.length) {
        const first = cursor.values[0];
        const shown = first !== undefined && first.length > 60 ? `${first.slice(0, 57)}...` : first;
        return { failed: problem(shown === undefined
          ? `there is no value to read \`${step.key}\` from`
          : `\`${shown}\` is a value, not a note, so it has no \`${step.key}\` (${misses[0] ?? "it names no note"}); a link value ([[page]], ((id)) or an id that names one note) continues into its note`,
        cx.route, [], "{{person.firstName}} with [person::[[evan schultz]]]") };
      }
      cursor = { kind: "notes", notes, list: notes.length > 1 };
      continue;
    }
    if (cursor.kind === "notes" && cursor.notes.length !== 1) {
      // Each note finishes the rest of the path on its own, then the answers are joined: one with a different shape
      // (a link where another has a name) can't turn another's steps into nonsense.
      if (!cursor.notes.length) { cursor = { kind: "values", values: [] }; break; }
      if ((cx.budget.left -= cursor.notes.length) < 0) return { failed: problem(`this path reads more than ${MAX_VISITS} notes; narrow the list with a filter first`, cx.route, [], "{{this.children | type=task .count}}") };
      const each = cursor.notes.map(n => walk({ kind: "notes", notes: [n], list: false, label: short(n.id) }, steps, i, { ...cx, route: [] }));
      const good = each.filter((e): e is { cursor: Cursor } => "cursor" in e);
      if (!good.length) return each[0] as { failed: Failed };
      cx.route.push(`${cursor.notes.length} notes: ${good.length} have it`);
      const joined = join(good.map(g => g.cursor));
      if ("failed" in joined) return { failed: problem(joined.failed, cx.route) };
      cursor = joined.cursor;
      break;
    }
    const stepped = cursor.kind === "notes" ? inRecord(cursor.notes[0]!, steps, i, cursor.label ?? short(cursor.notes[0]!.id), cx) : inTask(cursor.tasks, cursor.of, steps, i, cx);
    if ("failed" in stepped) return stepped;
    cursor = stepped.cursor; i = stepped.next;
  }
  return { cursor };
}

/** A cursor's final values: values themselves, notes by title, tasks by text. */
function valuesOfCursor(c: Cursor): string[] {
  return c.kind === "values" ? c.values : c.kind === "notes" ? c.notes.map(titleOf) : c.tasks.map(taskText);
}

/** Walk the rest of the steps, then the span's filter and the steps after it, and write the answer. */
function finish(start: Cursor, steps: readonly PathStep[], from: number, cx: Cx): PathAnswer {
  const { tail } = cx;
  let reached = walk(start, steps, from, cx);
  if ("failed" in reached) return reached.failed;
  let cursor = reached.cursor;

  if (tail?.filter) {
    const world = cx.scope.world;
    if (cursor.kind === "values") return problem("a filter works on a list of notes or tasks (this.tasks, this.children), not on plain values", cx.route, [], "{{this.tasks | status=todo}}");
    if (!world?.filter) return problem("a filter needs the service's query matcher; this read has none", cx.route);
    const rows = cursor.kind === "notes"
      ? cursor.notes.map((n): FilterRow => ({ id: n.id, text: n.text, properties: n.properties.flatMap(p => p.values.map(value => ({ key: p.key, value }))) }))
      : cursor.tasks.map(t => taskRow(t, cursor.kind === "tasks" ? cursor.of : (undefined as never)));
    const kept = world.filter(rows, tail.filter);
    if (!kept.ok) return problem(kept.message.replace("{rows}", cursor.kind === "tasks" ? "tasks" : "notes"), cx.route, kept.didYouMean ?? [], "{{this.tasks | status=todo}}");
    cx.route.push(`filter \`${tail.filter}\`: ${kept.keep.filter(Boolean).length} of ${rows.length} kept (the views' query grammar)`);
    cursor = cursor.kind === "notes"
      ? { kind: "notes", notes: cursor.notes.filter((_, n) => kept.keep[n]), list: true }
      : { kind: "tasks", tasks: cursor.tasks.filter((_, n) => kept.keep[n]), list: true, of: cursor.of };
  }
  if (tail?.then) {
    reached = walk(cursor, tail.then, 0, cx);
    if ("failed" in reached) return reached.failed;
    cursor = reached.cursor;
  }

  const values = valuesOfCursor(cursor);
  const out: Extract<PathAnswer, { ok: true }> = { ok: true, values, route: cx.route, ...(cx.clock?.minute ? { clock: "minute" as const } : {}) };
  if (cursor.kind === "values") {
    if (cursor.lines) out.lines = cursor.lines;
    if (cursor.marks) out.marks = cursor.marks;
    if (cursor.offsets) out.offsets = cursor.offsets;
    if (cursor.from) out.from = cursor.from;
    // Values that are links to a note are shown by its title, and a client may open them.
    const world = cx.scope.world;
    if (world) {
      const links: ResolvedLink[] = [];
      for (const value of values) {
        const link = linkTokenOf(value);
        if (!link) continue;
        const found = world.note(link.token, link.written ? "reference" : "value");
        if (found.kind === "found") links.push({ text: value, id: found.record.id, title: titleOf(found.record), how: found.how });
      }
      if (links.length) out.links = links;
    }
  } else if (cursor.kind === "notes" && cursor.notes.length === 1) out.from = cursor.notes[0]!.id;
  return out;
}

// --- reference heads ---

function referenceHead(head: string, steps: readonly PathStep[], cx: Cx): PathAnswer {
  const world = cx.scope.world;
  if (!world) return problem(`\`${head}\` names another note; the service reads it (this read has no service)`, cx.route);
  const found = world.note(head, "reference");
  if (found.kind === "found") {
    cx.route.push(`${head} → ((${short(found.record.id)})) by ${found.how}`);
    return finish({ kind: "notes", notes: [found.record], list: false }, steps, 0, cx);
  }
  if (found.kind === "ambiguous") {
    cx.route.push(`${head}: more than one note`);
    return problem(found.message, cx.route, found.matches.map(m => m.id));
  }
  cx.route.push(`${head}: ${found.kind}`);
  return problem(found.message, cx.route, found.kind === "missing" ? found.didYouMean : []);
}

/** Resolve one path against a Site, then the span's `tail` (a filter, and steps after it). */
export function resolvePath(path: string | ParsedPath, site: Site, scope: PathScope = {}, tail?: PathTail): PathAnswer {
  const parsed = typeof path === "string" ? parsePath(path) : path;
  const route: string[] = [];
  if (!parsed) return problem(`\`${String(typeof path === "string" ? path : path.head)}\` isn't a path: write head.key, such as this.owner`, route, [], "{{this.owner}}");
  const { head, steps } = parsed;
  const cx: Cx = { site, scope, route, budget: { left: MAX_VISITS }, ...(tail ? { tail } : {}) };
  const record = (r: BlockRecord | undefined, label: string, why: string, missing: string): PathAnswer => {
    if (!r) return problem(missing, route);
    route.push(`${label}: ${why}`);
    return finish({ kind: "notes", notes: [r], list: false, label }, steps, 0, cx);
  };
  switch (head) {
    case "this": return record(site.this, "this", "the note the producer sits in", "this run has no note; pass at= or run it from a note");
    case "self": return record(site.self, "self", "the producer's definition", "there is no `self` here: only a script, template or component has one");
    case "parent": return record(typeof scope.parent === "function" ? scope.parent() : scope.parent, "parent", "the note's parent", "this note has no parent");
    case "props": return propsAnswer(steps, cx);
    case "match": return matched(steps, cx);
    case "caller": return callerAnswer(steps, cx);
    case "now": return nowAnswer(steps, cx);
    default:
      return isReferenceHead(head) ? referenceHead(head, steps, cx) : bare(head, steps, cx);
  }
}
