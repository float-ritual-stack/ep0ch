// What a tool's bookkeeping write can reach among the watched questions (PIE-1546). Write-review records, health
// samples and install stamps carry `[machine::…]` and came about once a second on pie; each one evaluated every watched
// question again, and the door's reads queued behind those passes for seconds. A question that leaves machinery out
// (every reader's default, PIE-867) can't see a stamped note, so QueryWatches skips it for such a change unless the
// note is one it lists or names: this says which questions those are, and whether a change was to a stamped note.
import { DEFAULT_MACHINERY, isMachinery } from "@ep0ch/outline-core/machinery";
import { normalizeBlockSearchQuery } from "./block-query";
import type { ChangedNotes } from "./query-watches";
import type { OutlinerStore } from "./store";
import type { BlockSearchQuery, OutlinerResponse } from "./types";
import { parseVirtualBranchConfig, virtualBranchMembershipQuery } from "./virtual-branches";

/** A committed change, with whether its note carries `[machine::…]` after it. */
export function machineryChange(store: Pick<OutlinerStore, "get">, change: ChangedNotes | undefined): ChangedNotes | undefined {
  if (!change?.blockId) return change;
  const block = store.get(change.blockId);
  return { ...change, machinery: !!block && isMachinery(block.properties) };
}

/**
 * When a watched question leaves machinery out, the notes a stamped note's change could still reach it through: the
 * ones its answer lists (and so their children: a change names its parent) and the ones it names. Undefined when it
 * may hold a stamped note, or counts the ones it left out (`machineryHidden`, `machineryLeftOut`: that count moves with
 * them). `blocks.query` (a script line's too) and `views.read` say; the other watched reads are evaluated after every
 * change, as before.
 */
export function machineryBlind(store: Pick<OutlinerStore, "get">, request: Record<string, unknown>, response: OutlinerResponse): ReadonlySet<string> | undefined {
  if (!response.ok || !response.result || typeof response.result !== "object") return undefined;
  const result = response.result as { blocks?: { id?: unknown }[]; machineryHidden?: unknown; machineryLeftOut?: unknown };
  if (!Array.isArray(result.blocks) || result.machineryHidden !== undefined || result.machineryLeftOut !== undefined) return undefined;
  const named: unknown[] = [];
  try {
    if (request.action === "blocks.query") {
      const query = request.query as BlockSearchQuery | undefined;
      if (!query || typeof query !== "object" || query.countMachinery) return undefined;
      // The question as the service answers it: one that names `machine` in its own clauses holds stamped notes.
      if (normalizeBlockSearchQuery({ ...query, machinery: query.machinery ?? DEFAULT_MACHINERY }).machinery !== "hide") return undefined;
      named.push((query as { this?: unknown }).this, query.subtreeRootId);
    } else if (request.action === "views.read") {
      const viewId = request.viewId;
      const definition = typeof viewId === "string" ? store.get(viewId) : null;
      const config = definition ? parseVirtualBranchConfig(definition, []).config : undefined;
      if (!config || normalizeBlockSearchQuery(virtualBranchMembershipQuery(viewId as string, config, 1)).machinery !== "hide") return undefined;
      named.push(viewId);
    } else return undefined;
  } catch {
    return undefined;
  }
  const ids = new Set<string>();
  for (const id of [...named, ...result.blocks.map(block => block?.id)]) if (typeof id === "string" && id) ids.add(id);
  return ids;
}
