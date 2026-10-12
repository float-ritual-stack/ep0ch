// The outline service, as this extension (PIE-754). Copy this file into your extension's folder.
//
// The service starts every call of an extension with EP0CH_SOCKET (where the service listens), EP0CH_WS (the outline
// it runs for) and EP0CH_EXT_GRANT (who it is: valid while this process runs). A request that carries the grant is
// the extension's: what it writes is `author: agent`, `actorId: ext:<id>`, with whoever asked for the run beside it
// (`requestedBy`). It may read, create, update (a draft.patch under the edit policy: while the person types in that
// passage it becomes a proposal), comment and annotate, in any outline the host serves: name one with `outline`, and
// in an outline on another machine, as far as that outline's access level lets it: name its `machine` too (an ssh
// config name). The host that started this program checks the grant and sends the request there through the ssh
// forward the clients share; that machine's host checks its own outline's access level.
import { connect } from "node:net";

export interface OutlineRequest {
  readonly action: string;
  readonly [field: string]: unknown;
}

/** Where a request goes: an outline by name (EP0CH_WS when left out), on a machine (this one when left out). */
export interface Route {
  readonly outline?: string;
  readonly machine?: string;
  /** How long to wait for an answer (ms; 20 s when left out). */
  readonly timeoutMs?: number;
}

/**
 * One request, answered: a JSON line out, a JSON line back. Throws the service's refusal as an Error. The second
 * argument is the outline's name, or a route (`{ outline, machine }`).
 */
export function outline<T = unknown>(request: OutlineRequest, to: string | Route = {}): Promise<T> {
  const socket = process.env.EP0CH_SOCKET, grant = process.env.EP0CH_EXT_GRANT;
  if (!socket || !grant) return Promise.reject(new Error("no EP0CH_SOCKET or EP0CH_EXT_GRANT: the outline service starts this program"));
  const route: Route = typeof to === "string" ? { outline: to } : to;
  const name = route.outline ?? process.env.EP0CH_WS;
  const where = `${name ?? "the service"}${route.machine ? `@${route.machine}` : ""}`;
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    const wait = route.timeoutMs ?? 20_000;
    const timer = setTimeout(() => { connection.destroy(); reject(new Error(`no answer from ${where} in ${wait} ms`)); }, wait);
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
