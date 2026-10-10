import { randomBytes } from "node:crypto";
import type { MutationProvenance } from "./types";

/**
 * Who an extension's own process is when it calls the service (PIE-754). Every call the runtime starts gets a
 * grant: a random token in `EP0CH_EXT_GRANT`, valid while that process runs and revoked when it ends. A request
 * that carries it (`grant`) is the extension's: its writes are `author: agent`, `actorId: ext:<id>`, with who
 * asked for the run (`requestedBy`) beside them in the change feed, as an action's returned writes are.
 *
 * `ext:<id>` stays reserved (a client naming it is refused, src/server.ts): the grant is how the service knows a
 * connection is the process it started, not a client claiming the prefix. It is attribution, not a sandbox:
 * extensions are trusted code.
 *
 * The table is the process's, not one outline's: an outline host serves several outlines in one process, and a
 * grant reaches every outline that host serves (a new connection names the outline, as any client's does).
 */
export interface ExtensionGrant {
  readonly extensionId: string;
  /** The change feed's action for what it writes: `ext.<id>.<action or handler>`. */
  readonly label: string;
  /** Who asked for the run: a person, an agent (with its id), or none for a scheduled run. */
  readonly requestedBy?: MutationProvenance;
}

const grants = new Map<string, ExtensionGrant>();

/** A new grant for one process; revoke it when the process ends. */
export function issueGrant(grant: ExtensionGrant): string {
  const token = randomBytes(24).toString("hex");
  grants.set(token, grant);
  return token;
}

export function revokeGrant(token: string): void {
  grants.delete(token);
}

/** The grant a request carries, when it is one this process issued and hasn't revoked. */
export function grantOf(token: unknown): ExtensionGrant | undefined {
  return typeof token === "string" && token.length === 48 ? grants.get(token) : undefined;
}

/** How many grants are live (tests: a call's grant is gone once it answers). */
export function liveGrants(): number {
  return grants.size;
}
