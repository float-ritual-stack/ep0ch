/*
 * Schema version 2 → 3 (PIE-613): drop the state tables of the removed Inbox agent and note assistance.
 *
 *   bun scripts/migrations/0003-drop-agent-tables.ts <database>
 *
 * Run it on a file no service is serving (stop the outline host, or work on a
 * copy taken with `sqlite3 <db> ".backup <copy>"`). In one transaction it drops
 * inbox_agent_settings, inbox_agent_instructions, inbox_retry_triggers and
 * note_assistance_state, keeps inbox_agent_results and note_assistance_results
 * untouched (they hold the person's original writing, now read-only history), checks
 * that what is left is exactly a new version-3 database's shape, and stamps
 * `PRAGMA user_version = 3`. Anything else rolls back and leaves the file as it was.
 * A version-3 database missing its outline instance id (or holding one that isn't
 * a UUID) is repaired: it gets a fresh one.
 *
 * A one-off: run it on the outlines that matter, then delete it (git keeps it).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { insertOutlineInstanceId, OUTLINE_INSTANCE_ID_KEY, SCHEMA_VERSION } from "../../src/schema";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";
import { freshSchemaShape, schemaDifferences, schemaShape } from "./0001-stamp";

export const DROPPED_TABLES = ["inbox_agent_settings", "inbox_agent_instructions", "inbox_retry_triggers", "note_assistance_state"] as const;

const instanceId = (database: Database): string | undefined => {
  const row = database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_INSTANCE_ID_KEY) as { value: string } | null;
  return row && BLOCK_ID_PATTERN.test(row.value) ? row.value.toLowerCase() : undefined;
};

export function migrate(path: string): { migrated: boolean; repaired?: boolean; outlineInstanceId: string } {
  if (SCHEMA_VERSION !== 3) throw new Error(`This script upgrades to version 3; the schema is now version ${SCHEMA_VERSION}`);
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  // The owner lock every store takes: refused (already owned) while a service serves the file.
  const release = acquireWorkspaceOwnership(path);
  const database = new Database(path, { create: false, readwrite: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const { user_version: version } = database.query("PRAGMA user_version").get() as { user_version: number };
    if (version === 3) {
      const existing = instanceId(database);
      if (existing) return { migrated: false, outlineInstanceId: existing };
      return { migrated: false, repaired: true, outlineInstanceId: insertOutlineInstanceId(database) };
    }
    if (version !== 2) throw new Error(`${path} is schema version ${version}, not 2`);
    let outlineInstanceId = "";
    database.transaction(() => {
      for (const table of DROPPED_TABLES) database.exec(`DROP TABLE IF EXISTS ${table}`);
      const differences = schemaDifferences(schemaShape(database), freshSchemaShape());
      if (differences.length > 0) {
        throw new Error(`${path} does not match schema version 2, so it was not migrated:\n- ${differences.join("\n- ")}`);
      }
      outlineInstanceId = instanceId(database) ?? insertOutlineInstanceId(database);
      database.exec("PRAGMA user_version = 3");
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
    console.error("Usage: bun scripts/migrations/0003-drop-agent-tables.ts <database>   (a file no service is serving)");
    process.exit(2);
  }
  try {
    const { migrated, repaired, outlineInstanceId } = migrate(path);
    console.log(`${path}: ${migrated ? "migrated to schema version 3" : repaired ? "schema version 3, given its missing instance id" : "already schema version 3"} · outlineInstanceId ${outlineInstanceId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
