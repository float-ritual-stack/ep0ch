import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

/**
 * Schema 10 to 11 (PIE-1586): Pi's guided walkthrough is gone, so `workflow_runs` (with its index) and
 * `workflow_promotions` are dropped. A promoted note is an ordinary block and stays; only the run records go.
 */
export function migrateDropWorkflows(path: string): void {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  let reader: Database | undefined;
  try {
    // Keep a read-only connection until failure cleanup finishes, so closing the writer cannot checkpoint an interrupted WAL.
    reader = new Database(path, { readonly: true });
    const { user_version } = reader.query("PRAGMA user_version").get() as { user_version: number };
    if (user_version !== 10) throw new Error(`Expected schema 10, found ${user_version}`);
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    db.transaction(() => {
      db.exec("DROP TABLE IF EXISTS workflow_promotions");
      db.exec("DROP INDEX IF EXISTS workflow_runs_updated");
      db.exec("DROP TABLE IF EXISTS workflow_runs");
      db.exec("PRAGMA user_version = 11");
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
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0011-drop-workflows.ts <database>");
    migrateDropWorkflows(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
