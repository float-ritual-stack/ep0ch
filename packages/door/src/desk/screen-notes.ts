// Screens a person made (PIE-565): each one a screen note in the outline, so it travels with the outline, every door
// on it opens it and an agent reads it. A screen note is an ordinary block (Detail and the outliner show it as one):
//
//     garden-work [type::screen] [screen::garden-work]
//     A screen made in the door … (what it is and how to open it)
//
//     ```json
//     { the spec as data: what `screen.spec` answers (specData), read back by readSpec }
//     ```
//
// Its name is its `screen::` property (a name a person chose: ADR 0001), its spec the JSON in its first ```json fence.
// The door reads every screen note as it starts and again when one changes, and registers each as a screen
// (`registerScreen` with `made`), so `screen.open`, `--screen <name>`, `screen.list`, the screen pickers and
// `layout.load` find it beside the built-ins. A name that is a built-in screen's, or that two notes share, isn't
// registered: the problem is said, with the notes' ids. Saving again writes the same note, checked against the
// revision this door read; trashing the note (or `screen.delete`) takes the screen away.
//
// The service needs nothing new for it: notes found by a property (`blocks.query`), written by `create` and `update`
// with their revision, put in Trash by `delete`.
import { subject, type Msg } from "../board";
import { EditConflict, type Actor, type SocketBoard } from "../socket";
import { ActionRefused } from "../surface/actions";
import { builtinScreen, forgetScreen, madeScreen, readSpec, registerScreen, screenNameProblem, screenNames, specData, type ScreenSpec } from "./screen-spec";

/** The property value that makes a block a screen note, and the one of the note they're kept under. */
export const SCREEN_TYPE = "screen";
const HOME_TYPE = "screens";

/** What the store needs from the outline: the door's board (a test's fake gives the same calls). */
export type ScreenStore = Pick<SocketBoard, "byProp" | "createBlock" | "update" | "trash">;

/** A screen note as read: the screen's name, its note and the revision read, and its spec. */
export interface ScreenNote { name: string; id: string; revision: number; spec: ScreenSpec }

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

/** A screen's note text: its name as the title, its properties, a line on what it is, and its spec as data. */
export function screenNoteText(spec: ScreenSpec): string {
  const data = specData({ ...spec, title: spec.name });
  return [
    `${spec.name} [type::${SCREEN_TYPE}] [${SCREEN_TYPE}::${spec.name}]`,
    `A screen made in the door: \`ep0ch --screen ${spec.name}\` opens it, and ^W w on it saves it again. Its layout is the data below, as \`screen.spec\` answers it. Trash this note to take the screen away.`,
    "",
    "```json",
    JSON.stringify(data, null, 2),
    "```",
  ].join("\n");
}

/**
 * The spec in a screen note's first ```json fence, named by its `screen::` property: what the door registers, or
 * what's wrong with it. It reads only what `screenNoteText` writes (a fence opened by exactly ```json and closed by
 * ```), so the JSON's own lines are never taken for anything else.
 */
export function readScreenNote(m: Msg): ScreenNote | { problem: string; name: string; id: string } {
  const name = (m.props[SCREEN_TYPE] ?? "").trim() || subject(m);
  const where = `the screen note ((${m.id}))`;
  const wrong = (problem: string) => ({ problem, name, id: m.id });
  const bad = screenNameProblem(name);
  if (bad) return wrong(`${where}: ${bad} · set its [${SCREEN_TYPE}::…]`);
  const lines = m.text.split("\n");
  const open = lines.findIndex(l => /^```json\s*$/.test(l));
  const close = open < 0 ? -1 : lines.findIndex((l, i) => i > open && /^```\s*$/.test(l));
  if (open < 0 || close < 0) return wrong(`${where} (${name}) has no \`\`\`json fence holding its layout · save the screen again from the door (^W w) to write one`);
  let data: unknown;
  try { data = JSON.parse(lines.slice(open + 1, close).join("\n")); } catch (e) { return wrong(`${where} (${name}): its layout isn't JSON (${(e as Error).message})`); }
  try {
    // Its name is the note's: renaming the property renames the screen. Its title is its name.
    const spec = readSpec({ ...(data && typeof data === "object" ? data : {}), name, title: name });
    return { name, id: m.id, revision: m.revision ?? 0, spec };
  } catch (e) { return wrong(`${where}: ${(e as Error).message}`); }
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
  registerScreen(n.name, () => readSpec(specData(n.spec)), { made: { id: n.id, revision: n.revision } });
}
/** One screen note taken out. */
function unregister(name: string) { writes++; forgetScreen(name); notes.delete(name); }

/**
 * Read every screen note and register each (the door's start, a screen note changed, a reconnect): what came and
 * went since the last read, and what's wrong. A read that fails keeps what was registered and throws.
 */
export async function loadScreenNotes(board: Pick<ScreenStore, "byProp">): Promise<{ added: string[]; removed: string[]; changed: string[]; problems: string[]; stale?: true }> {
  const at = writes;
  const found = await board.byProp("type", SCREEN_TYPE, 500);
  // A save or delete landed while this read was out: what it read is older than what's registered.
  if (writes !== at) return { added: [], removed: [], changed: [], problems: [...problems], stale: true };
  const read = found.map(readScreenNote);
  const wrong: string[] = read.flatMap(r => ("problem" in r ? [r.problem] : []));
  // Every note by the name it gives, read well or not: a name two notes give opens neither, whatever else is wrong.
  const byName = new Map<string, (ScreenNote | { problem: string; name: string; id: string })[]>();
  for (const r of read) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const next = new Map<string, ScreenNote>();
  for (const [name, same] of byName) {
    const ids = same.map(n => `((${n.id}))`).join(", ");
    if (builtinScreen(name)) wrong.push(`a screen note is named ${name}, a built-in screen's name: it isn't opened · rename it ([${SCREEN_TYPE}::…] in ${ids})`);
    else if (same.length > 1) wrong.push(`${same.length} screen notes are named ${name}: none is opened by that name · rename all but one (${ids})`);
    else if (!("problem" in same[0]!)) next.set(name, same[0]!);
  }
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
 * Whether a change may concern the screen notes: any block made, edited, trashed, brought back or purged (an edit can
 * make a note a screen note, fix one, or rename it). The door reads them again once a burst of changes settles.
 */
export const screenNotesAffected = (c: { kind: string }): boolean => ["create", "edit", "delete", "restore", "purge"].includes(c.kind);

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
  const bad = screenNameProblem(spec.name);
  if (bad) throw new ActionRefused(bad);
  if (builtinScreen(spec.name)) throw new ActionRefused(`${spec.name} is a built-in screen: a screen you make takes a name of its own (the built-ins: ${screenNames().filter(builtinScreen).join(", ")})`);
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
