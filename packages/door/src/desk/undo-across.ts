// An undo across desks keeps the tiles that moved between them by identity (PIE-1559): a carry (to the glass, into the
// drawer), a gather into a group and a spill out of one are each one transaction on every desk they touched; undoing it
// rebuilds each desk's shape from before, and a tile those shapes name by its id (`t-…`) is the same instance put back,
// never a second one made by name. Desk applies it; the choices here are plain.
import { tileRegistry } from "./tile-registry";
import { specTileIds, type LayoutEntry } from "./layout-history";
import { savedNodes } from "./screen-spec";
import { ScreenTile } from "./screen-tile";
import type { Pane } from "./panes";
import type { TileSpec } from "./tiles";

/** What gives a claimed tile up: a desk being put back (`releaseTile`). */
export interface Releases { releaseTile(rid: string): Pane | undefined }
/** `claims`: the ids the shapes being put back name; `pool`: instances a rebuilt desk let go that another claims; `from`: the desks put back. */
export interface Adopt { claims: Set<string>; pool: Map<string, Pane>; from: Releases[] }
/** The desk rebuilding, as adoption reads it: its instances by layout id, their identities, and how one leaves it whole. */
export interface AdoptHost { self: Releases; panes: ReadonlyMap<number, Pane>; tileId(id: number): string; leave(id: number): void }

/**
 * The desks an undo puts back, in the order that keeps every instance: one holding a tile another's shape claims goes
 * first (its tile to the pool, its name free), and what they claim between them.
 */
export function undoOrder<D extends Releases>(plan: [D, LayoutEntry[]][], held: (d: D) => string[]): { plan: [D, LayoutEntry[]][]; adopt: Adopt } {
  const own = new Map(plan.map(([d, es]) => [d, new Set(es.flatMap(e => specTileIds(e.before)))]));
  const adopt: Adopt = { claims: new Set([...own.values()].flatMap(s => [...s])), pool: new Map(), from: plan.map(([d]) => d) };
  const gives = (d: D) => held(d).filter(id => adopt.claims.has(id) && !own.get(d)!.has(id)).length;
  return { plan: [...plan].sort(([a], [b]) => gives(b) - gives(a)), adopt };
}

/** The instance `rid` names for a desk being rebuilt: let go already (the pool), unused here, on another desk put back, or in a group this rebuild drops. */
export function adoptTile(rid: string, adopt: Adopt, host: AdoptHost, old: ReadonlyMap<number, Pane>, used: Set<number>): Pane | undefined {
  const pooled = adopt.pool.get(rid);
  if (pooled) { adopt.pool.delete(rid); return pooled; }
  for (const [x, q] of old) if (!used.has(x) && host.panes.get(x) === q && host.tileId(x) === rid) { used.add(x); host.leave(x); return q; }
  for (const d of adopt.from) { const p = d === host.self ? undefined : d.releaseTile(rid); if (p) return p; }
  for (const q of old.values()) { const p = q instanceof ScreenTile && q.group ? q.release(rid, x => tileRegistry.knownId(x)) : undefined; if (p) return p; }
  return undefined;
}

/** A group put back by an undo (a spill undone): its own tiles, the instances that spilled, given whole. */
export function groupWith(l: TileSpec, adopt: Adopt | undefined, host: AdoptHost, old: ReadonlyMap<number, Pane>, used: Set<number>): Pane | undefined {
  if (!adopt || l.kind !== "screen" || l.screen || !l.inner || typeof l.inner !== "object") return undefined;
  const given = new Map<string, Pane>();
  for (const n of savedNodes((l.inner as { root?: unknown }).root)) if (n.t === "leaf" && typeof n.id === "string" && typeof n.name === "string") { const p = adoptTile(n.id, adopt, host, old, used); if (p) given.set(n.name, p); }
  if (!given.size) return undefined;
  const g = new ScreenTile("screen", l, undefined, given);
  if (l.id) tileRegistry.restore(g, { id: l.id });   // the group keeps its identity: a wire or a reference to it still reaches it
  return g;
}
