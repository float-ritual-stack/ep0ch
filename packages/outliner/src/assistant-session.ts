import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface AssistantSessionEvidence {
  id: string;
  path?: string;
  startedAt: string;
  finishedAt?: string;
  phase: string;
  outcome: "running" | "completed" | "failed" | "canceled";
  /** An early interruption can leave only SDK entries preceding the first reply. */
  snapshot?: boolean;
  warning?: string;
}

/** Owns one attempt, never resumes an earlier session or replays its tools. */
export class AssistantSession {
  readonly manager: SessionManager;
  readonly evidence: AssistantSessionEvidence;

  constructor(cwd: string, directory: string, sourceId: string, purpose: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.manager = SessionManager.create(cwd, directory);
    this.evidence = { id: this.manager.getSessionId(), startedAt: new Date().toISOString(), phase: "Starting Pi", outcome: "running" };
    this.manager.appendCustomEntry("outliner-attempt", { ...this.evidence, sourceId, purpose });
  }

  progress(phase: string): void {
    if (this.evidence.finishedAt) return;
    this.evidence.phase = phase;
    this.manager.appendCustomEntry("outliner-phase", { phase, at: new Date().toISOString() });
  }

  finish(outcome: "completed" | "failed" | "canceled"): AssistantSessionEvidence {
    if (this.evidence.finishedAt) return { ...this.evidence };
    this.evidence.outcome = outcome;
    this.evidence.finishedAt = new Date().toISOString();
    try {
      this.manager.appendCustomEntry("outliner-attempt-end", { ...this.evidence });
      const nativePath = this.manager.getSessionFile();
      if (nativePath && existsSync(nativePath)) this.evidence.path = nativePath;
      else {
        // Pi defers persistence until an assistant message. Snapshot its actual
        // public entries to a different native JSONL file: do not fabricate a
        // reply or occupy the filename Pi may still create after cancellation.
        const header = this.manager.getHeader();
        if (!header) throw new Error("Session header unavailable");
        const path = join(this.manager.getSessionDir(), `${this.evidence.id}.interrupted.jsonl`);
        writeFileSync(path, [header, ...this.manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
        this.evidence.path = path;
        this.evidence.snapshot = true;
        this.evidence.warning = "Early-interruption snapshot; only completed SDK entries are retained, not partial streamed output";
      }
    } catch {
      this.evidence.warning = "Pi session could not be retained; no transcript is available";
      delete this.evidence.path;
    }
    return { ...this.evidence };
  }
}
