// A block as a record (PIE-534, for PIE-533): one shape for "everything the outline knows about this note", which the
// service builds (`blocks.records`) and every consumer reads: `ep0ch find --json`, `ep0ch export`, and later
// interpolation, `::graph-*`, extensions and publishing. This file is the shape and its one builder; the service passes
// what it read (the block, its parsed properties, children, tasks, links, backlinks, resources) and nothing here reads
// anything. `recordJson` writes it deterministically: sorted keys, one timestamp format (ISO 8601, UTC, milliseconds).
import { splitPropertyValue } from "./property-grammar";
import type { PropertyScope } from "./property-parse";
import { bodyOffset, headerLine, type LiteralRange } from "./header-line";

export type TaskStatus = import("./checklist-marks").ChecklistStatus;
export type { PropertyScope } from "./property-parse";

/** A block as a record. */
export interface BlockRecord {
  id: string;
  /** The parent's id; null at the top of the outline. */
  parent: string | null;
  /** The service's title (the first line without its properties). */
  title: string;
  /** The header line's chips (header-line.ts), in order, keys as written: what a Markdown export puts in front matter. */
  header: { key: string; value: string }[];
  /** The text without its header chips: the header line's prose, then the rest verbatim. */
  body: string;
  /** The text exactly as stored. */
  text: string;
  /** Block-scope properties (what queries and views match), each key once with its values in order, keys in order. */
  properties: { key: string; values: string[] }[];
  /**
   * Properties of a line or a spot in it (`key:: value` lines, `[key::value]` mid-sentence), in order: `line` and
   * `column` where the token starts, `offset` its offset in `text`.
   */
  fields: { key: string; value: string; scope: "line" | "inline"; line: number; column: number; offset: number }[];
  /** The children's ids, in outline order. */
  children: string[];
  /** The checklist's items, in order. */
  tasks: { status: TaskStatus; text: string; line: number; id: string | null }[];
  /**
   * Links out (`((id))`, `[[page]]`, work ids), each target once, in order: as first written, its label, where it
   * points, and every place it's written: `spans`, [start, end) offsets in `text`; `bodySpans`, the same in `body` (a
   * link inside a header chip isn't in the body). Then `property` links: a property whose value is a block's id
   * (`[source-block::<id>]`, its `key`), which the backlink relation counts too, for a target the text doesn't link.
   */
  links: {
    kind: "block" | "page" | "work-id" | "property"; key?: string; text: string; label: string; target: string | null; status: string;
    spans: [number, number][]; bodySpans: [number, number][];
  }[];
  /** The ids of the active blocks that link here, sorted (so a record doesn't change when one of them moves). */
  backlinks: string[];
  /** Resources the text names (files, web pages, tickets), each once, in order. */
  resources: { text: string; label: string; provider: string | null; resource: string | null; status: string }[];
  created: string;
  updated: string;
  /** user, agent or system. */
  author: string;
  /** The agent's or extension's id, when the service recorded one. */
  actor: string | null;
  revision: number;
  /** What was cut short at the service's limits: "links", "resources". Absent when nothing was. */
  truncated?: string[];
}

/** What the service read for one block, to build its record from. */
export interface BlockRecordInput {
  block: {
    id: string; parentId: string | null; text: string; revision: number;
    author: string; actorId?: string; createdAt: string; updatedAt: string;
  };
  title: string;
  /** The service's parse of the text, in order. */
  properties: readonly { key: string; value: string; scope: PropertyScope; line: number; column: number; start: number }[];
  /** The text's literal ranges (code spans, fences), so a token in one isn't read as a header chip. */
  literal: readonly LiteralRange[];
  children: readonly string[];
  tasks: BlockRecord["tasks"];
  links: Omit<BlockRecord["links"][number], "bodySpans">[];
  backlinks: readonly string[];
  resources: BlockRecord["resources"];
  truncated?: readonly string[];
}

/**
 * Properties as a record holds them: each key once with its values in order (a repeat adds to the list, a value
 * is split by the list rule), keys in order of first appearance. The one grouping: the record, a wire block's
 * `properties` and an extension's `context.block` all read through it.
 */
export function recordProperties(properties: Iterable<{ key: string; value: string }>): BlockRecord["properties"] {
  const out: BlockRecord["properties"] = [];
  const byKey = new Map<string, string[]>();
  for (const p of properties) {
    const values = byKey.get(p.key);
    if (values) values.push(...splitPropertyValue(p.value));
    else { const v = splitPropertyValue(p.value); byKey.set(p.key, v); out.push({ key: p.key, values: v }); }
  }
  return out;
}

/**
 * Every value of `key` a note has at block scope (what queries match), in order; none is `[]`, never undefined. Reads
 * a record's `properties` (`{ key, values }`) or a wire block's (`{ key, value }`, split by the list rule), so no
 * client flattens properties into a `key → value` map (a repeat or a list would be lost). Keys compare in lower case.
 */
export function valuesOf(source: { properties?: readonly ({ key: string; values: readonly string[] } | { key: string; value: string })[] }, key: string): string[] {
  const k = key.toLowerCase();
  return (source.properties ?? []).flatMap(p => (p.key.toLowerCase() === k ? ("values" in p ? p.values : splitPropertyValue(p.value)) : []));
}

/** The first value of `key` at block scope, or undefined. */
export const valueOf = (source: Parameters<typeof valuesOf>[0], key: string): string | undefined => valuesOf(source, key)[0];

/** A timestamp in the record's one format: ISO 8601, UTC, milliseconds. */
export const recordTime = (t: string | number) => new Date(t).toISOString();

/** The record of one block, from what the service read. */
export function blockRecord(input: BlockRecordInput): BlockRecord {
  const { block } = input;
  const h = headerLine(block.text, input.literal);
  const properties = recordProperties(input.properties.filter(p => p.scope === "block"));
  return {
    id: block.id,
    parent: block.parentId,
    title: input.title,
    header: h.chips.map(({ key, value }) => ({ key, value })),
    body: h.body,
    text: block.text,
    properties,
    fields: input.properties.flatMap(p => (p.scope === "block" ? [] : [{ key: p.key, value: p.value, scope: p.scope, line: p.line, column: p.column, offset: p.start }])),
    children: [...input.children],
    tasks: input.tasks,
    links: input.links.map(l => ({
      ...l,
      bodySpans: l.spans.flatMap(([s, e]): [number, number][] => {
        const start = bodyOffset(h, s), last = bodyOffset(h, e - 1);
        return start < 0 || last < start ? [] : [[start, last + 1]];
      }),
    })),
    backlinks: [...new Set(input.backlinks)].sort(),
    resources: input.resources,
    created: recordTime(block.createdAt),
    updated: recordTime(block.updatedAt),
    author: block.author,
    actor: block.actorId ?? null,
    revision: block.revision,
    ...(input.truncated?.length ? { truncated: [...input.truncated] } : {}),
  };
}

/** A value with every object's keys sorted, recursively (arrays keep their order). */
export function sortedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortedKeys) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortedKeys((value as Record<string, unknown>)[k])])) as T;
  }
  return value;
}

/** Records (or anything) as deterministic JSON: sorted keys, two-space indent, a final newline. */
export const recordJson = (value: unknown) => `${JSON.stringify(sortedKeys(value), null, 2)}\n`;
