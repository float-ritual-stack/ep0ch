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
  // And each range after the first follows the one before it, entry for entry.
  for (let i = 1; i < ranges.length; i++) {
    const before = ranges.slice(0, i).flatMap(r => r.entries).at(-1);
    const r = ranges[i]!;
    if (before && (r.after !== before.lsn || r.prev !== entryDigest(before))) throw new Error(`these entries don't follow each other: a range follows ${r.after}, after one that ends at ${before.lsn}`);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const genesis = entries.filter(e => e.op === "g").at(-1);
  const file = join(dir, `${pad(entries[0]!.lsn)}-${pad(entries.at(-1)!.lsn)}${genesis ? `.g${pad(genesis.lsn)}` : ""}.jsonl`);
  const temp = `${file}.${process.pid}.part`;
  writeFileSync(temp, ranges.map(r => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  renameSync(temp, file);
  return file;
}

/**
 * Whether what a replay is about to apply is whole: every entry from its genesis on, one after another (the log's
 * positions are consecutive), each range meeting the entry before it, and the genesis's rows all there. A segment lost
 * from the middle would otherwise replay into an outline missing notes, with the right last entry and a clean check.
 */
function checkChain(ranges: readonly LogRange[], entries: readonly LogEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.lsn !== entries[i - 1]!.lsn + 1) throw new Error(`the archive is missing entries ${entries[i - 1]!.lsn + 1} to ${entries[i]!.lsn - 1} (a segment is gone); it can't be replayed whole`);
  }
  const first = entries[0]!.lsn;
  const byEnd = new Map<number, LogEntry>();
  for (const r of ranges) for (const e of r.entries) byEnd.set(e.lsn, e);
  for (const r of ranges) {
    if (!r.entries.length || r.entries[0]!.lsn <= first || r.prev === null) continue;
    const before = byEnd.get(r.after);
    if (!before || entryDigest(before) !== r.prev) throw new Error(`the archive's range after entry ${r.after} doesn't meet the entry there; it can't be replayed whole`);
  }
  const rows = (JSON.parse(entries[0]!.row ?? "{}") as { rows?: number }).rows;
  if (rows !== undefined && entries.length - 1 < rows) throw new Error(`the archive's genesis at ${first} holds ${entries.length - 1} of its ${rows} rows; it can't be replayed whole`);
}

/** What a replay made: the log it came from, the newest entry applied, when that was written, and the rows it holds. */
export interface Replayed { logId: string; lsn: number; at: string | null; rows: Record<string, number> }

/**
 * A restore (ADR 0009 §6): the log `logId` in an outline's archive (folder `root`, as restic put it back; else the
 * one written to last), replayed from
 * its newest genesis at this build's schema up to `until` (an entry's time; default all of it) into `out`, a new file.
 * The result is an outline of its own: a new log id, recorded as forked from the old at the last entry it holds.
 * `logId` names the folder: a log's own, or a part of it set aside at a gap (`<logId>~<lsn>`), which replays as that log.
 * `through` is an exact entry: when it ends one of the archive's segments (a point an archive was taken at, so the
 * outline once stood there), the replay stops there even inside a transaction that ran on past it; `until` keeps whole
 * transactions.
 */
export function replayArchive(root: string, outline: string, out: string, o: { until?: number; logId?: string; through?: number } = {}): Replayed {
  if (existsSync(out)) throw new Error(`${out} already exists; not overwritten`);
  // The log the snapshot says it holds; without one (a hand-made archive), the one written to last.
  const logs = logsOf(root, outline);
  const log = o.logId ? logs.find(l => l.logId === o.logId) : logs[0];
  if (!log) throw new Error(`the archive at ${join(root, outline)} holds no log ${o.logId ? `${o.logId} ` : ""}of ${outline}`);
  const segs = segments(log.dir);
  const ranges = segs.flatMap(s => readSegment(s.file));
  // The log the folder holds: a chain set aside at a gap is still that log (its folder only says where it stopped).
  const identity = log.logId.replace(/~\d+$/, "");
  const all: LogEntry[] = ranges.flatMap(r => r.entries);
  const until = o.until ?? Number.POSITIVE_INFINITY;
  // `through`: no entry past that lsn (an exact rollback point, Codex on #1502), as `until` is no entry past a time.
  const through = o.through ?? Number.POSITIVE_INFINITY;
  const upTo = all.filter(e => Date.parse(e.at) <= until && e.lsn <= through);
  const start = upTo.map((e, i) => ({ e, i })).filter(({ e }) => e.op === "g" && (JSON.parse(e.row ?? "{}") as { schema?: number }).schema === SCHEMA_VERSION).at(-1);
  if (!start) throw new Error(`the archive of ${outline} holds no genesis at schema ${SCHEMA_VERSION}${o.until !== undefined ? ` before ${new Date(until).toISOString()}` : ""}; restore it with the build that wrote it`);
  const entries = upTo.slice(start.i);
  checkChain(ranges, entries);
  // Whole transactions only: a cut inside one leaves it out. Except an exact entry the archive was taken at: the log's
  // transaction ids can run on across the host's writes (a write that ends none), and the outline stood at that entry.
  const lastTxn = entries.at(-1)!.txn;
  const taken = o.through !== undefined && entries.at(-1)!.lsn === o.through && segs.some(s => s.last === o.through);
  const cut = all.some(e => e.txn === lastTxn && (Date.parse(e.at) > until || (e.lsn > through && !taken)));
  const kept = cut ? entries.filter(e => e.txn !== lastTxn) : entries;
  const temp = `${out}.${process.pid}.part`;
  rmSync(temp, { force: true });
  const db = new Database(temp, { create: true });
  try {
    db.exec("PRAGMA journal_mode = DELETE;");
    openFollowerSchema(db, identity);
    const lsn = applyEntries(db, kept, SCHEMA_VERSION);
    const last = kept.at(-1)!;
    // An outline of its own now: its own log, written from here on, forked from the one it came from.
    db.query("UPDATE log_state SET role = 'home', log_id = ?, forked_from = ? WHERE id = 1").run(randomUUID(), JSON.stringify({ logId: identity, lsn }));
    db.transaction(() => endLogTransaction(db)).immediate();
    const rows = rowCounts(db);
    db.close();
    renameSync(temp, out);
    return { logId: identity, lsn, at: last.at, rows };
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
  else if (entries.some(e => e.op === "g")) {
    // The sender kept only what follows a newer genesis (its archive was trimmed after direct uploads): this archive's
    // chain is kept aside, and a new one starts at that genesis.
    const from = entries.findIndex(e => e.op === "g");
    renameSync(join(root, outline, logId), join(root, outline, `${logId}~${have.lsn}`));
    const kept = entries.slice(from);
    const last = ranges.at(-1)!;
    const file = writeSegment(root, outline, [{ logId, schema: last.schema, after: kept[0]!.lsn - 1, head: last.head, prev: null, entries: kept, complete: last.complete }]);
    return { lsn: kept.at(-1)!.lsn, file };
  } else throw new Error(`these entries don't meet ${outline}'s archive (it holds through ${have.lsn}; they run ${entries[0]?.lsn ?? "?"} to ${entries.at(-1)?.lsn ?? "?"})`);
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

/**
 * The chains in an outline's archive other than its current log `logId` (PIE-1806): an earlier log (a migration or an
 * import begins a new one), and a chain kept aside at a gap (`<id>~<lsn>`), each with the newest entry it holds here.
 * What an upload of the folder names in its snapshot's tags, so a restore of that log finds them there.
 */
export function otherChains(root: string, outline: string, logId: string): { chain: string; lsn: number }[] {
  const base = join(root, outline);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== logId).flatMap(e => {
    const last = segments(join(base, e.name)).at(-1);
    return last ? [{ chain: e.name, lsn: last.last }] : [];
  }).sort((a, b) => a.chain.localeCompare(b.chain));
}

/**
 * The other chains `held` names (each with the newest entry a snapshot restore can reach holds of it: `otherChains`, as
 * the upload that just landed tagged them), removed from this machine: a restore of that log reads it from the
 * repository (`backup restore --log <id>`). A chain holding entries past what `held` says stays, and so does the
 * current chain; nothing goes while that one holds no segment. Returns each chain let go, with its size.
 */
export function letGoOtherChains(root: string, outline: string, logId: string, held: readonly { chain: string; lsn: number }[]): { chain: string; bytes: number }[] {
  if (!archivedCursor(root, outline, logId)) return [];
  const reached = new Map(held.map(h => [h.chain, h.lsn]));
  return otherChains(root, outline, logId).filter(o => o.lsn <= (reached.get(o.chain) ?? -1)).map(o => {
    const dir = join(root, outline, o.chain);
    const bytes = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    rmSync(dir, { recursive: true, force: true });
    return { chain: o.chain, bytes };
  });
}
