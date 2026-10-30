// The facets tile (PIE-881): the properties the notes have, each opening to its values with how many notes carry them
// and when one was last updated, narrowed by what is picked. A tag is one facet among the others (`#yomama` is the `tag`
// facet's value), `project=x/y/z` and `type=meeting` are two more: the same engine underneath, with no special case.
//
// A value is included (`+`) or excluded (`−`): several values of one facet are ORed, facets are ANDed, an exclusion is NOT.
// A path-shaped value (`project=x/y/z`, a nested tag) groups as a tree, and picking `x` includes `x/…` (`project=x/*`).
// The selection is the views' query grammar, shown as text (`e` edits it, `facets.query` sets it) and savable as a view, a
// lane on a hub, in one action (`facets.save`): a facet search becomes a saved query, never a client-side filter.
//
// The service answers all of it: `blocks.query` with the selection as `where` and `facets=true` counts every match, so the
// door never counts, narrows or parses a value (SocketBoard.facetList). It only writes the selection as text. Every key and
// click is an action (FACETS_ACTIONS), so `act` reaches them with no tile open.
import { weekday } from "@ep0ch/outline-core/figure-props";
import { subject, type Msg } from "../board";
import { USER, type Actor, type FacetAnswer } from "../socket";
import { ActionRefused, actionSet, def, keysText } from "../surface/actions";
import { C, fg, pad, RESET, selectedRow, width } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ago, rowLines } from "../text";
import { RowView, wheelRows, clamp, type RowPress } from "../scroll";
import { LineField } from "../surface/line";
import { askInBar } from "../bar/ask";
import { blockRefText } from "@ep0ch/outline-core/link-syntax";
import { findBoards } from "./query";
import { prop, propValues } from "../props";
import { ListView, PERSON, actorKey, type ListViewRow } from "../surface/list-view";
import type { ListHost } from "../surface/list-actions";
import { ATTACHED_PLACES, AttachedTile, attachedPlaceOf, attachedRect, drawAttachedFloat, nextPlace, type AttachedPlace, type AttachedSide } from "../surface/attached";
import type { AttachedOwner, Attachment } from "./attached-tile";
import { drawCalendar } from "../figures/days";
import { chipsOf, matchGroups, matchRows, MORE, type MatchGroup } from "./facets-matches";

/** A step past every row: End and G (the list clamps it to its last row). */
const PAST_END = 1e9;
import { bucketWhere, dayBound, dayOfClause } from "@ep0ch/outline-core/date-buckets";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";

/** How the values are sorted: by how many notes carry them (most first), by name, by when one was last updated (newest first). */
export const FACET_SORTS = ["uses", "name", "last"] as const;
export type FacetSort = (typeof FACET_SORTS)[number];

/** A pick (no value means the whole key): `mode` says whether the notes must carry it or must not; `path`: it stands for everything below it too. */
export interface Clause { key: string; value?: string; mode: "include" | "exclude"; path?: boolean }
interface Value { value: string; count: number; last: number }
/** A node of a facet's tree of path-shaped values: its own value's figures (when a note carries exactly it) and what is below. */
interface Node { path: string; label: string; depth: number; value?: Value; kids: Node[]; open: boolean }

type Row =
  | { kind: "clause"; clause: Clause }
  | { kind: "facet"; key: string; count: number; open: boolean; more: number }
  | { kind: "value"; key: string; node: Node; state: Clause["mode"] | null; zero: boolean }
  | { kind: "day"; day: string }
  | { kind: "views"; count: number; open: boolean }
  | { kind: "view"; view: Msg }
  | { kind: "views-more"; count: number }
  | { kind: "note"; note: Msg }
  | { kind: "more"; group: string };

const HINT = "j k pick · ⏎ or click includes a value, again excludes it, again drops it · + − 0 · e edit the query · v save as a view · s sort · z zero · x clear · ctrl+o moves Matches · * pin · t tag · d today";
/** What the Matches list shows of a row unless the tile says (`show=`): its tags. Any key goes (properties are open). */
const SHOW = ["tag"];
/** A day picked on the calendar, as the views' grammar writes it (the service's day, as `updated >= YYYY-MM-DD` reads). */
export const dayClause = (day: string) => { const d = dayWords(day); return `updated >= "${d}" updated <= "${d}"`; };
/** A day as the query grammar reads it on the host's wall clock (`29 Oct 2026`; a bare YYYY-MM-DD is a UTC day). */
const dayWords = (day: string) => { const [y, m, d] = day.split("-").map(Number) as [number, number, number]; return dayBound(y, m, d).slice(1, -1); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The rows the calendar takes at the foot of the tree: a month heading, the weekdays and up to six weeks. */
const CAL_ROWS = 8, CAL_COLS = 28;
/** Saved views listed before a "▸ more views" row. */
const VIEWS_SHOWN = 8;
const USES = 5, LAST = 5;
const SAFE_VALUE = /^[\w./@*-]+$/u;

/** One clause as the views' grammar writes it: `#tag` for a tag, `key=value` (quoted when it needs it, `/*` for a path). */
export function clauseText(c: Clause): string {
  // A path's `/*` goes inside the quotes with it: `"back garden/*"` (the grammar takes nothing after a closing quote).
  if (c.value === undefined) return c.mode === "exclude" ? `NOT ${c.key}` : c.key;
  const value = c.value + (c.path ? "/*" : "");
  const term = c.key === "tag" ? `#${c.value}` : `${c.key}=${SAFE_VALUE.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`}`;
  return c.mode === "exclude" ? `NOT ${term}` : term;
}
/**
 * The selection as a query: each facet's included values ORed in a group, the facets ANDed, an excluded value a NOT.
 * `raw`: a query typed by hand, kept in front of the picks.
 */
export function selectionQuery(clauses: readonly Clause[], raw: string): string {
  const keys = [...new Set(clauses.map(c => c.key))];
  const terms = keys.flatMap(key => {
    const mine = clauses.filter(c => c.key === key);
    const inc = mine.filter(c => c.mode === "include" && c.value !== undefined).map(clauseText);
    return [...mine.filter(c => c.mode === "include" && c.value === undefined).map(clauseText), ...(inc.length > 1 ? [`(${inc.join(" OR ")})`] : inc), ...mine.filter(c => c.mode === "exclude").map(clauseText)];
  });
  return [raw.trim() ? (terms.length && /\b(?:OR|AND|NOT)\b/.test(raw) ? `(${raw.trim()})` : raw.trim()) : "", ...terms].filter(Boolean).join(" ");
}

export class FacetsPane implements Pane, AttachedOwner {
  clauses: Clause[] = [];
  /** A query typed by hand (`e`, `facets.query`): kept, with the picks after it. */
  raw = "";
  sort: FacetSort = "uses";
  /** Values no note left by the selection carries are listed, dimmed, at 0. */
  zero = false;
  /** The facets opened to their values. */
  open = new Set<string>();
  private answer: FacetAnswer | null = null;
  private all: FacetAnswer | null = null;
  private error: string | null = null;
  /** Whether some value of facet `key` lies below `path` (`path/…`), in what the service answered. */
  hasBelow(key: string, path: string): boolean {
    return [this.answer, this.all].some(a => a?.facets.find(f => f.key === key)?.values.some(v => v.value.startsWith(`${path}/`)));
  }
  /** The cursor: an index into the rows. */
  at = 0;
  private view = new RowView();
  share = 0.4;
  private divider = -1;
  private bodyRoom = 0;
  private noteRoom = 0;
  private dragging = false;
  private lineRows: number[] = [];
  private width = 0;
  private asked = 0;
  private reload: Timer | null = null;
  /** The query being typed (`e`): applied on ⏎, dropped on esc. */
  draft: LineField | null = null;

  /**
   * Matches, the notes the selection leaves (PIE-1443): the one ListView, its rows the service's groups (Pinned first),
   * placed as every attachment is (inline under the facets, split beside them, floating, popup, or a tile of its own).
   */
  readonly list = new ListView<Msg>("matches");
  place: AttachedPlace = "inline";
  private attached = new AttachedTile();
  /** The Matches tile while Matches is in one: its wires are where a pick previews and ⏎ opens. */
  matchesPane: Pane | null = null;
  /** The key that pins a note (its notes come first, under Pinned); the keys a row's chips show; the group the service makes. */
  pin = "pinned";
  show: string[] = SHOW;
  group = "updated:recent";
  /** The day picked on the calendar (YYYY-MM-DD), ANDed into the selection; the month the calendar shows. */
  day: string | null = null;
  month: { year: number; month: number } = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  calendar = true;
  private pinned: Msg[] = [];
  private views: Msg[] = [];
  /** A group's notes read past the first page (PIE-1448), by its label; read again with the selection. */
  private extra = new Map<string, Msg[]>();
  /** The groups whose last page read was full: their more row stays. */
  private extraMore = new Map<string, boolean>();
  /** The selection the expanded groups were read for. */
  private extraFor: string | null = null;
  /** The titles of the notes Matches' rows live under, by id: where a note lives, said on its row. */
  private homes = new Map<string, string>();
  /** The page whose links pin notes (PIE-1448): pinning writes there, never in the note pinned. */
  pins = "pins";
  /** The pins page's id, once it exists. */
  private pinsPage: string | null = null;
  private pinsMissAt = 0;
  private dayCounts = new Map<string, number>();
  private groupsKept: MatchGroup[] = [];

  constructor(public readonly kind: "facets" | "tags" = "facets", o: { query?: string; open?: readonly string[]; sort?: FacetSort; zero?: boolean; share?: number; place?: AttachedPlace; pin?: string; show?: readonly string[]; group?: string; calendar?: boolean; day?: string } = {}) {
    this.share = o.share ?? 0.4;
    this.raw = o.query ?? ""; this.sort = o.sort ?? "uses"; this.zero = o.zero ?? false;
    this.open = new Set(o.open ?? (kind === "tags" ? ["tag"] : []));
    this.place = o.place ?? "inline"; this.pin = o.pin ?? "pinned"; this.show = o.show ? [...o.show] : SHOW; this.group = o.group ?? "updated:recent";
    this.calendar = o.calendar ?? kind === "facets"; this.day = o.day ?? null;
  }

  /** The selection as the query the service is asked: the picks, then the calendar's day. */
  query(): string { const q = selectionQuery(this.clauses, this.raw); return [this.day && /\bOR\b/.test(q) ? `(${q})` : q, this.day ? dayClause(this.day) : ""].filter(Boolean).join(" "); }
  /** A saved view whose query is `q`, written the same (blanks aside). */
  viewWithQuery(q: string): Msg | undefined { const t = (x: string) => x.replace(/\s+/g, " ").trim(); return this.views.find(v => t(prop(v, "query") ?? "") === t(q)); }
  /** The note most of the outline's saved views live under: where a new one goes unless it's told. */
  viewsHome(): string | null {
    const n = new Map<string, number>();
    for (const v of this.views) if (v.parentId) n.set(v.parentId, (n.get(v.parentId) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  /** The pins page, once a pin found or made it: the Pinned list reads it from the next load on. */
  pinsPageIs(id: string) { this.pinsPage = id; }
  /** The notes the pins page links to, as the Pinned list read them. */
  pinnedIds(): Set<string> { return new Set(this.pinned.map(m => m.id)); }
  /** A view just saved: first among the views (the ones changed last come first). */
  viewSaved(v: Msg) { this.views = [v, ...this.views.filter(x => x.id !== v.id)]; this.rowsKept = null; }
  /** A note's title, when this tile has read it (a view's hub, a row's home). */
  homeName(id: string): string | undefined { return this.homes.get(id); }
  /** A saved view the tile lists as a shortcut, by id. */
  viewNamed(id: string): Msg | undefined { return this.views.find(v => v.id === id || (id.length >= 8 && v.id.startsWith(id))); }
  /** The pane whose wires a pick and an open go through: the Matches tile while there is one, else this. */
  source(): Pane { return this.place === "tile" && this.matchesPane ? this.matchesPane : this; }
  title() { const q = this.query(); return q ? `${this.kind} ${q}` : this.kind; }
  hint() { return this.draft ? "type the query (the views' grammar: #tag key=value NOT … OR …) · ⏎ apply · esc undo" : `${HINT} · ${keysText(FACETS_ACTIONS.def("facets.resize")!.keys)}`; }
  headLabel() { return fg(C.dark) + (this.error ? "failed" : this.answer ? String(this.answer.facets.length) : "…") + RESET; }
  spine() { return { title: this.title() }; }
  typing() { return this.draft !== null; }
  lineField() { return this.draft; }
  blur() { this.draft = null; }
  spec() {
    const q = selectionQuery(this.clauses, this.raw);
    return { ...(q ? { query: q } : {}), args: { share: this.share, sort: this.sort, ...(this.zero ? { zero: true } : {}), ...(this.open.size ? { open: [...this.open] } : {}),
      ...(this.place !== "inline" ? { place: this.place } : {}), ...(this.pin !== "pinned" ? { pin: this.pin } : {}), ...(this.show.join() !== SHOW.join() ? { show: this.show } : {}),
      ...(this.group !== "updated:recent" ? { group: this.group } : {}), ...(this.calendar !== (this.kind === "facets") ? { calendar: this.calendar } : {}), ...(this.day ? { day: this.day } : {}) } };
  }

  init(desk: DeskApi) { if (!this.answer) void this.refresh(desk); }
  onEvent(desk: DeskApi) {
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.refresh(desk); }, 400);
  }
  dispose() { if (this.reload) clearTimeout(this.reload); }

  /** Ask the service for the selection's facets and notes (and, to dim the ones it leaves at 0, every note's facets). */
  /** A refresh (an outline change, `r`, `z`): in turn with the selection's own reads, so none supersedes another. */
  refresh(desk: DeskApi): Promise<boolean> { return this.serial(() => this.load(desk)); }
  /** One read of the selection's facets and notes; a selection change calls it inside `serial`, anything else through `refresh`. */
  async load(desk: DeskApi): Promise<boolean> {
    const n = ++this.asked, board = desk.ctx.board, q = this.query();
    try {
      // Pinned: the notes the pins page links to, and any that carry the pin key itself.
      if (!this.pinsPage && Date.now() - this.pinsMissAt > 30_000) {
        const r = await board.resolvePage(this.pins).catch(() => null);
        this.pinsPage = r?.status === "resolved" && r.block ? r.block.id : null;
        if (!this.pinsPage) this.pinsMissAt = Date.now();
      }
      const pinQ = this.pinsPage ? `(${this.pin}=true OR linkedfrom:${this.pinsPage})` : `${this.pin}=true`, within = q ? (/\bOR\b/.test(q) ? `(${q}) ${pinQ}` : `${q} ${pinQ}`) : pinQ;
      const { year, month } = this.month, from = `${year}-${String(month).padStart(2, "0")}-01`, to = isoDay(new Date(year, month, 0));
      const plain = selectionQuery(this.clauses, this.raw), monthQ = [plain && /\bOR\b/.test(plain) ? `(${plain})` : plain, `updated >= "${dayWords(from)}" updated <= "${dayWords(to)}"`].filter(Boolean).join(" ");
      const [now, all, pinned, views, days] = await Promise.all([
        board.facetList(q, 200, { group: this.group, sort: "updated desc", excerpt: true }),
        q ? board.facetList("", 0) : null,
        board.facetList(within, 50, { facets: false, sort: "updated desc", excerpt: true }).catch(() => null),
        this.open.has("views") || !this.views.length ? board.facetList("type=virtual-branch query", 200, { facets: false, sort: "updated desc" }).catch(() => null) : null,
        this.calendar ? board.facetList(monthQ, 1, { facets: false, group: "updated:day" }).catch(() => null) : null,
      ]);
      if (n !== this.asked) return true;
      const was = this.rowKey(this.current());
      this.answer = now; this.all = all ?? now; this.error = null;
      this.pinned = pinned?.notes ?? [];
      if (views) this.views = views.notes;
      // A refresh of the same selection (a note written meanwhile) reads the groups that were expanded again, so the
      // rows read and the pick stay; a new selection starts from its first page.
      const reread = q === this.extraFor ? [...this.extra.keys()] : [];
      this.extra.clear(); this.extraMore.clear(); this.extraFor = q;
      if (reread.length) {
        const groups = matchGroups(now.notes, now.groups, this.pinned, now.matched);
        const pages = await Promise.all(reread.map(async label => {
          const g = groups.find(x => x.label === label), clause = g ? bucketWhere(this.group, g.value) : null;
          if (!clause) return null;
          const r = await board.facetList([q && /\bOR\b/.test(q) ? `(${q})` : q, clause].filter(Boolean).join(" "), 1000, { facets: false, sort: "updated desc", excerpt: true }).catch(() => null);
          return r ? [label, r] as const : null;
        }));
        if (n !== this.asked) return true;
        for (const page of pages) if (page) { this.extra.set(page[0], page[1].notes); this.extraMore.set(page[0], page[1].truncated); }
      }
      // Where each row lives is read after the rows are drawn: it fills in, it never holds them back.
      void this.readHomes(desk, [...now.notes, ...this.pinned, ...this.views]).then(() => { if (n === this.asked) { this.setRows(); desk.redraw(); } });
      this.dayCounts = new Map((days?.groups ?? []).flatMap(g => (g.value ? [[g.value, g.count] as [string, number]] : [])));
      this.setRows();
      // The cursor stays on the row it was on (by what it is), not its place.
      const at = was ? this.rows().findIndex(r => this.rowKey(r) === was) : -1;
      if (at >= 0) this.at = at;
    } catch (e) {
      if (n !== this.asked) return true;
      this.error = (e as Error).message;
      this.answer = this.answer ?? { facets: [], notes: [], truncated: false, matched: 0 };
      desk.redraw();
      return false;
    }
    this.at = Math.min(this.at, Math.max(0, this.rows().length - 1));
    desk.redraw();
    return true;
  }

  /** Selection changes run one after another: a second pick is judged against the answer to the first. */
  private chain: Promise<unknown> = Promise.resolve();
  serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f, f);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private ordered<T extends { value?: Value; label?: string; tag?: string }>(xs: readonly T[], figures: (x: T) => Value | undefined, name: (x: T) => string): T[] {
    const by: Record<FacetSort, (a: T, b: T) => number> = {
      uses: (a, b) => (figures(b)?.count ?? 0) - (figures(a)?.count ?? 0) || (figures(b)?.last ?? 0) - (figures(a)?.last ?? 0),
      name: (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: "base" }),
      last: (a, b) => (figures(b)?.last ?? 0) - (figures(a)?.last ?? 0) || (figures(b)?.count ?? 0) - (figures(a)?.count ?? 0),
    };
    return [...xs].sort((a, b) => by[this.sort](a, b) || name(a).localeCompare(name(b)));
  }

  /** A facet's values as a tree on `/`: a node is a path, with its own figures when a note carries exactly it. */
  private tree(values: readonly Value[]): Node[] {
    const root: Node = { path: "", label: "", depth: -1, kids: [], open: true };
    for (const v of values) {
      let at = root;
      v.value.split("/").forEach((part, i, parts) => {
        const path = parts.slice(0, i + 1).join("/");
        let next = at.kids.find(k => k.label === part);
        if (!next) at.kids.push(next = { path, label: part, depth: i, kids: [], open: true });
        if (i === parts.length - 1) next.value = v;
        at = next;
      });
    }
    const sort = (n: Node) => { n.kids = this.ordered(n.kids, k => k.value, k => k.label); n.kids.forEach(sort); };
    sort(root);
    return root.kids;
  }

  private clauseOf(key: string, node: Node): Clause | undefined { return this.clauses.find(c => c.key === key && c.value === node.path); }

  /** Matches' rows from the answers: the service's groups, Pinned first, each note a card. */
  private setRows() {
    const a = this.answer;
    this.groupsKept = a ? matchGroups(a.notes, a.groups, this.pinned, a.matched, this.extra, this.extraMore) : [];
    this.list.set(matchRows(this.groupsKept, this.show, this.pin, m => (m.parentId ? this.homes.get(m.parentId) : undefined)));
    this.rowsKept = null;
  }
  /** The titles of the notes `notes` live under, read in one ask (only those not known yet). */
  private async readHomes(desk: DeskApi, notes: readonly Msg[]) {
    const want = [...new Set(notes.flatMap(m => (m.parentId && !this.homes.has(m.parentId) ? [m.parentId] : [])))];
    if (!want.length) return;
    try { for (const h of await desk.ctx.board.readMany(want)) this.homes.set(h.id, subject(h)); } catch { /* a row says nothing of its home */ }
  }
  /**
   * Read the rest of group `label` (its "▸ more" row, PIE-1448): the selection ANDed with the clause that holds just that
   * group (outline-core `bucketWhere`), the service answering it as it answers the first page. The cursor goes to its
   * first note not shown before.
   */
  async readGroup(desk: DeskApi, label: string): Promise<{ group: string; notes: number }> {
    const g = this.groupsKept.find(x => x.label === label);
    if (!g) throw new ActionRefused(`Matches has no group ${label}`);
    const clause = bucketWhere(this.group, g.value);
    if (!clause) throw new ActionRefused(`${label} can't be asked for by itself`);
    // A page at a time, older than the last one read (a group past 1,000 notes keeps its more row); an answer that lands
    // after the selection changed is dropped, never put under the new selection's group.
    const asked = this.asked, q = this.query(), had = this.extra.get(label), was = new Set(g.notes.map(m => m.id));
    // `<=` the last one read: notes sharing its time (a batch written at once) aren't skipped; those already read drop out.
    const older = had?.length ? ` updated <= ${new Date(had[had.length - 1]!.updatedAt).toISOString()}` : "";
    const got = await desk.ctx.board.facetList([q && /\bOR\b/.test(q) ? `(${q})` : q, clause].filter(Boolean).join(" ") + older, 1000, { facets: false, sort: "updated desc", excerpt: true });
    await this.readHomes(desk, got.notes);
    if (asked !== this.asked) return { group: label, notes: 0 };
    const seen = new Set((had ?? []).map(m => m.id)), all = [...(had ?? []), ...got.notes.filter(m => !seen.has(m.id))];
    this.extra.set(label, all);
    this.extraMore.set(label, got.truncated);
    this.setRows();
    const first = got.notes.find(m => !was.has(m.id));
    if (first) { this.list.setPick(PERSON, first.id); const at = this.rows().findIndex(r => r.kind === "note" && r.note.id === first.id); if (at >= 0) this.at = at; }
    desk.redraw();
    return { group: label, notes: all.length };
  }
  /** The notes Matches lists, in the order drawn (Pinned first). */
  notes(): Msg[] { return this.list.pickable(PERSON).flatMap(r => (r.source ? [r.source] : [])); }

  /** The rows the cursor walks: the picks, then each facet and, opened, its values, then the notes the selection leaves. */
  rows(): Row[] {
    if (!this.answer) return [];
    // Asked a dozen times a frame (the cursor's row, what the tile shows, each tile's facts): built once for what it is built from.
    const from = `${this.sort}|${this.zero}|${this.place}|${this.day}|${this.views.length}|${[...this.open].join(",")}|${this.clauses.map(c => `${c.key}\0${c.value}\0${c.mode}\0${c.path ? 1 : 0}`).join("\n")}`;
    const kept = this.rowsKept;
    if (kept && kept.answer === this.answer && kept.all === this.all && kept.from === from) return kept.rows;
    const rows = this.build(this.answer);
    this.rowsKept = { answer: this.answer, all: this.all, from, rows };
    return rows;
  }
  private rowsKept: { answer: FacetAnswer; all: FacetAnswer | null; from: string; rows: Row[] } | null = null;
  private build(answer: FacetAnswer): Row[] {
    const rows: Row[] = this.clauses.map(clause => ({ kind: "clause", clause }));
    if (this.day) rows.push({ kind: "day", day: this.day });
    // Saved views are shortcuts: a pick sets the selection to the view's query.
    if (this.views.length) {
      rows.push({ kind: "views", count: this.views.length, open: this.open.has("views") });
      // The ones changed last first, a few at a time: an outline's views run to dozens (PIE-1448), the facets stay in sight.
      const all = this.open.has("views:all"), shown = all ? this.views : this.views.slice(0, VIEWS_SHOWN);
      if (this.open.has("views")) {
        for (const view of shown) rows.push({ kind: "view", view });
        if (!all && this.views.length > shown.length) rows.push({ kind: "views-more", count: this.views.length - shown.length });
      }
    }
    const here = new Map(answer.facets.map(f => [f.key, f]));
    const listed = this.zero && this.all ? this.all.facets.map(f => f.key) : answer.facets.map(f => f.key);
    // The facets in use (opened, or with a pick) come first, so what is being looked at is never far down a long list.
    const using = (k: string) => this.open.has(k) || this.clauses.some(c => c.key === k);
    const keys = [...new Set([...listed.filter(using), ...this.clauses.map(c => c.key), ...listed.filter(k => !using(k))])];
    for (const key of keys) {
      const f = here.get(key), open = this.open.has(key);
      rows.push({ kind: "facet", key, count: f?.count ?? 0, open, more: f?.more ?? 0 });
      if (!open) continue;
      const mine = new Set((f?.values ?? []).map(v => v.value));
      const gone = this.zero && this.all ? (this.all.facets.find(x => x.key === key)?.values ?? []).filter(v => !mine.has(v.value)).map(v => ({ ...v, count: 0 })) : [];
      const walk = (nodes: readonly Node[], zero: Set<string>) => {
        for (const node of nodes) {
          const clause = this.clauseOf(key, node);
          rows.push({ kind: "value", key, node, state: clause?.mode ?? null, zero: !mine.has(node.path) && !node.kids.some(k => mine.has(k.path)) && zero.has(node.path) });
          walk(node.kids, zero);
        }
      };
      walk(this.tree([...(f?.values ?? []), ...gone]), new Set(gone.map(g => g.value)));
    }
    // In a tile of its own, Matches walks there; here the cursor goes on into it.
    if (this.place !== "tile") for (const r of this.list.pickable(PERSON)) rows.push(r.source ? { kind: "note", note: r.source } : { kind: "more", group: r.group ?? "" });
    return rows;
  }
  current(): Row | undefined { return this.rows()[this.at]; }
  /**
   * A note Matches lists: by id (or its first 8+ characters), by its row in the tile (n, from 1), else the one the
   * cursor is on, else Matches' own pick (its tile's). Why not, when none.
   */
  noteFor({ n, id }: { n?: number; id?: string }, who = PERSON): Msg {
    const listed = this.list.rows.flatMap(r => (r.source ? [r.source] : []));
    if (id !== undefined) {
      const m = listed.find(x => x.id === id || (id.length >= 8 && x.id.startsWith(id)));
      if (!m) throw new ActionRefused(`the selection leaves no note ${id}`);
      return m;
    }
    if (n !== undefined) {
      // In a tile of its own, Matches' rows are its own (1 is its first note); here they follow the tree's.
      if (this.place === "tile") { const m = this.list.pickable(who)[n - 1]?.source; if (m) return m; throw new ActionRefused(`Matches has notes 1 to ${this.list.pickable(who).length}`); }
      const r = this.rows()[n - 1]; if (r?.kind === "note") return r.note; throw new ActionRefused(`row ${n} isn't a note (facets.list names the notes Matches lists)`);
    }
    const r = this.current();
    if (r?.kind === "note" && who === PERSON) return r.note;
    const picked = this.list.picked(who)?.source;
    if (picked && (this.place === "tile" || who !== PERSON)) return picked;
    throw new ActionRefused("the cursor isn't on a note (the notes the selection leaves are listed in Matches)");
  }
  private rowKey(r: Row | undefined) {
    return !r ? null : r.kind === "clause" ? `c:${r.clause.key}=${r.clause.value}` : r.kind === "facet" ? `f:${r.key}` : r.kind === "value" ? `v:${r.key}=${r.node.path}` : r.kind === "day" ? "d" : r.kind === "views" ? "views" : r.kind === "view" ? `w:${r.view.id}` : r.kind === "views-more" ? "w+" : r.kind === "more" ? `m:${r.group}` : `n:${r.note.id}`;
  }
  /** Run `change`, which reorders rows, and keep the cursor on the row it was on. */
  keeping(change: () => void) {
    const was = this.rowKey(this.current());
    change();
    const at = was ? this.rows().findIndex(r => this.rowKey(r) === was) : -1;
    this.at = at >= 0 ? at : Math.min(this.at, Math.max(0, this.rows().length - 1));
  }

  /** What a click on a drawn line hits besides the tree's rows: a Matches row, a chip (an action), a calendar day. */
  private hits: { y: number; x0: number; x1: number; note?: string; act?: [string, Record<string, unknown>] }[] = [];
  /** Where the calendar was drawn: its first grid row, its left column, the month's lead blanks and days. */
  private cal: { y: number; x: number; lead: number; days: number } | null = null;
  /** Split: the column Matches starts at (a click there is Matches', never the tree's row beside it). */
  private listFrom: number | null = null;

  /** Matches drawn `cols` × `room`: the lines, and which note each line belongs to. */
  matchLines(cols: number, room: number, focused: boolean): { lines: string[]; notes: (string | null)[] } {
    const a = this.answer, visible = this.list.visible();
    const d = this.list.draw({ cols, focused, selection: true, room,
      empty: !a ? " loading…" : this.query() ? " No matching notes." : " No notes yet." });
    // Each line's row: a note's id, or a group's "more" row (MORE + its label); headings and spacing are null.
    const notes = d.rowAt.map(i => (i === null ? null : visible[i]?.source?.id ?? (visible[i]?.id.startsWith(MORE) ? visible[i]!.id : null)));
    return { lines: d.lines.map(l => pad(l, cols)), notes };
  }

  /** The chip that says where Matches is and moves it (ctrl+o): `⧉ inline`. */
  private placeChip(): string { return `⧉ ${this.place}`; }

  render(w: number, h: number, focused: boolean, desk?: DeskApi): PaneView {
    const rows = this.rows();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    this.width = w;
    const cur = rows[this.at];
    if (cur?.kind === "note") this.list.setPick(PERSON, cur.note.id);
    else if (cur?.kind === "more") this.list.setPick(PERSON, `${MORE}${cur.group}`);
    if (desk) this.attached.sync(this, this.attachedHost(desk));
    const lines: string[] = [];
    this.lineRows = []; this.hits = []; this.cal = null;
    const push = (text: string, row = -1) => { lines.push(text); this.lineRows.push(row); };
    const cell = (sort: FacetSort, label: string) => (this.sort === sort ? fg(C.white) + `\x1b[1m${label}▾\x1b[22m` : fg(C.dark) + label + " ") + RESET;
    const a = this.answer, q = this.query();
    push(pad(` ${fg(C.dark)}${a?.matched ?? "…"} of ${this.all?.matched ?? "…"} notes`, Math.max(0, w - USES - 1 - LAST)) + cell("uses", "uses") + " " + cell("last", "last"));
    if (this.draft) push(fg(C.yellow) + ` ? ${this.draft.plain()}` + RESET);
    else push(fg(C.dark) + pad(q ? ` ? ${q}` : " ? every note · e types a query", w) + RESET);
    if (this.error) push(fg(C.lred) + " " + this.error + RESET);
    else if (!a) push(fg(C.dark) + " loading…" + RESET);
    if (a?.hint) push(fg(C.yellow) + " " + a.hint + RESET);
    const top = lines.length;
    this.bodyRoom = Math.max(0, h - top - 1);
    // Split with no room for two lists side by side draws as inline (a 44-column tile), and is still split when it widens.
    const split = this.place === "split" && w >= 60, inline = this.place === "inline" || (this.place === "split" && !split);
    const noteRoom = inline ? (this.bodyRoom > 1 ? clamp(Math.round(this.bodyRoom * this.share), 1, this.bodyRoom - 1) : this.bodyRoom) : 0;
    this.noteRoom = noteRoom;
    const listW = split ? clamp(Math.round(w * 0.55), 30, w - 24) : w, treeW = split ? w - listW - 1 : w;
    this.listFrom = split ? treeW : null;
    const treeRoom = this.bodyRoom - noteRoom;
    const calRoom = this.calendar && treeRoom >= CAL_ROWS + 6 && treeW >= CAL_COLS - 4 ? CAL_ROWS : 0;
    const keyRoom = treeRoom - calRoom;
    const tree: { text: string; row: number }[] = [];
    rows.forEach((r, i) => { if (r.kind !== "note" && r.kind !== "more") for (const text of this.line(r, i === this.at, focused, treeW)) tree.push({ text, row: i }); });
    if (!tree.length) tree.push({ text: fg(C.dark) + " No properties." + RESET, row: -1 });
    const first = tree.findIndex(l => l.row === this.at), last = tree.findLastIndex(l => l.row === this.at);
    this.view.place(first < 0 ? null : first, tree.length, keyRoom, first < 0 ? null : [first, last]);
    for (let i = 0; i < keyRoom; i++) { const l = tree[this.view.top + i]; push(pad(l?.text ?? "", treeW), l?.row ?? -1); }
    if (calRoom) for (const l of this.calendarLines(treeW, calRoom, top + keyRoom)) push(pad(l, treeW));
    // The Matches line: its count, where it is (a click moves it on, as ctrl+o), and inline the [less] [more] of its share.
    this.divider = lines.length;
    const count = `${a?.matched ?? "…"}${a?.truncated ? ` · first ${a.notes.length}` : ""}`;
    let x = 0, bar = "";
    const add = (text: string, act?: [string, Record<string, unknown>]) => { if (act) this.hits.push({ y: this.divider, x0: x, x1: x + text.length, act }); bar += (act ? fg(C.lcyan) : fg(C.dark)) + text; x += text.length; };
    add(` ── Matches ${count} `);
    add(`[${this.placeChip()}]`, ["facets.place", {}]);
    if (inline) { add(" "); add("[less]", ["facets.resize", { by: -0.1 }]); add(" "); add("[more]", ["facets.resize", { by: 0.1 }]); add(" · drag to resize"); }
    else if (this.place === "tile") add(" · in its own tile");
    push(pad(bar, w) + RESET);
    if (inline) {
      const m = this.matchLines(w, noteRoom, focused && (cur?.kind === "note" || cur?.kind === "more"));
      m.lines.forEach((l, i) => { const id = m.notes[i]; if (id) this.hits.push({ y: lines.length, x0: 0, x1: w, note: id }); push(l, id ? rows.findIndex(r => (r.kind === "note" && r.note.id === id) || (r.kind === "more" && `${MORE}${r.group}` === id)) : -1); });
    }
    if (split) {
      const m = this.matchLines(listW, h - top, focused && (cur?.kind === "note" || cur?.kind === "more"));
      for (let i = 0; i < h - top; i++) {
        const y = top + i, id = m.notes[i] ?? null;
        lines[y] = pad(lines[y] ?? "", treeW) + fg(C.dark) + "│" + RESET + (m.lines[i] ?? " ".repeat(listW));
        if (id) this.hits.push({ y, x0: treeW + 1, x1: w, note: id });
      }
    }
    let out = lines.slice(0, h);
    if (this.place === "floating" || this.place === "popup") {
      const rect = attachedRect(this.place, w, h, { min: { cols: 30, rows: 8 }, from: top });
      const m = this.matchLines(rect.cols - 2, rect.rows - 2, focused && (cur?.kind === "note" || cur?.kind === "more"));
      m.notes.forEach((id, i) => { if (id) this.hits.push({ y: rect.row + 1 + i, x0: rect.col + 1, x1: rect.col + rect.cols - 1, note: id }); });
      out = drawAttachedFloat(out, w, h, rect, `matches ${count} · ${this.placeChip()}`, focused, undefined,
        (canvas, dx, dy) => m.lines.forEach((l, i) => canvas.text(rect.col + 1 + dx, rect.row + 1 + i + dy, l, rect.cols - 2)), false);
      // Under the float, the tree's rows aren't there to click.
      for (let y = rect.row; y < rect.row + rect.rows; y++) this.lineRows[y] = -1;
    }
    return { lines: out };
  }

  /** The calendar at the foot of the tree (`rows` high from line `y`): « the month », days with notes in the selection lit, the picked day bracketed. */
  private calendarLines(w: number, rows: number, y: number): string[] {
    const { year, month } = this.month, mm = String(month).padStart(2, "0");
    const marks = [...this.dayCounts].filter(([d]) => d.startsWith(`${year}-${mm}-`)).map(([date, n]) => ({ date, label: String(n) }));
    const grid = drawCalendar({ year, month, today: this.day ?? isoDay(new Date()), weekStartsOn: "mon", marks, dots: true }, Math.max(CAL_COLS, w));
    const end = grid.indexOf("");
    const weeks = grid.slice(1, end < 0 ? undefined : end);
    const head = ` « ${grid[0]!.trim()} » `;
    this.hits.push({ y, x0: 1, x1: 2, act: ["facets.month", { by: -1 }] });
    const nextX = 1 + 2 + width(grid[0]!.trim()) + 1;
    this.hits.push({ y, x0: nextX, x1: nextX + 1, act: ["facets.month", { by: 1 }] });
    this.hits.push({ y, x0: nextX + 2, x1: nextX + 9, act: ["facets.day", { day: isoDay(new Date()) }] });
    const first = Date.UTC(year, month - 1, 1) / 86_400_000;
    this.cal = { y: y + 2, x: 0, lead: (weekday(first) - 1 + 7) % 7, days: new Date(year, month, 0).getDate() };
    return [fg(C.lcyan) + head + fg(C.dark) + "today" + RESET, ...weeks].slice(0, rows);
  }

  // ── Matches in a tile of its own (the `matches` kind: AttachedTilePane over this owner) ──

  /** How the attachment opens and closes its tile: the desk's attached tiles, as a reader's Sources. */
  private attachedHost(desk: DeskApi) {
    return {
      open: (on: boolean, side?: AttachedSide) => desk.attachedTile?.(this, "matches", on, side) ?? Promise.reject(new Error("this screen has no tiles to put Matches in")),
      exists: () => !!desk.hasAttachedTile?.(this, "matches"),
      changed: (why?: string) => { if (why) desk.ctx.flash(why); desk.redraw(); },
    };
  }
  /** Move Matches: a place, or the next one round (ctrl+o); `side` puts its tile on that side of this one. */
  async placeMatches(place: AttachedPlace | undefined, desk: DeskApi, side?: AttachedSide): Promise<AttachedPlace> {
    const to = place ?? nextPlace(this.place, !!desk.attachedTile);
    await this.attached.place(this, to, this.attachedHost(desk), side);
    if (to !== "tile") this.matchesPane = null;
    this.keeping(() => { this.rowsKept = null; });
    desk.keepLayout?.(); desk.redraw();
    return this.place;
  }
  /** The Matches tile's lines (its pane draws them, with its side chips under them). */
  attachedView(_a: Attachment, w: number, h: number, focused: boolean): PaneView {
    const m = this.matchLines(w, h, focused);
    this.tileNotes = m.notes;
    return { lines: m.lines };
  }
  private tileNotes: (string | null)[] = [];
  /** A key in the Matches tile: the list's own walk, open, pin, tag, and ctrl+o to move it. */
  attachedKey(_a: Attachment, k: Key, desk: DeskApi): boolean {
    if (this.list.typing && k.kind !== "mouse") return this.filterKey(k, desk);
    if (ch(k) === "/") { this.listHost(desk).type(this.listHost(desk).lists()[0]!); return true; }
    // Every list's keys (PIE-1457): Home and g to the first note, End and G to the last; space opens, as it does on a
    // note in the facets tile's own Matches.
    const c = ch(k), by = isDown(k) ? 1 : isUp(k) ? -1 : k.kind === "pgdn" ? 8 : k.kind === "pgup" ? -8
      : k.kind === "home" || c === "g" ? -PAST_END : k.kind === "end" || c === "G" ? PAST_END : 0;
    const run = (name: string, args: Record<string, unknown> = {}) => { void desk.press?.(this, FACETS_ACTIONS, name, args); return true; };
    if (by) return run("facets.match", { by });
    if (k.kind === "enter" || c === " ") return run("facets.open");
    if (k.kind === "alt-enter") return run("facets.open", { fresh: true });
    if (k.kind === "char" && k.ctrl && k.ch === "o") return run("facets.place");
    if (c === "*") return run("facets.pin");
    if (c === "t") return run("facets.tag");
    return false;
  }
  attachedMouse(_a: Attachment, k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { if (this.list.pickable(PERSON).length) void desk.press?.(this, FACETS_ACTIONS, "facets.match", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const id = this.tileNotes[y];
    if (id) this.pressNote(id, k, desk, press);
    return true;
  }
  /** A click on a note in Matches: select it (it previews), a second click or alt-click opens it. */
  private pressNote(id: string, k: Extract<Key, { kind: "mouse" }>, desk: DeskApi, press?: RowPress) {
    if (id.startsWith(MORE)) { void desk.press?.(this, FACETS_ACTIONS, "facets.more", { group: id.slice(MORE.length) }); return; }
    const i = this.list.pickable(PERSON).findIndex(r => r.id === id);
    const g = this.list.press(Math.max(0, i), press ?? { mods: k.mods ?? 0, button: k.button });
    void desk.press?.(this, FACETS_ACTIONS, "facets.match", { id });
    if (g === "open" || g === "fresh") void desk.press?.(this, FACETS_ACTIONS, "facets.open", { id, ...(g === "fresh" ? { fresh: true } : {}) });
  }
  /**
   * Matches lent to the lists' actions (`list.pick`, `list.step`, `list.open`, `list.filter`, `list.blocks`, PIE-1448),
   * as the links tile lends its own: the same keys and the same agent picks as every list in the door.
   */
  listHost(desk: DeskApi): ListHost {
    return {
      lists: () => [{ n: 1, key: "matches", title: "Matches", view: this.list, entered: false, about: this.query() || "every note", detail: { place: this.place, groups: this.groupsKept.map(g => g.label) } }],
      current: () => "matches",
      none: "Matches is still being read",
      picked: (_l, row) => { void desk.press?.(this, FACETS_ACTIONS, "facets.match", { id: row.id }, true); },
      open: async (_l, row, where, actor) => {
        if (row.id.startsWith(MORE)) return this.readGroup(desk, row.id.slice(MORE.length));
        const m = row.source as Msg | undefined;
        if (!m) throw new ActionRefused(`${row.label} is a heading: it opens nothing`);
        desk.openFromTile(m, { from: this.source(), link: true, ...(where === "new" ? { fresh: true } : {}), by: actor });
        return { id: m.id, title: subject(m) };
      },
      enter: () => { throw new ActionRefused("Matches has the keys whenever its tile does: focus it (tile.focus) rather than going into it"); },
      type: () => { this.list.startTyping(was => new LineField(was, false, { complete: false })); desk.redraw(); },
      redraw: () => desk.redraw(),
    };
  }
  /** Typing Matches' filter (`/`): letters narrow the rows as they're typed, ⏎ keeps them, esc goes back. */
  private filterKey(k: Key, desk: DeskApi): boolean {
    if (k.kind === "enter") this.list.stopTyping(true);
    else if (k.kind === "esc") this.list.stopTyping(false);
    else if (!this.list.typing?.take(k)) return k.kind !== "tab" && k.kind !== "backtab";
    this.rowsKept = null; desk.redraw();
    return true;
  }

  attachedTitle(): string { return `matches ${this.answer?.matched ?? "…"}${this.query() ? ` · ${this.query()}` : ""}`; }
  attachedHint(): string { return "j k pick · ⏎ open · alt+⏎ beside · * pin · t tag · ctrl+o moves it"; }
  attachedSide(_a: Attachment, side: AttachedSide, desk: DeskApi) { void this.placeMatches("tile", desk, side); }
  attachedSideWords(): string { return "beside the facets"; }
  attachedTileIs(_a: Attachment, tile: Pane | null) { this.matchesPane = tile; }

  private line(r: Row, on: boolean, focused: boolean, w: number): string[] {
    const style = (text: string, colour: string) => rowLines(text, w).map(text => (on ? selectedRow(text.replace(/\x1b\[(?!777;|778m)[\d;]*m/g, ""), w, focused, "idleRow") : colour + pad(text, w) + RESET));
    const room = Math.max(4, w - 3 - (USES + 1 + LAST));
    if (r.kind === "note") return style(` ${subject(r.note)} · ${ago(r.note.updatedAt)}`, fg(C.grey));
    if (r.kind === "day") return style(` + ${r.day} · the calendar's day`, fg(C.lgreen));
    if (r.kind === "views") return style(` ${r.open ? "▾" : "▸"} ☼ views  ${r.count}`, fg(C.yellow));
    // A view's hub says which one it is: "Closed this week" five times are five weeks' boards.
    if (r.kind === "view") { const hub = r.view.parentId ? this.homes.get(r.view.parentId) : undefined; return style(`   ${subject(r.view)}${hub ? fg(C.dark) + ` · ${hub}` : ""}`, fg(C.grey)); }
    if (r.kind === "views-more") return style(`   ▸ ${r.count} more views`, fg(C.dark));
    if (r.kind === "more") return style(` ▸ more in ${r.group}`, fg(C.dark));
    if (r.kind === "clause") return style(` ${r.clause.mode === "include" ? "+" : "−"} ${clauseText({ ...r.clause, mode: "include" })}`, r.clause.mode === "include" ? fg(C.lgreen) : fg(C.lred));
    if (r.kind === "facet") {
      const state = this.clauses.find(c => c.key === r.key && c.value === undefined)?.mode;
      const text = ` ${r.open ? "▾" : "▸"} [+] [-] ${r.key === "tag" ? "#tags" : r.key}  ${state === "include" ? "+" : state === "exclude" ? "−" : ""} ${r.count}${r.more ? ` +${r.more}` : ""}`;
      return style(text, fg(C.lcyan));
    }
    const v = r.node.value, mark = r.state === "include" ? "+" : r.state === "exclude" ? "−" : r.zero ? "○" : " ";
    const label = `${"  ".repeat(r.node.depth)}${r.key === "tag" ? "#" : ""}${r.node.label}${r.node.kids.length ? "/" : ""}`;
    const figs = v ? `${String(v.count).padStart(USES)} ${(v.last ? ago(v.last) : "").padStart(LAST)}` : " ".repeat(USES + 1 + LAST);
    const colour = r.state === "include" ? fg(C.lgreen) : r.state === "exclude" ? fg(C.lred) : r.zero ? fg(C.dark) : fg(C.grey);
    return style(`   ${mark} ${label}  ${figs}`, colour);
  }

  /** What a click at column `x`, line `y` hits: a sort word of the header, or a row. */
  private hit(x: number, y: number): { sort?: FacetSort; row?: number } {
    const line = y;
    if (line === 0) {
      const usesAt = this.width - (USES + 1 + LAST);
      if (x >= usesAt && x < usesAt + USES) return { sort: "uses" };
      if (x >= usesAt + USES + 1) return { sort: "last" };
      return { sort: "name" };
    }
    const row = this.lineRows[line];
    return row !== undefined && row >= 0 && this.rows()[row]?.kind !== "note" ? { row } : {};
  }

  private act(desk: DeskApi, name: string, args: Record<string, unknown> = {}) { void desk.press?.(this, FACETS_ACTIONS, name, args); }

  private draftKey(k: Key, desk: DeskApi): boolean {
    if (k.kind === "enter") { const text = this.draft?.text.trim() ?? ""; this.draft = null; this.act(desk, "facets.query", { text }); return true; }
    if (k.kind === "esc") this.draft = null;
    else if (!this.draft?.take(k)) return k.kind !== "tab" && k.kind !== "backtab";
    desk.redraw();
    return true;
  }

  key(k: Key, desk: DeskApi): boolean {
    if (this.draft !== null && k.kind !== "mouse") return this.draftKey(k, desk);
    const n = this.rows().length, c = ch(k), row = this.current();
    const by = isDown(k) ? 1 : isUp(k) ? -1 : k.kind === "pgdn" ? 8 : k.kind === "pgup" ? -8 : k.kind === "home" || c === "g" ? -PAST_END : k.kind === "end" || c === "G" ? PAST_END : 0;
    if (by) { if (n) this.act(desk, "facets.pick", { by }); return true; }
    if (k.kind === "char" && k.ctrl && k.ch === "o") { this.act(desk, "facets.place"); return true; }
    if (k.kind === "enter" || c === " ") {
      if (row?.kind === "note") this.act(desk, "facets.open");
      else if (row?.kind === "more") this.act(desk, "facets.more", { group: row.group });
      else if (row?.kind === "day") this.act(desk, "facets.day", { day: "" });
      else if (row?.kind === "views") this.act(desk, "facets.fold", { key: "views" });
      else if (row?.kind === "views-more") this.act(desk, "facets.fold", { key: "views:all" });
      else if (row?.kind === "view") this.act(desk, "facets.view", { id: row.view.id });
      else if (row?.kind === "facet") this.act(desk, "facets.fold");
      else if (row?.kind === "clause") this.act(desk, "facets.set", { key: row.clause.key, value: row.clause.value, mode: row.clause.mode === "include" ? "exclude" : "off" });
      else if (row?.kind === "value") this.act(desk, "facets.set");
      return true;
    }
    if (k.kind === "alt-enter") { if (row?.kind === "note") this.act(desk, "facets.open", { fresh: true }); return true; }
    if (c === "+" || c === "=") { this.act(desk, "facets.set", { mode: "include" }); return true; }
    if (c === "-") { this.act(desk, "facets.set", { mode: "exclude" }); return true; }
    if (c === "0" || k.kind === "backspace") { if (row?.kind === "day") this.act(desk, "facets.day", { day: "" }); else this.act(desk, "facets.set", { mode: "off" }); return true; }
    if (c === "e") { this.draft = new LineField(this.query(), false, { complete: false }); desk.redraw(); return true; }
    if (c === "[" || c === "]") { this.act(desk, "facets.resize", { by: c === "[" ? -0.1 : 0.1 }); return true; }
    if (c === "v") { this.act(desk, "facets.save"); return true; }
    if (c === "s") { this.act(desk, "facets.sort"); return true; }
    if (c === "z") { this.act(desk, "facets.zero"); return true; }
    if (c === "x") { this.act(desk, "facets.clear"); return true; }
    if (c === "r") { this.act(desk, "facets.reload"); return true; }
    if (c === "*" && row?.kind === "note") { this.act(desk, "facets.pin"); return true; }
    if (c === "t" && row?.kind === "note") { this.act(desk, "facets.tag"); return true; }
    if (c === "d") { this.act(desk, "facets.day", { day: isoDay(new Date()) }); return true; }
    if ((c === "," || c === ".") && this.day) { this.act(desk, "facets.day", { by: c === "," ? -1 : 1 }); return true; }
    return false;
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (this.draft !== null) return true;
    if (k.action === "up") { this.dragging = false; return true; }
    if (this.dragging && k.action === "drag") {
      this.act(desk, "facets.resize", { share: (this.divider + this.noteRoom - y) / Math.max(1, this.bodyRoom) });
      return true;
    }
    // A note drawn on the row (split's list runs down beside the Matches line) wins over the line's chips.
    const hit = this.hits.find(h => h.note && h.y === y && x >= h.x0 && x < h.x1) ?? this.hits.find(h => h.y === y && x >= h.x0 && x < h.x1);
    if (k.action === "down" && hit?.note) { this.pressNote(hit.note, k, desk, press); return true; }
    if (k.action === "down" && this.listFrom !== null && x >= this.listFrom && y > 1) return true;
    if (k.action === "down" && hit?.act) { this.act(desk, hit.act[0], hit.act[1]); return true; }
    if (k.action === "down" && y === this.divider) { if (this.place === "inline") this.dragging = true; return true; }
    const cal = this.cal;
    if (k.action === "down" && cal && y >= cal.y && y < cal.y + 6) {
      const day = (y - cal.y) * 7 + Math.floor((x - cal.x) / 4) - cal.lead + 1;
      if (day >= 1 && day <= cal.days) this.act(desk, "facets.day", { day: `${this.month.year}-${String(this.month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
      return true;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      if (hit?.note || (this.listFrom !== null && x >= this.listFrom) || (this.place === "tile" ? false : y > this.divider)) { if (this.list.pickable(PERSON).length) this.act(desk, "facets.match", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
      if (this.rows().some(r => r.kind !== "note")) this.act(desk, "facets.pick", { by: wheelRows(k.action === "wheel-up" ? -1 : 1), part: "keys" });
      return true;
    }
    if (k.action !== "down") return true;
    const at = this.hit(x, y);
    if (at.sort) { this.act(desk, "facets.sort", { by: at.sort }); return true; }
    if (at.row === undefined) return true;
    const g = this.view.press(at.row, press ?? { mods: k.mods ?? 0, button: k.button });
    const r = this.rows()[at.row];
    this.act(desk, "facets.pick", { n: at.row + 1 });
    // A click on a value includes it (again excludes it, again drops it); alt- or ctrl-click excludes it at once.
    if (r?.kind === "value") this.act(desk, "facets.set", { n: at.row + 1, ...((k.mods ?? 0) & (1 | 4) ? { mode: "exclude" } : {}) });
    else if (r?.kind === "day") this.act(desk, "facets.day", { day: "" });
    else if (r?.kind === "views") this.act(desk, "facets.fold", { key: "views" });
    else if (r?.kind === "views-more") this.act(desk, "facets.fold", { key: "views:all" });
    else if (r?.kind === "view") this.act(desk, "facets.view", { id: r.view.id });
    else if (r?.kind === "facet") {
      if (x >= 3 && x <= 5) this.act(desk, "facets.set", { key: r.key, mode: "include" });
      else if (x >= 7 && x <= 9) this.act(desk, "facets.set", { key: r.key, mode: "exclude" });
      else this.act(desk, "facets.fold", { n: at.row + 1 });
    }
    else if (r?.kind === "clause") this.act(desk, "facets.set", { key: r.clause.key, value: r.clause.value, mode: "off" });
    else if (r?.kind === "note" && (g === "open" || g === "fresh")) this.act(desk, "facets.open", { n: at.row + 1, ...(g === "fresh" ? { fresh: true } : {}) });
    return true;
  }

  describe() {
    const rows = this.rows();
    return {
      query: this.query(), clauses: this.clauses, raw: this.raw, sort: this.sort, zero: this.zero, share: this.share, total: this.all?.matched ?? 0, matched: this.answer?.matched ?? 0,
      facets: rows.flatMap(r => (r.kind === "facet" ? [{ key: r.key, notes: r.count, open: r.open, values: rows.filter((v): v is Extract<Row, { kind: "value" }> => v.kind === "value" && v.key === r.key).map(v => ({ value: v.node.path, uses: v.node.value?.count ?? null, last: v.node.value?.last ? new Date(v.node.value.last).toISOString() : null, ...(v.state ? { state: v.state } : {}), ...(v.zero ? { zero: true } : {}) })) }] : [])),
      notes: this.notes().map(m => ({ id: m.id, title: subject(m) })), ...(this.error ? { error: this.error } : {}), ...(this.draft ? { typing: this.draft.text } : {}),
      ...(this.day ? { day: this.day } : {}), month: `${this.month.year}-${String(this.month.month).padStart(2, "0")}`,
      views: this.views.map(v => ({ id: v.id, title: subject(v), query: prop(v, "query") ?? "", ...(v.parentId && this.homes.has(v.parentId) ? { hub: this.homes.get(v.parentId) } : {}) })),
      matches: {
        place: this.place, group: this.group, pin: this.pin, show: this.show, ...(this.list.picked(PERSON) ? { selected: this.list.picked(PERSON)!.id } : {}),
        groups: this.groupsKept.map(g => ({ label: g.label, count: g.count, more: g.more, notes: g.notes.map(m => ({ id: m.id, title: subject(m), excerpt: m.excerpt ?? "", chips: chipsOf(m, this.show.filter(k => k !== this.pin)), updated: new Date(m.updatedAt).toISOString(), ...(m.parentId && this.homes.has(m.parentId) ? { home: this.homes.get(m.parentId) } : {}) })) })),
      },
    };
  }
}

const bare = (t: string) => t.replace(/^#/, "");
const board = (desk: DeskApi) => desk.ctx.board;
type ValueRow = Extract<Row, { kind: "value" }>;
/** Whether `path` has values below it in the answers (the facet need not be open): picking it then includes them too. */
const pathy = (p: FacetsPane, key: string, path: string) => p.hasBelow(key, path);

/** The facets tile's actions on the desk (the tile's own: `act tile=<its name>`, or the focused one). */
export const FACETS_ACTIONS = actionSet<KindHost>()("facets", {
  "facets.pick": def({
    summary: "move the cursor in the facets tile (tile=<its name>): n (from 1), or by=<rows> from where it is",
    keys: [{ keys: "j k ↑ ↓ pgup pgdn", does: "pick a row" }, { keys: "home g end G", does: "the first or last row" }, { keys: "wheel", does: "pick a row" }],
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't move the person's cursor (facets.list reads the rows, facets.set picks a value by name)",
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, by: { type: "number", optional: true, about: "rows on from the cursor (negative: up)" }, part: { type: "string", optional: true, about: "keys or matches; left out, both" } },
    examples: [
      { act: "facets.pick n=4 tile=facets", does: "moves the cursor to the fourth row of the facets tile" },
      { act: "facets.pick by=-2 tile=facets", does: "moves the cursor up two rows" },
    ],
    run({ n, by, part }, { pane, desk }, actor) {
      const p = pane as FacetsPane, rows = p.rows();
      if (!rows.length) throw new ActionRefused("the facets tile lists nothing yet");
      if ((n === undefined) === (by === undefined)) throw new ActionRefused("facets.pick takes n or by");
      if (part !== undefined && part !== "keys" && part !== "matches") throw new ActionRefused("part is keys or matches");
      if (part === "matches" && p.place === "tile") throw new ActionRefused("Matches is in a tile of its own: facets.match picks there (id=, by=)");
      const go = (rows: ReturnType<FacetsPane["rows"]>): unknown => {
        const walk = rows.flatMap((r, i) => part === undefined || (r.kind === "note" || r.kind === "more") === (part === "matches") ? [i] : []);
        if (!walk.length) throw new ActionRefused(`no ${part} rows are listed`);
        const at = walk.indexOf(p.at);
        const i = by !== undefined ? walk[clamp((at < 0 ? (by > 0 ? -1 : walk.length) : at) + Math.trunc(by), 0, walk.length - 1)]! : n! - 1;
        if (!(i >= 0 && i < rows.length)) throw new ActionRefused(`the tile has ${rows.length} rows; n is 1-${rows.length}`);
        p.at = i;
        const row = rows[i];
        if (row?.kind === "note") desk.showFrom?.(p.source(), row.note, actor);
        // Reaching a group's "more" row reads the rest of the group: scrolling on goes on into it, and End on to the last
        // row (PIE-1457), while a read brings rows.
        if (row?.kind === "more") return p.readGroup(desk, row.group).then(r => {
          const now = p.rows();
          return by !== undefined && by >= PAST_END && now.length > rows.length ? go(now) : { n: i + 1, ...r };
        });
        desk.redraw();
        return { n: i + 1 };
      };
      return go(rows);
    },
  }),
  "facets.set": def({
    summary: "include a key (any value) or a value (the notes must carry it), exclude it (they must not), or drop it: key= (value= narrows it; a tag is key=tag), n (its row), or the row the cursor is on; mode= include, exclude or off, left out it steps include → exclude → off. Several included values of a facet are ORed, whole keys and facets are ANDed; a value with values below it (a path) includes them too",
    keys: [{ keys: "⏎ space click", does: "steps the facet value" }, { keys: "+", does: "include" }, { keys: "-", does: "exclude", says: "exclude the key or value: notes must not carry it" }, { keys: "0 backspace", does: "drop", says: "drop the key or value from the selection" }, { keys: "alt-click ctrl-click", does: "excludes" }],
    touches: "tile", while: "typing", replay: "safe", way: "an agent picks by key=, with value= to narrow it: the person's selection moves with it",
    says: r => `${r.mode === "off" ? "dropped" : r.mode === "include" ? "included" : "excluded"} ${r.clause}`,
    args: {
      key: { type: "string", optional: true, about: "the property (`tag` for a tag, with or without #)" },
      value: { type: "string", optional: true, about: "its value (a path such as x/y/z includes what is below it)" },
      n: { type: "number", optional: true, about: "the key, value or pick's row, from 1" },
      mode: { type: "string", optional: true, about: "include, exclude or off; left out: the next step" },
    },
    examples: [
      { act: "facets.set key=project mode=include tile=facets", does: "keeps notes with any project; mode=exclude keeps notes without one" },
      { act: "facets.set key=tag value=garden tile=facets", does: "includes the #garden tag, so the notes left must carry it" },
      { act: "facets.set key=project value=seed-swap mode=exclude tile=facets", does: "leaves out the notes whose project is seed-swap" },
    ],
    run({ key, value, n, mode }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane;
      if (mode !== undefined && !["include", "exclude", "off"].includes(mode)) throw new ActionRefused(`mode is include, exclude or off, not ${mode}`);
      // Which value, as of this action's arrival: a click's row number means the rows the person saw, not those after an earlier pick lands.
      let k = key, v = value;
      if (k === undefined && v === undefined) {
        const row = n !== undefined ? p.rows()[n - 1] : p.current();
        if (!row || (row.kind !== "value" && row.kind !== "clause" && row.kind !== "facet")) throw new ActionRefused("the cursor isn't on a key, value or pick (a note opens with facets.open)");
        [k, v] = row.kind === "facet" ? [row.key, undefined] : row.kind === "value" ? [row.key, row.node.path] : [row.clause.key, row.clause.value];
      }
      if (k === undefined) throw new ActionRefused("facets.set takes key= (value= narrows it), or n");
      const name = k.toLowerCase() === "#" ? "tag" : k.toLowerCase(), val = name === "tag" && v !== undefined ? bare(v) : v;
      return p.serial(async () => {
        const before = [...p.clauses], was = p.clauses.find(c => c.key === name && c.value === val);
        const next = mode ?? (!was ? "include" : was.mode === "include" ? "exclude" : "off");
        p.clauses = p.clauses.filter(c => c !== was);
        // A path stays one (its clause says so), and a value is one when values lie below it in the answers.
        if (next !== "off") p.clauses.push({ key: name, value: val, mode: next, ...(val !== undefined && name !== "tag" && (was?.path || pathy(p, name, val)) ? { path: true } : {}) } as Clause);
        // The service didn't answer: the selection is what the rows describe, as it was.
        if (!(await p.load(desk))) { p.clauses = before; throw new ActionRefused(`${clauseText({ key: name, value: val, mode: "include" })}: the service couldn't answer · r asks again`); }
        if (standing) { const at = p.rows().findIndex(r => val === undefined ? r.kind === "facet" && r.key === name : (r.kind === "value" && r.key === name && r.node.path === val) || (r.kind === "clause" && r.clause.key === name && r.clause.value === val)); if (at >= 0) p.at = at; }
        desk.keepLayout?.(); desk.redraw();
        return { clause: clauseText({ key: name, value: val, mode: "include" }), mode: next, query: p.query(), notes: p.describe().matched };
      });
    },
  }),
  "facets.fold": def({
    summary: "open a facet to its values or fold it: key= (a tag is `tag`; `views` for the saved views, the shortcuts at the top; `views:all` lists every one of them, not the 8 changed last), n (its row), or the row the cursor is on",
    keys: "⏎ or a click on a facet", touches: "tile", while: "typing", replay: "safe", way: "an agent folds by key=",
    args: { key: { type: "string", optional: true, about: "the property" }, n: { type: "number", optional: true, about: "its row, from 1" } },
    examples: [
      { act: "facets.fold key=project tile=facets", does: "opens the project facet to its values, or folds it if open" },
    ],
    run({ key, n }, { pane, desk }) {
      const p = pane as FacetsPane, rows = p.rows();
      const row = key !== undefined ? rows.find(r => (r.kind === "facet" && r.key === bare(key).toLowerCase()) || (r.kind === "views" && key === "views") || (r.kind === "views-more" && key === "views:all")) : n !== undefined ? rows[n - 1] : p.current();
      if (key === "views:all" && !row && p.open.has("views:all")) { p.keeping(() => p.open.delete("views:all")); desk.redraw(); return { key, open: false }; }
      if (!row || (row.kind !== "facet" && row.kind !== "views" && row.kind !== "views-more")) throw new ActionRefused(key !== undefined ? `no facet ${key} is listed · facets.list names them` : "the cursor isn't on a facet");
      const name = row.kind === "views" ? "views" : row.kind === "views-more" ? "views:all" : row.key;
      p.keeping(() => { p.open.has(name) ? p.open.delete(name) : p.open.add(name); });
      desk.keepLayout?.(); desk.redraw();
      return { key: name, open: p.open.has(name) };
    },
  }),
  "facets.open": def({
    summary: "open a note the selection leaves, as ⏎ does in a list (the desk's open rule: the tile's link, or its container's): n (its row, from 1), id, or the row the cursor is on; fresh opens a new detail beside",
    keys: [{ keys: "⏎ space", does: "on a note" }, { keys: "double-click", does: "a note" }, { keys: "alt+⏎", does: "fresh", says: "open the selected note in a new detail beside" }],
    touches: "nothing", replay: "safe", says: r => `opened "${String(r.title)}"`,
    args: {
      n: { type: "number", optional: true, about: "its row, from 1" },
      id: { type: "string", optional: true, about: "a block id (or its first 8+ characters)" },
      fresh: { type: "boolean", optional: true, about: "in a new detail beside, as alt+⏎ does" },
    },
    examples: [
      { act: "facets.open id=7d9a1f40 tile=facets", does: "opens that note where the facets tile's opens land" },
      { act: "facets.open n=9 fresh=true tile=facets", does: "opens the note on row 9 in a new detail beside" },
    ],
    run({ n, id, fresh }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane;
      const note = p.noteFor({ n, id });
      desk.openFromTile(note, { from: p.source(), link: true, ...(fresh ? { fresh: true } : {}), by: actor });
      // In a flow too narrow for every column (the navigator at 44), the reader it landed in comes to the wide place.
      const landed = !fresh && standing ? desk.linked?.(p.source()) : undefined;
      if (landed && desk.coverOf?.(landed) !== "full" && desk.coverOf?.(landed) !== undefined) void desk.perform?.("tile.widen", {}, actor, landed);
      desk.redraw();
      return { id: note.id, title: subject(note) };
    },
  }),
  "facets.query": def({
    summary: "set the selection as text in the views' grammar (`project=x/* type=meeting #yomama NOT week=3`): it replaces the picks; the service evaluates it and the facets and notes follow. Empty clears. The person types it with e",
    keys: [{ keys: "e", does: "then typing edits the query" }, { keys: "⏎", does: "applies", says: "apply the typed query as the selection" }, { keys: "esc", does: "undoes", says: "undo the typed query" }], touches: "tile", while: "typing", replay: "safe", way: "an agent passes text=<query>: the person's selection moves with it",
    args: { text: { type: "string", about: "the query; empty clears the selection" } },
    examples: [
      { act: "facets.query text=\"#garden NOT type=meeting\" tile=facets", does: "selects notes tagged #garden that are not meetings, replacing the picks" },
      { act: "facets.query text=\"\" tile=facets", does: "clears the selection so every note is left" },
    ],
    run({ text }, { pane, desk }) {
      const p = pane as FacetsPane;
      return p.serial(async () => {
        const before = { raw: p.raw, clauses: p.clauses };
        // It replaces every pick, the calendar's day too.
        p.raw = text.trim(); p.clauses = []; p.day = null;
        if (!(await p.load(desk))) { const why = p.describe().error; p.raw = before.raw; p.clauses = before.clauses; throw new ActionRefused(`that query wasn't answered${why ? `: ${why}` : ""}`); }
        desk.keepLayout?.(); desk.redraw();
        return { query: p.query(), notes: p.describe().matched };
      });
    },
  }),
  "facets.save": def({
    summary: "save the selection as a view: a block `[type::virtual-branch] [query::<the query>]` under a hub (parent=<block id>; left out, the note most of the outline's views live under, else the newest board hub, else the top level), named name=. The person is asked the name and the hub in the power bar (PIE-1448); a selection already saved as a view is refused with that view's name (facets.view opens it)",
    keys: "v", touches: "nothing", replay: "ask", says: r => `saved view "${String(r.title)}"`,
    args: { name: { type: "string", optional: true, about: "the view's name" }, parent: { type: "string", optional: true, kind: "note", about: "the hub's block id" } },
    examples: [
      { act: "facets.save name=\"Garden beds\" tile=facets", does: "saves the selection as a view named Garden beds under the note most views live under" },
      { act: "facets.save name=\"Shed to-do\" parent=2b7f5e90-1c34-4a86-8d5e-9f0a3c7b1d62 tile=facets", does: "saves the selection as a view under that hub block" },
    ],
    async run({ name, parent }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane, q = p.query();
      if (!q) throw new ActionRefused("nothing is selected: pick a value or type a query first, then save it as a view");
      const same = p.viewWithQuery(q);
      if (same) throw new ActionRefused(`this selection is already the view "${subject(same)}" · facets.view id=${same.id.slice(0, 8)} opens it`);
      const board = desk.ctx.board;
      const home = p.viewsHome() ?? (await findBoards(board))[0]?.hub.id ?? null;
      const save = async (label: string, hub: string | null) => {
        const title = (label.trim() || q).replace(/[\[\]\n]/g, " ").slice(0, 60);
        const made = await board.createBlock(hub, `${title} [type::virtual-branch] [query::${q}]`, actor);
        // Listed at once, whether the views are open or folded: the next v on this pick names it.
        p.viewSaved(made);
        desk.ctx.flash(`saved "${title}" as a view${hub ? ` under ${p.homeName(hub) ?? "its hub"}` : ""}`);
        await p.refresh(desk);
        return { id: made.id, title, parent: hub, query: q };
      };
      if (name !== undefined || !standing) return save(name ?? "", parent ?? home);
      // The person names it and says where it goes, in the power bar: the hub the views already share first.
      return askInBar(desk.ctx as never, "Save the selection as a view", [
        { name: "name", label: "name", type: "text", free: true, required: true, value: "", description: `what the view is called (its query: ${q})` },
        { name: "parent", label: "under", type: "note", required: false, ...(home ? { choices: [home], says: { [home]: p.homeName(home) ?? home } } : {}), description: "the note it goes under: the hub most views share, or any note found by its words" },
      ], parent ? { parent } : {}, actor, answers => save(answers.name ?? "", answers.parent || home));
    },
  }),
  "facets.sort": def({
    summary: "sort the values by uses (most first), name or last use (newest first): by=<one>, or the next in turn",
    keys: "s, a click on a header word", touches: "tile", while: "typing", replay: "safe", way: "an agent sorts the person's tile only with by=<sort>",
    args: { by: { type: "string", optional: true, about: "uses, name or last" } },
    examples: [
      { act: "facets.sort by=name tile=facets", does: "sorts the values by name" },
      { act: "facets.sort by=last tile=facets", does: "sorts the values by last use, newest first" },
    ],
    run({ by }, { pane, desk }) {
      const p = pane as FacetsPane;
      if (by !== undefined && !(FACET_SORTS as readonly string[]).includes(by)) throw new ActionRefused(`sort by ${FACET_SORTS.join(", ")}, not ${by}`);
      p.keeping(() => { p.sort = (by as FacetSort | undefined) ?? FACET_SORTS[(FACET_SORTS.indexOf(p.sort) + 1) % FACET_SORTS.length]!; });
      desk.keepLayout?.(); desk.redraw();
      return { sort: p.sort };
    },
  }),
  "facets.zero": def({
    summary: "list the values (and facets) no note the selection leaves carries, dimmed at 0, or hide them again: on=<true|false>, or the other way round",
    keys: "z", touches: "tile", while: "typing", replay: "safe", way: "an agent says on=<true|false>",
    args: { on: { type: "boolean", optional: true, about: "show them (true) or hide them (false)" } },
    examples: [
      { act: "facets.zero on=true tile=facets", does: "lists the values no remaining note carries, dimmed at 0" },
      { act: "facets.zero on=false tile=facets", does: "hides the zero-count values again" },
    ],
    async run({ on }, { pane, desk }) { const p = pane as FacetsPane; p.keeping(() => { p.zero = on ?? !p.zero; }); await p.refresh(desk); desk.keepLayout?.(); desk.redraw(); return { zero: p.zero }; },
  }),
  "facets.clear": def({
    summary: "drop every pick and the typed query: the tile lists all the outline's facets again",
    keys: "x", touches: "tile", while: "typing", replay: "safe", way: "an agent clears the person's selection by calling it",
    args: {},
    run(_, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane;
      return p.serial(async () => {
        const before = { raw: p.raw, clauses: p.clauses, at: p.at };
        p.raw = ""; p.clauses = []; if (standing) p.at = 0;
        if (!(await p.load(desk))) { p.raw = before.raw; p.clauses = before.clauses; p.at = before.at; throw new ActionRefused("the service couldn't answer · r asks again"); }
        desk.keepLayout?.();
        return { query: "", facets: p.describe().facets.length };
      });
    },
  }),
  "facets.reload": def({
    summary: "ask the service for the facets and notes again", keys: "r", touches: "nothing", replay: "safe", args: {},
    async run(_, { pane, desk }) { const p = pane as FacetsPane; await p.refresh(desk); return p.describe(); },
  }),
  "facets.resize": def({
    summary: "resize the matching notes' share of the tile: share= (0.15 to 0.85), or by= (a change in share)",
    keys: [{ keys: "[", does: "less", says: "give the matching notes less of the tile" }, { keys: "]", does: "more", says: "give the matching notes more of the tile" }, { via: "the Matches less/more buttons" }, { keys: "drag", does: "its divider" }],
    touches: "tile", while: "typing", replay: "safe", way: "an agent names share= or by=",
    args: {
      share: { type: "number", optional: true, about: "the matching notes' share, 0.15 to 0.85" },
      by: { type: "number", optional: true, about: "change in share" },
    },
    examples: [{ act: "facets.resize share=0.6 tile=facets", does: "gives matching notes sixty percent of the tile's body" }],
    run({ share, by }, { pane, desk }) {
      const p = pane as FacetsPane;
      if ((share === undefined) === (by === undefined)) throw new ActionRefused("facets.resize takes share= or by=");
      p.share = clamp(share ?? p.share + by!, 0.15, 0.85);
      desk.keepLayout?.(); desk.redraw();
      return { share: p.share };
    },
  }),
  "facets.match": def({
    summary: "pick a note in Matches (the notes the selection leaves): id, or by=<notes> from the one picked; it previews where the tile's selection goes (its Matches tile's wires, while Matches is in one). An agent's pick is its own, drawn in its tint: the person's stays",
    keys: [{ keys: "j k ↑ ↓ pgup pgdn", does: "in Matches' own tile", says: "pick the next or previous note in Matches' own tile" }, { keys: "home g end G", does: "in Matches' own tile", says: "pick the first or last note in Matches' own tile" }, { keys: "click wheel", does: "on Matches", says: "pick a note in Matches by clicking or scrolling it" }],
    touches: "nothing", replay: "safe", says: r => `picked "${String(r.title)}"`,
    args: { id: { type: "string", optional: true, about: "a note's block id (or its first 8+ characters)" }, by: { type: "number", optional: true, about: "notes on from the one picked (negative: up)" } },
    examples: [{ act: "facets.match by=1 tile=facets", does: "picks the next note in Matches; a reader wired to it shows it" }],
    run({ id, by }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane, who = standing ? PERSON : actorKey(actor);
      if ((id === undefined) === (by === undefined)) throw new ActionRefused("facets.match takes id or by");
      const go = (): unknown => {
        const had = p.list.pickable(who).length;
        const row = id !== undefined ? p.list.pick(who, p.noteFor({ id }).id) : p.list.step(who, by!) ?? p.list.picked(who);
        // End (a step past every row, PAST_END) reads a group's rest on the way and lands on the last note (PIE-1457),
        // while a read brings rows (notes sharing one time can page the same rows again).
        if (row?.id.startsWith(MORE)) {
          const read = p.readGroup(desk, row.id.slice(MORE.length));
          return by !== undefined && by >= PAST_END ? read.then(r => (p.list.pickable(who).length > had ? go() : r)) : read;
        }
        const m = row?.source;
        if (!m) throw new ActionRefused("Matches lists no note yet");
        if (standing) { const at = p.rows().findIndex(r => r.kind === "note" && r.note.id === m.id); if (at >= 0) p.at = at; desk.showFrom?.(p.source(), m, actor); }
        desk.redraw();
        return { id: m.id, title: subject(m) };
      };
      return go();
    },
  }),
  "facets.more": def({
    summary: "read the rest of a group of Matches (PIE-1448: its first page holds 200 notes; a group past it shows a ▸ more row): group= its heading (Today, Yesterday, Previous 7 days, a month such as October 2026). The service answers the selection with the clause that holds just that group",
    keys: [{ keys: "⏎", does: "on a group's more row", says: "read the rest of that group" }, { keys: "click", does: "a group's more row", says: "read the rest of that group by clicking its more row" }, { keys: "j", does: "onto a group's more row", says: "walking onto a more row reads the rest of its group" }],
    touches: "tile", replay: "safe", says: r => `read ${String(r.notes)} notes of ${String(r.group)}`,
    args: { group: { type: "string", about: "the group's heading, as Matches shows it" } },
    examples: [{ act: "facets.more group=\"September 2026\" tile=facets", does: "reads every note of September 2026 the selection leaves" }],
    run({ group }, { pane, desk }) { return (pane as FacetsPane).readGroup(desk, group); },
  }),
  "facets.place": def({
    summary: "put Matches somewhere else (PIE-1443, as a reader's Sources and comments): inline under the facets, split beside them, floating, popup, or tile (a tile of its own beside this one, wired as any list: its select and open wires say where a pick previews and ⏎ opens); left out, the next place round. side= puts its tile on that side",
    keys: [{ keys: "ctrl+o", does: "next place", says: "move Matches to its next place: inline, floating, split, popup, tile" }, { keys: "click", does: "the ⧉ chip on the Matches line", says: "move Matches by clicking the ⧉ chip on its line" }],
    touches: "tile", replay: "safe", says: r => `Matches ${String(r.place)}`,
    args: { place: { type: "string", optional: true, choices: ATTACHED_PLACES, about: "inline, floating, split, popup or tile" }, side: { type: "string", optional: true, choices: ["left", "right", "up", "down"], about: "with place=tile: which side of the facets tile" } },
    examples: [
      { act: "facets.place place=tile side=right tile=facets", does: "puts Matches in a tile of its own to the right of the facets" },
      { act: "facets.place place=inline tile=facets", does: "brings Matches back under the facets, closing its tile" },
    ],
    async run({ place, side }, { pane, desk }) {
      const p = pane as FacetsPane;
      if (place !== undefined && !attachedPlaceOf(place)) throw new ActionRefused(`place is ${ATTACHED_PLACES.join(", ")}, not ${place}`);
      return { place: await p.placeMatches(place as AttachedPlace | undefined, desk, side as AttachedSide | undefined) };
    },
  }),
  "facets.pin": def({
    summary: "pin a note Matches lists, or unpin it: pinned notes come first, under Pinned. A pin is a link on the tile's pins page (`[[pins]]`, made the first time; PIE-1448): the note pinned is never edited, as Notebook Navigator's pins don't touch the file. A note pinned by its own `[<pin>::true]` (written by hand) is unpinned by taking that property off. id, n (its row), or the picked note; on=true|false, else the other way round. Attributed",
    keys: "* on a note", touches: "nothing", replay: "ask", says: r => `${r.pinned ? "pinned" : "unpinned"} "${String(r.title)}"`,
    args: { id: { type: "string", optional: true, about: "a note's block id" }, n: { type: "number", optional: true, about: "its row, from 1" }, on: { type: "boolean", optional: true, about: "pin (true) or unpin (false)" } },
    examples: [{ act: "facets.pin id=7d9a1f40 tile=facets", does: "pins that note: it moves to the top of Matches, and only the pins page changes" }],
    async run({ id, n, on }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane, m = p.noteFor({ id, n }, standing ? PERSON : actorKey(actor)), board = desk.ctx.board;
      const page = await board.resolvePage(p.pins);
      const pins = page.status === "resolved" && page.block ? await board.get(page.block.id) : null;
      if (pins) p.pinsPageIs(pins.id);
      // Pinned by the page: the page links to it, as the list reads it (linkedfrom), however the link is written.
      const linked = !!pins && (await board.queryNotes(`linkedfrom:${pins.id}`, 1000)).notes.some(x => x.id === m.id);
      const own = await board.propertyTokens(m.id, p.pin);
      const byProperty = own.tokens.filter(t => t.value.trim().toLowerCase() === "true");
      const pinned = linked || byProperty.length > 0, want = on ?? !pinned;
      if (want && !pinned) {
        const line = `- ${blockRefText(m.id, subject(m).replace(/[|()\]\[]/g, " ").slice(0, 60))}`;
        if (pins) await board.update(pins.id, `${pins.text.replace(/\s+$/, "")}\n${line}`, pins.revision!, actor);
        else p.pinsPageIs((await board.createBlock(null, `Pins [page::${p.pins}]\nThe notes the navigator pins, one link a line: a pin never edits its note.\n\n${line}`, actor)).id);
      }
      if (!want && linked) {
        const kept = pins!.text.split("\n").filter(l => !l.includes(m.id.slice(0, 8)));
        if (kept.length === pins!.text.split("\n").length) throw new ActionRefused(`"${subject(m)}" is pinned by a link written another way on [[${p.pins}]]: take that line out there`);
        await board.update(pins!.id, kept.join("\n"), pins!.revision!, actor);
      }
      // Pinned by hand in the note itself: unpinning takes the property off (the one case that edits it).
      if (!want && byProperty.length) await board.patchProperties(m.id, own.revision, byProperty.map(t => ({ op: "remove" as const, ordinal: t.ordinal })), actor);
      await p.refresh(desk);
      return { id: m.id, title: subject(m), pinned: want };
    },
  }),
  "facets.tag": def({
    summary: "give a note Matches lists a tag or any property, written to the note as the person would: value=#tag (or key=tag value=…) for a tag, key= value= for a property. Left out, the person is asked in the power bar's form, the key from the outline's keys and the value from that key's values (the one completer)",
    keys: "t on a note", touches: "nothing", replay: "ask", says: r => `${String(r.key)} ${String(r.value)} on "${String(r.title)}"`,
    args: {
      id: { type: "string", optional: true, about: "a note's block id; left out, the picked one" },
      key: { type: "string", optional: true, kind: "key", about: "the property (tag for a tag)" },
      value: { type: "string", optional: true, kind: "value", of: "key", about: "its value (#word alone is a tag)" },
    },
    examples: [
      { act: "facets.tag id=7d9a1f40 value=#urgent tile=facets", does: "tags that note #urgent" },
      { act: "facets.tag id=7d9a1f40 key=stage value=next tile=facets", does: "writes [stage::next] on that note" },
    ],
    async run({ id, key, value }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane, m = p.noteFor({ id }, standing ? PERSON : actorKey(actor));
      const write = async (key: string | undefined, value: string | undefined) => {
        const tag = !key?.trim() && value?.trim().startsWith("#");
        const k = tag ? "tag" : key?.trim().replace(/^#$/, "tag"), v = (tag ? value!.trim().slice(1) : value?.trim())?.replace(/^#/, "");
        if (!k || !v) throw new ActionRefused("facets.tag takes key= and value= (value=#word alone is a tag)");
        const { revision } = await board(desk).propertyTokens(m.id, k);
        await board(desk).patchProperties(m.id, revision, [{ op: "append", key: k, value: v }], actor);
        await p.refresh(desk);
        return { id: m.id, title: subject(m), key: k, value: v };
      };
      if ((key?.trim() && value?.trim()) || value?.trim().startsWith("#") || !standing) return write(key, value);
      // The person is asked in the power bar: the key from the outline's keys, then that key's values (the one completer).
      return askInBar(desk.ctx as never, `Tag or property on "${subject(m)}"`, [
        { name: "key", label: "key", type: "text", kind: "key", free: true, required: true, description: "the property: tag for a #tag, or any key the outline has (or a new one)" },
        { name: "value", label: "value", type: "text", kind: "value", of: "key", free: true, required: true, description: "its value" },
      ], key?.trim() ? { key: key.trim() } : {}, actor, answers => write(answers.key, answers.value));
    },
  }),
  "facets.day": def({
    summary: "narrow the selection to the notes changed on a day (the calendar's pick): day=YYYY-MM-DD, or by=<days> from the one picked; day= empty drops it. Matches and the facets follow. Days are the service's (as `updated >= YYYY-MM-DD` reads)",
    keys: [{ keys: "click", does: "a day on the calendar", says: "narrow to the notes changed on the day clicked" }, { keys: "d", does: "today", says: "narrow to the notes changed today" }, { keys: ", .", does: "the day before, the day after", says: "step the picked day back or forward" }, { keys: "⏎ 0 backspace", does: "on the day's pick, drops it", says: "drop the day from the selection" }],
    touches: "tile", replay: "safe", says: r => (r.day ? `the notes of ${String(r.day)}` : "every day"),
    args: { day: { type: "string", optional: true, about: "YYYY-MM-DD; empty drops the day" }, by: { type: "number", optional: true, about: "days on from the picked one" } },
    examples: [
      { act: "facets.day day=2026-10-30 tile=facets", does: "narrows the selection to notes changed that day" },
      { act: "facets.day day=\"\" tile=facets", does: "drops the day from the selection" },
    ],
    run({ day, by }, { pane, desk }) {
      const p = pane as FacetsPane;
      let next: string | null;
      if (by !== undefined) {
        if (!p.day) throw new ActionRefused("no day is picked · d picks today");
        const [y, mo, d] = p.day.split("-").map(Number) as [number, number, number];
        next = isoDay(new Date(y, mo - 1, d + Math.trunc(by)));
      } else next = day?.trim() ? day.trim() : null;
      if (next && !DAY.test(next)) throw new ActionRefused(`a day is YYYY-MM-DD, not ${next}`);
      return p.serial(async () => {
        const was = p.day;
        p.day = next;
        if (next) { const [y, mo] = next.split("-").map(Number) as [number, number]; p.month = { year: y, month: mo }; }
        if (!(await p.load(desk))) { p.day = was; throw new ActionRefused("the service couldn't answer · r asks again"); }
        desk.keepLayout?.(); desk.redraw();
        return { day: p.day, query: p.query(), notes: p.describe().matched };
      });
    },
  }),
  "facets.month": def({
    summary: "show another month on the calendar: by=<months> (« is -1, » is 1); each day lit has notes the selection leaves",
    keys: "click « or » on the calendar", touches: "tile", replay: "safe",
    args: { by: { type: "number", about: "months on (negative: back)" } },
    examples: [{ act: "facets.month by=-1 tile=facets", does: "shows last month" }],
    async run({ by }, { pane, desk }) {
      const p = pane as FacetsPane, at = new Date(p.month.year, p.month.month - 1 + Math.trunc(by), 1);
      p.month = { year: at.getFullYear(), month: at.getMonth() + 1 };
      await p.refresh(desk);
      return { month: `${p.month.year}-${String(p.month.month).padStart(2, "0")}` };
    },
  }),
  "facets.view": def({
    summary: "set the selection to a saved view's query (a shortcut: the views listed at the top of the tile): id= the view's block id. The picks are replaced; v saves a selection back as a view",
    keys: "⏎ or a click on a view", touches: "tile", replay: "safe", says: r => `the view's query: ${String(r.query)}`,
    args: { id: { type: "string", kind: "view", about: "the saved view's block id" } },
    examples: [{ act: "facets.view id=7d9a1f40 tile=facets", does: "the selection becomes that view's query; Matches follows" }],
    async run({ id }, { pane, desk }) {
      const p = pane as FacetsPane;
      const v = p.viewNamed(id) ?? await desk.ctx.board.get(id);
      const q = v ? prop(v, "query") : undefined;
      if (!v || !q) throw new ActionRefused(`${id} is no saved view with a [query::…] · facets.list names the views`);
      return p.serial(async () => {
        const before = { raw: p.raw, clauses: p.clauses, day: p.day };
        p.raw = q; p.clauses = []; p.day = null;
        if (!(await p.load(desk))) { Object.assign(p, before); throw new ActionRefused(`the view's query wasn't answered: ${q}`); }
        desk.keepLayout?.(); desk.redraw();
        return { view: v.id, query: p.query(), notes: p.describe().matched };
      });
    },
  }),
  "facets.list": def({
    summary: "read the tile: the query, the picks, the sort, every facet with its notes and (opened) its values with uses and last use, and the notes the selection leaves",
    touches: "nothing", replay: "safe", args: {},
    run: (_, { pane }) => (pane as FacetsPane).describe(),
  }),
});

const SORTS = FACET_SORTS as readonly string[];
const makeFacets = (kind: "facets" | "tags") => (s: { query?: string; args?: Record<string, unknown> }) => {
  const a = s.args ?? {};
  if (a.share !== undefined && (typeof a.share !== "number" || !Number.isFinite(a.share) || a.share < 0.15 || a.share > 0.85)) throw new ActionRefused("facets: args.share must be a number from 0.15 to 0.85; edit the screen's tile args to share: 0.4");
  if (a.place !== undefined && !attachedPlaceOf(a.place)) throw new ActionRefused(`facets: args.place is ${ATTACHED_PLACES.join(", ")}`);
  return new FacetsPane(kind, { query: s.query, sort: SORTS.includes(String(a.sort)) ? (a.sort as FacetSort) : undefined, zero: a.zero === true, share: a.share as number | undefined, ...(Array.isArray(a.open) ? { open: a.open.map(String) } : {}),
    ...(attachedPlaceOf(a.place) ? { place: attachedPlaceOf(a.place)! } : {}), ...(typeof a.pin === "string" ? { pin: a.pin } : {}), ...(Array.isArray(a.show) ? { show: a.show.map(String) } : {}),
    ...(typeof a.group === "string" ? { group: a.group } : {}), ...(typeof a.calendar === "boolean" ? { calendar: a.calendar } : {}), ...(typeof a.day === "string" && DAY.test(a.day) ? { day: a.day } : {}) });
};
const kindOf = (kind: "facets" | "tags", about: string, key: string): TileKind => ({
  kind, about, noun: kind === "tags" ? "a tags tile" : "a facets tile",
  keys: [{ key, label: kind }],
  openArgs: ["query", "args"], previews: true,
  make: makeFacets(kind),
  actions: FACETS_ACTIONS,
  save: p => (p as FacetsPane).spec(),
  check: s => (s.query !== undefined && !s.query.trim() ? "a facets tile's query is the views' grammar, or left out" : null),
  shows: p => { const f = p as FacetsPane, r = f.current(); return r?.kind === "note" ? r.note : f.list.picked(PERSON)?.source ?? null; },
  // In brief (layout.get without full=true), its selection, counts and where Matches is: the lists are the facets tile's own read (facets.list).
  describe: (p, full) => { const d = (p as FacetsPane).describe(); return full ? d : { query: d.query, total: d.total, matched: d.matched, facets: d.facets.length, matches: d.matches.place, ...(d.day ? { day: d.day } : {}), ...(d.error ? { error: d.error } : {}) }; },
  peek: p => ({ facets: (p as FacetsPane).describe() }),
});
/**
 * A query a reader on this screen opens (a `#tag`, a figure row's, a calendar day's) becomes the facets tile's selection
 * (PIE-1448): one written as the calendar's own day clause picks that day, keeping the picks; anything else replaces them.
 */
async function takeQuery(p: Pane, query: string, desk: DeskApi, actor: Actor) {
  const f = p as FacetsPane, day = dayOfClause(query);
  if (day) await desk.within!("facets.day", { day }, actor, f);
  else await desk.within!("facets.query", { text: query }, actor, f);
  return { query: f.query(), notes: f.notes().map(m => ({ id: m.id, title: subject(m) })) };
}

export const FACETS_KIND: TileKind = { ...kindOf("facets", "the properties the notes have, each opening to its values with uses and last use: include or exclude values (ORed in a facet, ANDed across them), path values as a tree, the selection as the views' query text, editable and savable as a view (PIE-881); query=<a starting query>", "f"), takesQuery: takeQuery };
/** The same tile opened on the tags facet (`#tag` is a facet like any property). */
export const TAGS_KIND: TileKind = kindOf("tags", "the facets tile opened on the tags: every tag with its uses and last use, faceted so picking a tag leaves the tags that still narrow the results (PIE-881)", "#");
