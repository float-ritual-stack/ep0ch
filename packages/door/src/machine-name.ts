// This machine's name in a canonical ep0ch:// URI (ADR 0002). Its own module, with no door imports: the control
// socket, main and the MCP server need it, and taking it from notes-cli made an import cycle that left PtyPane
// undefined in any test that loads the edit or tile modules first.
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
