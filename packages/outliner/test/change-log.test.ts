// PIE-1751, ADR 0009: the outline is its change log. A follower built only from the log equals its home, catches up
// after a gap, refuses a range that doesn't follow its cursor, and a replay of the archived log gives the same outline.
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRange, canonicalDump, LOG_TABLES, RangeRefused, type LogRange } from "../src/change-log";
import { openFollowerSchema, SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const root = () => { const r = realpathSync(mkdtempSync(join(tmpdir(), "outliner-change-log-"))); roots.push(r); return r; };

/** A home with a mix of the writes a day brings: notes, an edit with properties, a move, Trash, a mark, the access setting. */
function busyHome(dir: string) {
  const home = new OutlinerStore(join(dir, "home.sqlite"));
  const shelf = home.create("Pantry shelf [type::shelf]");
  const jar = home.create("Jar of lentils\n- [ ] soak overnight", shelf.id);
  home.update(jar.id, "Jar of lentils [stock::low]\n- [x] soak overnight", jar.revision, { author: "agent", actorId: "pantry-bot" });
  const crate = home.create("Crate of onions");
  home.move(crate.id, shelf.id, 0, { author: "user" });
  const stale = home.create("Old receipt");
  home.delete(stale.id, { author: "user" });
  home.configureMcpAccess("propose");
  return { home, shelf, jar };
}

/** The home's file as a plain reader sees it (a test's look; at run time only the host opens it). */
const dumpOf = (path: string) => { const db = new Database(path, { readonly: true }); try { return canonicalDump(db); } finally { db.close(); } };

/** A new follower's file for the home's log, filled by applying ranges of at most `limit` entries until it is current. */
function follow(home: OutlinerStore, path: string, limit = 50) {
  const db = new Database(path, { create: true });
  openFollowerSchema(db, home.logCursor().logId);
  const catchUp = () => {
    let ranges = 0;
    for (;;) {
      const at = (db.query("SELECT COALESCE(MAX(lsn), 0) AS lsn FROM change_log").get() as { lsn: number }).lsn;
      const range = home.logRange(at, limit);
      applyRange(db, range, SCHEMA_VERSION);
      ranges++;
      if (range.complete) return ranges;
    }
  };
  return { db, catchUp };
}

test("every table the schema makes is classified for the log, replicated or local", () => {
  const db = new Database(":memory:");
  db.exec(SCHEMA_SQL);
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(r => r.name).sort();
  expect(tables).toEqual(Object.keys(LOG_TABLES).sort());
});

test("a follower built only from the log equals its home, and catches up after a gap", () => {
  const dir = root();
  const { home, jar } = busyHome(dir);
  const follower = follow(home, join(dir, "follower.sqlite"));
  expect(follower.catchUp()).toBeGreaterThan(1);
  expect(canonicalDump(follower.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  // The gap: the home goes on while the follower is away, then the follower takes up from its cursor.
  const now = home.get(jar.id)!;
  home.update(jar.id, `${now.text}\n- [ ] buy more`, now.revision, { author: "user" });
  home.create("Tin of tomatoes");
  follower.catchUp();
  expect(canonicalDump(follower.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  // Read through the outline's own reads, the follower shows what the home has.
  follower.db.close();
  const copy = new OutlinerStore(join(dir, "follower.sqlite"));
  expect(copy.get(jar.id)?.text).toContain("buy more");
  expect(copy.outlineInstanceId).toBe(home.outlineInstanceId);
  expect(copy.mcpAccessStatus().level).toBe("propose");
  // And it keeps following once the store has it open: the next range goes through the store.
  home.create("Bag of rice");
  copy.applyLogRange(home.logRange(copy.logCursor().lsn));
  copy.close();
  home.close();
  expect(dumpOf(join(dir, "follower.sqlite"))).toBe(dumpOf(join(dir, "home.sqlite")));
});

test("a range ends at the end of a store transaction, never inside one", () => {
  const dir = root();
  const { home, jar } = busyHome(dir);
  const all = home.logRange(0, 20_000).entries;
  // The edit with properties wrote several rows in one transaction.
  const editTxn = all.find(e => e.tbl === "blocks" && e.op === "u" && e.row?.includes("stock::low"))!.txn;
  const first = all.findIndex(e => e.txn === editTxn);
  const page = home.logRange(all[first]!.lsn, 1);
  expect(page.entries.length).toBeGreaterThan(1);
  expect(new Set(page.entries.map(e => e.txn))).toEqual(new Set([editTxn]));
  expect(page.complete).toBe(false);
  expect(jar.id).toBeTruthy();
  home.close();
});

test("a follower refuses a range that doesn't follow its cursor, and keeps what it has", () => {
  const dir = root();
  const { home, shelf } = busyHome(dir);
  const follower = follow(home, join(dir, "follower.sqlite"));
  follower.catchUp();
  const before = canonicalDump(follower.db);
  const at = (follower.db.query("SELECT MAX(lsn) AS lsn FROM change_log").get() as { lsn: number }).lsn;
  home.create("Sack of flour", shelf.id);
  home.create("Box of salt", shelf.id);
  const next = home.logRange(at);
  const refused = (range: LogRange) => { try { applyRange(follower.db, range, SCHEMA_VERSION); return null; } catch (e) { return e as RangeRefused; } };

  // A range that starts past the cursor (one in between was missed).
  const skipped = home.logRange(next.entries[0]!.lsn);
  expect(refused(skipped)?.message).toContain(`this copy is at ${at}`);
  // Another log (the home was restored or made again): only a rebuild follows it.
  const other = refused({ ...next, logId: "00000000-0000-4000-8000-000000000000" });
  expect(other).toBeInstanceOf(RangeRefused);
  expect(other!.rebuild).toBe(true);
  // A home whose entry at the cursor isn't the follower's (a file copied back, then written).
  expect(refused({ ...next, prev: "0".repeat(64) })?.rebuild).toBe(true);
  // Another schema: said with which side to update, no rebuild.
  expect(refused({ ...next, schema: SCHEMA_VERSION + 1 })?.message).toContain("update this machine");
  expect(canonicalDump(follower.db)).toBe(before);
  // The range that does follow is taken.
  applyRange(follower.db, next, SCHEMA_VERSION);
  expect(canonicalDump(follower.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  home.close();
});

test("a replay of the archived log gives the same outline", () => {
  const dir = root();
  const { home } = busyHome(dir);
  // The archive: the log as segments, written out as the backup job writes them.
  const segments: LogRange[] = [];
  for (let at = 0; ;) {
    const range = home.logRange(at, 7);
    segments.push(range);
    at = range.entries.at(-1)!.lsn;
    if (range.complete) break;
  }
  const lines = segments.map(s => JSON.stringify(s));
  home.close();
  const restored = new Database(join(dir, "restored.sqlite"), { create: true });
  openFollowerSchema(restored, (JSON.parse(lines[0]!) as LogRange).logId);
  for (const line of lines) applyRange(restored, JSON.parse(line) as LogRange, SCHEMA_VERSION);
  expect(canonicalDump(restored)).toBe(dumpOf(join(dir, "home.sqlite")));
  restored.close();
});
