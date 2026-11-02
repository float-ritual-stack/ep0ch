import type { ListPrimitive } from "@ep0ch/outline-core/list-row";
import { subject, type Msg } from "../board";
import { RELOAD_PAUSE_MS, SearchSchedule } from "../search-schedule";
import { pressOn, type RowPress } from "../scroll";
import { USER, type Actor } from "../socket";
import { C, extractLinks, fg, LINK_END, linkTag, type LinkRange } from "../style";
import { actionSet, def } from "../surface/actions";
import { filterLine } from "../surface/line";
import { LISTVIEW_ACTIONS, type ListHost } from "../surface/list-actions";
import { COLLECTION_KEYS, LIST_KEYS, listBinding } from "../surface/list-keys";
import { ListView, type ListViewRow } from "../surface/list-view";
import { keyTable } from "../surface/keymap";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import type { Key } from "../term";
import { TONE_INDEX } from "../theme";
import { openAddress } from "./outline-boards";
import { runOwn, type DeskApi, type Pane } from "./panes";
import { PostIt, readPostIt } from "./post-it";
import type { TileKind, KindHost } from "./tile-kinds";
import { ActionRefused } from "../surface/actions";

export type ShelfRef = { ref: string; title: string; by: string | null };
export type ShelfLayout = "list" | "grid";
export type ShelfColour = keyof typeof TONE_INDEX;
const across = COLLECTION_KEYS.filter(k => k.action === "list.step" && k.args?.axis === "column");
export const SHELF_KEYS = keyTable("shelf", "arrange the post-its on a shelf", [
  { key: "v", action: "shelf.layout", label: "list/grid" },
  { key: "c", action: "shelf.colour", label: "colour" },
] satisfies ModeKey[]);

export class Shelf implements Pane {
  readonly kind = "shelf";
  readonly list = new ListView<ShelfRef>("shelf");
  private hits: LinkRange[] = [];
  private notes = new Map<string, Msg>();
  private readonly refreshes = new SearchSchedule(RELOAD_PAUSE_MS);
  private reading: Promise<void> | null = null;
  private stale = false;
  constructor(public refs: ShelfRef[] = [], public layout: ShelfLayout = "list", public colour: ShelfColour = "amber") { this.sync(); }
  title() { return `shelf (${this.refs.length})`; }
  hint() { return modeHint([...LIST_KEYS.filter(k => k.action !== "list.enter"), ...(this.layout === "grid" ? across : []), ...SHELF_KEYS], a => SHELF_ACTIONS.def(a) ?? LISTVIEW_ACTIONS.def(a)); }
  spec() { return { refs: this.refs, shelfLayout: this.layout, colour: this.colour }; }
  headStatus() { return { glyph: "▤", sgr: fg(TONE_INDEX[this.colour]) }; }
  headControls(_room: number, desk: DeskApi) {
    return [
      { text: this.colour, sgr: fg(TONE_INDEX[this.colour]), chip: true as const, press: () => runOwn(SHELF_ACTIONS, "shelf.colour", {}, { pane: this, desk }) },
      ...(["list", "grid"] as const).map(set => ({ text: set, sgr: fg(set === this.layout ? C.lcyan : C.dark), chip: true as const, press: () => runOwn(SHELF_ACTIONS, "shelf.layout", { set }, { pane: this, desk }) })),
    ];
  }
  private sync() {
    this.list.set(this.refs.map(ref => ({ id: ref.ref, label: ref.title, mark: "·", do: { open: ref.ref }, source: ref, ...(ref.by ? { detail: ref.by } : {}) })));
  }
  async add(m: Msg, desk: DeskApi, actor: Actor) {
    const ref = m.id.startsWith("glass:") ? m.text : await openAddress(desk.ctx, m);
    if (!this.refs.some(r => r.ref === ref)) this.refs.push({ ref, title: subject(m), by: actor.kind === "agent" ? actor.id : null });
    this.notes.set(ref, m); this.sync(); desk.keepLayout?.(); desk.redraw();
    return { name: desk.nameOfPane?.(this), ref, refs: this.refs };
  }
  private async note(ref: string, desk: DeskApi) {
    const m = await readPostIt(desk.ctx, ref);
    this.notes.set(ref, m);
    return m;
  }
  refresh(desk: DeskApi): Promise<void> {
    if (this.reading) return this.reading;
    this.stale = false;
    const turn = this.refreshes.begin(), refs = [...this.refs];
    return this.reading = Promise.all(refs.map(r => this.note(r.ref, desk))).then(notes => {
      if (!turn.alive()) return;
      refs.forEach((r, i) => { r.title = subject(notes[i]!); });
      this.sync();
    }, e => { if (turn.alive()) desk.ctx.flash((e as Error).message); }).finally(() => {
      this.reading = null;
      if (turn.alive()) desk.redraw();
    });
  }
  init(desk: DeskApi) { void this.refresh(desk); }
  onEvent(desk: DeskApi) {
    this.refreshes.pause(() => {
      this.stale = true;
      if (desk.shows?.(this) !== false) void this.refresh(desk);
      else desk.redraw();
    });
  }
  dispose() { this.refreshes.cancel(); this.stale = false; }
  selected() { const r = this.list.picked(); return r ? this.notes.get(r.id) ?? null : null; }
  subject() { return this.selected()?.id ?? null; }
  get holdsKeys() { return !!this.list.typing; }
  listHost(desk: DeskApi): ListHost {
    const show = async (row: ListViewRow) => {
      const m = await this.note(row.id, desk);
      if (this.list.pickedId() === row.id) desk.showFrom?.(this, m, USER, "float");
    };
    return {
      lists: () => [{ n: 1, key: "shelf", title: desk.nameOfPane?.(this) ?? this.title(), view: this.list, entered: !!desk.hasFocus?.(this) }],
      current: () => "shelf", none: "this shelf is empty · glass.shelve ref=<note> shelf=<tile>",
      picked: (_l, row) => show(row),
      open: async (_l, row, where, actor) => {
        const m = await this.note(row.id, desk);
        await desk.openFromTile(m, { from: this, link: true, by: actor, ...(where === "new" ? { fresh: true } : {}), where: "float" });
        return { id: m.id };
      },
      enter: () => { throw new ActionRefused("a shelf's list has the keys whenever its tile does · tile.focus enters it"); },
      type: () => { this.list.startTyping(filterLine); desk.redraw(); }, redraw: () => desk.redraw(),
    };
  }
  render(w: number, h: number, focused: boolean, desk: DeskApi) {
    if (this.stale && !this.reading) void this.refresh(desk);
    const rows = this.list.visible();
    const primitive: ListPrimitive = { type: "list", rows: [...rows], ...(this.layout === "grid" ? { arrange: "grid" } : {}) };
    const drawn = this.list.draw({ primitive, cols: w, focused, selection: true, ...(this.layout === "list" ? { room: h } : {}), empty: "Drag a post-it here · glass.shelve ref= shelf=", tag: (r, s) => linkTag(rows.indexOf(r)) + s + LINK_END });
    const out = extractLinks(drawn.lines);
    const picked = rows.findIndex(r => r.id === this.list.pickedId());
    const at = out.ranges.find(r => r.n === picked)?.line ?? 0;
    const top = this.layout === "grid" ? this.list.view.place(picked, out.lines.length, h, [at, at]) : 0;
    this.hits = out.ranges.filter(r => r.line >= top && r.line < top + h).map(r => ({ ...r, line: r.line - top }));
    return { lines: out.lines.slice(top, top + h) };
  }
  key(k: Key, desk: DeskApi) {
    if (this.list.typing) {
      if (k.kind === "enter" || k.kind === "esc") this.list.stopTyping(k.kind === "enter");
      else this.list.typing.take(k);
      desk.redraw(); return true;
    }
    const own = modeBinding(SHELF_KEYS, k);
    const bound = own ?? (this.layout === "grid" ? modeBinding(across, k) : undefined) ?? listBinding(k, false, this.list.pickable().length);
    if (!bound || bound.action === "list.enter") return false;
    runOwn(own ? SHELF_ACTIONS : LISTVIEW_ACTIONS, bound.action, bound.args ?? {}, { pane: this, desk }); return true;
  }
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress) {
    if (k.action === "wheel-up" || k.action === "wheel-down") return this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, desk);
    if (k.action !== "down") return true;
    const hit = this.hits.find(r => r.line === y && x >= r.from && x < r.to);
    if (!hit) return true;
    const row = this.list.visible()[hit.n]!;
    const gesture = this.list.press(hit.n, pressOn(k, press, this.list.pickedId() === row.id));
    runOwn(LISTVIEW_ACTIONS, gesture === "open" || gesture === "fresh" ? "list.open" : "list.pick", { id: row.id, ...(gesture === "fresh" ? { where: "new" } : {}) }, { pane: this, desk });
    return true;
  }
}

export const SHELF_ACTIONS = actionSet<KindHost>()("shelf", {
  "shelf.layout": def({
    summary: "draw this shelf's refs as a list or a grid", keys: "v, click list grid", touches: "tile", replay: "safe",
    args: { set: { type: "string", optional: true, choices: ["list", "grid"], about: "list or grid; left out switches" } },
    run({ set }, { pane, desk }) { const s = pane as Shelf; s.layout = (set ?? (s.layout === "list" ? "grid" : "list")) as ShelfLayout; desk.keepLayout?.(); desk.redraw(); return { layout: s.layout }; },
  }),
  "shelf.colour": def({
    summary: "colour this shelf's header", keys: "c, click the header colour", touches: "tile", replay: "safe",
    args: { set: { type: "string", optional: true, choices: Object.keys(TONE_INDEX), about: "colour family; left out cycles" } },
    run({ set }, { pane, desk }) { const s = pane as Shelf, colours = Object.keys(TONE_INDEX) as ShelfColour[]; s.colour = set as ShelfColour ?? colours[(colours.indexOf(s.colour) + 1) % colours.length]!; desk.keepLayout?.(); desk.redraw(); return { colour: s.colour }; },
  }),
});

export const SHELF_KIND: TileKind = {
  kind: "shelf", about: "a named, coloured pile of post-it references, drawn by the shared list", previews: true,
  make: s => new Shelf(s.refs, s.shelfLayout, s.colour), actions: SHELF_ACTIONS,
  shows: p => (p as Shelf).selected(),
  describe: p => ({ shelf: (p as Shelf).spec() }),
  receive: (p, from, desk) => from instanceof PostIt && from.msg ? { label: `shelve on ${desk.nameOfPane?.(p)}`, action: "postit.shelve", args: { shelf: desk.pathTo?.(p) } } : null,
};
