// A named path's cap (PIE-804) is applied by the write gate's one rule (outliner write-gate.ts effectiveLevel, through
// levelFor) wherever the server asks what a caller may do, reads included: not by a wrapper on the outlines that lowers
// the access status a second time (Nov 3 review card 6, PIE-1544). So a caller that carries a cap is held to it on bare
// outlines with no gateway around them. Fictional names throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import { answerMcp } from "../src/mcp";
import { machineOutlines } from "../src/mcp-gateway";
import type { McpCaller } from "../src/mcp-writes";
import { canonicalLocalMachineName } from "@ep0ch/outliner/machine-name";
import { SocketBoard, hostRequest } from "../src/socket";
import { outliner, ScratchHost } from "./scratch";

const HERE = canonicalLocalMachineName();

describe.skipIf(!outliner)("a caller's cap holds on bare outlines", () => {
  const host = new ScratchHost();
  const boards: SocketBoard[] = [];
  let outlines: ReturnType<typeof machineOutlines>;
  let uri = "", nextId = 1;
  const boardOn = (name: string) => { const b = Object.assign(new SocketBoard(host.sock, 30_000, name), { address: { outline: name, machine: HERE } }); boards.push(b); return b; };
  const call = async (caller: McpCaller, name: string, args: Record<string, unknown>) => {
    const a = await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }), caller);
    const result = (a!.reply as { result: { isError?: boolean; content: { text: string }[] } }).result;
    let json: any = null; try { json = JSON.parse(result.content[0]!.text); } catch { /* words */ }
    return { isError: !!result.isError, text: result.content[0]!.text, json };
  };
  const capped = (level: McpAccessLevel): McpCaller => ({ sub: "user_fictional_a", clientId: "https://chat.example.test/oauth/client-metadata", persona: "scout", cap: () => level });

  beforeAll(async () => {
    await host.start();
    await host.create("herb-notes");
    const b = boardOn("herb-notes");
    await b.request("mcp.access.configure", { level: "full" });
    const made = await b.request("create", { parentId: null, text: "Herb rota\nBasil on Mondays.", author: "user" });
    uri = formatEp0chBlockUri({ outline: "herb-notes", machine: HERE, blockId: made.id });
    outlines = machineOutlines(undefined, () => {}, async name => boardOn(name) as any, [],
      async () => (await hostRequest(host.sock, "outlines.list")).outlines.map(o => o.name).sort());
  }, 60_000);
  afterAll(async () => { outlines?.close(); for (const b of boards) b.close(); await host.dispose(); });

  test("a cap of none shuts the outline to reads, a cap of read to writes, a cap of propose makes a write a proposal", async () => {
    expect((await call(capped("none"), "outline_read", { uri })).isError).toBe(true);
    expect((await call(capped("read"), "outline_read", { uri })).isError).toBe(false);
    expect((await call(capped("read"), "outline_comment", { uri, whole: true, body: "Too much." })).isError).toBe(true);
    const read = (await call(capped("propose"), "outline_read", { uri })).json;
    const patched = await call(capped("propose"), "outline_patch", { uri, revision: read.revision, patches: [{ observed: "Basil", replacement: "Mint" }] });
    expect(patched.json.outcome).toBe("proposed");
  });
});
