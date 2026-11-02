import { C, fg, pad, RESET } from "../style";
import { RowView, wheelRows } from "../scroll";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { keyTable } from "../surface/keymap";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import { pickRow } from "../surface/picker";
import { askInBar } from "../bar/ask";
import { trailRows, type TrailRow, type TrailView } from "../trail-view";
import { treeRows } from "../figures/tree";
import type { Visit } from "../trail";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";
import { TILE_ACTIONS } from "./tile-actions";
import type { KindHost, TileKind } from "./tile-kinds";

const row = (key: string, action: string, label: string, args?: Record<string, unknown>): ModeKey => ({ key, action, label, ...(args ? { args } : {}) });
export const TRAIL_KEYS: readonly ModeKey[] = keyTable("trail", "the day's trail (alt+T)", [
  row("j", "trail.pick", "pick", { by: 1 }), row("down", "trail.pick", "pick", { by: 1 }),
  row("k", "trail.pick", "pick", { by: -1 }), row("up", "trail.pick", "pick", { by: -1 }),
  row("enter", "trail.open", "where it was"), row("o", "trail.here", "open here"), row("s", "trail.save", "save branch"),
  row("f", "trail.fold", "fold flips"), row("/", "trail.search", "search"), row("t", "trail.view", "view"),
  row("a", "trail.agents", "agents"), row("delete", "trail.forget", "forget branch"),
  row("esc", "tile.close", "close"), row("q", "tile.close", "close"),
]);

export class TrailPane implements Pane {
  readonly kind = "trail";
  readonly bindings = TRAIL_KEYS;
  at = 1;
  readonly scroll = new RowView();
  options: TrailView = { view: "forest", folded: true, agents: "dim", q: "" };
  constructor(public source = "reader", options?: Partial<TrailView>) { Object.assign(this.options, options); }
  title() { return `Trail · ${this.options.view}${this.options.q ? ` · ${this.options.q}` : ""}`; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() { return modeHint(TRAIL_KEYS, a => TRAIL_ACTIONS.def(a) ?? TILE_ACTIONS.def(a)); }
  spec() { return { source: `tile:${this.source}`, state: this.options }; }
  rows(desk: DeskApi): TrailRow[] { return desk.ctx.trail ? trailRows(desk.ctx.trail, this.options) : []; }
  picked(rows: readonly TrailRow[]): number { return Math.max(0, Math.min(rows.length - 1, this.at)); }
  visit(desk: DeskApi, id?: string): Visit {
    const v = id ? desk.ctx.trail?.get(id) : this.rows(desk)[this.at]?.visit;
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
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { void desk.press?.(this, TRAIL_ACTIONS, "trail.pick", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const rows = this.rows(desk), n = this.top + y; if (n >= rows.length) return true;
    const action = rows[n]?.folded ? "trail.fold" : n === this.picked(rows) && rows[n]?.visit ? "trail.open" : "trail.pick";
    void desk.press?.(this, TRAIL_ACTIONS, action, action === "trail.pick" ? { n: n + 1 } : {}); return true;
  }
  describe(desk: DeskApi) { return { ...this.options, rows: this.rows(desk).map(r => ({ title: r.title, visit: r.visit?.open.target.visit, folded: r.folded })), at: this.at + 1 }; }
}
const paneOf = (p: unknown): TrailPane => { if (!(p instanceof TrailPane)) throw new ActionRefused("that isn't a Trail tile"); return p; };
const visitArg = { visit: { type: "string", optional: true, about: "visit id; default the selected visit" } } as const;
const menu = (label: string, key: string) => ({ label, key, group: "Trail" });

export const TRAIL_ACTIONS = actionSet<KindHost>()("trail", {
  "trail.pick": def({ summary: "Pick a visit without opening it", touches: "tile", replay: "safe",
    args: { n: { type: "number", optional: true, about: "row from 1" }, by: { type: "number", optional: true, about: "rows to move" } },
    run({ n, by }, { pane, desk }) { const p = paneOf(pane), rows = p.rows(desk); p.at = Math.max(0, Math.min(rows.length - 1, n !== undefined ? n - 1 : p.at + (by ?? 1))); p.scroll.reveal(); desk.redraw(); return { at: p.at + 1 }; } }),
  "trail.open": def({ summary: "Open a visit where it was, restoring its closed tile in its place", touches: "shape", replay: "ask", args: visitArg, menu: menu("open where it was", "enter"),
    async run({ visit }, { pane, desk }, actor) { if (!desk.reopenTrail) throw new ActionRefused("this screen cannot reopen tiles"); return desk.reopenTrail(paneOf(pane).visit(desk, visit), actor); } }),
  "trail.here": def({ summary: "Open a visit beside this Trail tile", touches: "shape", replay: "ask", args: visitArg, menu: menu("open here", "o"),
    async run({ visit }, { pane, desk }, actor) { const v = paneOf(pane).visit(desk, visit); const m = await desk.ctx.board.get(v.open.target.note); if (!m) throw new ActionRefused("that note is no longer available"); desk.openFromTile(m, { from: pane, fresh: true, link: true, by: actor }); return { opened: m.id }; } }),
  "trail.save": def({ summary: "Save this visit and the branch it started as a note", touches: "nothing", replay: "ask", args: visitArg, menu: menu("save branch as a note", "s"),
    async run({ visit }, { pane, desk }, actor) { const p = paneOf(pane), v = p.visit(desk, visit), trail = desk.ctx.trail!;
      const branch = trail.branch(v.open.target.visit);
      const tree = treeRows([v], parent => branch.filter(child => child.open.source?.visit === parent.open.target.visit));
      const text = `Trail · ${v.title}\n\n` + tree.map(({ node: v, lead }) => `${lead}((${v.open.target.note}|${v.title})) · ${trail.dwell(v)} · ${v.open.method} · ${new Date(v.open.at).toLocaleString()}${v.open.actor.kind === "agent" ? ` · ${v.open.actor.id}` : ""}`).join("\n");
      const note = await desk.ctx.board.createBlock(null, text, actor); desk.ctx.flash(`Saved trail as ((${note.id}|${note.text.split("\n")[0]}))`); return { note: note.id }; } }),
  "trail.forget": def({ summary: "Forget a branch, a day (YYYY-MM-DD), or all visits", touches: "nothing", replay: "ask", menu: menu("forget branch", "delete"),
    args: { ...visitArg, day: { type: "string", optional: true, about: "YYYY-MM-DD" }, all: { type: "boolean", optional: true, about: "clear all visits" } },
    run({ visit, day, all }, { pane, desk }) { const n = desk.ctx.trail!.forget({ visit: all || day ? undefined : paneOf(pane).visit(desk, visit).open.target.visit, day, all }); desk.redraw(); return { forgotten: n }; } }),
  "trail.fold": def({ summary: "Fold or show flipped visits and skimmed previews", touches: "tile", replay: "safe", menu: menu("fold or show flips", "f"),
    args: { on: { type: "boolean", optional: true, about: "fold flips" } }, run({ on }, { pane, desk }) { const p = paneOf(pane); p.options.folded = on ?? !p.options.folded; desk.redraw(); return { folded: p.options.folded }; } }),
  "trail.search": def({ summary: "Search the trail with the shared note matcher", touches: "tile", replay: "safe", menu: menu("search trail", "/"),
    args: { q: { type: "string", optional: true, about: "words to find; empty clears" } },
    run({ q }, { pane, desk }, actor) { const p = paneOf(pane); const set = async (q: string) => { p.options.q = q; p.at = 0; desk.redraw(); return { q }; };
      return q !== undefined ? set(q) : askInBar(desk.ctx as never, "Search the trail", [{ name: "q", type: "text", value: p.options.q }], {}, actor, a => set(a.q ?? "")); } }),
  "trail.view": def({ summary: "Switch between the forest, timeline and per-tile views", touches: "tile", replay: "safe", menu: menu("switch view", "t"),
    args: { view: { type: "string", optional: true, choices: ["forest", "timeline", "tile"], about: "view" } }, run({ view }, { pane, desk }) { const p = paneOf(pane); const views = ["forest", "timeline", "tile"] as const; p.options.view = view as TrailView["view"] ?? views[(views.indexOf(p.options.view) + 1) % 3]!; p.at = 0; desk.redraw(); return { view: p.options.view }; } }),
  "trail.agents": def({ summary: "Show, dim or hide visits opened by agents", touches: "tile", replay: "safe", menu: menu("show, dim or hide agents", "a"),
    args: { mode: { type: "string", optional: true, choices: ["show", "dim", "hide"], about: "visibility" } }, run({ mode }, { pane, desk }) { const p = paneOf(pane); const modes = ["show", "dim", "hide"] as const; p.options.agents = mode as TrailView["agents"] ?? modes[(modes.indexOf(p.options.agents) + 1) % 3]!; desk.redraw(); return { agents: p.options.agents }; } }),
});
export const TRAIL_TILE: TileKind = {
  kind: "trail", noun: "a Trail tile", about: "The day's forest of visits: what opened what, dwell and closed tiles; ⏎ reopens where it was",
  make: s => new TrailPane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader", s.state as Partial<TrailView> | undefined), openArgs: ["source"], actions: TRAIL_ACTIONS,
  describe: p => ({ source: `tile:${(p as TrailPane).source}` }), peek: (p, desk) => ({ trail: (p as TrailPane).describe(desk) }),
};
