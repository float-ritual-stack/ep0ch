// PIE-520: the local stdio MCP server is read-only, bound to the outline the CLI can open, and serves canonical
// ep0ch:// block resources plus read/find/links tools. Scratch service only; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { mcpCommand } from "../src/mcp";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

interface RpcResponse { id: string | number | null; result?: unknown; error?: { message?: string } }
interface ToolResult { content: { type: "text"; text: string }[]; isError?: boolean }

const linesOf = (lines: string[]) => (async function* () { for (const line of lines) yield line; })();
const responseOf = (line: string): RpcResponse => JSON.parse(line) as RpcResponse;
const fields = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tool = (value: unknown): ToolResult => value as ToolResult;

describe.skipIf(!outliner)("ep0ch mcp", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let target: { id: string; uri: string }, source: { id: string; uri: string }, machine = "";
  const oldEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    machine = canonicalLocalMachineName();
    target = await board.request<{ id: string; text: string }>("create", { parentId: null, text: "Addressable seed\nReady for local tools.", author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    source = await board.request<{ id: string; text: string }>("create", { parentId: null, text: `Link source\nSee ((${target.id}|the target)).`, author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  test("serves read, find, links and resources/read only for the bound outline", async () => {
    const out: string[] = [];
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "outline_find", arguments: { query: "Addressable seed", limit: 5 } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "outline_links", arguments: { ref: `((${target.id}))` } } },
      { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: target.uri } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri.replace(`@${machine}`, "@elsewhere") } } },
      { jsonrpc: "2.0", id: 8, method: "ping" },
      { jsonrpc: "1.0", id: 9, method: "tools/list" },
      [{ jsonrpc: "2.0", id: 10, method: "resources/list" }, { jsonrpc: "2.0", method: "tools/list" }, { jsonrpc: "2.0", id: 11, method: "nope" }],
    ].map(r => JSON.stringify(r));
    const code = await mcpCommand(["mcp"], { input: linesOf(requests), write: line => out.push(line), err: line => out.push(`ERR ${line}`) });
    expect(code).toBe(0);
    const responses = out.map(line => JSON.parse(line) as RpcResponse | RpcResponse[]);
    const flat = responses.flatMap(r => Array.isArray(r) ? r : [r]);
    const response = (id: number) => flat.find(r => r.id === id);
    expect(fields(response(1)?.result).serverInfo).toMatchObject({ name: "ep0ch" });
    expect(fields(response(1)?.result).protocolVersion).toBe("2024-11-05");
    const listed = fields(response(2)?.result).tools as { name: string; inputSchema?: any }[];
    expect(listed.map(t => t.name)).toEqual(["outline_read", "outline_find", "outline_links"]);
    expect(listed[0]!.inputSchema.oneOf).toEqual([{ required: ["uri"] }, { required: ["ref"] }]);

    const find = JSON.parse(tool(response(3)?.result).content[0]!.text) as { matches: { id: string; uri: string }[] };
    expect(find.matches).toContainEqual(expect.objectContaining({ id: target.id, uri: target.uri }));

    const read = JSON.parse(tool(response(4)?.result).content[0]!.text) as { id: string; uri: string; text: string }[];
    expect(read[0]).toMatchObject({ id: target.id, uri: target.uri, text: expect.stringContaining("Ready for local tools") });

    const links = JSON.parse(tool(response(5)?.result).content[0]!.text) as { backlinks: { blockId: string }[] };
    expect(links.backlinks.map(b => b.blockId)).toContain(source.id);

    const resource = fields(response(6)?.result).contents as { uri: string; text: string }[];
    expect(resource[0]).toMatchObject({ uri: target.uri, text: expect.stringContaining("Addressable seed") });

    const denied = tool(response(7)?.result);
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toContain("this MCP server is bound to");
    expect(fields(response(8)?.result)).toEqual({});
    expect(response(9)?.error?.message).toContain("jsonrpc");
    const batch = responses.find(Array.isArray) as RpcResponse[];
    expect(batch.map(r => r.id)).toEqual([10, 11]);
    expect(fields(batch[0]!.result).resources).toEqual([]);
    expect(batch[1]!.error?.message).toContain("Method not found");
  }, 30_000);

  test("rejects unsupported mcp command arguments before opening a board", async () => {
    const out: string[] = [];
    const code = await mcpCommand(["mcp", "--machin", "box-a"], { input: linesOf([]), write: line => out.push(line), err: line => out.push(line) });
    expect(code).toBe(2);
    expect(out[0]).toContain("mcp doesn't take");
  }, 30_000);
});
