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
  run(): void;
}

/** The window when nothing sets one. */
export const ARM_MS = 2000;

/**
 * How long an armed edit waits (EP0CH_EDIT_ARM): `off`, `no` or `0` turn arming off (e opens the edit at once), a
 * number is the window in milliseconds, anything else (or unset) the default 2 s.
 */
export function editArmMs(v = process.env.EP0CH_EDIT_ARM): number {
  const s = v?.trim().toLowerCase();
  if (!s) return ARM_MS;
  if (s === "off" || s === "no" || s === "false") return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : ARM_MS;
}

/** The key opens the armed edit: ⏎, or the key that armed it again. */
export function confirms(a: Arm, k: Key): boolean {
  if (k.kind === "enter") return !("shift" in k && k.shift) && !("ctrl" in k && k.ctrl);
  return k.kind === "char" && a.key.kind === "char" && k.ch === a.key.ch && !!k.ctrl === !!a.key.ctrl && !k.pasted;
}

/** A key that lets an armed edit go: anything but a mouse button's release (the press before it already did). */
export const disarms = (k: Key) => !(k.kind === "mouse" && k.action === "up");
