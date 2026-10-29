// PIE-1371: a block named by its id's first 8 characters resolves the same way for the Claude mod's tools (the
// outliner's `runAgentOperation`) and the MCP gateway's outline_read as for the CLI: through the service's one resolver,
// `blocks.resolve`. An ambiguous prefix lists its candidates, a miss the nearest ids, a title points at outline_find.
// Scratch host only; fictional notes with fixed ids so two share a prefix.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { answerMcp } from "../src/mcp";
import { machineOutlines } from "../src/mcp-gateway";
import { localAdmin } from "../src/mcp-outlines";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const ALPHA = "deadbeef-0000-4000-8000-000000000001";
const BETA = "deadbeef-0000-4000-8000-000000000002";
const GAMMA = "cafef00d-0000-4000-8000-000000000003";

describe.skipIf(!outliner)("a short id names a block for every agent entry point", () => {
  const scratch = new Scratch(undefined, "seed-swap");
  let gateway: ReturnType<typeof machineOutlines>;
  let agent: (ref: string) => Promise<{ id: string } | { error: string }>;
  let mcp: (ref: string) => Promise<{ id: string } | { error: string }>;

  beforeAll(async () => {
    // Seed the outline file before the host opens it: the service makes its own ids, and the test needs two that share 8 characters.
    const { OutlinerStore } = await import(`${outliner}/src/store.ts`);
    const store = new OutlinerStore(join(scratch.outlines, `${scratch.name}.sqlite`));
    const shed = store.create("Potting shed", null, "user");
    store.create("Alpha tray", shed.id, "user", undefined, { id: ALPHA });
    store.create("Beta tray", null, "user", undefined, { id: BETA });
    store.create("Gamma tray", null, "user", undefined, { id: GAMMA });
    store.close();
    const sock = await scratch.start();
    const board = new SocketBoard(sock);
    await board.configureMcpAccess("read");
    board.close();

    const { OutlinerClient } = await import(`${outliner}/src/client.ts`);
    const { runAgentOperation } = await import(`${outliner}/src/agent-tools.ts`);
    const client = new OutlinerClient(sock, 30_000, scratch.name);
    agent = (ref) => runAgentOperation(client, "read", { ref }, undefined).then((r: { id: string }) => ({ id: r.id }), (e: Error) => ({ error: e.message }));

    const machine = canonicalLocalMachineName();
    gateway = machineOutlines(scratch.name, () => {}, async () => Object.assign(new SocketBoard(sock), { address: { outline: scratch.name, machine } }) as never, [], async () => [scratch.name], undefined, undefined, localAdmin());
    mcp = async (ref) => {
      const answer = await answerMcp(gateway, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "outline_read", arguments: { outline: scratch.name, ref } } }), { sub: "user_fictional_a", clientId: "claude-desktop" });
      const result = (answer!.reply as { result: { content: { text: string }[]; isError?: boolean } }).result;
      const text = result.content[0]!.text;
      return result.isError ? { error: text } : { id: (JSON.parse(text) as { record: { id: string } }).record.id };
    };
  }, 30_000);

  afterAll(async () => {
    gateway?.close();
    await scratch.dispose();
  }, 20_000);

  test("a unique prefix reads the note, an ambiguous one lists its candidates, a title and a miss teach", async () => {
    for (const [name, read] of [["agent", () => agent], ["gateway", () => mcp]] as const) {
      expect(await read()("cafef00d"), name).toEqual({ id: GAMMA });
      expect(await read()(`((cafef00d))`), name).toEqual({ id: GAMMA });

      const ambiguous = await read()("deadbeef");
      expect("error" in ambiguous && ambiguous.error, name).toContain(`deadbeef starts 2 notes' ids: ${ALPHA} Alpha tray · in Potting shed; ${BETA} Beta tray · in (root); give more of it`);

      const title = await read()("Gamma tray");
      expect("error" in title && title.error, name).toContain("titles aren't accepted: outline_find finds one");

      const miss = await read()("cafef00e");
      expect("error" in miss && miss.error, name).toContain(`no id starts cafef00e; the nearest are ${GAMMA} Gamma tray · in (root)`);
    }
  }, 30_000);
});
