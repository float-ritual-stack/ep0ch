import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openSchema } from "./schema";
import { OutlinerStore } from "./store";

/*
 * Import (PIE-530): a new outline at `target`, with the current schema, filled
 * from the database at `source`, opened read-only. It is the way across a
 * schema change too large for a one-off script: an older file with the same
 * tables imports, because every table is read by column name.
 *
 * Carried: every table the current schema has, row for row: blocks with their
 * revisions, provenance and Trash state, page addresses (aliases included),
 * work ids (reservations and the allocator), resources and their snapshots,
 * annotations, extension records and outputs, agent requests, activity, and
 * the subsystems' own state.
 *
 * Not carried, on purpose:
 * - `block_properties`: derived from block text; the store parses every block
 *   again when it first opens the new file.
 * - selection, navigation history and working selections: a person's place in
 *   the old outline, not its content.
 * - the change feed: the old outline's history; the new one starts its feed at
 *   the imported sequence.
 * - `metadata` keys of steps that no longer exist (old migration markers), and
 *   the property parser version (so the parse above happens).
 * - a table or column the current schema doesn't have (named in the report).
 */

/** Counts only: what was read and written, never content. */
export interface ImportReport {
  source: string;
  target: string;
  /** Rows written per table (after the store's first open), for every table carried. */
  tables: Record<string, number>;
  blocks: number;
  properties: number;
  pageAddresses: number;
  workIds: number;
  /** Tables in the source this import leaves behind, with why. */
  notCarried: Record<string, string>;
  /** Source columns the current schema has no place for, as `table.column`. */
  droppedColumns: string[];
}

const SKIPPED_TABLES: Readonly<Record<string, string>> = {
  block_properties: "derived from block text; parsed again",
  selection: "the person's place in the old outline",
  navigation_history: "the person's place in the old outline",
  working_selections: "a client's temporary selection",
  change_feed: "the old outline's change history",
};

/** Metadata keys the new file must not inherit. */
const SKIPPED_METADATA = new Set([
  "property_parser_version",
  "change_feed_floor",
  "navigation_cursor",
  "change_feed_complete_through",
  "page_address_registry_version",
  "work_id_allocator_migration_version",
  "pie250_annotation_repository",
  "resource_retention_payload_migration",
]);

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function tableNames(database: Database): string[] {
  return (database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>)
    .map(row => row.name);
}

function columnNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>).map(column => column.name);
}

function count(database: Database, table: string): number {
  return (database.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number }).n;
}

/**
 * Creates `target` (refused when it exists) and imports `source` into it. On any
 * failure the new file is removed, and `source` is never written.
 */
export function importOutline(sourceInput: string, targetInput: string): ImportReport {
  const source = resolve(sourceInput);
  const target = resolve(targetInput);
  if (!existsSync(source)) throw new Error(`No database at ${source}`);
  if (existsSync(target)) throw new Error(`${target} already exists; import makes a new outline and never writes over one`);
  mkdirSync(dirname(target), { recursive: true });
  const reader = new Database(source, { readonly: true, create: false });
  const notCarried: Record<string, string> = {};
  const droppedColumns: string[] = [];
  let created = false;
  try {
    const sourceTables = new Set(tableNames(reader));
    if (!sourceTables.has("blocks") || !sourceTables.has("metadata")) throw new Error(`${source} is not an outline database (it has no blocks and metadata tables)`);
    const writer = new Database(target, { create: true });
    created = true;
    try {
      openSchema(writer, `The new outline ${target}`);
      const targetTables = tableNames(writer);
      for (const table of sourceTables) {
        if (SKIPPED_TABLES[table]) notCarried[table] = SKIPPED_TABLES[table]!;
        else if (!targetTables.includes(table)) notCarried[table] = "not in the current schema";
      }
      // Rows go in whole tables at a time, so references are checked once, at the end.
      writer.exec("PRAGMA foreign_keys = OFF;");
      writer.transaction(() => {
        for (const table of targetTables) {
          if (!sourceTables.has(table) || SKIPPED_TABLES[table]) continue;
          const wanted = new Set(columnNames(writer, table));
          const available = columnNames(reader, table);
          for (const column of available) if (!wanted.has(column)) droppedColumns.push(`${table}.${column}`);
          const columns = available.filter(column => wanted.has(column));
          if (columns.length === 0) continue;
          const list = columns.map(quote).join(", ");
          const where = table === "metadata" ? ` WHERE key NOT IN (${[...SKIPPED_METADATA].map(key => `'${key}'`).join(", ")})` : "";
          const rows = reader.query(`SELECT ${list} FROM ${quote(table)}${where}`).values();
          // The schema's own starting rows (the sequence, the Inbox agent's settings) give way to the source's.
          const insert = writer.prepare(`INSERT OR REPLACE INTO ${quote(table)} (${list}) VALUES (${columns.map(() => "?").join(", ")})`);
          for (const row of rows) insert.run(...(row as Array<string | number | bigint | null | Uint8Array>));
        }
        const sequence = writer.query("SELECT value FROM metadata WHERE key = 'sequence'").get() as { value: string } | null;
        writer.query("INSERT OR REPLACE INTO metadata (key, value) VALUES ('change_feed_floor', ?)").run(sequence?.value ?? "0");
        const violations = writer.query("PRAGMA foreign_key_check").all() as Array<{ table: string }>;
        if (violations.length > 0) {
          const tables = [...new Set(violations.map(violation => violation.table))].join(", ");
          throw new Error(`${source} has ${violations.length} rows whose references don't resolve (in ${tables}); nothing was imported`);
        }
      })();
    } finally {
      writer.close();
    }
    // The store's first open parses every block's properties and reconciles work ids.
    new OutlinerStore(target).close();
    const result = new Database(target, { readonly: true });
    try {
      const tables: Record<string, number> = {};
      for (const table of tableNames(result)) tables[table] = count(result, table);
      return {
        source, target, tables,
        blocks: tables.blocks ?? 0,
        properties: tables.block_properties ?? 0,
        pageAddresses: tables.page_addresses ?? 0,
        workIds: tables.reserved_work_ids ?? 0,
        notCarried, droppedColumns,
      };
    } finally {
      result.close();
    }
  } catch (error) {
    if (created) for (const suffix of ["", "-wal", "-shm", ".owner.sqlite"]) rmSync(`${target}${suffix}`, { force: true });
    throw error;
  } finally {
    reader.close();
  }
}
