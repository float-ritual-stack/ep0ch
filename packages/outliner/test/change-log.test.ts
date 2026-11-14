// PIE-1751, ADR 0009: the outline is its change log. A follower built only from the log equals its home, catches up
// after a gap, refuses a range that doesn't follow its cursor, and a replay of the archived log gives the same outline.
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRange, canonicalDump, COMPACT_FACTOR, compactionRoom, compactLog, LOG_RANGE_PAGE_BYTES, LOG_TABLES, RangeRefused, readRange, writeGenesis, type LogRange } from "../src/change-log";
import { appendToArchive, archivedCursor, letGoOtherChains, otherChains, replayArchive, trimArchive, writeSegment } from "../src/log-archive";
import { openFollowerSchema, SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { importOutline } from "../src/outline-import";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const root = () => { const r = realpathSync(mkdtempSync(join(tmpdir(), "outliner-change-log-"))); roots.push(r); return r; };

/** A compaction run to its end, as the host runs it: the genesis, then each step that gives back what it replaced. */
function compactAll(home: OutlinerStore, factor?: number): boolean {
  const compacted = home.log.compact(factor);
  while (home.log.trim()) { /* the next step */ }
  return compacted;
}

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

test("a page is cut by its size as well as its count, at a transaction's end, so a slow line carries it in time", () => {
  // float-2, Nov 12 (PIE-1779): a follower's 5,000-entry page of a big outline was 10 MB; over the laptop's 0.7 MB/s it
  // outran the 15 s a request waits, so the rebuild never finished.
  const dir = root();
  const home = new OutlinerStore(join(dir, "home.sqlite"));
  for (let i = 0; i < 30; i++) home.create(`Seed catalogue ${i}\n${"Sow after the last frost. ".repeat(4_000)}`);
  const bytes = (r: LogRange) => r.entries.reduce((n, e) => n + (e.row?.length ?? 0) + (e.key?.length ?? 0), 0);
  const pages: LogRange[] = [];
  for (let after = 0; ;) {
    const page = home.log.range(after, 5_000);
    pages.push(page);
    if (page.complete) break;
    after = page.entries.at(-1)!.lsn;
  }
  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) {
    const last = page.entries.at(-1)!.txn, before = { ...page, entries: page.entries.filter(e => e.txn !== last) };
    // Under the budget until its last transaction, which it finishes whole.
    expect(bytes(before)).toBeLessThan(LOG_RANGE_PAGE_BYTES);
  }
  const follower = join(dir, "follower.sqlite");
  const db = new Database(follower, { create: true });
  openFollowerSchema(db, home.log.cursor().logId);
  for (const page of pages) applyRange(db, page, SCHEMA_VERSION);
  expect(canonicalDump(db)).toBe(dumpOf(join(dir, "home.sqlite")));
  db.close(); home.close();
});

test("a delete, restore, purge or move logs the rows it changes, not every block (PIE-1786)", () => {
  // float-2, Nov 12: EchoNet's toss deleted a note in pie every 30 minutes, and each delete rewrote all 28,700 blocks
  // unchanged (the Trash roots worked out again), each logged whole: 47 MB a delete, 281 MB in 2.5 h.
  const dir = root();
  const home = new OutlinerStore(join(dir, "home.sqlite"));
  const shelf = home.create("Seed shelf");
  for (let i = 0; i < 300; i++) home.create(`Seed packet ${i}\n${"Sow in spring. ".repeat(20)}`, i % 2 ? shelf.id : null);
  const stray = home.create("Old receipt", shelf.id);
  const logged = (f: () => void) => {
    const before = home.log.cursor().lsn;
    f();
    const entries = home.log.range(before, 20_000).entries;
    return { blocks: entries.filter(e => e.tbl === "blocks").length, all: entries.length };
  };
  const deleted = logged(() => home.delete(stray.id, { author: "agent", actorId: "echo-bot" }));
  expect(deleted.blocks).toBeLessThanOrEqual(2);
  expect(deleted.all).toBeLessThan(20);
  expect(logged(() => home.restore(stray.id, { author: "user" })).blocks).toBeLessThanOrEqual(2);
  home.delete(stray.id, { author: "user" });
  expect(logged(() => home.purge(stray.id, stray.id.slice(0, 8))).blocks).toBeLessThanOrEqual(2);
  // A move rewrites only the siblings whose place changed: the last child to the end of its own list moves nothing else.
  const children = home.children(shelf.id);
  expect(logged(() => home.move(children[0]!.id, shelf.id, children.length, { author: "user" })).blocks).toBeLessThanOrEqual(children.length + 1);
  const last = home.children(shelf.id).at(-1)!;
  expect(logged(() => home.move(last.id, shelf.id, children.length, { author: "user" })).blocks).toBeLessThanOrEqual(1);
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
  for (let i = 0; i < 600 && !compactAll(home, 1); i++) {
    const now = home.get(crate.id)!;
    home.update(crate.id, `Crate of apples [count::${i}]\nCounted again.`, now.revision, { author: "user" });
    if (i % 50 === 0) near.catchUp();
  }
  near.catchUp();
  expect(canonicalDump(near.db)).toBe(dumpOf(join(dir, "home.sqlite")));
  // Another generation: what followed the far copy's cursor is gone from the home's log.
  for (let i = 0; i < 600 && !compactAll(home, 1); i++) {
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

test("weeks of edits keep the file within about 2x the outline, and each compaction gives the space back (PIE-1786)", () => {
  // float-2, Nov 12: pie.sqlite went from 384 MB to 1.07 GB in 2.5 h; compaction waited for 4x its genesis and kept one
  // generation back, and deleting entries never shrank the file.
  const dir = root();
  const path = join(dir, "home.sqlite");
  const home = new OutlinerStore(path);
  // Shaped like pie (Nov 12: 28,500 notes; ten properties and ten reference candidates a note, 1.6 KB of text).
  const body = (i: number, n: number) => `${"Sow after the frost; water at dusk. ".repeat(12)}${Array.from({ length: 8 }, (_, k) => `[field-${k}::${(i * 7 + k + n) % 13}]`).join(" ")} [[Seed packet ${(i + 1) % 400}]] [[Seed packet ${(i + 2) % 400}]] ((${i}))`;
  const notes = Array.from({ length: 400 }, (_, i) => home.create(`Seed packet ${i} [crop::beans] [bed::${i % 9}]\n${body(i, 0)}`));
  // The outline's own size: its rows and indexes with no log, as a VACUUM packs them.
  const own = () => {
    const copy = join(dir, `own-${Math.random().toString(36).slice(2)}.sqlite`);
    home.database.exec(`VACUUM INTO '${copy}'`);
    const db = new Database(copy);
    db.exec("DELETE FROM change_log"); db.exec("VACUUM");
    db.close();
    const n = statSync(copy).size; rmSync(copy, { force: true });
    return n;
  };
  const onDisk = () => {
    home.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return statSync(path).size + (existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0);
  };
  // Right after a compaction the file is the outline and one genesis (its floor); between two it grows by at most a
  // quarter genesis of edits. The floor never creeps: every compaction gives the pages it freed back to the disk.
  const ratios: { day: number; ratio: number; compacted: boolean }[] = [];
  for (let day = 0; day < 40; day++) {
    for (let i = 0; i < 150; i++) {
      const note = notes[(day * 150 + i) % notes.length]!, now = home.get(note.id)!;
      home.update(note.id, `${now.text.split("\n")[0].replace(/ \[day::\d+\]$/, "")} [day::${day}]\n${body(i, day)}`, now.revision, { author: "agent", actorId: "garden-bot" });
    }
    const compacted = compactAll(home);
    ratios.push({ day, ratio: onDisk() / own(), compacted });
  }
  const floors = ratios.filter(r => r.compacted).map(r => r.ratio);
  expect(floors.length).toBeGreaterThan(5);
  // No creep: the last floor is within 10% of the first.
  expect(floors.at(-1)! / floors[0]!).toBeLessThan(1.1);
  // Between compactions the file grows by well under the outline's own size again.
  expect(Math.max(...ratios.map(r => r.ratio)) - Math.max(...floors)).toBeLessThan(0.6);
  home.close();
}, 120_000);

/** A pie-shaped outline whose log has grown past its compaction point, and its size on disk (file and WAL). */
function grownHome(dir: string, notes = 600, days = 3, words = "Sow after the frost; water at dusk. ") {
  const path = join(dir, "home.sqlite");
  const home = new OutlinerStore(path);
  const body = (i: number, n: number) => `${words.repeat(12)}${Array.from({ length: 8 }, (_, k) => `[field-${k}::${(i * 7 + k + n) % 13}]`).join(" ")} [[Seed packet ${(i + 1) % notes}]]`;
  const made = Array.from({ length: notes }, (_, i) => home.create(`Seed packet ${i}\n${body(i, 0)}`));
  for (let day = 1; day <= days; day++) for (const [i, note] of made.entries()) {
    const now = home.get(note.id)!;
    home.update(note.id, `Seed packet ${i} [day::${day}]\n${body(i, day)}`, now.revision, { author: "agent", actorId: "garden-bot" });
  }
  const onDisk = () => statSync(path).size + (existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0);
  return { home, path, onDisk };
}

test("a compaction's room is its physical peak: the file and its WAL as the new genesis lands (Codex on #1500)", () => {
  const { home, onDisk } = grownHome(root());
  home.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const needs = compactionRoom(home.database);
  expect(() => compactLog(home.database, SCHEMA_VERSION, COMPACT_FACTOR, needs - 1)).toThrow(/not compacted: a new genesis needs/);
  const before = onDisk();
  // What a compaction writes first, before it frees anything: its peak.
  writeGenesis(home.database, SCHEMA_VERSION);
  expect(onDisk() - before).toBeLessThanOrEqual(needs);
  home.close();
}, 30_000);

/** The bytes on disk a new genesis adds, as a compaction writes it first: its peak. */
function genesisPeak(home: OutlinerStore, onDisk: () => number) {
  home.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const before = onDisk();
  writeGenesis(home.database, SCHEMA_VERSION);
  return onDisk() - before;
}

test("the room counts UTF-8 bytes, so notes in another script are budgeted as they land (Codex on #1500)", () => {
  const { home, onDisk } = grownHome(root(), 1000, 0, "種は霜の後に蒔き🌱🌧🌾🌻🍅🥕🌽🥬🫘🌿🍃🌸 ");
  const needs = compactionRoom(home.database);
  expect(genesisPeak(home, onDisk)).toBeLessThanOrEqual(needs);
  home.close();
}, 30_000);

test("the room is the outline as it is now, not its rewrites: a log of many rewrites still compacts (Codex on #1500)", () => {
  const { home, onDisk } = grownHome(root(), 150, 8);
  const needs = compactionRoom(home.database);
  const peak = genesisPeak(home, onDisk);
  expect(peak).toBeLessThanOrEqual(needs);
  // Sized to the new genesis, not to the twenty rewrites behind it.
  expect(needs).toBeLessThan(peak * 4);
  home.close();
}, 30_000);

test("a compaction gives its space back in bounded steps between requests, each well inside a client's wait (Codex on #1500)", () => {
  const { home, onDisk } = grownHome(root(), 900, 4);
  expect(home.log.compact()).toBe(true);
  const before = onDisk();
  let steps = 0, longest = 0;
  for (;;) {
    const started = performance.now();
    const more = home.log.trim();
    longest = Math.max(longest, performance.now() - started);
    steps++;
    if (!more) break;
  }
  expect(steps).toBeGreaterThan(1);
  expect(longest).toBeLessThan(250);
  expect((home.database.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count).toBe(0);
  expect(onDisk()).toBeLessThan(before);
  // Nothing before the new genesis's predecessor's edits is left, and the log still answers from its genesis.
  expect(home.log.range(0, 5).entries[0]!.op).toBe("g");
  home.close();
}, 60_000);

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
  for (let i = 0; i < 600 && !compactAll(home, 1); i++) {
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

test("an archive lets go of the other chains a snapshot holds whole, and of none while its current log holds nothing (PIE-1806)", () => {
  const archive = join(root(), "archive");
  const chain = (name: string, last: number, bytes = 10) => {
    mkdirSync(join(archive, "home", name), { recursive: true });
    writeFileSync(join(archive, "home", name, `0000000000000001-${String(last).padStart(16, "0")}.jsonl`), JSON.stringify({ entries: [], pad: "x".repeat(bytes) }) + "\n");
  };
  chain("an-earlier-log", 40, 400);
  chain("the-current-log~120", 120, 200);
  chain("a-later-tail", 9);
  expect(otherChains(archive, "home", "the-current-log")).toEqual([{ chain: "a-later-tail", lsn: 9 }, { chain: "an-earlier-log", lsn: 40 }, { chain: "the-current-log~120", lsn: 120 }]);
  const held = [{ chain: "an-earlier-log", lsn: 40 }, { chain: "the-current-log~120", lsn: 120 }, { chain: "a-later-tail", lsn: 8 }];
  // The current log has no chain yet (its first segment wasn't written): nothing goes.
  expect(letGoOtherChains(archive, "home", "the-current-log", held)).toEqual([]);
  chain("the-current-log", 10);
  const gone = letGoOtherChains(archive, "home", "the-current-log", held);
  expect(gone.map(g => g.chain)).toEqual(["an-earlier-log", "the-current-log~120"]);
  expect(gone.every(g => g.bytes > 200)).toBe(true);
  // A chain holding an entry past what the snapshot holds of it stays.
  expect(readdirSync(join(archive, "home")).sort()).toEqual(["a-later-tail", "the-current-log"]);
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
  for (let i = 0; i < 600 && !compactAll(home, 1); i++) {
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
  compactAll(home, 0);
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
