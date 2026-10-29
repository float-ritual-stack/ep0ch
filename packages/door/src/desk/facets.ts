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
import { subject, type Msg } from "../board";
import type { FacetAnswer } from "../socket";
import { ActionRefused, actionSet, def, keysText } from "../surface/actions";
import { C, fg, pad, RESET, selectedRow } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ago, rowLines } from "../text";
import { RowView, wheelRows, clamp, type RowPress } from "../scroll";
import { LineField } from "../surface/line";
import { findBoards } from "./query";
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
  | { kind: "note"; note: Msg };

const HINT = "j k pick · ⏎ or click includes a value, again excludes it, again drops it · + − 0 · e edit the query · v save as a view · s sort · z zero · x clear";
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

export class FacetsPane implements Pane {
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
  private matches = new RowView();
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

  constructor(public readonly kind: "facets" | "tags" = "facets", o: { query?: string; open?: readonly string[]; sort?: FacetSort; zero?: boolean; share?: number } = {}) {
    this.share = o.share ?? 0.4;
    this.raw = o.query ?? ""; this.sort = o.sort ?? "uses"; this.zero = o.zero ?? false;
    this.open = new Set(o.open ?? (kind === "tags" ? ["tag"] : []));
  }

  /** The selection as the query the service is asked. */
  query(): string { return selectionQuery(this.clauses, this.raw); }
  title() { const q = this.query(); return q ? `${this.kind} ${q}` : this.kind; }
  hint() { return this.draft ? "type the query (the views' grammar: #tag key=value NOT … OR …) · ⏎ apply · esc undo" : `${HINT} · ${keysText(FACETS_ACTIONS.def("facets.resize")!.keys)}`; }
  headLabel() { return fg(C.dark) + (this.error ? "failed" : this.answer ? String(this.answer.facets.length) : "…") + RESET; }
  spine() { return { title: this.title() }; }
  typing() { return this.draft !== null; }
  lineField() { return this.draft; }
  blur() { this.draft = null; }
  spec() {
    const q = this.query();
    return { ...(q ? { query: q } : {}), args: { share: this.share, sort: this.sort, ...(this.zero ? { zero: true } : {}), ...(this.open.size ? { open: [...this.open] } : {}) } };
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
      const [now, all] = await Promise.all([board.facetList(q), q ? board.facetList("", 0) : null]);
      if (n !== this.asked) return true;
      const was = this.rowKey(this.current());
      this.answer = now; this.all = all ?? now; this.error = null;
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

  /** The rows the cursor walks: the picks, then each facet and, opened, its values, then the notes the selection leaves. */
  rows(): Row[] {
    if (!this.answer) return [];
    // Asked a dozen times a frame (the cursor's row, what the tile shows, each tile's facts): built once for what it is built from.
    const from = `${this.sort}|${this.zero}|${[...this.open].join(",")}|${this.clauses.map(c => `${c.key}\0${c.value}\0${c.mode}\0${c.path ? 1 : 0}`).join("\n")}`;
    const kept = this.rowsKept;
    if (kept && kept.answer === this.answer && kept.all === this.all && kept.from === from) return kept.rows;
    const rows = this.build(this.answer);
    this.rowsKept = { answer: this.answer, all: this.all, from, rows };
    return rows;
  }
  private rowsKept: { answer: FacetAnswer; all: FacetAnswer | null; from: string; rows: Row[] } | null = null;
  private build(answer: FacetAnswer): Row[] {
    const rows: Row[] = this.clauses.map(clause => ({ kind: "clause", clause }));
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
    for (const note of answer.notes) rows.push({ kind: "note", note });
    return rows;
  }
  current(): Row | undefined { return this.rows()[this.at]; }
  private rowKey(r: Row | undefined) {
    return !r ? null : r.kind === "clause" ? `c:${r.clause.key}=${r.clause.value}` : r.kind === "facet" ? `f:${r.key}` : r.kind === "value" ? `v:${r.key}=${r.node.path}` : `n:${r.note.id}`;
  }
  /** Run `change`, which reorders rows, and keep the cursor on the row it was on. */
  keeping(change: () => void) {
    const was = this.rowKey(this.current());
    change();
    const at = was ? this.rows().findIndex(r => this.rowKey(r) === was) : -1;
    this.at = at >= 0 ? at : Math.min(this.at, Math.max(0, this.rows().length - 1));
  }

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = this.rows();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    this.width = w;
    const lines: string[] = [];
    this.lineRows = [];
    const push = (text: string, row = -1) => { lines.push(text); this.lineRows.push(row); };
    const cell = (sort: FacetSort, label: string) => (this.sort === sort ? fg(C.white) + `\x1b[1m${label}▾\x1b[22m` : fg(C.dark) + label + " ") + RESET;
    const a = this.answer, q = this.query();
    push(pad(` ${fg(C.dark)}${a?.matched ?? "…"} of ${this.all?.matched ?? "…"} notes`, Math.max(0, w - USES - 1 - LAST)) + cell("uses", "uses") + " " + cell("last", "last"));
    if (this.draft) push(fg(C.yellow) + ` ? ${this.draft.plain()}` + RESET);
    else push(fg(C.dark) + pad(q ? ` ? ${q}` : " ? every note · e types a query", w) + RESET);
    if (this.error) push(fg(C.lred) + " " + this.error + RESET);
    else if (!a) push(fg(C.dark) + " loading…" + RESET);
    if (a?.hint) push(fg(C.yellow) + " " + a.hint + RESET);
    this.bodyRoom = Math.max(0, h - lines.length - 1);
    const noteRoom = this.bodyRoom > 1 ? clamp(Math.round(this.bodyRoom * this.share), 1, this.bodyRoom - 1) : this.bodyRoom;
    this.noteRoom = noteRoom;
    const keyRoom = this.bodyRoom - noteRoom;
    const draw = (notes: boolean, room: number, view: RowView) => {
      const body: { text: string; row: number }[] = [];
      rows.forEach((r, i) => {
        if ((r.kind === "note") !== notes) return;
        for (const text of this.line(r, i === this.at, focused, w)) body.push({ text, row: i });
      });
      if (!body.length) body.push({ text: fg(C.dark) + (notes ? " No matching notes." : " No properties.") + RESET, row: -1 });
      const first = body.findIndex(l => l.row === this.at), last = body.findLastIndex(l => l.row === this.at);
      view.place(first < 0 ? null : first, body.length, room, first < 0 ? null : [first, last]);
      for (let i = 0; i < room; i++) {
        const l = body[view.top + i];
        push(l?.text ?? "", l?.row ?? -1);
      }
    };
    draw(false, keyRoom, this.view);
    this.divider = lines.length;
    push(fg(C.dark) + pad(` ── Matches [less] [more] · drag to resize${a?.truncated ? ` · first ${a.notes.length}` : ""}`, w) + RESET);
    draw(true, noteRoom, this.matches);
    return { lines: lines.slice(0, h) };
  }

  private line(r: Row, on: boolean, focused: boolean, w: number): string[] {
    const style = (text: string, colour: string) => rowLines(text, w).map(text => (on ? selectedRow(text.replace(/\x1b\[(?!777;|778m)[\d;]*m/g, ""), w, focused, "idleRow") : colour + pad(text, w) + RESET));
    const room = Math.max(4, w - 3 - (USES + 1 + LAST));
    if (r.kind === "note") return style(` ${subject(r.note)} · ${ago(r.note.updatedAt)}`, fg(C.grey));
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
    return row !== undefined && row >= 0 ? { row } : {};
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
    const by = isDown(k) ? 1 : isUp(k) ? -1 : k.kind === "pgdn" ? 8 : k.kind === "pgup" ? -8 : 0;
    if (by) { if (n) this.act(desk, "facets.pick", { by }); return true; }
    if (k.kind === "enter" || c === " ") {
      if (row?.kind === "note") this.act(desk, "facets.open");
      else if (row?.kind === "facet") this.act(desk, "facets.fold");
      else if (row?.kind === "clause") this.act(desk, "facets.set", { key: row.clause.key, value: row.clause.value, mode: row.clause.mode === "include" ? "exclude" : "off" });
      else if (row?.kind === "value") this.act(desk, "facets.set");
      return true;
    }
    if (k.kind === "alt-enter") { if (row?.kind === "note") this.act(desk, "facets.open", { fresh: true }); return true; }
    if (c === "+" || c === "=") { this.act(desk, "facets.set", { mode: "include" }); return true; }
    if (c === "-") { this.act(desk, "facets.set", { mode: "exclude" }); return true; }
    if (c === "0" || k.kind === "backspace") { this.act(desk, "facets.set", { mode: "off" }); return true; }
    if (c === "e") { this.draft = new LineField(this.query(), false, { complete: false }); desk.redraw(); return true; }
    if (c === "[" || c === "]") { this.act(desk, "facets.resize", { by: c === "[" ? -0.1 : 0.1 }); return true; }
    if (c === "v") { this.act(desk, "facets.save"); return true; }
    if (c === "s") { this.act(desk, "facets.sort"); return true; }
    if (c === "z") { this.act(desk, "facets.zero"); return true; }
    if (c === "x") { this.act(desk, "facets.clear"); return true; }
    if (c === "r") { this.act(desk, "facets.reload"); return true; }
    return false;
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (this.draft !== null) return true;
    if (k.action === "up") { this.dragging = false; return true; }
    if (this.dragging && k.action === "drag") {
      this.act(desk, "facets.resize", { share: (this.divider + this.noteRoom - y) / Math.max(1, this.bodyRoom) });
      return true;
    }
    if (k.action === "down" && y === this.divider) {
      if (x >= 12 && x < 18) this.act(desk, "facets.resize", { by: -0.1 });
      else if (x >= 19 && x < 25) this.act(desk, "facets.resize", { by: 0.1 });
      else this.dragging = true;
      return true;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const part = y > this.divider ? "matches" : "keys";
      if (this.rows().some(r => (r.kind === "note") === (part === "matches"))) this.act(desk, "facets.pick", { by: wheelRows(k.action === "wheel-up" ? -1 : 1), part });
      return true;
    }
    if (k.action !== "down") return true;
    const hit = this.hit(x, y);
    if (hit.sort) { this.act(desk, "facets.sort", { by: hit.sort }); return true; }
    if (hit.row === undefined) return true;
    const g = this.view.press(hit.row, press ?? { mods: k.mods ?? 0, button: k.button });
    const r = this.rows()[hit.row];
    this.act(desk, "facets.pick", { n: hit.row + 1 });
    // A click on a value includes it (again excludes it, again drops it); alt- or ctrl-click excludes it at once.
    if (r?.kind === "value") this.act(desk, "facets.set", { n: hit.row + 1, ...((k.mods ?? 0) & (1 | 4) ? { mode: "exclude" } : {}) });
    else if (r?.kind === "facet") {
      if (x >= 3 && x <= 5) this.act(desk, "facets.set", { key: r.key, mode: "include" });
      else if (x >= 7 && x <= 9) this.act(desk, "facets.set", { key: r.key, mode: "exclude" });
      else this.act(desk, "facets.fold", { n: hit.row + 1 });
    }
    else if (r?.kind === "clause") this.act(desk, "facets.set", { key: r.clause.key, value: r.clause.value, mode: "off" });
    else if (r?.kind === "note" && (g === "open" || g === "fresh")) this.act(desk, "facets.open", { n: hit.row + 1, ...(g === "fresh" ? { fresh: true } : {}) });
    return true;
  }

  describe() {
    const rows = this.rows();
    return {
      query: this.query(), clauses: this.clauses, raw: this.raw, sort: this.sort, zero: this.zero, share: this.share, total: this.all?.matched ?? 0, matched: this.answer?.matched ?? 0,
      facets: rows.flatMap(r => (r.kind === "facet" ? [{ key: r.key, notes: r.count, open: r.open, values: rows.filter((v): v is Extract<Row, { kind: "value" }> => v.kind === "value" && v.key === r.key).map(v => ({ value: v.node.path, uses: v.node.value?.count ?? null, last: v.node.value?.last ? new Date(v.node.value.last).toISOString() : null, ...(v.state ? { state: v.state } : {}), ...(v.zero ? { zero: true } : {}) })) }] : [])),
      notes: (this.answer?.notes ?? []).map(m => ({ id: m.id, title: subject(m) })), ...(this.error ? { error: this.error } : {}), ...(this.draft ? { typing: this.draft.text } : {}),
    };
  }
}

const bare = (t: string) => t.replace(/^#/, "");
type ValueRow = Extract<Row, { kind: "value" }>;
/** Whether `path` has values below it in the answers (the facet need not be open): picking it then includes them too. */
const pathy = (p: FacetsPane, key: string, path: string) => p.hasBelow(key, path);

/** The facets tile's actions on the desk (the tile's own: `act tile=<its name>`, or the focused one). */
export const FACETS_ACTIONS = actionSet<KindHost>()("facets", {
  "facets.pick": def({
    summary: "move the cursor in the facets tile (tile=<its name>): n (from 1), or by=<rows> from where it is",
    keys: [{ keys: "j k ↑ ↓ pgup pgdn", does: "pick a row" }, { keys: "wheel", does: "pick a row" }],
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
      const walk = rows.flatMap((r, i) => part === undefined || (r.kind === "note") === (part === "matches") ? [i] : []);
      if (!walk.length) throw new ActionRefused(`no ${part} rows are listed`);
      const at = walk.indexOf(p.at);
      const i = by !== undefined ? walk[clamp((at < 0 ? (by > 0 ? -1 : walk.length) : at) + Math.trunc(by), 0, walk.length - 1)]! : n! - 1;
      if (!(i >= 0 && i < rows.length)) throw new ActionRefused(`the tile has ${rows.length} rows; n is 1-${rows.length}`);
      p.at = i;
      const row = rows[i];
      if (row?.kind === "note") desk.showFrom?.(p, row.note, actor);
      desk.redraw();
      return { n: i + 1 };
    },
  }),
  "facets.set": def({
    summary: "include a key (any value) or a value (the notes must carry it), exclude it (they must not), or drop it: key= (value= narrows it; a tag is key=tag), n (its row), or the row the cursor is on; mode= include, exclude or off, left out it steps include → exclude → off. Several included values of a facet are ORed, whole keys and facets are ANDed; a value with values below it (a path) includes them too",
    keys: [{ keys: "⏎ space click", does: "steps the facet value" }, { keys: "+", does: "include" }, { keys: "-", does: "exclude" }, { keys: "0 backspace", does: "drop" }, { keys: "alt-click ctrl-click", does: "excludes" }],
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
    summary: "open a facet to its values or fold it: key= (a tag is `tag`), n (its row), or the row the cursor is on",
    keys: "⏎ or a click on a facet", touches: "tile", while: "typing", replay: "safe", way: "an agent folds by key=",
    args: { key: { type: "string", optional: true, about: "the property" }, n: { type: "number", optional: true, about: "its row, from 1" } },
    examples: [
      { act: "facets.fold key=project tile=facets", does: "opens the project facet to its values, or folds it if open" },
    ],
    run({ key, n }, { pane, desk }) {
      const p = pane as FacetsPane, rows = p.rows();
      const row = key !== undefined ? rows.find(r => r.kind === "facet" && r.key === bare(key).toLowerCase()) : n !== undefined ? rows[n - 1] : p.current();
      if (!row || row.kind !== "facet") throw new ActionRefused(key !== undefined ? `no facet ${key} is listed · facets.list names them` : "the cursor isn't on a facet");
      p.keeping(() => { p.open.has(row.key) ? p.open.delete(row.key) : p.open.add(row.key); });
      desk.keepLayout?.(); desk.redraw();
      return { key: row.key, open: p.open.has(row.key) };
    },
  }),
  "facets.open": def({
    summary: "open a note the selection leaves, as ⏎ does in a list (the desk's open rule: the tile's link, or its container's): n (its row, from 1), id, or the row the cursor is on; fresh opens a new detail beside",
    keys: "⏎ on a note, double click, alt+⏎ (fresh)",
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
      const p = pane as FacetsPane, rows = p.rows();
      const row = id !== undefined ? rows.find(r => r.kind === "note" && (r.note.id === id || (id.length >= 8 && r.note.id.startsWith(id)))) : n !== undefined ? rows[n - 1] : p.current();
      if (!row || row.kind !== "note") throw new ActionRefused(id !== undefined ? `the selection leaves no note ${id}` : "the cursor isn't on a note (the notes the selection leaves are listed under the facets)");
      desk.setCurrent(row.note, { from: p, link: true, ...(fresh ? { fresh: true } : {}), by: actor });
      desk.redraw();
      return { id: row.note.id, title: subject(row.note) };
    },
  }),
  "facets.query": def({
    summary: "set the selection as text in the views' grammar (`project=x/* type=meeting #yomama NOT week=3`): it replaces the picks; the service evaluates it and the facets and notes follow. Empty clears. The person types it with e",
    keys: [{ keys: "e", does: "then typing edits the query" }, { keys: "⏎", does: "applies" }, { keys: "esc", does: "undoes" }], touches: "tile", while: "typing", replay: "safe", way: "an agent passes text=<query>: the person's selection moves with it",
    args: { text: { type: "string", about: "the query; empty clears the selection" } },
    examples: [
      { act: "facets.query text=\"#garden NOT type=meeting\" tile=facets", does: "selects notes tagged #garden that are not meetings, replacing the picks" },
      { act: "facets.query text=\"\" tile=facets", does: "clears the selection so every note is left" },
    ],
    run({ text }, { pane, desk }) {
      const p = pane as FacetsPane;
      return p.serial(async () => {
        const before = { raw: p.raw, clauses: p.clauses };
        p.raw = text.trim(); p.clauses = [];
        if (!(await p.load(desk))) { const why = p.describe().error; p.raw = before.raw; p.clauses = before.clauses; throw new ActionRefused(`that query wasn't answered${why ? `: ${why}` : ""}`); }
        desk.keepLayout?.(); desk.redraw();
        return { query: p.query(), notes: p.describe().matched };
      });
    },
  }),
  "facets.save": def({
    summary: "save the selection as a view: a block `[type::virtual-branch] [query::<the query>]` under a hub (parent=<block id>; left out, the newest board hub, else the top level), named name= (left out, the query)",
    keys: "v", touches: "nothing", replay: "ask", says: r => `saved view "${String(r.title)}"`,
    args: { name: { type: "string", optional: true, about: "the view's name" }, parent: { type: "string", optional: true, about: "the hub's block id" } },
    examples: [
      { act: "facets.save name=\"Garden beds\" tile=facets", does: "saves the selection as a view named Garden beds under the newest board hub" },
      { act: "facets.save name=\"Shed to-do\" parent=2b7f5e90-1c34-4a86-8d5e-9f0a3c7b1d62 tile=facets", does: "saves the selection as a view under that hub block" },
    ],
    async run({ name, parent }, { pane, desk, standing }, actor) {
      const p = pane as FacetsPane, q = p.query();
      if (!q) throw new ActionRefused("nothing is selected: pick a value or type a query first, then save it as a view");
      const board = desk.ctx.board;
      const hub = parent ?? (await findBoards(board))[0]?.hub.id ?? null;
      const label = (name?.trim() || q).replace(/[\[\]\n]/g, " ").slice(0, 60);
      const made = await board.createBlock(hub, `${label} [type::virtual-branch] [query::${q}]`, actor);
      desk.ctx.flash(`saved "${label}" as a view${hub ? " on its hub" : ""}`);
      return { id: made.id, title: label, parent: hub, query: q };
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
    keys: [{ keys: "[", does: "less" }, { keys: "]", does: "more" }, { via: "the Matches less/more buttons" }, { keys: "drag", does: "its divider" }],
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
  return new FacetsPane(kind, { query: s.query, sort: SORTS.includes(String(a.sort)) ? (a.sort as FacetSort) : undefined, zero: a.zero === true, share: a.share as number | undefined, ...(Array.isArray(a.open) ? { open: a.open.map(String) } : {}) });
};
const kindOf = (kind: "facets" | "tags", about: string, key: string): TileKind => ({
  kind, about, noun: kind === "tags" ? "a tags tile" : "a facets tile",
  keys: [{ key, label: kind }],
  openArgs: ["query", "args"],
  make: makeFacets(kind),
  actions: FACETS_ACTIONS,
  save: p => (p as FacetsPane).spec(),
  check: s => (s.query !== undefined && !s.query.trim() ? "a facets tile's query is the views' grammar, or left out" : null),
  shows: p => { const r = (p as FacetsPane).current(); return r?.kind === "note" ? r.note : null; },
  describe: p => (p as FacetsPane).describe(),
  peek: p => ({ facets: (p as FacetsPane).describe() }),
});
export const FACETS_KIND: TileKind = kindOf("facets", "the properties the notes have, each opening to its values with uses and last use: include or exclude values (ORed in a facet, ANDed across them), path values as a tree, the selection as the views' query text, editable and savable as a view (PIE-881); query=<a starting query>", "f");
/** The same tile opened on the tags facet (`#tag` is a facet like any property). */
export const TAGS_KIND: TileKind = kindOf("tags", "the facets tile opened on the tags: every tag with its uses and last use, faceted so picking a tag leaves the tags that still narrow the results (PIE-881)", "#");
