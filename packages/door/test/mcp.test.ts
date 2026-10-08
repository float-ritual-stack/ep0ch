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
  let target: { id: string; uri: string }, source: { id: string; uri: string }, privateNote: { id: string; uri: string }, publishedShell: { id: string; uri: string }, machine = "";
  const oldEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    machine = canonicalLocalMachineName();
    target = await board.request<{ id: string; text: string }>("create", { parentId: null, text: "Addressable seed\nReady for local tools.", author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    source = await board.request<{ id: string; text: string }>("create", { parentId: null, text: `Private backlink source\nSee ((${target.id}|the target)).`, author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    privateNote = await board.request<{ id: string; text: string }>("create", { parentId: null, text: "Private seed\nNot published, but allowed after local MCP grant.", author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    publishedShell = await board.request<{ id: string; text: string }>("create", { parentId: null, text: `Published shell [publish::true]\nPublishing does not grant local MCP access. See ((${privateNote.id}|private seed)).`, author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  test("requires an explicit outline MCP grant, then reads private blocks through the same envelope until revoked", async () => {
    const hiddenChild = await board.request<{ id: string }>("create", { parentId: target.id, text: "Private child\nVisible to local MCP after grant.", author: "agent" });
    const outDenied: string[] = [];
    const deniedCode = await mcpCommand(["mcp"], { input: linesOf([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "outline_read", arguments: { uri: publishedShell.uri } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: publishedShell.uri } }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "outline_find", arguments: { query: "Published shell", limit: 5 } } }),
    ]), write: line => outDenied.push(line), err: line => outDenied.push(`ERR ${line}`) });
    expect(deniedCode).toBe(0);
    const denied = outDenied.map(responseOf);
    expect(tool(denied[0]?.result).isError).toBe(true);
    expect(tool(denied[0]?.result).content[0]!.text).toContain("local MCP access is none");
    expect(denied[1]?.error?.message).toContain("local MCP access is none");
    expect(tool(denied[2]?.result).isError).toBe(true);

    const configured: string[] = [];
    expect(await mcpCommand(["mcp", "access", "read", "--json"], { input: linesOf([]), write: line => configured.push(line), err: line => configured.push(line) })).toBe(0);
    expect(JSON.parse(configured[0]!) as { level: string; canRead: boolean }).toMatchObject({ level: "read", canRead: true });
    // Reads to proposals adds the gateway's write tools: a connected client won't see them until it reconnects.
    const said: string[] = [];
    expect(await mcpCommand(["mcp", "access", "propose"], { input: linesOf([]), write: line => said.push(line), err: line => said.push(line) })).toBe(0);
    expect(said.join("\n")).toContain("reconnect it to see the write tools appear or go");
    said.length = 0;
    expect(await mcpCommand(["mcp", "access", "full"], { input: linesOf([]), write: line => said.push(line), err: line => said.push(line) })).toBe(0);
    expect(said.join("\n")).not.toContain("reconnect");
    expect(await mcpCommand(["mcp", "access", "read"], { input: linesOf([]), write: line => said.push(line), err: line => said.push(line) })).toBe(0);
    expect(said.join("\n")).toContain("reconnect");

    const out: string[] = [];
    const requests = [
      { jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2099-01-01" } },
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "outline_find", arguments: { query: "Private seed", limit: 5 } } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri } } },
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "outline_links", arguments: { ref: `((${target.id}))` } } },
      { jsonrpc: "2.0", id: 9, method: "resources/read", params: { uri: privateNote.uri } },
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri.replace(`@${machine}`, "@elsewhere") } } },
      { jsonrpc: "2.0", id: 11, method: "ping" },
      { jsonrpc: "1.0", id: 12, method: "tools/list" },
      [{ jsonrpc: "2.0", id: 13, method: "resources/list" }, { jsonrpc: "2.0", method: "tools/list" }, { jsonrpc: "2.0", id: 14, method: "nope" }],
      { jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "outline_read", arguments: { uri: publishedShell.uri } } },
      // Another outline's URI in a ref (spaces around it too) is refused, never read by its id here.
      { jsonrpc: "2.0", id: 18, method: "tools/call", params: { name: "outline_links", arguments: { ref: `  ${target.uri.replace(`${scratch.name}@`, "other-garden@")}` } } },
      { jsonrpc: "2.0", id: 19, method: "tools/call", params: { name: "outline_read", arguments: { ref: target.uri.replace(`${scratch.name}@`, "other-garden@") } } },
      { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "list_outlines", arguments: {} } },
    ].map(r => JSON.stringify(r));
    const code = await mcpCommand(["mcp"], { input: linesOf(requests), write: line => out.push(line), err: line => out.push(`ERR ${line}`) });
    expect(code).toBe(0);
    const responses = out.map(line => JSON.parse(line) as RpcResponse | RpcResponse[]);
    const flat = responses.flatMap(r => Array.isArray(r) ? r : [r]);
    const response = (id: number) => flat.find(r => r.id === id);
    expect(fields(response(4)?.result).serverInfo).toMatchObject({ name: "ep0ch" });
    expect(fields(response(4)?.result).protocolVersion).toBe("2025-11-25");
    const listed = fields(response(5)?.result).tools as { name: string; inputSchema?: any }[];
    expect(listed.map(t => t.name)).toEqual(["list_outlines", "outline_read", "outline_find", "outline_query", "outline_links", "outline_components"]);
    expect(listed[1]!.inputSchema.oneOf).toEqual([{ required: ["uri"] }, { required: ["ref"] }]);

    const find = JSON.parse(tool(response(6)?.result).content[0]!.text) as { matches: { id: string; uri: string }[] };
    expect(find.matches).toContainEqual(expect.objectContaining({ id: privateNote.id, uri: privateNote.uri }));

    const read = JSON.parse(tool(response(7)?.result).content[0]!.text) as { uri: string; outlineInstanceId: string; revision: number; reachability: { status: string; level: string }; record: { id: string; body: string; backlinks: string[]; children: string[] } };
    expect(read).toMatchObject({ uri: target.uri, outlineInstanceId: expect.any(String), revision: expect.any(Number), reachability: { status: "reachable", level: "read" }, record: { id: target.id, body: expect.stringContaining("Ready for local tools") } });
    expect(read.record.backlinks).toContain(source.id);
    expect(read.record.children).toContain(hiddenChild.id);

    const links = JSON.parse(tool(response(8)?.result).content[0]!.text) as { backlinks: { blockId: string }[]; reachability: { status: string; level: string } };
    expect(links.reachability).toMatchObject({ status: "reachable", level: "read" });
    expect(links.backlinks.map(b => b.blockId)).toContain(source.id);

    const resource = fields(response(9)?.result) as { uri: string; outlineInstanceId: string; revision: number; reachability: { status: string; level: string }; record: { id: string; body: string }; contents: { uri: string; text: string }[] };
    expect(resource).toMatchObject({ uri: privateNote.uri, outlineInstanceId: expect.any(String), revision: expect.any(Number), reachability: { status: "reachable", level: "read" }, record: { id: privateNote.id, body: expect.stringContaining("Private seed") }, contents: [{ uri: privateNote.uri, text: expect.stringContaining("Private seed") }] });

    const wrongOutline = tool(response(10)?.result);
    expect(wrongOutline.isError).toBe(true);
    expect(wrongOutline.content[0]!.text).toContain("this MCP server is bound to");
    expect(fields(response(11)?.result)).toEqual({});
    expect(response(12)?.error?.message).toContain("jsonrpc");
    const batch = responses.find(Array.isArray) as RpcResponse[];
    expect(batch.map(r => r.id)).toEqual([13, 14]);
    const listedResources = fields(batch[0]!.result).resources as { uri: string }[];
    expect(listedResources.map(r => r.uri)).toContain(`ep0ch://${scratch.name}@${machine}/components/heading-style`);
    expect(batch[1]!.error?.message).toContain("Method not found");
    for (const id of [18, 19]) {
      expect(tool(response(id)?.result).isError).toBe(true);
      expect(tool(response(id)?.result).content[0]!.text).toContain(`names other-garden@${machine}; this MCP server is bound to ${scratch.name}@${machine}`);
    }
    // The bound outline is the one this server lists: live, read now, with its access setting.
    expect(JSON.parse(tool(response(20)?.result).content[0]!.text)).toEqual({ outlines: [{ outline: scratch.name, machine, uri: `ep0ch://${scratch.name}@${machine}`, source: "live", asOf: expect.any(String), access: "read" }] });
    expect(JSON.parse(tool(response(7)?.result).content[0]!.text).reachability).toMatchObject({ source: "live", asOf: expect.any(String) });
    const publishedRead = JSON.parse(tool(response(15)?.result).content[0]!.text) as { record: { links: { target: string | null; label: string }[] } };
    expect(publishedRead.record.links.map(link => link.target)).toContain(privateNote.id);

    const revoked: string[] = [];
    const revokingInput = (async function* () {
      yield JSON.stringify({ jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "outline_read", arguments: { uri: privateNote.uri } } });
      while (revoked.length < 1) await Bun.sleep(10);
      await board.request("mcp.access.configure", { level: "none" });
      yield JSON.stringify({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "outline_read", arguments: { uri: privateNote.uri } } });
    })();
    expect(await mcpCommand(["mcp"], { input: revokingInput, write: line => revoked.push(line), err: line => revoked.push(`ERR ${line}`) })).toBe(0);
    const revokedResponses = revoked.map(responseOf);
    expect(JSON.parse(tool(revokedResponses[0]?.result).content[0]!.text)).toMatchObject({ reachability: { status: "reachable" } });
    expect(tool(revokedResponses[1]?.result).isError).toBe(true);
    expect(tool(revokedResponses[1]?.result).content[0]!.text).toContain("local MCP access is none");
  }, 30_000);

  test("rejects unsupported mcp command arguments before opening a board", async () => {
    const out: string[] = [];
    const code = await mcpCommand(["mcp", "--machin", "box-a"], { input: linesOf([]), write: line => out.push(line), err: line => out.push(line) });
    expect(code).toBe(2);
    expect(out[0]).toContain("mcp doesn't take");
  }, 30_000);
});
