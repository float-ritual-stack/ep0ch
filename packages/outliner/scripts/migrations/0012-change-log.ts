import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { CHANGE_LOG_SQL, initLogState, installLogTriggers, writeGenesis } from "../../src/change-log";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

/**
 * Schema 11 to 12 (PIE-1751, ADR 0009): the outline becomes its change log. Adds `change_log` and `log_state`, gives
 * the outline its log's id, makes the log's triggers for every replicated table, and writes the genesis: one `g` entry
 * and an insert entry for every row there is, so a follower or a restore built from the log alone equals the file.
 */
export function migrateChangeLog(path: string): void {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  let reader: Database | undefined;
  try {
    // Keep a read-only connection until failure cleanup finishes, so closing the writer cannot checkpoint an interrupted WAL.
    reader = new Database(path, { readonly: true });
    const { user_version } = reader.query("PRAGMA user_version").get() as { user_version: number };
    if (user_version !== 11) throw new Error(`Expected schema 11, found ${user_version}`);
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    db.transaction(() => {
      db.exec(CHANGE_LOG_SQL);
      initLogState(db);
      installLogTriggers(db);
      writeGenesis(db, 12);
      db.exec("PRAGMA user_version = 12");
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
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0012-change-log.ts <database>");
    migrateChangeLog(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
