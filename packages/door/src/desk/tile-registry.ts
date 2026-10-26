// The tile registry (PIE-1286): the one place a tile's identity lives. A record per tile says which tile it is, whatever its
// name, its screen or its program: its id (`t-<uuid>`, kept through moves, tabs, saves and restores), what it is for (its
// role), the tile that opened it and, for a copy, the tile it was copied from. A desk joins a pane to it as the pane is
// made or restored, the drawer when it makes its own program; the resolver (tile-address.ts) reads it; nothing else keeps
// which tile this is (not the pane, not a desk's name map, not the drawer). A terminal program's `tileId` is what it was told
// (EP0CH_TILE_ID) and, for the drawer's own, the key the terminal host keeps it under: they say what the program was
// given, and no address is decided from them but a caller naming its own tile by what it was told (`open from=`).
//
// A name is a label the layout keeps; a screen and a slot are where the layout put the tile. They change when a tile is
// renamed or moved; the record doesn't, so an address made of the record survives them.
import { tileKind } from "./tile-kinds";
import type { Pane } from "./panes";

/** What the registry keeps of a tile, and what a save writes of it (the leaf's `id`, `role`, `openedFrom`, `copiedFrom`). */
export interface TileRecord {
  /** `t-<uuid>`, minted the first time anything asks for it (a role set before that doesn't fix it). */
  id?: string;
  /** What the tile is for (`agent`, `reader`), set by what makes it; absent: its kind's (`roleOf`). */
  role?: string;
  /** The tile that opened it (its id): what `^` follows, and where the keys go back when a program's tile closes. */
  openedFrom?: string;
  /** The tile this one was copied from (its id), when a saved arrangement was copied and the copy got fresh ids. */
  copiedFrom?: string;
}

const records = new WeakMap<Pane, TileRecord>();
/** Each door's index from id to pane, so a layout loaded twice finds an id already held. */
const doors = new WeakMap<object, Map<string, WeakRef<Pane>>>();
/** The door a pane was claimed in, so a pane that is gone can leave its index. */
const homes = new WeakMap<Pane, object>();

const record = (pane: Pane): TileRecord => {
  let r = records.get(pane);
  if (!r) { r = {}; records.set(pane, r); }
  return r;
};

export const tileRegistry = {
  /** The tile's id, minted the first time it is asked for. */
  idOf: (pane: Pane): string => (record(pane).id ??= `t-${crypto.randomUUID()}`),
  /** The tile's id if it has one yet (asking never mints it). */
  knownId: (pane: Pane): string | undefined => records.get(pane)?.id,
  /** What the tile is for: the role it was made with, else its kind's, else the kind's name. */
  roleOf: (pane: { kind: string }): string => records.get(pane as Pane)?.role ?? tileKind(pane.kind)?.role ?? pane.kind,
  /** The role the tile was made with, if one was set (not its kind's): a place a restarted tile fills again. */
  ownRole: (pane: Pane): string | undefined => records.get(pane)?.role,
  setRole(pane: Pane, role: string | undefined) { if (role === undefined) { const r = records.get(pane); if (r) delete r.role; } else record(pane).role = role; },
  /** The tile that opened it (its id), if one is recorded. */
  openerOf: (pane: Pane): string | undefined => records.get(pane)?.openedFrom,
  setOpener(pane: Pane, opener: string | undefined) { if (opener === undefined) { const r = records.get(pane); if (r) delete r.openedFrom; } else record(pane).openedFrom = opener; },
  copiedFrom: (pane: Pane): string | undefined => records.get(pane)?.copiedFrom,
  /** What a save writes of the tile's record besides its id. */
  saved(pane: Pane): Pick<TileRecord, "role" | "openedFrom" | "copiedFrom"> {
    const r = records.get(pane);
    return { ...(r?.role ? { role: r.role } : {}), ...(r?.openedFrom ? { openedFrom: r.openedFrom } : {}), ...(r?.copiedFrom ? { copiedFrom: r.copiedFrom } : {}) };
  },
  /** A saved arrangement comes back: the tile keeps its saved id (when it has none yet and it is an id), role, opener and lineage. */
  restore(pane: Pane, saved: { id?: string; role?: string; openedFrom?: string; copiedFrom?: string }) {
    const r = record(pane);
    if (!r.id && saved.id?.startsWith("t-")) r.id = saved.id;
    if (saved.role) tileRegistry.setRole(pane, saved.role);
    if (saved.openedFrom) tileRegistry.setOpener(pane, saved.openedFrom);
    if (saved.copiedFrom) record(pane).copiedFrom = saved.copiedFrom;
  },
  /**
   * `panes` are in `door` now: a pane whose id another live pane of the door holds (a saved arrangement loaded twice) gets a
   * fresh id and remembers the one it was copied from. Answers what changed (old id to new id), for the references to it.
   */
  claim(door: object, panes: Iterable<Pane>): Map<string, string> {
    let used = doors.get(door);
    if (!used) { used = new Map(); doors.set(door, used); }
    const remapped = new Map<string, string>();
    for (const pane of panes) {
      const before = tileRegistry.idOf(pane), other = used.get(before)?.deref();
      if (other && other !== pane) {
        const r = record(pane);
        r.copiedFrom = before;
        r.id = `t-${crypto.randomUUID()}`;
        remapped.set(before, r.id);
      }
      used.set(tileRegistry.idOf(pane), new WeakRef(pane));
      homes.set(pane, door);
    }
    return remapped;
  },
  /** The pane is gone for good (closed, or its desk disposed): its id no longer names a pane in its door. */
  release(pane: Pane) {
    const door = homes.get(pane), id = records.get(pane)?.id;
    if (door && id && doors.get(door)?.get(id)?.deref() === pane) doors.get(door)!.delete(id);
    homes.delete(pane);
  },
  /** A pane is made again in the same tile (its kind came or went): the new pane is that tile, same id, role and opener. */
  replace(from: Pane, to: Pane) {
    const r = records.get(from);
    if (!r) return;
    records.set(to, r); records.delete(from);
    const door = homes.get(from);
    if (door && r.id) { doors.get(door)?.set(r.id, new WeakRef(to)); homes.set(to, door); homes.delete(from); }
  },
  /** The pane with id `id` in `door`, if it is still there. */
  paneIn: (door: object | undefined, id: string): Pane | undefined => (door ? doors.get(door)?.get(id)?.deref() : undefined),
  /** The opener references of `panes` follow ids that were remapped. */
  followRemap(panes: Iterable<Pane>, remapped: Map<string, string>) {
    for (const pane of panes) { const up = records.get(pane)?.openedFrom; if (up !== undefined && remapped.has(up)) tileRegistry.setOpener(pane, remapped.get(up)); }
  },
};
