/*
 * Schema version 1 → 2 (PIE-559): give an existing outline database an instance identity.
 *
 *   bun scripts/migrations/0002-outline-instance-id.ts <database>
 *
 * Run it on a file no service is serving (stop the outline host, or work on a
 * copy taken with `sqlite3 <db> ".backup <copy>"`). It inserts one random UUID
 * in metadata as `outline_instance_id` and stamps `PRAGMA user_version = 2`.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { insertOutlineInstanceId, readOutlineInstanceId, SCHEMA_VERSION } from "../../src/schema";
import { freshSchemaShape, schemaDifferences, schemaShape } from "./0001-stamp";
export function migrate(path: string): { migrated: boolean; outlineInstanceId: string } {
  if (SCHEMA_VERSION !== 2) throw new Error(`This script upgrades to version 2; the schema is now version ${SCHEMA_VERSION}`);
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  const database = new Database(path, { create: false, readwrite: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const { user_version: version } = database.query("PRAGMA user_version").get() as { user_version: number };
    if (version === 2) return { migrated: false, outlineInstanceId: readOutlineInstanceId(database, path) };
    if (version !== 1) throw new Error(`${path} is schema version ${version}, not 1`);
    const differences = schemaDifferences(schemaShape(database), freshSchemaShape());
    if (differences.length > 0) {
      throw new Error(`${path} does not match schema version 1, so it was not migrated:\n- ${differences.join("\n- ")}`);
    }
    let outlineInstanceId = "";
    database.transaction(() => {
      outlineInstanceId = insertOutlineInstanceId(database);
      database.exec("PRAGMA user_version = 2");
    })();
    return { migrated: true, outlineInstanceId };
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    console.error("Usage: bun scripts/migrations/0002-outline-instance-id.ts <database>   (a file no service is serving)");
    process.exit(2);
  }
  try {
    const { migrated, outlineInstanceId } = migrate(path);
    console.log(migrated ? `${path}: migrated to schema version 2 · outlineInstanceId ${outlineInstanceId}` : `${path}: already schema version 2 · outlineInstanceId ${outlineInstanceId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
