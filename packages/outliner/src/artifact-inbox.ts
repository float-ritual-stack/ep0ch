// What the artifacts inbox and its server-side sibling agree on, read by the publisher (which writes a drop), the
// watcher (which takes it) and the store (which caps what it holds). No I/O beyond path joins.
import { join } from "node:path";

export const artifactLimit = () => Number(process.env.EP0CH_ARTIFACT_MAX_BYTES ?? 64 * 1024 * 1024);
export const artifactEntryLimit = () => Number(process.env.EP0CH_ARTIFACT_MAX_ENTRIES ?? 5000);

/**
 * Where server-side drops land (PIE-1267): the publisher writes a drop here and the watcher takes it, so nothing of
 * it appears in the synced inbox (`<outlines>/.artifacts/inbox`, which the laptop's mutagen mirrors).
 */
export const remoteInbox = (outlines: string, env: NodeJS.ProcessEnv = process.env) =>
  env.EP0CH_ARTIFACT_REMOTE_INBOX ?? join(outlines, ".artifacts", "inbox-remote");

/**
 * A drop is a folder `<inbox-remote>/<id>/` holding `drop.json` (this) and `file/<filename>`, renamed into place whole
 * so the watcher never sees half of it.
 */
export interface DropMeta {
  id: string;
  /** What admitted it: a one-time lease, or a device's token. */
  via: "lease" | "device";
  /** The lease's id, or the device's name. */
  source: string;
  /** Who minted the lease (`you`, an agent's actor id), or the device's name. */
  by: string;
  /** The outline whose day note gets the card. */
  outline: string;
  /** A note the card belongs under instead of today's (a page address), when the sender said which. */
  note?: string;
  /** The artifact's name, when the lease or the sender gave one; else the watcher reads it from the file. */
  name?: string;
  filename: string;
  bytes: number;
  sha256: string;
  at: string;
}

/** What the watcher answers a drop with, for the publisher still holding the sender's request open. */
export interface DropResult {
  ok: boolean;
  name?: string;
  version?: number;
  title?: string;
  /** Why it was refused (also in `.failed/<id>/reason.txt`). */
  reason?: string;
  /** What became of the card and the record: written, or why not. */
  card?: string;
  record?: string;
}

export const DROP_FILE = "drop.json";
export const DROP_RESULTS = ".results";
