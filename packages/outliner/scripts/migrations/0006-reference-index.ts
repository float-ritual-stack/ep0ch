import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { insertOutlineInstanceId, OUTLINE_INSTANCE_ID_KEY } from "../../src/schema";
import { REFERENCE_INDEX_SQL_6 } from "./schema-6";
import { replaceReferenceIndex } from "../../src/reference-index";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

/** One offline transaction: index existing text without changing notes, revisions or the change feed. */
export function migrateReferenceIndex(path: string): { migrated: boolean; repaired?: boolean; outlineInstanceId: string } {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  try {
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    return db.transaction(() => {
      const version = db.query("PRAGMA user_version").get() as { user_version: number };
      const row = db.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_INSTANCE_ID_KEY) as { value: string } | null;
      const existing = row && BLOCK_ID_PATTERN.test(row.value) ? row.value : undefined;
      if (version.user_version === 6) {
        if (existing) return { migrated: false, outlineInstanceId: existing };
        return { migrated: false, repaired: true, outlineInstanceId: insertOutlineInstanceId(db) };
      }
      if (version.user_version !== 5) throw new Error(`Expected schema 5, found ${version.user_version}`);
      db.exec(REFERENCE_INDEX_SQL_6);
      for (const row of db.query("SELECT id, text FROM blocks").all() as { id: string; text: string }[]) {
        replaceReferenceIndex(db, row.id, row.text);
      }
      const outlineInstanceId = existing ?? insertOutlineInstanceId(db);
      db.exec("PRAGMA user_version = 6");
      return { migrated: true, outlineInstanceId };
    }).immediate();
  } finally {
    database?.close();
    release();
  }
}

if (import.meta.main) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: bun scripts/migrations/0006-reference-index.ts <database>");
    migrateReferenceIndex(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
