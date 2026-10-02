// The reader's modes (PIE-516, part 2): what takes a reader's keys while the person or an agent is doing
// something in it besides reading: a step's status choice, the property panel, an edit, a comment session.
// Each is a mode behind one seam, kept in a small stack whose order is their precedence, stated once
// (PRECEDENCE). The note surface asks the stack, never each field: the key, a click, a press or drag, the
// wheel, what to draw, the hint, leaving, and `peek`. Reading itself (layout, elements, folds, history,
// selection, projections) stays the surface's: a mode only takes what reaches it first. The edit and the comment
// draw in place of the note (`rows`); the panel and the status choice are drawn inside it by the reading render,
// which asks the surface's `panel` and `picker` (views of this stack).
import type { LeaveResult } from "../draft-session";
import type { Actor } from "../socket";
import type { Key } from "../term";

export type ModeName = "picker" | "panel" | "draft" | "comment";

/**
 * Which mode takes a reader's keys first, when more than one is open: a step's status choice (it was opened
 * on top of whatever was there, and closes at the next key that isn't its own), then the property panel, then
 * the edit or the comment (one at a time: each refuses to open while the other is).
 */
export const PRECEDENCE: Record<ModeName, number> = { picker: 3, panel: 2, draft: 1, comment: 1 };

/** One mode, as the reader asks it. `H` is the reader's host. */
export interface ReaderMode<H> extends Mode<H> {
  readonly name: ModeName;
  /** What the mode is about (the edit's draft, the comment session, the panel, the choice): hosts compare it by identity. */
  readonly of: object;
  /** Takes every key, the host's shortcuts too, while it's open. */
  readonly holdsKeys: boolean;
  /** Holds the reader on its note and keeps its clicks (an edit, a comment, a property value being typed). */
  editing(): boolean;
  /** Its rows in place of the note (an edit, a comment, the full panel); null when it's drawn inside the note. */
  covers(): boolean;
  key(k: Key, host: H): boolean;
  /** A click at the surface's cell `x`, `y`: true or false when it was the mode's, undefined when reading has it. */
  click(x: number, y: number, host: H): boolean | undefined;
  /** The button went down (`drag`: moved with it down) at `x`, `y`: true when the mode took it. */
  press?(x: number, y: number, host: H, drag: boolean): boolean;
  /** The rows it draws in place of the note (`covers`), or null. */
  rows(w: number, h: number, host: H | undefined): string[] | null;
  /** Leave it as a click elsewhere does (an edit saved or kept, a comment kept); a refusal throws with why. */
  leave(host: H, actor: Actor): Promise<LeaveResult>;
  /** Why a click can't leave it now, or null. */
  leaveRefusal?(): string | null;
  /** Typed text not yet written; copied to disk (and put aside) by `keep`. */
  unsaved?(): boolean;
  keep?(): string[];
  /** The keys that work now, and the host title's word for it. */
  hint(): string;
  state(): string | null;
  /** For `peek`, under the mode's own key. */
  describe(): unknown;
  /** The note it's on changed elsewhere (`revision`; `partial`: only its list row was read): what it holds is marked, never replaced. */
  changed?(revision: number, partial: boolean): void;
  /** Its name for hints and refusals: "edit", "comment", "property panel", "status choice". */
  readonly word: string;
  /** How a refusal names it while it holds the note: "the edit", "the comment", "the property value". */
  readonly noun?: string;
}

/**
 * Anything that takes a host's keys first while it's open: a reader's mode, or a screen's overlay (a picker, the
 * policy panel). A stack of them (`Modes`) gives the key, a click and the wheel to the first that takes it.
 */
export interface Mode<H> {
  readonly name: string;
  key(k: Key, host: H): boolean;
  /** A click at `x`, `y`: true or false when it was the mode's, undefined when it wasn't. */
  click?(x: number, y: number, host: H): boolean | undefined;
  /** The wheel: true when the mode took it. */
  wheel?(dir: 1 | -1, host: H): boolean;
  /** It ended by itself: the stack lets it go. */
  ended?(): boolean;
}

/** The open modes, in precedence order (`order`, by name; the newest first among equals): the first takes the keys. */
export class Modes<H, M extends Mode<H>> {
  protected modes: M[] = [];
  constructor(private readonly order: Readonly<Record<string, number>> = {}) {}

  /** Open `m` (one of a name at a time: an earlier one of the same name goes). */
  push<N extends M>(m: N): N {
    const rank = (x: M) => this.order[x.name] ?? 0;
    this.modes = this.modes.filter(x => x.name !== m.name);
    const at = this.modes.findIndex(x => rank(x) <= rank(m));
    this.modes.splice(at < 0 ? this.modes.length : at, 0, m);
    return m;
  }
  /** Let go of a mode, by name, or only if it's that very one. */
  drop(m: string | M) { this.modes = this.modes.filter(x => (typeof m === "string" ? x.name !== m : x !== m)); }
  get(name: string): M | null { this.prune(); return this.modes.find(x => x.name === name) ?? null; }
  /** The mode the keys go to, or null when none is open. */
  top(): M | null { this.prune(); return this.modes[0] ?? null; }
  /** Every open mode, first the one the keys go to. */
  all(): readonly M[] { this.prune(); return this.modes; }

  /** The key goes to the first mode, or null when there's none. */
  key(k: Key, host: H): boolean | null { const t = this.top(); return t ? t.key(k, host) : null; }
  /** Each mode in order may take the click; undefined when none did. */
  click(x: number, y: number, host: H): boolean | undefined {
    for (const m of this.all()) { const r = m.click?.(x, y, host); if (r !== undefined) return r; }
    return undefined;
  }
  wheel(dir: 1 | -1, host: H): boolean { for (const m of this.all()) if (m.wheel?.(dir, host)) return true; return false; }

  /** Modes that ended by themselves go. */
  private prune() { if (this.modes.some(m => m.ended?.())) this.modes = this.modes.filter(m => !m.ended?.()); }
}

/** A reader's open modes, in PRECEDENCE order. */
export class ModeStack<H> extends Modes<H, ReaderMode<H>> {
  constructor() { super(PRECEDENCE); }

  get holdsKeys() { return this.all().some(m => m.holdsKeys); }
  get editing() { return this.all().some(m => m.editing()); }
  /** Something is drawn in place of the note: the note itself doesn't scroll. */
  get covers() { return this.all().some(m => m.covers()); }

  press(x: number, y: number, host: H, drag: boolean): boolean { return this.all().some(m => m.editing() && !!m.press?.(x, y, host, drag)); }
  /** What's drawn in place of the note, by the first mode that covers it. */
  rows(w: number, h: number, host: H | undefined): string[] | null {
    for (const m of this.all()) { const r = m.covers() ? m.rows(w, h, host) : null; if (r) return r; }
    return null;
  }
  /** Why a click can't leave what's open, or null. */
  leaveRefusal(): string | null { for (const m of this.all()) { const r = m.leaveRefusal?.(); if (r) return r; } return null; }
  unsaved() { return this.all().some(m => !!m.unsaved?.()); }
  keep(): string[] { return this.all().flatMap(m => m.keep?.() ?? []); }

  /** The note changed elsewhere: each open mode marks what it holds. */
  changed(revision: number, partial: boolean) { for (const m of this.all()) m.changed?.(revision, partial); }
  /** The mode that holds the note, by the noun a refusal names it with ("finish the edit first"). */
  holding(): string | null { return this.all().find(m => m.editing())?.noun ?? null; }
}
