// The remote MCP gateway's read-only copies of outlines whose home is another machine (PIE-562, ADR 0009): the
// outliner's OutlineFollower (packages/outliner/src/outline-follower.ts: the home's change log applied here; the web
// client reads the same copies through it), with the gateway's own reader (a door board on the copies' host). A copy
// older than this build is taken up by the outliner's migration scripts, whichever process owns its loop.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type MigrateCopy, type MirrorRead as CoreRead,
  OutlineFollower as CoreFollower,
} from "@ep0ch/outliner/outline-follower";
import { SCHEMA_FILE, schemaCodeOf } from "./setup/facts";
import type { NotesBoard } from "./notes-cli";
import { SocketBoard } from "./socket";

export { mirrorsConfig, type MirrorCopy, type MirrorsConfig, type MirrorStale, type MirrorUnreadable, type Migrated, type MigrateCopy } from "@ep0ch/outliner/outline-follower";
export type MirrorRead = CoreRead<NotesBoard>;

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
    super(outline, machine, folder, { attach: attachBoard(machine), log, now, ...(o.migrate ? { migrate: o.migrate } : {}), schema: currentSchema, label: "mcp follow",
      ...(o.reach ? { reach: o.reach } : {}), ...(o.outlines ? { outlines: o.outlines } : {}), ...(o.everyMs ? { everyMs: o.everyMs } : {}) });
  }
}
