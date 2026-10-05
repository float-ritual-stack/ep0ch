// A read-only local MCP server over stdio for the outline this process can already open. It exposes only
// canonical ep0ch:// block resources and read/search/link tools; it never writes and never serves another outline's URI.
import { createInterface } from "node:readline";
import { boardFor, everyNote, type Found, type NotesBoard } from "./notes-cli";
import { previewTitle } from "./socket";
import { recordJson } from "@ep0ch/outline-core/block-record";
import { formatEp0chBlockUri, parseAddressedBlock, parseEp0chBlockUri, type Ep0chBlockUri } from "@ep0ch/outline-core/addressable-resource";

export const MCP_USAGE = `  ep0ch mcp [--ws <name>] [--machine <ssh-name>]
                                   read-only local MCP server on stdio for ep0ch:// block resources:
                                   tools outline_read, outline_find, outline_links; resources/read for ep0ch://...`;

type RpcId = string | number | null;
interface RpcRequest { jsonrpc?: string; id?: RpcId; method?: string; params?: unknown }
interface McpContent { type: "text"; text: string }
interface ToolResult { content: McpContent[]; isError?: boolean }
interface McpIo { input?: AsyncIterable<string>; write?: (line: string) => void; err?: (line: string) => void }

type Board = NotesBoard;

const toolText = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const toolError = (message: string): ToolResult => ({ isError: true, content: [{ type: "text", text: message }] });
const objectFields = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringField = (value: Record<string, unknown>, key: string): string | undefined => typeof value[key] === "string" ? value[key] : undefined;
const numberField = (value: Record<string, unknown>, key: string): number | undefined => typeof value[key] === "number" ? value[key] : undefined;
const clampLimit = (value: unknown, fallback: number, max: number) => Number.isInteger(value) && typeof value === "number" && value > 0 ? Math.min(value, max) : fallback;

const SUPPORTED_PROTOCOL = "2024-11-05";

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

function sameOutline(board: Board, uri: Ep0chBlockUri): boolean {
  return uri.outline === board.address.outline && uri.machine === board.address.machine;
}

function addressedBlock(board: Board, input: unknown): { id: string; uri: string } | { error: string } {
  if (typeof input !== "string" || !input.trim()) return { error: "Give ref or uri as a block id, ((id)) or ep0ch:// outline URI." };
  try {
    if (input.startsWith("ep0ch://")) {
      const uri = parseEp0chBlockUri(input);
      if (!sameOutline(board, uri)) return { error: `${input} names ${uri.outline}@${uri.machine}; this MCP server is bound to ${board.address.outline}@${board.address.machine}` };
      return { id: uri.blockId, uri: formatEp0chBlockUri(uri) };
    }
    const parsed = parseAddressedBlock(input);
    if ("target" in parsed) return { error: "Local refs cannot name another outline; use an ep0ch:// URI for canonical addresses." };
    return { id: parsed.blockId, uri: blockUri(board, parsed.blockId) };
  } catch (e) { return { error: (e as Error).message }; }
}

async function readRecord(board: Board, input: unknown): Promise<ToolResult> {
  const target = addressedBlock(board, input);
  if ("error" in target) return toolError(target.error);
  const { records, unavailable } = await board.records([target.id]);
  const record = records[0];
  if (!record) return toolError(`No block ${target.id} in ${board.address.outline}; ${unavailable[0]?.status ?? "missing"}.`);
  return toolText(recordJson([{ uri: target.uri, ...record }]).trimEnd());
}

async function findBlocks(board: Board, args: Record<string, unknown>): Promise<ToolResult> {
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
  return toolText({ outline: board.address.outline, machine: board.address.machine, query, limit, completeness, ...(semantic ? { semantic } : {}), matches: rows });
}

async function linkData(board: Board, input: unknown, limitInput: unknown): Promise<ToolResult> {
  const target = addressedBlock(board, input);
  if ("error" in target) return toolError(target.error);
  const limit = clampLimit(limitInput, 50, 200);
  const [{ records, unavailable }, backlinks] = await Promise.all([board.records([target.id]), board.backlinks(target.id, limit)]);
  const record = records[0];
  if (!record) return toolError(`No block ${target.id} in ${board.address.outline}; ${unavailable[0]?.status ?? "missing"}.`);
  return toolText({ uri: target.uri, id: target.id, title: previewTitle(record.title), links: record.links, resources: record.resources, backlinks: backlinks.sources, completeness: backlinks.completeness });
}

async function resourceRead(board: Board, uriValue: unknown): Promise<unknown> {
  const target = addressedBlock(board, uriValue);
  if ("error" in target) throw invalidParams(target.error);
  const msg = await board.get(target.id);
  if (!msg) throw new RpcError(-32002, `No block ${target.id} in ${board.address.outline}.`);
  return { contents: [{ uri: target.uri, mimeType: "text/markdown", text: msg.text }] };
}


const oneAddressSchema = {
  type: "object",
  properties: { uri: { type: "string" }, ref: { type: "string" } },
  additionalProperties: false,
  oneOf: [{ required: ["uri"] }, { required: ["ref"] }],
};
const tools = [
  {
    name: "outline_read",
    description: "Read one block in the bound outline as a block record JSON document. Input: exactly one of uri or ref.",
    inputSchema: oneAddressSchema,
  },
  {
    name: "outline_find",
    description: "Search the bound outline with the same ranker as ep0ch find. Empty query lists recent/index rows.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "outline_links",
    description: "Read a block's authored outlinks, resources and backlinks. Input: exactly one of uri or ref.",
    inputSchema: { ...oneAddressSchema, properties: { ...oneAddressSchema.properties, limit: { type: "number" } } },
  },
];

async function callTool(board: Board, paramsValue: unknown): Promise<ToolResult> {
  const params = objectFields(paramsValue);
  if (!params || typeof params.name !== "string") throw invalidParams("tools/call needs a tool name.");
  const args = objectFields(params.arguments) ?? {};
  if (params.name === "outline_read") return readRecord(board, stringField(args, "uri") ?? stringField(args, "ref"));
  if (params.name === "outline_find") return findBlocks(board, args);
  if (params.name === "outline_links") return linkData(board, stringField(args, "uri") ?? stringField(args, "ref"), numberField(args, "limit"));
  throw invalidParams(`Unknown tool ${params.name}.`);
}

function resultFor(board: Board, req: RpcRequest): Promise<unknown> | unknown {
  switch (req.method) {
    case "initialize":
      return { protocolVersion: SUPPORTED_PROTOCOL, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "ep0ch", version: "0.0.0" } };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(board, req.params);
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [{ uriTemplate: `ep0ch://${board.address.outline}@${board.address.machine}/b/{blockId}`, name: "ep0ch block", description: "A block in the bound outline", mimeType: "text/markdown" }] };
    case "resources/read": {
      const params = objectFields(req.params);
      if (!params) throw invalidParams("resources/read needs a uri.");
      return resourceRead(board, params.uri);
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

async function responseFor(board: Board, req: ParsedMessage): Promise<unknown | null> {
  if ("invalidRequest" in req) return responseError(req.id, -32600, req.invalidRequest);
  if (req.id === undefined) return null;
  try { return { jsonrpc: "2.0", id: req.id, result: await resultFor(board, req) }; }
  catch (e) {
    const code = e instanceof RpcError ? e.code : -32603;
    return responseError(req.id, code, (e as Error).message);
  }
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

export async function mcpCommand(argsIn: string[], io: McpIo = {}): Promise<number> {
  const parsedArgs = mcpArgs(argsIn);
  const err = io.err ?? console.error;
  if ("error" in parsedArgs) { err(`ep0ch: ${parsedArgs.error}`); return 2; }
  const board = await boardFor(parsedArgs);
  if ("error" in board) { err(`ep0ch: ${board.error}`); return 1; }
  const write = io.write ?? (line => process.stdout.write(`${line}\n`));
  try {
    for await (const line of io.input ?? stdinLines()) {
      const parsed = parseRequest(line);
      if (!parsed) continue;
      if ("parseError" in parsed) { write(JSON.stringify(responseError(null, -32700, parsed.parseError))); continue; }
      const responses = (await Promise.all(parsed.map(req => responseFor(board, req)))).filter((r): r is unknown => r !== null);
      if (responses.length) write(JSON.stringify(parsed.length === 1 ? responses[0] : responses));
    }
    return 0;
  } finally { board.close(); }
}
