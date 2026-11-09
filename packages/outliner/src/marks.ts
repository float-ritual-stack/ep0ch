// Marks (PIE-1237, the capability "Marks"): one verb every surface calls. A mark is a fact written once: its subject (a
// block, a Resource, or a line of a file an nvim tile edits), where it was made (`surface`, `via`), a span of the
// block's text, when the person marked it (`at`: a phone's offline share keeps its time), who (an author and an
// actor id), optional words and an optional `reason`. Unmarking is a second fact (`mark_removals`).
//
// One table, two reads: a mark with a `reason` is an attention mark ("look here", the door's frame and alt+m step
// through them); one without is a pocket mark, what the query atoms read (`marked:today`, `marked-by:me`), so an
// agent's "look here" never joins the person's gathering. Sessions, recurrence and pocket history are derived later
// (the capability's build order); nothing here stores them.
import type { Database } from "bun:sqlite";
import type { PocketMark } from "@ep0ch/outline-core/query-expression";
import type { BlockAuthor, MutationProvenance } from "./types";

/** What `marks.add` takes: exactly one subject, and what the surface knows of where it was made. */
export interface MarkAddInput {
  blockId?: string;
  resourceId?: string;
  /** A line of a file (an nvim tile's): the file's path and its 1-based line. */
  file?: string;
  line?: number;
  /** A passage of the block's text: offsets, and the revision they were read at (the comment anchor's shape, no words). */
  span?: { start: number; end: number; revision?: number };
  /** Where it was made: `door`, `web`, `cli`, `mcp`, `phone`… */
  surface?: string;
  /** The query or note it was found through. */
  via?: string;
  /** When the person marked it (ISO), when it isn't now: an offline share keeps its time. */
  at?: string;
  words?: string;
  /** Why: a mark with a reason is an attention mark ("needs your call"), drawn as a frame and left out of `marked:`. */
  reason?: string;
}

/** What `marks.remove` takes: mark `n`, or every live mark on a subject; narrowed by reason ("" for pocket marks) or actor. */
export interface MarkRemoveInput { n?: number; blockId?: string; resourceId?: string; file?: string; line?: number; reason?: string; by?: string }

/** One live mark, as every surface reads it. `n` is its number (stays while it lives); `by` is `user` or an agent's actor id. */
export interface MarkRecord {
  n: number;
  block?: string;
  resource?: string;
  file?: string;
  line?: number;
  span?: { start: number; end: number; revision?: number };
  surface?: string;
  via?: string;
  at: string;
  author: BlockAuthor;
  by: string;
  words?: string;
  reason?: string;
}

/**
 * The marks' requests (types.ts's request union holds them): a mark by the request's mutation (the person when left out;
 * an agent with its actor id), unmarking as a second fact, and the live marks (every one, a block's, or since a time).
 */
export type MarkRequest =
  | { action: "marks.add"; input: MarkAddInput; mutation?: MutationProvenance }
  | { action: "marks.remove"; input: MarkRemoveInput; mutation?: MutationProvenance }
  | { action: "marks.list"; input?: { blockId?: string; since?: string } };
export type MarkAnswer = { mark: MarkRecord; already: boolean } | { removed: MarkRecord[] } | { marks: MarkRecord[] };

type Row = {
  id: number; block_id: string | null; resource_id: string | null; file: string | null; line: number | null;
  span_start: number | null; span_end: number | null; span_revision: number | null; surface: string | null; via: string | null;
  at: string; author: BlockAuthor; actor: string; words: string | null; reason: string | null;
};

const LIVE = "NOT EXISTS (SELECT 1 FROM mark_removals r WHERE r.mark_id = m.id)";

/** A short line of text (a reason, a surface, a via), or a refusal naming the field. */
function line(value: unknown, field: string, max = 500): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`marks: ${field} is text, not ${typeof value}`);
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > max) throw new Error(`marks: ${field} is at most ${max} characters`);
  return text;
}

function recordOf(row: Row): MarkRecord {
  return {
    n: row.id,
    ...(row.block_id ? { block: row.block_id } : {}),
    ...(row.resource_id ? { resource: row.resource_id } : {}),
    ...(row.file ? { file: row.file } : {}),
    ...(row.line !== null ? { line: row.line } : {}),
    ...(row.span_start !== null && row.span_end !== null ? { span: { start: row.span_start, end: row.span_end, ...(row.span_revision !== null ? { revision: row.span_revision } : {}) } } : {}),
    ...(row.surface ? { surface: row.surface } : {}),
    ...(row.via ? { via: row.via } : {}),
    at: row.at,
    author: row.author,
    by: row.actor,
    ...(row.words ? { words: row.words } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

/** Who a mark is by: the person is `user`; an agent its actor id (a write without one is refused). */
export function markActor(mutation: MutationProvenance | undefined): { author: BlockAuthor; actor: string } {
  const author = mutation?.author ?? "user";
  if (author === "user") return { author, actor: "user" };
  const actor = mutation?.actorId?.trim();
  if (!actor) throw new Error(`marks: an ${author}'s mark names its actor id (mutation.actorId)`);
  return { author, actor };
}

/** The service's answer to `marks.add`, `marks.remove` and `marks.list` (server.ts dispatches them here). */
export function answerMarks(store: { database: Database; get(id: string): { effectiveDeletedRootId?: string | null } | undefined | null }, request: MarkRequest): MarkAnswer {
  const marks = new Marks(store.database);
  if (request.action === "marks.add") return marks.add(request.input ?? {}, request.mutation, id => { const b = store.get(id); return !!b && !b.effectiveDeletedRootId; });
  if (request.action === "marks.remove") return { removed: marks.remove(request.input ?? {}, request.mutation) };
  return { marks: marks.list(request.input ?? {}) };
}

export class Marks {
  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  /**
   * Marks a subject. The same actor marking the same subject with the same reason while their mark is live answers
   * that mark (`already: true`): a second press never makes a second mark. `blockExists` says whether a block id
   * names a live block (the store's); a Resource must be in the catalog.
   */
  add(input: MarkAddInput, mutation: MutationProvenance | undefined, blockExists: (id: string) => boolean): { mark: MarkRecord; already: boolean } {
    const { author, actor } = markActor(mutation);
    const block = line(input.blockId, "blockId", 64), resource = line(input.resourceId, "resourceId", 128), file = line(input.file, "file", 4096);
    if ([block, resource, file].filter(Boolean).length !== 1) throw new Error("marks.add marks one thing: blockId (a note), resourceId (a Resource) or file with line (a line of a file)");
    if (block && !blockExists(block)) throw new Error(`marks.add: no block ${block} (or it is in Trash)`);
    if (resource && !this.database.query("SELECT 1 FROM resources WHERE id = ?").get(resource)) throw new Error(`marks.add: no Resource ${resource}`);
    const lineNo = input.line;
    if (lineNo !== undefined && (!Number.isSafeInteger(lineNo) || lineNo < 1)) throw new Error("marks.add: line is a line number from 1");
    if (file && lineNo === undefined) throw new Error("marks.add: a file's mark names its line");
    const span = input.span;
    if (span && (!block || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start)) throw new Error("marks.add: a span is { start, end } offsets in the block's text, end after start");
    let at = this.now().toISOString();
    if (input.at !== undefined) {
      const given = typeof input.at === "string" ? Date.parse(input.at) : NaN;
      if (!Number.isFinite(given)) throw new Error("marks.add: at is when it was marked, an ISO time (2026-11-09T14:05:00Z)");
      at = new Date(given).toISOString();
    }
    const reason = line(input.reason, "reason"), words = line(input.words, "words", 4000);
    const surface = line(input.surface, "surface", 120), via = line(input.via, "via", 500);
    return this.database.transaction(() => {
      const same = this.database.query(`
        SELECT * FROM marks m WHERE ${LIVE} AND actor = ? AND coalesce(reason, '') = ?
          AND block_id IS ? AND resource_id IS ? AND file IS ? AND line IS ? AND span_start IS ? AND span_end IS ?
        ORDER BY id LIMIT 1`).get(actor, reason ?? "", block ?? null, resource ?? null, file ?? null, lineNo ?? null, span?.start ?? null, span?.end ?? null) as Row | null;
      if (same) return { mark: recordOf(same), already: true };
      const row = this.database.query(`
        INSERT INTO marks (block_id, resource_id, file, line, span_start, span_end, span_revision, surface, via, at, author, actor, words, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(
        block ?? null, resource ?? null, file ?? null, lineNo ?? null, span?.start ?? null, span?.end ?? null, span?.revision ?? null,
        surface ?? null, via ?? null, at, author, actor, words ?? null, reason ?? null) as Row;
      return { mark: recordOf(row), already: false };
    }).immediate();
  }

  /**
   * Unmarks: mark `n`, or every live mark on block `blockId` (a file's line by `file` and `line`). Each removal is a
   * fact of its own, by its actor. Answers the marks it removed (none: nothing was there).
   */
  remove(input: MarkRemoveInput, mutation: MutationProvenance | undefined): MarkRecord[] {
    const { author, actor } = markActor(mutation);
    const where: string[] = [LIVE], args: (string | number)[] = [];
    if (input.n !== undefined) {
      if (!Number.isSafeInteger(input.n)) throw new Error("marks.remove: n is a mark's number (marks.list gives them)");
      where.push("id = ?"); args.push(input.n);
    } else if (input.blockId) {
      where.push("block_id = ?"); args.push(input.blockId);
    } else if (input.resourceId) {
      where.push("resource_id = ?"); args.push(input.resourceId);
    } else if (input.file && input.line !== undefined) {
      where.push("file = ? AND line = ?"); args.push(input.file, input.line);
    } else throw new Error("marks.remove names a mark: n (marks.list numbers them), blockId, resourceId, or file and line");
    if (input.reason !== undefined) { where.push("coalesce(reason, '') = ?"); args.push(input.reason?.trim() ?? ""); }
    if (input.by !== undefined) { where.push("actor = ?"); args.push(input.by); }
    const at = this.now().toISOString();
    return this.database.transaction(() => {
      const rows = this.database.query(`SELECT * FROM marks m WHERE ${where.join(" AND ")} ORDER BY id`).all(...args) as Row[];
      const write = this.database.query("INSERT INTO mark_removals (mark_id, at, author, actor) VALUES (?, ?, ?, ?)");
      for (const row of rows) write.run(row.id, at, author, actor);
      return rows.map(recordOf);
    }).immediate();
  }

  /** The live marks, oldest first: every one, or those on a block, or since a time (an ISO time). */
  list(filter: { blockId?: string; since?: string } = {}): MarkRecord[] {
    const where: string[] = [LIVE], args: string[] = [];
    if (filter.blockId) { where.push("block_id = ?"); args.push(filter.blockId); }
    if (filter.since) { where.push("at >= ?"); args.push(new Date(Date.parse(filter.since)).toISOString()); }
    // A mark on a block in Trash rests with it: it comes back with the block.
    where.push("(block_id IS NULL OR EXISTS (SELECT 1 FROM blocks b WHERE b.id = m.block_id AND b.effective_deleted_root_id IS NULL))");
    return (this.database.query(`SELECT * FROM marks m WHERE ${where.join(" AND ")} ORDER BY id`).all(...args) as Row[]).map(recordOf);
  }

  /** Each block's live pocket marks (no reason): what `marked:`, `marked-by:` and `marked-since:` read. */
  pocket(): ReadonlyMap<string, readonly PocketMark[]> {
    const rows = this.database.query(`SELECT block_id AS id, at, author, actor FROM marks m WHERE ${LIVE} AND block_id IS NOT NULL AND reason IS NULL`).all() as { id: string; at: string; author: string; actor: string }[];
    const out = new Map<string, PocketMark[]>();
    for (const row of rows) {
      const list = out.get(row.id) ?? [];
      list.push({ at: Date.parse(row.at), author: row.author, actor: row.actor });
      out.set(row.id, list);
    }
    return out;
  }
}
