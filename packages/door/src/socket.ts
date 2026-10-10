// Board over the outliner's JSON-lines socket, on outline-core's PROTOCOL: a service on another number is refused.
// Reads use the service's safe-read actions. Writes are guarded by the service, never by retrying:
// `update` (a saved edit) and `properties.patch` (a card moved between lanes) name the revision they
// started from, so a stale one is refused instead of overwriting someone else's change; a comment names
// the note's revision and an exact quote, and carries a requestId, so a retry after a lost answer
// returns the comment that was already saved instead of adding a second one.
import type { StyleSheet } from "@ep0ch/outline-core/style-cascade";
import type { HeadingStyle } from "@ep0ch/outline-core/heading-styles";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { connect, type Socket } from "node:net";
import { homedir, hostname } from "node:os";
import type { Board, BoardInfo, Caller, Msg } from "./board";
import { BACKLINK_QUERY_LIMIT, type BacklinkCollection } from "./backlinks";
import type { Decoration, ResourceProjectionRead } from "./projection";
import type { ExtensionActResult, ExtensionBarResult, ExtensionList } from "./extensions";
import { resourceNote, resourceStored, RESOURCE_NOTE, type AuthoredLinksSnapshot, type AuthoredTargetFacets, type AuthoredResourceReference, type ResourceDescription } from "./authored";
import { type BlockRevisionEntry, type BlockRevisions, type FragmentKind, type HostedOutlineSummary, OUTLINE_NAME_PATTERN, type OutlinerHostStatus, protocolMismatch } from "@ep0ch/outline-core/protocol";
import { outlineLayout, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { jsonLine, JsonLines } from "./jsonl";

/** The host a board talks to when none is named: EP0CH_SOCKET (a host elsewhere), else this machine's. */
export const DEFAULT_SOCKET = process.env.EP0CH_SOCKET || outlineLayout(outlinesFolder({ EP0CH_OUTLINES: process.env.EP0CH_OUTLINES }, process.env.HOME || homedir())).socket;
/** An outline's name on a host: a short slug (outline-core's OUTLINE_NAME_PATTERN). */
export const OUTLINE_NAME = OUTLINE_NAME_PATTERN;

/** What the outline host says about itself (outline-core's wire type). */
export type HostStatus = OutlinerHostStatus;
/** One outline on a host, as `outlines.list|attach|create|import|close` describe it (outline-core's wire type). */
export type HostedOutline = HostedOutlineSummary;

/**
 * A request to the outline host itself (`outlines.*`, or `ping` for the host), on a short connection of
 * its own. The host answers the first line of a connection and hands the rest to one outline, so these
 * never go on a board's connection, which belongs to its outline.
 */
export function hostRequest<T = any>(path: string, action: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const s = connect(path);
    const timer = setTimeout(() => { s.destroy(); reject(new Error(`${action} timed out`)); }, timeoutMs);
    const lines = new JsonLines(r => {
      clearTimeout(timer); s.destroy();
      r.ok ? resolve(r.result) : reject(new Refused(r.error ?? `${action} failed`));
    });
    s.on("data", d => lines.feed(d));
    s.on("error", e => { clearTimeout(timer); reject(e); });
    s.on("connect", () => s.write(jsonLine({ id: "host", action, ...params })));
  });
}

/**
 * A block as the service sends it: full (`text`), or projected without text (`title`, from blocks.read
 * or blocks.query `fields`), or compact (`preview`, from views.read `format: "tree"`).
 */
interface WireBlock {
  id: string; parentId?: string | null; text?: string; title?: string; preview?: string; revision?: number;
  author?: string; actorId?: string;
  createdAt?: string; updatedAt?: string; deletedAt?: string | null; effectiveDeletedRootId?: string | null;
  properties?: { key: string; value: string }[];
}
/** What `roadmap.items.create` takes (pi-herdr-outliner src/types.ts RoadmapItemCreateInput). */
export interface RoadmapItemInput {
  title: string; body?: string; priority: string; workStage?: string; workBatchId?: string;
  project: string; arc: string; tracks: string[]; dependsOn?: string[]; relatedTo?: string[]; sourceBlockId?: string;
}
/** Everything a list row needs, without the note's full text. */
export const LIST_FIELDS = ["parent", "title", "properties", "revision", "timestamps", "author", "hasChildren"] as const;

export interface Activity { cursor: number; block: Msg; author: string; actor: string; kind: string; at: number }
export interface Comment {
  id: string; author: string; body: string; quote: string; at: number; open: boolean;
  /** Where the quote sits in the note's current text (UTF-16 offsets), when the service could place it. */
  start: number | null; end: number | null;
  replies: { id: string; author: string; body: string; at: number }[];
}
/** A passage to comment on: exact source text of the note, and where it starts (UTF-16 offset). */
export interface CommentPassage { quote: string; start: number }
export interface CommentReceipt { id: string; deduplicated: boolean }
/** The open proposals beside a note, as the service answers `draft.proposals.list` (the outliner's `DraftProposalsBeside`). */
export interface ProposalsBeside { blockId: string; revision: number; proposals: { id: string; afterLine: number; author: string; actorId?: string; applies: boolean }[] }
/** One row of the whole-outline index: everything but the full text. `depth`: 0 for a top-level note. */
export interface IndexBlock {
  id: string; parentId: string | null; position: number; depth: number; title: string; author: string;
  createdAt: number; updatedAt: number; props: Record<string, string>; hasChildren: boolean;
}
export type { BacklinkCollection, BacklinkSource } from "./backlinks";
/** The service's record of one committed change (PIE-399), on content events and from `changes.since`. */
export interface Change {
  sequence: number; changeId: number; action: string;
  kind: "create" | "edit" | "move" | "delete" | "restore" | "purge" | "annotate" | "draft" | "reorder" | "other";
  blockId?: string; parentId?: string | null; previousParentId?: string | null;
  revision?: number; deleted?: boolean; actor?: { author?: string; actorId?: string };
  /** Who asked for it when that isn't its writer: an extension's action (`actor` `ext:<id>`) run for the person or an agent. */
  requestedBy?: { author?: string; actorId?: string };
  recordedAt: string;
}
/**
 * An outline event. Besides the service's own, the door makes two after a reconnect:
 * `reset` (reload everything: the feed's history doesn't reach back far enough)
 * and `reconnected` (caught up; `caughtUp` changes were replayed as ordinary events first).
 */
/** The spans of a `draft.patch` as the service passes them on (@ep0ch/outline-core/draft-patch-compare). */
export type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import type { CalloutType } from "@ep0ch/outline-core/callouts";

/**
 * What the service asks the door holding a draft (a `draft` event), and the answer the door sends back. A patch
 * that applies or dismisses a proposal names it (`proposal`, PIE-510), so the door says which without guessing.
 */
export type DraftRequest =
  | { kind: "read"; requestId: string; holdId: string; blockId: string }
  | { kind: "patch"; requestId: string; holdId: string; blockId: string; patchId: string; revision: number; patches: DraftPatchSpan[]; mutation: { author: string; actorId?: string }; mark?: string; force?: boolean; proposal?: { id: string; op: "apply" | "dismiss" } }
  | { kind: "revert"; requestId: string; holdId: string; blockId: string; patchId: string };
export type DraftAnswer = { text: string; revision: number } | { applied: true } | { applied: false; reason: string } | { reverted: boolean };
/** A live draft's hold on the service: renewed while the draft is open, let go when it closes. */
export interface DraftHoldHandle {
  revise(revision: number): void; release(): void;
  /** The person typed in it (never an agent's patch): told to the service a moment later (`drafts.touch`). */
  touched?(): void;
}
/** How long after the person's last keystroke the service is told they typed (ms); its own quiet timer settles the line. */
export const DRAFT_TOUCH_MS = 1000;
/** Lease and heartbeat of a draft hold (ms): a door that dies loses its holds within the lease. */
export const DRAFT_LEASE_MS = 15_000, DRAFT_HEARTBEAT_MS = 5_000;

export interface OutlineEvent {
  domain: string; action: string; blockId?: string; sequence: number;
  /** The Resource a `resource-catalog` event names (a registration, a refresh). */
  resourceId?: string;
  change?: Change;
  /** Replayed from `changes.since` after a reconnect, not live. */
  catchUp?: boolean;
  reason?: string;
  caughtUp?: number;
  /** On a `draft` event: what the service asks the door holding that draft (PIE-501). */
  draft?: DraftRequest;
}
/** A view's hand-set order (the outliner's `VirtualBranchOrder`): what a placement is checked against. */
export interface ViewOrder { viewId: string; viewRevision: number; blockIds: string[]; completeness: { kind: string; limit?: number } }

/** views.read's answer (PIE-397), blocks as list rows. */
export interface SavedViewRead {
  status: "ready" | "invalid" | "unsupported" | "missing" | "changed" | "failed";
  viewId: string; revision?: number; sequence: number;
  configuredLimit?: number; effectiveLimit?: number; offset?: number; total?: number; nextOffset?: number;
  blocks: Msg[];
  completeness: { kind: string } | null;
  errors: string[];
  problems?: { code: string; message: string; property?: string; position?: number }[];
}
export type ChangePage =
  | { kind: "changes"; changes: Change[]; nextSequence: number; completeness: { kind: string }; sequence: number }
  | { kind: "reset"; reason: string; oldestSequence: number; sequence: number };

/** The first line of a compact tree preview (it joins a property-less note's lines with ` ↵ `). */
export const previewTitle = (p: string) => p.split(" \u21b5 ")[0]!.trim();

const toMsg = (b: WireBlock, childIds: string[] = []): Msg => ({
  id: b.id,
  text: b.text ?? b.title ?? (b.preview !== undefined ? previewTitle(b.preview) : ""),
  parentId: b.parentId ?? null,
  childIds,
  createdAt: b.createdAt ? Date.parse(b.createdAt) : 0,
  updatedAt: b.updatedAt ? Date.parse(b.updatedAt) : 0,
  author: b.actorId ?? b.author ?? null,
  props: Object.fromEntries((b.properties ?? []).map(p => [p.key, p.value])),
  revision: b.revision,
  properties: (b.properties ?? []).map(p => ({ key: p.key, value: p.value })),
  ...(b.text === undefined ? { partial: true } : {}),
  ...(b.deletedAt || b.effectiveDeletedRootId ? { deleted: true } : {}),
});

/** A writer that is an extension (`ext:jira`): the service attributes every extension write that way. */
export const isExtensionWriter = (author: string | null | undefined) => !!author?.startsWith("ext:");

/**
 * Every property token in a text as the service's save-time parser reads it (PIE-401 `properties.preview`):
 * key, value, scope (block / line / inline), where it sits, and the `ordinal` `properties.patch` addresses.
 * Ordinals count every token (hashtags too) and hold only for exactly that text.
 */
export interface PropertyRecord {
  key: string; value: string; raw: string; start: number; end: number; line: number; column: number;
  placement: "metadata-line" | "trailing-metadata" | "inline"; syntax: "bracket" | "bare" | "hashtag";
  ordinal: number; scope: "block" | "line" | "inline";
}
/** How the service reads one `((id^fragment|label))` (`references.resolve`). */
export interface ReferenceResolution {
  blockId: string; fragmentId?: string; label?: string;
  status: "resolved" | "deleted" | "missing" | "stale" | "duplicate";
  title?: string;
}
/** How the service reads one `[[address]]` or Work ID (`pages.resolve`). Read-only: nothing is created. */
export interface PageResolution { address: string; status: "resolved" | "deleted" | "missing"; block?: Msg }
export type { NotePlacement } from "@ep0ch/outline-core/protocol";
import type { NotePlacement } from "@ep0ch/outline-core/protocol";

import type { McpAccessLevel, McpAccessStatus } from "@ep0ch/outline-core/protocol";
/**
 * Where an MCP answer came from: `live` (the outline's own host, read now) or `mirror` (a read-only copy on the
 * gateway's machine of an outline whose home is another machine). `asOf`: when it was read, or the newest change the
 * mirror holds; `note`: where the mirror comes from.
 */
export interface McpSource {
  /** `asOf`: live, when it was read; a mirror, the newest change its copy holds (the home machine's own clock). */
  source: "live" | "mirror"; asOf: string; note?: string;
  /** A live read of another machine's outline (through the shared ssh forward): that machine. */
  machine?: string;
  /** A mirror served because the live route to its machine wasn't there: why, and when it was tried (ISO). */
  liveTried?: { at: string; why: string; command?: string };
  /** A mirror older than a write made live through the gateway: when, and what it made. */
  staleSince?: { at: string; revision: number | null; uri: string | null; said: string };
  /** A mirror's copy: its file under the mirrors folder, and when that file last changed here. */
  copy?: { file: string; copiedAt: string };
  /** A mirror whose follower has stopped or fallen behind its replica: since when (when known), and why. */
  stale?: { since: string | null; why: string };
}
export interface McpReachability extends McpSource {
  id: string;
  status: "reachable";
  level: McpAccessLevel;
  revision?: number;
  reason: string;
}
/** One property token in a block's text, numbered the way `properties.patch` addresses it. */
export interface PropertyToken { key: string; value: string; ordinal: number; scope: "block" | "line" | "inline" }
/** The outliner's PropertyPatchOperation. */
export type PropertyPatch =
  | { op: "replace"; ordinal: number; value: string }
  | { op: "append"; key: string; value: string }
  | { op: "remove"; ordinal: number };

/** One property change a planned move makes: `from` null when the key is appended. */
export interface PlannedChange { key: string; to: string; from: string | null }
/** The service's plan for moving a block into one saved view (`views.planWrite` with a block). */
export type MovePlan =
  | { kind: "patch"; revision: number; changes: PlannedChange[]; operations: PropertyPatch[] }
  | { kind: "already" }
  /** `stale`: set by the door when the card changed since the board showed it (src/move.ts). */
  | { kind: "refused"; reason: string; stale?: boolean };
/** The service's plan for a new block in one saved view (`views.planWrite` with text). */
export type CreatePlan =
  | {
      kind: "create"; born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; roadmap: boolean;
      /** With text: what a plain create saves. */
      text?: string;
      /** With text in a roadmap view: what `roadmap.items.create` is called with. */
      item?: RoadmapItemInput;
      bornWith?: { key: string; value: string }[];
    }
  | { kind: "refused"; reason: string };

export type StepStatus = "todo" | "done" | "waiting" | "problem";
/** One checklist step as `checklist.query` reads it. */
export interface ChecklistStep {
  itemId?: string; identity: "unassigned" | "unique" | "duplicate"; status: StepStatus; evidence: string;
  span: { start: number; end: number; startLine: number; endLine: number }; depth: number; text: string;
  /** Where its `[ ]` starts (UTF-16 offset into the note's text). */
  markerStart?: number;
}
/** What a step change does: set its status, or only give it a stable id (`^t-…`) so it can be linked. */
export type StepChange = { kind: "status"; status: StepStatus } | { kind: "ensure-id" };

/** A fragment's slice of its note, as the service reads it (`fragments.read`, PIE-424). */
export interface FragmentSlice {
  kind: FragmentKind; label: string;
  /** Note lines (from 0, the subject), inclusive, and UTF-16 offsets [start, end). */
  startLine: number; endLine: number; start: number; end: number;
  /** The slice as a reader shows it (anchors hidden, a list item standing alone), line for line. */
  text: string;
}
export type FragmentRead =
  | { blockId: string; fragmentId: string; revision: number; status: "resolved"; fragment: FragmentSlice }
  | { blockId: string; fragmentId: string; revision: number; status: "missing" }
  | { blockId: string; fragmentId: string; revision: number; status: "duplicate"; duplicates: { kind: string; label: string; line: number }[] };

/** A fragment completion can link to, as `fragments.candidates` finds it. */
export interface FragmentCandidate {
  blockId: string; title: string; revision: number; kind: FragmentKind; label: string; lineIndex: number;
  fragmentId?: string;
  /** A heading without an anchor: the anchor it would get, and its line with it. */
  anchor?: { fragmentId: string; line: string };
}

/**
 * One transclusion as the service projects it (`transclusions.read`): ready with its note (and a fragment's
 * slice), the steps inside what it shows and the embeds inside it, nested; or why not, in the service's words.
 */
export interface TransclusionNode {
  blockId: string; fragmentId?: string; depth: number;
  status: "ready" | "missing" | "deleted" | "failed" | "fragment-missing" | "fragment-duplicate" | "limit" | "depth-limit" | "cycle" | "budget" | "too-large";
  message?: string; kind?: "note" | "fragment" | "view"; title?: string; revision?: number;
  block?: Msg; fragment?: FragmentSlice; checklist?: ChecklistStep[]; embeds?: TransclusionNode[];
}
export interface TransclusionRead {
  limits: { maxDepth: number; maxPerDocument: number; maxNodes: number };
  results: TransclusionNode[];
  dependencies: string[];
}
export interface ChecklistRead { blockId: string; revision: number; title: string; items: ChecklistStep[]; completeness: { kind: string } }

/** The block changed after the draft was read; the service kept the other writer's text. */
export class EditConflict extends Error {
  constructor(readonly blockId: string, message: string) { super(message); this.name = "EditConflict"; }
}

/** The service can't be reached: every refusal it causes starts with the status bar's word, "offline". */
export class Offline extends Error {
  constructor(detail: string) { super(`offline · ${detail}`); }
}

/**
 * The service answered with an error: it refused the request and wrote nothing. Anything else that
 * fails (a timeout, a dropped socket) leaves the outcome unknown, which is why comment writes carry a requestId.
 */
export class Refused extends Error {
  constructor(message: string) { super(message); this.name = "Refused"; }
}

/**
 * A conditional trash (`trash(id, actor, { revision, ifEmpty })`) refused because the block was written since it was
 * read: changed since that revision, or (`ifEmpty`) given text or a child.
 */
export const changedSinceRead = (e: unknown): e is Refused => e instanceof Refused && /^Block (changed since it was read|is not empty)/.test(e.message);

/**
 * The door's actor id, per machine (`ep0ch-door:float-box`), so `activity.recent` tells a laptop edit
 * from a float-box one.
 */
export const ACTOR_ID = `ep0ch-door:${hostname()}`;
/** How door edits are attributed: a person typing in the door, like the outliner's own Detail. */
export const EDIT_MUTATION = { author: "user", actorId: ACTOR_ID } as const;
/**
 * Comments and replies are a person's, like the outliner's own Detail sends them. The service takes an
 * actor id only on agent-authored annotations, so these can't name the door; resolve/reopen can.
 */
export const COMMENT_AUTHOR = "user";

/**
 * Who a write is for: the person at the keys, or an agent driving the door through its control socket
 * (`ep0ch-door act`). An agent's writes are recorded as `author: agent` with its own actor id, never as
 * the person's, so the outline's activity and comment threads say honestly who did it.
 *
 * `with` names others who wrote part of what is being saved (a draft the person and an agent both typed
 * into): the write stays the saver's, and its actor id names them all, `<saver>+<co-writer>…`.
 */
export type Actor = ({ kind: "user" } | { kind: "agent"; id: string }) & { with?: string[] };
export const USER: Actor = { kind: "user" };
/** Who did it, as a door's answer says it: the agent's id, or "you" for the person. */
export const whoOf = (actor: Actor): string => (actor.kind === "agent" ? actor.id : "you");
/** `{ by: <agent id> }` for an agent's doing, nothing for the person's: what a record or an answer spreads in. */
export const byOf = (actor: Actor): { by?: string } => (actor.kind === "agent" ? { by: actor.id } : {});
/** The actor id an agent gets when it doesn't name itself: `ep0ch-door:<hostname>:agent`. */
export const AGENT_ACTOR_ID = `${ACTOR_ID}:agent`;
/** One party's own id: an agent's, or the door's for the person at the keys. */
export const actorIdOf = (actor: Actor): string => (actor.kind === "agent" ? actor.id : ACTOR_ID);
/** The actor id a write records: the saver's, then anyone else who wrote part of it, joined by `+`. */
export const recordedActorId = (actor: Actor): string => [actorIdOf(actor), ...(actor.with ?? [])].join("+");
/** Who asks (an extension's action, a proposal applied or dismissed): the person, or an agent by its own id, which the service checks ownership by. */
export const requesterOf = (actor: Actor) => (actor.kind === "agent" ? { author: "agent", actorId: actorIdOf(actor) } : { author: "user" });
/** The `mutation` a write carries for `actor`. */
export const mutationFor = (actor: Actor = USER) =>
  actor.kind === "agent" || actor.with?.length ? { author: actor.kind, actorId: recordedActorId(actor) } : EDIT_MUTATION;
/**
 * How a comment or reply is authored. A person's alone carries no actor id: the service takes one only on
 * agent comments. So one a person and an agent both wrote is recorded as `author: agent`, with an actor
 * id naming both (the sender first), rather than as the person's with the agent left out.
 */
const annotationAuthor = (actor: Actor = USER) =>
  actor.kind === "agent" || actor.with?.length
    ? { author: "agent", source: "agent", provenance: { actorId: recordedActorId(actor) } }
    : { author: COMMENT_AUTHOR, source: COMMENT_AUTHOR };

/** What `tree.search` answers (the outliner's `GotoSearchCollection`). */
export interface SearchHits {
  matches: { block: { id: string; revision: number }; title: string; path: string; snippet: string; exact: boolean; reason?: "linked" | "near" | "yours" }[];
  completeness: { kind: string; limit?: number };
  semantic: { status: "lexical" | "ranked" | "unavailable"; message?: string };
}
/** How a search is asked: `semantic` has Jev re-order the candidates; `near` is the note it's asked from. */
export interface SearchOptions { semantic?: boolean; near?: string }

export class SocketBoard implements Board {
  private sock: Socket | null = null;
  private waiting = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer }>();
  private seq = 0;
  private events: Socket | null = null;
  readonly clientId = `ep0ch-door-${crypto.randomUUID().slice(0, 8)}`;
  /** The protocol the service reported (null until `info()`). */
  protocol: number | null = null;
  /** The outline database instance reported by the service; a change means every cached read belongs to another database. */
  outlineInstanceId: string | null = null;
  /** Every request's action, newest last: which paths the door actually took (tests read it). */
  readonly sent: string[] = [];

  /**
   * `outline`: the outline this board reads on an outline host. Every request line and the subscribe
   * line name it, and `info()` refuses a service that can't route by name.
   */
  constructor(readonly path = DEFAULT_SOCKET, private readonly timeoutMs = 15_000, readonly outline?: string) {}

  private conn(): Socket {
    if (this.sock && !this.sock.destroyed) return this.sock;
    const s = connect(this.path);
    const lines = new JsonLines(r => {
      const w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id); clearTimeout(w.timer);
      r.ok ? w.resolve(r.result) : w.reject(new Refused(r.error ?? "request failed"));
    });
    s.on("data", d => lines.feed(d));
    const fail = (e: Error) => { for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(e); } this.waiting.clear(); if (this.sock === s) this.sock = null; };
    s.on("error", fail);
    s.on("close", () => fail(new Error("outline socket closed")));
    this.sock = s;
    return s;
  }

  request<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `d${++this.seq}`;
    if (this.sent.length > 5000) this.sent.splice(0, 2500);
    this.sent.push(action);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${action} timed out`)); }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.conn().write(jsonLine({ id, action, ...params, ...(this.outline ? { outline: this.outline } : {}) }));
    });
  }

  /**
   * A note's resource projections (PIE-445): the stored details of each Resource its provider lines and
   * its own provider property name. A read only: the service never registers or fetches for it.
   */
  readResourceProjections(blockId: string): Promise<ResourceProjectionRead> {
    // Opening a note is the one step: the service fetches in the background what isn't fetched or is stale.
    return this.request<ResourceProjectionRead>("resources.projection.read", { blockId, materialize: true });
  }

  /**
   * Fetch the tickets a note shows now (`resources.projection.refresh`): a page's, or the ticket block's own.
   * Any client may; the answer is the note's projections after the fetch.
   */
  async refreshProjections(blockId: string, line?: number, actor: Actor = USER): Promise<ResourceProjectionRead> {
    // Who asks (`mutation`, as on extensions.act): an `@name` line asked again records them as who asked.
    return this.request<ResourceProjectionRead>("resources.projection.refresh", { blockId, ...(line !== undefined ? { line } : {}), mutation: requesterOf(actor) });
  }

  /**
   * The extensions the service runs (`extensions.list`, PIE-507): each folder's handlers, actions and tile
   * kinds.
   */
  listExtensions(reload = false): Promise<ExtensionList> {
    return this.request<ExtensionList>("extensions.list", reload ? { reload: true } : {});
  }

  /**
   * Run an extension's action (`extensions.act`): the service runs it and applies what it writes, attributed to
   * the extension (`author: agent`, `actorId: ext:<id>`), whoever asked. `blockId` (and `line`, for a handler
   * line's action) is what it acts on; `args` a tile's own. `actor` is who asks (`mutation`: the person, or an
   * agent by its own id), which the change feed records beside the extension's writes as `requestedBy`.
   */
  async actExtension(extension: string, action: string, target: { blockId?: string; line?: number; args?: Record<string, string> } = {}, actor: Actor = USER): Promise<ExtensionActResult> {
    return this.request<ExtensionActResult>("extensions.act", { extension, extensionAction: action, ...target, mutation: requesterOf(actor) });
  }

  /**
   * One of an extension's bar sources answers a query (`extensions.bar`, PIE-656): rows for the power bar, each
   * opening a block, running one of the extension's actions or copying text. It writes nothing. `near` is the note
   * in front of the person, which the call sees as its context.
   */
  barRows(extension: string, source: string, query: string, o: { near?: string; limit?: number } = {}): Promise<ExtensionBarResult> {
    return this.request<ExtensionBarResult>("extensions.bar", { extension, source, query, ...(o.near ? { near: o.near } : {}), ...(o.limit ? { limit: o.limit } : {}) });
  }

  /**
   * A block's authored links (the outliner's `blocks.authored-links`, PIE-259): its Outlinks and its
   * Resources as the service resolves them, each with where it points and why it can't. A read only: nothing
   * is registered by listing it.
   */
  authoredLinks(ownerBlockId: string): Promise<AuthoredLinksSnapshot> {
    return this.request<AuthoredLinksSnapshot>("blocks.authored-links", { ownerBlockId });
  }

  /**
   * Register the Resource an authored reference names (`resources.follow-authored`), or find the one already
   * registered: a `[file::…]` is interned (and its Source made), a `jira::KEY` resolved through the Jira
   * Source's provider. The Resource's id, and whether this call registered it.
   */
  async followAuthored(reference: AuthoredResourceReference, actor: Actor = USER): Promise<{ id: string; created: boolean }> {
    // Who registered it goes with the request (an agent's is its own).
    const r = await this.request<{ resource: { id: string }; created: boolean }>("resources.follow-authored", { reference, mutation: mutationFor(actor) });
    return { id: r.resource.id, created: !!r.created };
  }

  /**
   * A Resource's stored content (`resources.describe`). `fetch`: when nothing is stored yet (a ticket never
   * read, a web page never fetched) and the service says the Resource can be refreshed (its
   * `capabilities.refresh` isn't `unavailable`), it is fetched first (`resources.refresh`). Neither call needs a Detail
   * (`resources.observer-reads`).
   */
  async describeResource(resourceId: string, fetch = false): Promise<ResourceDescription> {
    const d = await this.request<ResourceDescription>("resources.describe", { target: { kind: "resource", resourceId } });
    // `unavailable`: the service won't refresh this one (a file is read as it is). `indeterminate` (a
    // ticket whose credentials the service only finds out about by trying) is worth one try.
    if (!fetch || resourceStored(d) || !d.capabilities?.refresh || d.capabilities.refresh.status === "unavailable") return d;
    return this.request<ResourceDescription>("resources.refresh", { resourceId });
  }

  /** Fetch a Resource again (`resources.refresh`: a ticket read from its provider, a web page fetched). */
  refreshResource(resourceId: string): Promise<ResourceDescription> {
    return this.request<ResourceDescription>("resources.refresh", { resourceId });
  }

  toMsgs(blocks: WireBlock[]): Msg[] { return blocks.map(b => toMsg(b)); }

  async info(): Promise<BoardInfo & { replaced?: boolean }> {
    const r = await this.request<{ protocolVersion: number; outlineInstanceId?: string; location: { hostname: string; workspaceRoot: string }; outline?: { name: string }; host?: HostStatus }>("ping");
    if (this.outline && r.outline?.name && r.outline.name !== this.outline)
      throw new Error(`the outline host at ${this.path} answered for "${r.outline.name}", not "${this.outline}"`);
    // One check: the service speaks this checkout's protocol. Older or newer, it is refused, never worked around.
    const mismatch = protocolMismatch(r.protocolVersion, "this door");
    if (mismatch) throw new Error(`${mismatch} (${this.path})`);
    this.protocol = r.protocolVersion;
    const previous = this.outlineInstanceId;
    this.outlineInstanceId = r.outlineInstanceId ?? null;
    return {
      host: r.location.hostname, workspace: r.location.workspaceRoot, protocol: r.protocolVersion, blocks: null,
      ...(this.outlineInstanceId ? { outlineInstanceId: this.outlineInstanceId } : {}),
      ...(previous && this.outlineInstanceId && previous !== this.outlineInstanceId ? { replaced: true } : {}),
      // On a host, the outline's name is how it's addressed (a board with no outline reads the host's default).
      ...(r.host ? { outline: r.outline?.name ?? this.outline } : {}),
    };
  }

  async roots(): Promise<Msg[]> {
    return (await this.request<WireBlock[]>("children", { parentId: null })).map(b => toMsg(b));
  }

  /**
   * A block, or null when the service says no (there is none, or it refused). When the service can't be
   * asked (the connection is down, or it didn't answer in time) it throws `Offline`: "couldn't ask" never
   * reads as "no block" (PIE-488).
   */
  async get(id: string): Promise<Msg | null> {
    // A Resource shown as a note (src/authored.ts) is read again from its stored text, not as a block (PIE-650).
    if (id.startsWith(RESOURCE_NOTE)) return this.describeResource(id.slice(RESOURCE_NOTE.length)).then(d => resourceNote(d), e => { if (e instanceof Refused) return null; throw e; });
    try {
      const ctx = await this.request<{ selected: WireBlock | null; children: WireBlock[] }>("blocks.context", { blockId: id });
      return ctx.selected ? toMsg(ctx.selected, ctx.children.map(c => c.id)) : null;
    } catch (e) {
      if (e instanceof Refused) return null;
      throw new Offline(`the outline isn't answering (${(e as Error).message})`);
    }
  }

  /**
   * A block, or null when the service says there is no such block. Any other failure (a timeout, a
   * dropped connection) throws, so a reader can tell "missing" from "couldn't ask". Trashed blocks come
   * back with `deleted`.
   */
  async read(id: string): Promise<Msg | null> {
    try {
      const ctx = await this.request<{ selected: WireBlock | null; children: WireBlock[] }>("blocks.context", { blockId: id });
      return ctx.selected ? toMsg(ctx.selected, ctx.children.map(c => c.id)) : null;
    } catch (e) {
      if (e instanceof Refused && /not found/i.test(e.message)) return null;
      throw e;
    }
  }

  /** How the service reads every `((…))` in `text`: status, title, label, fragment (the Detail's own resolver). */
  async resolveReferences(text: string): Promise<ReferenceResolution[]> {
    return (await this.request<{ references: ReferenceResolution[] }>("references.resolve", { text })).references;
  }

  /** The workspace's configured Work-ID prefix (`PIE`), or null when none is configured. */
  async workIdPrefix(): Promise<string | null> {
    return (await this.request<{ workIdPrefix?: string }>("references.resolve", { text: "" })).workIdPrefix ?? null;
  }

  /**
   * The outline's property index (`properties.catalog`): the keys starting with `prefix` (each value of each, counted), or
   * with `key` the values of that key starting with `prefix`; most used first. What a filter's completion offers.
   */
  async propertyCatalog(key: string | undefined, prefix: string, limit = 30): Promise<{ key: string; value: string; count: number }[]> {
    return this.request<{ key: string; value: string; count: number }[]>("properties.catalog", { ...(key ? { key } : {}), prefix, limit });
  }

  /** The outline's callout types (PIE-538): the types its notes declare with `[callout-type::name]`, and what's wrong with any. */
  async calloutTypes(): Promise<{ types: CalloutType[]; problems: string[]; complete: boolean }> {
    return this.request<{ types: CalloutType[]; problems: string[]; complete: boolean }>("callouts.types", {});
  }
  /** The outline's heading styles (PIE-599): those its notes declare with [heading-style::name]; the built-ins are outline-core's. */
  async headingStyles(): Promise<{ styles: HeadingStyle[]; problems: string[]; complete: boolean }> {
    return this.request<{ styles: HeadingStyle[]; problems: string[]; complete: boolean }>("headings.styles", {});
  }
  /** The outline's style sheets (PIE-673): each [style-for::…] note or line with its style.* fields; the cascade is outline-core's. */
  async styleSheets(): Promise<{ sheets: StyleSheet[]; problems: string[]; complete: boolean }> {
    return this.request<{ sheets: StyleSheet[]; problems: string[]; complete: boolean }>("styles.list", {});
  }
  /** What a rule note (its text, never saved) draws on a sample note's text (PIE-618: a component page's rule variations). */
  async rulePreview(note: string, text: string): Promise<{ decorations: Decoration[]; problems: string[] }> {
    return this.request<{ decorations: Decoration[]; problems: string[] }>("rules.preview", { note, text });
  }
  /** Every component's schema (PIE-618): the built-ins with the outline's own styles and types as values, then the extensions'. */
  async componentSchemas(): Promise<{ schemas: ComponentSchema[]; problems: string[]; complete: boolean }> {
    return this.request<{ schemas: ComponentSchema[]; problems: string[]; complete: boolean }>("components.schemas", {});
  }

  /** What a `[[page]]` address or Work ID points at. Never follows (`pages.follow` would create a stub). */
  async resolvePage(address: string): Promise<PageResolution> {
    const r = await this.request<{ address: string; status: PageResolution["status"]; block?: WireBlock }>("pages.resolve", { address });
    return { address: r.address, status: r.status, ...(r.block ? { block: toMsg(r.block) } : {}) };
  }

  /** Every property token in `text`, as the service parses it (PIE-401). */
  async propertyRecords(text: string): Promise<PropertyRecord[]> {
    return (await this.request<{ tokens: PropertyRecord[] }>("properties.preview", { text })).tokens;
  }

  /** Breadcrumb, root first. */
  async ancestors(id: string): Promise<Msg[]> {
    const ctx = await this.request<{ ancestors: WireBlock[] }>("blocks.context", { blockId: id });
    return ctx.ancestors.map(b => toMsg(b));
  }

  async children(id: string): Promise<Msg[]> {
    return (await this.request<WireBlock[]>("children", { parentId: id })).map(b => toMsg(b));
  }

  /**
   * Each block's kind, stage and dates as the service computes them for a link's target (`blocks.facets`, PIE-693):
   * what Kind, Stage and Sort read for rows that aren't links (a note's children). At most 1000 a request, asked in
   * turn; `missing` names the ids that answer no live block.
   */
  async facets(ids: readonly string[]): Promise<{ facets: Record<string, AuthoredTargetFacets>; missing: string[] }> {
    const out: { facets: Record<string, AuthoredTargetFacets>; missing: string[] } = { facets: {}, missing: [] };
    for (let i = 0; i < ids.length; i += 1000) {
      const r = await this.request<{ facets: Record<string, AuthoredTargetFacets>; missing: string[] }>("blocks.facets", { blockIds: ids.slice(i, i + 1000) });
      Object.assign(out.facets, r.facets ?? {}); out.missing.push(...(r.missing ?? []));
    }
    return out;
  }

  /**
   * Blocks changed after `since`, newest first, as list rows: the service answers `updated > since` itself
   * (`query.expression`, PIE-398) and sends titles and properties only.
   * A block an extension wrote (a Jira ticket the service keeps: its writer is `ext:…`, and only that
   * extension ever writes it) is left out unless `extensions`: it isn't the person's news.
   */
  async changedSince(since: number, limit: number, extensions = false): Promise<Msg[]> {
    const sort = { field: "updated", direction: "desc" };
    const keep = (m: Msg) => extensions || !isExtensionWriter(m.author);
    const after = since > 0 ? `updated>${new Date(since).toISOString()}` : "";
    if (extensions) {
      const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", {
        query: { ...(after ? { expression: after } : {}), limit: Math.min(1000, limit), sort }, ...this.listFields(),
      });
      return r.blocks.map(b => toMsg(b));
    }
    // What extensions wrote can outnumber the person's own changes (a poll that refreshed many tickets and
    // their comments): page back through them, so they never push the person's edits past the limit.
    const out: Msg[] = [], seen = new Set<string>(), size = Math.min(1000, Math.max(100, limit * 2));
    let before: string | undefined;
    for (let pages = 0; pages < 20 && out.length < limit; pages++) {
      const expression = [after, before ? `updated<=${before}` : ""].filter(Boolean).join(" ");
      const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", {
        query: { ...(expression ? { expression } : {}), limit: size, sort }, ...this.listFields(),
      });
      const fresh = r.blocks.filter(b => !seen.has(b.id));
      for (const b of fresh) { seen.add(b.id); const m = toMsg(b); if (keep(m)) out.push(m); }
      // The last page, or one whose rows all share the time already paged from (nothing further back to ask for).
      if (r.blocks.length < size || !fresh.length || !r.blocks.at(-1)?.updatedAt) break;
      before = r.blocks.at(-1)!.updatedAt;
    }
    return out.slice(0, limit);
  }

  /**
   * The one search (`tree.search`, as Tree's Goto ranks: the rungs are outline-core's search-match.ts): the
   * service's order, best first. `semantic` asks Jev to re-order the candidates (`semantic.status` says whether it
   * did); `near` is the note the person is in (`contextBlockId`): nearer notes first inside each rung, and an empty
   * `text` lists what's linked and edited around it.
   */
  searchBlocks(text: string, opts: SearchOptions = {}): Promise<SearchHits> {
    return this.request<SearchHits>("tree.search", { query: text, ...(opts.semantic ? { semantic: true } : {}), ...(opts.near ? { contextBlockId: opts.near } : {}) });
  }

  /** `searchBlocks`, at most `limit` hits read whole for a preview, with what Jev did (`semantic`). */
  async search(text: string, limit: number, opts: SearchOptions = {}): Promise<Msg[] & { semantic?: SearchHits["semantic"] }> {
    const r = await this.searchBlocks(text, opts);
    const ids = r.matches.slice(0, Math.min(1000, limit)).map(m => m.block.id);
    const by = new Map((ids.length ? (await this.readBlocks(ids)).blocks : []).map(m => [m.id, m]));
    return Object.assign(ids.flatMap(id => by.get(id) ?? []), { semantic: r.semantic });
  }

  async callers(): Promise<Caller[]> {
    const list = await this.request<any[]>("clients.list");
    return list.map(c => ({
      id: c.clientId,
      name: c.role,
      host: c.runtime?.hostname ?? (String(c.clientId).startsWith("ep0ch-door") ? "ep0ch door" : "—"),
      activity: c.currentTarget?.kind === "block" ? `reading ${c.currentTarget.blockId.slice(0, 8)}`
        : c.currentTarget?.kind === "resource" ? "in the file area" : c.role === "observer" ? "lurking" : "idle",
      since: null,
      target: c.currentTarget?.kind === "block" ? c.currentTarget.blockId : null,
    }));
  }

  /** Who edited what, across all three author classes, newest first. */
  async activity(limit = 60): Promise<Activity[]> {
    const pages = await Promise.all((["user", "agent", "system"] as const).map(author =>
      this.request<{ entries: any[] }>("activity.recent", { author, limit: Math.min(100, limit) }).catch(() => ({ entries: [] }))));
    return pages.flatMap(p => p.entries).map(e => ({
      cursor: e.cursor, block: toMsg(e.block), author: e.author, actor: e.actorId ?? e.author, kind: e.kind, at: Date.parse(e.editedAt),
    })).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  /**
   * The whole outline without full text (tree.index): parents, properties, titles, depths. ~1 MB for 1.5k blocks. In the
   * service's tree order (its one walk, as Tree draws it: depth first, children by position).
   */
  async index(): Promise<IndexBlock[]> {
    // Its own connection: the service answers one socket strictly in order, and this call takes seconds.
    const lane = new SocketBoard(this.path, 90_000, this.outline);
    const r = await lane.request<{ blocks: any[]; physicalBlockIds: string[] }>("tree.index", {}).finally(() => lane.close());
    // The service's walk is `physicalBlockIds`; `blocks` holds them by id (and a view's rows, which this asks for none of).
    const by = new Map(r.blocks.map(b => [b.id, b]));
    const order: any[] = r.physicalBlockIds.map(id => by.get(id)).filter(Boolean);
    return order.map(b => ({
      id: b.id, parentId: b.parentId ?? null, position: b.position ?? 0, depth: b.depth ?? 0, title: String(b.preview ?? "").trim() || "(untitled)",
      author: b.actorId ?? b.author ?? "?", createdAt: Date.parse(b.createdAt), updatedAt: Date.parse(b.updatedAt),
      props: Object.fromEntries((b.properties ?? []).map((p: any) => [p.key, p.value])), hasChildren: !!b.hasChildren,
    }));
  }

  /** Blocks carrying one property value, newest first (a virtual branch). */
  async byProp(key: string, value: string, limit = 200): Promise<Msg[]> {
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", {
      query: { limit, filters: [{ key, value }], sort: { field: "updated", direction: "desc" } },
    });
    return r.blocks.map(b => toMsg(b));
  }

  /**
   * Blocks matching property clauses (`type=roadmap-item work-stage=doing`). `list` asks for rows
   * without full text (PIE-400 `fields`).
   */
  /** `sort`: created, updated or a property key (the service orders by it, and refuses one that isn't). */
  async query(q: string, limit = 50, sort = "updated", direction: "asc" | "desc" = "desc", list = false): Promise<Msg[]> {
    const filters = q.split(/\s+/).filter(Boolean).map(t => { const i = t.indexOf("="); return i > 0 ? { key: t.slice(0, i), value: t.slice(i + 1) } : { key: t }; });
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", { query: { limit: Math.min(1000, limit), filters, sort: { field: sort, direction } }, ...this.listFields(list) });
    return r.blocks.map(b => toMsg(b));
  }

  /**
   * The blocks a query in the saved views' grammar matches (`type=outbox-item status=waiting`, OR, NOT, ranges), as
   * list rows, in the service's order: the service parses it (`query.expression`), the door never does. `truncated`:
   * there were more than `limit`.
   */
  async queryNotes(expression: string, limit = 200): Promise<{ notes: Msg[]; truncated: boolean }> {
    const r = await this.request<{ blocks: WireBlock[]; completeness?: { kind: string } }>("blocks.query", { query: { expression, limit: Math.min(1000, limit) }, ...this.listFields(true) });
    return { notes: r.blocks.map(b => toMsg(b)), truncated: r.completeness?.kind === "truncated" };
  }

  /** `fields` for a list-shaped read. */
  private listFields(list = true): { fields?: readonly string[] } {
    return list ? { fields: LIST_FIELDS } : {};
  }

  /**
   * Several blocks at once, as list rows (PIE-400 `blocks.read`), in the order asked. Missing and
   * trashed ids are left out.
   */
  async readMany(ids: string[], fields: readonly string[] = LIST_FIELDS): Promise<Msg[]> {
    if (!ids.length) return [];
    return (await this.request<{ blocks: WireBlock[] }>("blocks.read", { ids, fields })).blocks.map(b => toMsg(b));
  }

  /**
   * Whole blocks, text included, in one `blocks.read` (PIE-400), with the ids that are missing or in
   * Trash.
   */
  async readBlocks(ids: string[]): Promise<{ blocks: Msg[]; unavailable: { id: string; status: "missing" | "trashed" }[] }> {
    const r = await this.request<{ blocks: WireBlock[]; unavailable?: { id: string; status: "missing" | "trashed" }[] }>("blocks.read", { ids, fields: [...LIST_FIELDS, "text"] });
    return { blocks: r.blocks.map(b => toMsg(b)), unavailable: r.unavailable ?? [] };
  }

  /**
   * A saved view's members as the service evaluates them (PIE-397 `views.read`), as list rows.
   */
  async readSavedView(viewId: string, page: { limit?: number; offset?: number } = {}): Promise<SavedViewRead> {
    const r = await this.request<Omit<SavedViewRead, "blocks"> & { blocks: WireBlock[] }>("views.read", { viewId, format: "tree", ...page });
    return { ...r, blocks: r.blocks.map(b => toMsg(b)) };
  }

  /**
   * A view's hand-set order (`virtual.occurrences.order`): every member, in the order its lanes, figures and Tree show.
   * `view` is a ref the service resolves (an id, ((id)), a prefix, a Work ID, a [[page]]). A sorted view has none: the
   * service refuses, naming the [sort::] to remove.
   */
  async viewOrder(view: string): Promise<ViewOrder> {
    return this.request<ViewOrder>("virtual.occurrences.order", { viewId: view });
  }

  /**
   * Moves blocks in a view's hand-set order in one step (`virtual.occurrences.move`), recorded as `actor`'s: one block
   * `by` places (kept within what the view shows), `to` a position, `before`/`after` a member; or, with none, the
   * blocks first in the order given. Refs are resolved by the service. The order after it, and what moved.
   */
  async moveInView(move: { view: string; blocks: string[]; by?: number; to?: number; before?: string; after?: string }, actor: Actor = USER): Promise<ViewOrder & { moved: string[] }> {
    return this.request<ViewOrder & { moved: string[] }>("virtual.occurrences.move", { input: move, mutation: mutationFor(actor) });
  }

  /**
   * The ids of the blocks a query holds for, in outline order (`blocks.query`): `expression` in the saved-view grammar
   * and `text` (every word, any order) as the service evaluates them, under `subtreeRootId` (itself included). At most
   * 1000; `truncated` when there were more.
   */
  async queryIds(q: { expression?: string; text?: string; subtreeRootId?: string; sort?: { field: string; direction: string } }, limit = 1000): Promise<{ ids: string[]; truncated: boolean }> {
    const r = await this.request<{ blocks: { id: string }[]; completeness: { kind: string } }>("blocks.query", {
      query: { limit: Math.min(1000, limit), ...(q.expression ? { expression: q.expression } : {}), ...(q.text ? { text: q.text } : {}), ...(q.subtreeRootId ? { subtreeRootId: q.subtreeRootId } : {}), ...(q.sort ? { sort: q.sort } : {}) },
      fields: ["id"],
    });
    return { ids: r.blocks.map(b => b.id), truncated: r.completeness.kind !== "complete" };
  }

  /** Blocks as records (`blocks.records`, outline-core's block-record.ts), in the order asked, 200 a request (the service's most; each request is one backlink pass over the outline). */
  async records(ids: string[]): Promise<{ records: BlockRecord[]; unavailable: { id: string; status: "missing" | "trashed" }[] }> {
    const out: { records: BlockRecord[]; unavailable: { id: string; status: "missing" | "trashed" }[] } = { records: [], unavailable: [] };
    for (let i = 0; i < ids.length; i += 200) {
      const r = await this.request<typeof out>("blocks.records", { ids: ids.slice(i, i + 200) });
      out.records.push(...r.records);
      out.unavailable.push(...r.unavailable);
    }
    return out;
  }

  async mcpAccessStatus(): Promise<McpAccessStatus> {
    return this.request<McpAccessStatus>("mcp.access.status", {});
  }

  async configureMcpAccess(level: McpAccessLevel): Promise<McpAccessStatus> {
    return this.request<McpAccessStatus>("mcp.access.configure", { level });
  }

  /**
   * What moving `blockId` into each view would patch, or why it can't (`views.planWrite`, PIE-490), at the
   * block's current revision.
   */
  async planMoves(viewIds: string[], blockId: string): Promise<{ revision: number; plans: Map<string, MovePlan> }> {
    const r = await this.request<{ revision: number; plans: { viewId: string; plan: MovePlan }[] }>("views.planWrite", { viewIds, blockId });
    return { revision: r.revision, plans: new Map(r.plans.map(p => [p.viewId, p.plan])) };
  }

  /** What a new block in `viewId` is born with; with `text`, the text (or allocator input) it's saved as. */
  async planCreate(viewId: string, text = ""): Promise<CreatePlan> {
    return (await this.request<{ plans: { viewId: string; plan: CreatePlan }[] }>("views.planWrite", { viewIds: [viewId], text })).plans[0]!.plan;
  }

  /**
   * Which of `blockIds` the query `expression` holds for (`query.matches`, a thousand ids a request), narrowed by `text`
   * (every word) and `subtreeRootId` as `blocks.query` narrows.
   */
  async matchQuery(expression: string, blockIds: string[], narrow: { text?: string; subtreeRootId?: string } = {}): Promise<Set<string>> {
    const asks = Array.from({ length: Math.ceil(blockIds.length / 1000) }, (_, i) => this.request<{ blockIds: string[] }>("query.matches", { ...(expression ? { expression } : {}), ...narrow, blockIds: blockIds.slice(i * 1000, i * 1000 + 1000) }));
    return new Set((await Promise.all(asks)).flatMap(r => r.blockIds));
  }

  /** What changed after `sequence` (PIE-399), or an explicit reset. */
  changesSince(sequence: number, limit = 500): Promise<ChangePage> {
    return this.request<ChangePage>("changes.since", { sequence, limit });
  }

  /**
   * Blocks that point at this one, as the service sends them (PIE-442), with facets, read through
   * src/backlinks.ts as Detail reads them. The note itself stays, for the "this note" toggle.
   */
  async backlinks(id: string, limit = BACKLINK_QUERY_LIMIT): Promise<BacklinkCollection> {
    const r = await this.request<BacklinkCollection>("references.backlinks", { query: { targetBlockId: id, limit } });
    const sources = (r.sources ?? []).map(s => ({ ...s, parentContext: s.parentContext ?? "", referenceGroups: s.referenceGroups ?? [], occurrences: s.occurrences ?? [] }));
    return { ...r, targetBlockId: r.targetBlockId ?? id, sources, completeness: r.completeness ?? { kind: "complete" } };
  }

  /** Comment threads anchored on a block (open ones first). */
  async comments(blockId: string, shown?: { revision?: number; stale?: () => void }): Promise<Comment[]> {
    // A Resource's threads are read through the service's reconcile (PIE-650): it reads the text now and re-anchors
    // each quote through the resolution events (or keeps it as it read, with no place, when it is gone).
    let placedIn: number | undefined;
    let threads: any[];
    if (blockId.startsWith(RESOURCE_NOTE)) {
      const r = await this.request<{ threads: any[]; revision?: number }>("annotations.reconcile", { input: { subject: { kind: "resource", resourceId: blockId.slice(RESOURCE_NOTE.length) } } });
      threads = r.threads; placedIn = r.revision;
    } else threads = await this.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId }, includeResolved: true } });
    // Offsets mean the text they were placed in. The reader drew another (the file changed since): no places, and it reads again.
    const placed = shown?.revision === undefined || placedIn === undefined || shown.revision === placedIn;
    if (!placed) shown!.stale?.();
    const who = (r: any) => r?.block?.actorId ?? r?.source ?? r?.block?.author ?? "?";
    const text = (r: any) => String(r?.body ?? r?.block?.text ?? "").trim();
    const when = (r: any) => Date.parse(r?.block?.createdAt ?? r?.createdAt ?? "") || 0;
    const offset = (v: unknown) => (typeof v === "number" ? v : null);
    return threads.map(t => {
      // resolvedTarget follows the quote through later edits; null means the service lost it. A comment on a Resource
      // that this note's link opened (its reference context) is placed on that link here, not at the file's offsets.
      const onResource = !blockId.startsWith(RESOURCE_NOTE) && t.originalTarget?.representation?.subject?.kind === "resource";
      const at = onResource ? t.resolvedTarget?.referenceContext?.anchor : t.resolvedTarget?.anchor;
      return {
        id: t.block?.id ?? "", author: who(t), body: text(t), at: when(t), open: t.lifecycle !== "resolved",
        quote: String(t.originalTarget?.anchor?.exact ?? "").replace(/\s+/g, " ").trim(),
        start: placed && at?.kind === "text-quote" ? offset(at.start) : null, end: placed && at?.kind === "text-quote" ? offset(at.end) : null,
        replies: (t.replies ?? []).map((r: any) => ({ id: r.block?.id ?? "", author: who(r), body: text(r), at: when(r) })),
      };
    }).sort((a, b) => Number(b.open) - Number(a.open) || b.at - a.at);
  }

  /**
   * A block comment on an exact passage (`annotations.batch` / `block-comment`). The service refuses it
   * when the note is no longer at `expectedRevision` or the quote isn't where `start` says. `requestId`
   * must be the same on a retry of the same comment: the service then returns the saved one.
   */
  async comment(requestId: string, blockId: string, expectedRevision: number, body: string, passage: CommentPassage, actor: Actor = USER): Promise<CommentReceipt> {
    const { source, ...who } = annotationAuthor(actor);
    const r = await this.request<{ annotations: { block: { id: string } }[]; deduplicated: boolean }>("annotations.batch", {
      requestId, ...who,
      operations: [{ operationId: "comment", type: "block-comment", input: { blockId, expectedRevision, body, source, passage } }],
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /**
   * A comment on a passage of a Resource's stored text (`annotations.batch` / `resource-comment`, PIE-650). The
   * service reads the text itself and refuses the comment when it isn't the text `expectedRevision` names. `at`
   * is where the Resource's text begins in the note the passage was picked in (null: it isn't drawn as it is, so
   * the quote goes without an offset). Nothing is written to the Resource.
   */
  async commentOnResource(requestId: string, resource: NonNullable<Msg["resource"]>, expectedRevision: number, body: string, passage: CommentPassage, actor: Actor = USER): Promise<CommentReceipt> {
    const { source, ...who } = annotationAuthor(actor);
    const start = resource.sourceAt === null ? undefined : passage.start - resource.sourceAt;
    const r = await this.request<{ annotations: { block: { id: string } }[]; deduplicated: boolean }>("annotations.batch", {
      requestId, ...who,
      operations: [{ operationId: "comment", type: "resource-comment", input: {
        resourceId: resource.id, expectedRevision, body, source,
        passage: { quote: passage.quote, ...(start !== undefined && start >= 0 ? { start } : {}) },
        ...(resource.from ? { referenceBlockId: resource.from } : {}),
      } }],
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /** A reply on a comment thread, idempotent by `requestId` like `comment`. */
  async reply(requestId: string, annotationId: string, body: string, actor: Actor = USER): Promise<CommentReceipt> {
    const { source, ...who } = annotationAuthor(actor);
    const r = await this.request<{ annotations: { block: { id: string } }[]; deduplicated: boolean }>("annotations.reply", {
      requestId, ...who, input: { annotationId, body, source },
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /** Resolve or reopen a thread. It sets a state rather than adding anything, so repeating it is harmless. */
  async setLifecycle(annotationId: string, lifecycle: "open" | "resolved", actor: Actor = USER): Promise<void> {
    await this.request("annotations.lifecycle", { input: { annotationId, lifecycle }, mutation: mutationFor(actor) });
  }

  /** Replace a block's whole text, if it is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async update(blockId: string, text: string, expectedRevision: number, actor: Actor = USER): Promise<Msg> {
    try {
      return toMsg(await this.request<WireBlock>("update", { blockId, text, expectedRevision, mutation: mutationFor(actor) }));
    } catch (e) {
      const { conflict, now } = await this.conflictCheck(blockId, expectedRevision, e);
      // No answer, yet the note now holds exactly this text: the save landed before the answer was lost.
      if (conflict && now && !(e instanceof Refused) && now.text === text) return now;
      if (conflict) throw new EditConflict(blockId, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /**
   * After a failed write: is it a revision conflict? The service says so only in words today
   * ("changed since editing began"), which could be reworded, so the door also reads the block again:
   * a revision past `expected` is a conflict whatever the message said. Returns that current block.
   */
  private async conflictCheck(blockId: string, expected: number, e: unknown): Promise<{ conflict: boolean; now: Msg | null }> {
    const worded = /changed since editing began/i.test(e instanceof Error ? e.message : String(e));
    const now = await this.get(blockId);
    return { conflict: worded || (now?.revision !== undefined && now.revision !== expected), now };
  }

  /** The properties the service would store for `text` (PIE-401 `properties.preview`), without saving. */
  async previewProperties(text: string): Promise<Record<string, string>> {
    return Object.fromEntries((await this.previewPropertyList(text)).map(p => [p.key, p.value]));
  }

  /**
   * The block's own property tokens for `key`, as the service numbers them (`ordinal` is what
   * `properties.patch` replaces), at the revision the service read them. Asking the service keeps the
   * door from re-deriving the property parser: fences, code spans, hashtags and bare `key::` lines.
   */
  async propertyTokens(blockId: string, key: string): Promise<{ revision: number; tokens: PropertyToken[] }> {
    const r = await this.request<{ blocks: (WireBlock & { propertyMatches?: PropertyToken[] })[]; completeness: { kind: string } }>("blocks.query", {
      query: { filters: [{ key }], subtreeRootId: blockId, propertyScope: "all", limit: 200 },
    });
    const own = r.blocks.find(b => b.id === blockId);
    if (own) return { revision: own.revision!, tokens: (own.propertyMatches ?? []).filter(t => t.key === key) };
    if (r.completeness?.kind !== "complete") throw new Error(`couldn't read ${key}:: on the card (its subtree is too large to scan)`);
    // The block has no such token, in any scope; its revision still has to be known.
    const b = await this.request<{ selected: WireBlock | null }>("blocks.context", { blockId });
    if (!b.selected) throw new Error("the card is gone from the outline");
    return { revision: b.selected.revision!, tokens: [] };
  }

  /** Patch property tokens, if the block is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async patchProperties(blockId: string, expectedRevision: number, operations: PropertyPatch[], actor: Actor = USER): Promise<Msg> {
    try {
      return toMsg(await this.request<WireBlock>("properties.patch", { blockId, expectedRevision, operations, mutation: mutationFor(actor) }));
    } catch (e) {
      // Only a refusal can be called a conflict here: without an answer the patch may have landed.
      if (e instanceof Refused && (await this.conflictCheck(blockId, expectedRevision, e)).conflict) throw new EditConflict(blockId, e.message);
      throw e;
    }
  }

  // ── events ─────────────────────────────────────────────────────────────────

  /** The newest service sequence the door has seen events up to; a reconnect catches up from here. */
  lastSequence = 0;
  private lastChangeId = 0;
  private sub: { onEvent: (e: OutlineEvent) => void; attempt: number; retry: Timer | null; lost: boolean } | null = null;
  private closing = false;
  /** First reconnect delay; it doubles per failed try, up to 5 s. */
  reconnectMs = 250;
  /** Told when the event connection drops and when it's back (with what the catch-up did). */
  onConnection: (state: "lost" | "restored", detail: string) => void = () => {};
  /**
   * Run before each reconnect: what the path needs to answer again (a machine's forward, started again when it
   * dropped). What it did is said with the next `onConnection`; a throw is said, and the reconnect waits and retries.
   */
  prepare: (() => Promise<string | null>) | null = null;
  /** What `prepare` did, said when the connection is back. */
  private prepared: string | null = null;

  /**
   * Register as an observer and stream events; the door then shows up in Who's Online, like any caller.
   * If the connection drops (the service restarted), it reconnects with backoff and catches up: with a
   * change feed, the missed changes are replayed as events; when the feed's history doesn't reach back,
   * a `reset` event tells screens to reload everything.
   */
  subscribe(onEvent: (e: OutlineEvent) => void): void {
    if (process.env.EP0CH_OBSERVE === "0" || this.sub) return;
    this.closing = false;
    this.sub = { onEvent, attempt: 0, retry: null, lost: false };
    this.openEvents(false);
  }

  private openEvents(reconnect: boolean) {
    const sub = this.sub;
    if (!sub || this.closing) return;
    const s = connect(this.path);
    let subscribed = false;
    // Live events that arrive while the catch-up is still reading wait for it, so order holds.
    let held: OutlineEvent[] | null = reconnect ? [] : null;
    const lines = new JsonLines(r => {
      if (r.id === "sub") {
        if (!r.ok) return;
        subscribed = true; sub.attempt = 0;
        // A new subscription is a new client on the service: its drafts are held again.
        if (reconnect) for (const h of this.drafts.values()) void this.holdOn(h);
        if (!reconnect) { this.lastSequence = Math.max(this.lastSequence, Number(r.sequence) || 0); return; }
        void this.catchUp(Number(r.sequence) || 0).then(({ replayed, reset }) => {
          if (this.sub !== sub) return;                   // closed while catching up
          sub.lost = false;
          const rest = held ?? []; held = null;
          for (const e of rest) this.deliver(e);
          const did = this.prepared ? `${this.prepared} · ` : "";
          this.prepared = null;
          this.onConnection("restored", `${did}${reset ? `reloaded everything (${reset})` : `caught up ${replayed} change${replayed === 1 ? "" : "s"}`}`);
        });
        return;
      }
      if (!r.event) return;
      // A request to the door about a draft it holds is answered here, never queued behind a catch-up.
      if (r.event.domain === "draft") { void this.answerDraft(r.event.draft); return; }
      if (held) held.push(r.event); else this.deliver(r.event);
    });
    s.on("data", d => lines.feed(d));
    s.on("error", () => {});
    s.on("close", () => {
      if (this.events === s) this.events = null;
      if (this.closing || this.sub !== sub) return;
      // A service shutting down drops its subscribers, then waits for every other connection to end.
      // Let go of the idle request connection too, so a restart isn't held up by the door; the next
      // request opens a new one.
      if (!this.waiting.size && this.sock) { this.sock.end(); this.sock = null; }
      if (subscribed || !sub.lost) { sub.lost = true; this.onConnection("lost", "outline connection lost · reconnecting"); }
      this.retryEvents(sub);
    });
    s.on("connect", () => s.write(jsonLine({
      id: "sub", action: "events.subscribe", client: { clientId: this.clientId, role: "observer", contextId: this.clientId },
      ...(this.outline ? { outline: this.outline } : {}),
    })));
    this.events = s;
  }

  /** Open the events again after a wait that grows per failed try, `prepare` run first. */
  private retryEvents(sub: NonNullable<SocketBoard["sub"]>) {
    const wait = Math.min(5000, this.reconnectMs * 2 ** sub.attempt++);
    sub.retry = setTimeout(async () => {
      if (this.closing || this.sub !== sub) return;
      if (this.prepare) {
        try { this.prepared = (await this.prepare()) ?? this.prepared; }
        catch (e) {
          this.onConnection("lost", `${e instanceof Error ? e.message : String(e)} · trying again`);
          this.retryEvents(sub);
          return;
        }
        if (this.closing || this.sub !== sub) return;
      }
      this.openEvents(true);
    }, wait);
  }

  /** One event to the screens, once: a change the catch-up already replayed isn't delivered again. */
  private deliver(e: OutlineEvent) {
    if (e.change) {
      if (e.change.changeId <= this.lastChangeId) return;
      this.lastChangeId = e.change.changeId;
    }
    if (e.sequence > this.lastSequence) this.lastSequence = e.sequence;
    this.sub?.onEvent(e);
  }

  /**
   * After a reconnect: check the service again (it may have been replaced), then replay what was
   * missed. More than a page of changes or a feed reset mean "reload everything".
   */
  private async catchUp(subscribedAt: number): Promise<{ replayed: number; reset: string | null }> {
    // `subscribedAt` is the service's sequence when the new subscription started: after a reset, events
    // from there on are what the reloaded screens haven't seen.
    const reset = (reason: string, sequence = subscribedAt || this.lastSequence) => {
      // Resume from the service's own position: after "sequence-ahead" (a different or restored
      // database) the door's cursor and change ids mean nothing there.
      this.lastSequence = sequence; this.lastChangeId = 0;
      this.sub?.onEvent({ domain: "content", action: "reset", sequence: this.lastSequence, reason });
      return { replayed: 0, reset: reason };
    };
    try {
      const info = await this.info();
      if (info.replaced) return reset("the outline was replaced (restore or reset); everything was re-read");
      const page = await this.changesSince(this.lastSequence);
      if (page.kind === "reset") return reset(`the feed's history ${page.reason === "sequence-ahead" ? "is behind the door" : "doesn't reach back"}`, page.sequence);
      if (page.completeness.kind !== "complete") return reset("too much changed while away", page.sequence);
      for (const c of page.changes)
        this.deliver({ domain: "content", action: c.action, blockId: c.blockId, sequence: c.sequence, change: c, catchUp: true });
      this.lastSequence = Math.max(this.lastSequence, page.sequence);
      this.sub?.onEvent({ domain: "content", action: "reconnected", sequence: this.lastSequence, caughtUp: page.changes.length });
      return { replayed: page.changes.length, reset: null };
    } catch (e) {
      return reset(`catch-up failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── creating, trashing, checklist steps (PIE-406) ─────────────────────────

  /**
   * A new block under `parentId` (null: top level). `create` carries no revision and no request id, so
   * it is never retried: when the answer is lost, `findCreated` looks for it before anyone tries again.
   * A person's block is `author: user` with no actor id (the service takes provenance only on agent
   * blocks); an agent's, or one a person and an agent both typed, is `author: agent` naming them.
   */
  async createBlock(parentId: string | null, text: string, actor: Actor = USER): Promise<Msg> {
    const who = actor.kind === "agent" || actor.with?.length ? { author: "agent", provenance: { actorId: recordedActorId(actor) } } : { author: "user" };
    return toMsg(await this.request<WireBlock>("create", { parentId, text, ...who }));
  }

  /**
   * A new note where the service's placement rule puts it (PIE-544, `notes.create`): under `near` (the note the person
   * was in), else the top of the Inbox. The door never says where the Inbox is; the answer says where it went. Empty
   * `text` is a note opened to be written; `nearOnly`: a `near` the caller named, refused when it doesn't resolve
   * (the reader's own note falls back to the Inbox). Like `create`, never retried blindly.
   */
  async newNote(text: string, near: string | undefined, actor: Actor = USER, nearOnly = false): Promise<{ note: Msg; placement: NotePlacement }> {
    const who = actor.kind === "agent" || actor.with?.length ? { author: "agent", provenance: { actorId: recordedActorId(actor) } } : { author: "user" };
    const r = await this.request<{ block: WireBlock; placement: NotePlacement }>("notes.create", { text, intent: { kind: "note", ...(near ? { near, ...(nearOnly ? { nearOnly } : {}) } : {}) }, ...who });
    return { note: toMsg(r.block), placement: r.placement };
  }

  /**
   * What a `[[page]]` address points at, made when nothing does (`pages.follow`): a page stub `X [page::X]` where new
   * notes go (the service's placement rule, today the top of the Inbox). Only on the person's explicit ask
   * (`page.create`); a follow never calls it.
   */
  async followPage(address: string, actor: Actor = USER): Promise<{ note: Msg | null; created: boolean; status: PageResolution["status"]; placement?: NotePlacement }> {
    const who = actor.kind === "agent" || actor.with?.length ? { author: "agent", provenance: { actorId: recordedActorId(actor) } } : { author: "user" };
    const r = await this.request<{ status: PageResolution["status"]; created: boolean; block?: WireBlock; placement?: NotePlacement }>("pages.follow", { address, ...who });
    return { note: r.block ? toMsg(r.block) : null, created: r.created, status: r.status, ...(r.placement ? { placement: r.placement } : {}) };
  }

  /** `properties.preview` with repeats kept, in order. */
  async previewPropertyList(text: string): Promise<{ key: string; value: string }[]> {
    return (await this.request<{ properties: { key: string; value: string }[] }>("properties.preview", { text })).properties.map(p => ({ key: p.key, value: p.value }));
  }

  /** After a create whose answer was lost: a child of `parentId` with exactly `text`, created at or after `since`. */
  async findCreated(parentId: string | null, text: string, since: number): Promise<Msg | null> {
    const kids = parentId === null ? await this.roots() : await this.children(parentId);
    return kids.filter(k => k.text === text && k.createdAt >= since - 1000).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  /**
   * Move a block and its subtree to Trash. With `at.revision`, only the block at that revision: one changed since
   * (another client's save between the caller's read and this) is refused (`Refused`, "Block changed since it was
   * read") and stays. With `at.ifEmpty`, only a block with no text and no children ("Block is not empty"): a child
   * added doesn't change the revision. With `actor`, the service records who did it; the caller says it on screen.
   */
  async trash(blockId: string, actor?: Actor, at?: { revision?: number; ifEmpty?: boolean }): Promise<Msg> {
    return toMsg(await this.request<WireBlock>("delete", {
      blockId,
      ...(at?.revision !== undefined ? { expectedRevision: at.revision } : {}),
      ...(at?.ifEmpty ? { ifEmpty: true } : {}),
      ...(actor ? { mutation: mutationFor(actor) } : {}),
    }));
  }

  /**
   * Whether `blockId` is in Trash now (its own delete or an ancestor's): true, false, or null when the
   * service can't say (no such block any more, or no answer). For a write whose answer was lost.
   */
  async isTrashed(blockId: string): Promise<boolean | null> {
    try {
      const ctx = await this.request<{ selected: WireBlock | null }>("blocks.context", { blockId });
      return ctx.selected ? !!(ctx.selected.deletedAt || ctx.selected.effectiveDeletedRootId) : null;
    } catch { return null; }
  }

  /**
   * A roadmap item through the workboard's allocator (`roadmap.items.create`): the service issues its
   * work-id and puts it under the project's one active work queue. Like `create`, it has no request id,
   * so it is never retried.
   */
  async createRoadmapItem(input: RoadmapItemInput, actor: Actor = USER): Promise<{ workId: string; workQueueId: string; block: Msg }> {
    const who = actor.kind === "agent" || actor.with?.length ? { author: "agent", provenance: { actorId: recordedActorId(actor) } } : { author: "user" };
    const r = await this.request<{ workId: string; workQueueId: string; block: WireBlock }>("roadmap.items.create", { input, ...who });
    return { workId: r.workId, workQueueId: r.workQueueId, block: toMsg(r.block) };
  }

  // ── reference completion (the lookups Tree, Detail and Quick Capture use) ────────────────────────

  /**
   * Named addresses (pages, aliases, Work IDs) matching `query`, by address or their note's title, ranked as
   * `searchBlocks` is; `semantic` and `near` as there.
   */
  completePages(query: string | undefined, limit: number, opts: SearchOptions = {}) {
    return this.request<{ addresses: { address: string; blockId: string; kind: string; title: string }[]; completeness: { kind: string; limit?: number }; semantic?: SearchHits["semantic"] }>("pages.complete", {
      ...(query ? { query } : {}), limit, ...(opts.semantic ? { semantic: true } : {}), ...(opts.near ? { contextBlockId: opts.near } : {}),
    });
  }

  /** Workspace paths starting with `prefix`. */
  completeFiles(prefix: string) {
    return this.request<{ sourcePath: string; isDirectory: boolean }[]>("files.complete", { prefix });
  }

  /** A block with its ancestors. */
  async blockContext(blockId: string): Promise<{ selected: Msg | null; ancestors: Msg[] }> {
    const r = await this.request<{ selected: WireBlock | null; ancestors?: WireBlock[] }>("blocks.context", { blockId });
    return { selected: r.selected ? toMsg(r.selected) : null, ancestors: (r.ancestors ?? []).map(b => toMsg(b)) };
  }

  /** A note's revisions (PIE-621): the current one first, then the earlier texts the service keeps, newest first. */
  async revisions(blockId: string): Promise<BlockRevisions> { return this.request<BlockRevisions>("block.revisions", { blockId }); }

  /** One revision's whole text. */
  async revisionText(blockId: string, revision: number): Promise<BlockRevisionEntry & { text: string }> {
    return this.request<BlockRevisionEntry & { text: string }>("block.revisions", { blockId, revision });
  }

  /** Bring a Trash root (and its subtree) back where it was. */
  async restore(blockId: string): Promise<Msg> { return toMsg(await this.request<WireBlock>("trash.restore", { blockId })); }

  /** A note's checklist steps (docs/CHECKLIST_ITEMS.md), in source order, at the revision the service read. */
  async checklist(blockId: string, limit = 200): Promise<ChecklistRead> {
    return this.request<ChecklistRead>("checklist.query", { blockId, query: { limit, nested: "include" } });
  }

  /**
   * Set one step's status. The step is named by its id when it has a unique one, else by where it starts
   * at the revision it was read (the service then gives it an id); either way `evidence` must still match.
   */
  async setStep(blockId: string, step: ChecklistStep, revision: number, status: StepStatus, actor: Actor = USER): Promise<{ block: Msg; item: ChecklistStep; changed: boolean }> {
    return this.changeStep(blockId, step, revision, { kind: "status", status }, actor);
  }

  /**
   * One `checklist.update` of `step` (PIE-367): its status, or only a stable id so it can be linked. Checked
   * against the step's evidence (and, for a step without an id, the revision it was read at): a step that
   * changed since is refused, never guessed. Recorded as `actor`'s.
   */
  async changeStep(blockId: string, step: ChecklistStep, revision: number, change: StepChange, actor: Actor = USER): Promise<{ block: Msg; item: ChecklistStep; changed: boolean }> {
    const target = step.identity === "unique" && step.itemId ? { itemId: step.itemId } : { start: step.span.start, expectedRevision: revision };
    const r = await this.request<{ block: WireBlock; item: ChecklistStep; changed: boolean }>("checklist.update", {
      blockId, input: { target, expectedEvidence: step.evidence, change }, mutation: mutationFor(actor),
    });
    return { block: toMsg(r.block), item: r.item, changed: r.changed };
  }

  /**
   * `((note#…` / `((note^…` completion over every note, by the service's fragment rules (PIE-424): each
   * match with its note and, for a heading without an anchor, the anchor it would get.
   */
  fragmentCandidates(query: { noteQuery?: string; fragmentQuery: string; mode: "heading" | "id"; limit: number; draft?: { blockId: string; text: string } }) {
    return this.request<{ items: FragmentCandidate[]; completeness: { kind: string; limit?: number }; searched: number }>("fragments.candidates", { query });
  }

  /** Give the heading on `lineIndex` of a note its anchor, if the note is still at `expectedRevision`; recorded as `actor`'s. */
  ensureFragment(blockId: string, lineIndex: number, expectedRevision: number, actor: Actor = USER): Promise<{ fragmentId: string; created: boolean }> {
    return this.request("fragments.ensure", { blockId, lineIndex, expectedRevision, mutation: mutationFor(actor) });
  }

  /** `((id^fragment))`'s slice of its note (PIE-424). */
  readFragment(blockId: string, fragmentId: string): Promise<FragmentRead> {
    return this.request<FragmentRead>("fragments.read", { blockId, fragmentId });
  }

  /**
   * Transclusions as the service projects them (`transclusions.read`): each target's note or fragment
   * slice, nested to its depth and cycle-safe, with the steps in what it shows. `hostBlockId`: the note
   * they're embedded in (embedding it again is a cycle).
   */
  async readTransclusions(targets: { blockId: string; fragmentId?: string }[], hostBlockId?: string): Promise<TransclusionRead> {
    // The service sends each note once (`blocks`) and its steps once (`checklists`, without their text);
    // each projection names its note and the lines it shows. Put them back together per projection.
    type Wire = Omit<TransclusionNode, "block" | "embeds" | "checklist"> & { shownLines?: { start: number; end: number }; embeds?: Wire[] };
    type WireStep = Omit<ChecklistStep, "text">;
    const r = await this.request<Omit<TransclusionRead, "results"> & { results: Wire[]; blocks?: Record<string, WireBlock>; checklists?: Record<string, WireStep[]> }>("transclusions.read", { targets, ...(hostBlockId ? { hostBlockId } : {}) });
    const blocks = new Map(Object.entries(r.blocks ?? {}).map(([id, b]) => [id, toMsg(b)]));
    const node = (n: Wire): TransclusionNode => {
      const block = blocks.get(n.blockId), lines = n.shownLines;
      const checklist = block && lines ? (r.checklists?.[n.blockId] ?? [])
        .filter(s => s.span.startLine >= lines.start && s.span.startLine <= lines.end)
        .map(s => ({ ...s, text: block.text.slice(s.span.start, s.span.end).trimEnd() })) : undefined;
      return { ...n, ...(n.status === "ready" && block ? { block } : {}), ...(checklist ? { checklist } : {}), embeds: n.embeds?.map(node) };
    };
    return { limits: r.limits, dependencies: r.dependencies, results: r.results.map(node) };
  }

  // ── live drafts (PIE-501): held on the service, so draft.patch reaches them ─

  private drafts = new Map<string, { blockId: string; revision: number; holdId: string | null; answer: (r: DraftRequest) => DraftAnswer | Promise<DraftAnswer>; timer: Timer | null; touch: Timer | null; gone: boolean }>();

  /**
   * Hold a live draft of `blockId` on the service: while it's held, an agent's `draft.patch` on that note comes
   * here (`answer`) instead of to the saved note, and a lease the door renews lets go of it if the door dies.
   * Null when this connection doesn't subscribe to events (the service's draft requests arrive there).
   */
  holdDraft(blockId: string, revision: number, answer: (r: DraftRequest) => DraftAnswer | Promise<DraftAnswer>): DraftHoldHandle | null {
    if (!this.sub) return null;
    const old = this.drafts.get(blockId);
    if (old) this.letGo(old);
    const h = { blockId, revision, holdId: null as string | null, answer, timer: null as Timer | null, touch: null as Timer | null, gone: false };
    this.drafts.set(blockId, h);
    void this.holdOn(h);
    h.timer = setInterval(() => void this.renew(h), DRAFT_HEARTBEAT_MS);
    (h.timer as { unref?: () => void }).unref?.();
    return {
      revise: revision => { h.revision = revision; void this.renew(h); },
      release: () => this.letGo(h),
      touched: () => {
        if (h.gone) return;
        if (h.touch) clearTimeout(h.touch);
        h.touch = setTimeout(() => { h.touch = null; void this.touch(h); }, DRAFT_TOUCH_MS);
        (h.touch as { unref?: () => void }).unref?.();
      },
    };
  }

  /** The draft of `blockId` this connection holds on the service: `holdId` once the service granted it, else null while asking. Null when none. */
  heldDraft(blockId: string): { holdId: string | null } | null {
    const h = this.drafts.get(blockId);
    return h && !h.gone ? { holdId: h.holdId } : null;
  }

  /**
   * Tell the service the person typed in a held draft (`drafts.touch`, pi-herdr-outliner PIE-510): it reads the
   * draft back (a `draft` event of kind `read`) and runs a request line written there once quiet. A hold that
   * lapsed is taken again, quietly.
   */
  private async touch(h: { blockId: string; revision: number; holdId: string | null; gone: boolean }) {
    if (h.gone || !h.holdId) return;
    try { await this.request("drafts.touch", { holdId: h.holdId }); }
    catch (e) { if (/expired or was released/.test(e instanceof Error ? e.message : String(e))) { h.holdId = null; await this.holdOn(h); } }
  }

  private async holdOn(h: { blockId: string; revision: number; holdId: string | null; gone: boolean }) {
    try {
      const r = await this.request<{ holdId: string }>("drafts.hold", { blockId: h.blockId, clientId: this.clientId, revision: h.revision, leaseMs: DRAFT_LEASE_MS });
      if (h.gone) { void this.request("drafts.release", { holdId: r.holdId }).catch(() => {}); return; }
      h.holdId = r.holdId;
    } catch { h.holdId = null; /* tried again at the next heartbeat */ }
  }

  private async renew(h: { blockId: string; revision: number; holdId: string | null; gone: boolean }) {
    if (h.gone) return;
    if (!h.holdId) return this.holdOn(h);
    try { await this.request("drafts.heartbeat", { holdId: h.holdId, revision: h.revision }); }
    catch { h.holdId = null; await this.holdOn(h); }
  }

  private letGo(h: { blockId: string; holdId: string | null; timer: Timer | null; touch: Timer | null; gone: boolean }) {
    h.gone = true;
    if (h.timer) clearInterval(h.timer);
    if (h.touch) clearTimeout(h.touch);
    if (this.drafts.get(h.blockId) === h) this.drafts.delete(h.blockId);
    if (h.holdId) void this.request("drafts.release", { holdId: h.holdId }).catch(() => {});
  }

  /** The service asked about a draft this door holds: answer from the draft itself. */
  private async answerDraft(r: DraftRequest | undefined) {
    if (!r?.requestId) return;
    const h = [...this.drafts.values()].find(x => x.holdId === r.holdId || (x.blockId === r.blockId && !x.gone));
    let answer: DraftAnswer | undefined, error: string | undefined;
    try {
      if (!h) throw new Error("this door holds no draft of that note any more");
      answer = await h.answer(r);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    await this.request("drafts.answer", { requestId: r.requestId, clientId: this.clientId, ...(answer ? { answer } : { error }) }).catch(() => {});
  }

  /** A note's text as the draft someone holds has it now, or as saved (`drafts.read`). */
  readDraft(blockId: string): Promise<{ route: "draft" | "saved"; text: string; revision: number }> {
    return this.request("drafts.read", { blockId });
  }

  /**
   * "Apply anyway": a proposal's patch as an ordinary edit by `actor` (`draft.proposal.apply`). `warning`: the
   * edit landed, but something after it didn't (the proposal couldn't be marked applied).
   */
  async applyProposal(proposalId: string, actor: Actor = USER): Promise<{ outcome: "applied"; edits: { blockId: string; route: "draft" | "saved" }[]; warning?: string }> {
    return this.request("draft.proposal.apply", { proposalId, mutation: requesterOf(actor) });
  }

  /**
   * Dismiss a proposal without applying it (`draft.proposal.dismiss`, PIE-510): the service takes an older one's embed line
   * out of the note it was proposed under (or the live draft of it), marks it dismissed and puts it in the Trash,
   * all as `actor`, and refuses an agent's dismissal of another's proposal. `embedRemoved`: where the line was.
   */
  async dismissProposal(proposalId: string, actor: Actor = USER): Promise<{ outcome: "dismissed"; proposalId: string; embedRemoved: "saved" | "draft" | null; warning?: string }> {
    return this.request("draft.proposal.dismiss", { proposalId, mutation: requesterOf(actor) });
  }

  /**
   * The open proposals beside note `blockId` (`draft.proposals.list`, PIE-725): a patch that didn't apply is a proposal block
   * beside its note, never a line in its text. Each names the note line it is drawn after (its mark's, else the last).
   */
  async proposalsBeside(blockId: string): Promise<ProposalsBeside> {
    return this.request<ProposalsBeside>("draft.proposals.list", { blockId });
  }

  close(): void {
    for (const h of [...this.drafts.values()]) this.letGo(h);
    this.closing = true;
    if (this.sub?.retry) clearTimeout(this.sub.retry);
    this.sub = null;
    this.sock?.end(); this.events?.end(); this.sock = null; this.events = null;
  }
}
