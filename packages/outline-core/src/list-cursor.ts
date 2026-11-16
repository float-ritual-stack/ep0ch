// Where the keys move a cursor: one row of a list, and one tile of a screen. Pure rules every door asks, so a list's
// j and PgDn, a tree's ← on a folded row and Tab between tiles land on the same row and the same tile in each client.
// The terminal door's lists and desk ask these (`scroll.ts`'s `listMove`, the tree's `parentRow`, the desk's
// `tabStops`); the native window ports them once (`cursor.rs`), held row for row by `fixtures/core-contract.json`.

/**
 * Rows PgUp and PgDn move, everywhere: the view's rows less one, so the row at the edge stays in sight across the turn
 * (as less and vim do); at least one. A list moves its cursor by this many rows, a reader or a preview scrolls by it.
 */
export const pageRows = (room: number) => Math.max(1, Math.floor(room) - 1);

/** One step of a list's cursor: a number of rows, a page up or down, or an end. */
export type CursorStep = { by: number } | { page: 1 | -1 } | { edge: "first" | "last" };

/**
 * Where a step moves a list's cursor: `at` of `n` rows (-1: on no row yet), in a view of `room` rows. Kept within the
 * rows there are; a list with none leaves it where it was.
 */
export function cursorStepped(step: CursorStep, o: { at: number; n: number; room: number }): number {
  if (!o.n) return o.at;
  const by = "by" in step ? step.by : "page" in step ? step.page * pageRows(o.room) : step.edge === "first" ? -Infinity : Infinity;
  return Math.max(0, Math.min(o.n - 1, o.at + by));
}

/** The row a tree's row is under: the nearest row above it that is less deep. -1: it is under none. */
export function parentRow(depths: readonly number[], at: number): number {
  const d = depths[at] ?? 0;
  for (let i = Math.min(at, depths.length) - 1; i >= 0; i--) if (depths[i]! < d) return i;
  return -1;
}

/** A tile shown, and the container it counts as one stop with: the nearest set of columns or dock it is in, by its id. */
export type ShownTile<T> = { id: T; in?: string; columns?: boolean };

/**
 * Where Tab stops, in reading order: each tile shown, then the floats. A set of columns (a board's lanes) is one
 * stop: the tile with the keys when it is in them, else the tile last used there (`last`), else their first. A dock
 * is one stop: the tile with the keys when it is in it, else its first.
 */
export function tabStops<T>(shown: readonly ShownTile<T>[], focus: T, last: (key: string) => T | undefined, floats: readonly T[]): T[] {
  const out: T[] = [], seen = new Set<string>();
  for (const tile of shown) {
    if (tile.in === undefined) { out.push(tile.id); continue; }
    if (seen.has(tile.in)) continue;
    seen.add(tile.in);
    const ids = shown.filter(other => other.in === tile.in).map(other => other.id), at = tile.columns ? last(tile.in) : undefined;
    out.push(ids.includes(focus) ? focus : at !== undefined && ids.includes(at) ? at : ids[0]!);
  }
  return [...out, ...floats];
}

/** The stop `by` stops on from `at`, round the ends. A tile that is no stop counts from before the first. */
export function nextStop<T>(stops: readonly T[], at: T, by: number): T | undefined {
  if (!stops.length) return undefined;
  const i = stops.indexOf(at);
  return stops[((i + by) % stops.length + stops.length) % stops.length];
}
