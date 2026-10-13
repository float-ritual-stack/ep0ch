// After a save, the references it kept that lead nowhere (PIE-761): the door's lookups for outline-core's
// `referenceWarnings`. A save never waits on this and is never refused by it; the warning follows the save.

import { describeReferenceWarnings, referenceWarnings, type ReferenceLookups, type ReferenceWarning } from "@ep0ch/outline-core/reference-warnings";
import { describeSyntaxWarnings, syntaxWarnings } from "@ep0ch/outline-core/syntax-warnings";
import type { SocketBoard } from "./socket";

export type ReferenceBoard = Pick<SocketBoard, "resolveReferences" | "searchBlocks" | "get">;

/** outline-core's lookups over a connection: `references.resolve`, the one search, a note's text for its anchors. */
export function boardReferenceLookups(board: ReferenceBoard, near?: string, self = near): ReferenceLookups {
  return {
    resolve: text => board.resolveReferences(text),
    search: async query => (await board.searchBlocks(query, near ? { near } : {})).matches.slice(0, 2).map(m => ({ id: m.block.id, title: m.title })),
    text: async id => (await board.get(id))?.text ?? null,
    ...(self ? { self } : {}),
  };
}

/** The warnings for text just saved (`self`, the block it was saved as: never a suggestion); none when there's nothing to say or the outline can't be asked. */
export async function savedReferenceWarnings(board: ReferenceBoard, text: string, near?: string, self = near): Promise<ReferenceWarning[]> {
  try { return await referenceWarnings(text, boardReferenceLookups(board, near, self)); } catch { return []; }
}

/**
 * The same, said in one line, with each construct the text left open (PIE-669: an unclosed fence, `[[`, `[key::`,
 * component or literal region, and what is read instead); "" when there's nothing to say.
 */
export async function savedReferenceWarning(board: ReferenceBoard, text: string, near?: string, self = near): Promise<string> {
  const references = describeReferenceWarnings(await savedReferenceWarnings(board, text, near, self));
  const open = describeSyntaxWarnings(syntaxWarnings(text));
  return references && open ? `${references} · ${open}` : references || (open ? `saved; ${open}` : "");
}
