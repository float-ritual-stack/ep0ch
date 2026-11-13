/*
 * `passages.find`: where a quoted passage is in a note's text, asked before anything is written about it. A client
 * that selects in what it drew (the native window) asks this when words are picked, so what it shows the person as
 * "the words this comment is on" is what the service found, and a quote the note doesn't hold, or holds twice, is
 * said then, before a comment is written on it.
 *
 * - **The one lookup** is `annotations.batch`'s own (`blockCommentSelection`, outline-core's `findQuoted`): the same
 *   passage finds the same span here and at the send, and is refused in the same words.
 * - **Whole words** (`whole: "words"`): a passage picked by hand that starts or ends inside a word takes the whole
 *   word (outline-core's `wholePassage`): a press that landed past the middle of a first letter starts a selection
 *   after it, and nobody means "ction". `quote` is then the passage's words as a reader draws them, to send in the
 *   asker's place; a passage that was whole already is answered with the asker's own quote, untouched.
 *
 * A read: nothing is written, and nothing is watched (a passage is found in the text as it is now).
 */
import { wholePassage } from "@ep0ch/outline-core/drawn-passage";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { blockCommentSelection } from "./block-comments";
import { displayTitleOfText } from "./references";
import type { BlockCommentPassage } from "./types";

/** What a client asks. Declared here, beside the handler: types.ts names it once in the request union. */
export interface PassageFindRequest {
  id: string; action: "passages.find";
  /** The note the words are of. */
  blockId: string;
  /** The words, as a comment sends them (`BlockCommentPassage`): as written, or `drawn` with the span they were drawn `within`. */
  passage: BlockCommentPassage;
  /** `words`: a passage that starts or ends inside a word takes the whole word. */
  whole?: "words";
}

/** `passages.find`'s answer: the span of the note's text the passage is, at the revision it was found in. */
export interface PassageFound {
  blockId: string;
  revision: number;
  /** Where the passage is in the note's text (UTF-16, `end` exclusive), and that text. */
  start: number;
  end: number;
  exact: string;
  /** The quote to send for it: the asker's own when it names the passage whole, else the passage's words as a reader draws them. */
  quote: string;
  /** The passage is wider than the words asked: they started or ended inside a word. */
  widened: boolean;
}

type Note = { id: string; text: string; revision: number; effectiveDeletedRootId?: string | null };

/** `passages.find` as the service answers it: `require` reads a note by id, and refuses one that isn't there. */
export function foundPassage(require: (id: string) => Note, request: PassageFindRequest): PassageFound {
  if (typeof request.blockId !== "string" || !request.blockId) throw new Refusal("invalid", "passages.find finds words of one note: name it with blockId");
  if (request.whole !== undefined && request.whole !== "words") throw new Refusal("invalid", "passages.find whole= is words, or left out");
  const block = require(request.blockId);
  if (block.effectiveDeletedRootId) throw new Refusal("not-found", `Block ${block.id} is in Trash`);
  // A reference with no label is drawn as its note's title: the reading asks for it, as a comment's does.
  const reads = { title: (id: string) => { try { return displayTitleOfText(require(id).text); } catch { return undefined; } } };
  const { anchor } = blockCommentSelection(block.text, request.passage, reads);
  if (anchor.kind !== "text-quote" || anchor.start === null || anchor.end === null) throw new Refusal("invalid", "passages.find finds a passage: name its words with passage.quote");
  const found = { start: anchor.start, end: anchor.end };
  const whole = request.whole === "words" ? wholePassage(block.text, found, reads) : { span: found, words: "", widened: false };
  return { blockId: block.id, revision: block.revision, start: whole.span.start, end: whole.span.end, exact: block.text.slice(whole.span.start, whole.span.end),
    quote: whole.widened ? whole.words : request.passage.quote, widened: whole.widened };
}
