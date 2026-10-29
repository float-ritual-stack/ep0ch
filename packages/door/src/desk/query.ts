import { standsAsPerson } from "../surface/dispatch";
import { NOBODY } from "../whereabouts";
import { rowLines } from "../text";
// Query tiles (PIE-511): one saved view's cards (a virtual branch, as the service reads it with `views.read`),
// with its own cursor. A board lane is one; so is a query tile opened on the desk (`^W o q`, `tile.open
// kind=query view=<id>`). Where its cards open is the desk's rule (its link, its container's opens-into); the
// board adds moving cards between its lanes, writing new ones and the rest (src/desk/lanes.ts).
//
// A query tile can also list a query in the views' grammar with no saved view (`query=#garden`, PIE-800: a `#tag`
// opened in a reader), the service answering it (`blocks.query`, `where`). One beside a reader has that reader as
// its home (`source=tile:<name>`), and opens as every list does (PIE-794): j k and a click preview where its
// selection goes, ⏎ replaces its home's note, alt+⏎ opens a new detail beside it.
//
// The board's lanes come from data: a columns container whose `source` is `hub:<id>` holds one query tile per
// view under that hub (HUB_SOURCE, src/desk/lanes.ts). The desk asks the source and keeps each tile by its view, so a lane's
// cursor and collapse survive a refill; the board never lays its lanes out itself.
import { workIdTitle } from "@ep0ch/outline-core/work-id-title";
import { bodyMatch, headedTitle, matchWords, subject, type Msg } from "../board";
import { markReveal } from "../reveal";
import { USER, type Actor, type OutlineEvent, type SocketBoard } from "../socket";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { C, fg, pad, RESET, selectedRow } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago } from "../text";
import { describeChanges, type MovePlan } from "../move";
import { readView, type ViewRead } from "../views";
import { RELOAD_PAUSE_MS, SearchSchedule } from "../search-schedule";
import { summarySegments, viewSummaryKeys, prop } from "../props";
import { clamp, pressOn, RowView, wheelRows, type RowPress } from "../scroll";
import { hasUnsent } from "../draft-session";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";

/** Stage-named lanes get the delivery order; anything else keeps the hub's own order. */
const PREFERRED = ["validate", "doing", "queued", "review", "done"];
/** Views under a hub that aren't lanes on its board. */
const HIDDEN = new Set(["superseded"]);
const PRIORITY: Record<string, number> = { high: C.lred, medium: C.yellow, low: C.dark };

const isView = (k: Msg) => (prop(k, "type") ?? "").toLowerCase() === "virtual-branch";

/** A hub's children that are its board's lanes, in lane order. */
export function laneDefs(kids: Msg[]): Msg[] {
  const lanes = kids.filter(k => isView(k) && !HIDDEN.has(subject(k).toLowerCase()));
  const staged = lanes.some(k => PREFERRED.slice(0, 4).includes(subject(k).toLowerCase()));
  const rank = (n: string) => { const i = PREFERRED.indexOf(n.toLowerCase()); return i < 0 ? 99 : i; };
  if (staged) lanes.sort((a, b) => rank(subject(a)) - rank(subject(b)));
  return lanes;
}

/** Every block with two or more virtual-branch children is a board's hub; the most recently changed first. */
export async function findBoards(board: SocketBoard): Promise<{ hub: Msg; lanes: number }[]> {
  const branches = await board.query("type=virtual-branch", 500, "updated", "desc", true);
  const count = new Map<string, number>();
  for (const b of branches) if (b.parentId && prop(b, "query")) count.set(b.parentId, (count.get(b.parentId) ?? 0) + 1);
  const ids = [...count].filter(([, n]) => n >= 2).map(([id]) => id);
  const hubs = await board.readMany(ids);
  return hubs.map(hub => ({ hub, lanes: count.get(hub.id)! })).sort((a, b) => b.hub.updatedAt - a.hub.updatedAt);
}

/** Whether `hub` is a board (two or more views under it), and its views. */
export async function hubViews(board: SocketBoard, hubId: string): Promise<Msg[]> {
  return (await board.children(hubId)).filter(isView);
}

/** A lane's name as a tile's name: letters, digits, . - _ (a lane "Waiting on" is the tile `Waiting-on`). */
export function laneTileName(lane: string): string {
  const s = lane.replace(/[^\w.-]+/g, "-").replace(/^[^A-Za-z]+/, "").replace(/-+$/, "").slice(0, 40);
  return s || "lane";
}

/** A card's place in the lane, or what's being dragged over it (for its frame). */
export type DropShown = { plan: MovePlan | null } | null;

export class QueryPane implements Pane {
  readonly kind = "query" as const;
  /** The view: its block (null until read), and what the service answered for it. */
  def: Msg | null = null;
  items: Msg[] | null = null;
  read?: ViewRead;
  sel = 0;
  /** Its cursor and scroll. */
  cursor = new RowView();
  /** A card the next read should select (a move or a create landing here), and the word for it if it's not there. */
  want?: string;
  /** The latest read still on its way, for whoever needs the lane as the service has it now. */
  private inflight: Promise<void> | null = null;
  wantVerb?: string;
  /** The board's lane cursor is here (drawn brighter while another tile has the keys). */
  current = false;
  /** A card dragged over it: what moving it here would patch (null: being asked); undefined when nothing is. */
  drop?: DropShown;
  /**
   * The screen it's on asks it again (the board refreshes only the lanes a change can touch, PIE-399);
   * alone on a desk it asks again itself, once per burst of changes.
   */
  managed = false;
  /** What it's a lane of (the board's lanes, the hub source's model in src/desk/lanes.ts): its keys and mouse are theirs. */
  model: { laneKeys(k: Key): boolean; laneMouse(k: Extract<Key, { kind: "mouse" }>, press?: RowPress): boolean } | null = null;
  /** The board's hint for its lanes (c collapse · H L move); the tile's own otherwise. */
  boardHint: string | null = null;
  /** Its reads: a newer one stops the one before; a burst of outline changes reads once, after a pause. */
  private readonly search = new SearchSchedule(RELOAD_PAUSE_MS);
  /**
   * `view`: the saved view's block id. `query`: a query in the views' grammar it lists instead (`#garden`), with no
   * saved view. `home`: the reader it belongs to (a tile's name): its selection previews, ⏎ lands there (PIE-794).
   * `held`: a #tag's list kept off its home (PIE-855): it keeps its query, and the next tag in its home opens a list of its own.
   */
  constructor(public view: string, public query: string | null = null, public home: string | null = null, public held = false) {}

  renamedTile(from: string, to: string) { if (this.home === from) this.home = to; }

  /** A query listed for a home reader (a #tag's list) can be held there; a saved view's lane can't. */
  get holdable(): boolean { return this.query !== null && this.home !== null && !this.model; }

  /** Its view's name (the lane's name), or the query it lists. */
  get name(): string { return this.query ?? (this.def ? subject(this.def) : `view ${this.view.slice(0, 8)}`); }
  /** List another query (a `#tag` opened again from its home): its cards are read again, the cursor at the top. */
  retarget(query: string, desk: DeskApi): Promise<void> {
    if (query !== this.query) { this.query = query; this.items = null; this.sel = 0; this.cursor = new RowView(); }
    return this.load(desk);
  }
  /** The view as read now (a rename or a new query), its cards asked again when it changed. */
  define(d: Msg) {
    const changed = !this.def || this.def.revision !== d.revision || this.def.id !== d.id;
    this.def = d; this.view = d.id;
    return changed;
  }

  /** The count and status as the header shows them after its name: `3`, `200 of 200+`, `failed`; `■ card kept` while a new card is put aside here (n brings it back). */
  headLabel(): string {
    const r = this.read;
    return `${fg(C.dark)}${this.items ? this.items.length : "…"}${r?.truncated ? fg(C.yellow) + ` of ${r.limit}+` : ""}${r && r.status !== "ready" ? fg(C.lred) + " " + r.status : ""}${hasUnsent(`card:${this.view}`) ? fg(C.dark) + " ■ card kept" : ""}`;
  }
  get titleNote() { return this.def; }
  title() { return `${this.name} ${this.items ? this.items.length : "…"}`; }
  subject() { return this.items?.[this.sel]?.id ?? null; }
  /** Its header names the view as written ("Reading now"), not the tile (`Reading-now`). */
  headName() { return this.def ? headedTitle(this.def) : this.name; }
  hint() {
    if (this.boardHint) return this.boardHint;
    if (!this.home) return "j k pick · ⏎ open · r reload";
    const keys = `j k preview · ⏎ open in ${this.home} · alt+⏎ new detail · r reload`;
    return !this.holdable ? keys : this.held ? `held · a new tag opens its own list · ${keys} · p let go` : `${keys} · p hold`;
  }
  /** While a card is dragged over it: yellow (it would move, and what changes), red (refused, why). */
  frameLook(focused: boolean): { colour?: number; hint?: string } | null {
    const d = this.drop;
    if (d !== undefined && d !== null) {
      const p = d.plan;
      if (!p) return { colour: C.yellow, hint: fg(C.dark) + "planning…" };
      return p.kind === "patch" ? { colour: C.yellow, hint: fg(C.yellow) + "drop: " + describeChanges(p.changes) }
        : p.kind === "already" ? { colour: C.lcyan, hint: fg(C.dark) + "already here" } : { colour: C.lred, hint: fg(C.lred) + "can't: " + p.reason };
    }
    return !focused && this.current ? { colour: C.cyan } : null;
  }
  spine() { return { title: this.title() }; }

  /** Given the keys: a list with a home previews its selected card there, as a links tile does (PIE-794). */
  focused(desk: DeskApi) { const m = this.card(); if (m && this.home && desk.showFrom) desk.showFrom(this, m); }

  /** The selected card. */
  card(): Msg | undefined { return this.items?.[this.sel]; }

  init(desk: DeskApi) {
    if (this.query !== null) { if (!this.items) void this.load(desk); return; }
    if (!this.def) desk.ctx.board.get(this.view).then(d => { if (d) { this.define(d); void this.load(desk); } else { this.read = { status: "missing", items: [], limit: 0, truncated: false, errors: [`no view ${this.view} in the outline`] }; this.items = []; desk.redraw(); } }, () => {});
    else if (!this.items && !this.managed) void this.load(desk);
  }

  /** Ask the service for the view's cards (the selected card stays selected while it's listed). */
  load(desk: DeskApi): Promise<void> {
    const def = this.def, query = this.query;
    if (!def && query === null) return Promise.resolve();
    const turn = this.search.begin();
    // A query of its own is the service's to answer (the views' grammar, `where`), as a saved view's is.
    const reading: Promise<ViewRead> = query !== null
      ? desk.ctx.board.queryNotes(query, 200, undefined, turn.signal).then(r => ({ status: "ready" as const, items: r.notes, limit: 200, truncated: r.truncated, errors: [] }), (e: Error) => ({ status: "failed" as const, items: [], limit: 200, truncated: false, errors: [`${query}: ${e.message}`] }))
      : readView(desk.ctx.board, def!, {}, turn.signal);
    const mine: Promise<void> = reading.then(read => {
      // A newer read is on its way: done when that one has landed. Put away (the tile closed), nothing is.
      if (!turn.alive()) { const next = this.inflight; if (next === mine) this.inflight = null; return next === mine ? undefined : next ?? undefined; }
      this.inflight = null;
      const items = read.items;
      this.read = read;
      const keep = this.want ?? this.items?.[this.sel]?.id;
      this.items = items;
      const at = keep ? items.findIndex(m => m.id === keep) : -1;
      if (this.want) {
        if (at < 0) desk.ctx.flash(`${this.wantVerb ?? "moved"}, but ${this.name} doesn't list it${read.truncated ? ` (past its limit of ${read.limit})` : ""}`);
        this.want = undefined; this.wantVerb = undefined;
      }
      this.sel = Math.max(0, at >= 0 ? at : Math.min(this.sel, items.length - 1));
      this.loaded?.(this);
      desk.redraw();
    }, () => { if (turn.alive()) { this.inflight = null; this.items = []; desk.redraw(); } });
    this.inflight = mine;
    return mine;
  }
  /** Called once each read lands (the board's preview follows its lane's card). */
  loaded?: (q: QueryPane) => void;

  onEvent(desk: DeskApi, e?: OutlineEvent) {
    if (this.managed || e?.change?.kind === "draft" || e?.change?.kind === "annotate") return;
    this.search.pause(() => void this.load(desk));
  }
  dispose() { this.search.cancel(); }

  private drawnItems: number[] = [];
  private cardHeight = 2;
  /** A page step, using the average height of the cards last painted. */
  fits(rows: number) { return Math.max(1, Math.floor(rows / this.cardHeight)); }

  render(w: number, h: number, focused: boolean): PaneView {
    const items = this.items ?? [];

    const lines: string[] = [];
    // The view's [summary-properties::…] say what a card shows after its Work ID and priority (a reading list's
    // author); without them, whatever its cards carry: stage fields, or outbox fields (to · channel · waiting on).
    const keys = viewSummaryKeys(this.def)?.filter(k => k !== "work-id" && k !== "priority") ?? null;
    const at: number[] = [];
    const owners: number[] = [];
    items.forEach((m, j) => {
      at.push(lines.length);
      const sel = j === this.sel;
      const wid = prop(m, "work-id") ?? prop(m, "ticket") ?? "";
      const title = workIdTitle(subject(m), wid).title;
      const pri = PRIORITY[prop(m, "priority") ?? ""] ?? C.dark;
      // A row a line chip matched says where, and the step's state when it sits on one (PIE-1277).
      const line = bodyMatch(m), where = line ? matchWords(line) : "";
      const extra = [where, ...(keys ? summarySegments(m.properties, keys).map(x => x.value) : [prop(m, "track"), prop(m, "to") && `→ ${prop(m, "to")}`, prop(m, "channel"), prop(m, "waiting-on") && `waiting on ${prop(m, "waiting-on")}`])].filter(Boolean).join(" · ");
      if (sel) {
        lines.push(selectedRow(` ${wid} ${prop(m, "priority") ?? ""} ${extra} · ${ago(m.updatedAt)}`, w, focused, "idleRow"));
        lines.push(...rowLines(` ${title}`, w, undefined, { hang: 1 }).map(line => selectedRow(line, w, focused, "idleRow")));
      } else {
        lines.push(pad(` ${fg(pri)}● ${fg(C.lcyan)}${wid}${wid ? " " : ""}${fg(C.dark)}${extra} · ${ago(m.updatedAt)}`, w) + RESET);
        lines.push(...rowLines(` ${title}`, w, undefined, { hang: 1 }).map(line => fg(C.grey) + pad(line, w) + RESET));
      }
      owners.push(...Array.from({ length: lines.length - at[j]! }, () => j));
    });
    this.cardHeight = lines.length / Math.max(1, items.length) || 2;
    this.cursor.place(this.sel, lines.length, h, [at[this.sel] ?? 0, (at[this.sel + 1] ?? lines.length) - 1]);
    this.drawnItems = owners.slice(this.cursor.top, this.cursor.top + h);
    lines.splice(this.cursor.top + h);
    lines.splice(0, this.cursor.top);
    if (!this.items) lines.push(fg(C.dark) + " loading…" + RESET);
    else if (this.read && this.read.status !== "ready") for (const e of this.read.errors) lines.push(fg(C.lred) + " " + e + RESET);
    else if (!items.length) lines.push(fg(C.dark) + ` nothing in ${this.name || "this view"} yet: no note matches what it asks for` + RESET);
    return { lines };
  }

  /** The card owning physical row `y` of the tile, or -1. */
  rowAt(y: number): number { return this.drawnItems[y] ?? -1; }

  /**
   * Pick card `i`: the person's cursor moves there and it becomes what the tile shows (a preview follows it; with a
   * home, only where its selection goes: the current note stays, PIE-794); `open` opens it as ⏎ does, `fresh` as alt+⏎.
   */
  pick(i: number, open: boolean, desk: DeskApi, actor: Actor = USER, fresh = false, standing = standsAsPerson(actor, desk.ctx.person?.() ?? NOBODY, "tile")): { card: string; title: string; n: number } {
    const items = this.items ?? [];
    const m = items[i];
    if (!m) throw new ActionRefused(this.items ? (items.length ? `${this.name} has ${items.length} card${items.length === 1 ? "" : "s"}; n is 1-${items.length}` : `${this.name} is empty`) : `${this.name} is still being read`);
    // A row a line chip put here (PIE-1277: the view's [property-scope::all]) opens at that line, lit, as a ::fields row does.
    // Only a pick that shows or opens it marks it: a pick that leaves the tile alone leaves no mark behind.
    const line = bodyMatch(m);
    if (line && (standing || open || fresh)) markReveal(m, { at: line.start, ...(line.raw ? { label: line.raw } : {}), says: `the line its ${line.key} is written on` }, actor);
    // An agent's pick is its own: the person's cursor and what the tile shows stay.
    if (standing) { this.sel = i; if (this.home && desk.showFrom) desk.showFrom(this, m, actor); else desk.setCurrent(m, { from: this, by: actor }); }
    if (open || fresh) desk.setCurrent(m, { from: this, link: true, ...(fresh ? { fresh: true } : {}), by: actor });
    desk.redraw();
    return { card: m.id, title: subject(m), n: i + 1 };
  }

  private run(desk: DeskApi, name: "query.pick" | "query.reload", args: Record<string, unknown>) { runOwn(QUERY_ACTIONS, name, args, { pane: this, desk }); }

  key(k: Key, desk: DeskApi): boolean {
    // A lane on the board: the lanes' keys (its model's).
    if (this.model) return this.model.laneKeys(k);
    const c = ch(k);
    const by = isDown(k) ? 1 : isUp(k) ? -1 : k.kind === "pgdn" ? 8 : k.kind === "pgup" ? -8 : 0;
    if (by) { if (this.items?.length) this.run(desk, "query.pick", { by }); return true; }
    if (k.kind === "enter" || k.kind === "alt-enter") { if (this.card()) this.run(desk, "query.pick", { n: this.sel + 1, ...(k.kind === "alt-enter" ? { fresh: true } : { open: true }) }); return true; }
    if (c === "r") { this.run(desk, "query.reload", {}); return true; }
    return false;
  }
  /** A click picks a card (as j k), a double click or an alt-, ctrl- or middle-click opens it (⏎, RowView.press); the wheel moves the cursor. */
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    // A lane on the board: a card pressed, dragged to another lane, opened by a double click; the wheel (its model's).
    if (this.model) return this.model.laneMouse(k, press);
    if (k.action === "wheel-up" || k.action === "wheel-down") { if (this.items?.length) this.run(desk, "query.pick", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const i = this.rowAt(y);
    if (i < 0) return true;
    const g = this.cursor.press(i, pressOn(k, press, i === this.sel));
    this.run(desk, "query.pick", { n: i + 1, ...(g === "open" ? { open: true } : g === "fresh" ? { fresh: true } : {}) });
    return true;
  }

  spec() { return { ...(this.query !== null ? { query: this.query } : { view: this.view }), ...(this.home ? { source: `tile:${this.home}` } : {}), ...(this.held ? { mode: "held" as const } : {}) }; }
  describe() {
    const brief = (m: Msg | undefined) => (m ? { id: m.id, title: subject(m), workId: prop(m, "work-id") ?? prop(m, "ticket") } : null);
    return { ...(this.query !== null ? { query: this.query, ...(this.home ? { home: this.home } : {}), ...(this.holdable ? { held: this.held } : {}), cards: (this.items ?? []).map(m => ({ id: m.id, title: subject(m) })) } : { view: this.view }), lane: this.name, count: this.items?.length ?? null, status: this.read?.status, truncated: this.read?.truncated, selected: brief(this.card()) };
  }
}

/** A query tile's actions on the desk: which card is picked (and opened), and reading the view again. */
export interface QueryOn { pane: QueryPane; desk: DeskApi; standing: boolean }
export const QUERY_ACTIONS = actionSet<QueryOn>()("query", {
  "query.pick": def({
    summary: "pick a card in a query tile (tile=<its name>): n (from 1), id, or by=<cards> from the selected one; it becomes what the tile shows (a preview following it shows it; a tile beside a reader, its home, only previews: the current note stays), open=true opens it as ⏎ does (in its home, replacing its note), fresh=true as alt+⏎ (a new detail beside its home). An agent's pick is its own: the person's cursor stays (open=true opens it where the tile's opens go). On the board, card.select is the lanes' own",
    keys: [{ keys: "j k ↑ ↓ pgup pgdn", does: "pick" }, { keys: "click wheel", does: "pick" }, { keys: "⏎ double-click", does: "open" }, { keys: "alt+⏎ alt-click ctrl-click middle-click", does: "open fresh" }],
    touches: "nothing", replay: "safe", says: (r, a) => `${a.open ? "opened" : "picked"} "${r.title}"`,
    args: {
      n: { type: "number", optional: true, about: "the card, from 1" },
      id: { type: "string", optional: true, about: "a card's block id (or its first 8+ characters)" },
      by: { type: "number", optional: true, about: "cards on from the selected one (negative: up)" },
      open: { type: "boolean", optional: true, about: "open it, as ⏎ does" },
      fresh: { type: "boolean", optional: true, about: "open it in a new detail beside its home, as alt+⏎ does" },
    },
    examples: [
      { act: "query.pick tile=query n=3", does: "selects the third card; a preview following the lane shows it" },
      { act: "query.pick tile=query id=7d9a1f40 fresh=true", does: "opens that card in a new detail beside the lane's home" },
    ],
    run({ n, id, by, open, fresh }, { pane, desk, standing }, actor) {
      if ([n, id, by].filter(x => x !== undefined).length !== 1) throw new ActionRefused("query.pick takes one of n, id or by");
      const items = pane.items ?? [];
      const i = id !== undefined ? items.findIndex(m => m.id === id || (id.length >= 8 && m.id.startsWith(id))) : by !== undefined ? clamp(pane.sel + Math.trunc(by), 0, Math.max(0, items.length - 1)) : n! - 1;
      if (id !== undefined && i < 0) throw new ActionRefused(`${pane.name} doesn't list ${id}`);
      return pane.pick(i, !!open, desk, actor, !!fresh, standing);
    },
  }),
  "query.reload": def({
    summary: "read a query tile's view again from the service", keys: "r",
    touches: "nothing", replay: "safe", says: r => `read ${r.lane} again`,
    args: {},
    async run(_, { pane, desk }) {
      await pane.load(desk);
      return { lane: pane.name, count: pane.items?.length ?? 0 };
    },
  }),
});
