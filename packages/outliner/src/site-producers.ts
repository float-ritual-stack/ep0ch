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
import { asksPerItem, cellBlockId, CHILDREN_QUERY, figureQuestion, itemField, liveAsk, sortProblem, tableOf } from "@ep0ch/outline-core/figure-live";
import { recordProperties, valuesOf } from "@ep0ch/outline-core/block-record";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { frontMatterLines } from "@ep0ch/outline-core/header-line";
import { bodyMatch, matchWords } from "@ep0ch/outline-core/property-match";
import { VIEW, checkValue } from "@ep0ch/outline-core/component-schema";
import { viewWords } from "@ep0ch/outline-core/view-spec";
import { listCellText, type ListGroup, type ListPrimitive } from "@ep0ch/outline-core/list-row";
import type { QuestionGroup } from "@ep0ch/outline-core/protocol";
import { displayTitleOfText } from "./references";
import type { FieldRow, SiteProduced, SiteProducer, SiteValue } from "@ep0ch/outline-core/site";
import type { BlockSearchQuery, SavedViewReadResult, TreeIndexBlock, VisibleBlock, VisibleBlockCollection } from "./types";
import type { Bound } from "./site-answer";
import { queryRelations, type QueryRelationKind, type ValueBinder } from "./block-query";
import { parseVirtualBranchConfig, virtualBranchMembershipQuery } from "./virtual-branches";
import { StillCounting } from "./site-budget";

type Props = Record<string, any>;

/** What the producers need of the store, beyond the Site read's. */
export interface ProducerStore {
  get(id: string): { id: string; revision: number; text: string; parentId: string | null } | null;
  children(parentId: string | null): { id: string }[];
  queryBlocks(input: BlockSearchQuery, binder?: ValueBinder, select?: (blocks: VisibleBlock[], where?: string) => VisibleBlock[]): VisibleBlockCollection & { groups?: import("@ep0ch/outline-core/protocol").QuestionGroup[]; hint?: string };
  readSavedView(viewId: string, options: import("./types").SavedViewReadOptions, format: "tree", select?: (blocks: VisibleBlock[], where?: string) => VisibleBlock[]): SavedViewReadResult<TreeIndexBlock>;
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
    queryBlocks: (input, binder, select) => store.queryBlocks(input, binder, blocks => { const shown = visibleMatches(store, world, blocks, input.where); return select ? select(shown, input.where) : shown; }),
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
type Asked = { blocks: (VisibleBlock | TreeIndexBlock)[]; truncated: boolean; total?: number; groups?: import("@ep0ch/outline-core/protocol").QuestionGroup[]; hint?: string; error?: string };

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
    try { read = store.readSavedView(viewId, { limit: p.limit === undefined ? undefined : Number(p.limit) }, "tree"); } catch (error) { return { blocks: [], truncated: false, error: own(error) }; }
    if (read.status !== "ready") return { blocks: [], truncated: false, error: `view ${read.status}: ${read.errors.join("; ")}` };
    const hidden = read.machineryHidden;
    return {
      blocks: read.blocks, total: read.total,
      truncated: read.completeness?.kind === "truncated" || read.nextOffset !== undefined,
      ...(hidden ? { hint: `${hidden > 50 ? "50+" : hidden} machinery note${hidden === 1 ? "" : "s"} hidden · machinery=show` } : {}),
    };
  }
  const { where, limit, sort, direction, machinery } = question;
  try {
    const found = store.queryBlocks({ where, ...(thisId ? { this: thisId } : {}), limit, sort: `${sort} ${direction}`, ...(question.group ? { group: question.group } : {}), machinery: machinery ?? DEFAULT_MACHINERY } as BlockSearchQuery, tools.binder);
    return { blocks: found.blocks, truncated: found.completeness.kind === "truncated", total: found.completeness.kind === "truncated" ? found.completeness.matched : found.blocks.length, ...(found.groups ? { groups: found.groups } : {}), ...(found.hint ? { hint: found.hint } : {}) };
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
      const a = ask(store, tools, thisId, { ...item, limit: item.limit ?? p.limit });
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
  const titles = kind === "timeline" && p.meta === "parent"
    ? Object.fromEntries([...new Set(a.blocks.flatMap(b => b.parentId ? [b.parentId] : []))].flatMap(id => { const parent = store.get(id); return parent ? [[id, displayTitleOfText(parent.text) ?? id]] : []; }))
    : kind === "table" || kind === "tabs" ? cellTitles(tools, a.blocks, Array.isArray(p.columns) ? p.columns.map(String) : undefined) : undefined;
  // (A `link:` property's notes are the rows' links; they need no title.)
  return {
    kind: "figure", blocks: a.blocks, truncated: a.truncated, ...(a.total !== undefined ? { total: a.total } : {}), ...(titles ? { titles } : {}),
    ...(a.groups ? { groups: a.groups } : {}), ...(a.hint ? { hint: a.hint } : {}),
    ...(done.ids ? { done: done.ids } : {}), ...(now.ids ? { now: now.ids } : {}),
    ...(error ? { error } : {}),
  };
}

/** The collection record compiles here; clients receive rows, groups and cells, never a query to interpret. */
function collection(store: ProducerStore, bound: Bound, tools: SiteTools, written: Props, state: Props = {}): Extract<SiteProduced, { kind: "view" }> {
  let p: Props = { sort: "updated", ...written }, title = "Collection", source: string | undefined;
  const empty = (error: string): Extract<SiteProduced, { kind: "view" }> => ({ kind: "view", title, layout: "table", layouts: ["table"], question: {}, view: { type: "list", rows: [], empty: error }, truncated: false, error });
  try {
    if (written.of) {
      const ref = String(written.of);
      const id = tools.read(`${ref.startsWith("((") || ref.startsWith("[[") ? ref : `((${ref}))`}.id`);
      if (id.problem) return empty(id.problem.message);
      source = id.values![0]!;
      const saved = store.readSavedView(source, {}, "tree");
      if (saved.status !== "ready") return empty(saved.errors.join("; "));
      const note = store.get(source)!;
      title = displayTitleOfText(note.text) ?? "Collection";
      p = Object.fromEntries(parsePropertyRecords(note.text).filter(field => field.scope === "block").map(field => [field.key, field.value]));
      // A saved note's page address is not a page size; numeric values and inline/layout overrides still configure the collection.
      if (p.page !== undefined && Number.isNaN(Number(p.page))) delete p.page;
      const where = [p.where, written.where].filter(Boolean).map(w => `(${w})`).join(" AND ");
      p = { ...p, ...written, ...(where ? { where } : {}) };
    }
    const layouts = viewWords(p.layout ?? "table");
    const allowed = VIEW.props.find(prop => prop.key === "layout")!.values!.map(value => value.value);
    const bad = layouts.find(layout => !allowed.includes(layout));
    if (bad) return empty(`layout: ${bad} is unknown; write ${allowed.join(", ")}`);
    const layout = state.layout ?? layouts[0] ?? "table";
    if (!allowed.includes(layout)) return empty(`layout: ${layout} is unknown; write ${allowed.join(", ")}`);
    p = { ...p, ...Object.fromEntries(Object.entries(p).filter(([key]) => key.startsWith(`${layout}.`)).map(([key, value]) => [key.slice(layout.length + 1), value])) };
    p = { ...p, ...state, where: [p.where, state.where].filter(Boolean).map(w => `(${w})`).join(" AND ") };
    for (const property of VIEW.props) if (property.key !== "direction" && p[property.key] !== undefined && (property.type === "enum" || property.type === "int")) {
      const problem = checkValue(property, String(p[property.key]));
      if (problem) return empty(problem);
    }
    title = String(p.title ?? title);
    if (title.includes("{{")) title = interpolate(title, span => { const value = tools.read(span.expression); return value.values && !value.hidden ? value.values : undefined; });
    const compiled = parseVirtualBranchConfig({ id: source ?? "", properties: Object.entries({ type: "virtual-branch", ...p }).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(",") : String(value) })) }, []);
    if (!compiled.config) return empty(compiled.configurationErrors.join("; "));
    const question: BlockSearchQuery = {
      ...virtualBranchMembershipQuery(source ?? "", compiled.config, compiled.config.limit),
      ...(bound.site.this ? { this: bound.site.this.id } : {}), facets: true,
    };
    const answer = store.queryBlocks(question, tools.binder);
    // Excluding the record must keep the question's warnings; a publication cut still owns which hints it reveals.
    const found = source ? { ...store.queryBlocks(question, tools.binder, blocks => blocks.filter(block => block.id !== source)), ...(answer.hint ? { hint: answer.hint } : {}) } : answer;
    const items = found.blocks.map(block => ({ ...block, properties: recordProperties(block.properties), author: block.author ?? null, title: displayTitleOfText(block.text) ?? block.id, createdAt: Date.parse(block.createdAt), updatedAt: Date.parse(block.updatedAt) }));
    const writtenColumns = p["summary-properties"] ?? p.columns;
    const table = tableOf({ ...p, ...(writtenColumns ? { columns: viewWords(writtenColumns) } : {}) }, items);
    const columns = table.columns;
    const titles = cellTitles(tools, found.blocks, columns);
    const bodyLines = Number(p.body ?? (layout === "feed" ? 6 : 0));
    const rowValue = (block: VisibleBlock, key: string, label: string, body: string[]) => {
      if (key === "description") return valuesOf(block, key).join(", ") || body[0] || "";
      const raw = itemField({ ...block, properties: recordProperties(block.properties), author: block.author ?? null, title: label, createdAt: Date.parse(block.createdAt), updatedAt: Date.parse(block.updatedAt) }, key);
      const named = cellBlockId(raw);
      return named && titles?.[named] ? { text: titles[named], link: named } : raw;
    };
    const rows = found.blocks.map((block, i) => {
      const match = bodyMatch(block);
      const label = (displayTitleOfText(block.text) ?? block.id) + (match ? ` · ${matchWords(match, false)}` : "");
      const front = frontMatterLines(block.text);
      const body = block.text.split("\n").filter((_, i) => !front.has(i)).join("\n").trim().split("\n");
      const cells = columns.map(key => rowValue(block, key, label, body)).map(cell => typeof cell === "object" && cell.link === table.blocks[i] && table.rowRevisions?.[i] ? { ...cell, revision: table.rowRevisions[i]! } : cell);
      const cover = viewWords(p.cover).map(key => valuesOf(block, key).join(", ")).find(Boolean);
      return { id: block.id, label, cells, bind: `((${block.id}))`, body: body.slice(0, bodyLines),
        detail: columns.flatMap((key, i) => key === "title" || !listCellText(cells[i]!) ? [] : [`${key}: ${listCellText(cells[i]!)}`]).join(" · "),
        ...(cover ? { cover } : {}), preview: { block: block.id },
        do: { open: p.open || table.rowRevisions?.[i] || match ? { ref: table.blocks[i]!, ...(p.open ? { where: p.open } : {}), ...(table.rowRevisions?.[i] ? { revision: table.rowRevisions[i]! } : {}), ...(match ? { at: match.start, atLabel: match.raw, atSays: `the line its ${match.key} is written on` } : {}) } : table.blocks[i]! },
      };
    });
    const groups = (sourceGroups: QuestionGroup[], parent = ""): ListGroup[] => sourceGroups.map(group => ({
      name: `${parent}/${group.value ?? "\u0000"}`, label: group.value ?? "NONE", count: group.count, ids: group.ids,
      ...(group.groups ? { groups: groups(group.groups, `${parent}/${group.value ?? "\u0000"}`) } : {}),
    }));
    const arrange: Record<string, NonNullable<ListPrimitive["arrange"]>> = { table: "table", gallery: "grid", feed: "rows", board: "lanes" };
    return { kind: "view", title, layout, layouts, question: { ...question, where: compiled.config.query, ...(compiled.config.sort ? { sort: `${compiled.config.sort.field} ${compiled.config.sort.direction}` } : {}) }, view: {
      type: "list", rows, arrange: arrange[layout], size: p.card ?? "small", columns, headers: table.headers, page: Number(p.page ?? 200),
      ...(found.groups ? { groups: groups(found.groups) } : {}), empty: found.hint ?? "No matching notes",
    }, ...(found.groups ? { groups: found.groups } : {}), ...(found.facets ? { facets: found.facets } : {}),
      ...(found.hint ? { hint: found.hint } : {}), truncated: found.completeness.kind === "truncated" };
  } catch (error) { return empty(sortProblem(own(error), p.sort, p.direction ?? "desc")); }
}

/** The most cells naming a note one table answers with titles. */
const MAX_CELL_TITLES = 500;

/**
 * The titles of the notes a table's rows name by id in their properties (PIE-1388: a record's `note::<uuid>`), so every
 * reader draws the title, linked, where the value is a uuid. Ids of notes that aren't there are left as written.
 */
function cellTitles(tools: SiteTools, blocks: readonly { properties?: { key: string; value: string }[] }[], columns?: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let n = 0;
  // Only the columns the table draws (a table that names none draws title and updated: no property cells).
  if (!columns?.length) return undefined;
  for (const block of blocks) for (const property of block.properties ?? []) {
    if (!columns.includes(property.key)) continue;
    const id = cellBlockId(property.value ?? "");
    if (!id || id in out || n++ >= MAX_CELL_TITLES) continue;
    const named = tools.read(`((${id})).title`);
    if (!named.hidden && named.values?.[0]) out[id] = named.values[0];
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
  if (!thisId && producer.kind !== "figure" && producer.kind !== "view" && producer.kind !== "unknowable") return { answer: { kind: "if", holds: false, problem: { message: "this run has no note to read", didYouMean: [] } } };
  switch (producer.kind) {
    case "view": return { answer: collection(store, bound, tools, producer.props, producer.state), anyChange: true };
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
