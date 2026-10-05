/*
 * Schema version 0 → current (PIE-530/PIE-559): stamps a database made before schema versions,
 * once its shape is checked to be exactly what a new database at this checkout's version gets.
 *
 *   bun scripts/migrations/0001-stamp.ts <database>
 *
 * Run it on a file no service is serving (stop the outline host, or work on a
 * copy taken with `sqlite3 <db> ".backup <copy>"`). It inserts the current metadata
 * rows that are not represented by shape, then stamps `PRAGMA user_version`, and refuses
 * when the shape differs: a table, column, key, check, unique constraint, index or trigger
 * missing, extra or changed. Column order and SQL formatting don't count
 * (`ALTER TABLE … ADD COLUMN` appends where a new table has the column in place).
 *
 * A one-off: run it on the outlines that matter, then delete it (git keeps it).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { insertOutlineInstanceId, readOutlineInstanceId, SCHEMA_SQL, SCHEMA_VERSION } from "../../src/schema";

/** One table, index or trigger, reduced to what it means: no formatting, no column order. */
export type SchemaShape = Record<string, string>;

const squeeze = (text: string) => text.replace(/\s+/g, "").toLowerCase();

/** The `CHECK (…)` expressions in a table's SQL, each with balanced parentheses, whitespace removed. */
function checkExpressions(sql: string): string[] {
  const checks: string[] = [];
  const pattern = /\bCHECK\s*\(/gi;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
    let depth = 1;
    let index = match.index + match[0].length;
    for (; index < sql.length && depth > 0; index += 1) {
      if (sql[index] === "(") depth += 1;
      else if (sql[index] === ")") depth -= 1;
    }
    checks.push(squeeze(sql.slice(match.index + match[0].length, index - 1)));
  }
  return checks.sort();
}

/** The database's tables (columns as a set, keys, checks, unique constraints), indexes and triggers. */
export function schemaShape(database: Database): SchemaShape {
  const shape: SchemaShape = {};
  const objects = database.query(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  ).all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  for (const object of objects) {
    const name = object.name.replaceAll('"', '""');
    if (object.type === "table") {
      const columns = (database.query(`PRAGMA table_xinfo("${name}")`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }>)
        .map(column => `${column.name} ${column.type} notnull=${column.notnull} default=${column.dflt_value} pk=${column.pk} hidden=${column.hidden}`).sort();
      const keys = (database.query(`PRAGMA foreign_key_list("${name}")`).all() as Array<{ from: string; table: string; to: string | null; on_update: string; on_delete: string }>)
        .map(key => `${key.from}->${key.table}.${key.to} update=${key.on_update} delete=${key.on_delete}`).sort();
      const constraints = (database.query(`PRAGMA index_list("${name}")`).all() as Array<{ name: string; unique: number; origin: string }>)
        .filter(index => index.origin !== "c")
        .map(index => `${index.origin} unique=${index.unique} (${(database.query(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`).all() as Array<{ name: string }>).map(column => column.name).join(", ")})`).sort();
      shape[`table ${object.name}`] = JSON.stringify({ columns, keys, constraints, checks: checkExpressions(object.sql ?? ""), autoincrement: /AUTOINCREMENT/i.test(object.sql ?? "") });
    } else if (object.type === "index") {
      if (object.sql === null) continue;
      shape[`index ${object.name}`] = `${object.tbl_name}: ${squeeze(object.sql.replace(/\bIF\s+NOT\s+EXISTS\b/i, ""))}`;
    } else {
      shape[`${object.type} ${object.name}`] = squeeze((object.sql ?? "").replace(/\bIF\s+NOT\s+EXISTS\b/i, ""));
    }
  }
  return shape;
}

/** How `actual` differs from `expected`, one line per object. */
export function schemaDifferences(actual: SchemaShape, expected: SchemaShape): string[] {
  const differences: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) {
      differences.push(`${key} is missing`);
    } else if (actual[key] !== value) {
      differences.push(`${key} differs: has ${actual[key]}, expected ${value}`);
    }
  }
  for (const key of Object.keys(actual)) if (!(key in expected)) differences.push(`${key} is not in the schema`);
  return differences;
}

/** What a new database at the current schema version looks like. */
export function freshSchemaShape(): SchemaShape {
  const database = new Database(":memory:");
  try {
    database.exec(SCHEMA_SQL);
    return schemaShape(database);
  } finally {
    database.close();
  }
}

/** Stamps `path` at the current schema version, or throws naming why not. */
export function stamp(path: string): { stamped: boolean; outlineInstanceId: string } {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  const database = new Database(path, { create: false, readwrite: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const { user_version: version } = database.query("PRAGMA user_version").get() as { user_version: number };
    if (version === SCHEMA_VERSION) return { stamped: false, outlineInstanceId: readOutlineInstanceId(database, path) };
    if (version !== 0) throw new Error(`${path} is schema version ${version}, not 0`);
    const differences = schemaDifferences(schemaShape(database), freshSchemaShape());
    if (differences.length > 0) {
      throw new Error(`${path} does not match schema version ${SCHEMA_VERSION}, so it was not stamped:\n- ${differences.join("\n- ")}`);
    }
    let outlineInstanceId = "";
    database.transaction(() => {
      outlineInstanceId = insertOutlineInstanceId(database);
      database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    })();
    return { stamped: true, outlineInstanceId };
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    console.error("Usage: bun scripts/migrations/0001-stamp.ts <database>   (a file no service is serving)");
    process.exit(2);
  }
  try {
    const { stamped } = stamp(path);
    console.log(stamped ? `${path}: stamped schema version ${SCHEMA_VERSION}` : `${path}: already schema version ${SCHEMA_VERSION}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
