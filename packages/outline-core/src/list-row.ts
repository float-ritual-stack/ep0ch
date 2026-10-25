// The list primitive's wire: a row, the one thing ⏎ does on it, and the primitive a view (or a built-in component)
// answers with. ADR 0004 contract 3. Every client draws the same rows: the door's one ListView over RowView, Detail
// as text, the publisher as `<ul>`, Markdown as a bulleted list, JSON as the rows, CSV as label and detail. The
// service checks a view's `list` against this (outliner component-primitives.ts); this file does no I/O.

import { prepareSearchQuery, matchesSearchText, type SearchQuery } from "./search-match";
import type { RuleTone } from "./rules";

/** The tones a row is drawn in: the component primitives' (`good`, `warn`, … ). */
export type ListTone = RuleTone;

/**
 * What ⏎ does on a row: exactly one of four things, never several (the service refuses a row with two). It runs as
 * the picker, under the picker's rules (ADR 0004 §3): `open` lands where the picker's opens land; `run` goes through
 * the dispatcher's actor rules; `insert` goes only into the picker's own draft; `copy` puts text on the person's
 * clipboard and answers an agent with the text.
 */
export type Activation =
  | { open: string }
  | { run: { action: string; args?: Record<string, string> } }
  | { copy: string }
  | { insert: string };

export type ActivationKind = "open" | "run" | "copy" | "insert";
export const ACTIVATION_KINDS: readonly ActivationKind[] = ["open", "run", "copy", "insert"];

/** A row of a list. `do` absent: a header (nothing to pick). `id` is unique in its list and keys its view state. */
export interface ListRow {
  id: string;
  label: string;
  detail?: string;
  mark?: string;
  tone?: ListTone;
  group?: string;
  /** What the list shows beside (or below) it while the row is selected: a block drawn as an embed, or Blockdown. */
  preview?: { block: string } | { markdown: string };
  do?: Activation;
}

/** A named run of rows, drawn under its header. `count` is how many rows it holds before any filter. */
export interface ListGroup { name: string; label: string; glyph?: string; count: number; note?: string }

export const LIST_PREVIEWS = ["right", "below", "none"] as const;
export type ListPreviewSide = (typeof LIST_PREVIEWS)[number];

/** The `list` view primitive (ADR 0004 §3). */
export interface ListPrimitive {
  type: "list";
  rows: ListRow[];
  groups?: ListGroup[];
  /** Where the selected row's preview goes; default none. */
  preview?: ListPreviewSide;
  /** `/` types words over the rows; default true. */
  filter?: boolean;
  /** The frame's "⏎ in" takes the keys; default true. */
  enter?: boolean;
  /** What an empty list says. */
  empty?: string;
}

/** The most rows a list holds (a component's answer cuts each group to this, with `more`). */
export const LIST_MAX_ROWS = 200;

/** The one activation a row carries, or null for a header. A row with several (a hand-built one) answers the first in the ADR's order. */
export function activationOf(row: Pick<ListRow, "do">): { kind: ActivationKind; value: string | { action: string; args?: Record<string, string> } } | null {
  const d = row.do as Record<string, unknown> | undefined;
  if (!d) return null;
  for (const kind of ACTIVATION_KINDS) if (d[kind] !== undefined) return { kind, value: d[kind] as string | { action: string; args?: Record<string, string> } };
  return null;
}

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
