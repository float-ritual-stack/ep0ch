// What a projected read (`blocks.read`, `blocks.query` with `fields`) may name and what it answers: the field names
// and the block reduced to them. types.ts names these once; block-projection.ts fills them. No I/O.
import type { BlockAuthor, BlockProperty } from "@ep0ch/outline-core/protocol";

/** Fields a projected block read can return; `id` is always included. */
export const BLOCK_READ_FIELDS = [
  "id",
  "parent",
  "title",
  "properties",
  "revision",
  "timestamps",
  "author",
  "hasChildren",
  "hasNotes",
  "text",
  "excerpt",
] as const;
export type BlockReadField = (typeof BLOCK_READ_FIELDS)[number];
/** What a field costs beyond the block's own row is asked for by name: the full text, its excerpt, a look at what is under it. */
const BY_NAME: readonly BlockReadField[] = ["text", "excerpt", "hasNotes"];
/** Omitted `fields` return everything except full text (and what is asked only by name). */
export const DEFAULT_BLOCK_READ_FIELDS: readonly BlockReadField[] = BLOCK_READ_FIELDS.filter(field => !BY_NAME.includes(field));

/** A block reduced to the requested fields. Absent keys were not requested. */
export interface ProjectedBlock {
  id: string;
  /** `parent` */
  parentId?: string | null;
  position?: number;
  /** `title`: first content line without property tokens, as Tree and CLI label it. */
  title?: string;
  /** `properties`: block-scoped properties. */
  properties?: BlockProperty[];
  revision?: number;
  /** `timestamps` */
  createdAt?: string;
  updatedAt?: string;
  /** `author`, with any recorded actor/session/task provenance. */
  author?: BlockAuthor;
  actorId?: string;
  sessionId?: string;
  taskId?: string;
  /**
   * `hasChildren`: at least one block under it outside Trash, whatever it is. What a list of every block draws its
   * fold from (the Tree, a read of a subtree): a comment on the note and an edit proposed beside it count.
   */
  hasChildren?: boolean;
  /**
   * `hasNotes`: at least one note under it outside Trash, by the one reading of "the notes under a note"
   * (outline-core's `isNoteUnder`: a comment, a reply and a proposed edit are none). What a list of notes draws its
   * fold from, so a fold always opens onto a note (notes-under.ts).
   */
  hasNotes?: boolean;
  text?: string;
  /** `excerpt`: the words after the title as one line (outline-core `noteExcerpt`), what a list row previews. */
  excerpt?: string;
}
