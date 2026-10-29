// PIE-1427: a chat's "what changed lately" is real work. On a scratch outline holding 200 fetched notifications and 10
// notes people wrote, outline_query's orient read answers the 10 and says "200 notifications left out"; machinery show
// brings them back, only with machine=notification asks for just them. Everything here is made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mcpCommand } from "../src/mcp";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("outline_query leaves machinery out of a recent-activity read, and counts it", () => {
  const scratch = new Scratch();
  const oldEnv: Record<string, string | undefined> = {};
  let board: SocketBoard;
  const query = async (args: Record<string, unknown>) => {
    const out: string[] = [];
    const req = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "outline_query", arguments: { outline: scratch.name, ...args } } };
    await mcpCommand(["mcp"], { input: (async function* () { yield JSON.stringify(req); })(), write: l => out.push(l), err: l => out.push(`ERR ${l}`) });
    const result = JSON.parse(out[0]!).result as { isError?: boolean; content: { text: string }[] };
    return { isError: !!result.isError, text: result.content[0]!.text, json: (() => { try { return JSON.parse(result.content[0]!.text); } catch { return null; } })() };
  };

  beforeAll(async () => {
    const sock = await scratch.start();
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
    board = new SocketBoard(sock);
    await board.info();
    await board.configureMcpAccess("read");
    const page = await board.request<{ id: string }>("create", { parentId: null, text: "Notifications [page::notifications]", author: "user" });
    for (let i = 0; i < 200; i++) {
      await board.request("create", { parentId: page.id, text: `Seed order ${i} shipped [notify.key::mail:${i}] [notify.source::mail] [notify.state::unread] [machine::notification]`, author: "agent", actorId: "ext:notify" });
    }
    for (let i = 0; i < 10; i++) await board.request("create", { parentId: null, text: `Pruned the pear row ${i}\nThe north side first.`, author: "user" });
  }, 120_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  const ORIENT = { query: "updated >= -1d NOT type=peer-message", sort: "updated desc", fields: "id,title,updated", limit: 50 };

  test("the orient read holds the people's 10 notes and says the 200 notifications were left out", async () => {
    const r = await query(ORIENT);
    expect(r.isError).toBe(false);
    const titles: string[] = r.json.matches.map((m: { title: string }) => m.title);
    // The 10 people's notes and the notifications page; none of the notifications.
    expect(titles.filter(t => t.startsWith("Pruned the pear row"))).toHaveLength(10);
    expect(titles.some(t => t.startsWith("Seed order"))).toBe(false);
    expect(r.json.machineryOmitted).toMatchObject({ count: 200, by: { notification: 200 } });
    expect(r.json.machineryOmitted.said).toBe("200 notifications left out (machinery: show brings them back)");
  });

  test("machinery show brings them back, and only with machine=notification asks for just them", async () => {
    const hidden = await query(ORIENT), all = await query({ ...ORIENT, machinery: "show" });
    expect(all.json.total - hidden.json.total).toBe(200);
    expect(all.json.machineryOmitted).toBeUndefined();
    const just = await query({ ...ORIENT, query: "updated >= -1d machine=notification", machinery: "only" });
    expect(just.json.total).toBe(200);
    // A question that names machine itself is answered as written: nothing is left out, so nothing is counted.
    const named = await query({ ...ORIENT, query: "updated >= -1d machine=notification" });
    expect(named.json.total).toBe(200);
    expect(named.json.machineryOmitted).toBeUndefined();
  });

  test("a read that isn't about recent activity says nothing extra, and a wrong mode says what is allowed", async () => {
    const plain = await query({ query: "notify.source=mail" });
    expect(plain.json.total).toBe(0);
    expect(plain.json.machineryOmitted).toBeUndefined();
    const bad = await query({ ...ORIENT, machinery: "all" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("one of hide, only, show");
  });
});
