import { parseArgs } from "node:util";
import type { LokiLease } from "@ep0ch/outline-core/protocol";
import { outlineHostClient } from "./outline-host-client";

export async function runLokiCommand(args: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, options: { ttl: { type: "string" }, revoke: { type: "boolean" } }, allowPositionals: true });
    if (positionals.length !== 1 || positionals[0] !== "lease" || (values.revoke && values.ttl)) throw new Error("use ep0ch loki lease [--ttl 1h] or ep0ch loki lease --revoke (ends all leases)");
    const host = await outlineHostClient();
    if (!host) throw new Error("no outline host: start outliner-host on the publisher's machine, then run ep0ch loki lease there");
    if (values.revoke) {
      const result = await host.request<{ revoked: number }>({ action: "loki.lease.revoke" });
      console.log(`Ended ${result.revoked} Loki leases`);
    } else {
      const lease = await host.request<LokiLease>({ action: "loki.lease.start", ttl: values.ttl, by: "ssh" });
      console.log(lease.url);
    }
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
