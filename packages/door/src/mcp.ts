// An MCP server for ep0ch:// block resources: one implementation, two transports. `ep0ch mcp` serves it over stdio,
// bound to the outline this process can already open, and only reads; `ep0ch mcp serve --http` (src/mcp-gateway.ts)
// serves it over streamable HTTP behind OAuth, for this machine's outlines and read-only mirrors of other machines'
// (src/mcp-mirror.ts), and adds the write tools (src/mcp-writes.ts) for a caller its token names. Both answer through
// `responseFor` with an `McpOutlines` saying which outlines they read; each outline's own access setting gates every
// read and write, and every answer says where it came from (`source`: live or mirror, and `asOf`). A write to a mirror's
// outline never touches the mirror: it queues for the outline's home machine (src/mcp-netmail.ts).
import { createInterface } from "node:readline";
import { boardFor, canonicalLocalMachineName, everyNote, type Found, type NotesBoard } from "./notes-cli";
import { OUTLINE_NAME, previewTitle, type McpReachability, type McpSource } from "./socket";
import { MCP_ACCESS_LEVELS, type McpAccessLevel, type McpAccessStatus } from "@ep0ch/outline-core/protocol";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { formatEp0chBlockUri, namesOutline, parseAddressedBlock, sameMachine } from "@ep0ch/outline-core/addressable-resource";
import { QUEUE_USAGE, textHash, type NetmailEntry, type NetmailSummary } from "./mcp-netmail";
import { actorOf, applyWrite, isWriteTool, MCP_WRITE_TOOLS, resolveBoardRef, writeInput, writesAt, writeToolDefinitions, type McpCaller, type McpWriteTool } from "./mcp-writes";

export const MCP_USAGE = `  ep0ch mcp [--ws <name>] [--machine <ssh-name>]
                                   read-only local MCP server for ep0ch:// block resources after \`ep0ch mcp access read\`:
                                   tools list_outlines, outline_read, outline_find, outline_links; resources/read with envelope
  ep0ch mcp serve --http [--port <n>] [--bind <address>] [--ws <default outline>]
                                   the same server over streamable HTTP for remote clients (claude.ai), an OAuth resource
                                   server for this machine's outlines (and EP0CH_MCP_REMOTE's, live or from a mirror);
                                   needs EP0CH_MCP_RESOURCE, CLERK_PUBLISHABLE_KEY (or EP0CH_MCP_ISSUER) and
                                   EP0CH_MCP_ALLOWED_SUBJECTS (unset: refuse and log who asked)
  ep0ch mcp access [none|read|propose|full] [--json] [--ws <name>] [--machine <ssh-name>]
                                   show or set this outline's persisted MCP access grant (stdio and the gateway alike):
                                   propose and full let the gateway's write tools (outline_create, outline_patch,
                                   outline_comment, outline_set_property) propose or apply; a mirror's outline queues them
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
export interface McpBoard { board: Board; served: McpServed; home?: { machine: string; instanceId: string | null } }

/** Served live, read now. */
export const servedLive = (now = Date.now()): McpServed => ({ source: "live", asOf: new Date(now).toISOString() });

/** One outline as `list_outlines` shows it: where it lives, how it is served now, and its access setting. */
export interface McpOutlineListing {
  outline: string;
  machine: string;
  uri: string;
  /** `unreachable`: a mirror this server was told of that has no copy here yet. */
  source: McpServed["source"] | "unreachable";
  asOf?: string;
  access?: McpAccessLevel;
  /** What a write to it becomes: applied or proposed here, or queued for its home machine; absent when it takes none. */
  writes?: "applied" | "proposals" | "queued";
  /** A mirror's queued writes: how many wait, the oldest, and when its home machine last pulled. */
  queue?: { waiting: number; oldest: string | null; lastPull: string | null; said?: string };
  note?: string;
}

/** Where a remote server queues writes for other machines' outlines (src/mcp-netmail.ts). */
export interface McpQueue {
  queue(entry: Omit<NetmailEntry, "id" | "queuedAt">): NetmailEntry;
  summary(machine: string): NetmailSummary | null;
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
  list(): Promise<McpOutlineListing[]>;
  /** The outline a find or bare ref reads when none is named, if this server has one. */
  defaultOutline?: string;
  /** What a caller is told of an unexpected failure (the gateway logs it and says less); else its message. */
  internalError?: (e: Error) => string;
  /** Where writes to a mirror's outline wait (the gateway's); without one, they are refused. */
  netmail?: McpQueue;
  /** A line for the server's log (the gateway's): each write and what it became. */
  log?: (line: string) => void;
}

const uriOrName = (named: NamedOutline, machine: string) => named.machine ? `ep0ch://${named.outline}@${named.machine}` : `outline ${named.outline}@${machine}`;

/** The stdio server's outlines: the one board it was started on. */
export function boundOutlines(board: Board): McpOutlines {
  const bound = board.address;
  return {
    kind: "local",
    machine: bound.machine,
    defaultOutline: bound.outline,
    async board(named) {
      if (!named || namesOutline({ outline: named.outline, machine: named.machine ?? bound.machine }, bound)) return { board, served: servedLive() };
      return { error: `${uriOrName(named, bound.machine)} names ${named.outline}@${named.machine ?? bound.machine}; this MCP server is bound to ${bound.outline}@${bound.machine}` };
    },
    async list() {
      return [{ ...bound, uri: `ep0ch://${bound.outline}@${bound.machine}`, ...servedLive(), access: (await board.mcpAccessStatus()).level }];
    },
  };
}

const toolText = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const toolError = (message: string): ToolResult => ({ isError: true, content: [{ type: "text", text: message }] });
const objectFields = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

async function requireReadAccess(outlines: McpOutlines, target: McpBoard): Promise<McpAccessStatus | { error: string }> {
  const status = await target.board.mcpAccessStatus();
  if (!status.canRead) return { error: accessRefusal(outlines, target, status.level) };
  return status;
}

/** Where an answer came from, in words: nothing for a live outline, as before. */
const servedWords = (outlines: McpOutlines, { served }: McpBoard) =>
  served.source === "mirror" ? `, read-only mirror on ${outlines.machine} as of ${served.asOf}${served.note ? `: ${served.note}` : ""}` : "";

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
export type McpRecord = Omit<BlockRecord, "text" | "header" | "links"> & { links: Omit<BlockRecord["links"][number], "spans">[] };
export const mcpRecord = ({ text: _text, header: _header, links, ...rest }: BlockRecord): McpRecord =>
  ({ ...rest, links: links.map(({ spans: _spans, ...link }) => link) });

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


async function readRecord(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const target = await addressedBlock(outlines, stringField(args, "uri") ?? stringField(args, "ref"), args.outline);
  if ("error" in target) return toolError(target.error);
  const read = await recordForMcp(outlines, target, target.id);
  if ("error" in read) return toolError(read.error);
  return toolText(envelope(target.board, target.uri, read.access, read.record, read.record.revision));
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
  let rows: Found[], more: boolean, search: ReturnType<typeof semanticSays> | undefined;
  if (query) {
    const found = await board.searchBlocks(query, askSemantic ? { semantic: true } : {});
    rows = found.matches.slice(0, limit).map(m => ({ id: m.block.id, title: m.title, path: pathOf(m.path), uri: blockUri(board, m.block.id) }));
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
  const target = await addressedBlock(outlines, stringField(args, "uri") ?? stringField(args, "ref"), args.outline);
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

async function resourceRead(outlines: McpOutlines, uriValue: unknown): Promise<unknown> {
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
    oneOf: [{ required: ["uri"] }, { required: ["ref"] }],
  };
  return [
    {
      name: "list_outlines",
      description: "List the outlines this server reads: each one's machine, whether it is served live or from a read-only mirror or unreachable, and its MCP access setting. " +
        "A mirror's asOf is the newest change its copy holds, and copy says which file is served and when it last changed here. tools says whether the write tools are offered, and that a client caches its tool list until it reconnects.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "outline_read",
      description: `Read one block in ${which} as an enveloped block record JSON document; its reachability says whether it was read live or from a read-only mirror, and as of when. ` +
        `record.links are the notes it links to; record.backlinks the notes linking to it (outline_links lists the same, with where), so a note two notes link both ways appears in both. Requires ${grant}. Input: exactly one of uri or ref.`,
      inputSchema: addressSchema,
    },
    {
      name: "outline_find",
      description: `Search ${which} with the same ranker as ep0ch find: lexical (title, text, properties) unless semantic is true, and search says which ranking it got and why. ` +
        `source and asOf say whether it searched the live outline or a read-only mirror; a top-level note's path is "${ROOT_PATH}". Requires ${grant}. Empty query lists index rows.`,
      inputSchema: { type: "object", properties: {
        query: { type: "string" },
        limit: limitSchema(FIND_LIMIT, `Matches for a query (an empty query lists up to ${LIST_LIMIT.max}, default ${LIST_LIMIT.fallback})`),
        semantic: { type: "boolean", default: false, description: "Ask for a semantic re-ranking (Jev) of the lexical candidates; the answer's search says whether it happened" },
        outline: outlineProperty(outlines),
      }, additionalProperties: false },
    },
    {
      name: "outline_links",
      description: `Read a block's authored outlinks, resources and backlinks in ${which}, each group cut at limit; completeness says per group whether it is whole, how many it shows and the total. Requires ${grant}. Input: exactly one of uri or ref.`,
      inputSchema: { ...addressSchema, properties: { ...addressSchema.properties, limit: limitSchema(LINKS_LIMIT, "Entries per group (links, resources, backlinks)") } },
    },
  ];
}

/** Whether the write tools are offered: to a remote caller, when some outline it can reach takes writes. */
const writesOffered = (outlines: McpOutlines, caller: McpCaller | undefined, listed: McpOutlineListing[]) =>
  !!caller && outlines.kind === "remote" && listed.some(o => !!o.writes);
async function offersWrites(outlines: McpOutlines, caller: McpCaller | undefined): Promise<boolean> {
  return !!caller && outlines.kind === "remote" && writesOffered(outlines, caller, await outlines.list());
}

/** Said wherever access changes: a connected client keeps the tool list it fetched. */
export const RECONNECT_HINT = "an MCP client keeps the tool list it fetched when it connected (claude.ai until the connector reconnects): reconnect it to see the write tools appear or go";

async function listOutlines(outlines: McpOutlines, caller: McpCaller | undefined): Promise<ToolResult> {
  const listed = await outlines.list();
  if (outlines.kind !== "remote") return toolText({ outlines: listed });
  const writes = writesOffered(outlines, caller, listed);
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

async function callTool(outlines: McpOutlines, paramsValue: unknown, caller?: McpCaller): Promise<ToolResult> {
  const params = objectFields(paramsValue);
  if (!params || typeof params.name !== "string") throw invalidParams("tools/call needs a tool name.");
  const args = objectFields(params.arguments) ?? {};
  if (params.name === "list_outlines") return listOutlines(outlines, caller);
  if (params.name === "outline_read") return readRecord(outlines, args);
  if (params.name === "outline_find") return findBlocks(outlines, args);
  if (params.name === "outline_links") return linkData(outlines, args);
  if (isWriteTool(params.name) && caller && outlines.kind === "remote") return writeTool(outlines, params.name, args, caller);
  throw invalidParams(`Unknown tool ${params.name}.`);
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
  const target = await addressedBlock(outlines, stringField(args, "uri") ?? stringField(args, "ref"), args.outline);
  if ("error" in target) return toolError(target.error);
  const { board } = target;
  const status = await target.board.mcpAccessStatus();
  if (!status.canRead) return toolError(accessRefusal(outlines, target, status.level));
  if (!writesAt(status.level)) return toolError(writeRefusal(outlines, target, status.level));
  const record = (await board.records([target.id])).records.find(r => r.id === target.id);
  if (!record) return toolError(`No block ${target.id} in ${board.address.outline}${target.served.source === "mirror" ? `'s mirror (as of ${target.served.asOf})` : ""}.`);
  const actor = actorOf(caller);
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
        outcome: "queued", id: entry.id, uri: target.uri, ...where, queuedFor: `${where.outline}@${target.home.machine}`, queuedAt: entry.queuedAt,
        waiting: q?.waiting ?? 1, lastPull: q?.lastPull ?? null,
        said: `queued for ${where.outline}@${target.home.machine} (${seen}); it lands when ${target.home.machine} pulls it, ${status.level === "full" ? "applied, or proposed if the note changed meanwhile" : "as a proposal"}, and the mirror shows it after that`,
      });
    }
    const done = await applyWrite(board, { ...shape, blockId: target.id }, { level: status.level, actor, uri: id => blockUri(board, id) });
    outlines.log?.(`mcp write: ${actor.actorId} (${caller.sub}) ${tool} ${target.uri}: ${done.outcome}`);
    return toolText({ outcome: done.outcome, uri: done.uri, ...where, said: done.said, detail: done.detail });
  } catch (e) {
    outlines.log?.(`mcp write: ${actor.actorId} (${caller.sub}) ${tool} ${target.uri}: refused: ${(e as Error).message}`);
    return toolError((e as Error).message);
  }
}

function resultFor(outlines: McpOutlines, req: RpcRequest, caller?: McpCaller): Promise<unknown> | unknown {
  switch (req.method) {
    case "initialize":
      return { protocolVersion: protocolFor(objectFields(req.params)?.protocolVersion), capabilities: { tools: {}, resources: {} }, serverInfo: { name: "ep0ch", version: "0.0.0" } };
    case "ping":
      return {};
    case "tools/list":
      return offersWrites(outlines, caller).then(w => ({ tools: [...toolsFor(outlines), ...(w ? writeToolDefinitions(outlineProperty(outlines)) : [])] }));
    case "tools/call":
      return callTool(outlines, req.params, caller);
    case "resources/list":
      return { resources: [] };
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

async function responseFor(outlines: McpOutlines, req: ParsedMessage, caller?: McpCaller): Promise<unknown | null> {
  if ("invalidRequest" in req) return responseError(req.id, -32600, req.invalidRequest);
  if (req.id === undefined) return null;
  try { return { jsonrpc: "2.0", id: req.id, result: await resultFor(outlines, req, caller) }; }
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
  for (const req of parsed) { const r = await responseFor(outlines, req, caller); if (r !== null) responses.push(r); }
  return { reply: responses.length ? (parsed.length === 1 ? responses[0] : responses) : null, methods };
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
  propose: " (reads, and the remote gateway's writes as proposals for you to apply)",
  full: " (reads, and the remote gateway's writes applied, checked against the revision they read; a note open in your draft gets a proposal instead)",
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
  const outlines = boundOutlines(board);
  const write = io.write ?? (line => process.stdout.write(`${line}\n`));
  try {
    for await (const line of io.input ?? stdinLines()) {
      const answer = await answerMcp(outlines, line);
      if (answer?.reply) write(JSON.stringify(answer.reply));
    }
    return 0;
  } finally { board.close(); }
}
