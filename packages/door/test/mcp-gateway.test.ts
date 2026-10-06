// The remote MCP gateway (ADR 0002 decision 4): the stdio server's tools over streamable HTTP, behind OAuth. Tokens
// are signed here with a test key set and a fake Clerk issuer; outlines are a scratch host's, with fictional notes.
// Real HTTP throughout: a hand-rolled client against the gateway on a loopback port.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { gatewayConfig, issuerFromPublishableKey, machineOutlines, mcpServeCommand, startGateway, verifyBearer, type Gateway } from "../src/mcp-gateway";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { hostRequest, SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const PERSON = "user_fictional_a";
const STRANGER = "user_fictional_b";

type Key = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let signing: Key, other: Key, keys: ReturnType<typeof createLocalJWKSet>;

async function token(over: { claims?: JWTPayload; typ?: string; key?: Key; aud?: string | null; iss?: string; exp?: string; sub?: string } = {}) {
  let jwt = new SignJWT({ client_id: "client_fictional", scope: "profile", ...over.claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: over.typ ?? "at+jwt" })
    .setIssuer(over.iss ?? ISSUER)
    .setSubject(over.sub ?? PERSON)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? "5m");
  if (over.aud !== null) jwt = jwt.setAudience(over.aud ?? RESOURCE);
  return jwt.sign(over.key ?? signing);
}

describe.skipIf(!outliner)("ep0ch mcp serve --http", () => {
  const scratch = new Scratch();
  const logs: string[] = [];
  const oldEnv: Record<string, string | undefined> = {};
  let gateway: Gateway, capture: Gateway, closeOutlines: () => void, closeCapture: () => void;
  let board: SocketBoard, machine = "", note = { id: "", uri: "" }, quiet = { id: "", uri: "" };
  let nextId = 1;

  const call = async (body: unknown, opts: { auth?: string | null; at?: Gateway; method?: string } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const auth = opts.auth === undefined ? `Bearer ${await token()}` : opts.auth;
    if (auth) headers.Authorization = auth;
    return fetch((opts.at ?? gateway).url, { method: opts.method ?? "POST", headers, ...(opts.method && opts.method !== "POST" ? {} : { body: JSON.stringify(body) }) });
  };
  const rpc = async (method: string, params?: unknown, auth?: string | null) => {
    const res = await call({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }, { auth });
    return { status: res.status, body: await res.json() as { result?: any; error?: { message: string } } };
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const { body } = await rpc("tools/call", { name, arguments: args });
    const result = body.result as { isError?: boolean; content: { text: string }[] };
    return { isError: !!result.isError, text: result.content[0]!.text };
  };

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signing = pair.privateKey;
    other = (await generateKeyPair("RS256")).privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] });

    const sock = await scratch.start();
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
    machine = canonicalLocalMachineName();
    board = new SocketBoard(sock);
    await board.info();
    await board.configureMcpAccess("read");
    const made = await board.request<{ id: string }>("create", { parentId: null, text: "Lantern inventory\nThree brass lanterns by the shed door.", author: "agent" });
    note = { id: made.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: made.id }) };
    // A second outline on the same host, never granted: its notes stay out of reach.
    await hostRequest(sock, "outlines.create", { name: "quiet-pond" });
    const pond = new SocketBoard(sock, undefined, "quiet-pond");
    const q = await pond.request<{ id: string }>("create", { parentId: null, text: "Pond survey\nFrogs counted at dusk.", author: "agent" });
    quiet = { id: q.id, uri: formatEp0chBlockUri({ outline: "quiet-pond", machine, blockId: q.id }) };
    pond.close();

    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: ` ${PERSON} ` });
    if ("error" in config) throw new Error(config.error);
    const outlines = machineOutlines(undefined, line => logs.push(line));
    closeOutlines = outlines.close;
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: line => logs.push(line) });
    const captureConfig = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER });
    if ("error" in captureConfig) throw new Error(captureConfig.error);
    const captureOutlines = machineOutlines();
    closeCapture = captureOutlines.close;
    capture = startGateway({ config: captureConfig, outlines: captureOutlines, port: 0, bind: "127.0.0.1", keys, log: line => logs.push(line) });
  }, 30_000);

  afterAll(async () => {
    gateway?.stop(); capture?.stop(); closeOutlines?.(); closeCapture?.();
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  test("serves protected-resource metadata naming the issuer, without a token", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await fetch(new URL(path, gateway.url));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ["header"] });
    }
  });

  test("no token is 401 with WWW-Authenticate naming the resource metadata", async () => {
    for (const auth of [null, "Basic Zm9vOmJhcg==", "Bearer"]) {
      const res = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { auth });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"`);
    }
    // Every method, not just POST, asks for the token first.
    expect((await call(null, { auth: null, method: "GET" })).status).toBe(401);
    expect((await call(null, { auth: null, method: "DELETE" })).status).toBe(401);
  });

  test("a bad signature, another audience, another issuer, a session token or an expired one is 401", async () => {
    const refused = [
      await token({ key: other }),
      await token({ aud: "https://elsewhere.example.test/mcp" }),
      await token({ aud: null }),
      await token({ aud: `${RESOURCE}/` }),
      await token({ iss: "https://another-clerk.example.test" }),
      await token({ typ: "JWT" }),
      await token({ exp: "-5m" }),
      `${(await token()).slice(0, -4)}AAAA`,
      "oat_fictional_opaque_token",
      "not.a.jwt",
    ];
    for (const t of refused) {
      const res = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { auth: `Bearer ${t}` });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain(`error="invalid_token"`);
      expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    }
  });

  test("a valid token whose subject isn't listed is 403, and its subject is logged", async () => {
    logs.length = 0;
    const res = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { auth: `Bearer ${await token({ sub: STRANGER })}` });
    expect(res.status).toBe(403);
    expect(logs.join("\n")).toContain(`sub=${STRANGER}`);
  });

  test("a client registered either way passes: a CIMD URL client_id or a DCR id, and the client list pins either", async () => {
    // A CIMD client's id is its metadata document's URL (a made-up one here); a DCR client's is Clerk's own id.
    const cimd = "https://client.example.test/oauth/client-metadata.json";
    const policy = { issuer: ISSUER, resource: RESOURCE, allowedSubjects: [PERSON], keys };
    const quiet = () => {};
    for (const client_id of [cimd, "client_fictional_dcr"]) {
      expect(await verifyBearer(`Bearer ${await token({ claims: { client_id } })}`, policy, quiet)).toMatchObject({ ok: true, sub: PERSON, clientId: client_id });
    }
    const pinned = { ...policy, allowedClients: [cimd] };
    expect(await verifyBearer(`Bearer ${await token({ claims: { client_id: cimd } })}`, pinned, quiet)).toMatchObject({ ok: true });
    expect(await verifyBearer(`Bearer ${await token({ claims: { client_id: "client_fictional_dcr" } })}`, pinned, quiet)).toMatchObject({ ok: false, status: 403 });
    expect(await verifyBearer(`Bearer ${await token({ claims: { client_id: undefined } })}`, pinned, quiet)).toMatchObject({ ok: false, status: 403 });
  });

  test("capture mode (no subjects listed) refuses even the owner's valid token, logging the subject to pin", async () => {
    logs.length = 0;
    const res = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { at: capture });
    expect(res.status).toBe(403);
    expect(logs.join("\n")).toContain(`EP0CH_MCP_ALLOWED_SUBJECTS=${PERSON}`);
  });

  test("an allowed token speaks MCP: initialize, a notification (202), tools/list; GET is 405", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fictional-client", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "ep0ch" } });
    const notified = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notified.status).toBe(202);
    const listed = await rpc("tools/list");
    expect((listed.body.result.tools as { name: string }[]).map(t => t.name)).toEqual(["list_outlines", "outline_read", "outline_find", "outline_links"]);
    expect((await call(null, { method: "GET" })).status).toBe(405);
    const malformed = await fetch(gateway.url, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: "{not json" });
    expect(malformed.status).toBe(400);
    const batch = Array.from({ length: 17 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    expect((await call(batch)).status).toBe(400);
    expect((await call(batch.slice(0, 2))).status).toBe(200);
  });

  test("an allowed token on an outline granted read reads it, by URI and by outline name", async () => {
    const read = await tool("outline_read", { uri: note.uri });
    expect(read.isError).toBe(false);
    expect(JSON.parse(read.text)).toMatchObject({ uri: note.uri, reachability: { status: "reachable", level: "read", reason: "MCP access is read (remote gateway)" }, record: { id: note.id, text: expect.stringContaining("brass lanterns") } });
    const found = JSON.parse((await tool("outline_find", { query: "Lantern inventory", outline: scratch.name })).text) as { matches: { id: string; uri: string }[] };
    expect(found.matches).toContainEqual(expect.objectContaining({ id: note.id, uri: note.uri }));
    const byRef = await tool("outline_links", { ref: `((${note.id}))`, outline: scratch.name });
    expect(JSON.parse(byRef.text)).toMatchObject({ uri: note.uri });
    const resource = await rpc("resources/read", { uri: note.uri });
    expect(resource.body.result.contents[0]).toMatchObject({ uri: note.uri, mimeType: "text/markdown", text: expect.stringContaining("brass lanterns") });
  });

  test("an allowed token on an outline set to none is refused, and so is every outline it can't name", async () => {
    const quietRead = await tool("outline_read", { uri: quiet.uri });
    expect(quietRead.isError).toBe(true);
    expect(quietRead.text).toContain("MCP access is none for quiet-pond");
    expect(quietRead.text).not.toContain("Frogs");
    expect((await tool("outline_find", { query: "Pond", outline: "quiet-pond" })).isError).toBe(true);
    const resource = await rpc("resources/read", { uri: quiet.uri });
    expect(resource.body.error?.message).toContain("MCP access is none");

    const elsewhere = await tool("outline_read", { uri: note.uri.replace(`@${machine}`, "@another-box") });
    expect(elsewhere.isError).toBe(true);
    expect(elsewhere.text).toContain("is on another machine");
    // No outline is named, and one that doesn't exist is never made.
    expect((await tool("outline_find", { query: "Lantern" })).text).toContain("Name the outline");
    const missing = await tool("outline_find", { query: "x", outline: "no-such-outline" });
    expect(missing.isError).toBe(true);
    expect(missing.text).not.toContain(scratch.outlines);
    const hosted = await hostRequest<{ outlines: { name: string }[] }>(scratch.sock, "outlines.list");
    expect(hosted.outlines.map(o => o.name)).not.toContain("no-such-outline");

    // Revoking is the outline's own setting, at once: the next read is refused.
    await board.configureMcpAccess("none");
    try {
      const revoked = await tool("outline_read", { uri: note.uri });
      expect(revoked.isError).toBe(true);
      expect(revoked.text).toContain("MCP access is none");
    } finally { await board.configureMcpAccess("read"); }
  });

  test("config refuses to start without a resource, an issuer, or with plain http off loopback", async () => {
    expect(gatewayConfig({ EP0CH_MCP_ISSUER: ISSUER })).toMatchObject({ error: expect.stringContaining("EP0CH_MCP_RESOURCE") });
    expect(gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE })).toMatchObject({ error: expect.stringContaining("with-secrets clerk") });
    expect(gatewayConfig({ EP0CH_MCP_RESOURCE: "http://mcp.example.test/mcp", EP0CH_MCP_ISSUER: ISSUER })).toMatchObject({ error: expect.stringContaining("https") });
    expect(gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: "http://fake-clerk.example.test" })).toMatchObject({ error: expect.stringContaining("https") });
    // A publishable key names its Frontend API: "pk_test_" + base64("<host>$").
    const pk = `pk_test_${Buffer.from("fictional-otter-12.clerk.accounts.dev$").toString("base64")}`;
    expect(issuerFromPublishableKey(pk)).toBe("https://fictional-otter-12.clerk.accounts.dev");
    expect(gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, CLERK_PUBLISHABLE_KEY: pk })).toMatchObject({ issuer: "https://fictional-otter-12.clerk.accounts.dev" });
    const errs: string[] = [];
    expect(await mcpServeCommand(["--http"], { env: {}, err: line => errs.push(line) })).toBe(2);
    expect(await mcpServeCommand([], { env: {}, err: line => errs.push(line) })).toBe(2);
    expect(errs.join("\n")).toContain("--http");
  });
});
