// An outline's archived change log (ADR 0009 §5, §6): what the backup job keeps of each outline, and what a restore
// replays. The archive of one outline is a folder of segment files, `<root>/<outline>/<logId>/<first>-<last>.jsonl`,
// each line one range of the log (change-log.ts `LogRange`) as the host answered it, written once and never changed.
// restic takes the folder (only new segments upload). A restore replays the segments from the newest genesis at this
// build's schema, up to a moment, into a new file that is an outline of its own: a new log id, forked from the old.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEntries, endLogTransaction, entryDigest, rowCounts, type LogEntry, type LogRange } from "./change-log";
import { openFollowerSchema, SCHEMA_VERSION } from "./schema";

/** `<first>-<last>.jsonl`, or `<first>-<last>.g<lsn>.jsonl` when it holds a genesis (its newest one's lsn). */
const SEGMENT = /^(\d{16})-(\d{16})(?:\.g(\d{16}))?\.jsonl$/;
const pad = (n: number) => String(n).padStart(16, "0");

/** One log's segments in an outline's archive folder, oldest first. */
function segments(dir: string): { file: string; first: number; last: number; genesis: number | null }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(f => { const m = SEGMENT.exec(f); return m ? [{ file: join(dir, f), first: Number(m[1]), last: Number(m[2]), genesis: m[3] ? Number(m[3]) : null }] : []; })
    .sort((a, b) => a.first - b.first);
}

/** The logs an outline's archive holds, newest (by its newest segment) first. */
function logsOf(root: string, outline: string): { logId: string; dir: string; newest: number }[] {
  const base = join(root, outline);
  if (!existsSync(base)) return [];
  return readdirSync(base).flatMap(logId => {
    const dir = join(base, logId), segs = segments(dir);
    return segs.length ? [{ logId, dir, newest: statSync(segs.at(-1)!.file).mtimeMs }] : [];
  }).sort((a, b) => b.newest - a.newest);
}

/** How far an outline's archive holds its log `logId`: the newest entry archived and its digest, or null for none. */
export function archivedCursor(root: string, outline: string, logId: string): { lsn: number; digest: string | null } | null {
  const segs = segments(join(root, outline, logId));
  const last = segs.at(-1);
  if (!last) return null;
  const ranges = readSegment(last.file);
  const entry = ranges.flatMap(r => r.entries).at(-1);
  return { lsn: last.last, digest: entry ? entryDigest(entry) : null };
}

/** A segment's ranges, in order. */
export function readSegment(file: string): LogRange[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as LogRange);
}

/**
 * Appends `ranges` (consecutive, of one log) to an outline's archive as one new segment, written aside and renamed in
 * (a segment is whole or isn't there). Refused when they don't follow what the archive holds of that log. Returns the
 * segment's path, or null when the ranges hold no entries.
 */
export function writeSegment(root: string, outline: string, ranges: readonly LogRange[]): string | null {
  const entries = ranges.flatMap(r => r.entries);
  if (!entries.length) return null;
  const logId = ranges[0]!.logId;
  if (ranges.some(r => r.logId !== logId)) throw new Error("a segment holds one log's ranges");
  const dir = join(root, outline, logId);
  const have = archivedCursor(root, outline, logId);
  const first = ranges[0]!;
  // The first range of a log starts at a genesis; any other follows the archive's newest entry exactly.
  if (have ? first.after !== have.lsn || first.prev !== have.digest : entries[0]!.op !== "g") {
    throw new Error(`these entries don't follow ${outline}'s archive of log ${logId} (it holds through ${have?.lsn ?? "nothing"}, they follow ${first.after})`);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const genesis = entries.filter(e => e.op === "g").at(-1);
  const file = join(dir, `${pad(entries[0]!.lsn)}-${pad(entries.at(-1)!.lsn)}${genesis ? `.g${pad(genesis.lsn)}` : ""}.jsonl`);
  const temp = `${file}.${process.pid}.part`;
  writeFileSync(temp, ranges.map(r => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  renameSync(temp, file);
  return file;
}

/** What a replay made: the log it came from, the newest entry applied, when that was written, and the rows it holds. */
export interface Replayed { logId: string; lsn: number; at: string | null; rows: Record<string, number> }

/**
 * A restore (ADR 0009 §6): the newest log in an outline's archive (folder `root`, as restic put it back), replayed from
 * its newest genesis at this build's schema up to `until` (an entry's time; default all of it) into `out`, a new file.
 * The result is an outline of its own: a new log id, recorded as forked from the old at the last entry it holds.
 */
export function replayArchive(root: string, outline: string, out: string, o: { until?: number } = {}): Replayed {
  if (existsSync(out)) throw new Error(`${out} already exists; not overwritten`);
  const log = logsOf(root, outline)[0];
  if (!log) throw new Error(`the archive at ${join(root, outline)} holds no log of ${outline}`);
  const all: LogEntry[] = segments(log.dir).flatMap(s => readSegment(s.file).flatMap(r => r.entries));
  const until = o.until ?? Number.POSITIVE_INFINITY;
  const upTo = all.filter(e => Date.parse(e.at) <= until);
  const start = upTo.map((e, i) => ({ e, i })).filter(({ e }) => e.op === "g" && (JSON.parse(e.row ?? "{}") as { schema?: number }).schema === SCHEMA_VERSION).at(-1);
  if (!start) throw new Error(`the archive of ${outline} holds no genesis at schema ${SCHEMA_VERSION}${o.until !== undefined ? ` before ${new Date(until).toISOString()}` : ""}; restore it with the build that wrote it`);
  const entries = upTo.slice(start.i);
  // Whole transactions only: a cut inside one leaves it out.
  const lastTxn = entries.at(-1)!.txn, cut = all.some(e => e.txn === lastTxn && Date.parse(e.at) > until);
  const kept = cut ? entries.filter(e => e.txn !== lastTxn) : entries;
  const temp = `${out}.${process.pid}.part`;
  rmSync(temp, { force: true });
  const db = new Database(temp, { create: true });
  try {
    db.exec("PRAGMA journal_mode = DELETE;");
    openFollowerSchema(db, log.logId);
    const lsn = applyEntries(db, kept, SCHEMA_VERSION);
    const last = kept.at(-1)!;
    // An outline of its own now: its own log, written from here on, forked from the one it came from.
    db.query("UPDATE log_state SET role = 'home', log_id = ?, forked_from = ? WHERE id = 1").run(randomUUID(), JSON.stringify({ logId: log.logId, lsn }));
    db.transaction(() => endLogTransaction(db)).immediate();
    const rows = rowCounts(db);
    db.close();
    renameSync(temp, out);
    return { logId: log.logId, lsn, at: last.at, rows };
  } catch (e) {
    db.close();
    rmSync(temp, { force: true });
    throw e;
  }
}

/** Every range an outline's archive holds of the log `logId`, in order (what a relay sends). */
export function archivedRanges(root: string, outline: string, logId: string): LogRange[] {
  return segments(join(root, outline, logId)).flatMap(s => readSegment(s.file));
}

/**
 * Adds to an outline's archive what it doesn't hold yet of `ranges` (one log's, in order, which may begin before the
 * archive's newest entry: a relay sends the whole log), as one new segment. Refused when they don't meet the archive
 * at its newest entry with the same entry. Returns the archive's newest entry after, and the segment written, if any.
 */
export function appendToArchive(root: string, outline: string, ranges: readonly LogRange[]): { lsn: number; file: string | null } {
  if (!ranges.length) throw new Error("nothing to archive");
  const logId = ranges[0]!.logId;
  const have = archivedCursor(root, outline, logId);
  if (!have) return { lsn: ranges.flatMap(r => r.entries).at(-1)?.lsn ?? 0, file: writeSegment(root, outline, ranges) };
  const entries = ranges.flatMap(r => r.entries);
  const at = entries.findIndex(e => e.lsn === have.lsn);
  let rest: LogEntry[];
  if (at >= 0) {
    if (entryDigest(entries[at]!) !== have.digest) throw new Error(`${outline}'s log differs from its archive at entry ${have.lsn}`);
    rest = entries.slice(at + 1);
  } else if (ranges[0]!.after === have.lsn && ranges[0]!.prev === have.digest) rest = entries;
  else throw new Error(`these entries don't meet ${outline}'s archive (it holds through ${have.lsn}; they run ${entries[0]?.lsn ?? "?"} to ${entries.at(-1)?.lsn ?? "?"})`);
  if (!rest.length) return { lsn: have.lsn, file: null };
  const last = ranges.at(-1)!;
  const file = writeSegment(root, outline, [{ logId, schema: last.schema, after: have.lsn, head: last.head, prev: have.digest, entries: rest, complete: last.complete }]);
  return { lsn: rest.at(-1)!.lsn, file };
}

/**
 * What this machine keeps of an outline's archive after an upload: the segments from the one holding the newest
 * genesis on. The ones before it are in the repository's earlier snapshots (a restore to before that genesis reads
 * one of them). Returns how many segments were let go.
 */
export function trimArchive(root: string, outline: string, logId: string): number {
  const segs = segments(join(root, outline, logId));
  const newest = segs.map((s, i) => ({ s, i })).filter(({ s }) => s.genesis !== null).at(-1);
  if (!newest) return 0;
  for (const s of segs.slice(0, newest.i)) rmSync(s.file);
  return newest.i;
}
