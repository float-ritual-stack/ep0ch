// The calls an MCP server has seen (PIE-685): each call id (outline-core attribution.ts) gets a readable handle, minted
// once and stored here, id to handle under a unique index. The id stays the key; the handle is what people type
// (`call:leaping_otter_convergence`) and see. The gateway is stateless HTTP, so this file is how an id keeps its handle
// across requests, across restarts and between the gateway and stdio on one machine: it lives in the outlines folder's
// `.clients/mcp-calls/`, next to the other clients' own files.
//
// The hash of the id only seeds the pick (outline-core call-handles.ts), so a clash is settled here: the second call to
// seed a handle takes `_2`, in the same transaction that checks the index. The words come from the curated lists only,
// never from a chat's content.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { freeHandle } from "@ep0ch/outline-core/call-handles";
import { outlinesDir } from "./discover";

const SCHEMA_VERSION = 1;

export class CallRegistry {
  private readonly db: Database;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    this.db.exec("BEGIN IMMEDIATE");
    let version: number;
    try {
      version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version === 0) this.db.exec(`
        CREATE TABLE calls (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, minted_at TEXT NOT NULL);
        PRAGMA user_version = ${SCHEMA_VERSION};`);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); this.db.close(); throw e; }
    if (version !== 0 && version !== SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`${path} is call registry version ${version}; this ep0ch reads version ${SCHEMA_VERSION} (move it aside: the next call makes a new one, and calls already written keep their ids)`);
    }
  }

  /** The handle of a call id: stored when it has one, else minted now and stored. */
  handleOf(id: string, now = Date.now()): string {
    const have = this.db.query("SELECT handle FROM calls WHERE id = ?").get(id) as { handle: string } | null;
    if (have) return have.handle;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const again = this.db.query("SELECT handle FROM calls WHERE id = ?").get(id) as { handle: string } | null;
      if (again) { this.db.exec("COMMIT"); return again.handle; }
      const handle = freeHandle(id, h => !!this.db.query("SELECT 1 FROM calls WHERE handle = ?").get(h));
      this.db.query("INSERT INTO calls (id, handle, minted_at) VALUES (?, ?, ?)").run(id, handle, new Date(now).toISOString());
      this.db.exec("COMMIT");
      return handle;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /** The id a handle names, or null. */
  idOf(handle: string): string | null {
    return (this.db.query("SELECT id FROM calls WHERE handle = ?").get(handle) as { id: string } | null)?.id ?? null;
  }

  /** `call:<handle>` in a query turned into `call:<id>`; a word that is no handle (an id, an unknown name) stays as it was. */
  resolveIn(query: string): string {
    // A quoted string is text being searched for (`text~"call:x"`), never an atom; a word that is a known id stays as it is.
    return query.replace(/"(?:[^"\\]|\\.)*"|\bcall:([A-Za-z0-9][A-Za-z0-9._-]*)/gi, (all, word: string | undefined) => {
      if (word === undefined || this.hasId(word)) return all;
      const id = this.idOf(word);
      return id ? `call:${id}` : all;
    });
  }

  private hasId(id: string): boolean { return !!this.db.query("SELECT 1 FROM calls WHERE id = ?").get(id); }

  close(): void { this.db.close(); }
}

const open = new Map<string, CallRegistry>();
/** The registry of this machine's outlines folder, opened once. */
export function callRegistry(env: Record<string, string | undefined> = process.env): CallRegistry {
  const path = join(outlineLayout(outlinesDir(env)).clientDir("mcp-calls"), "calls.sqlite");
  let r = open.get(path);
  if (!r) open.set(path, r = new CallRegistry(path));
  return r;
}

/** A call as it is shown: its id and its stored handle. A registry that can't be opened never fails the write it decorates: the id alone is shown. */
export function callShown(id: string): { id: string; handle?: string } {
  try { return { id, handle: callRegistry().handleOf(id) }; } catch { return { id }; }
}
