// An MCP server for ep0ch:// block resources: one implementation, two transports. `ep0ch mcp` serves it over stdio,
// bound to the outline this process can already open; `ep0ch mcp serve --http` (src/mcp-gateway.ts)
// serves it over streamable HTTP behind OAuth, for this machine's outlines and read-only mirrors of other machines'
// (src/mcp-mirror.ts), and the caller its token names. Both offer the write tools (src/mcp-writes.ts) by the outline's access, to a caller: the gateway's token's, stdio's client (the MCP `initialize` clientInfo, as `mcp:<client>`). Both answer through
// `responseFor` with an `McpOutlines` saying which outlines they read; each outline's own access setting gates every
// read and write, and every answer says where it came from (`source`: live or mirror, and `asOf`). A write to a mirror's
// outline never touches the mirror: it queues for the outline's home machine (src/mcp-netmail.ts).
import { createInterface } from "node:readline";
import { boardFor, canonicalLocalMachineName, everyNote, type Found, type NotesBoard } from "./notes-cli";
import { OUTLINE_NAME, previewTitle, type McpReachability, type McpSource } from "./socket";
import { MCP_ACCESS_LEVELS, type HostedOutlineList, type HostedOutlineSummary, type McpAccessLevel, type McpAccessStatus, type OutlineAbout } from "@ep0ch/outline-core/protocol";
import { actorLabel } from "@ep0ch/outline-core/attribution";
import { localAdmin, outlineAdminDefinitions, outlineArchive, outlineNew, OUTLINE_ADMIN_EXAMPLES, type McpOutlineAdmin } from "./mcp-outlines";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { formatEp0chBlockUri, namesOutline, parseAddressedBlock, sameMachine } from "@ep0ch/outline-core/addressable-resource";
import { checkToolArgs, type ToolSchema } from "@ep0ch/outline-core/tool-args";
import { briefFor } from "./library/brief";
import { inboxThreads, notesWithThreads, threadRows, threadSummary } from "./mcp-threads";
import { QUEUE_USAGE, textHash, type NetmailEntry, type NetmailReceipt, type NetmailSummary } from "./mcp-netmail";
import { pendingOverlay, proposalSeen, proposalSeenInText, receiptStatus, writeStatusDefinition, type ProposalSeen } from "./mcp-receipts";
import { QUERY_LIMIT, queryPage } from "./mcp-query";
import { derivedPointer, parseFields, parseSeen, parseSort, projectRecord, ResponseScope, seeStub, unchangedStub, pairOf, FIELD_NAMES } from "./mcp-orient";
import { actorOf, levelFor, STDIO_SUBJECT, applyWrite, assignIdRefusal, commentOnResourceOn, isResourceRef, isWriteTool, readResourceOn, MCP_WRITE_TOOLS, resolveBoardRef, writeInput, writesAt, writeToolDefinitions, type McpCaller, type McpWriteTool } from "./mcp-writes";

export const MCP_USAGE = `  ep0ch mcp [--ws <name>] [--machine <ssh-name>]
                                   local stdio MCP server for ep0ch:// block resources, gated by the outline's \`ep0ch mcp access\` grant:
                                   tools list_outlines, outline_read, outline_threads, outline_find, outline_query, outline_links, outline_components; resources/read with envelope,
                                   and the outline's components as resources (resources/list). At \`propose\` and \`full\` it offers the
                                   same write tools as the gateway, as \`mcp:<client>\` (the client the MCP initialize names)
  ep0ch mcp serve --http [--port <n>] [--bind <address>] [--ws <default outline>]
                                   the same server over streamable HTTP for remote clients (claude.ai), an OAuth resource
                                   server for this machine's outlines (and EP0CH_MCP_REMOTE's, live or from a mirror);
                                   needs EP0CH_MCP_RESOURCE, CLERK_PUBLISHABLE_KEY (or EP0CH_MCP_ISSUER) and
                                   EP0CH_MCP_ALLOWED_SUBJECTS (unset: refuse and log who asked)
  ep0ch mcp access [none|read|propose|full] [--json] [--ws <name>] [--machine <ssh-name>]
                                   show or set this outline's persisted MCP access grant (stdio and the gateway alike):
                                   propose and full let the write tools (outline_create, outline_patch,
                                   outline_comment, outline_set_property, outline_reply, outline_resolve_thread) propose or apply (outline_assign_id applies at full only); a gateway's mirror of an outline queues them when its machine is away
${QUEUE_USAGE}`;

type RpcId = string | number | null;
interface RpcRequest { jsonrpc?: string; id?: RpcId; method?: string; params?: unknown }
interface McpContent { type: "text"; text: string }
interface ToolResult { content: McpContent[]; isError?: boolean }
interface McpIo { input?: AsyncIterable<string>; write?: (line: string) => void; err?: (line: string) => void }

type Board = NotesBoard;

/** An outline as a tool or URI names it: a name, and the machine when the caller gave one. */
export interface NamedOutline { outline: string; machine?: string }

/**
 * Where an answer came from (socket.ts's McpSource). `live`: the outline's own host, read now. `mirror`: a read-only
 * copy on the gateway's machine of an outline whose home is another machine; `asOf` is the newest change it holds.
 */
export type McpServed = McpSource;

/**
 * A board to read, and where it is served from. `home`: a mirror's outline lives on that machine, in the database
 * whose instance id the copy carries; a write to it queues for that machine.
 */
export interface McpBoard {
  board: Board; served: McpServed; home?: { machine: string; instanceId: string | null };
  /** Served live from a machine whose mirror this server also keeps: writes queued for it that haven't landed yet still overlay a read. */
  queuedFor?: string;
}

/** Served live, read now. */
export const servedLive = (now = Date.now()): McpServed => ({ source: "live", asOf: new Date(now).toISOString() });

/** One outline as `list_outlines` shows it: where it lives, how it is served now, and its access setting. */
export interface McpOutlineListing {
  outline: string;
  machine: string;
  /** An outline of another machine whose own name for itself is `machine`: the ssh name that reaches it (accepted in a URI too). */
  sshName?: string;
  uri: string;
  /** `unreachable`: a mirror this server was told of that has no copy here yet. */
  source: McpServed["source"] | "unreachable";
  asOf?: string;
  access?: McpAccessLevel;
  /** Who made it and why, when an agent made it with outline_new (the door's home base shows the same). */
  about?: OutlineAbout & { by: string };
  /** What a write to it becomes: applied or proposed here, or queued for its home machine; absent when it takes none. */
  writes?: "applied" | "proposals" | "queued";
  /** An outline of another machine: how it is served now (its host through the shared ssh forward, or the mirror and why) and when that was last checked. */
  route?: { via: "live" | "mirror"; checkedAt: string | null; why?: string; command?: string };
  /** A mirror's queued writes: how many wait, the oldest, and when its home machine last pulled. */
  queue?: { waiting: number; oldest: string | null; lastPull: string | null; said?: string };
  note?: string;
}

/** Where a remote server queues writes for other machines' outlines (src/mcp-netmail.ts). */
export interface McpQueue {
  queue(entry: Omit<NetmailEntry, "id" | "queuedAt">): NetmailEntry;
  summary(machine: string): NetmailSummary | null;
  /** A queued write and what it became so far, or none. */
  receipt(id: string): NetmailReceipt | null;
  /** One caller's writes about a block that the mirror doesn't show yet (the read-your-writes overlay). */
  pending(machine: string, outline: string, blockId: string, who: { actorId: string; subject: string }): NetmailReceipt[];
  /** A write made live on the machine's own host, kept with the queued ones (settled at once, with the revision it made). */
  live(entry: Omit<NetmailEntry, "id" | "queuedAt">, done: { state: "applied" | "proposed" | "unchanged"; said: string; uri?: string; revision?: number }): NetmailEntry;
  /** The newest write through this server to an outline (or one block) that took effect on its machine. */
  lastApplied(machine: string, outline: string, blockId?: string): { id: string; at: string; revision: number | null; live: boolean; uri: string | null } | null;
  /** All of one caller's writes about a block, oldest first (what a receipt compares for "superseded"). */
  history(machine: string, outline: string, blockId: string, who: { actorId: string; subject: string }): NetmailReceipt[];
}

/**
 * Which outlines an MCP server reads. `local`: the stdio server, bound to one board. `remote`: the HTTP gateway, any
 * outline on this machine's host by name, and the mirrors of other machines' outlines it was told of. `board` answers the board
 * a URI or a tool's `outline` names (or the default when none is named), with where it is served from, or why not, in
 * words the caller can act on. `list` is every outline it reads, for `list_outlines`.
 */
export interface McpOutlines {
  kind: "local" | "remote";
  machine: string;
  board(named?: NamedOutline): Promise<McpBoard | { error: string }>;
  list(caller?: McpCaller): Promise<McpOutlineListing[]>;
  /** What outline_new and outline_archive use: this machine's outline host. Absent, they aren't offered. */
  admin?: McpOutlineAdmin;
  /** A server bound to boards (stdio) takes an outline just made into what it serves, so list_outlines shows it on the same session. */
  adopt?(board: Board): void;
  /** An outline put away (outline_archive): no longer served in this session. */
  release?(name: string): void;
  /** The outline a find or bare ref reads when none is named, if this server has one. */
  defaultOutline?: string;
  /** What a caller is told of an unexpected failure (the gateway logs it and says less); else its message. */
  internalError?: (e: Error) => string;
  /** Where writes to a mirror's outline wait (the gateway's); without one, they are refused. */
  netmail?: McpQueue;
  /** A line for the server's log (the gateway's): each write and what it became. */
  log?: (line: string) => void;
}

/** An `about` as a listing shows it: with who, as a person reads it (`loki (claude-code@float-2)`). */
export const aboutListing = (a: OutlineAbout): OutlineAbout & { by: string } => ({ ...a, by: actorLabel(a.createdBy) });

const uriOrName = (named: NamedOutline, machine: string) => named.machine ? `ep0ch://${named.outline}@${named.machine}` : `outline ${named.outline}@${machine}`;

/** The stdio server's outlines: the one board it was started on. */
export function boundOutlines(board: Board, admin?: McpOutlineAdmin): McpOutlines {
  const bound = board.address;
  /** Outlines this session made with outline_new: served beside the bound one, on this machine. */
  const made = new Map<string, Board>();
  const hereOnly = (n: NamedOutline) => !n.machine || sameMachine(n.machine, admin?.machine ?? bound.machine);
  return {
    kind: "local",
    machine: bound.machine,
    defaultOutline: bound.outline,
    ...(admin ? { admin } : {}),
    adopt(b) { if (admin && b.address) made.set(b.address.outline, b); },
    release(name) { made.get(name)?.close(); made.delete(name); },
    async board(named) {
      if (!named || namesOutline({ outline: named.outline, machine: named.machine ?? bound.machine }, bound)) return { board, served: servedLive() };
      const other = made.get(named.outline);
      if (other && hereOnly(named)) return { board: other, served: servedLive() };
      return { error: `${uriOrName(named, bound.machine)} names ${named.outline}@${named.machine ?? bound.machine}; this MCP server is bound to ${bound.outline}@${bound.machine}${made.size ? ` and the ${made.size === 1 ? "outline" : "outlines"} it made (${[...made.keys()].join(", ")})` : ""}` };
    },
    async list(caller) {
      const rows: McpOutlineListing[] = [];
      const abouts = new Map((admin ? await admin.host<HostedOutlineList>("outlines.list").catch(() => ({ outlines: [] as HostedOutlineSummary[] })) : { outlines: [] as HostedOutlineSummary[] }).outlines.map(o => [o.name, o.about]));
      for (const b of [board, ...made.values()]) {
        const status = await b.mcpAccessStatus(), level = levelFor(status, caller), writes = writesAt(level);
        const about = abouts.get(b.address.outline);
        rows.push({ ...b.address, uri: `ep0ch://${b.address.outline}@${b.address.machine}`, ...servedLive(), access: level, ...(writes ? { writes } : {}), ...(about ? { about: aboutListing(about) } : {}) });
      }
      return rows;
    },
  };
}

const toolText = (value: unknown, compact = false): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, compact ? undefined : 2) }] });
const toolError = (message: string): ToolResult => ({ isError: true, content: [{ type: "text", text: message }] });
const objectFields = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** The block a tool names: its `uri`, or `ref`. (`id`, `reference` and the other aliases became `ref` in checkToolArgs, which callTool runs first; a call naming two different blocks never gets here.) */
const refArg = (args: Record<string, unknown>) => stringField(args, "uri") ?? stringField(args, "ref");
const stringField = (value: Record<string, unknown>, key: string): string | undefined => typeof value[key] === "string" ? value[key] : undefined;

/** A tool's `limit`: absent is the default; anything but a whole number from 1 to the maximum is refused, saying both. */
interface LimitRule { fallback: number; max: number }
const limitOf = (value: unknown, { fallback, max }: LimitRule): number | { error: string } => {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max) return value;
  return { error: `limit is a whole number from 1 to ${max} (default ${fallback}); got ${JSON.stringify(value)}.` };
};
const FIND_LIMIT: LimitRule = { fallback: 30, max: 30 };
const LIST_LIMIT: LimitRule = { fallback: 30, max: 100 };
const LINKS_LIMIT: LimitRule = { fallback: 50, max: 200 };
const limitSchema = ({ fallback, max }: LimitRule, what: string) => ({ type: "integer", minimum: 1, maximum: max, default: fallback, description: `${what}: 1 to ${max}, default ${fallback}` });

const MCP_WRITE_TOOL_NAMES = MCP_WRITE_TOOLS.join(", ");

/** The MCP protocol versions these servers speak, newest first: a client's own is echoed, any other gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const protocolFor = (requested: unknown) => (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(requested) ? requested as string : MCP_PROTOCOL_VERSIONS[0];

class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

const invalidParams = (message: string) => new RpcError(-32602, message);

async function* stdinLines(): AsyncIterable<string> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try { for await (const line of rl) yield line; } finally { rl.close(); }
}

function blockUri(board: Board, blockId: string): string {
  return formatEp0chBlockUri({ ...board.address, blockId });
}

/** A tool's `outline`: `<name>` or `<name>@<machine>`. */
function namedOutline(input: unknown): NamedOutline | { error: string } | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !input.trim()) return { error: "outline is an outline's name (or <name>@<machine>)." };
  const [outline, machine, extra] = input.trim().split("@");
  if (extra !== undefined || !outline || !OUTLINE_NAME.test(outline) || machine === "") return { error: `${JSON.stringify(input)} isn't an outline name: lowercase letters, digits and hyphens (or <name>@<machine>).` };
  return machine ? { outline, machine } : { outline };
}

/**
 * The board a tool or resource read addresses, and the block in it. A URI names its own outline (and an `outline`
 * naming another is refused); a ref is in `outline`'s, resolved there by the Claude mod's resolver (an id, ((id)),
 * [[page]] or Work ID), once the outline's access lets this caller read it. `refs: false`: a URI only (resources/read).
 */
async function addressedBlock(outlines: McpOutlines, input: unknown, outlineInput?: unknown, refs = true): Promise<McpBoard & { id: string; uri: string } | { error: string }> {
  if (typeof input !== "string" || !input.trim()) return { error: refs ? "Give ref (a block id, ((id)), [[page]] or Work ID) or uri (an ep0ch:// block URI)." : "Give uri: an ep0ch:// block URI." };
  const text = input.trim();
  const which = namedOutline(outlineInput);
  if (which && "error" in which) return which;
  if (text.startsWith("ep0ch://") || !refs) {
    let parsed;
    try { parsed = parseAddressedBlock(text); } catch (e) { return { error: (e as Error).message }; }
    if (!("outline" in parsed)) return { error: `${JSON.stringify(text)} isn't an ep0ch:// block URI.` };
    if (which && !namesOutline({ outline: which.outline, machine: which.machine ?? parsed.machine }, parsed)) {
      return { error: `uri names ${parsed.outline}@${parsed.machine} and outline names ${which.outline}${which.machine ? `@${which.machine}` : ""}: give one, or make them agree.` };
    }
    const served = await outlines.board({ outline: parsed.outline, machine: parsed.machine });
    if ("error" in served) return served;
    return { ...served, id: parsed.blockId, uri: blockUri(served.board, parsed.blockId) };
  }
  if (!which && !outlines.defaultOutline) return { error: `Name the outline: pass outline (an outline on ${outlines.machine}), or give an ep0ch:// URI.` };
  const served = await outlines.board(which);
  if ("error" in served) return served;
  // Nothing is looked up in an outline this caller may not read, not even whether a page or Work ID exists.
  const status = await requireReadAccess(outlines, served);
  if ("error" in status) return status;
  let id: string;
  try { id = (await resolveBoardRef(served.board, text)).id; }
  catch (e) { return { error: `${(e as Error).message} (in ${served.board.address.outline}@${served.board.address.machine})` }; }
  return { ...served, id, uri: blockUri(served.board, id) };
}


const grantCommand = (board: Board) => {
  const machine = sameMachine(board.address.machine, canonicalLocalMachineName()) ? "" : ` --machine ${board.address.machine}`;
  return `ep0ch mcp access read --ws ${board.address.outline}${machine}`;
};
const accessRefusal = (outlines: McpOutlines, { board, served }: McpBoard, level: McpAccessLevel) => outlines.kind === "local"
  ? `local MCP access is ${level} for ${board.address.outline}; run \`${grantCommand(board)}\` to grant read-only local MCP access for this outline.`
  // Run on the outline's own machine, so the command names no machine; a mirror carries the setting with its next change.
  : `MCP access is ${level} for ${board.address.outline}@${board.address.machine}${served.source === "mirror" ? ` (as its mirror on ${outlines.machine} carries it, as of ${served.asOf})` : ""}; its owner runs \`ep0ch mcp access read --ws ${board.address.outline}\` on ${board.address.machine} to let MCP clients read it${served.source === "mirror" ? ", and the mirror follows with that change" : ""}.`;

/** The status with the level this caller has: the principal that made a scratch outline writes with `full` (levelFor). */
const withLevel = (status: McpAccessStatus, caller: McpCaller | undefined): McpAccessStatus => ({ ...status, level: levelFor(status, caller) });

async function requireReadAccess(outlines: McpOutlines, target: McpBoard): Promise<McpAccessStatus | { error: string }> {
  const status = await target.board.mcpAccessStatus();
  if (!status.canRead) return { error: accessRefusal(outlines, target, status.level) };
  return status;
}

/** Where an answer came from, in words: nothing for a live outline, as before. */
const servedWords = (outlines: McpOutlines, { served }: McpBoard) =>
  served.source === "mirror" ? `, read-only mirror on ${outlines.machine} as of ${served.asOf}${served.note ? `: ${served.note}` : ""}` : served.machine ? `, live from ${served.machine}'s own host` : "";

const reachability = (outlines: McpOutlines, target: McpBoard, status: McpAccessStatus, id: string, revision: number | undefined): McpReachability => ({
  id,
  status: "reachable",
  level: status.level,
  ...(revision !== undefined ? { revision } : {}),
  ...target.served,
  reason: outlines.kind === "local" ? `local MCP access is ${status.level}` : `MCP access is ${status.level} (remote gateway${servedWords(outlines, target)})`,
});

/**
 * A record as MCP sends it: the service's record without what it repeats (`text` is `body` with the header chips, and
 * `header` is `properties` again), so a model reads each thing once. Links keep `bodySpans`, which point into `body`;
 * their `spans` point into the `text` that isn't sent. Other clients get the whole record.
 */
export type McpRecord = Omit<BlockRecord, "text" | "header" | "links"> & { links: Omit<BlockRecord["links"][number], "spans">[]; /** Who made it, as a person reads it: `loki (claude-code@float-2)` (PIE-679). */ by?: string };
export const mcpRecord = ({ text: _text, header: _header, links, ...rest }: BlockRecord): McpRecord =>
  ({ ...rest, ...(rest.actor ? { by: actorLabel(rest.actor) } : {}), links: links.map(({ spans: _spans, ...link }) => link) });

const envelope = (board: Board, uri: string, access: McpReachability, record: BlockRecord, revision: number | undefined) => ({
  uri,
  outlineInstanceId: board.outlineInstanceId,
  revision: revision ?? access.revision,
  reachability: access,
  record: mcpRecord(record),
});

async function recordForMcp(outlines: McpOutlines, target: McpBoard, id: string): Promise<{ access: McpReachability; record: BlockRecord } | { error: string }> {
  const status = await requireReadAccess(outlines, target);
  if ("error" in status) return status;
  const r = await target.board.records([id]);
  const record = r.records.find(row => row.id === id);
  if (!record) return { error: `No block ${id} in ${target.board.address.outline}${target.served.source === "mirror" ? `'s mirror (as of ${target.served.asOf})` : ""}; ${r.unavailable[0]?.status ?? "missing"}.` };
  return { access: reachability(outlines, target, status, id, record.revision), record };
}


/**
 * A Resource addressed by `ref` (resource:<id> or a [file::path] token, PIE-650): read, or commented on, live in the
 * outline it is registered in (a mirror is a copy of blocks, so a Resource is read at its home).
 */
async function resourceBoard(outlines: McpOutlines, args: Record<string, unknown>): Promise<McpBoard | { error: string }> {
  const named = namedOutline(args.outline);
  if (named && "error" in named) return named;
  if (!named && !outlines.defaultOutline) return { error: `Name the outline: pass outline (an outline on ${outlines.machine}).` };
  const target = await outlines.board(named);
  if ("error" in target) return target;
  const status = await requireReadAccess(outlines, target);
  if ("error" in status) return status;
  if (target.served.source === "mirror") return { error: `${target.board.address.outline}@${target.board.address.machine} is served from a read-only mirror here; a Resource and its threads are read live on ${target.board.address.machine}.` };
  return target;
}

async function readRecord(outlines: McpOutlines, args: Record<string, unknown>, caller?: McpCaller, scope?: ResponseScope): Promise<ToolResult> {
  const ref = refArg(args);
  if (ref && await isResourceRef(ref)) {
    const target = await resourceBoard(outlines, args);
    if ("error" in target) return toolError(target.error);
    try { return toolText({ outline: target.board.address.outline, machine: target.board.address.machine, resource: await readResourceOn(target.board, ref) }); }
    catch (e) { return toolError((e as Error).message); }
  }
  const target = await addressedBlock(outlines, refArg(args), args.outline);
  if ("error" in target) return toolError(target.error);
  const seen = args.seen === undefined ? undefined : parseSeen(args.seen);
  if (seen && "error" in seen) return toolError(seen.error);
  const read = await recordForMcp(outlines, target, target.id);
  if ("error" in read) return toolError(read.error);
  // Read your writes: this caller's own writes still queued for the mirror's home machine, laid over its text (PIE-648).
  // A write the home machine has applied stays until the mirror's copy has reached the revision it made.
  const queuedAt = target.home?.machine ?? target.queuedFor;
  const waiting = (caller && queuedAt && outlines.netmail ? outlines.netmail.pending(queuedAt, target.board.address.outline, target.id, { actorId: actorOf(caller).actorId, subject: caller.sub }) : [])
    .filter(w => w.state === "queued" || (w.resultRevision ?? 0) > read.record.revision);
  const pending = pendingOverlay(read.record.body, waiting);
  // A mirror older than a write made through this server: the newest such write to the note, and its revision.
  const newest = target.served.source === "mirror" && target.home && outlines.netmail ? outlines.netmail.lastApplied(target.home.machine, target.board.address.outline, target.id) : null;
  const staleSince = newest && (newest.revision ?? 0) > read.record.revision
    ? { revision: newest.revision, at: newest.at, queueId: newest.id, said: `this mirror copy is at revision ${read.record.revision}; a write made through this server already made revision ${newest.revision} on ${target.home!.machine} (${newest.live ? "live" : "applied by its pull"}), so the note is newer than this answer` }
    : null;
  // The note's comment threads, compact: a reply is how an agent learns it was answered. A board that can't list them still reads.
  // What the caller holds at this revision isn't sent again (`seen`), nor is a body this response already sent (`see`). Neither
  // while a queued write is laid over the text, or the mirror is behind: that answer is news. Threads are other blocks: outline_threads.
  const news = !!pending || !!staleSince;
  if (!news && seen?.has(pairOf(read.record.id, read.record.revision))) return toolText({ uri: target.uri, ...unchangedStub(read.record.id, read.record.revision), reachability: read.access });
  // A proposal or a comment points at its note (id@revision) instead of copying it; raw: true sends the block as stored.
  const pointer = args.raw === true ? null : await derivedPointer(target.board, read.record).catch(() => null);
  const first = !news && scope ? scope.claim(target.board.address.outline, read.record.id, read.record.revision, pointer ? "pointer" : "full", "record") : null;
  if (first) return toolText({ uri: target.uri, ...seeStub(read.record.id, read.record.revision, first), reachability: read.access });
  const threads = await target.board.comments(target.id).then(c => threadSummary(threadRows(c)), () => undefined);
  const env = envelope(target.board, target.uri, read.access, read.record, read.record.revision);
  return toolText({ ...env, ...(pointer ? { record: pointer } : {}), ...(pending ? { pending } : {}), ...(staleSince ? { staleSince } : {}), ...(threads ? { threads } : {}) });
}

const QUERY_LIMIT_RULE: LimitRule = QUERY_LIMIT;

/** outline_query: the views' grammar, or a saved view, over one outline; the service answers, records come back. */
async function queryTool(outlines: McpOutlines, args: Record<string, unknown>, scope?: ResponseScope): Promise<ToolResult> {
  const query = stringField(args, "query")?.trim(), view = stringField(args, "view")?.trim();
  if (!query === !view) return toolError("Give query (the views' grammar: type=ticket NOT work-stage=done) or view (a saved view's block id), one of them.");
  const limit = limitOf(args.limit, QUERY_LIMIT_RULE);
  if (typeof limit !== "number") return toolError(limit.error);
  const offset = args.offset === undefined ? 0 : args.offset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) return toolError(`offset is a whole number from 0 (a previous answer's nextOffset); got ${JSON.stringify(offset)}.`);
  const named = namedOutline(args.outline);
  if (named && "error" in named) return toolError(named.error);
  if (!named && !outlines.defaultOutline) return toolError(`Name the outline: pass outline (an outline on ${outlines.machine}).`);
  const target = await outlines.board(named);
  if ("error" in target) return toolError(target.error);
  const status = await requireReadAccess(outlines, target);
  if ("error" in status) return toolError(status.error);
  const { board, served } = target;
  const sort = args.sort === undefined ? undefined : parseSort(args.sort);
  if (sort && "error" in sort) return toolError(sort.error);
  if (sort && view) return toolError("sort orders a query (or under); a saved view has its own order (its [sort::]). Give query, or drop sort.");
  const fields = args.fields === undefined ? undefined : parseFields(args.fields);
  if (fields && "error" in fields) return toolError(fields.error);
  const seen = args.seen === undefined ? undefined : parseSeen(args.seen);
  if (seen && "error" in seen) return toolError(seen.error);
  if (args.fold !== undefined && typeof args.fold !== "boolean") return toolError("fold is true or false: true folds proposals, comments and deliveries into the note they belong to, with a count.");
  let under: string | undefined;
  if (args.under !== undefined) {
    if (typeof args.under !== "string" || !args.under.trim()) return toolError("under is a note: its id, ((id)), [[page]] or Work ID (PIE-123), as ref is; the query then covers that note's subtree.");
    try { under = (await resolveBoardRef(board, args.under.trim())).id; }
    catch (e) { return toolError(`under: ${(e as Error).message} (in ${board.address.outline}@${board.address.machine})`); }
  }
  const answer = await queryPage(board, {
    ...(query ? { query } : {}), ...(view ? { view } : {}), limit, offset, ...(sort ? { sort } : {}), ...(under ? { under } : {}),
    ...(args.fold === true ? { fold: true } : {}), ...(fields?.fields.includes("path") ? { path: true } : {}),
  });
  if ("error" in answer) return toolError(answer.error);
  const { rows, ...page } = answer;
  const matches: unknown[] = [];
  for (const [i, { record: r, changes, path }] of rows.entries()) {
    const uri = blockUri(board, r.id), extra = changes ? { changes } : {};
    // A stub keeps what the revision doesn't vouch for: a path moves when an ancestor is renamed, a fold's count when a comment is added.
    if (seen?.has(pairOf(r.id, r.revision))) { matches.push({ ...unchangedStub(r.id, r.revision, uri), ...(fields?.fields.includes("path") && path !== undefined ? { path: pathOf(path) } : {}), ...extra }); continue; }
    if (fields) { matches.push({ ...projectRecord(r, fields.fields, { uri, ...(path !== undefined ? { path: pathOf(path) } : {}) }), ...extra }); continue; }
    const pointer = args.raw === true ? null : await derivedPointer(board, r).catch(() => null);
    const first = scope?.claim(board.address.outline, r.id, r.revision, pointer ? "pointer" : "full", `matches[${i}]`);
    if (first) { matches.push({ ...seeStub(r.id, r.revision, first, uri), ...extra }); continue; }
    matches.push({ uri, revision: r.revision, record: pointer ?? mcpRecord(r), ...extra });
  }
  // A projected answer is for orienting: compact, since its size is the point.
  return toolText({
    outline: board.address.outline, machine: board.address.machine, ...served, access: { level: status.level }, ...page,
    completeness: { kind: page.more || page.truncated ? "truncated" : "complete", limit, more: page.more, total: page.total },
    matches,
  }, !!fields);
}

/** A proposal as the (mirror's) outline shows it: open, or applied or dismissed (which goes to the Trash, so its text is read there); missing when the copy doesn't hold it yet. */
async function proposalIn(board: Board, id: string): Promise<ProposalSeen> {
  const r = await board.records([id]);
  if (r.records[0]) return proposalSeen(r.records[0].properties);
  if (r.unavailable[0]?.status === "trashed") return proposalSeenInText((await board.request<{ text: string }>("get", { blockId: id })).text);
  return "missing";
}

/** outline_write_status: one of this caller's queued writes, and what it became. */
async function writeStatusTool(outlines: McpOutlines, args: Record<string, unknown>, caller: McpCaller): Promise<ToolResult> {
  const id = stringField(args, "queueId")?.trim();
  if (!id) return toolError("Give the queueId a queued write answered.");
  const queue = outlines.netmail;
  const mine = actorOf(caller);
  const receipt = queue?.receipt(id);
  // Not found and not yours read the same: another caller's writes are not for this one to list.
  if (!queue || !receipt || receipt.subject !== caller.sub || receipt.actorId !== mine.actorId) return toolError(`No queued write ${JSON.stringify(id)} of yours (a queueId is what a queued write answered).`);
  let proposal: ProposalSeen | undefined;
  if (receipt.state === "proposed" && receipt.proposalUri) {
    const served = await outlines.board({ outline: receipt.outline, machine: receipt.machine });
    proposal = "missing";
    if (!("error" in served)) {
      try { proposal = await proposalIn(served.board, (parseAddressedBlock(receipt.proposalUri) as { blockId: string }).blockId); }
      catch { /* the mirror can't say; the proposal stands as proposed */ }
    }
  }
  const later = receipt.state === "proposed" ? queue.history(receipt.machine, receipt.outline, receipt.blockId, { actorId: mine.actorId, subject: caller.sub }) : [];
  return toolText(receiptStatus(receipt, { summary: queue.summary(receipt.machine), ...(proposal ? { proposal } : {}), later }));
}

/** A time argument: an ISO date-time, or epoch milliseconds. */
const timeArg = (v: unknown): number | undefined | { error: string } => {
  if (v === undefined) return undefined;
  const t = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : { error: "since is an ISO date-time (2026-10-08T09:00:00Z) or epoch milliseconds." };
};
const INBOX_NOTES = { fallback: 20, max: 100 };
/** Most notes with threads an inbox query reads (each is one request); a longer list says it was cut. */
const INBOX_SCAN = 200;

/**
 * A note's comment threads, whole: who said what and when, on which quote, open or resolved. Without a note it is
 * the outline's inbox: the open threads anywhere in it, newest activity first, narrowed by who spoke last
 * (`lastFrom`), a mention (`mentions`) and `since`, which is what a scheduled check asks.
 */
async function threadsTool(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const hasNote = refArg(args) !== undefined;
  const asked = args.status === undefined ? (hasNote ? "all" : "open") : args.status;
  if (asked !== "all" && asked !== "open" && asked !== "resolved") return toolError(`status is all${hasNote ? " (the default)" : ""}, open${hasNote ? "" : " (the default)"} or resolved.`);
  const status: "all" | "open" | "resolved" = asked;
  if (hasNote) {
    const target = await addressedBlock(outlines, refArg(args), args.outline);
    if ("error" in target) return toolError(target.error);
    const read = await recordForMcp(outlines, target, target.id);
    if ("error" in read) return toolError(read.error);
    const rows = threadRows(await target.board.comments(target.id));
    return toolText({
      uri: target.uri, id: target.id, revision: read.record.revision, reachability: read.access,
      counts: { open: rows.filter(r => r.status === "open").length, resolved: rows.filter(r => r.status === "resolved").length },
      threads: inboxThreads(rows, { status, ...(typeof args.lastFrom === "string" ? { lastFrom: args.lastFrom } : {}), ...(typeof args.mentions === "string" ? { mentions: args.mentions } : {}) }),
    });
  }
  const which = namedOutline(args.outline);
  if (which && "error" in which) return toolError(which.error);
  if (!which && !outlines.defaultOutline) return toolError("Name the outline (pass outline), or a note (uri or ref) to read its threads.");
  const limit = limitOf(args.limit, INBOX_NOTES);
  if (typeof limit !== "number") return toolError(limit.error);
  const since = timeArg(args.since);
  if (typeof since === "object") return toolError(since.error);
  const target = await outlines.board(which);
  if ("error" in target) return toolError(target.error);
  const access = await requireReadAccess(outlines, target);
  if ("error" in access) return toolError(access.error);
  const { board } = target;
  const query = { status, ...(typeof args.lastFrom === "string" && args.lastFrom ? { lastFrom: args.lastFrom } : {}), ...(typeof args.mentions === "string" && args.mentions ? { mentions: args.mentions } : {}), ...(since !== undefined ? { since } : {}) };
  // The index narrows to the notes holding threads by status and time; each note's threads are then read and filtered
  // by who spoke last and mentions. A note that read nothing after filtering isn't shown.
  const candidates = notesWithThreads(await board.index(), { status, ...(since !== undefined ? { since } : {}) });
  const found: { at: number; note: { uri: string; id: string; title: string; threads: ReturnType<typeof threadRows> } }[] = [];
  let scanned = 0;
  for (const c of candidates.slice(0, INBOX_SCAN)) {
    scanned++;
    const threads = inboxThreads(threadRows(await board.comments(c.noteId)), query);
    // Ordered by the newest comment among the threads that matched, not by the note's newest activity.
    if (threads.length) found.push({ at: Math.max(...threads.map(t => Date.parse(t.comments.at(-1)!.at ?? "") || 0)), note: { uri: blockUri(board, c.noteId), id: c.noteId, title: previewTitle(c.title), threads } });
  }
  found.sort((a, b) => b.at - a.at);
  const notes = found.slice(0, limit).map(f => f.note);
  const more = scanned < candidates.length || found.length > limit;
  return toolText({
    outline: board.address.outline, machine: board.address.machine, ...target.served, access: { level: access.level },
    query, notes, threadCount: notes.reduce((n, x) => n + x.threads.length, 0),
    completeness: { kind: more ? "truncated" : "complete", limit, more },
    said: "Each note's threads are as outline_threads reads them for that note; outline_reply and outline_resolve_thread answer.",
  });
}

/** Where a search found a note: its ancestors' titles, or `(root)` for a top-level note (never an empty path). */
const ROOT_PATH = "(root)";
const pathOf = (path: string) => path || ROOT_PATH;

/** What a search's ranking was, in words a caller can act on. */
const semanticSays = (asked: boolean, semantic: { status: string; message?: string } | undefined) => {
  if (!asked) return { asked, status: "lexical", said: "lexical: ep0ch find's ranker (title, text, properties); pass semantic: true to ask for a semantic re-ranking" };
  const status = semantic?.status ?? "unavailable";
  return { asked, status, said: status === "ranked" ? "re-ranked semantically (Jev) over the lexical candidates" : `lexical: semantic re-ranking was asked for and isn't available here${semantic?.message ? ` (${semantic.message})` : ""}` };
};

async function findBlocks(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const seen = args.seen === undefined ? undefined : parseSeen(args.seen);
  if (seen && "error" in seen) return toolError(seen.error);
  const named = namedOutline(args.outline);
  if (named && "error" in named) return toolError(named.error);
  if (!named && !outlines.defaultOutline) return toolError(`Name the outline: pass outline (an outline on ${outlines.machine}).`);
  const target = await outlines.board(named);
  if ("error" in target) return toolError(target.error);
  const { board, served } = target;
  const status = await requireReadAccess(outlines, target);
  if ("error" in status) return toolError(status.error);
  const query = stringField(args, "query")?.trim() ?? "";
  const limit = limitOf(args.limit, query ? FIND_LIMIT : LIST_LIMIT);
  if (typeof limit !== "number") return toolError(limit.error);
  const askSemantic = args.semantic === true;
  // `completeness` is about this answer: the limit asked for, and whether there are more than it shows (cut here, or
  // already cut at the service's own limit).
  let rows: (Found & { revision?: number })[], more: boolean, search: ReturnType<typeof semanticSays> | undefined;
  if (query) {
    const found = await board.searchBlocks(query, askSemantic ? { semantic: true } : {});
    rows = found.matches.slice(0, limit).map(m => ({ id: m.block.id, title: m.title, path: pathOf(m.path), uri: blockUri(board, m.block.id), revision: m.block.revision }));
    // A hit the caller holds at this revision is a stub: its title and path are what they already have.
    if (seen) rows = rows.map(r => r.revision !== undefined && seen.has(pairOf(r.id, r.revision)) ? ({ ...unchangedStub(r.id, r.revision, r.uri), path: r.path }) as unknown as typeof r : r);
    more = found.matches.length > limit || found.completeness.kind !== "complete";
    search = semanticSays(askSemantic, found.semantic);
  } else {
    const every = everyNote(await board.index());
    rows = every.slice(0, limit).map(f => ({ ...f, path: pathOf(f.path), uri: blockUri(board, f.id) }));
    more = every.length > limit;
  }
  const completeness = { kind: more ? "truncated" : "complete", limit, more };
  return toolText({ outline: board.address.outline, machine: board.address.machine, ...served, query, limit, access: { level: status.level }, completeness, ...(search ? { search } : {}), matches: rows });
}

/** One group of an answer cut at `limit`: how many it shows, how many there are (null: more than the service read). */
const groupCompleteness = (shown: number, total: number | null) => ({ complete: total !== null && shown === total, shown, total, more: total === null || total > shown });

async function linkData(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args.limit, LINKS_LIMIT);
  if (typeof limit !== "number") return toolError(limit.error);
  const target = await addressedBlock(outlines, refArg(args), args.outline);
  if ("error" in target) return toolError(target.error);
  const board = target.board;
  const read = await recordForMcp(outlines, target, target.id);
  if ("error" in read) return toolError(read.error);
  const record = read.record;
  // The service keeps the note itself among its backlinks (the door's "this note" toggle); here it's noise, so one
  // more is asked for. The record's backlinks are the same relation, whole: their count is the total, so this answer
  // and outline_read's record always agree.
  const sources = (await board.backlinks(target.id, limit + 1)).sources.filter(s => s.blockId !== target.id).slice(0, limit);
  const links = mcpRecord(record).links;
  const linksTotal = record.truncated?.includes("links") ? null : links.length;
  const resourcesTotal = record.truncated?.includes("resources") ? null : record.resources.length;
  return toolText({
    uri: target.uri,
    id: target.id,
    title: previewTitle(record.title),
    reachability: read.access,
    limit,
    links: links.slice(0, limit),
    resources: record.resources.slice(0, limit),
    backlinks: sources,
    completeness: {
      links: groupCompleteness(Math.min(limit, links.length), linksTotal),
      resources: groupCompleteness(Math.min(limit, record.resources.length), resourcesTotal),
      backlinks: groupCompleteness(sources.length, record.backlinks.length),
    },
  });
}

/** A component's resource URI: `ep0ch://<outline>@<machine>/components/<id>`. */
const COMPONENT_URI = /^ep0ch:\/\/([^@/?#]+)@([^/?#]+)\/components\/([a-z0-9][a-z0-9-]*)$/;
const componentUri = (board: Board, id: string) => `ep0ch://${board.address.outline}@${board.address.machine}/components/${id}`;

/** The component schemas of a board, once the outline's access lets this caller read it: the same read as `ep0ch library`. */
async function componentsOf(outlines: McpOutlines, target: McpBoard): Promise<ComponentSchema[] | { error: string }> {
  const status = await requireReadAccess(outlines, target);
  if ("error" in status) return status;
  return (await target.board.componentSchemas()).schemas;
}

async function componentsTool(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const names = args.components === undefined ? [] : Array.isArray(args.components) && args.components.every(c => typeof c === "string") ? args.components as string[] : null;
  if (!names) return toolError("components is a list of component ids (leave it out for all of them).");
  const which = namedOutline(args.outline);
  if (which && "error" in which) return toolError(which.error);
  if (!which && !outlines.defaultOutline) return toolError(`Name the outline: pass outline (an outline on ${outlines.machine}).`);
  const served = await outlines.board(which);
  if ("error" in served) return toolError(served.error);
  const all = await componentsOf(outlines, served);
  if ("error" in all) return toolError(all.error);
  const brief = briefFor(all, names);
  return "error" in brief ? toolError(brief.error) : toolText(brief.text);
}

/** Every component of the outlines this server reads, as resources (an outline this caller can't read adds none). */
async function componentResources(outlines: McpOutlines): Promise<unknown[]> {
  const named = outlines.kind === "local" ? [{ outline: outlines.defaultOutline! }] : (await outlines.list()).filter(o => o.source !== "unreachable" && o.access && o.access !== "none").map(o => ({ outline: o.outline, machine: o.machine }));
  const out: unknown[] = [];
  for (const n of named) {
    const served = await outlines.board(n);
    if ("error" in served) continue;
    const all = await componentsOf(outlines, served).catch(() => null);
    if (!all || "error" in all) continue;
    for (const s of all) out.push({ uri: componentUri(served.board, s.id), name: `${s.id}@${served.board.address.outline}`, title: s.title, description: s.where, mimeType: "text/markdown" });
  }
  return out;
}

async function resourceRead(outlines: McpOutlines, uriValue: unknown): Promise<unknown> {
  const component = typeof uriValue === "string" ? COMPONENT_URI.exec(uriValue.trim()) : null;
  if (component) {
    const served = await outlines.board({ outline: component[1]!, machine: component[2]! });
    if ("error" in served) throw invalidParams(served.error);
    const all = await componentsOf(outlines, served);
    if ("error" in all) throw new RpcError(-32002, all.error);
    const brief = briefFor(all, [component[3]!]);
    if ("error" in brief) throw invalidParams(brief.error);
    return { contents: [{ uri: componentUri(served.board, component[3]!), mimeType: "text/markdown", text: brief.text }] };
  }
  const target = await addressedBlock(outlines, uriValue, undefined, false);
  if ("error" in target) throw invalidParams(target.error);
  const read = await recordForMcp(outlines, target, target.id);
  if ("error" in read) throw new RpcError(-32002, read.error);
  return { ...envelope(target.board, target.uri, read.access, read.record, read.record.revision), contents: [{ uri: target.uri, mimeType: "text/markdown", text: read.record.text }] };
}


const outlineProperty = (outlines: McpOutlines) => ({
  type: "string",
  description: outlines.defaultOutline
    ? `The outline a ref or search reads: <name> or <name>@${outlines.machine}. Default ${outlines.defaultOutline}. A uri names its own.`
    : `The outline a ref or search reads: <name> or <name>@<machine> (list_outlines lists them). A uri names its own.`,
});

/** The tools, described for the outlines this server reads. */
function toolsFor(outlines: McpOutlines) {
  const which = outlines.kind === "local" ? `the bound outline (${outlines.defaultOutline}@${outlines.machine})` : "an outline this server reads (list_outlines)";
  const grant = outlines.kind === "local" ? "this outline's local MCP access grant" : "the outline's MCP access grant (`ep0ch mcp access read`)";
  const addressSchema = {
    type: "object",
    properties: {
      uri: { type: "string", description: "The block's ep0ch:// URI; it names its outline (an outline that names another is refused)" },
      ref: { type: "string", description: "The block in `outline`: its id, ((id)), [[page]] or Work ID (PIE-123), as the outline's own links name it" },
      outline: outlineProperty(outlines),
    },
    additionalProperties: false,
    oneOf: [{ required: ["ref"] }, { required: ["uri"] }],
  };
  const seenProperty = {
    type: "array", items: { type: "string" }, maxItems: 1000,
    description: `Blocks you already hold, as "id@revision" (the id and revision of an earlier answer). One at that revision comes back as {id, revision, unchanged: true} instead of its body, like If-None-Match; one that changed since comes back whole.`,
  };
  const rawProperty = { type: "boolean", default: false, description: "Send a proposal or a comment as the block is stored. By default it points at its note (id@revision): a proposal as its diff, a comment as its own words and the span it is about." };
  return [
    {
      name: "list_outlines",
      description: "List the outlines this server reads: each one's machine, whether it is served live or from a read-only mirror or unreachable, and its MCP access setting. " +
        "A mirror's asOf is the newest change its copy holds, and copy says which file is served and when it last changed here. tools says whether the write tools are offered, and that a client caches its tool list until it reconnects.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "outline_read",
      description: `Read the block \`ref\` in ${which} as an enveloped block record JSON document; its reachability says whether it was read live or from a read-only mirror, and as of when. ` +
        `record.links are the notes it links to; record.backlinks the notes linking to it (outline_links lists the same, with where), so a note two notes link both ways appears in both. Requires ${grant}. Input: exactly one of uri or ref. ` +
        `A ref that is a Resource (resource:<id>, or a [file::path] token) reads as its stored text and the comment threads open on it (live outlines only): read a file's threads before rewriting it. ` +
        `A proposal or a comment reads as a pointer to the note it is on (its diff, or its words and the span), not a copy of the note (raw: true for the block as stored). ` +
        `seen ("id@revision" pairs you hold) answers a block you already have as {id, revision, unchanged: true}; a block already sent earlier in the same response (a batch) comes back as {id, revision, see}.`,
      inputSchema: { ...addressSchema, properties: { ...addressSchema.properties, seen: seenProperty, raw: rawProperty } },
    },
    {
      name: "outline_threads",
      description: `Read comment threads in ${which}. With a note (\`ref\`): that note's threads, each with its id (for outline_reply and outline_resolve_thread), open or resolved, the quote it is about and whether that passage is still in the note, and every comment and reply with its author (a person, or an agent such as mcp:daddy) and time, oldest first. ` +
        `Without a note: the outline's inbox, the open threads anywhere in it (outline names which; newest activity first), narrowed by lastFrom (who spoke last: an actor id such as evan or daddy), mentions (an @name in any comment) and since (an ISO time, or epoch ms): what a scheduled check asks. ` +
        `outline_read shows a note's threads compactly. The service doesn't record whether a comment asks for an answer: read the thread's last comment. Requires ${grant}.`,
      inputSchema: { ...addressSchema, properties: { ...addressSchema.properties,
        status: { type: "string", enum: ["all", "open", "resolved"], description: "Default all for a note, open for the inbox" },
        lastFrom: { type: "string", description: "Only threads whose last comment is from this person or agent" },
        mentions: { type: "string", description: "Only threads where a comment mentions this @name" },
        since: { type: ["string", "number"], description: "Only threads with activity at or after this ISO time (or epoch ms)" },
        limit: limitSchema(INBOX_NOTES, "Notes in the inbox"),
      }, oneOf: undefined, required: undefined },
    },
    {
      name: "outline_find",
      description: `Search ${which} with the same ranker as ep0ch find: lexical (title, text, properties) unless semantic is true, and search says which ranking it got and why. ` +
        `source and asOf say whether it searched the live outline or a read-only mirror; a top-level note's path is "${ROOT_PATH}". Requires ${grant}. Empty query lists index rows.`,
      inputSchema: { type: "object", properties: {
        query: { type: "string" },
        limit: { ...limitSchema(LIST_LIMIT, "Rows for an empty query"), description: `Matches: 1 to ${FIND_LIMIT.max} for a query (default ${FIND_LIMIT.fallback}); 1 to ${LIST_LIMIT.max} rows for an empty query (default ${LIST_LIMIT.fallback})` },
        semantic: { type: "boolean", default: false, description: "Ask for a semantic re-ranking (Jev) of the lexical candidates; the answer's search says whether it happened" },
        seen: seenProperty,
        outline: outlineProperty(outlines),
      }, additionalProperties: false },
    },
    {
      name: "outline_query",
      description: `Run a query in ${which}, read-only, in the grammar the views use ([query::…], virtual branches, ::graph-table): clauses like type=outbox-item outbox=next, AND/OR/NOT, groups, updated >= -7d, or a saved view by its block id. ` +
        `The outline evaluates it, so the rows are the ones a view shows in the door. Answers block records (title, properties, revision, uri) with total and completeness; more says there are further rows, nextOffset is where to continue. Requires ${grant}. Give query or view. ` +
        `To orient (what changed lately, in a few KB): query "updated >= -1d", sort "updated desc", fields "id,title,updated,actor,path", fold true; then outline_read the rows that are new, and pass seen on later reads. ` +
        `The service sorts, so limit takes the newest first. A projected row (fields) never carries the body. fold collapses the proposals, comments and deliveries into their note: "PIE-637 · 3 changes (1 proposal, 2 comments)".`,
      inputSchema: { type: "object", properties: {
        query: { type: "string", description: "A query in the views' grammar: type=ticket NOT work-stage=done" },
        view: { type: "string", description: "A saved view's block id (or ((id)))" },
        sort: { type: "string", description: `The order, by the service: "updated desc", "created", or "<property key> asc" (direction asc by default). Not with view: a saved view has its own order.` },
        fields: { type: ["string", "array"], items: { type: "string" }, description: `The columns of each row instead of the whole record: ${FIELD_NAMES.join(", ")}, or any property key ("id,title,updated,actor,path"). id and revision are always there; the body never is (outline_read).` },
        under: { type: "string", description: "Only blocks under this note (its subtree): its id, ((id)), [[page]] or Work ID, as ref names a block" },
        fold: { type: "boolean", default: false, description: "Fold proposals, comments and deliveries into the note they belong to, with a count (changes: {count, proposals, comments, deliveries, summary, ids}); total counts folded rows" },
        seen: seenProperty,
        raw: rawProperty,
        limit: limitSchema(QUERY_LIMIT_RULE, "Records per page"),
        offset: { type: "integer", minimum: 0, default: 0, description: "Where this page starts: a previous answer's nextOffset" },
        outline: outlineProperty(outlines),
      }, additionalProperties: false },
    },
    {
      name: "outline_links",
      description: `Read the authored outlinks, resources and backlinks of the block \`ref\` in ${which}, each group cut at limit; completeness says per group whether it is whole, how many it shows and the total. Requires ${grant}. Input: exactly one of uri or ref.`,
      inputSchema: { ...addressSchema, properties: { ...addressSchema.properties, limit: limitSchema(LINKS_LIMIT, "Entries per group (links, resources, backlinks)") } },
    },
    {
      name: "outline_components",
      description: `The components a note can hold in ${which}, as an agent reads them: per component its purpose, where it goes, each property as key: values (default) — meaning, and a minimal example. ` +
        `The outline's own heading styles, callout types and extensions' components are among them. Also served as resources (ep0ch://<outline>@<machine>/components/<id>). Requires ${grant}.`,
      inputSchema: { type: "object", properties: {
        components: { type: "array", items: { type: "string" }, description: "Component ids (heading-style, callout, …); leave out for all" },
        outline: outlineProperty(outlines),
      }, additionalProperties: false },
    },
  ];
}

/** outline_new and outline_archive: offered to a caller when the server can reach its machine's outline host. */
const adminTools = (outlines: McpOutlines, caller: McpCaller | undefined) => caller && outlines.admin ? outlineAdminDefinitions(outlines.admin.machine) : [];

/** Whether the write tools are offered: to a caller (the gateway's token, stdio's client), when some outline it can reach takes writes. One rule for both transports. */
const writesOffered = (caller: McpCaller | undefined, listed: McpOutlineListing[]) => !!caller && listed.some(o => !!o.writes);
async function offersWrites(outlines: McpOutlines, caller: McpCaller | undefined): Promise<boolean> {
  return !!caller && writesOffered(caller, await outlines.list(caller));
}

/** Said wherever access changes: a connected client keeps the tool list it fetched. */
export const RECONNECT_HINT = "an MCP client keeps the tool list it fetched when it connected (claude.ai until the connector reconnects): reconnect it to see the write tools appear or go (some clients also need their tool list refreshed after the reconnect: in Claude Code, RefreshMcpTools)";

async function listOutlines(outlines: McpOutlines, caller: McpCaller | undefined): Promise<ToolResult> {
  const listed = await outlines.list(caller);
  const writes = writesOffered(caller, listed);
  const taking = listed.filter(o => o.writes).map(o => `${o.outline}@${o.machine}`);
  return toolText({
    outlines: listed,
    tools: {
      writes,
      said: writes
        ? `write tools (${MCP_WRITE_TOOL_NAMES}) are offered: ${taking.join(", ")} take${taking.length === 1 ? "s" : ""} writes. If they aren't among your tools, ${RECONNECT_HINT}`
        : `no outline here takes writes, so only the read tools are offered; after \`ep0ch mcp access propose\` or \`full\` on an outline, ${RECONNECT_HINT}`,
    },
  });
}

/** A call that works, per tool, for the corrective error (tool-args.ts). */
const MCP_EXAMPLES: Record<string, Record<string, unknown>> = {
  list_outlines: {},
  outline_read: { ref: "PIE-123" },
  outline_threads: { ref: "PIE-123" },
  outline_find: { query: "seed swap" },
  outline_query: { query: "updated >= -1d", sort: "updated desc", fields: "id,title,updated,actor,path", fold: true },
  outline_links: { ref: "PIE-123" },
  outline_components: { components: ["callout"] },
  outline_create: { ref: "PIE-123", text: "Bring labels" },
  outline_patch: { ref: "PIE-123", revision: 3, patches: [{ observed: "Borlotti", replacement: "Borlotti only" }] },
  outline_comment: { ref: "PIE-123", body: "Is this still true?", whole: true },
  outline_reply: { ref: "PIE-123", thread: "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11", body: "Yes, checked today." },
  outline_resolve_thread: { ref: "PIE-123", thread: "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11", resolved: true },
  outline_set_property: { ref: "PIE-123", key: "status", value: "open", revision: 3 },
  outline_assign_id: { ref: "PIE-123", revision: 3 },
  outline_write_status: { queueId: "q-1" },
  ...OUTLINE_ADMIN_EXAMPLES,
};

/**
 * The arguments of a tool call, checked once for every tool against the schema the tool is listed with: `ref`'s
 * aliases renamed, an unknown, missing or mistyped argument answered with the schema line and a call that works.
 * Undefined for a tool this server doesn't offer (callTool says so).
 */
function checkedMcpArgs(outlines: McpOutlines, name: string, argsValue: unknown, caller?: McpCaller): { args: Record<string, unknown> } | { error: string } | undefined {
  const writes = !!caller;
  const definitions = [...toolsFor(outlines), ...(writes ? [...writeToolDefinitions(outlineProperty(outlines)), writeStatusDefinition] : []), ...adminTools(outlines, caller)];
  const definition = definitions.find(d => d.name === name);
  if (!definition) return undefined;
  // `limit` keeps limitOf's own answer, which names the tool's default and maximum.
  const schema = definition.inputSchema as ToolSchema;
  const { limit, ...others } = schema.properties ?? {};
  const checked = checkToolArgs({ name, schema: limit ? { ...schema, properties: { ...others, limit: { description: limit.description } } } : schema, example: MCP_EXAMPLES[name] ?? {}, ...(name === "outline_query" ? { aliases: { under: ["subtreeRootId", "subtree", "root"], fields: ["columns", "project"] } } : {}) }, argsValue);
  return checked.ok ? { args: checked.args } : { error: checked.error };
}

async function callTool(outlines: McpOutlines, paramsValue: unknown, caller?: McpCaller, scope?: ResponseScope): Promise<ToolResult> {
  const params = objectFields(paramsValue);
  if (!params || typeof params.name !== "string") throw invalidParams("tools/call needs a tool name.");
  const checked = checkedMcpArgs(outlines, params.name, params.arguments, caller);
  if (checked && "error" in checked) return toolError(checked.error);
  const args = checked?.args ?? objectFields(params.arguments) ?? {};
  if (params.name === "list_outlines") return listOutlines(outlines, caller);
  if (params.name === "outline_read") return readRecord(outlines, args, caller, scope);
  if (params.name === "outline_threads") return threadsTool(outlines, args);
  if (params.name === "outline_query") return queryTool(outlines, args, scope);
  if (params.name === "outline_write_status" && caller) return writeStatusTool(outlines, args, caller);
  if ((params.name === "outline_new" || params.name === "outline_archive") && caller && outlines.admin) return adminTool(outlines, outlines.admin, params.name, args, caller);
  if (params.name === "outline_find") return findBlocks(outlines, args);
  if (params.name === "outline_links") return linkData(outlines, args);
  if (params.name === "outline_components") return componentsTool(outlines, args);
  if (isWriteTool(params.name) && caller) return writeTool(outlines, params.name, args, caller);
  throw invalidParams(`Unknown tool ${params.name}.`);
}

async function adminTool(outlines: McpOutlines, admin: McpOutlineAdmin, tool: "outline_new" | "outline_archive", args: Record<string, unknown>, caller: McpCaller): Promise<ToolResult> {
  const actor = actorOf(caller, admin.env, admin.machine);
  try {
    const done = tool === "outline_new" ? await outlineNew(admin, args, caller) : await outlineArchive(admin, args, caller);
    if ("error" in done) { outlines.log?.(`mcp ${tool}: ${actor.actorId} (${caller.sub}): refused: ${done.error}`); return toolError(done.error); }
    outlines.log?.(`mcp ${tool}: ${actor.actorId} (${caller.sub}) ${String(args.name)}: ${String(done.ok.outcome)}`);
    // A server bound to boards (stdio) serves what it made or brought back, and lets go of what it put away.
    if (tool === "outline_new" || (tool === "outline_archive" && args.restore === true)) {
      const board = outlines.adopt ? await admin.open(String(args.name)) : undefined;
      if (board && !("error" in board)) outlines.adopt!(board as unknown as Board);
    } else outlines.release?.(String(args.name));
    return toolText({ ...done.ok, by: actorLabel(actor.actorId) });
  } catch (e) { return toolError((e as Error).message); }
}

const writeRefusal = (outlines: McpOutlines, { board, served }: McpBoard, level: McpAccessLevel) =>
  `MCP access is ${level} for ${board.address.outline}@${board.address.machine}${served.source === "mirror" ? ` (as its mirror on ${outlines.machine} carries it)` : ""}, which takes no writes; ` +
  `its owner runs \`ep0ch mcp access propose --ws ${board.address.outline}\` (proposals) or \`… full …\` (applied) on ${board.address.machine} to allow them.`;

/**
 * A write tool: the block addressed as the reads address it, checked against the outline's access, then applied
 * (src/mcp-writes.ts) on a live outline, or queued for its home machine when it is served from a mirror.
 */
async function writeTool(outlines: McpOutlines, tool: McpWriteTool, args: Record<string, unknown>, caller: McpCaller): Promise<ToolResult> {
  const shape = writeInput(tool, args);
  if ("error" in shape) return toolError(shape.error);
  const resourceRef = tool === "outline_comment" ? refArg(args) : undefined;
  if (resourceRef && await isResourceRef(resourceRef)) {
    const target = await resourceBoard(outlines, args);
    if ("error" in target) return toolError(target.error);
    const status = withLevel(await target.board.mcpAccessStatus(), caller);
    if (!writesAt(status.level)) return toolError(writeRefusal(outlines, target, status.level));
    if (target.home) return toolError(`${target.board.address.outline} lives on ${target.home.machine}: a comment on a Resource isn't queued; make it there.`);
    try {
      const done = await commentOnResourceOn(target.board, resourceRef, shape.input, actorOf(caller));
      return toolText({ outcome: done.outcome, uri: done.uri, outline: target.board.address.outline, machine: target.board.address.machine, said: done.said, detail: done.detail });
    } catch (e) { return toolError((e as Error).message); }
  }
  const target = await addressedBlock(outlines, refArg(args), args.outline);
  if ("error" in target) return toolError(target.error);
  const { board } = target;
  const status = withLevel(await target.board.mcpAccessStatus(), caller);
  if (!status.canRead) return toolError(accessRefusal(outlines, target, status.level));
  if (!writesAt(status.level)) return toolError(writeRefusal(outlines, target, status.level));
  if (tool === "outline_assign_id") { const why = assignIdRefusal(status.level); if (why) return toolError(why); }
  const record = (await board.records([target.id])).records.find(r => r.id === target.id);
  if (!record) return toolError(`No block ${target.id} in ${board.address.outline}${target.served.source === "mirror" ? `'s mirror (as of ${target.served.asOf})` : ""}.`);
  const actor = actorOf(caller);
  // How old the base a write was made against is: a mirror lags the laptop, so a revision read from it may be behind.
  const ageMin = Math.max(0, Math.round((Date.now() - Date.parse(target.served.asOf)) / 60_000));
  const base = { source: target.served.source, asOf: target.served.asOf, ageMinutes: target.served.source === "mirror" ? ageMin : 0 };
  const where = { outline: board.address.outline, machine: board.address.machine };
  try {
    if (target.home) {
      if (!outlines.netmail) return toolError(`${where.outline} lives on ${target.home.machine}, and this server has nowhere to queue writes for it.`);
      const entry = outlines.netmail.queue({
        machine: target.home.machine, outline: where.outline, uri: target.uri, blockId: target.id, tool, input: shape.input,
        revision: shape.revision ?? null, mirrorRevision: record.revision ?? null, textHash: textHash(record.text), instanceId: target.home.instanceId,
        level: status.level, actorId: actor.actorId, subject: caller.sub, clientId: caller.clientId ?? null,
      });
      const q = outlines.netmail.summary(target.home.machine);
      const seen = q?.lastPull ? `${target.home.machine} last pulled ${q.lastPull}` : `${target.home.machine} hasn't pulled yet`;
      outlines.log?.(`mcp write: ${actor.actorId} (${caller.sub}) ${tool} ${target.uri}: queued ${entry.id}`);
      return toolText({
        outcome: "queued", id: entry.id, queueId: entry.id, uri: target.uri, ...where, queuedFor: `${where.outline}@${target.home.machine}`, queuedAt: entry.queuedAt,
        waiting: q?.waiting ?? 1, lastPull: q?.lastPull ?? null, base,
        said: `queued for ${where.outline}@${target.home.machine} (${seen}); it lands when ${target.home.machine} pulls it (outline_write_status ${entry.id} follows it), ${status.level === "full" ? "applied, or proposed if the note changed meanwhile" : "as a proposal"}, and the mirror shows it after that; the base you wrote against is the mirror as of ${base.asOf} (~${base.ageMinutes} min old)`,
      });
    }
    // Served live from a machine this server also queues for: writes made while it was away wait for its pull, and the
    // service checks each one's revision then, so a write made now and one made before never apply twice.
    const earlier = target.queuedFor && outlines.netmail ? outlines.netmail.pending(target.queuedFor, where.outline, target.id, { actorId: actor.actorId, subject: caller.sub }).filter(w => w.state === "queued") : [];
    const done = await applyWrite(board, { ...shape, blockId: target.id }, { level: status.level, actor, uri: id => blockUri(board, id) });
    // Kept with the queued writes: a read that falls back to the mirror lays it over the note until the copy catches up.
    if (target.queuedFor && outlines.netmail) {
      const d = done.detail as { edits?: { blockId: string; revision?: number }[]; revision?: number } | undefined;
      const revision = d?.edits?.find(e => e.blockId === target.id)?.revision ?? (tool === "outline_create" ? d?.revision : undefined);
      try {
        outlines.netmail.live({
          machine: target.queuedFor, outline: where.outline, uri: target.uri, blockId: target.id, tool, input: shape.input, revision: shape.revision ?? null,
          mirrorRevision: record.revision ?? null, textHash: textHash(record.text), instanceId: board.outlineInstanceId, level: status.level, actorId: actor.actorId, subject: caller.sub, clientId: caller.clientId ?? null,
        }, { state: done.outcome, said: done.said, uri: done.uri, ...(done.outcome === "applied" && revision !== undefined ? { revision } : {}) });
      } catch (e) { outlines.log?.(`mcp write: couldn't record the live write for the mirror's overlay: ${(e as Error).message}`); }
    }
    outlines.log?.(`mcp write: ${actor.actorId} (${caller.sub}) ${tool} ${target.uri}: ${done.outcome}${target.served.machine ? ` live on ${target.served.machine}` : ""}`);
    const waitingNote = earlier.length ? `; ${earlier.length} earlier write${earlier.length === 1 ? "" : "s"} of yours to this note ${earlier.length === 1 ? "is" : "are"} still queued for ${target.queuedFor} and apply when it pulls, each checked against the note's revision then (outline_write_status follows them)` : "";
    return toolText({ outcome: done.outcome, uri: done.uri, by: actorLabel(actor.actorId), ...where, base, ...(target.served.machine ? { source: "live", machine: target.served.machine } : {}), ...(earlier.length ? { queuedEarlier: earlier.map(w => w.id) } : {}), said: `${done.said}${waitingNote}`, detail: done.detail });
  } catch (e) {
    outlines.log?.(`mcp write: ${actor.actorId} (${caller.sub}) ${tool} ${target.uri}: refused: ${(e as Error).message}`);
    return toolError((e as Error).message);
  }
}

function resultFor(outlines: McpOutlines, req: RpcRequest, caller?: McpCaller, scope?: ResponseScope): Promise<unknown> | unknown {
  switch (req.method) {
    case "initialize":
      return { protocolVersion: protocolFor(objectFields(req.params)?.protocolVersion), capabilities: { tools: {}, resources: {} }, serverInfo: { name: "ep0ch", version: "0.0.0" } };
    case "ping":
      return {};
    case "tools/list":
      return offersWrites(outlines, caller).then(w => ({ tools: [...toolsFor(outlines), ...(w ? [...writeToolDefinitions(outlineProperty(outlines)), writeStatusDefinition] : []), ...adminTools(outlines, caller)] }));
    case "tools/call":
      return callTool(outlines, req.params, caller, scope);
    case "resources/list":
      return componentResources(outlines).then(resources => ({ resources }));
    case "resources/templates/list": {
      const outline = outlines.kind === "local" ? outlines.defaultOutline! : "{outline}";
      const machine = outlines.kind === "local" ? outlines.machine : "{machine}";
      return { resourceTemplates: [{ uriTemplate: `ep0ch://${outline}@${machine}/b/{blockId}`, name: "ep0ch block", description: outlines.kind === "local" ? "A block in the bound outline" : "A block in an outline this server reads (list_outlines)", mimeType: "text/markdown" }] };
    }
    case "resources/read": {
      const params = objectFields(req.params);
      if (!params) throw invalidParams("resources/read needs a uri.");
      return resourceRead(outlines, params.uri);
    }
    case "prompts/list":
      return { prompts: [] };
    default:
      throw new RpcError(-32601, `Method not found: ${req.method ?? ""}`);
  }
}

type ParsedMessage = RpcRequest | { invalidRequest: string; id: RpcId };

function requestId(fields: Record<string, unknown>): RpcId | undefined {
  return typeof fields.id === "string" || typeof fields.id === "number" || fields.id === null ? fields.id : fields.id === undefined ? undefined : null;
}

function parseMessage(value: unknown): ParsedMessage {
  const fields = objectFields(value);
  if (!fields) return { invalidRequest: "JSON-RPC messages must be objects.", id: null };
  const id = requestId(fields);
  if (fields.jsonrpc !== "2.0") return { invalidRequest: "JSON-RPC jsonrpc must be \"2.0\".", id: id ?? null };
  const method = stringField(fields, "method");
  if (!method) return { invalidRequest: "JSON-RPC method must be a string.", id: id ?? null };
  return { jsonrpc: "2.0", id, method, params: fields.params };
}

function parseRequest(line: string): ParsedMessage[] | { parseError: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    if (Array.isArray(value)) return value.length ? value.map(parseMessage) : [{ invalidRequest: "JSON-RPC batch must not be empty.", id: null }];
    return [parseMessage(value)];
  } catch (e) { return { parseError: (e as Error).message }; }
}

const responseError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function responseFor(outlines: McpOutlines, req: ParsedMessage, caller?: McpCaller, scope?: ResponseScope): Promise<unknown | null> {
  if ("invalidRequest" in req) return responseError(req.id, -32600, req.invalidRequest);
  if (req.id === undefined) return null;
  if (scope) scope.rpc = req.id;
  try { return { jsonrpc: "2.0", id: req.id, result: await resultFor(outlines, req, caller, scope) }; }
  catch (e) {
    if (e instanceof RpcError) return responseError(req.id, e.code, e.message);
    return responseError(req.id, -32603, outlines.internalError?.(e as Error) ?? (e as Error).message);
  }
}

/** The most messages one batch may carry. */
export const MAX_BATCH = 16;

/** What answering one JSON-RPC message (or batch) asked for: `methods` for a log line, `malformed` for a bad body. */
export interface McpAnswer { reply: unknown | null; methods: string[]; malformed?: boolean }

/**
 * One JSON-RPC message or batch in, its answer out (`reply` null when every message was a notification). The one
 * implementation both transports call: stdio a line at a time, the HTTP gateway a request body at a time. `caller`:
 * who the gateway's token names, to whom (and only to whom) the write tools are offered.
 */
export async function answerMcp(outlines: McpOutlines, text: string, caller?: McpCaller): Promise<McpAnswer | null> {
  const parsed = parseRequest(text);
  if (!parsed) return null;
  if ("parseError" in parsed) return { reply: responseError(null, -32700, parsed.parseError), methods: [], malformed: true };
  if (parsed.length > MAX_BATCH) return { reply: responseError(null, -32600, `A batch carries at most ${MAX_BATCH} messages.`), methods: [], malformed: true };
  const methods = parsed.flatMap(req => "method" in req && req.method ? [req.method === "tools/call" ? `tools/call ${String(objectFields(req.params)?.name ?? "")}` : req.method] : []);
  const responses: unknown[] = [];
  // One reply, one memory: a body a batch sent once is not sent again by a later call in it.
  const scope = new ResponseScope();
  for (const req of parsed) { const r = await responseFor(outlines, req, caller, scope); if (r !== null) responses.push(r); }
  return { reply: responses.length ? (parsed.length === 1 ? responses[0] : responses) : null, methods };
}

/** The subject a stdio caller has: there is no token, so one fixed name; its client name is what tells callers apart. */
export { STDIO_SUBJECT };

/** The `clientInfo.name` of an `initialize` request in this line, if it is one. */
function clientNamed(line: string): string | undefined {
  if (!line.includes("initialize")) return undefined;
  try {
    for (const m of [JSON.parse(line)].flat()) {
      const name = m?.method === "initialize" ? m.params?.clientInfo?.name : undefined;
      if (typeof name === "string" && name.trim()) return name.trim().slice(0, 64);
    }
  } catch { /* not JSON: answerMcp says so */ }
  return undefined;
}

function mcpArgs(argsIn: string[]): string[] | { error: string } {
  const args = argsIn.slice(1), out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--ws" || a === "--machine") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) return { error: `${a} needs a value` };
      out.push(a, v); i++; continue;
    }
    return { error: `mcp doesn't take ${JSON.stringify(a)}; use --ws <name> and --machine <ssh-name>` };
  }
  return out;
}

function mcpAccessArgs(argsIn: string[]): { boardArgs: string[]; level?: McpAccessLevel; json: boolean } | { error: string } {
  const args = argsIn.slice(2), boardArgs: string[] = [];
  let level: McpAccessLevel | undefined, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") { json = true; continue; }
    if (a === "--ws" || a === "--machine") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) return { error: `${a} needs a value` };
      boardArgs.push(a, v); i++; continue;
    }
    if ((MCP_ACCESS_LEVELS as readonly string[]).includes(a)) {
      if (level) return { error: `mcp access takes one level, got ${level} and ${a}` };
      level = a as McpAccessLevel; continue;
    }
    return { error: `mcp access doesn't take ${JSON.stringify(a)}; use none, read, propose or full` };
  }
  return { boardArgs, level, json };
}

const ACCESS_SAYS: Record<McpAccessLevel, string> = {
  none: " (denied)",
  read: " (read-only MCP allowed, stdio and the remote gateway)",
  propose: " (reads, and writes as proposals for you to apply, over stdio and the remote gateway alike)",
  full: " (reads, and writes applied, checked against the revision they read; a note open in your draft gets a proposal instead; stdio and the remote gateway alike)",
};

async function mcpAccessCommand(argsIn: string[], io: McpIo): Promise<number> {
  const parsed = mcpAccessArgs(argsIn);
  const err = io.err ?? console.error;
  const write = io.write ?? (line => process.stdout.write(`${line}\n`));
  if ("error" in parsed) { err(`ep0ch: ${parsed.error}`); return 2; }
  const board = await boardFor(parsed.boardArgs);
  if ("error" in board) { err(`ep0ch: ${board.error}`); return 1; }
  try {
    const was = parsed.level ? (await board.mcpAccessStatus()).level : undefined;
    const status = parsed.level ? await board.configureMcpAccess(parsed.level) : await board.mcpAccessStatus();
    // Whether the gateway's write tools come or go with this change: a connected client won't see it until it reconnects.
    const toolsChanged = was !== undefined && !!writesAt(was) !== !!writesAt(status.level);
    if (parsed.json) write(JSON.stringify({ outline: board.address.outline, machine: board.address.machine, ...status, ...(toolsChanged ? { reconnect: RECONNECT_HINT } : {}) }, null, 2));
    else {
      write(`MCP access for ${board.address.outline}@${board.address.machine}: ${status.level}${ACCESS_SAYS[status.level]}`);
      if (toolsChanged) write(`  ${RECONNECT_HINT}`);
    }
    return 0;
  } finally { board.close(); }
}


export async function mcpCommand(argsIn: string[], io: McpIo = {}): Promise<number> {
  if (argsIn[1] === "access") return mcpAccessCommand(argsIn, io);
  if (argsIn[1] === "serve") { const { mcpServeCommand } = await import("./mcp-gateway"); return mcpServeCommand(argsIn.slice(2), io); }
  if (argsIn[1] === "queue" || argsIn[1] === "pull") {
    const out = io.write ?? (line => process.stdout.write(`${line}\n`)), err = io.err ?? console.error;
    if (argsIn[1] === "queue") { const { queueCommand } = await import("./mcp-netmail"); return queueCommand(argsIn.slice(2), { out, err }); }
    const { pullCommand } = await import("./backup/netmail"); return pullCommand(argsIn.slice(2), { out, err });
  }
  const parsedArgs = mcpArgs(argsIn);
  const err = io.err ?? console.error;
  if ("error" in parsedArgs) { err(`ep0ch: ${parsedArgs.error}`); return 2; }
  const board = await boardFor(parsedArgs);
  if ("error" in board) { err(`ep0ch: ${board.error}`); return 1; }
  const outlines = boundOutlines(board, localAdmin());
  const write = io.write ?? (line => process.stdout.write(`${line}\n`));
  try {
    // No token on stdio: the caller is the client the MCP `initialize` names, written as `mcp:<client>` (and mapped by
    // EP0CH_MCP_PERSONAS) exactly as the gateway's callers are.
    let clientId: string | undefined;
    for await (const line of io.input ?? stdinLines()) {
      clientId = clientNamed(line) ?? clientId;
      const answer = await answerMcp(outlines, line, { sub: STDIO_SUBJECT, ...(clientId ? { clientId } : {}) });
      if (answer?.reply) write(JSON.stringify(answer.reply));
    }
    return 0;
  } finally { board.close(); }
}
