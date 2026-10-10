// The calls an extension's process makes over its connection (PIE-754), as the extensions README documents them
// (PIE-767). Types only: each call's request is the service's own request type (`OutlinerRequestAction`), and its
// answer is the return type of the store method the service answers it with, so neither can be written here wrong.
// `scripts/extension-calls-doc.ts` writes the README's call reference from this file, and
// `test/extension-call-reference.test.ts` fails when a call's fields change and the README wasn't written again.
import type { DraftPatchResult } from "./draft-patch";
import type { OutlinerStore } from "./store";
import type {
  AnnotationBatchOperation,
  AnnotationBatchReceipt,
  AnnotationListQuery,
  AnnotationReplyInput,
  AnnotationSubject,
  AnnotationThread,
  Block,
  BlockCommentInput,
  BlockCommentPassage,
  BlockProperty,
  BlockSearchQuery,
  NoteAddress,
  NotePublication,
  OutlinerRequestAction,
  PageAddressResolution,
  RenderedNote,
  VisibleBlock,
  VisibleBlockCollection,
} from "./types";

/**
 * What a request carries besides `action`, as an extension sends it: `id`, `outline` and `grant` are outline.ts's,
 * and the service sets every actor field (`author`, `provenance`, `mutation`) to `ext:<id>`, so they're left out.
 */
type Ask<A extends OutlinerRequestAction["action"], Without extends string = never> =
  Omit<Extract<OutlinerRequestAction, { action: A }>, "id" | "action" | "author" | "provenance" | "mutation" | Without>;

interface Call<Request, Answer> {
  readonly request: Request;
  readonly answer: Answer;
}

/** The calls, in the order the README lists them. Each one's comment is its line in the README. */
export interface ExtensionCallReference {
  /** One block whole: its full text, properties, revision and who last wrote it. A block that isn't there is refused. */
  get: Call<Ask<"get">, ReturnType<OutlinerStore["require"]>>;
  /** A block's children in order, each whole (`null`: the outline's top level). Trash is left out. */
  children: Call<Ask<"children">, ReturnType<OutlinerStore["children"]>>;
  /**
   * Blocks matching a question in the views' grammar (`where: "readwise.book=8"`), under a block (`subtreeRootId`), by
   * text (`text`), sorted, grouped and counted. The usual way to find what a sync wrote before, by its own key.
   * (`fields` projects the rows, and answers `ProjectedBlockCollection`; `watch` keeps a question on a connection, which
   * an extension's one-request connection can't.)
   */
  "blocks.query": Call<Ask<"blocks.query", "fields" | "watch" | "generation">, ReturnType<OutlinerStore["queryBlocks"]>>;
  /** The block a page address names (`[page::readwise]` answers `readwise`), or why none does. */
  "pages.resolve": Call<Ask<"pages.resolve">, ReturnType<OutlinerStore["resolvePageAddress"]>>;
  /** A new block under `parentId` (none: the top level), last among its siblings. Properties in its text are properties. */
  create: Call<Ask<"create">, ReturnType<OutlinerStore["create"]>>;
  /**
   * A block's whole new text, checked against the revision you read. The service applies only the lines that changed,
   * as a `draft.patch` under the `edit` policy: a door's live draft gets it, and while the person types in that passage
   * it becomes a proposal (`outcome: "proposed"`). Text that didn't change answers the block as it is.
   */
  update: Call<Pick<Ask<"update">, "blockId" | "text" | "expectedRevision">, DraftPatchResult | Block>;
  /** The comment threads on a block (or a Resource), each with its replies and its own properties. */
  "annotations.list": Call<Ask<"annotations.list">, ReturnType<OutlinerStore["listAnnotationThreads"]>>;
  /**
   * Up to 100 comments in one write, all or none: a `block-comment` on a block (at a `passage`, or the whole block), a
   * `reply`, a `resource-comment`. `requestId` makes a retry safe: the same id with the same operations answers the
   * first receipt again (`deduplicated: true`) and writes nothing; the same id with other operations is refused.
   */
  "annotations.batch": Call<Ask<"annotations.batch">, ReturnType<OutlinerStore["createAnnotationBatch"]>>;
  /** A reply in a thread; `requestId` as `annotations.batch`'s. */
  "annotations.reply": Call<Ask<"annotations.reply">, ReturnType<OutlinerStore["replyToAnnotation"]>>;
  /** The outline, this machine's name and, with `blockId`, the note's `ep0ch://` URI and its web URLs when it is published. */
  "notes.address": Call<Ask<"notes.address">, NoteAddress>;
  /** A note and the notes under it, rendered by the publisher's renderer (Markdown or HTML), published or not. */
  "notes.render": Call<Ask<"notes.render">, RenderedNote>;
}

/** The types the README spells out field by field, in its order: the ones the calls above name. */
export interface ExtensionCallTypes {
  Block: Block;
  BlockProperty: BlockProperty;
  BlockSearchQuery: BlockSearchQuery;
  VisibleBlockCollection: VisibleBlockCollection;
  VisibleBlock: VisibleBlock;
  PageAddressResolution: PageAddressResolution;
  DraftPatchResult: DraftPatchResult;
  AnnotationListQuery: AnnotationListQuery;
  AnnotationSubject: AnnotationSubject;
  AnnotationThread: AnnotationThread;
  AnnotationBatchOperation: AnnotationBatchOperation;
  BlockCommentInput: BlockCommentInput;
  BlockCommentPassage: BlockCommentPassage;
  AnnotationReplyInput: AnnotationReplyInput;
  AnnotationBatchReceipt: AnnotationBatchReceipt;
  NoteAddress: NoteAddress;
  NotePublication: NotePublication;
  RenderedNote: RenderedNote;
}
