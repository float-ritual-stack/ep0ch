// What placement remembers between opens (PIE-1778): the tile each tile's next open goes beside, and the tiles opened
// into each container (PIE-1641) with the one an open there lands in now. placement() reads it (Ctx.beside, Ctx.opened);
// the desk says where an open landed and forgets a tile once, as it leaves. Nothing else writes it.

/** A container's tiles opened into it, the one an open there lands in now, and the last number given. */
interface OpenedInto<I> { ids: I[]; active: I | null; count: number }

export class PlacementMemory<I = number> {
  /** The tile an open from each tile goes beside next: the detail opened beside a reader holding an edit, or beside a pinned one. */
  readonly beside = new Map<I, I>();
  /** Each container's record, by its key. */
  readonly opened = new Map<string, OpenedInto<I>>();

  /** Opens from tile `from` go beside tile `to` from now on. */
  goBeside(from: I, to: I): void { this.beside.set(from, to); }
  /** Container `key`'s record, made on its first open. */
  into(key: string): OpenedInto<I> { let r = this.opened.get(key); if (!r) this.opened.set(key, r = { ids: [], active: null, count: 0 }); return r; }
  /** The container tile `id` was opened into, if it was. */
  intoOf(id: I): string | undefined { for (const [k, r] of this.opened) if (r.ids.includes(id)) return k; return undefined; }
  /** The tiles opened into `key` that are still there (`live`), in `order` (the container's own), then those outside it (a float of one counts: it goes back). */
  tilesIn(key: string, order: readonly I[], live: (id: I) => boolean): I[] {
    const r = this.opened.get(key);
    if (!r) return [];
    r.ids = r.ids.filter(live);
    return [...r.ids.filter(id => order.includes(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b)), ...r.ids.filter(id => !order.includes(id))];
  }
  /** The tile an open into `key` lands in now, among `ids` (its tiles in place): the one last opened or given the keys there, else the last. */
  activeIn(key: string, ids: readonly I[]): I | undefined {
    const r = this.opened.get(key);
    return r?.active !== null && r?.active !== undefined && ids.includes(r.active) ? r.active : ids.at(-1);
  }
  /** Tile `id` left the screen: nothing here names it any more. */
  forget(id: I): void {
    for (const [k, v] of [...this.beside]) if (k === id || v === id) this.beside.delete(k);
    for (const r of this.opened.values()) { r.ids = r.ids.filter(i => i !== id); if (r.active === id) r.active = null; }
  }
}
