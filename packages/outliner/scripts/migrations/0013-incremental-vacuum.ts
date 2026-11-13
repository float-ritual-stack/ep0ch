import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, chownSync, existsSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logState, writeGenesis } from "../../src/change-log";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";

/**
 * Schema 12 to 13 (PIE-1786): the outline is made again as a file whose freed pages go back to the disk
 * (`auto_vacuum = INCREMENTAL`; the host runs `PRAGMA incremental_vacuum` after each compaction), with its change log
 * begun again at one new genesis. Every row of every other table is copied as it is, AUTOINCREMENT's marks with them.
 *
 * Built beside the outline (`<file>.schema-13.tmp`) and checked before it replaces it, so the outline itself is never
 * written: a failure (no room, a bad check) leaves it exactly as it was. The room it needs is checked first, on the
 * outline's own filesystem: the outline without its log, plus a genesis. A follower's copy keeps its log as it is; the
 * home's new genesis rebuilds it. The home's log is a new one (a new id, its lsns from 1): its archive starts a new
 * chain at the genesis.
 */
export function migrateIncrementalVacuum(path: string, o: { free?: () => number; say?: (line: string) => void } = {}): { before: number; after: number } {
  const say = o.say ?? (() => {});
  const release = acquireWorkspaceOwnership(path);
  const temp = `${path}.schema-13.tmp`;
  let source: Database | undefined, made: Database | undefined;
  try {
    source = new Database(path, { create: false, readwrite: true });
    const { user_version } = source.query("PRAGMA user_version").get() as { user_version: number };
    if (user_version !== 12) throw new Error(`Expected schema 12, found ${user_version}`);
    // Everything in the file itself, or nothing is done: a reader holding the WAL back (busy) would leave frames the
    // new file must never meet (Codex on #1500).
    const checkpoint = source.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number; log: number; checkpointed: number };
    if (checkpoint.busy !== 0 || (checkpoint.log > 0 && checkpoint.checkpointed !== checkpoint.log)) {
      throw new Error(`not migrated: its WAL couldn't be checkpointed (a reader holds it: ${checkpoint.checkpointed} of ${checkpoint.log} frames); stop what reads ${path}, then run ep0ch install --apply again (the outline is as it was)`);
    }
    const before = statSync(path).size;
    const pages = (pragma: string) => (source!.query(`PRAGMA ${pragma}`).get() as Record<string, number>)[pragma]!;
    const used = (pages("page_count") - pages("freelist_count")) * pages("page_size");
    const home = logState(source).role === "home";
    const bytes = (where: string) => (source!.query(`SELECT COALESCE(SUM(LENGTH(row)) + SUM(COALESCE(LENGTH(key), 0)), 0) AS n FROM change_log ${where}`).get() as { n: number }).n;
    const genesis = (source.query("SELECT MAX(lsn) AS lsn FROM change_log WHERE op = 'g'").get() as { lsn: number | null }).lsn;
    const rows = genesis === null ? 0 : ((JSON.parse((source.query("SELECT row FROM change_log WHERE lsn = ?").get(genesis) as { row: string }).row) as { rows?: number }).rows ?? 0);
    const genesisBytes = genesis === null ? 0 : (source.query("SELECT COALESCE(SUM(LENGTH(row)), 0) AS n FROM change_log WHERE lsn BETWEEN ? AND ?").get(genesis, genesis + rows) as { n: number }).n;
    const needed = Math.ceil(1.2 * (home ? Math.max(0, used - bytes("")) + 1.5 * genesisBytes : used));
    const free = o.free ? o.free() : (() => { const fs = statfsSync(dirname(path)); return fs.bavail * fs.bsize; })();
    if (free < needed) throw new Error(`not migrated: the new file needs about ${Math.round(needed / 1048576)} MB on ${dirname(path)}'s filesystem, which has ${Math.round(free / 1048576)} MB free; free some room there and run ep0ch install --apply again (the outline is as it was)`);
    rmSync(temp, { force: true });
    made = new Database(temp, { create: true, readwrite: true });
    const db = made;
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    db.exec(`ATTACH DATABASE '${path.replaceAll("'", "''")}' AS src`);
    const objects = db.query("SELECT type, name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY rowid").all() as { type: string; name: string; sql: string }[];
    const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
    db.transaction(() => {
      for (const t of objects.filter(x => x.type === "table")) db.exec(t.sql);
      for (const t of objects.filter(x => x.type === "table")) {
        // The home's log begins again at the genesis below; a follower's stays as its home wrote it.
        if (t.name === "change_log" && home) continue;
        db.exec(`INSERT INTO main.${q(t.name)} SELECT * FROM src.${q(t.name)}`);
      }
      if (db.query("SELECT 1 FROM src.sqlite_master WHERE name = 'sqlite_sequence'").get()) {
        db.exec("DELETE FROM main.sqlite_sequence");
        db.exec("INSERT INTO main.sqlite_sequence SELECT * FROM src.sqlite_sequence");
      }
      for (const x of objects.filter(x => x.type === "index")) db.exec(x.sql);
      // Every row came across: each table counted on both sides.
      for (const t of objects.filter(x => x.type === "table" && (x.name !== "change_log" || !home))) {
        const count = (schema: string) => (db.query(`SELECT COUNT(*) AS n FROM ${schema}.${q(t.name)}`).get() as { n: number }).n;
        if (count("main") !== count("src")) throw new Error(`not migrated: ${t.name} has ${count("src")} rows and the new file ${count("main")}; the outline is as it was`);
      }
    }).immediate();
    db.exec("DETACH DATABASE src");
    db.transaction(() => {
      // A new log: its entries start again at 1, so an archive or a follower of the old one starts a new chain at this
      // genesis instead of meeting lsns behind its cursor (Codex on #1500).
      if (home) { db.query("UPDATE log_state SET log_id = ?, txn = 1 WHERE id = 1").run(randomUUID()); writeGenesis(db, 13); }
      // The triggers last: the copy above is no edit, and logs nothing.
      for (const x of objects.filter(x => x.type === "trigger" || x.type === "view")) db.exec(x.sql);
      db.exec("PRAGMA user_version = 13");
    }).immediate();
    const check = (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (check !== "ok") throw new Error(`not migrated: the new file failed its integrity check (${check}); the outline is as it was`);
    const vacuum = (db.query("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum;
    if (vacuum !== 2) throw new Error(`not migrated: the new file's auto_vacuum is ${vacuum}, not incremental; the outline is as it was`);
    made.close(); made = undefined;
    source.close(); source = undefined;
    // The outline's own mode and owner, not the umask's.
    const was = statSync(path);
    chmodSync(temp, was.mode & 0o7777);
    try { chownSync(temp, was.uid, was.gid); } catch { /* another owner's file: only root may give it; its mode is kept */ }
    // The old file's WAL and index go before the new file takes its name: emptied above, they belong to the old one,
    // and an interruption after this leaves the old file whole (Codex on #1500).
    for (const side of ["-wal", "-shm"]) {
      const file = `${path}${side}`;
      if (side === "-wal" && existsSync(file) && statSync(file).size > 0) throw new Error(`not migrated: ${file} still holds frames after the checkpoint; the outline is as it was`);
      rmSync(file, { force: true });
    }
    renameSync(temp, path);
    const after = statSync(path).size;
    say(`${path}: ${Math.round(before / 1048576)} MB → ${Math.round(after / 1048576)} MB, auto_vacuum incremental${home ? ", its log begun again at a genesis" : ""}`);
    return { before, after };
  } finally {
    made?.close();
    source?.close();
    if (existsSync(temp)) rmSync(temp, { force: true });
    release();
  }
}

if (import.meta.main) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: bun packages/outliner/scripts/migrations/0013-incremental-vacuum.ts <database>");
    migrateIncrementalVacuum(resolve(path), { say: line => console.log(line) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
