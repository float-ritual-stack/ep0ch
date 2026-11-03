// The one status line of a draft (PIE-1560): what is happening to it (checking its properties, saving, creating), what
// went wrong (a conflict, changed elsewhere), where a refused draft was copied, and the last thing said. Its draft
// session owns it (src/draft-session.ts) and is its writer: target adapters report a phase and an outcome, never a
// field, and every word anyone says on the line goes through `say`. A draft with no session (a line field, a test's)
// has one of its own. The esc ladder's arm is here too: the second esc puts the draft aside, the session's to do.
import { Again } from "./arm";
import { C, fg } from "./style";

/** What a write under way is doing: asking how the properties will read, writing it, creating it. */
export type DraftPhase = "checking" | "saving" | "creating";

export class DraftStatus {
  /** A write is under way: nothing may change or close the draft meanwhile. */
  phase: DraftPhase | null = null;
  /** The service refused the last save as stale; the draft is kept as typed. */
  conflict: string | null = null;
  /** Another writer changed the block after the draft opened (seen through an outline event). */
  changedElsewhere = false;
  /** Where the draft was last copied to disk (a refused save, a put-aside). */
  savedCopy: string | null = null;
  /** Esc once on unsaved text: esc again (Again) puts it aside. */
  readonly discard = new Again();
  private said = "";

  /** The last thing said on the line ("" for nothing). */
  get note(): string { return this.said; }
  /** Say `text` on the line (the one way anything is): it stays until the next thing said. Returns it. */
  say(text: string): string { return (this.said = text); }
  get busy(): boolean { return this.phase !== null; }
  get saving(): boolean { return this.phase === "saving" || this.phase === "creating"; }
  /** The block or passage was found again after a stale refusal (a reload): the line says so no longer. */
  settled() { this.conflict = null; this.changedElsewhere = false; }

  /** What a write under way is doing, in words ("saving…"), or null when none is. */
  get doing(): string | null {
    return this.phase === "saving" ? "saving…" : this.phase === "creating" ? "creating…" : this.phase === "checking" ? "checking properties…" : null;
  }

  /** The draft's state, for the edit frame's status line (`dirty`: it differs from what it started as). */
  state(dirty: boolean): string {
    return this.conflict ? fg(C.lred) + `! ${this.conflict}`
      : this.doing ? fg(C.grey) + this.doing
      : this.changedElsewhere ? fg(C.yellow) + "!! changed elsewhere · saving checks it first"
      : dirty ? fg(C.yellow) + "unsaved" : fg(C.dark) + "no changes";
  }
}
