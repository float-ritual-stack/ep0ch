// The reader's row containers (PIE-1521): everything a note draws as rows the walk steps through (a collection, a live
// figure's rows, a ::links list, an embedded view's inline list) answers the walk the same three ways: step within, say
// "past the edge", land first or last. The walk (NoteSurface.stepReading) asks the container under the `[ ]` position, or
// the one drawn in the block it lands on, and nothing else; the next kind of rows is one adapter here, not a branch there.
// What a row does once the walk is on it (pick, open, preview) stays ListHost's (list-actions.ts): two seams, not one.
import { PERSON, type ListHandle, type ListViewRow } from "./list-view";
import type { InlineList } from "./inline-list";

/** A drawn element as the walk reads it: where it is (`row`, of the drawn body) and what it stands for. */
export type RowElement = {
  kind: string; row: number;
  link?: { figure?: { figure?: string }; listRow?: { key: string; row?: string }; inlineList?: { key: number; row: number } };
};

/** What the last layout drew, and the two ways a row is landed on; a NoteSurface lends it (`rowWorld`), a test can too. */
export interface RowWorld<E extends RowElement = RowElement> {
  readonly elems: readonly E[];
  /** The note line element `e` is drawn on (0 is the subject), or undefined when no line names it (a saved view's own rows). */
  lineOf(e: E): number | undefined;
  /** The note's source line `line`. */
  text(line: number): string;
  readonly inline: ReadonlyMap<number, InlineList>;
  readonly lists: readonly ListHandle<any>[];
  /** The `[ ]` position's element (an inline row selected before its repaint included), and a collection row picked before its element is drawn. */
  readonly cursor: E | undefined;
  readonly wanted: { key: string; row: string } | null;
  /** The person's pick in list `l` lands on `row`, as a click's does (ListHost.picked, the preview following it). */
  pick(l: ListHandle<any>, row: ListViewRow<any>): void;
  /** The `[ ]` position on row `row` of the inline list `place` is drawn in. */
  selectInline(place: E, row: number): void;
}

export interface RowContainer {
  /**
   * j k from the `[ ]` position: one row on (`moved`); `edge` when that would leave it (the walk goes on past it); `held`
   * when it has no rows to go to from its own control and keeps the position there (a tabs figure on an empty tab: ← →
   * still switch it).
   */
  step(by: 1 | -1): "moved" | "edge" | "held";
  /** Land on its first or last row, as a walk comes in; false when it has none. */
  land(at: "first" | "last"): boolean;
  /** Its block's own text above the rows is a stop of the walk (a saved view's last body line): k off its first row lands there, j from above stops there first. */
  readonly lead: boolean;
}

/** A ListView's rows drawn as elements (a collection; an extension's list view): it steps, picks and lands through the view. */
function listContainer(w: RowWorld<any>, l: ListHandle<any>, line: number | undefined, onRow = true): RowContainer {
  // No line names its rows (a saved view opened as its own note): its block is the note, and the note's own text its lead.
  // A component's line (`::view`) or an embed's (`!((id))`) draws as the rows themselves: no text of its own.
  const text = w.text(line ?? 0).trim(), lead = text !== "" && !text.startsWith("::") && !/^!\(\([^)]*\)\)$/.test(text);
  const land = (at: "first" | "last") => { const rows = l.view.pickable(), row = at === "first" ? rows[0] : rows.at(-1); if (row) w.pick(l, row); return !!row; };
  return {
    lead, land,
    // From a control of its own (its frame's "⏎ in"), not one of its rows: into its rows.
    step(by) {
      if (!onRow) return land(by > 0 ? "first" : "last") ? "moved" : "edge";
      const row = l.view.step(PERSON, by); if (!row) return "edge"; w.pick(l, row); return "moved";
    },
  };
}

/** A live figure drawing no rows (a tabs figure on an empty tab), from its own control: the position stays there. */
const EMPTY_FIGURE: RowContainer = { lead: false, step: () => "held", land: () => false };

/** An inline list's rows (a live figure's, a ::links list's, an embedded view's), selected through the element drawn for it. */
function inlineContainer<E extends RowElement>(w: RowWorld<E>, place: E, at: number | undefined): RowContainer {
  const list = w.inline.get(place.link!.inlineList!.key)!, n = list.rows.length;
  const land = (to: "first" | "last") => { if (!n) return false; w.selectInline(place, to === "first" ? 0 : n - 1); return true; };
  return {
    lead: false,
    // From a control of its own (a figure's tab, a links list's frame), not one of its rows: into its rows.
    step(by) {
      if (at === undefined) return land(by > 0 ? "first" : "last") ? "moved" : "edge";
      if (at + by < 0 || at + by >= n) return "edge";
      w.selectInline(place, at + by); return "moved";
    },
    land,
  };
}

/** The collection key `k` names, among the lists drawn. */
const collection = (w: RowWorld<any>, key: string | undefined) => key === undefined ? undefined : w.lists.find(l => l.key === key && l.collection);

/** The collection whose row the `[ ]` position is on (`j`, `]`, a click), or null (PIE-1501). */
export function collectionAtCursor(w: RowWorld<any>): ListHandle<any> | null {
  const row = w.cursor?.link?.listRow ?? w.wanted;
  return row?.row ? collection(w, row.key) ?? null : null;
}

/** The container the `[ ]` position is in: on one of its rows, or on a control of its own (a figure's tab). Null off every container. */
export function rowContainerAt<E extends RowElement>(w: RowWorld<E>): RowContainer | null {
  const onRow = collectionAtCursor(w);
  if (onRow) return listContainer(w, onRow, lineOfList(w, onRow.key));
  const link = w.cursor?.link;
  if (!link) return null;
  if (link.inlineList) {
    const place = w.elems.find(e => e.link?.inlineList?.key === link.inlineList!.key);
    if (place) return inlineContainer(w, place, link.inlineList.row);
  }
  // A figure's own control, or a non-collection list's row or control: its rows are the inline list its row elements are in.
  const figure = link.figure?.figure, key = link.listRow?.key;
  if (figure === undefined && key === undefined) return null;
  const rows = w.elems.filter(e => figure !== undefined ? e.kind === "row" && e.link?.figure?.figure === figure : e.link?.listRow?.key === key && e.link?.listRow?.row !== undefined);
  const place = rows.find(e => e.link?.inlineList);
  if (place) return inlineContainer(w, place, undefined);
  if (figure !== undefined) return EMPTY_FIGURE;
  // A list whose rows aren't an inline list (an extension's list view): its view steps them. A collection's controls are
  // none of its rows: the walk goes on from them.
  const l = w.lists.find(l => l.key === key && !l.collection);
  return l ? listContainer(w, l, lineOfList(w, key), link.listRow?.row !== undefined) : null;
}

/** The note line list `key`'s rows are drawn on, or undefined (a saved view opened as its own note: no line names them). */
function lineOfList(w: RowWorld<any>, key: string | undefined): number | undefined {
  for (const e of w.elems) if (e.link?.listRow?.key === key && e.link?.listRow?.row !== undefined) { const line = w.lineOf(e); if (line !== undefined) return line; }
  return undefined;
}

/** The container drawn in the block on note line `line`: a collection, else the first (j) or last (k) inline list there, else a list view's rows. Null when it draws no rows. */
export function rowContainerOn<E extends RowElement>(w: RowWorld<E>, line: number, by: 1 | -1): RowContainer | null {
  for (const e of w.elems) {
    const l = collection(w, e.link?.listRow?.key);
    if (l && e.link?.listRow?.row !== undefined && w.lineOf(e) === line) return listContainer(w, l, line);
  }
  const inline = w.elems.filter(e => e.link?.inlineList && w.lineOf(e) === line);
  const place = by > 0 ? inline[0] : inline.at(-1);
  if (place) return inlineContainer(w, place, undefined);
  // A list whose rows aren't an inline list (an extension's list view): its view lands, as from its control.
  for (const e of w.elems) {
    const key = e.link?.listRow?.key, l = e.link?.listRow?.row !== undefined && w.lineOf(e) === line ? w.lists.find(l => l.key === key) : undefined;
    if (l) return listContainer(w, l, line);
  }
  return null;
}

/** A collection no note line names (a saved view opened as its own note is only its rows): the walk's last resort, j landing on the kept pick. */
export function loneCollection(w: RowWorld<any>): RowContainer | null {
  const l = w.lists.find(l => l.collection && lineOfList(w, l.key) === undefined);
  if (!l) return null;
  const c = listContainer(w, l, undefined);
  return { ...c, land: at => { const kept = at === "first" ? l.view.picked(PERSON) : null; if (kept) { w.pick(l, kept); return true; } return c.land(at); } };
}
