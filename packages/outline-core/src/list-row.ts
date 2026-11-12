// The list primitive's wire: a row, the one thing ⏎ does on it, and the primitive a view (or a built-in component)
// answers with. ADR 0004 contract 3. Every client draws the same rows: the door's one ListView over RowView, Detail
// as text, the publisher as `<ul>`, Markdown as a bulleted list, JSON as the rows, CSV as label and detail. The
// service checks a view's `list` against this (outliner component-primitives.ts); this file does no I/O.

import { actionLine } from "./action-line";
import { prepareSearchQuery, matchesSearchText, type SearchQuery } from "./search-match";
import { QUESTION_MAX_LIMIT } from "./protocol";
import type { RuleTone } from "./rules";
import type { PagePrimitive } from "./note-page";

/** The tones a row is drawn in: the component primitives' (`good`, `warn`, … ). */
export type ListTone = RuleTone;

/**
 * What ⏎ does on a row: exactly one of four things, never several (the service refuses a row with two). It runs as
 * the picker, under the picker's rules (ADR 0004 §3): `open` lands where the picker's opens land; `run` goes through
 * the dispatcher's actor rules; `insert` goes only into the picker's own draft; `copy` puts text on the person's
 * clipboard and answers an agent with the text.
 */
export type ListOpenWhere = "current" | "beside" | "float" | "full";
export interface ListOpen { ref: string; where?: ListOpenWhere; revision?: number; at?: number; atLabel?: string; atSays?: string }

export type Activation =
  | { open: string | ListOpen }
  | { run: { action: string; args?: Record<string, string> } }
  | { copy: string }
  | { insert: string };

export type ActivationKind = "open" | "run" | "copy" | "insert";
export const ACTIVATION_KINDS: readonly ActivationKind[] = ["open", "run", "copy", "insert"];

/** A row of a list. `do` absent: a header (nothing to pick). `id` is unique in its list and keys its view state. */
export type ListCell = string | number | { text: string; act?: string; link?: string; revision?: number; tone?: ListTone };
export const listCellText = (cell: ListCell): string => typeof cell === "object" ? cell.text : String(cell);

export interface ListRow {
  id: string;
  label: string;
  detail?: string;
  mark?: string;
  tone?: ListTone;
  group?: string;
  cells?: ListCell[];
  cover?: string;
  bind?: string;
  body?: string[];
  /** What the list shows beside (or below) it while the row is selected: a block drawn as an embed, or Blockdown. */
  preview?: { block: string } | { markdown: string };
  do?: Activation;
  /** The properties it carries that the list shows on it, as its author wrote them: any key. */
  chips?: ListChip[];
  /**
   * The act line a pick runs, as any door's dispatcher reads it (`open id=…`, `screen.open name=…`): `do`, said as a
   * line by the one rule (`actOf`), for a client that parses no activation. A row that copies or inserts has none.
   */
  act?: string;
  /** In a tree (`arrange: "tree"`): how deep it sits under the list's top (0), */
  depth?: number;
  /** whether anything is under it, whether what is under it is listed after it, and how many notes that is (said once they are). */
  folds?: boolean;
  open?: boolean;
  kids?: number;
  /**
   * What the row shows under itself, drawn as any primitive is: a proposal's change (a `diff`), a thread's replies, a
   * component's own example. A row that `folds` in a list whose source reads `open` carries it while it is open
   * (`lists.read`'s `open` names the rows that are), so a long one is answered only when asked for.
   */
  view?: PagePrimitive;
}

/** A property a row shows: its key and one of its values, as written. */
export interface ListChip { key: string; value: string }

/** The act line an activation is: an open is `open id=<ref>`, a run its action and arguments; a copy and an insert are no act. */
export function actOf(d: Activation | undefined): string | undefined {
  if (!d) return undefined;
  if ("open" in d) return actionLine({ action: "open", args: { id: typeof d.open === "string" ? d.open : d.open.ref } });
  if ("run" in d) return actionLine({ action: d.run.action, ...(d.run.args ? { args: d.run.args } : {}) });
  return undefined;
}

/** A named run of rows, drawn under its header. `count` is how many rows it holds before any filter. */
export interface ListGroup { name: string; label: string; glyph?: string; count: number; note?: string; ids?: string[]; groups?: ListGroup[] }

export const LIST_PREVIEWS = ["right", "below", "none"] as const;
export type ListPreviewSide = (typeof LIST_PREVIEWS)[number];

/** The `list` view primitive (ADR 0004 §3). */
export interface ListPrimitive {
  type: "list";
  rows: ListRow[];
  /** `tree`: rows carry `depth`, `folds` and `open`, and sit in the order they are drawn (a served list's; a view's list has the other four). */
  arrange?: "table" | "rows" | "grid" | "lanes" | "tree";
  size?: "small" | "large";
  columns?: string[];
  headers?: string[];
  page?: number;
  groups?: ListGroup[];
  /** Where the selected row's preview goes; default none. */
  preview?: ListPreviewSide;
  /** `/` types words over the rows; default true. */
  filter?: boolean;
  /** The frame's "⏎ in" takes the keys; default true. */
  enter?: boolean;
  /** What an empty list says. */
  empty?: string;
  /** The title of the tile it fills (PIE-1525: a render tile's frame, "outbox · 3 waiting on 2 people"); a list in a note ignores it. */
  title?: string;
}

/** A key the listed notes carry, with the values it takes among them and how many carry each: a list's chips to narrow by. */
export interface ListFacet { key: string; count: number; values: { value: string; count: number }[]; more?: number }

/** What a list is asked for by name (`lists.read`'s `from`), as it says of itself: every client lists the sources from these rows. */
export interface ListSource {
  from: string;
  /** What it lists, in a few words (a bar's title over its line). */
  about: string;
  /** What to type for it, when words narrow it. */
  placeholder?: string;
  /** The parameters it reads, each with what it means. */
  params: { name: string; about: string; required?: true }[];
  /**
   * A command bar lists it: under `all` when `main`, alone by its name. `facets`: its answer carries the facets its
   * matches have, so a facet picked anywhere is a term of its question (the bar opens on it).
   */
  bar?: { main?: true; facets?: true };
}

/**
 * `lists.read`'s answer: one list, whatever it is of (a tree, a query's matches, a search, a note's links, lanes, facets).
 * Every row says what it shows and the act line a pick runs; the list says how it is arranged and, for a table, its columns.
 */
export interface ListAnswer {
  from: string;
  list: ListPrimitive;
  /** The property keys the listed notes carry, counted over every match: chips that narrow the question. */
  facets?: ListFacet[];
  /** What the service says of the question where rows would be ("no notes have <key>; nearest: …"). */
  hint?: string;
  /** How many there are in all, when the list holds fewer. */
  total?: number;
  truncated?: boolean;
  /** A tree: the folders whose notes are listed (asked for and there). */
  open?: string[];
  /** The property the rows are sorted and grouped by, as asked: names, never a list a client keeps. */
  sort?: string;
  group?: string;
  /** `from: "sources"`: the sources as they say of themselves, a row of the list each (what a client reads; the rows are for a person). */
  sources?: ListSource[];
  /** A watched answer hears every change. */
  anyChange: true;
}

/** The most rows a list holds (a component's answer cuts each group to this, with `more`). */
export const LIST_MAX_ROWS = QUESTION_MAX_LIMIT;

/** The one activation a row carries, or null for a header. A row with several (a hand-built one) answers the first in the ADR's order. */
export function activationOf(row: Pick<ListRow, "do">): ({ kind: ActivationKind; value: string | { action: string; args?: Record<string, string> } } & Omit<ListOpen, "ref">) | null {
  const d = row.do as Record<string, unknown> | undefined;
  if (!d) return null;
  if (d.open && typeof d.open === "object") { const { ref, ...target } = d.open as ListOpen; return { kind: "open", value: ref, ...target }; }
  for (const kind of ACTIVATION_KINDS) if (d[kind] !== undefined) return { kind, value: d[kind] as string | { action: string; args?: Record<string, string> } };
  return null;
}

export const openedRef = (row: Pick<ListRow, "do">): string | undefined => row.do && "open" in row.do ? typeof row.do.open === "string" ? row.do.open : row.do.open.ref : undefined;

/** How many of the four a `do` names: the validator wants exactly one. */
export const activationCount = (d: object): number => ACTIVATION_KINDS.filter(k => (d as Record<string, unknown>)[k] !== undefined).length;

/** Whether `words` (a typed filter, `/`) match a row: the one matcher, over its label, detail and mark. An empty filter matches all. */
export function listRowMatches(row: Pick<ListRow, "label" | "detail" | "mark">, words: string | SearchQuery | null): boolean {
  const q = typeof words === "string" ? prepareSearchQuery(words) : words;
  return !q || matchesSearchText(q, [row.label, row.detail ?? "", row.mark ?? ""]);
}

/** The rows `words` leave, in their order. A header (a row with no activation) stays while any row of its group does. */
export function filterListRows<R extends Pick<ListRow, "id" | "label" | "detail" | "mark" | "group" | "do">>(rows: readonly R[], words: string): R[] {
  const q = prepareSearchQuery(words);
  if (!q) return [...rows];
  const keep = rows.map(r => listRowMatches(r, q));
  const groups = new Set(rows.filter((r, i) => keep[i] && r.do).map(r => r.group ?? ""));
  return rows.filter((r, i) => (r.do ? keep[i] : keep[i] || groups.has(r.group ?? "")));
}

/** A section of a list as every client draws it: its header (absent for the rows that name no group) and its rows. */
export interface ListSection { head: { name?: string; label: string; glyph?: string; count?: number; note?: string } | null; rows: ListRow[] }

/**
 * A list's rows in the sections they are drawn in, every renderer's order: the rows that name no group, then each
 * declared group's (its header from `groups`), then the groups only a row names. A row with no `do` is a header.
 */
export function listSections(node: Pick<ListPrimitive, "rows" | "groups">): ListSection[] {
  if (node.groups?.some(group => group.ids)) {
    const byId = new Map(node.rows.map(row => [row.id, row]));
    const sections = (groups: ListGroup[], prefix = ""): ListSection[] => groups.flatMap(group => group.groups?.length
      ? sections(group.groups, `${prefix}${group.label} / `)
      : [{ head: { ...group, label: prefix + group.label }, rows: (group.ids ?? []).flatMap(id => byId.has(id) ? [byId.get(id)!] : []) }]);
    return sections(node.groups);
  }
  const out: ListSection[] = [];
  const bare = node.rows.filter(row => row.group === undefined);
  if (bare.length) out.push({ head: null, rows: bare });
  const named = new Map<string, ListRow[]>();
  for (const row of node.rows) if (row.group !== undefined) named.set(row.group, [...(named.get(row.group) ?? []), row]);
  for (const group of node.groups ?? []) {
    out.push({ head: { name: group.name, label: group.label, ...(group.glyph ? { glyph: group.glyph } : {}), count: group.count, ...(group.note ? { note: group.note } : {}) }, rows: named.get(group.name) ?? [] });
    named.delete(group.name);
  }
  for (const [name, rows] of named) out.push({ head: { name, label: name }, rows });
  return out;
}

/** A section's header as words: `glyph label (count)`. */
export const listHead = (head: NonNullable<ListSection["head"]>): string =>
  `${head.glyph ? `${head.glyph} ` : ""}${head.label}${head.count !== undefined ? ` (${head.count})` : ""}`;
