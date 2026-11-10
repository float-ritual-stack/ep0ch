// Nov 3 review, card 13: every MCP tool error says its kind in structuredContent.kind, so an agent client branches on it
// and never on the words: `invalid` for a request that is wrong, the host's own kind for a refusal it sent (a note that
// isn't there), `no-access` for a write the outline's level refuses. A table over the tool error paths on a scratch outline.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { REFUSAL_KINDS, type RefusalKind } from "@ep0ch/outline-core/refusal";
import { answerMcp, boundOutlines } from "../src/mcp";
import { SocketBoard } from "../src/socket";
import { Scratch } from "./scratch";

describe("MCP tool errors carry a kind", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => {
    board = Object.assign(new SocketBoard(await scratch.start(), undefined, scratch.name), { address: { outline: scratch.name, machine: "garden-box" } });
    await board.request("mcp.access.configure", { level: "full" });
  });
  afterAll(async () => { board.close(); await scratch.dispose(); });

  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await answerMcp(boundOutlines(board as never), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), { sub: "stdio", clientId: "garden-agent" });
    return (reply!.reply as { result: { isError?: boolean; content: { text: string }[]; structuredContent?: { kind?: string } } }).result;
  };

  const rows: Array<[string, string, Record<string, unknown>, RefusalKind]> = [
    ["a query tool given neither query nor view", "outline_query", {}, "invalid"],
    ["an offset that isn't a whole number", "outline_query", { query: "type=bed", offset: -2 }, "invalid"],
    ["a fold that isn't true or false", "outline_query", { query: "type=bed", fold: "yes" }, "invalid"],
    ["a read of a note the host doesn't have", "outline_read", { ref: "00000000-0000-4000-8000-000000000000" }, "not-found"],
    ["a share revoked without saying which", "share_revoke", {}, "invalid"],
    ["an artifact put with no name", "artifact_put", {}, "invalid"],
  ];
  for (const [what, tool, args, kind] of rows) {
    test(`${what} is ${kind}`, async () => {
      const result = await call(tool, args);
      expect({ tool, isError: result.isError, kind: result.structuredContent?.kind, text: result.content[0]!.text.slice(0, 80) }).toMatchObject({ isError: true, kind });
    });
  }

  test("a write at read access is no-access", async () => {
    const bed = await board.createBlock(null, "Bean bed");
    await board.request("mcp.access.configure", { level: "read" });
    const refused = await call("outline_create", { ref: bed.id, text: "Bean row" });
    expect({ isError: refused.isError, kind: refused.structuredContent?.kind, text: refused.content[0]!.text.slice(0, 100) }).toMatchObject({ isError: true, kind: "no-access" });
    await board.request("mcp.access.configure", { level: "full" });
  });

  test("every kind a tool error names is one of the closed list", async () => {
    for (const [, tool, args] of rows) expect(REFUSAL_KINDS as readonly string[]).toContain((await call(tool, args)).structuredContent?.kind ?? "missing");
  });
});
