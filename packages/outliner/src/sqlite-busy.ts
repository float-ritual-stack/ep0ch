import { SQLiteError } from "bun:sqlite";

/** Extended results such as SQLITE_BUSY_SNAPSHOT retain SQLITE_BUSY in the low byte. */
export function isSqliteBusy(error: unknown): boolean {
  return error instanceof SQLiteError && (error.errno & 0xff) === 5;
}
