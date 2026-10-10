/*
 * Schema version 4 → 5: Resource providers open to extensions. A Resource's provider is a built-in one or an
 * extension's, `ext:<id>` (any extension with a `kind: "resource"` handler), where version 4 allowed only `jira` among
 * the remote ones. Jira moves onto it as `ext:jira`, with nothing lost: its Sources, Resources, snapshots and every
 * stored reference to one keep their ids and rows, renamed from `jira` to `ext:jira`.
 *
 *   bun scripts/migrations/0005-extension-providers.ts <database>
 *
 * Run it on a file no service is serving (stop the outline host, or work on a copy taken with
 * `sqlite3 <db> ".backup <copy>"`); `ep0ch install --apply` runs it itself. In one transaction it checks the file is
 * exactly a version-4 database's shape, rebuilds the three tables whose provider check changed (`resource_sources`,
 * `resources`, `remote_entity_source_snapshots`: SQLite can't alter a check) with their rows, renames `jira` to
 * `ext:jira` in their provider columns and in every stored JSON that names it (`"kind":"jira"`, `"provider":"jira"`),
 * checks the foreign keys and the new shape, and stamps `PRAGMA user_version = 5`. Anything else rolls back and leaves
 * the file as it was. A version-5 database missing its outline instance id (or holding one that isn't a UUID) is
 * repaired: it gets a fresh one.
 *
 * A one-off: run it on the outlines that matter, then delete it (git keeps it).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import {
  insertOutlineInstanceId, OUTLINE_INSTANCE_ID_KEY, REMOTE_ENTITY_PROVIDER_CHECK, RESOURCE_PROVIDER_CHECK, SCHEMA_SQL, SCHEMA_VERSION,
} from "../../src/schema";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";
import { freshSchemaShape, schemaDifferences, schemaShape, type SchemaShape } from "./0001-stamp";

/** The tables whose provider check version 5 changed, parents first. */
export const REBUILT_TABLES = ["resource_sources", "resources", "remote_entity_source_snapshots"] as const;

/** Version 4's checks, as its schema wrote them. */
const V4_RESOURCE_CHECK = "CHECK (provider IN ('filesystem', 'web', 'github', 'application', 'jira', 'linear', 'computed'))";
const V4_REMOTE_ENTITY_CHECK = "CHECK (provider IN ('jira', 'linear'))";

/** The schema at version 4: this one with the provider checks as they were. */
export const SCHEMA_SQL_4 = SCHEMA_SQL.replaceAll(RESOURCE_PROVIDER_CHECK, V4_RESOURCE_CHECK).replaceAll(REMOTE_ENTITY_PROVIDER_CHECK, V4_REMOTE_ENTITY_CHECK);

/** A version-4 database's shape. */
export function shapeAt4(): SchemaShape {
  const database = new Database(":memory:");
  try {
    database.exec(SCHEMA_SQL_4);
    return schemaShape(database);
  } finally {
    database.close();
  }
}

/** What a new database at version 5 says for these tables: their CREATE TABLE, and their indexes' CREATE INDEX. */
function freshDefinitions(): Map<string, { table: string; indexes: string[] }> {
  const database = new Database(":memory:");
  try {
    database.exec(SCHEMA_SQL);
    return new Map(REBUILT_TABLES.map((table) => {
      const rows = database.query("SELECT type, sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL").all(table) as Array<{ type: string; sql: string }>;
      return [table, { table: rows.find((row) => row.type === "table")!.sql, indexes: rows.filter((row) => row.type === "index").map((row) => row.sql) }];
    }));
  } finally {
    database.close();
  }
}

const instanceId = (database: Database): string | undefined => {
  const row = database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_INSTANCE_ID_KEY) as { value: string } | null;
  return row && BLOCK_ID_PATTERN.test(row.value) ? row.value.toLowerCase() : undefined;
};

/** How many rows each step renamed: `<table>.provider` and `<table>.<column>` for a JSON column. */
export type Renamed = Record<string, number>;

export function migrate(path: string): { migrated: boolean; repaired?: boolean; outlineInstanceId: string; renamed?: Renamed } {
  if (SCHEMA_VERSION !== 5) throw new Error(`This script upgrades to version 5; the schema is now version ${SCHEMA_VERSION}`);
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  // The owner lock every store takes: refused (already owned) while a service serves the file.
  const release = acquireWorkspaceOwnership(path);
  const database = new Database(path, { create: false, readwrite: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const { user_version: version } = database.query("PRAGMA user_version").get() as { user_version: number };
    if (version === 5) {
      const existing = instanceId(database);
      if (existing) return { migrated: false, outlineInstanceId: existing };
      return { migrated: false, repaired: true, outlineInstanceId: insertOutlineInstanceId(database) };
    }
    if (version !== 4) throw new Error(`${path} is schema version ${version}, not 4`);
    // A table is rebuilt by renaming it away: other tables' foreign keys keep naming it (legacy rename), and aren't
    // checked until the rows are back.
    database.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;");
    const definitions = freshDefinitions();
    const renamed: Renamed = {};
    let outlineInstanceId = "";
    database.transaction(() => {
      const differences = schemaDifferences(schemaShape(database), shapeAt4());
      if (differences.length > 0) {
        throw new Error(`${path} does not match schema version 4, so it was not migrated:\n- ${differences.join("\n- ")}`);
      }
      for (const table of REBUILT_TABLES) {
        const { table: create, indexes } = definitions.get(table)!;
        const columns = (database.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => `"${column.name}"`);
        renamed[`${table}.provider`] = (database.query(`SELECT COUNT(*) AS n FROM "${table}" WHERE provider = 'jira'`).get() as { n: number }).n;
        database.exec(`ALTER TABLE "${table}" RENAME TO "${table}__v4"`);
        database.exec(create);
        const values = columns.map((column) => column === '"provider"' ? "CASE WHEN provider = 'jira' THEN 'ext:jira' ELSE provider END" : column);
        database.exec(`INSERT INTO "${table}" (${columns.join(", ")}) SELECT ${values.join(", ")} FROM "${table}__v4"`);
        database.exec(`DROP TABLE "${table}__v4"`);
        for (const index of indexes) database.exec(index);
      }
      // Every stored JSON that names Jira as a provider or an address, revision or reference kind.
      const tables = (database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((row) => row.name);
      for (const table of tables) {
        for (const { name } of database.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>) {
          if (!name.endsWith("_json")) continue;
          const changed = database.query(`UPDATE "${table}" SET "${name}" = replace(replace("${name}", '"kind":"jira"', '"kind":"ext:jira"'), '"provider":"jira"', '"provider":"ext:jira"')
            WHERE "${name}" LIKE '%"kind":"jira"%' OR "${name}" LIKE '%"provider":"jira"%'`).run().changes;
          if (changed) renamed[`${table}.${name}`] = changed;
        }
      }
      const broken = database.query("PRAGMA foreign_key_check").all();
      if (broken.length) throw new Error(`${path}: ${broken.length} rows would break a foreign key, so it was not migrated`);
      const after = schemaDifferences(schemaShape(database), freshSchemaShape());
      if (after.length > 0) throw new Error(`${path} would not match schema version 5, so it was not migrated:\n- ${after.join("\n- ")}`);
      outlineInstanceId = instanceId(database) ?? insertOutlineInstanceId(database);
      database.exec("PRAGMA user_version = 5");
    })();
    return { migrated: true, outlineInstanceId, renamed };
  } finally {
    database.close();
    release();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    console.error("Usage: bun scripts/migrations/0005-extension-providers.ts <database>   (a file no service is serving)");
    process.exit(2);
  }
  try {
    const { migrated, repaired, outlineInstanceId, renamed } = migrate(path);
    const counts = renamed && Object.keys(renamed).length ? ` · renamed jira → ext:jira: ${Object.entries(renamed).map(([at, n]) => `${at} ${n}`).join(", ")}` : "";
    console.log(`${path}: ${migrated ? "migrated to schema version 5" : repaired ? "schema version 5, given its missing instance id" : "already schema version 5"}${counts} · outlineInstanceId ${outlineInstanceId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
