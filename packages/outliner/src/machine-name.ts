// This machine's name in a canonical ep0ch:// URI (ADR 0002). One rule for every client and the service: the door's
// control socket, main and MCP server, and the outline service's `notes.address` (what an extension builds its
// `ep0ch://` links from, PIE-767). It lives here, not in outline-core, because it reads the host name and hashes.
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { MACHINE_NAME_PATTERN } from "@ep0ch/outline-core/outline-location";

/** A stable URI machine name for this host when the outline is local, shaped like the remote ssh names URI grammar allows. */
export function canonicalLocalMachineName(raw = hostname()): string {
  const cleaned = raw.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "local";
  if (MACHINE_NAME_PATTERN.test(cleaned)) return cleaned;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  const prefix = cleaned.slice(0, 23).replace(/[^A-Za-z0-9]+$/g, "") || "local";
  return `${prefix}-${hash}`;
}
