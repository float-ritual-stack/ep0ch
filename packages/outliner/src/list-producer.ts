/*
 * What a list producer is, and what every producer of `lists.read` writes a row with: the request, the answer a
 * producer hands back, and the one way a row gets its act line (outline-core's `actOf`). `list-producers.ts` holds the
 * table and the lists of notes; `about-producers.ts` the lists about one note and about the asker's own parts.
 */
import type { ActionRow } from "@ep0ch/outline-core/action-row";
import { actOf, LIST_MAX_ROWS, type Activation, type ListAnswer, type ListRow, type ListSource } from "@ep0ch/outline-core/list-row";
import { Refusal } from "@ep0ch/outline-core/refusal";

/** What a client asks a list of. Declared here, beside the producers: types.ts names it once in the request union. */
export interface ListsRequest {
  id: string; action: "lists.read"; watch?: string; generation?: number;
  /** What to list: a producer's name (`sources` lists them). */
  from: string;
  /** The note it is about (a tree's top, a note's links, properties, threads, proposals and revisions). */
  of?: string | null;
  /** Words (a search) or a question in the views' grammar (a query, lanes, facets). */
  query?: string;
  /**
   * The rows that are open, by id: a tree's folders (their notes are listed under them), and in any list whose rows
   * fold, the ones whose `view` is answered (a revision's change, a component's example).
   */
  open?: string[];
  /** A property name to group by (lanes), as `blocks.query` reads `group`. */
  group?: string;
  /** `"<property|created|updated|title>[ asc|desc]"`, as `blocks.query` reads `sort`. */
  sort?: string;
  /** How the rows are arranged, when the asker says: `rows`, `table`, `lanes`, `grid`. */
  arrange?: string;
  /** The property names a table shows, in order (`title`, `updated` and `created` are the note's own). */
  columns?: string[] | string;
  /** A note's links: which groups (`children`, `outlinks,backlinks`), as a links tile saves them. */
  linkGroups?: string[] | string;
  limit?: number;
  /** The screens: the kinds and drawers the asker draws, as `screens.list` takes them. */
  kinds?: string[]; drawers?: string[];
  /** The asker's own actions, each as its row (outline-core's `ActionRow`): what `from: actions` lists. */
  actions?: ActionRow[];
  /** The screen the asker has open, by name: `from: actions` lists that screen's own keys first. */
  screen?: string;
  /** The programs the asker runs in its terminal tiles, each as it says of itself: what `from: programs` lists. */
  programs?: import("./list-programs").ProgramSaid[];
}

export type Own = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
/** A note as a producer reads one (`blocks.read`): `hasNotes` is whether notes are under it, what a row of notes folds by. */
export type Listed = { id: string; title?: string; hasNotes?: boolean; parentId?: string | null; updatedAt?: string; createdAt?: string; properties?: { key: string; value: string }[] };
export type Answered = Omit<ListAnswer, "from" | "anyChange">;
export interface Producer { row: ListSource; read(own: Own, request: ListsRequest): Promise<Answered> }

export const titled = (title: string | undefined) => title?.trim() ? title : "untitled";
/** A row, with the act line its pick runs said beside what it does (`actOf`, the one rule). */
export const row = (r: Omit<ListRow, "act">): ListRow => { const act = actOf(r.do); return act ? { ...r, act } : r; };
export const opens = (id: string): Activation => ({ open: id });
export const runs = (action: string, args: Record<string, string>): Activation => ({ run: { action, args } });
/** A press of its own inside a row (a cell): its words and the act line it runs, written by the same rule. */
export const press = (text: string, action: string, args: Record<string, string>) => ({ text, act: actOf(runs(action, args))! });
export const names = (v: string[] | string | undefined): string[] => (typeof v === "string" ? v.split(/[\s,]+/) : v ?? []).map(s => s.trim()).filter(Boolean);
export const capped = (limit: number | undefined) => Math.max(1, Math.min(typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : LIST_MAX_ROWS, LIST_MAX_ROWS));

/** The note a list about one note is of: asked by `of`, refused in words when none is named. */
export function subject(request: ListsRequest): string {
  if (typeof request.of !== "string" || !request.of) throw new Refusal("invalid", `lists.read from=${request.from} is about one note: name it with of=<a block id>`);
  return request.of;
}
