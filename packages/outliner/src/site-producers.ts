// What a producer in a note asks of its Site (PIE-533 S3), answered once for every client: a `::graph-*` figure's
// question (its query or view, groups, `done:`/`now:` subsets, a stat's per-item counts), a figure block's child
// bullets, `::fields` (one row per occurrence of a key) and `::if` (does `this` match). The door's watched reads and the
// publisher's page requests both ask `site.answer` for these and draw the answer; neither keeps its own orchestration.
//
// The Site is the one `bind` made (the note, or the host of a `::use`), so `this` in a query is its note and a
// `{{ }}` operand is bound from it, never pasted into the query text: one figure copied onto two pages, or drawn through
// a template, lists each host's own. Reads only. Which notes a page may show is the publisher's, applied after.
import { DEFAULT_MACHINERY } from "@ep0ch/outline-core/machinery";
import { asksPerItem, CHILDREN_QUERY, figureQuestion, liveAsk, sortProblem } from "@ep0ch/outline-core/figure-live";
import type { FieldRow, SiteProduced, SiteProducer, SiteValue } from "@ep0ch/outline-core/site";
import type { BlockSearchQuery, SavedViewReadResult, TreeIndexBlock, VisibleBlock, VisibleBlockCollection } from "./types";
import type { Bound } from "./site-answer";
import { parseSearchExpression, queryReach, type ValueBinder } from "./block-query";

type Props = Record<string, any>;

/** What the producers need of the store, beyond the Site read's. */
export interface ProducerStore {
  get(id: string): { id: string; revision: number; text: string } | null;
  queryBlocks(input: BlockSearchQuery, binder?: ValueBinder): VisibleBlockCollection & { groups?: import("@ep0ch/outline-core/protocol").QuestionGroup[]; hint?: string };
  readSavedView(viewId: string, options: Record<string, never>, format: "tree"): SavedViewReadResult<TreeIndexBlock>;
  matchQuery(expression: unknown, ids: unknown, narrow?: { this?: unknown }, binder?: ValueBinder): { blockIds: string[] };
}

/** The Site's reads a producer makes: a path's answer, and a query operand's binder. */
export interface SiteTools { read(path: string): SiteValue; binder: ValueBinder }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One question, asked: the results, or why not. A view is read as the door's tree reads it. */
type Asked = { blocks: (VisibleBlock | TreeIndexBlock)[]; truncated: boolean; groups?: import("@ep0ch/outline-core/protocol").QuestionGroup[]; hint?: string; error?: string };

function ask(store: ProducerStore, tools: SiteTools, thisId: string | undefined, p: Props, group?: string): Asked | null {
  const question = figureQuestion(p, group);
  if (!question) return null;
  if ("error" in question) return { blocks: [], truncated: false, error: question.error };
  if (question.kind === "view") {
    let read: SavedViewReadResult<TreeIndexBlock>;
    try { read = store.readSavedView(question.viewId, {}, "tree"); } catch (error) { return { blocks: [], truncated: false, error: message(error) }; }
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
    return { blocks: [], truncated: false, error: sortProblem(message(error), sort, direction) };
  }
}

/** Which of `ids` a figure's `done:` or `now:` query holds for. */
function subset(store: ProducerStore, tools: SiteTools, thisId: string | undefined, expression: string, ids: readonly string[]): { ids?: string[]; error?: string } {
  if (!ids.length) return { ids: [] };
  try { return { ids: store.matchQuery(expression, ids, thisId ? { this: thisId } : {}, tools.binder).blockIds }; }
  catch (error) { return { error: message(error) }; }
}

function figure(store: ProducerStore, tools: SiteTools, thisId: string | undefined, kind: string, p: Props): SiteProduced {
  if (asksPerItem(kind, p)) {
    const counts = (p.items as Props[]).map(item => {
      const a = ask(store, tools, thisId, item);
      if (!a) return { ids: [], truncated: false };
      return a.error ? { ids: [], truncated: false, error: a.error } : { ids: a.blocks.map(b => b.id), truncated: a.truncated };
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
  return {
    kind: "figure", blocks: a.blocks, truncated: a.truncated,
    ...(a.groups ? { groups: a.groups } : {}), ...(a.hint ? { hint: a.hint } : {}),
    ...(done.ids ? { done: done.ids } : {}), ...(now.ids ? { now: now.ids } : {}),
    ...(error ? { error } : {}),
  };
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
  const path = `${of ? `((${of}))` : "this"}.fields.${key}`;
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

/** The notes an `::if` with a relation clause (`child:`, `links:`…) can consult about `this`: its children and its link neighbours. */
function neighbours(store: ProducerStore, tools: SiteTools, thisId: string): string[] {
  const found = store.queryBlocks({ where: "parent:this OR links:this OR linkedfrom:this", this: thisId, limit: 1000, machinery: "show" } as BlockSearchQuery, tools.binder);
  return found.blocks.map(block => block.id);
}

function holds(store: ProducerStore, bound: Bound, tools: SiteTools, thisId: string, where: string): SiteProduced {
  try {
    // A clause about other notes answers from them: they are the answer's dependencies (a page asks whether it may show
    // each), and for a reader who may not see one, it says nothing: whether the body appears would tell what that note holds.
    if (queryReach(parseSearchExpression(where).where).open) {
      const near = neighbours(store, tools, thisId);
      for (const id of near) bound.world.deps.add(id);
      if (near.some(id => bound.world.hidden.has(id))) {
        bound.world.hiddenHits += 1;
        return { kind: "if", holds: false, problem: { message: "this reads notes that aren't shown here", didYouMean: [] } };
      }
    }
    return { kind: "if", holds: store.matchQuery(where, [thisId], { this: thisId }, tools.binder).blockIds.includes(thisId) };
  }
  catch (error) { return { kind: "if", holds: false, problem: { message: message(error), didYouMean: [], example: '::if{where="status=active"}' } }; }
}

/** A producer's question answered over the bound Site; `anyChange`: it depends on notes the answer can't name. */
export function produce(store: ProducerStore, bound: Bound, producer: SiteProducer, tools: SiteTools): { answer: SiteProduced; anyChange?: true } {
  const thisId = bound.site.this?.id;
  if (!thisId && producer.kind !== "figure") return { answer: { kind: "if", holds: false, problem: { message: "this run has no note to read", didYouMean: [] } } };
  switch (producer.kind) {
    case "figure": {
      if (!producer.figure || typeof producer.figure !== "string" || !producer.props || typeof producer.props !== "object") throw new Error("produce a figure with { kind: \"figure\", figure: \"table\", props: { query: \"type=ticket\" } }");
      return { answer: figure(store, tools, thisId, producer.figure, producer.props as Props), anyChange: true };
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
    default: throw new Error("produce is a figure, children, fields or if: { kind: \"fields\", key: \"connectTo\" }");
  }
}
