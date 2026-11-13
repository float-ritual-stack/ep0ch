// The remote MCP gateway's copies (PIE-562, ADR 0009): an outline whose home is another machine, read from a read-only
// copy on the gateway's machine, never from that machine. A scratch host stands in for the other machine; the copy is
// its follower (outliner outline-follower.ts), applying that host's change log from its cursor. Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { answerMcp, type McpOutlines } from "../src/mcp";
import { machineOutlines } from "../src/mcp-gateway";
import { mirrorsConfig, OutlineFollower } from "../src/mcp-mirror";
import { hostRequest, SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const FAR = "far-box";
const SCHEMA_VERSION = Number(/^export const SCHEMA_VERSION = (\d+);/m.exec(readFileSync(join(outliner!, "src/schema.ts"), "utf8"))![1]);

/** `list_outlines` through a gateway of its own. */
const answerList = async (outlines: McpOutlines) => {
  const answer = await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: 9000, method: "tools/call", params: { name: "list_outlines", arguments: {} } }));
  const result = (answer!.reply as { result: { content: { text: string }[] } }).result;
  return { text: result.content[0]!.text };
};

/** A read until `ok` holds, for at most `ms`: what a caller sees, polled. */
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > end) return value;
    await Bun.sleep(100);
  }
}

describe.skipIf(!outliner)("the gateway's read-only copies", () => {
  const home = new ScratchHost();
  let here = "", mirrorsFolder = "";
  let garden: SocketBoard, attic: SocketBoard, outlines: McpOutlines & { close(): void };
  let mirrors: OutlineFollower[] = [];
  const logs: string[] = [];
  let note = { id: "", uri: "" }, nextId = 1;
  /** The attic's home stops answering (its link down): its copy stays, stale. */
  let atticAway = false;
  /** The followers' clock: a home that wasn't reached is asked again only 15 s later on it, so a test moves it on. */
  let skew = 0;
  const clock = () => Date.now() + skew;

  const call = async (method: string, params?: unknown) => {
    const answer = await answerMcp(outlines, JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }));
    return answer!.reply as { result?: any; error?: { message: string } };
  };
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await call("tools/call", { name, arguments: args })).result as { isError?: boolean; content: { text: string }[] };
    return { isError: !!result.isError, text: result.content[0]!.text };
  };

  beforeAll(async () => {
    await home.start();
    await home.create("garden-notes");
    await home.create("attic-notes");
    garden = new SocketBoard(home.sock, undefined, "garden-notes");
    attic = new SocketBoard(home.sock, undefined, "attic-notes");
    await garden.request("mcp.access.configure", { level: "read" });
    const made = await garden.request("create", { parentId: null, text: "Seed swap list\nRunner beans for the allotment next door.", author: "agent" });
    note = { id: made.id, uri: formatEp0chBlockUri({ outline: "garden-notes", machine: FAR, blockId: made.id }) };
    await attic.request("create", { parentId: null, text: "Trunk contents\nOld maps of the canal.", author: "agent" });
    await garden.request("pages.follow", { address: "Allotment plan", author: "agent" });
    here = scratchDir("ep0ch-mirror-");
    mirrorsFolder = join(here, "mirrors");
    const reach = (name: string) => async () => {
      if (name === "cellar-notes" || (name === "attic-notes" && atticAway)) throw new Error(`${FAR} doesn't answer (no route)`);
      return home.sock;
    };
    mirrors = ["garden-notes", "attic-notes", "cellar-notes"].map(name => new OutlineFollower(name, FAR, mirrorsFolder, line => logs.push(line), clock, { reach: reach(name) }));
    // The first copies arrive; then the attic's home goes away.
    for (const m of mirrors.slice(0, 2)) await m.pull();
    atticAway = true;
    await mirrors[1]!.pull();
    // This machine's own host isn't part of these tests: no local outlines.
    outlines = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no local host" }), mirrors, async () => []);
  }, 30_000);

  afterAll(async () => {
    outlines?.close();
    for (const m of mirrors) await m.close();
    garden?.close(); attic?.close();
    await Bun.sleep(200);
    await home.dispose();
    if (here) rmSync(here, { recursive: true, force: true });
  }, 20_000);

  test("list_outlines shows each copy with its freshness and access, a stale one with why, and one never made as unreachable", async () => {
    const listed = JSON.parse((await tool("list_outlines")).text) as { outlines: Record<string, unknown>[] };
    expect(listed.outlines).toEqual([
      { outline: "garden-notes", machine: FAR, uri: `ep0ch://garden-notes@${FAR}`, source: "mirror", asOf: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), access: "read", note: expect.stringContaining(`garden-notes lives on ${FAR}`),
        copy: { file: `${FAR}/garden-notes.sqlite`, copiedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), cursor: expect.any(Number) } },
      { outline: "attic-notes", machine: FAR, uri: `ep0ch://attic-notes@${FAR}`, source: "mirror", asOf: expect.any(String), access: "none", copy: expect.objectContaining({ file: `${FAR}/attic-notes.sqlite` }),
        stale: { since: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), why: expect.stringContaining(`${FAR} doesn't answer`) }, note: expect.stringMatching(/is stale since \d{4}-.*doesn't answer/) },
      { outline: "cellar-notes", machine: FAR, uri: `ep0ch://cellar-notes@${FAR}`, source: "unreachable", note: expect.stringMatching(/^cellar-notes lives on far-box; .*'s read-only copy hasn't arrived yet/) },
    ]);
    expect((listed.outlines[0]!.note as string)).toContain("kept current from its change log");
  });

  test("a read says it came from the mirror, as of the newest change it holds, by URI, by name and as a resource", async () => {
    const read = JSON.parse((await tool("outline_read", { uri: note.uri })).text);
    expect(read).toMatchObject({ uri: note.uri, reachability: { status: "reachable", level: "read", source: "mirror", asOf: expect.any(String), reason: expect.stringContaining("read-only mirror") }, record: { id: note.id, body: expect.stringContaining("Runner beans") } });
    const found = JSON.parse((await tool("outline_find", { query: "Seed swap", outline: "garden-notes" })).text);
    // The copy is its source's instance: the id the outline's own host reports, not one the private serve copy minted.
    await garden.info();
    expect(garden.outlineInstanceId).toBeTruthy();
    expect(read.outlineInstanceId).toBe(garden.outlineInstanceId);
    expect(found).toMatchObject({ outline: "garden-notes", machine: FAR, source: "mirror", asOf: read.reachability.asOf });
    expect(found.matches).toContainEqual(expect.objectContaining({ id: note.id, uri: note.uri }));
    const resource = await call("resources/read", { uri: note.uri });
    expect(resource.result.reachability.source).toBe("mirror");
    expect((await tool("outline_find", { query: "Seed", outline: "garden-notes@another-box" })).text).toContain("is on another machine");
  });

  test("a ref on a mirror resolves as on a live outline: [[page]] and ((id)) in the copy, never made there", async () => {
    const page = await tool("outline_read", { ref: "[[Allotment plan]]", outline: "garden-notes" });
    expect(page.isError).toBe(false);
    expect(JSON.parse(page.text).record.title).toBe("Allotment plan");
    expect(JSON.parse((await tool("outline_links", { ref: `((${note.id}))`, outline: "garden-notes" })).text).id).toBe(note.id);
    const missing = await tool("outline_read", { ref: "[[Greenhouse]]", outline: "garden-notes" });
    expect(missing.isError).toBe(true);
    expect(missing.text).not.toContain("read-only copy");
  });

  test("the access setting is the one the copy carries; the refusal says to grant it on the outline's own machine", async () => {
    const refused = await tool("outline_find", { query: "Trunk", outline: "attic-notes" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`MCP access is none for attic-notes@${FAR}`);
    expect(refused.text).toContain(`runs \`ep0ch mcp access read --ws attic-notes\` on ${FAR}`);
    expect(refused.text).not.toContain("canal");
    expect((await tool("outline_read", { ref: note.id, outline: "cellar-notes" })).text).toContain("lives on far-box; ");
  });

  test("the copy is served read-only: a write or a host action is refused, and the followed file is never opened to write", async () => {
    const target = await outlines.board({ outline: "garden-notes" });
    if ("error" in target) throw new Error(target.error);
    await expect(target.board.request("create", { parentId: null, text: "Should not land", author: "agent" })).rejects.toThrow("read-only copy");
    await expect(target.board.request("mcp.access.configure", { level: "full" })).rejects.toThrow("read-only copy");
    await expect(hostRequest(target.board.path, "outlines.create", { name: "sneaky" })).rejects.toThrow("read-only copies");
    expect(readdirSync(join(mirrorsFolder, FAR)).filter(f => f.endsWith(".sqlite") && !f.endsWith(".owner.sqlite")).sort()).toEqual(["attic-notes.sqlite", "garden-notes.sqlite"]);
  });

  test("a change on the home is in the copy within moments, woken by the home's events", async () => {
    const before = JSON.parse((await tool("outline_read", { uri: note.uri })).text).reachability.asOf as string;
    await Bun.sleep(20);
    const later = await garden.request("create", { parentId: null, text: "Frost dates\nLast frost due mid-April.", author: "agent" });
    const laterUri = formatEp0chBlockUri({ outline: "garden-notes", machine: FAR, blockId: later.id });
    const readLater = async () => { const t = await tool("outline_read", { uri: laterUri }); return t.isError ? null : JSON.parse(t.text) as { record: { body: string }; reachability: { asOf: string } }; };
    const read = (await until(readLater, r => !!r, 5_000))!;
    expect(read.record.body).toContain("mid-April");
    expect(Date.parse(read.reachability.asOf)).toBeGreaterThan(Date.parse(before));
  }, 30_000);

  test("the home's access setting reaches the copy with its log: revoked there, refused here; granted again, read", async () => {
    await garden.request("mcp.access.configure", { level: "none" });
    try {
      await mirrors[0]!.pull();
      const revoked = await tool("outline_read", { uri: note.uri });
      expect(revoked.isError).toBe(true);
      expect(revoked.text).toContain("MCP access is none for garden-notes");
    } finally { await garden.request("mcp.access.configure", { level: "read" }); }
    await mirrors[0]!.pull();
    expect((await tool("outline_read", { uri: note.uri })).isError).toBe(false);
  }, 30_000);

  test("the stale copy catches up from its cursor once its home answers again", async () => {
    await attic.request("create", { parentId: null, text: "Lantern hook\nBy the attic window.", author: "agent" });
    await attic.request("mcp.access.configure", { level: "read" });
    atticAway = false;
    // Its follower asks again once its wait after the last refusal is over.
    skew += 16_000;
    await mirrors[1]!.pull();
    const found = JSON.parse((await tool("outline_find", { query: "Lantern hook", outline: "attic-notes" })).text);
    expect(found).toMatchObject({ outline: "attic-notes", source: "mirror" });
    expect(found.stale).toBeUndefined();
    expect(JSON.stringify(found.matches)).toContain("By the attic window");
    await attic.request("mcp.access.configure", { level: "none" });
  }, 30_000);

  /** A copy one schema behind this build (before the change log, 0012), at `path`: what the backup job's restic copy left there. */
  const asSchemaBehind = (name: string, path: string) => {
    rmSync(path, { force: true });
    const source = new Database(join(home.outlines, `${name}.sqlite`), { readonly: true });
    try { source.run("VACUUM INTO ?", [path]); } finally { source.close(); }
    const db = new Database(path);
    try {
      for (const { name: trigger } of db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log\\_%' ESCAPE '\\'").all() as { name: string }[]) db.exec(`DROP TRIGGER "${trigger}"`);
      db.exec("DROP TABLE change_log; DROP TABLE log_state;");
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    } finally { db.close(); }
  };
  const version = (path: string) => { const db = new Database(path, { readonly: true }); try { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; } finally { db.close(); } };
  const away = async () => { throw new Error(`${FAR} doesn't answer (asleep)`); };

  test("a copy one schema behind this build (a deploy here while the home sleeps) is migrated in place and served, stale, said", async () => {
    const dir = join(here, "behind");
    mkdirSync(join(dir, FAR), { recursive: true });
    const file = join(dir, FAR, "garden-notes.sqlite");
    asSchemaBehind("garden-notes", file);
    const mirror = new OutlineFollower("garden-notes", FAR, dir, line => logs.push(line), Date.now, { reach: away });
    try {
      // Its first look (the migration runs a script) is over before the read.
      await mirror.pull();
      const read = await mirror.read();
      if ("error" in read) throw new Error(read.error);
      expect(read.migrated).toEqual({ from: SCHEMA_VERSION - 1, to: SCHEMA_VERSION });
      expect(read.stale?.why).toContain(`${FAR} doesn't answer`);
      expect(version(file)).toBe(SCHEMA_VERSION);
      expect(logs.join("\n")).toContain("migrated the copy");
      const gateway = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no local host" }), [mirror], async () => []);
      const row = (JSON.parse((await answerList(gateway)).text).outlines as { note?: string; source: string }[])[0]!;
      expect(row.source).toBe("mirror");
      expect(row.note).toContain(`migrated from schema ${SCHEMA_VERSION - 1} to ${SCHEMA_VERSION}`);
    } finally { await mirror.close(); }
  }, 60_000);

  test("a copy no script can migrate is listed unreadable, its access and writes still shown, never 'ep0ch install'", async () => {
    const dir = join(here, "ancient");
    mkdirSync(join(dir, FAR), { recursive: true });
    const file = join(dir, FAR, "garden-notes.sqlite");
    asSchemaBehind("garden-notes", file);
    const copy = new Database(file);
    copy.run("PRAGMA user_version = 3");
    copy.run("INSERT INTO metadata (key, value) VALUES ('mcp.local_access', 'full') ON CONFLICT(key) DO UPDATE SET value = 'full'");
    copy.close();
    const mirror = new OutlineFollower("garden-notes", FAR, dir, line => logs.push(line), Date.now, { reach: away });
    try {
      await mirror.pull();
      const gateway = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no local host" }), [mirror], async () => [], join(here, "queue"));
      const row = (JSON.parse((await answerList(gateway)).text).outlines as Record<string, unknown>[])[0]!;
      expect(row).toMatchObject({ source: "unreachable", access: "full", writes: "queued" });
      expect(row.note).toContain("no migration script takes schema 3 to 4");
      expect(row.note).not.toContain("install --apply");
      expect(version(file)).toBe(3);
    } finally { await mirror.close(); }
  }, 60_000);

  test("config: copies are <outline>@<machine>, in a folder that isn't the outlines folder", () => {
    expect(mirrorsConfig({ HOME: "/fictional/home", EP0CH_MCP_MIRRORS: "garden-notes@far-box, attic-notes@far-box" })).toEqual({
      folder: "/fictional/home/outline-mirrors", mirrors: [{ outline: "garden-notes", machine: FAR }, { outline: "attic-notes", machine: FAR }],
    });
    expect(mirrorsConfig({ HOME: "/fictional/home" })).toEqual({ folder: "/fictional/home/outline-mirrors", mirrors: [] });
    expect(mirrorsConfig({ EP0CH_MCP_MIRRORS: "garden-notes" })).toMatchObject({ error: expect.stringContaining("<outline>@<machine>") });
    expect(mirrorsConfig({ EP0CH_MCP_MIRRORS: "a@b,a@b" })).toMatchObject({ error: expect.stringContaining("twice") });
    // A bare name reaches one copy, so one outline name is followed from one machine.
    expect(mirrorsConfig({ HOME: "/fictional/home", EP0CH_MCP_MIRRORS: "a@b,a@c" })).toMatchObject({ error: expect.stringContaining("names a twice") });
    expect(mirrorsConfig({ EP0CH_OUTLINES: "/fictional/outlines", EP0CH_MCP_MIRROR_DIR: "/fictional/outlines" })).toMatchObject({ error: expect.stringContaining("is the outlines folder") });
  });
});
