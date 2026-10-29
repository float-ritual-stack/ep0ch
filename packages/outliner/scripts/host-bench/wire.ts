// Talking to a bench's outline host the way long-lived clients do: one connection, many requests, events between.
import { createConnection, type Socket } from "node:net";

export interface Answer<T = unknown> { ms: number; result?: T; error?: string }

/** A persistent connection to the host, naming `outline` on every request; events go to `onEvent`. */
export class Conn {
  private socket: Socket | null = null;
  private buffer = "";
  private readonly waiting = new Map<string, { started: number; resolve: (answer: Answer<any>) => void; timer: ReturnType<typeof setTimeout> }>();
  private opened: Promise<void> | null = null;
  closed = false;

  constructor(private readonly path: string, private readonly outline: string, private readonly onEvent?: (event: Record<string, any>) => void) {}

  private open(): Promise<void> {
    if (this.opened) return this.opened;
    this.opened = new Promise((resolve, reject) => {
      const socket = createConnection(this.path);
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.once("connect", () => resolve());
      socket.on("error", error => { reject(error); this.fail(error.message); });
      socket.on("close", () => { this.closed = true; this.fail("closed"); });
      socket.on("data", (chunk: string) => {
        this.buffer += chunk;
        for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
          const line = this.buffer.slice(0, at);
          this.buffer = this.buffer.slice(at + 1);
          if (!line) continue;
          const message = JSON.parse(line);
          if (message.event) { this.onEvent?.(message.event); continue; }
          const waiter = this.waiting.get(message.id);
          if (!waiter) continue;
          this.waiting.delete(message.id);
          clearTimeout(waiter.timer);
          waiter.resolve({ ms: performance.now() - waiter.started, ...(message.ok ? { result: message.result } : { error: message.error }) });
        }
      });
    });
    return this.opened;
  }

  private fail(error: string): void {
    for (const [id, waiter] of this.waiting) { clearTimeout(waiter.timer); waiter.resolve({ ms: performance.now() - waiter.started, error }); this.waiting.delete(id); }
  }

  async request<T = unknown>(body: Record<string, unknown>, timeoutMs = 120_000): Promise<Answer<T>> {
    const started = performance.now();
    try { await this.open(); } catch (error) { return { ms: performance.now() - started, error: (error as Error).message }; }
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ ms: performance.now() - started, error: "timeout" }); }, timeoutMs);
      this.waiting.set(id, { started, resolve, timer });
      this.socket!.write(`${JSON.stringify({ id, outline: this.outline, ...body })}\n`);
    });
  }

  close(): void { this.closed = true; this.socket?.destroy(); }
}

export const quantile = (sorted: readonly number[], q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
