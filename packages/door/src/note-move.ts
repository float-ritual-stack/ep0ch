// Actions share the service's atomic move; the door keeps its receipt for local undo.
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

export interface MoveDone { moved: string; parent: string | null; position: number; previousParent: string | null; revision: number; unchanged?: true; said: string }

/** A move made, to put back: where the note was. */
interface MoveUndo { by: string; context: string; block: string; parent: string | null; position: number; previousRevision: number; at: { revision: number } }
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
function inputOf(intent: MoveIntent) {
  if ("step" in intent || "before" in intent || "after" in intent) return intent;
  return { parent: intent.to, position: intent.position === undefined ? 0 : intent.position - 1 };
}

/** moveBlock's words name notes as ((id|title)); said to a person they read as the title (a bare ((id)) as "that note"). */
const plainly = (said: string) => said.replace(/\(\([0-9a-f-]{36}(?:\|([^)]*))?\)\)/gi, (_m, label: string | undefined) => (label ? JSON.stringify(label) : "that note"));

/**
 * Move note `id` as `actor` by `moveBlock`; `revision`: the note as it was read (one changed since is refused). A done move is
 * remembered for ctrl+z unless `undoable` is false (putting back isn't a move to put back).
 */
export async function moveNote(board: WriteBoard, id: string, intent: MoveIntent, actor: Actor, opts: { revision?: number; undoable?: boolean } = {}): Promise<MoveDone> {
  const revision = opts.revision ?? (await board.get(id))!.revision!;
  const input = { ref: id, ...inputOf(intent), revision };
  const r = await moveWithRules(board, input, { actorId: recordedActorId(actor), author: actor.kind });
  const parent = r.parentId ?? null;
  if (r.outcome === "unchanged") return { moved: id, parent, position: r.position, revision: r.revision, previousParent: parent, unchanged: true, said: plainly(r.said) };
  const before = { parent: r.previousParentId ?? null, position: r.previousPosition };
  if (opts.undoable !== false && before.position >= 0) MOVE_UNDO.push({ by: partyOf(actor), context: id, block: id, previousRevision: revision, at: { revision: r.revision }, ...before });
  return { moved: id, parent, position: r.position, revision: r.revision, previousParent: before.parent, said: plainly(r.said) };
}

/** Put back the move `by` last made of the note `context`: where it was. Refuses with nothing to undo. */
export async function undoMove(board: WriteBoard, by: Actor, context: string): Promise<MoveDone> {
  const e = MOVE_UNDO.last(partyOf(by), context);
  if (!e) throw new ActionRefused("no move of this note to undo");
  const done = await moveNote(board, e.block, e.parent === null ? { to: "root", position: e.position + 1 } : { to: e.parent, position: e.position + 1 }, by, { revision: e.at.revision, undoable: false });
  if (!done.unchanged) {
    MOVE_UNDO.drop(e);
    // Undo restored the place an earlier receipt observed, at the revision just returned.
    MOVE_UNDO.advance(e.block, e.previousRevision, done.revision);
  }
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
