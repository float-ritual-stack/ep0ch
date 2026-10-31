// The gateway's live route (PIE-661), end to end over real HTTP. Two scratch hosts: "here" (the gateway's machine)
// and a far box standing in for the laptop. The far box's outline is mirrored here and reached live through the real
// shared ssh forward (outline-core's ensureForward), over the fake ssh (packages/outliner/test/fake-ssh.ts). "The
// laptop goes away" is the fake ssh refusing connections (FAKE_SSH_DOWN) with the forward killed. Fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { join, resolve } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { forwardFor } from "@ep0ch/outliner/machine-forward";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { LiveMachines } from "../src/mcp-live";
import { OutlineMirror } from "../src/mcp-mirror";
import { drainNetmail, Netmail, pullNetmail, queueCommand } from "../src/mcp-netmail";
import { canonicalLocalMachineName, type NotesBoard } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const PERSON = "user_fictional_a";
const CLIENT = "https://chat.example.test/oauth/client-metadata";
const FAR = "laptop";
const DOOR = resolve(import.meta.dir, "..");
const HERE = canonicalLocalMachineName();

describe.skipIf(!outliner)("the gateway's live route: the laptop's own host when it answers, the mirror when it doesn't", () => {
  const here = new ScratchHost(), far = new ScratchHost();
  let dir = "", mirrors = "", gateway: Gateway, closeOutlines: () => void, live: LiveMachines;
  let signing: CryptoKey, keys: ReturnType<typeof createLocalJWKSet>;
  const boards: SocketBoard[] = [];
  const logs: string[] = [];
  const ids: Record<string, string> = {};
  const forwardEnv: Record<string, string> = {};
  const pullEnv: Record<string, string> = {};
  let nextId = 1, clock = Date.now(), forwardCalls = 0, queuedKeys = "";

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
  const token = async () => new SignJWT({ client_id: CLIENT, scope: "profile" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" }).setIssuer(ISSUER).setSubject(PERSON).setAudience(RESOURCE)
    .setIssuedAt().setExpirationTime("5m").sign(signing);
  const tool = async (name: string, args: Record<string, unknown>, at: Gateway = gateway) => {
    const res = await fetch(at.url, { method: "POST", headers: { Host: new URL(RESOURCE).host, "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }) });
    const r = await res.json() as { result: { isError?: boolean; content: { text: string }[] } };
    const text = r.result.content[0]!.text;
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* an error's words */ }
    return { isError: !!r.result.isError, text, json };
  };
  const farRecord = async (id: string) => (await boardOn(far, "attic-notes", FAR).records([id])).records[0]!;
  const childrenOf = async (id: string) => (await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: id })).map(c => c.text);
  const pull = () => pullNetmail({ hub: "hub-box", machine: FAR, state: join(dir, "far-state"), env: pullEnv, open: async outline => boardOn(far, outline, FAR) });
  /** The laptop goes away: its forward ends and every ssh to it is refused. */
  const laptopAway = () => {
    try { process.kill(Number(readFileSync(join(here.outlines, ".remote", `${FAR}.ctl`), "utf8"))); } catch { /* none started */ }
    forwardEnv.FAKE_SSH_DOWN = "1";
  };
  const laptopBack = () => { delete forwardEnv.FAKE_SSH_DOWN; };

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signing = pair.privateKey as CryptoKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] });

    await here.start(); await far.start();
    await far.create("attic-notes");
    const attic = boardOn(far, "attic-notes", FAR);
    await attic.configureMcpAccess("full");
    const make = async (key: string, text: string) => { ids[key] = (await attic.request<{ id: string }>("create", { parentId: null, text, author: "user" })).id; };
    await make("trunk", "Trunk contents [room::attic]\nOld maps of the canal.");
    await make("lamps", "Lamp list\nTwo oil lamps, one cracked.");
    await make("keys", "Key hook\nThree brass keys.");
    await make("map", "Map drawer\nCharts of the canal.");

    dir = scratchDir("ep0ch-mcpl-");
    mirrors = join(dir, "mirrors");
    mkdirSync(join(mirrors, FAR), { recursive: true });
    follow("attic-notes");
    for (const d of ["bin", "bin-far", "hub-home", "hub-outlines", "far-home", "gw-home"]) mkdirSync(join(dir, d));
    const ssh = `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`;
    writeFileSync(join(dir, "bin", "ssh"), ssh);
    // The gateway's own `ep0ch` (what the laptop's pull runs over ssh), and the laptop's (what the forward asks for its socket).
    writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nEP0CH_MCP_MIRROR_DIR=${mirrors} exec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    writeFileSync(join(dir, "bin-far", "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    for (const f of ["bin/ssh", "bin/ep0ch", "bin-far/ep0ch"]) chmodSync(join(dir, f), 0o755);
    Object.assign(pullEnv, {
      PATH: process.env.PATH!, HOME: join(dir, "far-home"), EP0CH_SSH: join(dir, "bin", "ssh"),
      FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE!, FAKE_SSH_HOME: join(dir, "hub-home"), FAKE_SSH_OUTLINES: join(dir, "hub-outlines"), FAKE_SSH_BIN: join(dir, "bin"),
    });
    Object.assign(forwardEnv, {
      PATH: process.env.PATH!, HOME: join(dir, "gw-home"), EP0CH_SSH: join(dir, "bin", "ssh"),
      FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE!, FAKE_SSH_HOME: join(dir, "far-home"), FAKE_SSH_OUTLINES: far.outlines, FAKE_SSH_BIN: join(dir, "bin-far"), FAKE_SSH_LOG: join(dir, "ssh.log"),
    });

    live = new LiveMachines({
      forward: m => { forwardCalls++; return forwardFor(m, here.outlines, forwardEnv as NodeJS.ProcessEnv); },
      now: () => clock, budgetMs: 30_000, backoffMs: 45_000, log: line => logs.push(line),
    });
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, line => logs.push(line), Date.now, async () => null);
    // The gateway's own tries (its drain's timer) are off here, so the backoff's counts are the calls'; the drain test starts its own.
    const outlines = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no local outlines" }), [mirror], async () => [], join(mirrors, ".netmail.sqlite"), live, undefined, { drainEveryMs: 0, writeWaitMs: 0 });
    closeOutlines = outlines.close;
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: line => logs.push(line) });
  }, 90_000);

  afterAll(async () => {
    gateway?.stop(); closeOutlines?.();
    try { process.kill(Number(readFileSync(join(here.outlines, ".remote", `${FAR}.ctl`), "utf8"))); } catch { /* none */ }
    for (const b of boards) b.close();
    await Bun.sleep(200);
    await here.dispose(); await far.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  test("the laptop answers: reads, finds, queries and threads are the live outline's, with source live and the machine", async () => {
    // A change on the laptop the mirror (made in beforeAll) doesn't have.
    await boardOn(far, "attic-notes", FAR).request("create", { parentId: null, text: "Fresh note\nWritten after the mirror was copied.", author: "user" });
    const found = await tool("outline_find", { query: "Fresh note", outline: "attic-notes" });
    expect(found.isError, found.text).toBe(false);
    expect(found.text).toContain("Fresh note");
    const read = await tool("outline_read", { ref: ids.trunk, outline: "attic-notes" });
    expect(read.json.reachability).toMatchObject({ source: "live", machine: FAR, level: "full" });
    expect(read.json.uri).toBe(`ep0ch://attic-notes@${FAR}/b/${ids.trunk}`);
    const q = await tool("outline_query", { query: "room=attic", outline: "attic-notes" });
    expect(q.text).toContain("Trunk contents");
    const threads = await tool("outline_threads", { ref: ids.trunk, outline: "attic-notes" });
    expect(threads.isError, threads.text).toBe(false);
    const listed = (await tool("list_outlines", {})).json.outlines[0];
    expect(listed).toMatchObject({ outline: "attic-notes", machine: FAR, source: "live", writes: "applied", route: { via: "live" } });
    expect(typeof listed.route.checkedAt).toBe("string");
  }, 60_000);

  test("the laptop answers: a write goes straight to its host, revision-checked and attributed, and is not queued", async () => {
    const read = (await tool("outline_read", { ref: ids.lamps, outline: "attic-notes" })).json;
    const patched = await tool("outline_patch", { ref: ids.lamps, outline: "attic-notes", revision: read.revision, patches: [{ observed: "one cracked", replacement: "none cracked" }] });
    expect(patched.json).toMatchObject({ outcome: "applied", source: "live", machine: FAR, outline: "attic-notes" });
    expect((await farRecord(ids.lamps!)).text).toContain("none cracked");
    const stale = await tool("outline_patch", { ref: ids.lamps, outline: "attic-notes", revision: read.revision, patches: [{ observed: "none cracked", replacement: "three lamps" }] });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain(`revision ${read.revision}, now ${read.revision + 1}`);
    expect(stale.text).toContain("read it again and send the patch against the new text");
    expect((await farRecord(ids.lamps!)).text).toContain("none cracked");
    const entries = await boardOn(far, "attic-notes", FAR).request<{ entries: { block: { id: string }; actorId?: string; sessionId?: string }[] }>("activity.recent", { since: "2000-01-01T00:00:00.000Z", author: "agent", actorId: "mcp:chat.example.test", limit: 50, kinds: ["text", "properties"] });
    expect(entries.entries.filter(e => e.block.id === ids.lamps).map(e => ({ actorId: e.actorId, sessionId: e.sessionId }))).toContainEqual({ actorId: "mcp:chat.example.test", sessionId: expect.stringMatching(new RegExp(`^${PERSON}#c-[0-9a-f]{10}$`)) });
    const row = (await tool("list_outlines", {})).json.outlines[0];
    expect(row.queue.waiting).toBe(0);
    expect(logs.join("\n")).toContain(`outline_patch ep0ch://attic-notes@${FAR}/b/${ids.lamps}: applied live on ${FAR}`);
  }, 60_000);

  test("the laptop is away: the mirror answers saying why, writes queue, and the backoff keeps a sleeping laptop from slowing every call", async () => {
    laptopAway();
    clock += 1000;
    const read = await tool("outline_read", { ref: ids.keys, outline: "attic-notes" });
    expect(read.json.reachability).toMatchObject({ source: "mirror", liveTried: { why: expect.stringContaining(`${FAR} didn't answer over link or ssh`) } });
    expect(read.json.reachability.reason).toContain(`${FAR} didn't answer over link or ssh (tried just now)`);
    expect(read.json.reachability.reason).toContain("read-only copy");
    const row = (await tool("list_outlines", {})).json.outlines[0];
    expect(row).toMatchObject({ source: "mirror", writes: "queued", route: { via: "mirror", why: expect.stringContaining("didn't answer") } });
    // The write queues, and the caller's own read shows it laid over the mirror.
    const queued = await tool("outline_patch", { ref: ids.keys, outline: "attic-notes", revision: read.json.revision, patches: [{ observed: "Three brass keys", replacement: "Four brass keys" }] });
    expect(queued.json).toMatchObject({ outcome: "queued", queuedFor: `attic-notes@${FAR}`, why: expect.stringContaining(`${FAR} didn't answer over link or ssh`) });
    // It says why it queued, and that it lands when the gateway reaches the laptop again, not only at a pull.
    expect(queued.json.said).toMatch(new RegExp(`^${FAR} didn't answer over link or ssh.*: queued for attic-notes@${FAR} \\(${FAR} hasn't pulled yet\\); it lands when this server reaches ${FAR} again`));
    queuedKeys = queued.json.queueId;
    expect((await farRecord(ids.keys!)).text).toContain("Three brass keys");
    const again = await tool("outline_read", { ref: ids.keys, outline: "attic-notes" });
    expect(again.json.pending).toBeTruthy();
    // Within the backoff nobody tries the machine again, however many calls come.
    const calls = forwardCalls;
    clock += 10_000;
    for (let i = 0; i < 3; i++) expect((await tool("outline_read", { ref: ids.map, outline: "attic-notes" })).json.reachability.source).toBe("mirror");
    expect(forwardCalls).toBe(calls);
    expect((await tool("outline_read", { ref: ids.map, outline: "attic-notes" })).json.reachability.reason).toContain("tried 10 s ago");
    // After it, one try; still away, so the backoff starts over.
    clock += 40_000;
    await tool("outline_read", { ref: ids.map, outline: "attic-notes" });
    expect(forwardCalls).toBe(calls + 1);
    await tool("outline_read", { ref: ids.map, outline: "attic-notes" });
    expect(forwardCalls).toBe(calls + 1);
  }, 90_000);

  test("the laptop is back: the first call that finds it live drains what was queued, in order, before its own write; nothing is left for a pull", async () => {
    laptopBack();
    // Still inside the backoff of the last failed try: a read keeps to the mirror, then is live once it has passed.
    expect((await tool("outline_read", { ref: ids.keys, outline: "attic-notes" })).json.reachability.source).toBe("mirror");
    clock += 50_000;
    const read = await tool("outline_read", { ref: ids.keys, outline: "attic-notes" });
    expect(read.json.reachability).toMatchObject({ source: "live", machine: FAR });
    // The patch queued while the laptop was away landed over the link before the read was answered.
    expect((await farRecord(ids.keys!)).text).toContain("Four brass keys");
    expect(read.json.pending).toBeFalsy();
    const status = await tool("outline_write_status", { queueId: queuedKeys });
    expect(status.json).toMatchObject({ state: "applied" });
    // A live patch after it goes straight through, with nothing still queued before it.
    const second = await tool("outline_patch", { ref: ids.keys, outline: "attic-notes", revision: read.json.revision, patches: [{ observed: "brass keys", replacement: "brass and iron keys" }] });
    expect(second.json).toMatchObject({ outcome: "applied", source: "live" });
    expect(second.json.queuedEarlier).toBeUndefined();
    expect((await farRecord(ids.keys!)).text).toContain("Four brass and iron keys");
    expect(logs.join("\n")).toContain(`mcp drain: attic-notes@${FAR}: 1 applied`);
    // The laptop's pull finds nothing: the gateway settled it.
    expect(await pull()).toMatchObject({ ok: true, taken: 0 });
  }, 120_000);

  test("a queued create and a live create each land once", async () => {
    laptopAway();
    clock += 50_000;
    const q = await tool("outline_create", { ref: ids.map, outline: "attic-notes", text: "Queued child" });
    expect(q.json.outcome).toBe("queued");
    laptopBack();
    clock += 50_000;
    const l = await tool("outline_create", { ref: ids.map, outline: "attic-notes", text: "Live child" });
    expect(l.json).toMatchObject({ outcome: "applied", source: "live" });
    expect(await pull()).toMatchObject({ taken: 0 });
    expect((await childrenOf(ids.map!)).sort()).toEqual(["Live child", "Queued child"]);
  }, 120_000);

  test("a write inside the backoff of a failed try tries the laptop again before it queues (a short link drop)", async () => {
    laptopAway();
    clock += 50_000;
    expect((await tool("outline_read", { ref: ids.trunk, outline: "attic-notes" })).json.reachability.source).toBe("mirror");
    // The link is back seconds later: a read inside the backoff still keeps to the mirror; a write tries again, and lands.
    laptopBack();
    clock += 1000;
    expect((await tool("outline_read", { ref: ids.trunk, outline: "attic-notes" })).json.reachability.source).toBe("mirror");
    const w = await tool("outline_create", { ref: ids.trunk, outline: "attic-notes", text: "Written just after the drop" });
    expect(w.json).toMatchObject({ outcome: "applied", source: "live" });
    expect(await childrenOf(ids.trunk!)).toContain("Written just after the drop");
  }, 60_000);

  test("a write rides out a link restart (a deploy's): it waits a few seconds for the laptop instead of queueing", async () => {
    const own = new LiveMachines({ forward: m => forwardFor(m, here.outlines, forwardEnv as NodeJS.ProcessEnv), now: () => clock, budgetMs: 30_000, backoffMs: 45_000 });
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, () => {}, Date.now, async () => null);
    const outlines = machineOutlines(undefined, () => {}, async () => ({ error: "none" }), [mirror], async () => [], join(mirrors, ".netmail.sqlite"), own, undefined, { drainEveryMs: 0, writeWaitMs: 10_000 });
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    const gw = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: () => {} });
    try {
      laptopAway();
      // The link comes back two seconds into the write.
      setTimeout(laptopBack, 2000);
      const w = await tool("outline_create", { ref: ids.map, outline: "attic-notes", text: "Written across a restart" }, gw);
      expect(w.json).toMatchObject({ outcome: "applied", source: "live" });
      expect((await childrenOf(ids.map!)).filter(t => t === "Written across a restart")).toHaveLength(1);
    } finally { gw.stop(); outlines.close(); laptopBack(); }
  }, 60_000);

  test("with no call and no pull, the gateway drains a laptop's queued writes within seconds of its link coming back", async () => {
    const own = new LiveMachines({ forward: m => forwardFor(m, here.outlines, forwardEnv as NodeJS.ProcessEnv), now: () => clock, budgetMs: 30_000, backoffMs: 45_000 });
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, () => {}, Date.now, async () => null);
    const quiet: string[] = [];
    const outlines = machineOutlines(undefined, line => quiet.push(line), async () => ({ error: "none" }), [mirror], async () => [], join(mirrors, ".netmail.sqlite"), own, undefined, { drainEveryMs: 150, writeWaitMs: 0 });
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    const gw = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: () => {} });
    try {
      laptopAway();
      const q = await tool("outline_create", { ref: ids.keys, outline: "attic-notes", text: "Queued while the link was down" }, gw);
      expect(q.json).toMatchObject({ outcome: "queued", why: expect.stringContaining("didn't answer") });
      const p = await tool("outline_comment", { ref: ids.keys, outline: "attic-notes", whole: true, body: "A note on the keys, queued" }, gw);
      expect(p.json.outcome).toBe("queued");
      // Within the backoff, with no call coming in and the laptop never pulling: the gateway's own try finds it back.
      laptopBack();
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !(await childrenOf(ids.keys!)).includes("Queued while the link was down")) await Bun.sleep(100);
      expect((await childrenOf(ids.keys!)).filter(t => t === "Queued while the link was down")).toHaveLength(1);
      for (let i = 0; i < 50 && (await tool("outline_write_status", { queueId: p.json.queueId }, gw)).json.state !== "applied"; i++) await Bun.sleep(100);
      expect((await tool("outline_write_status", { queueId: q.json.queueId }, gw)).json).toMatchObject({ state: "applied" });
      expect((await tool("outline_write_status", { queueId: p.json.queueId }, gw)).json).toMatchObject({ state: "applied" });
      expect(quiet.join("\n")).toMatch(/mcp drain: attic-notes@laptop: \d+ applied/);
      expect(await pull()).toMatchObject({ ok: true, taken: 0 });
    } finally { gw.stop(); outlines.close(); laptopBack(); }
  }, 60_000);

  test("a live write whose answer is lost is queued with why, as the same write, and lands once", async () => {
    // A stand-in link that passes everything to the laptop's host but loses the answer to one create.
    const proxy = join(dir, "lossy.sock");
    let lose = true;
    const server: Server = createServer(c => {
      const up = connect(far.sock);
      const dropped = new Set<unknown>();
      let inBuf = "", outBuf = "";
      c.on("data", d => {
        inBuf += d.toString();
        for (let nl = inBuf.indexOf("\n"); nl >= 0; nl = inBuf.indexOf("\n")) {
          const line = inBuf.slice(0, nl); inBuf = inBuf.slice(nl + 1);
          const msg = JSON.parse(line);
          if (lose && msg.action === "create") { lose = false; dropped.add(msg.id); }
          up.write(line + "\n");
        }
      });
      up.on("data", d => {
        outBuf += d.toString();
        for (let nl = outBuf.indexOf("\n"); nl >= 0; nl = outBuf.indexOf("\n")) {
          const line = outBuf.slice(0, nl); outBuf = outBuf.slice(nl + 1);
          if (!dropped.has(JSON.parse(line).id)) c.write(line + "\n");
        }
      });
      const end = () => { c.destroy(); up.destroy(); };
      c.on("error", end); up.on("error", end); c.on("close", end); up.on("close", end);
    });
    await new Promise<void>(r => server.listen(proxy, r));
    const lossy = new LiveMachines({ forward: async () => ({ socket: proxy }), now: () => clock, budgetMs: 10_000, backoffMs: 45_000, requestTimeoutMs: 1500 });
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, () => {}, Date.now, async () => null);
    const outlines = machineOutlines(undefined, () => {}, async () => ({ error: "none" }), [mirror], async () => [], join(mirrors, ".netmail.sqlite"), lossy, undefined, { drainEveryMs: 0, writeWaitMs: 0 });
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    const gw = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: () => {} });
    try {
      const w = await tool("outline_create", { ref: ids.lamps, outline: "attic-notes", text: "A lamp whose answer was lost" }, gw);
      expect(w.isError, w.text).toBe(false);
      expect(w.json).toMatchObject({ outcome: "queued", why: expect.stringContaining("didn't answer the write"), base: { source: "live" } });
      // It did land on the laptop; the answer was what got lost.
      expect((await childrenOf(ids.lamps!)).filter(t => t === "A lamp whose answer was lost")).toHaveLength(1);
      // The first try and the queued retry share a request id, including when the live answer is lost.
      clock += 50_000;
      expect((await tool("outline_read", { ref: ids.lamps, outline: "attic-notes" }, gw)).json.reachability.source).toBe("live");
      const status = (await tool("outline_write_status", { queueId: w.json.queueId }, gw)).json;
      expect(status).toMatchObject({ state: "applied" });
      expect((await childrenOf(ids.lamps!)).filter(t => t === "A lamp whose answer was lost")).toHaveLength(1);
      expect(await pull()).toMatchObject({ ok: true, taken: 0 });
    } finally { gw.stop(); outlines.close(); server.close(); }
  }, 60_000);

  test("a host on another protocol is as good as away: the mirror serves, and the reason names the command to run on the laptop", async () => {
    // A stand-in host that answers the forward's questions but speaks another PROTOCOL.
    const sock = join(dir, "old.sock");
    const server: Server = createServer(c => {
      let buf = "";
      c.on("data", d => {
        buf += d.toString();
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          c.write(JSON.stringify({ id: req.id, ok: true, result: req.action === "ping" ? { protocolVersion: PROTOCOL - 1 } : { outlines: [] } }) + "\n");
        }
      });
    });
    await new Promise<void>(r => server.listen(sock, r));
    try {
      const old = new LiveMachines({ forward: async () => ({ socket: sock }), now: () => clock, budgetMs: 5000, log: line => logs.push(line) });
      const answer = await old.board(FAR, "attic-notes");
      expect("away" in answer).toBe(true);
      if (!("away" in answer)) return;
      expect(answer.away.why).toContain(`speaks protocol ${PROTOCOL - 1} and this gateway ${PROTOCOL}`);
      expect(answer.away.why).toContain(`on ${FAR} run \`ep0ch install --apply\``);
      expect(answer.away.command).toBe("ep0ch install --apply");
      expect(old.route(FAR, "attic-notes")).toMatchObject({ via: "mirror", command: "ep0ch install --apply" });
      old.close();
      // And through the gateway: the same, with the mirror's answer.
      const mirror = new OutlineMirror("attic-notes", FAR, mirrors, line => logs.push(line), Date.now, async () => null);
      const stale = new LiveMachines({ forward: async () => ({ socket: sock }), now: () => clock, budgetMs: 5000 });
      const outlines = machineOutlines(undefined, () => {}, async () => ({ error: "none" }), [mirror], async () => [], join(mirrors, ".netmail.sqlite"), stale);
      const second = startGateway({ config: gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON }) as any, outlines, port: 0, bind: "127.0.0.1", keys, log: () => {} });
      try {
        const read = await tool("outline_read", { ref: ids.trunk, outline: "attic-notes" }, second);
        expect(read.json.reachability).toMatchObject({ source: "mirror", liveTried: { command: "ep0ch install --apply" } });
        expect(read.json.reachability.reason).toContain("ep0ch install --apply");
      } finally { second.stop(); outlines.close(); }
    } finally { server.close(); }
  }, 60_000);

  test("a try that outlasts its budget falls back at once, and its late success is found by the next call", async () => {
    let release!: (v: { socket: string }) => void;
    let answered = false;
    const slow = new LiveMachines({ forward: () => answered ? Promise.resolve({ socket: far.sock }) : new Promise(r => { release = v => { answered = true; r(v); }; }), now: () => clock, budgetMs: 100, backoffMs: 45_000 });
    const first = await slow.board(FAR, "attic-notes");
    expect("away" in first && first.away.why).toContain("no answer within 0.1s");
    release({ socket: far.sock });
    for (let i = 0; i < 100 && slow.route(FAR, "attic-notes").via !== "live"; i++) await Bun.sleep(20);
    expect(slow.route(FAR, "attic-notes").via).toBe("live");
    // The backoff is for failures only: a machine that has just answered is tried at once.
    const next = await slow.board(FAR, "attic-notes");
    expect("board" in next).toBe(true);
    slow.close();
  }, 30_000);

  test("an outline the laptop's host can't open does not take the others' live route with it", async () => {
    const two = new LiveMachines({ forward: async () => ({ socket: far.sock }), now: () => clock, budgetMs: 10_000 });
    const missing = await two.board(FAR, "no-such-outline");
    expect("away" in missing && missing.away.why).toContain("can't open no-such-outline");
    expect("board" in await two.board(FAR, "attic-notes")).toBe(true);
    expect(two.route(FAR, "attic-notes").via).toBe("live");
    expect(two.route(FAR, "no-such-outline").via).toBe("mirror");
    two.close();
    const after = await two.board(FAR, "attic-notes");
    expect("away" in after).toBe(true);
  }, 30_000);

  test("a live write is laid over the next read from the mirror, which says it is older than the write", async () => {
    laptopBack(); clock += 50_000;
    const read = (await tool("outline_read", { ref: ids.lamps, outline: "attic-notes" })).json;
    expect(read.reachability.source).toBe("live");
    const wrote = await tool("outline_patch", { ref: ids.lamps, outline: "attic-notes", revision: read.revision, patches: [{ observed: "Lamp list", replacement: "Lamp inventory" }] });
    expect(wrote.json.outcome).toBe("applied");
    laptopAway(); clock += 50_000;
    const fallback = (await tool("outline_read", { ref: ids.lamps, outline: "attic-notes" })).json;
    expect(fallback.reachability.source).toBe("mirror");
    // The mirror is the copy from before (follow() ran once, at the start): the write is shown over it, and said to be missing from it.
    expect(fallback.pending.spans).toContainEqual(expect.objectContaining({ observed: "Lamp list", replacement: "Lamp inventory", shown: true }));
    expect(fallback.staleSince.revision).toBeGreaterThan(fallback.record.revision);
    expect(fallback.staleSince.said).toContain("newer than this answer");
    const other = (await tool("outline_find", { query: "Lamp", outline: "attic-notes" })).json;
    expect(other).toMatchObject({ source: "mirror" });
    const row = (await tool("list_outlines", {})).json.outlines[0];
    expect(row.staleSince).toMatchObject({ said: expect.stringContaining("made live through this server") });
    // A pull takes nothing for it: it was never queued.
    expect(await pull()).toMatchObject({ ok: true });
    expect((await farRecord(ids.lamps!)).text).toContain("Lamp inventory");
    // The copy is the laptop's instance, whatever served it: the id its own host reports.
    const onFar = boardOn(far, "attic-notes", FAR);
    await onFar.info();
    expect(fallback.outlineInstanceId).toBe(onFar.outlineInstanceId);
    laptopBack();
  }, 120_000);

  test("one outline, one identity: the copy carries its source's instance id, and the machine's own name and the ssh name reach the same outline", async () => {
    // A stand-in for the laptop's forward whose host names itself (its ping's machine) differently from the ssh name.
    const proxy = join(dir, "named.sock");
    const server: Server = createServer(c => {
      const up = connect(far.sock);
      c.pipe(up);
      let buf = "";
      up.on("data", d => {
        buf += d.toString();
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          const msg = JSON.parse(line);
          if (msg.result?.location) Object.assign(msg.result.location, { hostname: "Evans-MacBook-Pro.local", machine: "Evans-MacBook-Pro.local" });
          c.write(JSON.stringify(msg) + "\n");
        }
      });
      const end = () => { c.destroy(); up.destroy(); };
      c.on("error", end); up.on("error", end); c.on("close", end); up.on("close", end);
    });
    await new Promise<void>(r => server.listen(proxy, r));
    let proxyDown = false;
    const named = new LiveMachines({ forward: async () => { if (proxyDown) throw new Error("no route to host"); return { socket: proxy }; }, now: () => clock, budgetMs: 10_000 });
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, () => {}, Date.now, async () => null);
    const outlines = machineOutlines(undefined, () => {}, async () => ({ error: "none" }), [mirror], async () => [], join(mirrors, ".netmail.sqlite"), named, undefined, { drainEveryMs: 0, writeWaitMs: 0 });
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    const gw = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: () => {} });
    const OWN = "Evans-MacBook-Pro.local";
    try {
      const ssh = `ep0ch://attic-notes@${FAR}/b/${ids.trunk}`, own = `ep0ch://attic-notes@${OWN}/b/${ids.trunk}`;
      // Before its host has answered, the ssh name is the only name; once it has, answers use the machine's own.
      const first = (await tool("outline_read", { uri: ssh }, gw)).json;
      expect(first.reachability.source).toBe("live");
      expect(first.uri).toBe(own);
      const viaOwn = (await tool("outline_read", { uri: own }, gw)).json;
      const viaSsh = (await tool("outline_read", { uri: ssh }, gw)).json;
      expect(viaOwn.uri).toBe(own);
      expect(viaSsh.record.id).toBe(viaOwn.record.id);
      const onFar = boardOn(far, "attic-notes", FAR);
      await onFar.info();
      expect(viaOwn.outlineInstanceId).toBe(onFar.outlineInstanceId);
      const listed = (await tool("list_outlines", {}, gw)).json.outlines[0];
      expect(listed).toMatchObject({ machine: OWN, sshName: FAR, uri: `ep0ch://attic-notes@${OWN}` });
      // Away: a write addressed by the machine's own name queues for the ssh name's pull, and either name reads it back.
      proxyDown = true; clock += 50_000;
      const queued = await tool("outline_create", { uri: own, text: "Queued under the machine's own name" }, gw);
      expect(queued.json).toMatchObject({ outcome: "queued", queuedFor: `attic-notes@${FAR}` });
      for (const uri of [own, ssh]) {
        const mirrorRead = (await tool("outline_read", { uri }, gw)).json;
        expect(mirrorRead).toMatchObject({ uri: own, reachability: { source: "mirror" }, outlineInstanceId: onFar.outlineInstanceId });
        expect(mirrorRead.pending.newBlocks).toContainEqual(expect.objectContaining({ text: "Queued under the machine's own name" }));
      }
      expect((await pull()).settled.map(s => s.state)).toEqual(["applied"]);
      expect((await childrenOf(ids.trunk!)).filter(t => t.startsWith("Queued under"))).toEqual(["Queued under the machine's own name"]);
    } finally { gw.stop(); outlines.close(); server.close(); rmSync(join(mirrors, ".home"), { recursive: true, force: true }); }
  }, 60_000);
});

describe("the hub's queue: a drain's claim, and withdrawing a write by hand", () => {
  const entry = (outline: string) => ({ machine: "laptop", outline, uri: `ep0ch://${outline}@laptop/b/b1`, blockId: "b1", tool: "outline_create" as const, input: { text: "Spare fuse" },
    revision: null, mirrorRevision: null, textHash: null, instanceId: null, level: "full" as const, actorId: "mcp:daddy/chat.example.test", subject: "user_fictional_a", clientId: null });

  test("an entry the gateway's drain has claimed is not taken by a pull, still counts as waiting, and goes back when its outcome is unknown", () => {
    const dir = scratchDir("ep0ch-netmail-claim-");
    const n = new Netmail(join(dir, ".netmail.sqlite"));
    try {
      const e = n.enqueue(entry("shed-notes"));
      expect(n.claim(e.id)).toBe(true);
      expect(n.claim(e.id)).toBe(false);
      expect(n.take("laptop")).toEqual([]);
      expect(n.summaries()[0]).toMatchObject({ waiting: 1 });
      expect(n.receipt(e.id)!.state).toBe("queued");
      n.release(e.id);
      expect(n.take("laptop").map(x => x.id)).toEqual([e.id]);
      // A drain a restart cut off: the gateway, starting, puts its claims back.
      expect(n.claim(e.id)).toBe(true);
      expect(n.releaseAll()).toBe(1);
      expect(n.take("laptop").map(x => x.id)).toEqual([e.id]);
    } finally { n.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("entries the laptop's own pull just took are left to it for a while; ones queued after it are drained", async () => {
    const dir = scratchDir("ep0ch-netmail-held-");
    const n = new Netmail(join(dir, ".netmail.sqlite"));
    try {
      const t0 = Date.parse("2026-03-14T09:00:00.000Z");
      n.enqueue(entry("shed-notes"), t0);
      n.take("laptop", t0 + 1000);
      // No board is needed: nothing of the pull's is applied, and nothing else waits.
      const r = await drainNetmail(n, {} as never, "laptop", "shed-notes", () => t0 + 5000);
      expect(r.settled).toEqual([]);
      expect(r.held).toContain("pull at 2026-03-14T09:00:01.000Z took 1");
      expect(n.take("laptop")).toHaveLength(1);
    } finally { n.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("ep0ch mcp queue drop withdraws waiting writes by id, says what each was, and leaves the rest", async () => {
    const dir = scratchDir("ep0ch-netmail-drop-");
    const env = { HOME: dir, EP0CH_MCP_MIRROR_DIR: dir };
    const n = new Netmail(join(dir, ".netmail.sqlite"));
    const [a, b, c] = [n.enqueue(entry("shed-notes")), n.enqueue(entry("shed-notes")), n.enqueue(entry("shed-notes"))];
    n.close();
    const out: string[] = [], err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    try {
      expect(await queueCommand(["status"], io, env)).toBe(0);
      expect(out.join("\n")).toContain(`${a.id}  outline_create ep0ch://shed-notes@laptop/b/b1  by mcp:daddy/chat.example.test`);
      out.length = 0;
      expect(await queueCommand(["drop", a.id, b.id, "--why", "redone by hand on the laptop"], io, env)).toBe(0);
      expect(out).toEqual([
        `dropped ${a.id}: outline_create on ep0ch://shed-notes@laptop/b/b1 by mcp:daddy/chat.example.test, queued ${a.queuedAt}`,
        `dropped ${b.id}: outline_create on ep0ch://shed-notes@laptop/b/b1 by mcp:daddy/chat.example.test, queued ${b.queuedAt}`,
      ]);
      out.length = 0;
      expect(await queueCommand(["drop", a.id, "no-such-id"], io, env)).toBe(1);
      expect(out[0]).toContain(`not dropped ${a.id}: outline_create on ep0ch://shed-notes@laptop/b/b1`);
      expect(out[0]).toContain("already refused (withdrawn by hand: redone by hand on the laptop)");
      expect(out[1]).toBe("not dropped no-such-id: no such entry");
      expect(await queueCommand(["drop"], io, env)).toBe(2);
      const after = new Netmail(join(dir, ".netmail.sqlite"));
      try {
        expect(after.take("laptop").map(x => x.id)).toEqual([c.id]);
        expect(after.receipt(a.id)).toMatchObject({ state: "refused", said: "withdrawn by hand: redone by hand on the laptop" });
      } finally { after.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
