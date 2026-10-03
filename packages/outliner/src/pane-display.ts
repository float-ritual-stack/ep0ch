import {sanitizeDynamicText} from "./terminal";

/** Display-only host metadata. Never renames a pane or changes a user's label. */
export class PaneDisplay {
  private wanted = "";
  private paneId: string | null = null;
  private sequence = Date.now();
  private running = false;
  private pending: Promise<void> | undefined;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly source = `outliner:${process.pid}:${crypto.randomUUID()}`;
  inFrame = false;

  constructor(private readonly changed: () => void) {
    if (process.env.HERDR_ENV === "1") {
      this.timer = setInterval(() => this.requestPublish(), 5_000);
      this.timer.unref();
    }
  }

  update(title: string): void {
    const value = sanitizeDynamicText(title).replace(/\s+/g, " ").trim();
    if (value === this.wanted || this.stopped) return;
    this.wanted = value;
    if (process.env.HERDR_ENV === "1") this.requestPublish();
  }

  private requestPublish(): void {
    if (!this.running && !this.stopped) this.pending = this.publish();
  }

  private async command(args: string[]): Promise<any> {
    const child = Bun.spawn([process.env.HERDR_BIN_PATH ?? "herdr", ...args], {stdout: "pipe", stderr: "ignore"});
    const timer = setTimeout(() => child.kill(), 2_000);
    try {
      const text = await new Response(child.stdout).text();
      if (await child.exited !== 0) throw Error("Pane metadata unavailable");
      // Query commands return JSON; successful metadata writes are silent.
      return text.trim() ? JSON.parse(text) : null;
    } finally { clearTimeout(timer); }
  }

  private async clear(): Promise<void> {
    if (!this.paneId) return;
    await this.command(["pane", "report-metadata", this.paneId, "--source", this.source, "--clear-title", "--seq", String(++this.sequence)]);
    this.paneId = null;
  }

  private async publish(): Promise<void> {
    if (this.running || this.stopped || !this.wanted) return;
    this.running = true;
    const title = this.wanted;
    const previous = this.inFrame;
    try {
      const {result} = await this.command(["pane", "current", "--current"]);
      const pane = result?.pane;
      if (!pane?.pane_id) throw Error("No current pane");
      // Metadata follows the terminal through pane moves. Address that terminal
      // by its current ID instead of trying to clear its now-invalid old ID.
      this.paneId = pane.pane_id;
      // Herdr's metadata title precedes manual labels. Defer to any explicit
      // user label, including a rename while this reader is already running.
      const defaults = ["Outliner", "Outliner Detail", "Outliner · Tree + Detail"];
      if (pane.label && !defaults.includes(pane.label)) {
        await this.clear();
        this.inFrame = false;
      } else {
        await this.command(["pane", "report-metadata", this.paneId!, "--source", this.source,
          "--title", title, "--seq", String(++this.sequence), "--ttl-ms", "12000"]);
        this.inFrame = true;
      }
    } catch { this.inFrame = false; }
    finally {
      this.running = false;
      if (this.stopped) return;
      if (previous !== this.inFrame) this.changed();
      if (title !== this.wanted) this.requestPublish();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.pending;
    await this.clear().catch(() => {});
    this.inFrame = false;
  }
}
