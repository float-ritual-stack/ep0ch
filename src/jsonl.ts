// Newline-JSON over a socket, one way everywhere: the outline service's socket, the door's control socket and every
// client of it (`ep0ch act|peek`, `ep0ch where`, the Herdr agent's tile). `jsonLine` writes a value as a line,
// `JsonLines` reads them as chunks arrive, `ask` is a one-shot request and its answer, and `listening` is the one
// liveness probe (a control socket, the session's, its terminal host's).
import { connect } from "node:net";
import { StringDecoder } from "node:string_decoder";

/** A value as one line. */
export const jsonLine = (v: unknown) => JSON.stringify(v) + "\n";

/**
 * Lines of JSON as they arrive in chunks: each whole line's value, blank lines skipped, a line that isn't JSON given
 * to `bad` (else skipped). Bytes are decoded as a stream, so a character split across two chunks arrives whole. Only
 * the new chunk is searched for a line's end: a long line costs its length once, not per chunk.
 */
export class JsonLines {
  private buf = "";
  private readonly text = new StringDecoder("utf8");
  constructor(private readonly onValue: (v: any) => void, private readonly bad?: (line: string) => void) {}
  /** False when the line being read is past `limit` characters without its end: what was held is let go. */
  feed(d: Buffer | string, limit = Infinity): boolean {
    const s = typeof d === "string" ? d : this.text.write(d);
    this.buf += s;
    if (!s.includes("\n")) { if (this.buf.length <= limit) return true; this.buf = ""; return false; }
    for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let v: unknown;
      try { v = JSON.parse(line); } catch { this.bad?.(line); continue; }
      try { this.onValue(v); } catch { /* one line's handler failing never stops the stream */ }
    }
    return true;
  }
}

/**
 * Send `req` to the socket at `path` as one line and resolve to the first line it answers: null when nobody is there,
 * nothing answers within `ms` (left out: it may take as long as it takes), it hangs up first, or the answer isn't JSON.
 */
export function ask(path: string, req: unknown, ms?: number): Promise<any | null> {
  return new Promise(res => {
    let done = false;
    const finish = (v: any) => { if (done) return; done = true; clearTimeout(timer); c.destroy(); res(v); };
    const c = connect(path, () => c.write(jsonLine(req)));
    const timer = ms === undefined ? undefined : setTimeout(() => finish(null), ms);
    const lines = new JsonLines(finish, () => finish(null));
    c.on("data", d => lines.feed(d));
    c.on("error", () => finish(null));
    c.on("close", () => finish(null));
  });
}

/**
 * Is something serving on `path`? False only when nobody is: no file, or one left by a process that died (refused).
 * A file that isn't a socket has nobody on it either (macOS says ENOTSOCK where Linux says ECONNREFUSED). No answer
 * in `ms` is taken, not free: somebody holds it and is busy (a session starting, a host under load), and taking a
 * socket from a live process (unlinking it, serving a second one) would cut off everything it serves.
 */
export const listening = (path: string, ms = 2000) => new Promise<boolean>(res => {
  const c = connect(path, () => { clearTimeout(t); c.end(); res(true); });
  const t = setTimeout(() => { c.destroy(); res(true); }, ms);
  c.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(t); res(e.code !== "ECONNREFUSED" && e.code !== "ENOENT" && e.code !== "ENOTSOCK"); });
});
