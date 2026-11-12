// The outline's change log (ADR 0009, PIE-1751): every committed row change of a replicated table, in commit order, in
// the outline's own file. Triggers the schema generates for each table write it (`change_log`), so no store method can
// forget to; `log_state` holds the log's identity, the open transaction's number and whether a follower is applying.
//
//   lsn      the position, the one cursor a follower or an archive keeps
//   txn      the store transaction it was written in: a range never ends inside one (`configureTransactions` in
//            store.ts advances it at the end of each outermost write transaction that logged anything)
//   tbl, op  the table, and `i` insert, `u` update, `d` delete, or `g` a genesis (every row follows as an insert)
//   key      the row's declared primary key, as JSON (`old` for an update or a delete)
//   row      every column as JSON (null for a delete); a BLOB column as hex beside a `~<column>` marker
//   origin   the machine whose request wrote it (null: this outline's own machine)
//
// A follower applies a range only when it follows its cursor (`applyRange`): the same log, the same schema, its own
// newest lsn as `after`, and the same entry there (`prev`, a digest). Applied entries are added to the follower's own
// `change_log` as they were, so a follower's log is the home's and can be read onward (`readRange`) or archived.
import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";

/** How each table takes part in the log. Every table the schema makes is named here (a test holds it to that). */
export const LOG_TABLES: Readonly<Record<string, "replicated" | "local">> = {
  agent_mention_messages: "replicated", agent_request_baseline: "replicated", agent_requests: "replicated",
  annotation_agent_requests: "replicated", annotation_migration_quarantine: "replicated", annotation_requests: "replicated",
  annotation_resolution_events: "replicated", annotation_resource_evidence_refs: "replicated", annotation_targets: "replicated",
  block_edit_activity: "replicated", block_properties: "replicated", block_reference_candidates: "replicated",
  block_revisions: "replicated", blocks: "replicated", capture_requests: "replicated", change_feed: "replicated",
  computed_executions: "replicated", computed_invocations: "replicated", computed_representations: "replicated",
  computed_resource_state: "replicated", create_requests: "replicated", edit_recovery: "replicated",
  extension_askers: "replicated", extension_outputs: "replicated", extension_records: "replicated",
  inbox_agent_results: "replicated", mark_removals: "replicated", marks: "replicated", media_copies: "replicated",
  metadata: "replicated", navigation_history: "replicated", note_assistance_results: "replicated",
  page_addresses: "replicated", pdf_representations: "replicated", pdf_resource_state: "replicated",
  pdf_source_snapshots: "replicated", quick_capture_draft: "replicated", read_marks: "replicated",
  remote_entity_representations: "replicated", remote_entity_resource_state: "replicated",
  remote_entity_source_snapshots: "replicated", reserved_work_ids: "replicated", resource_retention_events: "replicated",
  resource_retention_pins: "replicated", resource_retention_policy: "replicated", resource_retention_references: "replicated",
  resource_sources: "replicated", resources: "replicated", selection: "replicated", virtual_occurrence_ranks: "replicated",
  web_representations: "replicated", web_resource_state: "replicated", web_source_snapshots: "replicated",
  work_id_allocator: "replicated", working_selections: "replicated",
  change_log: "local", log_state: "local",
};

/** Metadata keys each open of a file rewrites for itself (outline-instance.ts): never logged, never applied. */
export const LOCAL_METADATA_KEYS = ["outline_open_token"] as const;

export const CHANGE_LOG_SQL = `
  -- The change log (change-log.ts, ADR 0009).
  CREATE TABLE IF NOT EXISTS change_log (
    lsn INTEGER PRIMARY KEY,
    txn INTEGER NOT NULL,
    tbl TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('g', 'i', 'u', 'd')),
    key TEXT,
    row TEXT,
    origin TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS change_log_txn ON change_log(txn);
  CREATE INDEX IF NOT EXISTS change_log_genesis ON change_log(op) WHERE op = 'g';
  CREATE TABLE IF NOT EXISTS log_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    log_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('home', 'follower')),
    txn INTEGER NOT NULL,
    applying INTEGER NOT NULL DEFAULT 0,
    origin TEXT,
    forked_from TEXT
  );
`;

interface Column { name: string; type: string; pk: number }
interface TableShape { name: string; columns: Column[]; key: string[] }

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const lit = (text: string) => `'${text.replaceAll("'", "''")}'`;
const isBlob = (c: Column) => /BLOB/i.test(c.type);

/** The replicated tables as the database has them now, in a stable order (their columns, their declared key). */
export function replicatedTables(database: Database): TableShape[] {
  const names = (database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(r => r.name);
  const unclassified = names.filter(n => !(n in LOG_TABLES));
  if (unclassified.length) throw new Error(`change-log.ts LOG_TABLES doesn't classify ${unclassified.join(", ")}: name each replicated or local`);
  return names.filter(n => LOG_TABLES[n] === "replicated").map(name => {
    const columns = database.query(`PRAGMA table_info(${q(name)})`).all() as Column[];
    const key = columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    if (!key.length) throw new Error(`the replicated table ${name} has no declared primary key; the log keys every row by one`);
    return { name, columns, key };
  });
}

/** `json_object(...)` of a row's columns, read through `ref` (`NEW.`, `OLD.`, or nothing for a plain select). */
const rowJson = (t: TableShape, ref: string) => `json_object(${t.columns.flatMap(c => isBlob(c)
  ? [lit(c.name), `CASE WHEN typeof(${ref}${q(c.name)}) = 'blob' THEN hex(${ref}${q(c.name)}) ELSE ${ref}${q(c.name)} END`, lit(`~${c.name}`), `typeof(${ref}${q(c.name)}) = 'blob'`]
  : [lit(c.name), `${ref}${q(c.name)}`]).join(", ")})`;
const keyJson = (t: TableShape, ref: string) => `json_object(${t.key.map(k => `${lit(k)}, ${ref}${q(k)}`).join(", ")})`;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** The local metadata keys left out of the log, as a trigger's condition on `ref`. */
const notLocal = (t: TableShape, ref: string) => t.name === "metadata" ? ` AND ${ref}"key" NOT IN (${LOCAL_METADATA_KEYS.map(lit).join(", ")})` : "";

/** Drops and makes again the log's triggers for every replicated table, for the columns they have now. */
export function installLogTriggers(database: Database): void {
  const existing = database.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log\\_%' ESCAPE '\\'").all() as { name: string }[];
  for (const { name } of existing) database.exec(`DROP TRIGGER ${q(name)}`);
  const logging = "(SELECT applying = 0 AND role = 'home' FROM log_state WHERE id = 1)";
  for (const t of replicatedTables(database)) {
    const write = (op: string, key: string, row: string) => `INSERT INTO change_log (txn, tbl, op, key, row, origin, at) SELECT txn, ${lit(t.name)}, '${op}', ${key}, ${row}, origin, ${NOW} FROM log_state WHERE id = 1;`;
    database.exec(`
      CREATE TRIGGER ${q(`log_${t.name}_i`)} AFTER INSERT ON ${q(t.name)} WHEN ${logging}${notLocal(t, "NEW.")} BEGIN ${write("i", keyJson(t, "NEW."), rowJson(t, "NEW."))} END;
      CREATE TRIGGER ${q(`log_${t.name}_u`)} AFTER UPDATE ON ${q(t.name)} WHEN ${logging}${notLocal(t, "NEW.")} BEGIN ${write("u", keyJson(t, "OLD."), rowJson(t, "NEW."))} END;
      CREATE TRIGGER ${q(`log_${t.name}_d`)} AFTER DELETE ON ${q(t.name)} WHEN ${logging}${notLocal(t, "OLD.")} BEGIN ${write("d", keyJson(t, "OLD."), "NULL")} END;
    `);
  }
}

/** Drops the log's triggers (a migration's first step; it makes them again for the new columns). */
export function dropLogTriggers(database: Database): void {
  const existing = database.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log\\_%' ESCAPE '\\'").all() as { name: string }[];
  for (const { name } of existing) database.exec(`DROP TRIGGER ${q(name)}`);
}

/** A new outline's log: its identity, as this machine's own (`home`). */
export function initLogState(database: Database, role: "home" | "follower" = "home", logId: string = randomUUID()): void {
  database.query("INSERT OR REPLACE INTO log_state (id, log_id, role, txn, applying) VALUES (1, ?, ?, 1, 0)").run(logId, role);
}

export interface LogState { logId: string; role: "home" | "follower"; txn: number; forkedFrom: string | null }
export function logState(database: Database): LogState {
  const row = database.query("SELECT log_id, role, txn, forked_from FROM log_state WHERE id = 1").get() as { log_id: string; role: "home" | "follower"; txn: number; forked_from: string | null } | null;
  if (!row) throw new Error("this outline has no change log (log_state is empty)");
  return { logId: row.log_id, role: row.role, txn: row.txn, forkedFrom: row.forked_from };
}

/** The newest committed lsn, 0 when the log is empty. */
export const logHead = (database: Database): number => (database.query("SELECT COALESCE(MAX(lsn), 0) AS head FROM change_log").get() as { head: number }).head;

/** The lsn of the newest genesis, 0 when there is none. */
export const latestGenesis = (database: Database): number => (database.query("SELECT COALESCE(MAX(lsn), 0) AS lsn FROM change_log WHERE op = 'g'").get() as { lsn: number }).lsn;

/**
 * Ends the current log transaction: called by the store at the end of each outermost write transaction, inside it, so
 * the next one's entries carry the next number. Nothing happens when nothing was logged under this number.
 */
export function endLogTransaction(database: Database): void {
  database.query("UPDATE log_state SET txn = txn + 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM change_log WHERE change_log.txn = log_state.txn)").run();
}

/**
 * Writes a genesis: a `g` entry naming the schema, then an `i` entry for every row of every replicated table, in one
 * transaction. The log's first entries, and a schema step's (a migration writes one after making the triggers again).
 */
export function writeGenesis(database: Database, schema: number): number {
  return database.transaction(() => {
    const { txn } = logState(database);
    const at = new Date().toISOString();
    database.query("INSERT INTO change_log (txn, tbl, op, key, row, at) VALUES (?, '', 'g', NULL, ?, ?)").run(txn, JSON.stringify({ schema }), at);
    for (const t of replicatedTables(database)) {
      const where = t.name === "metadata" ? ` WHERE "key" NOT IN (${LOCAL_METADATA_KEYS.map(lit).join(", ")})` : "";
      database.query(`INSERT INTO change_log (txn, tbl, op, key, row, at) SELECT ?, ${lit(t.name)}, 'i', ${keyJson(t, "")}, ${rowJson(t, "")}, ? FROM ${q(t.name)}${where} ORDER BY ${t.key.map(q).join(", ")}`).run(txn, at);
    }
    endLogTransaction(database);
    return latestGenesis(database);
  }).immediate();
}

/**
 * Keeps the log's size in proportion (ADR 0009): when what was logged since the newest genesis outgrows `factor` times
 * that genesis, a new genesis is written and the entries before the previous one are deleted, so the file holds one
 * generation back for a follower or an archive that is behind. The archive keeps the history. Returns whether it ran.
 */
export function compactLog(database: Database, schema: number, factor = 4): boolean {
  if (logState(database).role !== "home") return false;
  const genesis = latestGenesis(database);
  if (!genesis) return false;
  // The genesis is one transaction: its rows are the outline's size; what came after it is the log's growth since.
  const txn = (database.query("SELECT txn FROM change_log WHERE lsn = ?").get(genesis) as { txn: number }).txn;
  const size = (where: string) => (database.query(`SELECT COALESCE(SUM(LENGTH(row)), 0) AS n FROM change_log WHERE lsn >= ? AND ${where}`).get(genesis, txn) as { n: number }).n;
  if (size("txn <> ?") <= factor * Math.max(size("txn = ?"), 64 * 1024)) return false;
  writeGenesis(database, schema);
  database.transaction(() => { database.query("DELETE FROM change_log WHERE lsn < ?").run(genesis); }).immediate();
  return true;
}

/** One log entry, as a range carries it. `key` and `row` stay the JSON text the log holds. */
export interface LogEntry { lsn: number; txn: number; tbl: string; op: "g" | "i" | "u" | "d"; key: string | null; row: string | null; origin: string | null; at: string }
/** A range of an outline's log: what follows `after`, through whole transactions. */
export interface LogRange { logId: string; schema: number; after: number; head: number; prev: string | null; entries: LogEntry[]; complete: boolean }

export const LOG_RANGE_DEFAULT_LIMIT = 2_000;
export const LOG_RANGE_MAX_LIMIT = 20_000;

/** A digest of an entry as stored, so two logs can tell whether they hold the same one at an lsn. */
export const entryDigest = (e: LogEntry): string =>
  createHash("sha256").update(JSON.stringify([e.lsn, e.txn, e.tbl, e.op, e.key, e.row, e.origin, e.at])).digest("hex");

const entryAt = (database: Database, lsn: number) => database.query("SELECT lsn, txn, tbl, op, key, row, origin, at FROM change_log WHERE lsn = ?").get(lsn) as LogEntry | null;

/**
 * The entries after `after`, at most `limit` and then to the end of the last one's transaction, read in one read
 * transaction (so `head` and the entries agree). `after: 0` starts at the newest genesis.
 */
export function readRange(database: Database, after: number, limit = LOG_RANGE_DEFAULT_LIMIT, schema: number): LogRange {
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("log.range after must be a non-negative integer");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LOG_RANGE_MAX_LIMIT) throw new Error(`log.range limit must be an integer from 1 through ${LOG_RANGE_MAX_LIMIT}`);
  return database.transaction((): LogRange => {
    const { logId } = logState(database);
    const head = logHead(database);
    // A cursor the log no longer holds (compacted away, `compactLog`) is answered from the newest genesis: the follower
    // sees the range doesn't follow it and rebuilds.
    const held = after > 0 && after <= head && !entryAt(database, after);
    const from = after === 0 || held ? Math.max(0, latestGenesis(database) - 1) : after;
    const prevEntry = from > 0 ? entryAt(database, from) : null;
    const entries = database.query("SELECT lsn, txn, tbl, op, key, row, origin, at FROM change_log WHERE lsn > ? ORDER BY lsn LIMIT ?").all(from, limit) as LogEntry[];
    const last = entries.at(-1);
    if (last && entries.length === limit) {
      entries.push(...database.query("SELECT lsn, txn, tbl, op, key, row, origin, at FROM change_log WHERE lsn > ? AND txn = ? ORDER BY lsn").all(last.lsn, last.txn) as LogEntry[]);
    }
    const end = entries.at(-1)?.lsn ?? from;
    return { logId, schema, after: from, head, prev: prevEntry ? entryDigest(prevEntry) : null, entries, complete: end >= head };
  }).deferred();
}

/** Why a range doesn't follow a follower's cursor; `rebuild` when only a fresh copy from the home's genesis can follow it. */
export class RangeRefused extends Error {
  constructor(message: string, readonly rebuild: boolean) { super(message); this.name = "RangeRefused"; }
}

/** What a follower holds: its log's id, its schema, its newest lsn and the digest of the entry there. */
export interface Cursor { logId: string; schema: number; lsn: number; digest: string | null }
export function cursorOf(database: Database, schema: number): Cursor {
  const lsn = logHead(database);
  const entry = lsn > 0 ? entryAt(database, lsn) : null;
  return { logId: logState(database).logId, schema, lsn, digest: entry ? entryDigest(entry) : null };
}

/** Throws RangeRefused when `range` doesn't follow `cursor`; returns quietly when it does. */
export function checkFollows(cursor: Cursor, range: LogRange): void {
  // An empty copy (a new follower, a rebuild) takes a range that starts at a genesis of its log.
  if (cursor.lsn === 0 && range.logId === cursor.logId && range.entries[0]?.op === "g") {
    if (range.schema !== cursor.schema) throw new RangeRefused(`the home is schema ${range.schema} and this copy ${cursor.schema}; ${range.schema < cursor.schema ? "update the home machine" : "update this machine"} (ep0ch install --apply)`, false);
    return;
  }
  if (range.logId !== cursor.logId) throw new RangeRefused(`the range is of log ${range.logId}, and this copy follows ${cursor.logId} (the home was restored or made again)`, true);
  if (range.schema !== cursor.schema) throw new RangeRefused(`the home is schema ${range.schema} and this copy ${cursor.schema}; ${range.schema < cursor.schema ? "update the home machine" : "update this machine"} (ep0ch install --apply)`, false);
  if (range.head < cursor.lsn) throw new RangeRefused(`the home's log ends at ${range.head}, behind this copy's ${cursor.lsn} (its file was put back to an earlier copy)`, true);
  // The home answered from a later genesis: what follows this copy's cursor was compacted away.
  if (range.after !== cursor.lsn) throw new RangeRefused(`the range follows ${range.after}, and this copy is at ${cursor.lsn}${range.after > cursor.lsn ? " (the home's log no longer holds what follows it)" : ""}`, range.after > cursor.lsn);
  if (range.prev !== cursor.digest) throw new RangeRefused(`the home's entry at ${cursor.lsn} isn't this copy's (the two logs differ from there)`, true);
}

/** The statements that put one table's logged rows back, made once per table and connection. */
interface Appliers { insert: string; update: string; delete: string }
const appliersCache = new WeakMap<Database, Map<string, Appliers>>();
function appliersFor(database: Database, t: TableShape): Appliers {
  let byTable = appliersCache.get(database);
  if (!byTable) appliersCache.set(database, byTable = new Map());
  const known = byTable.get(t.name);
  if (known) return known;
  const value = (c: Column) => {
    const path = `json_extract(row, ${lit(`$."${c.name}"`)})`;
    return isBlob(c) ? `CASE WHEN json_extract(row, ${lit(`$."~${c.name}"`)}) THEN unhex(${path}) ELSE ${path} END` : path;
  };
  const cols = t.columns.map(c => q(c.name)).join(", ");
  const keyMatch = t.key.map(k => `${q(k)} IS (SELECT json_extract(key, ${lit(`$."${k}"`)}) FROM change_log WHERE lsn = ?1)`).join(" AND ");
  const made: Appliers = {
    insert: `INSERT OR REPLACE INTO ${q(t.name)} (${cols}) SELECT ${t.columns.map(value).join(", ")} FROM change_log WHERE lsn = ?1`,
    update: `UPDATE ${q(t.name)} SET (${cols}) = (SELECT ${t.columns.map(value).join(", ")} FROM change_log WHERE lsn = ?1) WHERE ${keyMatch}`,
    delete: `DELETE FROM ${q(t.name)} WHERE ${keyMatch}`,
  };
  byTable.set(t.name, made);
  return made;
}

/** Empties every replicated table (a genesis is about to fill them), keeping this file's local metadata. */
function clearReplicated(database: Database, tables: TableShape[]): void {
  for (const t of tables) {
    database.exec(t.name === "metadata" ? `DELETE FROM metadata WHERE "key" NOT IN (${LOCAL_METADATA_KEYS.map(lit).join(", ")})` : `DELETE FROM ${q(t.name)}`);
  }
}

/**
 * Applies `range` to a follower's database: refused (RangeRefused) unless it follows the follower's cursor at
 * `schema`, then one transaction with the log's triggers and foreign keys off, each entry added to the follower's log
 * and its row put back. Returns the follower's new cursor lsn.
 */
export function applyRange(database: Database, range: LogRange, schema: number): number {
  checkFollows(cursorOf(database, schema), range);
  if (!range.entries.length) return range.after;
  return applyEntries(database, range.entries, schema);
}

/**
 * Applies entries in order to a follower's (or a restore's) database, in one transaction with the log's triggers and
 * foreign keys off: each entry added to its log and its row put back. A replay of an archive calls it directly; a
 * follower goes through `applyRange`, which first checks the range follows its cursor.
 */
export function applyEntries(database: Database, entries: readonly LogEntry[], schema: number): number {
  if (!entries.length) return logHead(database);
  const tables = new Map(replicatedTables(database).map(t => [t.name, t]));
  const foreignKeys = (database.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  if (foreignKeys) database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.query("UPDATE log_state SET applying = 1 WHERE id = 1").run();
      const add = database.query("INSERT INTO change_log (lsn, txn, tbl, op, key, row, origin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const e of entries) {
        add.run(e.lsn, e.txn, e.tbl, e.op, e.key, e.row, e.origin, e.at);
        if (e.op === "g") {
          const at = (JSON.parse(e.row ?? "{}") as { schema?: number }).schema;
          if (at !== schema) throw new RangeRefused(`the range holds a genesis at schema ${at}, and this copy is ${schema}`, false);
          clearReplicated(database, [...tables.values()]);
          continue;
        }
        const t = tables.get(e.tbl);
        if (!t) throw new RangeRefused(`the range names a table this copy doesn't have (${e.tbl})`, false);
        const a = appliersFor(database, t);
        database.query(e.op === "i" ? a.insert : e.op === "u" ? a.update : a.delete).run(e.lsn);
      }
      database.query("UPDATE log_state SET applying = 0, txn = ? WHERE id = 1").run(entries.at(-1)!.txn + 1);
    }).immediate();
  } finally {
    if (foreignKeys) database.exec("PRAGMA foreign_keys = ON");
  }
  return entries.at(-1)!.lsn;
}

/**
 * A canonical dump of the replicated tables, for comparing two copies (the drill, the tests): every row of every
 * replicated table, by key, as the log writes it. Local metadata is left out.
 */
export function canonicalDump(database: Database): string {
  const hash = createHash("sha256");
  for (const t of replicatedTables(database)) {
    const where = t.name === "metadata" ? ` WHERE "key" NOT IN (${LOCAL_METADATA_KEYS.map(lit).join(", ")})` : "";
    hash.update(`\n#${t.name}\n`);
    for (const r of database.query(`SELECT ${rowJson(t, "")} AS j FROM ${q(t.name)}${where} ORDER BY ${t.key.map(q).join(", ")}`).all() as { j: string }[]) hash.update(`${r.j}\n`);
  }
  return hash.digest("hex");
}

/** Rows per replicated table (the drill's report). */
export function rowCounts(database: Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of replicatedTables(database)) out[t.name] = (database.query(`SELECT COUNT(*) AS n FROM ${q(t.name)}`).get() as { n: number }).n;
  return out;
}
