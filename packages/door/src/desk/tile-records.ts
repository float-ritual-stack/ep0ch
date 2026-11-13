// One record per tile on a desk (PIE-1781): what this desk keeps about a tile beyond its instance, by tile number, so a
// tile that leaves takes it all with it in one step (`drop`). What travels with a tile when it's carried lives on the
// pane or in tile-registry.ts; what other owners hold about it (selection, the keys record, a gesture) is each owner's
// own `forget`. outOfStep checks that no record outlives its tile.
import type { TileSpec } from "./tiles";

export interface TileRecord {
  /** A kind nobody registers here (an extension not loaded yet): its spec, kept as saved. */
  unregistered?: TileSpec;
  /** A columns container's source supplied it: which container, which source, and its key there. */
  sourced?: { columns: string; source: string; key: string };
  /** Moved here whole (from the drawer): when this screen goes for good, one still running goes back. */
  movedIn?: true;
  /** The select source a saved layout gave it that isn't a tile here (a container, a tile still to come). */
  seed?: string;
}

/** One field of every record, read and written as a map by tile number (what the desk's code reads). */
export class RecordField<K extends keyof TileRecord> {
  constructor(private readonly recs: TileRecords, private readonly key: K) {}
  get(id: number): TileRecord[K] | undefined { return this.recs.get(id)?.[this.key]; }
  has(id: number): boolean { return this.get(id) !== undefined; }
  set(id: number, value: NonNullable<TileRecord[K]>): this { this.recs.of(id)[this.key] = value; return this; }
  delete(id: number): boolean { const r = this.recs.get(id); const had = r?.[this.key] !== undefined; if (r) delete r[this.key]; return had; }
  clear(): void { for (const [id] of this.entries()) this.delete(id); }
  keys(): number[] { return this.entries().map(([id]) => id); }
  entries(): [number, NonNullable<TileRecord[K]>][] { return this.recs.all().flatMap(([id, r]) => (r[this.key] !== undefined ? [[id, r[this.key] as NonNullable<TileRecord[K]>]] : [])); }
  [Symbol.iterator](): IterableIterator<[number, NonNullable<TileRecord[K]>]> { return this.entries()[Symbol.iterator](); }
}

/** A movedIn flag read as a set of tile numbers. */
export class RecordFlag {
  constructor(private readonly recs: TileRecords) {}
  has(id: number): boolean { return !!this.recs.get(id)?.movedIn; }
  add(id: number): this { this.recs.of(id).movedIn = true; return this; }
  delete(id: number): boolean { const r = this.recs.get(id), had = !!r?.movedIn; if (r) delete r.movedIn; return had; }
  [Symbol.iterator](): IterableIterator<number> { return this.recs.all().filter(([, r]) => r.movedIn).map(([id]) => id)[Symbol.iterator](); }
}

export class TileRecords {
  private readonly m = new Map<number, TileRecord>();
  get(id: number): TileRecord | undefined { return this.m.get(id); }
  /** Tile `id`'s record, made the first time something is kept about it. */
  of(id: number): TileRecord { let r = this.m.get(id); if (!r) this.m.set(id, r = {}); return r; }
  /** Tile `id` left this desk: nothing here is kept about it. */
  drop(id: number): void { this.m.delete(id); }
  all(): [number, TileRecord][] { return [...this.m]; }
  field<K extends Exclude<keyof TileRecord, "movedIn">>(key: K): RecordField<K> { return new RecordField(this, key); }
  flag(): RecordFlag { return new RecordFlag(this); }
}
