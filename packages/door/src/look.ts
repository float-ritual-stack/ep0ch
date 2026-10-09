// The look (PIE-673): spacing and list density from the outline's style notes, resolved for where something is
// drawn by outline-core's one cascade (style-cascade.ts), never by a rule of the door's own.
//
// - The sheets: the outline's `[style-for::…]` declarations (`styles.list`), kept per connection as the heading
//   styles are (src/outline-lists.ts): asked again after the outline changes, so an edit to a style note restyles
//   every door on the outline at once.
// - The tuning: the tune inspector's nudges, in memory, per connection: a layer over the outline's at the level they
//   target, so a nudge draws in the next frame with nothing read from the outline. `s` writes them to that level's
//   note; quitting with any unwritten says so.
// - `lookFor`: the values for a place (tile kind, screen, page) at a width, each with where it came from.
//
// Spacing is drawn, never text: the desk draws a tile's content inside its padding and measure (the tile never sees
// those cells), and a reader's margin and gap rows are its drawing (src/surface/selection.ts's margin and edge rows), so
// a selection, a copy, `peek` and an export give the note's text.
import {
  fieldKey, levelOfSave, levelTarget, parseFieldKey, resolveStyle, styleLayers, styleProperty, type Breakpoint, type FieldKey, type ResolvedStyle,
  type SaveLevel, type StyleLayer, type StylePlace, type StyleSheet, type StyleToken,
} from "@ep0ch/outline-core/style-cascade";
import { outlineList, type ListSource } from "./outline-lists";
import { liveTokensInLine, withoutTokens } from "@ep0ch/outline-core/heading-styles";
import { USER, type Actor, type PropertyToken, type PropertyPatch } from "./socket";
import type { Msg } from "./board";

type StyleBoard = { styleSheets?: () => Promise<{ sheets: StyleSheet[]; problems: string[] }> };

const SHEETS = outlineList<StyleSheet, { sheets: readonly StyleSheet[] }>(
  (b: StyleBoard) => (typeof b.styleSheets === "function" ? () => b.styleSheets!().then(r => ({ items: r.sheets, problems: r.problems })) : undefined),
  items => ({ sheets: items }), { sheets: [] },
);

/** The outline's style sheets for this connection (none until the service answers). */
export const sheetsOf = (src: ListSource | null | undefined) => SHEETS.of(src).sheets;
/** Once the question out now (if any) is answered. */
export const sheetsReady = async (src: ListSource) => (await SHEETS.ready(src)).sheets;
/** What's wrong with the outline's style declarations, as the service last said. */
export const styleSheetProblems = SHEETS.problems;

// ── the tuning layer ──────────────────────────────────────────────────────────

/** What a nudge targets: `global`, `tile:<kind>`, `screen:<name>`, or `page:<id>`. */
export type TuneTarget = string;

/** The target a value saved at `level` goes to, for `place`; null where the place has no such level (no page shown). */
export function tuneTarget(level: SaveLevel, place: StylePlace, list?: TuneTarget | null): TuneTarget | null {
  if (level === "page") return place.page ? `page:${place.page.id}` : null;
  // This tile (its tile spec) and this list (its lead-in or heading line, where the reader's [ ] is): PIE-675.
  if (level === "instance") return place.instance ? `tile:${place.instance.id}` : null;
  if (level === "list") return list ?? null;
  return levelTarget(level, place);
}

/** A list's target: its owner line in its note (`list:<note>:<line>`), and read back. */
export const listTarget = (note: string, line: number): TuneTarget => `list:${note}:${line}`;
export function parseListTarget(t: TuneTarget): { note: string; line: number } | null {
  const m = /^list:(.+):(\d+)$/.exec(t);
  return m ? { note: m[1]!, line: Number(m[2]) } : null;
}

/**
 * The target that wrote a value, from its source (StyleSource): `global`, `tile:<kind>`, `screen:<name>`, a named style's
 * name, or the page's own `page:<id>`; null for the built-ins, a component's or a box's (edited where they're written).
 */
export function sourceTarget(src: { level: string; label: string; block?: string; line?: number }, place: StylePlace): TuneTarget | null {
  const label = src.label.replace(/ · tuning$/, "");
  if (src.level === "global") return "global";
  if (src.level === "instance") return place.instance ? `tile:${place.instance.id}` : null;
  if (src.level === "block" && label === "this list" && src.block && src.line !== undefined) return listTarget(src.block, src.line);
  if (src.level === "tile" || src.level === "screen") return label.replace(" ", ":");
  if (src.level === "page") return label.startsWith("style ") ? label.slice(6) : place.page ? `page:${place.page.id}` : null;
  return null;
}

/**
 * A tuned field's value that takes it away from the one declaration that set it (the inspector's `x` on a row,
 * PIE-675, `from` naming that note): what the cascade has without it shows, and a save removes the property from that
 * note, so what shows before the save is what shows after it.
 */
export const UNSET = "\u0000unset";
interface Tuned { value: string; by: Actor; saved?: boolean; from?: string }
/** The nudges at one moment, target → field → value: what a write's undo puts back. */
type Snapshot = Map<TuneTarget, Map<FieldKey, Tuned>>;
const copyOf = (m: Snapshot): Snapshot => new Map([...m].map(([k, v]) => [k, new Map(v)]));

/**
 * One note's style properties written by the inspector (a save, a level reset, a revert, or one of their undos):
 * property → its values before and after, in order (none: not set; a key written twice keeps both), and the revision the
 * note was left at.
 */
export interface NoteWrite {
  note: string; before: Record<string, string[]>; after: Record<string, string[]>; revision: number;
  /** A list's own line (`this list`): the note's line it was written on, its keys that line's tokens. */
  line?: number;
}

/**
 * A step of the session's history (PIE-675): a nudge (or a value taken away or let go) in memory, or a write to the
 * outline with the nudges as they were before and after it (a save marks them saved; a reset or a revert lets them go).
 */
export type TuneStep =
  | { kind: "nudge"; target: TuneTarget; field: FieldKey; before: Tuned | undefined; after: Tuned | undefined; by: Actor }
  | { kind: "write"; what: string; writes: NoteWrite[]; tuningBefore: Snapshot; tuningAfter: Snapshot; by: Actor };

/** A value as the history says it: the nudge's, "taken away", or the outline's (no nudge). */
const tunedWords = (t: Tuned | undefined) => (!t ? "the outline's" : t.value === UNSET ? "taken away" : t.value);
/** What a step did, in words for the status line: `pad.x 4 → 6 at this page`, `save of style.pad.x=6 to this page`. */
export function stepWords(s: TuneStep, undoing: boolean): string {
  if (s.kind === "write") return s.what;
  const [from, to] = undoing ? [s.after, s.before] : [s.before, s.after];
  return `${s.field} ${tunedWords(from)} → ${tunedWords(to)} at ${targetWords(s.target)}`;
}

/**
 * The nudges on one connection: target → field → value, the session's history of steps (each nudge and each write) with
 * its redo, the revision each style note had before this session first wrote it (what revert puts back), and a
 * generation that changes with each.
 */
export class Tuning {
  layers: Snapshot = new Map();
  private history: TuneStep[] = [];
  private redos: TuneStep[] = [];
  /**
   * Each style note this session wrote: its style properties as they were before the first write (read at the revision
   * that write patched, kept only once it succeeded), and the revision the session last left it at: what an undo, a redo
   * and a revert name, so a note changed since by anyone else is refused.
   */
  readonly baseline = new Map<string, Record<string, string[]>>();
  /** A list's own line (`note:line`) and a tile's own look (its tile id), as they were before this session first wrote them. */
  readonly lineBaseline = new Map<string, Record<string, string[]>>();
  readonly tileBaseline = new Map<string, Record<string, string>>();
  readonly last = new Map<string, number>();
  /** Bumped by every change: a reader's layout cache keys on it. */
  gen = 0;

  get(target: TuneTarget, field: FieldKey): Tuned | undefined { return this.layers.get(target)?.get(field); }

  private put(target: TuneTarget, field: FieldKey, t: Tuned | undefined) {
    const at = this.layers.get(target) ?? new Map<FieldKey, Tuned>();
    if (t) at.set(field, t); else at.delete(field);
    if (at.size) this.layers.set(target, at); else this.layers.delete(target);
    this.gen++;
  }

  /** A step done now: it goes on the history, and what was undone can't be redone past it. */
  record(step: TuneStep) {
    this.history.push(step);
    if (this.history.length > 500) this.history.shift();
    this.redos = [];
  }

  /** `from`: for UNSET, the note the field is taken from. */
  set(target: TuneTarget, field: FieldKey, value: string, by: Actor, from?: string) {
    const after: Tuned = { value, by, ...(value === UNSET && from ? { from } : {}) };
    this.record({ kind: "nudge", target, field, before: this.get(target, field), after, by });
    this.put(target, field, after);
  }

  /** Lets go of `target`'s nudge of `field` (a step: undo puts it back); whether there was one. */
  drop(target: TuneTarget, field: FieldKey, by: Actor): boolean {
    const had = this.get(target, field);
    if (!had) return false;
    this.record({ kind: "nudge", target, field, before: had, after: undefined, by });
    this.put(target, field, undefined);
    return true;
  }

  /** The nudges as they are now (a write's step keeps them before and after). */
  snapshot(): Snapshot { return copyOf(this.layers); }
  /** Puts the nudges back as `s` had them. */
  restore(s: Snapshot) { this.layers = copyOf(s); this.gen++; }

  /**
   * The step `by` would take back: the person's, the last; an agent's, its own last, and only while nobody changed that
   * value since (a nudge) or did anything since (a write, whose undo puts every nudge back as it was). Why not: an Error.
   */
  nextUndo(by: Actor): TuneStep | null {
    const mine = (u: TuneStep) => (by.kind === "user" ? true : u.by.kind === "agent" && u.by.id === by.id);
    const at = this.history.findLastIndex(mine);
    if (at < 0) return null;
    const s = this.history[at]!, later = this.history.slice(at + 1);
    const who = (a: Actor) => (a.kind === "user" ? "by you" : `by ${a.kind === "agent" ? a.id : "someone"}`);
    if (s.kind === "nudge") {
      const again = later.find(x => x.kind === "write" || (x.target === s.target && x.field === s.field));
      if (again) throw new Error(`${s.field} was changed again since (${who(again.by)}): it's theirs to take back`);
    } else if (later.length) throw new Error(`${s.what} has changes after it (${who(later[0]!.by)}): those are taken back first`);
    return s;
  }
  /** Takes `s` (nextUndo's) back in memory: a nudge's value as it was, a write's nudges as they were; it can be redone. */
  undone(s: TuneStep) {
    this.history.splice(this.history.lastIndexOf(s), 1);
    if (s.kind === "nudge") this.put(s.target, s.field, s.before); else this.restore(s.tuningBefore);
    this.redos.push(s);
  }
  /** The step a redo would do again: the last one undone (an agent: only its own, and only while it is the last). */
  nextRedo(by: Actor): TuneStep | null {
    const s = this.redos.at(-1);
    if (!s) return null;
    if (by.kind === "agent" && !(s.by.kind === "agent" && s.by.id === by.id)) throw new Error("the last thing taken back isn't yours to redo");
    return s;
  }
  /** Does `s` (nextRedo's) again in memory. */
  redone(s: TuneStep) {
    this.redos.pop();
    if (s.kind === "nudge") this.put(s.target, s.field, s.after); else this.restore(s.tuningAfter);
    this.history.push(s);
  }

  /** Nudges not yet written to the outline, by target (a field taken away with the note it's taken from). */
  unsaved(): { target: TuneTarget; fields: [FieldKey, string, string?][] }[] {
    return [...this.layers].flatMap(([target, f]) => {
      const fields = [...f].filter(([, t]) => !t.saved).map(([k, t]) => (t.from ? [k, t.value, t.from] : [k, t.value]) as [FieldKey, string, string?]);
      return fields.length ? [{ target, fields }] : [];
    });
  }
  unsavedCount(): number { return this.unsaved().reduce((n, u) => n + u.fields.length, 0); }

  /**
   * Marks `target`'s fields written with the values written: they stay over the outline until its answer says the same
   * (no flicker). A field nudged again while the save was out keeps its newer value, unsaved.
   */
  markSaved(target: TuneTarget, written: readonly (readonly [FieldKey, string, string?])[]) {
    const at = this.layers.get(target);
    if (!at) return;
    for (const [f, v] of written) { const t = at.get(f); if (t && t.value === v) at.set(f, { ...t, saved: true }); }
    this.gen++;
  }

  /** Lets go of every nudge (`all`) or `target`'s: the outline's values stand again (not a step: a write's own part). */
  clear(target?: TuneTarget) {
    if (target === undefined) this.layers.clear(); else this.layers.delete(target);
    this.gen++;
  }

  /**
   * Drops a written field once the outline's own layer says the same value; a field taken away, once the note it was
   * taken from no longer sets it (`has`).
   */
  settle(target: TuneTarget, outline: Readonly<Record<FieldKey, string>> | undefined, has: (block: string, field: FieldKey) => boolean = () => false) {
    const at = this.layers.get(target);
    if (!at) return;
    let changed = false;
    for (const [f, t] of at) if (t.saved && (t.value === UNSET ? (t.from ? !has(t.from, f) : outline?.[f] === undefined) : outline?.[f] === t.value)) { at.delete(f); changed = true; }
    if (!at.size) this.layers.delete(target);
    if (changed) this.gen++;
  }
}

const tunings = new WeakMap<object, Tuning>();
/** The connections with a tuning, for the door's quit. */
const known = new Set<WeakRef<object>>();
/** The connection's tuning (one per outline connection: every tile and screen on it sees the same nudges). */
export function tuningOf(board: object): Tuning {
  let t = tunings.get(board);
  if (!t) { tunings.set(board, (t = new Tuning())); known.add(new WeakRef(board)); }
  return t;
}
/** Every connection's unwritten nudges (the door's quit says so). */
export function anyUnsavedTuning(): number {
  let n = 0;
  for (const r of known) { const b = r.deref(); if (!b) { known.delete(r); continue; } n += tunings.get(b)?.unsavedCount() ?? 0; }
  return n;
}

// ── resolving ─────────────────────────────────────────────────────────────────

export interface Look extends ResolvedStyle {
  /** Changes whenever what it was resolved from changes: a layout cache keys on it. */
  stamp: string;
  place: StylePlace;
  /** The layers it was resolved from (the outline's and the tuning's), for a component or a box to add theirs to. */
  layers: StyleLayer[];
}

/** A note as a page: its own properties. */
export function pageOf(m: Pick<Msg, "id" | "props"> | null | undefined): StylePlace["page"] {
  if (!m) return undefined;
  const props = Object.entries(m.props ?? {}).flatMap(([key, v]) => (Array.isArray(v) ? v : [v]).map(value => ({ key, value: String(value) })));
  return { id: m.id, properties: props };
}

const LEVEL_OF: Record<string, SaveLevel> = { global: "global", tile: "tile", screen: "screen", page: "page" };

/**
 * The look of `place` at `width` columns: the outline's levels, with the tuning's over each at its level. Cheap enough
 * to ask every frame (a handful of layers); the reader keys its layout on `stamp`.
 */
export function lookFor(src: ListSource | null | undefined, place: StylePlace, width: number): Look {
  const board = src?.board as object | undefined;
  const sheets = sheetsOf(src);
  const problems: string[] = [];
  const layers = styleLayers(sheets, place, problems);
  const t = board ? tunings.get(board) : undefined;
  if (t?.layers.size) {
    const outlineAt = (target: TuneTarget): Record<FieldKey, string> | undefined => {
      if (target.startsWith("page:")) return layers.find(l => l.level === "page" && l.label === "page")?.fields;
      if (target.startsWith("tile:")) return { ...(place.instance?.fields ?? {}) };
      const merged: Record<FieldKey, string> = {};
      for (const s of sheets) if (s.for === target) Object.assign(merged, s.fields);
      return merged;
    };
    // Whether note `block` still sets `field` itself (a declaration that's the note's own properties, or the page's).
    const has = (block: string, field: FieldKey) => sheets.some(s => s.block === block && s.line === undefined && field in s.fields)
      || layers.some(l => l.level === "page" && l.label === "page" && l.block === block && field in l.fields)
      || (block.startsWith("tile:") && field in (place.instance?.fields ?? {}));
    // The tuning goes into the outline's layer it tunes (its newest declaration), as a save would write it, so a width
    // variant there keeps its precedence live as after the save; a level with no declaration gets a layer of its own.
    // A field taken away (UNSET) leaves the one declaration it's taken from, as the save will: an older one still shows.
    const put = (level: StyleLayer["level"], label: string, at: Map<FieldKey, Tuned>) => {
      const set = [...at].filter(([, v]) => v.value !== UNSET), gone = [...at].filter(([, v]) => v.value === UNSET);
      const fields = Object.fromEntries(set.map(([k, v]) => [k, v.value]));
      for (const [k, v] of gone) layers.forEach((l, n) => { if (l.label === label && (l.block === v.from || (label === "this tile" && v.from?.startsWith("tile:")))) layers[n] = { ...l, fields: Object.fromEntries(Object.entries(l.fields).filter(([f]) => f !== k)) }; });
      const i = layers.findLastIndex(l => l.label === label);
      if (i >= 0) layers[i] = { ...layers[i]!, fields: { ...layers[i]!.fields, ...fields } };
      else if (set.length) layers.push({ level, label, fields });
    };
    for (const level of ["global", "tile", "screen", "page"] as const) {
      const target = tuneTarget(level, place);
      if (!target) continue;
      t.settle(target, outlineAt(target), has);
      const at = t.layers.get(target);
      if (!at?.size) continue;
      put(levelOfSave(LEVEL_OF[level]!), level === "page" ? "page" : level === "global" ? "global" : target.replace(":", " "), at);
    }
    // This tile's (its spec, saved with the layout): after the page, as the cascade has it.
    const mine = tuneTarget("instance", place);
    if (mine) {
      t.settle(mine, outlineAt(mine), has);
      const at = t.layers.get(mine);
      if (at?.size) put("instance", "this tile", at);
    }
    // The named style the page uses (`[style::lab]`): its tuning right after its own layer, under the page's own fields.
    const named = place.page?.properties.find(p => p.key.toLowerCase() === "style")?.value.trim().toLowerCase();
    if (named) {
      t.settle(named, outlineAt(named), has);
      const at = t.layers.get(named);
      if (at?.size) put("page", `style ${named}`, at);
    }
  }
  const r = resolveStyle(layers, width);
  r.problems.unshift(...problems);
  const sheetStamp = board ? SHEETS.stamp(SHEETS.of(src)) : 0;
  const tileStamp = place.instance ? Object.entries(place.instance.fields).map(([k, v]) => `${k}=${v}`).join(",") : "";
  const pageStamp = place.page ? place.page.properties.filter(p => p.key.startsWith("style")).map(p => `${p.key}=${p.value}`).join(",") : "";
  return { ...r, layers, place, stamp: `${sheetStamp}|${t?.gen ?? 0}|${place.tile ?? ""}|${place.screen ?? ""}|${pageStamp}|${tileStamp}|${r.breakpoint ?? ""}` };
}

/**
 * A list's own fields on line `line` of note `note` (`written`: what that line says), with this connection's tuning over
 * them: nudges in memory drawn at once, a field taken away gone; settled once the line says the same (PIE-675).
 */
export function listFieldsTuned(src: ListSource | null | undefined, note: string, line: number, written: Readonly<Record<FieldKey, string>>): Record<FieldKey, string> {
  const board = src?.board as object | undefined, t = board ? tunings.get(board) : undefined;
  const target = listTarget(note, line);
  if (!t?.layers.has(target)) return { ...written };
  t.settle(target, written, (_, f) => f in written);
  const out: Record<FieldKey, string> = { ...written };
  for (const [k, v] of t.layers.get(target) ?? []) { if (v.value === UNSET) delete out[k]; else out[k] = v.value; }
  return out;
}

// ── nudging and saving ────────────────────────────────────────────────────────

/** The field a nudge writes: the token's own, or its width variant (this width only). */
export function nudgeField(token: StyleToken, variant: Breakpoint | null): FieldKey { return fieldKey(token, variant); }

/** Where a save of `target` went, in words. */
export interface Saved { target: TuneTarget; note: string; fields: string[]; created: boolean }

/** A new style note's home: beside the outline's other style notes, else under a `Looks` note made for them. */
async function styleHome(board: StyleWriteBoard, sheets: readonly StyleSheet[], actor: Actor): Promise<string | null> {
  for (const s of sheets) { const m = await board.get(s.block); if (m) return m.parentId ?? null; }
  const looks = (await board.byProp("type", "looks", 1))[0];
  if (looks) return looks.id;
  return (await board.newNote("Looks [type::looks]\n\nThe notes under here set the door's spacing and list density ([style-for::…]); the tune inspector (alt+y) writes them.", undefined, actor)).note.id;
}

/** What saving needs of a connection. */
export interface StyleWriteBoard {
  get(id: string): Promise<Msg | null>;
  update(id: string, text: string, expectedRevision: number, actor?: Actor): Promise<Msg>;
  byProp(key: string, value: string, limit?: number): Promise<Msg[]>;
  newNote(text: string, near: string | undefined, actor?: Actor): Promise<{ note: Msg }>;
  createBlock(parentId: string | null, text: string, actor?: Actor): Promise<Msg>;
  propertyTokens(blockId: string, key: string): Promise<{ revision: number; tokens: PropertyToken[] }>;
  patchProperties(blockId: string, expectedRevision: number, operations: PropertyPatch[], actor?: Actor): Promise<Msg>;
}

/** Words for a target: `global`, `tile detail`, `screen desk`, `this page`. */
export const targetWords = (t: TuneTarget) => (t === "global" ? "global" : t.startsWith("page:") ? "this page" : t.startsWith("tile:") ? "this tile" : t.startsWith("list:") ? "this list" : t.includes(":") ? t.replace(":", " ") : `style ${t}`);

/** A note's style property keys (`style.…`). */
const styleKeys = (m: Msg) => Object.keys(m.props ?? {}).filter(k => k.toLowerCase().startsWith("style."));

/** A value to write: a value, several in order, or none (null: removed). */
type Want = string | readonly string[] | null;
const valuesOf = (v: Want): string[] => (v === null ? [] : typeof v === "string" ? [v] : [...v]);

/**
 * Writes style properties onto note `note` as `actor`, one attributed patch: each key to its values (a value, several
 * in order, or none: every one of the note's own removed, so a value written twice can't show again). `expected`: the
 * revision it must still be at (an undo, a redo, a revert, a reset), else it's refused naming the note; null reads it
 * fresh (a save). The first write of a note this session keeps what all its style properties were at the revision it
 * patched (Tuning.baseline, for revert), once the write succeeds. Null when nothing changes.
 */
export async function writeNote(board: StyleWriteBoard, tuning: Tuning, note: string, want: Readonly<Record<string, Want>>, expected: number | null, actor: Actor): Promise<NoteWrite | null> {
  const keys = Object.keys(want);
  if (!keys.length) return null;
  for (let tries = 0; tries < 3; tries++) {
    // Every style key the note has (for the baseline) and every key written, read at one revision.
    const m = tuning.baseline.has(note) ? null : await board.get(note);
    const all = [...new Set([...keys, ...(m ? styleKeys(m) : [])])];
    const reads = await Promise.all(all.map(k => board.propertyTokens(note, k)));
    const revision = reads[0]!.revision;
    if (reads.some(r => r.revision !== revision) || (m && m.revision !== undefined && m.revision !== revision)) continue;
    if (expected !== null && revision !== expected) throw new Error(`note ${note.slice(0, 8)} changed since (by another door or an agent): refused, nothing written`);
    const own = (k: string) => reads[all.indexOf(k)]!.tokens.filter(x => x.scope === "block");
    const before: Record<string, string[]> = {}, after: Record<string, string[]> = {}, ops: PropertyPatch[] = [];
    for (const k of keys) {
      const have = own(k), next = valuesOf(want[k]!);
      before[k] = have.map(x => x.value); after[k] = next;
      // The same place for each value: replaced where it differs, the rest removed or appended.
      have.forEach((x, i) => { if (i >= next.length) ops.push({ op: "remove", ordinal: x.ordinal }); else if (x.value !== next[i]) ops.push({ op: "replace", ordinal: x.ordinal, value: next[i]! }); });
      for (const v of next.slice(have.length)) ops.push({ op: "append", key: k, value: v });
    }
    if (!ops.length) return null;
    const baseline = m ? Object.fromEntries(all.map(k => [k, own(k).map(x => x.value)])) : null;
    const done = await board.patchProperties(note, revision, ops, actor);
    const left = done.revision ?? revision + 1;
    if (baseline && !tuning.baseline.has(note)) tuning.baseline.set(note, baseline);
    tuning.last.set(note, left);
    return { note, before, after, revision: left };
  }
  throw new Error("the style note kept changing while it was read: try again");
}

/** A desk's tiles' own looks (`this tile`, PIE-675): read and written by tile id, kept in each tile's spec. */
export interface TileLooks {
  get(id: string): Readonly<Record<FieldKey, string>> | null;
  set(id: string, fields: Record<FieldKey, string>): void;
}

/**
 * Writes a tile's own look (field key → value, null removing it) into its tile spec, which the layout saves: a step's
 * write like a note's (`tile:<id>`), kept in Tuning.tileBaseline before the first. Null when nothing changes.
 */
export function writeTile(tiles: TileLooks | undefined, tuning: Tuning, target: TuneTarget, want: Readonly<Record<FieldKey, Want>>): NoteWrite | null {
  const id = target.slice(5), now = tiles?.get(id);
  if (!tiles || !now) throw new Error(`tile ${id} isn't on this screen: its look can't be saved`);
  const next: Record<FieldKey, string> = { ...now }, before: Record<string, string[]> = {}, after: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(want)) {
    before[k] = now[k] !== undefined ? [now[k]!] : [];
    const vs = valuesOf(v);
    after[k] = vs.slice(0, 1);
    if (vs.length) next[k] = vs[0]!; else delete next[k];
  }
  if (Object.entries(want).every(([k]) => (now[k] ?? null) === (next[k] ?? null))) return null;
  if (!tuning.tileBaseline.has(id)) tuning.tileBaseline.set(id, { ...now });
  tiles.set(id, next);
  return { note: target, before, after, revision: 0 };
}

/**
 * Writes style tokens onto line `line` of note `note` (a list's own, `this list`): each key's tokens on that line
 * removed, its values appended, the rest of the line as written; one attributed update at the revision read (or
 * `expected`, refused when the note moved on). Kept in Tuning.lineBaseline before the first. Null when nothing changes.
 */
export async function writeLine(board: StyleWriteBoard, tuning: Tuning, note: string, line: number, want: Readonly<Record<string, Want>>, expected: number | null, actor: Actor): Promise<NoteWrite | null> {
  const m = await board.get(note);
  if (!m || m.revision === undefined) throw new Error(`note ${note.slice(0, 8)} can't be read`);
  if (expected !== null && m.revision !== expected) throw new Error(`note ${note.slice(0, 8)} changed since (by another door or an agent): refused, nothing written`);
  const lines = m.text.split("\n"), was = lines[line];
  if (was === undefined) throw new Error(`note ${note.slice(0, 8)} has no line ${line + 1} any more`);
  const tokens = liveTokensInLine(was), keys = Object.keys(want).map(k => k.toLowerCase());
  const before: Record<string, string[]> = {}, after: Record<string, string[]> = {};
  for (const k of Object.keys(want)) { before[k] = tokens.filter(x => x.key.toLowerCase() === k.toLowerCase()).map(x => x.value); after[k] = valuesOf(want[k]!); }
  const kept = withoutTokens(was, tokens.filter(x => keys.includes(x.key.toLowerCase())));
  const now = [kept, ...Object.entries(after).flatMap(([k, vs]) => vs.map(v => `[${k}::${v}]`))].filter(Boolean).join(" ");
  if (now === was) return null;
  const base = `${note}:${line}`;
  const baseline = tuning.lineBaseline.has(base) ? null : Object.fromEntries([...new Set(tokens.filter(x => x.key.toLowerCase().startsWith("style.")).map(x => x.key))].map(k => [k, tokens.filter(x => x.key === k).map(x => x.value)]));
  lines[line] = now;
  const done = await board.update(note, lines.join("\n"), m.revision, actor);
  if (baseline) tuning.lineBaseline.set(base, baseline);
  const left = done.revision ?? m.revision + 1;
  tuning.last.set(note, left);
  return { note, line, before, after, revision: left };
}

/** One write of a step again (an undo or a redo): to a tile's look, a list's line, or a note's properties. */
async function writeAgain(board: StyleWriteBoard, tuning: Tuning, tiles: TileLooks | undefined, w: NoteWrite, want: Record<string, string[]>, expected: number | null, actor: Actor) {
  if (w.note.startsWith("tile:")) return writeTile(tiles, tuning, w.note, want);
  if (w.line !== undefined) return writeLine(board, tuning, w.note, w.line, want, expected, actor);
  return writeNote(board, tuning, w.note, want, expected, actor);
}

/**
 * Writes `target`'s unwritten nudges to the outline as `actor`: a page's onto its own note, a level's onto its newest
 * style note that declares it as the note's own properties (each field replaced where it is, else added), else a new
 * style note for it; a field taken away, off the note it was taken from. Each note written goes into `done` (the save's
 * step) and is marked saved as soon as it is, so a save that fails part way leaves only what it didn't write. The
 * nudges stay over the outline until its answer says the same.
 */
export async function saveTuning(src: ListSource & { board: StyleWriteBoard }, target: TuneTarget, actor: Actor = USER, done: NoteWrite[] = [], tiles?: TileLooks): Promise<Saved | null> {
  const t = tuningOf(src.board), entry = t.unsaved().find(u => u.target === target);
  if (!entry) return null;
  // This tile's: into its tile spec, by field (the layout saves it). This list's: onto its owner line, as tokens.
  if (target.startsWith("tile:")) {
    const want = Object.fromEntries(entry.fields.map(([k, v]) => [k, v === UNSET ? null : v]));
    const w = writeTile(tiles, t, target, want);
    if (w) done.push(w);
    t.markSaved(target, entry.fields);
    return { target, note: target, fields: entry.fields.map(([k, v]) => (v === UNSET ? `${k} removed` : `${k}=${v}`)), created: false };
  }
  const list = parseListTarget(target);
  if (list) {
    const key = (k: FieldKey) => { const f = parseFieldKey(k)!; return styleProperty(f.token, f.variant); };
    const want = Object.fromEntries(entry.fields.map(([k, v]) => [key(k), v === UNSET ? null : v]));
    const w = await writeLine(src.board, t, list.note, list.line, want, null, actor);
    if (w) done.push(w);
    t.markSaved(target, entry.fields);
    return { target, note: list.note, fields: Object.entries(want).map(([k, v]) => (v === null ? `${k} removed` : `${k}=${v}`)), created: false };
  }
  const prop = (k: FieldKey) => { const f = parseFieldKey(k)!; return styleProperty(f.token, f.variant); };
  const sets = entry.fields.filter(([, v]) => v !== UNSET).map(([k, v]) => ({ key: prop(k), value: v }));
  const gone = entry.fields.filter(([, v]) => v === UNSET).map(([k, , from]) => ({ key: prop(k), from: from ?? "" }));
  const board = src.board;
  const written = (keys: readonly string[], w: NoteWrite | null) => {
    if (w) done.push(w);
    t.markSaved(target, entry.fields.filter(([k]) => keys.includes(prop(k))));
    SHEETS.stale(board);
  };
  const onto = async (id: string, put: readonly { key: string; value: string }[], off: readonly string[]) => {
    const want: Record<string, Want> = Object.fromEntries([...put.map(p => [p.key, p.value] as const), ...off.map(k => [k, null] as const)]);
    written([...put.map(p => p.key), ...off], await writeNote(board, t, id, want, null, actor));
  };
  let note = "", created = false;
  // What's taken away, from the note each was taken from (the one the inspector showed it came from).
  const byNote = new Map<string, string[]>();
  for (const g of gone) byNote.set(g.from, [...(byNote.get(g.from) ?? []), g.key]);
  const take = (id: string) => { const off = byNote.get(id) ?? []; byNote.delete(id); return off; };
  if (target.startsWith("page:")) {
    note = target.slice(5);
    await onto(note, sets, take(note));
  } else if (sets.length) {
    const sheets = sheetsOf(src);
    // The newest declaration for it wins in the cascade: written there when it's a note's own properties; when it's a
    // line, a new style note (newer still) holds the values, so what's saved is what shows.
    const own = sheets.filter(s => s.for === target).at(-1);
    if (own && own.line === undefined) { note = own.block; await onto(note, sets, take(note)); }
    else {
      const parent = await styleHome(board, sheets, actor);
      const text = `Style · ${targetWords(target)} [style-for::${target}] ${sets.map(p => `[${p.key}::${p.value}]`).join(" ")}`;
      const made = await board.createBlock(parent, text, actor);
      note = made.id; created = true;
      // Made by this session: revert takes its values off again; its undo too.
      t.baseline.set(note, {});
      t.last.set(note, made.revision ?? 1);
      written(sets.map(p => p.key), { note, before: Object.fromEntries(sets.map(p => [p.key, []])), after: Object.fromEntries(sets.map(p => [p.key, [p.value]])), revision: made.revision ?? 1 });
    }
  }
  for (const [id, keys] of byNote) {
    if (!id) throw new Error("a value taken away doesn't say which note it came from: x again");
    await onto(id, [], keys);
    note ||= id;
  }
  return { target, note, fields: [...sets.map(p => `${p.key}=${p.value}`), ...gone.map(g => `${g.key} removed`)], created };
}

/**
 * Undoes (`back`) or redoes one write step's notes: each written as it was before (or after), at the revision this
 * session last left it at (a later step's undo moved it on: that's the session's own, not a change by someone else).
 * Every note is checked before any is written; one changed since by another door or an agent refuses the step.
 */
export async function rewrite(board: StyleWriteBoard, tuning: Tuning, writes: NoteWrite[], back: boolean, actor: Actor, tiles?: TileLooks) {
  const at = (w: NoteWrite) => tuning.last.get(w.note) ?? w.revision;
  for (const w of writes) {
    if (w.note.startsWith("tile:")) continue;
    const m = await board.get(w.note);
    if (m && m.revision !== at(w)) throw new Error(`note ${w.note.slice(0, 8)} changed since (by another door or an agent): refused, nothing written`);
  }
  for (const w of back ? [...writes].reverse() : writes) {
    const r = await writeAgain(board, tuning, tiles, w, back ? w.before : w.after, w.note.startsWith("tile:") ? null : at(w), actor);
    if (r) w.revision = r.revision;
  }
  SHEETS.stale(board);
}

/** The notes a level's reset clears for `place`, with the style properties each sets, and the declarations on lines it can't. */
export function levelNotes(src: ListSource | null | undefined, target: TuneTarget, place: StylePlace): { notes: { id: string; fields: number }[]; lines: string[] } {
  if (target.startsWith("page:")) {
    const props = (place.page?.properties ?? []).filter(p => p.key.toLowerCase().startsWith("style."));
    return { notes: props.length ? [{ id: target.slice(5), fields: props.length }] : [], lines: [] };
  }
  const sheets = sheetsOf(src).filter(s => s.for === target);
  const notes = new Map<string, number>();
  for (const s of sheets) if (s.line === undefined) notes.set(s.block, (notes.get(s.block) ?? 0) + Object.keys(s.fields).length);
  return { notes: [...notes].filter(([, n]) => n > 0).map(([id, fields]) => ({ id, fields })), lines: sheets.filter(s => s.line !== undefined).map(s => s.block) };
}

/** Clears every style property of `notes` (a level's reset), each at the revision read; each write goes into `done` as it's made. */
export async function clearNotes(board: StyleWriteBoard, tuning: Tuning, notes: readonly string[], actor: Actor, done: NoteWrite[] = []): Promise<NoteWrite[]> {
  try {
    for (const id of notes) {
      const m = await board.get(id);
      if (!m) continue;
      const w = await writeNote(board, tuning, id, Object.fromEntries(styleKeys(m).map(k => [k, null])), m.revision ?? null, actor);
      if (w) done.push(w);
    }
  } finally { SHEETS.stale(board); }
  return done;
}

/**
 * Puts every style note this session wrote back as it was before the first write (saved changes too), each at the
 * revision this session left it at: one changed since by another door or an agent refuses the whole revert, naming it,
 * before anything is written. Each write goes into `done` as it's made (a refusal part way keeps the ones made, for undo).
 */
export async function revertAll(board: StyleWriteBoard, tuning: Tuning, actor: Actor, done: NoteWrite[] = [], tiles?: TileLooks): Promise<NoteWrite[]> {
  const notes = new Set([...tuning.baseline.keys(), ...[...tuning.lineBaseline.keys()].map(k => k.slice(0, k.lastIndexOf(":")))]);
  const now = new Map<string, Msg>();
  for (const id of notes) {
    const m = await board.get(id);
    if (!m) continue;
    if (m.revision !== tuning.last.get(id)) throw new Error(`note ${id.slice(0, 8)} changed since you started (by another door or an agent): refused, nothing reverted`);
    now.set(id, m);
  }
  try {
    for (const [id, m] of now) {
      const base = tuning.baseline.get(id);
      if (base) {
        const keys = new Set([...styleKeys(m), ...Object.keys(base)]);
        const w = await writeNote(board, tuning, id, Object.fromEntries([...keys].map(k => [k, base[k] ?? null])), tuning.last.get(id) ?? null, actor);
        if (w) done.push(w);
      }
      // A list's own lines: their style tokens as they were (each read again: the note moved on with each write).
      for (const [k, lineBase] of tuning.lineBaseline) {
        if (k.slice(0, k.lastIndexOf(":")) !== id) continue;
        const line = Number(k.slice(k.lastIndexOf(":") + 1)), cur = (await board.get(id))?.text.split("\n")[line] ?? "";
        const keys = new Set([...liveTokensInLine(cur).filter(x => x.key.toLowerCase().startsWith("style.")).map(x => x.key), ...Object.keys(lineBase)]);
        const w = await writeLine(board, tuning, id, line, Object.fromEntries([...keys].map(x => [x, lineBase[x] ?? null])), tuning.last.get(id) ?? null, actor);
        if (w) done.push(w);
      }
    }
    // Tiles' own looks, as they were.
    for (const [id, base] of tuning.tileBaseline) {
      const cur = tiles?.get(id);
      if (!cur) continue;
      const keys = new Set([...Object.keys(cur), ...Object.keys(base)]);
      const w = writeTile(tiles, tuning, `tile:${id}`, Object.fromEntries([...keys].map(k => [k, base[k] ?? null])));
      if (w) done.push(w);
    }
  } finally { SHEETS.stale(board); }
  return done;
}

export type { ResolvedStyle };
