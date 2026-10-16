// Moving a note to a new parent or a new place among its siblings (PIE-943): the one step `note.move` (the reader, the
// menu, the power bar's "Move to…", `act`), `tree.move` (the outline tile's keys and drags) and `column.move` run. The
// door passes only intent (under a note, beside a sibling, or one step); where the note lands, what is refused and how a
// stale revision reads are the outliner's `moveBlock`, the rule outline_move runs for an agent, so the person and an agent
// can't be given two answers. This adds only what a client owns: who asked, the words, and ctrl+z (the service keeps no
// undo token for a move, so the place it came from is kept here, in the shared UndoHistory).
import { recordedActorId, type Actor } from "./socket";
import { ActionRefused } from "./surface/actions";
import { UndoHistory, partyOf } from "./steps";
import { moveWithRules, type WriteBoard } from "./mcp-writes";
import type { BarQuestion } from "./bar/ask";

/** Where a note goes: one of these. `to`: inbox, root, or an id, ((ref)), [[page]] or Work ID; `position` counts from 1. */
export type MoveIntent =
  | { to: string; position?: number }
  | { before: string }
  | { after: string }
  | { step: "up" | "down" | "in" | "out" };

/** The arguments the actions take (all optional strings and numbers, as `act` gives them), read as one intent. */
export interface MoveArgs { to?: string; before?: string; after?: string; step?: string; position?: number; revision?: number }

export interface MoveDone { moved: string; parent: string | null; position: number; previousParent: string | null; unchanged?: true; said: string }

/** A move made, to put back: where the note was. */
interface MoveUndo { by: string; context: string; id: string; parent: string | null; position: number }
/** The moves made here, for ctrl+z (`context`: the moved note's id, what the reader or tree shows). */
export const MOVE_UNDO = new UndoHistory<MoveUndo>();

/** The one intent the arguments name, or a refusal that lists what to give. */
export function intentOf(a: MoveArgs): MoveIntent {
  const given = (["to", "before", "after", "step"] as const).filter(k => a[k] !== undefined);
  if (given.length !== 1) throw new ActionRefused("say where: to=<inbox, root, or a note's id, ((ref)), [[page]], Work ID>, before=<a sibling>, after=<a sibling> or step=up|down|in|out (one of them)");
  if (a.position !== undefined && given[0] !== "to") throw new ActionRefused("position goes with to= (before= and after= are the place already)");
  if (a.position !== undefined && (!Number.isInteger(a.position) || a.position < 1)) throw new ActionRefused("position counts from 1");
  if (a.step !== undefined) {
    if (a.step !== "up" && a.step !== "down" && a.step !== "in" && a.step !== "out") throw new ActionRefused("step is up, down, in (under the note above) or out (after its parent)");
    return { step: a.step };
  }
  if (a.before !== undefined) return { before: a.before };
  if (a.after !== undefined) return { after: a.after };
  return { to: a.to!, ...(a.position !== undefined ? { position: a.position } : {}) };
}

/** The `moveBlock` input for an intent: a person's `to` goes first under the note (position 0) unless a position says. */
async function inputOf(board: WriteBoard, intent: MoveIntent): Promise<{ parent?: string; before?: string; after?: string; position?: number; step?: "up" | "down" | "in" | "out" }> {
  if ("step" in intent || "before" in intent || "after" in intent) return intent;
  const to = intent.to.trim();
  const parent = to === "inbox" ? await board.inboxId().catch(() => null) : to;
  if (!parent) throw new ActionRefused("this outline has no Inbox to put it in: to=<a note's id>");
  return { parent, position: intent.position === undefined ? 0 : intent.position - 1 };
}

/** moveBlock's words name notes as ((id|title)); said to a person they read as the title (a bare ((id)) as "that note"). */
const plainly = (said: string) => said.replace(/\(\([0-9a-f-]{36}(?:\|([^)]*))?\)\)/gi, (_m, label: string | undefined) => (label ? JSON.stringify(label) : "that note"));

/**
 * Move note `id` as `actor` by `moveBlock`; `revision`: the note as it was read (one changed since is refused). A done move is
 * remembered for ctrl+z unless `undoable` is false (putting back isn't a move to put back).
 */
export async function moveNote(board: WriteBoard, id: string, intent: MoveIntent, actor: Actor, opts: { revision?: number; undoable?: boolean } = {}): Promise<MoveDone> {
  const input = { ref: id, ...(await inputOf(board, intent)), ...(opts.revision !== undefined ? { revision: opts.revision } : {}) };
  const r = await moveWithRules(board, input, { actorId: recordedActorId(actor), author: actor.kind });
  const parent = r.parentId ?? null;
  if (r.outcome === "unchanged") return { moved: id, parent, position: r.position, previousParent: parent, unchanged: true, said: plainly(r.said) };
  const before = { parent: r.previousParentId ?? null, position: r.previousPosition };
  if (opts.undoable !== false && before.position >= 0) MOVE_UNDO.push({ by: partyOf(actor), context: id, id, ...before });
  return { moved: id, parent, position: r.position, previousParent: before.parent, said: plainly(r.said) };
}

/** Put back the move `by` last made of the note `context`: where it was. Refuses with nothing to undo. */
export async function undoMove(board: WriteBoard, by: Actor, context: string): Promise<MoveDone> {
  const e = MOVE_UNDO.last(partyOf(by), context);
  if (!e) throw new ActionRefused("no move of this note to undo");
  MOVE_UNDO.drop(e);
  const done = await moveNote(board, e.id, e.parent === null ? { to: "root", position: e.position + 1 } : { to: e.parent, position: e.position + 1 }, by, { undoable: false });
  return { ...done, said: `put the note back${done.unchanged ? " (it was already there)" : ""}` };
}

/**
 * The question the power bar asks for "Move to…": a note (the outline's one search, nearer notes first), with the note's
 * parents and the notes changed lately offered before anything is typed (the bar's `ask` scope reads `parentsOf`).
 */
export const moveQuestion = (id: string): BarQuestion => ({
  name: "to", type: "note", label: "move to", parentsOf: id,
  description: "It goes first under the note you pick: its parents and the notes changed lately first, then the Inbox, or type to find any note.",
  choices: ["inbox", "root"], says: { inbox: "the Inbox", root: "the top level" }, found: "under this note",
});
