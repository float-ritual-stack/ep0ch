// After a save, the references it kept that lead nowhere (PIE-761): the door's lookups for outline-core's
// `referenceWarnings`. A save never waits on this and is never refused by it; the warning follows the save.

import { describeReferenceWarnings, referenceWarnings, type ReferenceLookups, type ReferenceWarning } from "@ep0ch/outline-core/reference-warnings";
import type { SocketBoard } from "./socket";

export type ReferenceBoard = Pick<SocketBoard, "resolveReferences" | "searchBlocks" | "get">;

/** outline-core's lookups over a connection: `references.resolve`, the one search, a note's text for its anchors. */
export function boardReferenceLookups(board: ReferenceBoard, near?: string): ReferenceLookups {
  return {
    resolve: text => board.resolveReferences(text),
    search: async query => (await board.searchBlocks(query, near ? { near } : {})).matches.slice(0, 1).map(m => ({ id: m.block.id, title: m.title })),
    text: async id => (await board.get(id))?.text ?? null,
  };
}

/** The warnings for text just saved; none when there's nothing to say or the outline can't be asked. */
export async function savedReferenceWarnings(board: ReferenceBoard, text: string, near?: string): Promise<ReferenceWarning[]> {
  try { return await referenceWarnings(text, boardReferenceLookups(board, near)); } catch { return []; }
}

/** The same, said in one line ("" when there's nothing to say). */
export async function savedReferenceWarning(board: ReferenceBoard, text: string, near?: string): Promise<string> {
  return describeReferenceWarnings(await savedReferenceWarnings(board, text, near));
}
