// The tile's one request to the outline service: a JSON line out, a JSON line back. Its own file so a test can
// reach it; it waits at most `timeoutMs`, rejects when the service hangs up or answers with something that isn't
// JSON, and reads the answer as a stream so a character split across two chunks stays whole.
import { connect } from "node:net";

export function request<T>(body: Record<string, unknown>, to: { socketPath?: string; outline?: string; timeoutMs?: number }): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!to.socketPath) return reject(new Error("no EP0CH_SOCKET: open this tile from the door"));
    const socket = connect(to.socketPath);
    const wait = to.timeoutMs ?? 20_000;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`no answer from the outline service in ${wait} ms`)); }, wait);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, end)) as { ok: boolean; result?: T; error?: string };
        if (response.ok) resolve(response.result as T);
        else reject(new Error(response.error));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("close", () => { clearTimeout(timer); reject(new Error("the outline service closed without an answer")); });
    socket.write(`${JSON.stringify({ id: crypto.randomUUID(), ...(to.outline ? { outline: to.outline } : {}), ...body })}\n`);
  });
}
