// The service's side of Jev's bookkeeping reads and batched stamps (PIE-1546): `suggestions.asks` answers from the
// outline's ask files (jev-asks.ts), `suggestions.stamp` writes a pass's finding stamps in one request.
import type { JevAsks, JevAsk } from "./jev-asks";
import type { SuggestionAsksRequest, SuggestionStampRequest } from "./jev-suggestions";
import type { OutlinerStore } from "./store";
import type { Block } from "./types";
import { stripPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { readAsks } from "./write-review";

/** At most this many findings stamped by one request. */
const STAMPS_PER_REQUEST = 200;

type AsksStore = Pick<OutlinerStore, "require" | "database" | "textSaved" | "listAnnotationThreads">;

/**
 * The lines of a note someone has answered (PIE-1620): each still as it was the last time the person acted on the note,
 * by a save (a tick is one) or a comment. He has seen them and moved on; only what an agent wrote after that can ask.
 * Reads who saved each revision and at most one kept text: this runs on the host's loop on a note's every settle.
 */
function answeredLines(store: AsksStore, block: Block): Set<number> {
  const now = store.textSaved(block);
  const kept = store.database.query("SELECT revision, saved_at AS savedAt, author FROM block_revisions WHERE block_id = ? ORDER BY revision DESC").all(block.id) as { revision: number; savedAt: string; author: string | null }[];
  const saves = [{ revision: block.revision, savedAt: now.savedAt, author: now.author as string | null }, ...kept]; // Newest first.
  const lastSave = saves.find(r => r.author === "user")?.revision ?? 0;
  const comments = store.listAnnotationThreads({ subject: { kind: "block", blockId: block.id }, includeResolved: true })
    .flatMap(thread => [thread.block, ...thread.replies.map(reply => reply.block)]).filter(b => b.author === "user").map(b => Date.parse(b.createdAt));
  const lastComment = comments.length ? Math.max(...comments) : 0;
  const onComment = lastComment ? saves.find(r => Date.parse(r.savedAt) <= lastComment)?.revision ?? 0 : 0;
  const seen = Math.max(lastSave, onComment);
  if (!seen) return new Set();
  const text = seen === block.revision ? block.text : (store.database.query("SELECT text FROM block_revisions WHERE block_id = ? AND revision = ?").get(block.id, seen) as { text: string } | null)?.text ?? "";
  const words = (line: string) => stripPropertyTokens(line).replace(/\s+/g, " ").trim();
  const then = new Set(text.split("\n").map(words));
  return new Set(block.text.split("\n").flatMap((line, i) => words(line) && then.has(words(line)) ? [i] : []));
}

/** `blocks.asks` (PIE-1612): the write review's `asks` judgment on a note as it is now, with the text and revision it read. */
export async function answerAsks(store: AsksStore, blockId: string, promptDirectory: string | undefined) {
  const block = store.require(blockId);
  return { blockId: block.id, revision: block.revision, text: block.text, ...await readAsks(block.text, { answered: () => answeredLines(store, block), ...(promptDirectory ? { promptDirectory } : {}) }) };
}

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
