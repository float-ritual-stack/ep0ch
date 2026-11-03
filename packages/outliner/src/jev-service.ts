// The service's side of Jev's bookkeeping reads and batched stamps (PIE-1546): `suggestions.asks` answers from the
// outline's ask files (jev-asks.ts), `suggestions.stamp` writes a pass's finding stamps in one request.
import type { JevAsks, JevAsk } from "./jev-asks";
import type { SuggestionAsksRequest, SuggestionStampRequest } from "./jev-suggestions";
import type { OutlinerStore } from "./store";

/** At most this many findings stamped by one request. */
const STAMPS_PER_REQUEST = 200;

export function answerSuggestions(store: Pick<OutlinerStore, "get" | "update">, asks: JevAsks, request: SuggestionAsksRequest | SuggestionStampRequest): { asks: JevAsk[] } | { stamped: string[]; skipped: string[] } {
  if (request.action === "suggestions.asks") {
    if (!Array.isArray(request.notes) || request.notes.some(note => typeof note !== "string")) throw new Error("suggestions.asks: notes is a list of note ids");
    const notes = new Set(request.notes);
    return { asks: asks.find(ask => !!ask.note && notes.has(ask.note) && (request.source === undefined || ask.source === request.source), request.days) };
  }
  if (!Array.isArray(request.stamps) || request.stamps.length > STAMPS_PER_REQUEST) throw new Error(`suggestions.stamp: stamps is a list of at most ${STAMPS_PER_REQUEST} { blockId, expectedRevision, text }`);
  const stamped: string[] = [], skipped: string[] = [];
  for (const stamp of request.stamps) {
    const now = store.get(stamp.blockId);
    // Changed since the pass read it (or gone): a later pass stamps it from what it is then.
    if (!now || now.revision !== stamp.expectedRevision || typeof stamp.text !== "string") { skipped.push(stamp.blockId); continue; }
    try {
      store.update(stamp.blockId, stamp.text, stamp.expectedRevision, request.mutation, "properties", [], now.updatedAt);
      stamped.push(stamp.blockId);
    } catch { skipped.push(stamp.blockId); }
  }
  return { stamped, skipped };
}
