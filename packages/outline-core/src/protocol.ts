// The wire contract between the outline service (packages/outliner) and its clients (the door, Tree, Detail,
// the CLI, the Claude mod). Both sides import this file; neither restates it. It does no I/O.
//
// PROTOCOL is the one compatibility check: `ping` reports the service's number and a client refuses a service
// whose number differs from its own. Bump it with any change to the wire (an action, a field, a meaning) and
// with any change to what outline-core's shared modules match or compute (the property grammar, the code fence
// and literal ranges, the link grammar, the heading styles, the style cascade, the component schemas, the draft.patch compare, the search matcher, the query atoms), since a long-running service
// and a remote door can run different checkouts.
/** The wire protocol both sides of this checkout speak. */
export const PROTOCOL = 134;

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
 * One revision of a block's text (PIE-621, `block.revisions`): its number, when it was saved and by whom (when the
 * service recorded the edit), its size in characters and lines, and its first line.
 */
export interface BlockRevisionEntry {
  revision: number;
  savedAt: string;
  author?: BlockAuthor;
  actorId?: string;
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
 * - `facets`: value counts for every key the matches carry (`true`), or these keys.
 * - `watch` (beside `query` on the request): keep the question on this connection under that key (`QueriesChanged`).
 */
export interface QuestionFields {
  where?: string;
  this?: string;
  group?: string;
  sort?: string | { field: string; direction: "asc" | "desc" };
  limit?: number;
  facets?: true | string[];
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
export interface QuestionFacet { key: string; count: number; values: { value: string; count: number }[]; more?: number }

/** What a question adds to `blocks.query`'s answer. `generation` is the watch's (0 when it registers). */
export interface QuestionAnswerFields {
  generation?: number;
  groups?: QuestionGroup[];
  facets?: QuestionFacet[];
  /** Said only when a key the question names is carried by no block in the outline: "no notes have <key>; nearest: …". */
  hint?: string;
}

/**
 * A watched read (ADR 0004): `blocks.query`, `views.read`, `blocks.authored-links`, `references.backlinks` and
 * `query.matches` take
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
export const WATCHABLE_ACTIONS = ["blocks.query", "views.read", "blocks.authored-links", "references.backlinks", "query.matches"] as const;

/** A query the service refused, with where. */
export interface OutlinerRequestProblem {
  code: "query-syntax" | "query-invalid";
  message: string;
  /** Query field that failed, such as where. */
  field?: string;
  /** 0-based character position within that field's text. */
  position?: number;
}

/**
 * What a fragment anchor names (`fragments.read`, `fragments.candidates`): a heading's section, a paragraph, a list
 * item, or (PIE-580) a component block such as a figure, named by an anchor alone on the line after its `::`.
 */
export type FragmentKind = "heading" | "paragraph" | "list-item" | "component";

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
  /** Opaque identity of this outline file instance; changes when an outline is restored, reset, imported or recreated. */
  outlineInstanceId?: string;
  location?: { hostname: string; workspaceRoot: string; database: string; stateDirectory: string };
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
export interface NotePlacement { parentId: string; at: "top" | "end"; rule: "near" | "inbox"; said: string }

/**
 * An outline's own MCP access setting (ADR 0002 §4, PIE-562): kept by the service in the outline's metadata, `none` by
 * default, set with `ep0ch mcp access`. One list for the service's check, the door's flags and the wire.
 */
export const MCP_ACCESS_LEVELS = ["none", "read", "propose", "full"] as const;
export type McpAccessLevel = typeof MCP_ACCESS_LEVELS[number];
/** `mcp.access.status` and `mcp.access.configure`'s answer. */
export interface McpAccessStatus {
  level: McpAccessLevel;
  canRead: boolean;
  sequence: number;
  /** The principal that made this outline over MCP (PIE-679): it writes with `full`, whatever `level` lets the others. */
  owner?: string;
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
