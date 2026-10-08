// Write receipts, read-your-writes and outline_query on the remote MCP gateway (PIE-648), end to end over real HTTP, on
// the same footing as mcp-writes.test.ts: a "here" scratch host the gateway writes directly, and a far box standing in
// for the laptop, whose outline the gateway serves from a mirror, queues writes for, and which pulls them over the fake
// ssh. Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { OutlineMirror } from "../src/mcp-mirror";
import { pullNetmail, type NetmailReceipt } from "../src/mcp-netmail";
import { pendingOverlay, receiptStatus } from "../src/mcp-receipts";
import { canonicalLocalMachineName, type NotesBoard } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const PERSON = "user_fictional_a";
const OTHER = "user_fictional_b";
const CLIENT = "https://chat.example.test/oauth/client-metadata";
const FAR = "far-box";
const DOOR = resolve(import.meta.dir, "..");
const HERE = canonicalLocalMachineName();

describe.skipIf(!outliner)("write receipts, read-your-writes and outline_query on the gateway", () => {
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
  // The mirror looks for a newer copy every 15 seconds of its clock; a follow moves the clock past that.
  let clock = Date.now();
  const follow = (name: string) => {
    clock += 16_000;
    const target = join(mirrors, FAR, `${name}.sqlite`);
    rmSync(target, { force: true });
    const source = new Database(join(far.outlines, `${name}.sqlite`), { readonly: true });
    try { source.run("VACUUM INTO ?", [target]); } finally { source.close(); }
  };
  const token = async (sub: string) => new SignJWT({ client_id: CLIENT, scope: "profile" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" }).setIssuer(ISSUER).setSubject(sub).setAudience(RESOURCE)
    .setIssuedAt().setExpirationTime("5m").sign(signing);
  const callAs = async (sub: string, name: string, args: Record<string, unknown>) => {
    const res = await fetch(gateway.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(sub)}` }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }) });
    const r = await res.json() as { result?: any; error?: { message: string } };
    if (r.error) return { isError: true, text: r.error.message, json: null as any };
    const text = (r.result as { content: { text: string }[] }).content[0]!.text;
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* an error's words */ }
    return { isError: !!r.result.isError, text, json };
  };
  const tool = (name: string, args: Record<string, unknown>) => callAs(PERSON, name, args);
  const textOf = async (host: ScratchHost, outline: string, machine: string, id: string) => (await boardOn(host, outline, machine).records([id])).records[0]!;
  const pull = () => pullNetmail({ hub: "hub-box", machine: FAR, state: join(dir, "far-state"), env, open: async outline => boardOn(far, outline, FAR) });
  const uriOf = (key: string) => formatEp0chBlockUri({ outline: "attic-notes", machine: FAR, blockId: ids[key]! });

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signing = pair.privateKey as CryptoKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] });

    await here.start(); await far.start();
    await here.create("garden-notes"); await here.create("quiet-notes"); await far.create("attic-notes");
    const garden = boardOn(here, "garden-notes", HERE), quiet = boardOn(here, "quiet-notes", HERE), attic = boardOn(far, "attic-notes", FAR);
    await garden.configureMcpAccess("full"); await quiet.configureMcpAccess("read"); await attic.configureMcpAccess("full");
    const make = async (b: SocketBoard, key: string, text: string) => { ids[key] = (await b.request<{ id: string }>("create", { parentId: null, text, author: "user" })).id; };
    await make(garden, "a", "Compost turning [type::chore] [area::garden] [stage::todo]\nFork it over on Sunday.");
    await make(garden, "b", "Water the beans [type::chore] [area::garden] [stage::done]");
    await make(garden, "c", "Mend the shed door [type::chore] [area::shed] [stage::todo]");
    await make(garden, "d", "Sharpen the spade [type::chore] [area::shed] [stage::todo]");
    await make(garden, "view", "Garden todo [type::virtual-branch] [query::type=chore area=garden]");
    await make(quiet, "still", "Still water [type::chore]\nNothing stirs.");
    await make(attic, "trunk", "Trunk contents [room::attic]\nOld maps of the canal. A brass key. Three candles.");
    await make(attic, "lamps", "Lamp list\nTwo oil lamps, one cracked.");
    await make(attic, "boxes", "Boxes [type::chore] [area::attic] [stage::todo]");

    dir = scratchDir("ep0ch-mcpr-");
    mirrors = join(dir, "mirrors");
    mkdirSync(join(mirrors, FAR), { recursive: true });
    follow("attic-notes");
    mkdirSync(join(dir, "bin")); mkdirSync(join(dir, "hub-home")); mkdirSync(join(dir, "hub-outlines"));
    writeFileSync(join(dir, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
    writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nEP0CH_MCP_MIRROR_DIR=${mirrors} exec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    chmodSync(join(dir, "bin", "ssh"), 0o755); chmodSync(join(dir, "bin", "ep0ch"), 0o755);
    Object.assign(env, {
      PATH: process.env.PATH!, HOME: join(dir, "far-home"), EP0CH_SSH: join(dir, "bin", "ssh"),
      FAKE_SSH_HOME: join(dir, "hub-home"), FAKE_SSH_OUTLINES: join(dir, "hub-outlines"), FAKE_SSH_BIN: join(dir, "bin"), FAKE_SSH_LOG: join(dir, "ssh.log"),
    });

    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: `${PERSON},${OTHER}` });
    if ("error" in config) throw new Error(config.error);
    const mirror = new OutlineMirror("attic-notes", FAR, mirrors, line => logs.push(line), () => clock, async () => null);
    const outlines = machineOutlines(undefined, line => logs.push(line), async name => ["garden-notes", "quiet-notes"].includes(name) ? boardOn(here, name, HERE) : { error: "no such outline" },
      [mirror], async () => ["garden-notes", "quiet-notes"], join(mirrors, ".netmail.sqlite"));
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

  test("queued, pulled: status follows the write from queued to applied (with the revision) and, when the note changed, to proposed (with the proposal's URI)", async () => {
    const trunk = await tool("outline_read", { uri: uriOf("trunk") });
    const lamps = await tool("outline_read", { uri: uriOf("lamps") });
    const q1 = await tool("outline_patch", { uri: uriOf("trunk"), revision: trunk.json.revision, patches: [{ observed: "Old maps", replacement: "Old survey maps" }] });
    const q2 = await tool("outline_patch", { uri: uriOf("lamps"), revision: lamps.json.revision, patches: [{ observed: "one cracked", replacement: "both mended" }] });
    expect(q1.json).toMatchObject({ outcome: "queued", queueId: q1.json.id });

    const waiting = await tool("outline_write_status", { queueId: q1.json.queueId });
    expect(waiting.json).toMatchObject({ state: "queued", lastPull: null, waiting: 2, queueId: q1.json.queueId });

    // The far box's lamp list changes before it pulls: that patch will meet a newer revision.
    const now = await textOf(far, "attic-notes", FAR, ids.lamps!);
    await boardOn(far, "attic-notes", FAR).request("update", { blockId: ids.lamps, text: "Lamp list\nTwo oil lamps, one cracked, one new.", expectedRevision: now.revision, mutation: { author: "user" } });
    expect((await pull()).ok).toBe(true);

    const applied = (await tool("outline_write_status", { queueId: q1.json.queueId })).json;
    const trunkNow = await textOf(far, "attic-notes", FAR, ids.trunk!);
    expect(applied).toMatchObject({ state: "applied", uri: uriOf("trunk"), revision: trunkNow.revision });
    const proposed = (await tool("outline_write_status", { queueId: q2.json.queueId })).json;
    expect(proposed.state).toBe("proposed");
    expect(proposed.proposal).toMatch(/^ep0ch:\/\/attic-notes@far-box\//);
    expect((await textOf(far, "attic-notes", FAR, proposed.proposal.split("/").at(-1)!)).properties).toContainEqual({ key: "proposal-status", values: ["open"] });

    // The mirror catches up with the proposal open: still proposed. Its owner dismisses it: the next copy says rejected.
    follow("attic-notes");
    expect((await tool("outline_write_status", { queueId: q2.json.queueId })).json.state).toBe("proposed");
    const proposalId = proposed.proposal.split("/").at(-1)!;
    const proposalBlock = await textOf(far, "attic-notes", FAR, proposalId);
    await boardOn(far, "attic-notes", FAR).request("draft.proposal.dismiss", { proposalId, mutation: { author: "user" } }).catch(async () => {
      // Without a holding door the dismissal is the status chip: the same property the door's action sets.
      await boardOn(far, "attic-notes", FAR).request("update", { blockId: proposalId, text: proposalBlock.text.replace("[proposal-status::open]", "[proposal-status::dismissed]"), expectedRevision: proposalBlock.revision, mutation: { author: "user" } });
    });
    follow("attic-notes");
    expect((await tool("outline_write_status", { queueId: q2.json.queueId })).json).toMatchObject({ state: "rejected", reason: "its owner dismissed the proposal", proposal: proposed.proposal });
  }, 90_000);

  test("a proposed write that its caller then writes again is superseded", async () => {
    const boxes = await tool("outline_read", { uri: uriOf("trunk") });
    // Make the next patch conflict: the note moves on the far box, then two queued patches follow.
    const trunkNow = await textOf(far, "attic-notes", FAR, ids.trunk!);
    const a = await tool("outline_patch", { uri: uriOf("trunk"), revision: boxes.json.revision, patches: [{ observed: "A brass key", replacement: "A brass key, tarnished" }] });
    await boardOn(far, "attic-notes", FAR).request("update", { blockId: ids.trunk, text: `${trunkNow.text}\nAdded on the far box.`, expectedRevision: trunkNow.revision, mutation: { author: "user" } });
    expect((await pull()).ok).toBe(true);
    follow("attic-notes");
    expect((await tool("outline_write_status", { queueId: a.json.queueId })).json.state).toBe("proposed");
    const fresh = await tool("outline_read", { uri: uriOf("trunk") });
    const b = await tool("outline_patch", { uri: uriOf("trunk"), revision: fresh.json.revision, patches: [{ observed: "A brass key", replacement: "A brass key, polished" }] });
    expect((await tool("outline_write_status", { queueId: a.json.queueId })).json).toMatchObject({ state: "superseded", supersededBy: b.json.queueId });
    expect((await pull()).ok).toBe(true);
  }, 90_000);

  test("a write the far box refuses is rejected, with why; another caller's queueId, or none, is not found", async () => {
    const gone = await tool("outline_comment", { uri: uriOf("lamps"), body: "Which lamp?", whole: true });
    await boardOn(far, "attic-notes", FAR).configureMcpAccess("read");
    expect((await pull()).ok).toBe(true);
    await boardOn(far, "attic-notes", FAR).configureMcpAccess("full");
    const r = (await tool("outline_write_status", { queueId: gone.json.queueId })).json;
    expect(r).toMatchObject({ state: "rejected", reason: expect.stringContaining("is read here now") });
    const theirs = await callAs(OTHER, "outline_write_status", { queueId: gone.json.queueId });
    expect(theirs.isError).toBe(true);
    expect(theirs.text).toContain("No queued write");
    expect((await tool("outline_write_status", { queueId: "nope" })).isError).toBe(true);
  }, 60_000);

  test("read your writes: the writer's read lays its queued edits over the mirror, marked pending per span; nobody else sees them", async () => {
    follow("attic-notes");
    const read = await tool("outline_read", { uri: uriOf("trunk") });
    const q = await tool("outline_patch", { uri: uriOf("trunk"), revision: read.json.revision, patches: [{ observed: "Three candles", replacement: "Four candles" }] });
    const prop = await tool("outline_set_property", { uri: uriOf("trunk"), revision: read.json.revision, key: "room", value: "cellar" });
    const mine = (await tool("outline_read", { uri: uriOf("trunk") })).json;
    // The mirror's own text is untouched; the overlay is beside it.
    expect(mine.record.body).toContain("Three candles");
    expect(mine.pending.entries.map((e: { queueId: string }) => e.queueId)).toEqual([q.json.queueId, prop.json.queueId]);
    expect(mine.pending.body).toContain(`⟦pending ${q.json.queueId.slice(0, 8)}⟧Four candles⟦/pending⟧`);
    expect(mine.pending.body).not.toContain("Three candles");
    expect(mine.pending.spans).toEqual([{ queueId: q.json.queueId, observed: "Three candles", replacement: "Four candles", shown: true }]);
    expect(mine.pending.properties).toEqual([{ queueId: prop.json.queueId, key: "room", value: "cellar" }]);

    const theirs = (await callAs(OTHER, "outline_read", { uri: uriOf("trunk") })).json;
    expect(theirs.pending).toBeUndefined();
    expect(theirs.record.body).toContain("Three candles");
    // Once the far box pulls it and the mirror follows, the overlay is gone: the mirror has it.
    const pulled = await pull();
    expect(pulled.settled.map(s => s.state)).toEqual(["applied", "proposed"]);
    follow("attic-notes");
    const after = (await tool("outline_read", { uri: uriOf("trunk") })).json;
    expect(after.pending).toBeUndefined();
    expect(after.record.body).toContain("Four candles");
  }, 90_000);

  test("outline_query: the views' grammar over a live outline answers what the service answers, paged with limit, more and total", async () => {
    const garden = boardOn(here, "garden-notes", HERE);
    const expected = (await garden.queryIds({ expression: "type=chore NOT stage=done" })).ids;
    expect(expected).toHaveLength(3);
    const all = (await tool("outline_query", { outline: "garden-notes", query: "type=chore NOT stage=done" })).json;
    expect(all).toMatchObject({ outline: "garden-notes", source: "live", total: 3, more: false, completeness: { kind: "complete", total: 3 } });
    expect(all.matches.map((m: { record: { id: string } }) => m.record.id)).toEqual(expected);
    expect(all.matches[0]).toMatchObject({ uri: expect.stringMatching(/^ep0ch:\/\/garden-notes@/), revision: expect.any(Number), record: { title: expect.any(String), properties: expect.any(Array) } });
    expect(all.matches[0].record.text).toBeUndefined();

    const first = (await tool("outline_query", { outline: "garden-notes", query: "type=chore NOT stage=done", limit: 2 })).json;
    expect(first).toMatchObject({ total: 3, more: true, nextOffset: 2, completeness: { kind: "truncated", more: true } });
    const rest = (await tool("outline_query", { outline: "garden-notes", query: "type=chore NOT stage=done", limit: 2, offset: first.nextOffset })).json;
    expect(rest).toMatchObject({ more: false });
    expect([...first.matches, ...rest.matches].map((m: { record: { id: string } }) => m.record.id)).toEqual(expected);
  });

  test("outline_query by saved view returns the members the door's view shows", async () => {
    const garden = boardOn(here, "garden-notes", HERE);
    const shown = (await garden.readSavedView(ids.view!)).blocks.map(b => b.id);
    expect(shown).toHaveLength(2);
    const r = (await tool("outline_query", { outline: "garden-notes", view: `((${ids.view}))` })).json;
    expect(r.matches.map((m: { record: { id: string } }) => m.record.id)).toEqual(shown);
    expect(r.view).toBe(`((${ids.view}))`);
  });

  test("outline_query on a laptop's mirror reads the copy and says so; it is gated by access, and refuses a bad ask", async () => {
    const asked = await tool("outline_query", { outline: `attic-notes@${FAR}`, query: "type=chore" });
    const r = asked.json;
    expect(r).toMatchObject({ source: "mirror", total: 1 });
    expect(r.matches[0].record.title).toContain("Boxes");
    const none = await tool("outline_query", { outline: "quiet-notes", query: "type=chore" });
    expect(none.isError).toBe(false);
    await boardOn(here, "quiet-notes", HERE).configureMcpAccess("none");
    const denied = await tool("outline_query", { outline: "quiet-notes", query: "type=chore" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("MCP access is none");
    await boardOn(here, "quiet-notes", HERE).configureMcpAccess("read");
    expect((await tool("outline_query", { outline: "garden-notes" })).text).toContain("query");
    expect((await tool("outline_query", { outline: "garden-notes", query: "type=chore", view: ids.view })).isError).toBe(true);
    expect((await tool("outline_query", { outline: "garden-notes", query: "type=chore", limit: 51 })).text).toContain("1 to 50");
    expect((await tool("outline_query", { outline: "garden-notes", query: "type=chore AND (" })).isError).toBe(true);
  });
});

describe("the overlay of a caller's waiting writes", () => {
  const entry = (id: string, tool: NetmailReceipt["tool"], input: Record<string, unknown>): NetmailReceipt => ({
    id, machine: FAR, outline: "attic-notes", uri: "ep0ch://attic-notes@far-box/b/x", blockId: "x", tool, input, revision: 1, mirrorRevision: 1, textHash: null, instanceId: null,
    level: "full", actorId: "mcp:chat.example.test", subject: PERSON, clientId: null, queuedAt: "2026-10-08T08:00:00.000Z",
    state: "queued", settledAt: null, said: null, resultUri: null, resultRevision: null, proposalUri: null,
  });

  test("patches are laid over the body in the order queued, each replacement fenced; a span that no longer matches is said not to be shown", () => {
    const o = pendingOverlay("Maps of the canal. A brass key. Three candles.", [
      entry("aaaaaaaa-1", "outline_patch", { patches: [{ observed: "brass key", replacement: "brass key, tarnished" }, { observed: "no such text", replacement: "x" }] }),
      entry("bbbbbbbb-2", "outline_patch", { patches: [{ observed: "tarnished", replacement: "polished" }, { observed: "Three candles", replacement: "" }] }),
    ])!;
    expect(o.body).toBe("Maps of the canal. A ⟦pending aaaaaaaa⟧brass key, ⟦pending bbbbbbbb⟧polished⟦/pending⟧⟦/pending⟧. ⟦pending bbbbbbbb: removes “Three candles”⟧.");
    expect(o.spans.map(s => s.shown)).toEqual([true, false, true, true]);
  });

  test("nothing waiting is no overlay; a property, a new block and a comment are listed, not laid over the text", () => {
    expect(pendingOverlay("text", [])).toBeNull();
    const o = pendingOverlay("text", [entry("c1", "outline_set_property", { key: "stage", value: "done" }), entry("c2", "outline_create", { text: "new", position: 0 }), entry("c3", "outline_comment", { body: "hm", quote: "text" })])!;
    expect(o.body).toBeUndefined();
    expect(o).toMatchObject({ properties: [{ key: "stage", value: "done" }], newBlocks: [{ text: "new", position: 0 }], comments: [{ body: "hm", quote: "text" }] });
  });

  test("a receipt says each state in words, and a refused write carries why", () => {
    const base = entry("d1", "outline_patch", {});
    expect(receiptStatus({ ...base, state: "refused", said: "MCP access is none here" }, { summary: null, later: [] })).toMatchObject({ state: "rejected", reason: "MCP access is none here" });
    expect(receiptStatus({ ...base, state: "applied", resultRevision: 7, said: "patch applied" }, { summary: null, later: [] })).toMatchObject({ state: "applied", revision: 7 });
    expect(receiptStatus(base, { summary: { machine: FAR, waiting: 3, oldest: null, lastPull: "2026-10-08T07:00:00.000Z", byOutline: {} }, later: [] })).toMatchObject({ state: "queued", waiting: 3, lastPull: "2026-10-08T07:00:00.000Z" });
  });
});
