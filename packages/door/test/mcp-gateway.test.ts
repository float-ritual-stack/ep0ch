// The remote MCP gateway (ADR 0002 decision 4): the stdio server's tools over streamable HTTP, behind OAuth. Tokens
// are signed here with a test key set and a fake Clerk issuer; outlines are a scratch host's, with fictional notes.
// Real HTTP throughout: a hand-rolled client against the gateway on a loopback port.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { gatewayConfig, issuerFromPublishableKey, machineOutlines, mcpServeCommand, startGateway, verifyBearer, type Gateway } from "../src/mcp-gateway";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { hostRequest, SocketBoard } from "../src/socket";
import { outliner, Scratch, scratchDir } from "./scratch";

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
    expect((listed.body.result.tools as { name: string }[]).map(t => t.name)).toEqual(["list_outlines", "outline_read", "outline_threads", "outline_find", "outline_query", "outline_links", "outline_components"]);
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
    expect(JSON.parse(read.text)).toMatchObject({ uri: note.uri, reachability: { status: "reachable", level: "read", reason: "MCP access is read (remote gateway)" }, record: { id: note.id, body: expect.stringContaining("brass lanterns") } });
    const found = JSON.parse((await tool("outline_find", { query: "Lantern inventory", outline: scratch.name })).text) as { matches: { id: string; uri: string }[] };
    expect(found.matches).toContainEqual(expect.objectContaining({ id: note.id, uri: note.uri }));
    const byRef = await tool("outline_links", { ref: `((${note.id}))`, outline: scratch.name });
    expect(JSON.parse(byRef.text)).toMatchObject({ uri: note.uri });
    const resource = await rpc("resources/read", { uri: note.uri });
    expect(resource.body.result.contents[0]).toMatchObject({ uri: note.uri, mimeType: "text/markdown", text: expect.stringContaining("brass lanterns") });
  });

  test("outline_components: the brief for all or named components, and each as a resource; an unknown one is refused with the list", async () => {
    const all = await tool("outline_components", { outline: scratch.name });
    expect(all.isError).toBe(false);
    expect(all.text).toContain("## heading-style\n");
    expect(all.text).toContain("## callout\n");
    const one = await tool("outline_components", { outline: scratch.name, components: ["rule"] });
    expect(one.text.startsWith("## rule\n")).toBe(true);
    expect(one.text).not.toContain("## callout");
    const bad = await tool("outline_components", { outline: scratch.name, components: ["nope"] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("no component nope; components: heading-style");
    // A component an extension ships is one more of the same answer: no code of the gateway's own (PIE-701).
    const dir = join(scratch.workspace, "extensions", "moods");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "moods", version: 1, name: "Moods", components: [{
        id: "mood", title: "Mood", intro: "How a standup went.", where: "`[mood::…]` on a standup's note",
        props: [{ key: "mood", where: "line", type: "enum", meaning: "how it went", values: [{ value: "calm", meaning: "nothing on fire" }] }],
        source: { use: "Standup [mood::{mood}]" }, example: { mood: "calm" }, sweep: ["mood"], grids: [], space: ["mood"],
      }],
    }));
    await board.request("extensions.list", { reload: true });
    const mood = await tool("outline_components", { outline: scratch.name, components: ["mood"] });
    expect(mood.isError).toBe(false);
    expect(mood.text).toContain("## mood (ext:moods)\n");
    expect(mood.text).toContain("- mood: calm — how it went");
    const listed = await rpc("resources/list");
    expect((listed.body.result.resources as { uri: string }[]).map(r => r.uri)).toContain(`ep0ch://${scratch.name}@${machine}/components/mood`);
    const uri = `ep0ch://${scratch.name}@${machine}/components/rule`;
    expect((listed.body.result.resources as { uri: string }[]).map(r => r.uri)).toContain(uri);
    const read = await rpc("resources/read", { uri });
    expect(read.body.result.contents[0]).toMatchObject({ uri, mimeType: "text/markdown", text: one.text });
    await board.configureMcpAccess("none");
    try {
      expect((await tool("outline_components", { outline: scratch.name })).isError).toBe(true);
      expect(((await rpc("resources/list")).body.result.resources as { uri: string }[]).some(r => r.uri === uri)).toBe(false);
    } finally { await board.configureMcpAccess("read"); }
  });

  test("a record is sent once: body and properties, no text or header; a note naming itself isn't its own link or backlink", async () => {
    const made = await board.request<{ id: string; revision: number }>("create", { parentId: null, text: "Kettle log", author: "agent" });
    const self = await board.request<{ revision: number }>("update", { blockId: made.id, text: `Kettle log [shelf::top]\nDescaled again, see ((${made.id})) and ((${note.id})).`, expectedRevision: made.revision, mutation: { author: "agent", actorId: "test-agent" } });
    expect(self.revision).toBeGreaterThan(made.revision);
    const uri = formatEp0chBlockUri({ outline: scratch.name, machine, blockId: made.id });
    const read = JSON.parse((await tool("outline_read", { uri })).text);
    expect(read.record).toMatchObject({ id: made.id, title: "Kettle log", body: expect.stringContaining("Descaled again"), properties: [{ key: "shelf", values: ["top"] }] });
    expect(read.record).not.toHaveProperty("text");
    expect(read.record).not.toHaveProperty("header");
    expect(read.record.links.map((l: { target: string }) => l.target)).toEqual([note.id]);
    expect(read.record.links[0]).not.toHaveProperty("spans");
    expect(read.record.backlinks).toEqual([]);
    const links = JSON.parse((await tool("outline_links", { uri })).text);
    expect(links.links.map((l: { target: string }) => l.target)).toEqual([note.id]);
    expect(links.backlinks.map((b: { blockId: string }) => b.blockId)).not.toContain(made.id);
    // The note it names has it as a backlink, as before.
    const named = JSON.parse((await tool("outline_links", { uri: note.uri })).text);
    expect(named.backlinks.map((b: { blockId: string }) => b.blockId)).toContain(made.id);
  });

  test("list_outlines lists every outline in this machine's outlines folder, with its access", async () => {
    const listed = JSON.parse((await tool("list_outlines", {})).text) as { outlines: { outline: string; source: string; access?: string }[]; tools: { writes: boolean; said: string } };
    expect(listed.outlines).toContainEqual(expect.objectContaining({ outline: scratch.name, machine, source: "live", access: "read" }));
    expect(listed.outlines).toContainEqual(expect.objectContaining({ outline: "quiet-pond", machine, source: "live", access: "none" }));
    // Nothing here takes writes; the answer says a client caches its tool list until it reconnects.
    expect(listed.tools).toEqual({ writes: false, said: expect.stringContaining("reconnect") });
  });

  test("an outline whose host doesn't answer is still listed, as unreachable, never left out", async () => {
    // A folder with an outline in it and no host on its socket: the list used to ask the host for names, and a host
    // that didn't answer in time left every live outline out of list_outlines.
    const folder = scratchDir("ep0ch-mcp-nohost-");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "reed-bed.sqlite"), "");
    const was = process.env.EP0CH_OUTLINES;
    process.env.EP0CH_OUTLINES = folder;
    const lonely = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no carrier" }));
    try {
      const rows = await lonely.list();
      expect(rows).toEqual([expect.objectContaining({ outline: "reed-bed", machine, source: "unreachable", note: expect.stringContaining("reed-bed") })]);
    } finally { lonely.close(); process.env.EP0CH_OUTLINES = was; }
  });

  test("a ref is the Claude mod's: an id, ((id)), [[page]] or Work ID, resolved in the named outline", async () => {
    await board.request("work-ids.configure", { prefix: "SHED" });
    const made = await board.request<{ id: string; revision: number }>("create", { parentId: null, text: "Mend the wheelbarrow\nThe tyre is flat.", author: "agent" });
    const { workId } = await board.request<{ workId: string }>("work-ids.allocate", { blockId: made.id, expectedRevision: made.revision });
    const page = (await board.request<{ block: { id: string } }>("pages.follow", { address: "Tool shed", author: "agent" })).block;
    for (const [ref, id] of [[workId, made.id], [`[[${workId}]]`, made.id], ["[[Tool shed]]", page.id], [made.id, made.id], [`((${made.id}))`, made.id]] as const) {
      const read = await tool("outline_read", { ref, outline: scratch.name });
      expect(read.isError).toBe(false);
      expect(JSON.parse(read.text).record.id).toBe(id);
      const links = await tool("outline_links", { ref, outline: scratch.name });
      expect(JSON.parse(links.text).id).toBe(id);
    }
    // A title is refused as the mod refuses it; a page that doesn't resolve is never made.
    expect((await tool("outline_read", { ref: "Mend the wheelbarrow", outline: scratch.name })).text).toContain("titles aren't accepted");
    const missing = await tool("outline_read", { ref: "[[No such shed]]", outline: scratch.name });
    expect(missing.isError).toBe(true);
    expect((await board.request<{ status: string }>("pages.resolve", { address: "No such shed" })).status).toBe("missing");
    // An outline this caller can't read isn't asked whether a page or Work ID exists in it.
    const refused = await tool("outline_read", { ref: "[[Pond survey]]", outline: "quiet-pond" });
    expect(refused.text).toContain("MCP access is none for quiet-pond");
  });

  test("record.backlinks and outline_links agree, property references included, in both directions", async () => {
    const make = async (text: string) => board.request<{ id: string; revision: number }>("create", { parentId: null, text, author: "agent" });
    const source = await make("Rain gauge readings");
    const proof = await make(`Gauge calibrated [source-block::${source.id}]`);
    // The source names the proof back: each is the other's link and backlink.
    await board.request("update", { blockId: source.id, text: `Rain gauge readings [proof::${proof.id}]`, expectedRevision: source.revision, mutation: { author: "agent", actorId: "test-agent" } });
    const oneWay = await make(`Gauge moved [source-block::${source.id}]`);
    const read = async (id: string) => JSON.parse((await tool("outline_read", { ref: id, outline: scratch.name })).text).record;
    const links = async (id: string) => JSON.parse((await tool("outline_links", { ref: id, outline: scratch.name })).text);
    for (const id of [source.id, proof.id, oneWay.id]) {
      const [record, linked] = [await read(id), await links(id)];
      expect(linked.backlinks.map((b: { blockId: string }) => b.blockId).sort()).toEqual(record.backlinks);
      expect(linked.links.map((l: { target: string }) => l.target)).toEqual(record.links.map((l: { target: string }) => l.target));
    }
    expect((await read(source.id)).backlinks.sort()).toEqual([proof.id, oneWay.id].sort());
    expect((await read(proof.id)).backlinks).toEqual([source.id]);
    // A note that only links out has no backlinks: its link target is never one.
    expect((await read(oneWay.id)).backlinks).toEqual([]);
    expect((await read(oneWay.id)).links.map((l: { target: string }) => l.target)).toEqual([source.id]);
  });

  test("outline_links cuts each group at limit and says per group whether it is whole, what it shows and the total", async () => {
    const make = async (text: string) => board.request<{ id: string }>("create", { parentId: null, text, author: "agent" });
    const [a, b] = [await make("Hose reel"), await make("Water butt")];
    const hub = await make(`Watering kit\nSee ((${a.id})) and ((${b.id})).`);
    await make(`Summer list\nCheck ((${hub.id})).`);
    await make(`Autumn list\nDrain ((${hub.id})).`);
    const one = JSON.parse((await tool("outline_links", { ref: hub.id, outline: scratch.name, limit: 1 })).text);
    expect(one.links).toHaveLength(1);
    expect(one.backlinks).toHaveLength(1);
    expect(one.completeness).toEqual({
      links: { complete: false, shown: 1, total: 2, more: true },
      resources: { complete: true, shown: 0, total: 0, more: false },
      backlinks: { complete: false, shown: 1, total: 2, more: true },
    });
    const all = JSON.parse((await tool("outline_links", { ref: hub.id, outline: scratch.name })).text);
    expect(all.completeness.links).toEqual({ complete: true, shown: 2, total: 2, more: false });
    expect(all.completeness.backlinks).toEqual({ complete: true, shown: 2, total: 2, more: false });
  });

  test("limit 0, a fraction or one past the maximum is refused, naming the default and the maximum", async () => {
    for (const limit of [0, -1, 2.5, 31, "5"]) {
      const r = await tool("outline_find", { query: "Lantern", outline: scratch.name, limit });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("limit is a whole number from 1 to 30 (default 30)");
    }
    expect((await tool("outline_links", { uri: note.uri, limit: 0 })).text).toContain("from 1 to 200 (default 50)");
    expect((await tool("outline_find", { query: "", outline: scratch.name, limit: 100 })).isError).toBe(false);
  });

  test("a uri and an outline that names another outline are refused, naming both", async () => {
    const r = await tool("outline_read", { uri: note.uri, outline: "quiet-pond" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(`uri names ${scratch.name}@${machine} and outline names quiet-pond`);
    expect((await tool("outline_read", { uri: note.uri, outline: scratch.name })).isError).toBe(false);
    expect((await tool("outline_read", { uri: note.uri, outline: `${scratch.name}@${machine}` })).isError).toBe(false);
  });

  test("a search says how it was ranked and why; a top-level note's path is (root)", async () => {
    const lexical = JSON.parse((await tool("outline_find", { query: "Lantern inventory", outline: scratch.name })).text);
    expect(lexical.search).toMatchObject({ asked: false, status: "lexical", said: expect.stringContaining("semantic: true") });
    expect(lexical.matches.find((m: { id: string }) => m.id === note.id).path).toBe("(root)");
    const asked = JSON.parse((await tool("outline_find", { query: "Lantern inventory", outline: scratch.name, semantic: true })).text);
    expect(asked.search.asked).toBe(true);
    // No Jev key in a scratch host: it says so rather than claiming a ranking it didn't get.
    if (asked.search.status !== "ranked") expect(asked.search.said).toContain("isn't available here");
    const listed = JSON.parse((await tool("outline_find", { query: "", outline: scratch.name })).text);
    expect(listed.matches.every((m: { path: string }) => m.path !== "")).toBe(true);
  });

  test("outline_find's completeness is about the answer: the limit asked for, and whether there are more", async () => {
    const one = JSON.parse((await tool("outline_find", { query: "", limit: 1, outline: scratch.name })).text);
    expect(one.completeness).toEqual({ kind: "truncated", limit: 1, more: true });
    expect(one.matches).toHaveLength(1);
    const all = JSON.parse((await tool("outline_find", { query: "", limit: 100, outline: scratch.name })).text);
    expect(all.completeness).toEqual({ kind: "complete", limit: 100, more: false });
    const searched = JSON.parse((await tool("outline_find", { query: "Lantern inventory", limit: 5, outline: scratch.name })).text);
    expect(searched.completeness).toMatchObject({ limit: 5 });
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
