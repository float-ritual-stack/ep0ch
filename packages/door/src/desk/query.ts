// Query tiles (PIE-511): one saved view's cards (a virtual branch, as the service reads it with `views.read`),
// with its own cursor. A board lane is one; so is a query tile opened on the desk (`^W o q`, `tile.open
// kind=query view=<id>`). Where its cards open is the desk's rule (its link, its container's opens-into); the
// board adds moving cards between its lanes, writing new ones and the rest (src/desk/lanes.ts).
//
// The board's lanes come from data: a columns container whose `source` is `hub:<id>` holds one query tile per
// view under that hub (HUB_SOURCE, src/desk/lanes.ts). The desk asks the source and keeps each tile by its view, so a lane's
// cursor and collapse survive a refill; the board never lays its lanes out itself.
import { subject, type Msg } from "../board";
import { USER, type Actor, type OutlineEvent, type SocketBoard } from "../socket";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { C, fg, pad, RESET, selected } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago } from "../text";
import { describeChanges, type MovePlan } from "../move";
import { readView, type ViewRead } from "../views";
import { summarySegments, viewSummaryKeys } from "../props";
import { clamp, RowView, wheelRows, type RowPress } from "../scroll";
import { hasUnsent } from "../draft-session";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";

/** Stage-named lanes get the delivery order; anything else keeps the hub's own order. */
const PREFERRED = ["validate", "doing", "queued", "review", "done"];
/** Views under a hub that aren't lanes on its board. */
const HIDDEN = new Set(["superseded"]);
const PRIORITY: Record<string, number> = { high: C.lred, medium: C.yellow, low: C.dark };

const isView = (k: Msg) => (k.props.type ?? "").toLowerCase() === "virtual-branch";

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
  for (const b of branches) if (b.parentId && b.props.query) count.set(b.parentId, (count.get(b.parentId) ?? 0) + 1);
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
  private asked = 0;
  private reload: Timer | null = null;
  constructor(public view: string) {}

  /** Its view's name (the lane's name). */
  get name(): string { return this.def ? subject(this.def) : `view ${this.view.slice(0, 8)}`; }
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
  title() { return `${this.name} ${this.items ? this.items.length : "…"}`; }
  /** Its header names the view as written ("Reading now"), not the tile (`Reading-now`). */
  headName() { return this.def ? subject(this.def) : undefined; }
  hint() { return this.boardHint ?? "j k pick · ⏎ open · r reload"; }
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

  /** The selected card. */
  card(): Msg | undefined { return this.items?.[this.sel]; }

  init(desk: DeskApi) {
    if (!this.def) desk.ctx.board.get(this.view).then(d => { if (d) { this.define(d); void this.load(desk); } else { this.read = { status: "missing", items: [], limit: 0, truncated: false, errors: [`no view ${this.view} in the outline`] }; this.items = []; desk.redraw(); } }, () => {});
    else if (!this.items && !this.managed) void this.load(desk);
  }

  /** Ask the service for the view's cards (the selected card stays selected while it's listed). */
  load(desk: DeskApi): Promise<void> {
    const def = this.def;
    if (!def) return Promise.resolve();
    const n = ++this.asked;
    const mine: Promise<void> = readView(desk.ctx.board, def).then(read => {
      if (n !== this.asked) return this.inflight ?? undefined;   // a newer read is on its way: done when that one has landed
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
    }, () => { if (n === this.asked) { this.inflight = null; this.items = []; desk.redraw(); } });
    this.inflight = mine;
    return mine;
  }
  /** Called once each read lands (the board's preview follows its lane's card). */
  loaded?: (q: QueryPane) => void;

  onEvent(desk: DeskApi, e?: OutlineEvent) {
    if (this.managed || e?.change?.kind === "draft" || e?.change?.kind === "annotate") return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(desk); }, 300);
  }
  dispose() { if (this.reload) clearTimeout(this.reload); }

  /** How many cards fit in `rows` (two rows each). */
  fits(rows: number) { return Math.max(1, Math.floor(rows / 2)); }

  render(w: number, h: number, focused: boolean): PaneView {
    const items = this.items ?? [];
    const fit = this.fits(h);
    this.cursor.place(this.sel, items.length, fit);
    const lines: string[] = [];
    // The view's [summary-properties::…] say what a card shows after its Work ID and priority (a reading list's
    // author); without them, whatever its cards carry: stage fields, or outbox fields (to · channel · waiting on).
    const keys = viewSummaryKeys(this.def)?.filter(k => k !== "work-id" && k !== "priority") ?? null;
    items.slice(this.cursor.top, this.cursor.top + fit).forEach((m, j) => {
      const sel = this.cursor.top + j === this.sel;
      const wid = m.props["work-id"] ?? m.props.ticket ?? "";
      const title = wid ? subject(m).replace(new RegExp(`^${wid}\\s*[—:-]?\\s*`), "") : subject(m);
      const pri = PRIORITY[m.props.priority ?? ""] ?? C.dark;
      const extra = (keys ? summarySegments(m.properties ?? Object.entries(m.props).map(([key, value]) => ({ key, value })), keys).map(x => x.value) : [m.props.track, m.props.to && `→ ${m.props.to}`, m.props.channel, m.props["waiting-on"] && `waiting on ${m.props["waiting-on"]}`]).filter(Boolean).join(" · ");
      if (sel) {
        const style = selected(focused, "idleRow");
        lines.push(style + pad(` ${wid} ${m.props.priority ?? ""} ${extra} · ${ago(m.updatedAt)}`, w) + RESET);
        lines.push(style + pad(` ${title}`, w) + RESET);
      } else {
        lines.push(pad(` ${fg(pri)}● ${fg(C.lcyan)}${wid}${wid ? " " : ""}${fg(C.dark)}${extra} · ${ago(m.updatedAt)}`, w) + RESET);
        lines.push(fg(C.grey) + pad(` ${title}`, w) + RESET);
      }
    });
    if (!this.items) lines.push(fg(C.dark) + " loading…" + RESET);
    else if (this.read && this.read.status !== "ready") for (const e of this.read.errors) lines.push(fg(C.lred) + " " + e + RESET);
    else if (!items.length) lines.push(fg(C.dark) + ` nothing in ${this.name || "this view"} yet: no note matches what it asks for` + RESET);
    return { lines };
  }

  /** The card drawn at row `y` of the tile (its two rows), or -1. */
  rowAt(y: number): number { const i = this.cursor.top + Math.floor(y / 2); return y >= 0 && i < (this.items?.length ?? 0) ? i : -1; }

  /** Pick card `i`: the person's cursor moves there and it becomes what the tile shows (a preview follows it); `open` opens it as ⏎ does. */
  pick(i: number, open: boolean, desk: DeskApi, actor: Actor = USER): { card: string; title: string; n: number } {
    const items = this.items ?? [];
    const m = items[i];
    if (!m) throw new ActionRefused(this.items ? (items.length ? `${this.name} has ${items.length} card${items.length === 1 ? "" : "s"}; n is 1-${items.length}` : `${this.name} is empty`) : `${this.name} is still being read`);
    // An agent's pick is its own: the person's cursor and what the tile shows stay.
    if (actor.kind !== "agent") { this.sel = i; desk.setCurrent(m, { from: this }); }
    if (open) desk.setCurrent(m, { from: this, link: true, by: actor });
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
    if (k.kind === "enter") { if (this.card()) this.run(desk, "query.pick", { n: this.sel + 1, open: true }); return true; }
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
    const g = this.cursor.press(i, press ?? { mods: k.mods ?? 0, button: k.button });
    this.run(desk, "query.pick", { n: i + 1, ...(g === "open" || g === "fresh" ? { open: true } : {}) });
    return true;
  }

  spec() { return { view: this.view }; }
  describe() {
    const brief = (m: Msg | undefined) => (m ? { id: m.id, title: subject(m), workId: m.props["work-id"] ?? m.props.ticket } : null);
    return { view: this.view, lane: this.name, count: this.items?.length ?? null, status: this.read?.status, truncated: this.read?.truncated, selected: brief(this.card()) };
  }
}

/** A query tile's actions on the desk: which card is picked (and opened), and reading the view again. */
export interface QueryOn { pane: QueryPane; desk: DeskApi }
export const QUERY_ACTIONS = actionSet<QueryOn>()("query", {
  "query.pick": def({
    summary: "pick a card in a query tile (tile=<its name>): n (from 1), id, or by=<cards> from the selected one; it becomes what the tile shows (a preview following it shows it), open=true opens it as ⏎ does. An agent's pick is its own: the person's cursor stays (open=true opens it where the tile's opens go). On the board, card.select is the lanes' own",
    keys: "j k ↑ ↓ PgUp PgDn, click, wheel (pick) · ⏎, double click, alt- ctrl- or middle-click (open)",
    touches: "nothing", replay: "safe", says: (r, a) => `${a.open ? "opened" : "picked"} "${r.title.slice(0, 40)}"`,
    args: {
      n: { type: "number", optional: true, about: "the card, from 1" },
      id: { type: "string", optional: true, about: "a card's block id (or its first 8+ characters)" },
      by: { type: "number", optional: true, about: "cards on from the selected one (negative: up)" },
      open: { type: "boolean", optional: true, about: "open it, as ⏎ does" },
    },
    run({ n, id, by, open }, { pane, desk }, actor) {
      if ([n, id, by].filter(x => x !== undefined).length !== 1) throw new ActionRefused("query.pick takes one of n, id or by");
      const items = pane.items ?? [];
      const i = id !== undefined ? items.findIndex(m => m.id === id || (id.length >= 8 && m.id.startsWith(id))) : by !== undefined ? clamp(pane.sel + Math.trunc(by), 0, Math.max(0, items.length - 1)) : n! - 1;
      if (id !== undefined && i < 0) throw new ActionRefused(`${pane.name} doesn't list ${id}`);
      return pane.pick(i, !!open, desk, actor);
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
