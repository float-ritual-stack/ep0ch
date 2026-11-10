// The door's paste path (PIE-1659): where a paste lands, decided once. A terminal sends a paste whole (bracketed paste,
// mode 2004; KeyDecoder joins one cut by the reads); the App asks here before the layers below the power bar and never
// types a paste out as keys, so no letter of it runs as a command (a pasted `dd` trashed the note in front). It lands:
// - **in** the place that has the keys, whole: a terminal tile's program (bracketed when it asked, PtyPane.paste), an
//   edit, a comment, a field or a filter line (the one editor takes a paste as one step), the edit or comment still
//   opening (the desk keeps it and puts it in when it opens); a hold that takes no text (a ^W chord, a step's choice, a
//   picker with no line) lets it go, and no letter of it runs;
// - **offer**: in the power bar's line where nothing is being typed into (a reader, a board's lanes, the drawer's
//   reader, a menu screen): a note's address there is that note's row (PIE-1401), any other text the bar's search, an
//   action line lit as a typed one is; nothing runs until ⏎ or a click, and one Esc puts it away (PIE-1675);
// - **nowhere**, said: a menu is open over the screen, or the screen has no power bar (the logon). The clipboard still
//   has it.
import type { Key } from "./term";
import { screenKeys, type DoorLayer, type KeyLayers, type ScreenKeys } from "./whereabouts";

export type PasteLanding = "bar" | "probe" | "picture" | "in" | "offer" | "nowhere";

/** What the paste path reads: the person's whereabouts, as the screen (or the drawer) and the door answer them. */
export interface PasteFacts {
  /** The pasted text; empty when the clipboard held only a picture (the terminal sends an empty paste). */
  text: string;
  /** The door's own layer open over everything (the power bar, the key probe, a menu over the screen). */
  over?: DoorLayer;
  /** A program has the keys (a terminal tile or the drawer's agent), nothing open over it. */
  program: boolean;
  /** Where the keys type, as the place that has them answers (Screen.keys' typingIn): an edit, a comment, a filter, an edit opening. */
  typingIn: string | null;
  /** The keys are held there (Screen.keys' busy, not the showcase's hold on navigation): an edit opening, a filter, a chord. */
  held: boolean;
  /** The power bar opens on this screen (not the logon or the logoff). */
  bar: boolean;
}

/** Where a paste lands: one answer for every screen, the drawer and the door's own layers. */
export function pasteLands(f: PasteFacts): PasteLanding {
  if (f.over === "bar") return "bar";
  if (f.over === "probe") return "probe";
  if (f.over === "menu") return "nowhere";
  if (f.program) return "in";
  if (f.typingIn || f.held) return f.text === "" ? "picture" : "in";
  if (!f.bar || f.text === "") return "nowhere";
  return "offer";
}

/** A screen as the paste path reads it (Screen's own answers). */
type Holder = { title: string; keys?(): ScreenKeys; holdsKeys?(): boolean; rawKeys?(): boolean; noDrawer?: boolean };

/** What the paste path needs of the door (App). */
export interface PasteDoor {
  /** The screen on top, and the drawer's desk while the person is in it (it has their keys then). */
  top(): Holder | undefined;
  drawer(): Holder | null;
  press(action: string, args?: Record<string, unknown>): Promise<unknown>;
  key(k: Key): void;
  refuse(why: string): void;
}

/**
 * A paste, where `pasteLands` says: offered in the power bar where nothing is typed into, said where nothing takes text,
 * a picture's ctrl+v (draft.image, PIE-592). False: it goes on whole, as one key, to what has the keys (the bar, a
 * terminal tile, an edit, a comment, a field, an edit still opening).
 */
export function paste(door: PasteDoor, text: string, w: KeyLayers): boolean {
  const top = door.top(), holder = door.drawer() ?? top, k = holder ? screenKeys(holder) : null;
  const facts: PasteFacts = { text, ...(w.over ? { over: w.over } : {}), program: !!w.program && !w.program.over, typingIn: k?.typingIn ?? null, held: !!k?.busy && !k.navHold, bar: !top?.noDrawer };
  const lands = pasteLands(facts);
  if (lands === "picture") { door.key({ kind: "char", ch: "v", ctrl: true }); return true; }
  // The offer is the power bar with the paste in its line, as a paste into the open bar is (bar.edit op=paste), said to be
  // offered: it isn't the person's typing, so one Esc puts the bar away (PIE-1675).
  if (lands === "offer") { void door.press("bar.open").then(() => door.press("bar.edit", { op: "paste", text, offer: true })); return true; }
  if (lands === "nowhere") {
    const where = facts.over === "menu" ? "a menu is open" : `nothing types on the ${top?.title ?? "screen"}`;
    door.refuse(text === "" ? "a picture pastes into an edit or a comment" : `pasted text isn't typed here: ${where} · the clipboard still has it`);
    return true;
  }
  return false;
}
