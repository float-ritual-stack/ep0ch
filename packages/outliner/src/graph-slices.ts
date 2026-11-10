// The store's graph, the parts that aren't its own reads. The rows a page at a time, with a chance for anyone else to run
// between pages (PIE-1610): the whole read holds the loop half a second on pie, and every outline's open pays it. And what
// tells a later read which blocks to read again.
import type { Database } from "bun:sqlite";

export const PROPERTY_COLUMNS = "block_id, key, value, ordinal, raw, start, end, line, column, placement, scope, syntax";
const SLICE = 1000;

interface Row { id: string; position: number; created_at: string }
interface PropertyRow { block_id: string; ordinal: number }
/** SQLite's BINARY order for the ASCII ids and timestamps a block row holds. */
export const compareBinary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `add` gets each slice's blocks with their properties, in the order a whole read has them. */
export async function readGraphRowsInSlices<R extends Row, P extends PropertyRow>(database: Database, pass: () => Promise<void>, add: (rows: R[], properties: P[]) => void): Promise<void> {
  const rows: R[] = [];
  for (let after = "";;) {
    const page = database.query("SELECT * FROM blocks WHERE id > ? ORDER BY id LIMIT ?").all(after, SLICE) as R[];
    for (const row of page) rows.push(row);
    if (page.length < SLICE) break;
    after = page.at(-1)!.id;
    await pass();
  }
  rows.sort((a, b) => a.position - b.position || compareBinary(a.created_at, b.created_at) || compareBinary(a.id, b.id));
  await pass();
  const propertiesOf = new Map<string, P[]>();
  for (let block = "", ordinal = -1;;) {
    const page = database.query(`SELECT ${PROPERTY_COLUMNS} FROM block_properties WHERE (block_id, ordinal) > (?, ?) ORDER BY block_id, ordinal LIMIT ?`).all(block, ordinal, SLICE) as P[];
    for (const row of page) {
      const held = propertiesOf.get(row.block_id);
      if (held) held.push(row); else propertiesOf.set(row.block_id, [row]);
    }
    if (page.length < SLICE) break;
    ({ block_id: block, ordinal } = page.at(-1)!);
    await pass();
  }
  for (let at = 0; at < rows.length; at += SLICE) {
    await pass();
    const slice = rows.slice(at, at + SLICE);
    add(slice, slice.flatMap(row => propertiesOf.get(row.id) ?? []));
  }
}

/** Notes, per connection, which blocks a write touched: what `loadGraph` reads again (TEMP, never in the file). */
export function noteGraphWrites(database: Database): void {
  const note = (id: string) => `INSERT OR IGNORE INTO graph_dirty (block_id) VALUES (${id});`; // never temp.graph_dirty: macOS SQLite refuses a qualified name in a trigger
  database.exec(`
    CREATE TEMP TABLE IF NOT EXISTS graph_dirty (block_id TEXT PRIMARY KEY) WITHOUT ROWID;
    CREATE TEMP TRIGGER IF NOT EXISTS graph_dirty_block_insert AFTER INSERT ON main.blocks BEGIN ${note("NEW.id")} END;
    CREATE TEMP TRIGGER IF NOT EXISTS graph_dirty_block_update AFTER UPDATE ON main.blocks BEGIN ${note("NEW.id")} ${note("OLD.id")} END;
    CREATE TEMP TRIGGER IF NOT EXISTS graph_dirty_block_delete AFTER DELETE ON main.blocks BEGIN ${note("'*'")} END;
    CREATE TEMP TRIGGER IF NOT EXISTS graph_dirty_property_insert AFTER INSERT ON main.block_properties BEGIN ${note("NEW.block_id")} END;
    CREATE TEMP TRIGGER IF NOT EXISTS graph_dirty_property_update AFTER UPDATE ON main.block_properties BEGIN ${note("NEW.block_id")} ${note("OLD.block_id")} END;
    CREATE TEMP TRIGGER IF NOT EXISTS graph_dirty_property_delete AFTER DELETE ON main.block_properties BEGIN ${note("OLD.block_id")} END;
  `);
}

/**
 * What a selection reads (PIE-1691): the note, its ancestors root first, and its children: the trashed ones only when
 * the note is itself in Trash. The one rule for the store's read of the selection and its graph's (a workspace snapshot).
 */
export function selectionContext<B extends { id: string; parentId: string | null; effectiveDeletedRootId?: string }>(
  selected: B | null, byId: (id: string) => B | null, children: (id: string, withTrashed: boolean) => B[],
): { selected: B | null; ancestors: B[]; children: B[] } {
  if (!selected) return { selected: null, ancestors: [], children: [] };
  const ancestors: B[] = [];
  for (let parent = selected.parentId ? byId(selected.parentId) : null; parent; parent = parent.parentId ? byId(parent.parentId) : null) {
    ancestors.unshift(parent);
  }
  return { selected, ancestors, children: children(selected.id, Boolean(selected.effectiveDeletedRootId)) };
}
