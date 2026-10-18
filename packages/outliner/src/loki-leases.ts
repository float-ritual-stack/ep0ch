import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { LokiLease, LokiLeaseUse } from "@ep0ch/outline-core/protocol";
import { shareTtlMs } from "./share-sessions";

interface Lease { id: string; expires: number; uses: number[] }
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Host-owned, like web sessions; a host restart ends all outstanding query URLs. */
export class LokiLeases {
  private readonly leases = new Map<string, Lease>();
  constructor(private readonly log: (message: string) => void) {}

  start(ttl: unknown, by: string): LokiLease {
    const expires = Date.now() + shareTtlMs(ttl);
    for (const [key, lease] of this.leases) if (lease.expires <= Date.now()) this.leases.delete(key);
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    this.leases.set(digest(token), { id, expires, uses: [] });
    this.log(JSON.stringify({ event: "loki.lease.start", id, by, expiresAt: new Date(expires).toISOString() }));
    return { id, url: `https://my.ep0ch.sh/loki/${token}/`, expiresAt: new Date(expires).toISOString() };
  }

  revoke(): { revoked: number } {
    const revoked = this.leases.size;
    this.leases.clear();
    this.log(JSON.stringify({ event: "loki.lease.revoke", revoked }));
    return { revoked };
  }

  use(token: string, method: string, path: string): LokiLeaseUse {
    const lease = this.leases.get(digest(token));
    const now = Date.now();
    let status = 200;
    if (!lease || lease.expires <= now) status = 410;
    else if (method !== "GET" || !/^\/loki\/api\/v1\/(?:query|query_range|labels|series|label\/[a-zA-Z_][a-zA-Z0-9_]*\/values)$/.test(path)) status = 403;
    else {
      lease.uses = lease.uses.filter(at => at > now - 60_000);
      if (lease.uses.length >= 60) status = 429;
      else lease.uses.push(now);
    }
    // Neither the bearer URL nor the query (which can contain prompt text) belongs in telemetry.
    this.log(JSON.stringify({ event: "loki.lease.use", id: lease?.id, status }));
    return { status, ...(lease ? { id: lease.id } : {}) };
  }
}
