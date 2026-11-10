// Esc's one rule (PIE-1614): it closes the innermost temporary thing where the keys are, one thing a press, and the hint
// row says first what that is. The keys nest (door, drawer or screen, desk, a group's desk, tile, reader, mode, draft,
// popup), so the ladder composes: each layer states its own order here, as data, and answers with its first open rung,
// asking the layer inside at the step that names it. `escNext` is what the hint says; `escPress` is what the key does: both
// read the same steps, so they can't disagree. A rung's `run` is its owner's own close (an action, a picker's, a draft's
// esc steps): what stays in the leaves is how a thing closes, never which thing goes first. Its twin for ctrl+] is
// `wayOut` in desk/keys-fact.ts.
import type { Key } from "./term";

/** The key itself, as a rung hands it to the owner whose close reads it (a picker, a draft). */
export const ESC_KEY: Key = { kind: "esc" };

export interface EscRung {
  /** What it closes, in the hint's words ("the popup"); null: an owner that says nothing (a program's Esc, an extension's key). */
  readonly closes: string | null;
  /** It may take nothing: with no word of its own the hint reads on past it. Without this a wordless rung is the end of the hint: the program has the key. */
  readonly maybe?: true;
  /** Close it. False: it took nothing after all, and the next rung goes. */
  run(): boolean | void;
}
/** One layer's steps, by the names its order lists. Reading one changes nothing: the hint row asks on every paint. */
export type EscSteps<N extends string> = Record<N, () => EscRung | null>;

/** The drawer's own rungs, which its foot says in its own parts ("esc puts it away", "esc steps out"). */
export const ESC_DRAWER = "the drawer", ESC_DRAWER_KEYS = "the drawer's keys";

/** The door's order, innermost first (App.escSteps). The screen answers twice: all that's in front of the drawer, then its own way home. */
export const DOOR_ESC = ["probe", "armed", "strip", "bar", "menu", "module", "lift", "in-drawer", "keymap", "screen", "drawer-up", "home"] as const;
/**
 * A desk's order, innermost first (Desk.escSteps). What holds the keys over a tile comes first: a picker opened over an
 * edit is inside that edit. `home` steps are outside the drawer the person is out of; all the others are in front of it.
 */
export const DESK_ESC = ["opening", "card", "overlay", "model", "bound", "link", "program", "held-tile", "drag", "choosing", "chord", "in-reader", "script", "tile", "lift", "zoom", "peek", "picked", "dock"] as const;
export const DESK_HOME_ESC = ["keys-home", "sliding-dock"] as const;
/** A reader's order, innermost first (NoteSurface.escSteps): its modes in PRECEDENCE, then what's lit. */
export const READER_ESC = ["mode", "selection", "collection", "lit"] as const;
/** A draft's own, innermost first (`draftEsc`): the popup, then snippet stops, then the selection, then its put-aside steps. */
export const DRAFT_ESC = ["popup", "snippet", "selection", "draft"] as const;

/** An owner has the key and closes nothing the hint can name (a program, the person's binding for Esc): apart from nothing open, which lets the next layer answer. */
export const ESC_TAKEN = Symbol("the key is taken, with nothing to name");
/** One layer's answer to the next Esc: what it closes, taken, or null: nothing open here. */
export type EscRead = string | typeof ESC_TAKEN | null;

/** The layer's answer: the first open rung's word, or that a wordless owner has the key. */
export function escRead<N extends string>(order: readonly N[], steps: EscSteps<N>): EscRead {
  for (const n of order) {
    const r = steps[n]();
    if (r?.closes) return r.closes;
    if (r && !r.maybe) return ESC_TAKEN;
  }
  return null;
}
/** The rung the next Esc closes: what a hint says. */
export function escNext<N extends string>(order: readonly N[], steps: EscSteps<N>): string | null {
  const read = escRead(order, steps);
  return typeof read === "string" ? read : null;
}
/** A rung from the answer of the layer inside: what `run` then asks. Nothing open inside passes the key on when `run` says it took nothing. */
export function rungOf(read: EscRead, run: () => boolean | void): EscRung {
  return typeof read === "string" ? { closes: read, run } : read === ESC_TAKEN ? { closes: null, run } : { closes: null, maybe: true, run };
}
/** The key: the first rung open closes, and only that one. False: nothing took it. */
export function escPress<N extends string>(order: readonly N[], steps: EscSteps<N>): boolean {
  for (const n of order) { const r = steps[n](); if (r && r.run() !== false) return true; }
  return false;
}

// ── a rung whose key isn't Esc ──────────────────────────────────────────────────────────────────────────────────
// A draft's rungs (popup, snippet stops, selection, the put-aside steps) belong to its `edit.close` row, so when the person's
// keymap moves that row off Esc, Esc is no longer theirs. The rung's word carries the key (`escVia`), through every layer
// that passes the word on unread, to the hint row, which names it (`escSays`). A click on the hint (`esc.close`, `asHintEsc`)
// is the key itself: the draft reads that Esc as its bound key.
const VIA = "␟";
/** `word` as closed by `key`: Esc's words stay plain. */
export const escVia = (key: string | null | undefined, word: string): string => (!key || key === "esc" ? word : `${key}${VIA}${word}`);
/** A rung's word split into the key that closes it (Esc unless it says another) and what it closes. */
export function escWordOf(closes: string): { key: string; word: string } {
  const i = closes.indexOf(VIA);
  return i < 0 ? { key: "esc", word: closes } : { key: closes.slice(0, i), word: closes.slice(i + 1) };
}
/** The hint's words for a rung: `esc: the popup`, `alt+q: the edit, put aside`. */
export const escSays = (closes: string): string => { const { key, word } = escWordOf(closes); return `${key}: ${word}`; };
let hinted = 0;
/** Whether the Esc being handled is the hint's click (or `act esc.close`), not the key: a draft reads it as its own close key. */
export const escByHint = () => hinted > 0;
export function asHintEsc<T>(f: () => T): T { hinted++; try { return f(); } finally { hinted--; } }
