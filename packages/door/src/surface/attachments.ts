// The attached surface as one layer (PIE-1536): everything a reader shows beside its note (the comment being written,
// Sources, settings, a list's children, the edit preview) is an attachment. Each kind supplies only what is its own: the
// state it keeps (`owner`), its drawing (`draw`) and its words; the layer owns the rest for all of them: which are open,
// where each sits (inline, floating, split, popup, tile: attached.ts's geometry), drawing a split or a float, which one is
// on top (the one holding the keys paints last and takes the pointer first), the split's size and side, moving a float,
// the placement menu's choices and the hand-off to a tile of its own (AttachedTile, the host's `attachedTile`). A new kind
// is one more `AttachmentDef`: no placement code of its own (test/attachments.test.ts registers a made-up one).
import { ActionRefused } from "./actions";
import { ATTACHED_PLACES, AttachedTile, attachedAt, attachedPlaceOf, attachedRect, drawAttachedFloat, frameZone, moveFloat, nextPlace, type AttachedPlace, type AttachedSide, type AttachedSplit, type AttachedTileHost, type FloatMove, type FloatRect } from "./attached";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { C, fg, pad, RESET } from "../style";
import { readState, writeState } from "../state";

export const ATTACHMENT_KINDS = ["comment", "sources", "list-preview", "edit-preview", "settings"] as const;
/** The attachments a reader has, by name: `attachment.split target=`, `placement.menu target=`, a tile's kind. */
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export const attachmentKindOf = (v: unknown): AttachmentKind | null => (ATTACHMENT_KINDS as readonly unknown[]).includes(v) ? v as AttachmentKind : null;
export const ATTACHMENT_SIDES: readonly AttachedSide[] = ["left", "right", "up", "down"];

/** The room a float is kept in: the reader's cells (its inner frame, offset when it has one). */
export type FloatRoom = { w: number; h: number; col?: number; row?: number };

/** What an open attachment keeps, owned by its kind (a comment session, the inspector, a card, a preview). */
export interface AttachedState {
  place: AttachedPlace;
  /** Where the person moved its float to; null: its usual place. */
  float: FloatRect | null;
  /** Where its float was last drawn, and the room it had (the layer writes these). */
  frame?: FloatRect | null;
  room?: FloatRoom;
}

/** The few things the layer needs from the reader it's in. */
export interface AttachmentHost {
  attachedTile?(kind: AttachmentKind, on: boolean, side?: AttachedSide, keys?: boolean): Promise<unknown>;
  hasAttachedTile?(kind: AttachmentKind): boolean;
  redraw(): void;
  ctx: { flash(text: string): void };
}

/** A drawn attachment's rows (a SurfaceView's shape, kept loose so the layer stays independent of the note surface). */
export interface AttachedView { lines: string[]; frame?: FloatRect; placements?: { row: number; col: number; rows: number; cols: number }[] }

/** One kind of attachment: its state, its drawing, its words. Placement, layering and tiles are the layer's. */
export interface AttachmentDef<H extends AttachmentHost = AttachmentHost, V extends AttachedView = AttachedView> {
  readonly kind: AttachmentKind;
  /** Its name in a float's frame and its tile's title (`sources`, `list children`). */
  readonly noun: string;
  /** Its state while it's open, else null. */
  owner(): AttachedState | null;
  /** Open and drawn in the reader now (beyond being open: a list preview gives way to a comment). Default: open. */
  shown?(host?: H): boolean;
  /** The state its tile follows (default: its owner). */
  tileOwner?(host?: H): AttachedState | null;
  /** Its rows in `cols` × `rows` cells at `row`, `col` of the reader (or of its tile, at 0, 0); null: nothing to draw. */
  draw(cols: number, rows: number, row: number, col: number, host: H | undefined, where: "split" | "float" | "tile"): V | null;
  /** Its float's smallest size, and the size it asks for in the room offered (`fill`: a moved float fills its rect). */
  readonly min?: { cols: number; rows: number };
  fit?(cols: number, rows: number, fill: boolean): { cols: number; rows: number };
  /** Its split when none was kept (default: beside when the reader is wide, else under it). */
  readonly split?: AttachedSplit;
  /** Rows a split below the note gives it (default: the split's share). */
  readonly splitRows?: number;
  /** The reader mode that takes its keys and its wheel (`panel` for settings), when it has one. */
  readonly mode?: string;
  /** It holds the reader's keys now: drawn on top, its frame lit, the pointer its first. */
  holdsKeys(): boolean;
  /** Its tile takes the person's keys when it opens. */
  tileKeys(): boolean;
  /** The state file its placement (and split) is kept in, for next time. */
  readonly persist?: string;
  /** Its own actions, which its keys, clicks and agents use: where it sits and moving its float. */
  readonly actions: { place: string; move: string };
  /** The refusal when it isn't open. */
  readonly closed: string;
  /** Where its `[place ▸]` chip is drawn, for the placement menu under it. */
  chip(): { col: number; row: number } | null;
  /** Its own refusal of a placement (the thread list only ever goes into a tile). */
  refuse?(want: AttachedPlace, side: AttachedSide | undefined, asked: string | undefined): string | null;
  /**
   * After it lands somewhere: its own follow-up (the keys to it, bringing it into view); `was`: where it sat before
   * (Sources back from its tile takes the keys the tile had, PIE-1545).
   */
  placed?(want: AttachedPlace, host: H, side: AttachedSide | undefined, was: AttachedPlace): void;
  /** Moving its float its own way (the comment's box is placed by its passage); default: the layer's. */
  move?(a: FloatMove, host: H): FloatRect | null;
}

/** A split drawn this frame: its divider is dragged to size it. */
export type SplitFrame = { target: AttachmentKind; beside: boolean; w: number; h: number; edge: number };

const CHIP = (place: AttachedPlace) => `[${place} ▸]`;

/** A reader's attachments: the open set, their placement, drawing, layering, splits and tiles. */
export class Attachments<H extends AttachmentHost = AttachmentHost, V extends AttachedView = AttachedView> {
  readonly splits = {} as Record<AttachmentKind, AttachedSplit>;
  private readonly tiles = {} as Record<AttachmentKind, AttachedTile>;
  private readonly defs = new Map<AttachmentKind, AttachmentDef<H, V>>();
  /** The splits drawn this frame, and the side of the last one (where a click lands in it). */
  splitDrawn: SplitFrame[] = [];
  besideRect: { x: number; y: number; w: number; h: number } | null = null;
  /** The floats drawn this frame, in paint order: the last is on top. */
  private floats: { target: AttachmentKind; rect: FloatRect }[] = [];

  constructor(defs: readonly AttachmentDef<H, V>[], private look: () => StyleValues | undefined = () => undefined) {
    for (const d of defs) this.register(d);
  }

  /** One more kind: its split is read back from where it was kept. */
  register(d: AttachmentDef<H, V>) {
    this.defs.set(d.kind, d);
    this.tiles[d.kind] = new AttachedTile();
    const kept = d.persist ? readState<{ split?: AttachedSplit }>(d.persist)?.split : undefined;
    this.splits[d.kind] ??= kept ?? { ...d.split };
  }

  def(kind: AttachmentKind): AttachmentDef<H, V> {
    const d = this.defs.get(kind);
    if (!d) throw new ActionRefused(`target is ${[...this.defs.keys()].join(", ")}`);
    return d;
  }
  kind(v: unknown): AttachmentKind {
    const k = attachmentKindOf(v);
    if (!k || !this.defs.has(k)) throw new ActionRefused(`target is ${[...this.defs.keys()].join(", ")}`);
    return k;
  }
  /** Its placement while it's open, else null. */
  place(kind: AttachmentKind): AttachedPlace | null { return this.defs.get(kind)?.owner()?.place ?? null; }
  private open(kind: AttachmentKind) {
    const d = this.def(kind), o = d.owner();
    if (!o) throw new ActionRefused(d.closed);
    return { d, o };
  }

  /** A new frame: nothing drawn yet. */
  begin() { this.splitDrawn = []; this.besideRect = null; this.floats = []; }

  // ── tiles ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Each kind's tile follows its attachment: opened when it goes to a tile, closed when it leaves or ends. */
  sync(host?: H) {
    for (const d of this.defs.values()) this.tiles[d.kind].sync(d.tileOwner ? d.tileOwner(host) : d.owner(), this.tileHost(d.kind, host));
  }
  tiled(host?: H): boolean { return !!host?.attachedTile; }
  tileHost(kind: AttachmentKind, host?: H): AttachedTileHost | undefined {
    if (!host?.attachedTile) return undefined;
    const d = this.def(kind);
    return {
      open: (on, side) => host.attachedTile!(kind, on, side, d.tileKeys()),
      ...(host.hasAttachedTile ? { exists: () => host.hasAttachedTile!(kind) } : {}),
      changed: why => { if (why) host.ctx.flash(why); host.redraw(); },
    };
  }
  /** Its tile closed (it ended). */
  close(kind: AttachmentKind, host?: H) { return this.tiles[kind].close(this.tileHost(kind, host)); }

  /**
   * Where it sits: `place`, or the next one round (with `side`, a tile on that side of its reader; a split takes `side`
   * right or down). Kept for next time where its kind keeps it.
   */
  async put(kind: AttachmentKind, place: string | undefined, host: H, side?: string): Promise<AttachedPlace> {
    const { d, o } = this.open(kind);
    if (side !== undefined && !ATTACHMENT_SIDES.includes(side as AttachedSide)) throw new ActionRefused(`side is left, right, up or down, not ${JSON.stringify(side)}`);
    const want = place === undefined ? (side !== undefined ? "tile" : nextPlace(o.place, this.tiled(host))) : attachedPlaceOf(place);
    if (!want) throw new ActionRefused(`place is ${ATTACHED_PLACES.join(", ")}, not ${JSON.stringify(place)}`);
    const own = d.refuse?.(want, side as AttachedSide | undefined, place);
    if (own) throw new ActionRefused(own);
    if (want === "tile" && !this.tiled(host)) throw new ActionRefused(`this reader has no tiles round it to put ${d.noun} in · ${d.actions.place} place=split shares the reader`);
    if (want === "split" && side) this.split(kind, side, undefined);
    const was = o.place;
    await this.tiles[kind].place(o, want, this.tileHost(kind, host), side as AttachedSide | undefined);
    d.placed?.(want, host, side as AttachedSide | undefined, was);
    this.keep(kind);
    host.redraw();
    return want;
  }

  private keep(kind: AttachmentKind) {
    const d = this.def(kind), place = d.owner()?.place;
    if (d.persist && place) writeState(d.persist, { place, split: this.splits[kind] });
  }

  /** Its split beside the note (`right`) or under it (`down`), and its share of the reader. */
  split(kind: AttachmentKind, direction: string | undefined, share: number | undefined) {
    if (direction !== undefined && direction !== "right" && direction !== "down") throw new ActionRefused("split direction is right or down");
    const split = this.splits[this.kind(kind)];
    if (direction) split.direction = direction;
    if (share !== undefined) split.share = Math.max(.15, Math.min(.85, share));
    this.keep(kind);
    return { ...split };
  }

  /** Its float moved or sized (`*.move`), kept in the reader. */
  move(kind: AttachmentKind, a: FloatMove, host: H): FloatRect | null {
    const { d, o } = this.open(kind);
    if (d.move) return d.move(a, host);
    if (o.place !== "floating" || !o.frame) throw new ActionRefused(`${d.actions.place} place=floating floats it first`);
    o.float = a.reset ? null : moveFloat(o.float ?? o.frame, a, o.room ?? { w: 0, h: 0 });
    host.redraw();
    return o.float;
  }

  // ── drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The kinds drawn in the reader as a split, a float or a popup, in the order they're laid: splits wrap the note first. */
  layered(host?: H): AttachmentKind[] {
    return [...this.defs.values()].filter(d => {
      const p = d.owner()?.place;
      return p && p !== "inline" && p !== "tile" && (d.shown ? d.shown(host) : true);
    }).map(d => d.kind);
  }

  /**
   * The reader with its attachments over `read` (the note, drawn `cols` × `rows`): each split shares the reader with
   * what's under it, then each float and popup is laid over the whole, the one holding the keys last.
   */
  compose(kinds: readonly AttachmentKind[], w: number, h: number, host: H | undefined, read: (cols: number, rows: number) => V, frame?: FloatRect, over?: (v: V) => V): V {
    let base = read;
    // The first kind's split is the outermost (Sources beside a note whose settings split it again).
    for (const k of [...kinds].reverse()) if (this.def(k).owner()?.place === "split") { const under = base; base = (cols, rows) => this.beside(cols, rows, (c, r, y, x) => this.def(k).draw(c, r, y, x, host, "split") ?? { lines: [] } as unknown as V, under, k); }
    let v = base(w, h);
    const floats = kinds.filter(k => { const p = this.def(k).owner()?.place; return p === "floating" || p === "popup"; });
    const top = floats.filter(k => this.def(k).holdsKeys());
    const rest = floats.filter(k => !top.includes(k));
    for (const k of rest) v = this.float(k, v, w, h, host, frame);
    if (over && !top.length) return over(v);
    if (over) v = over(v);
    for (const k of top) v = this.float(k, v, w, h, host, frame);
    return v;
  }

  /** One attachment floating (or a popup) over `v`, the reader's `w` × `h` cells (in `frame`, a tile's inner frame). */
  float(kind: AttachmentKind, v: V, w: number, h: number, host: H | undefined, frame?: FloatRect): V {
    const d = this.def(kind), o = d.owner()!;
    const rect = attachedRect(o.place, w, h, { frame, min: d.min ?? { cols: 24, rows: 6 }, moved: o.float }, d.fit && ((c, r, fill) => d.fit!(c, r, fill)));
    o.frame = rect;
    o.room = frame ? { w: frame.cols, h: frame.rows, col: frame.col, row: frame.row } : { w, h };
    this.floats.push({ target: kind, rect });
    const side: AttachedView = d.draw(rect.cols - 2, rect.rows - 2, rect.row + 1, rect.col + 1, host, "float") ?? { lines: [] };
    const floating = o.place === "floating";
    const lines = drawAttachedFloat(v.lines, w, h, rect, floating ? `${d.noun} · ≡ move` : d.noun, d.holdsKeys(), this.look(),
      (canvas, dx, dy) => side.lines.forEach((line, i) => canvas.text(rect.col + 1 + dx, rect.row + 1 + i + dy, line, rect.cols - 2)), floating, frame, v.frame);
    // A picture under the float isn't drawn while it's there; the float's own are.
    const under = (p: { row: number; col: number; rows: number; cols: number }) => p.row < rect.row + rect.rows && p.row + p.rows > rect.row && p.col < rect.col + rect.cols && p.col + p.cols > rect.col;
    return { ...v, frame, lines, placements: [...(v.placements ?? []).filter(p => !under(p)), ...(side.placements ?? [])] };
  }

  /** A float laid by its kind's own drawing (the comment's box, placed by its passage): counted in the pointer's order. */
  floated(kind: AttachmentKind, rect: FloatRect) { this.floats.push({ target: kind, rect }); }

  /**
   * The reader shared (a split): `read` in one part, `draw` in the other, beside it when the reader is wide (or the
   * split says right), else under it. With a `target` the divider is drawn and dragged (attachment.split).
   */
  beside(w: number, h: number, draw: (cols: number, rows: number, row: number, col: number) => AttachedView, read: (cols: number, rows: number) => V, target?: AttachmentKind): V {
    const rows = target && this.defs.get(target)?.splitRows;
    const rect = attachedRect("split", w, h, { split: target ? this.splits[target] : {}, ...(rows ? { rows } : {}) });
    if (rect.col > 0) {
      const cw = rect.cols, nw = rect.col - 1;
      if (target) this.splitDrawn.push({ target, beside: true, w, h, edge: nw });
      this.besideRect = { x: rect.col, y: rect.row, w: rect.cols, h: rect.rows };
      const v = read(nw, h), side = draw(cw, h, 0, nw + 1);
      return { ...v, lines: Array.from({ length: h }, (_, i) => pad(v.lines[i] ?? "", nw) + RESET + (target ? fg(C.dark) + "│" + RESET : " ") + (side.lines[i] ?? "")), placements: [...(v.placements ?? []), ...(side.placements ?? [])] };
    }
    const ch = rect.rows, nh = Math.max(0, rect.row - (target ? 1 : 0));
    if (target) this.splitDrawn.push({ target, beside: false, w, h, edge: nh });
    this.besideRect = { x: 0, y: nh + (target ? 1 : 0), w, h: ch };
    const v = read(w, nh), side = draw(w, ch, nh + (target ? 1 : 0), 0);
    const top = v.lines.slice(0, nh);
    while (top.length < nh) top.push("");
    return { ...v, lines: [...top, ...(target ? [fg(C.dark) + "─".repeat(w) + RESET] : []), ...side.lines], placements: [...(v.placements ?? []).filter(p => p.row < nh), ...(side.placements ?? [])] };
  }

  /** Its rows in a tile of its own, `w` × `h`; null when it isn't in one. */
  tile(kind: AttachmentKind, w: number, h: number, host?: H): V | null {
    const d = this.defs.get(kind);
    if (d?.owner()?.place !== "tile") return null;
    const v = d.draw(w, h, 0, 0, host, "tile");
    return v && { ...v, lines: Array.from({ length: h }, (_, i) => v.lines[i] ?? "") };
  }

  /** Its header row's `[place ▸]` chip, right-aligned over `text` in `cols`. */
  static chipped(text: string, place: AttachedPlace, cols: number): string {
    const chip = CHIP(place);
    return pad(text, Math.max(0, cols - chip.length)) + fg(C.lcyan) + chip + RESET;
  }

  // ── the pointer ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The float under `x`, `y`: the last painted wins, border and all. */
  at(x: number, y: number): AttachmentKind | null { return attachedAt(this.floats.filter(f => this.defs.get(f.target)?.owner()), x, y); }
  /** A press on a float's frame: its top edge moves it, its ◢ corner and edges size it (floating only). */
  grip(x: number, y: number): { target: AttachmentKind; zone: NonNullable<ReturnType<typeof frameZone>>; from: FloatRect } | null {
    const target = this.at(x, y);
    const o = target && this.def(target).owner();
    if (!target || !o || o.place !== "floating" || !o.frame) return null;
    const zone = frameZone(o.frame, x, y);
    return zone && { target, zone, from: o.frame };
  }
  /** A split's divider under `x`, `y`. */
  divider(x: number, y: number): SplitFrame | null { return this.splitDrawn.find(s => (s.beside ? x : y) === s.edge) ?? null; }
  /** The placements its menu offers: a tile only where the reader has tiles. */
  choices(host?: H): AttachedPlace[] { return ATTACHED_PLACES.filter(p => p !== "tile" || this.tiled(host)); }
}
