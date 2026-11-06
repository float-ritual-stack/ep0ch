// Whole-outline questions without walking the outline (PIE-1610): who could match, from the property index, and those few
// in the outline's order. One graph's answers are kept with it; a write makes a new graph, so nothing here goes stale.
import { Database } from "bun:sqlite";
import { propertyCandidates } from "@ep0ch/outline-core/query-expression";
import type { Block, PropertyFilter, QueryExpression } from "./types";

// Bun keeps the first 20 statements a connection prepares and prepares every other again per call: 7% of a pie host's time
// after a restart, at 8× a read on float-box. The store's own SQL is a few hundred fixed strings.
(Database as unknown as { MAX_QUERY_CACHE_SIZE: number }).MAX_QUERY_CACHE_SIZE = 1_000;

/** The part of the store's graph these read. */
interface Graph { byId: ReadonlyMap<string, Block>; byParent: ReadonlyMap<string | null, readonly Block[]> }

type Place = { at: number; depth: number };
const liveOrders = new WeakMap<Graph, Map<string, Place>>();
const carriersByGraph = new WeakMap<Graph, Map<string, ReadonlySet<string>>>();

/** Every live block's place in outline order and its depth: what a walk of the graph would meet, once per graph. */
function liveOrder(graph: Graph): Map<string, Place> {
  const known = liveOrders.get(graph);
  if (known) return known;
  const places = new Map<string, Place>();
  const walk = (block: Block, depth: number): void => {
    if (block.effectiveDeletedRootId) return;
    places.set(block.id, { at: places.size, depth });
    for (const child of graph.byParent.get(block.id) ?? []) walk(child, depth + 1);
  };
  for (const root of graph.byParent.get(null) ?? []) walk(root, 0);
  liveOrders.set(graph, places);
  return places;
}

/** The live blocks of `ids` in outline order, each with its depth. */
export function inLiveOrder(graph: Graph, ids: ReadonlySet<string>): { block: Block; depth: number }[] {
  const places = liveOrder(graph);
  const found: { block: Block; at: number; depth: number }[] = [];
  for (const id of ids) {
    const place = places.get(id);
    if (place) found.push({ block: graph.byId.get(id)!, ...place });
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * The blocks a question could hold for, by the property index: a walk of the outline asks the predicate of these only.
 * Rows in any scope, so this holds every match and a few more; undefined when a clause isn't about a key.
 */
export function queryCandidates(database: Database, graph: Graph, filters: readonly PropertyFilter[] | undefined, where: QueryExpression | undefined, now?: number): ReadonlySet<string> | undefined {
  const parts: QueryExpression[] = [
    ...(filters ?? []).map((filter): QueryExpression => ({ kind: "property", key: filter.key, ...(filter.value === undefined ? {} : { value: filter.value }) })),
    ...(where ? [where] : []),
  ];
  if (!parts.length) return undefined;
  let known = carriersByGraph.get(graph);
  if (!known) carriersByGraph.set(graph, known = new Map());
  const held = known;
  const carriers = (key: string, value?: string): ReadonlySet<string> => {
    // What a value test holds for is an item of it, in any case: its text is in the row's, and SQLite's lower() only knows ASCII.
    const wanted = value?.trim().toLowerCase().replace(/\/\*$/, "");
    const needle = wanted && /^[\x00-\x7f]+$/.test(wanted) ? wanted : undefined;
    const name = needle === undefined ? key : `${key}\0${needle}`;
    let ids = held.get(name);
    if (!ids) {
      // `tag` and `tags` are one key to a filter (`matchesFilters`).
      const keys = key === "tag" ? ["tag", "tags"] : [key];
      const rows = keys.flatMap(one => (needle === undefined
        ? database.query("SELECT block_id AS id FROM block_properties WHERE scope IN ('block', 'line', 'inline') AND key = ?").all(one)
        : database.query("SELECT block_id AS id FROM block_properties WHERE scope IN ('block', 'line', 'inline') AND key = ? AND instr(lower(value), ?) > 0").all(one, needle)) as { id: string }[]);
      held.set(name, ids = new Set(rows.map(row => row.id)));
    }
    return ids;
  };
  return propertyCandidates({ kind: "and", operands: parts }, carriers, now) ?? undefined;
}

/**
 * A note's place and revision and its children's order, what a read of it structurally depends on. Asked of every dep of
 * every value-reading note after each change: its columns, never its hydrated note and children.
 */
export function structuralVersion(database: Database, id: string): string {
  const block = database.query("SELECT revision, parent_id, position, effective_deleted_root_id FROM blocks WHERE id = ?").get(id) as { revision: number; parent_id: string | null; position: number; effective_deleted_root_id: string | null } | null;
  const children = database.query("SELECT id FROM blocks WHERE parent_id IS ? AND effective_deleted_root_id IS NULL ORDER BY position, created_at").all(id) as { id: string }[];
  return JSON.stringify([block?.revision, block?.parent_id, block?.position, block?.effective_deleted_root_id, children.map(child => child.id)]);
}
