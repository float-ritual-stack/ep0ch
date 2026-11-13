import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOutline } from "../src/outline-import";
import { insertOutlineInstanceId, openSchema, readOutlineInstanceId, SCHEMA_SQL, SCHEMA_VERSION, schemaRefusal } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { ownerLockOf } from "../src/workspace-ownership";
import { migrateIncrementalVacuum } from "../scripts/migrations/0013-incremental-vacuum";
import { canonicalDump, initLogState, installLogTriggers, readRange, writeGenesis, type LogRange } from "../src/change-log";
import { archivedCursor, replayArchive, writeSegment } from "../src/log-archive";

const directories: string[] = [];
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "outliner-schema-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

const userVersion = (path: string) => {
  const database = new Database(path, { readonly: true });
  try { return (database.query("PRAGMA user_version").get() as { user_version: number }).user_version; } finally { database.close(); }
};

const outlineInstanceId = (path: string) => {
  const database = new Database(path, { readonly: true });
  try { return readOutlineInstanceId(database, path); } finally { database.close(); }
};

/** A database with the current schema's shape and no stamp: what a database from before stamping looks like. */
function unstamped(path: string, change?: (database: Database) => void): void {
  const database = new Database(path, { create: true });
  database.exec(SCHEMA_SQL);
  change?.(database);
  database.close();
}

test("a new file gets the schema, stamp and outline instance id", () => {
  const path = join(directory(), "outliner.sqlite");
  const store = new OutlinerStore(path);
  const id = store.outlineInstanceId;
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  store.close();
  expect(userVersion(path)).toBe(SCHEMA_VERSION);
  expect(outlineInstanceId(path)).toBe(id);
  const reopened = new OutlinerStore(path);
  expect(reopened.outlineInstanceId).toBe(id);
  expect(reopened.queryBlocks({ filters: [{ key: "system-view", value: "inbox" }], limit: 2 }).blocks).toHaveLength(1);
  reopened.close();
});

test("a database from before schema versions is refused, untouched, with the import route", () => {
  const path = join(directory(), "outliner.sqlite");
  unstamped(path);
  const before = readFileSync(path);
  expect(() => new OutlinerStore(path)).toThrow(new RegExp(`schema version 0 .*opens only schema version ${SCHEMA_VERSION}.*No script migrates schema 0.*\n  mv \\S+outliner\\.sqlite \\S+outliner\\.sqlite\\.schema-0\n.*\n  ep0ch outline import \\S+outliner\\.sqlite\\.schema-0 outliner$`, "s"));
  expect(readFileSync(path).equals(before)).toBe(true);
  expect(userVersion(path)).toBe(0);
});

test("any other schema version is refused", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  const database = new Database(path);
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  database.close();
  expect(() => new OutlinerStore(path)).toThrow(`is schema version ${SCHEMA_VERSION + 1}; this build opens only schema version ${SCHEMA_VERSION}`);
});

/** Every table, index and trigger, as sqlite_master has them. */
const shape = (database: Database) => database.query("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();

/** A schema-12 file as the machines have them: no incremental vacuum, its log grown past its genesis. */
function schema12(path: string, notes: number) {
  const old = new Database(path);
  old.exec(SCHEMA_SQL);
  insertOutlineInstanceId(old);
  initLogState(old);
  installLogTriggers(old);
  writeGenesis(old, 12);
  old.exec("PRAGMA user_version = 12; PRAGMA journal_mode = WAL;");
  const ids: string[] = [];
  const add = old.query("INSERT INTO blocks (id, position, text, author, created_at, updated_at) VALUES (?, ?, ?, 'user', '2026-11-01', '2026-11-01')");
  for (let i = 0; i < notes; i++) { const id = crypto.randomUUID(); ids.push(id); add.run(id, i, `Seed tray ${i}\n${"Water from below. ".repeat(40)}`); }
  // A day of the rewrite PIE-1786 found: every note written back unchanged, each logged whole.
  for (let round = 0; round < 6; round++) old.exec("UPDATE blocks SET effective_deleted_root_id = NULL");
  old.close();
  return ids;
}

test("schema 12 takes 0013: the file made again, incremental, its log one genesis; a served, full or current file is left as it was (PIE-1786)", async () => {
  const path = join(directory(), "allotment.sqlite");
  const ids = schema12(path, 300);
  const size = () => statSync(path).size + (existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0);
  const at12 = readFileSync(path), before = size();
  expect(() => new OutlinerStore(path)).toThrow(/schema version 12.*only schema version 13.*0013-incremental-vacuum\.ts/s);

  const migrate = async () => {
    const run = Bun.spawn(["bun", join(import.meta.dir, "../scripts/migrations/0013-incremental-vacuum.ts"), path], { stdout: "pipe", stderr: "pipe" });
    return { code: await run.exited, out: await new Response(run.stdout).text(), err: await new Response(run.stderr).text() };
  };
  const held = new Database(ownerLockOf(path).path);
  held.exec("BEGIN IMMEDIATE");
  try { expect(await migrate()).toMatchObject({ code: 1, err: expect.stringContaining("already owned") }); }
  finally { held.close(); }
  expect(readFileSync(path).equals(at12)).toBe(true);
  // No room on its filesystem: refused before anything is written.
  expect(() => migrateIncrementalVacuum(path, { free: () => 1024 })).toThrow(/needs about \d+ MB .* has 0 MB free/);
  expect(readFileSync(path).equals(at12)).toBe(true);
  expect(existsSync(`${path}.schema-13.tmp`)).toBe(false);

  const ran = await migrate();
  expect(ran).toMatchObject({ code: 0, out: expect.stringContaining("auto_vacuum incremental") });
  expect(userVersion(path)).toBe(13);
  expect(size()).toBeLessThan(before / 2);
  const fresh = new Database(":memory:");
  openSchema(fresh);
  const migrated = new Database(path, { readonly: true });
  try {
    expect(shape(migrated)).toEqual(shape(fresh));
    expect((migrated.query("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum).toBe(2);
    expect((migrated.query("SELECT COUNT(*) AS n FROM blocks").get() as { n: number }).n).toBe(300);
    // The log begun again: one genesis, each note in it once.
    const log = migrated.query("SELECT op, tbl FROM change_log ORDER BY lsn").all() as { op: string; tbl: string }[];
    expect(log[0]).toEqual({ op: "g", tbl: "" });
    expect(log.filter(e => e.tbl === "blocks").length).toBe(300);
    expect(readOutlineInstanceId(migrated, path)).toBeTruthy();
  } finally { migrated.close(); fresh.close(); }
  const store = new OutlinerStore(path);
  try {
    expect(store.require(ids[7]!).text).toStartWith("Seed tray 7");
    const head = store.log.cursor().lsn;
    store.create("Label the trays");
    expect(store.log.range(head).entries.some(e => e.tbl === "blocks" && e.op === "i" && e.row?.includes("Label the trays"))).toBe(true);
  } finally { store.close(); }

  const at13 = readFileSync(path);
  expect(await migrate()).toMatchObject({ code: 1, err: expect.stringContaining("Expected schema 12, found 13") });
  expect(readFileSync(path).equals(at13)).toBe(true);
}, 60_000);

test("after 0013 the archive starts a new chain at the new log's genesis, and a restore from it is the outline (Codex on #1500)", () => {
  const dir = directory(), path = join(dir, "allotment.sqlite"), archive = join(dir, "archive");
  schema12(path, 120);
  // The backup job's run (jobs.ts newRanges): the log after what the archive holds of this log id, to its head.
  const archiveRun = () => {
    const db = new Database(path, { readonly: true });
    try {
      const logId = (db.query("SELECT log_id FROM log_state").get() as { log_id: string }).log_id;
      const schema = userVersion(path);
      const ranges: LogRange[] = [];
      let at = archivedCursor(archive, "allotment", logId)?.lsn ?? 0;
      for (;;) { const r = readRange(db, at, 500, schema); ranges.push(r); at = r.entries.at(-1)?.lsn ?? at; if (r.complete) break; }
      writeSegment(archive, "allotment", ranges);
      return logId;
    } finally { db.close(); }
  };
  const before = archiveRun();
  migrateIncrementalVacuum(path);
  const after = archiveRun();
  expect(after).not.toBe(before);
  replayArchive(archive, "allotment", join(dir, "restored.sqlite"));
  const restored = new Database(join(dir, "restored.sqlite"), { readonly: true }), live = new Database(path, { readonly: true });
  try { expect(canonicalDump(restored)).toBe(canonicalDump(live)); } finally { restored.close(); live.close(); }
});

test("0013 refuses when a reader holds the WAL back, and keeps the outline's mode on the new file (Codex on #1500)", () => {
  const dir = directory(), path = join(dir, "allotment.sqlite");
  schema12(path, 40);
  chmodSync(path, 0o600);
  // A reader in the middle of a read: the checkpoint can't empty the WAL, so the old file must stay.
  const reader = new Database(path, { readonly: true });
  reader.exec("BEGIN");
  reader.query("SELECT COUNT(*) FROM blocks").get();
  const writer = new Database(path);
  writer.exec("UPDATE blocks SET position = position + 1 WHERE rowid = 1");
  writer.close();
  const at12 = readFileSync(path);
  try { expect(() => migrateIncrementalVacuum(path)).toThrow(/checkpoint/); }
  finally { reader.exec("COMMIT"); reader.close(); }
  expect(readFileSync(path).equals(at12)).toBe(true);
  expect(userVersion(path)).toBe(12);
  const umask = process.umask(0o022);
  try { migrateIncrementalVacuum(path); } finally { process.umask(umask); }
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(userVersion(path)).toBe(13);
});

test("a current database missing its instance id is refused with the import route, and the import opens", () => {
  const folder = directory();
  const path = join(folder, "allotment.sqlite");
  const store = new OutlinerStore(path);
  store.create("Leeks by the wall");
  store.close();
  const database = new Database(path);
  database.query("DELETE FROM metadata WHERE key = 'outline_instance_id'").run();
  database.close();
  let said = "";
  try { outlineInstanceId(path); } catch (e) { said = (e as Error).message; }
  expect(said).toContain(`${path} has no valid outline instance id. Import its notes into a new outline (it gets one):\n\n`);
  expect(said).toContain(`\n  mv ${path} ${path}.old\n`);
  expect(said).toContain(`\n  ep0ch outline import ${path}.old allotment`);
  renameSync(path, `${path}.old`);
  importOutline(`${path}.old`, path);
  const reopened = new OutlinerStore(path);
  expect(reopened.outlineInstanceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(reopened.database.query("SELECT text FROM blocks WHERE text = 'Leeks by the wall'").all()).toHaveLength(1);
  reopened.close();
});

test("a copied database file has a different outline instance id", () => {
  const root = directory();
  const source = join(root, "source.sqlite");
  const target = join(root, "restored-copy.sqlite");
  const first = new OutlinerStore(source);
  const originalId = first.outlineInstanceId;
  first.close();
  copyFileSync(source, target);
  const restored = new OutlinerStore(target);
  expect(restored.outlineInstanceId).not.toBe(originalId);
  restored.close();
});

test("an open that never closed (a crash) gives the next open a new instance id", () => {
  const path = join(directory(), "outliner.sqlite");
  const first = new OutlinerStore(path);
  const id = first.outlineInstanceId;
  first.close();
  // What a crash leaves: the record of an open that never said it ended.
  const record = `${realpathSync(path)}.instance.json`;
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, "utf8")), open: true }));
  const after = new OutlinerStore(path);
  expect(after.outlineInstanceId).not.toBe(id);
  after.close();
});

test("the instance id stays put across reopens, whatever the file's inode or device", () => {
  const root = directory();
  const path = join(root, "outliner.sqlite");
  const first = new OutlinerStore(path);
  const id = first.outlineInstanceId;
  first.create("Fictional note before the restart");
  first.close();
  // A reboot can renumber the device, and a file moved away and back has a new inode: neither replaces the database.
  renameSync(path, join(root, "moved.sqlite"));
  copyFileSync(join(root, "moved.sqlite"), path);
  rmSync(join(root, "moved.sqlite"));
  for (let open = 0; open < 3; open += 1) {
    const reopened = new OutlinerStore(path);
    expect(reopened.outlineInstanceId).toBe(id);
    reopened.create(`Fictional note ${open}`);
    reopened.close();
  }
});

test("a backup restored in place over the same file gets a new instance id", () => {
  const root = directory();
  const path = join(root, "outliner.sqlite");
  const backup = join(root, "backup.sqlite");
  const store = new OutlinerStore(path);
  const id = store.outlineInstanceId;
  store.create("Fictional note in the backup");
  store.database.exec(`VACUUM INTO '${backup}'`);
  store.create("Fictional note after the backup");
  store.close();
  const inode = statSync(path).ino;
  // `cp backup over the file`: same inode, the backup's own (identical) metadata id.
  writeFileSync(path, readFileSync(backup));
  for (const suffix of ["-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  expect(statSync(path).ino).toBe(inode);
  expect(outlineInstanceId(path)).toBe(id);
  const restored = new OutlinerStore(path);
  expect(restored.outlineInstanceId).not.toBe(id);
  const restoredId = restored.outlineInstanceId;
  restored.close();
  const reopened = new OutlinerStore(path);
  expect(reopened.outlineInstanceId).toBe(restoredId);
  reopened.close();
});

test("a restore to an earlier point of the same open (a continuous backup) gets a new instance id", () => {
  const root = directory();
  const path = join(root, "outliner.sqlite");
  const backup = join(root, "backup.sqlite");
  new OutlinerStore(path).close();
  const store = new OutlinerStore(path);
  const id = store.outlineInstanceId;
  // Taken during this open, so it carries this open's token; only its sequence is behind.
  store.database.exec(`VACUUM INTO '${backup}'`);
  store.create("Fictional note after the backup");
  store.close();
  writeFileSync(path, readFileSync(backup));
  for (const suffix of ["-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  const restored = new OutlinerStore(path);
  expect(restored.outlineInstanceId).not.toBe(id);
  restored.close();
});

test("an in-memory store has an instance id without a file", () => {
  const first = new OutlinerStore(":memory:");
  const second = new OutlinerStore(":memory:");
  expect(first.outlineInstanceId).toMatch(/^[0-9a-f]{8}-/);
  expect(second.outlineInstanceId).not.toBe(first.outlineInstanceId);
  first.close();
  second.close();
});

test("import makes a new outline with the blocks, properties, page addresses and work ids; it never writes over one", () => {
  const root = directory();
  const source = join(root, "old.sqlite");
  const target = join(root, "new.sqlite");
  const store = new OutlinerStore(source);
  store.configureWorkIdPrefix("FIC");
  const page = store.create("Fictional page [page::garden-notes]");
  store.update(page.id, "Fictional page [page::garden-journal]", page.revision);
  const parent = store.create("Fictional parent [type::project-doc]");
  store.create("Fictional child [status::draft]", parent.id);
  const trashed = store.create("Fictional discard");
  store.delete(trashed.id);
  store.create("Fictional work [type::work-queue] [project::garden]");
  store.createRoadmapItem({ title: "A fictional outcome", project: "garden", arc: "growth", tracks: ["growth"], priority: "low" });
  store.configureMcpAccess("read");
  const counts = (database: Database) => Object.fromEntries(["blocks", "block_properties", "page_addresses", "reserved_work_ids"].map(table =>
    [table, (database.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
  const before = counts(store.database);
  const sourceDatabaseId = outlineInstanceId(source);
  store.close();
  const sourceBytes = readFileSync(source);

  const report = importOutline(source, target);
  expect(report).toMatchObject({ blocks: before.blocks, properties: before.block_properties, pageAddresses: before.page_addresses, workIds: before.reserved_work_ids });
  expect(report.notCarried).toHaveProperty("selection");
  expect(readFileSync(source).equals(sourceBytes)).toBe(true);
  expect(userVersion(target)).toBe(SCHEMA_VERSION);
  expect(outlineInstanceId(target)).not.toBe(sourceDatabaseId);

  const imported = new OutlinerStore(target);
  // An MCP grant is the old outline's disclosure decision; the new one starts at none.
  expect(imported.mcpAccessStatus()).toMatchObject({ level: "none", canRead: false });
  const kinds = Object.fromEntries((imported.database.query("SELECT display_address, kind FROM page_addresses WHERE block_id = ?").all(page.id) as Array<{ display_address: string; kind: string }>)
    .map(row => [row.display_address, row.kind]));
  // The renamed page keeps its old address as an alias.
  expect(kinds).toEqual({ "garden-journal": "page", "garden-notes": "alias" });
  expect(imported.require(trashed.id).deletedAt).toBeDefined();
  expect(imported.require(parent.id).text).toBe("Fictional parent [type::project-doc]");
  imported.close();

  expect(() => importOutline(source, target)).toThrow("already exists");
  expect(existsSync(target)).toBe(true);
});

test("two imports to one name: the one that finds it claimed is refused and touches nothing; a finished import leaves no claim (PIE-636)", () => {
  const root = directory();
  const source = join(root, "old.sqlite");
  const target = join(root, "new.sqlite");
  new OutlinerStore(source).close();
  // Another import is under way: it holds the claim, and the file it is filling is not ours to touch or remove.
  const claim = `${target}.import-claim`;
  writeFileSync(claim, "");
  writeFileSync(target, "half-filled by the other import");
  expect(() => importOutline(source, target)).toThrow("being imported");
  expect(readFileSync(target, "utf8")).toBe("half-filled by the other import");
  expect(existsSync(claim)).toBe(true);
  rmSync(target);
  rmSync(claim);
  importOutline(source, target);
  expect(existsSync(claim)).toBe(false);
  expect(userVersion(target)).toBe(SCHEMA_VERSION);
});

describe("the refusal says the exact commands for this machine (PIE-617)", () => {
  // A made-up step for the version before this one, in a migrations folder of the test's own.
  const migrations = mkdtempSync(join(tmpdir(), "outliner-migrations-"));
  afterAll(() => rmSync(migrations, { recursive: true, force: true }));
  const SCRIPT = join(migrations, `${String(SCHEMA_VERSION).padStart(4, "0")}-seed-trays.ts`);
  writeFileSync(SCRIPT, "");
  const at = (folder: string, name: string, version: number) => {
    const path = join(folder, `${name}.sqlite`);
    const database = new Database(path);
    database.exec(`CREATE TABLE marker (x); PRAGMA user_version = ${version}`);
    database.close();
    return path;
  };

  test("one step behind: install, or by hand the stop, a line per outline at that version here (real paths), the start", () => {
    const folder = directory();
    const hub = at(folder, "float-hub", SCHEMA_VERSION - 1), log = at(folder, "sysops-log", SCHEMA_VERSION - 1);
    at(folder, "current", SCHEMA_VERSION);
    expect(schemaRefusal(`The outline database ${hub}`, SCHEMA_VERSION - 1, hub, { platform: "darwin", home: "/Users/wren", migrations })).toBe([
      `The outline database ${hub} is schema version ${SCHEMA_VERSION - 1}; this build opens only schema version ${SCHEMA_VERSION}.`,
      `Migrate it, and the 1 other outline here at schema ${SCHEMA_VERSION - 1}, with:`,
      "",
      "  ep0ch install --apply",
      "",
      "or by hand:",
      "",
      "  launchctl bootout gui/$(id -u)/io.ep0ch.outliner-host",
      `  bun ${SCRIPT} ${hub}`,
      `  bun ${SCRIPT} ${log}`,
      "  launchctl bootstrap gui/$(id -u) /Users/wren/Library/LaunchAgents/io.ep0ch.outliner-host.plist",
    ].join("\n"));
    const linux = schemaRefusal(`The outline database ${hub}`, SCHEMA_VERSION - 1, hub, { platform: "linux", migrations });
    expect(linux).toContain("\n  systemctl --user stop outliner-host.service\n");
    expect(linux).toEndWith("\n  systemctl --user start outliner-host.service");
    // Nothing to fill in: no placeholders, no prose about services, no colour.
    expect(linux).not.toMatch(/<[a-z]+>|while no service|\x1b\[/);
  });

  test("no script for the step: the import route, with the real file and name", () => {
    const folder = directory();
    const old = at(folder, "seed-bank", 1);
    expect(schemaRefusal(`The outline database ${old}`, 1, old, { platform: "linux", migrations })).toBe([
      `The outline database ${old} is schema version 1; this build opens only schema version ${SCHEMA_VERSION}.`,
      `No script migrates schema 1 to ${SCHEMA_VERSION}; import its notes into a new outline:`,
      "",
      "  systemctl --user stop outliner-host.service",
      `  mv ${old} ${old}.schema-1`,
      "  systemctl --user start outliner-host.service",
      `  ep0ch outline import ${old}.schema-1 seed-bank`,
    ].join("\n"));
  });

  // Two steps behind never has a script, whether or not this build ships one for the last step (0013 names its own).
  test("the store's refusal is that message: with no script for the step, the import route; a path that needs quoting is quoted", () => {
    const folder = join(directory(), "my outlines");
    mkdirSync(folder);
    const behind = SCHEMA_VERSION - 2;
    const path = at(folder, "float-hub", behind);
    let said = "";
    try { new OutlinerStore(path).close(); } catch (e) { said = (e as Error).message; }
    expect(said).not.toContain("ep0ch install --apply");
    expect(said).toContain(`\n  mv '${path}' '${path}.schema-${behind}'\n`);
    expect(said).toContain(`\n  ep0ch outline import '${path}.schema-${behind}' float-hub`);
  });
});


test("the reference index keeps backlinks current through edits, an aborted edit, reopen, trash and restore", () => {
  const path = join(directory(), "outliner.sqlite");
  let store = new OutlinerStore(path);
  const target = store.create("Destination [page::Garden]");
  const other = store.create("Other destination");
  const source = store.create(`Source ((${target.id})) [[Garden]]`);
  try {
    const links = (id: string) => store.queryBacklinks({ targetBlockId: id, limit: 10 });
    expect(links(target.id).sources).toMatchObject([{ blockId: source.id, occurrenceCount: 2 }]);
    expect(store.get(source.id)).toMatchObject({ text: source.text, revision: source.revision });
    expect(() => store.database.transaction(() => {
      store.update(source.id, `Changed ((${other.id}))`, source.revision);
      throw new Error("aborted edit");
    })()).toThrow("aborted edit");
    expect(links(target.id).sources).toMatchObject([{ blockId: source.id, occurrenceCount: 2 }]);
    store.update(source.id, `Changed ((${other.id})) [[Future garden]]`, source.revision);
    expect(links(target.id).sources).toEqual([]);
    const page = store.create("Later page [page::Future garden]");
    expect(links(page.id).sources).toMatchObject([{ blockId: source.id }]);
    store.close();
    store = new OutlinerStore(path);
    expect(links(other.id).sources).toMatchObject([{ blockId: source.id }]);
    expect(links(page.id).sources).toMatchObject([{ blockId: source.id }]);
    store.delete(source.id);
    expect(links(other.id).sources).toEqual([]);
    store.restore(source.id);
    expect(links(other.id).sources).toMatchObject([{ blockId: source.id }]);
  } finally { store.close(); }
});
