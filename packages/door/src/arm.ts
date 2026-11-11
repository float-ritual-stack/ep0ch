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
  // A paste never opens it (a `paste`, never ⏎ or a char): it lets the arm go and is offered (src/paste-path.ts).
  if (k.kind === "enter") return !("shift" in k && k.shift) && !("ctrl" in k && k.ctrl);
  return k.kind === "char" && a.key.kind === "char" && k.ch === a.key.ch && !!k.ctrl === !!a.key.ctrl;
}

/** A key that lets an armed edit go: anything but a mouse button's release (the press before it already did). */
export const disarms = (k: Key) => !(k.kind === "mouse" && (k.action === "up" || (k.action === "drag" && k.button === 3)));

// ── the same key again (PIE-1293, PIE-1616) ───────────────────────────────────────────────────────────
// One machine for every "press it again", and any wait on a press: idle, or holding one `what` since a moment.
//   arm(what)            idle or holding → holding `what` (a new arm replaces the old one)
//   take(what) / press() holding → idle, saying whether this press confirms: past its pause, inside its window
//   clear()              holding → idle (any other key, or a change the first press didn't see)
//   the window out       holding → idle, by itself or at the first read after it (`lapsed` says so, once, when someone draws it)
//   each tick (`tick`)   holding → holding, its owner told, so a window said as a countdown is drawn again (`left`)
// Each owner keeps its own window, pause and words: the edit's esc twice, ctrl+x ctrl+e and ctrl+z at a save
// (DraftStatus), a comment's ctrl+s twice, the look tuner's X X and R R, the door's quit, ctrl+], ^W x, an armed edit, a
// [[page]] offered, a prefix's panel after its pause. A yes/no with rows is confirmPicker (surface/picker.ts): the safe
// row first, and no machine here.

/** How long a second press confirms the first. */
export const AGAIN_MS = 5000;

/** A press's rule: a number, or one for each `what`. */
type PerWhat<T> = number | ((what: T) => number);
const perWhat = <T>(v: PerWhat<T> | undefined, what: T, none: number) => (typeof v === "function" ? v(what) : v ?? none);

export interface AgainRule<T> {
  /** How long the first press waits (`AGAIN_MS` by default; Infinity for as long as nothing else happens). */
  ms?: PerWhat<T>;
  /** How soon a second press is too soon: key repeat isn't a second press, and `ripe` waits for it. */
  pause?: PerWhat<T>;
  /** Two presses of the same thing (identity by default). */
  same?: (a: T, b: T) => boolean;
  /** The window ran out and it let go: for an owner that draws it. */
  lapsed?(what: T): void;
  /** The pause passed while it still waits: for an owner that draws something then. */
  ripe?(what: T): void;
  /** Every `ms` while it waits (its own timers, so a clear stops it): for an owner that draws what's left (PIE-1738). */
  tick?: { ms: number; then(what: T): void };
}

/** One press waiting for its second. */
export class Again<T = true> {
  private held: { what: T; at: number } | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  constructor(private readonly rule: AgainRule<T> = {}) {}
  private window(what: T) { return perWhat(this.rule.ms, what, AGAIN_MS); }
  private pause(what: T) { return perWhat(this.rule.pause, what, 0); }
  private stopTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
  private after(ms: number, then: () => void) { const t = setTimeout(then, ms); (t as { unref?(): void }).unref?.(); this.timers.push(t); }

  /** The first press: it waits, replacing whatever waited. */
  arm(what: T, now = Date.now()) {
    this.clear();
    const h = this.held = { what, at: now }, elapsed = Date.now() - now, ms = this.window(what), pause = this.pause(what), { lapsed, ripe } = this.rule;
    if (lapsed && Number.isFinite(ms)) this.after(Math.max(0, ms - elapsed), () => { if (this.held === h) { this.clear(); lapsed(what); } });
    if (ripe && pause > 0 && pause > elapsed) this.after(pause - elapsed + 5, () => { if (this.held === h) ripe(what); });
    const tick = this.rule.tick;
    if (tick && tick.ms > 0) { const next = () => this.after(tick.ms, () => { if (this.held === h) { tick.then(what); next(); } }); next(); }
  }
  /**
   * The window ran out: let it go and say so, once. Its timer does this on time; on a busy machine the timer is late, and
   * whoever reads the arm first after the window (a paint, peek, a key) does it, so nobody sees it gone while its owner
   * still shows it waiting (PIE-1635).
   */
  private lapse(now: number) {
    const h = this.held;
    if (!h || now - h.at < this.window(h.what)) return;
    this.clear();
    this.rule.lapsed?.(h.what);
  }
  /** A press of `what`: whether it is the second, past the pause and inside the window. Either way the first is let go. */
  take(what: T, now = Date.now()): boolean {
    this.lapse(now);
    const h = this.held, confirms = !!h && (this.rule.same ?? Object.is)(h.what, what) && this.inTime(h, now);
    this.clear();
    return confirms;
  }
  /** A press of whatever waits: what it confirms, or null. Either way the first is let go. */
  press(now = Date.now()): T | null {
    this.lapse(now);
    const h = this.held, confirms = h && this.inTime(h, now) ? h.what : null;
    this.clear();
    return confirms;
  }
  private inTime(h: { what: T; at: number }, now: number) { const e = now - h.at; return e >= this.pause(h.what) && e < this.window(h.what); }
  /** How long the window has left, in ms (0 when nothing waits; Infinity for a window with no end). */
  left(now = Date.now()): number { this.lapse(now); const h = this.held; return h ? Math.max(0, this.window(h.what) - (now - h.at)) : 0; }
  /** What waits for its second press now, or null. */
  armed(now = Date.now()): T | null { this.lapse(now); return this.held?.what ?? null; }
  /** What waits and has waited its pause, or null. */
  ripe(now = Date.now()): T | null { return this.held && this.armed(now) !== null && now - this.held.at >= this.pause(this.held.what) ? this.held.what : null; }
  /** Let it go (any other key). */
  clear() { this.held = null; this.stopTimers(); }
}

/**
 * The door's asks of one press (leaving, closing a running program): the same press within 3 s goes; any other lets it go,
 * but ^W, which is no press yet, and one that only opens a menu on the way to its row.
 */
export class PressAgain {
  private readonly waiting = new Again<{ press: string; what: string; at: number }>({ ms: 3000, same: (a, b) => a.press === b.press && a.what === b.what });
  /** What this press let go, until the next press. */
  private letGo: { press: string; what: string; at: number } | null = null;
  /** The press being handled, by its name. */
  private press = "";
  /** A press came, whoever takes it. */
  pressed(press: string, k: Key) {
    this.press = press;
    const asked = this.waiting.armed();
    this.letGo = null;
    if (asked && asked.press !== press && !(k.kind === "char" && k.ctrl && k.ch === "w")) { this.letGo = asked; this.waiting.clear(); }
  }
  /** `what` asks twice: false on the first press (it waits), true on the same press again. */
  asked(what: string): boolean {
    const asked = { press: this.press, what, at: Date.now() };
    if (this.waiting.take(asked)) return true;
    this.waiting.arm(asked);
    return false;
  }
  /** This press only opened a menu: what it let go still waits, in its own window. */
  openedMenu() {
    if (this.letGo) this.waiting.arm(this.letGo, this.letGo.at);
    this.letGo = null;
  }
}
