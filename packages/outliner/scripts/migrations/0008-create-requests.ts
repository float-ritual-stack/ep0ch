import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

export function migrateCreateRequests(path: string): void {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  try {
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    db.transaction(() => {
      const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
      if (user_version !== 7) throw new Error(`Expected schema 7, found ${user_version}`);
      db.exec(`CREATE TABLE create_requests (
        request_id TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        block_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.exec("PRAGMA user_version = 8");
    }).immediate();
  } finally {
    database?.close();
    release();
  }
}

if (import.meta.main) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0008-create-requests.ts <database>");
    migrateCreateRequests(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
