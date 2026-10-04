// Where a new note goes (PIE-544): one placement rule for every note and page a client asks the service to make
// (`notes.create`, and the page stub `pages.follow` makes). A client says what it's making and, for a note, the note
// the person was in (`near`); the service answers where it goes. No client computes where the Inbox is.
//
// The rule is a list of rules, tried in order; the first that answers places the note. Today: a note made from inside
// another note goes under it, at the end of its children; everything else goes to the top of the Inbox, where quick
// capture puts its notes. This list is the seam for rules the outline defines later (a note holding `[new-notes::…]`
// lines: "type x goes under y", "pages go under Pages"): they read the outline and slot in before these two.
// Quick capture (`capture.create`) asks for a capture, which only the Inbox rule answers: "the top of the Inbox" is
// said once, here. A `near` the caller named itself (`nearOnly`: an agent, the CLI) that doesn't resolve is refused,
// never quietly put in the Inbox; the door's reader names the note the person is in, and that falls back.
import type { NotePlacement } from "@ep0ch/outline-core/protocol";
import type { Block } from "./types";
import { blockDisplayTitle } from "./references";

/** What a client is making. */
export type NewNoteIntent =
  /** A note; `near` is the note the person was in, if any (the reader they pressed it in); `nearOnly`: under `near` or
   * nowhere (the caller named it). */
  | { kind: "note"; near?: string; nearOnly?: boolean }
  /** A quick capture: always the Inbox. */
  | { kind: "capture" }
  /** A page stub for a `[[address]]` nothing answers yet. */
  | { kind: "page"; address: string };

/** Where a new note goes, and the words that say so: the wire type, outline-core's. */
export type Placement = NotePlacement;

/** What the rules may read: the outline's one Inbox, and a block if it's active. */
export interface PlacementReads {
  inbox(): Block;
  active(id: string): Block | null;
}

/** One rule: a placement, or null to let the next rule decide. */
export type PlacementRule = (intent: NewNoteIntent, reads: PlacementReads) => Placement | null;

/** A note made from inside another goes under it, last; never under a system note other than the Inbox. */
const underNear: PlacementRule = (intent, reads) => {
  if (intent.kind !== "note" || !intent.near) return null;
  const near = reads.active(intent.near);
  if (!near || near.id === reads.inbox().id) return null;
  if (near.author === "system" || near.properties.some(p => p.key === "system-view" || p.key === "system-doc")) return null;
  return { parentId: near.id, at: "end", rule: "near", said: `under “${blockDisplayTitle(near).slice(0, 60)}”` };
};

/** The default: the top of the Inbox, as quick capture places its notes. */
const inInbox: PlacementRule = (_intent, reads) => ({ parentId: reads.inbox().id, at: "top", rule: "inbox", said: "in the Inbox" });

/** The rules, in order. */
export const PLACEMENT_RULES: readonly PlacementRule[] = [underNear, inInbox];

/** Where a new note goes: the first rule that answers. */
export function placeNewNote(intent: NewNoteIntent, reads: PlacementReads, rules: readonly PlacementRule[] = PLACEMENT_RULES): Placement {
  if (intent.kind === "note" && intent.nearOnly && intent.near && !underNear(intent, reads)) {
    throw new Error(`No live note ${intent.near} to put the new note under: it's gone, in the trash, or a system note (without a near, the new note goes to the top of the Inbox)`);
  }
  for (const rule of rules) {
    const placed = rule(intent, reads);
    if (placed) return placed;
  }
  throw new Error("No placement rule placed the new note");
}

/** A `notes.create` intent from the wire, checked. */
export function readNewNoteIntent(input: unknown): NewNoteIntent {
  if (input === undefined || input === null) return { kind: "note" };
  if (typeof input !== "object") throw new Error("intent must be { kind: \"note\", near?, nearOnly? }");
  const { kind, near, nearOnly } = input as { kind?: unknown; near?: unknown; nearOnly?: unknown };
  if (kind !== undefined && kind !== "note") throw new Error(`notes.create makes notes (intent kind "note"); a page is pages.follow, not ${JSON.stringify(kind)}`);
  if (near !== undefined && near !== null && (typeof near !== "string" || !near)) throw new Error("intent.near must be a block id");
  if (nearOnly !== undefined && typeof nearOnly !== "boolean") throw new Error("intent.nearOnly must be true or false");
  return { kind: "note", ...(near ? { near: near as string, ...(nearOnly ? { nearOnly: true } : {}) } : {}) };
}
