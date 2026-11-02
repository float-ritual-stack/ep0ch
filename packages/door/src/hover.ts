// The hover primitive (PIE-1505, docs/adr/0008-extension-first.md): what is under the pointer, for whoever listens. Core
// owns the pointer and the rules every listener needs: no hover while a mouse button is down (a drag of an edge, a
// title, a selection; #1176) and none over chrome (the drawer's bar, hint rows, the status bar belong to no tile), and
// the list a pointer is over lights up. Listeners hear every distinct move in process (`subscribe`); once the pointer
// rests on a target, a `door.hover` envelope goes out on the door event wire (`door.event`, beside `door.open`), so an
// extension program or a rule hears it too (`events.subscribe kinds=["door.hover"]`, `on.events`). What a hover does
// is the listener's: the glass extension (packages/door/ext/glass) is the first.
import type { DoorHover } from "@ep0ch/outline-core/door-open";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import type { App } from "./app";
import type { Rect } from "./canvas";
import type { AgentDrawer } from "./drawer";
import type { Desk } from "./desk/desk";
import type { LinkTarget } from "./refs";
import type { ListView } from "./surface/list-view";
import type { Key } from "./term";

export type Point = { x: number; y: number; alt: boolean };
/** A tile's answer to "what is at this cell": a link's target, a cut-off title's text, the list the cell is in. */
export interface HoverHit { desk: Desk; tile: string; target?: LinkTarget; collection?: ListView; text?: string; rect: Rect }
/** One distinct pointer move, as a listener hears it: where, where before, and what is under it (null: nothing, or chrome). */
export interface HoverMove { point: Point; before: Point | null; hit: HoverHit | null }
export interface HoverListener {
  /** The pointer moved with no button down. */
  moved?(m: HoverMove): void;
  /** A button went down (or a drag moved): whatever was about to open waits for the next move. */
  pressed?(point: Point | null): void;
}

export const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.col && p.x < r.col + r.cols && p.y >= r.row && p.y < r.row + r.rows;
/** How long the pointer rests on a target before `door.hover` goes out on the wire (ms): a sweep across links sends nothing. */
export const HOVER_REST_MS = 300;

/** The wire envelope for a hit: the tile, the note a block target names, the link and the words. */
export function hoverEnvelope(hit: HoverHit, at = Date.now()): DoorHover | null {
  const t = hit.target;
  const link = t ? Object.fromEntries(Object.entries({ block: t.block, page: t.page, outline: t.outline, machine: t.machine, url: t.url }).filter(([, v]) => v !== undefined)) as DoorHover["link"] : undefined;
  if (!t && !hit.text) return null;
  const note = t?.block && BLOCK_ID_PATTERN.test(t.block) && !t.outline ? t.block : undefined;
  return { kind: "door.hover", at, actor: { kind: "user" }, target: { tile: hit.tile, ...(note ? { note } : {}) }, method: "pointer", ...(link && Object.keys(link).length ? { link } : {}), ...(hit.text ? { text: hit.text } : {}) };
}
const keyOf = (e: DoorHover) => JSON.stringify([e.target.tile, e.link ?? null, e.text ?? null]);

export class Hover {
  pointer: Point | null = null;
  /** A mouse button is down: no hover resolves until a report with no button comes. */
  private held = false;
  private collection: ListView | undefined;
  private readonly listeners = new Set<HoverListener>();
  private resting: ReturnType<typeof setTimeout> | null = null;
  private sent = "";

  constructor(private readonly app: App, private readonly host: AgentDrawer) {}

  /** Hear every distinct move and every press; answers the function that stops it. */
  subscribe(l: HoverListener): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  /** Every button report, before it is routed (App.route): a button down holds hover until it comes up. */
  mouse(k: Extract<Key, { kind: "mouse" }>) {
    if (k.action === "down") this.pointer = { x: k.x, y: k.y, alt: !!((k.mods ?? 0) & 8) };
    if (k.action === "down" || k.action === "drag") { this.held = true; this.rest(null); for (const l of this.listeners) l.pressed?.(this.pointer); }
    else if (k.action === "up") this.held = false;
  }

  /** A hover report (the pointer action's): a move with no button down releases the hold. */
  motion(x: number, y: number, alt = false) {
    const point = { x, y, alt }, before = this.pointer, held = this.held;
    this.pointer = point; this.held = false;
    if (held || before && before.x === x && before.y === y && before.alt === alt) return;
    const hit = this.hitAt(point);
    if (hit?.collection !== this.collection) {
      if (this.collection) this.collection.hovered = false;
      if (hit?.collection) hit.collection.hovered = true;
      this.collection = hit?.collection;
      this.app.redraw();
    }
    this.rest(hit);
    for (const l of this.listeners) l.moved?.({ point, before, hit });
  }

  /**
   * What is under `point` now. Inside the open drawer, the screen under it is covered: only the host desk answers there,
   * unless a float or menu of the screen is drawn over that cell (the drawer's own layer answer, `covers`). Chrome
   * belongs to no tile, so it never answers: a tile's content and its title are the targets.
   */
  hitAt(point: { x: number; y: number }): HoverHit | null {
    const floats = this.host.made?.floatingTiles() ?? [];
    const over = floats.findLast(f => inside(point, f.rect));
    const inDrawer = !over && this.host.shown && this.host.rect && inside(point, this.host.rect) && !this.host.coveredAt(point.x, point.y);
    const desks = over || inDrawer ? [this.host.made!] : this.host.desks().filter(d => !this.host.isDrawer(d));
    return desks.map(d => d.hoverAt(point.x - d.screenOrigin.col, point.y - d.screenOrigin.row)).find(Boolean) ?? null;
  }

  /** The wire: one `door.hover` per target the pointer rests on, never a sweep's every link. */
  private rest(hit: HoverHit | null) {
    if (this.resting) clearTimeout(this.resting);
    this.resting = null;
    const e = hit && hoverEnvelope(hit);
    if (!e) { this.sent = ""; return; }
    const key = keyOf(e);
    if (key === this.sent) return;
    this.resting = setTimeout(() => {
      this.resting = null; this.sent = key;
      this.app.openEvents.post({ ...e, at: Date.now() }, this.app);
    }, HOVER_REST_MS);
    this.resting.unref?.();
  }

  dispose() { if (this.resting) clearTimeout(this.resting); this.resting = null; this.listeners.clear(); }
}
