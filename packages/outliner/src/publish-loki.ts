import type { OutlinerClient } from "./client";
import type { LokiLeaseUse } from "@ep0ch/outline-core/protocol";

/** Only the host's lease decision opens this upstream; caller headers never cross into Loki. */
export async function publishLoki(request: Request, host: Pick<OutlinerClient, "request">, upstream: string, log: (line: string) => void): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/loki\/([A-Za-z0-9_-]+)\/(.*)$/.exec(url.pathname);
  if (!match) return new Response("No Loki lease\n", { status: 404 });
  // Existing scripts append /loki/api/v1 to LOKI_URL, including when the minted URL ends in /.
  const path = `/${match[2]!.replace(/^\//, "")}`;
  const use = await host.request<LokiLeaseUse>({ action: "loki.lease.use", token: match[1]!, method: request.method, path });
  if (use.status !== 200) return new Response(use.status === 410 ? "Lease ended: request loki_lease or run ep0ch loki lease\n" : use.status === 429 ? "Lease limit: 60 queries per minute\n" : "This lease permits only Loki read queries\n", { status: use.status, ...(use.status === 429 ? { headers: { "retry-after": "60" } } : {}) });
  try {
    const response = await fetch(`${upstream}${path}${url.search}`, { redirect: "manual", signal: request.signal });
    const status = response.status >= 300 && response.status < 400 ? 502 : response.status;
    log(JSON.stringify({ event: "loki.lease.response", id: use.id, status }));
    if (status === 502 && response.status !== 502) {
      await response.body?.cancel();
      return new Response("Loki redirected: check the publisher's loopback forward\n", { status });
    }
    return new Response(response.body, { status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch {
    log(JSON.stringify({ event: "loki.lease.response", id: use.id, status: 502 }));
    return new Response("Loki unavailable: check the publisher's loopback forward to float-box:3101\n", { status: 502 });
  }
}
