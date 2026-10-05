import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOutline } from "../src/outline-import";
import { OUTLINE_INSTANCE_ID_KEY, SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { stamp } from "../scripts/migrations/0001-stamp";

/*
 * The schema cutover on a real outline's COPY (PIE-530): set EP0CH_MIGRATE_COPY to a database file taken
 * with `sqlite3 <db> ".backup <copy>"`. Skipped otherwise. The file named is never written: it is copied
 * into a temp folder first. Only counts are printed, never content.
 */
const SOURCE = process.env.EP0CH_MIGRATE_COPY;
const work = SOURCE ? mkdtempSync(join(tmpdir(), "outliner-migrate-copy-")) : "";
afterAll(() => { if (work) rmSync(work, { recursive: true, force: true }); });

/** Rows per table, read-only, with the few metadata values that must survive. */
function counts(path: string): Record<string, number> {
  const database = new Database(path, { readonly: true });
  try {
    const out: Record<string, number> = {};
    for (const { name } of database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>) {
      out[name] = (database.query(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
    }
    out["blocks in the Trash"] = (database.query("SELECT COUNT(*) AS n FROM blocks WHERE effective_deleted_root_id IS NOT NULL").get() as { n: number }).n;
    return out;
  } finally {
    database.close();
  }
}

const KEY_TABLES = ["blocks", "block_properties", "page_addresses", "reserved_work_ids", "blocks in the Trash"];

test.skipIf(!SOURCE)("the stamp script, then the store, keep every row of a real outline's copy", () => {
  const copy = join(work, "stamped.sqlite");
  copyFileSync(SOURCE!, copy);
  const before = counts(copy);
  expect(stamp(copy)).toMatchObject({ stamped: true });
  new OutlinerStore(copy).close();
  const after = counts(copy);
  const changed = Object.keys({ ...before, ...after }).filter(table => before[table] !== after[table]);
  console.log(`stamp: ${KEY_TABLES.map(table => `${table} ${before[table]} -> ${after[table]}`).join(", ")}; ${Object.keys(before).length} tables, changed: ${changed.join(", ") || "none"}`);
  expect(changed).toEqual(["metadata"]);
  const database = new Database(copy, { readonly: true });
  expect((database.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  expect((database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_INSTANCE_ID_KEY) as { value: string } | null)?.value).toMatch(/^[0-9a-f-]{36}$/);
  database.close();
});

test.skipIf(!SOURCE)("importing a real outline's copy into a new file keeps its blocks, properties, page addresses and work ids", () => {
  const copy = join(work, "source.sqlite");
  copyFileSync(SOURCE!, copy);
  const before = counts(copy);
  const report = importOutline(copy, join(work, "imported.sqlite"));
  const after = counts(report.target);
  console.log(`import: ${KEY_TABLES.map(table => `${table} ${before[table]} -> ${after[table]}`).join(", ")}; not carried: ${Object.keys(report.notCarried).join(", ")}; dropped columns: ${report.droppedColumns.length}`);
  for (const table of KEY_TABLES) expect(after[table]).toBe(before[table]!);
  for (const table of Object.keys(report.tables)) {
    if (!(table in report.notCarried) && table !== "metadata" && table in before) expect([table, after[table]]).toEqual([table, before[table]]);
  }
});
