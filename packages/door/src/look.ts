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
  fieldKey, levelTarget, parseFieldKey, resolveStyle, styleLayers, styleProperty, type Breakpoint, type FieldKey, type ResolvedStyle,
  type SaveLevel, type StyleLayer, type StylePlace, type StyleSheet, type StyleToken,
} from "@ep0ch/outline-core/style-cascade";
import { outlineList, type ListSource } from "./outline-lists";
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
export function tuneTarget(level: SaveLevel, place: StylePlace): TuneTarget | null {
  if (level === "page") return place.page ? `page:${place.page.id}` : null;
  return levelTarget(level, place);
}

/**
 * The target that wrote a value, from its source (StyleSource): `global`, `tile:<kind>`, `screen:<name>`, a named style's
 * name, or the page's own `page:<id>`; null for the built-ins, a component's or a box's (edited where they're written).
 */
export function sourceTarget(src: { level: string; label: string; block?: string }, place: StylePlace): TuneTarget | null {
  const label = src.label.replace(/ · tuning$/, "");
  if (src.level === "global") return "global";
  if (src.level === "tile" || src.level === "screen") return label.replace(" ", ":");
  if (src.level === "page") return label.startsWith("style ") ? label.slice(6) : place.page ? `page:${place.page.id}` : null;
  return null;
}

interface Tuned { value: string; by: Actor; saved?: boolean }
interface Undo { target: TuneTarget; field: FieldKey; before: Tuned | undefined; by: Actor }

/** The nudges on one connection: target → field → value, an undo stack, and a generation that changes with each. */
export class Tuning {
  readonly layers = new Map<TuneTarget, Map<FieldKey, Tuned>>();
  private undos: Undo[] = [];
  /** Bumped by every change: a reader's layout cache keys on it. */
  gen = 0;

  get(target: TuneTarget, field: FieldKey): Tuned | undefined { return this.layers.get(target)?.get(field); }

  set(target: TuneTarget, field: FieldKey, value: string, by: Actor) {
    const at = this.layers.get(target) ?? new Map<FieldKey, Tuned>();
    this.undos.push({ target, field, before: at.get(field), by });
    if (this.undos.length > 200) this.undos.shift();
    at.set(field, { value, by });
    this.layers.set(target, at);
    this.gen++;
  }

  /** Takes back the last change `by` made (an agent only its own); what it took back, or null. */
  undo(by: Actor): Undo | null {
    const mine = (u: Undo) => (by.kind === "user" ? true : u.by.kind === "agent" && u.by.id === by.id);
    const at = this.undos.findLastIndex(mine);
    if (at < 0) return null;
    const [u] = this.undos.splice(at, 1);
    const layer = this.layers.get(u!.target) ?? new Map<FieldKey, Tuned>();
    if (u!.before) layer.set(u!.field, u!.before); else layer.delete(u!.field);
    if (layer.size) this.layers.set(u!.target, layer); else this.layers.delete(u!.target);
    this.gen++;
    return u!;
  }

  /** Nudges not yet written to the outline, by target. */
  unsaved(): { target: TuneTarget; fields: [FieldKey, string][] }[] {
    return [...this.layers].flatMap(([target, f]) => {
      const fields = [...f].filter(([, t]) => !t.saved).map(([k, t]) => [k, t.value] as [FieldKey, string]);
      return fields.length ? [{ target, fields }] : [];
    });
  }
  unsavedCount(): number { return this.unsaved().reduce((n, u) => n + u.fields.length, 0); }

  /** Marks `target`'s fields written: they stay over the outline until its answer says the same (no flicker). */
  markSaved(target: TuneTarget, fields: readonly FieldKey[]) {
    const at = this.layers.get(target);
    if (!at) return;
    for (const f of fields) { const t = at.get(f); if (t) at.set(f, { ...t, saved: true }); }
    this.gen++;
  }

  /** Lets go of every nudge (`all`) or `target`'s: the outline's values stand again. */
  clear(target?: TuneTarget) {
    if (target === undefined) this.layers.clear(); else this.layers.delete(target);
    this.undos = this.undos.filter(u => target !== undefined && u.target !== target);
    this.gen++;
  }

  /** Drops a written field once the outline's own layer says the same value. */
  settle(target: TuneTarget, outline: Readonly<Record<FieldKey, string>> | undefined) {
    const at = this.layers.get(target);
    if (!at) return;
    let changed = false;
    for (const [f, t] of at) if (t.saved && outline?.[f] === t.value) { at.delete(f); changed = true; }
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
      const merged: Record<FieldKey, string> = {};
      for (const s of sheets) if (s.for === target) Object.assign(merged, s.fields);
      return merged;
    };
    // Each tuning layer goes right after the outline's layer it tunes (or last at its level), so it wins there and only there.
    const put = (level: StyleLayer["level"], label: string, at: Map<FieldKey, { value: string }>) => {
      const fields = Object.fromEntries([...at].map(([k, v]) => [k, v.value]));
      const after = layers.findLastIndex(l => l.label === label);
      layers.splice(after >= 0 ? after + 1 : layers.length, 0, { level, label: `${label} · tuning`, fields });
    };
    for (const level of ["global", "tile", "screen", "page"] as const) {
      const target = tuneTarget(level, place);
      if (!target) continue;
      t.settle(target, outlineAt(target));
      const at = t.layers.get(target);
      if (!at?.size) continue;
      put(LEVEL_OF[level]!, level === "page" ? "page" : level === "global" ? "global" : target.replace(":", " "), at);
    }
    // The named style the page uses (`[style::lab]`): its tuning right after its own layer, under the page's own fields.
    const named = place.page?.properties.find(p => p.key.toLowerCase() === "style")?.value.trim().toLowerCase();
    if (named) {
      t.settle(named, outlineAt(named));
      const at = t.layers.get(named);
      if (at?.size) put("page", `style ${named}`, at);
    }
  }
  const r = resolveStyle(layers, width);
  r.problems.unshift(...problems);
  const sheetStamp = board ? SHEETS.stamp(SHEETS.of(src)) : 0;
  const pageStamp = place.page ? place.page.properties.filter(p => p.key.startsWith("style")).map(p => `${p.key}=${p.value}`).join(",") : "";
  return { ...r, layers, place, stamp: `${sheetStamp}|${t?.gen ?? 0}|${place.tile ?? ""}|${place.screen ?? ""}|${pageStamp}|${r.breakpoint ?? ""}` };
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
  byProp(key: string, value: string, limit?: number): Promise<Msg[]>;
  newNote(text: string, near: string | undefined, actor?: Actor): Promise<{ note: Msg }>;
  createBlock(parentId: string | null, text: string, actor?: Actor): Promise<Msg>;
  propertyTokens(blockId: string, key: string): Promise<{ revision: number; tokens: PropertyToken[] }>;
  patchProperties(blockId: string, expectedRevision: number, operations: PropertyPatch[], actor?: Actor): Promise<Msg>;
}

/** Words for a target: `global`, `tile detail`, `screen desk`, `this page`. */
export const targetWords = (t: TuneTarget) => (t === "global" ? "global" : t.startsWith("page:") ? "this page" : t.includes(":") ? t.replace(":", " ") : `style ${t}`);

/**
 * Writes `target`'s unwritten nudges to the outline as `actor`: a page's onto its own note, a level's onto its newest
 * style note that declares it as the note's own properties (each field replaced where it is, else added), else a new
 * style note for it. Every write names the revision it read; a conflict is refused, never overwritten. The nudges stay
 * over the outline until its answer says the same.
 */
export async function saveTuning(src: ListSource & { board: StyleWriteBoard }, target: TuneTarget, actor: Actor = USER): Promise<Saved | null> {
  const t = tuningOf(src.board), entry = t.unsaved().find(u => u.target === target);
  if (!entry) return null;
  const props = entry.fields.map(([k, v]) => { const f = parseFieldKey(k)!; return { key: styleProperty(f.token, f.variant), value: v }; });
  const board = src.board;
  const patchOnto = async (id: string) => {
    const ops: PropertyPatch[] = [];
    let revision = 0;
    for (const p of props) {
      const r = await board.propertyTokens(id, p.key);
      revision = r.revision;
      const own = r.tokens.find(x => x.scope === "block");
      ops.push(own ? { op: "replace", ordinal: own.ordinal, value: p.value } : { op: "append", key: p.key, value: p.value });
    }
    const m = await board.patchProperties(id, revision, ops, actor);
    return m;
  };
  let note: string, created = false;
  if (target.startsWith("page:")) {
    note = target.slice(5);
    await patchOnto(note);
  } else {
    const sheets = sheetsOf(src);
    const own = sheets.filter(s => s.for === target && s.line === undefined).at(-1);
    if (own) { note = own.block; await patchOnto(note); }
    else {
      const parent = await styleHome(board, sheets, actor);
      const text = `Style · ${targetWords(target)} [style-for::${target}] ${props.map(p => `[${p.key}::${p.value}]`).join(" ")}`;
      note = (await board.createBlock(parent, text, actor)).id;
      created = true;
    }
  }
  t.markSaved(target, entry.fields.map(([k]) => k));
  SHEETS.stale(board);
  return { target, note, fields: props.map(p => `${p.key}=${p.value}`), created };
}

export type { ResolvedStyle };
