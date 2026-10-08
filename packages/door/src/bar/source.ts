// The power bar's sources (PIE-656): what the bar lists, previews and does, one source per scope. The bar itself
// (src/bar/bar.ts) owns none of it: it asks each source for rows as the person types, draws the one picked on the
// right through the readers' own renderers, and hands a pick back to its source, which runs it through the shared
// paths (the dispatcher's actions, `open`, the drawer's goTo). The built-ins are src/bar/sources.ts; an extension's
// come from the outline service (`extensions.list`'s `barSources`, asked with `extensions.bar`), registered here by
// the extension binding (src/extensions.ts), as its tile kinds register in the tile-kind registry.
import type { Ctx, Screen } from "../app";
import type { Msg } from "../board";
import type { Dispatcher } from "../surface/dispatch";
import type { Actor } from "../socket";

/** One row of a source: what it says, how deep it sits (the tiles' tree), and what the source needs to pick it. */
export interface BarRow {
  /** Unique within its source (a tile's id, a note's id, an action's name). */
  key: string;
  label: string;
  /** Dim words after the label (where a tile is, who changed a note, an action's group). */
  detail?: string;
  /** How far it's indented: a tile's depth in its screen's layout tree. */
  depth?: number;
  /** A mark before it: ● the tile with the keys, ▸ a spine, ⧉ a float, ⇤ docked. */
  mark?: string;
  /** The key that does the same (an action's), drawn as a keycap. */
  keycap?: string;
  /** Why picking it would be refused now: drawn dim, and said when picked. */
  refused?: string;
  /** Rows of a source are grouped under headings by this (the tiles' screen), when it changes. */
  group?: string;
  data?: unknown;
}

/** What the bar draws on its right for a row: a note (through the note surface), Markdown (the readers' renderer), or plain lines. */
export type BarPreview = { note: string } | { markdown: string } | { lines: string[] } | null;

/** How a row is picked: ⏎, or the alternate (alt+⏎, an alt-click: a note in a new detail, a tile zoomed); and by whom. */
export interface PickHow { alt: boolean; actor: Actor }

/** What a source reaches: the door (its outline, dispatcher, drawer and screens) and the note in front of the person. */
export interface BarHost {
  ctx: Ctx;
  /** The door's dispatcher (every screen's, then the screen shown's). */
  dispatch: Dispatcher;
  /** The screens, the one shown last; and those kept in the background. */
  screens(): readonly Screen[];
  kept(): readonly Screen[];
  /** The note in the reader the person is in, or the screen's current one: the notes search starts near it. */
  near(): string | null;
  /** Read a note (cached for the bar's life). */
  note(id: string): Promise<Msg | null>;
}

export interface BarSource {
  /** Its scope's name (`tiles`, `notes`, an extension's `ext.<id>.<source>`). */
  id: string;
  /** Its tab's word. */
  title: string;
  /** Typed first, it scopes the bar to this source (`%` tiles, `/` notes). */
  prefix: string;
  /** What it lists, for `bar.open`'s answer and the bar's foot. */
  about: string;
  /** Its rows join the main list (no scope chosen): with nothing typed (`empty`), and as the person types (`typed`). */
  main: { empty: boolean; typed: boolean; most?: number };
  /** Its rows ask the service (the notes search, an extension's process): asked once typing pauses, not on every key. */
  asks?: boolean;
  /** The door's own, or the extension's id. */
  by: string;
  /** Rows for `query` (the prefix taken off). An answer that needs the service is a promise; the bar shows `…` meanwhile. */
  rows(query: string, host: BarHost): BarRow[] | Promise<BarRow[]>;
  /**
   * Asked once its rows came (the service's search, Jev re-ordering the same hits after a pause): the rows again with
   * a word for the bar's line (`jev ranked`), or null to keep them. The lit row stays lit.
   */
  later?(query: string, rows: BarRow[], host: BarHost, alive: () => boolean): Promise<{ rows: BarRow[]; said?: string } | null> | null;
  /** What the bar draws on its right while the row is lit. */
  preview(row: BarRow, host: BarHost): BarPreview | Promise<BarPreview>;
  /** Pick it: through the shared paths, as `how.actor`. */
  pick(row: BarRow, host: BarHost, how: PickHow): Promise<unknown>;
}

const sources: BarSource[] = [];
let changed: () => void = () => {};

/** Add a source (one of an id at a time: a source registered again replaces the one before, in its place). */
export function registerBarSource(s: BarSource) {
  const at = sources.findIndex(x => x.id === s.id);
  if (at >= 0) sources[at] = s; else sources.push(s);
  changed();
}
export function unregisterBarSource(id: string) {
  const at = sources.findIndex(x => x.id === id);
  if (at >= 0) { sources.splice(at, 1); changed(); }
}
/** Every source, the door's first, in the order they registered. */
export const barSources = (): readonly BarSource[] => sources;
export const barSource = (id: string): BarSource | undefined => sources.find(s => s.id === id || s.prefix === id || s.title === id);
/** The open bar hears when a source came or went (an extension added or removed). */
export function onBarSources(f: () => void) { changed = f; }

/** Open note `id` where the screen's opens land (alt: in a new detail, as alt+⏎ on a link), as `actor`. */
export async function openNote(id: string, host: BarHost, how: PickHow): Promise<unknown> {
  const top = host.screens().at(-1);
  // A screen with an open of its own (the desk's) takes fresh=: a new detail beside the tile with the keys.
  const args = how.alt && top?.dispatch?.has("open") ? { id, fresh: true } : { id };
  return how.actor.kind === "agent" ? host.dispatch.act({ action: "open", args }, how.actor) : host.dispatch.press("open", args);
}

