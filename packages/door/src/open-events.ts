import type { DoorOpen } from "@ep0ch/outline-core/door-open";
import type { Ctx, ViewEvent, Screen, ViewState } from "./app";
import { Trail } from "./trail";
import { traceRequests } from "./surface/dispatch";

/** The local feed keeps its recent envelopes; the service receives the same object on its existing connection. */
export class OpenEvents {
  readonly trail = new Trail();
  private readonly events: DoorOpen[] = [];
  private stop?: () => void;
  readonly hear = (e: ViewEvent) => { if (e.type === "door.open") this.trail.hear(e as unknown as DoorOpen); };
  start() {
    this.stop = traceRequests(r => {
      if (!r.typed || !r.tile?.id) return;
      const what = /scroll/.test(r.action) ? "scrolls" : /select|pick|cursor|ruler/.test(r.action) ? "selections" : r.action === "tile.focus" ? "returns" : null;
      if (what) this.trail.attend(r.tile.id, what);
    });
  }
  opened(event: DoorOpen, ctx: Ctx) {
    this.events.push(event); if (this.events.length > 500) this.events.shift();
    queueMicrotask(() => { for (const f of this.viewers) { try { f(event as unknown as ViewEvent); } catch { /* Subscribers own their errors. */ } } });
    void ctx.board.request("door.open", { body: event }).catch(error => ctx.flash(`Open event: ${String(error)}`));
  }
  last(tile: string) { return this.events.findLast(e => e.target.tile === tile); }
  since(at = 0) { return this.events.filter(e => e.at >= at); }
  close() { this.stop?.(); this.trail.flush(); }
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
