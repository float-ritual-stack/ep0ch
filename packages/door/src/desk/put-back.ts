// A desk puts a tile back (PIE-1559, PIE-1592): a tile that moved between desks is the same instance when its step is taken
// back, never a second one made by name. The step record says which desks and in what order; these are the tile's own moves.
import { tileRegistry } from "./tile-registry";
import { savedNodes } from "./screen-spec";
import { ScreenTile } from "./screen-tile";
import type { Pane } from "./panes";
import type { TileSpec } from "./tiles";

/** What gives a claimed tile up: a desk being put back (`releaseTile`). */
export interface Releases { releaseTile(rid: string): Pane | undefined }
/** `claims`: the ids the shapes being put back name; `pool`: instances a rebuilt desk let go that another claims; `from`: the desks put back; `kept`: tiles a rebuild kept in a dock for the work they hold, in words (PIE-1571). */
export interface Adopt { claims: Set<string>; pool: Map<string, Pane>; from: Releases[]; kept: string[] }
/** The desk rebuilding, as adoption reads it: its instances by layout id, their identities, and how one leaves it whole. */
export interface AdoptHost { self: Releases; panes: ReadonlyMap<number, Pane>; tileId(id: number): string; leave(id: number): void }

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
