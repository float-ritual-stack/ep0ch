// A read-only MCP server for ep0ch:// block resources: one implementation, two transports. `ep0ch mcp` serves it
// over stdio, bound to the outline this process can already open; `ep0ch mcp serve --http` (src/mcp-gateway.ts)
// serves it over streamable HTTP behind OAuth, for this machine's outlines. Both answer through `responseFor` with
// an `McpOutlines` saying which outlines they read; neither ever writes, and each outline's own access setting gates
// every read.
import { createInterface } from "node:readline";
import { boardFor, canonicalLocalMachineName, everyNote, type Found, type NotesBoard } from "./notes-cli";
import { OUTLINE_NAME, previewTitle, type McpAccessStatus, type McpReachability, type McpAccessLevel } from "./socket";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { formatEp0chBlockUri, parseAddressedBlock } from "@ep0ch/outline-core/addressable-resource";

export const MCP_USAGE = `  ep0ch mcp [--ws <name>] [--machine <ssh-name>]
                                   read-only local MCP server for ep0ch:// block resources after \`ep0ch mcp access read\`:
                                   tools outline_read, outline_find, outline_links; resources/read with envelope
  ep0ch mcp serve --http [--port <n>] [--bind <address>] [--ws <default outline>]
                                   the same server over streamable HTTP for remote clients (claude.ai), an OAuth resource
                                   server for this machine's outlines; needs EP0CH_MCP_RESOURCE, CLERK_PUBLISHABLE_KEY
                                   (or EP0CH_MCP_ISSUER) and EP0CH_MCP_ALLOWED_SUBJECTS (unset: refuse and log who asked)
  ep0ch mcp access [none|read|propose|full] [--json] [--ws <name>] [--machine <ssh-name>]
                                   show or set this outline's persisted MCP access grant (stdio and the gateway alike)`;

type RpcId = string | number | null;
interface RpcRequest { jsonrpc?: string; id?: RpcId; method?: string; params?: unknown }
interface McpContent { type: "text"; text: string }
interface ToolResult { content: McpContent[]; isError?: boolean }
interface McpIo { input?: AsyncIterable<string>; write?: (line: string) => void; err?: (line: string) => void }

type Board = NotesBoard;

/** An outline as a tool or URI names it: a name, and the machine when the caller gave one. */
export interface NamedOutline { outline: string; machine?: string }

/**
 * Which outlines an MCP server reads. `local`: the stdio server, bound to one board. `remote`: the HTTP gateway, any
 * outline on this machine's host by name. `board` answers the board a URI or a tool's `outline` names (or the
 * default when none is named), or why not, in words the caller can act on.
 */
export interface McpOutlines {
  kind: "local" | "remote";
  machine: string;
  board(named?: NamedOutline): Promise<Board | { error: string }>;
  /** The outline a find or bare ref reads when none is named, if this server has one. */
  defaultOutline?: string;
  /** What a caller is told of an unexpected failure (the gateway logs it and says less); else its message. */
  internalError?: (e: Error) => string;
}

/** The stdio server's outlines: the one board it was started on. */
export function boundOutlines(board: Board): McpOutlines {
  const bound = board.address;
  return {
    kind: "local",
    machine: bound.machine,
    defaultOutline: bound.outline,
    async board(named) {
      if (!named) return board;
      if (named.outline === bound.outline && (named.machine ?? bound.machine) === bound.machine) return board;
      return { error: `${named.outline}@${named.machine ?? bound.machine} isn't the outline this MCP server is bound to; it is bound to ${bound.outline}@${bound.machine}` };
    },
  };
}

const toolText = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const toolError = (message: string): ToolResult => ({ isError: true, content: [{ type: "text", text: message }] });
const objectFields = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringField = (value: Record<string, unknown>, key: string): string | undefined => typeof value[key] === "string" ? value[key] : undefined;
const numberField = (value: Record<string, unknown>, key: string): number | undefined => typeof value[key] === "number" ? value[key] : undefined;
const clampLimit = (value: unknown, fallback: number, max: number) => Number.isInteger(value) && typeof value === "number" && value > 0 ? Math.min(value, max) : fallback;

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

/** The board a tool or resource read addresses, and the block in it: a URI names its own outline; a ref, `outline`'s. */
async function addressedBlock(outlines: McpOutlines, input: unknown, outlineInput?: unknown): Promise<{ board: Board; id: string; uri: string } | { error: string }> {
  if (typeof input !== "string" || !input.trim()) return { error: "Give ref or uri as a block id, ((id)) or ep0ch:// outline URI." };
  let named: NamedOutline | undefined, id: string;
  try {
    // One parser for a uuid, ((uuid)) and the URI; a URI names its own outline, checked before its id is read anywhere.
    const parsed = parseAddressedBlock(input.trim());
    if ("outline" in parsed) named = { outline: parsed.outline, machine: parsed.machine };
    else {
      const which = namedOutline(outlineInput);
      if (which && "error" in which) return which;
      named = which;
    }
    id = parsed.blockId;
  } catch (e) { return { error: (e as Error).message }; }
  if (!named && !outlines.defaultOutline) return { error: `Name the outline: pass outline (an outline on ${outlines.machine}), or give an ep0ch:// URI.` };
  const board = await outlines.board(named);
  if ("error" in board) return board;
  return { board, id, uri: blockUri(board, id) };
}

const ACCESS_LEVELS = ["none", "read", "propose", "full"] as const satisfies readonly McpAccessLevel[];

const grantCommand = (board: Board) => {
  const machine = board.address.machine === canonicalLocalMachineName() ? "" : ` --machine ${board.address.machine}`;
  return `ep0ch mcp access read --ws ${board.address.outline}${machine}`;
};
const accessRefusal = (outlines: McpOutlines, board: Board, level: McpAccessLevel) => outlines.kind === "local"
  ? `local MCP access is ${level} for ${board.address.outline}; run \`${grantCommand(board)}\` to grant read-only local MCP access for this outline.`
  : `MCP access is ${level} for ${board.address.outline}@${board.address.machine}; its owner runs \`${grantCommand(board)}\` on ${board.address.machine} to let MCP clients read it.`;

async function requireReadAccess(outlines: McpOutlines, board: Board): Promise<McpAccessStatus | { error: string }> {
  const status = await board.mcpAccessStatus();
  if (!status.canRead) return { error: accessRefusal(outlines, board, status.level) };
  return status;
}

const reachability = (outlines: McpOutlines, status: McpAccessStatus, id: string, revision: number | undefined): McpReachability => ({
  id,
  status: "reachable",
  level: status.level,
  ...(revision !== undefined ? { revision } : {}),
  reason: outlines.kind === "local" ? `local MCP access is ${status.level}` : `MCP access is ${status.level} (remote gateway)`,
});

const envelope = (board: Board, uri: string, access: McpReachability, record: unknown, revision: number | undefined) => ({
  uri,
  outlineInstanceId: board.outlineInstanceId,
  revision: revision ?? access.revision,
  reachability: access,
  record,
});

async function recordForMcp(outlines: McpOutlines, board: Board, id: string): Promise<{ access: McpReachability; record: BlockRecord } | { error: string }> {
  const status = await requireReadAccess(outlines, board);
  if ("error" in status) return status;
  const r = await board.records([id]);
  const record = r.records.find(row => row.id === id);
  if (!record) return { error: `No block ${id} in ${board.address.outline}; ${r.unavailable[0]?.status ?? "missing"}.` };
  return { access: reachability(outlines, status, id, record.revision), record };
}


async function readRecord(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const target = await addressedBlock(outlines, stringField(args, "uri") ?? stringField(args, "ref"), args.outline);
  if ("error" in target) return toolError(target.error);
  const read = await recordForMcp(outlines, target.board, target.id);
  if ("error" in read) return toolError(read.error);
  return toolText(envelope(target.board, target.uri, read.access, read.record, read.record.revision));
}

async function findBlocks(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const named = namedOutline(args.outline);
  if (named && "error" in named) return toolError(named.error);
  if (!named && !outlines.defaultOutline) return toolError(`Name the outline: pass outline (an outline on ${outlines.machine}).`);
  const board = await outlines.board(named);
  if ("error" in board) return toolError(board.error);
  const status = await requireReadAccess(outlines, board);
  if ("error" in status) return toolError(status.error);
  const query = stringField(args, "query")?.trim() ?? "";
  const limit = clampLimit(args.limit, 30, query ? 30 : 100);
  let rows: Found[], completeness: { kind: string; limit?: number }, semantic: unknown;
  if (query) {
    const found = await board.searchBlocks(query);
    rows = found.matches.slice(0, limit).map(m => ({ id: m.block.id, title: m.title, path: m.path, uri: blockUri(board, m.block.id) }));
    completeness = found.completeness;
    semantic = found.semantic;
  } else {
    rows = everyNote(await board.index()).slice(0, limit).map(f => ({ ...f, uri: blockUri(board, f.id) }));
    completeness = { kind: rows.length < limit ? "complete" : "limited", limit };
  }
  return toolText({ outline: board.address.outline, machine: board.address.machine, query, limit, access: { level: status.level }, completeness, ...(semantic ? { semantic } : {}), matches: rows });
}

async function linkData(outlines: McpOutlines, args: Record<string, unknown>): Promise<ToolResult> {
  const target = await addressedBlock(outlines, stringField(args, "uri") ?? stringField(args, "ref"), args.outline);
  if ("error" in target) return toolError(target.error);
  const board = target.board;
  const read = await recordForMcp(outlines, board, target.id);
  if ("error" in read) return toolError(read.error);
  const limit = clampLimit(numberField(args, "limit"), 50, 200);
  const backlinks = await board.backlinks(target.id, limit);
  const record = read.record;
  return toolText({
    uri: target.uri,
    id: target.id,
    title: previewTitle(record.title),
    reachability: read.access,
    links: record.links,
    resources: record.resources,
    backlinks: backlinks.sources,
    completeness: backlinks.completeness,
  });
}

async function resourceRead(outlines: McpOutlines, uriValue: unknown): Promise<unknown> {
  const target = await addressedBlock(outlines, uriValue);
  if ("error" in target) throw invalidParams(target.error);
  const read = await recordForMcp(outlines, target.board, target.id);
  if ("error" in read) throw new RpcError(-32002, read.error);
  return { ...envelope(target.board, target.uri, read.access, read.record, read.record.revision), contents: [{ uri: target.uri, mimeType: "text/markdown", text: read.record.text }] };
}


const outlineProperty = (outlines: McpOutlines) => ({
  type: "string",
  description: outlines.defaultOutline
    ? `The outline a ref or search reads: <name> or <name>@${outlines.machine}. Default ${outlines.defaultOutline}. A uri names its own.`
    : `The outline a ref or search reads: <name> or <name>@${outlines.machine} (this server reads only outlines on ${outlines.machine}). A uri names its own.`,
});

/** The tools, described for the outlines this server reads. */
function toolsFor(outlines: McpOutlines) {
  const which = outlines.kind === "local" ? `the bound outline (${outlines.defaultOutline}@${outlines.machine})` : `an outline on ${outlines.machine}`;
  const grant = outlines.kind === "local" ? "this outline's local MCP access grant" : "the outline's MCP access grant (`ep0ch mcp access read`)";
  const addressSchema = {
    type: "object",
    properties: { uri: { type: "string" }, ref: { type: "string" }, outline: outlineProperty(outlines) },
    additionalProperties: false,
    oneOf: [{ required: ["uri"] }, { required: ["ref"] }],
  };
  return [
    {
      name: "outline_read",
      description: `Read one block in ${which} as an enveloped block record JSON document. Requires ${grant}. Input: exactly one of uri or ref.`,
      inputSchema: addressSchema,
    },
    {
      name: "outline_find",
      description: `Search ${which} with the same ranker as ep0ch find. Requires ${grant}. Empty query lists recent/index rows.`,
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, outline: outlineProperty(outlines) }, additionalProperties: false },
    },
    {
      name: "outline_links",
      description: `Read a block's authored outlinks, resources and backlinks in ${which}. Requires ${grant}. Input: exactly one of uri or ref.`,
      inputSchema: { ...addressSchema, properties: { ...addressSchema.properties, limit: { type: "number" } } },
    },
  ];
}

async function callTool(outlines: McpOutlines, paramsValue: unknown): Promise<ToolResult> {
  const params = objectFields(paramsValue);
  if (!params || typeof params.name !== "string") throw invalidParams("tools/call needs a tool name.");
  const args = objectFields(params.arguments) ?? {};
  if (params.name === "outline_read") return readRecord(outlines, args);
  if (params.name === "outline_find") return findBlocks(outlines, args);
  if (params.name === "outline_links") return linkData(outlines, args);
  throw invalidParams(`Unknown tool ${params.name}.`);
}

function resultFor(outlines: McpOutlines, req: RpcRequest): Promise<unknown> | unknown {
  switch (req.method) {
    case "initialize":
      return { protocolVersion: protocolFor(objectFields(req.params)?.protocolVersion), capabilities: { tools: {}, resources: {} }, serverInfo: { name: "ep0ch", version: "0.0.0" } };
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolsFor(outlines) };
    case "tools/call":
      return callTool(outlines, req.params);
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list": {
      const outline = outlines.kind === "local" ? outlines.defaultOutline! : "{outline}";
      return { resourceTemplates: [{ uriTemplate: `ep0ch://${outline}@${outlines.machine}/b/{blockId}`, name: "ep0ch block", description: outlines.kind === "local" ? "A block in the bound outline" : `A block in an outline on ${outlines.machine}`, mimeType: "text/markdown" }] };
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

async function responseFor(outlines: McpOutlines, req: ParsedMessage): Promise<unknown | null> {
  if ("invalidRequest" in req) return responseError(req.id, -32600, req.invalidRequest);
  if (req.id === undefined) return null;
  try { return { jsonrpc: "2.0", id: req.id, result: await resultFor(outlines, req) }; }
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
 * implementation both transports call: stdio a line at a time, the HTTP gateway a request body at a time.
 */
export async function answerMcp(outlines: McpOutlines, text: string): Promise<McpAnswer | null> {
  const parsed = parseRequest(text);
  if (!parsed) return null;
  if ("parseError" in parsed) return { reply: responseError(null, -32700, parsed.parseError), methods: [], malformed: true };
  if (parsed.length > MAX_BATCH) return { reply: responseError(null, -32600, `A batch carries at most ${MAX_BATCH} messages.`), methods: [], malformed: true };
  const methods = parsed.flatMap(req => "method" in req && req.method ? [req.method === "tools/call" ? `tools/call ${String(objectFields(req.params)?.name ?? "")}` : req.method] : []);
  const responses: unknown[] = [];
  for (const req of parsed) { const r = await responseFor(outlines, req); if (r !== null) responses.push(r); }
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
    if ((ACCESS_LEVELS as readonly string[]).includes(a)) {
      if (level) return { error: `mcp access takes one level, got ${level} and ${a}` };
      level = a as McpAccessLevel; continue;
    }
    return { error: `mcp access doesn't take ${JSON.stringify(a)}; use none, read, propose or full` };
  }
  return { boardArgs, level, json };
}

async function mcpAccessCommand(argsIn: string[], io: McpIo): Promise<number> {
  const parsed = mcpAccessArgs(argsIn);
  const err = io.err ?? console.error;
  const write = io.write ?? (line => process.stdout.write(`${line}\n`));
  if ("error" in parsed) { err(`ep0ch: ${parsed.error}`); return 2; }
  const board = await boardFor(parsed.boardArgs);
  if ("error" in board) { err(`ep0ch: ${board.error}`); return 1; }
  try {
    const status = parsed.level ? await board.configureMcpAccess(parsed.level) : await board.mcpAccessStatus();
    if (parsed.json) write(JSON.stringify({ outline: board.address.outline, machine: board.address.machine, ...status }, null, 2));
    else write(`MCP access for ${board.address.outline}@${board.address.machine}: ${status.level}${status.canRead ? " (read-only MCP allowed, stdio and the remote gateway)" : " (denied)"}`);
    return 0;
  } finally { board.close(); }
}


export async function mcpCommand(argsIn: string[], io: McpIo = {}): Promise<number> {
  if (argsIn[1] === "access") return mcpAccessCommand(argsIn, io);
  if (argsIn[1] === "serve") { const { mcpServeCommand } = await import("./mcp-gateway"); return mcpServeCommand(argsIn.slice(2), io); }
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
