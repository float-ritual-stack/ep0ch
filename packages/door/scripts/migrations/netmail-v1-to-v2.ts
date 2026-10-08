/*
 * The netmail queue (the remote MCP gateway's store, `<mirrors>/.netmail.sqlite`) gains write receipts: the revision an
 * entry's write made and the proposal it became (outline_write_status). Version 1 to 2, in place.
 *
 *   bun packages/door/scripts/migrations/netmail-v1-to-v2.ts <path to .netmail.sqlite>           # says what it would do
 *   bun packages/door/scripts/migrations/netmail-v1-to-v2.ts <path to .netmail.sqlite> --write   # does it
 *
 * Run once on the gateway's machine (float-2: ~/outline-mirrors/.netmail.sqlite) after deploying, then delete this
 * file. Stop the gateway first and start it after.
 */
import { Database } from "bun:sqlite";

const [path, flag] = process.argv.slice(2);
if (!path) { console.error("usage: netmail-v1-to-v2.ts <path to .netmail.sqlite> [--write]"); process.exit(2); }
const db = new Database(path, { readwrite: true });
const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
if (version !== 1) { console.error(`${path} is version ${version}; this moves version 1 to 2`); process.exit(1); }
if (flag !== "--write") { console.log(`would add result_revision and proposal_uri to ${path} and set version 2 (--write does it)`); process.exit(0); }
db.exec("BEGIN IMMEDIATE; ALTER TABLE entries ADD COLUMN result_revision INTEGER; ALTER TABLE entries ADD COLUMN proposal_uri TEXT; PRAGMA user_version = 2; COMMIT;");
console.log(`${path} is version 2`);
