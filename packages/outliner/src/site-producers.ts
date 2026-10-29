// What a producer in a note asks of its Site (PIE-533 S3), answered once for every client: a `::graph-*` figure's
// question (its query or view, groups, `done:`/`now:` subsets, a stat's per-item counts), a figure block's child
// bullets, `::fields` (one row per occurrence of a key) and `::if` (does `this` match). The door's watched reads and the
// publisher's page requests both ask `site.answer` for these and draw the answer; neither keeps its own orchestration.
//
// The Site is the one `bind` made (the note, or the host of a `::use`), so `this` in a query is its note and a
// `{{ }}` operand is bound from it, never pasted into the query text: one figure copied onto two pages, or drawn through
// a template, lists each host's own. Reads only. Which notes a page may show is the publisher's, applied after.
import { DEFAULT_MACHINERY } from "@ep0ch/outline-core/machinery";
import { interpolate } from "@ep0ch/outline-core/interpolation";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { asksPerItem, cellBlockId, CHILDREN_QUERY, figureQuestion, liveAsk, sortProblem } from "@ep0ch/outline-core/figure-live";
import { displayTitleOfText } from "./references";
import type { FieldRow, SiteProduced, SiteProducer, SiteValue } from "@ep0ch/outline-core/site";
import type { BlockSearchQuery, SavedViewReadResult, TreeIndexBlock, VisibleBlock, VisibleBlockCollection } from "./types";
import type { Bound } from "./site-answer";
import { queryRelations, type QueryRelationKind, type ValueBinder } from "./block-query";
import { StillCounting } from "./site-budget";

type Props = Record<string, any>;

/** What the producers need of the store, beyond the Site read's. */
export interface ProducerStore {
  get(id: string): { id: string; revision: number; text: string; parentId: string | null } | null;
  children(parentId: string | null): { id: string }[];
  queryBlocks(input: BlockSearchQuery, binder?: ValueBinder, select?: (blocks: VisibleBlock[], where?: string) => VisibleBlock[]): VisibleBlockCollection & { groups?: import("@ep0ch/outline-core/protocol").QuestionGroup[]; hint?: string };
  readSavedView(viewId: string, options: Record<string, never>, format: "tree", select?: (blocks: VisibleBlock[], where?: string) => VisibleBlock[]): SavedViewReadResult<TreeIndexBlock>;
  matchQuery(expression: unknown, ids: unknown, narrow?: { this?: unknown }, binder?: ValueBinder, draft?: BlockRecord): { blockIds: string[] };
  /** For each id, the notes linking to it (`sources`) and the ones it links to (`targets`), read once for all of them. */
  linkNeighbours(ids: readonly string[], which: { sources: boolean; targets: boolean }): Map<string, Set<string>>;
}

/** The Site's reads a producer makes: a path's answer, and a query operand's binder. */
export interface SiteTools { read(path: string): SiteValue; binder: ValueBinder; /** One unit of work done (the request's time budget, site-budget.ts). */ spend(what: string): void }

/** The most notes whose neighbours are checked for one question; a note past it counts as unknowable. */
export const MAX_CHECKED = 500;

/**
 * Which of `ids` a question about other notes (`child:status=approved`, `links:`, `under:`…) can't be answered for by a
 * reader who may not see every note: whether such a note matches would tell what a neighbour (a child, an ancestor, a
 * link either way) holds. Every neighbour consulted joins the answer's `deps` (a page asks whether it shows each, then
 * asks again naming the ones it doesn't). Only for a limited reader (the request carried `hidden`); a note past
 * `MAX_CHECKED` counts as unknowable.
 */
export function unknowable(store: ProducerStore, world: Bound["world"], ids: readonly string[], expression: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!world.cut || !expression) return out;
  const relations = queryRelations(expression);
  if (!relations.size) return out;
  // A note the question names (`linkedfrom:((id))`) is one it consults whether or not it matches (a `NOT` answers from it too).
  const named = [...expression.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map(found => found[0].toLowerCase());
  for (const id of named) world.deps.add(id);
  const all = named.some(id => world.hidden.has(id));
  const checked = all ? [] : ids.slice(0, MAX_CHECKED);
  world.spend("checking which rows this page may show");
  const near = neighbours(store, checked, relations);
  ids.forEach((id, i) => {
    if (all || i >= MAX_CHECKED) { out.add(id); return; }
    world.spend("checking which rows this page may show");
    for (const other of near.get(id)!) {
      world.deps.add(other);
      if (world.hidden.has(other)) out.add(id);
    }
  });
  if (out.size) world.hiddenHits += 1;
  return out;
}

/**
 * The notes the relations a question reads can consult about each of `ids`: children and ancestors from the tree, and
 * links either way from one read of the link index for every row (PIE-1047: a whole-outline query per row held the
 * host for 57 s over pie's 5k notes).
 */
function neighbours(store: ProducerStore, ids: readonly string[], relations: ReadonlySet<QueryRelationKind>): Map<string, Set<string>> {
  const all = relations.has("other");
  const sources = all || relations.has("links"), targets = all || relations.has("linkedfrom");
  const linked = sources || targets ? store.linkNeighbours(ids, { sources, targets }) : undefined;
  return new Map(ids.map(id => {
    const out = new Set<string>(linked?.get(id) ?? []);
    if (all || relations.has("child")) for (const child of store.children(id)) out.add(child.id);
    if (all || relations.has("parent") || relations.has("under")) {
      const seen = new Set<string>([id]);
      for (let at = store.get(id)?.parentId; at && !seen.has(at); at = relations.has("under") || all ? store.get(at)?.parentId : null) { out.add(at); seen.add(at); }
    }
    return [id, out];
  }));
}

/** Apply the Site's cut before a query counts, groups, facets or limits its matches. */
export function visibleMatches<T extends { id: string }>(store: ProducerStore, world: Bound["world"], blocks: T[], where?: string): T[] {
  world.spend("checking which results this page may show");
  const ids = blocks.map(block => block.id);
  for (const id of ids) world.deps.add(id);
  const gone = unknowable(store, world, ids, where);
  return blocks.filter(block => !world.hidden.has(block.id) && !gone.has(block.id));
}

/**
 * The store a producer asks, cut for a limited reader: a query's or a view's rows, and the notes a subset holds for, leave
 * out any note `unknowable` says the question can't be answered for. Every producer asks this store, so none can forget.
 */
function cutStore(store: ProducerStore, world: Bound["world"]): ProducerStore {
  return {
    get: id => store.get(id),
    children: id => store.children(id),
    linkNeighbours: (ids, which) => store.linkNeighbours(ids, which),
    queryBlocks: (input, binder) => store.queryBlocks(input, binder, blocks => visibleMatches(store, world, blocks, input.where)),
    readSavedView: (viewId, options, format) => store.readSavedView(viewId, options, format, (blocks, where) => visibleMatches(store, world, blocks, where)),
    matchQuery: (expression, ids, narrow, binder, draft) => {
      const matched = store.matchQuery(expression, ids, narrow, binder, draft);
      const gone = unknowable(store, world, Array.isArray(ids) ? ids as string[] : [], typeof expression === "string" ? expression : undefined);
      return gone.size ? { blockIds: matched.blockIds.filter(id => !gone.has(id)) } : matched;
    },
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** A question's own error is its answer; running out of time is the whole request's (`StillCounting`). */
const own = (error: unknown) => { if (error instanceof StillCounting) throw error; return message(error); };

/** One question, asked: the results, or why not. A view is read as the door's tree reads it. */
type Asked = { blocks: (VisibleBlock | TreeIndexBlock)[]; truncated: boolean; groups?: import("@ep0ch/outline-core/protocol").QuestionGroup[]; hint?: string; error?: string };

function ask(store: ProducerStore, tools: SiteTools, thisId: string | undefined, p: Props, group?: string): Asked | null {
  const question = figureQuestion(p, group);
  if (!question) return null;
  if ("error" in question) return { blocks: [], truncated: false, error: question.error };
  if (question.kind === "view" || question.kind === "page") {
    let viewId: string;
    if (question.kind === "page") {
      const page = tools.read(`[[${question.address}]].id`);
      if (page.problem) return { blocks: [], truncated: false, error: `view: ${page.problem.message}${page.problem.didYouMean.length ? `; did you mean ${page.problem.didYouMean.join(" or ")}?` : ""}` };
      viewId = page.values![0]!;
    } else viewId = question.viewId;
    let read: SavedViewReadResult<TreeIndexBlock>;
    try { read = store.readSavedView(viewId, {}, "tree"); } catch (error) { return { blocks: [], truncated: false, error: own(error) }; }
    if (read.status !== "ready") return { blocks: [], truncated: false, error: `view ${read.status}: ${read.errors.join("; ")}` };
    const hidden = read.machineryHidden;
    return {
      blocks: read.blocks,
      truncated: read.completeness?.kind === "truncated" || read.nextOffset !== undefined,
      ...(hidden ? { hint: `${hidden > 50 ? "50+" : hidden} machinery note${hidden === 1 ? "" : "s"} hidden · machinery=show` } : {}),
    };
  }
  const { where, limit, sort, direction, machinery } = question;
  try {
    const found = store.queryBlocks({ where, ...(thisId ? { this: thisId } : {}), limit, sort: `${sort} ${direction}`, ...(question.group ? { group: question.group } : {}), machinery: machinery ?? DEFAULT_MACHINERY } as BlockSearchQuery, tools.binder);
    return { blocks: found.blocks, truncated: found.completeness?.kind === "truncated", ...(found.groups ? { groups: found.groups } : {}), ...(found.hint ? { hint: found.hint } : {}) };
  } catch (error) {
    return { blocks: [], truncated: false, error: sortProblem(own(error), sort, direction) };
  }
}

/** Which of `ids` a figure's `done:` or `now:` query holds for. */
function subset(store: ProducerStore, tools: SiteTools, thisId: string | undefined, expression: string, ids: readonly string[]): { ids?: string[]; error?: string } {
  if (!ids.length) return { ids: [] };
  try { return { ids: store.matchQuery(expression, ids, thisId ? { this: thisId } : {}, tools.binder).blockIds }; }
  catch (error) { return { error: own(error) }; }
}

function figure(store: ProducerStore, tools: SiteTools, thisId: string | undefined, kind: string, p: Props): SiteProduced {
  if (asksPerItem(kind, p)) {
    const counts = (p.items as Props[]).map((item, index) => {
      tools.spend(`counting ${item.label ?? `item ${index + 1}`}`);
      const a = ask(store, tools, thisId, item);
      if (!a) return { ids: [], truncated: false };
      return a.error ? { ids: [], truncated: false, error: `${item.label ?? `item ${index + 1}`}: ${a.error}` } : { ids: a.blocks.map(b => b.id), truncated: a.truncated };
    });
    const error = counts.find(c => c.error)?.error;
    return { kind: "figure", blocks: [], truncated: false, counts, ...(error ? { error } : {}) };
  }
  const asking = liveAsk(kind, p);
  if (asking.error) return { kind: "figure", blocks: [], truncated: false, error: asking.error };
  const a = ask(store, tools, thisId, asking.ask, asking.group);
  if (!a) return { kind: "figure", blocks: [], truncated: false };
  if (a.error) return { kind: "figure", blocks: [], truncated: false, error: a.error };
  const ids = a.blocks.map(b => b.id);
  const done = asking.props.done ? subset(store, tools, thisId, String(asking.props.done), ids) : {};
  const now = asking.props.now ? subset(store, tools, thisId, String(asking.props.now), ids) : {};
  const error = done.error ? `done: ${done.error}` : now.error ? `now: ${now.error}` : undefined;
  const titles = kind === "table" || kind === "tabs" ? cellTitles(store, a.blocks, Array.isArray(p.columns) ? p.columns.map(String) : undefined) : undefined;
  return {
    kind: "figure", blocks: a.blocks, truncated: a.truncated, ...(titles ? { titles } : {}),
    ...(a.groups ? { groups: a.groups } : {}), ...(a.hint ? { hint: a.hint } : {}),
    ...(done.ids ? { done: done.ids } : {}), ...(now.ids ? { now: now.ids } : {}),
    ...(error ? { error } : {}),
  };
}

/** The most cells naming a note one table answers with titles. */
const MAX_CELL_TITLES = 500;

/**
 * The titles of the notes a table's rows name by id in their properties (PIE-1388: a record's `note::<uuid>`), so every
 * reader draws the title, linked, where the value is a uuid. Ids of notes that aren't there are left as written.
 */
function cellTitles(store: ProducerStore, blocks: readonly { properties?: { key: string; value: string }[] }[], columns?: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let n = 0;
  // Only the columns the table draws (a table that names none draws title and updated: no property cells).
  if (!columns?.length) return undefined;
  for (const block of blocks) for (const property of block.properties ?? []) {
    if (!columns.includes(property.key)) continue;
    const id = cellBlockId(property.value ?? "");
    if (!id || id in out || n++ >= MAX_CELL_TITLES) continue;
    const named = store.get(id);
    if (named) out[id] = displayTitleOfText(named.text) ?? id;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A field as written: a `[key::value]` chip to its closing bracket (links inside nest), else its `key:: value` line. */
function tokenAt(text: string, offset: number, line: string): string {
  if (text[offset] === "[") {
    for (let i = offset, depth = 0; i < text.length && text[i] !== "\n"; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]" && --depth === 0) return text.slice(offset, i + 1);
    }
  }
  return line.trim();
}

function fields(store: ProducerStore, tools: SiteTools, key: string, of: string | undefined, draft?: { id: string; text: string }): SiteProduced {
  const path = `${of === "parent" ? "parent" : of ? (of.startsWith("((") ? of : `((${of}))`) : "this"}.fields.${key}`;
  const read = tools.read(path);
  if (read.problem) return { kind: "fields", key, from: of ?? "", revision: 0, rows: [], problem: read.problem };
  const from = read.from ?? of ?? "";
  const saved = store.get(from);
  // The note as read: a draft being typed (its fields, text and offsets agree), else the saved text at its revision.
  const note = draft && draft.id === from ? { text: draft.text, revision: 0 } : saved;
  const rows: FieldRow[] = (read.values ?? []).map((value, i) => {
    const link = read.links?.find(l => l.text === value);
    const offset = read.offsets?.[i], mark = read.marks?.[i] ?? "";
    return {
      value, line: read.lines?.[i] ?? 0, mark,
      ...(offset !== undefined ? { offset, token: tokenAt(note?.text ?? "", offset, mark) } : {}),
      ...(link ? { link: { id: link.id, title: link.title } } : {}),
    };
  });
  return { kind: "fields", key, from, revision: note?.revision ?? 0, rows };
}

function holds(store: ProducerStore, bound: Bound, tools: SiteTools, thisId: string, where: string): SiteProduced {
  try {
    const hits = bound.world.hiddenHits;
    const draft = bound.draft?.id === thisId ? bound.site.this : undefined;
    const held = store.matchQuery(where, [thisId], { this: thisId }, tools.binder, draft).blockIds.includes(thisId);
    // A clause about other notes answers from them: for a reader who may not see one, it says nothing.
    if (bound.world.hiddenHits > hits) return { kind: "if", holds: false, problem: { message: "this reads notes that aren't shown here", didYouMean: [] } };
    return { kind: "if", holds: held };
  }
  catch (error) { return { kind: "if", holds: false, problem: { message: own(error), didYouMean: [], example: '::if{where="status=active"}' } }; }
}

/** A producer's question answered over the bound Site; `anyChange`: it depends on notes the answer can't name. */
export function produce(raw: ProducerStore, bound: Bound, producer: SiteProducer, tools: SiteTools): { answer: SiteProduced; anyChange?: true } {
  // A limited reader's producers ask a store that leaves out what it can't answer for (`cutStore`).
  const store = bound.world.cut ? cutStore(raw, bound.world) : raw;
  const thisId = bound.site.this?.id;
  if (!thisId && producer.kind !== "figure" && producer.kind !== "unknowable") return { answer: { kind: "if", holds: false, problem: { message: "this run has no note to read", didYouMean: [] } } };
  switch (producer.kind) {
    case "figure": {
      if (!producer.figure || typeof producer.figure !== "string" || !producer.props || typeof producer.props !== "object") throw new Error("produce a figure with { kind: \"figure\", figure: \"table\", props: { query: \"type=ticket\" } }");
      const answer = figure(store, tools, thisId, producer.figure, producer.props as Props), t = (producer.props as Props).title;
      // Its title's `{{ }}` read in the same Site as its query's (PIE-1362); one with no value stays as written.
      const title = typeof t === "string" && t.includes("{{") ? interpolate(t, span => { const v = tools.read(span.expression); return v.values && !v.hidden ? v.values : undefined; }) : undefined;
      return { answer: answer.kind === "figure" && title !== undefined ? { ...answer, title } : answer, anyChange: true };
    }
    case "children": {
      const found = store.queryBlocks({ where: CHILDREN_QUERY, this: thisId!, limit: 1000 } as BlockSearchQuery, tools.binder);
      return { answer: { kind: "children", blocks: found.blocks }, anyChange: true };
    }
    case "fields": {
      if (typeof producer.key !== "string" || !producer.key.trim()) throw new Error("produce fields with { kind: \"fields\", key: \"connectTo\" }");
      return { answer: fields(store, tools, producer.key.trim(), producer.of, bound.draft) };
    }
    case "if": {
      if (typeof producer.where !== "string" || !producer.where.trim()) throw new Error("produce an if with { kind: \"if\", where: \"status=active\" }");
      return { answer: holds(store, bound, tools, thisId!, producer.where), anyChange: true };
    }
    case "unknowable": {
      if (!Array.isArray(producer.ids) || producer.ids.some(id => typeof id !== "string") || producer.ids.length > 1000) throw new Error("produce unknowable with { kind: \"unknowable\", ids: [\"<note id>\"], where: \"child:status=approved\" }, at most 1000 ids");
      return { answer: { kind: "unknowable", ids: [...unknowable(raw, bound.world, producer.ids, producer.where)] } };
    }
    default: throw new Error("produce is a figure, children, fields, if or unknowable: { kind: \"fields\", key: \"connectTo\" }");
  }
}
