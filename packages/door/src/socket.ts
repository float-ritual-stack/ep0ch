import { type RefusalKind, blockNotFound, refusalKindOf } from "@ep0ch/outline-core/refusal";
import type { SoftLinkName } from "@ep0ch/outline-core/soft-links";
import { grammarWarning, type OutlinerRequestProblem } from "@ep0ch/outline-core/protocol";
import { meetRules } from "@ep0ch/outliner/client-code";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SourcesAnswer } from "@ep0ch/outline-core/sources";
// Board over the outliner's JSON-lines socket, on outline-core's PROTOCOL: a service on another number is refused.
// Reads use the service's safe-read actions. Writes are guarded by the service, never by retrying:
// `update` (a saved edit) and `properties.patch` (a card moved between lanes) name the revision they
// started from, so a stale one is refused instead of overwriting someone else's change; a comment names
// the note's revision and an exact quote, and carries a requestId, so a retry after a lost answer
// returns the comment that was already saved instead of adding a second one.
import type { MachineryLeftOut, MachineryMode } from "@ep0ch/outline-core/machinery";
import { isMarkLifecycle, isTldr, markCurrent, type MarkLifecycle } from "@ep0ch/outline-core/annotation-marks";
import { actorName } from "@ep0ch/outline-core/attribution";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { connect, type Socket } from "node:net";
import { homedir, hostname } from "node:os";
import type { Board, BoardInfo, Caller, Msg } from "./board";
import type { PropertyMatch } from "@ep0ch/outline-core/protocol";
import type { CompletionPickedRequest, CompletionRowsRequest, CompletionRowsResult } from "@ep0ch/outline-core/protocol";
import { BACKLINK_QUERY_LIMIT, type BacklinkCollection } from "./backlinks";
import type { ResourceProjectionRead } from "./projection";
import type { ExtensionBarResult } from "./extensions";
import { resourceNote, resourceStored, RESOURCE_NOTE, type AuthoredTargetFacets, type AuthoredResourceReference, type ResourceDescription } from "./authored";
import { type BlockRevisionEntry, type HeldAsk, type BlockRevisions, type HostedOutlineSummary, OUTLINE_NAME_PATTERN, type OutlinerHostStatus, type PageRename, protocolMismatch } from "@ep0ch/outline-core/protocol";
import { outlineLayout, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { jsonLine, JsonLines } from "./jsonl";
import { Watched } from "./watched";
import { QUERIES_CHANGED } from "@ep0ch/outline-core/protocol";

/** An action the outline host answers: the outliner's wire contract (wire.ts), which both sides compile against. */
export type WireAction = import("@ep0ch/outliner/actions").ActionName;
export type { WireAnswer, WireParams } from "@ep0ch/outliner/wire";
type AnnotationRecord = import("@ep0ch/outliner/wire").AnnotationRecord;
type AnnotationThread = import("@ep0ch/outliner/wire").AnnotationThread;
import type { WireAnswer, WireParams } from "@ep0ch/outliner/wire";
/**
 * A reader's view of a wire type (`View`, what a client reads of `Wire`), held to it: `Reads<View, Wire>` fails the check
 * when the host's answer stops being one the view can read. For a client type kept narrower than the wire's on purpose
 * (small fixtures, a part it never reads); a client that reads the whole answer uses the wire's type itself.
 */
export type Reads<View, Wire extends View> = Wire;
/** What follows the action: its fields (left out when it has no required one), then a timeout and a signal. */
export type WireArgs<A extends WireAction> = {} extends WireParams<A>
  ? [params?: WireParams<A>, timeoutMs?: number, signal?: AbortSignal]
  : [params: WireParams<A>, timeoutMs?: number, signal?: AbortSignal];

/** The host a board talks to when none is named: EP0CH_SOCKET (a host elsewhere), else this machine's. */
export const DEFAULT_SOCKET = process.env.EP0CH_SOCKET || outlineLayout(outlinesFolder({ EP0CH_OUTLINES: process.env.EP0CH_OUTLINES }, process.env.HOME || homedir())).socket;
/** An outline's name on a host: a short slug (outline-core's OUTLINE_NAME_PATTERN). */
export const OUTLINE_NAME = OUTLINE_NAME_PATTERN;

/** What the outline host says about itself (outline-core's wire type). */
export type HostStatus = OutlinerHostStatus;
/** One outline on a host, as `outlines.list|attach|create|import|close` describe it (outline-core's wire type). */
export type HostedOutline = HostedOutlineSummary;

/**
 * Round trips to an outline host waiting for their answer in this process, every way they're asked (a board's request,
 * hostRequest): `hostsIdle()` resolves once none is. What a test waits on before it looks (test/settle.ts), so a
 * screen's own read (the home base's hostLive) never lands in the middle of a probe.
 */
export const hostTraffic = { waiting: 0, asked: 0 };
let whenIdle: (() => void)[] = [];
function traced<T>(p: Promise<T>): Promise<T> {
  hostTraffic.waiting++; hostTraffic.asked++;
  return p.finally(() => { if (--hostTraffic.waiting === 0) { const w = whenIdle; whenIdle = []; for (const f of w) f(); } });
}
export const hostsIdle = (): Promise<void> => (hostTraffic.waiting ? new Promise(r => whenIdle.push(r)) : Promise.resolve());

/**
 * A request to the outline host itself (`outlines.*`, or `ping` for the host), on a short connection of
 * its own. The host answers the first line of a connection and hands the rest to one outline, so these
 * never go on a board's connection, which belongs to its outline.
 */
export function hostRequest<A extends WireAction>(path: string, action: A, ...[params = {} as WireParams<A>, timeoutMs = 15_000]: WireArgs<A>): Promise<WireAnswer<A>> {
  return hostSend(path, action, params as Record<string, unknown>, timeoutMs) as Promise<WireAnswer<A>>;
}
/** `hostRequest` by a name only known at run time (an outliner function handed a client): the host checks it. */
export function hostSend(path: string, action: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<unknown> {
  return traced(new Promise<unknown>((resolve, reject) => {
    const s = connect(path);
    const timer = setTimeout(() => { s.destroy(); reject(new Error(`${action} timed out`)); }, timeoutMs);
    const lines = new JsonLines(r => {
      clearTimeout(timer); s.destroy();
      r.ok ? resolve(r.result) : reject(new Refused(r.error ?? `${action} failed`, r.kind, r.problem));
    });
    s.on("data", d => lines.feed(d));
    s.on("error", e => { clearTimeout(timer); reject(e); });
    s.on("connect", () => s.write(jsonLine({ id: "host", action, ...params })));
  }));
}

/**
 * A block as the service sends it: full (`text`), or projected without text (`title`, from blocks.read
 * or blocks.query `fields`), or compact (`preview`, from views.read `format: "tree"`).
 */
/** A place a soft link could land: the note, or what following it would make. */
export interface SoftLinkChoice { label: string; context?: string; note?: Msg; create?: { address: string; under?: string } }

export interface WireBlock {
  id: string; parentId?: string | null; position?: number; text?: string; title?: string; preview?: string; revision?: number;
  author?: string; actorId?: string;
  createdAt?: string; updatedAt?: string; deletedAt?: string | null; effectiveDeletedRootId?: string | null;
  properties?: { key: string; value: string }[];
  /** A line-scope question's matches (PIE-1277). */
  propertyMatches?: PropertyMatch[];
  /** The words after the title as one line (`fields: ["excerpt"]`, outline-core `noteExcerpt`): a list row's preview. */
  excerpt?: string;
}
/** What `roadmap.items.create` takes: the outliner's `RoadmapItemCreateInput` (its priority and stage are the workboard's words). */
export type RoadmapItemInput = WireParams<"roadmap.items.create">["input"];

/** Everything a list row needs, without the note's full text. */
export const LIST_FIELDS: readonly BlockReadField[] = ["parent", "title", "properties", "revision", "timestamps", "author", "hasChildren"];
type BlockReadField = NonNullable<WireParams<"blocks.read">["fields"]>[number];

/** `activity.recent`'s entry, reshaped on purpose: its note as a row (`Msg`), `editedAt` as ms in `at`. */
export interface Activity { cursor: number; block: Msg; author: string; actor: string; kind: string; at: number }
export interface Comment {
  /** `open`: current (PIE-791: open or kept, in the page's margin by default); seen and resolved are earlier. */
  id: string; author: string; body: string; quote: string; at: number; open: boolean;
  /** How present it is (outline-core's annotation-marks.ts): open, seen, kept or resolved. */
  lifecycle: MarkLifecycle;
  /** Its newest TL;DR (a reply with `[kind::tldr]`): the thread's face, its discussion folded behind it. */
  tldr?: { id: string; author: string; body: string; at: number };
  /** Where the quote sits in the note's current text (UTF-16 offsets), when the service could place it. */
  start: number | null; end: number | null;
  replies: { id: string; author: string; body: string; at: number; quotedIn?: string[]; tldr?: boolean; revision?: number; edited?: number; editedBy?: string }[];
  /** Its block's revision: an edit of its words (`updateComment`) names it, so an edit made meanwhile is never overwritten. */
  revision?: number;
  /** When its words were last edited after it was posted (PIE-763), ms; absent when never. */
  edited?: number;
  /** Who edited them last: `user` (the person) or an agent's actor id. */
  editedBy?: string;
  /**
   * Its own properties (ADR 0004 contract 6), open: `kind` (highlight, note, question…), `tags`, `color` (a theme
   * tone). A highlight is a thread with no body.
   */
  props?: Record<string, string[]>;
  /** The blocks quoting it (`quote`), oldest first: each holds `[from::((this))]`. */
  quotedIn?: string[];
}
// `quote`'s wire types (PIE-1247) are outline-core's: both sides import them.
import type { QuotePlace, QuoteReceipt, QuoteSubject } from "@ep0ch/outline-core/protocol";
export type { QuotePlace, QuoteReceipt, QuoteSubject, QuotedSubject } from "@ep0ch/outline-core/protocol";
/**
 * A passage to comment on: exact source text of the note, where it starts (UTF-16 offset), and the text around it
 * (outline-core passage.ts), so a comment on a note that moved on since lands where the words are, once.
 */
export interface CommentPassage { quote: string; start: number; prefix?: string; suffix?: string }
/** An annotation's own properties as written: open keys, a value or a list. */
export type AnnotationProps = Record<string, string | string[]>;
export interface CommentReceipt { id: string; deduplicated: boolean }
/** The open proposals beside a note, as the service answers `draft.proposals.list` (the outliner's `DraftProposalsBeside`). */
export type ProposalsBeside = WireAnswer<"draft.proposals.list">;
/** One row of the whole-outline index: everything but the full text. `depth`: 0 for a top-level note. */
export interface IndexBlock {
  id: string; parentId: string | null; position: number; depth: number; title: string; author: string;
  createdAt: number; updatedAt: number; properties: { key: string; value: string }[]; hasChildren: boolean;
}
export type { BacklinkCollection, BacklinkSource } from "./backlinks";
/** The service's record of one committed change (PIE-399), on content events and from `changes.since`. */
export type Change = Extract<WireAnswer<"changes.since">, { kind: "changes" }>["changes"][number];
/**
 * An outline event. Besides the service's own, the door makes two after a reconnect:
 * `reset` (reload everything: the feed's history doesn't reach back far enough)
 * and `reconnected` (caught up; `caughtUp` changes were replayed as ordinary events first).
 */
/** The spans of a `draft.patch` as the service passes them on (@ep0ch/outline-core/draft-patch-compare). */
export type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";

/**
 * What the service asks the door holding a draft (a `draft` event), and the answer the door sends back. A patch
 * that applies or dismisses a proposal names it (`proposal`, PIE-510), so the door says which without guessing.
 */
export type DraftRequest =
  | { kind: "read"; requestId: string; holdId: string; blockId: string }
  | { kind: "patch"; undoPatches?: string[]; requestId: string; holdId: string; blockId: string; patchId: string; revision: number; patches: DraftPatchSpan[]; mutation: { author: string; actorId?: string }; replyTo?: string; replyGroup?: string; mark?: string; output?: boolean; force?: boolean; proposal?: { id: string; op: "apply" | "dismiss" } }
  | { kind: "revert"; requestId: string; holdId: string; blockId: string; patchId: string };
export type DraftAnswer = { text: string; revision: number; cursorLine?: number } | { applied: true; inverse?: { before: string; text: string; revision: number } } | { applied: false; reason: string } | { reverted: boolean };
/** A live draft's hold on the service: renewed while the draft is open, let go when it closes. */
export interface DraftHoldHandle {
  revise(revision: number): void; release(): void;
  /** The person typed in it (never an agent's patch): told to the service a moment later (`drafts.touch`). */
  touched?(): void;
}
/** How often ongoing typing reaches the service (ms); its quiet timer settles each ask independently. */
export const DRAFT_TOUCH_MS = 1000;
/** Lease and heartbeat of a draft hold (ms): a door that dies loses its holds within the lease. */
export const DRAFT_LEASE_MS = 15_000, DRAFT_HEARTBEAT_MS = 5_000;

export interface OutlineEvent {
  door?: import("@ep0ch/outline-core/door-open").DoorOpen;
  ask?: import("@ep0ch/outline-core/protocol").AskProgress;
  script?: import("@ep0ch/outline-core/protocol").ScriptActionCall;
  /** On a `scripts.ended` event (PIE-957): a run ended; on `scripts.undone`: a run's writes were taken back. */
  ended?: import("@ep0ch/outline-core/protocol").ScriptEnded;
  undone?: { run: string };
  domain: string; action: string; blockId?: string; sequence: number;
  /** On an `agents` event: whether yolo is on for the outline now (PIE-973). */
  yolo?: boolean;
  /** The Resource a `resource-catalog` event names (a registration, a refresh). */
  resourceId?: string;
  change?: Change;
  /**
   * A change to a note a tool stamped `[machine::…]` before and after (the service says, PIE-1546): a list that leaves
   * machinery out can't see it, so only what shows that very note (or asks for machinery) looks again.
   */
  hidden?: true;
  /** Replayed from `changes.since` after a reconnect, not live. */
  catchUp?: boolean;
  reason?: string;
  caughtUp?: number;
  /** On a `draft` event: what the service asks the door holding that draft (PIE-501). */
  draft?: DraftRequest;
}
/** A view's hand-set order (the outliner's `VirtualBranchOrder`): what a placement is checked against. */
export type ViewOrder = WireAnswer<"virtual.occurrences.order">;

/** views.read's answer (PIE-397), derived from the wire: its blocks as list rows (`Msg`) are the one reshape. */
export type SavedViewRead = Omit<WireAnswer<"views.read">, "blocks"> & { blocks: Msg[] };
export type ChangePage = WireAnswer<"changes.since">;

/** The first line of a compact tree preview (it joins a property-less note's lines with ` ↵ `). */
export const previewTitle = (p: string) => p.split(" \u21b5 ")[0]!.trim();

/** A `references.backlinks` answer for block `id`, its optional parts filled in (as `SocketBoard.backlinks` reads it). */
export function backlinkCollectionOf(r: BacklinkCollection, id: string): BacklinkCollection {
  const sources = (r.sources ?? []).map(s => ({ ...s, parentContext: s.parentContext ?? "", referenceGroups: s.referenceGroups ?? [], occurrences: s.occurrences ?? [] }));
  return { ...r, targetBlockId: r.targetBlockId ?? id, sources, completeness: r.completeness ?? { kind: "complete" } };
}

const toMsg = (b: WireBlock, childIds: string[] = []): Msg => ({
  id: b.id,
  text: b.text ?? b.title ?? (b.preview !== undefined ? previewTitle(b.preview) : ""),
  parentId: b.parentId ?? null,
  position: b.position,
  childIds,
  createdAt: b.createdAt ? Date.parse(b.createdAt) : 0,
  updatedAt: b.updatedAt ? Date.parse(b.updatedAt) : 0,
  author: b.actorId ?? b.author ?? null,
  revision: b.revision,
  properties: (b.properties ?? []).map(p => ({ key: p.key, value: p.value })),
  ...(b.text === undefined ? { partial: true } : {}),
  ...(b.excerpt ? { excerpt: b.excerpt } : {}),
  ...(b.deletedAt || b.effectiveDeletedRootId ? { deleted: true } : {}),
  ...(b.propertyMatches?.length ? { propertyMatches: b.propertyMatches } : {}),
});

/** A writer that is an extension (`ext:jira`): the service attributes every extension write that way. */
export const isExtensionWriter = (author: string | null | undefined) => !!author?.startsWith("ext:");

/** How the service reads one `((id^fragment|label))` (`references.resolve`), as the wire sends it without the note (the door asks for the title). */
export type ReferenceResolution = Omit<WireAnswer<"references.resolve">["references"][number], "block">;
/** How the service reads one `[[address]]` or Work ID (`pages.resolve`), its note as a list row (`Msg`). Read-only: nothing is created. */
export type PageResolution = Omit<WireAnswer<"pages.resolve">, "block"> & { block?: Msg };
export type { HeldAsk, NotePlacement } from "@ep0ch/outline-core/protocol";
import type { NotePlacement } from "@ep0ch/outline-core/protocol";
import type { PropertyRecord } from "@ep0ch/outline-core/property-parse";
import type { SiteAnswer, SiteLink } from "@ep0ch/outline-core/site";
import type { TemplateUseAnswer } from "@ep0ch/outline-core/template-use";

import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
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
export type PlannedChange = import("@ep0ch/outliner/wire").ViewWriteChange;
type ViewMovePlan = import("@ep0ch/outliner/wire").ViewMovePlan;
type ViewCreatePlan = import("@ep0ch/outliner/wire").ViewCreatePlan;
/** The service's plan for moving a block into one saved view (`views.planWrite` with a block). */
export type MovePlan =
  | Exclude<ViewMovePlan, { kind: "refused" }>
  /** `stale`: set by the door when the card changed since the board showed it (src/move.ts). */
  | { kind: "refused"; reason: string; stale?: boolean };
/** The service's plan for a new block in one saved view (`views.planWrite` with text). */
export type CreatePlan = ViewCreatePlan;

/** A step's status: outline-core's checklist grammar (checklist-marks.ts, PIE-811). */
export type { ChecklistStatus as StepStatus } from "@ep0ch/outline-core/checklist-marks";
import type { ChecklistStatus as StepStatus } from "@ep0ch/outline-core/checklist-marks";
import { prop, propValues } from "./props";
/** One checklist step as `checklist.query` reads it (the wire's item), less what only the service computes: the door also reads a draft's steps itself (src/steps.ts). */
export type ChecklistStep = Omit<WireAnswer<"checklist.query">["items"][number], "markerStart" | "properties" | "parentStart"> & { markerStart?: number };
/** What a step change does: set its status, or only give it a stable id (`^t-…`) so it can be linked. */
export type StepChange = { kind: "status"; status: StepStatus } | { kind: "ensure-id" };

/** A fragment's slice of its note, as the service reads it (`fragments.read`, PIE-424). */
export type FragmentSlice = Extract<FragmentRead, { status: "resolved" }>["fragment"];
export type FragmentRead = WireAnswer<"fragments.read">;

/** A fragment completion can link to, as `fragments.candidates` finds it. */
export type FragmentCandidate = WireAnswer<"fragments.candidates">["items"][number];

/**
 * One transclusion as the service projects it (`transclusions.read`): ready with its note (and a fragment's
 * slice), the steps inside what it shows and the embeds inside it, nested; or why not, in the service's words.
 * Reshaped on purpose: the door inlines the note as a `Msg` and resolves the results itself.
 */
export interface TransclusionNode {
  resolvedBlockId?: string;
  outline?: string; machine?: string;
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
export type ChecklistRead = Omit<WireAnswer<"checklist.query">, "items"> & { items: ChecklistStep[] };

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
  /** Which kind of refusal, from the envelope's `kind` (outline-core refusal.ts): what a caller branches on, never the words. */
  constructor(message: string, readonly kind: RefusalKind = "failed", readonly problem?: OutlinerRequestProblem) { super(message); this.name = "Refused"; }
}

/**
 * A conditional trash (`trash(id, actor, { revision, ifEmpty })`) refused because the block was written since it was
 * read: changed since that revision, or (`ifEmpty`) given text or a child.
 */
export const changedSinceRead = (e: unknown): e is Refused => e instanceof Refused && (e.kind === "stale-revision" || e.kind === "conflict");
/** The refusal for a note that isn't there, as the host would send it. */
const blockNotFoundRefused = (id: string): Refused => new Refused(blockNotFound(id).message, "not-found");

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
/**
 * Who acts. `run` and `invitation` (PIE-957) are an agent's that a script run carries: its run id, and the invitation the
 * person's press minted for it (src/surface/invite.ts), which lets the run move the person's tiles; `for` is who asked for
 * the run (`you`, or `agent:<id>`), who may undo what it did.
 */
export type Actor = ({ kind: "user" } | { kind: "agent"; id: string; run?: string; invitation?: string; for?: string }) & { with?: string[] };
export const USER: Actor = { kind: "user" };
/** A stored author (an actor id, `user`, …) as a byline shows it: the persona first (`actorName`), `none` when there's none. */
export const authorName = (author: string | null | undefined, none = "?"): string => (author ? actorName(author) || none : none);
/** Who did it, as a door's answer says it: the agent's id, or "you" for the person. Drawn through `authorName`. */
export const whoOf = (actor: Actor): string => (actor.kind === "agent" ? actor.id : "you");
/** `{ by: <agent id> }` for an agent's doing, nothing for the person's: what a record or an answer spreads in. */
export const byOf = (actor: Actor): { by?: string } => (actor.kind === "agent" ? { by: actor.id } : {});
/** The actor id an agent gets when it doesn't name itself: `ep0ch-door:<hostname>:agent`. */
export const AGENT_ACTOR_ID = `${ACTOR_ID}:agent`;
/** One party's own id: an agent's, or the door's for the person at the keys. */
export const actorIdOf = (actor: Actor): string => (actor.kind === "agent" ? actor.id : ACTOR_ID);
/** The actor id a write records: the saver's, then anyone else who wrote part of it, joined by `+`. */
export const recordedActorId = (actor: Actor): string => [actorIdOf(actor), ...(actor.with ?? [])].join("+");
/**
 * Who asks (an extension's action, a proposal applied or dismissed): the person, or an agent by its own id, which the
 * service checks ownership by. Not who a write is recorded as (`recorded`): an ask names one party, so co-writers
 * (`with`) aren't in it.
 */
export const requesterOf = (actor: Actor): { author: "agent" | "user"; actorId?: string } => (actor.kind === "agent" ? { author: "agent", actorId: actorIdOf(actor) } : { author: "user" });
/**
 * Who a write by `actor` is recorded as: the one answer (PIE-1294; ADR 0005, how a change is recorded is shared by
 * every client), for what the service stores and for the words an answer or a status line says about it. The saver
 * is named first and anyone who wrote part of it after (`recordedActorId`).
 *
 * - `revision`: a change to a block that exists (an edit, a property, a move, a trash): the saver's kind, naming
 *   them and their co-writers (`mutation`). The person with an agent's words in it is `author: user` naming both.
 * - `new`: a block or a comment made now (`block`). The service keeps agent provenance on agent-authored blocks only
 *   (outliner store.ts `normalizeCreatorProvenance`: a person's block never claims an agent's id), so one a person
 *   and an agent both wrote is `author: agent` naming both, the person's door first; the person's alone carries none.
 *
 * `says` is what was stored, in words: "yours", "yours, naming <ids>", "an agent (<ids>)'s" or, for a new block both
 * wrote, "an agent's, naming <ids>". The guard test
 * (test/one-owner.test.ts) fails when a write spells its own `author: "agent", provenance`.
 */
export function recorded(actor: Actor = USER, made: "revision" | "new" = "revision") {
  const shared = actor.kind === "agent" || !!actor.with?.length, actorId = recordedActorId(actor);
  const agent = actor.kind === "agent" || made === "new";
  return {
    mutation: (shared ? { author: actor.kind, actorId } : EDIT_MUTATION) as { author: "agent" | "user"; actorId: string },
    block: shared ? { author: "agent" as const, provenance: { actorId } } : { author: "user" as const },
    says: !shared ? "yours" : actor.kind === "agent" ? `an agent (${actorId})'s` : agent ? `an agent's, naming ${actorId}` : `yours, naming ${actorId}`,
  };
}
/**
 * Who a write was recorded as, as every writing action answers it (PIE-1406): what was stored (`author`, and `actorId`
 * when one was: a person's new block carries none) and `says`, the words the door says for it. One shape for every
 * answer, so an agent reads `recordedAs.says` or `recordedAs.actorId` without asking which action it ran.
 */
export interface RecordedAs { author: "agent" | "user"; actorId?: string; says: string }
/** `recordedAs` for a write by `actor` (`recorded`): `made` "new" for a block or comment made now, else a change. */
export function recordedAnswer(actor: Actor = USER, made: "revision" | "new" = "revision"): RecordedAs {
  const r = recorded(actor, made);
  const stored = made === "new" ? { author: r.block.author, actorId: r.block.author === "agent" ? r.block.provenance.actorId : undefined } : r.mutation;
  return { author: stored.author, ...(stored.actorId ? { actorId: stored.actorId } : {}), says: r.says };
}
/** The `recordedAs` field as an action's `answer` describes it (ActionDef.answer): spread into every writing action's. */
export const RECORDED_AS = { recordedAs: { type: "object", about: "who it was recorded as: author (agent or user), actorId when one was stored, says (the words the door says: yours, an agent (<id>)'s)" } } as const;
/** The `mutation` a change to a block carries for `actor` (`recorded`). */
export const mutationFor = (actor: Actor = USER) => recorded(actor).mutation;
/** How a comment or reply is authored (`recorded`, made `new`): a person's alone carries no actor id, as Detail sends it. */
const annotationAuthor = (actor: Actor = USER) => {
  const b = recorded(actor, "new").block;
  return b.author === "agent" ? { ...b, source: "agent" as const } : { author: COMMENT_AUTHOR, source: COMMENT_AUTHOR } as const;
};

/** What `tree.search` answers (the outliner's `GotoSearchCollection`). */
export type SearchHits = WireAnswer<"tree.search">;
/** How a search is asked: `semantic` has Jev re-order the candidates; `near` is the note it's asked from. */
export interface SearchOptions { semantic?: boolean; /** With semantic: when the ranked hits hold no sure answer, Jev reads the notes themselves (PIE-1200). */ deep?: boolean; near?: string; limit?: number; signal?: AbortSignal }

/** What the service says of a selection's facets (SocketBoard.facetList). */
export interface FacetAnswer {
  // Reshaped on purpose: counts settled (`more`), `last` as ms, notes as `Msg`.
  facets: { key: string; count: number; more: number; values: { value: string; count: number; last: number }[] }[];
  notes: Msg[]; truncated: boolean; matched: number; hint?: string;
  /** With `group=`: the service's groups of the notes (a date bucket's newest first), each its count over every match. */
  groups?: WireAnswer<"blocks.query">["groups"];
}
/** How the notes of a facet answer come: grouped by the service (`updated:recent`), sorted, each with its excerpt. */
export interface FacetNotes { group?: string; sort?: string; excerpt?: boolean; facets?: boolean }

export class SocketBoard implements Board {
  private sock: Socket | null = null;
  private waiting = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer; sock: Socket }>();
  private seq = 0;
  private events: Socket | null = null;
  readonly clientId = `ep0ch-door-${crypto.randomUUID().slice(0, 8)}`;
  /** The protocol the service reported (null until `info()`). */
  protocol: number | null = null;
  /** The outline database instance reported by the service; a change means every cached read belongs to another database. */
  outlineInstanceId: string | null = null;
  /** Every request's action, newest last: which paths the door actually took (tests read it). */
  readonly sent: string[] = [];
  /** The reads this connection watches (ADR 0004): the service says when one's answer changed. */
  readonly watched = new Watched(this);

  /**
   * `outline`: the outline this board reads on an outline host. Every request line and the subscribe
   * line name it, and `info()` refuses a service that can't route by name.
   */
  constructor(readonly path = DEFAULT_SOCKET, private readonly timeoutMs = 15_000, readonly outline?: string) {}

  /** With no subscription to say so: the requests' connection was said lost, and nothing has answered since. */
  private lostSaid = false;

  private conn(): Socket {
    if (this.sock && !this.sock.destroyed) return this.sock;
    const s = connect(this.path);
    const lines = new JsonLines(r => {
      // The service tells the connection that asked which watched answers changed (src/watched.ts).
      if (r.event?.action === QUERIES_CHANGED) { this.watched.changed(r.event.changes ?? []); return; }
      const w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id); clearTimeout(w.timer);
      // Only an answer is the link back: an ssh forward's local end takes a connection with the far host asleep.
      if (r.ok) this.lostSaid = false;
      r.ok ? w.resolve(r.result) : w.reject(new Refused(r.error ?? "request failed", r.kind, r.problem));
    });
    s.on("data", d => lines.feed(d));
    // Only this connection's requests fail with it: a close that comes after a new connection opened leaves its alone.
    const fail = (e: Error) => {
      for (const [id, w] of this.waiting) if (w.sock === s) { clearTimeout(w.timer); w.reject(e); this.waiting.delete(id); }
      if (this.sock === s) {
        this.sock = null; this.watched.lost();
        // Said once until the service answers again: each try against a dead socket is the same news, and drew over what
        // the status line had just said (PIE-1570).
        if (!this.sub && !this.lostSaid) { this.lostSaid = true; this.onConnection("lost", e.message); }
      }
    };
    s.on("error", fail);
    s.on("close", () => fail(new Error("outline socket closed")));
    this.sock = s;
    return s;
  }

  /** `timeoutMs`: this request's own wait, for one the service answers slowly on purpose (a tunnel coming up). */
  private readonly scriptRun = new AsyncLocalStorage<string>();
  /** A replayed action is not another physical command to record in a macro. */
  get inScriptRun(): boolean { return this.scriptRun.getStore() !== undefined; }

  /**
   * `signal` (a search turn's, src/search-schedule.ts): aborted, the request stops waiting and fails with an AbortError.
   * The host still answers it; the answer is dropped.
   */
  request<A extends WireAction>(action: A, ...[params = {} as WireParams<A>, timeoutMs = this.timeoutMs, signal]: WireArgs<A>): Promise<WireAnswer<A>> {
    return this.send(action, params as Record<string, unknown>, timeoutMs, signal) as Promise<WireAnswer<A>>;
  }

  /**
   * A request by a name only known at run time (a script's or an extension's call, passed on as asked): the host checks it,
   * this side can't. Everything the door itself asks goes through `request`, typed by the wire contract.
   */
  send(action: string, params: Record<string, unknown> = {}, timeoutMs = this.timeoutMs, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = `d${++this.seq}`;
    if (this.sent.length > 5000) this.sent.splice(0, 2500);
    this.sent.push(action);
    const stop = () => { const w = this.waiting.get(id); if (w) { clearTimeout(w.timer); this.waiting.delete(id); w.reject(signal!.reason); } };
    return traced(new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${action} timed out`)); }, timeoutMs);
      const sock = this.conn();
      this.waiting.set(id, { resolve, reject, timer, sock });
      // Taken off the turn's signal once the request settles, however it does.
      signal?.addEventListener("abort", stop, { once: true });
      sock.write(jsonLine({ id, action, ...params, ...(this.scriptRun.getStore() ? { scriptRun: this.scriptRun.getStore() } : {}), ...(this.outline ? { outline: this.outline } : {}) }));
    }).finally(() => signal?.removeEventListener("abort", stop)));
  }

  /** A file's text, read by the service (`files.read`): a relative path is the outline's own folder (an artifact's card, PIE-793). */
  async readFile(path: string): Promise<string> {
    return (await this.request("files.read", { path })).text;
  }

  /**
   * Fetch the tickets a note shows now (`resources.projection.refresh`): a page's, or the ticket block's own.
   * Any client may; the answer is the note's projections after the fetch.
   */
  async refreshProjections(blockId: string, line?: number, actor: Actor = USER): Promise<ResourceProjectionRead> {
    // Who asks (`mutation`, as on extensions.act): an `@name` line asked again records them as who asked.
    return this.request("resources.projection.refresh", { blockId, ...(line !== undefined ? { line } : {}), mutation: requesterOf(actor) });
  }

  scriptAction?: (call: import("@ep0ch/outline-core/protocol").ScriptActionCall) => Promise<unknown>;

  private async answerScript(call: import("@ep0ch/outline-core/protocol").ScriptActionCall): Promise<void> {
    if (call.targetClientId !== this.clientId) return;
    try {
      if (!this.scriptAction) throw new Error("This door has no active dispatcher; run the script from its power bar");
      const result = await this.scriptRun.run(call.actor.sessionId!, () => this.scriptAction!(call));
      await this.request("scripts.answer", { requestId: call.requestId, clientId: this.clientId, result });
    } catch (error) {
      await this.request("scripts.answer", { requestId: call.requestId, clientId: this.clientId, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    }
  }

  /**
   * Take an action's write group back whole (`extensions.undo`, PIE-784), as `actor`: its blocks to the Trash, its
   * edits, moves and orders put back in one step; refused with nothing changed when any of it changed since.
   */
  async undoExtension(undo: string, actor: Actor = USER): Promise<{ undone: string; extension: string; action: string; written: string[] }> {
    await Promise.all(this.releasing);
    return this.request("extensions.undo", { undo, mutation: requesterOf(actor) });
  }

  /**
   * One of an extension's bar sources answers a query (`extensions.bar`, PIE-656): rows for the power bar, each
   * opening a block, running one of the extension's actions or copying text. It writes nothing. `near` is the note
   * in front of the person, which the call sees as its context.
   */
  barRows(extension: string, source: string, query: string, o: { near?: string; limit?: number; signal?: AbortSignal } = {}): Promise<ExtensionBarResult> {
    return this.request("extensions.bar", { extension, source, query, ...(o.near ? { near: o.near } : {}), ...(o.limit ? { limit: o.limit } : {}) }, undefined, o.signal);
  }

  /**
   * Register the Resource an authored reference names (`resources.follow-authored`), or find the one already
   * registered: a `[file::…]` is interned (and its Source made), a `jira::KEY` resolved through the Jira
   * Source's provider. The Resource's id, and whether this call registered it.
   */
  async followAuthored(reference: AuthoredResourceReference, actor: Actor = USER): Promise<{ id: string; created: boolean }> {
    // Who registered it goes with the request (an agent's is its own).
    const r = await this.request("resources.follow-authored", { reference, mutation: mutationFor(actor) });
    return { id: r.resource.id, created: !!r.created };
  }

  /**
   * A Resource's stored content (`resources.describe`). `fetch`: when nothing is stored yet (a ticket never
   * read, a web page never fetched) and the service says the Resource can be refreshed (its
   * `capabilities.refresh` isn't `unavailable`), it is fetched first (`resources.refresh`). Neither call needs a Detail
   * (`resources.observer-reads`).
   */
  async describeResource(resourceId: string, fetch = false): Promise<ResourceDescription> {
    const d = await this.request("resources.describe", { target: { kind: "resource", resourceId } });
    // `unavailable`: the service won't refresh this one (a file is read as it is). `indeterminate` (a
    // ticket whose credentials the service only finds out about by trying) is worth one try.
    if (!fetch || resourceStored(d) || !d.capabilities?.refresh || d.capabilities.refresh.status === "unavailable") return d;
    return this.request("resources.refresh", { resourceId });
  }

  toMsgs(blocks: WireBlock[]): Msg[] { return blocks.map(b => toMsg(b)); }

  grammarNotice: string | undefined;
  private grammarSaid = false;
  onGrammar: (notice: string) => void = () => {};
  takeGrammarNotice(): string | undefined {
    if (this.grammarSaid || !this.grammarNotice) return undefined;
    this.grammarSaid = true;
    return this.grammarNotice;
  }

  async info(): Promise<BoardInfo & { replaced?: boolean }> {
    const r = await this.request("ping");
    if (this.outline && r.outline?.name && r.outline.name !== this.outline)
      throw new Error(`the outline host at ${this.path} answered for "${r.outline.name}", not "${this.outline}"`);
    // One check: the service speaks this checkout's protocol. Older or newer, it is refused, never worked around.
    await meetRules(r);
    this.grammarNotice = grammarWarning(r.grammarVersion);
    if (this.grammarNotice && !this.grammarSaid) this.onGrammar(this.grammarNotice);
    const mismatch = protocolMismatch(r.protocolVersion, "this door");
    if (mismatch) throw new Error(`${mismatch} (${this.path})`);
    this.protocol = r.protocolVersion;
    const previous = this.outlineInstanceId;
    this.outlineInstanceId = r.outlineInstanceId ?? null;
    return {
      host: r.location.hostname, workspace: r.location.workspaceRoot, protocol: r.protocolVersion, blocks: null,
      ...(r.location.machine ? { machine: r.location.machine } : {}),
      ...(this.outlineInstanceId ? { outlineInstanceId: this.outlineInstanceId } : {}),
      ...(previous && this.outlineInstanceId && previous !== this.outlineInstanceId ? { replaced: true } : {}),
      // On a host, the outline's name is how it's addressed (a board with no outline reads the host's default).
      ...(r.host ? { outline: r.outline?.name ?? this.outline } : {}),
    };
  }

  async roots(): Promise<Msg[]> {
    return (await this.request("children", { parentId: null })).map(b => toMsg(b));
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
      const ctx = await this.request("blocks.context", { blockId: id });
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
      const ctx = await this.request("blocks.context", { blockId: id });
      return ctx.selected ? toMsg(ctx.selected, ctx.children.map(c => c.id)) : null;
    } catch (e) {
      if (e instanceof Refused && e.kind === "not-found") return null;
      throw e;
    }
  }

  /** How the service reads every `((…))` in `text`: status, title, label, fragment (the Detail's own resolver). */
  async resolveReferences(text: string): Promise<ReferenceResolution[]> {
    return (await this.request("references.resolve", { text })).references;
  }

  /** Where a soft link lands (PIE-408): the service's answer for what it names, from the block and line it's written on. */
  async softLink(name: SoftLinkName, at: { blockId?: string; line?: number } = {}): Promise<{ status: "resolved" | "ambiguous" | "missing"; words: string; candidates: SoftLinkChoice[] }> {
    const r = await this.request("references.soft", { name, ...at });
    return { status: r.status, words: r.words, candidates: r.candidates.map(({ block, ...c }) => ({ ...c, ...(block ? { note: toMsg(block) } : {}) })) };
  }

  /** What soft links are drawn with (PIE-408): keys left out, and the page addresses a value can land on. */
  async softLinkScope(): Promise<{ ignore: string[]; pages: string[] }> { return this.request("references.soft-scope", {}); }

  /** Which prefixes make a bare key a Work ID here (#429): the configured one and every prefix in use. */
  async ticketPrefixes(): Promise<{ prefix: string | null; prefixesInUse: string[] }> {
    const r = await this.request("references.resolve", { text: "" });
    return { prefix: r.workIdPrefix ?? null, prefixesInUse: r.ticketPrefixes ?? [] };
  }

  /** The workspace's configured Work-ID prefix (`PIE`), or null when none is configured. */
  async workIdPrefix(): Promise<string | null> {
    return (await this.request("references.resolve", { text: "" })).workIdPrefix ?? null;
  }

  /**
   * Notes named the way a person types them (`blocks.resolve`, PIE-875): an id, ((id)), an id's first 8+ characters, a
   * Work ID of any prefix the outline has or a [[page]]. Each answers its block id, or why not (with a did-you-mean); 200 a request, the service's most.
   */
  async resolveRefs(refs: string[]): Promise<{ ref: string; id?: string; error?: string }[]> {
    const out: { ref: string; id?: string; error?: string }[] = [];
    for (let i = 0; i < refs.length; i += 200) out.push(...(await this.request("blocks.resolve", { refs: refs.slice(i, i + 200) })).resolved);
    return out;
  }

  /** What a `[[page]]` address or Work ID points at. Never follows (`pages.follow` would create a stub). */
  async resolvePage(address: string): Promise<PageResolution> {
    const r = await this.request("pages.resolve", { address });
    return { ...r, ...(r.block ? { block: { ...toMsg(r.block), ...(r.outline ? { address: { outline: r.outline, machine: r.machine } } : {}) } } : { block: undefined }) };
  }

  /**
   * A template written out as a new note (PIE-533 S4, `template.stamp`): the service fills the stamp's own values and makes
   * the note (or one per `for` match), recorded as `actor`'s. Never retried blindly.
   */
  async templateStamp(req: { of: string; parent?: string; title?: string; props?: Record<string, string>; for?: string; freeze?: string; as?: string; into?: string }, actor: Actor = USER): Promise<{ template: { id: string; title: string }; stamped: { id: string; title: string; parentId: string | null; blocks: number; frozen: number; for?: string }[]; skipped: { for: string; stamped: string }[]; warnings: string[]; said: string }> {
    const who = recorded(actor, "new").block;
    return this.request("template.stamp", { ...req, ...who });
  }

  /** The call a `::use` line makes (`template.use`), once; a drawing asks it watched (src/template-use.ts). */
  templateUse(block: string, line: number, draft?: string): Promise<TemplateUseAnswer> {
    return this.request("template.use", { block, line, ...(draft !== undefined ? { draft: { text: draft } } : {}) });
  }

  /**
   * What the `{{ }}` of a note read as (PIE-533 `site.answer`): the service resolves, the door draws. `draft` is the note's
   * unsaved text, so values agree with what is on screen. A service without it answers an error (the placeholders stay text).
   */
  async siteAnswer(blockId: string, draft?: string, call?: { chain?: SiteLink[]; props?: Record<string, string[]> }): Promise<SiteAnswer> {
    return this.request("site.answer", { blockId, ...(draft !== undefined ? { draft: { text: draft } } : {}), ...(call?.chain?.length ? { chain: call.chain } : {}), ...(call?.props ? { props: call.props } : {}) });
  }

  /**
   * Every generated region of a note with what it read, when, what shaped it and what it answered (`site.sources`, PIE-956 S6b):
   * the Sources inspector's one answer, the one a published page's panel draws too. Reads the saved note.
   */
  async siteSources(blockId: string): Promise<SourcesAnswer> {
    const { sources } = await this.request("site.answer", { blockId, sources: true });
    if (!sources) throw new Error("the service answered this note's site without its sources");
    return sources;
  }

  /** Every property token in `text`, as the service parses it (PIE-401). */
  async propertyRecords(text: string): Promise<PropertyRecord[]> {
    return (await this.request("properties.preview", { text })).tokens;
  }

  /** Breadcrumb, root first. */
  async ancestors(id: string): Promise<Msg[]> {
    const ctx = await this.request("blocks.context", { blockId: id });
    return ctx.ancestors.map(b => toMsg(b));
  }

  async children(id: string): Promise<Msg[]> {
    return (await this.request("children", { parentId: id })).map(b => toMsg(b));
  }

  /**
   * Each block's kind, stage and dates as the service computes them for a link's target (`blocks.facets`, PIE-693):
   * what Kind, Stage and Sort read for rows that aren't links (a note's children). At most 1000 a request, asked in
   * turn; `missing` names the ids that answer no live block.
   */
  async facets(ids: readonly string[]): Promise<{ facets: Record<string, AuthoredTargetFacets>; missing: string[] }> {
    const out: { facets: Record<string, AuthoredTargetFacets>; missing: string[] } = { facets: {}, missing: [] };
    for (let i = 0; i < ids.length; i += 1000) {
      const r = await this.request("blocks.facets", { blockIds: ids.slice(i, i + 1000) });
      Object.assign(out.facets, r.facets ?? {}); out.missing.push(...(r.missing ?? []));
    }
    return out;
  }

  /**
   * Blocks changed after `since`, newest first, as list rows: the service answers `updated > since` itself
   * (`where`, PIE-398) and sends titles and properties only.
   * A block an extension wrote (a Jira ticket the service keeps: its writer is `ext:…`, and only that
   * extension ever writes it) and a block a tool stamped `[machine::…]` (the service's `machinery`, hidden unless asked) are
   * left out unless `extensions`: they aren't the person's news.
   */
  async changedSince(since: number, limit: number, extensions = false): Promise<Msg[]> {
    const sort = { field: "updated", direction: "desc" } as const;
    const keep = (m: Msg) => extensions || !isExtensionWriter(m.author);
    const after = since > 0 ? `updated>${new Date(since).toISOString()}` : "";
    if (extensions) {
      const r = await this.request("blocks.query", {
        query: { ...(after ? { where: after } : {}), limit: Math.min(1000, limit), sort, machinery: "show" }, ...this.listFields(),
      });
      return r.blocks.map(b => toMsg(b));
    }
    // What extensions wrote can outnumber the person's own changes (a poll that refreshed many tickets and
    // their comments): page back through them, so they never push the person's edits past the limit.
    const out: Msg[] = [], seen = new Set<string>(), size = Math.min(1000, Math.max(100, limit * 2));
    let before: string | undefined;
    for (let pages = 0; pages < 20 && out.length < limit; pages++) {
      const expression = [after, before ? `updated<=${before}` : ""].filter(Boolean).join(" ");
      const r = await this.request("blocks.query", {
        query: { ...(expression ? { where: expression } : {}), limit: size, sort }, ...this.listFields(),
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
    // A deep search reads every note's title in windows: it gets longer than a keystroke's.
    return this.request("tree.search", { query: text, ...(opts.limit !== undefined ? { limit: opts.limit } : {}), ...(opts.semantic ? { semantic: true } : {}), ...(opts.semantic && opts.deep ? { deep: true } : {}), ...(opts.near ? { contextBlockId: opts.near } : {}) }, opts.deep ? 60_000 : undefined, opts.signal);
  }

  /** `searchBlocks`, at most `limit` hits read whole for a preview, with what Jev did (`semantic`) and its Score per hit (`scores`). */
  async search(text: string, limit: number, opts: SearchOptions = {}): Promise<Msg[] & { semantic?: SearchHits["semantic"]; scores?: Map<string, number>; deep?: Set<string> }> {
    const r = await this.searchBlocks(text, opts);
    const ids = r.matches.slice(0, Math.min(1000, limit)).map(m => m.block.id);
    // A search replaced meanwhile (its signal aborted) stops reading its hits.
    const by = new Map((ids.length ? (await this.readBlocks(ids, opts.signal)).blocks : []).map(m => [m.id, m]));
    const scores = new Map(r.matches.flatMap(m => m.score !== undefined ? [[m.block.id, m.score] as const] : []));
    const deep = new Set(r.matches.flatMap(m => m.deep ? [m.block.id] : []));
    return Object.assign(ids.flatMap(id => by.get(id) ?? []), { semantic: r.semantic, ...(scores.size ? { scores } : {}), ...(deep.size ? { deep } : {}) });
  }

  async callers(): Promise<Caller[]> {
    const list = await this.request("clients.list");
    return list.map(c => ({
      id: c.clientId,
      name: c.role,
      host: c.runtime?.hostname ?? (c.app === "door" ? "ep0ch door" : "—"),
      activity: c.currentTarget?.kind === "block" ? `reading ${c.currentTarget.blockId.slice(0, 8)}`
        : c.currentTarget?.kind === "resource" ? "in the file area" : c.role === "observer" ? "lurking" : "idle",
      since: null,
      target: c.currentTarget?.kind === "block" ? c.currentTarget.blockId : null,
    }));
  }

  /** Who edited what, across all three author classes, newest first. */
  async activity(limit = 60): Promise<Activity[]> {
    const pages = await Promise.all((["user", "agent", "system"] as const).map(author =>
      this.request("activity.recent", { author, limit: Math.min(100, limit) }).catch(() => ({ entries: [] }))));
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
    const r = await lane.request("tree.index", {}).finally(() => lane.close());
    // The service's walk is `physicalBlockIds`; `blocks` holds them by id (and a view's rows, which this asks for none of).
    const by = new Map(r.blocks.map(b => [b.id, b]));
    const order = r.physicalBlockIds.map(id => by.get(id)).filter(b => b !== undefined);
    // The wire's times are ISO text; a row keeps them as ms (IndexBlock), parsed here once.
    return order.map(b => ({
      id: b.id, parentId: b.parentId ?? null, position: b.position ?? 0, depth: b.depth ?? 0, title: String(b.preview ?? "").trim() || "(untitled)",
      author: b.actorId ?? b.author ?? "?", createdAt: Date.parse(b.createdAt), updatedAt: Date.parse(b.updatedAt),
      properties: (b.properties ?? []).map(p => ({ key: p.key, value: p.value })), hasChildren: !!b.hasChildren,
    }));
  }

  /** Blocks carrying one property value, newest first (a virtual branch). */
  async byProp(key: string, value: string, limit = 200, machinery?: MachineryMode): Promise<Msg[]> {
    const r = await this.request("blocks.query", {
      query: { limit, filters: [{ key, value }], sort: { field: "updated", direction: "desc" }, ...(machinery ? { machinery } : {}) },
    });
    return r.blocks.map(b => toMsg(b));
  }

  /** byProp's question as the service watches it (PIE-1546): asked once, then told when its answer changed. */
  private byPropQuestion(key: string, value: string, limit: number) {
    return { query: { limit, filters: [{ key, value }], sort: { field: "updated", direction: "desc" as const } } };
  }
  /** byProp, watched: the answer the service last gave this connection (a change elsewhere asks nothing). */
  async byPropWatched(key: string, value: string, limit = 200): Promise<Msg[]> {
    const shown = await this.watched.answer<Msg[]>("blocks.query", this.byPropQuestion(key, value, limit), (r: { blocks: WireBlock[] }) => r.blocks.map(b => toMsg(b)), "", { held: true });
    if (shown.state === "error") throw new Error(shown.error);
    return shown.value ?? [];
  }
  /** byPropWatched's answer as it stands, without waiting (undefined until the first is in). */
  byPropShown(key: string, value: string, limit = 200): Msg[] | undefined {
    return this.watched.read<Msg[]>("blocks.query", this.byPropQuestion(key, value, limit), (r: { blocks: WireBlock[] }) => r.blocks.map(b => toMsg(b)), "", { held: true }).value;
  }

  private queryQuestion(q: string, limit: number, sort: string, direction: "asc" | "desc", list: boolean) {
    const filters = q.split(/\s+/).filter(Boolean).map(t => { const i = t.indexOf("="); return i > 0 ? { key: t.slice(0, i), value: t.slice(i + 1) } : { key: t }; });
    return { query: { limit: Math.min(1000, limit), filters, sort: { field: sort, direction } }, ...this.listFields(list) };
  }
  async query(q: string, limit = 50, sort = "updated", direction: "asc" | "desc" = "desc", list = false): Promise<Msg[]> {
    const r = await this.request("blocks.query", this.queryQuestion(q, limit, sort, direction, list));
    return r.blocks.map(b => toMsg(b));
  }
  /** `query` as a question the service watches: its answer as it stands (undefined until the first is in), moving when the service says it changed. */
  queryShown(q: string, limit = 50, sort = "updated", direction: "asc" | "desc" = "desc", list = false): Msg[] | undefined {
    return this.watched.read<Msg[]>("blocks.query", this.queryQuestion(q, limit, sort, direction, list), (r: { blocks: WireBlock[] }) => r.blocks.map(b => toMsg(b)), "", { held: true }).value;
  }

  /**
   * The blocks a query in the saved views' grammar matches (`type=outbox-item status=waiting`, OR, NOT, ranges), as
   * list rows, in the service's order: the service parses it (`where`), the door never does. `truncated`:
   * there were more than `limit`. `machinery` (outline-core `machinery.ts`): the service leaves out what tools stamped
   * `[machine::…]` unless this says `show` (or `only`).
   */
  async queryNotes(expression: string, limit = 200, machinery?: MachineryMode, signal?: AbortSignal): Promise<{ notes: Msg[]; truncated: boolean }> {
    const r = await this.request("blocks.query", { query: { where: expression, limit: Math.min(1000, limit), ...(machinery ? { machinery } : {}) }, ...this.listFields(true) }, undefined, signal);
    return { notes: r.blocks.map(b => toMsg(b)), truncated: r.completeness?.kind === "truncated" };
  }

  /**
   * The facets of the notes a query narrows to (the facets tile, PIE-881), as the service counts them: `where` is the
   * selection in the views' grammar (empty: every note), and every property key the matches carry comes back with how
   * many of them carry it, and each value with how many matches have it and when one was last updated (`blocks.query`
   * `facets=true`, `facetValues`), with the notes themselves (up to `noteLimit`, none when `noteLimit` is 0). The door
   * never counts or narrows. `more`: values a key's list left out.
   */
  async facetList(where: string, noteLimit = 200, o: FacetNotes = {}): Promise<FacetAnswer> {
    const r = await this.request(
      "blocks.query", { query: { ...(where.trim() ? { where } : {}), ...(o.facets === false ? {} : { facets: true, facetKeys: 1000, facetValues: 1000 }), ...(o.group ? { group: o.group } : {}), ...(o.sort ? { sort: o.sort } : {}), limit: Math.max(1, Math.min(1000, noteLimit)) }, fields: o.excerpt ? [...LIST_FIELDS, "excerpt"] : [...LIST_FIELDS] });
    const notes = noteLimit ? r.blocks.map(b => toMsg(b)) : [];
    const truncated = r.completeness?.kind === "truncated";
    return {
      facets: (r.facets ?? []).map(f => ({ key: f.key, count: f.count, more: f.more ?? 0, values: f.values.map(v => ({ value: v.value, count: v.count, last: Date.parse(v.last) || 0 })) })),
      notes, truncated, matched: r.completeness.kind === "truncated" ? r.completeness.matched ?? notes.length : r.blocks.length, ...(r.hint ? { hint: r.hint } : {}), ...(r.groups ? { groups: r.groups } : {}),
    };
  }

  /** `fields` for a list-shaped read. */
  private listFields(list = true): { fields?: BlockReadField[] } {
    return list ? { fields: [...LIST_FIELDS] } : {};
  }

  /**
   * Several blocks at once, as list rows (PIE-400 `blocks.read`), in the order asked. Missing and
   * trashed ids are left out.
   */
  async readMany(ids: string[], fields: readonly BlockReadField[] = LIST_FIELDS): Promise<Msg[]> {
    if (!ids.length) return [];
    return (await this.request("blocks.read", { ids, fields: [...fields] })).blocks.map(b => toMsg(b));
  }

  /**
   * Whole blocks, text included, in one `blocks.read` (PIE-400), with the ids that are missing or in
   * Trash.
   */
  async readBlocks(ids: string[], signal?: AbortSignal): Promise<{ blocks: Msg[]; unavailable: { id: string; status: "missing" | "trashed" }[] }> {
    const r = await this.request("blocks.read", { ids, fields: [...LIST_FIELDS, "text"] }, undefined, signal);
    return { blocks: r.blocks.map(b => toMsg(b)), unavailable: r.unavailable ?? [] };
  }

  /**
   * A saved view's members as the service evaluates them (PIE-397 `views.read`), as list rows.
   */
  async readSavedView(viewId: string, page: { limit?: number; offset?: number } = {}, signal?: AbortSignal): Promise<SavedViewRead> {
    const r = await this.request("views.read", { viewId, format: "tree", ...page }, undefined, signal);
    return { ...r, blocks: r.blocks.map(b => toMsg(b)) };
  }

  /** The requests held for a person's `r` (`agents.held`): what the waiting-on-you list shows beside the terminals'. */
  async heldAsks(): Promise<HeldAsk[]> {
    return (await this.request("agents.held", {})).held;
  }

  /** Every matching id in service order, following blocks.query's continuation. */
  async queryIds(q: { expression?: string } & Pick<WireParams<"blocks.query">["query"], "text" | "subtreeRootId" | "sort" | "propertyScope" | "machinery" | "countMachinery">): Promise<{ ids: string[]; hint?: string; matches?: Map<string, PropertyMatch[]>; machineryLeftOut?: MachineryLeftOut }> {
    const { expression: where, ...narrow } = q;
    for (;;) {
      const start = (await this.changesSince(0, 1)).sequence;
      const ids: string[] = [], matches = new Map<string, PropertyMatch[]>();
      let hint: string | undefined, machineryLeftOut: MachineryLeftOut | undefined;
      for (let offset = 0; ;) {
        const r = await this.request("blocks.query", { query: { ...narrow, where, limit: 1000, offset }, fields: ["id"] });
        ids.push(...r.blocks.map(b => b.id));
        for (const b of r.blocks) if (b.propertyMatches?.length) matches.set(b.id, b.propertyMatches);
        hint ??= r.hint; machineryLeftOut ??= r.machineryLeftOut;
        if (r.nextOffset === undefined) break;
        offset = r.nextOffset;
      }
      // A delete or move shifts offsets, omitting an unchanged note the change feed cannot restore.
      if ((await this.changesSince(start, 1)).sequence === start)
        return { ids, hint, machineryLeftOut, ...(matches.size ? { matches } : {}) };
    }
  }

  /** Blocks as records (`blocks.records`, outline-core's block-record.ts), in the order asked, 200 a request (the service's most; each request is one backlink pass over the outline). */
  async records(ids: string[]): Promise<{ records: BlockRecord[]; unavailable: { id: string; status: "missing" | "trashed" }[] }> {
    const out: { records: BlockRecord[]; unavailable: { id: string; status: "missing" | "trashed" }[] } = { records: [], unavailable: [] };
    for (let i = 0; i < ids.length; i += 200) {
      const r = await this.request("blocks.records", { ids: ids.slice(i, i + 200) });
      out.records.push(...r.records);
      out.unavailable.push(...r.unavailable);
    }
    return out;
  }

  /** Yolo (PIE-973): this door hands the outline's agents the person's permissions in the service too (`on`), or takes them back (any door can). */
  async setAgentsYolo(on: boolean, actor: Actor = USER): Promise<boolean> {
    return (await this.request("agents.yolo", { clientId: this.clientId, on, ...(actor.kind === "agent" ? { mutation: mutationFor(actor) } : {}) })).yolo;
  }

  /**
   * What moving `blockId` into each view would patch, or why it can't (`views.planWrite`, PIE-490), at the
   * block's current revision.
   */
  async planMoves(viewIds: string[], blockId: string): Promise<{ revision: number; plans: Map<string, MovePlan> }> {
    const r = await this.request("views.planWrite", { viewIds, blockId });
    // With a block the service plans moves only: a create plan here would be its mistake, said as a refusal.
    const move = (plan: ViewMovePlan | ViewCreatePlan): MovePlan => (plan.kind === "create" ? { kind: "refused", reason: "the service planned a create for a move" } : plan);
    return { revision: r.revision ?? 0, plans: new Map(r.plans.map(p => [p.viewId, move(p.plan)])) };
  }

  /** What a new block in `viewId` is born with; with `text`, the text (or allocator input) it's saved as. */
  async planCreate(viewId: string, text = ""): Promise<CreatePlan> {
    const plan = (await this.request("views.planWrite", { viewIds: [viewId], text })).plans[0]!.plan;
    return plan.kind === "create" || plan.kind === "refused" ? plan : { kind: "refused", reason: "the service planned a move for a new note" };
  }

  /**
   * Which of `blockIds` the query `expression` holds for (`query.matches`, a thousand ids a request), narrowed by `text`
   * (every word) and `subtreeRootId` as `blocks.query` narrows.
   */
  async matchQuery(expression: string, blockIds: string[], narrow: { text?: string; subtreeRootId?: string; this?: string } = {}): Promise<Set<string>> {
    const asks = Array.from({ length: Math.ceil(blockIds.length / 1000) }, (_, i) => this.request("query.matches", { ...(expression ? { expression } : {}), ...narrow, blockIds: blockIds.slice(i * 1000, i * 1000 + 1000) }));
    return new Set((await Promise.all(asks)).flatMap(r => r.blockIds));
  }

  /** What changed after `sequence` (PIE-399), or an explicit reset. */
  changesSince(sequence: number, limit = 500): Promise<ChangePage> {
    // Everything, flagged: the door decides what to show (`machinery` on each change), and counts both.
    return this.request("changes.since", { sequence, limit, machinery: "show" });
  }

  /**
   * Blocks that point at this one, as the service sends them (PIE-442), with facets, read through
   * src/backlinks.ts as Detail reads them. The note itself stays, for the "this note" toggle.
   */
  async backlinks(id: string, limit = BACKLINK_QUERY_LIMIT, softMentions = false): Promise<BacklinkCollection> {
    return backlinkCollectionOf(await this.request("references.backlinks", { query: { targetBlockId: id, limit, ...(softMentions ? { softMentions } : {}) } }), id);
  }

  /**
   * The comments under a note that the margin can't show because they have no target (PIE-933), with why: the service's
   * own answer to opening each (`annotations.get`), never a guess here. `shown` is the ids `comments` returned.
   */
  async untargeted(noteId: string, shown: readonly string[]): Promise<Array<{ id: string; why: string }>> {
    const known = new Set(shown);
    const stray = (await this.children(noteId)).filter(child => prop(child, "type") === "annotation" && !known.has(child.id)).slice(0, 20);
    const found: Array<{ id: string; why: string }> = [];
    for (const { id } of stray) {
      try { await this.request("annotations.get", { annotationId: id }); } catch (error) { found.push({ id, why: error instanceof Error ? error.message : String(error) }); }
    }
    return found;
  }

  /** Comment threads anchored on a block (open ones first). */
  async comments(blockId: string, shown?: { revision?: number; stale?: () => void }): Promise<Comment[]> {
    // A Resource's threads are read through the service's reconcile (PIE-650): it reads the text now and re-anchors
    // each quote through the resolution events (or keeps it as it read, with no place, when it is gone).
    let placedIn: number | undefined;
    let threads: readonly AnnotationThread[];
    if (blockId.startsWith(RESOURCE_NOTE)) {
      const r = await this.request("annotations.reconcile", { input: { subject: { kind: "resource", resourceId: blockId.slice(RESOURCE_NOTE.length) } } });
      threads = r.threads; placedIn = r.revision;
    } else threads = await this.request("annotations.list", { query: { subject: { kind: "block", blockId }, includeResolved: true } });
    // Offsets mean the text they were placed in. The reader drew another (the file changed since): no places, and it reads again.
    const placed = shown?.revision === undefined || placedIn === undefined || shown.revision === placedIn;
    if (!placed) shown!.stale?.();
    const who = (r: AnnotationRecord) => r.block.actorId ?? r.source ?? r.block.author ?? "?";
    const text = (r: AnnotationRecord) => String(r.body ?? r.block.text ?? "").trim();
    const when = (r: AnnotationRecord) => Date.parse(r.block.createdAt) || 0;
    const offset = (v: unknown) => (typeof v === "number" ? v : null);
    const quoted = (r: AnnotationRecord) => (r.quotedIn?.length ? { quotedIn: [...r.quotedIn] } : {});
    // Its revision (an edit names it) and when it was edited after posting (PIE-763).
    const kept = (r: AnnotationRecord) => ({ revision: r.block.revision, ...(r.edited && Date.parse(r.edited) ? { edited: Date.parse(r.edited), ...(r.editedBy ? { editedBy: r.editedBy } : {}) } : {}) });
    return threads.map(t => {
      // resolvedTarget follows the quote through later edits; null means the service lost it. A comment on a Resource
      // that this note's link opened (its reference context) is placed on that link here, not at the file's offsets.
      const onResource = !blockId.startsWith(RESOURCE_NOTE) && t.originalTarget.representation.subject.kind === "resource";
      const at = onResource ? t.resolvedTarget?.referenceContext?.anchor : t.resolvedTarget?.anchor;
      const lifecycle: MarkLifecycle = isMarkLifecycle(t.lifecycle) ? t.lifecycle : "open";
      const replies = t.replies.map(r => ({ id: r.block.id, author: who(r), body: text(r), at: when(r), ...quoted(r), ...kept(r), ...(isTldr(r.properties) ? { tldr: true } : {}) }));
      const tldr = replies.filter((r: { tldr?: boolean }) => r.tldr).at(-1);
      return {
        id: t.block.id, author: who(t), body: text(t), at: when(t), open: markCurrent(lifecycle), lifecycle,
        ...(tldr ? { tldr: { id: tldr.id, author: tldr.author, body: tldr.body, at: tldr.at } } : {}),
        quote: String(t.originalTarget.anchor.kind === "text-quote" ? t.originalTarget.anchor.exact : "").replace(/\s+/g, " ").trim(),
        start: placed && at?.kind === "text-quote" ? offset(at.start) : null, end: placed && at?.kind === "text-quote" ? offset(at.end) : null,
        replies,
        props: t.properties ? Object.fromEntries(Object.entries(t.properties).map(([k, v]) => [k, v.map(String)])) : {},
        ...quoted(t), ...kept(t),
      };
    }).sort((a, b) => Number(b.open) - Number(a.open) || b.at - a.at);
  }

  /**
   * A block comment on an exact passage (`annotations.batch` / `block-comment`). The service refuses it
   * when the note is no longer at `expectedRevision` or the quote isn't where `start` says. `requestId`
   * must be the same on a retry of the same comment: the service then returns the saved one.
   */
  /** A comment on `passage` of a note, or (null) on the whole note (PIE-846). */
  async comment(requestId: string, blockId: string, expectedRevision: number, body: string, passage: CommentPassage | null, actor: Actor = USER, properties?: AnnotationProps): Promise<CommentReceipt> {
    const { source, ...who } = annotationAuthor(actor);
    const r = await this.request("annotations.batch", {
      requestId, ...who,
      operations: [{ operationId: "comment", type: "block-comment", input: { blockId, expectedRevision, body, source, ...(passage ? { passage } : {}), ...(properties ? { properties } : {}) } }],
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /**
   * A comment on a passage of a Resource's stored text (`annotations.batch` / `resource-comment`, PIE-650). The
   * service reads the text itself and refuses the comment when it isn't the text `expectedRevision` names. `at`
   * is where the Resource's text begins in the note the passage was picked in (null: it isn't drawn as it is, so
   * the quote goes without an offset). Nothing is written to the Resource.
   */
  async commentOnResource(requestId: string, resource: NonNullable<Msg["resource"]>, expectedRevision: number, body: string, passage: CommentPassage | null, actor: Actor = USER, properties?: AnnotationProps): Promise<CommentReceipt> {
    const { source, ...who } = annotationAuthor(actor);
    const start = resource.sourceAt === null || !passage ? undefined : passage.start - resource.sourceAt;
    const r = await this.request("annotations.batch", {
      requestId, ...who,
      operations: [{ operationId: "comment", type: "resource-comment", input: {
        resourceId: resource.id, expectedRevision, body, source,
        // None: on the whole of its text (PIE-846).
        ...(passage ? { passage: { quote: passage.quote, ...(start !== undefined && start >= 0 ? { start } : {}) } } : {}),
        ...(resource.from ? { referenceBlockId: resource.from } : {}),
        ...(properties ? { properties } : {}),
      } }],
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /** A reply on a comment thread, idempotent by `requestId` like `comment`. */
  async reply(requestId: string, annotationId: string, body: string, actor: Actor = USER): Promise<CommentReceipt> {
    const { source, ...who } = annotationAuthor(actor);
    const r = await this.request("annotations.reply", {
      requestId, ...who, input: { annotationId, body, source },
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /**
   * A posted comment's or reply's new words (`annotations.update`, PIE-763), if it is still at `expectedRevision`:
   * attributed to `actor`, marked edited, its earlier words kept in its block's revisions. The service refuses a stale
   * one ("revision is stale"), so an edit made meanwhile is never overwritten.
   */
  async updateComment(annotationId: string, expectedRevision: number, body: string, actor: Actor = USER): Promise<{ id: string; revision: number; body: string }> {
    const r = await this.request("annotations.update", { input: { annotationId, expectedRevision, body }, mutation: mutationFor(actor) });
    return { id: r.block.id, revision: r.block.revision, body: r.body };
  }

  /**
   * A thread read by the person (PIE-708): its comment and replies marked read, so they leave `unread:me` (Recent
   * replies' new ones). Bookkeeping: nothing in the thread changes, and repeating it is harmless.
   */
  /**
   * Materialize marks or elements (`quote`, PIE-1247): into a new block, each transcluded and linked back with
   * `[from::((…))]`, placed where `place` says (one write, one undo step: `undoExtension(undo)`), or into a note's text
   * after a line, as a reference or (`as: copy`) an element's own lines, through draft.patch. As `actor`.
   */
  quote(subjects: QuoteSubject[], place: QuotePlace, actor: Actor = USER, opts: { as?: "reference" | "copy"; text?: string } = {}): Promise<QuoteReceipt> {
    // A block the person makes is theirs with no actor id (recorded, made new), as a comment is.
    const mutation = recorded(actor, "new").block.author === "agent" ? mutationFor(actor) : { author: "user" as const };
    return this.request("quote", { input: { subjects, place, ...(opts.as ? { as: opts.as } : {}), ...(opts.text ? { text: opts.text } : {}) }, mutation });
  }

  /**
   * How present a thread is (PIE-791): seen puts it away, kept keeps it, open brings it back, resolved closes a ticket.
   * It sets a state rather than adding anything, so repeating it is harmless.
   */
  async setLifecycle(annotationId: string, lifecycle: MarkLifecycle, actor: Actor = USER): Promise<void> {
    await this.request("annotations.lifecycle", { input: { annotationId, lifecycle }, mutation: mutationFor(actor) });
  }

  /** Note `id` moved under `parentId` (null: the top level) at `position` among its children, first by default (`move`; PIE-883, PIE-943). */
  async move(id: string, parentId: string | null, actor: Actor = USER, position = 0): Promise<void> {
    const revision = (await this.get(id))?.revision;
    if (revision === undefined) throw blockNotFoundRefused(id);
    await this.request("move", { blockId: id, parentId, position, expectedRevision: revision, mutation: mutationFor(actor) });
  }
  /** The outline's Inbox: the root the service made it as (`[system-view::inbox]`), or null. */
  async inboxId(): Promise<string | null> {
    return (await this.roots()).find(r => propValues(r, "system-view").includes("inbox"))?.id ?? null;
  }

  /** Replace a block's whole text, if it is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async update(blockId: string, text: string, expectedRevision: number, actor: Actor = USER): Promise<Msg> {
    try {
      return toMsg(await this.request("update", { blockId, text, expectedRevision, mutation: mutationFor(actor) }));
    } catch (e) {
      const { conflict, now } = await this.conflictCheck(blockId, expectedRevision, e);
      // No answer, yet the note now holds exactly this text: the save landed before the answer was lost.
      if (conflict && now && !(e instanceof Refused) && now.text === text) return now;
      if (conflict) throw new EditConflict(blockId, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /**
   * After a failed write: is it a revision conflict? The refusal's kind says so (`stale-revision`), and a revision past
   * `expected` is one too (a write that failed for another reason while the note moved on). Returns the current block.
   */
  private async conflictCheck(blockId: string, expected: number, e: unknown): Promise<{ conflict: boolean; now: Msg | null }> {
    const now = await this.get(blockId);
    return { conflict: refusalKindOf(e) === "stale-revision" || (now?.revision !== undefined && now.revision !== expected), now };
  }


  /**
   * The block's own property tokens for `key`, as the service numbers them (`ordinal` is what
   * `properties.patch` replaces), at the revision the service read them. Asking the service keeps the
   * door from re-deriving the property parser: fences, code spans, hashtags and bare `key::` lines.
   */
  async propertyTokens(blockId: string, key: string): Promise<{ revision: number; tokens: PropertyToken[] }> {
    const r = await this.request("blocks.query", {
      query: { filters: [{ key }], subtreeRootId: blockId, propertyScope: "all", limit: 200 },
    });
    const own = r.blocks.find(b => b.id === blockId);
    if (own) return { revision: own.revision!, tokens: (own.propertyMatches ?? []).filter(t => t.key === key) };
    if (r.completeness?.kind !== "complete") throw new Error(`couldn't read ${key}:: on the card (its subtree is too large to scan)`);
    // The block has no such token, in any scope; its revision still has to be known.
    const b = await this.request("blocks.context", { blockId });
    if (!b.selected) throw new Error("the card is gone from the outline");
    return { revision: b.selected.revision!, tokens: [] };
  }

  /** Patch property tokens, if the block is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async patchProperties(blockId: string, expectedRevision: number, operations: PropertyPatch[], actor: Actor = USER): Promise<Msg> {
    try {
      return toMsg(await this.request("properties.patch", { blockId, expectedRevision, operations, mutation: mutationFor(actor) }));
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
      if (r.event.ask && r.event.blockId) this.drafts.get(r.event.blockId)?.progress?.(r.event.ask);
      if (r.event.domain === "draft") { void this.answerDraft(r.event.draft); return; }
      if (r.event.domain === "script" && r.event.script) { void this.answerScript(r.event.script); return; }
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
      if (!this.waiting.size && this.sock) { this.sock.end(); this.sock = null; this.watched.lost(); }
      if (subscribed || !sub.lost) { sub.lost = true; this.onConnection("lost", "outline connection lost · reconnecting"); }
      this.retryEvents(sub);
    });
    s.on("connect", () => s.write(jsonLine({
      id: "sub", action: "events.subscribe", client: { clientId: this.clientId, role: "observer", contextId: this.clientId, app: "door" },
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
    const who = recorded(actor, "new").block;
    return toMsg(await this.request("create", { parentId, text, ...who }));
  }

  /**
   * A new note where the service's placement rule puts it (PIE-544, `notes.create`): under `near` (the note the person
   * was in), else the top of the Inbox. The door never says where the Inbox is; the answer says where it went. Empty
   * `text` is a note opened to be written; `nearOnly`: a `near` the caller named, refused when it doesn't resolve
   * (the reader's own note falls back to the Inbox). Like `create`, never retried blindly.
   */
  async newNote(text: string, near: string | undefined, actor: Actor = USER, nearOnly = false): Promise<{ note: Msg; placement: NotePlacement }> {
    const who = recorded(actor, "new").block;
    const r = await this.request("notes.create", { text, intent: { kind: "note", ...(near ? { near, ...(nearOnly ? { nearOnly } : {}) } : {}) }, ...who });
    if (!("block" in r)) throw new Error("notes.create answered a dry run");
    return { note: toMsg(r.block), placement: r.placement };
  }

  /**
   * What a `[[page]]` address points at, made when nothing does (`pages.follow`): a page stub `X [page::X]` where new
   * notes go (the service's placement rule, today the top of the Inbox). Only on the person's explicit ask
   * (`page.create`); a follow never calls it.
   */
  async followPage(address: string, actor: Actor = USER): Promise<{ note: Msg | null; created: boolean; status: PageResolution["status"]; placement?: NotePlacement }> {
    const who = recorded(actor, "new").block;
    const r = await this.request("pages.follow", { address, ...who });
    return { note: r.block ? toMsg(r.block) : null, created: r.created, status: r.status, ...(r.placement ? { placement: r.placement } : {}) };
  }

  /** `properties.preview` with repeats kept, in order. */
  async previewPropertyList(text: string): Promise<{ key: string; value: string }[]> {
    return (await this.request("properties.preview", { text })).properties.map(p => ({ key: p.key, value: p.value }));
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
    return toMsg(await this.request("delete", {
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
      const ctx = await this.request("blocks.context", { blockId });
      return ctx.selected ? !!(ctx.selected.deletedAt || ctx.selected.effectiveDeletedRootId) : null;
    } catch { return null; }
  }

  /**
   * A roadmap item through the workboard's allocator (`roadmap.items.create`): the service issues its
   * work-id and puts it under the project's one active work queue. Like `create`, it has no request id,
   * so it is never retried.
   */
  async createRoadmapItem(input: RoadmapItemInput, actor: Actor = USER): Promise<{ workId: string; workQueueId: string; block: Msg }> {
    const who = recorded(actor, "new").block;
    const r = await this.request("roadmap.items.create", { input, ...who });
    return { workId: r.workId, workQueueId: r.workQueueId, block: toMsg(r.block) };
  }

  /** A new ask added under an open item instead (`roadmap.items.attach`): its words, dated, at the end of the item. */
  async attachToItem(input: { item: string; title: string; body?: string; sourceBlockId?: string }, actor: Actor = USER): Promise<{ attached: string; block: Msg }> {
    const who = recorded(actor, "new").block;
    const r = await this.request("roadmap.items.attach", { input, ...who });
    return { attached: r.attached, block: toMsg(r.block) };
  }

  /**
   * A search's row opened (the power bar, `[[`): the words, the row and its place, kept for the search eval's labels
   * (PIE-1197). Best-effort: an open never waits on it or fails for it.
   */
  searchPicked(query: string, blockId: string, rank: number, surface: string): void {
    if (query.trim().length < 3) return;
    this.request("search.picked", { query, blockId, rank, surface }).catch(() => undefined);
  }

  // ── reference completion (the lookups Tree, Detail and Quick Capture use) ────────────────────────

  /**
   * Named addresses (pages, aliases, Work IDs) matching `query`, by address or their note's title, ranked as
   * `searchBlocks` is; `semantic` and `near` as there.
   */
  completePages(query: string | undefined, limit: number, opts: SearchOptions = {}) {
    return this.request("pages.complete", {
      ...(query ? { query } : {}), limit, ...(opts.semantic ? { semantic: true } : {}), ...(opts.near ? { contextBlockId: opts.near } : {}),
    });
  }
  completionRows(input: CompletionRowsRequest, signal?: AbortSignal): Promise<CompletionRowsResult> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const turn = crypto.randomUUID();
    const cancel = () => { void this.request("completion.cancel", { turn }).catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    return this.request("completion.rows", { ...input, turn }, undefined, signal)
      .finally(() => signal?.removeEventListener("abort", cancel));
  }

  /**
   * A completion row was chosen: the host counts the pick, so it ranks higher next time on every client. With `told`
   * (PIE-1508) its source hears it too: accepted, edited or ignored (no `insert`, nothing counted).
   */
  completionPicked(key: string, insert: string | undefined, told: Omit<CompletionPickedRequest, "key" | "insert"> = {}): Promise<unknown> {
    return this.request("completion.picked", { key, ...(insert !== undefined ? { insert } : {}), ...told });
  }

  /** A block with its ancestors. */
  async blockContext(blockId: string): Promise<{ selected: Msg | null; ancestors: Msg[] }> {
    const r = await this.request("blocks.context", { blockId });
    return { selected: r.selected ? toMsg(r.selected) : null, ancestors: (r.ancestors ?? []).map(b => toMsg(b)) };
  }

  /** A note's revisions (PIE-621): the current one first, then the earlier texts the service keeps, newest first. */
  async revisions(blockId: string): Promise<BlockRevisions> {
    const r = await this.request("block.revisions", { blockId });
    if (!("revisions" in r)) throw new Error("block.revisions answered one revision for the list");
    return r;
  }

  /** One revision's whole text. */
  async revisionText(blockId: string, revision: number): Promise<BlockRevisionEntry & { text: string }> {
    const r = await this.request("block.revisions", { blockId, revision });
    if ("revisions" in r) throw new Error("block.revisions answered the list for one revision");
    return r;
  }

  /** Bring a Trash root (and its subtree) back where it was, with the page names it had to change (PIE-312). */
  async restore(blockId: string, actor: Actor = USER): Promise<Msg & { renamedPages?: PageRename[] }> {
    // Recorded as who brought it back (PIE-1655): an agent's restore isn't the person's.
    const restored = await this.request("trash.restore", { blockId, mutation: mutationFor(actor) });
    return { ...toMsg(restored), ...(restored.renamedPages?.length ? { renamedPages: restored.renamedPages } : {}) };
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
    const r = await this.request("checklist.update", {
      blockId, input: { target, expectedEvidence: step.evidence, change }, mutation: mutationFor(actor),
    });
    return { block: toMsg(r.block), item: r.item, changed: r.changed };
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
    const r = await this.request("transclusions.read", { targets, ...(hostBlockId ? { hostBlockId } : {}) });
    const blocks = new Map(Object.entries(r.blocks ?? {}).map(([id, b]) => [id, toMsg(b)]));
    const node = (n: Wire): TransclusionNode => {
      const stored = blocks.get(n.resolvedBlockId ?? n.blockId), lines = n.shownLines;
      const block = stored && n.outline ? { ...stored, address: { outline: n.outline, machine: n.machine } } : stored;
      const checklist = block && lines ? (r.checklists?.[n.resolvedBlockId ?? n.blockId] ?? [])
        .filter(s => s.span.startLine >= lines.start && s.span.startLine <= lines.end)
        .map(s => ({ ...s, text: block.text.slice(s.span.start, s.span.end).trimEnd() })) : undefined;
      // A missing fragment keeps its note too (the service sends it), for the anchors it does have (PIE-852).
      return { ...n, ...((n.status === "ready" || n.status === "fragment-missing") && block ? { block } : {}), ...(checklist ? { checklist } : {}), embeds: n.embeds?.map(node) };
    };
    return { limits: r.limits, dependencies: r.dependencies, results: r.results.map(node) };
  }

  // ── live drafts (PIE-501): held on the service, so draft.patch reaches them ─

  private drafts = new Map<string, { progress?: (ask: import("@ep0ch/outline-core/protocol").AskProgress) => void; blockId: string; revision: number; holdId: string | null; asking?: Promise<void>; answer: (r: DraftRequest) => DraftAnswer | Promise<DraftAnswer>; timer: Timer | null; touch: Timer | null; gone: boolean }>();
  /**
   * Releases on their way: a hold let go before the service granted it is released once the grant comes back, and until
   * then the service still counts the note held. An undo that a held note refuses (`extensions.undo`) waits for these: an
   * edit closed, then ctrl+z at once, was refused "open in a draft" when the grant took 250 ms under load.
   */
  private releasing = new Set<Promise<void>>();

  /**
   * Hold a live draft of `blockId` on the service: while it's held, an agent's `draft.patch` on that note comes
   * here (`answer`) instead of to the saved note, and a lease the door renews lets go of it if the door dies.
   * Null when this connection doesn't subscribe to events (the service's draft requests arrive there).
   */
  holdDraft(blockId: string, revision: number, answer: (r: DraftRequest) => DraftAnswer | Promise<DraftAnswer>, progress?: (ask: import("@ep0ch/outline-core/protocol").AskProgress) => void): DraftHoldHandle | null {
    if (!this.sub) return null;
    const old = this.drafts.get(blockId);
    if (old) this.letGo(old);
    const h = { blockId, revision, progress, holdId: null as string | null, answer, timer: null as Timer | null, touch: null as Timer | null, gone: false };
    this.drafts.set(blockId, h);
    // A draft can outlive the script that opened it; its lease belongs to the door.
    this.scriptRun.exit(() => {
      void this.holdOn(h);
      h.timer = setInterval(() => void this.renew(h), DRAFT_HEARTBEAT_MS);
      (h.timer as { unref?: () => void }).unref?.();
    });
    return {
      revise: revision => { h.revision = revision; this.scriptRun.exit(() => void this.renew(h)); },
      release: () => this.letGo(h),
      touched: () => {
        if (h.gone || h.touch) return;
        h.touch = this.scriptRun.exit(() => setTimeout(() => { h.touch = null; void this.touch(h); }, DRAFT_TOUCH_MS));
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
    catch (e) { if (refusalKindOf(e) === "not-found") { h.holdId = null; await this.holdOn(h); } }
  }

  private holdOn(h: { blockId: string; revision: number; holdId: string | null; asking?: Promise<void>; gone: boolean }): Promise<void> {
    let asking: Promise<void> | undefined;
    asking = (async () => {
      try {
        const r = await this.scriptRun.exit(() => this.request("drafts.hold", { blockId: h.blockId, clientId: this.clientId, revision: h.revision, leaseMs: DRAFT_LEASE_MS }));
        if (h.gone) { await this.request("drafts.release", { holdId: r.holdId }).catch(() => {}); return; }
        h.holdId = r.holdId;
      } catch { h.holdId = null; /* tried again at the next heartbeat */ }
      finally { if (h.asking === asking) h.asking = undefined; }
    })();
    h.asking = asking;
    return asking!;
  }

  private async renew(h: { blockId: string; revision: number; holdId: string | null; gone: boolean }) {
    if (h.gone) return;
    if (!h.holdId) return this.holdOn(h);
    try { await this.request("drafts.heartbeat", { holdId: h.holdId, revision: h.revision }); }
    catch { h.holdId = null; await this.holdOn(h); }
  }

  private letGo(h: { blockId: string; holdId: string | null; asking?: Promise<void>; timer: Timer | null; touch: Timer | null; gone: boolean }) {
    h.gone = true;
    if (h.timer) clearInterval(h.timer);
    if (h.touch) clearTimeout(h.touch);
    if (this.drafts.get(h.blockId) === h) this.drafts.delete(h.blockId);
    const release = h.holdId ? this.request("drafts.release", { holdId: h.holdId }).then(() => {}, () => {}) : h.asking;
    if (release) { const p = release.finally(() => this.releasing.delete(p)); this.releasing.add(p); }
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

  /**
   * "Apply anyway": a proposal's patch as an ordinary edit by `actor` (`draft.proposal.apply`). `warning`: the
   * edit landed, but something after it didn't (the proposal couldn't be marked applied).
   */
  async resolveProposal(proposalId: string, actor: Actor = USER): Promise<{ outcome: "resolved" | "open"; proposalId: string; message: string; undo?: string }> {
    return this.request("draft.proposal.resolve", { proposalId, mutation: requesterOf(actor) }, 120_000);
  }

  close(): void {
    for (const h of [...this.drafts.values()]) this.letGo(h);
    this.closing = true;
    this.watched.stop();
    if (this.sub?.retry) clearTimeout(this.sub.retry);
    this.sub = null;
    this.sock?.end(); this.events?.end(); this.sock = null; this.events = null;
  }
}
