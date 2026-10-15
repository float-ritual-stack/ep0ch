// The requests held for a person's `r` (PIE-888): an `@name` line an agent or an extension wrote that no grant lets
// wake its agent. The service keeps them (`agents.held`: the note, the agent, why it waits); this is the door's copy,
// read once and again after the outline changes (a burst is one read), which the status bar counts and the
// waiting-on-you list shows beside the terminals' programs. The door never decides what is held.
import type { HeldAsk, SocketBoard } from "./socket";
import type { OutlineEvent } from "./socket";

export class HeldAsks {
  private rows: HeldAsk[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private board: SocketBoard | null = null;
  private readonly listeners = new Set<() => void>();
  /** Wait this long after a change before asking again (a burst of changes is one read). */
  constructor(private readonly quietMs = 400) {}

  list(): readonly HeldAsk[] { return this.rows; }
  count(): number { return this.rows.length; }
  subscribe(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }

  /** Read them now, and keep reading them as the outline changes. */
  async seed(board: SocketBoard): Promise<void> {
    this.board = board;
    await this.read();
  }

  /** An outline event: a content change or a reconnect may change what is held, so they are read again once it is quiet. */
  heard(e: OutlineEvent): void {
    const agent = e.domain === "resource-catalog" && e.action === "extensions.agent";
    if (!this.board || e.change?.kind === "draft" || (e.domain !== "content" && !agent && e.action !== "reconnected" && e.action !== "reset")) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.read(); }, this.quietMs);
  }

  private async read(): Promise<void> {
    const board = this.board;
    if (!board) return;
    const next = await board.heldAsks().catch(() => null);
    if (!next || JSON.stringify(next) === JSON.stringify(this.rows)) return;
    this.rows = next;
    for (const f of this.listeners) f();
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.board = null; }
}
