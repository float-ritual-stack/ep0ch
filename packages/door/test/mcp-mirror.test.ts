// The remote MCP gateway's mirrors (PIE-562): an outline whose home is another machine, read from a read-only copy on
// the gateway's machine, never from that machine. A scratch host stands in for the other machine; "Litestream's follow"
// is a VACUUM INTO of its database into the mirrors folder. Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { answerMcp, type McpOutlines } from "../src/mcp";
import { machineOutlines } from "../src/mcp-gateway";
import { mirrorsConfig, OutlineMirror } from "../src/mcp-mirror";
import { hostRequest, SocketBoard } from "../src/socket";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const FAR = "far-box";

describe.skipIf(!outliner)("the gateway's read-only mirrors", () => {
  const home = new ScratchHost();
  let here = "", mirrorsFolder = "", clock = Date.parse("2026-03-14T09:00:00Z");
  let garden: SocketBoard, attic: SocketBoard, outlines: McpOutlines & { close(): void };
  const logs: string[] = [];
  let note = { id: "", uri: "" }, nextId = 1;

  /** What Litestream's follow does: the outline's current state lands in `<mirrors>/<machine>/<name>.sqlite`. */
  const follow = (name: string) => {
    const target = join(mirrorsFolder, FAR, `${name}.sqlite`);
    rmSync(target, { force: true });
    const source = new Database(join(home.outlines, `${name}.sqlite`), { readonly: true });
    try { source.run("VACUUM INTO ?", [target]); } finally { source.close(); }
  };
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
    await garden.configureMcpAccess("read");
    const made = await garden.request<{ id: string }>("create", { parentId: null, text: "Seed swap list\nRunner beans for the allotment next door.", author: "agent" });
    note = { id: made.id, uri: formatEp0chBlockUri({ outline: "garden-notes", machine: FAR, blockId: made.id }) };
    await attic.request("create", { parentId: null, text: "Trunk contents\nOld maps of the canal.", author: "agent" });
    here = scratchDir("ep0ch-mirror-");
    mirrorsFolder = join(here, "mirrors");
    mkdirSync(join(mirrorsFolder, FAR), { recursive: true });
    follow("garden-notes");
    follow("attic-notes");
    const mirrors = ["garden-notes", "attic-notes", "cellar-notes"].map(name => new OutlineMirror(name, FAR, mirrorsFolder, line => logs.push(line), () => clock));
    // This machine's own host isn't part of these tests: no local outlines.
    outlines = machineOutlines(undefined, line => logs.push(line), async () => ({ error: "no local host" }), mirrors, async () => []);
  }, 30_000);

  afterAll(async () => {
    outlines?.close();
    garden?.close(); attic?.close();
    await Bun.sleep(200);
    await home.dispose();
    if (here) rmSync(here, { recursive: true, force: true });
  }, 20_000);

  test("list_outlines shows each mirror with its freshness and access, and one never copied as unreachable", async () => {
    const listed = JSON.parse((await tool("list_outlines")).text) as { outlines: Record<string, unknown>[] };
    expect(listed.outlines).toEqual([
      { outline: "garden-notes", machine: FAR, uri: `ep0ch://garden-notes@${FAR}`, source: "mirror", asOf: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), access: "read", note: expect.stringContaining(`garden-notes lives on ${FAR}`) },
      { outline: "attic-notes", machine: FAR, uri: `ep0ch://attic-notes@${FAR}`, source: "mirror", asOf: expect.any(String), access: "none", note: expect.any(String) },
      { outline: "cellar-notes", machine: FAR, uri: `ep0ch://cellar-notes@${FAR}`, source: "unreachable", note: expect.stringContaining("no copy of cellar-notes@far-box has reached this machine yet") },
    ]);
  });

  test("a read says it came from the mirror, as of the newest change it holds, by URI, by name and as a resource", async () => {
    const read = JSON.parse((await tool("outline_read", { uri: note.uri })).text);
    expect(read).toMatchObject({ uri: note.uri, reachability: { status: "reachable", level: "read", source: "mirror", asOf: expect.any(String), reason: expect.stringContaining("read-only mirror") }, record: { id: note.id, text: expect.stringContaining("Runner beans") } });
    const found = JSON.parse((await tool("outline_find", { query: "Seed swap", outline: "garden-notes" })).text);
    expect(found).toMatchObject({ outline: "garden-notes", machine: FAR, source: "mirror", asOf: read.reachability.asOf });
    expect(found.matches).toContainEqual(expect.objectContaining({ id: note.id, uri: note.uri }));
    const resource = await call("resources/read", { uri: note.uri });
    expect(resource.result.reachability.source).toBe("mirror");
    expect((await tool("outline_find", { query: "Seed", outline: "garden-notes@another-box" })).text).toContain("is on another machine");
  });

  test("the access setting is the one the copy carries; the refusal says to grant it on the outline's own machine", async () => {
    const refused = await tool("outline_find", { query: "Trunk", outline: "attic-notes" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`MCP access is none for attic-notes@${FAR}`);
    expect(refused.text).toContain(`runs \`ep0ch mcp access read --ws attic-notes\` on ${FAR}`);
    expect(refused.text).not.toContain("canal");
    expect((await tool("outline_read", { ref: note.id, outline: "cellar-notes" })).text).toContain("reads it only from its mirror");
  });

  test("the copy is served read-only: a write or a host action is refused, and the followed file is never opened to write", async () => {
    const target = await outlines.board({ outline: "garden-notes" });
    if ("error" in target) throw new Error(target.error);
    await expect(target.board.request("create", { parentId: null, text: "Should not land", author: "agent" })).rejects.toThrow("read-only copy");
    await expect(target.board.configureMcpAccess("full")).rejects.toThrow("read-only copy");
    await expect(hostRequest(target.board.path, "outlines.create", { name: "sneaky" })).rejects.toThrow("read-only copies");
    expect(readdirSync(join(mirrorsFolder, FAR)).sort()).toEqual(["attic-notes.sqlite", "garden-notes.sqlite"]);
  });

  test("a newer copy is picked up at the next check; until then the one before answers", async () => {
    const before = JSON.parse((await tool("outline_read", { uri: note.uri })).text).reachability.asOf as string;
    await Bun.sleep(20);
    const later = await garden.request<{ id: string }>("create", { parentId: null, text: "Frost dates\nLast frost due mid-April.", author: "agent" });
    follow("garden-notes");
    const laterUri = formatEp0chBlockUri({ outline: "garden-notes", machine: FAR, blockId: later.id });
    expect((await tool("outline_read", { uri: laterUri })).isError).toBe(true);
    clock += 16_000;
    const read = JSON.parse((await tool("outline_read", { uri: laterUri })).text);
    expect(read.record.text).toContain("mid-April");
    expect(Date.parse(read.reachability.asOf)).toBeGreaterThan(Date.parse(before));
  }, 30_000);

  test("config: mirrors are <outline>@<machine>, in a folder that isn't the outlines folder", () => {
    expect(mirrorsConfig({ HOME: "/fictional/home", EP0CH_MCP_MIRRORS: "garden-notes@far-box, attic-notes@far-box" })).toEqual({
      folder: "/fictional/home/outline-mirrors", mirrors: [{ outline: "garden-notes", machine: FAR }, { outline: "attic-notes", machine: FAR }],
    });
    expect(mirrorsConfig({ HOME: "/fictional/home" })).toEqual({ folder: "/fictional/home/outline-mirrors", mirrors: [] });
    expect(mirrorsConfig({ EP0CH_MCP_MIRRORS: "garden-notes" })).toMatchObject({ error: expect.stringContaining("<outline>@<machine>") });
    expect(mirrorsConfig({ EP0CH_MCP_MIRRORS: "a@b,a@c" })).toMatchObject({ error: expect.stringContaining("twice") });
    expect(mirrorsConfig({ EP0CH_OUTLINES: "/fictional/outlines", EP0CH_MCP_MIRROR_DIR: "/fictional/outlines" })).toMatchObject({ error: expect.stringContaining("is the outlines folder") });
  });
});
