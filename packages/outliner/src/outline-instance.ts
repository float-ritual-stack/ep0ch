import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { insertOutlineInstanceId, readOutlineInstanceId } from "./schema";
import { isPrivateDatabase, ownerLockOf } from "./workspace-ownership";

/**
 * Which database instance an outline file holds (ADR 0002 §2, PIE-559): the `outline_instance_id` UUID in its
 * metadata. A cache keys on it with the block's URI and revision, so it must change exactly when the database is
 * replaced, and stay put otherwise.
 *
 * It lives in the database, so it survives a reboot, a move and a new inode, which mean nothing replaced it. What a
 * replacement looks like from inside (a `cp` of a backup over the file, sqlite's `.restore`, a Litestream restore, a
 * fork copied back) is the backup's own UUID, and a backup's UUID is the live one's. So each open also leaves a
 * record beside the file (`<database>.instance.json`, never copied with it): the instance id, a token written into
 * the database at that open, and the highest sequence seen. The next open keeps the id only when the database is
 * the one the record describes: same id, same token, and no sequence behind it. Anything else is a database this
 * path has not had open (a restore, a copy, a fork, a rewind to an earlier point of the same session), and it gets a
 * fresh id before anything reads it. A missing record is the same doubt; at worst a cache is dropped once.
 *
 * Not covered: a restore that brings back the record with the database, and a file replaced while a store has it
 * open (restores happen with the host stopped).
 */
export const OUTLINE_OPEN_TOKEN_KEY = "outline_open_token";

/** How often a store writes its sequence to the record while it changes; close writes the last one. */
const RECORD_INTERVAL_MS = 1000;

type InstanceRecord = { instanceId: string; openToken: string; sequence: number };

function readRecord(path: string): InstanceRecord | null {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as Partial<InstanceRecord>;
    return typeof record.instanceId === "string" && typeof record.openToken === "string" && typeof record.sequence === "number"
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
  /** After the sequence advances: records it, at most once per `RECORD_INTERVAL_MS`. */
  advanced(sequence: number): void;
  /** At close: records the last sequence. */
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
    return { id, advanced() {}, close() {} };
  }
  const recordPath = ownerLockOf(path).instance;
  const openToken = randomUUID();
  const id = database.transaction(() => {
    let id = readOutlineInstanceId(database, path);
    if (!created) {
      const record = readRecord(recordPath);
      const token = (database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_OPEN_TOKEN_KEY) as { value: string } | null)?.value;
      const same = record !== null && record.instanceId === id && record.openToken === token && sequence() >= record.sequence;
      if (!same) id = insertOutlineInstanceId(database);
    }
    database.query("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(OUTLINE_OPEN_TOKEN_KEY, openToken);
    return id;
  })();
  let recordedAt = 0;
  const record = (current: number) => {
    writeRecord(recordPath, { instanceId: id, openToken, sequence: current });
    recordedAt = Date.now();
  };
  record(sequence());
  return {
    id,
    advanced(current) {
      if (Date.now() - recordedAt >= RECORD_INTERVAL_MS) record(current);
    },
    close(current) {
      record(current);
    },
  };
}
