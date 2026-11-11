// The one status line of a draft (PIE-1560): what is happening to it (checking its properties, saving, creating), what
// went wrong (a conflict, changed elsewhere), where a refused draft was copied, and the last thing said. Its draft
// session owns it (src/draft-session.ts) and is its writer: target adapters report a phase and an outcome, never a
// field, and every word anyone says on the line goes through `say`. A draft with no session (a line field, a test's)
// has one of its own. The draft's press-agains are here too (PIE-1616), one arm at a time, since its words are on this line:
//   nothing armed → discard (esc on unsaved text) · undo (ctrl+z at a save) · chord (ctrl+x), the line saying what's next
//   armed → the second press: esc puts it aside, ctrl+z after a pause goes past the save, ctrl+e opens $EDITOR, a attaches
//   armed → nothing armed: any other key, a click, a change to the text, a write or reload starting, anything else said
//   on the line, or its window (esc and ctrl+z 5 s; the chord has none, as bash's hasn't). ctrl+z's says its window
//   as a countdown ("ctrl+z again in 4s"), drawn again each second (PIE-1738: a slow second press asked again unseen)
import { Again, AGAIN_MS } from "./arm";
import { C, fg } from "./style";

/** What a write under way is doing: asking how the properties will read, writing it, creating it, reading the current text back. */
export type DraftPhase = "checking" | "saving" | "creating" | "reloading";

/** What a draft's next press would confirm: esc again, ctrl+z again, or what follows ctrl+x. */
export type DraftArm = "discard" | "undo" | "chord";
/** How soon a ctrl+z after the one that asked goes past the save: sooner is the key held down, which never does. */
export const UNDO_ASK_PAUSE_MS = 400;

export class DraftStatus {
  private doingNow: DraftPhase | null = null;
  /** A write is under way: nothing may change or close the draft meanwhile, and what was armed before it is off. */
  get phase(): DraftPhase | null { return this.doingNow; }
  set phase(p: DraftPhase | null) { if (p) this.letGo(); this.doingNow = p; }
  /** The service refused the last save as stale; the draft is kept as typed. */
  conflict: string | null = null;
  /** Another writer changed the block after the draft opened (seen through an outline event). */
  changedElsewhere = false;
  /** Where the draft was last copied to disk (a refused save, a put-aside). */
  savedCopy: string | null = null;
  private readonly arms = new Again<DraftArm>({
    ms: what => (what === "chord" ? Infinity : AGAIN_MS),
    pause: what => (what === "undo" ? UNDO_ASK_PAUSE_MS : 0),
    lapsed: () => { this.letGo(); this.changed?.(); },
    // A window said as a countdown is drawn again each second, so the count on screen is the one a key would meet.
    tick: { ms: 1000, then: () => { if (this.counting) this.changed?.(); } },
  });
  /** The words of what's armed, while they are the line. */
  private armWords: string | null = null;
  /** The armed words for the seconds left in their window (PIE-1738: "ctrl+z again in 4s …"), drawn at each read. */
  private counting: ((seconds: number) => string) | null = null;
  private said = "";
  /** The line changed by itself (an arm's window ran out, or its countdown moved on): its host draws it again. */
  changed: (() => void) | null = null;

  /** The last thing said on the line ("" for nothing). */
  get note(): string {
    if (this.armWords !== null && this.arms.armed() === null) this.letGo();
    if (this.counting && this.armWords !== null && this.said === this.armWords) this.said = this.armWords = this.counting(Math.ceil(this.arms.left() / 1000));
    return this.said;
  }
  /** Say `text` on the line (the one way anything is): it stays until the next thing said. Returns it. An arm is never held unseen: other words let it go. */
  say(text: string): string {
    if (this.armWords !== null && text !== this.armWords) { this.arms.clear(); this.armWords = null; }
    return (this.said = text);
  }
  /**
   * The first press: what's just been said on the line says what the second does, and stays for as long as it would.
   * `counting` says it with the seconds its window has left instead, counted down on the line (an undo at a save).
   */
  arm(what: DraftArm, counting?: (seconds: number) => string) {
    this.arms.arm(what);
    this.counting = counting ?? null;
    this.armWords = this.said = counting ? counting(Math.ceil(this.arms.left() / 1000)) : this.said;
  }
  /** What's armed now, or null. */
  armed(): DraftArm | null { return this.arms.armed(); }
  /** A press that can confirm it: what it confirms (past its pause, inside its window), or null. The arm and its words go either way. */
  press(): DraftArm | null { const was = this.arms.press(); this.letGo(); return was; }
  /** The one reset: nothing is armed, and the line stops saying so. */
  letGo() {
    this.arms.clear();
    this.counting = null;
    if (this.armWords !== null && this.said === this.armWords) this.said = "";
    this.armWords = null;
  }
  get busy(): boolean { return this.phase !== null; }
  get saving(): boolean { return this.phase === "saving" || this.phase === "creating"; }
  /** The block or passage was found again after a stale refusal (a reload): the line says so no longer. */
  settled() { this.conflict = null; this.changedElsewhere = false; }

  /** What a write under way is doing, in words ("saving…"), or null when none is. */
  get doing(): string | null {
    return this.phase === "saving" ? "saving…" : this.phase === "creating" ? "creating…" : this.phase === "checking" ? "checking properties…" : this.phase === "reloading" ? "reloading…" : null;
  }

  /** The draft's state, for the edit frame's status line (`dirty`: it differs from what it started as). */
  state(dirty: boolean): string { const s = this.stateParts(dirty); return fg(s.colour) + s.words; }
  /**
   * The state's words and colour apart, and (`short`) the same said for a narrow row: what was refused first, so a cut
   * never takes "not saved" (PIE-1560).
   */
  stateParts(dirty: boolean): { colour: number; words: string; short: string } {
    const one = (colour: number, words: string, short = words) => ({ colour, words, short });
    // Reloading answers the conflict: the line says that's happening, and says the conflict again only if it stands.
    if (this.phase === "reloading") return one(C.grey, this.doing!);
    return this.conflict ? one(C.lred, `! ${this.conflict}`, /not saved/.test(this.conflict) ? `! not saved: ${this.conflict.replace(/\s*·?\s*not saved\s*/, " ").trim()}` : `! ${this.conflict}`)
      : this.doing ? one(C.grey, this.doing)
      : this.changedElsewhere ? one(C.yellow, "!! changed elsewhere · saving checks it first", "!! changed elsewhere")
      : dirty ? one(C.yellow, "unsaved") : one(C.dark, "no changes");
  }
}
