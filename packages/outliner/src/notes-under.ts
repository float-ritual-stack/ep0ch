// What is under a block, as the store answers it on a row. Two readings, kept side by side so neither is mistaken
// for the other:
//
// - **Any block** (`hasChildren`, `HAS_CHILDREN`): at least one block under it outside Trash. A list of every block
//   draws its fold from it (the Herdr Tree, an agent's read of a subtree, the door's outline): a comment on the note
//   and an edit proposed beside it are rows there, so they count.
// - **A note** (`hasNotes`, `notesUnder`): at least one of those blocks is a note of it, by the one reading of "the
//   notes under a note", outline-core's `isNoteUnder` (a comment, a reply in its thread and a proposed edit are
//   none). A list that leaves those blocks out (`lists.read`'s tree and matches, `notes.page`'s rows) draws its fold
//   from this, so a fold never opens onto nothing.
//
// The store asks both for the rows a read names (`readBlocks`, `queryProjectedBlocks`); nothing else decides either.
import type { Database } from "bun:sqlite";
import { isNoteUnder } from "@ep0ch/outline-core/derived";

/** The column a block's row carries for "any block under it outside Trash", for a read whose row is `block`. */
export const HAS_CHILDREN = `EXISTS (
            SELECT 1 FROM blocks child
            WHERE child.parent_id = block.id AND child.effective_deleted_root_id IS NULL
          ) AS has_children`;

/**
 * Which of `ids` have a note under them outside Trash. One look for all of them: each block's children by the `type`
 * a list reads off a block (its first block-scoped `type` property, as `properties.find` meets it), kept when
 * `isNoteUnder` says that type is a note's.
 */
export function notesUnder(database: Database, ids: readonly string[]): Set<string> {
  const noted = new Set<string>();
  if (!ids.length) return noted;
  const rows = database.query(`
    SELECT DISTINCT child.parent_id AS parent, (
      SELECT property.value FROM block_properties property
      WHERE property.block_id = child.id AND property.scope = 'block' AND property.key = 'type'
      ORDER BY property.ordinal LIMIT 1
    ) AS type
    FROM blocks child
    WHERE child.parent_id IN (SELECT value FROM json_each(?)) AND child.effective_deleted_root_id IS NULL
  `).all(JSON.stringify(ids)) as { parent: string; type: string | null }[];
  for (const row of rows) if (isNoteUnder(row.type)) noted.add(row.parent);
  return noted;
}
