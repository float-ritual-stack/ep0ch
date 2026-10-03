import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOutline } from "../src/outline-import";
import { SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import { freshSchemaShape, schemaDifferences, schemaShape, stamp } from "../scripts/migrations/0001-stamp";

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

/** A database with the current schema's shape and no stamp: what a database from before stamping looks like. */
function unstamped(path: string, change?: (database: Database) => void): void {
  const database = new Database(path, { create: true });
  database.exec(SCHEMA_SQL);
  change?.(database);
  database.close();
}

test("a new file gets the schema and the stamp", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  expect(userVersion(path)).toBe(SCHEMA_VERSION);
  const reopened = new OutlinerStore(path);
  expect(reopened.queryBlocks({ filters: [{ key: "system-view", value: "inbox" }], limit: 2 }).blocks).toHaveLength(1);
  reopened.close();
});

test("a database from before schema versions is refused, untouched, with the command that upgrades it", () => {
  const path = join(directory(), "outliner.sqlite");
  unstamped(path);
  const before = readFileSync(path);
  expect(() => new OutlinerStore(path)).toThrow(/schema version 0 .*opens only schema version 1.*0001-stamp\.ts/s);
  expect(readFileSync(path).equals(before)).toBe(true);
  expect(userVersion(path)).toBe(0);
});

test("any other schema version is refused", () => {
  const path = join(directory(), "outliner.sqlite");
  new OutlinerStore(path).close();
  const database = new Database(path);
  database.exec("PRAGMA user_version = 7");
  database.close();
  expect(() => new OutlinerStore(path)).toThrow("is schema version 7; this build opens only schema version 1");
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
  expect(stamp(path)).toEqual({ stamped: true });
  expect(userVersion(path)).toBe(1);
  expect(stamp(path)).toEqual({ stamped: false });
  const store = new OutlinerStore(path);
  expect(store.create("Opens after the stamp").text).toBe("Opens after the stamp");
  store.close();
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
  expect(message).toContain("does not match schema version 1");
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
  const counts = (database: Database) => Object.fromEntries(["blocks", "block_properties", "page_addresses", "reserved_work_ids"].map(table =>
    [table, (database.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
  const before = counts(store.database);
  store.close();
  const sourceBytes = readFileSync(source);

  const report = importOutline(source, target);
  expect(report).toMatchObject({ blocks: before.blocks, properties: before.block_properties, pageAddresses: before.page_addresses, workIds: before.reserved_work_ids });
  expect(report.notCarried).toHaveProperty("selection");
  expect(readFileSync(source).equals(sourceBytes)).toBe(true);
  expect(userVersion(target)).toBe(SCHEMA_VERSION);

  const imported = new OutlinerStore(target);
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
