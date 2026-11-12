/*
 * The screens an outline has, listed and saved by the service (packages/native/docs/DESIGN.md §2, §3).
 *
 * - `screens.list` (watched): every `[type::screen]` note, read from whichever body it has (outline-core's
 *   screen-note.ts: the door's JSON fence or the block form), and every screen an extension served here ships. Each is
 *   one row: its validated `ScreenSpec`, and `problems[]` saying what is wrong, for its tile where it is one tile's.
 *   Names are settled here: a name two notes give, one an extension's screen has or one the asker reserves (its own
 *   built-ins) opens nothing, and says so. A tile kind is settled here too: the kinds the asker draws (`kinds`), the
 *   kinds extensions serve, and each kind a served one replaces.
 * - `screens.save`: a spec written as a screen note in the block form, under the Screens note: the note it already
 *   has (checked against the revision the asker read), else a new one. Saved over, the note keeps its blocks: only a
 *   block that reads differently is written, so a save trashes nothing but a tile that is gone.
 *
 * The service asks itself (`own`) for every read and write, so a screen note is written, attributed and broadcast
 * like any other note. One reader, one writer: no client reads a screen note's text.
 */
import { addressProblems, readScreenNote, screenNoteBlocks, screenNoteName, SCREEN_TYPE, type NoteBlock, type WrittenBlock } from "@ep0ch/outline-core/screen-note";
import { canonKind, canonLeaf, readSpec, savedNodes, screenNameProblem, screenSlug, type ScreenSpec } from "@ep0ch/outline-core/screen-spec";
import { Refusal } from "@ep0ch/outline-core/refusal";
import type { MutationProvenance } from "./types";

/** What a client asks about screens. Declared here, beside the handlers: types.ts names it once in the request union. */
export type ScreensRequest =
  | {
    id: string; action: "screens.list"; watch?: string; generation?: number;
    /** The tile kinds the asker draws itself. Left out: kinds aren't checked. */
    kinds?: string[];
    /** Screen names the asker keeps for itself (its built-ins): a note by one of them opens nothing. */
    reserved?: string[];
    /** The drawers the asker has (`list`, `page`): a kind an extension serves for a drawer it hasn't is said on the tile. Left out: every served kind counts as drawn. */
    drawers?: string[];
  }
  | { id: string; action: "screens.save"; spec: unknown; base?: { id: string; revision: number } | null; mutation?: MutationProvenance };

/** One thing wrong with a screen, in words: about one tile when it names it, else about the whole screen. */
export interface ScreenProblem { tile?: string; said: string }

export interface ScreenRow {
  name: string;
  title: string;
  /** Where it comes from: a note a person made, or an extension served here. */
  from: "note" | "extension";
  /** Its note, the revision read and the body it was read from. */
  note?: { id: string; revision: number; form: "json" | "blocks" };
  extension?: string;
  /** Its spec, when it reads as one. A row with no spec opens nothing: its problems say why. */
  spec?: ScreenSpec;
  problems: ScreenProblem[];
}

export interface ScreensList {
  screens: ScreenRow[];
  /** What is wrong that no one row holds: two notes with one name, a note named as an extension's screen is. */
  problems: string[];
  /** A watched answer hears every change: a screen note's children carry none of its properties. */
  anyChange: true;
}

export interface ScreenSaved { name: string; title: string; id: string; revision: number; created: boolean }

type Own = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
type Read = { id: string; text: string; revision: number };
type ExtensionsListed = {
  extensions?: readonly { id: string; screens?: readonly ({ name: string } & Record<string, unknown>)[] }[];
  tileKinds?: readonly { kind: string; replaces?: readonly string[]; drawer?: string }[];
};

const HOME_TYPE = "screens";

/** The notes that carry a property, newest first. */
async function byProp(own: Own, key: string, value: string, limit: number): Promise<Read[]> {
  return (await own.request<{ blocks: Read[] }>({ action: "blocks.query", query: { limit, filters: [{ key, value }], sort: { field: "updated", direction: "desc" } } })).blocks;
}

/** A note with every block under it, as the reader takes one. */
async function subtree(own: Own, block: Read, depth = 0): Promise<NoteBlock> {
  // A layout nests a handful of levels; one nested deeper than this is no layout.
  if (depth > 12) return { id: block.id, text: block.text, revision: block.revision, children: [] };
  const blocks = await own.request<Read[]>({ action: "children", parentId: block.id });
  return { id: block.id, text: block.text, revision: block.revision, children: await Promise.all(blocks.map(child => subtree(own, child, depth + 1))) };
}

const near = (kind: string, among: readonly string[]): string | undefined => {
  const distance = (a: string, b: string) => { let d = Math.abs(a.length - b.length); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++; return d; };
  const sorted = (s: string) => [...s].sort().join("");
  return among.find(k => sorted(k) === sorted(kind)) ?? among.map(k => [distance(k, kind), k] as const).filter(([d]) => d <= 2).sort((a, b) => a[0] - b[0])[0]?.[1];
};

/** What is wrong with each tile's kind: one no door asked for and no extension serves. A replaced name is no problem. */
function kindProblems(spec: ScreenSpec, kinds: readonly string[], replaced: ReadonlyMap<string, string>, undrawn: ReadonlyMap<string, string>): ScreenProblem[] {
  const leaves = [...savedNodes(spec.layout.root), ...(spec.layout.floats ?? []).map(f => f.tile)].filter(n => n?.t === "leaf");
  return leaves.flatMap(leaf => {
    const kind = canonKind(String(leaf.kind ?? ""));
    const as = replaced.get(kind) ?? kind;
    const tile = typeof leaf.name === "string" ? leaf.name : undefined;
    // A kind an extension serves for a drawer this door hasn't: said as that, never as a typo.
    if (undrawn.has(as)) return [{ ...(tile ? { tile } : {}), said: `this door has no ${undrawn.get(as)} drawer, which draws a ${as} tile` }];
    if (kinds.includes(kind) || replaced.has(kind)) return [];
    const guess = near(kind, kinds);
    return [{ ...(tile ? { tile } : {}), said: `no tile kind ${kind || "(none)"} here${guess ? ` · did you mean ${guess}?` : ""}` }];
  });
}

/**
 * `spec` with each tile's kind as the kind it is: a retired name (`detail`, `pinned`) and a name an extension's kind
 * replaces read as the kind that took their place, with what the retired name said as the tile's fields (outline-core's
 * `canonLeaf`: a pin is still a pin). The one place a served screen's kinds are resolved: a client finds its drawer by
 * the kind the row says, and keeps no map from old names of its own.
 */
function kindsResolved(spec: ScreenSpec, replaced: ReadonlyMap<string, string>): ScreenSpec {
  const served = structuredClone(spec);
  for (const leaf of [...savedNodes(served.layout.root), ...(served.layout.floats ?? []).map(f => f.tile)]) {
    if (leaf?.t !== "leaf" || typeof leaf.kind !== "string") continue;
    Object.assign(leaf, canonLeaf(leaf as { kind: string; mode?: string; page?: string }));
    leaf.kind = replaced.get(leaf.kind) ?? leaf.kind;
  }
  return served;
}

/** `screens.list`: the outline's screen notes and its extensions' screens, each read, checked and named once. */
export async function listScreens(own: Own, request: Pick<Extract<ScreensRequest, { action: "screens.list" }>, "kinds" | "reserved" | "drawers">): Promise<ScreensList> {
  const [notes, listed] = await Promise.all([byProp(own, "type", SCREEN_TYPE, 500), own.request<ExtensionsListed>({ action: "extensions.list" }).catch((): ExtensionsListed => ({}))]);
  const served = listed.tileKinds ?? [];
  const replaced = new Map(served.flatMap(k => (k.replaces ?? []).map(old => [old, k.kind] as const)));
  const kinds = request.kinds ? [...new Set([...request.kinds.map(canonKind), ...served.map(k => k.kind)])] : null;
  const undrawn = new Map(request.drawers ? served.flatMap(k => k.drawer && !request.drawers!.includes(k.drawer) ? [[k.kind, k.drawer] as const] : []) : []);
  const checked = (spec: ScreenSpec): ScreenProblem[] => [...addressProblems(spec), ...(kinds ? kindProblems(spec, kinds, replaced, undrawn) : [])];
  const problems: string[] = [];
  const rows: ScreenRow[] = [];
  const theirs = new Map<string, string>();
  for (const extension of listed.extensions ?? []) for (const screen of extension.screens ?? []) {
    theirs.set(screen.name, extension.id);
    try {
      const spec = readSpec({ ...screen, title: typeof screen.title === "string" && screen.title ? screen.title : screen.name });
      rows.push({ name: spec.name, title: spec.title, from: "extension", extension: extension.id, spec: kindsResolved(spec, replaced), problems: checked(spec) });
    } catch (e) { rows.push({ name: screen.name, title: screen.name, from: "extension", extension: extension.id, problems: [{ said: `the ${extension.id} extension's screen ${screen.name}: ${(e as Error).message}` }] }); }
  }
  const read = await Promise.all(notes.map(async note => readScreenNote(await subtree(own, note))));
  // Every note by the name it gives, read well or not: a name two notes give opens neither, whatever else is wrong.
  const byName = new Map<string, typeof read>();
  for (const r of read) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  for (const [name, same] of byName) {
    const ids = same.map(n => `((${n.id}))`).sort().join(", ");
    const taken = request.reserved?.includes(name) ? `a built-in screen's name` : theirs.has(name) ? `the ${theirs.get(name)} extension's screen` : null;
    const clash = taken ? `a screen note is named ${name}, ${taken}: it isn't opened · rename it ([${SCREEN_TYPE}::…] in ${ids})`
      : same.length > 1 ? `${same.length} screen notes are named ${name}: none is opened by that name · rename all but one (${ids})` : null;
    if (clash) problems.push(clash);
    for (const r of same) {
      if ("problem" in r) rows.push({ name, title: name, from: "note", note: { id: r.id, revision: 0, form: "blocks" }, problems: [{ said: r.problem }, ...(clash ? [{ said: clash }] : [])] });
      else rows.push({ name, title: r.title, from: "note", note: { id: r.id, revision: r.revision, form: r.form }, ...(clash ? {} : { spec: kindsResolved(r.spec, replaced) }), problems: [...(clash ? [{ said: clash }] : []), ...checked(r.spec)] });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || (a.note?.id ?? "").localeCompare(b.note?.id ?? ""));
  return { screens: rows, problems, anyChange: true };
}

/** `screens.save`: `spec` written as its screen note in the block form: the note by that name, else a new one. */
export async function saveScreen(own: Own, request: Extract<ScreensRequest, { action: "screens.save" }>): Promise<ScreenSaved> {
  let spec: ScreenSpec;
  // A name as a person typed it ("Garden work") is the screen's title, and its name the slug of it: the one rule.
  const given = (request.spec && typeof request.spec === "object" ? request.spec : {}) as Record<string, unknown>;
  const typed = typeof given.name === "string" && screenNameProblem(given.name) ? given.name.trim() : null;
  try { spec = readSpec(typed === null ? given : { ...given, title: typed, name: screenSlug(typed) }); } catch (e) { throw new Refusal("invalid", `screens.save: ${(e as Error).message}`); }
  const bad = screenNameProblem(spec.name);
  if (bad) throw new Refusal("invalid", bad);
  const { extensions = [] } = await own.request<ExtensionsListed>({ action: "extensions.list" }).catch((): ExtensionsListed => ({}));
  const theirs = extensions.find(e => e.screens?.some(s => s.name === spec.name));
  if (theirs) throw new Refusal("invalid", `${spec.name} is the ${theirs.id} extension's screen: a screen you make takes a name of its own · try ${JSON.stringify(`${spec.title} 2`)}`);
  const mutation: MutationProvenance = request.mutation ?? { author: "user" };
  const written = screenNoteBlocks(spec);
  const made = (await byProp(own, "type", SCREEN_TYPE, 500)).filter(note => screenNoteName(note.text).name === spec.name);
  if (made.length > 1) throw new Refusal("invalid", `${made.length} screen notes are named ${spec.name}: none is saved over · rename all but one (${made.map(n => `((${n.id}))`).join(", ")})`);
  // A block is made as its author: an agent's names the agent, a person's names no client (the store's rule for creates).
  const create = (parentId: string | null, text: string) => own.request<{ id: string; revision: number }>({ action: "create", parentId, text, author: mutation.author, ...(mutation.author === "agent" && mutation.actorId ? { provenance: { actorId: mutation.actorId } } : {}) });
  const under = async (parentId: string, blocks: readonly WrittenBlock[]): Promise<void> => {
    // In order, one at a time: each lands last under its parent.
    for (const block of blocks) { const at = await create(parentId, block.text); await under(at.id, block.children); }
  };
  const had = made[0];
  if (!had) {
    const home = (await byProp(own, "type", HOME_TYPE, 5))[0] ?? await create(null, `Screens [type::${HOME_TYPE}]\nThe screens made in a door, one note each: \`ep0ch --screen <name>\` opens one.`);
    const note = await create(home.id, written.text);
    await under(note.id, written.children);
    return { name: spec.name, title: spec.title, id: note.id, revision: note.revision, created: true };
  }
  // The note it has, at the revision the asker read: a note changed since is refused, and nothing under it is touched.
  const expectedRevision = request.base && request.base.id === had.id ? request.base.revision : had.revision;
  const title = screenSlug(spec.title) === spec.name ? spec.title : spec.name;
  const updated = await own.request<{ id: string; revision: number }>({ action: "update", blockId: had.id, text: written.text, expectedRevision, mutation });
  // The blocks it has are kept, each where it is: one that reads as it should is left alone, one that doesn't is
  // written again, a block the layout no longer has goes to the Trash and one it gained is made. A save after a
  // border moved writes one block, and nothing a save didn't change is trashed and made again.
  const settle = async (parentId: string, blocks: readonly WrittenBlock[]): Promise<void> => {
    const old = await own.request<Read[]>({ action: "children", parentId });
    for (const [i, block] of blocks.entries()) {
      const was = old[i];
      if (!was) { const at = await create(parentId, block.text); await under(at.id, block.children); continue; }
      if (was.text !== block.text) await own.request({ action: "update", blockId: was.id, text: block.text, expectedRevision: was.revision, mutation });
      await settle(was.id, block.children);
    }
    for (const gone of old.slice(blocks.length)) await own.request({ action: "delete", blockId: gone.id, mutation });
  };
  await settle(had.id, written.children);
  return { name: spec.name, title, id: had.id, revision: updated.revision, created: false };
}
