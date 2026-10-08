import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { insertOutlineInstanceId, readOutlineInstanceId } from "./schema";
import { isPrivateDatabase, ownerLockOf } from "./workspace-ownership";

/**
 * Which database instance an outline file holds (ADR 0002 §2, PIE-559): the `outline_instance_id` UUID in its
 * metadata. A cache keys on it with the block's URI and revision, so it must change exactly when the database is
 * replaced, and stay put otherwise.
 *
 * It lives in the database, so it survives a reboot and a new inode at the same path, which mean nothing replaced
 * it. What a replacement looks like from inside (a `cp` of a backup over the file, sqlite's `.restore`, a Litestream
 * restore, a fork copied back) is the backup's own UUID, and a backup's UUID is the live one's. So each open leaves a
 * record beside the file (`<database>.instance.json`, never copied with it): the instance id, a token written into
 * the database at that open, whether that open has ended, and the sequence it closed at. The next open keeps the id
 * only when the database is the one a clean close described: same id, same token, the same sequence. Anything else
 * gets a fresh id before anything reads it: a restore or copy (another token), a restore to an earlier point of the
 * last open (a sequence behind), a database at a new path or after a delete (no record), and an open that never
 * closed (a crash: what happened to the file after it can't be told). Every doubt errs toward a new id, which at
 * worst drops a cache once; keeping one wrongly would serve replaced data.
 *
 * Not covered: a restore that brings back the record with the database, and a file replaced while a store has it
 * open (restores happen with the host stopped).
 */
export const OUTLINE_OPEN_TOKEN_KEY = "outline_open_token";

type InstanceRecord = { instanceId: string; openToken: string; open: boolean; sequence: number };

function readRecord(path: string): InstanceRecord | null {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as Partial<InstanceRecord>;
    return typeof record.instanceId === "string" && typeof record.openToken === "string" && typeof record.open === "boolean" && typeof record.sequence === "number"
      ? record as InstanceRecord
      : null;
  } catch {
    return null;
  }
}

function writeRecord(path: string, record: InstanceRecord): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export type OutlineInstance = {
  readonly id: string;
  /** At a clean close: records that this open ended, at `sequence`. */
  close(sequence: number): void;
};

/**
 * Opens the instance identity of the database at `path` (already at the current schema), giving it a fresh id when
 * it isn't the database this path last had open. `created` is a database `openSchema` just made, whose id is new.
 * A memory database has no file to be replaced: its id is its metadata's.
 */
export function openOutlineInstance(path: string, database: Database, sequence: () => number, created: boolean): OutlineInstance {
  if (isPrivateDatabase(path)) {
    const id = readOutlineInstanceId(database, path);
    return { id, close() {} };
  }
  const recordPath = ownerLockOf(path).instance;
  const openToken = randomUUID();
  const id = database.transaction(() => {
    let id = readOutlineInstanceId(database, path);
    if (!created) {
      const record = readRecord(recordPath);
      const token = (database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_OPEN_TOKEN_KEY) as { value: string } | null)?.value;
      const same = record !== null && !record.open && record.instanceId === id && record.openToken === token && sequence() === record.sequence;
      if (!same) id = insertOutlineInstanceId(database);
    }
    database.query("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(OUTLINE_OPEN_TOKEN_KEY, openToken);
    return id;
  })();
  writeRecord(recordPath, { instanceId: id, openToken, open: true, sequence: sequence() });
  return {
    id,
    close(current) {
      writeRecord(recordPath, { instanceId: id, openToken, open: false, sequence: current });
    },
  };
}

/**
 * Makes the database at `path` keep the instance id it carries when it is next opened, as a clean close of that very
 * database would. For a private copy of an outline (the MCP gateway's mirror, served read-only from a snapshot of the
 * home machine's file): a copy is the same instance as its source, so it must say the source's id, not a fresh one.
 * Nothing else may call this: a restore that kept its old id is exactly what the record exists to catch.
 */
export function adoptOutlineInstance(path: string): void {
  const database = new Database(path);
  try {
    const meta = (key: string) => (database.query("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | null)?.value;
    const id = meta("outline_instance_id"), token = meta(OUTLINE_OPEN_TOKEN_KEY);
    if (!id || !token) return;
    writeRecord(ownerLockOf(path).instance, { instanceId: id, openToken: token, open: false, sequence: Number(meta("sequence") ?? 0) });
  } finally { database.close(); }
}
