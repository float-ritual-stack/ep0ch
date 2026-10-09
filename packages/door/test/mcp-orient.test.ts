// PIE-674: orienting from an outline over MCP. outline_query sorts (in the service), projects fields (never a body),
// scopes to a subtree and folds derived blocks into their notes; a body is sent once per response, a proposal or a
// comment points at its note, and `seen` turns a block the caller holds into a stub. Every test runs over both
// transports (stdio and streamable HTTP) against one scratch host with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { gatewayConfig, machineOutlines, startGateway, type Gateway } from "../src/mcp-gateway";
import { mcpCommand } from "../src/mcp";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const ISSUER = "https://fake-clerk.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const PERSON = "user_fictional_a";

interface Result { isError: boolean; text: string; json: any }
type Call = { name: string; args: Record<string, unknown> };
type Transport = { name: string; batch(calls: Call[]): Promise<Result[]> };
const parse = (r: { isError?: boolean; content: { text: string }[] }): Result => {
  const text = r.content[0]!.text;
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* an error's words */ }
  return { isError: !!r.isError, text, json };
};

describe.skipIf(!outliner)("orient: sort, project, fold and never re-send, over stdio and HTTP", () => {
  const scratch = new Scratch();
  const oldEnv: Record<string, string | undefined> = {};
  let board: SocketBoard, gateway: Gateway, closeOutlines: () => void, signing: CryptoKey, rpcId = 1;
  const notes: Record<string, { id: string; revision: number }> = {};
  const derived: { comments: string[]; reply: string; proposal: string; delivery: string } = { comments: [], reply: "", proposal: "", delivery: "" };
  const LONG = "UNIQUE-TARGET-SENTENCE the lamp room keeps its brass fittings dry with a waxed cloth every second Sunday of the month.";

  const stdio: Transport = {
    name: "stdio",
    async batch(calls) {
      const reqs = calls.map(c => ({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name: c.name, arguments: { outline: scratch.name, ...c.args } } }));
      const out: string[] = [];
      await mcpCommand(["mcp"], { input: (async function* () { yield JSON.stringify(reqs.length === 1 ? reqs[0] : reqs); })(), write: l => out.push(l), err: l => out.push(`ERR ${l}`) });
      const reply = JSON.parse(out[0]!);
      return ([] as any[]).concat(reply).map(r => parse(r.result));
    },
  };
  const http: Transport = {
    name: "http",
    async batch(calls) {
      const jwt = await new SignJWT({ client_id: "client_fictional", scope: "profile" }).setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
        .setIssuer(ISSUER).setSubject(PERSON).setAudience(RESOURCE).setIssuedAt().setExpirationTime("5m").sign(signing);
      const reqs = calls.map(c => ({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name: c.name, arguments: { outline: scratch.name, ...c.args } } }));
      const res = await fetch(gateway.url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${jwt}` }, body: JSON.stringify(reqs.length === 1 ? reqs[0] : reqs) });
      return ([] as any[]).concat(await res.json()).map(r => parse(r.result));
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
    // propose: reads, and a patch is always a proposal (the derived block this test needs).
    await board.configureMcpAccess("propose");
    const make = async (key: string, text: string, parentId: string | null = null) => {
      const b = await board.request<{ id: string; revision: number }>("create", { parentId, text, author: "agent" });
      notes[key] = { id: b.id, revision: b.revision };
      await Bun.sleep(8);
      return b;
    };
    await make("oldest", "Oldest note [rank::3]\nFirst thing written.");
    await make("middle", "Middle note [rank::1]\nSecond thing written.");
    await make("garden", "Garden room [rank::2]\nThe room for the plants.");
    await make("lamp", "PIE-9001 Lamp room upkeep [type::upkeep-note]\n" + LONG + "\nA second paragraph that stays put.");
    await make("fresh", "Freshest note [rank::4]\nLast thing written.");
    await make("child-a", "Seed tray A\nSprouting.", notes.garden!.id);
    await make("child-b", "Seed tray B\nNot yet.", notes.garden!.id);
    // Derived blocks of the lamp note: two comments, a delivery, and (below) a proposal.
    for (const [i, q] of ["brass fittings", "waxed cloth"].entries()) {
      const at = (await board.request<{ text: string }>("get", { blockId: notes.lamp!.id })).text.indexOf(q);
      derived.comments.push((await board.comment(`seed-${i}`, notes.lamp!.id, notes.lamp!.revision, `Is "${q}" still right?`, { quote: q, start: at })).id);
    }
    derived.reply = (await board.reply("seed-reply", derived.comments[1]!, "Yes, checked on Sunday.")).id;
    derived.delivery = (await make("delivery", "Delivery PIE-9001/primary [type::delivery] [delivery-key::PIE-9001/primary]\nBranch lamp-upkeep.", notes.lamp!.id)).id;
    const outlines = machineOutlines(undefined, () => {});
    closeOutlines = outlines.close;
    const config = gatewayConfig({ EP0CH_MCP_RESOURCE: RESOURCE, EP0CH_MCP_ISSUER: ISSUER, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON });
    if ("error" in config) throw new Error(config.error);
    gateway = startGateway({ config, outlines, port: 0, bind: "127.0.0.1", keys, log: () => {} });
    const proposed = (await http.batch([{ name: "outline_patch", args: { ref: notes.lamp!.id, revision: notes.lamp!.revision, patches: [{ observed: "waxed cloth", replacement: "microfibre cloth" }] } }]))[0]!;
    expect(proposed.text).toContain("proposed");
    derived.proposal = proposed.json.detail.proposalId;
  }, 40_000);

  afterAll(async () => {
    gateway?.stop(); closeOutlines?.();
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  const ORIENT = { query: "updated >= -1d", sort: "updated desc", fields: "id,title,updated,actor,path", fold: true };

  describe.each([stdio, http])("over $name", t => {
    const call = async (name: string, args: Record<string, unknown>) => (await t.batch([{ name, args }]))[0]!;
    const ids = (r: Result) => r.json.matches.map((m: any) => m.id) as string[];

    test("sort is the service's: updated desc and asc are each other's reverse, a property key sorts, limit keeps the newest", async () => {
      const desc = await call("outline_query", { query: "rank", sort: "updated desc", fields: "updated", limit: 50 });
      const times = desc.json.matches.map((m: any) => m.updated as string);
      expect(times.length).toBe(4);
      expect(times).toEqual([...times].sort().reverse());
      expect(desc.json.sort).toBe("updated desc");
      const asc = await call("outline_query", { query: "rank", sort: "updated asc", fields: "updated", limit: 50 });
      expect(asc.json.matches.map((m: any) => m.updated)).toEqual([...times].reverse());
      const newest = await call("outline_query", { query: "rank", sort: "-updated", fields: "title", limit: 1 });
      expect(newest.json.matches).toHaveLength(1);
      expect(newest.json.more).toBe(true);
      expect(newest.json.matches[0].id).toBe(ids(desc)[0]);
      expect(newest.json.nextOffset).toBe(1);
      const ranked = await call("outline_query", { query: "rank", sort: "rank asc", fields: "title,rank" });
      expect(ranked.json.matches.map((m: any) => m.rank)).toEqual(["1", "2", "3", "4"]);
    });

    test("fields project a row and never carry a body; property keys are columns", async () => {
      const r = await call("outline_query", { query: "type=upkeep-note", fields: ["id", "title", "updated", "actor", "path", "type"] });
      expect(r.json.matches).toHaveLength(1);
      const row = r.json.matches[0];
      expect(Object.keys(row).sort()).toEqual(["actor", "id", "path", "revision", "title", "type", "updated"].filter(k => k !== "actor" || "actor" in row).sort());
      expect(row).toMatchObject({ id: notes.lamp!.id, title: expect.stringContaining("PIE-9001"), type: "upkeep-note", path: "(root)", revision: expect.any(Number) });
      expect(r.text).not.toContain("UNIQUE-TARGET-SENTENCE");
      expect(r.text).not.toContain('"record"');
      const refused = await call("outline_query", { query: "rank", fields: "id,body" });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("outline_read");
      expect((await call("outline_query", { query: "rank", fields: "id,bad key!" })).isError).toBe(true);
    });

    test("under limits a query to a subtree, by id, ((id)) or page; subtreeRootId is the same argument", async () => {
      const kids = new Set([notes["child-a"]!.id, notes["child-b"]!.id]);
      for (const args of [{ under: notes.garden!.id }, { under: `((${notes.garden!.id}))` }, { subtreeRootId: notes.garden!.id }]) {
        const r = await call("outline_query", { query: "updated >= -1d", fields: "title", ...args });
        expect(r.isError).toBe(false);
        expect(r.json.under).toBe(notes.garden!.id);
        expect(ids(r)).toEqual(expect.arrayContaining([...kids]));
        expect(ids(r).every((id: string) => kids.has(id) || id === notes.garden!.id)).toBe(true);
        expect(ids(r)).not.toContain(notes.oldest!.id);
      }
      const gone = await call("outline_query", { query: "rank", under: "PIE-999999" });
      expect(gone.isError).toBe(true);
      expect(gone.text).toContain("under:");
    });

    test("fold collapses a note's proposal, comments and delivery into it, with a count", async () => {
      const flat = await call("outline_query", { query: "updated >= -1d", fields: "title", limit: 50 });
      for (const d of [...derived.comments, derived.reply, derived.proposal, derived.delivery]) expect(ids(flat)).toContain(d);
      const folded = await call("outline_query", { ...ORIENT, limit: 50 });
      for (const d of [...derived.comments, derived.reply, derived.proposal, derived.delivery]) expect(ids(folded)).not.toContain(d);
      const row = folded.json.matches.find((m: any) => m.id === notes.lamp!.id);
      expect(row.changes).toMatchObject({ count: 5, proposals: 1, comments: 3, deliveries: 1, summary: "5 changes (1 proposal, 3 comments, 1 delivery)" });
      expect(row.changes.ids.sort()).toEqual([...derived.comments, derived.reply, derived.proposal, derived.delivery].sort());
      expect(folded.json.total).toBe(flat.json.total - 5);
      expect(folded.json.foldedFrom).toBe(flat.json.total);
      // A folded note is a row once, wherever its derived blocks were.
      expect(new Set(ids(folded)).size).toBe(ids(folded).length);
    });

    test("a body goes once per response: a later hit is {id, revision, see}", async () => {
      const [a, b, q] = await t.batch([
        { name: "outline_read", args: { ref: notes.lamp!.id } },
        { name: "outline_read", args: { ref: notes.lamp!.id } },
        { name: "outline_query", args: { query: "type=upkeep-note" } },
      ]);
      expect(a!.json.record.body).toContain("UNIQUE-TARGET-SENTENCE");
      expect(b!.json).toMatchObject({ id: notes.lamp!.id, revision: expect.any(Number), see: expect.stringMatching(/:record$/) });
      expect(b!.text).not.toContain("UNIQUE-TARGET-SENTENCE");
      expect(q!.json.matches[0]).toMatchObject({ id: notes.lamp!.id, see: b!.json.see });
      expect(q!.text).not.toContain("UNIQUE-TARGET-SENTENCE");
      // The next response starts clean.
      expect((await call("outline_read", { ref: notes.lamp!.id })).json.record.body).toContain("UNIQUE-TARGET-SENTENCE");
    });

    test("a proposal points at its note: its diff and the target's id@revision, not the note again", async () => {
      const lamp = (await call("outline_read", { ref: notes.lamp!.id })).json;
      const r = await call("outline_read", { ref: derived.proposal });
      expect(r.json.record).toMatchObject({ kind: "proposal", id: derived.proposal, status: "open", changes: 1,
        diff: [{ target: `${notes.lamp!.id}@${notes.lamp!.revision}`, observed: "waxed cloth", replacement: "microfibre cloth" }] });
      // The diff names the revision it was proposed against; `now` says the note has moved on (the comments bumped it).
      expect(lamp.revision).toBeGreaterThan(notes.lamp!.revision);
      expect(r.json.record.now).toEqual([`${notes.lamp!.id}@${lamp.revision}`]);
      expect(r.text).not.toContain("UNIQUE-TARGET-SENTENCE");
      expect(r.text).not.toContain("draft-patch");
      const full = await call("outline_read", { ref: derived.proposal, raw: true });
      expect(full.text).toContain("draft-patch");
      const inQuery = await call("outline_query", { query: "type=draft-proposal" });
      expect(inQuery.json.matches[0].record.kind).toBe("proposal");
      expect(inQuery.text).not.toContain("UNIQUE-TARGET-SENTENCE");
    });

    test("a comment points at its note: its words and the span it is about, not a quoted copy", async () => {
      const lamp = (await call("outline_read", { ref: notes.lamp!.id })).json;
      const text = (await board.request<{ text: string }>("get", { blockId: notes.lamp!.id })).text;
      const r = await call("outline_read", { ref: derived.comments[0]! });
      const start = text.indexOf("brass fittings");
      expect(r.json.record).toMatchObject({ kind: "comment", id: derived.comments[0], status: "open", target: `${notes.lamp!.id}@${lamp.revision}`, anchor: { start, end: start + "brass fittings".length }, body: 'Is "brass fittings" still right?' });
      expect(r.text).not.toContain("Comment on");
      expect(r.text).not.toContain("UNIQUE-TARGET-SENTENCE");
    });

    test("a pointer never stands in for a raw read, and a reply points at the note, not its thread", async () => {
      const [pointer, raw, again] = await t.batch([
        { name: "outline_read", args: { ref: derived.proposal } },
        { name: "outline_read", args: { ref: derived.proposal, raw: true } },
        { name: "outline_read", args: { ref: derived.proposal } },
      ]);
      expect(pointer!.json.record.kind).toBe("proposal");
      expect(raw!.json.see).toBeUndefined();
      expect(raw!.text).toContain("draft-patch");
      expect(again!.json).toMatchObject({ see: expect.stringMatching(/:record$/) });
      const r = await call("outline_read", { ref: derived.reply });
      expect(r.json.record).toMatchObject({ kind: "comment", reply: true, target: expect.stringMatching(new RegExp(`^${notes.lamp!.id}@\\d+$`)), thread: derived.comments[1], body: "Yes, checked on Sunday." });
    });

    test("seen: a block held at that revision is a stub, a changed one comes back whole, over read, query and find", async () => {
      const first = await call("outline_read", { ref: notes.fresh!.id });
      const pair = `${notes.fresh!.id}@${first.json.revision}`;
      const stub = await call("outline_read", { ref: notes.fresh!.id, seen: [pair] });
      expect(stub.json).toMatchObject({ id: notes.fresh!.id, revision: first.json.revision, unchanged: true });
      expect(stub.text).not.toContain("Last thing written");
      expect(stub.json.record).toBeUndefined();

      const held = (await call("outline_query", { query: "rank", limit: 50 })).json.matches.map((m: any) => `${m.record.id}@${m.revision}`);
      const q = await call("outline_query", { query: "rank", seen: held });
      expect(q.json.matches.every((m: any) => m.unchanged === true && !m.record)).toBe(true);
      expect(q.json.matches).toHaveLength(held.length);

      const f = await call("outline_find", { query: "Freshest", seen: [pair] });
      expect(f.json.matches[0]).toMatchObject({ id: notes.fresh!.id, unchanged: true });

      // The note changes: the same pair is now stale, and the full body comes back at the new revision.
      const now = (await board.request<{ revision: number }>("get", { blockId: notes.fresh!.id })).revision;
      await board.update(notes.fresh!.id, "Freshest note [rank::4]\nLast thing written, then edited.", now);
      const changed = await call("outline_read", { ref: notes.fresh!.id, seen: [pair] });
      expect(changed.json.unchanged).toBeUndefined();
      expect(changed.json.revision).toBeGreaterThan(first.json.revision);
      expect(changed.json.record.body).toContain("then edited");
      const q2 = await call("outline_query", { query: "rank", seen: held, sort: "rank asc" });
      expect(q2.json.matches.filter((m: any) => !m.unchanged)).toHaveLength(1);
      expect(q2.json.matches.find((m: any) => !m.unchanged).record.body).toContain("then edited");
      notes.fresh!.revision = changed.json.revision;
    });

    test("bad arguments are corrected: sort, seen, fold, a view with sort", async () => {
      for (const args of [{ sort: "updated sideways" }, { sort: 3 }]) {
        const r = await call("outline_query", { query: "rank", ...args });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/sort/);
      }
      const seen = await call("outline_read", { ref: notes.fresh!.id, seen: ["nope"] });
      expect(seen.isError).toBe(true);
      expect(seen.text).toContain("id@revision");
      expect((await call("outline_query", { query: "rank", fold: "yes" })).isError).toBe(true);
      const view = await call("outline_query", { view: notes.garden!.id, sort: "updated" });
      expect(view.isError).toBe(true);
      expect(view.text).toContain("saved view has its own order");
      const typo = await call("outline_query", { query: "rank", sorted: "updated" });
      expect(typo.isError).toBe(true);
      expect(typo.text).toContain("sort");
    });

    test("size: the orient query is a small fraction of the same query unprojected", async () => {
      // Heavier notes, so the difference is what a real outline's is.
      for (let i = 0; i < 12; i++) await board.createBlock(null, `Field journal ${i} [kind::journal]\n${"The tide came in over the flats and the heron stood still. ".repeat(40)}`, { author: "agent" } as any);
      const full = await call("outline_query", { query: "updated >= -1d", sort: "updated desc", limit: 50 });
      const orient = await call("outline_query", { ...ORIENT, limit: 50 });
      expect(full.json.matches.length).toBeGreaterThan(15);
      expect(orient.text.length).toBeLessThan(full.text.length * 0.2);
      expect(orient.text.length).toBeLessThan(orient.json.matches.length * 220 + 800);
    });
  });
});
