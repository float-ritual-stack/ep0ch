// An outline away on another machine, read through the MCP gateway from this machine's read-only copy (PIE-1091):
// outline_snapshot mints a link this machine's web client serves, reader_view says what its pages of the copy show,
// and a share is refused with why and what to do. Every answer says how fresh the copy is. "The other machine" is a
// scratch host whose database Litestream's follow leaves in the mirrors folder (a VACUUM INTO); the web client is the
// outliner's own OutlinePublishers with a RemoteOutline whose forward never answers, so it reads the same copy.
// Calls go over HTTP to the real gateway (startGateway) with tokens a test issuer signs. Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { McpOutlines } from "../src/mcp";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { OutlineMirror } from "../src/mcp-mirror";
import { SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";

/** The outliner's web client, loaded by path (the door's type checker reads its own sources, not the outliner's). */
interface Started { start(): Promise<void>; stop(): Promise<void> }
interface Web { handle(request: Request): Promise<Response>; stop(): Promise<void> }
type Ctor<T> = new (options: any, ...rest: any[]) => T;
const load = async <T>(file: string, name: string) => (await import(join(outliner!, "src", file)) as Record<string, Ctor<T>>)[name]!;

const FAR = "far-box";
const TAILNET = "garden.tail0000.ts.net";
const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const PERSON = "user_fictional_owner";

describe.skipIf(!outliner)("an away outline read from its copy here: snapshot, reader view, shares", () => {
  const far = new ScratchHost();
  const logs: string[] = [];
  let here = "", mirrors = "", nextId = 1;
  let garden: SocketBoard, porch: SocketBoard;
  let outlines: McpOutlines & { close(): void };
  let gateway: Gateway, sign: () => Promise<string>;
  let web: Web, home: Started;
  let lantern = "";
  let stale: { since: string; why: string } | null = null;
  let clock = Date.now();
  const savedWebUrl = process.env.EP0CH_WEB_URL;

  const follow = () => {
    const target = join(mirrors, FAR, "garden-notes.sqlite");
    rmSync(target, { force: true });
    const source = new Database(join(far.outlines, "garden-notes.sqlite"), { readonly: true });
    try { source.run("VACUUM INTO ?", [target]); } finally { source.close(); }
  };
  /** A tool call as claude.ai makes it: over HTTP to the gateway, with a token its issuer signed. */
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await fetch(gateway.url, {
      method: "POST", headers: { Host: "mcp.example.test", Authorization: `Bearer ${await sign()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
    const result = ((await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    return { isError: !!result.isError, text: result.content[0]!.text };
  };
  const fetchWeb = (url: string, init: RequestInit = {}) => web.handle(new Request(url, { ...init, headers: { host: TAILNET, ...(init.headers as Record<string, string> ?? {}) } }));

  beforeAll(async () => {
    await far.start();
    await far.create("garden-notes");
    await far.create("porch-notes");
    garden = new SocketBoard(far.sock, undefined, "garden-notes");
    porch = new SocketBoard(far.sock, undefined, "porch-notes");
    await garden.configureMcpAccess("full");
    lantern = (await garden.request<{ id: string }>("create", { parentId: null, text: "Lantern log\nThe lantern burned until the moths came.", author: "agent" })).id;
    here = scratchDir("ep0ch-away-");
    mirrors = join(here, "mirrors");
    mkdirSync(join(mirrors, FAR), { recursive: true });
    follow();
    process.env.EP0CH_WEB_URL = `https://${TAILNET}`;
    // The gateway: no outline of its own here, and the far machine's outline only from its copy (no live link).
    const mirror = new OutlineMirror("garden-notes", FAR, mirrors, line => logs.push(line), () => clock, async () => stale);
    outlines = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no local host" }), [mirror], async () => []);
    const pair = await generateKeyPair("RS256", { extractable: true });
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] });
    sign = () => new SignJWT({ client_id: "client_fictional", scope: "profile" }).setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
      .setIssuer(ISSUER).setSubject(PERSON).setAudience(RESOURCE).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: line => logs.push(line) });
    // The web client: its home outline (porch-notes stands in), and the far outline at /pub/o/garden-notes@far-box/,
    // whose forward never answers, so its pages read the copy.
    const [OutlinerClient, Publisher, RemoteOutline, OutlinePublishers] = await Promise.all([
      load<object>("client.ts", "OutlinerClient"), load<Started>("publish.ts", "Publisher"), load<object>("publish-remote.ts", "RemoteOutline"), load<Web>("publish-outlines.ts", "OutlinePublishers"),
    ]);
    home = new Publisher({ client: new OutlinerClient(far.sock, 15_000, "porch-notes"), basePath: "/pub", log: (line: string) => logs.push(line) });
    await home.start();
    const remote = new RemoteOutline({
      outline: "garden-notes", machine: FAR, mirrors, forward: async () => { throw new Error("far-box is asleep"); }, log: (line: string) => logs.push(line),
      publisher: (client: unknown, page: object) => new Publisher({ client, basePath: `/pub/o/garden-notes@${FAR}`, webRoot: "/pub", ...page, shares: false, log: (line: string) => logs.push(line) }),
    });
    web = new OutlinePublishers({ home, homeName: "porch-notes", names: async () => ["porch-notes"], remotes: [remote], open: () => { throw new Error("no other outline here"); }, log: (line: string) => logs.push(line) });
  }, 30_000);

  afterAll(async () => {
    if (savedWebUrl === undefined) delete process.env.EP0CH_WEB_URL; else process.env.EP0CH_WEB_URL = savedWebUrl;
    gateway?.stop();
    outlines?.close();
    await web?.stop();
    garden?.close(); porch?.close();
    await Bun.sleep(200);
    await far.dispose();
    if (here) rmSync(here, { recursive: true, force: true });
  }, 20_000);

  test("outline_snapshot answers from the copy, says how fresh it is, and this machine's web client serves the link once", async () => {
    const answer = await tool("outline_snapshot", { outline: "garden-notes" });
    expect(answer.isError).toBe(false);
    const snapshot = JSON.parse(answer.text) as { url: string; curl: string; sha256: string; bytes: number; source: string; asOf: string; note: string; said: string; expiresAt: string };
    expect(snapshot.source).toBe("mirror");
    expect(snapshot.asOf).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(snapshot.note).toContain(`garden-notes lives on ${FAR}`);
    expect(snapshot.url).toStartWith(`https://${TAILNET}/pub/o/garden-notes@${FAR}/s/`);
    expect(snapshot.said).toContain("read-only copy");
    expect(snapshot.said).toContain(snapshot.asOf);
    expect(Date.parse(snapshot.expiresAt)).toBeGreaterThan(Date.now());
    const got = await fetchWeb(snapshot.url);
    expect(got.status).toBe(200);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(bytes.byteLength).toBe(snapshot.bytes);
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(snapshot.sha256);
    const file = join(here, "downloaded.sqlite");
    writeFileSync(file, bytes);
    const db = new Database(file, { readonly: true });
    try { expect(JSON.stringify(db.query("SELECT text FROM blocks WHERE id = ?").get(lantern))).toContain("the moths came"); } finally { db.close(); }
    // It works once, as any snapshot's link does.
    expect((await fetchWeb(snapshot.url)).status).toBe(404);
  }, 30_000);

  test("a stale copy says it is stale in the snapshot's answer, never silently", async () => {
    stale = { since: "2026-03-14T08:00:00.000Z", why: "the mirror is at txid 3, the replica at 5" };
    try {
      // The mirror asks its follower's health at most once a minute.
      clock += 61_000;
      const snapshot = JSON.parse((await tool("outline_snapshot", { outline: "garden-notes" })).text);
      expect(snapshot.stale).toEqual(stale);
      expect(snapshot.said).toContain("stale since 2026-03-14T08:00:00.000Z");
    } finally { stale = null; }
  }, 30_000);

  test("reader_view says what this machine's web pages of the copy show, with the copy's freshness", async () => {
    const page = `https://${TAILNET}/pub/o/garden-notes@${FAR}/p/${lantern}`;
    expect((await fetchWeb(page, { headers: { accept: "text/html" } })).status).toBe(200);
    const reported = await fetchWeb(`https://${TAILNET}/pub/o/garden-notes@${FAR}/_marginalia/view`, {
      method: "POST", headers: { origin: `https://${TAILNET}`, "content-type": "application/json" },
      body: JSON.stringify({ page: lantern, url: page, quote: "the moths came", prefix: "The lantern burned until ", suffix: ".", visitor: "tab-0000-1111" }),
    });
    expect(reported.status).toBe(200);
    const answer = await tool("reader_view", { outline: "garden-notes" });
    expect(answer.isError).toBe(false);
    const seen = JSON.parse(answer.text);
    expect(seen).toMatchObject({ source: "mirror", asOf: expect.any(String), view: { blockId: lantern, title: "Lantern log", selection: { text: "the moths came" } } });
    expect(seen.said).toContain("Lantern log");
    expect(seen.said).toContain("read-only copy");
  }, 30_000);

  test("a share of the away outline is refused, with why and the two ways out", async () => {
    const refused = await tool("share_start", { outline: "garden-notes", ref: lantern });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`garden-notes lives on ${FAR}`);
    expect(refused.text).toContain("live");
    expect(refused.text).toContain(`ep0ch share start ${lantern} --ws garden-notes`);
    expect(refused.text).toContain("outline_snapshot");
  });

  test("a snapshot of the copy is listed and revoked like any other: its link ends at once", async () => {
    const snapshot = JSON.parse((await tool("outline_snapshot", { outline: "garden-notes" })).text) as { url: string; shareId: string };
    const listed = JSON.parse((await tool("share_list", { outline: "garden-notes" })).text) as { shares: { id: string }[] };
    expect(listed.shares.map(s => s.id)).toContain(snapshot.shareId);
    const revoked = JSON.parse((await tool("share_revoke", { outline: "garden-notes", id: snapshot.shareId })).text) as { revoked: string[] };
    expect(revoked.revoked).toEqual([snapshot.shareId]);
    expect((await fetchWeb(snapshot.url)).status).not.toBe(200);
  }, 30_000);
});
