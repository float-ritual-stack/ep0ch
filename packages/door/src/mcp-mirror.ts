// The remote MCP gateway's read-only mirrors of outlines whose home is another machine (PIE-562): the outliner's
// OutlineMirror (packages/outliner/src/outline-mirror.ts, the web client reads the same copies through it), with the
// gateway's own reader (a door board on each snapshot's host), its follower-health check and the migration scripts.
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  type MigrateCopy, type MirrorRead as CoreRead, type MirrorStale,
  OutlineMirror as CoreMirror, userVersionOf,
} from "@ep0ch/outliner/outline-mirror";
import { MIGRATIONS_DIR, run, SCHEMA_FILE, schemaCodeOf } from "./setup/facts";
import type { NotesBoard } from "./notes-cli";
import { SocketBoard } from "./socket";

export { mirrorsConfig, type MirrorCopy, type MirrorsConfig, type MirrorStale, type MirrorUnreadable, type Migrated, type MigrateCopy } from "@ep0ch/outliner/outline-mirror";
export type MirrorRead = CoreRead<NotesBoard>;

/**
 * The migration scripts the outliner carries (the ones `ep0ch install --apply` runs, setup/apply.ts), run in order on
 * the private copy: each is a one-off from NNNN-1 to NNNN, so a copy older than the oldest script left isn't migrated.
 */
export const migrateWithScripts = (root = resolve(import.meta.dir, "../../..")): MigrateCopy => async file => {
  const from = userVersionOf(file);
  let text: string | null = null, files: string[] = [];
  try { text = readFileSync(join(root, SCHEMA_FILE), "utf8"); files = readdirSync(join(root, MIGRATIONS_DIR)); } catch { /* reported below */ }
  const code = schemaCodeOf(text, files);
  if (from === null) return { from, error: "its schema version can't be read" };
  if (code.version === null) return { from, error: code.error ?? "this build's schema version can't be read" };
  if (from === code.version) return null;
  if (from > code.version) return { from, error: `it is schema ${from}, newer than the schema ${code.version} this build opens; on this machine: ep0ch install --apply updates the gateway's checkout`, newer: true };
  const steps: string[] = [];
  for (let v = from + 1; v <= code.version; v++) {
    const script = code.scripts[v];
    if (!script) return { from, error: `no migration script takes schema ${v - 1} to ${v} (it was deleted once the machines that matter ran it)` };
    steps.push(join(root, script));
  }
  for (const [i, script] of steps.entries()) {
    const r = await run([process.execPath, script, file], { cwd: join(root, "packages/outliner"), timeoutMs: 120_000 });
    const now = userVersionOf(file);
    if (r.code !== 0 || now !== from + i + 1) return { from, error: `${basename(script)} failed on the copy (${(r.err || r.out || `exit ${r.code}`).trim().split("\n").at(-1)?.slice(0, 200)})` };
  }
  return { from, to: code.version };
};

/**
 * Doctor's question about one mirror, asked of this machine's Litestream follower unit (setup/backups.ts
 * `mirrorHealth`); with none, of the restic backup job's alert (PIE-607, backup/alert.ts), which refreshes the mirror.
 */
const followerHealth = async (follow: string): Promise<MirrorStale | null> => {
  const [{ mirrorHealth }, { run }, { detectPlatform }] = await Promise.all([import("./setup/backups"), import("./setup/facts"), import("./setup/model")]);
  const litestream = await mirrorHealth(follow, { platform: detectPlatform(), home: process.env.HOME || homedir(), env: process.env, run });
  if (litestream) return litestream;
  const { readAlert } = await import("./backup/alert");
  const { stateDir } = await import("./state");
  const key = `${basename(dirname(follow))}/${basename(follow).replace(/\.sqlite$/, "")}`;
  const i = readAlert(join(stateDir(), "backup"))?.incidents.find(x => x.key === `mirror:${key}` || x.key === `pending:${key}`);
  return i ? { since: i.since, why: i.detail } : null;
};

/** The schema version this build opens (its schema.ts), read once; null when it can't be told. */
let schemaNow: number | null | undefined;
const currentSchema = (): number | null => {
  if (schemaNow === undefined) {
    try { schemaNow = schemaCodeOf(readFileSync(join(resolve(import.meta.dir, "../../.."), SCHEMA_FILE), "utf8"), []).version; } catch { schemaNow = null; }
  }
  return schemaNow;
};

/** A door board on a snapshot's host, and the newest change it holds. */
const attachBoard = (machine: string) => async (socket: string, outline: string) => {
  const board = new SocketBoard(socket, 30_000, outline) as NotesBoard;
  board.address = { outline, machine };
  try {
    await board.info();
    let newest = 0;
    for (const b of await board.index()) if (Number.isFinite(b.updatedAt) && b.updatedAt > newest) newest = b.updatedAt;
    return { board, newest, close: () => board.close() };
  } catch (e) { board.close(); throw e; }
};

export class OutlineMirror extends CoreMirror<NotesBoard> {
  constructor(outline: string, machine: string, folder: string, log: (line: string) => void = console.error, now: () => number = Date.now,
    askHealth: (follow: string) => Promise<MirrorStale | null> = followerHealth,
    migrate: MigrateCopy = migrateWithScripts()) {
    super(outline, machine, folder, { attach: attachBoard(machine), log, now, askHealth, migrate, schema: currentSchema, label: "mcp mirror" });
  }
}
