import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";
import { MARKS_SQL } from "../../src/schema";

/**
 * Schema 9 to 10 (PIE-1237): `marks` and `mark_removals`, the service's marks (one verb every surface calls, read by
 * the `marked:` atoms). The door's marks.json isn't read: its attention marks were a door's own, and the door starts
 * on the service's.
 */
export function migrateMarks(path: string): void {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  let reader: Database | undefined;
  try {
    // Keep a read-only connection until failure cleanup finishes, so closing the writer cannot checkpoint an interrupted WAL.
    reader = new Database(path, { readonly: true });
    const { user_version } = reader.query("PRAGMA user_version").get() as { user_version: number };
    if (user_version !== 9) throw new Error(`Expected schema 9, found ${user_version}`);
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    db.transaction(() => {
      db.exec(MARKS_SQL);
      db.exec("PRAGMA user_version = 10");
    }).immediate();
    reader.close();
  } finally {
    database?.close();
    reader?.close();
    release();
  }
}

if (import.meta.main) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0010-marks.ts <database>");
    migrateMarks(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
