// The wire contract between the outline service (packages/outliner) and its clients (the door, Tree, Detail,
// the CLI, the Claude mod). Both sides import this file; neither restates it. It does no I/O.
//
// PROTOCOL refuses a different wire contract (actions, fields and their meanings) or a difference in rules
// both sides must compute identically for writes: draft-patch-compare.ts and edit-merge.ts (draft.patch comparisons),
// link-syntax.ts anchors, code-fence.ts/code-ranges.ts literal ranges, property-parse.ts/property-grammar.ts
// token spans, and header-line.ts boundaries when a patch names those anchors or ranges. Bump PROTOCOL
// when those write-location computations change; parsing only for display bumps GRAMMAR instead.
// Section edits send heading/body to the host, which alone computes the section boundary. Component scanning
// that changes literal/property/anchor spans is still PROTOCOL-owned through code-ranges.ts; rich editing also
// uses component source bounds. Component presentation, figures, property display, heading display, styles,
// search and dates are GRAMMAR-owned. Never use a GRAMMAR-only parse to choose a write range.
// A newer host's grammar warns once and never refuses capture; the host's parsing owns saved content.
import type { CompletionTarget } from "./completion-triggers";
import type { PickRecord, SourceAnswer, SourceTrigger } from "./completion-source";
/** The wire protocol both sides of this checkout speak. */
export const PROTOCOL = 281;
/** Parse/draw rules, independent of whether a write can land correctly. */
export const GRAMMAR = 11;

/** A stale renderer can keep working; surface this once in the client's own message channel. */
export function grammarWarning(grammar: number): string | undefined {
  return grammar > GRAMMAR ? "drawn with older rules; run `ep0ch install --apply`" : undefined;
}

/**
 * The revision a comment on a Resource names (the `resource-comment` batch operation, PIE-650). A Resource's
 * stored text has no revision counter like a block's; its content hash is the revision, and this folds it to
 * the integer a Msg and a comment request carry (the first 48 bits, which a JS number holds exactly).
 */
export function resourceTextRevision(contentHash: string): number {
  const n = Number.parseInt(contentHash.slice(0, 12), 16);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/**
 * Why a service speaking `serviceProtocol` can't serve this client, in words that name both numbers and the side
 * to update; undefined when they agree. `client` is what this side is called ("this door", "this Detail").
 */
export function protocolMismatch(serviceProtocol: unknown, client = "this client"): string | undefined {
  if (serviceProtocol === PROTOCOL) return undefined;
  const theirs = typeof serviceProtocol === "number" ? `protocol ${serviceProtocol}` : "no protocol it reports";
  if (typeof serviceProtocol === "number" && serviceProtocol > PROTOCOL) {
    return `${client} speaks protocol ${PROTOCOL} and the outline host ${theirs}: update ${client.replace(/^this /, "the ")} (ep0ch install --apply) and restart it`;
  }
  return `${client} speaks protocol ${PROTOCOL} and the outline host ${theirs}: restart the outline host on current code (ep0ch install --apply updates and restarts it)`;
}

/** An outline's name: a short slug of lowercase letters, digits and hyphens. The name is how an outline is found. */
export const OUTLINE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export type BlockAuthor = "user" | "agent" | "system";

export interface BlockProperty {
  key: string;
  value: string;
}

export interface ScriptActionCall {
  requestId: string;
  targetClientId: string;
  action: string;
  args: Record<string, unknown>;
  actor: { author: "user" | "agent" | "system"; actorId?: string; sessionId?: string; taskId?: string };
  /** Who asked for the run (PIE-957): the person whose press started it, or the agent. The call's `actor` is the script. */
  requestedBy?: { author: "user" | "agent" | "system"; actorId?: string };
  /** The invitation the person's press minted for this run (a door's, src/surface/invite.ts): it lets the run move the person's tiles. */
  invitation?: string;
}

/** A script run ended (`scripts.ended` event, PIE-957): the door closes the layout transaction the run held by its end rule. */
export interface ScriptEnded {
  /** A sequence keeps completed effects on failure; its undo group is closed without rollback. */
  sequence?: true;
  run: string; reason: "done" | "stopped" | "failed";
  targetClientId?: string;
  requestedBy: { author: "user" | "agent" | "system"; actorId?: string };
  message: string;
  written: readonly string[];
  undo: boolean;
}

/** A block as the service sends it whole. Projected reads (`fields`) send a subset. */
export interface Block {
  id: string;
  parentId: string | null;
  position: number;
  text: string;
  revision: number;
  author: BlockAuthor;
  actorId?: string;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  effectiveDeletedRootId?: string;
  properties: BlockProperty[];
}

/**
 * A page name a restore had to change (PIE-312): while the note was in Trash another note took `[page::from]`, so the
 * restored note's declaration now reads `[page::to]`, the next free `from-2`, `from-3`…
 */
export interface PageRename {
  blockId: string;
  from: string;
  to: string;
}

/** `trash.restore`'s reply: the restored root, and the page names in its subtree that were taken meanwhile. */
export interface RestoredBlock extends Block {
  renamedPages?: PageRename[];
}

/** What a restore says in every client: the page names it had to change ("" when none). */
export function renamedPagesNote(renamed: readonly PageRename[] | undefined): string {
  return (renamed ?? []).map((rename) => `[[${rename.from}]] is another note's page now, so it is [[${rename.to}]]`).join("; ");
}

/** "Restored from Trash", and each page name the restore had to change. */
export function restoredStatus(restored: Pick<RestoredBlock, "renamedPages"> | undefined): string {
  const note = renamedPagesNote(restored?.renamedPages);
  return note ? `Restored from Trash; ${note}` : "Restored from Trash";
}

/**
 * One revision of a block's text (PIE-621, `block.revisions`): its number, when it was saved and by whom (when the
 * service recorded the edit), its size in characters and lines, and its first line.
 */
export interface BlockRevisionEntry {
  revision: number;
  savedAt: string;
  author?: BlockAuthor;
  actorId?: string;
  taskId?: string;
  chars: number;
  lines: number;
  firstLine: string;
}

/** A block's revisions, the current one first (`revision`), then the earlier texts the service keeps, newest first. */
export interface BlockRevisions {
  blockId: string;
  revision: number;
  revisions: BlockRevisionEntry[];
}

// ── Questions (ADR 0004 contract 1): the service evaluates, groups, sorts and counts; a client never does ──

/**
 * What `blocks.query` takes beyond its rows' narrowing (packages/outliner `BlockSearchQuery`): the question as every
 * client writes it (a `::links` attribute, a `::graph-*` key, a tile's saved args, `outline_query`).
 *
 * - `where`: the views' grammar (outline-core's atoms, the outliner's `block-query.ts`).
 * - `this`: the block `this` stands for in `where` (`links:this`). A `this` with none given is refused.
 * - `group`: a property name, or `created:day|week|month` / `updated:day|week|month`.
 * - `sort`: `"<property|created|updated|title>[ asc|desc]"`; `property:<name>` for a property so named. `work-stage`
 *   sorts in the workboard's stage order.
 * - `limit`: rows returned, 200 when left out, at most 1000. Groups and facets count every match.
 * - `facets`: value counts for every key the matches carry (`true`), or these keys; each value also says when a match carrying
 *   it was last updated (`last`).
 * - `facetKeys`: how many keys `facets: true` lists, QUESTION_FACET_CAP when left out, at most QUESTION_MAX_LIMIT.
 * - `facetValues`: how many values a facet lists per key, QUESTION_FACET_CAP when left out, at most QUESTION_MAX_LIMIT (a
 *   tags list wants them all).
 * - `watch` (beside `query` on the request): keep the question on this connection under that key (`QueriesChanged`).
 */
export interface QuestionFields {
  where?: string;
  this?: string;
  group?: string;
  sort?: string | { field: string; direction: "asc" | "desc" };
  limit?: number;
  facets?: true | string[];
  facetValues?: number;
  facetKeys?: number;
}

/** The most rows a question returns (a handler's input, a figure). */
export const QUESTION_MAX_LIMIT = 1000;
/** Rows a question returns when it names no limit. */
export const QUESTION_DEFAULT_LIMIT = 200;
/** The most keys a facet answer lists, and the most values per key; `more` says how many values were left out. */
export const QUESTION_FACET_CAP = 50;

/**
 * One group of an answer (`group=`): a value of the property (null: matches without it), how many matches have it
 * (every match, not only the rows returned), and the ids of the returned rows in it, in the rows' order. A row whose
 * property has several values is in each of their groups.
 */
export interface QuestionGroup { value: string | null; count: number; ids: string[] }

/** A key's value counts over every match (`facets=`): `count` matches carry the key; `more` values were left out. */
export interface QuestionFacet { key: string; count: number; values: { value: string; count: number; last: string }[]; more?: number }

/** What a question adds to `blocks.query`'s answer. `generation` is the watch's (0 when it registers). */
export interface QuestionAnswerFields {
  generation?: number;
  groups?: QuestionGroup[];
  facets?: QuestionFacet[];
  /** Said only when a key the question names is carried by no block in the outline: "no notes have <key>; nearest: …". */
  hint?: string;
}

/**
 * A watched read (ADR 0004): `blocks.query`, `views.read`, `blocks.authored-links`, `references.backlinks`,
 * `query.matches` and `site.answer` take
 * `watch: <key>` (kept on this connection; its answer is generation 0) and `generation` (answered from the newest
 * answer kept, never evaluated again). After changes the service evaluates every watch at most every 250 ms and at
 * least once a second under steady writes, and tells the connection which answers changed (a hash of the whole
 * answer) with a `queries.changed` event: `{ domain: "queries", action: "queries.changed", changes }`. A watch dropped
 * past the bounds (64 per connection, 512 per service, the oldest first) is announced with `dropped: true`; ask
 * again to register it. A connection's watches end with it.
 */
export interface QueryChange { key: string; generation: number; dropped?: true }
export const QUERIES_CHANGED = "queries.changed";
export const WATCH_LIMITS = { perConnection: 64, perService: 512, settleMs: 250, maxWaitMs: 1000 } as const;
/** The reads a client may watch. */
export const WATCHABLE_ACTIONS = ["blocks.query", "views.read", "blocks.authored-links", "references.backlinks", "query.matches", "site.answer", "template.use"] as const;

// The Site read (PIE-533): what a `{{ }}`, a figure, a script or a template reads of the note it sits in. Defined beside the
// Site (site.ts), named here with the rest of the wire.
export type { FieldRow, SiteAnswer, SiteAnswerRequest, SiteLink, SiteProblem, SiteProduced, SiteProducer, SiteValue } from "./site";

/** A query the service refused, with where. */
export interface OutlinerRequestProblem {
  /**
   * `still-counting` (PIE-1047): the answer ran past the service's time budget for one request, so it stopped and went on
   * to other requests; a reader draws "still counting" where the answer goes and asks again in a moment.
   */
  code: "query-syntax" | "query-invalid" | "still-counting";
  message: string;
  /** Query field that failed, such as where. */
  field?: string;
  /** 0-based character position within that field's text. */
  position?: number;
}

/**
 * What a fragment anchor names (`fragments.read`, `fragments.candidates`): a heading's section, a paragraph, a list
 * item, (PIE-580) a component block such as a figure, named by an anchor alone on the line after its `::`, or (PIE-592)
 * a whole blockquote or callout, named by an anchor at the end of its last line.
 */
export type FragmentKind = "heading" | "paragraph" | "list-item" | "component" | "quote" | "callout";

/**
 * The part of a note that holds a line (`fragments.at`, PIE-780): the one `element.detach` and `element.quote` take there
 * (the innermost figure, callout, quote, list item, paragraph or heading's section), read without writing its anchor.
 * `lineIndex` is where its anchor is or would go; `startLine` and `endLine` the note lines it covers (from 0, inclusive).
 * `part` is null on a line no part holds (a blank, the title), unless `next` asks for the first part after it.
 */
export interface PartAt {
  blockId: string; revision: number;
  part: { kind: FragmentKind; label: string; lineIndex: number; startLine: number; endLine: number; fragmentId?: string } | null;
}

/** One answer line on the socket. */
export type OutlinerResponse =
  | { id: string; ok: true; result: unknown; sequence: number }
  | { id: string; ok: false; error: string; problem?: OutlinerRequestProblem; sequence: number };

// ── The outline host: `ping` and `outlines.*` (packages/outliner src/outline-host.ts) ──

/** How the service names its outline in `ping`. */
export interface OutlinerServiceOutline {
  name: string;
}

/** The outline host behind a socket: one per user and machine, serving outlines by name. */
export interface OutlinerHostStatus {
  socket: string;
  /** Where requests without `outline` go; absent when the host has none (it is for tests and scripts). */
  defaultOutline?: string;
  /** Every outline in the outlines folder, open or not. */
  outlines: string[];
}

/** What `ping` answers. */
export interface OutlinerServiceStatus {
  status: "ready";
  /** The service's PROTOCOL; a client refuses any other number (`protocolMismatch`). */
  protocolVersion: number;
  /** Parse/draw rules; a mismatch never refuses a request. */
  grammarVersion: number;
  /** Opaque identity of this outline file instance; changes when an outline is restored, reset, imported or recreated. */
  outlineInstanceId?: string;
  /** `machine`: the machine's name in `ep0ch://` URIs (the name its person gave it, else its host name's). */
  location?: { hostname: string; machine?: string; workspaceRoot: string; database: string; stateDirectory: string };
  /** The outline answering. */
  outline?: OutlinerServiceOutline;
  /** The host that routed the request. */
  host?: OutlinerHostStatus;
}

/** One outline a host serves (`outlines.list`, `outlines.create`, `outlines.import`, `outlines.attach`). */
export interface HostedOutlineSummary {
  name: string;
  /** `<outlines>/<name>.sqlite`. */
  database: string;
  /** `<outlines>/<name>/`: its side files, and the root its relative file links resolve against. */
  folder: string;
  /** Open in this host process now. Outlines open on their first request. */
  open: boolean;
  /** The host's default outline (tests and scripts). */
  default?: boolean;
  /** Who made it and why, when an agent made it over MCP (`outline_new`). */
  about?: OutlineAbout;
}

/**
 * What a scratch outline says of itself (PIE-679): kept in the outline's own metadata, and as the properties of its root
 * note. `principal` is who auth proved (`claude-code@float-2`, `claude.ai`): the one with `full` on it; `createdBy` is that
 * with the persona it declared (`loki/claude-code@float-2`).
 */
export interface OutlineAbout {
  createdBy: string;
  principal: string;
  persona?: string;
  /** ISO time. */
  created: string;
  purpose: string;
  kind: "scratch";
}

/** An archived outline (`.archive/<name>/`): hidden from lists, its database kept. */
export interface HostedArchivedOutline { name: string; about?: OutlineAbout }

/** `outlines.list`. */
export interface HostedOutlineList {
  defaultOutline?: string;
  outlines: HostedOutlineSummary[];
  /** Outlines put away with `outlines.archive`; absent when there are none. */
  archived?: HostedArchivedOutline[];
}

/** `outlines.archive` and `outlines.unarchive`: where the outline's files went (nothing is erased). */
export interface HostedOutlineArchival {
  name: string;
  archived: boolean;
  movedTo: string;
}

/** `outlines.attach`: the outline, open, and whether this request created it. */
export interface HostedOutlineAttachment {
  outline: HostedOutlineSummary;
  created: boolean;
}

/** `outlines.delete`: where the outline's files went (nothing is erased). */
export interface HostedOutlineDeletion {
  name: string;
  movedTo: string;
}

/**
 * Where the service's placement rule put a new note or page (PIE-544, `notes.create`, `pages.follow`): its parent, the
 * first child (`top`) or the last (`end`), which rule placed it, and the words a client says it with.
 */
export interface NotePlacement {
  parentId: string; at: "top" | "end";
  /** `route`: a routing rule note placed it (PIE-1010); `routeRule` names which. */
  rule: "near" | "inbox" | "route"; said: string;
  routeRule?: { id: string; title: string };
}

/**
 * What routing did, or would do, with one note (PIE-1010, `notes.route`): the first rule note (`[type::route]`) whose
 * query holds for it, and where that rule sends it. `held`: a door holds a draft of the note, so it routes when the
 * draft closes; `refused`: the move itself was refused (the words say why).
 */
export interface NoteRouteResult {
  blockId: string;
  title: string;
  outcome: "moved" | "would-move" | "unchanged" | "no-rule" | "held" | "refused";
  rule?: { id: string; title: string; query: string };
  from: { id: string | null; title: string };
  to?: { id: string; title: string };
  /** After a move: where it was and where it is, for a client's undo. */
  previousPosition?: number;
  position?: number;
  revision?: number;
  said: string;
}

/**
 * A `notes.route` run: each note a rule holds for (with `all`, notes no rule holds for are only counted, `unmatched`),
 * the rule notes that can't be used (and why), and how many rules there are.
 */
export interface NoteRouteRun {
  dryRun: boolean;
  results: NoteRouteResult[];
  problems: string[];
  rules: number;
  unmatched: number;
}

/**
 * An outline's own MCP access setting (ADR 0002 §4, PIE-562): kept by the service in the outline's metadata, `none` by
 * default, set with `ep0ch mcp access`. One list for the service's check, the door's flags and the wire.
 */
export const MCP_ACCESS_LEVELS = ["none", "read", "propose", "full"] as const;
export type McpAccessLevel = typeof MCP_ACCESS_LEVELS[number];
/**
 * A request an agent or an extension wrote that waits for a person's `r` (PIE-888, `agents.held`): the note it is in
 * (and the line, from 0, -1 when it is only in a draft), the agent that would answer, and why it waits.
 */
export interface HeldAsk {
  blockId: string; line: number; title: string; agent: string; extensionId: string;
  request: string; why: string; by: string; at: string;
}
/** `mcp.access.status` and `mcp.access.configure`'s answer. */
export interface McpAccessStatus {
  level: McpAccessLevel;
  canRead: boolean;
  sequence: number;
  /** The principal that made this outline over MCP (PIE-679): it writes with `full`, whatever `level` lets the others. */
  owner?: string;
  /**
   * Asked by an extension (PIE-779): what this outline lets it do. `full` on its own outline and on an outline of this
   * host whose owner never set a level; `level` otherwise, and always for another machine's extension (unset: `none`).
   */
  granted?: McpAccessLevel;
  /**
   * Yolo is on (PIE-973): the person's door lifted the agent gate, so `level` is `full` and `canRead` true whatever the
   * owner set. `configured` is that setting. Absent otherwise.
   */
  yolo?: true;
  configured?: McpAccessLevel;
}

/**
 * A share session: a short-lived public link to a note and what's under it, or to the whole outline, opened by
 * anyone who has it until it expires or is revoked (`shares.start`, `ep0ch share`, the MCP's share tools). The
 * publisher's public listener serves it at `url`; inside it every page stays below that URL and inside its scope.
 */
export interface OutlineSnapshot {
  url?: string;
  expiresAt?: string;
  bytes: number;
  sha256: string;
  schema: number;
  asOf: string;
  curl?: string;
  shareId?: string;
  path?: string;
}

export interface ShareSession {
  /** A single-use database download, never a browsable page share. */
  snapshot?: Omit<OutlineSnapshot, "url" | "curl" | "path" | "shareId" | "expiresAt"> & { recordId: string; base: string; removed?: boolean };
  /** A short id to name it by (`ep0ch share revoke <id>`): not the secret, which is only in `url`. */
  id: string;
  /**
   * What it shows: the whole outline (the default, navigated as the tailnet's web client is), or only one note and
   * what's under it. A `[publish::never]` note is never shown either way. An `artifact` share (PIE-1266) shows one
   * artifact on its own, full-bleed: the same link, revoke and list as a page's.
   */
  scope: { kind: "note"; blockId: string; title: string } | { kind: "outline" } | { kind: "artifact"; name: string; title: string };
  /** The note the link opens on (`url` ends `/p/<id>`), when it was started from or for one. */
  opens?: { blockId: string; title: string };
  /** Whether a reader may highlight, comment, ask and reply (attributed to the person, via this share). */
  comments: boolean;
  /**
   * How the link reaches the publisher (SHARE_VIAS): `edge`, the public listener's own stable host (`pie.ep0ch.sh`);
   * `cloudflare`, a Cloudflare Quick Tunnel of its own on a random trycloudflare.com host, run by the publisher for as
   * long as the share is open, email-gated when `allowMail` names who may sign in.
   */
  via: ShareVia;
  /** `cloudflare` only: the emails (or `@domain` wildcards) Cloudflare lets in by one-time PIN; none, the tunnel is public. */
  allowMail?: string[];
  /** `cloudflare` only: its tunnel, as the publisher running it reported (`starting` until its host is known). */
  tunnel?: { state: "starting" | "up" | "failed"; host?: string; pid?: number; error?: string };
  createdAt: string;
  expiresAt: string;
  /** `active` until it expires or is revoked; an ended one answers 410 and is forgotten after a week. */
  state: "active" | "expired" | "revoked";
  revokedAt?: string;
  /** Who started it: `you`, or the agent's actor id. */
  by: string;
  /** The link, when a public listener has said where it is opened (`publish serve --public-url`). Holds the secret. */
  url?: string;
}

/** The ways a share's link reaches the publisher (ShareSession.via); the first is the default. */
export const SHARE_VIAS = ["edge", "cloudflare"] as const;
export type ShareVia = typeof SHARE_VIAS[number];

/**
 * The life of a share session. `defaultMs`, `maxMs` and `minMs` bound a snapshot's download and a lease (an hour by default,
 * a minute to a day); a share of a page, the outline or an artifact lasts until revoked unless a time is given (`neverMs`,
 * PIE-1266), any length from `minMs`.
 */
export const SHARE_TTL = { defaultMs: 60 * 60_000, maxMs: 24 * 60 * 60_000, minMs: 60_000, neverMs: 100 * 365 * 24 * 60 * 60_000 } as const;

/**
 * A signed-in web session (the publisher's sign-in listener, `my.ep0ch.sh`): one browser that signed in through Clerk as
 * a person allowed in, kept by the outline host for every outline it serves (`web.sessions.*`, host actions). The
 * secret is the browser's cookie; the host keeps only its digest. It lasts WEB_SESSION_TTL_MS from its last use.
 */
export interface WebSession {
  /** A short id to name it by (`ep0ch web revoke <id>`): not the secret. */
  id: string;
  /** Who signed in: the Clerk user id, and their name or login when Clerk gave one. */
  subject: string;
  name?: string;
  /** The browser, as its User-Agent said at sign-in (cut short). */
  device: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** A web session lives this long from its last use (renewed on use). */
export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * What a reader of the web client has in front of them now (`reader.view`): the page, and the words selected on it
 * with the drawn text either side. Reported by the page itself as presence (a debounced post), kept in memory only.
 */
export interface ReaderView {
  /** Who: `tailnet` (the person on the tailnet web client), or `share:<id>` for a share session's page. */
  reader: string;
  /** The page's note (the outline's top level has none). */
  blockId?: string;
  title: string;
  url: string;
  /**
   * The words selected, at most 2,000 characters, with the text around them and the note row they're in; `offsets`
   * are where they are in that row's source (UTF-16, end exclusive) at its `revision`, when the page found them there.
   */
  selection?: {
    text: string; before: string; after: string; blockId?: string;
    offsets?: { start: number; end: number }; revision?: number; truncated?: boolean;
  };
  /** The blocks on screen, in page order (at most READER_VISIBLE_MAX). */
  visible?: string[];
  /** How far down the page is: pixels from the top, of at most `max`. */
  scroll?: { y: number; max: number };
  /** When the page last said so. */
  at: string;
}

/** At most this many blocks are said to be on screen. */
export const READER_VISIBLE_MAX = 200;

/**
 * One thing a reader did, kept in order (`reader.view`'s journal, `ep0ch.journal(since)` on the page): opened a page,
 * selected words, or opened or closed a fold. `n` goes up by one each time, across readers.
 */
export interface ReaderEvent {
  n: number;
  at: string;
  reader: string;
  kind: "page" | "selection" | "fold";
  blockId?: string;
  /** A page's title and address. */
  title?: string;
  url?: string;
  /** A selection's words (at most 2,000 characters). */
  text?: string;
  /** A fold, opened or closed. */
  open?: boolean;
}

/**
 * An extension's command-palette source (PIE-656), as `extensions.list` lists it (`barSources`, and each extension's
 * own under `bar`): the door's power bar asks it with `extensions.bar` as the person types.
 */
export interface ExtensionBarSource {
  readonly id: string;
  readonly extension: string;
  /** `ext.<extension>.<id>`: unique across extensions. */
  readonly name: string;
  readonly title: string;
  /** The character that scopes the bar to it when typed first. */
  readonly prefix?: string;
  readonly description?: string;
  /** Its rows join the bar's main list, not only its own scope. */
  readonly main: boolean;
}

/**
 * One row a bar source answers: its words, a Markdown preview the client draws with its own renderer, and what picking
 * it does: open `block`, run the extension's `action` (with `args`), or put `copy` on the clipboard. `id` is unique in
 * an answer.
 */
export interface ExtensionBarRow {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly preview?: string;
  readonly block?: string;
  /** A Resource to open when picked (PIE-754): `file:/path`, `web:https://…` or `resource:<id>` (outline-core resource-ref.ts). */
  readonly resource?: string;
  readonly action?: string;
  readonly args?: Readonly<Record<string, string>>;
  readonly copy?: string;
}

/** `extensions.bar`'s answer. */
export interface ExtensionBarResult {
  readonly extension: string;
  readonly source: string;
  readonly rows: readonly ExtensionBarRow[];
}

/**
 * An extension's completion source (PIE-1340, ADR 0004 §4), as `extensions.list` lists it (`completionSources`): rows
 * it answers under one of the existing triggers (`[[`, `key::`…; never a sigil of its own), asked with
 * `completion.rows` alongside the built-ins, through the extension's `source` operation.
 */
export interface ExtensionCompletionSource {
  readonly id: string;
  readonly extension: string;
  /** `ext.<extension>.<id>`: unique across extensions. */
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly triggers: readonly SourceTrigger[];
  /** For `key::`: only these property keys. */
  readonly keys?: readonly string[];
}

/**
 * One setting an extension's `configSchema` declares (PIE-1343), as `extensions.list`'s `settings` says it: what it is,
 * what `config.json` has, and what the extension does when it's left out (the schema's `default`).
 */
export interface ExtensionSettingField {
  readonly name: string;
  /** The schema's type: string, number, integer, boolean, command (an array of strings: a command's words), or json (anything else). */
  readonly type: "string" | "number" | "integer" | "boolean" | "command" | "json";
  readonly description?: string;
  readonly required?: boolean;
  /** The schema's `enum`. */
  readonly choices?: readonly (string | number | boolean)[];
  /** The schema's `default`: what the extension uses when it's left out. */
  readonly default?: unknown;
  /** What config.json has; absent when it has none. */
  readonly value?: unknown;
  /** set (config.json has it), default (left out, the schema's default applies), unset (left out, no default), missing (required and left out). */
  readonly state: "set" | "default" | "unset" | "missing";
}

/** A secret an extension declares (PIE-1343): where its value comes from (a reference, never the value). */
export interface ExtensionSettingSecret {
  readonly name: string;
  readonly description?: string;
  /** Where config.json (or the manifest's group) points it, in words: `env TOKEN`, `file ~/.config/x/token`, `group readwise READWISE_TOKEN`. */
  readonly reference?: string;
  /** set: the reference finds a value on the host; missing: no reference, or nothing where it points. */
  readonly state: "set" | "missing";
}

/**
 * An extension's settings (PIE-1343), from its manifest's `configSchema` and `secrets`, on `extensions.list`'s entry:
 * the file they live in on the host, each field and secret, and the state a row shows. Only an extension that declares
 * a configSchema or secrets has one. `extensions.configure` writes them.
 */
export interface ExtensionSettings {
  /** config.json's path on the machine that hosts the outline. */
  readonly file: string;
  readonly exists: boolean;
  /** failing (its last call failed since config.json changed, or config.json doesn't load), missing (a required field or a secret), set, or default (nothing set). */
  readonly state: "set" | "default" | "missing" | "failing";
  readonly fields: readonly ExtensionSettingField[];
  readonly secrets: readonly ExtensionSettingSecret[];
  /** The schema isn't an object of named fields: its config is edited whole, as JSON. */
  readonly whole?: true;
  /** config.json's `config` as it is: a client changes what it names and sends the rest back unchanged. */
  readonly config: Readonly<Record<string, unknown>>;
  /** Why it's failing: config.json's problem, or the last call's error. */
  readonly error?: string;
}

/** A secret reference `extensions.configure` writes into config.json: where the value is, never the value. */
export type ExtensionSecretReference =
  | { env: string }
  | { file: string }
  | { group: string; key: string }
  | { keychainService: string; account?: string };

/**
 * `extensions.configure` (PIE-1343): `set` and `unset` change the named fields of config.json's `config` as it is on
 * disk (or `config` replaces it whole), checked against the manifest's configSchema first; each of `secrets` sets that
 * secret's reference (null takes it out); the file's `enabled` and `sources` stay. Written on the machine that hosts the outline; the registry reloads before it answers.
 */
export interface ExtensionsConfigureRequest {
  extension: string;
  /** The whole of config.json's `config`, replacing it (a schema that isn't an object of named fields). */
  config?: Record<string, unknown>;
  /** These fields set, merged into what config.json has now (the rest stay). */
  set?: Record<string, unknown>;
  /** These fields taken out (back to their defaults). */
  unset?: string[];
  secrets?: Record<string, ExtensionSecretReference | null>;
}

/** `extensions.configure`'s answer: the settings as they are now, and the extension's state after the reload. */
export interface ExtensionsConfigured {
  readonly id: string;
  readonly settings: ExtensionSettings;
  readonly state?: string;
  readonly error?: string;
}

/**
 * `completion.rows` (PIE-1340): every service-side source for the token at the cursor (pages, blocks and their
 * fragments, files, agents, and the extensions' completion sources), each answering on the one row contract
 * (outline-core completion-source.ts), with the picks remembered for the trigger. The client merges these with its
 * own sources' answers (`mergeSourceAnswers`): the door and Detail merge the same way, so they show the same rows.
 */
export interface CompletionRowsRequest {
  /**
   * The token at the cursor as outline-core's detector found it, without where it sits on the line: `headingShort` (the
   * `# Title [hea…` shorthand, written as a whole `[heading::…` token), a component's `attrs` (the props already written:
   * which one names a template's props, which are used), an attribute's `quote` and `existingValue`, a filter's `words`.
   */
  target: Omit<CompletionTarget, "start" | "end">;
  /** The note the draft writes in, or is about: nearer notes first, and its own text for `((#heading`. */
  near?: string;
  draft?: { blockId: string; text: string };
  limit?: number;
  offset?: number;
  /** Ask Jev to re-order the notes' and pages' candidates. */
  semantic?: boolean;
}

/** One source's answer to `completion.rows`, with what its list says when it's empty or cut. */
export interface CompletionSourceAnswer extends SourceAnswer {
  /** The source cut its list at this many. */
  truncated?: number | null;
  /** What to say when it found nothing; `partial` when it found some and says so. */
  empty?: string;
  partial?: string;
  /** What the list is, when not the trigger's own word (`in Greenhouse meeting`). */
  heading?: string;
  jev?: "ranked";
  jevOff?: boolean;
  /** How sure a ranked list is (PIE-1198): said under it when it isn't a strong match. */
  sure?: SearchCertainty;
}

/**
 * How sure a ranked search is (PIE-1198), decided by the service over Jev's answers (search-ranking.ts `certaintyOf`)
 * and only said by clients: `strong` when the top note answers it, `weak` when the closest is named but not claimed,
 * `none` when nothing here does. `said` is the sentence; `exists` Jev's "is it among these?" (0–1), `top` its best Score (0–3).
 */
export interface SearchCertainty { verdict: "strong" | "weak" | "none"; said: string; exists?: number; top?: number; /** The short form a footer or a row draws: `sure` or `no strong match`. */ label?: string }

/**
 * `search.picked`: the person opened a search's row (the power bar, `[[`, Tree's goto). Kept with the query and the row's
 * place, so the search eval can label a query with what was wanted (scripts/evals/search.ts reads them).
 */
export interface SearchPickedRequest { query: string; blockId: string; rank: number; surface: string }

export interface CompletionRowsResult {
  answers: CompletionSourceAnswer[];
  /** This trigger's picks (`pickKey`): how often and how lately each insert was chosen, on any client. */
  picks: Record<string, PickRecord>;
}

/** `completion.picked`: a row was chosen. `key` is `pickKey`'s, `insert` the text it wrote. */
export interface CompletionPickedRequest { key: string; insert: string }

/** Progress for an ask in a held draft; the line stays authored text. */
export interface AskProgress { line: string; state: string; blocks?: number; beside?: boolean; warning?: string }

/** Current non-deleted blocks, measured in Unicode characters; p90 uses nearest rank. */
export interface BlockSizeSummary { blocks: number; characters: number; median: number; p90: number }
export interface BlockSizeCensus {
  outline: BlockSizeSummary;
  actors: (BlockSizeSummary & { key: string })[];
  branches: (BlockSizeSummary & { key: string })[];
}

/** A structural move resolves its destination under the same transaction as its revision check. Positions are zero-based. */
export interface NoteMoveIntent {
  to?: string;
  parentId?: string | null;
  before?: string;
  after?: string;
  step?: "up" | "down" | "in" | "out";
  position?: number;
}
export interface NoteMoveReceipt {
  outcome: "applied" | "unchanged";
  previousParentId: string | null;
  previousPosition: number;
  said: string;
}

/** A host-owned read-only Loki URL; restarting the host ends it. */
export interface LokiLease { id: string; url: string; expiresAt: string }
export interface LokiLeaseUse { status: number; id?: string }

/**
 * A one-time upload link into the artifacts inbox (PIE-1267): one name (or none: the file then names itself), one upload, one hour. `url` ends in `/` so
 * `curl -T <file> <url>` appends the file's name; it holds the secret, so it's shown in a code block and never logged.
 */
export interface UploadLease { id: string; name?: string; outline: string; url: string; expiresAt: string; curl: string }
/** A device that may upload (`ep0ch device add`): its token is shown once, when it's made. */
export interface UploadDevice { id: string; name: string; outline: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }
/** What the host says of a request to the upload route: who it may be, or why not. A write comes with the `claim` to settle. */
export type UploadTake =
  | { status: 200; claim?: string; who: { kind: "lease" | "device"; id: string; name?: string; outline: string; by: string; deviceName?: string }; expiresAt?: string }
  | { status: 404 | 409 | 410; reason: string };

/** Which chips a question reads (PIE-1277): the note's own header (`block`), bare `key:: value` lines, `[key::value]` in the text, or all of them. */
export const PROPERTY_QUERY_SCOPES = ["block", "line", "inline", "all"] as const;

/**
 * A chip a question matched a note on (`blocks.query` and `views.read` rows' `propertyMatches`, when the question's
 * scope reaches past the header): where it is in the note's text (`line` from 0), as written (`raw`), and on a
 * checklist step the step's status (`task`). A chip on a ticked step is settled and never matches.
 */
export interface PropertyMatch {
  key: string; value: string; ordinal: number; start: number; end: number; line: number; column: number;
  scope: "block" | "line" | "inline"; raw?: string; task?: import("./checklist-marks").ChecklistStatus;
}

/** A match as a tool or the CLI gives it to a person or an agent: `line` counts from 1, `task` only on a step. */
export const matchFacts = (m: PropertyMatch) => ({ key: m.key, value: m.value, line: m.line + 1, scope: m.scope, ...(m.task ? { task: m.task } : {}) });

/** An outline ask in the waiting-on-you list; call positions are zero-based source lines and offsets. */
export interface WaitingAsk {
  properties: BlockProperty[];
  kind: "decision" | "proposal" | "call";
  block: string;
  title: string;
  reason: string;
  by: string;
  revision: number;
  line?: number;
  at?: number;
  label?: string;
}

/**
 * `quote` (PIE-1247): materialize marks or elements of a note. A subject is a mark, or an element of a note by its
 * anchor, or by a line of it (from 0) at the note's revision (its anchor written for the quote; `next`: the first part
 * at or after that line).
 */
export type QuoteSubject = { kind: "mark"; id: string } | { kind: "element"; blockId: string; anchor?: string; line?: number; revision?: number; next?: true };
/**
 * Where it goes: a new block (the top of the Inbox, under the first subject's note, under a block, under `.detached`),
 * or into a note's text after line `line` (from 0), `observed` being that line as the dropper saw it.
 */
export type QuotePlace = { kind: "inbox" } | { kind: "note" } | { kind: "under"; blockId: string } | { kind: "detached" } | { kind: "into"; blockId: string; line: number; observed?: string };
/** reference (each transcluded) or copy (an element's own lines). */
export type QuoteAs = "reference" | "copy";
/** `quote`'s input as sent: `place` defaults to the Inbox, `as` to reference. */
export interface QuoteRequest { subjects: QuoteSubject[]; place?: QuotePlace; as?: QuoteAs; text?: string }
/** A subject as the service read it: `ref` links to it (`note^anchor`); `copy` is what `as: copy` writes; `anchored` when its anchor was just written. */
export interface QuotedSubject { ref: string; label: string; kind?: FragmentKind; copy?: string; anchored?: true }
/**
 * What `quote` did: the block it made, where it went and the undo step that takes it back; or, into a note, the
 * draft.patch it sent there (applied, or proposed beside the note).
 */
export type QuoteReceipt<B = { id: string; text: string }, P = { parentId: string | null; said: string }> =
  | { block: B; placement: P; marks: string[]; subjects: QuotedSubject[]; undo?: string }
  | { into: { blockId: string; outcome: "applied" | "proposed"; revision?: number; reason?: string }; subjects: QuotedSubject[]; said: string };

/**
 * One open item a new one looks like (`roadmap.items.similar`, the outliner's work-twins.ts): how the search matcher
 * found it, Jev's Nouls when it answered, code's verdict, and `said`, the line every client shows for it.
 */
export interface TwinCandidate {
  id: string;
  workId: string;
  title: string;
  stage: string;
  /** The search matcher's kind, and the share of the new title's words in its title. */
  match: string;
  inTitle: number;
  /** Jev's: the same work, and one more step of it. */
  same?: number;
  part?: number;
  /**
   * `same` (a twin), `unsure` (Jev between yes and no on the same work: offered as a twin, its writer decides; PIE-1402),
   * `part` (attach to it), `text` (a strong title match Jev didn't say no to), or `related`.
   */
  verdict: "same" | "unsure" | "part" | "text" | "related";
  /** `PIE-12 (doing) Title · same work, Jev 0.86`: the service's words for it. */
  said: string;
}

/** `roadmap.items.similar`'s answer: the candidates, the Work IDs an agent's create is refused over, and whether Jev read them. */
export interface TwinAnswer { candidates: TwinCandidate[]; twins: string[]; jev: string; tokens?: number }
