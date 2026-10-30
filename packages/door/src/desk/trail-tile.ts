// The trail tile (PIE-1425): a tile's trail (PIE-208) docked beside it, resized and closed like any tile. It reads its
// source's own back and forward every frame (Pane.trail, PIE-1426: a reader's stacks, the links tile's notes listed), so it
// follows as the tile walks; a stop chosen is back or forward that many steps there, as back steps= does. Opened by alt+T, the ≡
// trail chip or the tile menu's trail row on a screen of tiles (Desk.trailTile); a screen without tiles lists the trail
// over itself instead.
import { C, fg, pad, RESET } from "../style";
import { RowView, wheelRows } from "../scroll";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { keyTable } from "../surface/keymap";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import { trailLine, trailRows, type TrailRow } from "../surface/note";
import { pickRow } from "../surface/picker";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";
import { TILE_ACTIONS } from "./tile-actions";
import type { KindHost, TileKind } from "./tile-kinds";

const row = (key: string, action: string, label: string, args?: Record<string, unknown>): ModeKey => ({ key, action, label, ...(args ? { args } : {}) });
/** The trail tile's keys: a table like any mode's, so the keymap moves them and the hint row says them. */
export const TRAIL_KEYS: readonly ModeKey[] = keyTable("trail", "a trail tile (alt+T)", [
  row("j", "trail.pick", "pick", { by: 1 }), row("down", "trail.pick", "pick", { by: 1 }),
  row("k", "trail.pick", "pick", { by: -1 }), row("up", "trail.pick", "pick", { by: -1 }),
  row("enter", "trail.go", "go there"), row("esc", "tile.close", "close"), row("q", "tile.close", "close"),
]);

export class TrailPane implements Pane {
  readonly kind = "trail";
  readonly bindings = TRAIL_KEYS;
  /** The row picked, from 0; null is the note shown (the trail's ●). */
  at: number | null = null;
  readonly view = new RowView();
  /** `source`: the tile whose trail it lists (a reader, the links tile), by name. */
  constructor(public source: string) {}

  title() { return `trail · ${this.source}`; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() { return `${modeHint(TRAIL_KEYS, a => (TRAIL_ACTIONS.def(a) ?? TILE_ACTIONS.def(a)))} · click picks, again goes`; }
  spec() { return { source: `tile:${this.source}` }; }

  /** The tile whose trail it lists, while it's here and keeps one (Pane.trail). */
  reader(desk: DeskApi): (Pane & { trail: NonNullable<Pane["trail"]> }) | null { const p = desk.paneNamed?.(this.source); return p?.trail ? p as Pane & { trail: NonNullable<Pane["trail"]> } : null; }
  /** Its rows now, from the source's own trail. */
  rows(desk: DeskApi): TrailRow[] { const r = this.reader(desk); return r ? trailRows(r.trail.stops()) : []; }
  /** The row picked, clamped to the rows there are; the note shown when none was picked. */
  picked(rows: readonly TrailRow[]): number { const here = rows.findIndex(r => r.dir === 0); return Math.max(0, Math.min(rows.length - 1, this.at ?? here)); }

  private top = 0;
  render(w: number, h: number, _focused: boolean, desk: DeskApi): PaneView {
    const rows = this.rows(desk);
    if (!this.reader(desk)) return { lines: [fg(C.dark) + pad(` ${this.source} has closed: esc closes this trail too`, w) + RESET] };
    if (rows.length < 2) return { lines: [fg(C.dark) + pad(` no trail yet: follow a link in ${this.source} and its stops show here`, w) + RESET] };
    const sel = this.picked(rows);
    this.top = this.view.place(sel, rows.length, h);
    const lines = rows.slice(this.top, this.top + h).map((r, i) => pickRow(trailLine(r), this.top + i === sel, w, r.dir ? C.grey : C.white));
    return { lines, scroll: { top: this.top, total: rows.length, room: h } };
  }

  key(k: Key, desk: DeskApi): boolean {
    const b = modeBinding(TRAIL_KEYS, k);
    if (!b) return false;
    void desk.press?.(this, TILE_ACTIONS.has(b.action) ? TILE_ACTIONS : TRAIL_ACTIONS, b.action, b.args ?? {});
    return true;
  }
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { void desk.press?.(this, TRAIL_ACTIONS, "trail.pick", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const rows = this.rows(desk), n = this.top + y;
    if (n >= rows.length) return true;
    // A click picks a stop; a click on the one picked goes there.
    void desk.press?.(this, TRAIL_ACTIONS, n === this.picked(rows) ? "trail.go" : "trail.pick", n === this.picked(rows) ? {} : { n: n + 1 });
    return true;
  }

  describe(desk: DeskApi) {
    const rows = this.rows(desk);
    return { source: `tile:${this.source}`, rows: rows.map(r => r.title), at: rows.length ? this.picked(rows) + 1 : 0 };
  }
}

const paneOf = (p: unknown): TrailPane => { if (!(p instanceof TrailPane)) throw new ActionRefused("that isn't a trail tile"); return p; };

export const TRAIL_ACTIONS = actionSet<KindHost>()("trail", {
  "trail.pick": def({
    summary: "pick a stop in a trail tile: n=<row from 1> or by=<rows> (negative up); it goes nowhere until trail.go",
    keys: [{ keys: "j k ↓ ↑", does: "the next stop down or up" }, { keys: "click", does: "on a stop" }, { keys: "wheel", does: "the stops" }],
    touches: "tile", replay: "safe", way: "an agent reads the trail with trail (tile=<its reader>), which moves nothing",
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, by: { type: "number", optional: true, about: "rows to move, negative up" } },
    examples: [{ act: "trail.pick n=3 tile=trail", does: "picks the third stop listed" }],
    run({ n, by }, { pane, desk }) {
      const p = paneOf(pane), rows = p.rows(desk);
      if (rows.length < 2) throw new ActionRefused(`no trail yet: follow a link in ${p.source} first`);
      p.at = Math.max(0, Math.min(rows.length - 1, n !== undefined ? n - 1 : p.picked(rows) + (by ?? 1)));
      p.view.reveal(); desk.redraw();
      return { at: p.at + 1, title: rows[p.at]!.title };
    },
  }),
  "trail.go": def({
    summary: "go to the stop picked in a trail tile (or row n=): its reader goes back or forward that many steps, as back steps= does, and the trail stays beside it",
    keys: [{ keys: "⏎", does: "on the stop picked" }, { keys: "click", does: "on the stop picked again" }],
    touches: "tile", replay: "ask", way: "an agent goes with back steps= or forward steps= on the reader (tile=<it>)",
    args: { n: { type: "number", optional: true, about: "the row, from 1; default the one picked" } },
    examples: [{ act: "trail.go n=4 tile=trail", does: "takes its reader to the fourth stop listed" }],
    async run({ n }, { pane, desk }, actor) {
      const p = paneOf(pane), rows = p.rows(desk), r = p.reader(desk);
      if (!r || rows.length < 2) throw new ActionRefused(`no trail yet: follow a link in ${p.source} first`);
      const stop = rows[n !== undefined ? Math.max(0, Math.min(rows.length - 1, n - 1)) : p.picked(rows)]!;
      p.at = null;
      if (!stop.dir) return { here: stop.title };
      const why = await r.trail.go(stop.dir, stop.steps, desk, actor);
      if (why) throw new ActionRefused(why);
      return { went: stop.title, [stop.dir < 0 ? "back" : "forward"]: stop.steps };
    },
  }),
});

/** The trail tile's kind: opened beside its reader by Desk.trailTile (alt+T on a screen of tiles), or tile.open kind=trail source=tile:<reader>. */
export const TRAIL_TILE: TileKind = {
  kind: "trail", noun: "a trail tile",
  about: "a reader's trail (source=tile:<name>): every stop back and forward by its title beside it, ⏎ goes there (PIE-208, PIE-1425)",
  make: s => new TrailPane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader"),
  openArgs: ["source"],
  check: s => (s.source && !/^tile:./.test(s.source) ? "a trail tile's source is tile:<name>, the reader whose trail it lists" : null),
  actions: TRAIL_ACTIONS,
  describe: p => ({ source: `tile:${(p as TrailPane).source}` }),
  peek: (p, desk) => ({ trail: (p as TrailPane).describe(desk) }),
};
