// The outline service, as this extension (PIE-754). Copy this file into your extension's folder.
//
// The service starts every call of an extension with EP0CH_SOCKET (where the service listens), EP0CH_WS (the outline
// it runs for) and EP0CH_EXT_GRANT (who it is: valid while this process runs). A request that carries the grant is
// the extension's: what it writes is `author: agent`, `actorId: ext:<id>`, with whoever asked for the run beside it
// (`requestedBy`). It may read, create, update (a draft.patch under the edit policy: while the person types in that
// passage it becomes a proposal), comment and annotate, in any outline the host serves: name one with `outline`.
import { connect } from "node:net";

export interface OutlineRequest {
  readonly action: string;
  readonly [field: string]: unknown;
}

/** One request, answered: a JSON line out, a JSON line back. Throws the service's refusal as an Error. */
export function outline<T = unknown>(request: OutlineRequest, name = process.env.EP0CH_WS): Promise<T> {
  const socket = process.env.EP0CH_SOCKET, grant = process.env.EP0CH_EXT_GRANT;
  if (!socket || !grant) return Promise.reject(new Error("no EP0CH_SOCKET or EP0CH_EXT_GRANT: the outline service starts this program"));
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      connection.end();
      try {
        const response = JSON.parse(buffer.slice(0, end)) as { ok: boolean; result?: T; error?: string };
        if (response.ok) resolve(response.result as T);
        else reject(new Error(response.error));
      } catch (error) {
        reject(error);
      }
    });
    connection.on("error", reject);
    connection.write(`${JSON.stringify({ id: crypto.randomUUID(), ...(name ? { outline: name } : {}), ...request, grant })}\n`);
  });
}
