// The board as its tests read it (PIE-515: the board is a screen spec on the desk, so its areas are tiles and its
// lanes' state is the lanes' model): places by the names its tests use, "lanes" (the lane the cursor is in), "preview",
// "detail<i>" and "float<i>" by place (from 0), "tree" and "backlinks" (the drawers' lists), "tree-preview" and
// "links-preview" (their previews), a lane by its name, or any tile's name. Read through the desk's own host API
// (`pane`, `modelFor`, `openedPanes`, `floatPanes`, `drawnAt`, `focusPane`): no private reaches. Tests only: an agent
// names tiles by name (detail1, float1 are detail tiles' names, not places).
import type { Rect } from "../src/canvas";
import type { BacklinksPane } from "../src/desk/backlinks-pane";
import type { Desk } from "../src/desk/desk";
import { Lanes } from "../src/desk/lanes";
import type { Pane, ReaderPane, TreePane } from "../src/desk/panes";
import type { PreviewPane } from "../src/desk/preview";
import type { QueryPane } from "../src/desk/query";
import { USER } from "../src/socket";

/** A board's parts, read by place (loosely typed, as a test reads them: what's there is the test's to say). */
export class BoardView {
  constructor(readonly b: Desk) {}
  /** The lanes' model: the hub, the cursor, the composer, the steps, the mover, what was written. */
  get model(): Lanes { const m = this.b.modelFor("lanes"); if (!(m instanceof Lanes)) throw new Error("no lanes on this screen"); return m; }
  get lanes(): any[] { return this.model.lanes; }
  /** The lane the cursor is in, by place. */
  get lane(): number { return this.model.lane; }
  /** The cursor to lane `i` (as h l move it; the keys go with it while they're on the lanes). */
  set lane(i: number) { this.model.lane = i; }
  get preview(): any { return this.b.pane("preview") as PreviewPane; }
  /** The details docked in the readers row, in its order. */
  get details(): any[] { return this.b.openedPanes("readers") as ReaderPane[]; }
  /** Which detail ⏎ opens into, by place. */
  get active(): number { const a = this.b.activePane("readers"); return a ? this.details.indexOf(a as ReaderPane) : 0; }
  get floats(): any[] { return this.b.floatPanes() as ReaderPane[]; }
  get tree(): any { return this.b.pane("tree") as TreePane; }
  get treePreview(): any { return this.b.pane("tree-preview") as PreviewPane; }
  get linksTile(): any { return this.b.pane("backlinks") as BacklinksPane; }
  get linksPreview(): any { return this.b.pane("backlinks-preview") as PreviewPane; }
  /** The outline drawer is on screen (open, or docked). */
  get treeOpen(): boolean { return this.b.shownNow(this.tree); }
  get treePinned(): boolean { return !this.b.inDrawer(this.tree); }
  get linksOpen(): boolean { return this.b.shownNow(this.linksTile); }
  get linksPinned(): boolean { return !this.b.inDrawer(this.linksTile); }
  // The screen's own, as any host reads it.
  get ctx() { return this.b.ctx; }
  get dispatch() { return this.b.dispatch; }
  describe() { return this.b.describe() as any; }
  layoutGet() { return this.b.layoutGet() as any; }
  // The lanes' model's state, as the model keeps it.
  get hub(): any { return this.model.hub; }
  get status(): any { return this.model.status; }
  get hubPicker(): any { return this.model.hubPicker; }
  get composer(): any { return this.model.composer; }
  get composerAt(): any { return this.model.composerAt; }
  get steps(): any { return this.model.steps; }
  get mover(): any { return this.model.mover; }
  set mover(m: any) { this.model.mover = m; }
  get movePlans(): any { return this.model.movePlans; }
  get moving(): any { return this.model.moving; }
  get lastMove(): any { return this.model.lastMove; }
  get lastWrite(): any { return this.model.lastWrite; }
  get trashArm(): any { return this.model.trashArm; }
  get trashed(): any { return this.model.trashed; }
  get refreshes(): any { return this.model.refreshes; }
  get asked(): any { return this.model.asked; }
  get cardDrag(): any { return this.model.cardDrag; }
  /** The selected card. */
  card(): any { return this.model.card(); }
  /** The preview shows the selected card (as moving the cursor does). */
  follow() { this.model.follow(); }
  /** Every lane asked for its cards again. */
  loadLanes() { this.model.loadLanes(); }
  /** The selected card to lane `i` (as H L do). */
  moveTo(i: number) { return this.model.moveTo(i); }
  /** The card an actor's card actions default to. */
  selectedCardId(): string { return this.model.selectedCardId(); }
  /** The columns filled from their sources again. */
  fill() { return this.b.fillColumns(); }
  /** A tile's stable number (`t<n>` in layout.get and a saved layout). */
  tileNum(place: string | Pane): number { const p = typeof place === "string" ? tileOf(this, place) : place; const n = p ? this.b.nameOfPane(p) : ""; const t = (this.layoutGet().tiles as { name: string; id: string }[]).find(x => x.name === n); return Number(t?.id.slice(1)); }
  /** The names of the tiles folded to spines. */
  get collapsed(): Set<string> { return new Set((this.layoutGet().tiles as { name: string }[]).map(t => t.name).filter(n => { const p = this.b.pane(n); return !!p && this.b.folded(p); })); }
  /** The tile's rectangle as last drawn (a float's too), by place or pane. */
  rect(place: string | Pane): Rect | undefined { const p = typeof place === "string" ? tileOf(this, place) : place; return p ? this.b.rectOf(p) : undefined; }
  /** A place's tile (see the top of this file). */
  tile(place: string): Pane | undefined { return tileOf(this, place); }
  /** A tile's name for agents (`tile=`): detail1, not its place. */
  name(p: Pane): string { return this.b.nameOfPane(p); }
  /** Folded to a spine: its fold (who folded it), else undefined. */
  folded(place: string | Pane): { by?: string } | undefined { const p = typeof place === "string" ? tileOf(this, place) : place; return p ? this.b.foldOf(p) : undefined; }
}

const tileOf = (v: BoardView, place: string): Pane | undefined => {
  if (place === "lanes") return v.lanes[v.lane];
  if (place === "links-preview") return v.linksPreview;
  const lane = v.lanes.find(l => l.name === place);
  if (lane) return lane;
  const d = /^detail(\d+)$/.exec(place);
  if (d) return v.details[Number(d[1])];
  const f = /^float(\d+)$/.exec(place);
  if (f) return v.floats[Number(f[1])];
  return v.b.pane(place);
};

/** The board's parts, read by place. */
export const view = (b: Desk) => new BoardView(b);

/** The place that has the keys. */
export function where(b: Desk): string {
  const v = view(b), f = b.focusedPane();
  if (!f) return "";
  if (v.lanes.includes(f as QueryPane)) return "lanes";
  const di = v.details.indexOf(f as ReaderPane);
  if (di >= 0) return `detail${di}`;
  const fi = v.floats.indexOf(f as ReaderPane);
  if (fi >= 0) return `float${fi}`;
  const n = b.focusedName();
  return n === "backlinks-preview" ? "links-preview" : n;
}

/** Give the keys to a place (as a test sets the scene; the person's way is Tab, a click or `tile.focus`). */
export function at(b: Desk, place: string) {
  const p = tileOf(view(b), place);
  if (!p) throw new Error(`no ${place} on the board`);
  b.focusPane(p, USER);
}

/** Where a place was drawn: its tile's frame (the columns' for "lanes:all"), as the board last placed it. */
export function rectOf(b: Desk, place: string): Rect {
  if (place === "lanes:all") return b.drawnAt("lanes")!;
  const p = tileOf(view(b), place);
  return (p ? b.rectOf(p) : undefined) as Rect;
}
