// What a tool's bookkeeping write can reach among the watched questions (PIE-1546). Write-review records, health
// samples and install stamps carry `[machine::…]` and came about once a second on pie; each one evaluated every watched
// question again, and the door's reads queued behind those passes for seconds. A question that leaves machinery out
// (every reader's default, PIE-867) can't see a stamped note, so QueryWatches skips it for such a change unless the
// note is one it lists or names: this says which questions those are, and whether a change was to a stamped note.
import { DEFAULT_MACHINERY, isMachinery } from "@ep0ch/outline-core/machinery";
import { isMachineryBlindRead } from "./actions";
import { normalizeBlockSearchQuery, queryReach } from "./block-query";
import type { ChangedNotes, QueryWatches } from "./query-watches";
import type { OutlinerStore } from "./store";
import type { BlockSearchQuery, OutlinerEvent, OutlinerResponse } from "./types";
import { parseVirtualBranchConfig, virtualBranchMembershipQuery } from "./virtual-branches";

/** Which notes are stamped, as of each one's last change: a stamp put on or taken off is a change anyone may see. */
const seen = new WeakMap<object, Map<string, boolean>>();

/**
 * A committed change, with whether it stays among stamped notes: its note carries `[machine::…]` after it and did
 * before. A note stamped or unstamped by the change moves in or out of what a question that hides machinery lists and
 * counts, so that change is an ordinary one. What was stamped before is known from the outline as it was at the first
 * change this service saw (one read of its notes) and every change since; the first change's own note counts as plain.
 */
export function machineryChange(store: Pick<OutlinerStore, "get" | "liveBlocks">, change: ChangedNotes | undefined): ChangedNotes | undefined {
  if (!change?.blockId) return change;
  const block = store.get(change.blockId), now = !!block && isMachinery(block.properties);
  let known = seen.get(store);
  if (!known) {
    seen.set(store, known = new Map());
    for (const note of store.liveBlocks()) if (note.id !== change.blockId && isMachinery(note.properties)) known.set(note.id, true);
  }
  const before = known.get(change.blockId);
  known.set(change.blockId, now);
  // A create had no before: a new stamped note was never visible. A trash or a restore takes the note's whole subtree
  // along, ordinary children too: a change anyone may see (PIE-1546 review).
  const kind = (change as { kind?: string }).kind;
  if (kind === "delete" || kind === "restore" || kind === "purge") return { ...change, machinery: false };
  return { ...change, machinery: now && (kind === "create" || before === true) };
}

/** A question about other notes (`child:`, `links:`, `under:`, `parent:`…): a stamped note can change which notes it holds. */
const readsAcross = (query: { predicate?: Parameters<typeof queryReach>[0] }) => queryReach(query.predicate).open;

/**
 * A `blocks.query` or `views.read` that leaves machinery out, as the service answers it: the notes it names (its `this`,
 * subtree root or view). Undefined when it may hold a stamped note (it names `machine`, shows or counts machinery, reads
 * other notes) or isn't one of those reads.
 */
function questionOf(store: Pick<OutlinerStore, "get">, request: Record<string, unknown>): unknown[] | undefined {
  try {
    if (request.action === "blocks.query") {
      const query = request.query as BlockSearchQuery | undefined;
      if (!query || typeof query !== "object" || query.countMachinery) return undefined;
      // The question as the service answers it: one that names `machine` in its own clauses holds stamped notes.
      const normal = normalizeBlockSearchQuery({ ...query, machinery: query.machinery ?? DEFAULT_MACHINERY });
      if (normal.machinery !== "hide" || readsAcross(normal)) return undefined;
      return [(query as { this?: unknown }).this, query.subtreeRootId];
    }
    if (request.action === "views.read") {
      const viewId = request.viewId;
      const definition = typeof viewId === "string" ? store.get(viewId) : null;
      const config = definition ? parseVirtualBranchConfig(definition, []).config : undefined;
      const normal = config && normalizeBlockSearchQuery(virtualBranchMembershipQuery(viewId as string, config, 1));
      if (!normal || normal.machinery !== "hide" || readsAcross(normal)) return undefined;
      return [viewId];
    }
  } catch { /* a question that doesn't read: as one that may hold anything */ }
  return undefined;
}

/**
 * When a watched question leaves machinery out, the notes a stamped note's change could still reach it through: the
 * ones its answer lists (and so their children: a change names its parent) and the ones it names. Undefined when it
 * may hold a stamped note, or counts the ones it left out (`machineryHidden`, `machineryLeftOut`: that count moves with
 * them). `blocks.query` (a script line's too) and `views.read` say, and a read whose actions.ts row is `machineryBlind`
 * (none); the other watched reads are evaluated after every change, as before.
 */
export function machineryBlind(store: Pick<OutlinerStore, "get">, request: Record<string, unknown>, response: OutlinerResponse): ReadonlySet<string> | undefined {
  if (!response.ok || !response.result || typeof response.result !== "object") return undefined;
  // Made from the text of what a machinery-hiding query matched (its row in actions.ts): no stamped note reaches it.
  if (isMachineryBlindRead(request.action)) return new Set();
  const result = response.result as { blocks?: { id?: unknown }[]; machineryHidden?: unknown; machineryLeftOut?: unknown };
  if (!Array.isArray(result.blocks) || result.machineryHidden !== undefined || result.machineryLeftOut !== undefined) return undefined;
  const named = questionOf(store, request);
  if (!named) return undefined;
  const ids = new Set<string>();
  for (const id of [...named, ...result.blocks.map(block => block?.id)]) if (typeof id === "string" && id) ids.add(id);
  return ids;
}

/**
 * Whether a read can hold notes tools stamped `[machine::…]`: the question as the service answers it (a saved view by
 * its own definition) names `machine`, shows machinery, counts what it hid, or reads other notes (`child:`, `links:`…),
 * as `machineryBlind` classifies it; any other read that says `machinery: show|only`. A script's drawing that asked one
 * sees them (PIE-1546), so a change to a stamped note draws it again; one that asked none doesn't.
 */
export function asksMachinery(store: Pick<OutlinerStore, "get">, request: Record<string, unknown>): boolean {
  if (request.action === "blocks.query" || request.action === "views.read") return questionOf(store, request) === undefined;
  return request.machinery === "show" || request.machinery === "only";
}

/**
 * A change event on its way to the subscribers: the watched questions hear it (a content change with whether it stays
 * among stamped notes), and one that does is said `hidden`, so a door's lists that leave machinery out skip it.
 */
export function watchesHear(store: Pick<OutlinerStore, "get" | "liveBlocks">, watches: Pick<QueryWatches, "changed">, event: OutlinerEvent): OutlinerEvent {
  if (event.domain !== "content" && event.domain !== "view" && event.domain !== "resource-catalog") return event;
  const touched = event.domain === "content" ? machineryChange(store, event.change) : undefined;
  watches.changed(touched);
  return touched?.machinery && event.change ? { ...event, hidden: true } : event;
}
