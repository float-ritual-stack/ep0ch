// Trashing a note from wherever it is seen (PIE-878): `note.trash` and `note.untrash`, the tile actions
// (src/desk/tile-actions.ts) over this one service-facing part. The board's `card.trash` (src/desk/lanes.ts) goes
// through `trashAtRevision` here too, so the checks that matter (the note as it was read, a lost answer) live once.
// The service moves a note and its subtree to Trash and keeps it there; what the door adds is what it will not do:
// a system note (Inbox, Trash, Bookmarks) or the workspace root, a note already in the Trash, a note someone has a draft open on.
import { ellipsize } from "./style";
import { centred, ListPicker, pickRow } from "./surface/picker";
import { ch, type Key } from "./term";
import { subject, type Msg } from "./board";
import { openDraftOf } from "./draft-session";
import { changedSinceRead, Refused, type Actor, type SocketBoard } from "./socket";
import { ActionRefused } from "./surface/actions";
import { partyOf } from "./steps";
import type { PageRename } from "@ep0ch/outline-core/protocol";

/** How long the person's first press (the confirmation) stands. */
export const TRASH_ARM_MS = 5000;

/** A note trashed, as `note.untrash` finds it again: who trashed it, and what went with it. */
export interface TrashedNote { id: string; title: string; notesUnder: number; by: string; at: number }

const trashed = new WeakMap<object, TrashedNote[]>();

/** The note `actor` trashed last on this board that is still in the Trash, newest first with `all`. */
export function lastTrashed(board: object, actor: Actor): TrashedNote | null {
  return (trashed.get(board) ?? []).findLast(t => t.by === partyOf(actor)) ?? null;
}

const noteTitle = (m: Msg, n = 50) => ellipsize(subject(m), n);

/**
 * Why this note won't be trashed from here, or null. A system note is the service's own (`[system-view::…]`: the
 * Inbox, Trash, Bookmarks); a note in the Trash is there already; a draft open on it is somebody's words.
 */
export function trashProblem(board: object, m: Msg): string | null {
  if (m.props.type === "workspace") return `“${noteTitle(m)}” is the outline's own root; everything sits under it`;
  if (m.props["system-view"]) return `“${noteTitle(m)}” is one of the outline's own (${m.props["system-view"]}); it stays`;
  if (m.deleted) return `“${noteTitle(m)}” is in the Trash already`;
  const draft = openDraftOf(board, m.id);
  if (draft) return `“${noteTitle(m)}” has a draft open${draft.dirty ? " with unsaved words" : ""}; save or close it first`;
  return null;
}

/** What trashing the note named `ref` would take: the note as the service has it now, with how many notes sit under it. */
export async function trashPlan(board: SocketBoard, ref: string): Promise<{ note: Msg; notesUnder: number }> {
  const note = await board.get(ref);
  if (!note) throw new ActionRefused("that note isn't in the outline (any more)");
  const why = trashProblem(board, note);
  if (why) throw new ActionRefused(`not trashed: ${why}`);
  return { note, notesUnder: note.childIds.length };
}

/**
 * Move the note at the revision it was read to the Trash. A save by another client since is refused and the note stays;
 * an answer lost on the way is looked up before it is called either way. `lost`: what to add to what is said.
 */
export async function trashAtRevision(board: SocketBoard, id: string, revision: number | undefined, actor: Actor | undefined, what = "note"): Promise<{ lost: string }> {
  try {
    await board.trash(id, actor, revision !== undefined ? { revision } : undefined);
    return { lost: "" };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (changedSinceRead(e)) throw new ActionRefused(`the ${what} changed just now (another client saved it) · look again before trashing`);
    if (e instanceof Refused) throw new ActionRefused(why);
    // The answer was lost, not refused: it may be in Trash anyway. Look before saying either.
    const gone = await board.isTrashed(id);
    if (gone === false) throw new ActionRefused(`${why}; the ${what} is still there`);
    if (gone === null) throw new ActionRefused(`${why}, and the outline didn't say whether the ${what} is in Trash; look before trying again`);
    return { lost: ` (the outline's answer was lost: ${why}; it is in Trash)` };
  }
}

export interface TrashDone { trashed: string; title: string; notesUnder: number; restore: string; recordedAs: string }

/** `note.trash` confirmed: the note and the notes under it to Trash, recorded as `actor`'s; `note.untrash` brings it back. */
export async function trashNote(board: SocketBoard, ref: string, actor: Actor, say: (msg: string) => void): Promise<TrashDone> {
  const { note } = await trashPlan(board, ref);
  const { lost } = await trashAtRevision(board, note.id, note.revision, actor);
  const title = noteTitle(note), notesUnder = note.childIds.length;
  const log = trashed.get(board) ?? [];
  log.push({ id: note.id, title, notesUnder, by: partyOf(actor), at: Date.now() });
  if (log.length > 50) log.shift();
  trashed.set(board, log);
  say(`trashed “${title}”${notesUnder ? ` and the ${notesUnder} note${notesUnder === 1 ? "" : "s"} under it` : ""} · ctrl+z brings it back${lost}`);
  return { trashed: note.id, title, notesUnder, restore: `note.untrash id=${note.id}`, recordedAs: actor.kind === "agent" ? `agent ${actor.id}` : "the person" };
}

export interface UntrashDone { restored: string; title: string; renamedPages?: PageRename[] }

/** Bring back the note `id` (else the one `actor` trashed last), where it was. */
export async function untrashNote(board: SocketBoard, id: string | undefined, actor: Actor, say: (msg: string) => void, renamed: (r: PageRename[]) => string): Promise<UntrashDone> {
  const last = id === undefined ? lastTrashed(board, actor) : null;
  const target = id ?? last?.id;
  if (!target) throw new ActionRefused("nothing was trashed here by you; pass id=<the note's block id> to bring back another");
  let m: Awaited<ReturnType<SocketBoard["restore"]>>;
  try { m = await board.restore(target); }
  catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); }
  const log = trashed.get(board);
  if (log) trashed.set(board, log.filter(t => t.id !== m.id));
  const title = noteTitle(m);
  say(`brought back “${title}”${m.renamedPages?.length ? ` · ${renamed(m.renamedPages)}` : ""}`);
  return { restored: m.id, title, ...(m.renamedPages?.length ? { renamedPages: m.renamedPages } : {}) };
}

/**
 * The person's first press (a key, a menu row, a click): what would go, as a two-row choice: `d` again (or Delete, ⏎,
 * a click on the first row) trashes it, anything else keeps it. The key and the mouse are the same two steps the board's
 * `d d` is; `trash` is what a yes runs (the confirmed `note.trash`).
 */
export function trashConfirm<H>(o: { title: string; notesUnder: number; trash: (h: H) => void }): ListPicker<string, H> {
  const rows = [`trash it${o.notesUnder ? ` and the ${o.notesUnder} note${o.notesUnder === 1 ? "" : "s"} under it` : ""}`, "keep it"];
  const yes = (k: Key) => ch(k) === "d" || k.kind === "delete";
  const p: ListPicker<string, H> = new ListPicker<string, H>({
    name: "trash", items: () => rows, clickChooses: true,
    row: (r, _i, on, w) => [pickRow(` ${r}`, on, w)],
    choose: (_r, i, h) => { if (i === 0) o.trash(h); },
    keys: (k, h) => { if (!yes(k)) return false; p.close(h, "letter"); o.trash(h); return true; },
    frame: a => ({ rect: centred(a, Math.min(a.cols, Math.max(40, ellipsize(o.title, 40).length + 10, rows[0]!.length + 4)), 5), title: `trash “${ellipsize(o.title, 40)}”?`, foot: "d again or ⏎ trashes · esc keeps" }),
  });
  return p;
}
