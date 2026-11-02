import type { DoorEvent, DoorOpen } from "@ep0ch/outline-core/door-open";
import type { Ctx, ViewEvent, Screen, ViewState } from "./app";
import { Trail, type Visit } from "./trail";
import { traceRequests } from "./surface/dispatch";

/** Local landings are immediate; select previews reach the service when the Trail counts them as read. */
export class OpenEvents {
  readonly trail = new Trail(v => this.qualify(v));
  private pending = new Map<string, { ctx: Ctx; timer: ReturnType<typeof setTimeout> }>();
  private readonly events: DoorOpen[] = [];
  private stop?: () => void;
  readonly hear = (e: ViewEvent) => { if (e.type === "door.open") this.trail.hear(e as unknown as DoorOpen); };
  start() {
    this.stop = traceRequests(r => {
      if (r.actor.kind !== "user" || !r.tile?.id) return;
      const what = (r.action === "reading.step" || /scroll/.test(r.action)) ? "scrolls" : /select|pick|cursor|ruler/.test(r.action) ? "selections" : r.action === "tile.focus" ? "returns" : null;
      if (what) this.trail.attend(r.tile.id, what);
    });
  }
  opened(event: DoorOpen, ctx: Ctx) {
    this.events.push(event); if (this.events.length > 500) this.events.shift();
    queueMicrotask(() => { for (const f of this.viewers) { try { f(event as unknown as ViewEvent); } catch { /* Subscribers own their errors. */ } } });
    if (event.method !== "select") this.deliver(event, ctx);
    else {
      const timer = setTimeout(() => { const v = this.trail.get(event.target.visit); if (v) this.qualify(v); else this.pending.delete(event.target.visit); }, this.trail.settings.linger * 1000);
      timer.unref?.(); this.pending.set(event.target.visit, { ctx, timer });
    }
  }
  private deliver(event: DoorOpen, ctx: Ctx) { this.post(event, ctx); }
  /** Any door kind onto the door event wire (`door.event`): `door.open` here, `door.hover` from the hover primitive. */
  post(event: DoorEvent, ctx: Ctx) {
    void ctx.board.request("door.event", { body: event }).catch(error => ctx.flash(`${event.kind} event: ${String(error)}`));
  }
  private qualify(v: Visit) {
    const pending = this.pending.get(v.open.target.visit); if (!pending) return;
    const read = !this.trail.skim(v);
    if (!read && v.left === undefined) return;
    clearTimeout(pending.timer); this.pending.delete(v.open.target.visit);
    if (read) this.deliver(v.open, pending.ctx);
  }
  last(tile: string) { return this.events.findLast(e => e.target.tile === tile); }
  since(at = 0) { return this.events.filter(e => e.at >= at); }
  close() { this.stop?.(); for (const p of this.pending.values()) clearTimeout(p.timer); this.pending.clear(); this.trail.flush(); }
  get seen() { return this.viewers.size > 1; }
  unseen() { this.shown = null; }
  private viewers = new Set<(e: ViewEvent) => void>([this.hear]);
  private shown: { screen: string; focus: string; layout: string; tiles: Map<string, string>; cursors: Map<string, string>; marks: string } | null = null;

  /** Hear every change to what the person sees. The first event is the whole state (`hello`). */
  subscribe(f: (e: ViewEvent) => void, s?: Screen): () => void {
    const state = s?.viewState?.() ?? null;
    f({ type: "hello", at: Date.now(), screen: s?.title ?? null, state });
    this.viewers.add(f);
    if (s && state && !this.shown) this.shown = this.snapshot(s.title, state);
    return () => { this.viewers.delete(f); };
  }

  private snapshot(screen: string, v: ViewState) {
    return { screen, focus: JSON.stringify(v.focus), layout: JSON.stringify(v.layout), tiles: new Map(v.tiles.map(t => [t.tile, JSON.stringify(t.viewport)] as const)), cursors: new Map(v.tiles.map(t => [t.tile, JSON.stringify(t.cursor ?? null)] as const)), marks: JSON.stringify(v.marks ?? null) };
  }

  /** After a paint: what changed since the last one, as events to every subscriber. */
  publishView(s: Screen) {
    if (!this.seen) { this.shown = null; return; }
    const v = s.viewState?.();
    const at = Date.now();
    const send = (e: Omit<ViewEvent, "at">) => { for (const f of this.viewers) { try { f({ ...e, at } as ViewEvent); } catch { /* a subscriber's own problem */ } } };
    if (!v) { if (this.shown?.screen !== s.title) send({ type: "screen", screen: s.title }); this.shown = { screen: s.title, focus: "", layout: "", tiles: new Map(), cursors: new Map(), marks: "" }; return; }
    const was = this.shown?.screen === s.title ? this.shown : null;
    const now = { screen: s.title, focus: JSON.stringify(v.focus), layout: JSON.stringify(v.layout), tiles: new Map<string, string>(), cursors: new Map<string, string>(), marks: JSON.stringify(v.marks ?? null) };
    if (this.shown && this.shown.screen !== s.title) send({ type: "screen", screen: s.title });
    if (was?.layout !== now.layout) send({ type: "layout.changed", layout: v.layout });
    if (was?.focus !== now.focus) send({ type: "focus.changed", ...v.focus });
    for (const t of v.tiles) {
      const vp = JSON.stringify(t.viewport), cu = JSON.stringify(t.cursor ?? null);
      now.tiles.set(t.tile, vp); now.cursors.set(t.tile, cu);
      if (was?.tiles.get(t.tile) !== vp) send({ type: "viewport", tile: t.tile, name: t.name, viewport: t.viewport });
      if (t.cursor !== undefined && was?.cursors.get(t.tile) !== cu) send({ type: "cursor", tile: t.tile, name: t.name, cursor: t.cursor });
    }
    if (was?.marks !== now.marks && v.marks !== undefined) send({ type: "marks.changed", marks: v.marks });
    this.shown = now;
  }

}
