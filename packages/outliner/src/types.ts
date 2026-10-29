import type { AwayMachine } from "@ep0ch/outline-core/outline-away";
import type { Block, BlockAuthor, BlockProperty, McpAccessLevel, NotePlacement, OutlineAbout, QueryChange, QuestionAnswerFields } from "@ep0ch/outline-core/protocol";
export type { BlockRevisionEntry, BlockRevisions } from "@ep0ch/outline-core/protocol";
// The wire types both sides share live in outline-core (protocol.ts); re-exported for the service's modules.
export type { Block, BlockAuthor, BlockProperty, OutlinerRequestProblem, OutlinerResponse } from "@ep0ch/outline-core/protocol";
export type { HostedArchivedOutline, HostedOutlineArchival, HostedOutlineAttachment, HostedOutlineDeletion, HostedOutlineList, HostedOutlineSummary, OutlinerHostStatus, OutlinerServiceOutline, OutlinerServiceStatus } from "@ep0ch/outline-core/protocol";
import type { QueryAtom } from "@ep0ch/outline-core/query-atoms";
import type { MentionMessage, MentionScope } from "./mentions-types";
import type { FragmentCandidateQuery } from "./fragment-search";
import type { AuthoredResourceReference } from "./resource-references";
import type { PromptRevision } from "./ai-prompts";
import type { SuggestionKeep } from "./jev-suggestions";
import type { ViewCreatePlan, ViewMovePlan } from "./view-writes";
import type { DraftHolderAnswer, DraftHolderRequest, DraftPatchInput } from "./draft-patch";
import type {
  ComputedExecutionReceipt,
  CreateComputedInvocationInput,
  CreateResourceSourceInput,
  InternFilesystemResourceInput,
  FilesystemResourceWriteInput,
  InternResourceInput,
  RelocateResourceInput,
  ResourceDescription,
  ResourceProviderCommandInput,
  ResourceProviderCommandReceipt,
  ResourceRevisionRef,
  ResourcePresentationContext,
  ResourceRetentionPinInput,
  ResourceRetentionPolicyInput,
  ResourceRetentionReferenceInput,
  ReviseComputedInvocationInput,
} from "./resources";
export type { AuthoredResourceReference } from "./resource-references";

export type {
  ComputedExecutionHistory,
  ComputedExecutionReceipt,
  ComputedExecutionReceiptOutput,
  ComputedExecutionRecord,
  ComputedExecutionRecordOutput,
  ComputedHandlerResolution,
  ComputedInvocation,
  ComputedProducerDeclarationSnapshot,
  ComputedResourceDocument,
  ComputedResourceFailure,
  ComputedResourceStatus,
  CreateComputedInvocationInput,
  CapabilityAssessment,
  FilesystemResourceWriteInput,
  InternFilesystemResourceInput,
  InternResourceReceipt,
  PdfPageText,
  PdfRegion,
  PdfRepresentationProvenance,
  PdfResourceDocument,
  PdfResourceHistory,
  PdfSourceSnapshotProvenance,
  RemoteEntityDocument,
  RemoteEntityMetadata,
  RemoteEntityMetadataValue,
  RemoteEntityProvider,
  RemoteEntityRepresentationProvenance,
  RemoteEntitySourceSnapshotProvenance,
  PdfTextSpan,
  Resource,
  ResourceAddress,
  ResourceCapability,
  ResourceCapabilityDecision,
  ResourceCapabilityReport,
  ResourceDescription,
  ResourceNativePayload,
  ResourceKind,
  ResourcePlacement,
  ResourcePresentationAttempt,
  ResourcePresentationContext,
  ResourcePresentationDecision,
  ResourcePresentationHost,
  ResourcePresentationSelection,
  ResourceProviderAccess,
  ResourceRenderer,
  ResourceRepresentationKind,
  ResourceSurface,
  ResourceProviderCommandDescriptor,
  ResourceProviderCommandInput,
  ResourceProviderCommandReceipt,
  PurgedResourceArtifact,
  ResourceRetentionArtifact,
  ResourceRetentionArtifactKind,
  ResourceRetentionArtifactRef,
  ResourceRetentionCollectionReceipt,
  ResourceRetentionPin,
  ResourceRetentionPinInput,
  ResourceRetentionPolicy,
  ResourceRetentionPolicyInput,
  ResourceRetentionReference,
  ResourceRetentionReferenceInput,
  ResourceRetentionReferenceOwner,
  ResourceRetentionReport,
  ResourceRetentionState,
  ResourceFreshness,
  ResourcePolicy,
  ResourceProvider,
  ResourceRevision,
  ResourceRevisionRef,
  ResourceSource,
  ResourceRepresentationAdapter,
  WebRepresentationProvenance,
  WebResourceDocument,
  WebResourceProvenance,
  ReviseComputedInvocationInput,
  WebResourceStatus,
  WebSourceSnapshotProvenance,
} from "./resources";

export interface BlockProvenance {
  actorId: string;
  sessionId?: string;
  taskId?: string;
}

export interface MutationProvenance {
  /** Exact request keys copied from the person; only these inherit their ask. */
  invocationRequests?: readonly string[];
  author: BlockAuthor;
  actorId?: string;
  sessionId?: string;
  taskId?: string;
}

/**
 * What an activity entry records. `text` and `properties` are edits; `move`,
 * `delete` (moved to Trash) and `restore` are structural changes, recorded only
 * when the request declared who made them (capability `mutations.provenance`).
 */
export const BLOCK_ACTIVITY_KINDS = ["text", "properties", "move", "delete", "restore"] as const;
export type BlockActivityKind = (typeof BLOCK_ACTIVITY_KINDS)[number];

/** Edits: what `activity.recent` returns without `kinds`, and what "latest edit" readers count. */
export const BLOCK_EDIT_ACTIVITY_KINDS = ["text", "properties"] as const satisfies readonly BlockActivityKind[];

/** `kind IN (...)` for the edit kinds, for readers that must not count structural changes. */
export const BLOCK_EDIT_ACTIVITY_KIND_SQL = `kind IN (${BLOCK_EDIT_ACTIVITY_KINDS.map(kind => `'${kind}'`).join(", ")})`;

export interface BlockEditActivity {
  cursor: number;
  block: Block;
  author: BlockAuthor;
  actorId?: string;
  sessionId?: string;
  taskId?: string;
  kind: BlockActivityKind;
  editedAt: string;
}

export interface BlockEditActivityPage {
  entries: BlockEditActivity[];
  cursor: number;
}

export type { PropertyPlacement, PropertyRecord, PropertyScope, PropertySyntax } from "@ep0ch/outline-core/property-parse";
import type { PropertyRecord, PropertyScope } from "@ep0ch/outline-core/property-parse";
export type PropertyQueryScope = PropertyScope | "all";

/**
 * How the save-time parser reads a draft. Nothing is stored: a client compares
 * `properties` with the block it read to see what a save would change.
 */
export interface PropertyParsePreview {
  parserVersion: number;
  /** Block-scoped properties, exactly as a save would index them. */
  properties: BlockProperty[];
  /** Every token, including inline and line-scoped ones, in source order. */
  tokens: PropertyRecord[];
}

/** A chip a question matched a row on: outline-core's wire type (PIE-1277). */
export type PropertyMatchContext = import("@ep0ch/outline-core/protocol").PropertyMatch;

export type PropertyPatchOperation =
  | { op: "replace"; ordinal: number; key?: string; value: string }
  | { op: "remove"; ordinal: number }
  | { op: "append"; key: string; value: string };

export interface PropertyCatalogItem {
  key: string;
  value: string;
  count: number;
}

export interface PropertyInventory {
  key: string;
  propertyScope: PropertyQueryScope;
  items: PropertyCatalogItem[];
  totalValues: number;
  totalBlocks: number;
  matchedBlocks: number;
  offset: number;
  nextOffset: number | null;
  /** This response contains every matching value, rather than one page. */
  complete: boolean;
  sequence: number;
}

export type CaptureSource = "tree" | "pi" | "omp" | "cli" | "external";

/** What `notes.create` made (PIE-544): the note, and where the placement rule put it (src/note-placement.ts). */
export interface NewNoteReceipt {
  block: Block;
  placement: NotePlacement;
}

export interface CaptureReceipt {
  block: Block;
  inboxBlockId: string;
  deduplicated: boolean;
}

export interface QuickCaptureDraft {
  requestId: string;
  text: string;
  submittedText?: string;
  cursorRow: number;
  cursorColumn: number;
  selectionAnchor?: {row: number; column: number};
  blockId?: string;
  blockRevision?: number;
  capturedFromBlockId?: string;
  revision: number;
  updatedAt: string;
}

/** Live Capture ownership follows its subscribed client, never a durable lock. */
export interface CaptureOwnerLocation {
  launching?: boolean;
  hostname: string;
  herdrSocket: string;
  paneId: string;
  popup: boolean;
}
export interface CaptureOwner extends CaptureOwnerLocation { clientId: string }
export interface CaptureOwnerClaim { acquired: boolean; owner: CaptureOwner }

export interface QuickCaptureDraftSaveInput {
  ownerClientId?: string;
  requestId: string;
  text: string;
  submittedText?: string;
  cursorRow: number;
  cursorColumn: number;
  selectionAnchor?: {row: number; column: number};
  prepareBlock?: boolean;
  /** Explicit writing-history choice, guarded against edits made after review. */
  recovery?: {id: string; revision: number; basedOnBlockRevision: number};
  capturedFromBlockId?: string;
  expectedRevision: number | null;
}

export interface BookmarkStatus {
  root: Block;
  targetBlockId: string;
  record: Block | null;
}

export type BookmarkResolution =
  | {
    record: Block;
    target: Block;
  }
  | {
    record: Block;
    target: null;
    unavailableReason: string;
  };

export interface BookmarkToggleReceipt {
  root: Block;
  target: Block;
  record: Block;
  bookmarked: boolean;
}

export interface BookmarkRemoveReceipt {
  record: Block;
  targetBlockId: string;
}

export type AnnotationSource = "user" | "agent";
/** How present a mark is on its page (PIE-791, outline-core's annotation-marks.ts): open, seen, kept, resolved. */
export type AnnotationLifecycle = import("@ep0ch/outline-core/annotation-marks").MarkLifecycle;

export interface AnnotationAdapter {
  readonly id: string;
  readonly version: number;
}

export type AnnotationSubject =
  | { readonly kind: "block"; readonly blockId: string }
  | { readonly kind: "resource"; readonly resourceId: string }
  | {
      readonly kind: "legacy-file";
      readonly sourceBlockId: string;
      readonly filePath: string;
    };

export type RenderedPassageProjection = "canonical" | "resolved" | "generated" | "mixed";
export type RenderedSelectionValidation = "herdr-keybinding" | "detail-pointer";

export interface RenderedSelectionEvidence {
  readonly quote: string;
  readonly capturedAt: string;
  readonly hostBlockId: string;
  readonly paneId: string;
  readonly contentRevision: number;
  readonly contextId: string;
  readonly detailClientId: string;
  readonly validation: RenderedSelectionValidation;
}

export interface RenderedSelectionCapture extends RenderedSelectionEvidence {
  readonly snapshotText: string;
  readonly passage?: AnnotationPassage;
}

export interface RenderedPassageObservation extends RenderedSelectionEvidence {
  readonly projection: RenderedPassageProjection;
}

export type AnnotationSourceSnapshot =
  | {
      readonly kind: "block";
      readonly blockId: string;
      readonly inboxAttemptId?: string;
      readonly updatedAt: string;
      readonly contentHash: string;
    }
  | {
      readonly kind: "resource";
      readonly resourceId: string;
      readonly sourceSnapshotId: string | null;
      readonly revision: ResourceRevisionRef | null;
    }
  | {
      readonly kind: "rendered";
      readonly observation: RenderedPassageObservation | PreviewPassageObservation;
    }
  | {
      readonly kind: "unknown";
      readonly reason: string;
    };

/** Evidence captured by a local Preview, without asserting Markdown offsets. */
export interface PreviewPassageObservation {
  readonly fragmentId?:string;
  readonly validation:"preview-selection";
  readonly input:"pointer"|"keyboard";
  readonly quote:string;
  readonly capturedAt:string;
  readonly readerId:string;
  readonly renderRevision:number;
  readonly representationId:string;
  readonly snapshotHash:string;
  readonly projection:RenderedPassageProjection;
}

export interface AnnotationRepresentation {
  readonly id: string;
  readonly subject: AnnotationSubject;
  readonly sourceSnapshot: AnnotationSourceSnapshot;
  readonly adapter: AnnotationAdapter | null;
  readonly mediaType: string | null;
  readonly contentHash: string | null;
  readonly capturedAt: string;
  readonly observation?: RenderedPassageObservation | PreviewPassageObservation;
}

export type AnnotationAnchor =
  | { readonly kind: "whole-subject" }
  | { readonly kind: "list-item"; readonly itemId: string }
  | {
      readonly kind: "text-quote";
      readonly start: number | null;
      readonly end: number | null;
      readonly exact: string;
      readonly prefix: string;
      readonly suffix: string;
    }
  | {
      readonly kind: "dom-range";
      readonly start: {
        readonly selector: string;
        readonly textNode: number;
        readonly offset: number;
      };
      readonly end: {
        readonly selector: string;
        readonly textNode: number;
        readonly offset: number;
      };
      readonly exact: string;
    }
  | {
      readonly kind: "pdf-page-region";
      readonly page: number;
      readonly regions: readonly {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }[];
      readonly start: number | null;
      readonly end: number | null;
      readonly exact: string | null;
      readonly prefix: string | null;
      readonly suffix: string | null;
    }
  | {
      readonly kind: "structured-entity-field";
      readonly entityType: string;
      readonly entityId: string;
      readonly fieldPath: readonly string[];
      readonly valueHash: string;
    }
  | {
      readonly kind: "provider-comment-id";
      readonly provider: string;
      readonly commentId: string;
    };

export interface AnnotationReferenceContext {
  readonly representation: AnnotationRepresentation;
  readonly anchor: Extract<AnnotationAnchor, { readonly kind: "text-quote" }>;
  /** Immutable host evidence, never a read/write authority. */
  readonly sourceText: string;
}

/** A rendered passage is one comment with zero or more independent source anchors.
 * Documents are interned so repeated embeds do not duplicate whole note bodies. */
export interface AnnotationPassageSlice {
  readonly document: number;
  readonly anchor: Extract<AnnotationAnchor, {readonly kind: "text-quote"}>;
  /** Service-admitted task ownership; the observed words stay immutable. */
  readonly listItemId?: string;
}

export interface AnnotationPassageOccurrence {
  readonly host: AnnotationPassageSlice;
  readonly path: readonly {readonly token: AnnotationPassageSlice; readonly target: string}[];
}

export type AnnotationPassageFragment =
  | {readonly kind: "source"; readonly slices: readonly AnnotationPassageSlice[]; readonly occurrence?: AnnotationPassageOccurrence}
  | {readonly kind: "reference"; readonly token: AnnotationPassageSlice; readonly destination: string; readonly occurrence?: AnnotationPassageOccurrence}
  | {readonly kind: "derived"; readonly resultId: string; readonly dependencies: readonly AnnotationPassageSlice[];
      readonly result?: number; readonly resourceDependencies?: readonly ResourceRevisionRef[]}
  | {readonly kind: "generated"; readonly reason: string};

export interface AnnotationPassage {
  readonly version: 1;
  readonly quote: string;
  readonly documents: readonly import("./document-provenance").ObservedDocument[];
  readonly fragments: readonly AnnotationPassageFragment[];
}

export interface AnnotationTarget {
  /** Stable checklist ownership, independent of the immutable captured quote. */
  readonly listItemId?: string;
  readonly representation: AnnotationRepresentation;
  readonly anchor: AnnotationAnchor;
  readonly referenceContext?: AnnotationReferenceContext;
  readonly passage?: AnnotationPassage;
}

export type AnnotationResolutionStatus =
  | "resolved"
  | "probable"
  | "unresolved"
  | "ambiguous"
  | "orphaned"
  | "unsupported"
  | "rejected";

export type AnnotationResolutionMethod =
  | {
      readonly kind: "codec";
      readonly codecId: string;
      readonly codecVersion: number;
      readonly method: string;
    }
  | {
      readonly kind: "human";
      readonly method: string;
      readonly proposalEventId?: string;
    }
  | {
      readonly kind: "agent";
      readonly modelId: string;
      readonly method: "semantic-reconciliation";
      readonly rationale: string;
      readonly evidence: readonly string[];
    };

export interface AnnotationResolutionCandidate {
  readonly target: AnnotationTarget;
  readonly method: AnnotationResolutionMethod;
  readonly confidence: number;
}

export type AnnotationResolutionReviewer =
  | { readonly kind: "system"; readonly id: string }
  | { readonly kind: "user"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string };

/** Each position is an independent result; partially resolved passages retain
 * their useful positions without pretending the whole quote is contiguous. */
export interface AnnotationPassageSliceResolution {
  readonly document: number;
  readonly resolvedTarget: AnnotationTarget | null;
  readonly status: AnnotationResolutionStatus;
  readonly method: AnnotationResolutionMethod;
  readonly confidence: number | null;
  readonly candidates: readonly AnnotationResolutionCandidate[];
}

export interface AnnotationPassageResolution {
  readonly fragments: readonly {
    readonly sources: readonly AnnotationPassageSliceResolution[];
    readonly occurrence?: {
      readonly host: AnnotationPassageSliceResolution;
      readonly path: readonly AnnotationPassageSliceResolution[];
    };
  }[];
}

export interface AnnotationResolutionEvent {
  readonly id: string;
  readonly annotationId: string;
  readonly sequence: number;
  readonly passageResolution?: AnnotationPassageResolution;
  readonly sourceRepresentation: AnnotationRepresentation;
  readonly targetRepresentation: AnnotationRepresentation;
  readonly resolvedTarget: AnnotationTarget | null;
  readonly method: AnnotationResolutionMethod;
  readonly reviewer: AnnotationResolutionReviewer;
  readonly confidence: number | null;
  readonly candidates: readonly AnnotationResolutionCandidate[];
  readonly status: AnnotationResolutionStatus;
  readonly appliesCurrent: boolean;
  readonly createdAt: string;
}

export interface AnnotationCreateInput {
  readonly target: AnnotationTarget;
  /** Empty for a highlight: an annotation of a passage with no body (ADR 0004, contract 6). */
  readonly body: string;
  readonly source: AnnotationSource;
  /** Its own properties, open (`kind`, `tags`, `color` as a theme tone, or any other), written on its block. */
  readonly properties?: Readonly<Record<string, string | readonly string[]>>;
}

/** A quote is exact source text; optional context must identify one occurrence. */
export interface BlockCommentPassage {
  /** The words, exactly as the block's text has them. */
  readonly quote: string;
  /** Where the quote starts in the block's text, when you know. */
  readonly start?: number;
  /** Among repeats, the one nearest this offset (an agent's `near=`). */
  readonly near?: number;
  /** Text just before the quote, to tell repeats apart. */
  readonly prefix?: string;
  /** Text just after the quote, to tell repeats apart. */
  readonly suffix?: string;
  readonly itemId?: string;
}

export interface BlockCommentInput {
  readonly blockId: string;
  /** The block's revision you read: a block saved since is refused. */
  readonly expectedRevision: number;
  /** Empty for a highlight (a passage's annotation with no body). */
  readonly body: string;
  /** `user` or `agent`; an extension's is always `agent` (the service sets it). */
  readonly source: AnnotationSource;
  /** Its own properties, open (`kind`, `tags`, `color` as a theme tone, any key): `annotations.list` answers them, and a view's `where=` finds them. */
  readonly properties?: Readonly<Record<string, string | readonly string[]>>;
  /** Omit only for an intentional whole-block comment. */
  readonly passage?: BlockCommentPassage;
}

/**
 * A comment on a Resource's stored text (a file, a fetched page; PIE-650). The service reads the text itself, so a
 * client sends the quote it selected in the source, not a representation. `expectedRevision` is
 * `resourceTextRevision` of the content hash the client read: a Resource that changed since is refused.
 * `referenceBlockId`: the note whose link opened the Resource, kept as the comment's reference context (it
 * shows as a backlink there).
 */
export interface ResourceCommentInput {
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly body: string;
  readonly source: AnnotationSource;
  readonly properties?: Readonly<Record<string, string | readonly string[]>>;
  readonly passage?: BlockCommentPassage;
  readonly referenceBlockId?: string;
}

export interface AnnotationReplyInput {
  /** The thread's first annotation (`AnnotationThread.block.id`). */
  readonly annotationId: string;
  readonly body: string;
  /** `user` or `agent`; an extension's is always `agent` (the service sets it). */
  readonly source: AnnotationSource;
  /** Its own properties, open as a comment's are (`via: share:<id>` for a reply made through a share link). */
  readonly properties?: Readonly<Record<string, string | readonly string[]>>;
}

export type AnnotationBatchOperation =
  | { readonly operationId: string; readonly type: "block-comment"; readonly input: BlockCommentInput }
  | { readonly operationId: string; readonly type: "resource-comment"; readonly input: ResourceCommentInput }
  | { readonly operationId: string; readonly type: "create"; readonly input: AnnotationCreateInput }
  | { readonly operationId: string; readonly type: "reply"; readonly input: AnnotationReplyInput };

export interface AnnotationRecord {
  /** The annotation's own block: its id is the annotation's, and its text holds the body (update the block to edit the body). */
  readonly block: Block;
  readonly originalTarget: AnnotationTarget;
  /** Where it is anchored now (the passage, re-found after edits), or null when its words are gone. */
  readonly resolvedTarget: AnnotationTarget | null;
  readonly currentResolution: AnnotationResolutionEvent;
  readonly resolutionHistory: readonly AnnotationResolutionEvent[];
  /** What it says; empty for a highlight. */
  readonly body: string;
  readonly source: AnnotationSource;
  readonly lifecycle: AnnotationLifecycle;
  readonly promotedBlockIds?: readonly string[];
  readonly parentAnnotationId?: string;
  /** Its own properties (`kind`, `tags`, `color`, any other), the store's bookkeeping keys left out. */
  readonly properties?: Readonly<Record<string, readonly string[]>>;
  /** The live blocks quoting it (`quote`): each holds `[from::((this mark))]`, in the order they were made. */
  readonly quotedIn?: readonly string[];
  /** When its words were last edited after it was posted (`annotations.update`, an ISO time); absent when never. Its earlier words are its block's revisions (`block.revisions`). */
  readonly edited?: string;
  /** Who edited its words last: `user` (the person) or an agent's actor id. */
  readonly editedBy?: string;
}

export interface AnnotationThread extends AnnotationRecord {
  readonly replies: AnnotationRecord[];
}

export interface AnnotationBatchReceipt {
  /** What was written, one per operation, in order. */
  readonly annotations: AnnotationRecord[];
  /** True when the `requestId` had been used with these same operations: the first receipt, and nothing written now. */
  readonly deduplicated: boolean;
}

export interface AnnotationListQuery {
  /** The block (`{ kind: "block", blockId }`) or Resource (`{ kind: "resource", resourceId }`) the threads are on. */
  readonly subject: Exclude<AnnotationSubject, { readonly kind: "legacy-file" }>;
  /** Only threads in this lifecycle. */
  readonly lifecycle?: AnnotationLifecycle;
  /** Earlier threads too (seen and resolved: left out by default; open and kept are current). */
  readonly includeResolved?: boolean;
}

export interface AnnotationReconcileInput {
  readonly subject: Exclude<AnnotationSubject, { readonly kind: "legacy-file" }>;
  readonly newRepresentation: AnnotationRepresentation;
  readonly content?: string;
}

/** A Resource's threads re-anchored against its text as the service reads it now (PIE-650): no representation to send. */
export interface ResourceReconcileInput {
  readonly subject: { readonly kind: "resource"; readonly resourceId: string };
}

export interface AnnotationReconcileReceipt {
  readonly threads: AnnotationThread[];
  readonly changed: boolean;
  /** A Resource whose text can't be read now: its threads are as last resolved, and this says why. */
  readonly unavailable?: string;
  /** A Resource's threads were placed in the text of this revision (`resourceTextRevision`): offsets mean that text only. */
  readonly revision?: number;
}

export interface AnnotationApproveResolutionInput {
  readonly annotationId: string;
  readonly target: AnnotationTarget;
}

export interface AnnotationAgentCandidateSection {
  readonly index: number;
  readonly deterministicMethod: AnnotationResolutionMethod;
  readonly deterministicConfidence: number;
  readonly passage: string;
  readonly prefix: string;
  readonly suffix: string;
}

export interface AnnotationAgentPromptPackage {
  readonly annotationId: string;
  readonly baseEventId: string;
  readonly annotationBody: string;
  readonly originalPassage: string;
  readonly originalPrefix: string;
  readonly originalSuffix: string;
  readonly candidates: readonly AnnotationAgentCandidateSection[];
  readonly truncated: boolean;
  readonly characterCount: number;
}

export type AnnotationAgentResult =
  | {
      readonly status: "reanchored";
      readonly candidateIndex: number;
      readonly confidence: number;
      readonly rationale: string;
      readonly evidence: readonly string[];
    }
  | {
      readonly status: "ambiguous";
      readonly candidateIndexes: readonly number[];
      readonly confidence: number;
      readonly rationale: string;
      readonly evidence: readonly string[];
    }
  | {
      readonly status: "orphaned";
      readonly confidence: number;
      readonly rationale: string;
      readonly evidence: readonly string[];
    };

export interface AnnotationAgentProposalInput {
  readonly annotationId: string;
  readonly baseEventId: string;
  readonly modelId: string;
  readonly result: AnnotationAgentResult;
}

export interface AnnotationAgentProposalReceipt {
  readonly annotation: AnnotationRecord;
  readonly proposal: AnnotationResolutionEvent;
  readonly deduplicated: boolean;
}

export interface AnnotationAgentReviewInput {
  readonly annotationId: string;
  readonly proposalEventId: string;
  readonly decision: "accept" | "reject";
  readonly candidateIndex?: number;
}

export interface AnnotationAgentEvidenceSample {
  readonly annotationId: string;
  readonly proposalEventId: string;
  readonly modelId: string;
  readonly outcome: "reanchored" | "ambiguous" | "orphaned";
  readonly acceptedBy: "automatic" | "human";
  readonly confidence: number;
  readonly originalPassage: string;
  readonly resolvedPassage: string | null;
  readonly rationale: string;
  readonly evidence: readonly string[];
}

export interface AnnotationAgentEvidenceSummary {
  readonly acceptedCount: number;
  readonly automaticCount: number;
  readonly humanReviewedCount: number;
  readonly samples: readonly AnnotationAgentEvidenceSample[];
  readonly truncated: boolean;
}

/**
 * `quote` (PIE-1247, src/quote.ts): materialize marks or elements of a note into a new block (the Inbox, under the
 * first subject's note, under a block, under `.detached`) or into a note's text at a line, as references (each
 * transcluded, linked back with `[from::]`) or as a copy of an element's own lines.
 */
export type { QuoteAs, QuoteInput, QuotePlace, QuoteSubject, QuotedSubject } from "./quote";

/**
 * What `quote` did: the block it made, where it went and the undo step that takes it back (`extensions.undo`); or,
 * `into` a note, the draft.patch it sent there (applied, or proposed beside the note). Each subject as it was read
 * (`anchored`: its anchor was written for this quote).
 */
export type QuoteReceipt = import("@ep0ch/outline-core/protocol").QuoteReceipt<Block, NotePlacement>;

/** A posted comment's or reply's new words (`annotations.update`, PIE-763), checked against the revision the editor started from. */
export interface AnnotationUpdateInput {
  readonly annotationId: string;
  readonly expectedRevision: number;
  readonly body: string;
}

export interface AnnotationLifecycleInput {
  readonly annotationId: string;
  readonly lifecycle: AnnotationLifecycle;
  readonly promotedBlockId?: string;
}


export type AttentionTone = "current" | "info" | "warning" | "error" | "match" | "dim";
export type AttentionRole = "current" | "supporting";
export type AttentionSourceState = "active" | "stale";
export interface AttentionTextAnchor {
  readonly start: number;
  readonly end: number;
  readonly excerpt: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
  readonly sourceVersion: string;
  readonly sourceHash: string;
}

export type AttentionTargetInput =
  | {
      kind: "block";
      sourceBlockId: string;
      fragmentId?: string;
      sourceVersion?: string;
      sourceHash?: string;
      anchor?: AttentionTextAnchor;
    }
  | {
      kind: "file";
      sourceBlockId: string;
      filePath: string;
      startLine: number;
      endLine: number;
      anchor: AttentionTextAnchor;
    };

export type AttentionTarget =
  | {
      kind: "block";
      sourceBlockId: string;
      fragmentId?: string;
      sourceVersion: string;
      sourceHash: string;
      anchor?: AttentionTextAnchor;
    }
  | {
      kind: "file";
      sourceBlockId: string;
      filePath: string;
      startLine: number;
      endLine: number;
      anchor: AttentionTextAnchor;
    };

export interface AttentionMarkInput {
  targetRegion?: OutlinerRegion;
  markId: string;
  targetClientId: string;
  target: AttentionTargetInput;
  tone: AttentionTone;
  role?: AttentionRole;
  sender: string;
  expiresInMs?: number;
  reveal?: boolean;
  focus?: boolean;
}

export interface AttentionMark {
  markId: string;
  targetClientId: string;
  target: AttentionTarget;
  tone: AttentionTone;
  role: AttentionRole;
  sender: string;
  createdAt: string;
  expiresAt: string;
  acknowledgedAt?: string;
  returnCuePending: boolean;
  sourceState: AttentionSourceState;
}

export interface AttentionClientState {
  targetClientId: string;
  marks: AttentionMark[];
  currentMarkId?: string;
  pendingCount: number;
  summary: string;
  updatedAt: string;
}

export interface AttentionClearInput {
  targetClientId: string;
  markId?: string;
}

export interface AttentionAcknowledgeInput extends AttentionClearInput {}

export interface AttentionInstruction {
  targetRegion?: OutlinerRegion;
  markId: string;
  reveal: boolean;
  focus: boolean;
}

export type WorkflowActionId = "walkthrough.plan";
export type WorkflowPlanner = "pi-direct" | "callscript";
export type WorkflowStatus =
  | "planning"
  | "ready"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";
export type WorkflowCapability =
  | "outline.structure"
  | "outline.route"
  | "attention.mark"
  | "annotations.create"
  | "annotations.reply"
  | "annotations.batch"
  | "promotion.preview"
  | "promotion.commit";

export type WorkflowInvocation =
  | { kind: "block"; sourceBlockId: string }
  | { kind: "callout"; sourceBlockId: string; calloutType: string; calloutIndex?: number }
  | { kind: "query"; query: BlockSearchQuery }
  | { kind: "command"; command: string; sourceBlockId?: string };

export interface WorkflowLimits {
  fanOut: number;
  calls: number;
}

export interface WorkflowStartInput {
  requestId: string;
  actionId: WorkflowActionId;
  invocation: WorkflowInvocation;
  capabilities: WorkflowCapability[];
  limits: WorkflowLimits;
  planner: WorkflowPlanner;
  targetClientId?: string;
  provenance?: BlockProvenance;
}

export interface WorkflowStructureRegion {
  regionId: string;
  title: string;
  target: AttentionTargetInput;
  sourceBytes: number;
}

export interface WorkflowStructureItem {
  blockId: string;
  title: string;
  updatedAt: string;
  depth: number;
  properties: BlockProperty[];
  regions: WorkflowStructureRegion[];
  sourceBytes: number;
}

export interface WorkflowStructure {
  invocation: WorkflowInvocation;
  items: WorkflowStructureItem[];
  completeness: BlockCollectionCompleteness;
  contextBytes: number;
}

export interface WorkflowStep {
  stepId: string;
  ordinal: number;
  title: string;
  target: AttentionTargetInput;
  sourceRevision: string;
  status: "pending" | "current" | "visited" | "skipped";
}

export interface WorkflowMetrics {
  planner: WorkflowPlanner;
  modelTurns: number;
  operations: number;
  contextBytes: number;
  wallTimeMs: number;
  completeness: BlockCollectionCompleteness;
  artifactQuality: "unrated" | "usable" | "needs-revision";
  structureFirst: boolean;
}

export interface WorkflowComparison {
  direct: WorkflowMetrics;
  callscript: WorkflowMetrics;
  contextBytesSaved: number;
  operationDelta: number;
}

export interface WorkflowBranchQuestion {
  stepId: string;
  question: string;
  createdAt: string;
}

export interface WorkflowRun {
  runId: string;
  requestId: string;
  actionId: WorkflowActionId;
  invocation: WorkflowInvocation;
  capabilities: WorkflowCapability[];
  limits: WorkflowLimits;
  planner: WorkflowPlanner;
  targetClientId?: string;
  provenance?: BlockProvenance;
  status: WorkflowStatus;
  route: WorkflowStep[];
  currentStepIndex: number | null;
  branchQuestion?: WorkflowBranchQuestion;
  metrics?: WorkflowMetrics;
  comparison?: WorkflowComparison;
  resultBlockIds: string[];
  cancellationRequested: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStartReceipt {
  run: WorkflowRun;
  deduplicated: boolean;
}

export interface WorkflowPlanInput {
  runId: string;
  route: WorkflowStep[];
  metrics: WorkflowMetrics;
  comparison?: WorkflowComparison;
}

export type WorkflowTransitionAction =
  | "next"
  | "previous"
  | "pause"
  | "resume"
  | "skip"
  | "branch"
  | "end";

export interface WorkflowTransitionInput {
  runId: string;
  action: WorkflowTransitionAction;
  question?: string;
  targetClientId?: string;
  focus?: boolean;
}

export type WorkflowPromotionKind = "decision" | "follow-up" | "task" | "artifact";

export interface WorkflowPromotionInput {
  runId: string;
  stepId: string;
  annotationId: string;
  kind: WorkflowPromotionKind;
  title: string;
  approvedBy: string;
  body?: string;
  parentId?: string | null;
}

export interface WorkflowPromotionPreview {
  input: WorkflowPromotionInput;
  text: string;
  approvalToken: string;
}

export interface WorkflowPromotionCommitInput {
  requestId: string;
  approvalToken: string;
  input: WorkflowPromotionInput;
}

export interface WorkflowPromotionReceipt {
  run: WorkflowRun;
  block: Block;
  deduplicated: boolean;
}

export type DeliveryStage = "work" | "review" | "validate" | "complete";

export interface DeliveryEnsureInput {
  taskBlockId: string;
  deliveryKey: string;
  repository: string;
  baseBranch: string;
  workBranch: string;
}

export interface DeliveryReceipt {
  task: Block;
  delivery: Block;
  created: boolean;
}

export interface DeliverySyncInput {
  taskBlockId: string;
  deliveryBlockId: string;
  expectedDeliveryRevision: number;
  expectedTaskRevision: number;
  /** `mergedAt` is GitHub's ISO time of the merge, stamped as `merged-at` on a merged delivery (PIE-1352). */
  pullRequest: { number: number; url: string; state: "OPEN" | "CLOSED" | "MERGED"; mergeCommit: string | null; mergedAt?: string | null };
}

export interface DeliverySyncReceipt {
  task: Block;
  delivery: Block;
  changed: boolean;
}

export type OutlinerClientRole = "tree" | "detail" | "composed" | "observer";
export type OutlinerRegion = "tree" | "detail";

export function clientSupportsRole(client: Pick<OutlinerClientRegistration, "role">, role: OutlinerClientRole): boolean {
  return client.role === role || (client.role === "composed" && (role === "tree" || role === "detail"));
}

export interface BlockTarget {
  outline?: string;
  machine?: string;
  kind: "block";
  blockId: string;
  fragmentId?: string;
}

export interface ResourceTarget {
  kind: "resource";
  resourceId: string;
  revision?: ResourceRevisionRef;
  referenceContext?: AnnotationReferenceContext;
}

export type OutlinerNavigationIntent = "preview" | "open" | "reveal";

export type OutlinerNavigationTarget = BlockTarget | ResourceTarget;
export interface OutlinerClientRuntime {
  hostname?: string;
  paneId?: string;
  terminalId?: string;
  workspaceId?: string;
  tabId?: string;
  paneX?: number;
  paneY?: number;
  focused?: boolean;
  visible?: boolean;
}

export interface OutlinerViewAddress {
  clientId: string;
  region: OutlinerRegion;
}

export interface NavigationLinkState {
  source: OutlinerViewAddress;
  destination: OutlinerViewAddress | null;
  destinations: Array<{ view: OutlinerViewAddress; label: string; description?: string; groupLabel?: string; target?: OutlinerNavigationTarget; otherLocation?: boolean; protection?: string; placementPaneId?: string }>;
}

export interface OutlinerClientRegistration {
  clientId: string;
  role: OutlinerClientRole;
  contextId: string;
  /** The program a client says it is (a door says `door`): what a script's `act()` looks for, not a clientId prefix. */
  app?: "door";
  /** The host outline this pane is on; a hosted outline stamps its own name. */
  outline?: string;
  navigationProtection?: string | null;
  currentTarget?: OutlinerNavigationTarget;
  previewTarget?: OutlinerNavigationTarget;
  runtime?: OutlinerClientRuntime;
  resourcePresentation?: ResourcePresentationContext;
  focusedRegion?: OutlinerRegion;
  treeSelection?: { target: OutlinerNavigationTarget; rowId: string };
  /** A publisher (`publish serve`) says where it is opened, so `notes.address` can give a note's web URL (PIE-767). */
  publish?: PublisherAddress;
}

/** Where a note is published (`notes.address`, PIE-767). */
export interface NotePublication {
  /** Its slug: the page is at `/p/<slug>` below the publisher's base. */
  slug: string;
  /** `[publish::public…]`: anyone with the link may open it. */
  public: boolean;
  /** Its tailnet URL, by its slug: when the publisher said where it is opened (`--url`). */
  url?: string;
  /** Its URL for anyone with the link, by its slug: a public note, when the public URL is known (`--public-url`). */
  publicUrl?: string;
  /** Its URL by its block id (`/p/<id>`): holds while it stays published, whatever its slug. The public one when it is public. */
  permalink?: string;
}

/** A note rendered as its published page renders it (`notes.render`, PIE-767). */
export interface RenderedNote {
  blockId: string;
  /** Its title as the page shows it. */
  title: string;
  format: "markdown" | "html";
  /** The Markdown, or the HTML article (no page, styles or scripts around it). */
  text: string;
  /** Whether it is published itself (rendering doesn't need it to be). */
  published: boolean;
}

/**
 * A note's address (`notes.address`, PIE-767): the outline and this host's machine name (what an `ep0ch://` URI names),
 * the note's URI, and where it is published when it is.
 */
export interface NoteAddress {
  /** The outline's name; absent on a service that serves no named outline. */
  outline?: string;
  /** This host's machine name in `ep0ch://` URIs (`canonicalLocalMachineName`: the name its person gave it, else its host name's). */
  machine: string;
  /** Names this machine went by before it was given one (its host name's): older URIs and EchoNet marks still say them. */
  aliases?: string[];
  /** This machine dials in (EchoNet): it calls the other machines and is never called (`<outlines>/.host/dials-in`). */
  dialsIn?: boolean;
  blockId?: string;
  /** `ep0ch://<outline>@<machine>/b/<id>`, with `blockId` and a named outline. */
  uri?: string;
  /** Where the publisher serves it, when it is published (and not `[publish::never]`). */
  published?: NotePublication;
  /**
   * Its tailnet page by its id (`<url>/p/<id>`), published or not (PIE-782: the tailnet serves every note but a locked
   * one), when the publisher said where it is opened. An artifact line's page is below it (`/artifact/<line>`, PIE-793).
   */
  page?: string;
}

/** Where a running publisher is opened, as it tells the service when it connects (`notes.address` builds links from it). */
export interface PublisherAddress {
  /** The local clients' download address when web pages advertise a separate sign-in origin. */
  tailnetUrl?: string;
  /** The tailnet listener's full URL with its base path (`https://host.ts.net/pub`), when the publisher was told it. */
  url?: string;
  /** The public listener's full URL (`https://share.example/share`), when its origin is known. */
  publicUrl?: string;
  /** It runs Cloudflare Quick Tunnels to its public listener for `cloudflare` shares (it has one, and was asked to). */
  tunnels?: boolean;
}

export type PageAddressKind = "page" | "alias" | "work-id";

export interface PageAddressRecord {
  address: string;
  normalizedAddress: string;
  blockId: string;
  kind: PageAddressKind;
}

export interface PageAddressRemoval {
  removed: PageAddressRecord;
  block: Block;
}

export interface PageAddressResolution {
  outline?: string;
  machine?: string;
  address: string;
  normalizedAddress: string;
  /** `resolved` (then `block`), `deleted` (its block is in Trash) or `missing` (no block has that address). */
  status: "resolved" | "deleted" | "missing";
  registeredAddress?: string;
  kind?: PageAddressKind;
  block?: Block;
  deletionRootId?: string;
}

export interface PageAddressFollowResult extends PageAddressResolution {
  created: boolean;
  /** Where the placement rule put a page it created (PIE-544). */
  placement?: NewNoteReceipt["placement"];
}

export interface PageAddressMatch extends PageAddressRecord {
  subtitle?: string;
  title: string;
  /** Jev's Score for it (0 to 3), on a ranked lookup (PIE-1198). */
  score?: number;
}

export interface PageAddressCollection {
  outlines?: string[];
  addresses: PageAddressMatch[];
  completeness: BlockCollectionCompleteness;
}

export interface WorkIdAllocatorStatus {
  prefix: string | null;
  nextNumber: number | null;
  nextWorkId: string | null;
  reservedCount: number;
  observedPrefixes: string[];
  /**
   * Every prefix a ticket key may have to be one in this outline: the allocator's, the reserved ids', the
   * `[work-id::]` values notes carry and the ticket pages' keys. Any other `LETTERS-digits` token is plain text.
   */
  prefixesInUse: string[];
}


export interface WorkIdAllocation {
  workId: string;
  block: Block;
}

export type RoadmapItemPriority = "high" | "medium" | "low";

export const ROADMAP_WORK_STAGES = [
  "unprioritized", "later", "queued", "doing", "review", "validate", "done", "superseded",
] as const;
export type RoadmapWorkStage = typeof ROADMAP_WORK_STAGES[number];

export interface RoadmapItemCreateInput {
  title: string;
  body?: string;
  priority: RoadmapItemPriority;
  workStage?: Exclude<RoadmapWorkStage, "done" | "superseded">;
  workBatchId?: string;
  project: string;
  arc: string;
  tracks: string[];
  dependsOn?: string[];
  relatedTo?: string[];
  sourceBlockId?: string;
  /** The wave it ships in (`[wave::<theme>]`), when it's one of several tickets under one theme. */
  wave?: string;
  /**
   * File it although open items look like the same work (work-twins.ts): an agent's create with twins is refused
   * without it. The item says it was filed beside them, and relates to them.
   */
  new?: boolean;
}

export interface RoadmapBranchMembership {
  viewId: string;
  title: string;
  rank?: number;
}

export interface RoadmapItemCreateReceipt {
  workId: string;
  workQueueId: string;
  block: Block;
  memberships: RoadmapBranchMembership[];
}

export interface PropertyFilter {
  key: string;
  value?: string;
}

export type { ChecklistStatus } from "@ep0ch/outline-core/checklist-marks";
import type { ChecklistStatus } from "@ep0ch/outline-core/checklist-marks";

export interface ChecklistItem {
  itemId?: string;
  identity: "unassigned" | "unique" | "duplicate";
  status: ChecklistStatus;
  evidence: string;
  /** Canonical UTF-16 positions; the extent includes continuation lines and nested items. */
  span: { start: number; end: number; startLine: number; endLine: number };
  markerStart: number;
  depth: number;
  parentStart?: number;
  text: string;
  /** Only this item's properties: descendants and the plan's metadata do not inherit. */
  properties: PropertyRecord[];
  /** A `::graph-check` figure's row (PIE-864): never given an id, addressed by where it starts. */
  figure?: true;
}

export interface ChecklistQuery {
  statuses?: ChecklistStatus[];
  excludeStatuses?: ChecklistStatus[];
  filters?: PropertyFilter[];
  nested?: "include" | "top-level";
  limit: number;
}

export interface ChecklistCollection {
  blockId: string;
  revision: number;
  title: string;
  items: ChecklistItem[];
  completeness: BlockCollectionCompleteness;
}

export interface ChecklistSearchQuery {
  /** Select canonical plans, independently of the item predicates and pane expansion. */
  scope?: Pick<BlockSearchQuery, "filters" | "text" | "subtreeRootId" | "propertyScope" | "sort">;
  items: ChecklistQuery;
}

export interface ChecklistSearchCollection {
  matches: {block: Block; item: ChecklistItem}[];
  completeness: BlockCollectionCompleteness;
}

export interface ChecklistUpdateInput {
  /** Unassigned items are addressed only against an exact observed block revision. */
  target: { itemId: string } | { start: number; expectedRevision: number };
  expectedEvidence: string;
  change: { kind: "status"; status: ChecklistStatus } | { kind: "ensure-id" };
}

export interface ChecklistUpdateReceipt {
  block: Block;
  item: ChecklistItem;
  changed: boolean;
}

/** Explicit identity edits are authorized only with the enclosing block's expected revision. */
export type ChecklistIdentityChange =
  | { kind: "remove"; itemId: string }
  | { kind: "rename"; itemId: string; to: string };

/**
 * `created` and `updated` sort by timestamp; any other value is a property key (lowercase), sorted by the block's
 * value for it within the query's propertyScope: numbers as numbers and before text, text without case, blocks
 * without it last in either direction. `property:<key>` names a property even when it is called created or updated.
 */
export type BlockQuerySortField = string;
export type BlockQuerySortDirection = "asc" | "desc";

export interface BlockQuerySort {
  field: BlockQuerySortField;
  direction: BlockQuerySortDirection;
}


export interface BlockTraversalOptions {
  filters?: PropertyFilter[];
  subtreeRootId?: string;
  propertyScope?: PropertyQueryScope;
}

export type QueryTimeField = "created" | "updated";
export type QueryComparison = "<" | "<=" | ">" | ">=";

/**
 * Boolean property/timestamp predicate. Property leaves have filter semantics
 * (presence or case-insensitive equality within propertyScope; a value that reads as a date also holds for the
 * values on that day, or a span holding it). Time values are
 * YYYY-MM-DD, an ISO datetime, now, today, yesterday or -N{m,h,d,w}; relative
 * values resolve when the service evaluates the query.
 */
export type QueryExpression =
  /**
   * `relation: "child"` (`child:key=value` in query text): some active direct
   * child has the property, not the block itself. It lets a view compare a
   * block with what sits under it (a ticket page's `[status::]` with its
   * Jira record's `jira.status`).
   */
  | {
    kind: "property"; key: string; value?: string; relation?: "child"; /** `child>=N:`: at least N children have it (default 1). */ count?: number;
    /**
     * `key={{this.project}}`: the value is read from the Site when the question is bound (`bindThis`), as an operand: the
     * values it gives are compared as values, never pasted into the query text, so one that holds `OR` or a quote can't
     * change the query. A list means any of them; none matches nothing. Never present once bound.
     */
    from?: string;
  }
  | { kind: "time"; field: QueryTimeField; op: QueryComparison; value: string }
  /**
   * `due <= +3d`, `rating > 3`, `stage >= beta`: any property against a bound, as dates when the bound reads as one
   * (outline-core `dates.ts`: relative ones resolve when the service evaluates the query), numbers when it is a
   * number, text otherwise (PIE-769). A block holds when any of its values for the key does.
   */
  | { kind: "compare"; key: string; op: QueryComparison; value: string }
  /** `#tag`, `links:`, `linkedfrom:`, `under:`, `parent:`, `title~`, `text~`, `call:`, `unread:` and `thread:` (outline-core `query-atoms.ts`); the service evaluates them. */
  | QueryAtom
  | { kind: "not"; operand: QueryExpression }
  | { kind: "and" | "or"; operands: QueryExpression[] };

/**
 * `blocks.query`'s question. `where` (the views' grammar), `this`, `group`, `sort`, `limit` and `facets` are the
 * question every client writes (outline-core's `QuestionFields`, ADR 0004); `filters`, `predicate`, `text`,
 * `subtreeRootId`, `rankViewId`, `includeDeleted` and `propertyScope` narrow it the way Tree and the CLI need.
 * Normalized (`normalizeBlockSearchQuery`), `where` is parsed into `predicate`, `this` is bound, `sort` is an object
 * and `limit` is set.
 */
export interface BlockSearchQuery {
  filters?: PropertyFilter[];
  /** Structured predicate, ANDed with filters and `where`. */
  predicate?: QueryExpression;
  /** Query text in the documented grammar, parsed by the service and ANDed with predicate. */
  where?: string;
  /** The block `this` stands for in `where` (a component's note, a tile's aim). */
  this?: string;
  text?: string;
  subtreeRootId?: string;
  rankViewId?: string;
  includeDeleted?: "roots" | "all";
  propertyScope?: PropertyQueryScope;
  /** An object, or `"<field>[ asc|desc]"` (asc unless said). */
  sort?: BlockQuerySort | string;
  /** Rows returned: 200 when left out, at most 1000. */
  limit?: number;
  /** A property name, or created:day|week|month, updated:day|week|month: the answer's `groups`, over every match. */
  group?: string;
  /** `true`: value counts for every key the matches carry; or these keys. */
  facets?: true | string[];
  /** Values a facet lists per key: 50 when left out, at most 1000. */
  facetValues?: number;
  /** Keys `facets: true` lists: 50 when left out, at most 1000. */
  facetKeys?: number;
  /**
   * `hide` leaves out what tools write for their own bookkeeping (`[machine::…]`, outline-core `machinery.ts`), `only`
   * holds just that, `show` everything (PIE-867). The service's requests answer `hide` when it is left out; asked
   * of the store directly, left out means unfiltered.
   */
  machinery?: import("@ep0ch/outline-core/machinery").MachineryMode;
}

/** A watched read (outline-core `WATCHABLE_ACTIONS`): kept on the connection under `watch`; `generation` is answered from what's kept. */
export interface WatchFields { watch?: string; generation?: number }

/** A normalized query: its sort an object and its limit set. */
export type NormalizedBlockSearchQuery = Omit<BlockSearchQuery, "sort" | "limit" | "where" | "this" | "facets" | "facetValues" | "facetKeys"> & {
  sort?: BlockQuerySort;
  limit: number;
  facets?: true | string[];
  facetValues?: number;
  facetKeys?: number;
};

export type BlockCollectionCompleteness =
  | { kind: "complete" }
  /** `matched`: how many blocks matched in all, when the service counted every match (a sort, a group or facets). */
  | { kind: "truncated"; limit: number; matched?: number };

export interface VisibleBlock extends Block {
  depth: number;
  deletedDescendantCount?: number;
  hasChildren: boolean;
  displayText: string;
  propertyMatches?: PropertyMatchContext[];
}

export interface VisibleBlockCollection extends QuestionAnswerFields {
  blocks: VisibleBlock[];
  completeness: BlockCollectionCompleteness;
  /** How many notes `machinery: hide` left out of the answer (at most 50: then there are more), when it left any (PIE-867). */
  machineryHidden?: number;
}

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
  "text",
] as const;
export type BlockReadField = (typeof BLOCK_READ_FIELDS)[number];
/** Omitted `fields` return everything except full text. */
export const DEFAULT_BLOCK_READ_FIELDS: readonly BlockReadField[] = BLOCK_READ_FIELDS.filter(
  (field) => field !== "text",
);

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
  /** `hasChildren`: at least one child outside Trash. */
  hasChildren?: boolean;
  text?: string;
}

export interface ProjectedVisibleBlock extends ProjectedBlock {
  depth: number;
  /** Query metadata like `depth`: which property records matched, when the query scope attaches them. */
  propertyMatches?: PropertyMatchContext[];
  /**
   * Trash metadata, present only on trashed matches (queries with `includeDeleted`),
   * as on full `blocks.query` results. `effectiveDeletedRootId` is the Trash root, the
   * value `blocks.read` reports as `deletedRootId`; `deletedAt` and
   * `deletedDescendantCount` mark that root itself.
   */
  deletedAt?: string;
  effectiveDeletedRootId?: string;
  deletedDescendantCount?: number;
}

export interface ProjectedBlockCollection extends QuestionAnswerFields {
  blocks: ProjectedVisibleBlock[];
  completeness: BlockCollectionCompleteness;
  fields: BlockReadField[];
}

export type UnavailableBlockRead =
  | { id: string; status: "missing" }
  | { id: string; status: "trashed"; deletedRootId: string };

/** `blocks.read`: found blocks in request order; each other id is reported separately. */
export interface BlockReadCollection {
  blocks: ProjectedBlock[];
  unavailable: UnavailableBlockRead[];
  fields: BlockReadField[];
}

export interface TreeIndexBlock extends Omit<VisibleBlock, "text" | "displayText"> {
  preview: string;
  previewReferences: TreePreviewReference[];
  textDigest: string;
}

export interface TreePreviewReference {
  start: number;
  end: number;
  target: Pick<BlockReferenceResolution, "blockId" | "fragmentId"> | null;
}

export interface SavedViewReadOptions {
  /** An explicit bounded page size; the authored limit remains unchanged. */
  limit?: number;
  /** Number of eligible members to skip, in branch order. */
  offset?: number;
  expectedRevision?: number;
}

export type SavedViewReadStatus = "ready" | "invalid" | "unsupported" | "missing" | "changed" | "failed";

export interface SavedViewReadProblem {
  code: "view-missing" | "view-unsupported" | "view-changed" | "view-invalid" | "query-failed";
  message: string;
  /** Definition property that caused an invalid view, such as query. */
  property?: string;
  /** 0-based character position within that property value, for syntax errors. */
  position?: number;
}

/**
 * `views.planWrite`: plan a write into saved views. With `blockId`, a move of that block into each view;
 * with `text`, a new block in each view (without text, or blank text, only the view's side is planned).
 */
export interface ViewWritePlanRequest {
  viewIds: string[];
  blockId?: string;
  text?: string;
}

export interface ViewWritePlanResult {
  sequence: number;
  /** The block's revision the move plans were made at (move plans only). */
  revision?: number;
  plans: Array<{ viewId: string; plan: ViewMovePlan | ViewCreatePlan }>;
}

/** One saved view's members, evaluated atomically by the service (views.read). */
export interface SavedViewReadResult<B = VisibleBlock> {
  status: SavedViewReadStatus;
  viewId: string;
  revision?: number;
  sequence: number;
  configuredLimit?: number;
  effectiveLimit?: number;
  /** How many levels of children each member shows under it: the view's `[child-depth::]`, else the default (PIE-882). */
  childDepth?: number;
  offset?: number;
  /** Every eligible member of the view, beyond the authored limit and this page. */
  total?: number;
  /** Offset of the next page when this page does not reach the end. */
  nextOffset?: number;
  /** Matching canonical roots, in branch order. Context children are not matches. */
  blocks: B[];
  completeness: BlockCollectionCompleteness | null;
  /** How many members the view's `[machinery::hide]` left out (at most 50: then there are more), when it left any (PIE-867). */
  machineryHidden?: number;
  errors: string[];
  problems?: SavedViewReadProblem[];
}

export interface TreeIndexCollection {
  blocks: TreeIndexBlock[];
  completeness: BlockCollectionCompleteness;
}

export interface TreeFocusCollection {
  matches: Array<{ block: Pick<Block, "id">; title: string }>;
  completeness: BlockCollectionCompleteness;
}

export interface GotoSearchMatch {
  subtitle?: string;
  block: Pick<Block, "id" | "revision">;
  title: string;
  path: string;
  snippet: string;
  exact: boolean;
  /** Jev's Score for it (0 to 3), on a ranked search (PIE-1198). */
  score?: number;
  /** What a ranked search reads beside its text (PIE-1199): its type, its length in characters, when it last changed. */
  facts?: { type?: string; length: number; updated: string };
  /** Found by meaning, not words (the deep pass, PIE-1200). */
  deep?: true;
  /**
   * An empty query asked from a note (`contextBlockId`) lists, in order: what its parent and siblings link to
   * (`linked`), notes near it (`near`), the person's own recent edits (`yours`).
   */
  reason?: "linked" | "near" | "yours";
}

export interface GotoSearchCollection {
  matches: GotoSearchMatch[];
  completeness: BlockCollectionCompleteness;
  /** The note the search was asked from (`contextBlockId`), when it is live. */
  context?: { blockId: string; title: string; path: string };
  semantic: {
    status: "lexical" | "ranked" | "unavailable";
    message?: string;
    model?: string;
    elapsedMs?: number;
    candidateCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    promptRevisions?: PromptRevision[];
    /** The deep pass (PIE-1200, `deep: true`): skipped when the ranked search was sure, else what Jev found and what it cost. */
    deep?: { status: "found" | "skipped" | "unavailable"; windows?: number; found?: number; elapsedMs?: number; inputTokens?: number; message?: string };
  } & Partial<SearchCertainty>;
}
export type { SearchCertainty } from "@ep0ch/outline-core/protocol";
import type { SearchCertainty } from "@ep0ch/outline-core/protocol";

interface BacklinkOccurrenceBase {
  label: string;
  snippet: string;
  start: number;
  end: number;
}

export type BacklinkOccurrence =
  | (BacklinkOccurrenceBase & {
      kind: "block" | "page" | "work-id";
      /** The anchor it aims at (`((id^anchor))`, `[[page^anchor]]`, PIE-1247). */
      fragmentId?: string;
    })
  | (BacklinkOccurrenceBase & {
      kind: "property";
      propertyKey: string;
    });

export type BacklinkReferenceGroup =
  | {
      kind: "block" | "page" | "work-id";
      /** Grouped by the anchor aimed at too (PIE-1247): `((id^sowing))` and `((id))` are two groups. */
      fragmentId?: string;
      count: number;
    }
  | {
      kind: "property";
      propertyKey: string;
      count: number;
    };

export const BACKLINK_STAGE_BUCKETS = ["waiting", "draft", "active", "done"] as const;
/** Normalized lifecycle bucket; waiting, draft and active are open. */
export type BacklinkStageBucket = (typeof BACKLINK_STAGE_BUCKETS)[number];

/**
 * Service-derived meaning of one backlink source, so every client groups,
 * filters and orders the same way. Present when the service advertises
 * `references.backlinks.facets`.
 */
/** What an Outlink's or Resource's target block is (PIE-646): a backlink source's kind and stage, and its dates. */
export interface LinkTargetFacets {
  kind: string;
  kindLabel: string;
  stage?: { property: string; value: string; bucket?: BacklinkStageBucket };
  createdAt: string;
  updatedAt: string;
}

export interface BacklinkSourceFacets {
  /** Stable kind key, e.g. `comment`, `day-page`, `note` or a normalized `type::` value. */
  kind: string;
  /** Human label for the kind, e.g. "Outbox item". */
  kindLabel: string;
  /** Where the source sits relative to the queried target. */
  placement: "self" | "descendant" | "other";
  /** The first configured stage property the source declares. `bucket` is absent for an unmapped value. */
  stage?: { property: string; value: string; bucket?: BacklinkStageBucket };
  /** Present for comments and replies; a reply takes its thread's lifecycle. */
  comment?: { resolved: boolean };
}

export interface BacklinkSource {
  outline?: string;
  machine?: string;
  subtitle?: string;
  blockId: string;
  title: string;
  parentContext: string;
  createdAt: string;
  updatedAt: string;
  occurrenceCount: number;
  referenceGroups: BacklinkReferenceGroup[];
  occurrences: BacklinkOccurrence[];
  occurrencesTruncated: boolean;
  deletedRootId?: string;
  /** Absent from services without the `references.backlinks.facets` capability. */
  facets?: BacklinkSourceFacets;
}

export interface BacklinkQuery {
  targetBlockId: string;
  includeDeleted?: boolean;
  limit: number;
}

export interface BacklinkCollection {
  away?: AwayMachine[];
  targetBlockId: string;
  targetDeletedRootId?: string;
  sources: BacklinkSource[];
  completeness: BlockCollectionCompleteness;
}

export interface WorkingSelectionTarget {
  blockId: string;
  rowId: string;
  viewId?: string;
  parentRowId?: string | null;
  rankRoot?: boolean;
}

export interface WorkingSelection {
  id: string;
  ownerClientId: string;
  revision: number;
  updatedAt: string;
  targets: WorkingSelectionTarget[];
}

export interface WorkingSelectionSaveInput {
  ownerClientId: string;
  expected: {id: string; revision: number} | null;
  targets: WorkingSelectionTarget[];
}

export interface WorkingSelectionRecovery {
  selections: WorkingSelection[];
  completeness: BlockCollectionCompleteness;
}

export interface VirtualBranchOrder {
  viewId: string;
  viewRevision: number;
  blockIds: string[];
  completeness: BlockCollectionCompleteness;
}

/** `first`: the selected blocks first, in the order given (not the view's), then the rest as they were. */
export type VirtualBranchPlacement =
  | {kind: "up" | "down" | "top" | "bottom" | "first"}
  | {kind: "before" | "after"; anchorId: string};

export interface VirtualBranchPlacementInput {
  selection?: Pick<WorkingSelection, "id" | "ownerClientId" | "revision">;
  expected: VirtualBranchOrder;
  selectedBlockIds: string[];
  placement: VirtualBranchPlacement;
}

/**
 * `virtual.occurrences.move`: change a view's hand-set order in one step, read and written in one transaction.
 * `view` and `blocks` are refs: an id, ((id)), an id's first 8+ characters, a Work ID or a [[page]] address.
 * One block with `by` (places; negative up, and within what the view shows when the block is shown: its
 * `[limit::]`), `to` (position from 0), `before` or `after` (another member); or, with none of them, the blocks
 * first in the order given and the rest after them as they were.
 */
export interface VirtualOccurrenceMoveInput {
  view: string;
  blocks: string[];
  by?: number;
  to?: number;
  before?: string;
  after?: string;
}

/** The order after a move, and the members whose place changed. */
export interface VirtualOccurrenceMoveResult extends VirtualBranchOrder {
  moved: string[];
}

export interface VirtualOccurrenceRank {
  viewId: string;
  blockId: string;
  rank: number;
}

export interface BlockReferenceResolution {
  block?: Block;
  requestedOutline?: string;
  outline?: string;
  machine?: string;
  blockId: string;
  fragmentId?: string;
  label?: string;
  status: "resolved" | "deleted" | "missing" | "stale" | "duplicate";
  title?: string;
  deletionRootId?: string;
}

export interface ResolvedBlockReferences {
  away?: AwayMachine[];
  text: string;
  references: BlockReferenceResolution[];
  workIdPrefix?: string;
  /** Every prefix a ticket key may have here (`work-ids.status`'s `prefixesInUse`), when there are any. */
  ticketPrefixes?: string[];
}

/** `outlines.pane`: the outline and client a live pane is registered on; empty when none is. */
export interface HostedPaneOutline {
  outline?: string;
  clientId?: string;
  role?: OutlinerClientRole;
}


export interface ResourceProviderCommandResult {
  readonly receipt: ResourceProviderCommandReceipt;
  readonly description: ResourceDescription;
}

export interface ComputedExecutionResult {
  readonly receipt: ComputedExecutionReceipt;
  readonly description: ResourceDescription;
}

/**
 * Any request may name its outline: the outline host routes the connection by
 * its first line's `outline`, and a later line naming another outline is refused.
 * `grant` (PIE-754): an extension's own process passes its `EP0CH_EXT_GRANT`, which makes the request the
 * extension's (`ext:<id>`) while that process runs (src/extension-grants.ts).
 */
export type OutlinerRequest = OutlinerRequestAction & { outline?: string; grant?: string; scriptRun?: string };

export type OutlinerRequestAction =
  | ({ id: string } & import("@ep0ch/outline-core/artifacts").ArtifactRequest)
  | { id: string; action: "properties.preview"; text: string }
  | { id: string; action: "properties.inventory"; key: string; propertyScope?: PropertyQueryScope; offset?: number; limit?: number }
  | { id: string; action: "ping" }
  /** Answered by the outline host itself (capabilities `outlines.*`); a single-outline service refuses them. */
  | { id: string; action: "outlines.list" }
  | { id: string; action: "outlines.create"; name: string; about?: OutlineAbout }
  | { id: string; action: "outlines.import"; path: string; name: string }
  | { id: string; action: "outlines.attach"; name: string; create?: boolean }
  | { id: string; action: "outlines.pane"; paneId: string; hostname: string }
  | { id: string; action: "outlines.close"; name: string }
  | { id: string; action: "outlines.delete"; name: string }
  | { id: string; action: "outlines.archive"; name: string }
  | { id: string; action: "outlines.unarchive"; name: string }
  | { id: string; action: "loki.lease.start"; ttl?: string; by: string }
  | { id: string; action: "loki.lease.revoke" }
  | { id: string; action: "loki.lease.use"; token: string; method: string; path: string }
  /** Uploads into the artifacts inbox (PIE-1267, upload-tokens.ts): the route's two steps and a device's token (a lease is `artifacts.lease`, asked of the outline). */
  | { id: string; action: "uploads.take"; token: string; method: string }
  | { id: string; action: "uploads.finish"; claim: string; ok: boolean }
  | { id: string; action: "devices.add"; name: string; outline: string }
  | { id: string; action: "devices.list" }
  | { id: string; action: "devices.revoke"; device: string }
  /**
   * The signed-in web client's sessions (web-sessions.ts), answered by the outline host for every outline: `start` after
   * a sign-in (answers the cookie's token once), `resolve` a cookie's token on each request (renewing it), `list`, and
   * `revoke` one (`sessionId`) or `all`.
   */
  | { id: string; action: "web.sessions.start"; subject: string; name?: string; device?: string }
  | { id: string; action: "web.sessions.resolve"; token: string }
  | { id: string; action: "web.sessions.list" }
  | { id: string; action: "web.sessions.revoke"; sessionId?: string; all?: boolean }
  | ({ id: string; action: "blocks.query"; query: BlockSearchQuery; fields?: BlockReadField[] } & WatchFields)
  | { id: string; action: "blocks.read"; ids: string[]; fields?: BlockReadField[] }
  /** Blocks as records (outline-core's block-record.ts: properties, header, children, tasks, links, backlinks, resources). Reads only. */
  | { id: string; action: "blocks.records"; ids: string[] }
  | ({ id: string; action: "site.answer" } & import("@ep0ch/outline-core/site").SiteAnswerRequest & WatchFields)
  /** The call a `::use` line makes (PIE-533 S4): the template, the props resolved and checked, the chain to draw its body in. Reads only. */
  | ({ id: string; action: "template.use" } & import("@ep0ch/outline-core/template-use").TemplateUseRequest & WatchFields)
  /** Every generated region of a note with what it read, when, what shaped it and what it answered (PIE-956 S6b): the Sources inspector's one answer. Reads only. */
  | ({ id: string; action: "site.sources" } & import("@ep0ch/outline-core/sources").SourcesRequest)
  /** The props a template declares, for asking for them before a stamp or a use. Reads only. */
  | { id: string; action: "template.props"; of: string }
  | { id: string; action: "blocks.census" }
  /** Each block's link facets (kind, stage, dates), as an Outlink's target carries them: the links model's children and query rows (PIE-693). Reads only. */
  | { id: string; action: "blocks.facets"; blockIds: string[] }
  /** Service-owned publication reachability for external read surfaces. Uses `[publish::…]` and `[publish::never]`. */
  /** Per-outline local MCP access. Default is none; read/propose/full allow local MCP reads, and propose/full also the write tools (as proposals, or applied). */
  | { id: string; action: "mcp.access.status" }
  /** The `@name` requests an agent or an extension wrote that wait for a person's `r`, with why (PIE-888). Reads only. */
  | { id: string; action: "agents.held" }
  | { id: string; action: "waiting.list" }
  /** Yolo (PIE-973): the person's door (`clientId`, a connected client) turns the agent gate off for the outline (`on: true`), or any door takes it back (`on: false`). An agent's mutation is refused. */
  | { id: string; action: "agents.yolo"; clientId: string; on: boolean; mutation?: MutationProvenance }
  | { id: string; action: "mcp.access.configure"; level: McpAccessLevel }
  | ({ id: string; action: "views.read"; viewId: string; format?: "full" | "tree" } & SavedViewReadOptions & WatchFields)
  /** Capability `views.planWrite`: what a move of `blockId` into each view, or a new block with `text`, must change. Reads only. */
  | ({ id: string; action: "views.planWrite" } & ViewWritePlanRequest)
  /**
   * Capability `query.matches`: which of `blockIds` a query holds for (the saved-view grammar), narrowed by `text` and
   * `subtreeRootId` as `blocks.query` narrows (either lets the expression be left out). Reads only.
   */
  | ({ id: string; action: "query.matches"; expression?: string; blockIds: string[]; text?: string; subtreeRootId?: string; this?: string } & WatchFields)
  | ({ id: string; action: "blocks.authored-links"; ownerBlockId: string } & WatchFields)
  /** Capability `resources.projection`. Stored ticket details for provider lines; never fetches. */
  | {
      id: string;
      action: "resources.projection.read";
      blockId: string;
      line?: number;
      /**
       * Capability `resources.projection.materialize`: register and fetch in the
       * background what the block asks for when it isn't fetched or is stale.
       * The read answers at once with the stored state (`fetching` while it runs).
       */
      materialize?: boolean;
    }
  | {
      id: string;
      action: "resources.projection.refresh";
      /** A block with provider lines (or a ticket page), or an extension record block. */
      blockId: string;
      line?: number;
      /** Who pressed `r`: recorded as who asked an `@name` agent (a person when absent). An agent's `r` doesn't release a line an agent wrote. */
      mutation?: MutationProvenance;
    }
  | { id: string; action: "get"; blockId: string }
  | { id: string; action: "children"; parentId: string | null }
  | { id: string; action: "files.read"; path: string }
  | { id: string; action: "files.complete"; prefix: string }
  | { id: string; action: "workspace.snapshot"; view?: WorkspaceSnapshotView }
  | { id: string; action: "tree.index"; view?: WorkspaceSnapshotView }
  | { id: string; action: "tree.query"; query: BlockSearchQuery }
  | { id: string; action: "tree.search"; query: string; limit?: number; semantic?: boolean; deep?: boolean; contextBlockId?: string; machinery?: import("@ep0ch/outline-core/machinery").MachineryMode }
  | { id: string; action: "tree.focus"; query: string }
  | { id: string; action: "events.subscribe"; client: OutlinerClientRegistration }
  | { id: string; action: "clients.list"; role?: OutlinerClientRole }
  | {
      id: string;
      action: "clients.update";
      clientId: string;
      navigationProtection?: string | null;
      currentTarget?: OutlinerNavigationTarget | null;
      previewTarget?: OutlinerNavigationTarget | null;
      runtime?: OutlinerClientRuntime | null;
      focusedRegion?: OutlinerRegion;
      treeSelection?: { target: OutlinerNavigationTarget; rowId: string } | null;
    }
  | { id: string; action: "resource-sources.create"; input: CreateResourceSourceInput }
  | { id: string; action: "resource-sources.list" }
  | { id: string; action: "resource-sources.get"; sourceId: string }
  | { id: string; action: "resource-sources.rebind"; root: string }
  | {
      id: string;
      action: "computed.invocations.create";
      input: CreateComputedInvocationInput;
    }
  | {
      id: string;
      action: "computed.invocations.revise";
      input: ReviseComputedInvocationInput;
    }
  | { id: string; action: "computed.handlers.resolve"; reference: string }
  | { id: string; action: "computed.executions.list"; resourceId: string }
  | {
      id: string;
      action: "computed.execute";
      resourceId: string;
      destinationClientId: string;
    }
  | { id: string; action: "resources.intern"; input: InternResourceInput }
  | { id: string; action: "resources.intern-filesystem"; input: InternFilesystemResourceInput }
  | { id: string; action: "resources.lookup-filesystem"; path: string }
  | {
      id: string;
      action: "resources.follow-authored";
      reference: AuthoredResourceReference;
      /** Capability `resources.follow-authored.provenance`: who registered it, echoed and on the change feed. */
      mutation?: MutationProvenance;
    }
  | { id: string; action: "resources.get"; resourceId: string }
  | { id: string; action: "resources.relocate"; input: RelocateResourceInput }
  | {
      id: string;
      action: "resources.write-filesystem";
      input: FilesystemResourceWriteInput;
      destinationClientId: string;
    }

  | {
      id: string;
      action: "resources.describe";
      target: ResourceTarget;
      /** Optional with capability `resources.observer-reads`: without it, the terminal presentation. */
      destinationClientId?: string;
    }
  | {
      id: string;
      action: "resources.open";
      target: ResourceTarget;
      /** Optional with capability `resources.observer-reads`: without it, the terminal presentation. */
      destinationClientId?: string;
    }
  | {
      id: string;
      action: "resources.refresh";
      resourceId: string;
      /** Optional with capability `resources.observer-reads`. */
      destinationClientId?: string;
    }
  | {
      id: string;
      action: "resources.command.execute";
      resourceId: string;
      destinationClientId: string;
      input: ResourceProviderCommandInput;
    }
  | { id: string; action: "resources.retention.get" }
  | { id: string; action: "resources.retention.configure"; input: ResourceRetentionPolicyInput }
  | { id: string; action: "resources.retention.inspect"; resourceId?: string }
  | { id: string; action: "resources.retention.pin"; input: ResourceRetentionPinInput }
  | { id: string; action: "resources.retention.unpin"; pinId: string }
  | {
      id: string;
      action: "resources.retention.reference";
      input: ResourceRetentionReferenceInput;
    }
  | { id: string; action: "resources.retention.unreference"; referenceId: string }
  | {
      id: string;
      action: "resources.collect";
      mode: "evict" | "purge";
      resourceId?: string;
    }
  | { id: string; action: "attention.get"; targetClientId: string }
  | { id: string; action: "attention.mark"; input: AttentionMarkInput }
  | { id: string; action: "attention.advance"; input: AttentionMarkInput }
  | { id: string; action: "attention.clear"; input: AttentionClearInput }
  | { id: string; action: "attention.acknowledge"; input: AttentionAcknowledgeInput }
  | { id: string; action: "workflows.start"; input: WorkflowStartInput }
  | { id: string; action: "workflows.get"; runId: string }
  | { id: string; action: "workflows.list"; limit?: number }
  | { id: string; action: "workflows.structure"; runId: string }
  | { id: string; action: "workflows.plan"; input: WorkflowPlanInput }
  | { id: string; action: "workflows.transition"; input: WorkflowTransitionInput }
  | { id: string; action: "workflows.cancel"; runId: string }
  | { id: string; action: "workflows.promotion.preview"; input: WorkflowPromotionInput }
  | {
      id: string;
      action: "workflows.promotion.commit";
      input: WorkflowPromotionCommitInput;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | { id: string; action: "ui.command.send"; command: OutlinerUiCommand }
  | { id: string; action: "blocks.context"; blockId: string }
  | { id: string; action: "browsing-context.get"; contextId: string }
  | {
      id: string;
      action: "browsing-context.publish";
      sourceClientId: string;
      contextId: string;
      target: OutlinerNavigationTarget | null;
      dispatchPreview?: boolean;
    }
  | { id: string; action: "navigation.link.get"; source: OutlinerViewAddress }
  | { id: string; action: "navigation.link.set"; source: OutlinerViewAddress; destination: OutlinerViewAddress | null }
  | {
      id: string;
      action: "navigation.resolve";
      sourceClientId: string;
      intent: OutlinerNavigationIntent;
      sourceRegion?: OutlinerRegion;
      destination?: OutlinerViewAddress;
      preserveSource?: boolean;
    }
  | {
      id: string;
      action: "navigation.dispatch";
      sourceClientId: string;
      target: OutlinerNavigationTarget;
      intent: OutlinerNavigationIntent;
      sourceRegion?: OutlinerRegion;
      destination?: OutlinerViewAddress;
      preserveSource?: boolean;
      focusTarget?: boolean;
    }
  | {
      id: string;
      action: "create";
      parentId?: string | null;
      text: string;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  /**
   * A new note where the placement rule puts it (PIE-544): under `intent.near` (the note the person was in), else the
   * top of the Inbox. The client never says where the Inbox is. Empty text is a note opened to be written.
   */
  | {
      id: string;
      action: "notes.create";
      text?: string;
      intent?: { kind: "note"; near?: string; nearOnly?: boolean };
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  /**
   * Route one note (`ref`) or every note (`all`) by the outline's routing rules (PIE-1010, src/note-routing.ts); `dryRun`
   * says what would move where and why, moving nothing. The moves are `ext:route`'s, with the caller as `requestedBy`.
   */
  | {
      id: string;
      action: "notes.route";
      ref?: string;
      all?: boolean;
      dryRun?: boolean;
      mutation?: MutationProvenance;
    }
  /** A template written out as a new note, props filled (PIE-533 S4, src/template-stamp.ts); `for` stamps once per match. */
  | ({ id: string; action: "template.stamp" } & import("./template-stamp").TemplateStampRequest)
  | { id:string; action:"mentions.ingest"; message:MentionMessage }
  | { id:string; action:"mentions.list"; scope?:MentionScope; limit?:number }
  | { id:string; action:"mentions.message"; messageKey:string }
  | { id:string; action:"mentions.clear"; scope?:MentionScope }
  | { id:string; action:"mentions.save"; messageKey:string }
  | { id: string; action: "bookmarks.root" }
  | { id: string; action: "bookmarks.status"; targetBlockId: string }
  | { id: string; action: "bookmarks.resolve"; recordId: string }
  | {
      id: string;
      action: "bookmarks.toggle";
      targetBlockId: string;
      expectedRecordId: string | null;
      label?: string;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      id: string;
      action: "bookmarks.remove";
      recordId: string;
      expectedRevision: number;
    }
  | {
      id: string;
      action: "roadmap.items.create";
      input: RoadmapItemCreateInput;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      /** Open items like a new one (work-twins.ts): the search matcher's candidates, Jev's Nouls, code's twins. */
      id: string;
      action: "roadmap.items.similar";
      input: { title: string; body?: string };
      limit?: number;
    }
  | {
      /** A new ask added under an open item, in its writer's words and dated (work-twins.ts attachText). */
      id: string;
      action: "roadmap.items.attach";
      input: { item: string; title: string; body?: string; sourceBlockId?: string };
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      id: string;
      action: "deliveries.sync";
      input: DeliverySyncInput;
      mutation: MutationProvenance;
    }
  | {
      id: string;
      action: "deliveries.ensure";
      input: DeliveryEnsureInput;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      id: string;
      action: "capture.create";
      requestId: string;
      text: string;
      source: CaptureSource;
      capturedFromBlockId?: string;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
      expectedDraftRevision?: number;
      ownerClientId?: string;
    }
  | {
      id: string;
      action: "capture.retitle";
      blockId: string;
      expectedRevision: number;
      title: string;
      mutation: MutationProvenance;
    }
  | { id: string; action: "capture.owner.get" }
  | { id: string; action: "capture.owner.claim"; clientId: string; location: CaptureOwnerLocation; transferToken?: string }
  | { id: string; action: "capture.owner.handoff"; clientId: string; requestId: string; expectedDraftRevision: number }
  | { id: string; action: "capture.draft.get" }
  | { id: string; action: "edit-recovery.start"; input: import("./edit-recovery").EditRecoveryStart }
  | { id: string; action: "edit-recovery.get"; recoveryId: string }
  | { id: string; action: "edit-recovery.list"; blockId: string; includeHistory?: boolean }
  | { id: string; action: "edit-recovery.restore"; recoveryId: string; requestId: string; version: "draft"|"before-save" }
  | { id: string; action: "edit-recovery.refresh"; recoveryId: string; expectedRevision: number }
  | { id: string; action: "edit-recovery.propose"; recoveryId: string; expectedRevision: number; proposal: import("./edit-recovery").EditRecoveryProposal }
  | { id: string; action: "edit-recovery.commit"; recoveryId: string; expectedRevision: number; text: string; basedOnRevision: number; mutation: MutationProvenance; identityChanges?:ChecklistIdentityChange[] }
  | { id: string; action: "edit-recovery.discard"; recoveryId: string; expectedRevision: number }
  | { id: string; action: "edit-recovery.separate"; recoveryId: string; expectedRevision: number; mutation: MutationProvenance }
  | {
      id: string;
      action: "capture.draft.save";
      input: QuickCaptureDraftSaveInput;
    }
  | {
      id: string;
      action: "capture.draft.clear";
      ownerClientId?: string;
      expectedRevision: number | null;
    }
  | {
      id: string;
      action: "annotations.list";
      query: AnnotationListQuery;
    }
  | {
      id: string;
      action: "annotations.create";
      requestId: string;
      input: AnnotationCreateInput;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      id: string;
      action: "annotations.get";
      annotationId: string;
    }
  | {
      id: string;
      action: "annotations.reply";
      requestId: string;
      input: AnnotationReplyInput;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      id: string;
      action: "annotations.batch";
      requestId: string;
      operations: AnnotationBatchOperation[];
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | {
      id: string;
      action: "annotations.reconcile";
      input: AnnotationReconcileInput | ResourceReconcileInput;
    }
  | {
      id: string;
      action: "annotations.approve-resolution";
      input: AnnotationApproveResolutionInput;
    }
  | {
      id: string;
      action: "annotations.agent-package";
      annotationId: string;
    }
  | {
      id: string;
      action: "annotations.agent-receipt";
      requestId: string;
    }
  | {
      id: string;
      action: "annotations.propose-agent";
      requestId: string;
      input: AnnotationAgentProposalInput;
    }
  | {
      id: string;
      action: "annotations.review-agent";
      input: AnnotationAgentReviewInput;
    }
  | {
      id: string;
      action: "annotations.agent-evidence";
      limit?: number;
    }
  /**
   * A thread read (PIE-708): its comment and replies marked read by `reader` (`user`, the person, when left out; an
   * agent passes its actor id). Clears its replies from `unread:` views.
   */
  | {
      id: string;
      action: "annotations.read";
      annotationId: string;
      reader?: string;
    }
  /**
   * Blocks read by `reader` (EchoNet's message reader): each marked read at the revision it was shown at (`user`, the
   * person, when left out; an agent passes its actor id). Bookkeeping only: clears them from `unread:` views until
   * they change again.
   */
  | {
      id: string;
      action: "blocks.markRead";
      blocks: { id: string; revision: number }[];
      reader?: string;
    }
  | {
      id: string;
      action: "annotations.lifecycle";
      input: AnnotationLifecycleInput;
      mutation: MutationProvenance;
    }
  /**
   * A posted comment's or reply's words changed (PIE-763), if its block is still at `expectedRevision`: its target,
   * lifecycle, properties and replies kept, `edited` stamped, attributed to `mutation`. Its earlier words stay in the
   * block's revisions (`block.revisions`).
   */
  | {
      id: string;
      action: "annotations.update";
      input: AnnotationUpdateInput;
      mutation: MutationProvenance;
    }
  /**
   * A thread's TL;DR (PIE-791): a reply with `[kind::tldr]`, the newest of which is the thread's face. With `body`, the
   * one written (the person's, or an edit of @margin's); without, the agent that answers in threads is asked to write it.
   */
  | {
      id: string;
      action: "annotations.tldr";
      annotationId: string;
      body?: string;
      /** Take its TL;DR away (PIE-860): the discussion is its face again. */
      remove?: boolean;
      requestId?: string;
      mutation: MutationProvenance;
    }
  /**
   * Materialize marks or elements (src/quote.ts): into a new block, each transcluded under one `[from::]` line, placed
   * by `input.place` (one write, one undo step), or into a note's text at a line, through draft.patch.
   */
  | {
      id: string;
      action: "quote";
      /** As sent: `place` defaults to the Inbox, `as` to reference (src/quote.ts readQuoteInput checks it). */
      input: import("@ep0ch/outline-core/protocol").QuoteRequest;
      mutation: MutationProvenance;
    }
  | {
      id: string;
      action: "update";
      blockId: string;
      expectedRevision: number;
      mutation: MutationProvenance;
      identityChanges?: ChecklistIdentityChange[];
    } & (
      | { text: string; replaceSection?: never }
      // The host finds the section; a client's renderer may use older component rules.
      | { text?: never; replaceSection: { heading: string; body: string }; allowStructural?: boolean }
    )
  | { id: string; action: "checklist.query"; blockId: string; query: ChecklistQuery }
  | { id: string; action: "checklist.search"; query: ChecklistSearchQuery }
  | { id: string; action: "checklist.update"; blockId: string; input: ChecklistUpdateInput; mutation: MutationProvenance }
  /** A fragment's slice of its note (PIE-424): kind, label, lines, offsets and the text a reader shows. */
  | { id: string; action: "fragments.read"; blockId: string; fragmentId: string }
  /** The part of a note holding `line` (from 0), else with `next` the first after it, as element.detach would take it, its anchor not written (PIE-780). */
  | { id: string; action: "fragments.at"; blockId: string; line: number; next?: boolean }
  /** Transclusions projected as readers show them, nested and cycle-safe (src/transclusions.ts). */
  | { id: string; action: "transclusions.read"; targets: { blockId: string; fragmentId?: string }[]; hostBlockId?: string; maxDepth?: number }
  /** Fragment completion over every active note (src/fragment-search.ts). */
  | { id: string; action: "fragments.candidates"; query: FragmentCandidateQuery }
  /** Give a heading its anchor (`## Beds ^beds`), if the note is still at `expectedRevision`. */
  | { id: string; action: "fragments.ensure"; blockId: string; lineIndex: number; expectedRevision: number; mutation: MutationProvenance }
  /** A door holds a live draft of a note, on a lease it renews (capability `drafts.hold`, PIE-501). */
  | { id: string; action: "drafts.hold"; blockId: string; clientId: string; revision: number; leaseMs?: number }
  | { id: string; action: "drafts.heartbeat"; holdId: string; revision?: number }
  | { id: string; action: "drafts.release"; holdId: string }
  /**
   * The person typed in the draft a hold keeps (capability `drafts.touch`): the service reads the draft from the
   * holding door and runs a request line written there once it is quiet. Answers `{ touched: true }` at once.
   */
  | { id: string; action: "drafts.touch"; holdId: string }
  /** The holding door's answer to a `draft` event; never queued behind the request waiting for it. */
  | { id: string; action: "drafts.answer"; requestId: string; clientId: string; answer?: DraftHolderAnswer; error?: string }
  /** A note's text as its live draft has it now, or as saved when no door holds one (capability `drafts.read`). */
  | { id: string; action: "drafts.read"; blockId: string }
  | ({ id: string; action: "outputs.place" } & import("./place").PlaceInput)
  /** Capability `extensions.list`. `reload` reads the folders now instead of waiting for the watcher. */
  | ({ id: string; action: "extensions.list"; reload?: boolean } & Pick<import("@ep0ch/outline-core/site").SiteAnswerRequest, "blockId" | "line" | "draft" | "chain">)
  /**
   * The service's completion sources for the token at the cursor (PIE-1340): pages, blocks and their fragments, files,
   * agents and the extensions' completion sources, each answering on outline-core's row contract, with the trigger's
   * picks. `{ answers: [{ source, rows, problem?, truncated?, empty?, partial?, heading?, jev? }], picks }`. It writes nothing.
   */
  | ({ id: string; action: "completion.rows" } & import("@ep0ch/outline-core/protocol").CompletionRowsRequest)
  /** A completion row was chosen (PIE-1340): its pick is counted, so every client ranks it higher next time. `{ picks }`. */
  | ({ id: string; action: "completion.picked" } & import("@ep0ch/outline-core/protocol").CompletionPickedRequest)
  | ({ id: string; action: "search.picked" } & import("@ep0ch/outline-core/protocol").SearchPickedRequest)
  | { id: string; action: "search.picks" }
  /**
   * An extension's command-palette source answers a query (PIE-656, the door's power bar): `{ extension, source,
   * rows: [{ id, label, detail?, preview?, block?, action?, args?, copy? }] }`. It writes nothing.
   */
  | { id: string; action: "extensions.bar"; extension: string; source: string; query: string; near?: string; limit?: number }
  /**
   * An action's write group taken back whole (PIE-784): `undo` is the id its answer gave. Every block it made goes to
   * the Trash, every edit, move and order is put back, in one step, as `mutation`; refused when any of it changed since.
   * `{ undone, extension, action, written }`.
   */
  | { id: string; action: "extensions.undo"; undo: string; mutation?: MutationProvenance }
  | { id: string; action: "scripts.sequence"; blockId: string; line: number; clientId: string; invitation?: string; mutation: MutationProvenance }
  | { id: string; action: "scripts.stop"; run: string; mutation?: MutationProvenance }
  | { id: string; action: "scripts.run"; blockId: string; access: import("@ep0ch/outline-core/protocol").McpAccessLevel; mutation: MutationProvenance; /** The door a script's `act` goes to (PIE-957); with none, the only door here, else a refusal naming them. */ door?: string }
  | { id: string; action: "scripts.answer"; requestId: string; clientId: string; result?: unknown; error?: string }
  /**
   * What an action asks for (its declared `args`, PIE-784), each with the choices it has on `blockId` and its value
   * when not given: what a client prompts with. `{ extension, action, args: [{ name, type, …, choices?, value? }] }`.
   */
  | { id: string; action: "extensions.args"; extension: string; extensionAction: string; blockId?: string }
  /** Runs one of an extension's schedules now (PIE-754): `entry` is `action:<id>` or `handler:<key>`; recorded as any run. */
  | { id: string; action: "extensions.schedule.run"; extension: string; entry: string }
  /**
   * A built-in from the repo's extensions folder installed (as `ext add <name>`): into the user folder (every outline
   * the host serves) or `where: "outline"`, this one's own. Answers once its page and demo notes are written:
   * `{ id, lines, page?, hub?, state?, error? }`.
   */
  | { id: string; action: "extensions.install"; extension: string; where?: "user" | "outline"; mutation?: MutationProvenance }
  /**
   * An installed extension removed (its folder deleted), and its demo notes kept or moved to Trash as `demo` says
   * (no default: they never go silently). `{ id, lines, removed, demo: { trashed, kept, left } }`.
   */
  | { id: string; action: "extensions.uninstall"; extension: string; demo: "keep" | "remove"; mutation?: MutationProvenance }
  /** Capability `extensions.configure` (PIE-1343): config.json's settings and secret references, checked against the schema, written on this host. */
  | ({ id: string; action: "extensions.configure"; mutation?: MutationProvenance } & import("@ep0ch/outline-core/protocol").ExtensionsConfigureRequest)
  /** Capability `extensions.render`: the results of a block's handler lines (or the one on `line`) in `target`. */
  | { id: string; action: "extensions.render"; blockId: string; line?: number; target: string; fallback?: string }
  /** Capability `extensions.act`: an extension's action on a block (and line), or on a tile with `args`. */
  | {
      id: string; action: "extensions.act"; extension: string; extensionAction: string; blockId?: string; line?: number; args?: Record<string, string>; passage?: import("@ep0ch/outline-core/passage").Passage; clientId?: string;
      /** A press (PIE-957): the one-run invitation the door minted for it, and the button it pressed (the note and line). */
      invitation?: string;
      button?: { block: string; line?: number };
      /**
       * Capability `extensions.act.requester`: who asks (the person, or an agent with its actor id). The writes
       * stay `ext:<id>`'s; the change feed records this beside them as `requestedBy`. `author`/`provenance`
       * are read the same way, as on `create`.
       */
      mutation?: MutationProvenance;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  /** Compare-and-swap on spans of notes' text (capability `draft.patch`). */
  | ({ id: string; action: "draft.patch" } & DraftPatchInput)
  /**
   * EchoNet's mail (ADR 0005, src/echonet-mail.ts): the outline's bulletin (what its areas publish, or null), a packet
   * handed to it for its own tosser to import, and the packets it holds for a node that dials in (taken, then `ack`ed).
   * They write no block and read no access level.
   */
  | { id: string; action: "echonet.bulletin" }
  | { id: string; action: "echonet.put"; from: string; packet: unknown }
  | { id: string; action: "echonet.take"; for: string; ack?: string[] }
  /** "Apply anyway": a proposal block's patch as an ordinary edit (capability `draft.proposal.apply`). */
  | { id: string; action: "draft.proposal.resolve"; proposalId: string; mutation: MutationProvenance }
  | { id: string; action: "draft.proposal.apply"; proposalId: string; mutation: MutationProvenance }
  /** Dismiss a proposal without applying it (capability `draft.proposal.dismiss`). */
  | { id: string; action: "draft.proposal.dismiss"; proposalId: string; mutation: MutationProvenance }
  /** The open proposals beside a note, each with the line it is drawn after (PIE-725, `DraftProposalsBeside`). */
  | { id: string; action: "draft.proposals.list"; blockId: string }
  /** `mutation` needs capability `mutations.provenance`; without it the change is unattributed. */
  | ({ id: string; action: "move"; blockId: string; expectedRevision: number; mutation?: MutationProvenance } & import("@ep0ch/outline-core/protocol").NoteMoveIntent)
  /**
   * `expectedRevision`: trash only the block as read; a block changed since is refused and stays. `ifEmpty`: trash
   * only a block with no text and no children ("Block is not empty"); a child added doesn't change the revision.
   */
  | { id: string; action: "delete"; blockId: string; expectedRevision?: number; ifEmpty?: boolean; mutation?: MutationProvenance }
  | { id: string; action: "trash.restore"; blockId: string; mutation?: MutationProvenance }
  /**
   * A block's earlier texts (PIE-621): without `revision` the list (BlockRevisions), with it that revision's whole
   * text. Going back is an ordinary `update` with that text, recorded as whoever writes it.
   */
  | { id: string; action: "block.revisions"; blockId: string; revision?: number; latest?: boolean }
  | { id: string; action: "trash.purge"; blockId: string; confirmation: string }
  | {
      id: string;
      action: "virtual.occurrences.reorder";
      viewId: string;
      orderedBlockIds: string[];
      /** Who reordered: recorded as a `move` on each block placed, and on the change. */
      mutation?: MutationProvenance;
    }
  | { id: string; action: "virtual.occurrences.order"; viewId: string }
  | { id: string; action: "working-selection.get"; ownerClientId: string }
  | { id: string; action: "working-selection.save"; input: WorkingSelectionSaveInput }
  | { id: string; action: "working-selection.recoverable"; ownerClientId: string }
  | { id: string; action: "working-selection.resume"; ownerClientId: string; selectionId: string; expectedRevision: number }
  /** `mutation`: who moved it, recorded as a `move` on each block whose place changed, and on the change. */
  | { id: string; action: "virtual.occurrences.move"; input: VirtualOccurrenceMoveInput; mutation?: MutationProvenance }
  /** `mutation`: who placed them, recorded as a `move` on each block whose place changed, and on the change. */
  | { id: string; action: "virtual.occurrences.place"; input: VirtualBranchPlacementInput; mutation?: MutationProvenance }
  | { id: string; action: "references.resolve"; text: string }
  /** Notes named the way a person types them (an id, ((id)), an id's first 8+ characters, a Work ID, a [[page]]): each one's block id, or why not, with a did-you-mean (PIE-875). Read-only. */
  | { id: string; action: "blocks.resolve"; refs: string[]; includeTrashed?: boolean }
  /** The outline's callout types (PIE-538): the built-ins and those its notes declare with [callout-type::name]. */
  | { id: string; action: "callouts.types" }
  /** The outline's heading styles (PIE-599): the built-ins and those its notes declare with [heading-style::name]. */
  | { id: string; action: "headings.styles" }
  /** The outline's style sheets (PIE-673): each [style-for::…] note or line with its style.* fields; the cascade is outline-core's. */
  | { id: string; action: "styles.list" }
  /** Every component's schema (PIE-618): the built-ins with the outline's own styles and types as values, and the extensions'. */
  | { id: string; action: "components.schemas" }
  | { id: string; action: "components.usage" }
  /** What a writer asks the service to keep of an ask to Jev (PIE-1251): the suggestion's record and the day's run, made by the service whether or not the writer waits. */
  | { id: string; action: "suggestions.keep"; keep: SuggestionKeep }
  /** What a rule note (its text, not saved) draws on a sample note's text: a component page's rule variations (PIE-618). */
  | { id: string; action: "rules.preview"; note: string; text: string }
  | ({ id: string; action: "references.backlinks"; query: BacklinkQuery; sourceTarget?: { block: Block; outline: string; addresses: string[] } } & WatchFields)
  | { id: string; action: "pages.resolve"; address: string }
  | {
      id: string;
      action: "pages.follow";
      address: string;
      author?: BlockAuthor;
      provenance?: BlockProvenance;
    }
  | { id: string; action: "pages.complete"; query?: string; limit: number; semantic?: boolean; contextBlockId?: string }
  | {
      id: string;
      action: "pages.rename";
      blockId: string;
      address: string;
      expectedRevision: number;
    }
  | { id: string; action: "pages.alias"; blockId: string; address: string }
  | {
      id: string;
      action: "pages.remove";
      blockId: string;
      address: string;
      expectedRevision: number;
    }
  | {
      id: string;
      action: "properties.patch";
      blockId: string;
      expectedRevision: number;
      operations: PropertyPatchOperation[];
      mutation: MutationProvenance;
    }
  | {
      id: string;
      action: "activity.recent";
      afterCursor?: number;
      since?: string;
      limit?: number;
      author?: BlockAuthor;
      /** Capability `mutations.provenance`. Defaults to the edit kinds, `text` and `properties`. */
      kinds?: BlockActivityKind[];
      /**
       * Capability `activity.extensions`: `exclude` leaves out what extensions
       * wrote (`actorId` `ext:…`, a refreshed ticket), `only` keeps just that.
       * Absent: everything, as before.
       */
      extensions?: "exclude" | "only";
      /** `hide` (the default) leaves out notes tools stamped `[machine::…]`; `only` holds just those; `show` everything (PIE-867). */
      machinery?: import("@ep0ch/outline-core/machinery").MachineryMode;
      /** Capability `activity.actor`: only entries recorded with this actor id (`claude-code`, `ext:jira`…). */
      actorId?: string;
      /** Capability `activity.actor`: only blocks whose latest matching entry is below this cursor (the next page). */
      beforeCursor?: number;
    }
  | {
      id: string;
      action: "properties.catalog";
      key?: string;
      prefix?: string;
      limit?: number;
      propertyScope?: PropertyQueryScope;
      /** With no key: one row per key (its notes counted, value empty), not one per key and value (PIE-1344). */
      keys?: boolean;
    }
  | { id: string; action: "selection.get" }
  | { id: string; action: "selection.set"; blockId: string | null }
  | { id: string; action: "navigation.state" }
  | { id: string; action: "navigation.back" }
  | { id: string; action: "navigation.forward" }
  | { id: string; action: "work-ids.status" }
  | { id: string; action: "work-ids.configure"; prefix: string }
  | {
      id: string;
      action: "work-ids.allocate";
      blockId: string;
      expectedRevision: number;
      /** Who stamped it: an agent's allocation is attributed. */
      mutation?: MutationProvenance;
    }
  | {
      id: string; action: "changes.since";
      /** The cursor: the changes after it are answered. The last page's `nextSequence`. To start from now, ask with `Number.MAX_SAFE_INTEGER`: the `reset` it answers has the current `sequence`. */
      sequence: number;
      /** At most this many changes (default 200, at most 1000); a page never splits one sequence. */
      limit?: number;
      /** `hide` leaves out changes to notes tools stamped `[machine::…]`; `only` holds just those; `show` (the default here: the feed is how a client catches up, so it holds everything unless asked) everything. Each change says `machinery: true` when its note is stamped (PIE-867). */
      machinery?: import("@ep0ch/outline-core/machinery").MachineryMode;
    }
  /**
   * A note's address (PIE-767): the outline, this host's machine name, the note's `ep0ch://` URI and, when it is
   * published, its web URLs (`NoteAddress`). Without `blockId`, the outline and machine alone. Reads only.
   */
  | { id: string; action: "notes.address"; blockId?: string }
  /**
   * A note and the notes under it rendered by the publisher's renderer, as its published page reads (PIE-767),
   * published or not: Markdown, or the HTML article (`RenderedNote`). `audience: "public"` links only public notes;
   * `marks` draws its open highlights and margin notes in the HTML. A `[publish::never]` note is refused. Reads only.
   */
  | { id: string; action: "notes.render"; blockId: string; format: "markdown" | "html"; audience?: "tailnet" | "public"; marks?: boolean }
  /**
   * A share session (`ShareSession`): a short-lived public link to the whole outline, as the tailnet's web client shows
   * it, or with `scope` (a block id) to that note and below only. `open`: the note the link opens on (inside it). `ttl`: `30m`, `1h` (the default), up
   * to `24h`, or seconds. `comments` (default true) lets the link's reader highlight, comment, ask and reply. `mutation`
   * names who started it. Answers the session with its `url` (when a public listener has said where it is opened).
   */
  | { id: string; action: "outline.snapshot"; webUrl?: string; ttl?: string | number; out?: string; mutation?: MutationProvenance }
  | { id: string; action: "shares.snapshot.take"; token: string; ip: string; userAgent: string; method: string }
  | { id: string; action: "shares.snapshot.finish"; shareId: string; fetched: boolean; bytes: number }
  | { id: string; action: "shares.start"; scope?: string; artifact?: string; open?: string; ttl?: string | number; comments?: boolean; via?: string; allowMail?: string | string[]; mutation?: MutationProvenance }
  /** The open share sessions, soonest to end first (`all`: the ones ended this week too). */
  | { id: string; action: "shares.list"; all?: boolean }
  /** Ends one share session now (its link answers 410), or with `all: true` every open one. */
  | { id: string; action: "shares.revoke"; shareId?: string; all?: boolean }
  /** The publisher's per-request check of a link's token (`ShareResolution` in share-sessions.ts). */
  | { id: string; action: "shares.resolve"; token: string }
  /**
   * The publisher running a `cloudflare` share's tunnel says how it went: up on `host` (process `pid`), or failed
   * with `error` (the share ends). `shares.start` waits for this to answer with the link.
   */
  | { id: string; action: "shares.tunnel"; shareId: string; host?: string; pid?: number; error?: string }
  /** A web client page's presence (the publisher posts it): the page and the words selected on it (`ReaderView`). */
  | { id: string; action: "reader.report"; view: Record<string, unknown> }
  /** What a reader of the web client has in front of them now: the latest reader's view (or `reader`'s), and every reader seen lately. */
  | { id: string; action: "reader.view"; reader?: string; since?: number };

/** Machine-readable detail for a rejected request, such as a query syntax position. */
export interface SelectionContext {
  selected: Block | null;
  ancestors: Block[];
  children: Block[];
}

export interface NavigationState {
  selection: SelectionContext;
  canBack: boolean;
  canForward: boolean;
}

export interface BrowsingContextState {
  contextId: string;
  target: OutlinerNavigationTarget | null;
}

export interface BrowsingContextPublication extends BrowsingContextState {
  preview?: OutlinerNavigationDispatch;
  unavailable?: string;
}

export interface WorkspaceSnapshotView {
  query?: BlockSearchQuery;
}

export interface WorkspaceSnapshot {
  visible: VisibleBlockCollection;
  physical: VisibleBlockCollection;
  selection: SelectionContext;
  virtualOccurrenceRanks: VirtualOccurrenceRank[];
  sequence: number;
  workIdPrefix?: string;
  /** Every prefix a ticket key may have here (`work-ids.status`'s `prefixesInUse`), when there are any. */
  ticketPrefixes?: string[];
}

export interface TreeIndexSnapshot {
  blocks: TreeIndexBlock[];
  physicalBlockIds: string[];
  visible: {
    rows: Pick<VisibleBlock, "id" | "depth" | "propertyMatches">[];
    completeness: BlockCollectionCompleteness;
  };
  selectedBlockId: string | null;
  virtualOccurrenceRanks: VirtualOccurrenceRank[];
  sequence: number;
  workIdPrefix?: string;
  /** Every prefix a ticket key may have here (`work-ids.status`'s `prefixesInUse`), when there are any. */
  ticketPrefixes?: string[];
}

export type OutlinerUiCommand = (
  | {
      targetClientId: string;
      command: "focus";
      target?: OutlinerNavigationTarget;
      focus?: boolean;
    }
  | {
      targetClientId: string;
      command: "edit" | "reveal";
      target: Extract<OutlinerNavigationTarget, { kind: "block" }>;
      focus?: boolean;
    }
  | {
      targetClientId: string;
      command: "preview" | "open" | "replace";
      target: OutlinerNavigationTarget;
      focus?: boolean;
    }
  | {
      targetClientId: string;
      command: "backlinks.select";
      targetBlockId: string;
      sourceBlockId: string;
    }
  | {
      targetClientId: string;
      command: "comment.selection";
      renderedSelection: RenderedSelectionCapture;
    }) & { targetRegion?: OutlinerRegion };

export interface OutlinerNavigationResolution {
  sourceClientId: string;
  targetClientId: string;
  intent: OutlinerNavigationIntent;
  resolution: "self" | "context" | "same-tab" | "linked" | "chosen";
  targetRegion?: OutlinerRegion;
}

export interface OutlinerNavigationDispatch extends OutlinerNavigationResolution {
  command: OutlinerUiCommand;
}

export type OutlinerEventDomain =
  | "mentions"
  | "content"
  | "resource-catalog"
  | "selection"
  | "view"
  | "ui"
  | "attention"
  | "browsing-context"
  /** A request to the door holding a live draft (`draft`), sent only to that client. */
  | "draft"
  | "script"
  /** Share sessions started or ended (`shares.changed`), sent to publishers: a tunnel to start or stop. */
  | "shares"
  /** The extension registry changed (`extensions.changed`): read `extensions.list` again. */
  | "extensions"
  /** `agents.yolo`: yolo went on or off for the outline (`yolo`), sent to every client (PIE-973). */
  | "agents"
  /** `queries.changed`: watched answers that changed, sent only to the connection that watches them (ADR 0004). */
  | "queries";

export interface OutlinerEvent {
  ask?: import("@ep0ch/outline-core/protocol").AskProgress;
  id: string;
  domain: OutlinerEventDomain;
  action: string;
  sequence: number;
  clientId?: string;
  blockId?: string;
  resourceId?: string;
  sourceId?: string;
  contextId?: string;
  command?: OutlinerUiCommand;
  attention?: AttentionClientState;
  /** On an `agents` event: whether yolo is on now. */
  yolo?: boolean;
  attentionInstruction?: AttentionInstruction;
  /** On a `draft` event: what the service asks the door holding the draft (PIE-501). */
  draft?: DraftHolderRequest;
  script?: import("@ep0ch/outline-core/protocol").ScriptActionCall;
  /** On a `scripts.ended` event: the run that ended and how. */
  ended?: import("@ep0ch/outline-core/protocol").ScriptEnded;
  /** On a `scripts.undone` event: the run whose writes were taken back. */
  undone?: { run: string };
  /** On a `queries.changed` event: the watches whose answer changed, or that were dropped. */
  changes?: QueryChange[];
  /**
   * The committed change this event reports, identical to its `changes.since`
   * entry: one event per change (`view` for branch-local ranks). Absent on a
   * `content` event for a request that committed nothing.
   */
  change?: OutlinerChange;
}

/**
 * What a content change did. `reorder` changed branch-local ranks of the virtual
 * branch named by `blockId`. `other` covers workspace-wide changes without one
 * primary block (for example Work-ID configuration);
 * clients that cannot interpret a change should reload the affected projection.
 */
export type OutlinerChangeKind =
  | "create"
  | "edit"
  | "move"
  | "delete"
  | "restore"
  | "purge"
  | "annotate"
  | "draft"
  | "reorder"
  | "other";

export interface OutlinerChange {
  /** Service sequence after the change; changes are ordered by sequence, then `changeId`. */
  sequence: number;
  /** Monotonic feed position; unique even when two changes share a sequence. */
  changeId: number;
  /** The request (or internal) action that caused the change. */
  action: string;
  kind: OutlinerChangeKind;
  /** Primary block. Other blocks (a moved subtree, reordered siblings) may change too. */
  blockId?: string;
  /** Parent after the change; `null` for a root. Absent without a readable block. */
  parentId?: string | null;
  /** Parent before a `move`. */
  previousParentId?: string | null;
  /** Block revision after the change. */
  revision?: number;
  /** True when the block is in Trash after the change. */
  deleted?: boolean;
  /** Declared provenance of the request; absent when the request carried none. */
  actor?: MutationProvenance;
  /**
   * Who asked for the change when that isn't its writer: an extension's action (`actor` `ext:<id>`) run for
   * the person or an agent (`extensions.act`'s `mutation`). Absent when the writer acted on its own.
   */
  requestedBy?: MutationProvenance;
  /** An edit that moved only `[key::value]` tokens (a stage move, a stamp, a sync): the words are as they were (PIE-867). */
  bookkeeping?: true;
  /** The note is one a tool stamped `[machine::…]`: what it wrote for its own bookkeeping, hidden from the readers' lists by default (PIE-867). */
  machinery?: true;
  recordedAt: string;
}

export type ChangeFeedPage =
  | {
      kind: "changes";
      /** Ordered by sequence then changeId; a page never splits one sequence. */
      changes: OutlinerChange[];
      /**
       * Pass as the next `sequence`. A complete page returns `sequence` (every
       * change through it was checked, including activity the feed does not
       * describe); a truncated page returns the last whole sequence it covers.
       */
      nextSequence: number;
      completeness: BlockCollectionCompleteness;
      /** Current service sequence when the page was read. */
      sequence: number;
    }
  | {
      kind: "reset";
      /**
       * `history-unavailable`: changes after the requested sequence are no longer
       * retained. `sequence-ahead`: the cursor is newer than this workspace.
       * Either way, reload the complete projection and resume from its sequence.
       */
      reason: "history-unavailable" | "sequence-ahead";
      /** Oldest cursor the feed can still answer completely. */
      oldestSequence: number;
      sequence: number;
    };

export interface OutlinerEventEnvelope {
  event: OutlinerEvent;
}
