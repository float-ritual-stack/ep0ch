// An edit armed, not opened (edit.arm): the person's e (or ctrl+e) in a reader asks first, so a key typed into
// the wrong tile, or a fat finger, never opens an edit. The status bar says `edit <title>? ⏎ · any other key
// cancels` and the reader's frame turns the edit's colour; ⏎ or the same key again within the window opens it,
// any other key lets it go and does what it does, and the window running out lets it go quietly. The shell holds
// it (App.arm), so a key any layer takes (the dock, a screen's chord) lets it go too. A click on an edit control
// and an agent's `edit` open at once.
import type { Key } from "./term";

/** One armed edit: what it's for (a reader's surface, by identity), what the status bar says, and how it opens. */
export interface Arm {
  /** What is armed (a NoteSurface): the screen it's on draws that tile in the edit's colour. */
  of: object;
  /** The note's title, for `peek`. */
  what: string;
  /** The status bar's question. */
  say: string;
  /** The key that armed it: pressed again, it opens too. */
  key: Key;
  /** How long it waits, in milliseconds. */
  ms: number;
  /** Open the edit, as the person's key did before arming (the confirm: the note's `edit` action). */
  run(key: Key): void;
}

/** The window when nothing sets one. */
export const ARM_MS = 2000;

/** The person's setting (edit.arm.set, kept in the state dir as `edit-arm.json`): the window, 0 for off; null for none. */
let saved: number | null = null;
/** Use the setting kept from last time (the door's start) or just chosen (edit.arm.set). */
export function useEditArm(ms: unknown) { saved = typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null; }

/**
 * How long an armed edit waits: EP0CH_EDIT_ARM when set (`off`, `no` or `0` turn arming off, e opens the edit at
 * once; a number is the window in milliseconds), else the person's setting (edit.arm.set), else the default 2 s.
 */
export function editArmMs(v = process.env.EP0CH_EDIT_ARM): number {
  const s = v?.trim().toLowerCase();
  if (!s) return saved ?? ARM_MS;
  if (s === "off" || s === "no" || s === "false") return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : ARM_MS;
}

/** The key opens the armed edit: ⏎, or the key that armed it again. */
export function confirms(a: Arm, k: Key): boolean {
  // A paste typed out as keys never opens it: its newline lets the arm go, as any other key does.
  if ("pasted" in k && k.pasted) return false;
  if (k.kind === "enter") return !("shift" in k && k.shift) && !("ctrl" in k && k.ctrl);
  return k.kind === "char" && a.key.kind === "char" && k.ch === a.key.ch && !!k.ctrl === !!a.key.ctrl;
}

/** A key that lets an armed edit go: anything but a mouse button's release (the press before it already did). */
export const disarms = (k: Key) => !(k.kind === "mouse" && (k.action === "up" || (k.action === "drag" && k.button === 3)));

// ── the same key again (PIE-1293) ──────────────────────────────────────────────────────────────────────
// One rule for every "press it again to confirm": the first press says what the second does, the same press again
// within AGAIN_MS does it, and any other key (or the window running out) lets it go, quietly. The edit's esc twice
// (discard), a comment's ctrl+s twice (send anyway), the look tuner's X X and R R all hold theirs here. A yes/no
// with rows is confirmPicker (surface/picker.ts): the safe row first.

/** How long a second press confirms the first. */
export const AGAIN_MS = 5000;

/** One press waiting for its second: `what` it is for (compared with `same`), until the window runs out. */
export class Again<T = true> {
  private held: { what: T; at: number } | null = null;
  constructor(private readonly ms = AGAIN_MS, private readonly same: (a: T, b: T) => boolean = Object.is) {}
  /** The first press: the next `take` of the same `what` within the window confirms. */
  arm(what: T, now = Date.now()) { this.held = { what, at: now }; }
  /** A press: whether it is the second of `what` within the window. Either way the first is let go. */
  take(what: T, now = Date.now()): boolean {
    const h = this.held;
    this.held = null;
    return !!h && this.same(h.what, what) && now - h.at < this.ms;
  }
  /** What waits for its second press now, or null. */
  armed(now = Date.now()): T | null { return this.held && now - this.held.at < this.ms ? this.held.what : null; }
  /** Let it go (any other key). */
  clear() { this.held = null; }
}
