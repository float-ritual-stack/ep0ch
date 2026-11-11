// A note as the native app draws it: the service's page (`notes.page`: the title, the chips and the body as parts,
// every component already answered) with what the window shows around it: where the note sits, its children, what
// links to it. Nothing is parsed here.
import type { SocketBoard } from "@ep0ch/door/src/socket";
import type { NotePage } from "@ep0ch/outline-core/note-page";

/** A note in a list: a child, a backlink, a search match, a query's row. */
export interface Row { id: string; title: string; hasChildren?: boolean; context?: string; snippet?: string; props?: Record<string, string> }

export interface Page extends NotePage {
  id: string;
  path: string;
  /** Every property the note carries, as the service read them (the header's and the body's). */
  properties: { key: string; value: string }[];
  updated: string;
  author: string;
  children: Row[];
  backlinks: Row[];
}

/** The page of `id`, read now. */
export async function page(board: SocketBoard, id: string): Promise<Page> {
  const [read, { records, unavailable }, back] = await Promise.all([
    board.request("notes.page", { blockId: id }),
    board.records([id]),
    board.backlinks(id, 50).catch(() => null),
  ]);
  const record = records[0];
  if (!record) throw new Error(unavailable[0]?.status === "trashed" ? `${id} is in the Trash` : `no note ${id}`);
  const kids = record.children.length ? (await board.request("blocks.read", { ids: record.children, fields: ["id", "title", "hasChildren"] })).blocks : [];
  return {
    ...read, id: read.blockId, path: record.path ?? "",
    properties: record.properties.flatMap(p => p.values.map(value => ({ key: p.key, value }))),
    updated: record.updated, author: record.actor ?? record.author,
    children: kids.map(b => ({ id: b.id, title: b.title ?? "(untitled)", hasChildren: !!b.hasChildren })),
    backlinks: (back?.sources ?? []).filter(s => s.blockId !== id).map(s => ({ id: s.blockId, title: s.title, context: s.parentContext })),
  };
}
