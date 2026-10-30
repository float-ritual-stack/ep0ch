// The door's one list (PIE-747, ADR 0004 contract 3): `ListView` is what the `list` primitive, the inline `::links`
// component and the links tile all draw and step through. It owns the rows it was last given, each actor's pick and
// filter (the person's drawn as the selection, an agent's in its tint, never moving the person's), the person's typed
// filter, and a `RowView` (scroll and the press gestures: select, open, open fresh). It decides nothing a host
// decides: where an open lands, what a row's note previews as, which rows the model narrows. Those stay with the
// host that draws it (the reader, the links tile), reached through `ListHandle`, the one seam `LISTVIEW_ACTIONS`
// (list.blocks, list.pick, list.step, list.open, list.filter, list.enter) runs over.
import { filterListRows, listHead, listSections, type ListPreviewSide, type ListPrimitive, type ListRow, type ListTone } from "@ep0ch/outline-core/list-row";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { dividerLine, listSlots, zebraRow } from "../list-look";
import { RowView, type RowGesture, type RowPress } from "../scroll";
import type { Actor } from "../socket";
import { C, ellipsize, fg, pad, RESET, selectedRow, tint, width } from "../style";
import { rowLines } from "../text";
import type { LineField } from "./line";
import { paintRange } from "./selection";

/** The person's key in a list's picks and filters (an agent's is its actor id). */
export const PERSON = "you";
export const actorKey = (actor: Actor): string => (actor.kind === "agent" ? actor.id : PERSON);

/**
 * A row as the door draws it: the wire's `ListRow` plus what only a terminal needs. `depth` nests a row under its
 * header, `join` is what joins its label to its detail, `ink` overrides its tone's colour, `paintDetail` inks the
 * detail's words (the stage families on a kind header), and `source` is the host's own row it stands for. `pick`
 * says whether the row can be selected when it carries no activation (a link whose note can't be read yet).
 */
export interface ListViewRow<S = unknown> extends ListRow {
  depth?: number;
  join?: string;
  ink?: number;
  paintDetail?: (detail: string) => string;
  pick?: boolean;
  source?: S;
  /**
   * Lines drawn under the label, hanging under it, one row each (cut to the width): a card's preview line and its chips
   * (the navigator's rows, PIE-1443). Painted by the host; dim unless it painted them.
   */
  body?: string[];
}

const TONE_INK: Record<ListTone, number> = { default: C.white, good: C.lgreen, warn: C.yellow, bad: C.lred, dim: C.dark, accent: C.lcyan };

/** Whether a row can be selected: it does something when picked, or its host says it can be. */
export const selectable = (row: ListViewRow): boolean => row.pick ?? !!row.do;

/** What a drawn row needs of its list. */
export interface RowDraw<S = unknown> {
  cols: number;
  /** The most lines a row may take (it wraps, hanging under its label). */
  lines?: number;
  selected?: boolean;
  /** The list has the keys: the selection is the lit band, else the idle one. */
  focused?: boolean;
  /** An agent's pick: the row in its tint. */
  agent?: boolean;
  /** Tags the row's text as the link the reader steps to. */
  tag?: (row: ListViewRow<S>, text: string) => string;
}

/** The look a list takes from its tile or note: the rows between rows and the stripe under every other one. */
export type ListLook = Pick<StyleValues, "list.gap" | "list.divider" | "list.divider.align" | "list.zebra"> & Partial<Pick<StyleValues, "list.divider.glyph" | "list.zebra.bg" | "list.zebra.strength" | "rows.lines">>;

/**
 * One row as drawn, `cols` wide: indented by its depth, its mark, its label and dim detail, lit while selected. Every
 * list draws a row with this: the links tile, the inline components, the tree's links and an extension's `list`.
 */
export function listRowLines<S>(r: ListViewRow<S>, o: RowDraw<S>): string[] {
  const head = `${"  ".repeat(r.depth ?? 0)}${r.mark ?? ""} `;
  const colour = r.ink ?? TONE_INK[r.tone ?? "default"];
  const detail = r.detail ? (r.join ?? " · ") + (r.paintDetail ? r.paintDetail(r.detail) : r.detail) : "";
  const text = head + r.label + fg(C.dark) + detail + RESET;
  const lines = rowLines(o.tag ? o.tag(r, text) : text, o.cols - (o.selected && !head.startsWith(" ") ? 1 : 0), o.lines, { hang: width(head) });
  const indent = " ".repeat(width(head));
  // Cut plainly: a body line is a preview, so the selection never reveals what it cut (the label's line does).
  for (const b of r.body ?? []) lines.push(fg(C.dark) + ellipsize(indent + b, o.cols - (o.selected ? 1 : 0)) + RESET);
  return lines.map(line => {
    if (o.selected) return selectedRow(line, o.cols, o.focused ?? true, "idleRow");
    const body = pad(fg(colour) + line, o.cols) + RESET;
    return o.agent ? paintRange(body, 0, o.cols, tint("agent")) : body;
  });
}

/**
 * The rows a `list` primitive draws, flat: each section's header (a row that can't be picked) then its rows, nested
 * under it. A row with no mark is a dot, or a square when it does nothing (a header the view wrote itself).
 */
export function listRowsOf(node: Pick<ListPrimitive, "rows" | "groups">): ListViewRow[] {
  return listSections(node).flatMap(({ head, rows }) => [
    ...(head ? [{ id: `\u0000group:${head.name ?? head.label}`, label: listHead(head), mark: "▾", tone: "warn" as const, pick: false, group: head.name ?? head.label, ...(head.note ? { detail: head.note } : {}) }] : []),
    ...rows.map((r): ListViewRow => ({ ...r, mark: r.mark ?? (r.do ? "·" : "■"), depth: head ? 1 : 0 })),
  ]);
}

/** What a list says it holds, for `list.blocks` and `peek`: one row as an agent reads it. */
export interface ListRowInfo { n: number; id: string; text: string; detail?: string; kind?: string; group?: string; selected?: true; pickedBy?: string[] }

/** The preview beside or under a list: its rows, `of` the selected row at a width. */
export interface ListPreview<S> {
  side: ListPreviewSide;
  /** The narrowest the frame goes beside the list in; narrower, under it. */
  minWidth?: number;
  /** The most rows it draws; the rest is a ⏎ away. */
  maxRows?: number;
  of(row: ListViewRow<S>, width: number): string[] | null;
}

export interface ListDrawOpts<S> {
  /** The width of the list and its preview together. */
  cols: number;
  lines?: number;
  focused: boolean;
  /** Draw the person's selection (an inline list shows one only when it previews or the person is in it; a tile always). */
  selection: boolean;
  tag?: (row: ListViewRow<S>, text: string) => string;
  /** The viewport: the most drawn lines, scrolled with this view's RowView; all of them when absent (the reader clips). */
  room?: number;
  look?: ListLook;
  /** Whether a divider goes above a row (the links tile divides its groups); default none. */
  divide?: (row: ListViewRow<S>) => boolean;
  preview?: ListPreview<S>;
  /** What an empty list says. */
  empty?: string;
  /** Draw the `/ words` line while the person types or a filter is kept (default true; a tile says it in its status line). */
  filterLine?: boolean;
}

export interface ListDrawn<S> {
  lines: string[];
  /** The visible row each drawn line belongs to (its index in `visible()`), or null for spacing, the filter line or a preview. */
  rowAt: (number | null)[];
  /** The row the preview shows, when there is one. */
  previewed: ListViewRow<S> | null;
  /** Whether the preview sat beside the list. */
  beside: boolean;
  /** The columns the list took (the rest is the preview's). */
  listCols: number;
}

export class ListView<S = unknown> {
  readonly view = new RowView();
  private all: ListViewRow<S>[] = [];
  private picks = new Map<string, string>();
  private filters = new Map<string, string>();
  /** The person's filter while they type it (`/`): applied as it's typed, ⏎ keeps it, esc goes back to what it was. */
  typing: LineField | null = null;
  private was = "";

  /**
   * `narrows`: whether this view narrows its rows by a typed filter. A host whose model narrows its own (the links
   * model: its counts, kinds and sorts follow the filter) says false, reads `filter()` and gives the rows narrowed.
   */
  /** What kind of component draws here: a positional key (`#2`) keeps its state only while the component there is the same kind of thing. */
  signature = "";

  constructor(readonly key: string, readonly narrows = true) {}

  /**
   * The rows as the host gave them. A pick on a row that is not among them is kept: a host that narrows for the person
   * leaves out rows other actors have picked, and they come back with the filter cleared. `picked` only answers a row that is listed.
   */
  set(rows: readonly ListViewRow<S>[]) { this.all = [...rows]; }
  get rows(): readonly ListViewRow<S>[] { return this.all; }

  // ── filters ──────────────────────────────────────────────────────────────

  /** `who`'s filter: the person's as they type it, else as kept. */
  filter(who: string = PERSON): string { return who === PERSON && this.typing ? this.typing.text.trim() : this.filters.get(who) ?? ""; }
  /** Keep `words` as `who`'s filter (empty clears it). */
  setFilter(who: string, words: string) {
    const w = words.trim();
    if (w) this.filters.set(who, w); else this.filters.delete(who);
  }
  /**
   * The person starts typing a filter, from the one kept, in the line `field` makes from it (a LineField with no
   * completion: the caller makes it, since this file sits under the draft's own imports).
   */
  startTyping(field: (was: string) => LineField): LineField {
    this.was = this.filters.get(PERSON) ?? "";
    return this.typing = field(this.was);
  }
  /** ⏎ keeps what was typed; esc goes back to what it was. */
  stopTyping(keep: boolean) {
    if (!this.typing) return;
    this.setFilter(PERSON, keep ? this.typing.text : this.was);
    this.typing = null;
  }

  /** The rows `who` sees: all, or those their filter leaves (the person's, when this view narrows; an agent's always). */
  visible(who: string = PERSON): readonly ListViewRow<S>[] {
    const words = this.filter(who);
    // A host that narrows for the person (the links model) still leaves an agent's filter to this view: it is the agent's own.
    return (this.narrows || who !== PERSON) && words ? filterListRows(this.all, words) : this.all;
  }

  // ── picks ────────────────────────────────────────────────────────────────

  /** The row `who` has picked among those they see; the person's falls to the first that can be selected. */
  picked(who: string = PERSON): ListViewRow<S> | null {
    const rows = this.visible(who), id = this.picks.get(who);
    const at = id !== undefined ? rows.find(r => r.id === id && selectable(r)) : undefined;
    return at ?? (who === PERSON ? rows.find(selectable) ?? null : null);
  }
  /** `who`'s pick as kept: a row id, whether or not it is listed now (null: none made). */
  pickedId(who: string = PERSON): string | null { return this.picks.get(who) ?? null; }
  /** Keep `id` as `who`'s pick without checking it against the rows (a host that moves its own selection by row, then draws). */
  setPick(who: string, id: string | null) {
    if ((this.picks.get(who) ?? null) === id) return;
    if (id === null) this.picks.delete(who); else this.picks.set(who, id);
    this.view.reveal();
  }
  /** The rows `who` can pick among those they see, numbered from 1 by `list.blocks` and `list.pick n=`. */
  pickable(who: string = PERSON): ListViewRow<S>[] { return this.visible(who).filter(selectable); }
  /** Whether `who` has picked anything of their own (the person's default first row isn't one). */
  hasPick(who: string): boolean { return this.picks.has(who); }
  /** Pick a row by id for `who`; the row, or why not. */
  pick(who: string, id: string): ListViewRow<S> {
    const rows = this.visible(who), row = rows.find(r => r.id === id);
    if (!row) throw new Error(`no row ${id} in ${this.key}`);
    if (!selectable(row)) throw new Error(`${row.label} is a header: it has nothing to pick`);
    this.picks.set(who, row.id);
    this.view.reveal();
    return row;
  }
  /** Move `who`'s pick `by` rows among those that can be selected; null where there's no row that way. */
  step(who: string, by: number): ListViewRow<S> | null {
    const rows = this.pickable(who), at = rows.findIndex(r => r.id === this.picked(who)?.id);
    const to = (at < 0 ? (by > 0 ? -1 : rows.length) : at) + Math.trunc(by);
    const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
    if (!row || (to < 0 || to >= rows.length) && at >= 0 && rows[at] === row) return null;
    this.picks.set(who, row.id);
    this.view.reveal();
    return row;
  }
  /** Forget `who`'s pick (their own, not the rows). */
  unpick(who: string) { this.picks.delete(who); }

  /** The agents with a pick or a filter here, for the line that says so and for `list.blocks`. */
  others(): { who: string; row: ListViewRow<S> | null; filter: string }[] {
    const who = new Set([...this.picks.keys(), ...this.filters.keys()]);
    who.delete(PERSON);
    return [...who].map(w => ({ who: w, row: this.picked(w), filter: this.filter(w) }));
  }

  // ── what a list says it holds ────────────────────────────────────────────

  describe(who: string = PERSON, describeRow?: (row: ListViewRow<S>, n: number) => Partial<ListRowInfo>, marked: string = PERSON): ListRowInfo[] {
    const rows = this.pickable(who), mine = this.picked(marked)?.id;
    return rows.map((r, i) => ({
      n: i + 1, id: r.id, text: r.label, ...(r.detail ? { detail: r.detail } : {}), ...(r.group ? { group: r.group } : {}),
      ...(describeRow?.(r, i + 1) ?? {}),
      ...(r.id === mine ? { selected: true as const } : {}),
      ...(this.others().filter(o => o.who !== who && o.row?.id === r.id).length ? { pickedBy: this.others().filter(o => o.who !== who && o.row?.id === r.id).map(o => o.who) } : {}),
    }));
  }

  // ── presses ──────────────────────────────────────────────────────────────

  /** A press on visible row `i`: select, open, open fresh, or only focus. */
  press(i: number, p: RowPress = {}): RowGesture { return this.view.press(i, p); }

  // ── drawing ──────────────────────────────────────────────────────────────

  /**
   * The list drawn: the person's filter line while they type, the rows (spaced by the look, scrolled in `room`), the
   * line that says what each agent has picked, and the selected row's preview beside or under them. Nothing the
   * host decides: `tag` turns a row's text into the reader's link, `preview.of` draws the row's note.
   */
  draw(o: ListDrawOpts<S>): ListDrawn<S> {
    const rows = this.visible(), mine = o.selection ? this.picked() : null;
    const others = this.others();
    const agentRows = new Map<string, string[]>();
    for (const a of others) if (a.row) agentRows.set(a.row.id, [...(agentRows.get(a.row.id) ?? []), a.who]);
    const preview = o.preview && mine ? o.preview : null;
    const beside = !!preview && preview.side === "right" && o.cols >= (preview.minWidth ?? 70);
    const lw = beside ? Math.max(20, Math.floor(o.cols * 0.42)) : o.cols, pw = beside ? o.cols - lw - 3 : o.cols;
    const lines: string[] = [], at: (number | null)[] = [];
    const push = (line: string, row: number | null) => { lines.push(line); at.push(row); };
    const kept = this.filter();
    if (o.filterLine !== false && (this.typing || kept)) push(fg(C.yellow) + pad(`/ ${this.typing ? this.typing.plain() : kept}`, lw) + RESET, null);
    // The rows an agent's say-so takes at the bottom come out of the viewport, never past the tile: as many as fit beside one row.
    const sayers = others.filter(a => a.row || a.filter).slice(0, o.room === undefined ? undefined : Math.max(0, o.room - 1 - lines.length));
    const says = sayers.length;
    const drawn = rows.map((r, i) => listRowLines(r, { cols: lw, lines: o.lines, selected: r.id === mine?.id, focused: o.focused, agent: agentRows.has(r.id), ...(o.tag ? { tag: o.tag } : {}) }));
    // The selected row is shown with the heading it sits under (a group's, PIE-1448): the rows that can't be picked just
    // above it come into view with it, so the list's first group never scrolls its heading away.
    const selAt = mine ? rows.findIndex(r => r.id === mine.id) : -1;
    let headAt = selAt;
    while (headAt > 0 && !selectable(rows[headAt - 1]!)) headAt--;
    // The heading the selected row sits under, however far above it: when it has scrolled off, it is drawn on its own
    // at the top, over its rows (a sticky heading), so the 11th note of Today still says Today.
    let groupHead = selAt - 1;
    while (groupHead >= 0 && selectable(rows[groupHead]!)) groupHead--;
    if (!rows.length) push(fg(C.dark) + (o.empty ?? "nothing here yet") + RESET, null);
    else if (o.look) {
      const { slots, at: starts } = listSlots(rows.length, o.look, i => !!o.divide?.(rows[i]!), drawn.map(r => r.length));
      const sel = selAt;
      let room = o.room === undefined ? slots.length : Math.max(1, o.room - says - lines.length);
      const reveal = sel < 0 ? null : [starts[headAt] ?? starts[sel] ?? 0, (starts[sel] ?? 0) + (drawn[sel]?.length ?? 1) - 1] as [number, number];
      let top = this.view.place(sel < 0 ? null : sel, slots.length, room, reveal);
      if (groupHead >= 0 && room > 2 && top > (starts[groupHead] ?? 0)) {
        room -= 1; top = this.view.place(sel, slots.length, room, reveal);
        push(drawn[groupHead]![0]!, groupHead);
      }
      for (const slot of slots.slice(top, top + room)) {
        if ("item" in slot) push(zebraRow(drawn[slot.item]![slot.line ?? 0]!, slot.item, lw, o.look, slot.item === sel), slot.item);
        else push("divider" in slot ? dividerLine(o.look, lw) : "", null);
      }
    } else {
      const flat = drawn.flatMap((ls, i) => ls.map(l => [l, i] as const));
      const sel = selAt;
      const first = drawn.slice(0, Math.max(sel, 0)).reduce((n, l) => n + l.length, 0), head = drawn.slice(0, Math.max(headAt, 0)).reduce((n, l) => n + l.length, 0);
      let room = o.room === undefined ? flat.length : Math.max(1, o.room - says - lines.length);
      const reveal = sel < 0 ? null : [Math.max(0, Math.min(head, first)), first + (drawn[sel]?.length ?? 1) - 1] as [number, number];
      let top = this.view.place(sel < 0 ? null : sel, flat.length, room, reveal);
      const headLine = groupHead >= 0 ? drawn.slice(0, groupHead).reduce((n, l) => n + l.length, 0) : -1;
      if (groupHead >= 0 && room > 2 && top > headLine) {
        room -= 1; top = this.view.place(sel, flat.length, room, reveal);
        push(drawn[groupHead]![0]!, groupHead);
      }
      for (const [l, i] of flat.slice(top, top + room)) push(l, i);
    }
    // Each agent's own pick and filter, in its tint: it never moved the person's.
    for (const a of sayers) {
      const said = [a.row ? `◆ ${a.row.label}` : "", a.filter ? `/ ${a.filter}` : ""].filter(Boolean).join("  ");
      if (said) push(paintRange(pad(` ${a.who.replace(/^.*:/, "")}: ${said}`, lw), 0, lw, tint("agent")) + RESET, null);
    }
    // The selected row's note, beside the list or under it.
    let pv: string[] = [];
    if (preview && mine) {
      const got = preview.of(mine, pw);
      const max = preview.maxRows ?? 16;
      if (got) pv = got.length > max ? [...got.slice(0, max - 1), fg(C.dark) + `… ${got.length - max + 1} more rows · ⏎ opens it` + RESET] : got;
    }
    if (beside) {
      const n = Math.max(lines.length, pv.length), out: string[] = [], outAt: (number | null)[] = [];
      for (let i = 0; i < n; i++) { out.push(pad(lines[i] ?? "", lw) + fg(C.dark) + " │ " + RESET + (pv[i] ?? "")); outAt.push(at[i] ?? null); }
      return { lines: out, rowAt: outAt, previewed: mine, beside, listCols: lw };
    }
    if (pv.length) return { lines: [...lines, fg(C.dark) + "─".repeat(Math.min(o.cols, 40)) + RESET, ...pv], rowAt: [...at, null, ...pv.map(() => null)], previewed: mine, beside, listCols: lw };
    // `room` bounds what is drawn, whatever the filter line and the say-so lines took of it.
    const cut = o.room === undefined ? lines.length : Math.max(1, o.room);
    return { lines: lines.slice(0, cut), rowAt: at.slice(0, cut), previewed: mine, beside, listCols: lw };
  }
}

/** The handle a host gives for each list it draws: the one seam `LISTVIEW_ACTIONS` runs over (src/surface/list-actions.ts). */
export interface ListHandle<S = unknown> {
  /** Its number among the host's lists, from 1, in drawing order. */
  n: number;
  /** Its `^name`, else its position (`#2`): the key its view state is kept under. */
  key: string;
  /** The words a person calls it by (its title). */
  title: string;
  view: ListView<S>;
  /** The person is in it (their keys are its). */
  entered: boolean;
  /** Its question or source, when it has one (`list.blocks` says it). */
  about?: string;
  /** What only its host says of it (a links component's groups and the block its preview shows), merged into `list.blocks`. */
  detail?: Record<string, unknown>;
  /** Adds what only the host knows about a row (its kind, the note it stands for). */
  describeRow?(row: ListViewRow<S>, n: number): Partial<ListRowInfo>;
}
