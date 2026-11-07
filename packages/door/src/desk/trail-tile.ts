import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { blockRefText } from "@ep0ch/outline-core/link-syntax";
import { readNote } from "./outline-boards";
import { C, fg, pad, RESET } from "../style";
import { RowView, wheelRows, pressOn, type RowPress } from "../scroll";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { keyTable } from "../surface/keymap";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import { pickRow } from "../surface/picker";
import { trailRows as historyRows, trailLine, type TrailRow as HistoryRow } from "../surface/navigation";
import { askInBar } from "../bar/ask";
import { trailRows, type TrailRow, type TrailView } from "../trail-view";
import { treeRows } from "../figures/tree";
import type { Visit } from "../trail";
import type { Key } from "../term";
import type { Actor } from "../socket";
import type { DeskApi, Pane, PaneView } from "./panes";
import { TILE_ACTIONS } from "./tile-actions";
import type { KindHost, TileKind } from "./tile-kinds";

function visitLink(v: Visit): string {
  const { note, address } = v.open.target;
  return address?.machine ? `[${v.title}](${formatEp0chBlockUri({ outline: address.outline, machine: address.machine, blockId: note })})` : blockRefText(note, v.title, address);
}
const row = (key: string, action: string, label: string, args?: Record<string, unknown>): ModeKey => ({ key, action, label, ...(args ? { args } : {}) });
export const TRAIL_KEYS: readonly ModeKey[] = keyTable("trail", "the day's trail (alt+T)", [
  row("j", "trail.pick", "pick", { by: 1 }), row("down", "trail.pick", "pick", { by: 1 }),
  row("k", "trail.pick", "pick", { by: -1 }), row("up", "trail.pick", "pick", { by: -1 }),
  row("enter", "trail.open", "where it was"), row("o", "trail.here", "open here"), row("s", "trail.save", "save branch"),
  row("f", "trail.fold", "fold flips"), row("/", "trail.search", "search"), row("t", "trail.view", "view"),
  row("S", "trail.facets", "facets over the trail"),
  row("a", "trail.agents", "agents"), row("delete", "trail.forget", "forget branch"),
  row("esc", "tile.close", "close"), row("q", "tile.close", "close"),
]);
type View = TrailView["view"] | "history";
type Options = Omit<TrailView, "view"> & { view: View };
type Row = TrailRow & { stop?: HistoryRow };

export class TrailPane implements Pane {
  /** Esc closes this tile, a trail being a look aside (esc-rule.ts). */
  escCloses() { return "the trail"; }
  readonly kind = "trail";
  readonly bindings = TRAIL_KEYS;
  private at = 1;
  private selectedVisit: string | null | undefined;
  readonly scroll = new RowView();
  options: Options = { view: "forest", folded: true, agents: "dim", q: "" };
  constructor(public source = "reader", options?: Partial<Options>) { Object.assign(this.options, options); if (this.options.view === "history") this.at = -1; }
  title() { return this.options.view === "history" ? `trail · ${this.source}` : `Trail · ${this.options.view}${this.options.q ? ` · ${this.options.q}` : ""}`; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() { return modeHint(TRAIL_KEYS, a => TRAIL_ACTIONS.def(a) ?? TILE_ACTIONS.def(a)); }
  spec() { return { source: `tile:${this.source}`, state: this.options }; }
  rows(desk: DeskApi): Row[] {
    const { view } = this.options;
    if (view === "history") { const trail = desk.paneNamed?.(this.source)?.trail; return trail ? historyRows(trail.stops()).map(stop => ({ title: trailLine(stop), stop, heading: stop.dir === 0 })) : []; }
    return desk.ctx.trail ? trailRows(desk.ctx.trail, { ...this.options, view }) : [];
  }
  pick(rows: readonly Row[], at: number) {
    this.at = Math.max(0, Math.min(rows.length - 1, at));
    this.selectedVisit = rows[this.at]?.visit?.open.target.visit ?? null;
  }
  resetPick() { this.at = this.options.view === "history" ? -1 : 0; this.selectedVisit = undefined; this.scroll.forget(); }
  picked(rows: readonly Row[]): number {
    if (this.options.view !== "history") {
      if (this.selectedVisit === undefined && rows.length) this.pick(rows, this.at);
      if (this.selectedVisit) return rows.findIndex(r => r.visit?.open.target.visit === this.selectedVisit);
    }
    return Math.max(0, Math.min(rows.length - 1, this.at < 0 ? rows.findIndex(r => r.stop?.dir === 0) : this.at));
  }
  async go(desk: DeskApi, actor: Actor, n?: number) {
    const rows = this.rows(desk), stop = rows[n === undefined ? this.picked(rows) : n - 1]?.stop, trail = desk.paneNamed?.(this.source)?.trail;
    if (!stop || !trail) throw new ActionRefused(`pick a history stop in ${this.source} first`);
    this.at = -1;
    if (!stop.dir) return { here: stop.title };
    const why = await trail.go(stop.dir, stop.steps, desk, actor);
    if (why) throw new ActionRefused(why);
    return { went: stop.title, [stop.dir < 0 ? "back" : "forward"]: stop.steps };
  }
  visit(desk: DeskApi, id?: string): Visit {
    this.picked(this.rows(desk));
    const selected = id ?? this.selectedVisit;
    const v = selected ? desk.ctx.trail?.get(selected) : undefined;
    if (!v) throw new ActionRefused("pick a visit first (j/k or click), or name visit=<id> from trail.recent");
    return v;
  }
  private top = 0;
  render(w: number, h: number, _focused: boolean, desk: DeskApi): PaneView {
    const rows = this.rows(desk);
    if (!rows.length) return { lines: [fg(C.dark) + pad(" No visits yet · open a note, then return here", w) + RESET] };
    this.top = this.scroll.place(this.picked(rows), rows.length, h);
    return { lines: rows.slice(this.top, this.top + h).map((r, i) => pickRow(r.title, this.top + i === this.picked(rows), w, r.dim ? C.dark : r.heading ? C.white : C.grey)), scroll: { top: this.top, total: rows.length, room: h } };
  }
  key(k: Key, desk: DeskApi): boolean {
    const b = modeBinding(TRAIL_KEYS, k); if (!b) return false;
    void desk.press?.(this, TILE_ACTIONS.has(b.action) ? TILE_ACTIONS : TRAIL_ACTIONS, b.action, b.args ?? {}); return true;
  }
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { void desk.press?.(this, TRAIL_ACTIONS, "trail.pick", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const rows = this.rows(desk), n = this.top + y; if (n >= rows.length) return true;
    const gesture = this.scroll.press(n, pressOn(k, press, n === this.picked(rows)));
    const action = rows[n]?.folded ? "trail.fold" : !(rows[n]?.visit || rows[n]?.stop) ? "trail.pick" : gesture === "fresh" ? "trail.here" : gesture === "open" ? "trail.open" : "trail.pick";
    void desk.press?.(this, TRAIL_ACTIONS, action, action === "trail.pick" ? { n: n + 1 } : rows[n]?.visit ? { visit: rows[n]!.visit!.open.target.visit } : {}); return true;
  }
  describe(desk: DeskApi) { const rows = this.rows(desk); return { ...this.options, rows: rows.map(r => ({ title: r.title, visit: r.visit?.open.target.visit, folded: r.folded })), at: rows.length ? this.picked(rows) + 1 : 0 }; }
}
const paneOf = (p: unknown): TrailPane => { if (!(p instanceof TrailPane)) throw new ActionRefused("that isn't a Trail tile"); return p; };
const visitArg = { visit: { type: "string", optional: true, about: "visit id; default the selected visit" } } as const;
const menu = (label: string, key: string) => ({ label, key, group: "Trail" });

export const TRAIL_ACTIONS = actionSet<KindHost>()("trail", {
  "trail.facets": def({
    summary: "Open facets over the trail: narrow visits by dwell, day, method or any property",
    menu: menu("facets over the trail", "S"), touches: "shape", replay: "safe", args: {},
    examples: [{ act: "trail.facets tile=trail", does: "opens the facets tile over visits" }],
    run(_, { desk }, actor) { return desk.ctx.dispatch!.act({ action: "facets.trail" }, actor); },
  }),
  "trail.pick": def({ examples: [{ act: "trail.pick tile=trail n=2", does: "selects the first visit below the day heading" }], summary: "Pick a visit without opening it", touches: "tile", replay: "safe",
    args: { n: { type: "number", optional: true, about: "row from 1" }, by: { type: "number", optional: true, about: "rows to move" } },
    run({ n, by }, { pane, desk }) { const p = paneOf(pane), rows = p.rows(desk); p.pick(rows, n !== undefined ? n - 1 : p.picked(rows) + (by ?? 1)); p.scroll.reveal(); desk.redraw(); return { at: p.picked(rows) + 1 }; } }),
  "trail.open": def({ examples: [{ act: "trail.open tile=trail visit=visit-garden", does: "opens the visit returned by trail.recent in its original place" }], summary: "Go to a history stop or open a visit where it was, restoring its closed tile; a trail wired to itself (alt+l o, then a click on it) opens the visit's note in place, ← back returning to the trail", touches: "shape", replay: "ask", args: visitArg, menu: menu("open where it was", "enter"),
    async run({ visit }, { pane, desk }, actor) {
      const p = paneOf(pane);
      if (!visit && p.options.view === "history") return p.go(desk, actor);
      // Wired to itself (PIE-1516): the visit's note opens in this tile, ← back returns to the trail.
      if (desk.opensInPlace?.(pane)) { const v = p.visit(desk, visit), m = await readNote(desk.ctx, v.open.target.note, v.open.target.address); if (!m) throw new ActionRefused("that note is no longer available"); desk.openFromTile(m, { from: pane, link: true, by: actor }); return { opened: m.id, inPlace: true }; }
      if (!desk.reopenTrail) throw new ActionRefused("this screen cannot reopen tiles");
      return desk.reopenTrail(p.visit(desk, visit), actor);
    } }),
  "trail.go": def({ summary: "Go back or forward to a stop in the source tile's history", touches: "tile", replay: "ask",
    args: { n: { type: "number", optional: true, about: "row from 1; default the selected history stop" } }, examples: [{ act: "trail.go tile=trail n=2", does: "takes the source reader to the second history stop" }],
    run({ n }, { pane, desk }, actor) { return paneOf(pane).go(desk, actor, n); } }),
  "trail.here": def({ examples: [{ act: "trail.here tile=trail visit=visit-garden", does: "opens that visit beside the Trail" }], summary: "Open a visit beside this Trail tile", touches: "shape", replay: "ask", args: visitArg, menu: menu("open here", "o"),
    async run({ visit }, { pane, desk }, actor) { const v = paneOf(pane).visit(desk, visit); const m = await readNote(desk.ctx, v.open.target.note, v.open.target.address); if (!m) throw new ActionRefused("that note is no longer available"); desk.openFromTile(m, { from: pane, fresh: true, link: true, by: actor }); return { opened: m.id }; } }),
  "trail.save": def({ examples: [{ act: "trail.save tile=trail visit=visit-garden", does: "writes that branch as a linked note" }], summary: "Save this visit and the branch it started as a note", touches: "nothing", replay: "ask", args: visitArg, menu: menu("save branch as a note", "s"),
    async run({ visit }, { pane, desk }, actor) { const p = paneOf(pane), v = p.visit(desk, visit), trail = desk.ctx.trail!;
      const branch = trail.branch(v.open.target.visit);
      const tree = treeRows([v], parent => branch.filter(child => child.open.source?.visit === parent.open.target.visit));
      const text = `Trail · ${v.title}\n\n` + tree.map(({ node: v, lead }) => `${lead}${visitLink(v)} · ${trail.dwell(v)} · ${v.open.method} · ${new Date(v.open.at).toLocaleString()}${v.open.actor.kind === "agent" ? ` · ${v.open.actor.id}` : ""}`).join("\n");
      const { note } = await desk.ctx.board.newNote(text, undefined, actor); desk.ctx.flash(`Saved trail as ((${note.id}|${note.text.split("\n")[0]}))`); return { note: note.id }; } }),
  "trail.forget": def({ examples: [{ act: "trail.forget tile=trail day=2026-10-22", does: "forgets the visits from that day" }], summary: "Forget a branch, a day (YYYY-MM-DD), or all visits", touches: "nothing", replay: "ask", menu: menu("forget branch", "delete"),
    args: { ...visitArg, day: { type: "string", optional: true, about: "YYYY-MM-DD" }, all: { type: "boolean", optional: true, about: "clear all visits" } },
    run({ visit, day, all }, { pane, desk }) { const n = desk.ctx.trail!.forget({ visit: all || day ? undefined : paneOf(pane).visit(desk, visit).open.target.visit, day, all }); desk.redraw(); return { forgotten: n }; } }),
  "trail.fold": def({ examples: [{ act: "trail.fold tile=trail on=false", does: "shows the quick flips and skimmed previews" }], summary: "Fold or show flipped visits and skimmed previews", touches: "tile", replay: "safe", menu: menu("fold or show flips", "f"),
    args: { on: { type: "boolean", optional: true, about: "fold flips" } }, run({ on }, { pane, desk }) { const p = paneOf(pane); p.options.folded = on ?? !p.options.folded; desk.redraw(); return { folded: p.options.folded }; } }),
  "trail.search": def({ examples: [{ act: "trail.search tile=trail q=garden", does: "finds visits by their note or tile words" }], summary: "Search the trail with the shared note matcher", touches: "tile", replay: "safe", menu: menu("search trail", "/"),
    args: { q: { type: "string", optional: true, about: "words to find; empty clears" } },
    run({ q }, { pane, desk }, actor) { const p = paneOf(pane); const set = async (q: string) => { p.options.q = q; p.resetPick(); desk.redraw(); return { q }; };
      return q !== undefined ? set(q) : askInBar(desk.ctx as never, "Search the trail", [{ name: "q", type: "text", value: p.options.q }], {}, actor, a => set(a.q ?? "")); } }),
  "trail.view": def({ examples: [{ act: "trail.view tile=trail view=timeline", does: "shows visits in time order" }], summary: "Switch between source history, forest, timeline and per-tile views", touches: "tile", replay: "safe", menu: menu("switch view", "t"),
    args: { view: { type: "string", optional: true, choices: ["history", "forest", "timeline", "tile"], about: "view" } }, run({ view }, { pane, desk }) { const p = paneOf(pane); const views = ["history", "forest", "timeline", "tile"] as const; p.options.view = view as View ?? views[(views.indexOf(p.options.view) + 1) % views.length]!; p.resetPick(); desk.redraw(); return { view: p.options.view }; } }),
  "trail.agents": def({ examples: [{ act: "trail.agents tile=trail mode=dim", does: "dims visits opened by agents" }], summary: "Show, dim or hide visits opened by agents", touches: "tile", replay: "safe", menu: menu("show, dim or hide agents", "a"),
    args: { mode: { type: "string", optional: true, choices: ["show", "dim", "hide"], about: "visibility" } }, run({ mode }, { pane, desk }) { const p = paneOf(pane); const modes = ["show", "dim", "hide"] as const; p.options.agents = mode as TrailView["agents"] ?? modes[(modes.indexOf(p.options.agents) + 1) % 3]!; desk.redraw(); return { agents: p.options.agents }; } }),
});
export const TRAIL_TILE: TileKind = {
  kind: "trail", noun: "a Trail tile", about: "The day's forest of visits: what opened what, dwell and closed tiles; ⏎ reopens where it was",
  make: s => new TrailPane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader", s.state as Partial<Options> | undefined), openArgs: ["source"], actions: TRAIL_ACTIONS,
  describe: p => ({ source: `tile:${(p as TrailPane).source}` }), peek: (p, desk) => ({ trail: (p as TrailPane).describe(desk) }),
  // A list of visits: wired to itself (PIE-1516), a visit's note opens in its tile.
  lists: () => true,
};
