import { parseActor } from "@ep0ch/outline-core/attribution";
import { valueLinkOccurrences, problemWords, hasWords } from "@ep0ch/outline-core/site-values";
/**
 * Outline operations for agents (PIE-504): read, find, resolve, edit, create,
 * comment, reply, resolve a thread, recent changes and `draft.patch`. The CLI's
 * `agent` command runs them, and the Claude mod's `outline_*` tools call that
 * command, so an agent never hand-rolls a script around `list --subtree`,
 * `update` or a comment socket.
 *
 * Each one is the agent side of a service call the door and Detail already
 * make: the service keeps the rules (revisions, quote anchoring, the draft
 * patch policy, activity). These helpers name blocks explicitly, always return
 * full text, attribute every write to the agent that asked, and answer compact
 * JSON. The refusals they add are the ones an agent's script got wrong: an
 * empty write, a stale revision, and an edit that drops a `[page::…]` or an
 * anchor other notes link to.
 */
import { parseMachineryMode, readsRecentActivity, type MachineryLeftOut, type MachineryMode } from "@ep0ch/outline-core/machinery";
import { describeReferenceWarning, referenceWarnings } from "@ep0ch/outline-core/reference-warnings";
import { syntaxWarnings } from "@ep0ch/outline-core/syntax-warnings";
import { hasCountCandidate, shapeNext, shapeWarnings, type ShapeFacet } from "@ep0ch/outline-core/write-shape";
import { outlineFacets, reviewWarnings, reviewWrite, type WriteReview } from "./write-review";
import { houseRule } from "./work-review";
import { componentReading, type ComponentReading } from "@ep0ch/outline-core/component-warnings";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { figureShape, suggestFigure } from "./figure-fit";
import { toldKeys, type SuggestionKeep, type SuggestionWrite } from "./jev-suggestions";
import { figureRowReport } from "./figure-rows";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { useCallsOf, type TemplateUseAnswer } from "@ep0ch/outline-core/template-use";
import { annotationPropertyProblem } from "@ep0ch/outline-core/annotation-marks";
import { randomUUID } from "node:crypto";
import { checkToolArgs, closest } from "@ep0ch/outline-core/tool-args";
import { AGENT_OPERATION_SPECS } from "./agent-tool-specs";
import { createBlockComment } from "./block-comments";
import { matchFacts, resourceTextRevision, type BlockRevisions } from "@ep0ch/outline-core/protocol";
import { authoredResourceReferenceOccurrences, type AuthoredResourceReference } from "./resource-references";
import { resourceCommentSource } from "./resource-comments";
import type { ResourceDescription } from "./resources";
import { normalizePropertyQueryScope, parsePropertyFilterClause } from "./block-query";
import { DRAFT_PATCH_POLICIES, droppedStructure, type DraftPatchInput, type DraftPatchPolicyName, type DraftPatchResult } from "./draft-patch";
import { chipText, headerLine } from "@ep0ch/outline-core/header-line";
import { isPropertyKey } from "@ep0ch/outline-core/property-grammar";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { parseOutlinerLinkUri, resolveOutlinerLinkTarget, type OutlinerLinkTarget } from "./outliner-links";
import { blockDisplayTitle } from "./references";
import { textRecord } from "./block-records";
import type { SiteAnswer } from "@ep0ch/outline-core/site";
import { interpolationSpans } from "@ep0ch/outline-core/interpolation";
import { MAX_NOTE_VALUES } from "@ep0ch/outline-core/site-values";
import { recordProperties, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { isSystemNote, systemNoteKind } from "./note-placement";
import { pageAddressReferences, referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { readSavedView } from "./saved-view-read";
import { parseWorkId } from "./work-ids";
import { refuseDroppedStructure, WorkToolRefusal, type WorkToolsClient } from "./work-tools";
import type {
  AnnotationBatchReceipt,
  AnnotationRecord,
  AnnotationThread,
  Block,
  BlockAuthor,
  BlockEditActivityPage,
  BlockReadCollection,
  BlockSearchQuery,
  GotoSearchCollection,
  SearchCertainty,
  MutationProvenance,
  ProjectedBlock,
  ResolvedBlockReferences,
  PropertyFilter,
  PropertyMatchContext,
  PropertyQueryScope,
  VirtualBranchOrder,
  VisibleBlockCollection,
} from "./types";
import type { ExtensionsListResult } from "./extension-registry";
import { codeBlocks, codeFenceInfo } from "@ep0ch/outline-core/code-fence";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";

/** The client these operations use: requests, and the protocol check before a write or a newer read. */
export interface AgentToolsClient extends WorkToolsClient {
  requireCompatibleService(): Promise<unknown>;
}

/** The agent a write is attributed to: always `author: agent`, with its actor id and session. */
export interface AgentActor {
  actorId: string;
  sessionId?: string;
  author?: "user" | "agent" | "system";
  taskId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mutationOf(actor: AgentActor): MutationProvenance {
  // A person has no actor id (a run a person pressed writes as them, PIE-1462).
  const { actorId, ...rest } = provenanceOf(actor);
  return { author: actor.author ?? "agent", ...(actorId ? { actorId } : {}), ...rest };
}

function provenanceOf(actor: AgentActor) {
  return { actorId: actor.actorId, ...(actor.sessionId ? { sessionId: actor.sessionId } : {}), ...(actor.taskId ? { taskId: actor.taskId } : {}) };
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.trim()) throw new WorkToolRefusal(`${what} is empty; give the text to write`);
  return value;
}

function boundedInteger(value: unknown, what: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new WorkToolRefusal(`${what} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function requireRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new WorkToolRefusal("Give expectedRevision: the revision outline_read returned");
  }
  return value;
}

function workIdOf(block: Block): string | undefined {
  return block.properties.find(property => property.key === "work-id")?.value;
}

// ─── Resolve ───────────────────────────────────────────────────────────────

/**
 * The refs the link grammar names by itself, read here: a `pi-outliner://` link, a full id or `((id))`, and a
 * `((…))` or `[[…]]` with an `^anchor` or another outline's name (links route those). Null for the rest, which
 * `blocks.resolve` reads.
 */
function linkTarget(text: string): OutlinerLinkTarget | null {
  if (text.startsWith("pi-outliner://")) return parseOutlinerLinkUri(text);
  const block = referencedBlock(text);
  if (block && (block.outline || block.fragment || UUID.test(block.blockId))) {
    return { kind: "block", value: block.outline ? `${block.outline}:${block.blockId}` : block.blockId.toLowerCase(), ...(block.fragment ? { fragmentId: block.fragment } : {}) };
  }
  const pages = pageAddressReferences(text).filter(page => !page.nested);
  const page = pages.length === 1 && pages[0]!.start === 0 && pages[0]!.end === text.length ? pages[0]! : null;
  if (!page || !(page.outline || page.fragmentId)) return null;
  return { kind: "page", value: page.outline ? `${page.outline}:${page.displayAddress}` : page.displayAddress, ...(page.fragmentId ? { fragmentId: page.fragmentId } : {}) };
}

/** The id `blocks.resolve` reads `text` as (a note in Trash too, so it can be read and restored), or its refusal. */
async function serviceBlockId(client: AgentToolsClient, text: string): Promise<string> {
  const [answer] = (await client.request<{ resolved: { id?: string; error?: string }[] }>({ action: "blocks.resolve", refs: [text], includeTrashed: true })).resolved;
  if (answer?.id) return answer.id;
  const error = answer?.error ?? `No note ${text}`;
  const named = text.startsWith("[[") || text.startsWith("((") || /^[0-9a-f-]{8,}$/i.test(text) || parseWorkId(text);
  throw new WorkToolRefusal(named ? error : `${error}; titles aren't accepted: outline_find finds one`);
}

export interface ResolvedReference {
  id: string;
  ref: string;
  title: string;
  revision: number;
  workId?: string;
  fragmentId?: string;
  deleted?: true;
}

/**
 * The block an agent names, by the service's one resolver (`blocks.resolve`, the CLI's too) unless `linkTarget` reads
 * it. Its refusals teach (an ambiguous prefix's candidates, a miss's nearest ids); a title is refused, so a write never
 * lands on a guess.
 */
async function resolveReference(client: AgentToolsClient, ref: string): Promise<{ block: Block; fragmentId?: string }> {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) throw new WorkToolRefusal("Give a reference: a block id, ((id)), an id's first 8+ characters, [[page]] or a Work ID");
  const target = linkTarget(text);
  if (!target) return { block: await client.request<Block>({ action: "get", blockId: await serviceBlockId(client, text) }) };
  if (target.kind === "goto" || target.kind === "resource" || target.kind === "reference") {
    throw new WorkToolRefusal(`A ${target.kind} link doesn't name one block; give its id, [[page]] or Work ID`);
  }
  // `((b234391f^beans))`: the id by the service's resolver, the fragment by the link's.
  const local = target.kind === "block" && !target.value.includes(":") && !UUID.test(target.value);
  // Read-only: a page address that doesn't resolve is an error, never a new page.
  const resolved = await resolveOutlinerLinkTarget(client, local ? { ...target, value: await serviceBlockId(client, target.value) } : target, { followMissingPages: false });
  return { block: resolved.block, ...(resolved.fragmentId ? { fragmentId: resolved.fragmentId } : {}) };
}

/** A block to write to: resolved, and refused while it is in Trash. */
async function writableBlock(client: AgentToolsClient, ref: string): Promise<Block> {
  const { block } = await resolveReference(client, ref);
  if (block.effectiveDeletedRootId) throw new WorkToolRefusal(`${block.id} is in Trash; restore it before writing`);
  return block;
}

/** `outline_site`: what a note's placeholders and the paths asked resolve to, by the service's one resolver (`site.answer`). */
export async function siteRead(client: AgentToolsClient, input: { ref: string; paths?: string[]; draft?: string; chain?: unknown[]; props?: Record<string, string[]>; line?: number }): Promise<SiteAnswer & { uses?: UseCallRead[] }> {
  const { block } = await resolveReference(client, input.ref);
  const answer = await client.request<SiteAnswer>({
    action: "site.answer", blockId: block.id,
    ...(input.paths ? { paths: input.paths } : {}), ...(input.draft !== undefined ? { draft: { text: input.draft } } : {}),
    ...(input.chain ? { chain: input.chain as never } : {}), ...(input.props ? { props: input.props } : {}), ...(input.line !== undefined ? { line: input.line } : {}),
  });
  const uses = await useCallsRead(client, block.id, input.draft ?? block.text);
  return uses.length ? { ...answer, uses } : answer;
}

/** One `::use` of a note as the service reads it (`template.use`): the template, the props it gets, and what is wrong with the call. */
export interface UseCallRead { line: number; of: string | null; template?: { id: string; title: string }; props: Record<string, string[]>; problems: TemplateUseAnswer["problems"]; missing: TemplateUseAnswer["missing"] }

/** The `::use` calls `text` holds (at most 8), each as the service reads it in note `blockId`; none for a note that holds none. */
export async function useCallsRead(client: AgentToolsClient, blockId: string, text: string): Promise<UseCallRead[]> {
  if (!text.includes("::use")) return [];
  const out: UseCallRead[] = [];
  for (const call of useCallsOf(text).slice(0, 8)) {
    try {
      const a = await client.request<TemplateUseAnswer>({ action: "template.use", block: blockId, line: call.line, draft: { text } });
      out.push({ line: call.line + 1, of: call.of, ...(a.template ? { template: { id: a.template.id, title: a.template.title } } : {}), props: a.props, problems: a.problems, missing: a.missing });
    } catch { /* a call the service can't read says nothing */ }
  }
  return out;
}

export async function resolveRef(client: AgentToolsClient, ref: string): Promise<ResolvedReference> {
  const { block, fragmentId } = await resolveReference(client, ref);
  const workId = workIdOf(block);
  return {
    id: block.id,
    ref: `((${block.id}))`,
    title: blockDisplayTitle(block),
    revision: block.revision,
    ...(workId ? { workId } : {}),
    ...(fragmentId ? { fragmentId } : {}),
    ...(block.effectiveDeletedRootId ? { deleted: true as const } : {}),
  };
}

// ─── Resources ─────────────────────────────────────────────────────────────

/** A Resource an agent names instead of a block: a registered one by id, or the reference that names it. */
export type ResourceRef = { resourceId: string } | { reference: AuthoredResourceReference };

/**
 * `resource:<id>` (what outline_read returns for one) or an authored reference as written in a note, `[file::path]`,
 * `[web::url]`: the Resource a read or a comment is about. Null when `ref` names a block (PIE-650).
 */
export function resourceRefOf(ref: string): ResourceRef | null {
  const text = typeof ref === "string" ? ref.trim() : "";
  const id = /^resource:([^\s:]+)$/.exec(text);
  if (id) return { resourceId: id[1]! };
  if (!text.startsWith("[")) return null;
  const only = authoredResourceReferenceOccurrences(text);
  const one = only.length === 1 ? only[0]! : null;
  if (!one || one.start !== 0 || one.end !== text.length) return null;
  if (one.kind === "invalid-authored-resource") throw new WorkToolRefusal(one.message);
  return { reference: one.reference };
}

/** The registered Resource a ref names, registering it when `register` (a comment does; a read doesn't). Null when it isn't registered. */
async function resourceIdOf(client: AgentToolsClient, ref: ResourceRef, register: boolean, actor?: AgentActor): Promise<string | null> {
  if ("resourceId" in ref) return ref.resourceId;
  const r = ref.reference;
  if (r.kind === "resource") return r.resourceId;
  if (r.kind === "filesystem") {
    const found = await client.request<{ id: string } | null>({ action: "resources.lookup-filesystem", path: r.path });
    if (found) return found.id;
  }
  if (!register) return null;
  const followed = await client.request<{ resource: { id: string } }>({ action: "resources.follow-authored", reference: r, ...(actor ? { mutation: mutationOf(actor) } : {}) });
  return followed.resource.id;
}

export interface ResourceThread {
  thread: string;
  /** "resolved": the quote is still where it was said (or was found again); "moved or gone": it isn't, and `quote` is the text as it read. */
  anchored: boolean;
  quote: string;
  body: string;
  author: BlockAuthor;
  actorId?: string;
  lifecycle: string;
  replies: { id: string; author: BlockAuthor; body: string }[];
}

export interface ResourceReadResult {
  kind: "resource";
  id: string;
  ref: string;
  title: string;
  /** `resourceTextRevision` of the stored text: what a comment on it names. */
  revision: number | null;
  text: string | null;
  /** The comment threads on it that are open (a rewritten file's are re-anchored, or kept as they read when written). */
  threads: ResourceThread[];
  /** Why the text can't be read or quoted now, when it can't; the threads are still the ones there are. */
  unavailable?: string;
}

function threadOf(thread: import("./types").AnnotationThread): ResourceThread {
  const anchor = thread.originalTarget.anchor;
  return {
    thread: thread.block.id,
    anchored: thread.resolvedTarget !== null,
    quote: anchor.kind === "text-quote" ? anchor.exact : "",
    body: thread.body,
    author: thread.block.author,
    ...(thread.block.actorId ? { actorId: thread.block.actorId } : {}),
    lifecycle: thread.lifecycle,
    replies: thread.replies.map(reply => ({ id: reply.block.id, author: reply.block.author, body: reply.body })),
  };
}

/** The open threads on a Resource, re-anchored against its text as it is now (all of them with `resolved: true`). */
export async function resourceThreads(client: AgentToolsClient, resourceId: string, includeResolved = false): Promise<{ threads: ResourceThread[]; unavailable?: string }> {
  const receipt = await client.request<import("./types").AnnotationReconcileReceipt>({ action: "annotations.reconcile", input: { subject: { kind: "resource", resourceId } } });
  return { threads: receipt.threads.filter(t => includeResolved || t.lifecycle === "open").map(threadOf), ...(receipt.unavailable ? { unavailable: receipt.unavailable } : {}) };
}

/** A Resource with its stored text and its open comment threads: what an agent reads before it edits the file (PIE-650). */
export async function readResource(client: AgentToolsClient, ref: ResourceRef): Promise<ResourceReadResult> {
  const id = await resourceIdOf(client, ref, false);
  if (!id) {
    const file = "reference" in ref && ref.reference.kind === "filesystem" ? ref.reference.path : null;
    const named = file ?? "that reference";
    return { kind: "resource", id: "", ref: "", title: named, revision: null, text: null, threads: [], unavailable: file
      ? `${named} isn't a registered Resource, so nothing has been said about it`
      : `${named} can't be looked up without registering it: read a registered Resource as resource:<id> (outline_comment returns the id; a note's link, opened in the door, registers it)` };
  }
  const description = await client.request<ResourceDescription>({ action: "resources.describe", target: { kind: "resource", resourceId: id } });
  const source = resourceCommentSource(description);
  const { threads, unavailable } = await resourceThreads(client, id);
  const hash = source?.representation.contentHash;
  return {
    kind: "resource", id: `resource:${id}`, ref: `resource:${id}`,
    title: (() => { const a = description.resource.address as Record<string, unknown>; return String(a.path ?? a.url ?? a.key ?? id); })(),
    revision: hash ? resourceTextRevision(hash) : null,
    text: source?.text ?? null,
    threads,
    ...(unavailable ? { unavailable } : source ? {} : { unavailable: "no stored text a comment can quote" }),
  };
}

// ─── Read ──────────────────────────────────────────────────────────────────

export interface ReadChild {
  id: string;
  text: string;
  revision: number;
  children?: ReadChild[];
  /** It has children this read didn't reach (past `depth`, or past `limit`). */
  more?: true;
}

export interface ReadResult extends ResolvedReference {
  text: string;
  /** Block-scope properties as the record holds them (outline-core `block-record.ts`): each key once with its values in order. */
  properties: BlockRecord["properties"];
  /** Properties of a line or a spot in it (`key:: value` lines, `[key::value]` mid-sentence), where they start. */
  fields: BlockRecord["fields"];
  author: BlockAuthor;
  actorId?: string;
  updated: string;
  parentId: string | null;
  children: ReadChild[];
  /** Every descendant to `depth` is here, and none below it was cut off. */
  complete: boolean;
  /**
   * What the note's `{{ }}` read as (`site.answer`): each placeholder with its values, or its problem and the nearest keys,
   * how it was found (`route`), and the notes it was computed from. What the person sees; `text` is what they wrote.
   * Only a note holding a `{{ }}` has one.
   */
  site?: SiteAnswer;
}

/** How much children's text one read returns at most (the note's own text is always whole). */
export const READ_CHILDREN_MAX_CHARS = 60_000;

/**
 * A block with its full text (never the title alone), properties, revision and
 * who last wrote it, and its children to `depth` levels (default 1), at most
 * `limit` descendants in all (default 50), each with full text, and at most
 * READ_CHILDREN_MAX_CHARS of children's text. `complete` says
 * whether anything was left out; a child marked `more` has unread children.
 */
export async function readBlock(
  client: AgentToolsClient,
  input: { ref: string; depth?: number; limit?: number; view?: boolean },
): Promise<ReadResult | ResourceReadResult> {
  // The drawing is the door's (ep0ch show); the Claude mod and the MCP gateway add it, a script reads the text.
  if (input.view === true) throw new WorkToolRefusal("view is the note as the door draws it, which this read can't draw: read without view, or draw it with ep0ch show <id>");
  const resource = resourceRefOf(input.ref);
  if (resource) return readResource(client, resource);
  const depth = boundedInteger(input.depth, "depth", 1, 0, 6);
  const limit = boundedInteger(input.limit, "limit", 50, 0, 500);
  // The children's text in all, so a read of a large subtree never floods the caller: past it, `complete` is false.
  let chars = READ_CHILDREN_MAX_CHARS;
  const resolved = await resolveRef(client, input.ref);
  const block = await client.request<Block>({ action: "get", blockId: resolved.id });
  let budget = limit;
  let complete = true;
  // Blocks whose children this read doesn't reach: ask the service which have any, in one read.
  const markMore = async (unread: ReadChild[]) => {
    if (!unread.length) return;
    const read = await client.request<BlockReadCollection>({ action: "blocks.read", ids: unread.map(child => child.id), fields: ["hasChildren"] });
    const withChildren = new Set(read.blocks.filter(row => row.hasChildren).map(row => row.id));
    for (const child of unread) {
      if (withChildren.has(child.id)) { child.more = true; complete = false; }
    }
  };
  const read = async (parentId: string, level: number): Promise<ReadChild[]> => {
    const blocks = await client.request<Block[]>({ action: "children", parentId });
    const children: ReadChild[] = [];
    for (const child of blocks) {
      if (budget === 0 || child.text.length > chars) { budget = 0; complete = false; break; }
      budget--;
      chars -= child.text.length;
      children.push({ id: child.id, text: child.text, revision: child.revision });
    }
    const unread: ReadChild[] = [];
    for (const child of children) {
      if (level === depth || budget === 0) { unread.push(child); continue; }
      const below = await read(child.id, level + 1);
      if (below.length) child.children = below;
    }
    await markMore(unread);
    return children;
  };
  let children: ReadChild[] = [];
  if (depth > 0) children = await read(block.id, 1);
  else await markMore([{ id: block.id, text: "", revision: block.revision }]);
  const record = textRecord(block);
  const site = await readSiteOf(client, block);
  // Who last wrote it (its current revision's edit), as `updated` says when: the block's own author is who made it.
  // Only the entry for the revision read: a write that lands between the two reads never lends its author to older text.
  const saved = (await client.request<BlockRevisions>({ action: "block.revisions", blockId: block.id, latest: true }).catch(() => undefined))?.revisions.find(r => r.revision === block.revision);
  const writer = saved?.author ? { author: saved.author, ...(saved.actorId ? { actorId: saved.actorId } : {}) } : { author: block.author, ...(block.actorId ? { actorId: block.actorId } : {}) };
  return {
    ...resolved,
    title: blockDisplayTitle(block),
    revision: block.revision,
    text: block.text,
    properties: record.properties,
    fields: record.fields,
    ...writer,
    updated: block.updatedAt,
    parentId: block.parentId,
    children,
    complete,
    ...(site ? { site } : {}),
  };
}

/** The note's whole `site.answer` (bounded), for a note that holds a `{{ }}`; nothing when it holds none or the service can't answer. */
async function readSiteOf(client: AgentToolsClient, block: Block): Promise<SiteAnswer | undefined> {
  if (!block.text.includes("{{") || !interpolationSpans(block.text).length) return undefined;
  try {
    const answer = await client.request<SiteAnswer>({ action: "site.answer", blockId: block.id });
    return answer.values.length > MAX_NOTE_VALUES ? { ...answer, values: answer.values.slice(0, MAX_NOTE_VALUES) } : answer;
  } catch {
    return undefined;
  }
}

// ─── Find ──────────────────────────────────────────────────────────────────

export interface FindInput {
  text?: string;
  /** `key=value`, or `key` for any value (as `list --filter`). */
  property?: string;
  hasKey?: string;
  /** The saved-view query grammar (`list --query`). */
  query?: string;
  /** A saved view (virtual branch): its members, instead of a search. */
  view?: string;
  /** Only under this block. */
  under?: string;
  /** The note a `parent:this` / `links:this` in the query stands for (a script's Site supplies it; no tool argument names it). */
  this?: string;
  limit?: number;
  /** `hide` (the default) leaves out what tools wrote for their own bookkeeping (`[machine::…]`); `only` or `show`. */
  machinery?: string;
  /** Which chips property, hasKey and query read (PIE-1277): `block` (the note's own, the default), `line`, `inline` or `all`. */
  propertyScope?: string;
  /** Rows carry their properties, grouped by key as a record does (PIE-1461): a table over many rows needs no read per row. */
  properties?: boolean;
}

/** A chip a line-scope find matched (PIE-1277), as outline-core's matchFacts gives it: `line` counts from 1. */
export type FindMatch = ReturnType<typeof matchFacts>;

export interface FindRow {
  id: string;
  title: string;
  revision: number;
  parentId: string | null;
  /** When the note was made: an edit leaves it alone, so a newest-first list sorts on it and keeps its order. */
  created: string;
  updated: string;
  workId?: string;
  /** With a propertyScope other than block: the chips that matched, so a buried `[needs::…]` says its line. */
  matches?: FindMatch[];
  /** With `properties: true`: the row's properties, each key once with its values, as outline_read gives them (PIE-1461). */
  properties?: { key: string; values: string[] }[];
}

function findRow(block: Block & { propertyMatches?: PropertyMatchContext[] }, withProperties = false): FindRow {
  const workId = workIdOf(block);
  return {
    id: block.id,
    title: blockDisplayTitle(block),
    revision: block.revision,
    parentId: block.parentId,
    created: block.createdAt,
    updated: block.updatedAt,
    ...(workId ? { workId } : {}),
    ...(block.propertyMatches?.length ? { matches: block.propertyMatches.map(matchFacts) } : {}),
    ...(withProperties ? { properties: recordProperties(block.properties) } : {}),
  };
}

function propertyScopeInput(value: string): PropertyQueryScope {
  try { return normalizePropertyQueryScope(value.trim().toLowerCase()); }
  catch { throw new WorkToolRefusal(`propertyScope is block, line, inline or all, not ${value}: "all" reads a [key::value] on any line, as well as the note's own`); }
}

/**
 * Blocks by text, property, property key, query or saved view, as rows to read
 * next (id, title, revision). `text`, `property`, `hasKey`, `query` and `under`
 * combine; `view` stands alone. `complete: false` means more matched than `limit`.
 */
/** How sure a ranked find is (PIE-1198): the service's verdict and sentence, and Jev's "is it among these?". */
export interface FindSearch { status: "ranked" | "lexical" | "unavailable"; verdict?: SearchCertainty["verdict"]; label?: string; said: string; exists?: number; deep?: GotoSearchCollection["semantic"]["deep"] }
/** A words-only find is the ranked search: at most this many rows (tree.search's own cap). */
const RANKED_FIND_LIMIT = 30;

export async function findBlocks(client: AgentToolsClient, input: FindInput): Promise<{ blocks: (FindRow & { score?: number })[]; complete: boolean; total?: number; search?: FindSearch; machineryOmitted?: MachineryLeftOut }> {
  const limit = boundedInteger(input.limit, "limit", 20, 1, 200);
  const given = (key: keyof FindInput) => typeof input[key] === "string" && (input[key] as string).trim() !== "";
  if (given("view")) {
    if (["text", "property", "hasKey", "query", "under", "propertyScope"].some(key => given(key as keyof FindInput))) {
      throw new WorkToolRefusal("A view is read on its own (its [property-scope::] says which chips it reads); drop text, property, hasKey, query, under and propertyScope");
    }
    await client.requireCompatibleService();
    const view = await resolveRef(client, input.view!);
    const read = await readSavedView(client, view.id, { limit });
    if (read.errors.length) throw new WorkToolRefusal(`The view ${view.id} can't be read: ${read.errors.join("; ")}`);
    return {
      blocks: read.blocks.map(block => findRow(block, input.properties === true)),
      complete: read.nextOffset === undefined && (read.completeness?.kind ?? "complete") === "complete",
      ...(read.total === undefined ? {} : { total: read.total }),
    };
  }
  if (!["text", "property", "hasKey", "query"].some(key => given(key as keyof FindInput))) {
    throw new WorkToolRefusal("Give text, property, hasKey, query or view to find blocks by");
  }
  // Words alone are a search, not a filter: the service's ranked one (ep0ch find's, the door's), re-ordered by Jev, each
  // row its Score and the answer how sure it is, so a weak top says "no strong match" instead of reading as the answer.
  if (given("text") && !["property", "hasKey", "query", "under", "this", "propertyScope"].some(key => given(key as keyof FindInput)) && (input.machinery === undefined || input.machinery === "hide")) {
    // Every candidate is ranked (as the door's / ranks them), then cut to what was asked: at most RANKED_FIND_LIMIT.
    // Deep when the ranked hits hold no sure answer (PIE-1200): notes that never use the words are found by meaning.
    const found = await client.request<GotoSearchCollection>({ action: "tree.search", query: input.text!, semantic: true, deep: true });
    const shown = Math.min(limit, RANKED_FIND_LIMIT);
    const ids = found.matches.slice(0, shown).map(m => m.block.id);
    const read = await Promise.all(ids.map(blockId => client.request<Block | null>({ action: "get", blockId }).catch(() => null)));
    const by = new Map(read.flatMap(b => b ? [[b.id, b] as const] : []));
    const scores = new Map(found.matches.map(m => [m.block.id, m.score]));
    const byMeaning = new Set(found.matches.flatMap(m => m.deep ? [m.block.id] : []));
    const s = found.semantic;
    const search: FindSearch = s.status === "ranked" && s.verdict ? { status: "ranked", verdict: s.verdict, ...(s.label ? { label: s.label } : {}), said: s.said ?? "", ...(s.exists !== undefined ? { exists: s.exists } : {}), ...(s.deep ? { deep: s.deep } : {}) }
      : s.status === "ranked" ? { status: "ranked", said: "ranked by Jev over the text matches" }
      : { status: s.status, said: `text matches only${s.message ? ` (${s.message})` : ""}` };
    return {
      blocks: ids.flatMap(id => { const b = by.get(id); if (!b) return []; const score = scores.get(id); return [{ ...findRow(b, input.properties === true), ...(score !== undefined ? { score } : {}), ...(byMeaning.has(id) ? { byMeaning: true } : {}) }]; }),
      complete: found.completeness.kind === "complete" && found.matches.length <= shown, search,
    };
  }
  const filters: PropertyFilter[] = [];
  if (given("property")) filters.push(parsePropertyFilterClause(input.property!));
  if (given("hasKey")) filters.push({ key: input.hasKey!.trim() });
  const query: BlockSearchQuery = {
    limit,
    ...(filters.length ? { filters } : {}),
    ...(given("text") ? { text: input.text } : {}),
    ...(given("query") ? { where: input.query } : {}),
    ...(given("under") ? { subtreeRootId: (await resolveRef(client, input.under!)).id } : {}),
    ...(given("this") ? { this: input.this } : {}),
    ...(input.machinery !== undefined ? { machinery: machineryInput(input.machinery) } : {}),
    ...(given("propertyScope") ? { propertyScope: propertyScopeInput(input.propertyScope!) } : {}),
    // A recent-activity read (`updated >= -1d`) says how many notes tools stamped it left out, by producer (PIE-1427).
    ...(readsRecentActivity(input.query) ? { countMachinery: true } : {}),
  };
  // An older service ignores `where` and would return unfiltered results.
  if (query.where !== undefined) await client.requireCompatibleService();
  const found = await client.request<VisibleBlockCollection>({ action: "blocks.query", query });
  return { blocks: found.blocks.map(block => findRow(block, input.properties === true)), complete: found.completeness.kind === "complete", ...(found.machineryLeftOut ? { machineryOmitted: found.machineryLeftOut } : {}) };
}

// ─── Edit ──────────────────────────────────────────────────────────────────

export interface EditInput {
  ref: string;
  expectedRevision: number;
  /** The whole new text. */
  text?: string;
  /** One heading's section, as Detail folds it. */
  replaceSection?: { heading: string; body: string };
  /** Added after the text, as a new paragraph unless it starts with a newline. */
  append?: string;
  /** Append an output region at this anchor through the held-draft route. */
  at?: string;
  /** Allow dropping a `[page::…]` or an anchor other notes link to. */
  allowStructural?: boolean;
}

export interface EditResult {
  id: string;
  ref: string;
  revision: number;
  previousRevision: number;
  diff: string;
  /** For replaceSection: the heading and the text it replaced. */
  section?: { heading: string; previous: string };
  /** With allowStructural: the `[page::…]` properties and `^anchors` the edit removed. */
  dropped?: string[];
  /** References the saved text kept that lead nowhere, with a did-you-mean (PIE-761), and what its components won't draw as written (PIE-721): saved anyway. */
  warnings?: string[];
  /** The components the saved text holds, by id (PIE-721): what the note now draws besides its prose. */
  components?: string[];
  /** The live figures this write added or changed, with the rows each returned (figure-rows.ts, PIE-1270). */
  figures?: string[];
  /** The next check, always (PIE-1270): read the note as drawn before calling the write done. */
  next?: string;
}

/** A short line diff: the changed lines between the common head and tail, `-` then `+`, at most `max` lines. */
export function shortDiff(before: string, after: string, max = 40): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const removed = a.slice(head, a.length - tail).map(line => `-${line}`);
  const added = b.slice(head, b.length - tail).map(line => `+${line}`);
  const lines = [`@@ line ${head + 1}`, ...removed, ...added];
  if (!removed.length && !added.length) return "";
  return lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more lines`].join("\n") : lines.join("\n");
}

/**
 * The references `text` kept that lead nowhere, each with what it may have meant (PIE-761), then each construct it
 * left open (PIE-669: an unclosed fence, `[[`, `[key::`, component or literal region, and what is read instead), then
 * what its components won't draw as written (PIE-721: a figure's name or key with a typo, YAML that doesn't read, a value
 * outside a property's): said after the write, never a reason to refuse it. A lookup that fails only drops a suggestion;
 * none at all gives no field.
 */
export async function referenceWarningsFor(client: AgentToolsClient, text: string, near?: string, self = near): Promise<string[]> {
  return (await writtenReading(client, text, near, self)).warnings;
}

/** `referenceWarningsFor`'s warnings, with the components the text holds (`components`: a write's confirmation of what it drew). */
export async function writtenReading(client: AgentToolsClient, text: string, near?: string, self = near): Promise<{ warnings: string[]; components: string[] }> {
  const reading = await componentsRead(client, text);
  return {
    warnings: [...await referenceOnlyWarnings(client, text, near, self), ...syntaxWarnings(text).map(w => w.message), ...reading.warnings, ...await useCallWarnings(client, text, self), ...await scriptLoadProblems(client, text, self)],
    components: reading.components,
  };
}

/** The script fence languages whose code is JavaScript (an `actions` fence is lines, read by its own grammar). */
const CODE_LANGUAGES = new Set(["js", "javascript", "ts", "typescript", "tsx", "jsx"]);

/**
 * Why the scripts a written note holds won't load or run as written (note components): what the service says of them
 * (`extensions.list` over the text as written: a schema that won't load, an empty fence), code that doesn't compile (its
 * fence's language and line, and the note's line), an import of a name no script here has, and a name another note's
 * script or a component already has. Asked only of a text holding `[script::`; a lookup that fails says nothing.
 */
export async function scriptLoadProblems(client: AgentToolsClient, text: string, self?: string): Promise<string[]> {
  if (!self || !text.includes("[script::")) return [];
  let listed: ExtensionsListResult;
  try {
    listed = await client.request<ExtensionsListResult>({ action: "extensions.list", blockId: self, draft: { text } });
  } catch { return []; /* an older service, a host that is gone: nothing to say */ }
  const out: string[] = [];
  const say = (line: string) => { if (!out.includes(line)) out.push(line); };
  const mine = listed.extensions.filter(e => e.script?.blockId === self);
  for (const e of mine) if (e.error) say(`script ${e.name ?? e.id}: ${e.error}`);
  // A name another note's script has (one of them answers it), or a component's that isn't a note's.
  const schemas = await schemasOf(client);
  for (const name of new Set(mine.flatMap(e => e.name ? [e.name] : []))) {
    const twin = listed.extensions.find(e => e.script && e.script.blockId !== self && e.name === name);
    if (twin) say(`script ${name}: the name is taken by ${twin.script!.blockId ? `((${twin.script!.blockId}))'s script` : `the script in ${twin.directory}`}; only one answers to ${name}, so give this one another name`);
    const component = schemas?.find(s => s.id === name && !s.origin?.startsWith("note:"));
    if (component) say(`script ${name}: ${component.origin === "built-in" || !component.origin ? "a built-in" : `${component.origin}'s`} component is called ${name} already, so ::${name} draws that one; give this one another name`);
  }
  // Its code as a run reads it: the imports linked against the scripts here (a module's own code is its note's to say),
  // then compiled. Loaded here only: the mod reads notes far more often than it writes scripts.
  const { linkScript } = await import("./script-link");
  const { isJsxLanguage, transpileScript } = await import("./script-runtime");
  const find = (name: string) => {
    const e = listed.extensions.find(x => x.script && x.name === name && x.script.blockId !== self) ?? listed.extensions.find(x => x.script && x.name === name);
    return e ? { id: `check-${e.id}`, name, code: "return {}", stamp: "check" } : undefined;
  };
  const lines = text.split("\n");
  const noteName = parsePropertyRecords(text).find(p => p.scope === "block" && p.key === "script")?.value;
  const fences = codeBlocks(lines).fences.filter(f => f.closed && CODE_LANGUAGES.has(codeFenceInfo(f.fence.info).language));
  const named = (f: (typeof fences)[number]) => codeFenceInfo(f.fence.info).attrs.script;
  // The note's script is its first unnamed fence, unless a fence names it (script-sources.ts's rule); other fences are code shown.
  const noteFence = noteName && !fences.some(f => named(f) === noteName) ? fences.find(f => !named(f)) : undefined;
  for (const f of fences) {
    const name = named(f) ?? (f === noteFence ? noteName : undefined);
    if (!name) continue;
    const language = codeFenceInfo(f.fence.info).language;
    const code = lines.slice(f.start + 1, f.end).map(line => line.slice(Math.min(f.fence.indent, line.length))).join("\n");
    let linked: string;
    try { linked = linkScript({ name, code }, find).code; }
    catch (error) { say(`script ${name}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    try { transpileScript(`async function __ep0ch_check__() {\n${linked}\n}`, isJsxLanguage(language)); }
    catch (error) {
      // Bun's build error: the first message, at a line of the wrapped code (one line above the fence's first).
      const first = ((error as { errors?: unknown[] })?.errors?.[0] ?? error) as { message?: string; position?: { line?: number } };
      // Past its last line is the wrapper's own `}`: a `}` too many closed the script early.
      const at = first.position?.line ? first.position.line - 1 : 0;
      const where = at > code.split("\n").length ? " at the end of its fence (a } too many closes it early)" : at > 0 ? ` line ${at} (line ${f.start + 1 + at} of the note)` : "";
      say(`script ${name} doesn't compile: ${language}${where}: ${first.message ?? String(error)}`);
    }
  }
  return out;
}

/**
 * The outline's own components (`components.schemas`), asked once per connection for a few seconds, so a write that
 * reads two texts (a patch's before and after) asks once; null when the service can't be asked.
 */
const schemasAsked = new WeakMap<AgentToolsClient, { at: number; schemas: Promise<ComponentSchema[] | null> }>();
function schemasOf(client: AgentToolsClient): Promise<ComponentSchema[] | null> {
  const kept = schemasAsked.get(client);
  if (kept && Date.now() - kept.at < 10_000) return kept.schemas;
  const schemas = client.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" }).then(r => r.schemas, () => null);
  schemasAsked.set(client, { at: Date.now(), schemas });
  return schemas;
}

/**
 * outline-core's `componentReading` over the outline's own components; nothing asked when the text holds no `::` component
 * and no one-line `::name{…}` call (a note component's, which closes with its line).
 */
async function componentsRead(client: AgentToolsClient, text: string): Promise<ComponentReading> {
  if (!componentBlocks(text.split("\n")).length && !/^ {0,3}::[a-z][a-z0-9-]*\{/m.test(text)) return { components: [], warnings: [] };
  const schemas = await schemasOf(client);
  return schemas ? componentReading(text, schemas) : { components: [], warnings: [] };
}

/**
 * The outline's property values (write-review.ts outlineFacets), asked once a minute per connection.
 */
const facetsAsked = new WeakMap<AgentToolsClient, { at: number; facets: Promise<ShapeFacet[]> }>();
function facetsOf(client: AgentToolsClient): Promise<ShapeFacet[]> {
  const kept = facetsAsked.get(client);
  if (kept && Date.now() - kept.at < 60_000) return kept.facets;
  const facets = outlineFacets(client as never);
  facetsAsked.set(client, { at: Date.now(), facets });
  return facets;
}

/**
 * The review of a create, an edit or a patch (write-review.ts, PIE-1388): code's measures with ready patches, and Jev's
 * judgment of what the write changed against Evan's rubric and the outline's whole kit, answered ship or fix. Jev is
 * asked unless OUTLINER_FIGURE_FIT is `off` (the tests' preloads set it), whatever the note's shape: prose included.
 * The answer waits for Jev no longer than the budget; past it, code's findings stand alone. What the writer is told is
 * kept as records by the service (`suggestions.keep`). Never throws: the write has landed.
 */
async function reviewOf(client: AgentToolsClient, text: string, before: string | undefined, at: Omit<SuggestionWrite, "source">): Promise<WriteReview> {
  const input = { text, ...(before === undefined ? {} : { before }), id: at.note };
  const off = process.env.OUTLINER_FIGURE_FIT === "off";
  const within = <T,>(work: Promise<T>, fallback: T) => Promise.race([work.catch(() => fallback), Bun.sleep(REVIEW_BUDGET_MS).then(() => fallback)]);
  const started = Date.now();
  const full = async () => {
    // Each read is bounded on its own; the outline's facets (pie's answer in about 0.2 s since PIE-1396, 2 to 7 s before)
    // are read while Jev answers, and only when the text types a number before a word, so they never hold Jev up.
    // The host answers a connection's requests in turn, so the quick reads go first and the facets after them.
    const [schemas, qaRule, told] = await Promise.all([within(schemasOf(client), null), within(houseRule(client as never, "qa-for-evan"), undefined), off ? Promise.resolve(undefined) : within(toldKeys(client as never, at.note), undefined)]);
    const facets = hasCountCandidate(text) ? within(facetsOf(client), []) : Promise.resolve([]);
    return reviewWrite({ ...input, schemas, facets, jev: !off, ...(qaRule ? { qaRule } : {}), ...(told ? { told } : {}) }, { timeoutMs: REVIEW_BUDGET_MS });
  };
  // The whole review is bounded, and any failure leaves code's measures alone, saying why Jev wasn't heard: the write has landed.
  const codeOnly = (why: string) => reviewWrite({ ...input, schemas: null, jev: false, jevWhy: why });
  const { review, reading } = await Promise.race([
    full(),
    Bun.sleep(REVIEW_BUDGET_MS * 2 + 1000).then(() => codeOnly(`not heard: the review ran past ${((REVIEW_BUDGET_MS * 2 + 1000) / 1000).toFixed(1)} s`)),
  ]).catch((e: unknown) => codeOnly(`not heard: ${(e as Error)?.message ?? String(e)} (after ${((Date.now() - started) / 1000).toFixed(1)} s)`));
  if (!off) await keepRecords(client, { kind: "reviewed", at: { ...at, source: "write" }, title: headerLine(text).prose.trim(), review, ...(reading ? { reading } : {}) });
  return review;
}

/** Asks the service to make the records of what Jev said (jev-suggestions.ts); waits for it no longer than the budget, and never throws. */
async function keepRecords(client: AgentToolsClient, keep: SuggestionKeep): Promise<void> {
  await Promise.race([(async () => client.request({ action: "suggestions.keep", keep }))().catch(() => undefined), Bun.sleep(RECORD_BUDGET_MS)]);
}
/** At most this long added to a write's answer by Jev's review, whatever Jev does. */
const REVIEW_BUDGET_MS = 2500;
/** And at most this long for the review's records and the settling of earlier ones (jev-suggestions.ts). */
const RECORD_BUDGET_MS = 3000;

/** What a figure-fit sweep found: each note it would tell, and the margin thread it left when asked to. */
export interface FigureSweep {
  checked: number;
  shaped: number;
  /** Shaped notes a figure-fit thread already told (Seen, Kept or resolved included): not asked again. */
  told: number;
  suggested: { id: string; title: string; component: string; confidence: number; thread?: string }[];
  /** Notes the sweep couldn't finish, and why; the rest are swept regardless. */
  failed?: { id: string; error: string }[];
  /** Why Jev couldn't be asked, when it couldn't: the sweep stops there, with what it had. */
  unavailable?: string;
}

/**
 * The tidy pass's figure check (PIE-721): the notes under `under` that read as a figure and draw none, each with the
 * figure Jev is sure of. Comments are never swept. With `comment`, each gets one margin thread (`[kind::figure-fit]`, a
 * whole-note comment by the actor) saying so: a suggestion, never a rewrite. A note is told once, ever: a note with a
 * figure-fit thread already, Seen or Kept (PIE-791) or resolved, isn't asked about again. A note that fails is listed
 * in `failed` and the sweep goes on.
 */
export async function sweepFigures(client: AgentToolsClient, input: { under: string; limit?: number; comment?: boolean }, actor?: AgentActor): Promise<FigureSweep> {
  if (typeof input.under !== "string" || !input.under.trim()) throw new WorkToolRefusal("Give under: the note whose subtree to sweep (a ref)");
  if (input.comment && !actor) throw new WorkToolRefusal("figure-fit with comment writes: pass --actor <agent id>");
  const schemas = await schemasOf(client);
  if (!schemas) throw new WorkToolRefusal("The outline's components can't be read (components.schemas); is the outline host up?");
  const limit = input.limit === undefined ? 50 : boundedInteger(input.limit, "limit", 1, 1, 500);
  // Every note under it, newest first, as the views read a subtree, its comments left out (the root aside).
  const root = (await resolveRef(client, input.under)).id;
  await client.requireCompatibleService();
  const found = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { subtreeRootId: root, where: "NOT type=annotation", sort: "updated desc", limit: limit + 1 } });
  const rows = found.blocks.filter(b => b.id !== root).slice(0, limit);
  const sweep: FigureSweep = { checked: rows.length, shaped: 0, told: 0, suggested: [] };
  // PIE-1251: the sweep is also when a day-old suggestion nobody followed is settled as ignored.
  if (process.env.OUTLINER_FIGURE_FIT !== "off") await keepRecords(client, { kind: "settle" });
  const failed: { id: string; error: string }[] = [];
  for (const block of rows) {
    if (figureShape(block.text, schemas) !== "shaped") continue;
    sweep.shaped++;
    try {
      const threads = await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: block.id }, includeResolved: true } });
      if (threads.some(t => t.properties?.kind?.includes("figure-fit"))) { sweep.told++; continue; }
      const answer = await suggestFigure(block.text, schemas, { timeoutMs: 5000 });
      if ("unavailable" in answer) return { ...sweep, ...(failed.length ? { failed } : {}), unavailable: answer.unavailable };
      if (!answer.fit) continue;
      const thread = input.comment
        ? (await commentOn(client, { ref: block.id, whole: true, kind: "figure-fit", requestId: `figure-fit:${block.id}:${block.revision}`, body: `${answer.fit.said}. A suggestion only, nothing was changed: mark it Seen to set it aside.` }, actor!)).thread
        : undefined;
      // Only a thread the writer can see is a suggestion told: a listing without `comment` tells nobody.
      if (thread) await keepRecords(client, { kind: "suggested", fit: answer.fit, reading: answer.reading, at: { note: block.id, revision: block.revision, actorId: actor!.actorId, source: "sweep", thread } });
      sweep.suggested.push({ id: block.id, title: blockDisplayTitle(block), component: answer.fit.component, confidence: answer.fit.confidence, ...(thread ? { thread } : {}) });
    } catch (error) {
      failed.push({ id: block.id, error: (error as Error).message });
    }
  }
  return { ...sweep, ...(failed.length ? { failed } : {}) };
}

/**
 * What each `::use` the text holds gets wrong (PIE-533 S4): a prop the template doesn't declare (with the nearest name), a
 * value outside a choice's options, a required prop left out, a template that isn't there. The service reads the call
 * (`template.use`, with this text as the host's, so the lines agree); a call it can't ask about says nothing.
 */
export async function useCallWarnings(client: AgentToolsClient, text: string, self?: string): Promise<string[]> {
  if (!self || !text.includes("::use")) return [];
  const out: string[] = [];
  for (const call of useCallsOf(text).filter(c => !c.problem).slice(0, 8)) {
    try {
      const answer = await client.request<TemplateUseAnswer>({ action: "template.use", block: self, line: call.line, draft: { text } });
      for (const problem of answer.problems) out.push(`the ::use on line ${call.line + 1}: ${problem.message}${problem.example ? ` (for example ${problem.example})` : ""}`);
    } catch { /* an older service, a host that is gone: nothing to say */ }
  }
  return out;
}

async function referenceOnlyWarnings(client: AgentToolsClient, text: string, near?: string, self = near): Promise<string[]> {
  try {
    const valueWarnings: string[] = [];
    if (self && text.includes("{{")) {
      const answer = await client.request<SiteAnswer>({ action: "site.answer", blockId: self, draft: { text } });
      const built = valueLinkOccurrences(text, answer.values);
      for (const span of built) for (const value of span.values) if (!hasWords(value)) valueWarnings.push(`{{${value.expression}}}: ${problemWords(value)}`);
      for (const span of built.sort((a, b) => b.start - a.start)) text = text.slice(0, span.start) + (span.text ?? " ".repeat(span.end - span.start)) + text.slice(span.end);
    }
    const warnings = await referenceWarnings(text, {
      resolve: async t => (await client.request<ResolvedBlockReferences>({ action: "references.resolve", text: t })).references,
      search: async query => (await client.request<{ matches: { block: { id: string }; title: string }[] }>({ action: "tree.search", query, ...(near ? { contextBlockId: near } : {}) })).matches
        .slice(0, 2).map(m => ({ id: m.block.id, title: m.title })),
      text: async blockId => (await client.request<Block | null>({ action: "get", blockId }))?.text ?? null,
      ...(self ? { self } : {}),
    });
    return [...valueWarnings, ...warnings.map(describeReferenceWarning)];
  } catch {
    return [];
  }
}

/**
 * Rewrites a block's text, checked against the revision the agent read: the
 * whole text, one section, or an addition at the end. An empty result, a stale
 * revision, and (unless `allowStructural`) dropping a `[page::…]` or an anchor
 * other notes link to are refused before anything is written.
 */
export async function editBlock(client: AgentToolsClient, input: EditInput, actor: AgentActor): Promise<EditResult | (DraftPatchResult & { id: string; ref: string; anchor?: string; message: string })> {
  const expectedRevision = requireRevision(input.expectedRevision);
  const modes = [input.text !== undefined, input.replaceSection !== undefined, input.append !== undefined].filter(Boolean).length;
  if (modes !== 1) throw new WorkToolRefusal("Give exactly one of text, replaceSection or append");
  const block = await writableBlock(client, input.ref);
  if (block.revision !== expectedRevision) {
    throw new WorkToolRefusal(
      `${block.id} is at revision ${block.revision}, not ${expectedRevision}: it changed since you read it. Read it again, then edit`,
    );
  }
  if (input.at !== undefined) {
    if (input.append === undefined) throw new WorkToolRefusal("at takes append: { append: \"One more entry\", at: \"^log\" }");
    const result = await client.request<DraftPatchResult & { anchor?: string; message: string }>({
      action: "outputs.place", blockId: block.id, at: input.at, mode: "append", content: input.append,
      producer: { id: block.id, name: actor.actorId }, mutation: mutationOf(actor),
    });
    return { ...result, id: block.id, ref: `((${block.id}))` };
  }
  let next: string;
  if (input.text !== undefined) {
    next = requireText(input.text, "The new text");
  } else if (input.replaceSection !== undefined) {
    const { heading, body } = input.replaceSection ?? {};
    if (typeof heading !== "string" || typeof body !== "string") throw new WorkToolRefusal("replaceSection needs a heading and a body");
    const updated = await client.request<Block & { section: NonNullable<EditResult["section"]> }>({
      action: "update", blockId: block.id, replaceSection: { heading, body },
      expectedRevision, mutation: mutationOf(actor), allowStructural: input.allowStructural,
    });
    const lost = input.allowStructural === true ? droppedStructure(block.text, updated.text) : undefined;
    const dropped = lost ? [...lost.pages, ...lost.anchors.map(anchor => `^${anchor}`)] : [];
    return {
      id: updated.id, ref: `((${updated.id}))`, revision: updated.revision, previousRevision: block.revision,
      diff: shortDiff(block.text, updated.text), section: updated.section,
      ...(dropped.length ? { dropped } : {}),
      ...(await warned(client, updated.text, updated.id, updated.id, { before: block.text, at: { note: updated.id, revision: updated.revision, actorId: actor.actorId } })),
    };
  } else {
    const addition = requireText(input.append, "The text to append");
    next = addition.startsWith("\n") ? `${block.text.replace(/\s+$/, "")}${addition}` : `${block.text.replace(/\s+$/, "")}\n\n${addition}`;
  }
  requireText(next, "The note's new text");
  if (next === block.text) {
    return { id: block.id, ref: `((${block.id}))`, revision: block.revision, previousRevision: block.revision, diff: "" };
  }
  // Only an explicit boolean true skips the guard ("true" or 1 do not), and what it let go is said in the result.
  let dropped: string[] = [];
  if (input.allowStructural !== true) await refuseDroppedStructure(client, block, next);
  else {
    const lost = droppedStructure(block.text, next);
    dropped = [...lost.pages, ...lost.anchors.map(anchor => `^${anchor}`)];
  }
  const updated = await client.request<Block>({
    action: "update",
    blockId: block.id,
    text: next,
    expectedRevision,
    mutation: mutationOf(actor),
  });
  return {
    id: updated.id,
    ref: `((${updated.id}))`,
    revision: updated.revision,
    previousRevision: block.revision,
    diff: shortDiff(block.text, updated.text),
    ...(dropped.length ? { dropped } : {}),
    ...(await warned(client, updated.text, updated.id, updated.id, { before: block.text, at: { note: updated.id, revision: updated.revision, actorId: actor.actorId } })),
  };
}

/**
 * What a write's answer says about the text it wrote (PIE-1270): the references and components it read, then what to fix
 * before calling it done: the house rules measured in code (outline-core's write-shape), and, when `gate` is given (a
 * create's or an edit's, with the text before), the figure it would read best as (figure-fit.ts). Every finding is a
 * warning worded as a gate, never a refusal; `next` always ends the answer.
 */
async function warned(client: AgentToolsClient, text: string, near?: string, self = near, gate?: { before?: string; at: Omit<SuggestionWrite, "source"> }): Promise<{ warnings?: string[]; components?: string[]; figures?: string[]; review?: WriteReview; next?: string }> {
  const [{ warnings, components }, review, rows] = await Promise.all([
    writtenReading(client, text, near, self),
    gate ? reviewOf(client, text, gate.before, gate.at) : null,
    gate && near ? figureRowReport(client, near, text, gate.before) : null,
  ]);
  const all = [...warnings, ...(review ? reviewWarnings(review) : []), ...(rows?.warnings ?? [])];
  return { ...(all.length ? { warnings: all } : {}), ...(components.length ? { components } : {}), ...(rows?.figures.length ? { figures: rows.figures } : {}), ...(review ? { review } : {}), ...(near ? { next: review?.next ?? shapeNext(near) } : {}) };
}

// ─── Create ────────────────────────────────────────────────────────────────

/** A new block under `parent` (a reference, or `root`), at `position` among its siblings (0 first; default last). */
export async function createBlock(
  client: AgentToolsClient,
  input: { parent: string; text: string; position?: number },
  actor: AgentActor,
): Promise<{ id: string; ref: string; revision: number; parentId: string | null; warnings?: string[]; components?: string[]; figures?: string[]; next?: string }> {
  const text = requireText(input.text, "The new block's text");
  if (typeof input.parent !== "string" || !input.parent.trim()) throw new WorkToolRefusal("Give the parent: a reference, or root");
  const parentId = input.parent.trim() === "root" ? null : (await writableBlock(client, input.parent)).id;
  const position = input.position === undefined ? undefined : boundedInteger(input.position, "position", 0, 0, 1_000_000);
  let block = await client.request<Block>({ action: "create", text, parentId, author: actor.author ?? "agent", provenance: actor.author && actor.author !== "agent" ? undefined : provenanceOf(actor) });
  if (position !== undefined) {
    await client.requireCompatibleService();
    block = await client.request<Block>({ action: "move", blockId: block.id, expectedRevision: block.revision, parentId, position, mutation: mutationOf(actor) });
  }
  return { id: block.id, ref: `((${block.id}))`, revision: block.revision, parentId: block.parentId, ...(await warned(client, block.text, block.id, block.id, { at: { note: block.id, revision: block.revision, actorId: actor.actorId } })) };
}

// ─── A view's hand-set order ────────────────────────────────────────────────

export interface ViewOrderResult {
  view: string;
  ref: string;
  /** The view's members in its hand-set order, after the write when `ids` were given. */
  order: { id: string; title: string; workId?: string }[];
  /** True when the order is cut short (more than 1000 members): a write is then refused. */
  truncated?: true;
}

/**
 * A view's hand-set order (a view with no `[sort::]`), or, with `ids`, those members put first in the order given
 * and the rest after them as they were. Ids are what the service's resolver takes (ids, ((id)), prefixes, Work IDs,
 * [[page]]s). One service call, `virtual.occurrences.move`, attributed to `actor`.
 */
export async function viewOrder(
  client: AgentToolsClient,
  input: { view: string; ids?: unknown },
  actor: AgentActor | undefined,
): Promise<ViewOrderResult> {
  if (typeof input.view !== "string" || !input.view.trim()) throw new WorkToolRefusal("view is the view's id, ((id)) or [[page]]");
  if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some(id => typeof id !== "string"))) {
    throw new WorkToolRefusal("ids is a list of block ids, ((id))s or Work IDs");
  }
  const refs = (input.ids ?? []) as string[];
  // The service resolves the view and each ref, and refuses what isn't a view, isn't in it or is sorted.
  let order: VirtualBranchOrder;
  if (refs.length) {
    if (!actor || (!actor.actorId.trim() && actor.author !== "user")) throw new WorkToolRefusal("view order writes: pass --actor <agent id>");
    await client.requireCompatibleService();
    order = await client.request<VirtualBranchOrder>({ action: "virtual.occurrences.move", input: { view: input.view, blocks: refs }, mutation: mutationOf(actor) });
  } else {
    order = await client.request<VirtualBranchOrder>({ action: "virtual.occurrences.order", viewId: input.view });
  }
  const read = order.blockIds.length
    ? await client.request<{ blocks: ProjectedBlock[] }>({ action: "blocks.read", ids: order.blockIds, fields: ["title", "properties"] })
    : { blocks: [] };
  const byId = new Map(read.blocks.map(b => [b.id, b]));
  return {
    view: order.viewId,
    ref: `((${order.viewId}))`,
    order: order.blockIds.map(id => {
      const b = byId.get(id), workId = b?.properties?.find(p => p.key === "work-id")?.value;
      return { id, title: b?.title ?? "", ...(workId ? { workId } : {}) };
    }),
    ...(order.completeness.kind === "truncated" ? { truncated: true as const } : {}),
  };
}

// ─── Comments ──────────────────────────────────────────────────────────────

export interface CommentResult {
  thread: string;
  blockId?: string;
  /** A comment on a Resource: which one. */
  resourceId?: string;
  author: BlockAuthor;
  actorId?: string;
  lifecycle: string;
  deduplicated?: boolean;
  /** References the comment kept that lead nowhere, with a did-you-mean (PIE-761), and what to fix before calling it done (PIE-1270): sent anyway. */
  warnings?: string[];
  /** The next check (PIE-1270): read the note it is on as drawn. */
  next?: string;
}

function commentResult(record: AnnotationRecord, extra: Partial<CommentResult> = {}): CommentResult {
  return {
    thread: record.parentAnnotationId ?? record.block.id,
    author: record.block.author,
    ...(record.block.actorId ? { actorId: record.block.actorId } : {}),
    lifecycle: record.lifecycle,
    ...extra,
  };
}

/**
 * A comment thread on a block, as the agent: on an exact `quote` of its source
 * (with `start`, `prefix` or `suffix` when the quote repeats), or on the
 * `whole` block. A `requestId` makes a retry return the same thread.
 */
export async function commentOn(
  client: AgentToolsClient,
  input: { ref: string; body?: string; quote?: string; whole?: boolean; start?: number; near?: number; prefix?: string; suffix?: string; requestId?: string; from?: string; kind?: string; properties?: Record<string, string | string[]> },
  actor: AgentActor,
): Promise<CommentResult> {
  // `kind` is the thread's `[kind::…]` (PIE-871: a patch note's was dropped), said here or in properties; open, as any property.
  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !input.kind.trim()) throw new WorkToolRefusal(`kind is the thread's kind, a word (patch-note, question, highlight…); got ${JSON.stringify(input.kind)}`);
    const said = input.properties?.kind, kind = input.kind.trim();
    const same = typeof said === "string" ? said.trim() === kind : Array.isArray(said) && said.length === 1 && String(said[0]).trim() === kind;
    if (said !== undefined && !same) throw new WorkToolRefusal(`kind is "${kind}" but properties.kind is ${JSON.stringify(said)}: give one`);
    input = { ...input, properties: { ...(input.properties ?? {}), kind } };
  }
  if ((input.whole === true) === (typeof input.quote === "string")) {
    throw new WorkToolRefusal("Give either quote (exact source text) or whole: true");
  }
  // A highlight is a comment on a passage with no body (ADR 0004 contract 6): its properties say what it is.
  const body = typeof input.quote === "string" && (input.body === undefined || input.body === "") ? "" : requireText(input.body, "The comment");
  if (input.properties !== undefined) {
    const problem = input.properties && typeof input.properties === "object" && !Array.isArray(input.properties) ? annotationPropertyProblem(input.properties) : "properties map names to a value or a list of values";
    if (problem) throw new WorkToolRefusal(`properties: ${problem}. Example: properties: { kind: "highlight", tags: ["soil"], color: "warn" }`);
  }
  const resource = resourceRefOf(input.ref);
  const result = resource ? await commentOnResource(client, resource, { ...input, body }, actor) : await commentOnBlock(client, input, body, actor);
  // A kind nobody else's thread has (a typo of one that's in use?): kept, as anything written is, and said (PIE-871).
  const kind = input.properties?.kind;
  const said = typeof kind === "string" ? await newKindWarning(client, kind.trim()) : null;
  // The house rules, measured on the body (PIE-1270): a margin comment is read as quickly as a note, so a wall in it is told too.
  const warnings = [...(result.warnings ?? []), ...(said ? [said] : []), ...shapeWarnings(body, undefined, { kind: "comment" })];
  return { ...result, ...(warnings.length ? { warnings } : {}), ...(result.blockId ? { next: shapeNext(result.blockId) } : {}) };
}

/** What to say about a thread's kind no other thread in the outline has: the kinds in use, the nearest first. */
async function newKindWarning(client: AgentToolsClient, kind: string): Promise<string | null> {
  if (!kind) return null;
  const answer = await client.request<{ facets?: { key: string; values: { value: string; count: number }[] }[] }>({
    action: "blocks.query", query: { filters: [{ key: "type", value: "annotation" }], facets: ["kind"], limit: 1 },
  } as never).catch(() => null);
  const values = answer?.facets?.find(f => f.key === "kind")?.values ?? [];
  if (!values.length || (values.find(v => v.value === kind)?.count ?? 0) > 1) return null;
  const others = values.filter(v => v.value !== kind).sort((a, b) => b.count - a.count).map(v => v.value);
  if (!others.length) return null;
  const near = closest(kind, others);
  return `kind "${kind}" is new in this outline (kinds in use: ${others.slice(0, 12).join(", ")})${near ? `; did you mean "${near}"?` : ""} It was kept; outline_set_property on the thread changes it.`;
}

async function commentOnBlock(client: AgentToolsClient, input: Parameters<typeof commentOn>[1], body: string, actor: AgentActor): Promise<CommentResult> {
  const block = await writableBlock(client, input.ref);
  const receipt = await createBlockComment(client, {
    requestId: input.requestId?.trim() || randomUUID(),
    author: actor.author ?? "agent",
    provenance: actor.author && actor.author !== "agent" ? undefined : provenanceOf(actor),
    input: {
      blockId: block.id,
      expectedRevision: block.revision,
      body,
      source: "agent",
      ...(input.whole ? {} : {
        passage: {
          quote: input.quote!,
          ...(input.start === undefined ? {} : { start: input.start }),
          ...(input.near === undefined ? {} : { near: input.near }),
          ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
          ...(input.suffix === undefined ? {} : { suffix: input.suffix }),
        },
      }),
      ...(input.properties ? { properties: input.properties } : {}),
    },
  });
  const record = receipt.annotations[0];
  if (!record) throw new Error("The service recorded no comment");
  return commentResult(record, { blockId: block.id, ...(receipt.deduplicated ? { deduplicated: true } : {}), ...(await warned(client, body, block.id, record.block.id)) });
}

/**
 * A comment thread on a Resource's stored text (a file, a fetched page), as the agent: on an exact `quote` of the
 * text outline_read returned, which the service reads again and refuses when the Resource has changed since
 * `revision`. The thread lives in the outline; the Resource is never written. `from`: the note whose link names it,
 * kept as the thread's reference context (it shows as a backlink there).
 */
async function commentOnResource(
  client: AgentToolsClient,
  ref: ResourceRef,
  input: { body: string; quote?: string; whole?: boolean; start?: number; near?: number; prefix?: string; suffix?: string; requestId?: string; from?: string; revision?: number; properties?: Record<string, string | string[]> },
  actor: AgentActor,
): Promise<CommentResult> {
  if (input.whole) throw new WorkToolRefusal("A Resource's text is commented on at a quote; give quote (exact source text), not whole");
  const resourceId = (await resourceIdOf(client, ref, true, actor))!;
  const description = await client.request<ResourceDescription>({ action: "resources.describe", target: { kind: "resource", resourceId } });
  const source = resourceCommentSource(description);
  const hash = source?.representation.contentHash;
  if (!source || !hash) throw new WorkToolRefusal("This Resource has no stored text a comment can quote (a PDF, a ticket, or a file that is gone)");
  const from = input.from?.trim() ? (await resolveReference(client, input.from)).block.id : undefined;
  const receipt = await client.request<AnnotationBatchReceipt>({
    action: "annotations.batch",
    requestId: input.requestId?.trim() || randomUUID(),
    author: actor.author ?? "agent",
    provenance: actor.author && actor.author !== "agent" ? undefined : provenanceOf(actor),
    operations: [{ operationId: "comment", type: "resource-comment", input: {
      resourceId, expectedRevision: input.revision ?? resourceTextRevision(hash), body: input.body, source: "agent",
      passage: {
        quote: input.quote!,
        ...(input.start === undefined ? {} : { start: input.start }),
        ...(input.near === undefined ? {} : { near: input.near }),
        ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
        ...(input.suffix === undefined ? {} : { suffix: input.suffix }),
      },
      ...(from ? { referenceBlockId: from } : {}),
      ...(input.properties ? { properties: input.properties } : {}),
    } }],
  });
  const record = receipt.annotations[0];
  if (!record) throw new Error("The service recorded no comment");
  return commentResult(record, { resourceId, ...(receipt.deduplicated ? { deduplicated: true } : {}) });
}

function threadId(thread: string): string {
  const id = typeof thread === "string" ? referencedBlock(thread)?.blockId ?? "" : "";
  if (!UUID.test(id)) throw new WorkToolRefusal("Name the thread by its id (outline_comment returns it)");
  return id.toLowerCase();
}

/** A reply in a comment thread, as the agent. */
export async function replyTo(
  client: AgentToolsClient,
  input: { thread: string; body: string; requestId?: string },
  actor: AgentActor,
): Promise<CommentResult & { reply: string }> {
  const body = requireText(input.body, "The reply");
  const annotationId = threadId(input.thread);
  const receipt = await client.request<AnnotationBatchReceipt>({
    action: "annotations.reply",
    requestId: input.requestId?.trim() || randomUUID(),
    input: { annotationId, body, source: "agent" },
    author: actor.author ?? "agent",
    provenance: actor.author && actor.author !== "agent" ? undefined : provenanceOf(actor),
  });
  const record = receipt.annotations[0];
  if (!record) throw new Error("The service recorded no reply");
  return { ...commentResult(record, { ...(receipt.deduplicated ? { deduplicated: true } : {}), ...(await warned(client, body, undefined, record.block.id)) }), thread: annotationId, reply: record.block.id };
}

/**
 * A posted comment's or reply's words edited (PIE-763), as the agent: `mark` is the comment or reply, `observed` the
 * words it read (or `revision`, the comment's revision as read), so an edit made meanwhile is refused, never
 * overwritten. Who wrote it stays its author; the edit is the agent's, and the comment shows as edited by it.
 */
export async function editComment(
  client: AgentToolsClient,
  input: { mark: string; body: string; observed?: string; revision?: number },
  actor: AgentActor,
): Promise<CommentResult & { mark: string; revision: number; edited: string }> {
  const body = requireText(input.body, "The comment's new words");
  const annotationId = threadId(input.mark);
  if (input.observed === undefined && input.revision === undefined) throw new WorkToolRefusal("Say which words you're changing: observed (the comment's words as you read them) or revision (its revision), so an edit made meanwhile isn't overwritten");
  const now = await client.request<AnnotationRecord>({ action: "annotations.get", annotationId });
  if (input.observed !== undefined && input.observed.trim() !== now.body.trim()) throw new WorkToolRefusal(`The comment changed since you read it; its words now: ${JSON.stringify(now.body.slice(0, 400))} (revision ${now.block.revision})`);
  const record = await client.request<AnnotationRecord>({
    action: "annotations.update",
    input: { annotationId, expectedRevision: input.revision ?? now.block.revision, body },
    mutation: mutationOf(actor),
  });
  return { ...commentResult(record, await warned(client, body, undefined, record.block.id)), mark: record.block.id, revision: record.block.revision, edited: record.edited ?? "" };
}

/** Resolves (or reopens) a comment thread, as the agent. */
export async function resolveThread(
  client: AgentToolsClient,
  input: { thread: string; resolved: boolean },
  actor: AgentActor,
): Promise<CommentResult> {
  if (typeof input.resolved !== "boolean") throw new WorkToolRefusal("Say resolved: true to resolve the thread, false to reopen it");
  const annotationId = threadId(input.thread);
  const record = await client.request<AnnotationRecord>({
    action: "annotations.lifecycle",
    input: { annotationId, lifecycle: input.resolved ? "resolved" : "open" },
    mutation: mutationOf(actor),
  });
  return commentResult(record);
}

// ─── Changes ───────────────────────────────────────────────────────────────

/** `machinery` as an agent gives it (PIE-867): hide (the default), only or show; anything else says what is allowed. */
function machineryInput(value: unknown): MachineryMode {
  try { return parseMachineryMode(value); } catch (error) { throw new WorkToolRefusal(error instanceof Error ? error.message : String(error)); }
}

export interface ChangeRow {
  cursor: number;
  id: string;
  title: string;
  kind: string;
  author: BlockAuthor;
  actorId?: string;
  sessionId?: string;
  at: string;
  revision: number;
}

/**
 * What changed since a point: an ISO time, or the `cursor` a previous call
 * returned. Each block once, at its latest edit, newest first. Without
 * `author`, the person's, agents' and the system's edits together; `actor`
 * narrows to one agent (or extension).
 *
 * When more changed than `limit`, `complete` is false and `before` is given:
 * call again with the same `since` and that `before` for the older ones, until
 * `complete` is true. Then pass `cursor` as `since` next time for only what is
 * newer; it is past everything that matched, so take it only once every page
 * is read.
 */
export async function changesSince(
  client: AgentToolsClient,
  input: { since: string | number; author?: string; actor?: string; limit?: number; before?: number; machinery?: string },
): Promise<{ entries: ChangeRow[]; cursor: number; complete: boolean; before?: number }> {
  const limit = boundedInteger(input.limit, "limit", 20, 1, 100);
  const since = typeof input.since === "number" ? String(input.since) : typeof input.since === "string" ? input.since.trim() : "";
  if (!since) throw new WorkToolRefusal("Give since: an ISO time (2026-01-31T09:00:00Z) or a cursor from an earlier call");
  const point = /^\d+$/.test(since) ? { afterCursor: Number(since) } : { since };
  if ("since" in point && !Number.isFinite(Date.parse(since))) throw new WorkToolRefusal(`since is neither a time nor a cursor: ${since}`);
  if (input.author !== undefined && !["user", "agent", "system"].includes(input.author)) {
    throw new WorkToolRefusal("author is user, agent or system");
  }
  const before = input.before === undefined ? undefined : boundedInteger(input.before, "before", 1, 1, Number.MAX_SAFE_INTEGER);
  const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : undefined;
  await client.requireCompatibleService();
  const authors = (input.author ? [input.author] : actor ? ["agent", "system", "user"] : ["user", "agent", "system"]) as BlockAuthor[];
  // One more than asked (the service's cap is 100), to tell a full page from a cut one.
  const asked = Math.min(limit + 1, 100);
  const pages = await Promise.all(authors.map(author => client.request<BlockEditActivityPage>({
    action: "activity.recent",
    ...point,
    author,
    limit: asked,
    kinds: ["text", "properties", "move", "delete", "restore"],
    ...(actor ? { actorId: actor } : {}),
    ...(before ? { beforeCursor: before } : {}),
    ...(input.machinery !== undefined ? { machinery: machineryInput(input.machinery) } : {}),
  })));
  // One entry per block across authors: its latest.
  const latest = new Map<string, ChangeRow>();
  for (const entry of pages.flatMap(page => page.entries)) {
    const had = latest.get(entry.block.id);
    if (had && had.cursor > entry.cursor) continue;
    latest.set(entry.block.id, {
      cursor: entry.cursor,
      id: entry.block.id,
      title: blockDisplayTitle(entry.block),
      kind: entry.kind,
      author: entry.author,
      ...(entry.actorId ? { actorId: entry.actorId } : {}),
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      at: entry.editedAt,
      revision: entry.block.revision,
    });
  }
  const sorted = [...latest.values()].sort((a, b) => b.cursor - a.cursor);
  // `cut`: every entry above it is here; at or below it, some may not be. A page the service filled is whole only
  // above its oldest entry (one cursor can cover several blocks), and so is this answer past `limit`.
  let cut = 0;
  for (const page of pages) {
    if (page.entries.length >= asked) cut = Math.max(cut, Math.min(...page.entries.map(entry => entry.cursor)));
  }
  let entries = sorted.filter(entry => entry.cursor > cut);
  if (entries.length > limit) {
    cut = entries[limit]!.cursor;
    entries = entries.filter(entry => entry.cursor > cut);
  }
  // More blocks at one cursor than `limit`: return them all rather than page forever.
  if (cut && !entries.length) {
    entries = sorted.filter(entry => entry.cursor >= cut);
    cut -= 1;
  }
  const floor = "afterCursor" in point ? point.afterCursor ?? 0 : 0;
  return {
    entries,
    cursor: Math.max(floor, ...pages.map(page => page.cursor)),
    complete: cut === 0,
    ...(cut ? { before: cut + 1 } : {}),
  };
}

// ─── draft.patch ───────────────────────────────────────────────────────────

/**
 * `draft.patch` as the agent: compare-and-swap on spans of a note's text, safe
 * while the person types in it. The door holding a live draft gets it; with
 * none, the saved note is patched under the revision, as an ordinary edit.
 * `policy` is `edit` unless the caller says `prose`: the same guard as
 * outline_edit (a dropped `[page::…]` or linked `^anchor` is refused, unless
 * `allowStructural`). A patch that no longer matches, or that `prose` refuses,
 * is refused without writing; the agent re-reads and retries in the same turn.
 * `propose: true` deliberately offers a suggestion instead.
 */
export async function patchDraft(
  client: AgentToolsClient,
  input: { ref: string; revision: number; patches: DraftPatchSpan[]; mark?: string; policy?: DraftPatchPolicyName; allowStructural?: boolean; propose?: DraftPatchInput["propose"] },
  actor: AgentActor,
  /** `suggest: false`: a write that isn't the note's words (a property set) asks figure-fit nothing, measures nothing and has no next check. */
  o: { suggest?: boolean } = {},
): Promise<DraftPatchResult & { warnings?: string[]; components?: string[]; figures?: string[]; review?: WriteReview; next?: string }> {
  const revision = requireRevision(input.revision);
  const policy = input.policy ?? "edit";
  if (!DRAFT_PATCH_POLICIES.includes(policy)) throw new WorkToolRefusal(`policy is ${DRAFT_PATCH_POLICIES.join(" or ")}`);
  if (!Array.isArray(input.patches) || input.patches.length === 0) throw new WorkToolRefusal("Give at least one patch: {observed, replacement}");
  for (const patch of input.patches) {
    if (!patch || typeof patch.observed !== "string" || !patch.observed || typeof patch.replacement !== "string") {
      throw new WorkToolRefusal("Each patch needs observed (the exact text you read, never empty) and replacement");
    }
  }
  await client.requireCompatibleService();
  const block = await writableBlock(client, input.ref);
  // The note as its draft has it when a person has it open (drafts.read), else as saved: a patch into a live draft
  // leaves the saved note as it was, so what was written is read where it went.
  const read = async () => (await client.request<{ text: string }>({ action: "drafts.read", blockId: block.id }).catch(() => null))?.text;
  const was = (await read()) ?? block.text;
  const result = await client.request<DraftPatchResult>({
    action: "draft.patch",
    blockId: block.id,
    revision,
    patches: input.patches,
    mutation: mutationOf(actor),
    policy,
    ...(input.allowStructural === true ? { allowStructural: true } : {}),
    ...(typeof input.mark === "string" && input.mark.trim() ? { mark: { text: input.mark } } : {}),
    ...(input.propose !== undefined ? { propose: input.propose } : {}),
  }, 15_000);
  // The note as it is now, read whole (a replacement alone loses its context); a warning the note had before isn't this write's (PIE-761).
  const after = await read();
  if (after === undefined || after === was) return result;
  const before = new Set(await referenceWarningsFor(client, was, block.id));
  const [now, review, rows] = await Promise.all([
    writtenReading(client, after, block.id),
    o.suggest === false ? null : reviewOf(client, after, was, { note: block.id, revision: (result.outcome === "applied" ? result.edits.find(e => e.blockId === block.id)?.revision : undefined) ?? block.revision, actorId: actor.actorId }),
    o.suggest === false ? null : figureRowReport(client, block.id, after, was),
  ]);
  const warnings = [
    ...now.warnings.filter(w => !before.has(w)),
    ...(review ? reviewWarnings(review) : []),
    ...(rows?.warnings ?? []),
  ];
  return { ...result, ...(warnings.length ? { warnings } : {}), ...(now.components.length ? { components: now.components } : {}), ...(rows?.figures.length ? { figures: rows.figures } : {}), ...(review ? { review, next: review.next } : {}) };
}

// ─── One header property ───────────────────────────────────────────────────

export type SetPropertyResult =
  | (DraftPatchResult & { id: string; key: string; previous: string | null; value: string })
  | { outcome: "unchanged"; id: string; key: string; previous: string; value: string };

/**
 * Sets one `[key::value]` chip on a note's header line (outline-core's `header-line.ts`): the chip's value replaced
 * where it is, or the chip added at the line's end. It is one `draft.patch` span against the revision the agent read,
 * so it has the patch's rules: a live draft gets it in place (or, with `propose: true`, a suggestion), and a note that
 * changed since is refused if it cannot rebase, never overwritten. A key written more than once is a list: outline_patch edits it.
 */
export async function setBlockProperty(
  client: AgentToolsClient,
  input: { ref: string; key?: string; value?: string; properties?: Record<string, string | null>; revision: number; propose?: DraftPatchInput["propose"] },
  actor: AgentActor,
): Promise<SetPropertyResult | SetPropertiesResult> {
  if (input.properties !== undefined) {
    if (input.key !== undefined || input.value !== undefined) throw new WorkToolRefusal("Give either key and value (one property) or properties (several), not both");
    return setBlockProperties(client, { ref: input.ref, properties: input.properties, revision: input.revision, ...(input.propose ? { propose: input.propose } : {}) }, actor);
  }
  if (typeof input.key !== "string" || typeof input.value !== "string") throw new WorkToolRefusal("Give key and value (one property), or properties: { key: value, key: null } (several; null removes)");
  const revision = requireRevision(input.revision);
  const key = input.key.trim();
  if (!isPropertyKey(key)) throw new WorkToolRefusal(`${JSON.stringify(input.key)} isn't a property key: letters, digits, - and _`);
  const value = input.value.trim();
  if (!value || /[\]\n]/.test(value)) throw new WorkToolRefusal("The value is one line of text without ]; give a non-empty value");
  const block = await writableBlock(client, input.ref);
  const header = headerLine(block.text);
  if (header.line < 0) throw new WorkToolRefusal(`${block.id} is empty; it has no header line to set [${key}::…] on`);
  const same = header.chips.filter(chip => chip.key.toLowerCase() === key.toLowerCase());
  if (same.length > 1) throw new WorkToolRefusal(`[${key}::…] is written ${same.length} times on ${block.id} (a list); edit it with outline_patch`);
  const chip = same[0];
  if (chip && chip.value === value) return { outcome: "unchanged", id: block.id, key: chip.key, previous: chip.value, value };
  const span: DraftPatchSpan = chip
    ? { observed: block.text.slice(chip.start, chip.end), replacement: chipText({ key: chip.key, value }), range: { start: chip.start, end: chip.end } }
    : (() => {
      const line = block.text.slice(header.offset, header.end);
      return { observed: line, replacement: `${line.trimEnd()} ${chipText({ key, value })}`, range: { start: header.offset, end: header.end } };
    })();
  const result = await patchDraft(client, { ref: block.id, revision, patches: [span], policy: "edit", ...(input.propose ? { propose: input.propose } : {}) }, actor, { suggest: false });
  return { ...result, id: block.id, key: chip?.key ?? key, previous: chip?.value ?? null, value };
}

export type SetPropertiesResult =
  | (DraftPatchResult & { id: string; properties: PropertyChanges })
  | { outcome: "unchanged"; id: string; properties: PropertyChanges };
/** What a map write changed, by key: the value the chip had (null: none) and has now (null: removed). Keys already as asked are left out. */
export type PropertyChanges = Record<string, { previous: string | null; value: string | null }>;

/**
 * Several header chips in one write: `{ key: value }`, a null value removing the chip. Each key is checked as the single
 * form checks it, and the whole header line is one `draft.patch` span against the revision read, so the note takes one
 * revision however many chips changed, and a refusal anywhere (a list, a bad key or value, a stale revision) writes none.
 * A chip is replaced where it is, a new one is added at the line's end in the map's order, and a separator the removals
 * leave dangling (`Seed list - ` once its chips are gone) goes with them.
 */
export async function setBlockProperties(
  client: AgentToolsClient,
  input: { ref: string; properties: Record<string, string | null>; revision: number; propose?: DraftPatchInput["propose"] },
  actor: AgentActor,
): Promise<SetPropertiesResult> {
  const revision = requireRevision(input.revision);
  const given = input.properties;
  if (!given || typeof given !== "object" || Array.isArray(given)) throw new WorkToolRefusal("properties is an object of { key: value }, null removing a key");
  const entries = Object.entries(given);
  if (!entries.length) throw new WorkToolRefusal("Give at least one property in properties: { key: value } (null removes the key)");
  const wanted: [string, string | null][] = entries.map(([name, raw]) => {
    const key = name.trim();
    if (!isPropertyKey(key)) throw new WorkToolRefusal(`${JSON.stringify(name)} isn't a property key: letters, digits, - and _`);
    if (raw === null) return [key, null];
    if (typeof raw !== "string") throw new WorkToolRefusal(`[${key}::…] takes a string (or null to remove it); got ${JSON.stringify(raw)}`);
    const value = raw.trim();
    if (!value || /[\]\n]/.test(value)) throw new WorkToolRefusal(`[${key}::…]: the value is one line of text without ]; give a non-empty value (null removes the key)`);
    return [key, value];
  });
  const names = wanted.map(([key]) => key.toLowerCase());
  const twice = wanted.find(([key], i) => names.indexOf(key.toLowerCase()) !== i);
  if (twice) throw new WorkToolRefusal(`[${twice[0]}::…] is named twice in properties (keys match without regard to case); name each key once`);
  const block = await writableBlock(client, input.ref);
  const header = headerLine(block.text);
  if (header.line < 0) throw new WorkToolRefusal(`${block.id} is empty; it has no header line to set properties on`);
  const changes: PropertyChanges = {};
  // Edits to the header line, from the back so the offsets of the earlier ones hold.
  const replaced: { start: number; end: number; text: string }[] = [];
  const added: string[] = [];
  for (const [key, value] of wanted) {
    const same = header.chips.filter(chip => chip.key.toLowerCase() === key.toLowerCase());
    if (same.length > 1) throw new WorkToolRefusal(`[${key}::…] is written ${same.length} times on ${block.id} (a list); edit it with outline_patch`);
    const chip = same[0];
    if (!chip) { if (value !== null) { added.push(chipText({ key, value })); changes[key] = { previous: null, value }; } continue; }
    if (chip.value === value) continue;
    changes[chip.key] = { previous: chip.value, value };
    if (value !== null) { replaced.push({ start: chip.start, end: chip.end, text: chipText({ key: chip.key, value }) }); continue; }
    // A removed chip takes the blanks before it, and the ` -` separator before those (`Seed - [a::1] - [b::2]` loses " - [a::1]").
    let start = chip.start;
    while (start > header.offset && /[ \t]/.test(block.text[start - 1]!)) start--;
    if (start < chip.start && block.text[start - 1] === "-" && start - 1 > header.offset && /[ \t]/.test(block.text[start - 2]!)) {
      start--;
      while (start > header.offset && /[ \t]/.test(block.text[start - 1]!)) start--;
    }
    replaced.push({ start, end: chip.end, text: "" });
  }
  if (!Object.keys(changes).length) return { outcome: "unchanged", id: block.id, properties: {} };
  const line = block.text.slice(header.offset, header.end);
  let next = line;
  for (const edit of replaced.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start - header.offset) + edit.text + next.slice(edit.end - header.offset);
  if (added.length) next = `${next.trimEnd()} ${added.join(" ")}`;
  if (replaced.some(edit => !edit.text)) next = next.trimEnd();
  const span: DraftPatchSpan = { observed: line, replacement: next, range: { start: header.offset, end: header.end } };
  const result = await patchDraft(client, { ref: block.id, revision, patches: [span], policy: "edit", ...(input.propose ? { propose: input.propose } : {}) }, actor, { suggest: false });
  return { ...result, id: block.id, properties: changes };
}

// ─── A work id for a note ──────────────────────────────────────────────────

export type AssignIdResult =
  | { outcome: "applied"; id: string; workId: string; page: string; revision: number }
  | { outcome: "unchanged"; id: string; workId: string; page: string; revision: number };

/**
 * Stamps the outline's next work id (the `work-ids.allocate` the CLI's `work-id-allocate` runs) on an existing note,
 * against the revision the agent read. The id is the note's page address, so `[[HUB-002]]` reaches it: no `[page::…]`.
 * A note that already has one answers with it, unchanged. For notes that aren't roadmap items (a draft in an outbox);
 * work_create is for those. Attributed to `actor`.
 */
export async function assignWorkId(
  client: AgentToolsClient,
  input: { ref: string; revision: number },
  actor: AgentActor,
): Promise<AssignIdResult> {
  const revision = requireRevision(input.revision);
  const block = await writableBlock(client, input.ref);
  const had = workIdOf(block);
  if (had) return { outcome: "unchanged", id: block.id, workId: had, page: `[[${had}]]`, revision: block.revision };
  const done = await client.request<{ workId: string; block: Block }>({
    action: "work-ids.allocate", blockId: block.id, expectedRevision: revision, mutation: mutationOf(actor),
  });
  return { outcome: "applied", id: block.id, workId: done.workId, page: `[[${done.workId}]]`, revision: done.block.revision };
}

// ─── Move, trash and restore ────────────────────────────────────────────────

const short = (title: string): string => title.slice(0, 50).replace(/[|()]/g, " ").trim();
const label = (block: Block): string => `((${block.id}|${short(blockDisplayTitle(block))}))`;

export type MoveStep = "up" | "down" | "in" | "out";
export type MoveResult = import("@ep0ch/outline-core/protocol").NoteMoveReceipt & {
  id: string; ref: string; parentId: string | null; position: number; revision: number;
};

export async function moveBlock(
  client: AgentToolsClient,
  input: { ref: string; parent?: string; before?: string; after?: string; position?: number; revision: number; step?: MoveStep },
  actor: AgentActor,
): Promise<MoveResult> {
  const block = await writableBlock(client, input.ref);
  const moved = await client.request<Block & import("@ep0ch/outline-core/protocol").NoteMoveReceipt>({
    action: "move", blockId: block.id, expectedRevision: input.revision,
    to: input.parent, before: input.before, after: input.after, step: input.step, position: input.position,
    mutation: mutationOf(actor),
  });
  return { outcome: moved.outcome, id: moved.id, ref: `((${moved.id}))`, parentId: moved.parentId,
    position: moved.position, previousParentId: moved.previousParentId, previousPosition: moved.previousPosition,
    revision: moved.revision, said: moved.said };
}

export type TrashResult =
  | { outcome: "applied"; id: string; ref: string; children: number; said: string }
  | { outcome: "unchanged"; id: string; ref: string; said: string };

/**
 * Puts a note in Trash, with what is under it, against the `revision` the agent read: one changed since is refused and
 * stays (the service's conditional delete). `outline_restore` brings it back. A system note is refused; a note already
 * in Trash answers unchanged.
 */
export async function trashBlock(client: AgentToolsClient, input: { ref: string; revision: number }, actor: AgentActor): Promise<TrashResult> {
  const revision = requireRevision(input.revision);
  const { block } = await resolveReference(client, input.ref);
  if (block.effectiveDeletedRootId) return { outcome: "unchanged", id: block.id, ref: `((${block.id}))`, said: `${label(block)} is already in Trash` };
  if (isSystemNote(block)) throw new WorkToolRefusal(`${label(block)} is ${systemNoteKind(block)}, which the service keeps and finds by its properties: it can't be trashed (move it instead)`);
  if (revision !== block.revision) {
    throw new WorkToolRefusal(`${label(block)} changed since you read it (revision ${block.revision} now, you have ${revision}): outline_read it again, and trash it only if it's still the note you mean`);
  }
  // Trashing a parent trashes what is under it: the service needs exactly one Inbox, Trash and Bookmarks note, wherever they are.
  for (const view of ["inbox", "trash", "bookmarks"]) {
    const inside = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { filters: [{ key: "system-view", value: view }], subtreeRootId: block.id, limit: 1 } });
    const held = inside.blocks.find(found => found.id !== block.id);
    if (held) throw new WorkToolRefusal(`${label(block)} holds ${systemNoteKind(held)} (${label(held)}), which the service keeps and finds by its properties, so trashing ${label(block)} would take it too: outline_move it out first`);
  }
  const children = (await client.request<Block[]>({ action: "children", parentId: block.id })).length;
  try {
    await client.request<Block>({ action: "delete", blockId: block.id, expectedRevision: revision, mutation: mutationOf(actor) });
  } catch (e) {
    if (e instanceof Error && /changed since it was read/.test(e.message)) {
      throw new WorkToolRefusal(`${label(block)} changed while you were trashing it: outline_read it again, and trash it only if it's still the note you mean`);
    }
    throw e;
  }
  return { outcome: "applied", id: block.id, ref: `((${block.id}))`, children, said: `trashed ${label(block)}${children ? ` with its ${children} ${children === 1 ? "child" : "children"}` : ""}; outline_restore brings it back` };
}

export type RestoreResult = { outcome: "applied"; id: string; ref: string; revision: number; renamedPages?: unknown; said: string };

/** Brings a note back from Trash, with what went under it, where it was. Only a note trashed itself (a Trash root). */
export async function restoreBlock(client: AgentToolsClient, input: { ref: string }, actor: AgentActor): Promise<RestoreResult> {
  const { block } = await resolveReference(client, input.ref);
  if (!block.effectiveDeletedRootId) throw new WorkToolRefusal(`${label(block)} isn't in Trash`);
  if (block.effectiveDeletedRootId !== block.id) {
    const root = await client.request<Block>({ action: "get", blockId: block.effectiveDeletedRootId });
    throw new WorkToolRefusal(`${label(block)} went to Trash inside ${label(root)}: restore that first (outline_restore ${root.id}), and this comes back with it`);
  }
  const restored = await client.request<Block & { renamedPages?: unknown }>({ action: "trash.restore", blockId: block.id, mutation: mutationOf(actor) });
  return { outcome: "applied", id: block.id, ref: `((${block.id}))`, revision: restored.revision, ...(restored.renamedPages ? { renamedPages: restored.renamedPages } : {}), said: `restored ${label(block)}` };
}

/** Proposal settlement uses the service's ownership, compare and attribution rules, with no reader involved. */
export async function settleProposal(client: AgentToolsClient, input: { ref: string }, op: "apply" | "dismiss" | "resolve", actor: AgentActor): Promise<unknown> {
  await client.requireCompatibleService();
  const { id } = await resolveRef(client, input.ref);
  return client.request({ action: `draft.proposal.${op}`, proposalId: id, mutation: mutationOf(actor) }, op === "resolve" ? 120_000 : undefined);
}

/**
 * What became of an agent's proposals (PIE-1086): the service reads them from the proposals' own revisions
 * (proposal-outcomes.ts). Whose: `actor` when given, else the caller's own: a persona in it covers every client it writes
 * through; with none, only the caller's session (`--session`) is its own.
 */
export async function proposalOutcomesOf(client: AgentToolsClient, input: { since?: string; actor?: string; limit?: number }, actor: AgentActor | undefined): Promise<unknown> {
  const whose = input.actor?.trim() || actor?.actorId.trim();
  if (!whose) throw new WorkToolRefusal("agent proposals: give actor (an actor id, or a persona such as loki), or pass --actor <agent id>");
  // The caller's own, with no persona to name it: this session's proposals, not every session's that writes as the same client.
  const session = !input.actor?.trim() && actor?.sessionId && !parseActor(whose).persona ? actor.sessionId : undefined;
  await client.requireCompatibleService();
  const ask = (scoped: boolean, limit = input.limit) => client.request<{ actor: string; outcomes: unknown[]; cursor: string; complete: boolean }>({ action: "proposals.outcomes", actor: whose, ...(scoped && session ? { session } : {}), ...(input.since !== undefined ? { since: input.since } : {}), ...(limit !== undefined ? { limit } : {}) });
  const page = await ask(true);
  if (page.outcomes.length) return page;
  // An empty list says why (PIE-1436): nothing changed since the cursor, or this session's own were all that was asked.
  const since = input.since ? `since ${input.since}` : "this past week";
  const persona = parseActor(whose).persona;
  if (!session) return { ...page, said: `no proposals by ${persona ?? whose} changed ${since}: an edit that applied is no proposal, and each change of one is told once (pass since to look further back)` };
  const others = (await ask(false, 50)).outcomes.length;
  const count = others >= 50 ? "50 or more changes" : others === 1 ? "1 change" : `${others} changes`;
  const left = others ? `; ${count} to proposals by ${whose} from other sessions ${others === 1 ? "is" : "are"} left out (actor="${whose}" lists them)` : "";
  return { ...page, said: `none from this session: ${whose} writes with no persona, so only this session's proposals are its own${left}. With a persona (agent = "<name>" in the folder's .ep0ch, or EP0CH_AGENT), a session hears the proposals of every session writing as it` };
}

/**
 * Runs a script block as an agent (PIE-1272), the way a person's press runs it: `this` the note it is about, `slots`
 * its props. The service caps its writes at the outline's MCP access, the same as the gateway's script_run.
 */
export async function runScriptBlock(client: AgentToolsClient, input: { ref: string; this?: string; slots?: Record<string, string> }, actor: AgentActor): Promise<unknown> {
  await client.requireCompatibleService();
  const { id } = await resolveRef(client, input.ref);
  const about = input.this ? (await resolveRef(client, input.this)).id : undefined;
  return client.request({ action: "scripts.run", blockId: id, ...(about ? { this: about } : {}), ...(input.slots ? { slots: input.slots } : {}), access: "full", mutation: mutationOf(actor) }, 120_000);
}

// ─── The CLI's `agent` command ──────────────────────────────────────────────

export const AGENT_OPERATIONS = ["artifact-deploy", "proposal-resolve", "proposal-apply", "proposal-dismiss", "proposals", "script-run", "read", "find", "resolve", "site", "edit", "create", "comment", "reply", "edit-comment", "resolve-thread", "changes", "patch", "set-property", "assign-id", "move", "trash", "restore", "view-order", "touch-file", "figure-fit"] as const;
export type AgentOperation = (typeof AGENT_OPERATIONS)[number];

/** Runs one operation on its JSON input. Writes need an actor; reads ignore it. */
export function runAgentOperation(
  client: AgentToolsClient,
  operation: AgentOperation,
  input: Record<string, unknown>,
  actor: AgentActor | undefined,
): Promise<unknown> {
  const writer = () => {
    // A run a person pressed writes as them (author user, no actor id; PIE-1462).
    if (!actor || (!actor.actorId.trim() && actor.author !== "user")) throw new WorkToolRefusal(`agent ${operation} writes: pass --actor <agent id>`);
    return actor;
  };
  // `ref` and its aliases; a wrong input is answered with the operation's arguments and a call that works.
  const spec = AGENT_OPERATION_SPECS[operation];
  const checked = spec ? checkToolArgs(spec, input) : undefined;
  if (checked && !checked.ok) return Promise.reject(new WorkToolRefusal(checked.error));
  const any = (checked?.ok ? (operation === "view-order" ? { ...checked.args, view: checked.args.ref } : checked.args) : input) as any;
  switch (operation) {
    case "artifact-deploy":
      if (!any.repo === !any.note) return Promise.reject(new WorkToolRefusal('artifact_deploy takes repo (an ep0ch-artifacts repo) or note (a note whose [artifact::] lines name repos), one of them: {"repo":"ep0ch-artifacts/moth-garden"}'));
      return client.request({ action: "artifacts.deploy", repo: any.repo, note: any.note, domain: any.domain, mutation: mutationOf(writer()) });
    case "read": return readBlock(client, any);
    case "find": return findBlocks(client, any);
    case "resolve": return resolveRef(client, any.ref);
    case "site": return siteRead(client, any);
    case "edit": return editBlock(client, any, writer());
    case "create": return createBlock(client, any, writer());
    case "comment": return commentOn(client, any, writer());
    case "reply": return replyTo(client, any, writer());
    case "edit-comment": return editComment(client, any, writer());
    case "resolve-thread": return resolveThread(client, any, writer());
    case "changes": return changesSince(client, any);
    case "proposal-resolve": return settleProposal(client, any, "resolve", writer());
    case "proposal-apply": return settleProposal(client, any, "apply", writer());
    case "proposal-dismiss": return settleProposal(client, any, "dismiss", writer());
    case "proposals": return proposalOutcomesOf(client, any, actor);
    case "script-run": return runScriptBlock(client, any, writer());
    case "patch": return patchDraft(client, any, writer());
    case "set-property": return setBlockProperty(client, any, writer());
    case "assign-id": return assignWorkId(client, any, writer());
    case "move": return moveBlock(client, any, writer());
    case "trash": return trashBlock(client, any, writer());
    case "restore": return restoreBlock(client, any, writer());
    case "view-order": return viewOrder(client, any, Array.isArray(any.ids) && any.ids.length ? writer() : actor);
    case "touch-file": return import("./file-touches").then(m => m.touchFile(client, any, writer()));
    case "figure-fit": return sweepFigures(client, any, any.comment ? writer() : actor);
  }
}
