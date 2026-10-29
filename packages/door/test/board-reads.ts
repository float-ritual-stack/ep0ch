// A door built again for every probe (test/parity.ts) asks the outline host the same questions each time: what a note's
// context is, its children, its annotations (X alone: ~70,000 round trips, a third of its time). The scratch outline holds
// still under a probe, so a read asked again gets the answer it had; anything else the board sends (a write), and any
// change the host reports, forgets them all. Only reads are listed, by name: an action not here is never answered from here.
import type { SocketBoard } from "../src/socket";

const READS = new Set([
  "blocks.context", "children", "annotations.list", "blocks.query", "blocks.facets", "blocks.authored-links", "block.revisions",
  "activity.recent", "extensions.list", "properties.preview", "views.read", "checklist.query", "draft.proposals.list", "references.resolve",
  "references.backlinks", "pages.resolve", "styles.list", "callouts.types", "headings.styles", "transclusions.read", "resources.projection.read",
]);

export function cacheReads(board: SocketBoard) {
  const kept = new Map<string, unknown>();
  let generation = 0;
  const forget = () => { generation++; kept.clear(); };
  const ask = board.request.bind(board) as (action: string, params?: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal) => Promise<unknown>;
  // `signal` (a search turn's) goes through to the board: a replaced search stops here as it does in the door.
  (board as { request: unknown }).request = (action: string, params: Record<string, unknown> = {}, timeoutMs?: number, signal?: AbortSignal) => {
    if (!READS.has(action)) { forget(); return ask(action, params, timeoutMs, signal).finally(forget); }
    const key = `${action}\0${JSON.stringify(params)}`;
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (kept.has(key)) return Promise.resolve(structuredClone(kept.get(key)));
    const gen = generation;
    return ask(action, params, timeoutMs, signal).then(v => { if (gen === generation) kept.set(key, structuredClone(v)); return v; });
  };
  return { forget };
}
