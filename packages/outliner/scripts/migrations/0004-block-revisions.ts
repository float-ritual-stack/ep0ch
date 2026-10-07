/*
 * Schema version 3 → 4 (PIE-621): add `block_revisions`, the earlier texts of blocks, so a saved note can go back
 * (`block.revisions`, `ep0ch revisions`). Notes keep no history from before it: the first save after it keeps the
 * text it replaced, and every save after.
 *
 *   bun scripts/migrations/0004-block-revisions.ts <database>
 *
 * Run it on a file no service is serving (stop the outline host, or work on a copy taken with
 * `sqlite3 <db> ".backup <copy>"`); `ep0ch install --apply` runs it itself. In one transaction it checks the file is
 * exactly a version-3 database's shape, creates the table and stamps `PRAGMA user_version = 4`. Anything else rolls
 * back and leaves the file as it was. A version-4 database missing its outline instance id (or holding one that isn't
 * a UUID) is repaired: it gets a fresh one.
 *
 * A one-off: run it on the outlines that matter, then delete it (git keeps it).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { insertOutlineInstanceId, OUTLINE_INSTANCE_ID_KEY, SCHEMA_VERSION } from "../../src/schema";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";
import { freshSchemaShape, schemaDifferences, schemaShape, type SchemaShape } from "./0001-stamp";

/** What version 4 added: version 3's shape is the current one without these. */
export const ADDED_TABLES = ["block_revisions"] as const;

export const BLOCK_REVISIONS_SQL = `
  CREATE TABLE IF NOT EXISTS block_revisions (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    text TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    author TEXT,
    actor_id TEXT,
    replaced_at TEXT NOT NULL,
    PRIMARY KEY (block_id, revision)
  );
`;

/** A version-3 database's shape: a new database's at this checkout, without what version 4 added. */
export function shapeAt3(): SchemaShape {
  const shape = freshSchemaShape();
  for (const table of ADDED_TABLES) delete shape[`table ${table}`];
  return shape;
}

const instanceId = (database: Database): string | undefined => {
  const row = database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_INSTANCE_ID_KEY) as { value: string } | null;
  return row && BLOCK_ID_PATTERN.test(row.value) ? row.value.toLowerCase() : undefined;
};

export function migrate(path: string): { migrated: boolean; repaired?: boolean; outlineInstanceId: string } {
  if (SCHEMA_VERSION !== 4) throw new Error(`This script upgrades to version 4; the schema is now version ${SCHEMA_VERSION}`);
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  // The owner lock every store takes: refused (already owned) while a service serves the file.
  const release = acquireWorkspaceOwnership(path);
  const database = new Database(path, { create: false, readwrite: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const { user_version: version } = database.query("PRAGMA user_version").get() as { user_version: number };
    if (version === 4) {
      const existing = instanceId(database);
      if (existing) return { migrated: false, outlineInstanceId: existing };
      return { migrated: false, repaired: true, outlineInstanceId: insertOutlineInstanceId(database) };
    }
    if (version !== 3) throw new Error(`${path} is schema version ${version}, not 3`);
    let outlineInstanceId = "";
    database.transaction(() => {
      const differences = schemaDifferences(schemaShape(database), shapeAt3());
      if (differences.length > 0) {
        throw new Error(`${path} does not match schema version 3, so it was not migrated:\n- ${differences.join("\n- ")}`);
      }
      database.exec(BLOCK_REVISIONS_SQL);
      const after = schemaDifferences(schemaShape(database), freshSchemaShape());
      if (after.length > 0) throw new Error(`${path} would not match schema version 4, so it was not migrated:\n- ${after.join("\n- ")}`);
      outlineInstanceId = instanceId(database) ?? insertOutlineInstanceId(database);
      database.exec("PRAGMA user_version = 4");
    })();
    return { migrated: true, outlineInstanceId };
  } finally {
    database.close();
    release();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    console.error("Usage: bun scripts/migrations/0004-block-revisions.ts <database>   (a file no service is serving)");
    process.exit(2);
  }
  try {
    const { migrated, repaired, outlineInstanceId } = migrate(path);
    console.log(`${path}: ${migrated ? "migrated to schema version 4" : repaired ? "schema version 4, given its missing instance id" : "already schema version 4"} · outlineInstanceId ${outlineInstanceId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
