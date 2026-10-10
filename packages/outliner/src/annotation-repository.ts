import {resolveAnnotationPassage, passageResolutionStatus, passageDocumentRepresentation} from "./annotation-passages";
import {observeDocument} from "./document-provenance";
import {resourceDocumentObservation} from "./document-resources";
import { blockCommentTarget } from "./block-comments";
import { resourceTextRevision } from "@ep0ch/outline-core/protocol";
import { resourceCommentSource, resourceCommentTarget } from "./resource-comments";
import type { SequenceChange } from "./change-feed";
import { blockAnnotationRepresentation } from "./annotation-representations";
import { checklistItems, updateChecklistText } from "./checklist-items";
import {readCaptureBefore} from "./capture-history";
import { Database } from "bun:sqlite";
import {
  annotationSourceHash,
  createTextQuoteAnchor,
  createAnnotationReferenceContext,
  formatAnnotationBlock,
  normalizeAnnotationCreateInput,
  normalizePassageResolution,
  normalizeAnnotationRepresentation,
  normalizeAnnotationSubject,
  normalizeAnnotationTarget,
  normalizeResolutionMethod,
  normalizeResolutionReviewer,
  parseAnnotationBlockContent,
  parseStoredRepresentation,
  parseStoredTarget,
  type AnnotationBlockContent,
  normalizeResolutionCandidate,
} from "./annotations";
import { authoredResourceReferenceOccurrences } from "./resource-references";
import { reanchorAnnotationTarget } from "./annotation-reanchoring";
import type { ResourceCatalog } from "./resource-catalog";
import type {
  AnnotationAgentEvidenceSample,
  AnnotationAgentEvidenceSummary,
  AnnotationAgentPromptPackage,
  AnnotationAgentProposalInput,
  AnnotationAgentProposalReceipt,
  AnnotationAgentReviewInput,
  AnnotationApproveResolutionInput,
  AnnotationBatchOperation,
  AnnotationBatchReceipt,
  AnnotationCreateInput,
  AnnotationLifecycleInput,
  AnnotationListQuery,
  AnnotationRecord,
  AnnotationPassageResolution,
  AnnotationPassageSlice,
  AnnotationReconcileInput,
  AnnotationReconcileReceipt,
  AnnotationRepresentation,
  AnnotationReferenceContext,
  AnnotationResolutionCandidate,
  AnnotationResolutionEvent,
  AnnotationResolutionMethod,
  AnnotationResolutionReviewer,
  AnnotationResolutionStatus,
  AnnotationSource,
  AnnotationSubject,
  ResourceCommentInput,
  ResourceReconcileInput,
  AnnotationTarget,
  AnnotationThread,
  Block,
  BlockAuthor,
  BlockProvenance,
  MutationProvenance,
  PdfPageText,
} from "./types";

const SYSTEM_ANNOTATIONS_ROOT_ID = "7674db6f-6639-4d49-bb63-9ed50cdbba08";
const TEXT_CODEC = { kind: "codec", codecId: "text-quote", codecVersion: 1 } as const;
const REFERENCE_CONTEXT_CODEC = { kind: "codec", codecId: "reference-context", codecVersion: 1 } as const;
const AGENT_AUTOMATIC_THRESHOLD = 0.95;
const AGENT_BODY_LIMIT = 4_000;
const AGENT_PASSAGE_LIMIT = 2_000;
const AGENT_CONTEXT_LIMIT = 1_000;
const AGENT_PACKAGE_LIMIT = 24_000;

interface AnnotationTargetRow {
  annotation_block_id: string;
  block_id: string | null;
  resource_id: string | null;
  legacy_source_block_id: string | null;
  legacy_file_path: string | null;
  original_target_json: string;
  created_at: string;
}

interface ResolutionRow {
  id: string;
  annotation_block_id: string;
  sequence: number;
  source_representation_json: string;
  target_representation_json: string;
  resolved_target_json: string | null;
  passage_resolution_json?: string | null;
  method_json: string;
  reviewer_json: string;
  candidates_json: string;
  confidence: number | null;
  status: AnnotationResolutionStatus;
  applies_current: number;
  created_at: string;
}

type AnnotationResourceEvidenceRole =
  | "original-target"
  | "event-source"
  | "event-target"
  | "event-resolved"
  | "event-candidate";

interface AnnotationRequestRow {
  payload_hash: string | null;
  annotation_ids: string;
}

interface AgentRequestRow {
  payload_hash: string;
  event_id: string;
}

interface AgentEvidenceRow extends ResolutionRow {
  accepted_by: "automatic" | "human";
  accepted_target_json: string | null;
  accepted_count: number;
  automatic_count: number;
}

interface RepositoryBlocks {
  readonly create: (
    text: string,
    parentId: string | null,
    author: BlockAuthor,
    provenance?: BlockProvenance,
  ) => Block;
  readonly update: (
    blockId: string,
    text: string,
    expectedRevision: number,
    mutation: MutationProvenance,
  ) => Block;
  readonly insertCanonical: (
    id: string,
    text: string,
    parentId: string | null,
    author: BlockAuthor,
    createdAt: string,
  ) => Block;
  readonly replaceCanonicalText: (blockId: string, text: string) => Block;
  /** Advances the sequence and records `change` in the caller's transaction. */
  readonly markMutation: (change: SequenceChange) => void;
  readonly requireActive: (blockId: string) => Block;
  readonly get: (blockId: string) => Block | null;
  readonly listAnnotations: () => Block[];
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} cannot be empty`);
  return value.trim();
}

function iso(value: string, label: string): string {
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be an ISO timestamp`);
  return value;
}

function json(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

function sameSubject(left: AnnotationSubject, right: AnnotationSubject): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "block" && right.kind === "block") return left.blockId === right.blockId;
  if (left.kind === "resource" && right.kind === "resource") return left.resourceId === right.resourceId;
  return left.kind === "legacy-file" &&
    right.kind === "legacy-file" &&
    left.sourceBlockId === right.sourceBlockId &&
    left.filePath === right.filePath;
}

function sameRepresentation(
  left: AnnotationRepresentation,
  right: AnnotationRepresentation,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function referenceContextInBlock(
  context: AnnotationReferenceContext,
  block: Block | null,
): { context: AnnotationReferenceContext | null; status: "resolved" | "ambiguous" | "orphaned" } {
  if (!block || block.effectiveDeletedRootId || block.deletedAt) return { context: null, status: "orphaned" };
  if (block.text === context.sourceText) return { context, status: "resolved" };
  const start = context.anchor.start!;
  const end = context.anchor.end!;
  const lineStart = context.sourceText.lastIndexOf("\n", start - 1) + 1;
  const newline = context.sourceText.indexOf("\n", start);
  const lineEnd = newline < 0 ? context.sourceText.length : newline;
  if (end > lineEnd) return { context: null, status: "orphaned" };
  const line = context.sourceText.slice(lineStart, lineEnd);
  const matches = (text: string): number[] => {
    const result: number[] = [];
    let offset = 0;
    for (const candidate of text.split("\n")) {
      if (candidate === line) result.push(offset);
      offset += candidate.length + 1;
    }
    return result;
  };
  const before = matches(context.sourceText);
  const after = matches(block.text);
  // A unique survivor cannot identify which of two earlier equal lines survived.
  if (before.length !== 1 || after.length > 1) return { context: null, status: "ambiguous" };
  if (after.length === 0) return { context: null, status: "orphaned" };
  const mappedStart = after[0]! + start - lineStart;
  try {
    return { context: createAnnotationReferenceContext(block, mappedStart, mappedStart + end - start), status: "resolved" };
  } catch {
    return { context: null, status: "orphaned" };
  }
}

function payloadHash(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Annotation request payload cannot be serialized");
  return new Bun.CryptoHasher("sha256").update(serialized).digest("hex");
}

function boundedSlice(value: string, maximum: number): { readonly text: string; readonly truncated: boolean } {
  if (value.length <= maximum) return { text: value, truncated: false };
  return { text: value.slice(0, maximum), truncated: true };
}

function targetPassage(target: AnnotationTarget): string {
  const anchor = target.anchor;
  if (anchor.kind === "whole-subject") return "Whole note";
  if (anchor.kind === "list-item") return `Checklist item ^${anchor.itemId}`;
  if (anchor.kind === "text-quote" || anchor.kind === "dom-range") return anchor.exact;
  if (anchor.kind === "pdf-page-region") return anchor.exact ?? `PDF page ${anchor.page}`;
  if (anchor.kind === "structured-entity-field") return `${anchor.entityType}/${anchor.entityId}/${anchor.fieldPath.join(".")}`;
  return `${anchor.provider}:${anchor.commentId}`;
}

function eventFromRow(row: ResolutionRow): AnnotationResolutionEvent {
  const status = row.status;
  if (
    status !== "resolved" &&
    status !== "probable" &&
    status !== "unresolved" &&
    status !== "ambiguous" &&
    status !== "orphaned" &&
    status !== "unsupported" &&
    status !== "rejected"
  ) throw new Error(`Invalid stored annotation resolution status: ${String(status)}`);
  const resolvedTarget = row.resolved_target_json === null ? null : parseStoredTarget(row.resolved_target_json);
  const method = normalizeResolutionMethod(json(row.method_json, "Resolution method"));
  const reviewer = normalizeResolutionReviewer(json(row.reviewer_json, "Resolution reviewer"));
  const rawCandidates = json(row.candidates_json, "Resolution candidates");
  if (!Array.isArray(rawCandidates)) throw new Error("Resolution candidates must be an array");
  const candidates = rawCandidates.map(normalizeResolutionCandidate);
  const appliesCurrent = row.applies_current === 1;
  if (row.applies_current !== 0 && !appliesCurrent) throw new Error("Invalid stored appliesCurrent value");
  if (status === "resolved" && (!resolvedTarget || !appliesCurrent || row.confidence === null)) {
    throw new Error("Resolved annotation event is incomplete");
  }
  const isAgentProposal = method.kind === "agent" && !appliesCurrent;
  if (status === "probable" &&
    (resolvedTarget !== null || row.confidence === null || candidates.length === 0 ||
      (!appliesCurrent && !isAgentProposal))) {
    throw new Error("probable annotation event requires scored candidates without applying a target");
  }
  if (status === "unresolved" && (
    resolvedTarget !== null ||
    !appliesCurrent ||
    ((row.confidence === null) !== (candidates.length === 0))
  )) throw new Error("unresolved annotation event evidence is inconsistent");
  if ((status === "ambiguous" || status === "orphaned") && (
    resolvedTarget !== null ||
    (appliesCurrent ? row.confidence !== null : !isAgentProposal || row.confidence === null) ||
    (status === "ambiguous" && isAgentProposal && candidates.length < 2) ||
    (status === "orphaned" && candidates.length > 0)
  )) throw new Error(`${status} annotation event evidence is inconsistent`);
  if (status === "unsupported" && (resolvedTarget !== null || !appliesCurrent || row.confidence !== null)) {
    throw new Error("unsupported annotation event cannot carry a resolved target or confidence");
  }
  if (status === "rejected" && (resolvedTarget !== null || appliesCurrent)) {
    throw new Error("Rejected annotation event cannot apply current or carry a resolved target");
  }
  if (row.confidence !== null && (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) {
    throw new Error("Stored annotation confidence is outside 0-1");
  }
  return {
    id: text(row.id, "Resolution event ID"),
    annotationId: text(row.annotation_block_id, "Resolution annotation ID"),
    sequence: row.sequence,
    sourceRepresentation: parseStoredRepresentation(row.source_representation_json),
    targetRepresentation: parseStoredRepresentation(row.target_representation_json),
    resolvedTarget,
    ...(row.passage_resolution_json ? {passageResolution: normalizePassageResolution(json(row.passage_resolution_json, "Passage resolution"))} : {}),
    method,
    reviewer,
    confidence: row.confidence,
    candidates,
    status,
    appliesCurrent,
    createdAt: iso(row.created_at, "Resolution event time"),
  };
}

export class AnnotationRepository {
  constructor(
    private readonly database: Database,
    private readonly resources: ResourceCatalog,
    private readonly blocks: RepositoryBlocks,
  ) {}

  create(
    requestId: string,
    input: AnnotationCreateInput,
    author: BlockAuthor = "user",
    provenance?: BlockProvenance,
  ): AnnotationBatchReceipt {
    return this.batch(requestId, [{ operationId: "create", type: "create", input }], author, provenance);
  }

  reply(
    requestId: string,
    input: { readonly annotationId: string; readonly body: string; readonly source: AnnotationSource },
    author: BlockAuthor = "user",
    provenance?: BlockProvenance,
  ): AnnotationBatchReceipt {
    return this.batch(requestId, [{ operationId: "reply", type: "reply", input }], author, provenance);
  }

  batch(
    requestId: string,
    operations: readonly AnnotationBatchOperation[],
    author: BlockAuthor = "user",
    provenance?: BlockProvenance,
  ): AnnotationBatchReceipt {
    const normalizedRequestId = text(requestId, "Annotation request ID");
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > 100) {
      throw new Error("Annotation batch must contain 1-100 operations");
    }
    const hash = payloadHash(operations);
    return this.database.transaction((): AnnotationBatchReceipt => {
      const existing = this.database.query(
        "SELECT payload_hash, annotation_ids FROM annotation_requests WHERE request_id = ?",
      ).get(normalizedRequestId) as AnnotationRequestRow | null;
      if (existing) {
        if (existing.payload_hash !== hash) {
          throw new Error(`Annotation request ID was already used with different input: ${normalizedRequestId}`);
        }
        const ids = json(existing.annotation_ids, "Annotation request receipt");
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
          throw new Error(`Corrupt annotation request receipt: ${normalizedRequestId}`);
        }
        return { annotations: ids.map((id) => this.get(id)), deduplicated: true };
      }
      const operationIds = new Set<string>();
      const prepared = operations.map((operation) => {
        const operationId = text(operation.operationId, "Annotation operation ID");
        if (operationIds.has(operationId)) {
          throw new Error(`Duplicate annotation operationId: ${operationId}`);
        }
        operationIds.add(operationId);
        if (operation.type === "create" || operation.type === "block-comment" || operation.type === "resource-comment") {
          let raw: AnnotationCreateInput;
          if (operation.type === "resource-comment") raw = this.resourceComment(operation.input);
          else if (operation.type === "block-comment") {
            const request = operation.input;
            if (!request || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
              throw new Error("Block comment requires a positive expectedRevision");
            }
            const block = this.blocks.requireActive(text(request.blockId, "Comment block ID"));
            // Read at an older revision: a passage that says what's around it (prefix, suffix) is checked as any passage
            // target is (outline-core passage.ts): found once with that context, it moves; else refused. One that
            // doesn't is refused as stale.
            const context = request.passage && (request.passage.prefix !== undefined || request.passage.suffix !== undefined);
            if (block.revision !== request.expectedRevision && !context) throw new Error("Comment source revision is stale; read the current block before commenting");
            const passage = block.revision !== request.expectedRevision && request.passage ? { ...request.passage, start: undefined } : request.passage;
            raw = { target: blockCommentTarget(block, passage), body: request.body, source: request.source, ...(request.properties ? { properties: request.properties } : {}) };
          } else raw = operation.input;
          const input = normalizeAnnotationCreateInput(raw);
          this.requireSubject(input.target.representation.subject);
          this.validateCapture(input.target);
          return { type: "create" as const, input };
        }
        if (operation.type !== "reply") throw new Error("Unsupported annotation batch operation");
        const annotationId = text(operation.input.annotationId, "Reply annotation ID");
        this.requireRoot(annotationId);
        return {
          type: "reply" as const,
          input: {
            annotationId,
            body: text(operation.input.body, "Annotation body"),
            source: operation.input.source,
          },
        };
      });
      const creates = prepared.filter(operation => operation.type === "create");
      const attached = this.attachChecklistItems(creates.map(operation => operation.input), author, provenance);
      let createIndex = 0;
      const records = prepared.map((operation) => {
        if (operation.type === "create") {
          const capture = attached[createIndex++]!;
          return this.createFromCurrentWrite(capture.input, author, provenance, capture.currentTarget, capture.currentPassageTargets);
        }
        return this.replyFromCurrentWrite(operation.input, author, provenance);
      });
      this.database.query(
        "INSERT INTO annotation_requests (request_id, payload_hash, annotation_ids, created_at) VALUES (?, ?, ?, ?)",
      ).run(normalizedRequestId, hash, JSON.stringify(records.map((record) => record.block.id)), new Date().toISOString());
      return { annotations: records, deduplicated: false };
    })();
  }

  get(annotationId: string): AnnotationRecord {
    const block = this.blocks.requireActive(text(annotationId, "Annotation ID"));
    const content = parseAnnotationBlockContent(block);
    const rootId = content.parentAnnotationId ?? block.id;
    const root = this.targetRow(rootId);
    return this.materialize(content, root);
  }

  list(query: AnnotationListQuery): AnnotationThread[] {
    if (!query || typeof query !== "object") throw new Error("Annotation list query must be an object");
    const subject = normalizeAnnotationSubject(query.subject, false);
    if (subject.kind === "legacy-file") throw new Error("legacy-file subjects are migration-only");
    const rows = subject.kind === "block"
      ? this.database.query(`SELECT * FROM annotation_targets WHERE block_id = ?
          OR json_extract(original_target_json, '$.referenceContext.representation.subject.blockId') = ?
          OR EXISTS (SELECT 1 FROM json_each(json_extract(original_target_json, '$.passage.documents')) document
            WHERE json_extract(document.value, '$.subject.kind') = 'block'
              AND json_extract(document.value, '$.subject.blockId') = ?)
          ORDER BY created_at, annotation_block_id`).all(subject.blockId, subject.blockId, subject.blockId)
      : this.database.query(`SELECT * FROM annotation_targets WHERE resource_id = ?
          OR EXISTS (SELECT 1 FROM json_each(json_extract(original_target_json, '$.passage.documents')) document
            WHERE json_extract(document.value, '$.subject.kind') = 'resource'
              AND json_extract(document.value, '$.subject.resourceId') = ?)
          ORDER BY created_at, annotation_block_id`).all(subject.resourceId, subject.resourceId);
    const rootIds = new Set((rows as AnnotationTargetRow[]).map((row) => row.annotation_block_id));
    if (rootIds.size === 0) return [];
    const replyIds = this.database.query(`
      SELECT DISTINCT parent.block_id AS id
      FROM block_properties parent
      JOIN block_properties type ON type.block_id = parent.block_id
      WHERE parent.scope = 'block' AND parent.key = 'parent-annotation'
        AND parent.value IN (SELECT value FROM json_each(?))
        AND type.scope = 'block' AND type.key = 'type'
        AND type.value IN ('annotation', 'annotation-reply')
        AND NOT EXISTS (
          SELECT 1 FROM annotation_migration_quarantine quarantine
          WHERE quarantine.annotation_block_id = parent.block_id
        )
    `).all(JSON.stringify([...rootIds])) as Array<{ id: string }>;
    const repliesByParent = new Map<string, AnnotationBlockContent[]>();
    for (const { id } of replyIds) {
      const candidate = this.blocks.get(id);
      if (!candidate || candidate.effectiveDeletedRootId) continue;
      const reply = parseAnnotationBlockContent(candidate);
      if (!reply.parentAnnotationId || !rootIds.has(reply.parentAnnotationId)) continue;
      const siblings = repliesByParent.get(reply.parentAnnotationId) ?? [];
      siblings.push(reply);
      repliesByParent.set(reply.parentAnnotationId, siblings);
    }
    for (const replies of repliesByParent.values()) {
      replies.sort((left, right) =>
        left.block.createdAt.localeCompare(right.block.createdAt) ||
        left.block.id.localeCompare(right.block.id)
      );
    }
    return (rows as AnnotationTargetRow[]).flatMap((row) => {
      const block = this.blocks.get(row.annotation_block_id);
      if (!block || block.effectiveDeletedRootId) return [];
      const content = parseAnnotationBlockContent(block);
      if (query.lifecycle && content.lifecycle !== query.lifecycle) return [];
      if (query.includeResolved === false && content.lifecycle === "resolved") return [];
      const root = this.materialize(content, row);
      const replies = (repliesByParent.get(root.block.id) ?? [])
        .map((reply) => this.materialize(reply, row));
      return [{ ...root, replies }];
    });
  }

  reconcile(input: AnnotationReconcileInput | ResourceReconcileInput): AnnotationReconcileReceipt {
    if (!input || typeof input !== "object") throw new Error("Annotation reconcile input must be an object");
    const subject = normalizeAnnotationSubject(input.subject, false);
    if (subject.kind === "legacy-file") throw new Error("legacy-file subjects are migration-only");
    let revision: number | undefined;
    let given = "newRepresentation" in input ? input.newRepresentation : undefined;
    let givenContent = "content" in input ? input.content : undefined;
    if (given === undefined) {
      // A Resource is read by the service (PIE-650): a client asking for its threads needs no copy of its text.
      if (subject.kind !== "resource") throw new Error("Annotation reconcile needs the new representation of a block");
      const source = resourceCommentSource(this.resources.describe(subject.resourceId, true));
      if (!source) {
        // Moved, deleted or unreadable: the threads stay, as last resolved, and the receipt says why.
        return { threads: this.list({ subject, includeResolved: true }), changed: false, unavailable: "the Resource's text can't be read now (the file moved or is gone, or nothing is stored)" };
      }
      given = source.representation;
      givenContent = source.text;
      if (source.representation.contentHash) revision = resourceTextRevision(source.representation.contentHash);
    }
    const representation = normalizeAnnotationRepresentation(given, false);
    if (!sameSubject(subject, representation.subject)) {
      throw new Error("Reconciliation representation subject does not match the requested subject");
    }
    const content = givenContent === undefined ? this.representationContent(representation) : givenContent;
    if (content !== null && typeof content !== "string") {
      throw new Error("Annotation reconciliation content must be a string");
    }
    if (
      content !== null &&
      representation.contentHash !== null &&
      annotationSourceHash(content) !== representation.contentHash
    ) throw new Error("Annotation reconciliation content hash does not match the representation");
    const pdfPages = this.representationPdfPages(representation);
    const threads = this.list({ subject, includeResolved: true });
    let changed = false;
    this.database.transaction(() => {
      for (const thread of threads) {
        changed = this.reconcileOne(thread, representation, content, pdfPages) || changed;
      }
      if (changed) this.blocks.markMutation({ kind: "annotate" });
    })();
    return { threads: this.list({ subject, includeResolved: true }), changed, ...(revision === undefined ? {} : { revision }) };
  }

  /**
   * A `resource-comment` operation as the `create` it stands for: the Resource's text read now, the quote
   * anchored in it, and the note whose link opened it kept as the reference context.
   */
  private resourceComment(request: ResourceCommentInput): AnnotationCreateInput {
    if (!request || typeof request !== "object") throw new Error("Resource comment input must be an object");
    const resourceId = text(request.resourceId, "Comment Resource ID");
    const source = resourceCommentSource(this.resources.describe(resourceId, true));
    if (!source) throw new Error("This Resource has no stored text a comment can quote (a PDF, a ticket, or a file that is gone)");
    const target = resourceCommentTarget(source, request.expectedRevision, request.passage);
    let referenceContext: AnnotationReferenceContext | undefined;
    if (request.referenceBlockId !== undefined) {
      const host = this.blocks.requireActive(text(request.referenceBlockId, "Comment reference block ID"));
      const contexts = authoredResourceReferenceOccurrences(host.text)
        .filter(occurrence => occurrence.kind === "authored-resource")
        .map(occurrence => createAnnotationReferenceContext(host, occurrence.start, occurrence.end))
        .filter(context => this.referenceContextResourceId(context) === resourceId);
      if (contexts.length === 0) throw new Error("The reference note has no link to this Resource");
      referenceContext = contexts[0];
    }
    return { target: { ...target, ...(referenceContext ? { referenceContext } : {}) }, body: request.body, source: request.source, ...(request.properties ? { properties: request.properties } : {}) };
  }

  approve(input: AnnotationApproveResolutionInput): AnnotationRecord {
    if (!input || typeof input !== "object") throw new Error("Annotation approval input must be an object");
    const annotationId = text(input.annotationId, "Annotation ID");
    const target = normalizeAnnotationTarget(input.target, false);
    const root = this.requireRoot(annotationId);
    const original = parseStoredTarget(root.original_target_json);
    if (original.passage) throw new Error("Rendered passage approval requires resolving its individual source fragments");
    if (!sameSubject(original.representation.subject, target.representation.subject)) {
      throw new Error("Approved target must belong to the annotation subject");
    }
    if (original.referenceContext) {
      if (!target.referenceContext || !sameSubject(original.referenceContext.representation.subject, target.referenceContext.representation.subject)) {
        throw new Error("Approved context must preserve the original host");
      }
      this.validateCapture(target);
    } else if (target.referenceContext) {
      throw new Error("Approval cannot change a global annotation into a contextual annotation");
    }
    if (original.listItemId !== target.listItemId) throw new Error("Approval must preserve checklist item identity");
    if (original.listItemId) this.validateCapture(target);
    this.requireSubject(target.representation.subject);
    return this.database.transaction(() => {
      const current = this.currentEvent(annotationId);
      this.appendEvent({
        annotationId,
        sourceRepresentation: current.targetRepresentation,
        targetRepresentation: target.representation,
        resolvedTarget: target,
        method: { kind: "human", method: "approved-target" },
        reviewer: { kind: "user", id: "protocol" },
        confidence: 1,
        candidates: [],
        status: "resolved",
        appliesCurrent: true,
      });
      this.blocks.markMutation({ kind: "annotate", blockId: annotationId });
      return this.get(annotationId);
    })();
  }

  agentPackage(annotationIdValue: string): AnnotationAgentPromptPackage {
    const annotationId = text(annotationIdValue, "Annotation ID");
    const record = this.get(annotationId);
    if (record.parentAnnotationId) throw new Error("Agent reconciliation belongs to the root annotation");
    const current = record.currentResolution;
    const deterministicFailure =
      current.method.kind === "codec" &&
      current.reviewer.kind === "system" &&
      current.reviewer.id === "annotation-repository" &&
      (current.method.method === "quote-context" || current.method.method === "local-fuzzy") &&
      ["probable", "unresolved", "ambiguous", "orphaned"].includes(current.status);
    if (!deterministicFailure) {
      throw new Error("Only failed deterministic reconciliations can be sent to an agent");
    }
    const original = record.originalTarget.anchor;
    const originalPassage = boundedSlice(targetPassage(record.originalTarget), AGENT_PASSAGE_LIMIT);
    const originalPrefix = boundedSlice(
      original.kind === "text-quote" ? original.prefix : "",
      AGENT_CONTEXT_LIMIT,
    );
    const originalSuffix = boundedSlice(
      original.kind === "text-quote" ? original.suffix : "",
      AGENT_CONTEXT_LIMIT,
    );
    const body = boundedSlice(record.body, AGENT_BODY_LIMIT);
    let annotationBody = body.text;
    let packageOriginalPassage = originalPassage.text;
    let packageOriginalPrefix = originalPrefix.text;
    let packageOriginalSuffix = originalSuffix.text;
    let truncated = body.truncated ||
      originalPassage.truncated ||
      originalPrefix.truncated ||
      originalSuffix.truncated;
    const packageLength = (
      candidates: readonly AnnotationAgentPromptPackage["candidates"][number][],
      packageTruncated: boolean,
    ) => JSON.stringify({
      annotationId,
      baseEventId: current.id,
      annotationBody,
      originalPassage: packageOriginalPassage,
      originalPrefix: packageOriginalPrefix,
      originalSuffix: packageOriginalSuffix,
      candidates,
      truncated: packageTruncated,
      characterCount: AGENT_PACKAGE_LIMIT,
    }).length;
    while (packageLength([], truncated) > AGENT_PACKAGE_LIMIT) {
      const maximum = Math.max(
        annotationBody.length,
        packageOriginalPassage.length,
        packageOriginalPrefix.length,
        packageOriginalSuffix.length,
      );
      if (maximum === 0) throw new Error("Annotation reconciliation package metadata exceeds its limit");
      if (annotationBody.length === maximum) {
        annotationBody = annotationBody.slice(0, Math.floor(annotationBody.length / 2));
      } else if (packageOriginalPassage.length === maximum) {
        packageOriginalPassage = packageOriginalPassage.slice(
          0,
          Math.floor(packageOriginalPassage.length / 2),
        );
      } else if (packageOriginalPrefix.length === maximum) {
        packageOriginalPrefix = packageOriginalPrefix.slice(
          0,
          Math.floor(packageOriginalPrefix.length / 2),
        );
      } else {
        packageOriginalSuffix = packageOriginalSuffix.slice(
          0,
          Math.floor(packageOriginalSuffix.length / 2),
        );
      }
      truncated = true;
    }
    const candidates: AnnotationAgentPromptPackage["candidates"][number][] = [];
    for (let index = 0; index < Math.min(current.candidates.length, 8); index += 1) {
      const candidate = current.candidates[index]!;
      const anchor = candidate.target.anchor;
      const passage = boundedSlice(targetPassage(candidate.target), AGENT_PASSAGE_LIMIT);
      const prefix = boundedSlice(
        anchor.kind === "text-quote" ? anchor.prefix : "",
        AGENT_CONTEXT_LIMIT,
      );
      const suffix = boundedSlice(
        anchor.kind === "text-quote" ? anchor.suffix : "",
        AGENT_CONTEXT_LIMIT,
      );
      const section = {
        index,
        deterministicMethod: candidate.method,
        deterministicConfidence: candidate.confidence,
        passage: passage.text,
        prefix: prefix.text,
        suffix: suffix.text,
      };
      const nextTruncated =
        truncated || passage.truncated || prefix.truncated || suffix.truncated;
      if (packageLength([...candidates, section], nextTruncated) > AGENT_PACKAGE_LIMIT) {
        truncated = true;
        break;
      }
      candidates.push(section);
      truncated = nextTruncated;
    }
    if (candidates.length < current.candidates.length) truncated = true;
    const packageWithoutCount = {
      annotationId,
      baseEventId: current.id,
      annotationBody,
      originalPassage: packageOriginalPassage,
      originalPrefix: packageOriginalPrefix,
      originalSuffix: packageOriginalSuffix,
      candidates,
      truncated,
    };
    let characterCount = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const nextCount = JSON.stringify({ ...packageWithoutCount, characterCount }).length;
      if (nextCount === characterCount) break;
      characterCount = nextCount;
    }
    const promptPackage = { ...packageWithoutCount, characterCount };
    if (JSON.stringify(promptPackage).length > AGENT_PACKAGE_LIMIT) {
      throw new Error("Annotation reconciliation package exceeds its limit");
    }
    return promptPackage;
  }

  agentReceipt(requestIdValue: string): AnnotationAgentProposalReceipt | null {
    const requestId = text(requestIdValue, "Agent reconciliation request ID");
    if (requestId.length > 200) throw new Error("Agent reconciliation request ID must be at most 200 characters");
    const existing = this.database.query(
      "SELECT payload_hash, event_id FROM annotation_agent_requests WHERE request_id = ?",
    ).get(requestId) as AgentRequestRow | null;
    if (!existing) return null;
    const proposal = this.eventById(existing.event_id);
    return {
      annotation: this.get(proposal.annotationId),
      proposal,
      deduplicated: true,
    };
  }

  proposeAgent(requestIdValue: string, input: AnnotationAgentProposalInput): AnnotationAgentProposalReceipt {
    const requestId = text(requestIdValue, "Agent reconciliation request ID");
    if (!input || typeof input !== "object") throw new Error("Agent proposal input must be an object");
    const annotationId = text(input.annotationId, "Annotation ID");
    if (requestId.length > 200) throw new Error("Agent reconciliation request ID must be at most 200 characters");
    const baseEventId = text(input.baseEventId, "Base resolution event ID");
    const modelId = text(input.modelId, "Agent model ID");
    if (modelId.length > 200) throw new Error("Agent model ID must be at most 200 characters");
    if (!input.result || typeof input.result !== "object") throw new Error("Agent result must be an object");
    const result = input.result;
    if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
      throw new Error("Agent confidence must be between 0 and 1");
    }
    const method = normalizeResolutionMethod({
      kind: "agent",
      modelId,
      method: "semantic-reconciliation",
      rationale: result.rationale,
      evidence: result.evidence,
    });
    const normalizedResult = result.status === "reanchored"
      ? {
          status: result.status,
          candidateIndex: Number.isSafeInteger(result.candidateIndex) ? result.candidateIndex : -1,
          confidence: result.confidence,
          rationale: method.kind === "agent" ? method.rationale : "",
          evidence: method.kind === "agent" ? method.evidence : [],
        }
      : result.status === "ambiguous"
        ? {
            status: result.status,
            candidateIndexes: Array.isArray(result.candidateIndexes) &&
                result.candidateIndexes.length >= 2 &&
                result.candidateIndexes.length <= 8
              ? result.candidateIndexes.map((index) => Number.isSafeInteger(index) ? index : -1)
              : [],
            confidence: result.confidence,
            rationale: method.kind === "agent" ? method.rationale : "",
            evidence: method.kind === "agent" ? method.evidence : [],
          }
        : result.status === "orphaned"
          ? {
              status: result.status,
              confidence: result.confidence,
              rationale: method.kind === "agent" ? method.rationale : "",
              evidence: method.kind === "agent" ? method.evidence : [],
            }
          : (() => { throw new Error("Agent result status must be reanchored, ambiguous, or orphaned"); })();
    const hash = payloadHash({ annotationId, baseEventId });
    return this.database.transaction((): AnnotationAgentProposalReceipt => {
      const existing = this.database.query(
        "SELECT payload_hash, event_id FROM annotation_agent_requests WHERE request_id = ?",
      ).get(requestId) as AgentRequestRow | null;
      if (existing) {
        if (existing.payload_hash !== hash) throw new Error("Agent reconciliation request ID was reused with different input");
        const proposal = this.eventById(existing.event_id);
        return { annotation: this.get(annotationId), proposal, deduplicated: true };
      }
      const promptPackage = this.agentPackage(annotationId);
      if (promptPackage.baseEventId !== baseEventId) {
        throw new Error("Agent proposal is stale because the annotation resolution changed");
      }
      const current = this.currentEvent(annotationId);
      let proposal: AnnotationResolutionEvent;
      if (normalizedResult.status === "reanchored") {
        if (normalizedResult.candidateIndex >= promptPackage.candidates.length) {
          throw new Error("Agent selected a candidate that was not supplied in its prompt package");
        }
        const candidate = current.candidates[normalizedResult.candidateIndex];
        if (!candidate) throw new Error("Agent selected an unavailable candidate");
        const automatic = normalizedResult.confidence >= AGENT_AUTOMATIC_THRESHOLD;
        if (automatic) this.validateReferenceContext(candidate.target);
        proposal = this.appendEvent({
          annotationId,
          sourceRepresentation: current.targetRepresentation,
          targetRepresentation: current.targetRepresentation,
          resolvedTarget: automatic ? candidate.target : null,
          method,
          reviewer: { kind: "agent", id: modelId },
          confidence: normalizedResult.confidence,
          candidates: [candidate],
          status: automatic ? "resolved" : "probable",
          appliesCurrent: automatic,
        });
      } else if (normalizedResult.status === "ambiguous") {
        const indexes = [...new Set(normalizedResult.candidateIndexes)];
        if (indexes.length < 2) throw new Error("Ambiguous agent result requires at least two candidates");
        if (indexes.some((index) => index >= promptPackage.candidates.length)) {
          throw new Error("Agent selected a candidate that was not supplied in its prompt package");
        }
        const candidates = indexes.map((index) => {
          const candidate = current.candidates[index];
          if (!candidate) throw new Error("Agent selected an unavailable candidate");
          return candidate;
        }).sort((left, right) => right.confidence - left.confidence);
        proposal = this.appendEvent({
          annotationId,
          sourceRepresentation: current.targetRepresentation,
          targetRepresentation: current.targetRepresentation,
          resolvedTarget: null,
          method,
          reviewer: { kind: "agent", id: modelId },
          confidence: normalizedResult.confidence,
          candidates,
          status: "ambiguous",
          appliesCurrent: false,
        });
      } else {
        proposal = this.appendEvent({
          annotationId,
          sourceRepresentation: current.targetRepresentation,
          targetRepresentation: current.targetRepresentation,
          resolvedTarget: null,
          method,
          reviewer: { kind: "agent", id: modelId },
          confidence: normalizedResult.confidence,
          candidates: [],
          status: "orphaned",
          appliesCurrent: false,
        });
      }
      this.database.query(
        "INSERT INTO annotation_agent_requests (request_id, payload_hash, event_id, created_at) VALUES (?, ?, ?, ?)",
      ).run(requestId, hash, proposal.id, new Date().toISOString());
      this.blocks.markMutation({ kind: "annotate", blockId: annotationId });
      return { annotation: this.get(annotationId), proposal, deduplicated: false };
    })();
  }

  reviewAgent(input: AnnotationAgentReviewInput): AnnotationRecord {
    if (!input || typeof input !== "object") throw new Error("Agent review input must be an object");
    const annotationId = text(input.annotationId, "Annotation ID");
    const proposalEventId = text(input.proposalEventId, "Proposal event ID");
    if (input.decision !== "accept" && input.decision !== "reject") {
      throw new Error("Agent review decision must be accept or reject");
    }
    return this.database.transaction(() => {
      this.requireRoot(annotationId);
      const proposal = this.eventById(proposalEventId);
      if (proposal.annotationId !== annotationId || proposal.method.kind !== "agent" || proposal.appliesCurrent) {
        throw new Error("Resolution event is not a reviewable agent proposal");
      }
      const reviewed = this.history(annotationId).some((event) =>
        event.method.kind === "human" && event.method.proposalEventId === proposalEventId
      );
      if (reviewed) throw new Error("Agent proposal was already reviewed");
      const current = this.currentEvent(annotationId);
      if (!sameRepresentation(current.targetRepresentation, proposal.targetRepresentation)) {
        throw new Error("Agent proposal is stale because the annotation representation changed");
      }
      if (input.decision === "reject") {
        this.appendEvent({
          annotationId,
          sourceRepresentation: current.targetRepresentation,
          targetRepresentation: proposal.targetRepresentation,
          resolvedTarget: null,
          method: { kind: "human", method: "rejected-agent-proposal", proposalEventId },
          reviewer: { kind: "user", id: "protocol" },
          confidence: proposal.confidence,
          candidates: proposal.candidates,
          status: "rejected",
          appliesCurrent: false,
        });
      } else if (proposal.status === "orphaned") {
        this.appendEvent({
          annotationId,
          sourceRepresentation: current.targetRepresentation,
          targetRepresentation: proposal.targetRepresentation,
          resolvedTarget: null,
          method: { kind: "human", method: "accepted-agent-proposal", proposalEventId },
          reviewer: { kind: "user", id: "protocol" },
          confidence: null,
          candidates: [],
          status: "orphaned",
          appliesCurrent: true,
        });
      } else {
        const candidateIndex = input.candidateIndex ?? (proposal.candidates.length === 1 ? 0 : -1);
        const candidate = Number.isSafeInteger(candidateIndex) ? proposal.candidates[candidateIndex] : undefined;
        if (!candidate) throw new Error("Agent proposal acceptance requires a valid candidate index");
        if (candidate.target.referenceContext && current.sequence > proposal.sequence) {
          throw new Error("Agent proposal is stale because the annotation resolution changed");
        }
        this.validateReferenceContext(candidate.target);
        this.appendEvent({
          annotationId,
          sourceRepresentation: current.targetRepresentation,
          targetRepresentation: proposal.targetRepresentation,
          resolvedTarget: candidate.target,
          method: { kind: "human", method: "accepted-agent-proposal", proposalEventId },
          reviewer: { kind: "user", id: "protocol" },
          confidence: 1,
          candidates: [],
          status: "resolved",
          appliesCurrent: true,
        });
      }
      this.blocks.markMutation({ kind: "annotate", blockId: annotationId });
      return this.get(annotationId);
    })();
  }

  agentEvidence(limitValue = 50): AnnotationAgentEvidenceSummary {
    if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      throw new Error("Agent evidence limit must be an integer between 1 and 100");
    }
    const rows = this.database.query(`
      WITH reviews AS (
        SELECT
          json_extract(method_json, '$.proposalEventId') AS proposal_event_id,
          resolved_target_json,
          ROW_NUMBER() OVER (
            PARTITION BY json_extract(method_json, '$.proposalEventId')
            ORDER BY sequence
          ) AS review_order
        FROM annotation_resolution_events
        WHERE json_extract(method_json, '$.kind') = 'human'
          AND json_extract(method_json, '$.method') = 'accepted-agent-proposal'
      )
      SELECT
        agent.*,
        CASE
          WHEN agent.status = 'resolved' AND agent.applies_current = 1 THEN 'automatic'
          ELSE 'human'
        END AS accepted_by,
        CASE
          WHEN agent.status = 'resolved' AND agent.applies_current = 1
            THEN agent.resolved_target_json
          ELSE review.resolved_target_json
        END AS accepted_target_json,
        COUNT(*) OVER () AS accepted_count,
        SUM(CASE
          WHEN agent.status = 'resolved' AND agent.applies_current = 1 THEN 1
          ELSE 0
        END) OVER () AS automatic_count
      FROM annotation_resolution_events agent
      LEFT JOIN reviews review
        ON review.proposal_event_id = agent.id AND review.review_order = 1
      WHERE json_extract(agent.method_json, '$.kind') = 'agent'
        AND agent.confidence IS NOT NULL
        AND (
          (agent.status = 'resolved' AND agent.applies_current = 1) OR
          review.proposal_event_id IS NOT NULL
        )
      ORDER BY agent.created_at, agent.id
      LIMIT ?
    `).all(limitValue) as AgentEvidenceRow[];
    const acceptedCount = rows[0]?.accepted_count ?? 0;
    const automaticCount = rows[0]?.automatic_count ?? 0;
    const humanReviewedCount = acceptedCount - automaticCount;
    let passageTruncated = false;
    const samples = rows.map((row): AnnotationAgentEvidenceSample => {
      const proposal = eventFromRow(row);
      if (proposal.method.kind !== "agent" || proposal.confidence === null) {
        throw new Error("Stored agent evidence row is invalid");
      }
      const original = parseStoredTarget(this.targetRow(proposal.annotationId).original_target_json);
      const resolved = row.accepted_target_json === null
        ? null
        : parseStoredTarget(row.accepted_target_json);
      const originalPassage = boundedSlice(targetPassage(original), AGENT_PASSAGE_LIMIT);
      const resolvedPassage = resolved === null
        ? null
        : boundedSlice(targetPassage(resolved), AGENT_PASSAGE_LIMIT);
      passageTruncated ||= originalPassage.truncated || resolvedPassage?.truncated === true;
      return {
        annotationId: proposal.annotationId,
        proposalEventId: proposal.id,
        modelId: proposal.method.modelId,
        outcome: proposal.status === "ambiguous"
          ? "ambiguous"
          : proposal.status === "orphaned"
            ? "orphaned"
            : "reanchored",
        acceptedBy: row.accepted_by,
        confidence: proposal.confidence,
        originalPassage: originalPassage.text,
        resolvedPassage: resolvedPassage?.text ?? null,
        rationale: proposal.method.rationale,
        evidence: proposal.method.evidence,
      };
    });
    return {
      acceptedCount,
      automaticCount,
      humanReviewedCount,
      samples,
      truncated: acceptedCount > samples.length || passageTruncated,
    };
  }

  setLifecycle(input: AnnotationLifecycleInput, mutation: MutationProvenance): AnnotationRecord {
    if (!input || typeof input !== "object") throw new Error("Annotation lifecycle input must be an object");
    const annotationId = text(input.annotationId, "Annotation ID");
    if (input.lifecycle !== "open" && input.lifecycle !== "resolved") throw new Error("Unsupported annotation lifecycle");
    const record = this.get(annotationId);
    if (record.parentAnnotationId) throw new Error("Annotation lifecycle belongs to the root thread");
    const promotedBlockIds = [...(record.promotedBlockIds ?? [])];
    if (input.promotedBlockId !== undefined) {
      const promotedBlockId = text(input.promotedBlockId, "Promoted block ID");
      this.blocks.requireActive(promotedBlockId);
      if (!promotedBlockIds.includes(promotedBlockId)) promotedBlockIds.push(promotedBlockId);
    }
    const updated = this.blocks.update(
      annotationId,
      formatAnnotationBlock(
        { target: record.resolvedTarget ?? record.originalTarget, body: record.body, source: record.source, ...(record.properties && Object.keys(record.properties).length ? { properties: record.properties } : {}) },
        undefined,
        { lifecycle: input.lifecycle, promotedBlockIds, allowLegacy: true },
      ),
      record.block.revision,
      mutation,
    );
    return this.materialize(parseAnnotationBlockContent(updated), this.targetRow(annotationId));
  }

  /** Passage slices and ordinary comments share the same per-note ID transaction.
   * Stale observations may retain an already observed ID, but cannot assign new
   * identities into a changed note using old offsets. */
  private attachChecklistItems(inputs: AnnotationCreateInput[], author: BlockAuthor, provenance?: BlockProvenance) {
    const exactInputs = [...inputs];
    const slices: Array<{input:number; slice:AnnotationPassageSlice; exactIndex?:number; itemId?:string}> = [];
    for (const [index, input] of inputs.entries()) {
      const passage = input.target.passage;
      if (!passage) continue;
      for (const fragment of passage.fragments) {
        if (fragment.kind !== "source") continue;
        for (const slice of fragment.slices) {
          const document = passage.documents[slice.document]!;
          if (document.subject.kind !== "block" || document.draft || document.inbox) continue;
          const item = checklistItems(document.text).filter(item =>
            item.span.start <= slice.anchor.start! && item.span.end >= slice.anchor.end!)
            .sort((a, b) => b.depth - a.depth)[0];
          if (slice.listItemId && (item?.itemId !== slice.listItemId || item.identity !== "unique")) {
            throw new Error("Passage checklist ID does not belong to the observed item");
          }
          if (!item) continue;
          if (item.identity === "duplicate") throw new Error(`Duplicate checklist item ID: ${item.itemId}`);
          const current = this.blocks.get(document.subject.blockId);
          const entry: typeof slices[number] = {input:index, slice, itemId:item.itemId};
          if (current && !current.deletedAt && !current.effectiveDeletedRootId && annotationSourceHash(current.text) === document.hash) {
            entry.exactIndex = exactInputs.length;
            exactInputs.push({...input, target:{representation:blockAnnotationRepresentation(current), anchor:slice.anchor,
              ...(item.itemId ? {listItemId:item.itemId} : {})}});
          }
          slices.push(entry);
        }
      }
    }
    const {captures:attached, edits} = this.attachExactChecklistItems(exactInputs, author, provenance);
    return inputs.map((input, index) => {
      if (!input.target.passage) return {...attached[index]!, currentPassageTargets:undefined};
      const identities = new Map<AnnotationPassageSlice,string>();
      const currentPassageTargets = new Map<string,AnnotationTarget>();
      for (const entry of slices.filter(entry => entry.input === index)) {
        const capture = entry.exactIndex === undefined ? undefined : attached[entry.exactIndex];
        const itemId = capture?.input.target.listItemId ?? entry.itemId;
        if (itemId) identities.set(entry.slice, itemId);
        if (capture?.currentTarget) currentPassageTargets.set(JSON.stringify([entry.slice.document, entry.slice.anchor]), capture.currentTarget);
      }
      const passage = input.target.passage;
      // ID insertions can move other captured text and repeated host tokens in
      // this same note. Replay those known edits, not a search for similar text.
      for (const fragment of passage.fragments) {
        const sources = fragment.kind === 'source' ? fragment.slices : fragment.kind === 'reference' ? [fragment.token] : [];
        const occurrence = fragment.kind === 'source' || fragment.kind === 'reference' ? fragment.occurrence : undefined;
        for (const slice of [...sources, ...(occurrence ? [occurrence.host, ...occurrence.path.map(step=>step.token)] : [])]) {
          const key = JSON.stringify([slice.document, slice.anchor]);
          if (currentPassageTargets.has(key)) continue;
          const observed = passage.documents[slice.document]!;
          if (observed.subject.kind !== 'block' || observed.draft || observed.inbox) continue;
          const edit = edits.get(observed.subject.blockId);
          if (!edit || edit.beforeHash !== observed.hash) continue;
          let start = slice.anchor.start!, end = slice.anchor.end!;
          for (const insertion of edit.insertions) {
            if (start >= insertion.at) start += insertion.length;
            if (end > insertion.at) end += insertion.length;
          }
          const block = this.blocks.requireActive(observed.subject.blockId);
          if (block.text.slice(start,end) !== slice.anchor.exact) continue;
          currentPassageTargets.set(key, {representation:blockAnnotationRepresentation(block),
            anchor:createTextQuoteAnchor(block.text,start,end)});
        }
      }
      return {input:{...input, target:{...input.target, passage:{...passage,
        fragments:passage.fragments.map(fragment => fragment.kind !== "source" ? fragment : {...fragment,
          slices:fragment.slices.map(slice => identities.has(slice) ? {...slice, listItemId:identities.get(slice)!} : slice)}),
      }}}, currentTarget:undefined, currentPassageTargets};
    });
  }

  /** Assign IDs once per note, inside the same transaction as comment creation. */
  private attachExactChecklistItems(inputs: AnnotationCreateInput[], author: BlockAuthor, provenance?: BlockProvenance) {
    const result: {input: AnnotationCreateInput; currentTarget?: AnnotationTarget}[] = inputs.map(input => ({input}));
    const edits = new Map<string,{beforeHash:string;insertions:Array<{at:number;length:number}>}>();
    const groups = new Map<string, number[]>();
    inputs.forEach((input, index) => {
      const {representation, anchor, referenceContext} = input.target;
      if (referenceContext || representation.subject.kind !== "block" || representation.sourceSnapshot.kind !== "block" ||
        representation.sourceSnapshot.inboxAttemptId || anchor.kind !== "text-quote" || anchor.start === null) return;
      const blockId = representation.subject.blockId;
      groups.set(blockId, [...(groups.get(blockId) ?? []), index]);
    });
    for (const [blockId, indexes] of groups) {
      const block = this.blocks.requireActive(blockId);
      const items = checklistItems(block.text);
      const selected = indexes.flatMap(index => {
        const anchor = inputs[index]!.target.anchor;
        if (anchor.kind !== "text-quote" || anchor.start === null || anchor.end === null) return [];
        const item = items.filter(item => item.span.start <= anchor.start! && item.span.end >= anchor.end! &&
          (!inputs[index]!.target.listItemId || item.itemId === inputs[index]!.target.listItemId))
          .sort((left, right) => right.depth - left.depth)[0];
        if (!item) return [];
        if (item.identity === "duplicate") throw new Error(`Duplicate checklist item ID: ${item.itemId}`);
        return [{index, item}];
      });
      // These are validated current-source captures. Replay only the ID insertions
      // performed in this transaction; keep original targets as immutable evidence.
      const ranges = new Map(selected.map(({index}) => {
        const anchor = inputs[index]!.target.anchor;
        if (anchor.kind !== "text-quote" || anchor.start === null || anchor.end === null) throw new Error("Missing capture range");
        return [index, {start: anchor.start, end: anchor.end, exact: anchor.exact}];
      }));
      let content = block.text;
      const insertions:Array<{at:number;length:number}>=[];
      const ids = new Map<number, string>();
      // Insert from the bottom so earlier source coordinates remain meaningful.
      for (const start of [...new Set(selected.map(entry => entry.item.span.start))].sort((a, b) => b - a)) {
        const item = checklistItems(content).find(item => item.span.start === start)!;
        const updated = updateChecklistText(content, block.revision, {
          target: {start, expectedRevision: block.revision}, expectedEvidence: item.evidence, change: {kind: "ensure-id"},
        });
        if (updated.text !== content) {
          let insertion = 0;
          while (content[insertion] === updated.text[insertion] && insertion < content.length) insertion++;
          const delta = updated.text.length - content.length;
          insertions.push({at:insertion,length:delta});
          for (const range of ranges.values()) {
            if (range.start >= insertion) range.start += delta;
            if (range.end > insertion) range.end += delta;
          }
        }
        content = updated.text;
        ids.set(start, updated.itemId);
      }
      if (content !== block.text) {
        this.blocks.update(blockId, content, block.revision, {author, ...provenance});
        edits.set(blockId,{beforeHash:annotationSourceHash(block.text),insertions});
      }
      for (const {index, item} of selected) {
        const listItemId = ids.get(item.span.start)!;
        const input = {...inputs[index]!, target: {...inputs[index]!.target, listItemId}};
        const range = ranges.get(index)!;
        result[index] = {input, ...(content.slice(range.start, range.end) === range.exact ? {
          currentTarget: {...input.target, representation: blockAnnotationRepresentation(this.blocks.requireActive(blockId)),
            anchor: createTextQuoteAnchor(content, range.start, range.end)},
        } : {})};
      }
    }
    return {captures:result,edits};
  }

  private createFromCurrentWrite(
    input: AnnotationCreateInput,
    author: BlockAuthor,
    provenance?: BlockProvenance,
    currentTarget?: AnnotationTarget,
    currentPassageTargets?: ReadonlyMap<string,AnnotationTarget>,
  ): AnnotationRecord {
    const subject = input.target.representation.subject;
    const parentId = subject.kind === "block" ? subject.blockId : this.ensureSystemRoot();
    const block = this.blocks.create(formatAnnotationBlock(input), parentId, author, provenance);
    this.insertTarget(block.id, input.target, block.createdAt);
    const current = subject.kind === "block" && input.target.listItemId ? this.blocks.requireActive(subject.blockId) : null;
    const representation = current ? blockAnnotationRepresentation(current) : input.target.representation;
    const resolution = current && !currentTarget ? reanchorAnnotationTarget(input.target, representation, current.text) : null;
    if (resolution && !resolution.resolvedTarget) throw new Error("Checklist comment lost its item during creation");
    const passageResolution = input.target.passage ? this.resolvePassage(input.target, undefined, currentPassageTargets) : undefined;
    const status = passageResolution ? passageResolutionStatus(passageResolution) : "resolved";
    this.appendEvent({
      ...(passageResolution ? {passageResolution} : {}),
      annotationId: block.id,
      sourceRepresentation: input.target.representation,
      targetRepresentation: representation,
      resolvedTarget: status === "resolved" ? currentTarget ?? resolution?.resolvedTarget ?? input.target : null,
      method: passageResolution ? {kind: "codec", codecId: "rendered-passage", codecVersion: 1, method: "capture"}
        : resolution?.method ?? { ...TEXT_CODEC, method: "capture" },
      reviewer: { kind: "system", id: "annotation-repository" },
      confidence: status === "resolved" ? 1 : null,
      candidates: [],
      status,
      appliesCurrent: true,
      createdAt: block.createdAt,
    });
    return this.get(block.id);
  }

  private replyFromCurrentWrite(
    input: { readonly annotationId: string; readonly body: string; readonly source: AnnotationSource },
    author: BlockAuthor,
    provenance?: BlockProvenance,
  ): AnnotationRecord {
    const root = this.get(input.annotationId);
    if (root.parentAnnotationId) throw new Error("Replies must attach directly to a root annotation");
    const block = this.blocks.create(
      formatAnnotationBlock(
        { target: root.resolvedTarget ?? root.originalTarget, body: input.body, source: input.source },
        root.block.id,
        { allowLegacy: true },
      ),
      root.block.id,
      author,
      provenance,
    );
    return this.materialize(parseAnnotationBlockContent(block), this.targetRow(root.block.id));
  }

  private resolvePassage(target: AnnotationTarget, initial?: AnnotationPassageResolution,
    captures?: ReadonlyMap<string,AnnotationTarget>): AnnotationPassageResolution {
    const admitted = new Map<string,AnnotationTarget>();
    target.passage!.fragments.forEach((fragment,index)=>{
      const position=initial?.fragments[index];
      const retain=(slice:AnnotationPassageSlice,value:AnnotationTarget|null|undefined)=>{
        if(value)admitted.set(JSON.stringify([slice.document,slice.anchor]),value);
      };
      const slices=fragment.kind==='source'?fragment.slices:fragment.kind==='reference'?[fragment.token]:[];
      slices.forEach((slice,source)=>retain(slice,position?.sources[source]?.resolvedTarget));
      if((fragment.kind==='source'||fragment.kind==='reference')&&fragment.occurrence){
        retain(fragment.occurrence.host,position?.occurrence?.host.resolvedTarget);
        fragment.occurrence.path.forEach((step,index)=>retain(step.token,position?.occurrence?.path[index]?.resolvedTarget));
      }
    });
    return normalizePassageResolution(resolveAnnotationPassage(target.passage!, target.representation.capturedAt, observed => {
      if (observed.subject.kind === "block") {
        const block = this.blocks.get(observed.subject.blockId);
        return block && !block.deletedAt && !block.effectiveDeletedRootId
          ? observeDocument(observed.subject, block.text, block.revision) : null;
      }
      if (observed.subject.kind === "resource") {
        try { return resourceDocumentObservation(this.resources.describe(observed.subject.resourceId, true)); }
        catch { return null; }
      }
      return null;
    }, slice => captures?.get(JSON.stringify([slice.document, slice.anchor])) ??
      admitted.get(JSON.stringify([slice.document,slice.anchor]))));
  }

  private reconcileOne(
    record: AnnotationRecord,
    representation: AnnotationRepresentation,
    content: string | null,
    pdfPages: readonly PdfPageText[],
  ): boolean {
    if (record.originalTarget.passage) {
      const passageResolution = this.resolvePassage(record.originalTarget, record.resolutionHistory[0]?.passageResolution);
      const located=record.originalTarget.referenceContext?this.locateReferenceContext(record):undefined;
      const status=located&&!located.context?located.status:passageResolutionStatus(passageResolution);
      const resolvedTarget=status==='resolved'
        ? {...record.originalTarget,...(located?.context?{referenceContext:located.context}:{})}:null;
      // Reading a file can change capture time without changing its source.
      const identity = (value: unknown) => JSON.stringify(value, (key, value) => key === "capturedAt" ? undefined : value);
      if (identity(record.currentResolution.passageResolution) === identity(passageResolution) &&
        record.currentResolution.status===status && identity(record.resolvedTarget)===identity(resolvedTarget)) return false;
      this.appendEvent({annotationId: record.block.id, passageResolution,
        sourceRepresentation: record.currentResolution.targetRepresentation,
        targetRepresentation: record.originalTarget.representation,
        resolvedTarget,
        method: located&&!located.context
          ? {...REFERENCE_CONTEXT_CODEC,method:'source-occurrence-unpositioned'}
          : {kind: "codec", codecId: "rendered-passage", codecVersion: 1, method: "reconcile"},
        reviewer: {kind: "system", id: "annotation-repository"}, confidence: status === "resolved" ? 1 : null,
        candidates: [], status, appliesCurrent: true});
      return true;
    }
    if (record.originalTarget.referenceContext) return this.reconcileContextual(record, representation, content, pdfPages);
    const sourceRepresentation = record.currentResolution.targetRepresentation;
    if (sameRepresentation(sourceRepresentation, representation)) return false;
    if (
      sourceRepresentation.sourceSnapshot.kind === "rendered" &&
      representation.sourceSnapshot.kind !== "rendered"
    ) return false;
    // Initial capture may have replayed ID insertions. It still quotes the original
    // words, but its context belongs to the committed source rather than pre-ID text.
    const captured = record.resolutionHistory[0]?.resolvedTarget;
    const originalEvidence = captured?.anchor.kind === "text-quote" && record.originalTarget.anchor.kind === "text-quote" &&
      captured.anchor.exact === record.originalTarget.anchor.exact && captured.listItemId === record.originalTarget.listItemId
      ? captured : record.originalTarget;
    const result = reanchorAnnotationTarget(
      record.originalTarget.listItemId
        ? ([...record.resolutionHistory].reverse().find(event => event.appliesCurrent && event.method.kind === "human")?.resolvedTarget ?? originalEvidence)
        : record.resolvedTarget ?? record.originalTarget,
      representation,
      content,
      pdfPages,
    );
    this.appendEvent({
      annotationId: record.block.id,
      sourceRepresentation,
      targetRepresentation: representation,
      resolvedTarget: result.resolvedTarget,
      method: result.method,
      reviewer: { kind: "system", id: "annotation-repository" },
      confidence: result.confidence,
      candidates: result.candidates,
      status: result.status,
      appliesCurrent: true,
    });
    return true;
  }

  private locateReferenceContext(record:AnnotationRecord) {
    const original = record.originalTarget;
    const lastApproval = [...record.resolutionHistory].reverse().find(event =>
      event.appliesCurrent && event.method.kind === "human" && event.resolvedTarget?.referenceContext);
    const evidence = lastApproval?.resolvedTarget?.referenceContext ?? original.referenceContext!;
    const hostSubject = evidence.representation.subject;
    if (hostSubject.kind !== "block") throw new Error("Reference context must belong to a block");
    const blocked = record.resolutionHistory.find(event => event.sequence > (lastApproval?.sequence ?? -1) &&
      event.appliesCurrent && event.method.kind === "codec" && event.method.codecId === "reference-context" && event.status !== "resolved");
    let located = blocked
      ? { context: null, status: blocked.status }
      : referenceContextInBlock(evidence, this.blocks.get(hostSubject.blockId));
    if (located.context && original.representation.subject.kind === "resource" &&
      this.referenceContextResourceId(located.context) !== original.representation.subject.resourceId) {
      located = { context: null, status: "orphaned" };
    }
    return {...located,blocked:!!blocked};
  }

  private reconcileContextual(
    record: AnnotationRecord,
    representation: AnnotationRepresentation,
    content: string | null,
    pdfPages: readonly PdfPageText[],
  ): boolean {
    const original = record.originalTarget;
    const located=this.locateReferenceContext(record);
    const sourceRepresentation = record.currentResolution.targetRepresentation;
    const resourceReconciliation = representation.subject.kind === "resource";
    const targetRepresentation = resourceReconciliation ? representation : sourceRepresentation;
    if (!located.context) {
      if (located.blocked && sameRepresentation(sourceRepresentation, targetRepresentation)) return false;
      this.appendEvent({
        annotationId: record.block.id, sourceRepresentation, targetRepresentation,
        resolvedTarget: null, method: { ...REFERENCE_CONTEXT_CODEC, method: "source-occurrence-unpositioned" },
        reviewer: { kind: "system", id: "annotation-repository" }, confidence: null,
        candidates: [], status: located.status, appliesCurrent: true,
      });
      return true;
    }
    const context = located.context;
    if (!resourceReconciliation) {
      // Host changes cannot repair an unresolved Resource passage.
      if (!record.resolvedTarget) return false;
      const target: AnnotationTarget = original.representation.subject.kind === "block"
        ? { representation: context.representation, anchor: context.anchor, referenceContext: context }
        : { ...record.resolvedTarget, referenceContext: context };
      if (JSON.stringify(target) === JSON.stringify(record.resolvedTarget)) return false;
      this.appendEvent({
        annotationId: record.block.id, sourceRepresentation, targetRepresentation: target.representation,
        resolvedTarget: target, method: { ...REFERENCE_CONTEXT_CODEC, method: "unique-source-line" },
        reviewer: { kind: "system", id: "annotation-repository" }, confidence: 1,
        candidates: [], status: "resolved", appliesCurrent: true,
      });
      return true;
    }
    if (sameRepresentation(sourceRepresentation, representation)) {
      if (record.resolvedTarget && JSON.stringify(record.resolvedTarget.referenceContext) !== JSON.stringify(context)) {
        return this.reconcileContextual(record, context.representation, context.sourceText, []);
      }
      return false;
    }
    const result = reanchorAnnotationTarget(record.resolvedTarget ?? original, representation, content, pdfPages);
    this.appendEvent({
      annotationId: record.block.id, sourceRepresentation, targetRepresentation: representation,
      resolvedTarget: result.resolvedTarget ? { ...result.resolvedTarget, referenceContext: context } : null,
      method: result.method, reviewer: { kind: "system", id: "annotation-repository" },
      confidence: result.confidence,
      candidates: result.candidates.map(candidate => ({ ...candidate, target: { ...candidate.target, referenceContext: context } })),
      status: result.status, appliesCurrent: true,
    });
    return true;
  }

  private referenceContextResourceId(context: AnnotationReferenceContext): string | null {
    const occurrence = authoredResourceReferenceOccurrences(context.sourceText).find(candidate =>
      candidate.start === context.anchor.start && candidate.end === context.anchor.end);
    if (!occurrence || occurrence.kind !== "authored-resource") return null;
    const lookup = this.resources.resolveAuthoredReference(occurrence.reference);
    return lookup.kind === "ready" ? lookup.resourceId : null;
  }

  private validateReferenceContext(target: AnnotationTarget): void {
    const context = target.referenceContext;
    if (context) {
      const hostSubject = context.representation.subject;
      if (hostSubject.kind !== "block") throw new Error("Reference context must belong to a block");
      const host = this.blocks.requireActive(hostSubject.blockId);
      if (host.text !== context.sourceText) throw new Error("Reference context block snapshot is stale");
      if (target.representation.subject.kind === "resource") {
        if (this.referenceContextResourceId(context) !== target.representation.subject.resourceId) {
          throw new Error("Reference context does not resolve to the annotation Resource");
        }
      } else if (target.representation.subject.kind !== "block" ||
        target.representation.subject.blockId !== hostSubject.blockId ||
        target.representation.contentHash !== context.representation.contentHash ||
        JSON.stringify(target.anchor) !== JSON.stringify(context.anchor)) {
        throw new Error("Occurrence-only annotations must target their exact host token");
      }
    }
  }

  private validateCapture(target: AnnotationTarget): void {
    this.validateReferenceContext(target);
    for (const observed of target.passage?.documents ?? []) {
      if (!observed.inbox || observed.subject.kind !== "block") continue;
      const saved = readCaptureBefore(this.database, observed.inbox.attemptId, observed.subject.blockId);
      if (!saved || saved.updatedAt !== observed.inbox.updatedAt || annotationSourceHash(saved.text) !== observed.hash ||
        (observed.revision !== undefined && saved.revision !== observed.revision)) {
        throw new Error("Annotation saved Inbox passage is unavailable or mismatched");
      }
    }
    const representation = target.representation;
    if (representation.sourceSnapshot.kind === "block") {
      const snapshot=representation.sourceSnapshot;
      const current=this.blocks.requireActive(snapshot.blockId);
      const block=snapshot.inboxAttemptId ? readCaptureBefore(this.database,snapshot.inboxAttemptId,snapshot.blockId) : current;
      if(!block || (snapshot.inboxAttemptId && block.updatedAt!==snapshot.updatedAt)) {
        throw new Error("Annotation saved Inbox source is unavailable or mismatched");
      }
      // Historical timestamps are observation metadata. Exact source bytes own
      // passage identity; moving the block cannot invalidate an annotation.
      if (annotationSourceHash(block.text) !== representation.sourceSnapshot.contentHash) {
        throw new Error("Annotation block snapshot is stale");
      }
    }
    // Rendered Resource quotes are separate observations, just like rendered
    // block quotes. Their source evidence lives in normalized passage fragments.
    // A bare rendered snapshot cannot replace provider evidence for older targets.
    if (representation.subject.kind === 'resource' && representation.sourceSnapshot.kind === 'rendered' &&
      (!target.passage || representation.sourceSnapshot.observation.validation !== 'preview-selection')) {
      throw new Error('Rendered Resource annotations require a captured passage');
    }
    const content = this.representationContent(representation);
    if (representation.subject.kind === "resource" && representation.sourceSnapshot.kind !== 'rendered' && content === null) {
      throw new Error("Annotation Resource representation evidence is unavailable");
    }
    if (
      representation.contentHash !== null &&
      content !== null &&
      annotationSourceHash(content) !== representation.contentHash
    ) throw new Error("Annotation representation content hash does not match captured content");
    if (target.listItemId) {
      const matches = content === null ? [] : checklistItems(content).filter(item => item.itemId === target.listItemId);
      if (matches.length !== 1 || matches[0]!.identity !== "unique") throw new Error("Checklist annotation item is missing or ambiguous");
      const item = matches[0]!;
      if (target.anchor.kind === "text-quote" && (target.anchor.start === null || target.anchor.end === null ||
        target.anchor.start < item.span.start || target.anchor.end > item.span.end)) {
        throw new Error("Checklist annotation quote is outside its item");
      }
    }
    if (
      (target.anchor.kind !== "text-quote" &&
        target.anchor.kind !== "pdf-page-region") ||
      content === null
    ) return;
    if (
      target.anchor.kind === "pdf-page-region" &&
      (
        target.anchor.start === null ||
        target.anchor.end === null ||
        target.anchor.exact === null ||
        target.anchor.prefix === null ||
        target.anchor.suffix === null
      )
    ) {
      throw new Error("New PDF annotations require quote range and context evidence");
    }
    const { start, end, exact, prefix, suffix } = target.anchor;
    if (exact === null || prefix === null || suffix === null) {
      throw new Error("PDF annotation quote evidence is incomplete");
    }
    if (start === null || end === null) {
      if (representation.observation?.quote !== exact) {
        throw new Error("Unpositioned annotation quote must match rendered evidence");
      }
      return;
    }
    if (target.anchor.kind === "pdf-page-region") {
      const pdfAnchor = target.anchor;
      const page = this.representationPdfPages(representation)
        .find(({ page: pageNumber }) => pageNumber === pdfAnchor.page);
      if (!page || start < page.start || end > page.end) {
        throw new Error("PDF annotation quote does not belong to its captured page");
      }
    }
    if (content.slice(start, end) !== exact) {
      throw new Error("Annotation quote does not match captured representation");
    }
    if (
      content.slice(Math.max(0, start - prefix.length), start) !== prefix ||
      content.slice(end, end + suffix.length) !== suffix
    ) throw new Error("Annotation quote context does not match captured representation");
  }

  private representationPdfPages(
    representation: AnnotationRepresentation,
  ): readonly PdfPageText[] {
    const subject = representation.subject;
    const snapshot = representation.sourceSnapshot;
    if (
      subject.kind !== "resource" ||
      snapshot.kind !== "resource" ||
      snapshot.resourceId !== subject.resourceId
    ) return [];
    const description = this.resources.describe(
      subject.resourceId,
      true,
      snapshot.revision ?? undefined,
    );
    const pdf = description.pdf;
    if (
      !pdf ||
      pdf.representation.id !== representation.id ||
      snapshot.sourceSnapshotId === null ||
      pdf.sourceSnapshot.id !== snapshot.sourceSnapshotId
    ) return [];
    return pdf.pages;
  }

  private representationContent(representation: AnnotationRepresentation): string | null {
    const subject = representation.subject;
    if (representation.sourceSnapshot.kind === 'rendered') return null;
    if (subject.kind === "block") {
      const current=this.blocks.requireActive(subject.blockId);
      const snapshot=representation.sourceSnapshot;
      if(snapshot.kind==='block' && snapshot.inboxAttemptId){
        const before=readCaptureBefore(this.database,snapshot.inboxAttemptId,subject.blockId);
        if(!before)throw new Error("Annotation saved Inbox source is unavailable");
        return before.text;
      }
      return current.text;
    }
    if (subject.kind === "legacy-file") return null;
    const snapshot = representation.sourceSnapshot;
    if (snapshot.kind !== "resource" || snapshot.resourceId !== subject.resourceId) {
      throw new Error("Annotation Resource snapshot does not match its subject");
    }
    const description = this.resources.describe(
      subject.resourceId,
      true,
      snapshot.revision ?? undefined,
    );
    const pdf = description.pdf;
    if (
      pdf &&
      pdf.representation.id === representation.id &&
      snapshot.sourceSnapshotId !== null &&
      pdf.sourceSnapshot.id === snapshot.sourceSnapshotId
    ) return pdf.markdown;
    if (description.resource.provider === "filesystem") {
      return description.filesystem?.text ?? null;
    }
    if (description.resource.provider === "web") {
      const web = description.web;
      if (
        !web ||
        web.representation.id !== representation.id ||
        snapshot.sourceSnapshotId === null ||
        web.sourceSnapshot.id !== snapshot.sourceSnapshotId
      ) return null;
      return web.markdown;
    }
    return null;
  }

  private materialize(
    content: AnnotationBlockContent,
    targetRow: AnnotationTargetRow,
  ): AnnotationRecord {
    const originalTarget = parseStoredTarget(targetRow.original_target_json);
    const history = this.history(targetRow.annotation_block_id);
    const current = [...history].reverse().find((event) => event.appliesCurrent);
    if (!current) throw new Error(`Annotation has no current resolution: ${targetRow.annotation_block_id}`);
    return {
      block: content.block,
      originalTarget,
      resolvedTarget: current.status === "resolved" ? current.resolvedTarget : null,
      currentResolution: current,
      resolutionHistory: history,
      body: content.body,
      source: content.source,
      lifecycle: content.lifecycle,
      promotedBlockIds: content.promotedBlockIds,
      properties: content.properties,
      ...(content.parentAnnotationId ? { parentAnnotationId: content.parentAnnotationId } : {}),
    };
  }

  private history(annotationId: string): AnnotationResolutionEvent[] {
    const rows = this.database.query(
      "SELECT * FROM annotation_resolution_events WHERE annotation_block_id = ? ORDER BY sequence",
    ).all(annotationId) as ResolutionRow[];
    if (rows.length === 0 || rows[0]!.sequence !== 0) throw new Error(`Annotation resolution history is missing sequence 0: ${annotationId}`);
    return rows.map((row, index) => {
      if (row.sequence !== index) throw new Error(`Annotation resolution history has a sequence gap: ${annotationId}`);
      return eventFromRow(row);
    });
  }

  private currentEvent(annotationId: string): AnnotationResolutionEvent {
    const row = this.database.query(
      "SELECT * FROM annotation_resolution_events WHERE annotation_block_id = ? AND applies_current = 1 ORDER BY sequence DESC LIMIT 1",
    ).get(annotationId) as ResolutionRow | null;
    if (!row) throw new Error(`Annotation has no current resolution: ${annotationId}`);
    return eventFromRow(row);
  }

  private eventById(eventId: string): AnnotationResolutionEvent {
    const row = this.database.query(
      "SELECT * FROM annotation_resolution_events WHERE id = ?",
    ).get(eventId) as ResolutionRow | null;
    if (!row) throw new Error(`Annotation resolution event not found: ${eventId}`);
    return eventFromRow(row);
  }

  private appendEvent(input: {
    readonly annotationId: string;
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
    readonly createdAt?: string;
  }): AnnotationResolutionEvent {
    const sequenceRow = this.database.query(
      "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM annotation_resolution_events WHERE annotation_block_id = ?",
    ).get(input.annotationId) as { sequence: number };
    const event: AnnotationResolutionEvent = {
      id: crypto.randomUUID(),
      annotationId: input.annotationId,
      sequence: sequenceRow.sequence,
      ...(input.passageResolution ? {passageResolution: normalizePassageResolution(input.passageResolution)} : {}),
      sourceRepresentation: normalizeAnnotationRepresentation(input.sourceRepresentation, true),
      targetRepresentation: normalizeAnnotationRepresentation(input.targetRepresentation, true),
      resolvedTarget: input.resolvedTarget === null ? null : normalizeAnnotationTarget(input.resolvedTarget, true),
      method: normalizeResolutionMethod(input.method),
      reviewer: normalizeResolutionReviewer(input.reviewer),
      confidence: input.confidence,
      candidates: input.candidates.map(normalizeResolutionCandidate),
      status: input.status,
      appliesCurrent: input.appliesCurrent,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.assertEvent(event);
    this.database.query(`
      INSERT INTO annotation_resolution_events (
        id, annotation_block_id, sequence, source_representation_json,
        target_representation_json, resolved_target_json, method_json,
        reviewer_json, confidence, candidates_json, status, applies_current, created_at, passage_resolution_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.annotationId,
      event.sequence,
      JSON.stringify(event.sourceRepresentation),
      JSON.stringify(event.targetRepresentation),
      event.resolvedTarget === null ? null : JSON.stringify(event.resolvedTarget),
      JSON.stringify(event.method),
      JSON.stringify(event.reviewer),
      event.confidence,
      JSON.stringify(event.candidates),
      event.status,
      event.appliesCurrent ? 1 : 0,
      event.createdAt,
      event.passageResolution ? JSON.stringify(event.passageResolution) : null,
    );
    this.insertEventResourceEvidenceRefs(event);
    return event;
  }

  private assertEvent(event: AnnotationResolutionEvent): void {
    if (event.passageResolution) {
      const passage = parseStoredTarget(this.targetRow(event.annotationId).original_target_json).passage;
      if (!passage || passage.fragments.length !== event.passageResolution.fragments.length) {
        throw new Error("Passage resolution must retain every captured fragment");
      }
      const check = (position: import("./types").AnnotationPassageSliceResolution,
        slice: import("./types").AnnotationPassageSlice) => {
        if (position.document !== slice.document ||
          (position.resolvedTarget && (!sameSubject(position.resolvedTarget.representation.subject, passage.documents[slice.document]!.subject) ||
            position.resolvedTarget.listItemId !== slice.listItemId))) {
          throw new Error("Passage resolution cannot change source ownership");
        }
      };
      for (const [index, original] of passage.fragments.entries()) {
        const fragment = event.passageResolution.fragments[index]!;
        const slices = original.kind === "source" ? original.slices : original.kind === "reference" ? [original.token] : [];
        if (fragment.sources.length !== slices.length) throw new Error("Passage resolution must retain every source slice");
        fragment.sources.forEach((position, index) => check(position, slices[index]!));
        const occurrence = original.kind === "source" || original.kind === "reference" ? original.occurrence : undefined;
        if (Boolean(occurrence) !== Boolean(fragment.occurrence) ||
          (occurrence && fragment.occurrence?.path.length !== occurrence.path.length)) {
          throw new Error("Passage resolution must retain its occurrence path");
        }
        if (occurrence && fragment.occurrence) {
          check(fragment.occurrence.host, occurrence.host);
          fragment.occurrence.path.forEach((position, index) => check(position, occurrence.path[index]!.token));
        }
      }
    }
    if (event.status === "resolved") {
      if (!event.appliesCurrent || event.resolvedTarget === null || event.confidence === null) {
        throw new Error("Resolved event must apply a target with confidence");
      }
    } else if (event.status === "probable") {
      const proposal = event.method.kind === "agent" && !event.appliesCurrent;
      if (
        (!event.appliesCurrent && !proposal) ||
        event.resolvedTarget !== null ||
        event.confidence === null ||
        event.candidates.length === 0
      ) throw new Error("probable event requires scored candidates without applying a target");
    } else if (event.status === "unresolved") {
      if (
        !event.appliesCurrent ||
        event.resolvedTarget !== null ||
        ((event.confidence === null) !== (event.candidates.length === 0))
      ) throw new Error("unresolved event evidence is inconsistent");
    } else if (event.status === "ambiguous" || event.status === "orphaned") {
      const proposal = event.method.kind === "agent" && !event.appliesCurrent;
      if (
        event.resolvedTarget !== null ||
        (event.appliesCurrent ? event.confidence !== null : !proposal || event.confidence === null) ||
        (event.status === "ambiguous" && proposal && event.candidates.length < 2) ||
        (event.status === "orphaned" && event.candidates.length > 0)
      ) throw new Error(`${event.status} event evidence is inconsistent`);
    } else if (event.status === "rejected") {
      if (event.appliesCurrent || event.resolvedTarget !== null) {
        throw new Error("Rejected event cannot apply current");
      }
    } else if (!event.appliesCurrent || event.resolvedTarget !== null || event.confidence !== null) {
      throw new Error(`${event.status} event must apply a null current target without confidence`);
    }
    if (event.confidence !== null && (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1)) {
      throw new Error("Resolution confidence must be between 0 and 1");
    }
    for (let index = 0; index < event.candidates.length; index += 1) {
      const entry = event.candidates[index]!;
      if (!sameRepresentation(entry.target.representation, event.targetRepresentation)) {
        throw new Error("Resolution candidate must belong to the target representation");
      }
      if (index > 0 && event.candidates[index - 1]!.confidence < entry.confidence) {
        throw new Error("Resolution candidates must be ranked by descending confidence");
      }
    }
  }

  private insertTarget(annotationId: string, target: AnnotationTarget, createdAt: string): void {
    const subject = target.representation.subject;
    this.database.query(`
      INSERT INTO annotation_targets (
        annotation_block_id, block_id, resource_id, legacy_source_block_id,
        legacy_file_path, original_target_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      annotationId,
      subject.kind === "block" ? subject.blockId : null,
      subject.kind === "resource" ? subject.resourceId : null,
      subject.kind === "legacy-file" ? subject.sourceBlockId : null,
      subject.kind === "legacy-file" ? subject.filePath : null,
      JSON.stringify(target),
      createdAt,
    );
    this.insertResourceEvidenceRef({
      annotationId,
      resolutionEventId: null,
      role: "original-target",
      value: target,
      createdAt,
    });
  }

  private targetRow(annotationId: string): AnnotationTargetRow {
    const row = this.database.query("SELECT * FROM annotation_targets WHERE annotation_block_id = ?").get(annotationId) as AnnotationTargetRow | null;
    if (!row) throw new Error(`Annotation target not found: ${annotationId}`);
    const target = parseStoredTarget(row.original_target_json);
    const subject = target.representation.subject;
    if (
      (subject.kind === "block" &&
        (row.block_id !== subject.blockId ||
          row.resource_id !== null ||
          row.legacy_source_block_id !== null ||
          row.legacy_file_path !== null)) ||
      (subject.kind === "resource" &&
        (row.resource_id !== subject.resourceId ||
          row.block_id !== null ||
          row.legacy_source_block_id !== null ||
          row.legacy_file_path !== null)) ||
      (subject.kind === "legacy-file" &&
        (row.legacy_source_block_id !== subject.sourceBlockId ||
          row.legacy_file_path !== subject.filePath ||
          row.block_id !== null ||
          row.resource_id !== null))
    ) throw new Error(`Annotation target index disagrees with stored target: ${annotationId}`);
    return row;
  }

  private requireRoot(annotationId: string): AnnotationTargetRow {
    this.blocks.requireActive(annotationId);
    return this.targetRow(annotationId);
  }

  private requireSubject(subject: AnnotationSubject): void {
    if (subject.kind === "legacy-file") throw new Error("legacy-file subjects are migration-only");
    if (subject.kind === "block") this.blocks.requireActive(subject.blockId);
    else this.resources.require(subject.resourceId);
  }

  private ensureSystemRoot(): string {
    const existing = this.blocks.get(SYSTEM_ANNOTATIONS_ROOT_ID);
    if (existing) {
      if (!existing.properties.some((property) =>
        property.key === "type" && property.value === "annotations-root"
      )) throw new Error(`System annotations root ID collision: ${SYSTEM_ANNOTATIONS_ROOT_ID}`);
      return existing.id;
    }
    const now = new Date().toISOString();
    this.blocks.insertCanonical(
      SYSTEM_ANNOTATIONS_ROOT_ID,
      "Annotations [type::annotations-root]",
      null,
      "system",
      now,
    );
    return SYSTEM_ANNOTATIONS_ROOT_ID;
  }

  private insertResourceEvidenceRef(input: {
    readonly annotationId: string;
    readonly resolutionEventId: string | null;
    readonly role: AnnotationResourceEvidenceRole;
    readonly value: AnnotationRepresentation | AnnotationTarget;
    readonly createdAt: string;
  }): void {
    if ("representation" in input.value && input.value.passage) {
      for (const document of input.value.passage.documents) {
        if (document.subject.kind === "resource") this.insertResourceEvidenceRef({...input,
          value: passageDocumentRepresentation(document, input.value.representation.capturedAt)});
      }
    }
    const representation = "representation" in input.value
      ? input.value.representation
      : input.value;
    const subject = representation.subject;
    const snapshot = representation.sourceSnapshot;
    if (
      subject.kind !== "resource" ||
      snapshot.kind !== "resource" ||
      snapshot.resourceId !== subject.resourceId
    ) return;
    const artifacts = this.database.query(`
      SELECT
        (
          SELECT id
          FROM web_source_snapshots
          WHERE id = ? AND resource_id = target.id
        ) AS source_snapshot_id,
        (
          SELECT web_representation.id
          FROM web_representations web_representation
          JOIN web_source_snapshots web_snapshot
            ON web_snapshot.id = web_representation.source_snapshot_id
          WHERE web_representation.id = ?
            AND web_snapshot.resource_id = target.id
        ) AS representation_id,
        (
          SELECT id
          FROM pdf_source_snapshots
          WHERE id = ? AND resource_id = target.id
        ) AS pdf_source_snapshot_id,
        (
          SELECT pdf_representation.id
          FROM pdf_representations pdf_representation
          JOIN pdf_source_snapshots pdf_snapshot
            ON pdf_snapshot.id = pdf_representation.source_snapshot_id
          WHERE pdf_representation.id = ?
            AND pdf_snapshot.resource_id = target.id
        ) AS pdf_representation_id
      FROM resources target
      WHERE target.id = ?
    `).get(
      snapshot.sourceSnapshotId,
      representation.id,
      snapshot.sourceSnapshotId,
      representation.id,
      subject.resourceId,
    ) as {
      source_snapshot_id: string | null;
      representation_id: string | null;
      pdf_source_snapshot_id: string | null;
      pdf_representation_id: string | null;
    } | null;
    if (
      !artifacts ||
      (
        artifacts.source_snapshot_id === null &&
        artifacts.representation_id === null &&
        artifacts.pdf_source_snapshot_id === null &&
        artifacts.pdf_representation_id === null
      )
    ) return;
    this.database.query(`
      INSERT OR IGNORE INTO annotation_resource_evidence_refs (
        id, annotation_block_id, resolution_event_id, role,
        source_snapshot_id, representation_id,
        pdf_source_snapshot_id, pdf_representation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      input.annotationId,
      input.resolutionEventId,
      input.role,
      artifacts.source_snapshot_id,
      artifacts.representation_id,
      artifacts.pdf_source_snapshot_id,
      artifacts.pdf_representation_id,
      input.createdAt,
    );
  }

  private insertEventResourceEvidenceRefs(event: AnnotationResolutionEvent): void {
    for (const fragment of event.passageResolution?.fragments ?? []) {
      for (const position of [...fragment.sources,
        ...(fragment.occurrence ? [fragment.occurrence.host, ...fragment.occurrence.path] : [])]) {
        if (position.resolvedTarget) this.insertResourceEvidenceRef({annotationId: event.annotationId,
          resolutionEventId: event.id, role: "event-resolved", value: position.resolvedTarget, createdAt: event.createdAt});
        for (const candidate of position.candidates) this.insertResourceEvidenceRef({annotationId: event.annotationId,
          resolutionEventId: event.id, role: "event-candidate", value: candidate.target, createdAt: event.createdAt});
      }
    }
    this.insertResourceEvidenceRef({
      annotationId: event.annotationId,
      resolutionEventId: event.id,
      role: "event-source",
      value: event.sourceRepresentation,
      createdAt: event.createdAt,
    });
    this.insertResourceEvidenceRef({
      annotationId: event.annotationId,
      resolutionEventId: event.id,
      role: "event-target",
      value: event.targetRepresentation,
      createdAt: event.createdAt,
    });
    if (event.resolvedTarget) {
      this.insertResourceEvidenceRef({
        annotationId: event.annotationId,
        resolutionEventId: event.id,
        role: "event-resolved",
        value: event.resolvedTarget,
        createdAt: event.createdAt,
      });
    }
    for (const candidate of event.candidates) {
      this.insertResourceEvidenceRef({
        annotationId: event.annotationId,
        resolutionEventId: event.id,
        role: "event-candidate",
        value: candidate.target,
        createdAt: event.createdAt,
      });
    }
  }
}
