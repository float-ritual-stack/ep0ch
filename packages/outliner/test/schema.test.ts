import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOutline } from "../src/outline-import";
import { readOutlineInstanceId, SCHEMA_SQL, SCHEMA_VERSION, schemaRefusal } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { ownerLockOf } from "../src/workspace-ownership";
import { freshSchemaShape, schemaDifferences, schemaShape, stamp } from "../scripts/migrations/0001-stamp";
import { migrate as migrate5, REBUILT_TABLES, SCHEMA_SQL_4 } from "../scripts/migrations/0005-extension-providers";

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

/** A version-4 database holding one note and one Jira ticket's Source and Resource, as version 4 named them. */
function version4(path: string, change?: (database: Database) => void): { noteId: string; resourceId: string } {
  const store = new OutlinerStore(path);
  const noteId = store.create("Kept through the migration").id;
  store.close();
  const database = new Database(path);
  const v4 = new Database(":memory:");
  v4.exec(SCHEMA_SQL_4);
  database.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON; DROP TABLE read_marks;");
  for (const table of REBUILT_TABLES) {
    const rows = v4.query("SELECT type, sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL").all(table) as Array<{ type: string; sql: string }>;
    database.exec(`ALTER TABLE ${table} RENAME TO ${table}__v5; ${rows.find(row => row.type === "table")!.sql}; INSERT INTO ${table} SELECT * FROM ${table}__v5; DROP TABLE ${table}__v5;`);
    for (const row of rows.filter(row => row.type === "index")) database.exec(row.sql);
  }
  v4.close();
  const sourceId = "11111111-1111-4111-8111-111111111111", resourceId = "22222222-2222-4222-8222-222222222222", at = "2026-10-01T09:00:00.000Z";
  database.query("INSERT INTO resource_sources (id, name, provider, boundary_json, policy_json, root_binding, version, created_at, updated_at) VALUES (?, 'Made-up tickets', 'jira', ?, ?, NULL, 1, ?, ?)")
    .run(sourceId, JSON.stringify({ origin: "https://tickets.example.com", project: "FIC" }), JSON.stringify({ deniedCapabilities: [] }), at, at);
  database.query("INSERT INTO resources (id, source_id, provider, address_json, canonical_key, media_type, address_version, version, created_at, updated_at) VALUES (?, ?, 'jira', ?, '10007', NULL, 1, 1, ?, ?)")
    .run(resourceId, sourceId, JSON.stringify({ kind: "jira", entityId: "10007", key: "FIC-7" }), at, at);
  database.exec("PRAGMA user_version = 4");
  change?.(database);
  database.close();
  return { noteId, resourceId };
}

test("a version 5 database missing its instance id is refused with the exact repair command, and 0005 repairs it", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  const database = new Database(path);
  database.query("DELETE FROM metadata WHERE key = 'outline_instance_id'").run();
  database.close();
  expect(() => new OutlinerStore(path)).toThrow(new RegExp(`has no valid outline instance id\\. Repair it with:\n\n  .+\n  bun \\S+/scripts/migrations/0005-extension-providers\\.ts ${path}\n`));
  // Not while a store (a service) has it open.
  const held = new Database(ownerLockOf(path).path);
  held.exec("BEGIN IMMEDIATE");
  expect(() => migrate5(path)).toThrow("already owned");
  held.close();
  const repaired = migrate5(path);
  expect(repaired).toMatchObject({ migrated: false, repaired: true });
  expect(outlineInstanceId(path)).toBe(repaired.outlineInstanceId);
  expect(migrate5(path)).toEqual({ migrated: false, outlineInstanceId: repaired.outlineInstanceId });
  // A version-5 file from before read marks joined it gets their table.
  const early = new Database(path);
  early.exec("DROP TABLE read_marks");
  early.close();
  migrate5(path);
  new OutlinerStore(path).close();
});

test("the version 5 migration moves Jira onto the extension providers as ext:jira, keeping every row; it refuses another shape or version", () => {
  const path = join(directory(), "outliner.sqlite");
  const { noteId, resourceId } = version4(path);
  const id = outlineInstanceId(path);
  expect(migrate5(path)).toEqual({ migrated: true, outlineInstanceId: id,
    renamed: { "resource_sources.provider": 1, "resources.provider": 1, "remote_entity_source_snapshots.provider": 0, "resources.address_json": 1 } });
  expect(userVersion(path)).toBe(5);
  const store = new OutlinerStore(path);
  expect(store.get(noteId)?.text).toBe("Kept through the migration");
  expect(store.readMarks.mark("user", [noteId])).toBe(1);
  expect(store.resources.require(resourceId)).toMatchObject({ provider: "ext:jira", address: { kind: "ext:jira", entityId: "10007", key: "FIC-7" } });
  // The check takes any extension's provider now, and still refuses a name that isn't one.
  store.database.query("INSERT INTO resource_sources (id, name, provider, boundary_json, policy_json, version, created_at, updated_at) VALUES ('s2', 'x', 'ext:kanboard', '{}', '{}', 1, 'a', 'a')").run();
  expect(() => store.database.query("INSERT INTO resource_sources (id, name, provider, boundary_json, policy_json, version, created_at, updated_at) VALUES ('s3', 'x', 'kanboard', '{}', '{}', 1, 'a', 'a')").run()).toThrow("CHECK");
  store.close();
  const odd = join(directory(), "outliner.sqlite");
  version4(odd, database => database.exec("CREATE TABLE leftover_cache (id TEXT PRIMARY KEY);"));
  const before = readFileSync(odd);
  expect(() => migrate5(odd)).toThrow("does not match schema version 4");
  expect(readFileSync(odd).equals(before)).toBe(true);
  const older = join(directory(), "outliner.sqlite");
  version4(older, database => database.exec("PRAGMA user_version = 3"));
  expect(() => migrate5(older)).toThrow("is schema version 3, not 4");
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

describe("the refusal says the exact commands for this machine (PIE-617)", () => {
  const SCRIPT = join(import.meta.dir, "../scripts/migrations/0005-extension-providers.ts");
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
    expect(schemaRefusal(`The outline database ${hub}`, SCHEMA_VERSION - 1, hub, { platform: "darwin", home: "/Users/wren" })).toBe([
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
    const linux = schemaRefusal(`The outline database ${hub}`, SCHEMA_VERSION - 1, hub, { platform: "linux" });
    expect(linux).toContain("\n  systemctl --user stop outliner-host.service\n");
    expect(linux).toEndWith("\n  systemctl --user start outliner-host.service");
    // Nothing to fill in: no placeholders, no prose about services, no colour.
    expect(linux).not.toMatch(/<[a-z]+>|while no service|\x1b\[/);
  });

  test("no script for the step: the import route, with the real file and name", () => {
    const folder = directory();
    const old = at(folder, "seed-bank", 1);
    expect(schemaRefusal(`The outline database ${old}`, 1, old, { platform: "linux" })).toBe([
      `The outline database ${old} is schema version 1; this build opens only schema version ${SCHEMA_VERSION}.`,
      `No script migrates schema 1 to ${SCHEMA_VERSION}; import its notes into a new outline:`,
      "",
      "  systemctl --user stop outliner-host.service",
      `  mv ${old} ${old}.schema-1`,
      "  systemctl --user start outliner-host.service",
      `  ep0ch outline import ${old}.schema-1 seed-bank`,
    ].join("\n"));
  });

  test("the store's refusal is that message; a path that needs quoting is quoted", () => {
    const folder = join(directory(), "my outlines");
    mkdirSync(folder);
    const path = at(folder, "float-hub", SCHEMA_VERSION - 1);
    let said = "";
    try { new OutlinerStore(path).close(); } catch (e) { said = (e as Error).message; }
    expect(said).toContain("\n  ep0ch install --apply\n");
    expect(said).toContain(`\n  bun ${SCRIPT} '${path}'\n`);
  });
});
