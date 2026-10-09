// The remote MCP gateway's writes (PIE-615), end to end over real HTTP. Two scratch hosts: "here" (the gateway's
// machine, whose outlines it writes directly) and a far box standing in for the laptop, whose outline the gateway reads
// from a read-only mirror and whose writes queue (netmail) until the far box pulls them over ssh. The ssh is the fake one
// (packages/outliner/test/fake-ssh.ts), whose "other machine" runs this checkout's `ep0ch` against the gateway's queue.
// Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { OutlineMirror } from "../src/mcp-mirror";
import { Netmail, pullNetmail } from "../src/mcp-netmail";
import { incidents, type BackupState } from "../src/backup/alert";
import { readQueues } from "../src/backup/netmail";
import { actorLabel } from "@ep0ch/outline-core/attribution";
import { clientName, actorOf, levelFor, personaClaim, principalOf, STDIO_SUBJECT } from "../src/mcp-writes";
import { remoteWrite } from "../src/app";
import { canonicalLocalMachineName, type NotesBoard } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
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
  const token = async () => new SignJWT({ client_id: CLIENT, scope: "profile" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" }).setIssuer(ISSUER).setSubject(PERSON).setAudience(RESOURCE)
    .setIssuedAt().setExpirationTime("5m").sign(signing);
  const rpc = async (method: string, params?: unknown) => {
    const res = await fetch(gateway.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }) });
    return await res.json() as { result?: any; error?: { message: string } };
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc("tools/call", { name, arguments: args });
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
    await make(pond, "frogs", "Frog count\nTwelve at dusk by the reeds.");
    await make(quiet, "still", "Still water\nNothing stirs.");
    await make(attic, "trunk", "Trunk contents [room::attic]\nOld maps of the canal.");
    await make(attic, "lamps", "Lamp list\nTwo oil lamps, one cracked.");
    await make(attic, "map", "Map drawer\nCharts of the canal.");
    await make(attic, "keys", "Key hook\nThree brass keys.");

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
      FAKE_SSH_HOME: join(dir, "hub-home"), FAKE_SSH_OUTLINES: join(dir, "hub-outlines"), FAKE_SSH_BIN: join(dir, "bin"), FAKE_SSH_LOG: join(dir, "ssh.log"),
    });

    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, line => logs.push(line), Date.now, async () => null);
    const outlines = machineOutlines(undefined, line => logs.push(line), async name => ["garden-notes", "pond-notes", "quiet-notes"].includes(name) ? boardOn(here, name, HERE) : { error: "no such outline" },
      [mirror], async () => ["garden-notes", "pond-notes", "quiet-notes"], join(mirrors, ".netmail.sqlite"));
    closeOutlines = outlines.close;
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: line => logs.push(line) });
  }, 60_000);

  afterAll(async () => {
    gateway?.stop(); closeOutlines?.();
    for (const b of boards) b.close();
    await Bun.sleep(200);
    await here.dispose(); await far.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  test("tools/list offers the write tools, and list_outlines says what a write to each outline becomes", async () => {
    const names = ((await rpc("tools/list")).result.tools as { name: string }[]).map(t => t.name);
    expect(names).toEqual(["list_outlines", "outline_read", "outline_threads", "outline_find", "outline_query", "outline_links", "outline_components", "outline_create", "outline_patch", "outline_comment", "outline_reply", "outline_resolve_thread", "outline_set_property", "outline_assign_id", "outline_write_status"]);
    const listed = (await tool("list_outlines", {})).json.outlines as Record<string, unknown>[];
    expect(listed.map(o => [o.outline, o.access, o.writes ?? null])).toEqual([
      ["garden-notes", "full", "applied"], ["pond-notes", "propose", "proposals"], ["quiet-notes", "read", null], ["attic-notes", "full", "queued"],
    ]);
    expect(listed.at(-1)).toMatchObject({ source: "mirror", queue: { waiting: 0, lastPull: null } });
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

  test("full: a stale revision becomes a proposal, never an overwrite", async () => {
    const uri = formatEp0chBlockUri({ outline: "garden-notes", machine: HERE, blockId: ids.seeds! });
    const stale = await tool("outline_patch", { uri, revision: 1, patches: [{ observed: "allotment", replacement: "community garden" }] });
    expect(stale.json.outcome).toBe("proposed");
    expect(stale.json.said).toContain("proposed, not applied");
    expect((await textOf(here, "garden-notes", HERE, ids.seeds!)).text).toContain("allotment next door");
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

  test("propose: a patch and a property are proposals; a new block is a comment on its parent; read takes no writes", async () => {
    const uri = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
    const before = await textOf(here, "pond-notes", HERE, ids.frogs!);
    const p = await tool("outline_patch", { uri, revision: before.revision, patches: [{ observed: "Twelve", replacement: "Fourteen" }] });
    expect(p.json).toMatchObject({ outcome: "proposed", detail: { outcome: "proposed", reason: expect.stringContaining("propose") } });
    const s = await tool("outline_set_property", { uri, key: "species", value: "common-frog", revision: before.revision });
    expect(s.json.outcome).toBe("proposed");
    const c = await tool("outline_create", { uri, text: "Newt sighted" });
    expect(c.json).toMatchObject({ outcome: "proposed", said: expect.stringContaining("comment") });
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
    // A thread that isn't on the note is refused; a bad shape is too.
    expect((await tool("outline_reply", { uri: seeds, thread: "no-such-thread", body: "hello" })).text).toContain("No thread no-such-thread");
    expect((await tool("outline_resolve_thread", { uri: seeds, thread: id })).isError).toBe(true);
    // Propose access takes replies and resolves: they change only the thread. Read access takes neither.
    const frogs = formatEp0chBlockUri({ outline: "pond-notes", machine: HERE, blockId: ids.frogs! });
    const pc = await tool("outline_comment", { uri: frogs, whole: true, body: "Count again at dawn?" });
    expect((await tool("outline_reply", { uri: frogs, thread: pc.json.detail.thread, body: "Yes." })).json.outcome).toBe("applied");
    expect((await tool("outline_resolve_thread", { uri: frogs, thread: pc.json.detail.thread, resolved: true })).json.outcome).toBe("applied");
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
    await boardOn(far, "attic-notes", FAR).request("create", { parentId: ids.lamps, text: "A tin of lamp oil", author: "agent", provenance: { actorId: "mcp:chat.example.test" } });
    const state = join(dir, "far-state");
    writeFileSync(join(state, "netmail-applied.json"), JSON.stringify({ [q.id]: { id: q.id, state: "applying", at: "2026-03-14T09:00:00.000Z" } }));
    const retried = await pull();
    expect(retried.settled).toMatchObject([{ state: "applied", said: expect.stringContaining("found made by a pull cut off before") }]);
    const kids = await boardOn(far, "attic-notes", FAR).request<{ text: string }[]>("children", { parentId: ids.lamps });
    expect(kids.filter(k => k.text === "A tin of lamp oil")).toHaveLength(1);

    // The far box's host doesn't answer: nothing is settled, the write waits.
    expect((await tool("outline_comment", { uri: lamps, whole: true, body: "Trim the wicks" })).json.outcome).toBe("queued");
    const gone = await pullNetmail({ hub: "hub-box", machine: FAR, state, env, open: async outline => Object.assign(new SocketBoard(join(dir, "no-such.sock"), 2000, outline), { address: { outline, machine: FAR } }) });
    expect(gone).toMatchObject({ ok: true, settled: [], detail: expect.stringContaining("none applied here yet") });
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
});

describe("personas: who a connection writes as", () => {
  const caller = { sub: "user_fictional_a", clientId: "https://chat.example.test/oauth/client-metadata" };
  test("a client or subject maps to a name; none keeps the client's; a bad name is ignored; the file works too", () => {
    expect(actorOf(caller, {}).actorId).toBe("mcp:chat.example.test");
    expect(actorOf(caller, { EP0CH_MCP_PERSONAS: "chat.example.test=daddy" })).toEqual({ actorId: "mcp:daddy/chat.example.test", sessionId: "user_fictional_a" });
    expect(actorOf(caller, { EP0CH_MCP_PERSONAS: "chat.example.test=daddy, user_fictional_a=sysop" }).actorId).toBe("mcp:sysop/chat.example.test");
    expect(actorOf(caller, { EP0CH_MCP_PERSONAS: "chat.example.test=not a name!" }).actorId).toBe("mcp:chat.example.test");
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

  test("a persona can't cross principals: a claim another principal holds is refused, and a gateway can't claim one at all", () => {
    const env = { EP0CH_MCP_PERSONAS: "claude-code@float-2=loki", EP0CH_AGENT: "loki" };
    const claimed = personaClaim(stdio("claude-code"), env, "laptop");
    expect(claimed.persona).toBeUndefined();
    expect(claimed.refused).toContain("loki belongs to claude-code@float-2");
    expect(actorOf(stdio("claude-code"), env, "laptop").actorId).toBe("mcp:claude-code@laptop");
    // On its own principal the same claim is the persona; one nobody holds is a label for whoever declared it.
    expect(actorOf(stdio("claude-code"), env, "float-2").actorId).toBe("mcp:loki/claude-code@float-2");
    expect(actorOf(stdio("claude-code"), { EP0CH_AGENT: "scout" }, "laptop").actorId).toBe("mcp:scout/claude-code@laptop");
    // The gateway reads no environment claim: only its own principal's entry.
    expect(actorOf(gateway, { EP0CH_AGENT: "loki" }, "float-2").actorId).toBe("mcp:chat.example.test");
  });

  test("the principal that made an outline writes with full whatever the setting; a person's none holds for all", () => {
    const status = { level: "read" as const, owner: "claude-code@float-2" };
    expect(levelFor(status, stdio("claude-code"), "float-2")).toBe("full");
    expect(levelFor(status, stdio("claude-code"), "laptop")).toBe("read");
    expect(levelFor(status, gateway, "float-2")).toBe("read");
    expect(levelFor({ ...status, level: "none" }, stdio("claude-code"), "float-2")).toBe("none");
    expect(levelFor({ level: "read" }, stdio("claude-code"), "float-2")).toBe("read");
  });
});
