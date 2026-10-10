// outline_new and outline_archive (PIE-679), end to end on a scratch outline host: an agent makes an outline of its own
// and gets full on it, nothing else changes; a taken name, the weekly cap and archive hold; who made it and why is on
// the outline, its root note and every list. Fictional names throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { actorLabel } from "@ep0ch/outline-core/attribution";
import { answerMcp, aboutListing, boundOutlines } from "../src/mcp";
import { machineOutlines } from "../src/mcp-gateway";
import { mcpRecord } from "../src/mcp";
import type { McpOutlineAdmin } from "../src/mcp-outlines";
import type { McpCaller } from "../src/mcp-writes";
import { canonicalLocalMachineName } from "@ep0ch/outliner/machine-name";
import { SocketBoard, hostRequest } from "../src/socket";
import { outliner, ScratchHost } from "./scratch";

const HERE = canonicalLocalMachineName();
const code = { sub: "stdio", clientId: "claude-code" } satisfies McpCaller;          // claude-code on this machine
const chat = { sub: "user_fictional_a", clientId: "https://chat.example.test/oauth/client-metadata" } satisfies McpCaller;
const CODE_PRINCIPAL = `claude-code@${HERE}`;

describe.skipIf(!outliner)("agents make outlines of their own", () => {
  const host = new ScratchHost();
  const boards: SocketBoard[] = [];
  // The tools read the process environment (EP0CH_MCP_PERSONAS, EP0CH_MCP_SCRATCH_CAP) at each call, like the gateway does.
  const KEYS = ["EP0CH_MCP_PERSONAS", "EP0CH_MCP_SCRATCH_CAP", "EP0CH_AGENT", "OUTLINER_ACTOR"];
  const setEnv = (e: Record<string, string>) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, e); };
  let outlines: ReturnType<typeof machineOutlines>;
  let nextId = 1;

  const boardOn = (name: string) => { const b = Object.assign(new SocketBoard(host.sock, 30_000, name), { address: { outline: name, machine: HERE } }); boards.push(b); return b; };
  const admin = (): McpOutlineAdmin => ({
    machine: HERE, now: () => Date.parse("2026-10-09T03:00:00.000Z"),
    host: (action, params = {}) => hostRequest(host.sock, action, params),
    open: async name => boardOn(name) as any,
  });
  const call = async (caller: McpCaller, name: string, args: Record<string, unknown>) => {
    const a = await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }), caller);
    const result = (a!.reply as { result: { isError?: boolean; content: { text: string }[] } }).result;
    const text = result.content[0]!.text;
    let json: any = null; try { json = JSON.parse(text); } catch { /* words */ }
    return { isError: !!result.isError, text, json };
  };
  const toolNames = async (caller: McpCaller) => ((await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }), caller))!.reply as any).result.tools.map((t: { name: string }) => t.name) as string[];
  const listed = async (caller: McpCaller) => (await call(caller, "list_outlines", {})).json.outlines as { outline: string; access?: string; writes?: string; about?: { by: string; purpose: string } }[];

  beforeAll(async () => {
    await host.start();
    await host.create("pie-like");     // an existing work outline, which must stay as it is
    outlines = machineOutlines(undefined, () => {}, async name => boardOn(name) as any, [],
      async () => (await hostRequest<{ outlines: { name: string }[] }>(host.sock, "outlines.list")).outlines.map(o => o.name).sort(), undefined, undefined, admin());
  }, 60_000);
  afterAll(async () => { setEnv({}); outlines?.close(); for (const b of boards) b.close(); await host.dispose(); });

  test("the tools are offered to a caller on a server that reaches its machine's host, and describe the sprawl guardrail", async () => {
    expect(await toolNames(code)).toEqual(expect.arrayContaining(["outline_new", "outline_archive"]));
    const defs = ((await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), code))!.reply as any).result.tools as { name: string; description: string }[];
    expect(defs.find(t => t.name === "outline_new")!.description).toContain("call list_outlines");
    // No caller (no token): no tools that make anything.
    expect(((await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })))!.reply as any).result.tools.map((t: { name: string }) => t.name)).not.toContain("outline_new");
  });

  test("outline_new makes the outline, answers its URI, lists it on the same session with who and why, and tags the root note", async () => {
    const before = (await listed(code)).map(o => o.outline);
    expect(before).not.toContain("gurgle");
    setEnv({ EP0CH_MCP_PERSONAS: `${CODE_PRINCIPAL}=loki` });
    const made = await call(code, "outline_new", { name: "gurgle", purpose: "burps, link sprees and the day's discourse", seed: ["first burp", "second burp"] });
    expect(made.isError).toBe(false);
    expect(made.json).toMatchObject({ outcome: "created", uri: `ep0ch://gurgle@${HERE}`, seeded: 2, access: { you: "full", others: "read" }, by: `loki (${CODE_PRINCIPAL})` });
    const row = (await listed(code)).find(o => o.outline === "gurgle")!;
    expect(row.about).toMatchObject({ by: `loki (${CODE_PRINCIPAL})`, purpose: "burps, link sprees and the day's discourse" });
    const board = boardOn("gurgle");
    const root = (await board.roots()).find(r => r.text.includes("[kind::scratch]"));
    expect(root).toBeDefined();
    expect(root!.text).toContain(`[created-by::loki/${CODE_PRINCIPAL}]`);
    expect(root!.text).toContain("[created::2026-10-09]");
    expect(root!.text).toContain("[purpose::burps, link sprees and the day's discourse]");
    expect(root!.text).toContain("[kind::scratch]");
    const seeded = await board.children(root!.id);
    expect(seeded.map(c => c.text)).toEqual(["first burp", "second burp"]);
    expect((await board.records([seeded[0]!.id])).records[0]!.actor).toBe(`mcp:loki/${CODE_PRINCIPAL}`);
  }, 60_000);

  test("access: full for the creator on the new outline, read for another principal, and nothing else changes", async () => {
    const mine = (await listed(code)), theirs = (await listed(chat));
    expect(mine.find(o => o.outline === "gurgle")).toMatchObject({ access: "full", writes: "applied" });
    expect(theirs.find(o => o.outline === "gurgle")).toMatchObject({ access: "read" });
    expect(theirs.find(o => o.outline === "gurgle")!.writes).toBeUndefined();
    // The creator got nothing on the work outline, and the other principal got nothing new there either.
    expect(mine.find(o => o.outline === "pie-like")).toMatchObject({ access: "none" });
    expect(theirs.find(o => o.outline === "pie-like")).toMatchObject({ access: "none" });
    expect((await boardOn("pie-like").mcpAccessStatus()).level).toBe("none");
    // The creator writes to it; the other principal's write is refused.
    const root = (await boardOn("gurgle").roots()).find(r => r.text.includes("[kind::scratch]"))!;
    const wrote = await call(code, "outline_create", { ref: root.id, outline: "gurgle", text: "a third burp" });
    expect(wrote.json).toMatchObject({ outcome: "applied", by: `loki (${CODE_PRINCIPAL})` });
    const refused = await call(chat, "outline_create", { ref: root.id, outline: "gurgle", text: "not mine" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("takes no writes");
    expect(await call(chat, "outline_create", { ref: (await boardOn("pie-like").roots())[0]?.id ?? "x", outline: "pie-like", text: "nope" }).then(r => r.isError)).toBe(true);
  }, 60_000);

  test("a taken name is refused with a did-you-mean; so is a bad one", async () => {
    const taken = await call(chat, "outline_new", { name: "gurgle", purpose: "again" });
    expect(taken.isError).toBe(true);
    expect(taken.text).toContain("already exists");
    expect(taken.text).toContain(`ep0ch://gurgle@${HERE}`);
    expect(taken.text).toContain("free name is gurgle-2");
    const near = await call(chat, "outline_new", { name: "gurgl", purpose: "typo?" });
    expect(near.json).toMatchObject({ outcome: "created" });         // a different name: made
    expect((await call(chat, "outline_new", { name: "Bad Name", purpose: "x" })).isError).toBe(true);
    expect((await call(chat, "outline_new", { name: "ok-name", purpose: "a ] b" })).text).toContain("one line");
  }, 60_000);

  test("the weekly cap is per principal, configurable, and the refusal names the ones already made", async () => {
    setEnv({ EP0CH_MCP_SCRATCH_CAP: "2" });
    // code has made gurgle (1); one more is its second.
    expect((await call(code, "outline_new", { name: "links-a", purpose: "links" })).json.outcome).toBe("created");
    const third = await call(code, "outline_new", { name: "links-b", purpose: "more links" });
    expect(third.isError).toBe(true);
    expect(third.text).toContain("gurgle");
    expect(third.text).toContain("links-a");
    expect(third.text).toContain("EP0CH_MCP_SCRATCH_CAP");
    // Another principal has its own count: chat has made gurgl only.
    expect((await call(chat, "outline_new", { name: "links-c", purpose: "chat's links" })).json.outcome).toBe("created");
    setEnv({});
  }, 60_000);

  test("archive hides it and keeps the database; only its maker may; unarchive restores; the name stays taken", async () => {
    expect((await call(chat, "outline_archive", { name: "links-a" })).text).toContain("only claude-code@");
    expect((await call(code, "outline_archive", { name: "pie-like" })).text).toContain("wasn't made with outline_new");
    const gone = await call(code, "outline_archive", { name: "links-a" });
    expect(gone.json).toMatchObject({ outcome: "archived" });
    expect((await listed(code)).map(o => o.outline)).not.toContain("links-a");
    expect((await call(code, "outline_new", { name: "links-a", purpose: "again" })).text).toContain("archived");
    // Archived ones still count against the cap.
    setEnv({ EP0CH_MCP_SCRATCH_CAP: "2" });
    expect((await call(code, "outline_new", { name: "links-z", purpose: "z" })).text).toContain("links-a");
    setEnv({});
    expect((await call(chat, "outline_archive", { name: "links-a", restore: true })).isError).toBe(true);
    expect((await call(code, "outline_archive", { name: "links-a", restore: true })).json).toMatchObject({ outcome: "restored" });
    expect((await listed(code)).map(o => o.outline)).toContain("links-a");
    // Nothing deletes over MCP.
    expect(await toolNames(code)).not.toContain("outline_delete");
  }, 60_000);

  test("attribution shows in a proposal: who wrote it, the persona and the principal", async () => {
    const board = boardOn("gurgle");
    await board.configureMcpAccess("propose");          // a person tightens the others to proposals
    try {
      const note = (await board.children((await board.roots()).find(r => r.text.includes("[kind::scratch]"))!.id))[0]!;
      const rec = (await board.records([note.id])).records[0]!;
      setEnv({ EP0CH_MCP_PERSONAS: "chat.example.test=daddy" });
      const proposed = await call(chat, "outline_patch", { ref: note.id, outline: "gurgle", revision: rec.revision, patches: [{ observed: "first burp", replacement: "first burp, louder" }] });
      expect(proposed.json).toMatchObject({ outcome: "proposed", by: "daddy (chat.example.test)" });
      const proposal = (await board.records([proposed.json.detail.proposalId])).records[0]!;
      expect(proposal.actor).toBe("mcp:daddy/chat.example.test");
      expect(mcpRecord(proposal).by).toBe("daddy (chat.example.test)");
      // The creator is still full: its patch applies.
      const mine = await call(code, "outline_patch", { ref: note.id, outline: "gurgle", revision: (await board.records([note.id])).records[0]!.revision, patches: [{ observed: "first burp", replacement: "first burp, applied" }] });
      expect(mine.json, mine.text).toMatchObject({ outcome: "applied" });
    } finally { setEnv({}); await board.configureMcpAccess("read"); }
  }, 60_000);

  test("two outline_new at once can't both take the last place under the cap", async () => {
    setEnv({ EP0CH_MCP_SCRATCH_CAP: "1" });
    const racer = { sub: "stdio", clientId: "racer" } satisfies McpCaller;
    const [a, b] = await Promise.all([call(racer, "outline_new", { name: "race-a", purpose: "a" }), call(racer, "outline_new", { name: "race-b", purpose: "b" })]);
    expect([a.isError, b.isError].sort()).toEqual([false, true]);
    setEnv({});
  }, 60_000);

  test("stdio: an outline made in the session is served in it, listed on the same connection", async () => {
    const bound = boundOutlines(Object.assign(boardOn("pie-like"), { address: { outline: "pie-like", machine: HERE } }) as any, admin());
    const run = async (name: string, args: Record<string, unknown>) => {
      const a = await answerMcp(bound, JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }), code);
      const r = (a!.reply as any).result; return { isError: !!r.isError, json: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })() };
    };
    setEnv({ EP0CH_MCP_SCRATCH_CAP: "20" });
    const made = await run("outline_new", { name: "stdio-pad", purpose: "stdio scratch" });
    expect(made.json).toMatchObject({ outcome: "created" });
    const rows = (await run("list_outlines", {})).json.outlines as { outline: string; access: string; about?: { purpose: string } }[];
    expect(rows.map(r => r.outline)).toEqual(["pie-like", "stdio-pad"]);
    expect(rows[1]).toMatchObject({ access: "full", about: { purpose: "stdio scratch" } });
    const root = (await boardOn("stdio-pad").roots()).find(r => r.text.includes("[kind::scratch]"))!;
    expect((await run("outline_create", { ref: root.id, outline: "stdio-pad", text: "scribble" })).json.outcome).toBe("applied");
    // Put away, it leaves the session's list; brought back, it returns to it.
    expect((await run("outline_archive", { name: "stdio-pad" })).json.outcome).toBe("archived");
    expect(((await run("list_outlines", {})).json.outlines as { outline: string }[]).map(r => r.outline)).toEqual(["pie-like"]);
    expect((await run("outline_archive", { name: "stdio-pad", restore: true })).json.outcome).toBe("restored");
    expect(((await run("list_outlines", {})).json.outlines as { outline: string }[]).map(r => r.outline)).toEqual(["pie-like", "stdio-pad"]);
    setEnv({});
  }, 60_000);

  test("the host's list and the CLI's words show who made it and why", () => {
    expect(aboutListing({ createdBy: `loki/${CODE_PRINCIPAL}`, principal: CODE_PRINCIPAL, persona: "loki", created: "2026-10-09T00:00:00.000Z", purpose: "x", kind: "scratch" }).by).toBe(`loki (${CODE_PRINCIPAL})`);
    expect(actorLabel(`loki/${CODE_PRINCIPAL}`)).toBe(`loki (${CODE_PRINCIPAL})`);
  });
});
