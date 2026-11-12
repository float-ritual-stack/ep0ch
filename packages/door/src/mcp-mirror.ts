// The remote MCP gateway's read-only copies of outlines whose home is another machine (PIE-562, ADR 0009): the
// outliner's OutlineFollower (packages/outliner/src/outline-follower.ts: the home's change log applied here; the web
// client reads the same copies through it), with the gateway's own reader (a door board on the copies' host) and the
// migration scripts that take a copy up to this build's schema.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  type MigrateCopy, type MirrorRead as CoreRead,
  OutlineFollower as CoreFollower, userVersionOf,
} from "@ep0ch/outliner/outline-follower";
import { MIGRATIONS_DIR, run, SCHEMA_FILE, schemaCodeOf } from "./setup/facts";
import type { NotesBoard } from "./notes-cli";
import { SocketBoard } from "./socket";

export { mirrorsConfig, type MirrorCopy, type MirrorsConfig, type MirrorStale, type MirrorUnreadable, type Migrated, type MigrateCopy } from "@ep0ch/outliner/outline-follower";
export type MirrorRead = CoreRead<NotesBoard>;

/**
 * The migration scripts the outliner carries (the ones `ep0ch install --apply` runs, setup/apply.ts), run in order on
 * a follower's copy, in place: each is a one-off from NNNN-1 to NNNN, so a copy older than the oldest script left isn't migrated.
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

/** The schema version this build opens (its schema.ts), read once; null when it can't be told. */
let schemaNow: number | null | undefined;
const currentSchema = (): number | null => {
  if (schemaNow === undefined) {
    try { schemaNow = schemaCodeOf(readFileSync(join(resolve(import.meta.dir, "../../.."), SCHEMA_FILE), "utf8"), []).version; } catch { schemaNow = null; }
  }
  return schemaNow;
};

/** A door board on the copies' host (the follower says the newest change the copy holds itself). */
const attachBoard = (machine: string) => async (socket: string, outline: string) => {
  const board = new SocketBoard(socket, 30_000, outline) as NotesBoard;
  board.address = { outline, machine };
  try {
    await board.info();
    return { board, close: () => board.close() };
  } catch (e) { board.close(); throw e; }
};

export class OutlineFollower extends CoreFollower<NotesBoard> {
  constructor(outline: string, machine: string, folder: string, log: (line: string) => void = console.error, now: () => number = Date.now,
    o: { migrate?: MigrateCopy; reach?: (machine: string) => Promise<string>; outlines?: string; everyMs?: number } = {}) {
    super(outline, machine, folder, { attach: attachBoard(machine), log, now, migrate: o.migrate ?? migrateWithScripts(), schema: currentSchema, label: "mcp follow",
      ...(o.reach ? { reach: o.reach } : {}), ...(o.outlines ? { outlines: o.outlines } : {}), ...(o.everyMs ? { everyMs: o.everyMs } : {}) });
  }
}
