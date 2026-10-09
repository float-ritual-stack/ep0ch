// PIE-685: a call names itself. Every connection has a call id (the HTTP gateway's Mcp-Session-Id, minted at
// `initialize`; one per stdio connection; or an id the agent gives on a request) and a readable handle minted once and
// stored, every write records the id beside the principal, `call:` finds what a call wrote, and a call's own
// recent-activity reads leave its writes out unless includeOwn. Each test runs over both transports against one scratch host with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { mcpCommand } from "../src/mcp";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const PERSON = "user_fictional_a";
const CLIENT = "client_fictional";

interface Result { isError: boolean; text: string; json: any }
interface Connection { call(name: string, args?: Record<string, unknown>): Promise<Result>; close(): Promise<void> }
interface Transport { name: string; open(): Promise<Connection> }
const parse = (r: { isError?: boolean; content: { text: string }[] }): Result => {
  const text = r.content[0]!.text;
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* an error's words */ }
  return { isError: !!r.isError, text, json };
};

describe.skipIf(!outliner)("calls: a write records its call, call: finds it, a call's own echo is left out", () => {
  const scratch = new Scratch();
  const oldEnv: Record<string, string | undefined> = {};
  const logs: string[] = [];
  let board: SocketBoard, gateway: Gateway, closeOutlines: () => void, signing: CryptoKey, rpcId = 1;
  let target = "";

  const stdio: Transport = {
    name: "stdio",
    async open() {
      // One mcpCommand is one connection: lines are fed to it one at a time and each reply is awaited.
      const queue: string[] = [], waiting: ((line: string | null) => void)[] = [], replies = new Map<number, (r: any) => void>();
      let closed = false;
      const next = () => new Promise<string | null>(resolve => { const line = queue.shift(); if (line !== undefined) resolve(line); else if (closed) resolve(null); else waiting.push(resolve); });
      const done = mcpCommand(["mcp"], {
        input: (async function* () { for (let l = await next(); l !== null; l = await next()) yield l; })(),
        write: l => { const r = JSON.parse(l); replies.get(r.id)?.(r); }, err: () => {},
      });
      const send = (method: string, params: unknown) => new Promise<any>(resolve => {
        const id = rpcId++;
        replies.set(id, resolve);
        const line = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        const w = waiting.shift();
        if (w) w(line); else queue.push(line);
      });
      return {
        async call(name, args = {}) { return parse((await send("tools/call", { name, arguments: name === "list_outlines" ? {} : { outline: scratch.name, ...args } })).result); },
        async close() { closed = true; for (const w of waiting.splice(0)) w(null); await done; },
      };
    },
  };
  const http: Transport = {
    name: "http",
    async open() {
      const jwt = async () => new SignJWT({ client_id: CLIENT, scope: "profile" }).setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
        .setIssuer(ISSUER).setSubject(PERSON).setAudience(RESOURCE).setIssuedAt().setExpirationTime("5m").sign(signing);
      let session: string | null = null;
      const post = async (method: string, params: unknown) => {
        const res = await fetch(gateway.url, { method: "POST", headers: {
          "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${await jwt()}`,
          ...(session ? { "Mcp-Session-Id": session } : {}),
        }, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }) });
        return { res, body: await res.json() as any };
      };
      const init = await post("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fictional-chat", version: "1" } });
      session = init.res.headers.get("mcp-session-id");
      return {
        async call(name, args = {}) { return parse((await post("tools/call", { name, arguments: name === "list_outlines" ? {} : { outline: scratch.name, ...args } })).body.result); },
        async close() {},
      };
    },
  };

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signing = pair.privateKey as CryptoKey;
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] });
    const sock = await scratch.start();
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
    board = new SocketBoard(sock);
    await board.info();
    await board.configureMcpAccess("full");
    target = (await board.request<{ id: string }>("create", { parentId: null, text: "Seed shelf [rank::1]\nA note a person wrote.", author: "user" })).id;
    const outlines = machineOutlines(undefined, l => logs.push(l));
    closeOutlines = outlines.close;
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: l => logs.push(l) });
  }, 40_000);

  afterAll(async () => {
    gateway?.stop(); closeOutlines?.();
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  const write = async (c: Connection, text: string, extra: Record<string, unknown> = {}) => {
    const r = await c.call("outline_create", { ref: target, text, ...extra });
    expect(r.isError).toBe(false);
    return r;
  };
  const callOf = async (c: Connection) => { const { id, handle } = (await c.call("list_outlines")).json.call as { id: string; handle: string }; return { id, handle }; };
  const findIds = async (c: Connection, query: string, extra: Record<string, unknown> = {}) =>
    (await c.call("outline_query", { query, fields: "id,title", limit: 50, ...extra })).json.matches.map((m: any) => m.title as string);

  describe.each([stdio, http])("over $name", t => {
    test("two connections get distinct call ids and handles; the id and handle are stable within one", async () => {
      const a = await t.open(), b = await t.open();
      try {
        const sa = await callOf(a), sb = await callOf(b);
        expect(sa.id).toMatch(/^c-[0-9a-f]{6}$/);
        expect(sa.handle).toMatch(/^[a-z]+_[a-z]+_[a-z]+$/);
        expect(sa.id).not.toBe(sb.id);
        expect(sa.handle).not.toBe(sb.handle);
        expect(await callOf(a)).toEqual(sa);
      } finally { await a.close(); await b.close(); }
    });

    test("a write carries its call beside its principal: the actor says who, the sessionId says which call", async () => {
      const a = await t.open();
      try {
        const s = await callOf(a);
        const r = await write(a, `carries ${t.name}`);
        expect(r.json.call).toMatchObject(s);
        const id = /\/b\/([^/?#]+)$/.exec(r.json.detail?.uri ?? r.json.uri ?? "")?.[1] ?? r.json.detail?.id;
        const made = await board.request<{ actorId?: string; sessionId?: string }>("get", { blockId: id });
        // The principal (display and access) is in the actor id, untouched; the call rides the sessionId after the subject.
        expect(made.actorId).toMatch(/^mcp:/);
        expect(made.sessionId).toMatch(new RegExp(`#${s.id}$`));
        expect(made.sessionId!.split("#")[0]).toBe(t.name === "stdio" ? "stdio" : PERSON);
      } finally { await a.close(); }
    });

    test("call: finds one call's writes, by id or by handle, and an agent-supplied call id is its own handle; a write with no call says so", async () => {
      const a = await t.open(), b = await t.open();
      try {
        const sa = await callOf(a);
        await write(a, `alpha one ${t.name}`);
        await write(b, `beta one ${t.name}`);
        await write(a, `gamma named ${t.name}`, { call: `daddy-${t.name}-k7f` });
        expect(await findIds(a, `call:${sa.id}`)).toEqual([`alpha one ${t.name}`]);
        expect(await findIds(a, `call:${sa.handle}`)).toEqual([`alpha one ${t.name}`]);
        expect(await findIds(a, `call:daddy-${t.name}-k7f`)).toEqual([`gamma named ${t.name}`]);
        expect((await a.call("outline_query", { query: "call:" })).isError).toBe(true);
      } finally { await a.close(); await b.close(); }
    });

    test("a call's own writes are left out of its recent-activity read, counted, and includeOwn brings them back; another call's still show", async () => {
      const a = await t.open(), b = await t.open();
      try {
        const sa = await callOf(a);
        await write(a, `mine ${t.name}`);
        await write(b, `theirs ${t.name}`);
        const recent = { query: "updated >= -1d", sort: "updated desc" };
        const titles = await findIds(a, recent.query, { sort: recent.sort });
        expect(titles).not.toContain(`mine ${t.name}`);
        expect(titles.some((x: string) => x.startsWith(`theirs ${t.name}`))).toBe(true);
        expect(titles.some((x: string) => x.startsWith("Seed shelf"))).toBe(true);
        const answer = (await a.call("outline_query", { ...recent, fields: "id,title", limit: 50 })).json;
        expect(answer.ownOmitted).toMatchObject({ call: sa.id, handle: sa.handle });
        expect(answer.ownOmitted.count).toBeGreaterThanOrEqual(1);
        expect(await findIds(a, recent.query, { sort: recent.sort, includeOwn: true })).toContain(`mine ${t.name}`);
        // A read that isn't about recent activity is not filtered.
        expect(await findIds(a, "rank")).toContain("Seed shelf");
        // The other call sees the first one's writes as news.
        expect((await findIds(b, recent.query, { sort: recent.sort })).some((x: string) => x.startsWith(`mine ${t.name}`))).toBe(true);
      } finally { await a.close(); await b.close(); }
    });
  });

  test("over HTTP the gateway logs each request's Mcp-Session-Id with its client, and a request with none has no call, and its write gets one of its own", async () => {
    const c = await http.open();
    const s = await callOf(c);
    await write(c, "logged write");
    expect(logs.some(l => l.includes(`client=${CLIENT}`) && l.includes(`call=${s.id}`) && l.includes("mcp-session-id="))).toBe(true);
    expect(logs.some(l => l.includes("mcp write:") && l.includes(`call=${s.id}`) && l.includes(s.handle))).toBe(true);
    // Without the header (a client that ignores sessions) a call is served, with no call to leave out.
    const jwt = await new SignJWT({ client_id: CLIENT, scope: "profile" }).setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
      .setIssuer(ISSUER).setSubject(PERSON).setAudience(RESOURCE).setIssuedAt().setExpirationTime("5m").sign(signing);
    const bare = async (name: string, args: Record<string, unknown>) => {
      const res = await fetch(gateway.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` }, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } }) });
      return parse(((await res.json()) as any).result);
    };
    expect((await bare("list_outlines", {})).json.call).toBeUndefined();
    const fresh = await bare("outline_create", { outline: scratch.name, ref: target, text: "unnamed write" });
    expect(fresh.json.call.id).toMatch(/^c-[0-9a-f]{6}$/);
    expect(fresh.json.call.said).toContain("pass call");
  });
});
