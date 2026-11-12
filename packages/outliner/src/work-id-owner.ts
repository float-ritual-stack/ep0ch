// A Work ID by its number (PIE-1761): GATE-1 and GATE-001 are one ticket, however a note's chip writes it. The
// store's page addresses hold only canonical ids of the allocator's prefix; this finds the rest, read when those miss.
import type { Database } from "bun:sqlite";
import { parseWorkId } from "@ep0ch/outline-core/work-ids";

/** The id of the note whose block-scope `[work-id::]` parses to `workId`'s number, live first, else the oldest; or null. */
export function workIdOwner(database: Database, workId: string): string | null {
  const wanted = parseWorkId(workId);
  if (!wanted) return null;
  const rows = database.query(`SELECT property.block_id AS id, property.value FROM block_properties property JOIN blocks block ON block.id = property.block_id
    WHERE property.scope = 'block' AND property.key = 'work-id' AND upper(trim(property.value)) LIKE ?
    ORDER BY block.effective_deleted_root_id IS NOT NULL, block.created_at, block.id`).all(`${wanted.prefix}-%`) as Array<{ id: string; value: string }>;
  return rows.find(row => parseWorkId(row.value)?.workId === wanted.workId)?.id ?? null;
}
