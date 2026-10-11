// The outline service, as this extension (PIE-754), copied from almanac's outline.ts with one addition: a request can
// name an outline on another machine (`machine`). The host that started this program sends it there through the ssh
// forward the clients share, with this extension's grant checked here and that outline's access level checked there.
import { connect } from "node:net";

export interface OutlineRequest {
  readonly action: string;
  readonly [field: string]: unknown;
}

export interface Route {
  /** The outline the request is for (EP0CH_WS when left out). */
  readonly outline?: string;
  /** The machine it is on (an ssh config name); left out, this one. */
  readonly machine?: string;
  /** How long to wait for an answer (ms). */
  readonly timeoutMs?: number;
}

/** One request, answered: a JSON line out, a JSON line back. Throws the service's refusal as an Error. */
export function outline<T = unknown>(request: OutlineRequest, route: Route = {}): Promise<T> {
  const socket = process.env.EP0CH_SOCKET, grant = process.env.EP0CH_EXT_GRANT;
  const name = route.outline ?? process.env.EP0CH_WS;
  if (!socket || !grant) return Promise.reject(new Error("no EP0CH_SOCKET or EP0CH_EXT_GRANT: the outline service starts this program"));
  const where = `${name ?? "the service"}${route.machine ? `@${route.machine}` : ""}`;
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    const timer = setTimeout(() => { connection.destroy(); reject(new Error(`no answer from ${where} in ${route.timeoutMs ?? 20_000} ms`)); }, route.timeoutMs ?? 20_000);
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      connection.end();
      try {
        const response = JSON.parse(buffer.slice(0, end)) as { ok: boolean; result?: T; error?: string };
        if (response.ok) resolve(response.result as T);
        else reject(new Error(response.error));
      } catch (error) {
        reject(error);
      }
    });
    connection.on("error", (error) => { clearTimeout(timer); reject(error); });
    connection.on("close", () => { clearTimeout(timer); reject(new Error(`${where}: the connection closed without an answer`)); });
    const at = route.machine ? { machine: route.machine } : {};
    connection.write(`${JSON.stringify({ id: crypto.randomUUID(), ...(name ? { outline: name } : {}), ...at, ...request, grant })}\n`);
  });
}
