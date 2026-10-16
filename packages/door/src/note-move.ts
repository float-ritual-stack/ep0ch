// Moving a note to a new parent or a new place among its siblings (PIE-943): the one step `note.move` (the reader,
// the menu, the power bar's "Move to…", `act`) and the outline tree's keys and drags (`tree.move`) both run. The
// service's `move` does the write; this decides where, checks the note is still the one that was read, remembers how
// to put it back (ctrl+z), and says it in words. An agent's goes by the outliner's own `moveBlock` (outline_move's
// rules, whatever PIE-942 makes them), the person's as a drag in the Tree would.
import type { Msg } from "./board";
import { recordedActorId, type Actor, type SocketBoard } from "./socket";
import { ActionRefused } from "./surface/actions";
import { UndoHistory, partyOf } from "./steps";
import { moveAsAgent, resolveBoardRef, type WriteBoard } from "./mcp-writes";
import type { BarQuestion } from "./bar/ask";
import { subject } from "./board";

/** Where a note goes: under `parent` (an id; null: the top level) at `position` (default first), or beside a sibling. One of the three. */
export type Place = { parent: string | null; position?: number } | { before: string } | { after: string };

/** A move made, to put back: where the note was. */
interface MoveUndo { by: string; context: string; id: string; title: string; parent: string | null; position: number }
/** The moves made here, for ctrl+z (`context`: the moved note's id, what the reader or tree shows). */
export const MOVE_UNDO = new UndoHistory<MoveUndo>();

export interface MoveDone { moved: string; parent: string | null; position: number; previousParent: string | null; unchanged?: true; said: string }

const label = (m: Msg) => JSON.stringify(subject(m).slice(0, 40));

/** The children of `parent` (null: the top level) in order, `except` left out. */
async function siblingsOf(board: SocketBoard, parent: string | null, except?: string): Promise<Msg[]> {
  return (parent === null ? await board.roots() : await board.children(parent)).filter(m => m.id !== except);
}

/**
 * Move note `id` to `place` as `actor`. `revision`: the note as the person saw it; one changed since is refused and stays.
 * Refused, with what to do instead: no such note, a place beneath itself, a stale revision. Says what changed; a note
 * already there answers `unchanged`.
 */
export async function moveNote(board: WriteBoard, id: string, place: Place, actor: Actor, opts: { revision?: number; undoable?: boolean } = {}): Promise<MoveDone> {
  const { revision } = opts;
  const m = await board.get(id);
  if (!m) throw new ActionRefused(`no note ${id.slice(0, 8)} to move`);
  if (revision !== undefined && m.revision !== undefined && revision !== m.revision) {
    throw new ActionRefused(`${label(m)} changed since you read it (revision ${m.revision} now, you have ${revision}): read it again, and move it only if it's still the note you mean`);
  }
  const oldParent = m.parentId ?? null;
  const before = await siblingsOf(board, oldParent);
  const oldPosition = before.findIndex(x => x.id === id);
  if (actor.kind === "agent") {
    const a = "parent" in place ? { parent: place.parent === null ? "root" : place.parent, ...(place.position !== undefined ? { position: place.position } : {}) } : place;
    const r = await moveAsAgent(board, id, a, { actorId: recordedActorId(actor) }) as { outcome: string; said: string; parentId?: string | null; position?: number };
    return { moved: id, parent: r.parentId ?? null, position: r.position ?? 0, previousParent: oldParent, ...(r.outcome === "unchanged" ? { unchanged: true as const } : {}), said: r.said };
  }
  let parent: string | null, position: number;
  if ("parent" in place) {
    parent = place.parent;
    if (parent === id) throw new ActionRefused("a note can't go under itself");
    position = place.position ?? 0;
  } else {
    const beside = "before" in place ? place.before : place.after;
    if (beside === id) throw new ActionRefused("a note can't go beside itself: name a sibling");
    const b = await board.get(beside);
    if (!b) throw new ActionRefused(`no note ${beside.slice(0, 8)} to go beside`);
    parent = b.parentId ?? null;
    const sibs = await siblingsOf(board, parent, id);
    position = sibs.findIndex(x => x.id === beside) + ("after" in place ? 1 : 0);
  }
  const target = await siblingsOf(board, parent, id);
  position = Math.max(0, Math.min(position, target.length));
  const where = parent === null ? "at the top level" : `under ${label((await board.get(parent)) ?? m)}`;
  if (parent === oldParent && position === oldPosition) return { moved: id, parent, position, previousParent: oldParent, unchanged: true, said: `${label(m)} is already ${where} at ${position + 1}` };
  try { await board.move(id, parent, actor, position); } catch (e) {
    if (e instanceof Error && /beneath itself/.test(e.message)) throw new ActionRefused(`${label(m)} can't go inside itself: pick a place outside it`);
    throw e;
  }
  if (oldPosition >= 0 && opts.undoable !== false) MOVE_UNDO.push({ by: partyOf(actor), context: id, id, title: subject(m), parent: oldParent, position: oldPosition });
  return { moved: id, parent, position, previousParent: oldParent, said: `moved ${label(m)} ${where} at ${position + 1}` };
}

/** Put back the move `by` last made of the note `context`: where it was. Says what moved, or refuses with nothing to undo. */
export async function undoMove(board: WriteBoard, by: Actor, context: string): Promise<MoveDone> {
  const e = MOVE_UNDO.last(partyOf(by), context);
  if (!e) throw new ActionRefused("no move of this note to undo");
  MOVE_UNDO.drop(e);
  // The old parent may be gone since: the move says so, and the entry stays dropped (a second ctrl+z isn't the same failure).
  // Putting back isn't a move to put back again.
  const done = await moveNote(board, e.id, { parent: e.parent, position: e.position }, by, { undoable: false });
  return { ...done, said: `put ${JSON.stringify(e.title.slice(0, 40))} back${done.unchanged ? " (it was already there)" : ""}` };
}

/** How a row moves in its list: one place up or down among its siblings, in under the sibling above, out after its parent. */
export type Step = "up" | "down" | "in" | "out";

/**
 * The place a step takes note `id` to, or why it can't (a refusal that says which edge it's at). Indent puts it last under the
 * sibling above, outdent right after its parent: the keys of an outline, over the same `moveNote`.
 */
export async function stepPlace(board: SocketBoard, id: string, step: Step): Promise<Place> {
  const m = await board.get(id);
  if (!m) throw new ActionRefused(`no note ${id.slice(0, 8)} to move`);
  const parent = m.parentId ?? null;
  const sibs = await siblingsOf(board, parent);
  const i = sibs.findIndex(x => x.id === id);
  if (step === "up") {
    if (i <= 0) throw new ActionRefused(`${label(m)} is already first${parent === null ? " at the top level" : " under its parent"}`);
    return { before: sibs[i - 1]!.id };
  }
  if (step === "down") {
    if (i < 0 || i >= sibs.length - 1) throw new ActionRefused(`${label(m)} is already last${parent === null ? " at the top level" : " under its parent"}`);
    return { after: sibs[i + 1]!.id };
  }
  if (step === "in") {
    if (i <= 0) throw new ActionRefused(`${label(m)} has no note above it to go in under`);
    const up = sibs[i - 1]!;
    return { parent: up.id, position: (await board.children(up.id)).length };
  }
  if (parent === null) throw new ActionRefused(`${label(m)} is at the top level: there is no outer level to go out to`);
  return { after: parent };
}

// ── one request: the arguments `note.move` and `tree.move` share ────────────────

export interface MoveArgs {
  /** The note to move (default: the one in front). */
  id?: string;
  /** Under this note: an id, ((ref)), [[page]], Work ID, `inbox` or `root` (the top level). */
  to?: string;
  before?: string;
  after?: string;
  /** With `to`: its place among the children, from 1 (default first). */
  position?: number;
  step?: string;
  revision?: number;
}

/** The notes moved to lately, newest first: the picker offers them before any search (this door's, for this sitting). */
const RECENT_PARENTS: string[] = [];
const RECENT_MAX = 6;
function remember(parent: string | null) {
  if (parent === null) return;
  const i = RECENT_PARENTS.indexOf(parent);
  if (i >= 0) RECENT_PARENTS.splice(i, 1);
  RECENT_PARENTS.unshift(parent);
  RECENT_PARENTS.length = Math.min(RECENT_PARENTS.length, RECENT_MAX);
}

/** A note a ref names (its id, ((id)), [[page]], Work ID), or a refusal that says what to give instead. */
async function refId(board: WriteBoard, ref: string, role: string): Promise<string> {
  try { return (await resolveBoardRef(board, ref)).id; } catch (e) {
    throw new ActionRefused(`no note ${ref} to go ${role}: ${role === "under" ? "to=" : role + "="} takes an id, ((ref)), [[page]] or Work ID${e instanceof Error && e.message ? ` (${e.message.slice(0, 120)})` : ""}`);
  }
}

/** The place the arguments name: exactly one of to, before, after and step. */
export async function placeOf(board: WriteBoard, id: string, a: MoveArgs): Promise<Place> {
  const given = (["to", "before", "after", "step"] as const).filter(k => a[k] !== undefined);
  if (given.length !== 1) throw new ActionRefused("say where: to=<inbox, root, or a note's id, ((ref)), [[page]], Work ID>, before=<a sibling>, after=<a sibling> or step=up|down|in|out (one of them)");
  if (a.position !== undefined && given[0] !== "to") throw new ActionRefused("position goes with to= (before= and after= are the place already)");
  if (a.position !== undefined && (!Number.isInteger(a.position) || a.position < 1)) throw new ActionRefused("position counts from 1");
  if (a.step !== undefined) {
    if (!["up", "down", "in", "out"].includes(a.step)) throw new ActionRefused("step is up, down, in (under the note above) or out (after its parent)");
    return stepPlace(board, id, a.step as Step);
  }
  if (a.before !== undefined) return { before: await refId(board, a.before, "before") };
  if (a.after !== undefined) return { after: await refId(board, a.after, "after") };
  const to = a.to!.trim();
  if (to === "root") return { parent: null, ...(a.position !== undefined ? { position: a.position - 1 } : {}) };
  const parent = to === "inbox" ? await board.inboxId().catch(() => null) : await refId(board, to, "under");
  if (!parent) throw new ActionRefused("this outline has no Inbox to put it in: to=<a note's id>");
  return { parent, ...(a.position !== undefined ? { position: a.position - 1 } : {}) };
}

/** `note.move` and `tree.move`'s step: the place named, the move made and the parent remembered for the picker. */
export async function moveBy(board: WriteBoard, id: string, a: MoveArgs, actor: Actor): Promise<MoveDone> {
  const done = await moveNote(board, id, await placeOf(board, id, a), actor, { revision: a.revision });
  if (!done.unchanged) remember(done.parent);
  return done;
}

/**
 * The question the power bar asks for "Move to…": the note's parents (nearest first), the notes moved to lately, the
 * Inbox and the top level as choices, any other note by the words typed (the bar's one search, nearer notes first).
 */
export async function moveQuestion(board: SocketBoard, id: string): Promise<BarQuestion> {
  const chain = await board.ancestors(id).catch(() => [] as Msg[]);
  const says: Record<string, string> = {};
  const choices: string[] = [];
  const add = (key: string, text: string) => { if (!choices.includes(key)) { choices.push(key); says[key] = text; } };
  [...chain].reverse().slice(0, 3).forEach((a, i) => add(a.id, `${i === 0 ? "its parent" : "above it"}: ${subject(a).slice(0, 50)}`));
  for (const rid of RECENT_PARENTS) {
    if (rid === id) continue;
    const m = await board.get(rid).catch(() => null);
    if (m) add(rid, `moved to lately: ${subject(m).slice(0, 50)}`);
  }
  add("inbox", "the Inbox");
  add("root", "the top level");
  return { name: "to", type: "note", label: "move to", description: "It goes first under the note you pick: its parents and the notes you moved to lately first, then the Inbox, or type to find any note.", choices, says, found: "under this note" };
}
