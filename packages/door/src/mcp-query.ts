// outline_query (PIE-648): the views' grammar over MCP. The expression is the saved views' (`[query::…]`, virtual
// branches, ::graph-table): `type=outbox-item outbox=next`, `type=ticket NOT work-stage=done`; or a saved view by id.
// The service answers it (`blocks.query`, `views.read`), through the same selection `ep0ch find --query/--view` runs
// (notes-cli.ts's selectNotes): this file pages that answer and turns the ids into block records. No second engine.
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { selectNotes, type NotesBoard } from "./notes-cli";

export const QUERY_LIMIT = { fallback: 20, max: 50 } as const;

export interface QueryAnswer {
  query?: string;
  view?: string;
  limit: number;
  offset: number;
  /** How many blocks the query holds for (up to what the service reads: `truncated` says when it cut). */
  total: number;
  more: boolean;
  nextOffset?: number;
  truncated?: string;
  records: BlockRecord[];
}

/** The view id from an id or `((id))`. */
export const viewIdOf = (v: string) => v.trim().replace(/^\(\((.+?)(\|.*)?\)\)$/, "$1");

/** One page of what a query or a saved view holds, as records, in the order the service gives them. */
export async function queryPage(board: NotesBoard, a: { query?: string; view?: string; limit: number; offset: number }): Promise<QueryAnswer | { error: string }> {
  const picked = await selectNotes(board, { ids: [], words: [], dates: [], ...(a.query ? { query: a.query } : {}), ...(a.view ? { view: viewIdOf(a.view) } : {}) });
  if ("error" in picked) return picked;
  const page = picked.ids.slice(a.offset, a.offset + a.limit);
  const read = page.length ? await board.records(page) : { records: [] as BlockRecord[] };
  const byId = new Map(read.records.map(r => [r.id, r]));
  const more = picked.ids.length > a.offset + a.limit;
  return {
    ...(a.query ? { query: a.query } : {}), ...(a.view ? { view: a.view } : {}),
    limit: a.limit, offset: a.offset, total: picked.ids.length, more, ...(more ? { nextOffset: a.offset + a.limit } : {}),
    ...(picked.truncated ? { truncated: picked.truncated } : {}),
    records: page.flatMap(id => byId.get(id) ?? []),
  };
}
