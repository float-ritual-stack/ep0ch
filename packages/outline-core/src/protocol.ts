// The wire contract between the outline service (packages/outliner) and its clients (the door, Tree, Detail,
// the CLI, the Claude mod). Both sides import this file; neither restates it. It does no I/O.
//
// PROTOCOL is the one compatibility check: `ping` reports the service's number and a client refuses a service
// whose number differs from its own. Bump it with any change to the wire (an action, a field, a meaning) and
// with any change to what outline-core's shared modules match or compute (the property grammar, the code fence
// and literal ranges, the link grammar, the heading styles, the component schemas, the draft.patch compare, the search matcher), since a long-running service
// and a remote door can run different checkouts.
/** The wire protocol both sides of this checkout speak. */
export const PROTOCOL = 113;

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

/** A query the service refused, with where. */
export interface OutlinerRequestProblem {
  code: "query-syntax" | "query-invalid";
  message: string;
  /** Query field that failed, such as expression. */
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
}

/** `outlines.list`. */
export interface HostedOutlineList {
  defaultOutline?: string;
  outlines: HostedOutlineSummary[];
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
