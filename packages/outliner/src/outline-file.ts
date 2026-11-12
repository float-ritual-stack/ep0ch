// What the host reads of an outline's file itself (PIE-1750): only the host opens a live outline. An open outline answers
// from its store's own connection; one the host hasn't opened is stopped (the host holds the folder, so nothing else
// serves it), and its facts are this module's one read-only look. Clients ask the host (`outlines.list`, `outlines.backup`)
// and never open the file, so nothing waits out a busy database on their account.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync } from "node:fs";
import type { OutlineAbout } from "@ep0ch/outline-core/protocol";

// Singleton outline configuration uses the metadata table when it is not canonical user content and needs no revisioned
// note body (same table as sequence/outline_instance_id/change-feed floor).
export const MCP_ACCESS_METADATA_KEY = "mcp.local_access";
/** What a scratch outline says of itself (outline-core's OutlineAbout, JSON): who made it, why, when (PIE-679). */
export const OUTLINE_ABOUT_METADATA_KEY = "outline.about";

/** An outline file's position: the newest change in its change feed (0 with none) and its schema (`user_version`). */
export interface OutlineFileFacts { changeSeq: number; schema: number }

/** A stopped outline's look: its facts, what it says of itself, and the access level its owner set (if any). */
export interface StoppedOutline extends OutlineFileFacts { about?: OutlineAbout; access?: string }

/** The facts, from any connection to an outline (the store's, or the stopped look's). */
export function outlineFileFacts(database: Database): OutlineFileFacts {
  const schema = (database.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  const hasFeed = database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'change_feed'").get();
  const changeSeq = hasFeed ? (database.query("SELECT max(change_id) AS n FROM change_feed").get() as { n: number | null }).n ?? 0 : 0;
  return { changeSeq, schema };
}

/** An outline database's `about`, read from its metadata (a stopped file opened read-only works too); undefined when it has none. */
export function readOutlineAbout(database: Database): OutlineAbout | undefined {
  try {
    const row = database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_ABOUT_METADATA_KEY) as { value: string } | null;
    if (!row) return undefined;
    const a = JSON.parse(row.value) as OutlineAbout;
    return typeof a?.principal === "string" && typeof a.createdBy === "string" ? a : undefined;
  } catch { return undefined; }
}

/** The access level an owner set (`ep0ch mcp access`), lower-cased, or undefined when never set. */
function readAccess(database: Database): string | undefined {
  try {
    const row = database.query("SELECT value FROM metadata WHERE key = ?").get(MCP_ACCESS_METADATA_KEY) as { value: string } | null;
    return row?.value.trim().toLowerCase();
  } catch { return undefined; }
}

/** One read-only look at a stopped outline's file: the host's, for an outline it hasn't opened. Throws when it can't be read. */
export function readStoppedOutline(path: string): StoppedOutline {
  const database = new Database(path, { readonly: true });
  try {
    const about = readOutlineAbout(database), access = readAccess(database);
    return { ...outlineFileFacts(database), ...(about ? { about } : {}), ...(access ? { access } : {}) };
  } finally { database.close(); }
}

/**
 * A consistent copy of an outline into `dest` (VACUUM INTO, mode 0600), from the connection given: the store's own for an
 * open outline, so the copy is the store's own view, between its writes. The facts are read in the same call, so they
 * describe the copy. Never over an existing file. The copy is checked by whoever reads it (`checkCopy`), off the host.
 */
export function copyOutline(database: Database, dest: string): OutlineFileFacts {
  if (existsSync(dest)) throw new Error(`${dest} already exists; not overwritten`);
  const facts = outlineFileFacts(database);
  database.run("VACUUM INTO ?", [dest]);
  chmodSync(dest, 0o600);
  return facts;
}

/** As `copyOutline`, for a stopped outline's file (read-only). */
export function copyStoppedOutline(path: string, dest: string): OutlineFileFacts {
  const database = new Database(path, { readonly: true });
  try { return copyOutline(database, dest); } finally { database.close(); }
}

/** A copy's `PRAGMA integrity_check`, as one line ("ok" when it passes). A copy is never a live outline. */
export function checkCopy(path: string): string {
  const database = new Database(path, { readonly: true });
  try { return (database.query("PRAGMA integrity_check").all() as { integrity_check: string }[]).map(r => r.integrity_check).slice(0, 3).join("; "); }
  finally { database.close(); }
}
