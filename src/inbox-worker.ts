import { InboxRepository } from "./inbox-repository";
import type { InboxModel, InboxResult, InboxStatus, InboxUsage } from "./inbox-types";
import { blockDisplayTitle } from "./references";
import type { OutlinerStore } from "./store";
import type { Block } from "./types";

/** One workspace-owned loop. Pending work is the Inbox itself, not a second queue. */
export class InboxWorker {
  readonly repository: InboxRepository;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private active: AbortController | undefined;
  private current: Block | undefined;
  private stopped = false;
  private unavailable: string | undefined;
  private message = "Automatic cleanup is ready";
  private readonly settleMs: number;

  constructor(
    private readonly store: OutlinerStore,
    private readonly model: InboxModel,
    private readonly changed: (result?: InboxResult) => void,
    options: { settleMs?: number; repository?: InboxRepository } = {},
  ) {
    this.repository = options.repository ?? new InboxRepository(store);
    this.settleMs = options.settleMs ?? 750;
  }

  status(attentionOnly = false, resultsOffset = 0): InboxStatus {
    const paused = this.repository.settings().paused;
    const attention = this.repository.attention(31);
    const results = attentionOnly ? attention.results : this.repository.results(31, resultsOffset);
    return {
      enabled: true, paused,
      state: this.unavailable ? "unavailable" : paused ? "paused" : this.current ? "working" : "idle",
      message: this.unavailable ?? (paused ? "Automatic cleanup paused" : this.message),
      pending: this.repository.pending().length,
      ...(this.current ? { current: { id: this.current.id, title: blockDisplayTitle(this.current) } } : {}),
      results: results.slice(0, 30), resultsTruncated: results.length > 30,
      attentionCount: attention.total, attentionOnly, resultsOffset: attentionOnly ? 0 : resultsOffset,
    };
  }

  wake(): void {
    if (this.stopped || this.running || this.timer || this.unavailable || this.repository.settings().paused) return;
    // This also ensures capture replies leave the service before model work starts.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.drain().catch(() => {
        this.unavailable = "Inbox recovery could not be saved; automatic cleanup stopped";
        this.changed();
      }).finally(() => { this.running = undefined; this.wakeIfPending(); });
    }, this.settleMs);
    this.timer.unref?.();
  }

  pause(): InboxStatus {
    this.repository.setPaused(true);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.active?.abort();
    this.changed();
    return this.status();
  }

  resume(): InboxStatus {
    if (this.stopped) throw new Error("Inbox processor is stopping");
    const latest = this.repository.results(1)[0];
    if (latest?.state === "failed") this.repository.reconsider(latest.sourceId, this.repository.instructions(latest.sourceId));
    this.unavailable = undefined;
    this.repository.setPaused(false);
    this.message = "Automatic cleanup resumed";
    this.changed();
    this.wake();
    return this.status();
  }

  reconsider(sourceId: string, instructions?: string): InboxStatus {
    if (typeof sourceId !== "string" || !sourceId) throw new Error("Source ID is required");
    if (instructions !== undefined && (typeof instructions !== "string" || instructions.length > 2000)) {
      throw new Error("Steering instructions must be at most 2000 characters");
    }
    if (!this.repository.reconsider(sourceId, instructions?.trim())) throw new Error("This note is no longer an unprocessed Inbox note");
    // A previous decision must not consume direction supplied while it was thinking.
    if (this.current?.id === sourceId) this.active?.abort();
    this.unavailable = undefined;
    this.message = "Note ready for reconsideration";
    this.changed();
    this.wake();
    return this.status();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.active?.abort();
    await this.running;
  }

  private wakeIfPending(): void {
    if (!this.stopped && !this.unavailable && !this.repository.settings().paused && this.repository.pending().length) this.wake();
  }

  private async drain(): Promise<void> {
    while (!this.stopped && !this.repository.settings().paused && !this.unavailable) {
      const source = this.repository.pending()[0];
      if (!source) { this.message = "Inbox is caught up"; this.changed(); return; }
      this.current = source;
      this.message = "Reading and finding related notes";
      this.changed();
      const abort = new AbortController();
      this.active = abort;
      const observed = new Map<string, Block>([[source.id, source]]);
      const read = (id: string): Block | null => {
        abort.signal.throwIfAborted();
        const block = this.store.get(id);
        if (!block || block.effectiveDeletedRootId || block.deletedAt) return null;
        observed.set(id, block);
        return block;
      };
      const operationId = crypto.randomUUID();
      let abortListener: (() => void) | undefined;
      let applying = false;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          abortListener = () => reject(new Error("Inbox cleanup interrupted"));
          abort.signal.addEventListener("abort", abortListener, { once: true });
        });
        const answer = await Promise.race([cancelled, this.model({
          source, read,
          search: query => {
            abort.signal.throwIfAborted();
            return this.store.searchTree(query).matches.slice(0, 20)
              .filter(match => match.block.id !== source.id)
              .map(match => read(match.block.id)).filter((block): block is Block => block !== null);
          },
          instructions: this.repository.instructions(source.id), signal: abort.signal,
          progress: message => {
            if (abort.signal.aborted || this.stopped) return;
            this.message = message.slice(0, 200); this.changed();
          },
        })]);
        // Pause is checked at the write boundary, even if a provider ignores cancellation.
        if (abort.signal.aborted || this.stopped || this.repository.settings().paused) return;
        applying = true;
        for (const update of answer.plan.updates) {
          const previous = observed.get(update.blockId);
          const current = this.store.get(update.blockId);
          if (!previous || previous.revision !== update.expectedRevision || !current ||
              current.revision !== previous.revision || current.parentId !== previous.parentId) {
            throw new Error("A target changed or was not read; cleanup was not applied");
          }
        }
        const result = this.repository.apply(operationId, source, answer.plan, answer.usage);
        this.changed(result);
      } catch (error) {
        if (abort.signal.aborted || this.stopped) return;
        const detail = error instanceof Error ? error.message : "Inbox cleanup failed";
        const usage = error instanceof Error && "usage" in error ? error.usage as InboxUsage : undefined;
        const result = this.repository.fail(operationId, source, detail.slice(0, 500), usage);
        this.changed(result);
        // One provider failure must not burn through every note in the Inbox.
        // A rejected stale edit is local to that note and must not block the rest.
        if (!applying && !(error instanceof Error && error.name === "InboxNoteError")) {
          this.unavailable = detail.slice(0, 500);
          this.repository.setPaused(true);
        }
      } finally {
        if (abortListener) abort.signal.removeEventListener("abort", abortListener);
        this.current = undefined;
        this.active = undefined;
        this.changed();
      }
    }
  }
}
