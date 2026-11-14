// Screens a person made (PIE-565): each one a screen note in the outline, so it travels with the outline, every door
// on it opens it and an agent reads it. A screen note is an ordinary block (Detail and the outliner show it as one):
//
//     Garden work [type::screen] [screen::garden-work]
//     A screen made in the door … (what it is and how to open it)
//
//     ```json
//     { the spec as data: what `screen.spec` answers (specData), read back by readSpec }
//     ```
//
// Its name is its `screen::` property (a name a person chose: ADR 0001: a slug), its title the note's own title as they
// typed it ("Garden work"; `screenSlug` makes the name of it). Its spec is in one of two bodies, the JSON in its first
// ```json fence (what this door writes) or the blocks under it (what `screens.save` writes): the service reads both
// (`screens.list`, outline-core's screen-note.ts) and this door reads no screen note's text itself.
// The door asks for the outline's screens as it starts and again when the answer moves, and registers each as a screen
// (`registerScreen` with `made`), so `screen.open`, `--screen <name>`, `screen.list`, the screen pickers and
// `layout.load` find it beside the built-ins. A name that is a built-in screen's, or that two notes share, isn't
// registered: the service says the problem, with the notes' ids. Saving again writes the same note, checked against the
// revision this door read; trashing the note (or `screen.delete`) takes the screen away.
//
// The door's own writes are ordinary ones: `create` and `update` with their revision, `delete` to the Trash.
import { readScreenNote as readNote } from "@ep0ch/outline-core/screen-note";
import type { Msg } from "../board";
import { EditConflict, type Actor, type SocketBoard } from "../socket";
import { ActionRefused } from "../surface/actions";
import { savedNodes } from "@ep0ch/outline-core/screen-spec";
import { nowPage } from "../hub/now";
import { resolveKind } from "./tile-kinds";
import { builtinScreen, extensionScreen, forgetScreen, madeScreen, readSpec, registerScreen, screenNameProblem, screenNames, screenSlug, screenTitleProblem, specData, type ScreenSpec } from "./screen-spec";

/** The property value that makes a block a screen note, and the one of the note they're kept under. */
export const SCREEN_TYPE = "screen";
const HOME_TYPE = "screens";

/** What the store needs from the outline: the door's board (a test's fake gives the same calls). */
export type ScreenStore = Pick<SocketBoard, "screens" | "byProp" | "createBlock" | "update" | "trash">;

/** A screen note as read: the screen's name, its note and the revision read, and its spec. */
export interface ScreenNote { name: string; title: string; id: string; revision: number; spec: ScreenSpec }

/** The screen notes registered now, by name. */
let notes = new Map<string, ScreenNote>();
/** What the last read found wrong (a built-in's name, two notes with one name, a spec that doesn't read). */
let problems: string[] = [];

/** Every screen a person made, by name. */
export const screenNotes = (): ScreenNote[] => [...notes.values()].sort((a, b) => a.name.localeCompare(b.name));
/** The screen note named `name`, if one is registered. */
export const screenNote = (name: string): ScreenNote | undefined => notes.get(name);
/** What the last read of the screen notes found wrong, in words. */
export const screenNoteProblems = (): readonly string[] => problems;

/** A screen's note text: its title (as typed), its properties, a line on what it is, and its spec as data. */
export function screenNoteText(spec: ScreenSpec): string {
  const title = spec.title && screenSlug(spec.title) === spec.name ? spec.title.trim() : spec.name;
  const data = specData({ ...spec, title });
  return [
    `${title} [type::${SCREEN_TYPE}] [${SCREEN_TYPE}::${spec.name}]`,
    `A screen made in the door: \`ep0ch --screen ${spec.name}\`${title === spec.name ? "" : ` (or \`--screen ${JSON.stringify(title)}\`)`} opens it, and ^W w on it saves it again. Its layout is the data below, as \`screen.spec\` answers it. Trash this note to take the screen away.`,
    "",
    "```json",
    JSON.stringify(data, null, 2),
    "```",
  ].join("\n");
}

/**
 * A screen note this door just wrote, read back: outline-core's reader (the one `screens.list` reads every note with),
 * given the note alone, so its JSON fence. What the door registers, or what's wrong with it.
 */
export function readScreenNote(m: Msg): ScreenNote | { problem: string; name: string; id: string } {
  const read = readNote({ id: m.id, text: m.text, revision: m.revision ?? 0 });
  return "problem" in read ? read : { name: read.name, title: read.title, id: read.id, revision: read.revision, spec: read.spec };
}

/**
 * Each write this door makes to the registry (a save, a delete) counts: a read of the screen notes that began before
 * one landed is out of date when it answers, and is dropped (`stale`) rather than rolling the write back.
 */
let writes = 0;
/** One screen note registered (taking the place of the one by that name it replaces): one read, or a test's fixture. */
export function register(n: ScreenNote) {
  writes++;
  forgetScreen(n.name);
  notes.set(n.name, n);
  registerScreen(n.name, () => ownKinds(readSpec(specData(n.spec))), { made: { id: n.id, revision: n.revision, title: n.title } });
}
/**
 * A served spec's new-note rules and its keys name kinds as the service resolved them (`screens.reader`, as it serves
 * a tile's): each as the door's own kind, by the registry's one lookup (`resolveKind`, as `canonSpec` reads a tile's),
 * so a rule and a key are asked with the kind a tile here carries (a key bound only in the reader fires in it).
 */
function ownKinds(spec: ScreenSpec): ScreenSpec {
  const own = <T extends { only?: string[]; unless?: string[] }>(over: T): T => ({ ...over, ...(over.only ? { only: over.only.map(resolveKind) } : {}), ...(over.unless ? { unless: over.unless.map(resolveKind) } : {}) });
  const scoped = (list?: readonly { only?: string[]; unless?: string[] }[]) => !!list?.some(over => over.only || over.unless);
  const kinds = !scoped(spec.newNote) && !scoped(spec.keys) ? spec : { ...spec, ...(spec.newNote ? { newNote: spec.newNote.map(own) } : {}), ...(spec.keys ? { keys: spec.keys.map(own) } : {}) };
  return pinnedToNow(kinds);
}
/**
 * A tile a screen note wrote `pinned` with no page is served as what it is now, a reader pinned (`screens.list`,
 * outline-core's `canonLeaf`), and the page it means is this door's own setting: a served reader pinned to neither a
 * note nor a page is pinned to the "now" page, as `canonSpec` reads the name where the door meets it itself.
 */
function pinnedToNow(spec: ScreenSpec): ScreenSpec {
  const bare = (leaf: { t?: string; kind?: unknown; mode?: unknown; note?: unknown; page?: unknown } | undefined) =>
    leaf?.t === "leaf" && typeof leaf.kind === "string" && resolveKind(leaf.kind) === "reader" && leaf.mode === "pinned" && !leaf.note && !leaf.page;
  const tiles = (layout: ScreenSpec["layout"]) => [...savedNodes(layout.root), ...(layout.floats ?? []).map(f => f.tile)];
  if (!tiles(spec.layout).some(bare)) return spec;
  const served = structuredClone(spec);
  for (const leaf of tiles(served.layout)) if (bare(leaf)) leaf.page = nowPage().address;
  return served;
}
/** One screen note taken out. */
function unregister(name: string) { writes++; forgetScreen(name); notes.delete(name); }

/**
 * Where the door's loadScreenNotes reads (PIE-1546): the watched question, so the service says when a screen note
 * changed and nothing else in the outline reads them again (only a reconnect does).
 */
export const watchedScreens = (board: SocketBoard): Pick<ScreenStore, "screens"> => !board.watched ? board : { screens: reserved => board.screensWatched(reserved) };

/** The names this door keeps for itself: a screen note by one of them opens nothing, and the service says so. */
export const reservedScreens = (): string[] => screenNames().filter(builtinScreen);

/**
 * Ask the service for the outline's screen notes and register each (the door's start, the answer moved, a reconnect):
 * what came and went since the last read, and what's wrong, in the service's words. A read that fails keeps what was
 * registered and throws.
 */
export async function loadScreenNotes(board: Pick<ScreenStore, "screens">): Promise<{ added: string[]; removed: string[]; changed: string[]; problems: string[]; stale?: true }> {
  const at = writes;
  const listed = await board.screens(reservedScreens());
  // A save or delete landed while this read was out: what it read is older than what's registered.
  if (writes !== at) return { added: [], removed: [], changed: [], problems: [...problems], stale: true };
  const made = listed.screens.filter(row => row.from === "note" && row.note);
  // A note that doesn't read says why on its own row; a name two notes give, or one that isn't theirs to take, is the list's to say.
  const wrong: string[] = [...made.filter(row => !row.spec).flatMap(row => row.problems.map(p => p.said).filter(said => !listed.problems.includes(said))), ...listed.problems];
  const next = new Map<string, ScreenNote>();
  for (const row of made) if (row.spec) next.set(row.name, { name: row.name, title: row.title, id: row.note!.id, revision: row.note!.revision, spec: row.spec });
  const was = notes;
  const added = [...next.keys()].filter(n => !was.has(n));
  const removed = [...was.keys()].filter(n => !next.has(n));
  const changed = [...next.keys()].filter(n => was.has(n) && was.get(n)!.revision !== next.get(n)!.revision);
  for (const name of removed) unregister(name);
  for (const n of next.values()) if (!was.has(n.name) || was.get(n.name)!.revision !== n.revision || was.get(n.name)!.id !== n.id) register(n);
  problems = wrong;
  return { added, removed, changed, problems: wrong };
}

/**
 * Save `spec` as the screen note named `spec.name`: the note it already has, at the revision this door read (a note
 * changed since is refused, read again, and the next save writes over the new one), else a new note under the
 * Screens note (made at the top of the outline the first time). A built-in screen's name is refused.
 */
/** A save refused because the note changed since it was read: `now` is the note as it is, which the next save writes over. */
export class ScreenConflict extends ActionRefused { constructor(msg: string, readonly now: { id: string; revision: number } | null) { super(msg); } }

/**
 * `base`: the note and revision the screen being saved was opened from (or last saved as), when it was; the save is
 * checked against that, so a newer save another door made (and this door has since read) is never written over unseen.
 */
export async function saveScreenNote(board: ScreenStore, spec: ScreenSpec, actor: Actor, base?: { id: string; revision: number } | null): Promise<{ note: ScreenNote; created: boolean }> {
  const bad = screenNameProblem(spec.name) ?? (screenSlug(spec.title) === spec.name ? screenTitleProblem(spec.title) : null);
  if (bad) throw new ActionRefused(bad);
  if (builtinScreen(spec.name)) throw new ActionRefused(`${spec.name} is a built-in screen: a screen you make takes a name of its own (the built-ins: ${screenNames().filter(builtinScreen).join(", ")}) · try ${JSON.stringify(`${spec.title} 2`)}`);
  if (extensionScreen(spec.name)) throw new ActionRefused(`${spec.name} is the ${extensionScreen(spec.name)} extension's screen: a screen you make takes a name of its own · try ${JSON.stringify(`${spec.title} 2`)}`);
  const clash = problems.find(p => p.includes(` are named ${spec.name}:`));
  if (clash) throw new ActionRefused(clash);
  const text = screenNoteText(spec);
  const had = madeScreen(spec.name);
  let m: Msg;
  if (had) {
    const expected = base && base.id === had.id ? base.revision : had.revision;
    try { m = await board.update(had.id, text, expected, actor); }
    catch (e) {
      if (e instanceof EditConflict) {
        await loadScreenNotes(board).catch(() => {});
        throw new ScreenConflict(`the screen note ${spec.name} changed since this screen was read (another door or an agent saved it): nothing was written · ^W r and ${spec.name} lays it out as it is now, or save again to write over it ((${had.id}))`, madeScreen(spec.name) ?? null);
      }
      throw new ActionRefused(`couldn't save the screen note ${spec.name}: ${(e as Error).message}`);
    }
  } else {
    const home = (await board.byProp("type", HOME_TYPE, 5))[0] ?? await board.createBlock(null, `Screens [type::${HOME_TYPE}]\nThe screens made in the door, one note each: \`ep0ch --screen <name>\` opens one, and the door's ^W r lists them.`, actor);
    m = await board.createBlock(home.id, text, actor);
  }
  const read = readScreenNote(m);
  if ("problem" in read) throw new ActionRefused(read.problem);
  register(read);
  return { note: read, created: !had };
}

/** Put the screen note named `name` in Trash (at the revision this door read), and take the screen away. */
export async function trashScreenNote(board: ScreenStore, name: string, actor: Actor): Promise<ScreenNote> {
  const n = notes.get(name);
  if (!n) throw new ActionRefused(builtinScreen(name) ? `${name} is a built-in screen: it can't be deleted` : `no screen note named ${name} · screen.list names the screens you made`);
  try { await board.trash(n.id, actor, { revision: n.revision }); }
  catch (e) {
    await loadScreenNotes(board).catch(() => {});
    throw new ActionRefused(`the screen note ${name} wasn't trashed: ${(e as Error).message} · screen.list, then try again`);
  }
  unregister(name);
  return n;
}

/** Forget every screen note (a test, or a door moving to another outline). */
export function forgetScreenNotes(): void { for (const name of [...notes.keys()]) unregister(name); problems = []; }
