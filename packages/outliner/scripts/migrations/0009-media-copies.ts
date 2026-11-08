import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

/** Schema 8 to 9 (PIE-1634): `media_copies`, each picture a note names and its copy in the media bucket by sha256. */
export function migrateMediaCopies(path: string): void {
  const release = acquireWorkspaceOwnership(path);
  let database: Database | undefined;
  let reader: Database | undefined;
  try {
    // Keep a read-only connection until failure cleanup finishes, so closing the writer cannot checkpoint an interrupted WAL.
    reader = new Database(path, { readonly: true });
    const { user_version } = reader.query("PRAGMA user_version").get() as { user_version: number };
    if (user_version !== 8) throw new Error(`Expected schema 8, found ${user_version}`);
    database = new Database(path, { create: false, readwrite: true });
    const db = database;
    db.transaction(() => {
      db.exec(`CREATE TABLE media_copies (
    path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    mtime_ns TEXT NOT NULL,
    block_id TEXT NOT NULL,
    copied_at TEXT,
    error TEXT
  )`);
      db.exec("CREATE INDEX media_copies_sha256 ON media_copies(sha256)");
      db.exec("PRAGMA user_version = 9");
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
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0009-media-copies.ts <database>");
    migrateMediaCopies(resolve(path));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
