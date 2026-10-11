// The outline service, as this extension (PIE-754), copied from almanac's outline.ts with one addition: a request can
// go to another machine's host through the ssh forward the clients share (`<outlines>/.remote/<machine>.sock`). There
// the grant means nothing (a grant is one host's), so the request goes without it, as an agent naming itself.
import { connect } from "node:net";

export interface OutlineRequest {
  readonly action: string;
  readonly [field: string]: unknown;
}

export interface Route {
  /** The outline the request is for (EP0CH_WS when left out). */
  readonly outline?: string;
  /** Another host's socket (a machine's forward); left out, the service that started this program, with its grant. */
  readonly socket?: string;
  /** How long to wait for an answer (ms). */
  readonly timeoutMs?: number;
}

/** One request, answered: a JSON line out, a JSON line back. Throws the service's refusal as an Error. */
export function outline<T = unknown>(request: OutlineRequest, route: Route = {}): Promise<T> {
  const own = process.env.EP0CH_SOCKET, grant = process.env.EP0CH_EXT_GRANT;
  const socket = route.socket ?? own;
  const name = route.outline ?? process.env.EP0CH_WS;
  if (!socket || (!route.socket && !grant)) return Promise.reject(new Error("no EP0CH_SOCKET or EP0CH_EXT_GRANT: the outline service starts this program"));
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    const timer = setTimeout(() => { connection.destroy(); reject(new Error(`no answer from ${name ?? "the service"} in ${route.timeoutMs ?? 20_000} ms`)); }, route.timeoutMs ?? 20_000);
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
    const auth = route.socket ? {} : { grant };
    connection.write(`${JSON.stringify({ id: crypto.randomUUID(), ...(name ? { outline: name } : {}), ...request, ...auth })}\n`);
  });
}
