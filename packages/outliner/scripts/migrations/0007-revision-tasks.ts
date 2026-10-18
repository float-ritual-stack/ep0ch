import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

export function migrateRevisionTasks(path: string): void {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  try {
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    db.transaction(() => {
      const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
      if (user_version !== 6) throw new Error(`Expected schema 6, found ${user_version}`);
      // Earlier revisions never stored the task; timestamps cannot uniquely identify the activity that wrote them.
      db.exec("ALTER TABLE block_revisions ADD COLUMN task_id TEXT");
      db.exec("PRAGMA user_version = 7");
    }).immediate();
  } finally {
    database?.close();
    release();
  }
}

if (import.meta.main) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0007-revision-tasks.ts <database>");
    migrateRevisionTasks(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
