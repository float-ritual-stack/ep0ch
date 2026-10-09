// outline_query (PIE-648): the views' grammar over MCP. The expression is the saved views' (`[query::…]`, virtual
// branches, ::graph-table): `type=outbox-item outbox=next`, `type=ticket NOT work-stage=done`; or a saved view by id.
// The service answers it (`blocks.query`, `views.read`), through the same selection `ep0ch find --query/--view` runs
// (notes-cli.ts's selectNotes): this file pages that answer and turns the ids into block records. No second engine.
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { pathsOf, selectNotes, type NotesBoard } from "./notes-cli";
import { foldIds, type Changes, type FoldedRow } from "./mcp-orient";

export const QUERY_LIMIT = { fallback: 20, max: 50 } as const;

export interface QueryRow { record: BlockRecord; changes?: Changes; path?: string }

export interface QueryAnswer {
  query?: string;
  view?: string;
  under?: string;
  sort?: string;
  limit: number;
  offset: number;
  /** How many rows the query holds for (up to what the service reads: `truncated` says when it cut); folded rows count once. */
  total: number;
  /** With `fold`: how many blocks matched before the derived ones were folded into their notes. */
  foldedFrom?: number;
  more: boolean;
  nextOffset?: number;
  truncated?: string;
  rows: QueryRow[];
}

/** The view id from an id or `((id))`. */
export const viewIdOf = (v: string) => v.trim().replace(/^\(\((.+?)(\|.*)?\)\)$/, "$1");

export interface QueryAsk {
  query?: string; view?: string; limit: number; offset: number;
  /** The service orders the rows (`blocks.query`'s sort); a saved view has its own order. */
  sort?: { field: string; direction: "asc" | "desc" };
  /** A note's id: only the blocks under it (the service's subtreeRootId). */
  under?: string;
  fold?: boolean;
  /** Rows carry their path (the ancestors' titles). */
  path?: boolean;
}

/** The CLI's words for the same selection mean nothing to a tool caller. */
const inTool = (why: string) => why.replace(/--sort/g, "sort").replace(/--direction/g, "direction").replace(/--under/g, "under").replace(/\n\s+\(.*lists them\)|\n\s+the grammar is.*$/gs, "");

/** One page of what a query or a saved view holds, in the order the service gives them, as records. */
export async function queryPage(board: NotesBoard, a: QueryAsk): Promise<QueryAnswer | { error: string }> {
  const picked = await selectNotes(board, {
    ids: [], words: [], dates: [], ...(a.query ? { query: a.query } : {}), ...(a.view ? { view: viewIdOf(a.view) } : {}),
    ...(a.sort ? { sort: a.sort.field, direction: a.sort.direction } : {}), ...(a.under ? { under: a.under } : {}),
  });
  if ("error" in picked) return { error: inTool(picked.error) };
  const index = a.fold || a.path ? await board.index() : null;
  const folded = a.fold && index ? foldIds(picked.ids, index) : picked.ids.map((id): FoldedRow => ({ id }));
  const page = folded.slice(a.offset, a.offset + a.limit);
  const read = page.length ? await board.records(page.map(r => r.id)) : { records: [] as BlockRecord[] };
  const byId = new Map(read.records.map(r => [r.id, r]));
  const pathOf = a.path && index ? pathsOf(index) : null;
  const at = new Map((index ?? []).map(b => [b.id, b]));
  const more = folded.length > a.offset + a.limit;
  return {
    ...(a.query ? { query: a.query } : {}), ...(a.view ? { view: a.view } : {}), ...(a.under ? { under: a.under } : {}),
    ...(a.sort ? { sort: `${a.sort.field} ${a.sort.direction}` } : {}),
    limit: a.limit, offset: a.offset, total: folded.length, ...(a.fold ? { foldedFrom: picked.ids.length } : {}),
    more, ...(more ? { nextOffset: a.offset + a.limit } : {}),
    ...(picked.truncated ? { truncated: picked.truncated } : {}),
    rows: page.flatMap(f => {
      const record = byId.get(f.id);
      return record ? [{ record, ...(f.changes ? { changes: f.changes } : {}), ...(pathOf && at.get(f.id) ? { path: pathOf(at.get(f.id)!) } : {}) }] : [];
    }),
  };
}
