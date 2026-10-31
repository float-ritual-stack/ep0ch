// The remote MCP gateway's writes (PIE-615), end to end over real HTTP. Two scratch hosts: "here" (the gateway's
// machine, whose outlines it writes directly) and a far box standing in for the laptop, whose outline the gateway reads
// from a read-only mirror and whose writes queue (netmail) until the far box pulls them over ssh. The ssh is the fake one
// (packages/outliner/test/fake-ssh.ts), whose "other machine" runs this checkout's `ep0ch` against the gateway's queue.
// Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { OutlineMirror } from "../src/mcp-mirror";
import { Netmail, pullNetmail } from "../src/mcp-netmail";
import { incidents, type BackupState } from "../src/backup/alert";
import { readQueues } from "../src/backup/netmail";
import { actorLabel } from "@ep0ch/outline-core/attribution";
import { clientName, actorOf as actorOfIn, levelFor, pathCap, personaClaim, principalOf, STDIO_SUBJECT } from "../src/mcp-writes";
import { remoteWrite } from "../src/app";
import { canonicalLocalMachineName, type NotesBoard } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";
import { prop } from "../src/props";

// A persona is read from the environment given, else ~/.config/ep0ch/mcp.env under its HOME (XDG_CONFIG_HOME first). A call with
// an environment of its own would otherwise fall through to the person's real home, and a persona of theirs would leak into
// the actor id (agent-env's XDG folders don't reach it: the environment is the test's own). Every call here gets an empty HOME.
const emptyHome = scratchDir("ep0ch-nohome-");
afterAll(() => rmSync(emptyHome, { recursive: true, force: true }));
const actorOf: typeof actorOfIn = (caller, env, machine) => actorOfIn(caller, { HOME: emptyHome, ...env }, machine);

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const HOST = "mcp.example.test";
const PERSON = "user_fictional_a";
const CLIENT = "https://chat.example.test/oauth/client-metadata";
const FAR = "far-box";
const DOOR = resolve(import.meta.dir, "..");
/** The gateway's own machine, as its URIs name it. */
const HERE = canonicalLocalMachineName();

describe.skipIf(!outliner)("the gateway's writes: applied here, queued for a far box and pulled", () => {
  const here = new ScratchHost(), far = new ScratchHost();
  let dir = "", mirrors = "", gateway: Gateway, closeOutlines: () => void;
  let signing: CryptoKey, keys: ReturnType<typeof createLocalJWKSet>;
  const boards: SocketBoard[] = [];
  const logs: string[] = [];
  let nextId = 1;
  const ids: Record<string, string> = {};
  const env: Record<string, string> = {};

  const boardOn = (host: ScratchHost, outline: string, machine: string): NotesBoard => {
    const b = Object.assign(new SocketBoard(host.sock, 30_000, outline), { address: { outline, machine } });
    boards.push(b);
    return b;
  };
  const follow = (name: string) => {
    const target = join(mirrors, FAR, `${name}.sqlite`);
    rmSync(target, { force: true });
    const source = new Database(join(far.outlines, `${name}.sqlite`), { readonly: true });
    try { source.run("VACUUM INTO ?", [target]); } finally { source.close(); }
  };
  const token = async (aud = RESOURCE, who = { sub: PERSON, clientId: CLIENT }) => new SignJWT({ client_id: who.clientId, scope: "profile" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" }).setIssuer(ISSUER).setSubject(who.sub).setAudience(aud)
    .setIssuedAt().setExpirationTime("5m").sign(signing);
  /** A request at the gateway's `/mcp`, or at `/<persona>/mcp` (`at`), with a token for that path's resource. */
  const rpc = async (method: string, params?: unknown, at?: string, who?: { sub: string; clientId: string }) => {
    const url = at ? `${new URL(gateway.url).origin}/${at}/mcp` : gateway.url;
    const res = await fetch(url, { method: "POST", headers: { Host: HOST, "Content-Type": "application/json", Authorization: `Bearer ${await token(at ? `https://mcp.example.test/${at}/mcp` : RESOURCE, who)}` }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }) });
    return await res.json() as { result?: any; error?: { message: string } };
  };
  const tool = async (name: string, args: Record<string, unknown>, at?: string, who?: { sub: string; clientId: string }) => {
    const r = await rpc("tools/call", { name, arguments: args }, at, who);
    if (r.error) return { isError: true, text: r.error.message, json: null as any };
    const text = (r.result as { content: { text: string }[] }).content[0]!.text;
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* an error's words */ }
    return { isError: !!r.result.isError, text, json };
  };
  /** The block's edits by the remote client, from the outline's own activity: who, and as which subject. */
  const editsBy = async (host: ScratchHost, outline: string, blockId: string) =>
    (await boardOn(host, outline, "x").request<{ entries: { block: { id: string }; actorId?: string; sessionId?: string }[] }>("activity.recent", { since: "2000-01-01T00:00:00.000Z", author: "agent", actorId: "mcp:chat.example.test", limit: 100, kinds: ["text", "properties"] }))
      .entries.filter(e => e.block.id === blockId).map(e => ({ actorId: e.actorId, sessionId: e.sessionId }));
  const textOf = async (host: ScratchHost, outline: string, machine: string, id: string) => (await boardOn(host, outline, machine).records([id])).records[0]!;
  const make = async (outline: string, key: string, text: string) => { ids[key] = (await boardOn(here, outline, HERE).request<{ id: string }>("create", { parentId: null, text, author: "user" })).id; };
  const pull = (extra: Record<string, string> = {}) => pullNetmail({
    hub: "hub-box", machine: FAR, state: join(dir, "far-state"), env: { ...env, ...extra },
    open: async outline => boardOn(far, outline, FAR),
  });

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signing = pair.privateKey as CryptoKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] });

    await here.start(); await far.start();
    for (const [h, name] of [[here, "garden-notes"], [here, "pond-notes"], [here, "quiet-notes"], [far, "attic-notes"]] as const) await h.create(name);
    const garden = boardOn(here, "garden-notes", HERE), pond = boardOn(here, "pond-notes", HERE), quiet = boardOn(here, "quiet-notes", HERE), attic = boardOn(far, "attic-notes", FAR);
    await garden.configureMcpAccess("full"); await pond.configureMcpAccess("propose"); await quiet.configureMcpAccess("read"); await attic.configureMcpAccess("full");
    for (const b of [garden, pond, attic]) await b.request("work-ids.configure", { prefix: "GDN" });
    const make = async (b: SocketBoard, key: string, text: string) => { ids[key] = (await b.request<{ id: string }>("create", { parentId: null, text, author: "user" })).id; };
    await make(garden, "seeds", "Seed swap list [season::spring]\nRunner beans for the allotment next door.");
    await make(pond, "frogs", "Frog count [page::Frog Count]\nTwelve at dusk by the reeds.");
    await make(quiet, "still", "Still water\nNothing stirs.");
    await make(attic, "trunk", "Trunk contents [room::attic]\nOld maps of the canal.");
    await make(attic, "lamps", "Lamp list\nTwo oil lamps, one cracked.");
    await make(attic, "map", "Map drawer\nCharts of the canal.");
    await make(attic, "keys", "Key hook\nThree brass keys.");
    for (const op of ["apply", "dismiss"]) {
      const note = await attic.request<any>("create", { parentId: null, text: "Seed plan\nPlant beans." });
      const proposal = await attic.request<any>("draft.patch", { blockId: note.id, revision: note.revision,
        patches: [{ observed: "Plant beans.", replacement: "Plant peas." }], propose: true,
        mutation: { author: "agent", actorId: "mcp:chat.example.test" } });
      ids[`settle-${op}`] = proposal.proposalId;
    }

    dir = scratchDir("ep0ch-mcpw-");
    mirrors = join(dir, "mirrors");
    mkdirSync(join(mirrors, FAR), { recursive: true });
    follow("attic-notes");
    // The fake ssh: "the other machine" is the gateway's, whose `ep0ch` reads the queue beside these mirrors.
    mkdirSync(join(dir, "bin")); mkdirSync(join(dir, "hub-home")); mkdirSync(join(dir, "hub-outlines"));
    writeFileSync(join(dir, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
    writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nEP0CH_MCP_MIRROR_DIR=${mirrors} exec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    chmodSync(join(dir, "bin", "ssh"), 0o755); chmodSync(join(dir, "bin", "ep0ch"), 0o755);
    Object.assign(env, {
      PATH: process.env.PATH!, HOME: join(dir, "far-home"), EP0CH_SSH: join(dir, "bin", "ssh"),
      FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE!, FAKE_SSH_HOME: join(dir, "hub-home"), FAKE_SSH_OUTLINES: join(dir, "hub-outlines"), FAKE_SSH_BIN: join(dir, "bin"), FAKE_SSH_LOG: join(dir, "ssh.log"),
    });

    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: `${PERSON},user_fictional_other` });
    if ("error" in config) throw new Error(config.error);
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, line => logs.push(line), Date.now, async () => null);
    const outlines = machineOutlines(undefined, line => logs.push(line), async name => ["garden-notes", "pond-notes", "quiet-notes"].includes(name) ? boardOn(here, name, HERE) : { error: "no such outline" },
      [mirror], async () => ["garden-notes", "pond-notes", "quiet-notes"], join(mirrors, ".netmail.sqlite"));
    closeOutlines = outlines.close;
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: line => logs.push(line) });
  }, 60_000);

  test("an MCP script at propose access leaves the note unchanged and offers its patch", async () => {
    const board = boardOn(here, "pond-notes", HERE);
    const target = await board.request<{ id: string; revision: number; text: string }>("create", { parentId: null, text: "Runner beans for the school garden.", author: "user" });
    const source = await board.request<{ id: string }>("create", { parentId: null, author: "user", text: [
      "Seed suggestion [script::seed-suggestion] [results::keep] [effects::write]", "```js",
      `return await tools.outline_patch({ ref: '${target!.id}', revision: ${target!.revision}, patches: [{ observed: 'Runner beans', replacement: 'Broad beans' }] });`,
      "```",
    ].join("\n") });
    const started = await tool("script_run", { outline: "pond-notes", ref: source.id });
    expect(started.isError).toBe(false);
    const end = Date.now() + 5000;
    let log;
    do { log = await board.get(started.json.written[0]); if (!log!.text.includes("· working")) break; await Bun.sleep(20); } while (Date.now() < end);
    expect(log!.text).toContain("· done");
    expect((await board.get(target!.id))!.text).toBe(target!.text);
    const proposal = (await board.children(target!.id)).find(n => prop(n, "type") === "draft-proposal");
    expect(proposal!.text).toContain("Broad beans");
    // The agent that asked wrote it, the script its how (PIE-1462).
    expect(String(proposal!.author)).toContain("chat.example.test");
  });

  test("an MCP script can comment, reply, edit its reply and resolve the thread", async () => {
    const board = boardOn(here, "garden-notes", HERE);
    const target = await board.request<{ id: string }>("create", { author: "user", text: "Seed exchange" });
    const source = await board.request<{ id: string }>("create", { author: "user", text: [
      "Seed conversation [script::seed-conversation] [results::keep] [effects::write]", "```js",
      `const c = await tools.outline_comment({ref:'${target.id}', whole:true, body:'Count the packets'});`,
      `const r = await tools.outline_reply({thread:c.thread, body:'Six packets'});`,
      `await tools.outline_reply({edit:r.reply, observed:'Six packets', body:'Seven packets'});`,
      `await tools.outline_resolve_thread({thread:c.thread, resolved:true});`,
      "```",
    ].join("\n") });
    const started = await tool("script_run", { outline: "garden-notes", ref: source.id });
    expect(started.isError).toBe(false);
    let log;
    const end = Date.now() + 5000;
    do { log = await board.get(started.json.written[0]); if (!log!.text.includes("· working")) break; await Bun.sleep(20); } while (Date.now() < end);
    expect(log!.text).toContain("· done");
    const threads = await board.comments(target.id);
    expect(threads[0]!.lifecycle).toBe("resolved");
    expect(threads[0]!.replies[0]!.body).toBe("Seven packets");
  });

  test("script_run takes this and slots, as a press in that note gives them (PIE-1272)", async () => {
    const board = boardOn(here, "garden-notes", HERE);
    const cave = await board.request<{ id: string }>("create", { author: "user", text: "The Undercroft" });
    const source = await board.request<{ id: string }>("create", { author: "user", text: [
      "Lamp [script::lamp]", "```js", "return `${this.title}: ${props.card[0]} ${props.choice[0]}`;", "```",
    ].join("\n") });
    const pressed = await tool("script_run", { outline: "garden-notes", ref: source.id, this: cave.id, slots: { card: "lamplighter", choice: "2" } });
    expect(pressed.isError).toBe(false);
    expect(pressed.json.message).toBe("The Undercroft: lamplighter 2");
    const bad = await tool("script_run", { outline: "garden-notes", ref: source.id, slots: { card: "two\nlines" } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("one line of text");
  });

  test("outline_proposals tells the caller what became of its proposals, each once, with links (PIE-1086)", async () => {
    await make("garden-notes", "heard", "Bean rota\nWater on Mondays.");
    const uri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.heard! });
    const read = (await tool("outline_read", { uri })).json;
    const before = (await tool("outline_proposals", { outline: "garden-notes" })).json;
    const proposed = await tool("outline_patch", { uri, revision: read.revision, propose: true, patches: [{ observed: "Water on Mondays.", replacement: "Water on Tuesdays." }] });
    expect(proposed.json.outcome).toBe("proposed");
    const board = boardOn(here, "garden-notes", HERE);
    const proposal = (await board.children(ids.heard!)).find(n => prop(n, "type") === "draft-proposal")!;
    await Bun.sleep(5);
    await board.request("draft.proposal.dismiss", { proposalId: proposal.id, mutation: { author: "user" } });
    const heard = (await tool("outline_proposals", { outline: "garden-notes", since: before.cursor })).json;
    expect(heard.outcomes.map((o: { state: string }) => o.state)).toEqual(["proposed", "dismissed"]);
    expect(heard.outcomes[0]).toMatchObject({ proposal: proposal.id, note: ids.heard, title: "Bean rota", noteUri: uri });
    expect((await tool("outline_proposals", { outline: "garden-notes", since: heard.cursor })).json.outcomes).toEqual([]);
  });

  test("outline_read with view: true answers the note as the door draws it", async () => {
    await make("garden-notes", "drawn", "Seed tin\n- borlotti\n- chard");
    const read = await tool("outline_read", { outline: "garden-notes", ref: ids.drawn!, view: true, width: 40 });
    expect(read.isError).toBe(false);
    expect(read.json.view.join("\n")).toContain("borlotti");
    expect(read.json.view.every((l: string) => !l.includes("\x1b"))).toBe(true);
    expect((await tool("outline_read", { outline: "garden-notes", ref: ids.drawn!, view: true, width: 5 })).isError).toBe(true);
  });

  afterAll(async () => {
    gateway?.stop(); closeOutlines?.();
    for (const b of boards) b.close();
    await Bun.sleep(200);
    await here.dispose(); await far.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  test("list_outlines says what a write to each outline becomes", async () => {
    const listed = (await tool("list_outlines", {})).json.outlines as Record<string, unknown>[];
    expect(listed.map(o => [o.outline, o.access, o.writes ?? null])).toEqual([
      ["garden-notes", "full", "applied"], ["pond-notes", "propose", "proposals"], ["quiet-notes", "read", null], ["attic-notes", "full", "queued"],
    ]);
    expect(listed.at(-1)).toMatchObject({ source: "mirror", queue: { waiting: 0, lastPull: null } });
  });

  test("a read-access MCP snapshot downloads once as a queryable SQLite copy", async () => {
    const { Publisher } = await import(`${outliner}/src/publish.ts`);
    const { OutlinerClient } = await import(`${outliner}/src/client.ts`);
    const { OutlinePublishers } = await import(`${outliner}/src/publish-outlines.ts`);
    const { SignInGate } = await import(`${outliner}/src/web-signin.ts`);
    const client = new OutlinerClient(here.sock, 30_000, "quiet-notes");
    let gate: InstanceType<typeof SignInGate>;
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => gate.handle(request) });
    const origin = `http://127.0.0.1:${http.port}`;
    const publisher = new Publisher({ client, basePath: "/pub", publicUrl: origin });
    const web = new OutlinePublishers({ home: publisher, homeName: "quiet-notes", names: async () => ["quiet-notes"], open: () => { throw new Error("home publisher is already open"); } });
    gate = new SignInGate({ settings: { origin, issuer: ISSUER, clientId: "fictional-web", allowedSubjects: [], home: "/pub/" }, request: (input: Record<string, unknown> & { action: string }) => client.request(input), serve: (request: Request) => publisher.handle(request), snapshot: (request: Request) => web.snapshot(request) });
    await publisher.start();
    const previousWebUrl = process.env.EP0CH_WEB_URL;
    try {
      process.env.EP0CH_WEB_URL = origin;
      const result = await tool("outline_snapshot", { outline: "quiet-notes" });
      expect(result.isError, result.text).toBe(false);
      const snapshot = result.json;
      expect(snapshot.url).toStartWith(origin + "/pub/o/quiet-notes/s/");
      expect(Date.parse(snapshot.expiresAt) - Date.parse(snapshot.asOf)).toBeGreaterThan(14 * 60_000);
      expect(snapshot.curl).toContain("curl --fail");
      expect(snapshot.said).toContain("fenced code block");
      // Pasting the command beside the source must never overwrite a live outline database.
      expect(snapshot.curl).toEndWith("--output 'quiet-notes.snapshot.sqlite'");
      const target = join(dir, "snapshot.sqlite");
      const curl = Bun.spawn(["curl", "--fail", "--silent", "--show-error", snapshot.url, "--output", target], { stdout: "pipe", stderr: "pipe" });
      expect(await curl.exited, await new Response(curl.stderr).text()).toBe(0);
      const bytes = readFileSync(target);
      expect(bytes.length).toBe(snapshot.bytes);
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(snapshot.sha256);
      const query = Bun.spawn(["sqlite3", target, "select text from blocks where text like 'Still water%';"], { stdout: "pipe", stderr: "pipe" });
      expect(await new Response(query.stdout).text()).toContain("Nothing stirs.");
      expect(await query.exited).toBe(0);
      const second = Bun.spawn(["curl", "--fail", "--silent", snapshot.url], { stdout: "ignore", stderr: "pipe" });
      expect(await second.exited).toBe(22);
      const notes = await boardOn(here, "quiet-notes", HERE).request<any>("blocks.query", { query: { where: "type=snapshot machine=snapshot", limit: 100 } });
      expect(notes.blocks.some((b: any) => b.text.includes("fetched") && b.text.includes("mcp:chat.example.test"))).toBe(true);
    } finally {
      if (previousWebUrl === undefined) delete process.env.EP0CH_WEB_URL; else process.env.EP0CH_WEB_URL = previousWebUrl;
      http.stop(true); await publisher.stop();
    }
  });

  test("share tools: a short-lived link started by the tool call alone, listed and ended; a read-only outline is refused", async () => {
    // No ref: the whole outline. A ref (a bare page name too) is only where the link opens; only narrows.
    const started = await tool("share_start", { outline: "pond-notes", ttl: "2m", ref: "Frog Count" });
    expect(started.isError, started.text).toBe(false);
    expect(started.json.share).toMatchObject({ scope: { kind: "outline" }, opens: { blockId: ids.frogs, title: "Frog count" }, state: "active", comments: true, by: "mcp:chat.example.test" });
    const only = await tool("share_start", { outline: "pond-notes", only: ids.frogs });
    expect(only.json.share).toMatchObject({ scope: { kind: "note", blockId: ids.frogs } });
    expect(only.json.share.opens).toBeUndefined();
    await tool("share_revoke", { id: only.json.share.id, outline: "pond-notes" });
    // No publisher has said its public address here: no link yet, and what to run.
    expect(started.json.said).toContain("--public-url");
    expect(((await tool("share_list", { outline: "pond-notes" })).json.shares as { id: string }[]).map(s => s.id)).toEqual([started.json.share.id]);
    expect((await tool("share_start", { outline: "quiet-notes" })).isError).toBe(true);
    expect((await tool("reader_view", { outline: "pond-notes" })).json.view).toBeNull();
    expect((await tool("share_revoke", { all: true, outline: "pond-notes" })).json.revoked).toEqual([started.json.share.id]);
    expect((await tool("share_list", { outline: "pond-notes" })).json.shares).toEqual([]);
  });

  test("a named path writes as that persona, and at propose whatever the outline allows; /mcp writes as before (PIE-804)", async () => {
    const origin = new URL(gateway.url).origin;
    // Discovery per path: each its own resource, and its 401 names its own metadata.
    const meta = await (await fetch(`${origin}/.well-known/oauth-protected-resource/gpty/mcp`, { headers: { Host: HOST } })).json() as { resource: string; authorization_servers: string[] };
    expect(meta).toMatchObject({ resource: "https://mcp.example.test/gpty/mcp", authorization_servers: [ISSUER] });
    const bare = await fetch(`${origin}/gpty/mcp`, { method: "POST", headers: { Host: HOST, "Content-Type": "application/json" }, body: "{}" });
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toContain(`resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/gpty/mcp"`);
    // A token for /mcp isn't one for /gpty/mcp.
    const crossed = await fetch(`${origin}/gpty/mcp`, { method: "POST", headers: { Host: HOST, "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(crossed.status).toBe(401);
    for (const path of ["/not a name/mcp", "/%FF/mcp", "/%/mcp", "/.hidden/mcp", "/gpty/mcp/", "/a/b/mcp"]) expect((await fetch(`${origin}${path}`, { method: "POST", headers: { Host: HOST } })).status).toBe(404);
    expect((await fetch(`${origin}/.well-known/oauth-protected-resource/%FF/mcp`, { headers: { Host: HOST } })).status).toBe(404);

    // garden-notes takes full writes; through /gpty/mcp, a property is a proposal and a comment is gpty's.
    const uri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.seeds! });
    const listed = (await tool("list_outlines", {}, "gpty")).json.outlines.find((o: { outline: string }) => o.outline === "garden-notes");
    expect(listed).toMatchObject({ access: "propose", writes: "proposals" });
    const read = (await tool("outline_read", { uri }, "gpty")).json;
    const set = await tool("outline_set_property", { uri, key: "keeper", value: "gpty", revision: read.revision }, "gpty");
    expect(set.json.outcome).toBe("proposed");
    expect((await textOf(here, "garden-notes", HERE, ids.seeds!)).text).not.toContain("keeper::gpty");
    const said = await tool("outline_comment", { uri, whole: true, body: "A date for the swap, from gpty?" }, "gpty");
    const thread = (await tool("outline_threads", { uri })).json.threads.find((t: { thread: string }) => t.thread === said.json.detail.thread);
    expect(thread.comments[0]).toMatchObject({ author: "mcp:gpty/chat.example.test", by: "gpty (chat.example.test)" });
    // Its kind lands on the thread (PIE-871), said as kind or in properties.
    const noted = await tool("outline_comment", { uri, whole: true, body: "Shipped: the swap date is set.", kind: "patch-note" }, "gpty");
    expect((await tool("outline_threads", { uri })).json.threads.find((t: { thread: string }) => t.thread === noted.json.detail.thread).properties).toMatchObject({ kind: ["patch-note"] });
    // A comment with no target (PIE-933) is never silently missing: the note's threads and the inbox say why. Written as
    // plain text, a comment gets its target in the same write; one whose properties don't read stays as written.
    const plain = (await boardOn(here, "garden-notes", HERE).request<{ id: string }>("create", { parentId: ids.seeds, author: "agent", text: "Comment on “paper labels”\n[type::annotation] [annotation-source::agent] [annotation-status::open]\nPlain text, same thread." })).id;
    const odd = (await boardOn(here, "garden-notes", HERE).request<{ id: string }>("create", { parentId: ids.seeds, author: "agent", text: "Comment on “labels”\n[type::annotation] [annotation-status::archived]\nA status nobody knows." })).id;
    const withStray = (await tool("outline_threads", { uri })).json;
    expect(withStray.threads.map((t: { thread: string }) => t.thread)).toContain(plain);
    expect(withStray.untargeted).toEqual([{ id: odd, why: expect.stringContaining("archived") }]);
    const inbox = (await tool("outline_threads", { outline: "garden-notes" })).json;
    expect(inbox.notes.find((n: { id: string }) => n.id === ids.seeds).untargeted.map((u: { id: string }) => u.id)).toEqual([odd]);
    // A path's cap can be set: EP0CH_MCP_PATH_ACCESS, read at each request.
    process.env.EP0CH_MCP_PATH_ACCESS = "warp=read";
    try { expect((await tool("list_outlines", {}, "warp")).json.outlines.find((o: { outline: string }) => o.outline === "garden-notes")).toMatchObject({ access: "read" }); }
    finally { delete process.env.EP0CH_MCP_PATH_ACCESS; }
    // Per outline: the most specific entry wins, and the outline's own level still bounds it.
    process.env.EP0CH_MCP_PATH_ACCESS = `gpty@garden-notes=full,gpty@attic-notes@${FAR}=read,gpty=propose`;
    try {
      const rows = (await tool("list_outlines", {}, "gpty")).json.outlines as { outline: string; access: string; writes?: string }[];
      const at = (name: string) => rows.find(o => o.outline === name);
      expect(at("garden-notes")).toMatchObject({ access: "full", writes: "applied" });
      expect(at("pond-notes")).toMatchObject({ access: "propose", writes: "proposals" });
      expect(at("quiet-notes")).toMatchObject({ access: "read" });               // its own level: a cap never raises it
      expect(at("attic-notes")).toMatchObject({ access: "read" });               // a mirror, by outline@machine
      await make("garden-notes", "shed", "Shed key rota");
      const shed = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.shed! });
      const shedNow = (await tool("outline_read", { uri: shed }, "gpty")).json;
      expect((await tool("outline_set_property", { uri: shed, key: "keeper", value: "gpty", revision: shedNow.revision }, "gpty")).json.outcome).toBe("applied");
    } finally { delete process.env.EP0CH_MCP_PATH_ACCESS; }
    // A path open wide but shut for one outline: no write there, and no read either (reads check the cap too).
    process.env.EP0CH_MCP_PATH_ACCESS = "gpty=full,gpty@pond-notes=none";
    try {
      const frogs = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
      expect((await tool("outline_read", { uri: frogs }, "gpty")).isError).toBe(true);
      expect((await tool("outline_threads", { uri: frogs }, "gpty")).isError).toBe(true);
      expect((await tool("reader_view", { outline: "pond-notes" }, "gpty")).isError).toBe(true);
      expect((await tool("outline_comment", { uri: frogs, whole: true, body: "sneaking in" }, "gpty")).isError).toBe(true);
      expect((await tool("outline_read", { uri: frogs })).isError).toBe(false);               // /mcp as before
    } finally { delete process.env.EP0CH_MCP_PATH_ACCESS; }
    // /mcp: as before, the full outline's writes apply.
    expect((await tool("list_outlines", {})).json.outlines.find((o: { outline: string }) => o.outline === "garden-notes")).toMatchObject({ access: "full", writes: "applied" });
  });

  test("full: a patch, a property, a new block and a comment apply, attributed to the client and subject", async () => {
    const uri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.seeds! });
    const read = (await tool("outline_read", { uri })).json;
    const patched = await tool("outline_patch", { uri, revision: read.revision, patches: [{ observed: "Runner beans", replacement: "Scarlet runner beans" }] });
    expect(patched.json).toMatchObject({ outcome: "applied", uri, outline: "garden-notes", machine: HERE });
    const now = await textOf(here, "garden-notes", HERE, ids.seeds!);
    expect(now.text).toContain("Scarlet runner beans");
    expect(await editsBy(here, "garden-notes", ids.seeds!)).toContainEqual({ actorId: "mcp:chat.example.test", sessionId: expect.stringMatching(new RegExp(`^${PERSON}#c-[0-9a-f]{10}$`)) });
    const set = await tool("outline_set_property", { uri, key: "season", value: "summer", revision: now.revision });
    expect(set.json.outcome).toBe("applied");
    expect((await textOf(here, "garden-notes", HERE, ids.seeds!)).text.split("\n")[0]).toBe("Seed swap list [season::summer]");
    const made = await tool("outline_create", { ref: ids.seeds, outline: "garden-notes", text: "Bring paper labels" });
    expect(made.json.outcome).toBe("applied");
    const child = (await textOf(here, "garden-notes", HERE, made.json.uri.split("/b/")[1]));
    expect(child).toMatchObject({ parent: ids.seeds, author: "agent", actor: "mcp:chat.example.test" });
    const said = await tool("outline_comment", { uri, quote: "Scarlet runner beans", body: "Which variety exactly?" });
    expect(said.json).toMatchObject({ outcome: "applied", detail: { author: "agent", actorId: "mcp:chat.example.test" } });
    expect(logs.join("\n")).toMatch(new RegExp(`mcp write: mcp:chat\\.example\\.test \\(${PERSON}\\) client=\\S+ call=c-[0-9a-f]{10} \\(\\w+\\) outline_patch ${uri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: applied`));
  });

  test("tool arguments: ref and each alias are accepted; two aliases for different notes are refused with nothing written; a wrong argument gets the right call back", async () => {
    const seeds = ids.seeds!;
    const threadsOn = async () => ((await tool("outline_threads", { ref: seeds, outline: "garden-notes" })).json.threads as unknown[]).length;
    for (const alias of ["ref", "id", "reference", "block", "blockId", "note"]) {
      for (const name of ["outline_read", "outline_threads", "outline_links"]) {
        const r = await tool(name, { [alias]: seeds, outline: "garden-notes" });
        expect(r.isError, `${name} ${alias}: ${r.text}`).toBe(false);
      }
    }
    const before = await threadsOn();
    for (const alias of ["ref", "id", "reference", "block", "blockId", "note"]) {
      const c = await tool("outline_comment", { [alias]: seeds, outline: "garden-notes", whole: true, body: `via ${alias}` });
      expect(c.json?.outcome, `${alias}: ${c.text}`).toBe("applied");
    }
    expect(await threadsOn()).toBe(before + 6);
    // Different notes: refused whichever way they are named, and no thread is made.
    for (const args of [{ ref: seeds, id: ids.frogs }, { ref: seeds, uri: formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.frogs! }) }]) {
      const conflict = await tool("outline_comment", { ...args, outline: "garden-notes", whole: true, body: "which note?" });
      expect(conflict.isError).toBe(true);
      expect(conflict.text).toContain("Ambiguous");
      expect(conflict.text).toContain("pass one `ref`");
      expect(conflict.text).toContain("Example: outline_comment");
    }
    expect((await tool("outline_read", { ref: seeds, id: ids.frogs })).text).toContain("Ambiguous");
    expect(await threadsOn()).toBe(before + 6);
    // One note spelt two ways is the same note.
    const same = await tool("outline_comment", { ref: `((${seeds}))`, id: seeds, outline: "garden-notes", whole: true, body: "same note twice" });
    expect(same.json?.outcome).toBe("applied");
    expect(await threadsOn()).toBe(before + 7);
    // The error says the right thing.
    const typo = await tool("outline_read", { refe: seeds });
    expect(typo.isError).toBe(true);
    expect(typo.text).toContain("`refe` is not an argument of outline_read; did you mean `ref`?");
    expect(typo.text).toContain("Arguments: uri (string");
    expect(typo.text).toContain(`Call it as: outline_read {"ref":"${seeds}"}`);
    const typed = await tool("outline_patch", { ref: seeds, revision: "3", patches: [] });
    expect(typed.text).toContain("`revision` must be integer >= 1; got string \"3\"");
    expect(typed.text).toContain("Example: outline_patch {");
  });

  test("a Resource (PIE-650): outline_comment takes a [file::] ref and outline_read returns its text with the open threads; the file is never written; a read-only outline refuses", async () => {
    const file = join(dir, "pr-body.md");
    const source = "## Summary\n\nThe **cache** warms [on boot](https://example.test/boot).\n";
    writeFileSync(file, source);
    const linking = (await boardOn(here, "garden-notes", HERE).request<{ id: string }>("create", { parentId: null, text: `Reading [file::${file}] first.`, author: "user" })).id;
    const said = await tool("outline_comment", { ref: `[file::${file}]`, outline: "garden-notes", quote: "warms [on boot](https://example.test/boot)", body: "Why on boot?", from: linking });
    expect(said.text).toContain("applied");
    expect(said.json).toMatchObject({ outcome: "applied", detail: { author: "agent", actorId: "mcp:chat.example.test" } });
    const resourceId = said.json.detail.resourceId as string;
    expect(resourceId).toBeTruthy();
    // The thread is among the threads of the note whose link opened the Resource (its reference context), as a comment on that reference is.
    expect((await boardOn(here, "garden-notes", HERE).comments(linking)).map(c => c.id)).toContain(said.json.detail.thread);
    const read = (await tool("outline_read", { ref: `resource:${resourceId}`, outline: "garden-notes" })).json.resource;
    expect(read).toMatchObject({ kind: "resource", text: source });
    expect(read.threads).toHaveLength(1);
    expect(read.threads[0]).toMatchObject({ thread: said.json.detail.thread, quote: "warms [on boot](https://example.test/boot)", body: "Why on boot?", anchored: true, actorId: "mcp:chat.example.test" });
    // The note whose link opened it is the thread's reference context only when it links the Resource.
    const refused = await tool("outline_comment", { ref: `resource:${resourceId}`, outline: "garden-notes", quote: "cache", body: "x", from: ids.seeds });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("no link to this Resource");
    expect(readFileSync(file, "utf8")).toBe(source);
    expect((await tool("outline_comment", { ref: `[file::${file}]`, outline: "quiet-notes", quote: "cache", body: "x" })).isError).toBe(true);
  });

  test("full: a conflicting patch is an error with revisions; rereading and retrying applies (PIE-1125)", async () => {
    await make("garden-notes", "retry", "Garden retry\nPlant beans.");
    const uri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.retry! });
    const before = await textOf(here, "garden-notes", HERE, ids.retry!);
    await boardOn(here, "garden-notes", HERE).request("update", { blockId: ids.retry!, text: "Garden retry\nPlant peas.", expectedRevision: before.revision, mutation: { author: "user" } });
    const read = await textOf(here, "garden-notes", HERE, ids.retry!);
    const stale = await tool("outline_patch", { uri, revision: before.revision, patches: [{ observed: "Plant beans.", replacement: "Plant carrots." }] });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain(`revision ${before.revision}, now ${read.revision}`);
    expect(stale.text).toContain("read it again and send the patch");
    expect((await textOf(here, "garden-notes", HERE, ids.retry!)).text).toBe(read.text);
    const again = await tool("outline_patch", { uri, revision: read.revision, patches: [{ observed: read.text, replacement: read.text + "\nWater in the evening." }] });
    expect(again.isError).toBe(false);
    expect(again.json.outcome).toBe("applied");
    const suggestion = await tool("outline_patch", { uri, revision: again.json.detail.edits[0].revision, propose: true, patches: [{ observed: "Water in the evening.", replacement: "Water at dawn." }] });
    expect(suggestion.isError).toBe(false);
    expect(suggestion.json.outcome).toBe("proposed");
  });

  test("full: outline_assign_id stamps the next work id as the note's page address, attributed; again it is unchanged; stale is refused", async () => {
    await make("garden-notes", "draft", "Reply to the swap thread\nSee you at ten.");
    const uri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.draft! });
    const read = (await tool("outline_read", { uri })).json;
    const stale = await tool("outline_assign_id", { uri, revision: read.revision + 5 });
    expect(stale.isError).toBe(true);
    const done = await tool("outline_assign_id", { uri, revision: read.revision });
    expect(done.json).toMatchObject({ outcome: "applied", uri, detail: { workId: "GDN-001", page: "[[GDN-001]]" } });
    const now = await textOf(here, "garden-notes", HERE, ids.draft!);
    expect(now.text).toContain("[work-id::GDN-001]");
    expect(now.text).not.toContain("[page::");
    expect(await editsBy(here, "garden-notes", ids.draft!)).toContainEqual({ actorId: "mcp:chat.example.test", sessionId: expect.stringMatching(new RegExp(`^${PERSON}#c-[0-9a-f]{10}$`)) });
    const again = await tool("outline_assign_id", { ref: "[[GDN-001]]", outline: "garden-notes", revision: now.revision });
    expect(again.json).toMatchObject({ outcome: "unchanged", detail: { workId: "GDN-001" } });
    expect((await tool("outline_assign_id", { uri })).isError).toBe(true);
  });

  test("propose: outline_assign_id is refused, since a stamp is no proposal", async () => {
    const uri = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
    const refused = await tool("outline_assign_id", { uri, revision: (await textOf(here, "pond-notes", HERE, ids.frogs!)).revision });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("needs full access");
    expect((await textOf(here, "pond-notes", HERE, ids.frogs!)).text).not.toContain("work-id");
  });

  test("full: outline_move puts a note in a day and beside a sibling, outline_trash a duplicate away and outline_restore back, attributed; a place inside itself and a stale revision are refused", async () => {
    await make("garden-notes", "day", "Wednesday");
    await make("garden-notes", "plan", "Plant the leeks");
    await make("garden-notes", "dup", "Plant the leeks (copy)");
    const uri = (key: string) => formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids[key]! });
    const board = boardOn(here, "garden-notes", HERE);
    const parentOf = async (key: string) => (await board.request<{ parentId: string | null }>("get", { blockId: ids[key] })).parentId;

    const moved = await tool("outline_move", { uri: uri("plan"), revision: (await tool("outline_read", { uri: uri("plan") })).json.revision, parent: ids.day, position: 0 });
    expect(moved.json).toMatchObject({ outcome: "applied", uri: uri("plan"), by: "chat.example.test", detail: { parentId: ids.day, position: 0 } });
    expect(await parentOf("plan")).toBe(ids.day!);
    const beside = await tool("outline_move", { uri: uri("dup"), revision: (await tool("outline_read", { uri: uri("dup") })).json.revision, after: ids.plan });
    expect(beside.json).toMatchObject({ outcome: "applied", detail: { parentId: ids.day, position: 1 } });
    expect((await board.request<{ id: string }[]>("children", { parentId: ids.day })).map(b => b.id)).toEqual([ids.plan!, ids.dup!]);
    const inside = await tool("outline_move", { uri: uri("day"), revision: (await tool("outline_read", { uri: uri("day") })).json.revision, parent: ids.plan });
    expect(inside.isError).toBe(true);
    expect(inside.text).toContain("inside itself");
    expect((await tool("outline_move", { uri: uri("dup"), revision: (await tool("outline_read", { uri: uri("dup") })).json.revision, parent: ids.day, before: ids.plan })).text).toContain("exactly one of parent");
    expect((await tool("outline_move", { uri: uri("dup"), parent: "root", revision: 99 })).text).toContain("changed since you read it");

    const read = (await tool("outline_read", { uri: uri("dup") })).json;
    expect((await tool("outline_trash", { uri: uri("dup"), revision: read.revision + 4 })).isError).toBe(true);
    expect((await tool("outline_trash", { uri: uri("dup") })).isError).toBe(true);
    const trashed = await tool("outline_trash", { uri: uri("dup"), revision: read.revision });
    expect(trashed.json).toMatchObject({ outcome: "applied", uri: uri("dup"), by: "chat.example.test" });
    expect((await board.request<{ deletedAt?: string }>("get", { blockId: ids.dup })).deletedAt).toBeDefined();
    expect((await tool("outline_trash", { uri: uri("dup"), revision: read.revision })).json).toMatchObject({ outcome: "unchanged" });
    const restored = await tool("outline_restore", { uri: uri("dup") });
    expect(restored.json, restored.text).toMatchObject({ outcome: "applied", uri: uri("dup") });
    expect((await board.request<{ deletedAt?: string }>("get", { blockId: ids.dup })).deletedAt).toBeUndefined();
  });

  test("propose: outline_move and outline_trash are comments on the note naming the change; outline_restore is refused", async () => {
    await make("pond-notes", "reeds", "Reeds by the bank");
    await make("pond-notes", "shore", "Shore");
    const uri = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.reeds! });
    const board = boardOn(here, "pond-notes", HERE);
    const move = await tool("outline_move", { uri, revision: (await tool("outline_read", { uri })).json.revision, parent: ids.shore });
    expect(move.json).toMatchObject({ outcome: "proposed", uri });
    expect((await board.request<{ parentId: string | null }>("get", { blockId: ids.reeds })).parentId).toBeNull();
    const trash = await tool("outline_trash", { uri, revision: (await textOf(here, "pond-notes", HERE, ids.reeds!)).revision });
    expect(trash.json).toMatchObject({ outcome: "proposed" });
    expect((await board.request<{ deletedAt?: string }>("get", { blockId: ids.reeds })).deletedAt).toBeUndefined();
    const threads = (await tool("outline_threads", { uri })).json.threads as { comments: { body: string }[] }[];
    expect(threads.map(t => t.comments[0]!.body)).toEqual(expect.arrayContaining([expect.stringContaining("Proposed move of this note under"), expect.stringContaining("Proposed trashing of this note")]));
    const restore = await tool("outline_restore", { uri });
    expect(restore.isError).toBe(true);
    expect(restore.text).toContain("needs full access");
  });

  test("yolo (PIE-973): a propose-level outline takes an agent's patch applied while a door says so, and proposes again once it is off", async () => {
    const uri = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
    const door = new SocketBoard(here.sock, 30_000, "pond-notes");
    boards.push(door);
    door.subscribe(() => {});
    const patchTo = async (replacement: string) => {
      const now = await textOf(here, "pond-notes", HERE, ids.frogs!);
      return tool("outline_patch", { uri, revision: now.revision, patches: [{ observed: now.text.includes("Nine") ? "Nine" : "Twelve", replacement }] });
    };
    expect((await tool("outline_patch", { uri, revision: (await textOf(here, "pond-notes", HERE, ids.frogs!)).revision, patches: [{ observed: "Twelve", replacement: "Nine" }] })).json.outcome).toBe("proposed");
    await door.setAgentsYolo(true);
    try {
      expect((await patchTo("Nine")).json).toMatchObject({ outcome: "applied" });
      expect((await textOf(here, "pond-notes", HERE, ids.frogs!)).text).toContain("Nine at dusk");
      // Still the agent's, as before: the edit is attributed to the remote client.
      expect((await editsBy(here, "pond-notes", ids.frogs!)).length).toBeGreaterThan(0);
    } finally { await door.setAgentsYolo(false); }
    expect((await patchTo("Ten")).json.outcome).toBe("proposed");
    // The mod's and MCP's outline_proposal_dismiss: refused at propose, and for another agent's proposal; both lift while yolo is on.
    const pond = boardOn(here, "pond-notes", HERE);
    const note = await pond.request<any>("create", { parentId: null, text: "Reeds\nTall and green.", author: "user" });
    const theirs = await pond.request<any>("draft.patch", { blockId: note.id, revision: note.revision, patches: [{ observed: "Tall", replacement: "Short" }], propose: true, mutation: { author: "agent", actorId: "other-agent" } });
    const dismissUri = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: theirs.proposalId });
    const refusedDismiss = await tool("outline_proposal_dismiss", { uri: dismissUri });
    expect(refusedDismiss.isError).toBe(true);
    expect(refusedDismiss.text).toContain("needs full access");
    await door.setAgentsYolo(true);
    try { expect((await tool("outline_proposal_dismiss", { uri: dismissUri })).json.outcome).toBe("applied"); }
    finally { await door.setAgentsYolo(false); }
    await boardOn(here, "pond-notes", HERE).request("update", { blockId: ids.frogs!, text: "Frog count [page::Frog Count]\nTwelve at dusk by the reeds.", expectedRevision: (await textOf(here, "pond-notes", HERE, ids.frogs!)).revision, mutation: { author: "user" } });
  });

  test("propose: a patch and a property are proposals; a new block is a comment on its parent; read takes no writes", async () => {
    const uri = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
    const before = await textOf(here, "pond-notes", HERE, ids.frogs!);
    const p = await tool("outline_patch", { uri, revision: before.revision, patches: [{ observed: "Twelve", replacement: "Fourteen" }] });
    expect(p.json).toMatchObject({ outcome: "proposed", detail: { outcome: "proposed", reason: expect.stringContaining("propose") } });
    const s = await tool("outline_set_property", { uri, key: "species", value: "common-frog", revision: before.revision });
    expect(s.json.outcome).toBe("proposed");
    const c = await tool("outline_create", { uri, text: "Newt sighted", requestId: "newt-sighting" });
    expect(c.json).toMatchObject({ outcome: "proposed", said: expect.stringContaining("comment") });
    const retry = await tool("outline_create", { uri, text: "Newt sighted", requestId: "newt-sighting" });
    expect(retry.json.detail.thread).toBe(c.json.detail.thread);
    expect(retry.json.detail.deduplicated).toBe(true);
    const changed = await tool("outline_create", { uri, text: "Toad sighted", requestId: "newt-sighting" });
    expect(changed.isError).toBe(true);
    expect(changed.text).toContain("different input");
    const after = await textOf(here, "pond-notes", HERE, ids.frogs!);
    expect(after.text).toContain("Twelve at dusk");
    expect(after.text).not.toContain("species::");
    const refused = await tool("outline_comment", { ref: ids.still, outline: "quiet-notes", whole: true, body: "Ripples?" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("MCP access is read for quiet-notes");
    expect(refused.text).toContain("ep0ch mcp access propose --ws quiet-notes");
  });

  test("a far box's outline: writes queue, never touching the mirror; the far box offline keeps them; online it applies them, and a changed note becomes a proposal", async () => {
    const trunk = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.trunk! });
    const lamps = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.lamps! });
    const trunkRead = (await tool("outline_read", { uri: trunk })).json;
    const lampsRead = (await tool("outline_read", { uri: lamps })).json;
    expect(trunkRead.reachability.source).toBe("mirror");

    const q1 = await tool("outline_patch", { uri: trunk, revision: trunkRead.revision, patches: [{ observed: "Old maps", replacement: "Old survey maps" }] });
    expect(q1.json.said).toContain("min old");
    expect(q1.json).toMatchObject({ outcome: "queued", queuedFor: `attic-notes@${FAR}`, lastPull: null, said: expect.stringContaining(`queued for attic-notes@${FAR} (${FAR} hasn't pulled yet)`) });
    expect(q1.json.base.source).toBe("mirror");
    expect(typeof q1.json.base.ageMinutes).toBe("number");
    const q2 = await tool("outline_comment", { uri: trunk, quote: "canal", body: "Which canal?" });
    const q3 = await tool("outline_create", { uri: trunk, text: "A brass compass" });
    const q4 = await tool("outline_patch", { uri: lamps, revision: lampsRead.revision, patches: [{ observed: "one cracked", replacement: "both mended" }] });
    expect([q2, q3, q4].map(q => q.json.outcome)).toEqual(["queued", "queued", "queued"]);
    // The mirror is never written: it still serves the note as it was. Nor, yet, is the far box's outline.
    expect((await tool("outline_read", { uri: trunk })).json.record.body).toContain("Old maps of the canal");
    expect((await textOf(far, "attic-notes", FAR, ids.trunk!)).text).toContain("Old maps of the canal");
    const listed = (await tool("list_outlines", {})).json.outlines as { outline: string; queue?: { waiting: number } }[];
    expect(listed.find(o => o.outline === "attic-notes")!.queue!.waiting).toBe(4);

    // Meanwhile on the far box, someone edits the lamp list: that queued patch now conflicts.
    const lampsNow = await textOf(far, "attic-notes", FAR, ids.lamps!);
    await boardOn(far, "attic-notes", FAR).request("update", { blockId: ids.lamps, text: "Lamp list\nTwo oil lamps, one cracked, one new.", expectedRevision: lampsNow.revision, mutation: { author: "user" } });

    // Offline: the pull fails, and everything waits.
    const offline = await pull({ FAKE_SSH_DOWN: "1" });
    expect(offline).toMatchObject({ ok: false, detail: "hub-box doesn't answer over ssh", taken: 0 });
    expect((await tool("list_outlines", {})).json.outlines.find((o: { outline: string }) => o.outline === "attic-notes").queue.waiting).toBe(4);

    // Online: each lands, attributed to the client that wrote it.
    const online = await pull();
    expect(online.ok).toBe(true);
    expect(online.settled.map(s => s.state)).toEqual(["applied", "applied", "applied", "proposed"]);
    const trunkNow = await textOf(far, "attic-notes", FAR, ids.trunk!);
    expect(trunkNow.text).toContain("Old survey maps of the canal");
    expect(await editsBy(far, "attic-notes", ids.trunk!)).toContainEqual({ actorId: "mcp:chat.example.test", sessionId: expect.stringMatching(new RegExp(`^${PERSON}#c-[0-9a-f]{10}$`)) });
    const lampsAfter = await textOf(far, "attic-notes", FAR, ids.lamps!);
    expect(lampsAfter.text).toContain("one cracked, one new");
    expect(lampsAfter.text).not.toContain("both mended");
    expect(online.settled[3]!.said).toContain("proposed, not applied");

    // The hub heard: nothing waits, the pull is recorded, and a second pull applies nothing twice.
    const store = new Netmail(join(mirrors, ".netmail.sqlite"));
    try {
      expect(store.summaries()).toEqual([{ machine: FAR, waiting: 0, oldest: null, lastPull: expect.any(String), byOutline: {} }]);
      expect(store.settled().map(s => s.state).sort()).toEqual(["applied", "applied", "applied", "proposed"]);
    } finally { store.close(); }
    expect(await pull()).toMatchObject({ ok: true, taken: 0 });
    const children = await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: ids.trunk });
    expect(children.filter(c => c.text.includes("brass compass"))).toHaveLength(1);
  }, 60_000);

  test("comment threads: a claude.ai comment, a mod's reply, the gateway reads it, replies and resolves; propose allows both, read neither", async () => {
    const seeds = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.seeds! });
    const garden = boardOn(here, "garden-notes", HERE);
    const thread = async (uri: string) => (await tool("outline_threads", { uri })).json;
    // claude.ai comments on a passage; cowboy (Claude Code, with the mod) replies through the service as itself.
    const c = await tool("outline_comment", { uri: seeds, quote: "Seed swap list", body: "Should this say which variety?" });
    if (!c.json) throw new Error(c.text);
    const id = c.json.detail.thread as string;
    await garden.reply(`mod-reply-${id}`, id, "Scarlet runner; I'll add it.", { kind: "agent", id: "claude-code:cowboy" });
    // The gateway reads the thread whole, with who said what.
    const read = (await thread(seeds)).threads.find((t: { thread: string }) => t.thread === id);
    expect(read).toMatchObject({ status: "open", quote: "Seed swap list", anchored: true });
    expect(read.comments.map((x: { author: string; body: string }) => [x.author, x.body])).toEqual([["mcp:chat.example.test", "Should this say which variety?"], ["claude-code:cowboy", "Scarlet runner; I'll add it."]]);
    expect(read.comments[1].at).toMatch(/^\d{4}-\d\d-\d\dT/);
    // outline_read carries a compact summary, so an agent notices the reply.
    const summary = (await tool("outline_read", { uri: seeds })).json.threads;
    expect(summary.open).toBeGreaterThanOrEqual(1);
    expect(summary.latest.find((t: { thread: string }) => t.thread === id)).toMatchObject({ comments: 2, last: { by: "claude-code:cowboy", body: "Scarlet runner; I'll add it." } });
    // Reply, then resolve, as the remote client.
    const r = await tool("outline_reply", { uri: seeds, thread: id, body: "Thanks, that settles it." });
    expect(r.json).toMatchObject({ outcome: "applied", said: expect.stringContaining(`replied in thread ${id}`) });
    expect((await thread(seeds)).threads.find((t: { thread: string }) => t.thread === id).comments.at(-1)).toMatchObject({ author: "mcp:chat.example.test", body: "Thanks, that settles it." });
    expect((await tool("outline_resolve_thread", { uri: seeds, thread: id, resolved: true })).json.outcome).toBe("applied");
    expect((await tool("outline_threads", { uri: seeds, status: "open" })).json.threads.some((t: { thread: string }) => t.thread === id)).toBe(false);
    expect((await tool("outline_threads", { uri: seeds, status: "resolved" })).json.threads.some((t: { thread: string }) => t.thread === id)).toBe(true);
    expect((await tool("outline_resolve_thread", { uri: seeds, thread: id, resolved: false })).json.said).toContain("now open");
    // Quote the thread into a block of its own (full access): it lands in the Inbox as the remote client, linked back.
    const q = await tool("outline_quote", { uri: seeds, marks: [id] });
    expect(q.json).toMatchObject({ outcome: "applied", said: expect.stringContaining("in the Inbox") });
    expect(q.json.detail.block.text).toContain(`[from::((${id}))]\n!((${id}))`);
    expect((await garden.comments(ids.seeds!)).find(t => t.id === id)!.quotedIn).toEqual([q.json.detail.block.id]);
    expect((await tool("outline_quote", { uri: seeds, marks: ["no-such-mark"] })).text).toContain("No mark no-such-mark");
    // A part of a note by its anchor (PIE-1247): detached into a block of its own, then embedded into another note.
    const plan = await garden.request<{ id: string }>("create", { parentId: null, text: "Bed plan\nFour beds.\n\n::graph-stat ^beds\n- beds: 4\n::", author: "user" });
    const planUri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: plan.id });
    const det = await tool("outline_quote", { uri: planUri, elements: ["^beds"], where: "detached" });
    expect(det.json.detail.block.text).toBe(`graph-stat [header::none]\n[from::((${plan.id}^beds))]\n!((${plan.id}^beds))`);
    const into = await tool("outline_quote", { uri: planUri, elements: ["beds"], into: ids.seeds!, at: 1 });
    expect(into.json).toMatchObject({ outcome: "applied" });
    // After the block at line 1, a blank line before it (PIE-1357).
    expect((await garden.get(ids.seeds!))!.text).toContain(`\n\n!((${plan.id}^beds))`);
    // A thread that isn't on the note is refused; a bad shape is too.
    expect((await tool("outline_reply", { uri: seeds, thread: "no-such-thread", body: "hello" })).text).toContain("No thread no-such-thread");
    expect((await tool("outline_resolve_thread", { uri: seeds, thread: id })).isError).toBe(true);
    // Propose access takes replies and resolves: they change only the thread. Read access takes neither.
    const frogs = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
    const pc = await tool("outline_comment", { uri: frogs, whole: true, body: "Count again at dawn?" });
    expect((await tool("outline_reply", { uri: frogs, thread: pc.json.detail.thread, body: "Yes." })).json.outcome).toBe("applied");
    expect((await tool("outline_resolve_thread", { uri: frogs, thread: pc.json.detail.thread, resolved: true })).json.outcome).toBe("applied");
    expect((await tool("outline_quote", { uri: frogs, marks: [pc.json.detail.thread] })).json).toMatchObject({ outcome: "proposed" });
    const still = formatEp0chBlockUri({ outline: "quiet-notes", machine: HERE, blockId: ids.still! });
    expect((await tool("outline_reply", { uri: still, thread: id, body: "x" })).text).toContain("takes no writes");
    expect((await tool("outline_threads", { uri: still })).isError).toBe(false);
  });

  test("the inbox: open threads across the outline, by who spoke last, mention and time; a persona names the connection; id is ref's alias", async () => {
    const seeds = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.seeds! });
    const garden = boardOn(here, "garden-notes", HERE);
    const before = Date.now();
    // The connection's owner names it: this client writes as daddy.
    process.env.EP0CH_MCP_PERSONAS = "chat.example.test=daddy";
    let id = "";
    try {
      const c = await tool("outline_comment", { id: ids.seeds, outline: "garden-notes", whole: true, body: "@evan can the swap list name a date?" });
      expect(c.json.base).toMatchObject({ source: "live", ageMinutes: 0 });
      id = c.json.detail.thread;
    } finally { delete process.env.EP0CH_MCP_PERSONAS; }
    const mine = (await tool("outline_threads", { uri: seeds })).json.threads.find((t: { thread: string }) => t.thread === id);
    expect(mine.comments[0].author).toBe("mcp:daddy/chat.example.test");
    expect(mine.comments[0].by).toBe("daddy (chat.example.test)");
    // The inbox, without a note.
    const inbox = async (args: Record<string, unknown>) => (await tool("outline_threads", { outline: "garden-notes", ...args })).json;
    const all = await inbox({});
    expect(all.notes.some((n: { id: string; threads: { thread: string }[] }) => n.id === ids.seeds && n.threads.some(t => t.thread === id))).toBe(true);
    expect(all.completeness.kind).toBe("complete");
    const has = (r: any) => r.notes.flatMap((n: { threads: { thread: string }[] }) => n.threads.map(t => t.thread)).includes(id);
    expect(has(await inbox({ lastFrom: "daddy" }))).toBe(true);
    expect(has(await inbox({ lastFrom: "mcp:daddy" }))).toBe(true);
    expect(has(await inbox({ lastFrom: "evan" }))).toBe(false);
    expect(has(await inbox({ mentions: "evan" }))).toBe(true);
    expect(has(await inbox({ mentions: "@nobody" }))).toBe(false);
    expect(has(await inbox({ since: new Date(before - 1000).toISOString() }))).toBe(true);
    expect(has(await inbox({ since: new Date(Date.now() + 60_000).toISOString() }))).toBe(false);
    // A reply from the person moves the thread to them; resolving takes it out of the open inbox.
    await garden.reply("inbox-reply", id, "Saturday the 14th.", { kind: "agent", id: "evan" });
    expect(has(await inbox({ lastFrom: "evan" }))).toBe(true);
    expect(has(await inbox({ lastFrom: "daddy" }))).toBe(false);
    await tool("outline_resolve_thread", { uri: seeds, thread: id, resolved: true });
    expect(has(await inbox({}))).toBe(false);
    expect(has(await inbox({ status: "resolved" }))).toBe(true);
    expect((await tool("outline_threads", { outline: "garden-notes", status: "nope" })).isError).toBe(true);
    expect((await tool("outline_threads", { outline: "garden-notes", since: "yesterday-ish" })).isError).toBe(true);
    // The tool list says id is an address, and list_outlines names the refresh some clients need.
    expect((await tool("list_outlines", {})).json.tools.said).toContain("RefreshMcpTools");
  });

  test("a far box's threads queue: a reply and a resolve land when it pulls; a thread gone by then becomes a whole-note comment saying so", async () => {
    const trunk = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.trunk! });
    const attic = boardOn(far, "attic-notes", FAR);
    // The far box's person comments there; the mirror catches up; the gateway reads it.
    const now = await textOf(far, "attic-notes", FAR, ids.trunk!);
    const made = await attic.comment("thread-seed", ids.trunk!, now.revision, "Is the canal map dated?", { quote: "canal", start: now.text.indexOf("canal") });
    follow("attic-notes");
    await Bun.sleep(100);
    const seen = (await tool("outline_threads", { uri: trunk })).json;
    // (the mirror refreshes on a timer, so the snapshot may not show the thread yet; the queue below doesn't need it)
    const queued = [
      await tool("outline_reply", { uri: trunk, thread: made.id, body: "Dated 1890, on the back." }),
      await tool("outline_resolve_thread", { uri: trunk, thread: made.id, resolved: true }),
      await tool("outline_reply", { uri: trunk, thread: "thread-that-never-was", body: "Anyone there?" }),
    ];
    expect(queued.map(q => q.json.outcome)).toEqual(["queued", "queued", "queued"]);
    // Replies and resolves follow the receipts path: a queueId, outline_write_status, and the caller's `pending` on a read.
    expect(queued.every(q => typeof q.json.queueId === "string")).toBe(true);
    expect((await tool("outline_write_status", { queueId: queued[0]!.json.queueId })).json.state).toBe("queued");
    const pend = (await tool("outline_read", { uri: trunk })).json.pending;
    expect(pend.replies.map((r: { body: string }) => r.body)).toEqual(["Dated 1890, on the back.", "Anyone there?"]);
    expect(pend.resolves).toHaveLength(1);
    expect(seen).toMatchObject({ uri: trunk, reachability: { source: "mirror" }, threads: expect.any(Array) });
    const done = await pull();
    expect(done.ok).toBe(true);
    expect(done.settled.map(s => s.state)).toEqual(["applied", "applied", "applied"]);
    const after = (await attic.comments(ids.trunk!));
    const ours = after.find(t => t.id === made.id)!;
    expect(ours.open).toBe(false);
    expect(ours.replies.map(r => [r.author, r.body])).toEqual([["mcp:chat.example.test", "Dated 1890, on the back."]]);
    const gone = after.find(t => t.body.includes("thread that is gone"))!;
    expect(gone.body).toContain("thread-that-never-was");
    expect(gone.body).toContain("Anyone there?");
    expect(await pull()).toMatchObject({ ok: true, taken: 0 });
  }, 60_000);

  test("a pull cut off before the hub heard re-tells it from the ledger, applying nothing twice", async () => {
    const lamps = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.lamps! });
    expect((await tool("outline_create", { uri: lamps, text: "A spare wick" })).json.outcome).toBe("queued");
    // The settle step's ssh fails: everything else answers. A wrapper that fails only `settle`.
    writeFileSync(join(dir, "bin", "ssh-flaky"), `#!/bin/sh\ncase "$*" in *settle*) exit 255;; esac\nexec ${join(dir, "bin", "ssh")} "$@"\n`);
    chmodSync(join(dir, "bin", "ssh-flaky"), 0o755);
    const cut = await pull({ EP0CH_SSH: join(dir, "bin", "ssh-flaky") });
    expect(cut).toMatchObject({ ok: false, detail: expect.stringContaining("the next pull tells it again") });
    expect(existsSync(join(dir, "far-state", "netmail-applied.json"))).toBe(true);
    const again = await pull();
    expect(again.ok).toBe(true);
    expect(again.settled.map(s => s.state)).toEqual(["applied"]);
    const children = await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: ids.lamps });
    expect(children.filter(c => c.text.includes("spare wick"))).toHaveLength(1);
  }, 60_000);

  test("access narrowed on the far box since: a full write queued earlier lands as a proposal; none drops it", async () => {
    const lamps = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.lamps! });
    expect((await tool("outline_create", { uri: lamps, text: "A box of matches" })).json.outcome).toBe("queued");
    await boardOn(far, "attic-notes", FAR).configureMcpAccess("propose");
    const narrowed = await pull();
    expect(narrowed.settled).toMatchObject([{ state: "proposed", said: expect.stringContaining("proposed as a comment") }]);
    const kids = await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: ids.lamps });
    expect(kids.some(k => k.text === "A box of matches")).toBe(false);
    expect((await tool("outline_comment", { uri: lamps, whole: true, body: "Order wicks" })).json.outcome).toBe("queued");
    await boardOn(far, "attic-notes", FAR).configureMcpAccess("none");
    const dropped = await pull();
    expect(dropped.settled).toMatchObject([{ state: "refused", said: expect.stringContaining("MCP access for attic-notes is none here now") }]);
    await boardOn(far, "attic-notes", FAR).configureMcpAccess("full");
  }, 60_000);

  test("a write cut off mid-pull is tried again without landing twice; no answer keeps it waiting; a bad ledger stops the pull", async () => {
    const lamps = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.lamps! });
    const q = (await tool("outline_create", { uri: lamps, text: "A tin of lamp oil" })).json;
    // A pull that made the block and stopped before its ledger heard: the ledger says applying, the block is there.
    const farBoard = boardOn(far, "attic-notes", FAR);
    const made = await farBoard.request<{ id: string; revision: number }>("create", { parentId: ids.lamps, text: "A tin of lamp oil", requestId: `netmail:${q.id}`, author: "agent", provenance: { actorId: "mcp:chat.example.test" } });
    // Someone has edited the landed note before its lost answer is retried: only the receipt identifies it.
    await farBoard.request("update", { blockId: made.id, text: "A tin of lamp oil, labelled", expectedRevision: made.revision, mutation: { author: "user" } });
    const state = join(dir, "far-state");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "netmail-applied.json"), JSON.stringify({ [q.id]: { id: q.id, state: "applying", at: "2026-03-14T09:00:00.000Z" } }));
    const retried = await pull();
    expect(retried.settled).toMatchObject([{ state: "applied", uri: expect.stringContaining(made.id) }]);
    const kids = await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: ids.lamps });
    expect(kids.filter(k => k.text.startsWith("A tin of lamp oil")).map(k => k.text)).toEqual(["A tin of lamp oil, labelled"]);

    // The far box's host doesn't answer: nothing is settled, the write waits.
    expect((await tool("outline_comment", { uri: lamps, whole: true, body: "Trim the wicks" })).json.outcome).toBe("queued");
    const gone = await pullNetmail({ hub: "hub-box", machine: FAR, state, env, open: async outline => Object.assign(new SocketBoard(join(dir, "no-such.sock"), 2000, outline), { address: { outline, machine: FAR } }) });
    const goneSaid = gone.detail;
    expect(gone).toMatchObject({ ok: true, settled: [] });
    // Its own summary says why, so the person running `ep0ch mcp pull` (or reading the job's state) isn't left guessing.
    expect(goneSaid).toContain("none applied here yet");
    expect(goneSaid).toContain("no-such.sock");
    // A ledger that can't be read stops the pull before anything is applied.
    writeFileSync(join(state, "netmail-applied.json"), "[not a ledger");
    expect(await pull()).toMatchObject({ ok: false, settled: [] });
    rmSync(join(state, "netmail-applied.json"));
    expect((await pull()).settled.map(s => s.state)).toEqual(["applied"]);
  }, 60_000);

  test("a far box's outline: a queued outline_assign_id stamps the note when pulled, and refuses one that changed meanwhile", async () => {
    const attic = boardOn(far, "attic-notes", FAR);
    const uri = (key: string) => formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids[key]! });
    const read = async (key: string) => (await tool("outline_read", { uri: uri(key) })).json;
    const first = await tool("outline_assign_id", { uri: uri("map"), revision: (await read("map")).revision });
    const second = await tool("outline_assign_id", { uri: uri("keys"), revision: (await read("keys")).revision });
    expect([first, second].map(q => q.json.outcome)).toEqual(["queued", "queued"]);
    const keysNow = await textOf(far, "attic-notes", FAR, ids.keys!);
    await attic.request("update", { blockId: ids.keys, text: "Key hook, now by the door", expectedRevision: keysNow.revision, mutation: { author: "user" } });
    const landed = await pull();
    expect(landed.settled.map(s => s.state)).toEqual(["applied", "refused"]);
    expect(landed.settled[1]!.said).toContain("changed since editing began");
    expect((await textOf(far, "attic-notes", FAR, ids.map!)).text).toContain("[work-id::GDN-001]");
    expect((await textOf(far, "attic-notes", FAR, ids.keys!)).text).not.toContain("work-id");
    expect(await editsBy(far, "attic-notes", ids.map!)).toContainEqual({ actorId: "mcp:chat.example.test", sessionId: expect.stringMatching(new RegExp(`^${PERSON}#c-[0-9a-f]{10}$`)) });
  }, 60_000);

  test("a pull that runs mid-deploy (its CLI on the old protocol) says why in its summary; the next pull, caught up, applies them once", async () => {
    const lamps = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.lamps! });
    const q = (await tool("outline_create", { uri: lamps, text: "A lamp written during a deploy" })).json;
    expect(q.outcome).toBe("queued");
    // The far box's host is already on the new protocol and its CLI isn't yet: the board won't open.
    const skew = "this door speaks protocol 270 and the outline host protocol 271: update the door (ep0ch install --apply)";
    const during = await pullNetmail({ hub: "hub-box", machine: FAR, state: join(dir, "far-state"), env, open: async () => ({ error: skew }) });
    expect(during).toMatchObject({ ok: true, taken: 1, settled: [] });
    expect(during.detail).toContain("none applied here yet (attic-notes isn't open here: this door speaks protocol 270");
    const waiting = (await tool("outline_write_status", { queueId: q.queueId })).json;
    expect(waiting.state).toBe("queued");
    expect(waiting.said).toContain("hasn't said what it became");
    // The CLI catches up: the next pull applies it, once.
    expect((await pull()).settled.map(s => s.state)).toEqual(["applied"]);
    expect(await pull()).toMatchObject({ taken: 0 });
    const kids = await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: ids.lamps });
    expect(kids.filter(k => k.text === "A lamp written during a deploy")).toHaveLength(1);
  }, 60_000);

  test("remote proposal settlement refuses before queueing at propose, and settles a queued refusal after access narrows", async () => {
    const attic = boardOn(far, "attic-notes", FAR);
    const pending: string[] = [];
    for (const op of ["apply", "dismiss"]) {
      const id = ids[`settle-${op}`]!;
      pending.push(id);
      const uri = formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: id });
      const denied = await tool(`outline_proposal_${op}`, { uri }, "gpty");
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("needs full access");
      expect((await tool(`outline_proposal_${op}`, { uri })).json.outcome).toBe("queued");
    }
    await attic.configureMcpAccess("propose");
    try {
      const landed = await pull();
      expect(landed.settled.map(s => s.state)).toEqual(["refused", "refused"]);
      for (const id of pending) expect(prop((await attic.get(id))!, "proposal-status")).toBe("open");
      expect((await pull()).settled).toEqual([]);
    } finally { await attic.configureMcpAccess("full"); follow("attic-notes"); }
  }, 60_000);

  test("the hub's backup job reads the queues, and a queue waiting a day while its machine was online is an incident", () => {
    const store = new Netmail(join(mirrors, ".netmail.sqlite"));
    const old = Date.parse("2026-03-10T08:00:00Z");
    try {
      store.enqueue({ machine: "nap-box", outline: "nap-notes", uri: "ep0ch://nap-notes@nap-box/b/x", blockId: "x", tool: "outline_comment", input: { whole: true, body: "hi" },
        revision: null, mirrorRevision: 1, textHash: null, instanceId: null, level: "full", actorId: "mcp:chat.example.test", subject: PERSON, clientId: CLIENT }, old);
    } finally { store.close(); }
    const s: BackupState = { outlines: {}, mirrors: { "nap-box/nap-notes": { at: "2026-03-11T09:00:00.000Z" } } };
    const c = { env: { ...env, EP0CH_MCP_MIRROR_DIR: mirrors } } as unknown as Parameters<typeof readQueues>[0];
    s.netmail = { queues: readQueues(c, s) };
    expect(s.netmail.queues!["nap-box"]).toEqual({ waiting: 1, oldest: "2026-03-10T08:00:00.000Z", lastPull: null, lastSeen: "2026-03-11T09:00:00.000Z" });
    const found = incidents(s, HERE, Date.parse("2026-03-11T10:00:00Z"), { run: "ep0ch backup run", log: "journalctl" });
    expect(found).toEqual([expect.objectContaining({ key: "netmail:nap-box", fix: expect.stringContaining("on nap-box: ep0ch mcp pull") })]);
    // Not seen online since: no incident, only waiting.
    s.netmail.queues!["nap-box"]!.lastSeen = "2026-03-09T00:00:00.000Z";
    expect(incidents(s, HERE, Date.parse("2026-03-11T10:00:00Z"), { run: "", log: "" })).toEqual([]);
  });

  test("a remote write is said on the door's screen; a client id URL is named by its host", () => {
    expect(clientName(CLIENT)).toBe("chat.example.test");
    expect(clientName("client_fictional")).toBe("client_fictional");
    expect(actorOf({ sub: PERSON, clientId: CLIENT })).toEqual({ actorId: "mcp:chat.example.test", sessionId: PERSON });
    const change = { sequence: 1, changeId: 1, action: "update", kind: "edit" as const, blockId: "b1", actor: { author: "agent", actorId: "mcp:chat.example.test" }, recordedAt: "" };
    expect(remoteWrite({ domain: "content", action: "update", sequence: 1, change })).toEqual({ actor: "mcp:chat.example.test", verb: "changed", blockId: "b1" });
    expect(remoteWrite({ domain: "content", action: "update", sequence: 1, change, catchUp: true })).toBeNull();
    expect(remoteWrite({ domain: "content", action: "update", sequence: 1, change: { ...change, actor: { author: "agent", actorId: "claude-code" } } })).toBeNull();
  });
  test("long-hostname clients on one subject read only their own pending writes", async () => {
    const remote = { uri: formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.trunk! }) };
    const host = `${"a".repeat(60)}.${"b".repeat(60)}`;
    const callers = ["first", "second"].map(name => ({ sub: PERSON, clientId: `https://${host}.${name}.example.test/client` }));
    const queued = [];
    for (const [i, caller] of callers.entries()) {
      const write = await tool("outline_comment", { ...remote, whole: true, body: `Private inventory ${i}`, persona: "scout" }, undefined, caller);
      expect(write.json.outcome).toBe("queued");
      queued.push(write.json.queueId);
    }
    for (const [i, caller] of callers.entries()) {
      const read = await tool("outline_read", remote, undefined, caller);
      expect(read.json.pending.comments).toEqual([{ queueId: queued[i], body: `Private inventory ${i}` }]);
    }
    await pull();
  });

  test("a per-write persona records its principal and leaves the named path's cap in place", async () => {
    const parent = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.seeds! });
    const made = await tool("outline_create", { uri: parent, text: "Persona's seed tray", persona: "scout" });
    expect(made.isError).toBe(false);
    expect(made.json.by).toBe("scout (chat.example.test)");
    const child = await textOf(here, "garden-notes", HERE, made.json.uri.split("/b/")[1]);
    expect(child.actor).toBe("mcp:scout/chat.example.test");
    const capped = await tool("outline_set_property", { uri: parent, key: "keeper", value: "scout", revision: (await textOf(here, "garden-notes", HERE, ids.seeds!)).revision, persona: "scout" }, "gpty");
    expect(capped.json.outcome).toBe("proposed");
    expect(capped.json.by).toBe("scout (chat.example.test)");
    expect((await textOf(here, "garden-notes", HERE, ids.seeds!)).text).not.toContain("keeper::scout");
    for (const persona of ["not/a-persona", "", "x".repeat(65), 42, null]) {
      const invalid = await tool("outline_create", { uri: parent, text: "Invalid persona's tray", persona });
      expect(invalid.isError).toBe(true);
      expect(invalid.text).toContain("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
      expect(invalid.text).toContain("loki");
    }
    const queued = await tool("outline_comment", { uri: formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.trunk! }), whole: true, body: "A scout's inventory", persona: "scout" });
    expect(queued.json.outcome).toBe("queued");
    expect(queued.json.by).toBe("scout (chat.example.test)");
    const remote = { uri: formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids.trunk! }) };
    expect((await tool("outline_read", remote)).json.pending.comments).toContainEqual({ queueId: queued.json.queueId, body: "A scout's inventory" });
    expect((await tool("outline_read", remote, undefined, { sub: PERSON, clientId: "https://other.example.test/client" })).json.pending).toBeUndefined();
    expect((await tool("outline_read", remote, undefined, { sub: "user_fictional_other", clientId: CLIENT })).json.pending).toBeUndefined();
    expect((await tool("outline_write_status", { queueId: queued.json.queueId, persona: "scout" })).json).toMatchObject({ state: "queued", by: "scout (chat.example.test)" });
    expect((await pull()).settled).toMatchObject([{ state: "applied" }]);
    expect((await boardOn(far, "attic-notes", FAR).comments(ids.trunk!)).find(t => t.body === "A scout's inventory")?.author).toBe("mcp:scout/chat.example.test");
  }, 60_000);
});

describe("personas: who a connection writes as", () => {
  const caller = { sub: "user_fictional_a", clientId: "https://chat.example.test/oauth/client-metadata" };
  test("a queue actor without a principal sees only its exact actor's writes", () => {
    const dir = scratchDir("ep0ch-actor-queue-");
    const queue = new Netmail(join(dir, "queue.sqlite"));
    try {
      const actors = ["mcp:scout/invalid:one", "mcp:scout/invalid:two", "mcp:chat.example.test"];
      const entries = actors.map(actorId => queue.enqueue({
        machine: FAR, outline: "attic-notes", blockId: "fictional-trunk", uri: "ep0ch://attic-notes@far-box/b/fictional-trunk",
        tool: "outline_comment", input: { body: actorId, whole: true }, actorId, subject: `${PERSON}#fictional-call`, clientId: null,
        level: "full", revision: null, mirrorRevision: null, textHash: null, instanceId: null,
      }));
      for (const [i, actorId] of actors.entries()) {
        expect(queue.forBlock(FAR, "attic-notes", "fictional-trunk", { actorId, subject: PERSON }).map(e => e.id)).toEqual([entries[i]!.id]);
      }
    } finally { queue.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("a client or subject maps to a name; none keeps the client's; a bad name is ignored; the file works too", () => {
    expect(actorOf(caller, {}).actorId).toBe("mcp:chat.example.test");
    expect(actorOf(caller, { EP0CH_MCP_PERSONAS: "chat.example.test=daddy" })).toEqual({ actorId: "mcp:daddy/chat.example.test", sessionId: "user_fictional_a" });
    expect(actorOf(caller, { EP0CH_MCP_PERSONAS: "chat.example.test=daddy, user_fictional_a=sysop" }).actorId).toBe("mcp:sysop/chat.example.test");
    expect(actorOf(caller, { EP0CH_MCP_PERSONAS: "chat.example.test=not a name!" }).actorId).toBe("mcp:chat.example.test");
    // A dynamically registered client goes by the name it was given here, and a path's persona wins over the list (PIE-804).
    const dcr = { sub: PERSON, clientId: "qFictionalDcr01" };
    expect(actorOf(dcr, { EP0CH_MCP_CLIENT_NAMES: "qFictionalDcr01=chatgpt" }).actorId).toBe("mcp:chatgpt");
    expect(actorOf({ ...dcr, persona: "gpty" }, { EP0CH_MCP_CLIENT_NAMES: "qFictionalDcr01=chatgpt", EP0CH_MCP_PERSONAS: "chatgpt=daddy" }).actorId).toBe("mcp:gpty/chatgpt");
    expect(actorOf(dcr, {}).actorId).toBe("mcp:qFictionalDcr01");
    // A path's cap per outline: outline@machine, then outline, then the path, then propose.
    const cap = pathCap("gpty@gurgle=full, gpty@float-hub@laptop=read, gpty=propose, warp=none, bad=sideways", "gpty");
    expect([cap({ outline: "gurgle", machine: "float-2" }), cap({ outline: "float-hub", machine: "laptop" }), cap({ outline: "float-hub", machine: "box-c" }), cap({ outline: "pie", machine: "float-2" }), cap()])
      .toEqual(["full", "read", "propose", "propose", "propose"]);
    expect(pathCap("warp=none", "warp")({ outline: "pie", machine: "float-2" })).toBe("none");
    expect(pathCap("bad=sideways", "bad")()).toBe("none");
    // A stdio client names itself: the registered-name list is the gateway's, for OAuth clients.
    expect(actorOf({ sub: STDIO_SUBJECT, clientId: "qFictionalDcr01" }, { EP0CH_MCP_CLIENT_NAMES: "qFictionalDcr01=chatgpt" }, "box-a").actorId).toBe("mcp:qFictionalDcr01@box-a");
    const home = scratchDir("ep0ch-persona-");
    try {
      mkdirSync(join(home, ".config", "ep0ch"), { recursive: true });
      writeFileSync(join(home, ".config", "ep0ch", "mcp.env"), "# who\nEP0CH_MCP_PERSONAS=chat.example.test=daddy\n");
      expect(actorOf(caller, { HOME: home }).actorId).toBe("mcp:daddy/chat.example.test");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

describe("principal and persona (PIE-679)", () => {
  const gateway = { sub: "user_fictional_a", clientId: "https://chat.example.test/oauth/client-metadata" };
  const stdio = (client: string) => ({ sub: STDIO_SUBJECT, clientId: client });

  test("a principal comes from auth: the gateway's OAuth client, stdio's client on this machine", () => {
    expect(principalOf(gateway, "float-2")).toBe("chat.example.test");
    expect(principalOf(stdio("claude-code"), "float-2")).toBe("claude-code@float-2");
    expect(principalOf(stdio("claude-code"), "laptop")).toBe("claude-code@laptop");
    expect(actorOf(stdio("claude-code"), {}, "float-2").actorId).toBe("mcp:claude-code@float-2");
  });

  test("a persona sits on its principal and is shown with it; stdio and the gateway differ in principal, not in persona", () => {
    const env = { EP0CH_MCP_PERSONAS: "claude-code@float-2=loki,claude-code@laptop=cowboy,chat.example.test=daddy" };
    expect(actorOf(stdio("claude-code"), env, "float-2").actorId).toBe("mcp:loki/claude-code@float-2");
    expect(actorOf(stdio("claude-code"), env, "laptop").actorId).toBe("mcp:cowboy/claude-code@laptop");
    expect(actorOf(gateway, env, "float-2").actorId).toBe("mcp:daddy/chat.example.test");
    expect(actorLabel(actorOf(stdio("claude-code"), env, "float-2").actorId)).toBe("loki (claude-code@float-2)");
    // A bare client name does not name a stdio principal: it would reach every machine's.
    expect(actorOf(stdio("claude-code"), { EP0CH_MCP_PERSONAS: "claude-code=loki" }, "float-2").actorId).toBe("mcp:claude-code@float-2");
  });

  test("a persona is recorded, never refused (ADR 0003): OUTLINER_ACTOR, EP0CH_AGENT, the folder's .ep0ch, then the machine's default", () => {
    const env = { EP0CH_MCP_PERSONAS: "claude-code@float-2=loki", EP0CH_AGENT: "loki" };
    // Claimed on another principal than the list gives it to: recorded as claimed, with the principal that says where it came from.
    expect(personaClaim(stdio("claude-code"), env, "laptop")).toEqual({ persona: "loki" });
    expect(actorOf(stdio("claude-code"), env, "laptop").actorId).toBe("mcp:loki/claude-code@laptop");
    expect(actorOf(stdio("claude-code"), { EP0CH_AGENT: "scout", OUTLINER_ACTOR: "wren" }, "laptop").actorId).toBe("mcp:wren/claude-code@laptop");
    // The folder a stdio server runs in names its persona in .ep0ch, over the machine's default and under the environment.
    const folder = mkdtempSync(join(tmpdir(), "ep0ch-persona-"));
    try {
      writeFileSync(join(folder, ".ep0ch"), 'ws = "pond-notes"\nagent = "testbot"\n');
      mkdirSync(join(folder, "sub"));
      const here = { ...stdio("claude-code"), folder: join(folder, "sub") };
      expect(actorOf(here, { EP0CH_MCP_PERSONAS: "claude-code@box-a=cowboy" }, "box-a").actorId).toBe("mcp:testbot/claude-code@box-a");
      expect(actorOf(here, { EP0CH_AGENT: "scout" }, "box-a").actorId).toBe("mcp:scout/claude-code@box-a");
      expect(actorOf({ ...stdio("claude-code"), folder }, {}, "box-a").actorId).toBe("mcp:testbot/claude-code@box-a");
    } finally { rmSync(folder, { recursive: true, force: true }); }
    // The gateway reads no environment claim and no folder: only its own principal's entry.
    expect(actorOf(gateway, { EP0CH_AGENT: "loki" }, "float-2").actorId).toBe("mcp:chat.example.test");
  });

  test("the principal that made an outline writes with full whatever the setting; a person's none holds for all", () => {
    const status = { level: "read" as const, owner: "claude-code@float-2" };
    expect(levelFor(status, stdio("claude-code"), "float-2", undefined)).toBe("full");
    expect(levelFor(status, stdio("claude-code"), "laptop", undefined)).toBe("read");
    expect(levelFor(status, gateway, "float-2", undefined)).toBe("read");
    expect(levelFor({ ...status, level: "none" }, stdio("claude-code"), "float-2", undefined)).toBe("none");
    expect(levelFor({ level: "read" }, stdio("claude-code"), "float-2", undefined)).toBe("read");
  });
});
