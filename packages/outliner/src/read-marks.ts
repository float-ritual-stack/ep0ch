// What each reader has read (PIE-708): a seen set per actor of `id@revision`, in `read_marks`. Unread is no mark;
// updated since read is a mark at a lower revision. The person reads as `user` (the door, the web client and the CLI
// all read as them); an agent as its actor id. Marks are bookkeeping, not content: setting one never changes a block.
//
// What reads them: the query grammar's `unread:<reader>` (a view of unread replies), and `thread:<reader>`, the
// comments and replies in the threads a reader started or wrote in (Recent replies, the capability "Conversations in
// the margin"). Opening a thread marks it read (`annotations.read`): its comment and every reply, at their revisions.
import type { Database } from "bun:sqlite";
import { ANNOTATION_REPLY_TYPE, ANNOTATION_TYPE } from "./annotations";
import { PERSON_READER } from "./block-query";

/** A reader: `user` for the person, else an agent's actor id. */
const READER = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

export function readerKey(reader: unknown): string {
  if (typeof reader !== "string" || !READER.test(reader)) throw new Error(`a reader is user (the person) or an agent's actor id, not ${JSON.stringify(reader)}`);
  return reader;
}

export class ReadMarks {
  constructor(private readonly database: Database, private readonly now: () => string = () => new Date().toISOString()) {}

  /** Marks `blockIds` read by `reader` at their current revisions (a trashed or unknown id is skipped). How many were marked. */
  mark(reader: string, blockIds: readonly string[]): number {
    const key = readerKey(reader);
    const at = this.now();
    const write = this.database.query(`
      INSERT INTO read_marks (actor, block_id, revision, read_at)
      SELECT ?, id, revision, ? FROM blocks WHERE id = ? AND effective_deleted_root_id IS NULL
      ON CONFLICT (actor, block_id) DO UPDATE SET revision = excluded.revision, read_at = excluded.read_at
    `);
    let marked = 0;
    this.database.transaction(() => {
      for (const id of new Set(blockIds)) marked += write.run(key, at, id).changes > 0 ? 1 : 0;
    })();
    return marked;
  }

  /** A thread's comment and its replies, by its comment's id (or a reply's: its thread). */
  threadOf(annotationId: string): { root: string; ids: string[] } {
    const parent = this.database.query(`SELECT value FROM block_properties WHERE block_id = ? AND key = 'parent-annotation' LIMIT 1`).get(annotationId) as { value: string } | null;
    const root = parent?.value ?? annotationId;
    const replies = this.database.query(`
      SELECT p.block_id AS id FROM block_properties p JOIN blocks b ON b.id = p.block_id
      WHERE p.key = 'parent-annotation' AND p.value = ? AND b.effective_deleted_root_id IS NULL
    `).all(root) as { id: string }[];
    return { root, ids: [root, ...replies.map((row) => row.id)] };
  }

  /** The revision `reader` last read each block at. */
  revisions(reader: string): ReadonlyMap<string, number> {
    const rows = this.database.query("SELECT block_id AS id, revision FROM read_marks WHERE actor = ?").all(reader) as { id: string; revision: number }[];
    return new Map(rows.map((row) => [row.id, row.revision]));
  }

  /**
   * The comments and replies of every thread `reader` started or wrote in: the person by what they wrote (`author`
   * user), an agent by its actor id.
   */
  threadBlocks(reader: string): ReadonlySet<string> {
    const who = reader === PERSON_READER ? "b.author = 'user'" : "b.actor_id = ?";
    const args = reader === PERSON_READER ? [] : [reader, reader];
    const rows = this.database.query(`
      WITH mine(root) AS (
        SELECT b.id FROM blocks b JOIN block_properties t ON t.block_id = b.id AND t.key = 'type' AND t.value = '${ANNOTATION_TYPE}'
        WHERE ${who}
        UNION
        SELECT p.value FROM blocks b
          JOIN block_properties t ON t.block_id = b.id AND t.key = 'type' AND t.value = '${ANNOTATION_REPLY_TYPE}'
          JOIN block_properties p ON p.block_id = b.id AND p.key = 'parent-annotation'
        WHERE ${who}
      )
      SELECT root AS id FROM mine
      UNION
      SELECT p.block_id FROM block_properties p JOIN mine ON p.value = mine.root WHERE p.key = 'parent-annotation'
    `).all(...args) as { id: string }[];
    return new Set(rows.map((row) => row.id));
  }
}
