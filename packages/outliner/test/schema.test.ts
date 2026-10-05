import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOutline } from "../src/outline-import";
import { readOutlineInstanceId, SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { freshSchemaShape, schemaDifferences, schemaShape, stamp } from "../scripts/migrations/0001-stamp";
import { migrate } from "../scripts/migrations/0002-outline-instance-id";

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

test("a database from before schema versions is refused, untouched, with the command that upgrades it", () => {
  const path = join(directory(), "outliner.sqlite");
  unstamped(path);
  const before = readFileSync(path);
  expect(() => new OutlinerStore(path)).toThrow(new RegExp(`schema version 0 .*opens only schema version ${SCHEMA_VERSION}.*0001-stamp\\.ts`, "s"));
  expect(readFileSync(path).equals(before)).toBe(true);
  expect(userVersion(path)).toBe(0);
});

test("any other schema version is refused", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  const database = new Database(path);
  database.exec("PRAGMA user_version = 7");
  database.close();
  expect(() => new OutlinerStore(path)).toThrow(`is schema version 7; this build opens only schema version ${SCHEMA_VERSION}`);
});

test("the stamp script stamps a database whose shape matches, column order and formatting aside", () => {
  const path = join(directory(), "outliner.sqlite");
  // As `ALTER TABLE … ADD COLUMN` left it: the draft's last three columns appended after the others.
  unstamped(path, database => database.exec(`
    DROP TABLE quick_capture_draft;
    CREATE TABLE quick_capture_draft (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), request_id TEXT NOT NULL, text TEXT NOT NULL,
      cursor_row INTEGER NOT NULL CHECK (cursor_row >= 0), cursor_column INTEGER NOT NULL CHECK (cursor_column >= 0),
      captured_from_block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL, revision INTEGER NOT NULL CHECK (revision >= 1), updated_at TEXT NOT NULL);
    ALTER TABLE quick_capture_draft ADD COLUMN submitted_text TEXT;
    ALTER TABLE quick_capture_draft ADD COLUMN block_id TEXT;
    ALTER TABLE quick_capture_draft ADD COLUMN block_revision INTEGER;
    ALTER TABLE quick_capture_draft ADD COLUMN selection_anchor TEXT;
  `));
  const stamped = stamp(path);
  expect(stamped.stamped).toBe(true);
  expect(stamped.outlineInstanceId).toBeString();
  expect(userVersion(path)).toBe(SCHEMA_VERSION);
  expect(stamp(path)).toEqual({ stamped: false, outlineInstanceId: stamped.outlineInstanceId });
  const store = new OutlinerStore(path);
  expect(store.outlineInstanceId).toBe(outlineInstanceId(path));
  expect(store.create("Opens after the stamp").text).toBe("Opens after the stamp");
  store.close();
});

test("the version 2 migration adds an outline instance id without touching blocks", () => {
  const path = join(directory(), "outliner.sqlite");
  unstamped(path, database => database.exec("PRAGMA user_version = 1"));
  const before = readFileSync(path);
  const migrated = migrate(path);
  expect(migrated.migrated).toBe(true);
  expect(migrated.outlineInstanceId).toBe(outlineInstanceId(path));
  expect(userVersion(path)).toBe(2);
  expect(migrate(path)).toEqual({ migrated: false, outlineInstanceId: migrated.outlineInstanceId });
  const after = readFileSync(path);
  expect(after.equals(before)).toBe(false);
  const store = new OutlinerStore(path);
  expect(store.outlineInstanceId).toBe(outlineInstanceId(path));
  store.close();
});

test("a version 2 database missing its instance id is refused with the exact repair command, and 0002 repairs it", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  const database = new Database(path);
  database.query("DELETE FROM metadata WHERE key = 'outline_instance_id'").run();
  database.close();
  expect(() => new OutlinerStore(path)).toThrow(new RegExp(`has no valid outline instance id; repair it with \`bun \\S+/scripts/migrations/0002-outline-instance-id\\.ts ${path}\``));
  const repaired = migrate(path);
  expect(repaired).toMatchObject({ migrated: false, repaired: true });
  expect(outlineInstanceId(path)).toBe(repaired.outlineInstanceId);
  expect(migrate(path)).toEqual({ migrated: false, outlineInstanceId: repaired.outlineInstanceId });
  new OutlinerStore(path).close();
});
test("the version 2 migration refuses a version 1 database whose shape differs", () => {
  const path = join(directory(), "outliner.sqlite");
  unstamped(path, database => database.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE leftover_cache (id TEXT PRIMARY KEY);
  `));
  const before = readFileSync(path);
  expect(() => migrate(path)).toThrow("does not match schema version 1");
  expect(readFileSync(path).equals(before)).toBe(true);
  expect(userVersion(path)).toBe(1);
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

test("the stamp script refuses a database whose shape differs, naming each difference", () => {
  const path = join(directory(), "outliner.sqlite");
  unstamped(path, database => database.exec(`
    ALTER TABLE blocks DROP COLUMN task_id;
    CREATE TABLE leftover_cache (id TEXT PRIMARY KEY);
    DROP INDEX blocks_parent_position;
  `));
  let message = "";
  try { stamp(path); } catch (error) { message = (error as Error).message; }
  expect(message).toContain(`does not match schema version ${SCHEMA_VERSION}`);
  expect(message).toContain("table blocks differs");
  expect(message).toContain("table leftover_cache is not in the schema");
  expect(message).toContain("index blocks_parent_position is missing");
  expect(userVersion(path)).toBe(0);
});

test("a fresh database's shape is the schema's", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  const database = new Database(path, { readonly: true });
  expect(schemaDifferences(schemaShape(database), freshSchemaShape())).toEqual([]);
  database.close();
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
