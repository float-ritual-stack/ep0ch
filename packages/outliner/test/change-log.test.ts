// PIE-1751, ADR 0009: the outline is its change log. A follower built only from the log equals its home, catches up
// after a gap, refuses a range that doesn't follow its cursor, and a replay of the archived log gives the same outline.
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRange, canonicalDump, LOG_TABLES, RangeRefused, readRange, type LogRange } from "../src/change-log";
import { appendToArchive, archivedCursor, replayArchive, trimArchive, writeSegment } from "../src/log-archive";
import { openFollowerSchema, SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { importOutline } from "../src/outline-import";

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
  openFollowerSchema(db, home.log.cursor().logId);
  const catchUp = () => {
    let ranges = 0;
    for (;;) {
      const at = (db.query("SELECT COALESCE(MAX(lsn), 0) AS lsn FROM change_log").get() as { lsn: number }).lsn;
      const range = home.log.range(at, limit);
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

test("Litestream's own tables in a file it once replicated are its, never the log's: the file opens and follows", () => {
  const dir = root();
  const { home } = busyHome(dir);
  home.close();
  // What Litestream leaves in every file it has watched (float-2's outlines had both when 0012 met them).
  const raw = new Database(join(dir, "home.sqlite"));
  raw.exec("CREATE TABLE _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER); CREATE TABLE _litestream_lock (id INTEGER);");
  raw.close();
  const reopened = new OutlinerStore(join(dir, "home.sqlite"));
  reopened.create("Sack of flour");
  const follower = follow(reopened, join(dir, "follower.sqlite"));
  follower.catchUp();
  expect(canonicalDump(follower.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  follower.db.close();
  reopened.close();
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
  copy.log.apply(home.log.range(copy.log.cursor().lsn));
  copy.close();
  home.close();
  expect(dumpOf(join(dir, "follower.sqlite"))).toBe(dumpOf(join(dir, "home.sqlite")));
});

test("a range ends at the end of a store transaction, never inside one", () => {
  const dir = root();
  const { home, jar } = busyHome(dir);
  const all = home.log.range(0, 20_000).entries;
  // The edit with properties wrote several rows in one transaction.
  const editTxn = all.find(e => e.tbl === "blocks" && e.op === "u" && e.row?.includes("stock::low"))!.txn;
  const first = all.findIndex(e => e.txn === editTxn);
  const page = home.log.range(all[first]!.lsn, 1);
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
  const next = home.log.range(at);
  const refused = (range: LogRange) => { try { applyRange(follower.db, range, SCHEMA_VERSION); return null; } catch (e) { return e as RangeRefused; } };

  // A range that starts past the cursor (one in between was missed).
  const skipped = home.log.range(next.entries[0]!.lsn);
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

test("a replay of the archived log gives the same outline, as an outline of its own", () => {
  const dir = root();
  const { home, jar } = busyHome(dir);
  const archive = join(dir, "archive");
  // The archive, as the backup job writes it: a segment per run, each the ranges since the last one.
  const run = () => {
    const ranges: LogRange[] = [];
    let at = archivedCursor(archive, "home", home.log.cursor().logId)?.lsn ?? 0;
    for (;;) {
      const range = home.log.range(at, 7);
      ranges.push(range);
      at = range.entries.at(-1)?.lsn ?? at;
      if (range.complete) break;
    }
    writeSegment(archive, "home", ranges);
  };
  run();
  const firstRunAt = Date.now();
  Bun.sleepSync(20);
  const now = home.get(jar.id)!;
  home.update(jar.id, `${now.text}\n- [ ] label the jar`, now.revision, { author: "user" });
  run();
  // A segment that doesn't follow the archive is refused, never written.
  expect(() => writeSegment(archive, "home", [home.log.range(1)])).toThrow("don't follow");
  const logId = home.log.cursor().logId;
  home.close();
  const replayed = replayArchive(archive, "home", join(dir, "restored.sqlite"));
  expect(replayed.logId).toBe(logId);
  expect(canonicalDump(new Database(join(dir, "restored.sqlite"), { readonly: true }))).toBe(dumpOf(join(dir, "home.sqlite")));
  // An earlier moment: the archive up to the first run, without the label.
  const earlier = replayArchive(archive, "home", join(dir, "earlier.sqlite"), { until: firstRunAt });
  expect(earlier.lsn).toBeLessThan(replayed.lsn);
  const restored = new OutlinerStore(join(dir, "earlier.sqlite"));
  expect(restored.get(jar.id)?.text).not.toContain("label the jar");
  // Its own outline now: a new log, so followers of the old one rebuild rather than take its writes.
  expect(restored.log.cursor().logId).not.toBe(logId);
  restored.create("Written after the restore");
  restored.close();
});

test("a log kept in proportion: a follower within a generation catches up, one further behind rebuilds", () => {
  const dir = root();
  const { home, shelf } = busyHome(dir);
  const near = follow(home, join(dir, "near.sqlite"));
  near.catchUp();
  const far = follow(home, join(dir, "far.sqlite"));
  far.catchUp();
  const farAt = (far.db.query("SELECT MAX(lsn) AS lsn FROM change_log").get() as { lsn: number }).lsn;
  // A busy day: the log outgrows the outline, so the next compaction writes a genesis.
  const crate = home.create("Crate of apples", shelf.id);
  for (let i = 0; i < 600 && !home.log.compact(1); i++) {
    const now = home.get(crate.id)!;
    home.update(crate.id, `Crate of apples [count::${i}]\nCounted again.`, now.revision, { author: "user" });
    if (i % 50 === 0) near.catchUp();
  }
  near.catchUp();
  expect(canonicalDump(near.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  // Another generation: what followed the far copy's cursor is gone from the home's log.
  for (let i = 0; i < 600 && !home.log.compact(1); i++) {
    const now = home.get(crate.id)!;
    home.update(crate.id, `Crate of apples [count::again-${i}]\nCounted again.`, now.revision, { author: "user" });
    if (i % 50 === 0) near.catchUp();
  }
  near.catchUp();
  expect(canonicalDump(near.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  const range = home.log.range(farAt);
  let refused: unknown = null;
  try { applyRange(far.db, range, SCHEMA_VERSION); } catch (e) { refused = e; }
  expect(refused).toBeInstanceOf(RangeRefused);
  expect((refused as RangeRefused).rebuild).toBe(true);
  // The log holds one generation back, not the whole history.
  const oldest = (home.database.query("SELECT MIN(lsn) AS lsn FROM change_log").get() as { lsn: number }).lsn;
  expect(oldest).toBeGreaterThan(farAt);
  home.close();
});

test("a BLOB column (a PDF's bytes) travels as itself", () => {
  const dir = root();
  const { home } = busyHome(dir);
  const logId = home.log.cursor().logId;
  home.close();
  // A test's own connection on the home's file: the log's triggers are in the file, so its write is logged too.
  const db = new Database(join(dir, "home.sqlite"));
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 255]);
  db.query("INSERT INTO pdf_source_snapshots (id, resource_id, address_version, locator, content_hash, revision_json, bytes, captured_at) VALUES ('snap-1', 'res-1', 1, 'file:///fictional.pdf', 'h', '{}', ?, '2026-11-01')").run(bytes);
  const copy = new Database(join(dir, "copy.sqlite"), { create: true });
  openFollowerSchema(copy, logId);
  for (let at = 0; ;) {
    const range = readRange(db, at, 50, SCHEMA_VERSION);
    applyRange(copy, range, SCHEMA_VERSION);
    at = range.entries.at(-1)?.lsn ?? at;
    if (range.complete) break;
  }
  expect((copy.query("SELECT bytes FROM pdf_source_snapshots WHERE id = 'snap-1'").get() as { bytes: Uint8Array }).bytes).toEqual(bytes);
  expect(canonicalDump(copy)).toBe(canonicalDump(db));
  db.close();
});

test("an archive keeps what follows its newest genesis here, and still replays to the outline", () => {
  const dir = root();
  const { home, shelf } = busyHome(dir);
  const archive = join(dir, "archive");
  const run = () => {
    const ranges: LogRange[] = [];
    let at = archivedCursor(archive, "home", home.log.cursor().logId)?.lsn ?? 0;
    for (;;) { const range = home.log.range(at, 50); ranges.push(range); at = range.entries.at(-1)?.lsn ?? at; if (range.complete) break; }
    writeSegment(archive, "home", ranges);
  };
  run();
  const crate = home.create("Crate of pears", shelf.id);
  for (let i = 0; i < 600 && !home.log.compact(1); i++) {
    const now = home.get(crate.id)!;
    home.update(crate.id, `Crate of pears [count::${i}]`, now.revision, { author: "user" });
    if (i % 40 === 0) run();
  }
  run();
  const logId = home.log.cursor().logId;
  const before = readdirSync(join(archive, "home", logId)).length;
  expect(trimArchive(archive, "home", logId)).toBeGreaterThan(0);
  expect(readdirSync(join(archive, "home", logId)).length).toBeLessThan(before);
  home.close();
  replayArchive(archive, "home", join(dir, "restored.sqlite"));
  expect(canonicalDump(new Database(join(dir, "restored.sqlite"), { readonly: true }))).toBe(dumpOf(join(dir, "home.sqlite")));
});

test("an archive refuses ranges that skip entries between them, and a relay from a trimmed sender restarts at its genesis", () => {
  const dir = root();
  const { home, shelf } = busyHome(dir);
  const archive = join(dir, "archive");
  const all = home.log.range(0, 20_000);
  const cut = all.entries.findIndex((e, i) => i > 0 && e.txn !== all.entries[i - 1]!.txn);
  const first = { ...all, entries: all.entries.slice(0, cut), complete: false };
  const gapped = { ...all, after: all.entries[cut + 3]!.lsn, prev: "0".repeat(64), entries: all.entries.slice(cut + 4) };
  expect(() => writeSegment(archive, "home", [first, gapped])).toThrow("don't follow each other");
  writeSegment(archive, "home", [first]);
  // The sender went on, compacted, and kept only what follows its newest genesis: this archive meets none of it.
  const crate = home.create("Crate of plums", shelf.id);
  for (let i = 0; i < 600 && !home.log.compact(1); i++) {
    const now = home.get(crate.id)!;
    home.update(crate.id, `Crate of plums [count::${i}]`, now.revision, { author: "user" });
  }
  home.update(crate.id, "Crate of plums [count::done]", home.get(crate.id)!.revision, { author: "user" });
  const sent: LogRange[] = [];
  for (let at = 0; ;) { const r = home.log.range(at, 500); sent.push(r); at = r.entries.at(-1)?.lsn ?? at; if (r.complete) break; }
  const logId = home.log.cursor().logId;
  const took = appendToArchive(archive, "home", sent);
  expect(took.lsn).toBe(home.log.cursor().lsn);
  expect(readdirSync(join(archive, "home"))).toContain(`${logId}~${first.entries.at(-1)!.lsn}`);
  home.close();
  replayArchive(archive, "home", join(dir, "restored.sqlite"), { logId });
  expect(canonicalDump(new Database(join(dir, "restored.sqlite"), { readonly: true }))).toBe(dumpOf(join(dir, "home.sqlite")));
});

test("a genesis carries AUTOINCREMENT's high-water marks: an id given out once is never given again after a restore", () => {
  const dir = root();
  const { home, jar } = busyHome(dir);
  const top = (db: Database) => (db.query("SELECT seq FROM sqlite_sequence WHERE name = 'block_edit_activity'").get() as { seq: number } | null)?.seq ?? 0;
  const before = top(home.database);
  // The newest activity rows go (a purge takes them), then a genesis is written without them.
  home.database.query("DELETE FROM block_edit_activity WHERE block_id = ?").run(jar.id);
  home.log.compact(0);
  const archive = join(dir, "archive");
  const ranges: LogRange[] = [];
  for (let at = 0; ;) { const r = home.log.range(at, 500); ranges.push(r); at = r.entries.at(-1)?.lsn ?? at; if (r.complete) break; }
  writeSegment(archive, "home", ranges);
  home.close();
  replayArchive(archive, "home", join(dir, "restored.sqlite"));
  const restored = new Database(join(dir, "restored.sqlite"), { readonly: true });
  expect(top(restored)).toBe(before);
  restored.close();
});

test("an import is an outline of its own: a fresh home log, whatever the file it came from (a follower's copy too)", () => {
  const dir = root();
  const { home, jar } = busyHome(dir);
  const follower = follow(home, join(dir, "follower.sqlite"));
  follower.catchUp();
  follower.db.close();
  const homeLog = home.log.cursor().logId;
  home.close();
  for (const from of ["home.sqlite", "follower.sqlite"]) {
    const target = join(dir, `imported-from-${from}`);
    importOutline(join(dir, from), target);
    const store = new OutlinerStore(target);
    try {
      expect(store.get(jar.id)?.text).toContain("Jar of lentils");
      const at = store.log.cursor();
      expect(at.logId).not.toBe(homeLog);
      store.create("Written after the import");
      // Logged: a write moves the log on, as at any home.
      expect(store.log.cursor().lsn).toBeGreaterThan(at.lsn);
      expect(store.log.range(at.lsn).entries.some(e => e.tbl === "blocks" && e.row?.includes("Written after the import"))).toBe(true);
    } finally { store.close(); }
    // And its log alone rebuilds it.
    const copy = new Database(join(dir, `copy-of-${from}`), { create: true });
    const db = new Database(target, { readonly: true });
    openFollowerSchema(copy, (db.query("SELECT log_id FROM log_state").get() as { log_id: string }).log_id);
    for (let at = 0; ;) { const r = readRange(db, at, 500, SCHEMA_VERSION); applyRange(copy, r, SCHEMA_VERSION); at = r.entries.at(-1)?.lsn ?? at; if (r.complete) break; }
    expect(canonicalDump(copy)).toBe(canonicalDump(db));
    db.close(); copy.close();
  }
});

test("a replay refuses an archive with a segment missing in the middle, or a genesis cut short, instead of a quiet gap", () => {
  const dir = root();
  const { home, shelf } = busyHome(dir);
  const archive = join(dir, "archive");
  const run = () => {
    const ranges: LogRange[] = [];
    let at = archivedCursor(archive, "home", home.log.cursor().logId)?.lsn ?? 0;
    for (;;) { const r = home.log.range(at, 50); ranges.push(r); at = r.entries.at(-1)?.lsn ?? at; if (r.complete) break; }
    writeSegment(archive, "home", ranges);
  };
  run();
  for (const words of ["Sack of oats", "Tin of cocoa", "Jar of honey"]) { home.create(words, shelf.id); run(); }
  const logId = home.log.cursor().logId;
  home.close();
  const folder = join(archive, "home", logId);
  const segments = readdirSync(folder).sort();
  expect(segments.length).toBe(4);
  // The whole archive replays.
  replayArchive(archive, "home", join(dir, "whole.sqlite"));
  // The third segment lost (a disk, a hand): refused, naming the gap.
  renameSync(join(folder, segments[2]!), join(dir, "lost.jsonl"));
  expect(() => replayArchive(archive, "home", join(dir, "gapped.sqlite"))).toThrow(/missing entries/);
  expect(existsSync(join(dir, "gapped.sqlite"))).toBe(false);
  renameSync(join(dir, "lost.jsonl"), join(folder, segments[2]!));
  // The genesis's own segment cut short: refused too.
  const first = join(folder, segments[0]!);
  const lines = readFileSync(first, "utf8").split("\n").filter(Boolean);
  const cut = JSON.parse(lines[0]!) as LogRange;
  writeFileSync(first, `${JSON.stringify({ ...cut, entries: cut.entries.slice(0, 5) })}\n${lines.slice(1).join("\n")}\n`);
  expect(() => replayArchive(archive, "home", join(dir, "short.sqlite"))).toThrow(/missing entries|genesis/);
});

test("opening a follower's copy writes nothing of the home's (no recovery of a refresh the home left running)", () => {
  const dir = root();
  const { home } = busyHome(dir);
  home.close();
  // The home was mid-refresh of a web page when the copy took its log (a test's own connection writes it).
  const raw = new Database(join(dir, "home.sqlite"));
  raw.query("INSERT INTO web_resource_state (resource_id, address_version, generation, freshness) VALUES ('res-1', 1, 1, 'refreshing')").run();
  // The follower takes it from the home's file as it is (the home's own store would recover it, as it should).
  const copy = new Database(join(dir, "follower.sqlite"), { create: true });
  openFollowerSchema(copy, (raw.query("SELECT log_id FROM log_state").get() as { log_id: string }).log_id);
  for (let at = 0; ;) { const r = readRange(raw, at, 500, SCHEMA_VERSION); applyRange(copy, r, SCHEMA_VERSION); at = r.entries.at(-1)?.lsn ?? at; if (r.complete) break; }
  raw.close();
  const before = canonicalDump(copy);
  const sequence = (db: Database) => (db.query("SELECT value FROM metadata WHERE key = 'sequence'").get() as { value: string }).value;
  const seq = sequence(copy);
  copy.close();
  // The copy's host opens it: the store's own recoveries must leave the home's rows as the home left them.
  new OutlinerStore(join(dir, "follower.sqlite")).close();
  const after = new Database(join(dir, "follower.sqlite"), { readonly: true });
  try {
    expect((after.query("SELECT freshness FROM web_resource_state WHERE resource_id = 'res-1'").get() as { freshness: string } | null)?.freshness).toBe("refreshing");
    expect(sequence(after)).toBe(seq);
    expect(canonicalDump(after)).toBe(before);
  } finally { after.close(); }
});
