// PIE-520: the local stdio MCP server is bound to the outline the CLI can open, and serves canonical
// ep0ch:// block resources plus read/find/links tools. Scratch service only; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync, cpSync } from "node:fs";
import { createServer, connect } from "node:net";
import { createInterface } from "node:readline";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { join, resolve } from "node:path";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { usageShape } from "../src/mcp-usage";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { answerMcp, mcpCommand } from "../src/mcp";
import { machineOutlines } from "../src/mcp-gateway";
import { localAdmin } from "../src/mcp-outlines";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";
import { OUTLINE_TOOLS } from "../../claude-mod/hooks/outline-tools";
import { prop } from "../src/props";

interface RpcResponse { id: string | number | null; result?: unknown; error?: { message?: string } }
interface ToolResult { content: { type: "text"; text: string }[]; isError?: boolean }

const linesOf = (lines: string[]) => (async function* () { for (const line of lines) yield line; })();
const responseOf = (line: string): RpcResponse => JSON.parse(line) as RpcResponse;
const fields = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tool = (value: unknown): ToolResult => value as ToolResult;

describe.skipIf(!outliner)("ep0ch mcp", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let target: { id: string; uri: string }, source: { id: string; uri: string }, privateNote: { id: string; uri: string }, publishedShell: { id: string; uri: string }, machine = "";
  const oldEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    machine = canonicalLocalMachineName();
    target = await board.request<{ id: string; text: string }>("create", { parentId: null, text: "Addressable seed\nReady for local tools.", author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    source = await board.request<{ id: string; text: string }>("create", { parentId: null, text: `Private backlink source\nSee ((${target.id}|the target)).`, author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    privateNote = await board.request<{ id: string; text: string }>("create", { parentId: null, text: "Private seed\nNot published, but allowed after local MCP grant.", author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    publishedShell = await board.request<{ id: string; text: string }>("create", { parentId: null, text: `Published shell [publish::true]\nPublishing does not grant local MCP access. See ((${privateNote.id}|private seed)).`, author: "agent" }).then(b => ({ id: b.id, uri: formatEp0chBlockUri({ outline: scratch.name, machine, blockId: b.id }) }));
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  test.each(["grep", "find", "read"])("whole-outline text tools: %s", async kind => {
    await board.configureMcpAccess("read");
    const note = await board.createBlock(null, `Orchard log [season::autumn]\nBefore the watch.\nAmber moon over the orchard.\nAfter the watch.\nSee ((${target.id})).\n${Array.from({ length: 1101 }, (_, i) => `Harvest mark ${i}`).join("\n")}`);
    const loose = await board.createBlock(null, "Amber—moon\nWords separated by punctuation.");
    const trashed = await board.createBlock(null, "Old harvest");
    await board.createBlock(trashed.id, "Harvest mark in a trashed subtree");
    await board.trash(trashed.id);
    const call = async (name: string, args: Record<string, unknown>) => {
      const out: string[] = [];
      expect(await mcpCommand(["mcp"], { input: linesOf([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })]), write: line => out.push(line), err: line => { throw new Error(line); } })).toBe(0);
      const response = responseOf(out[0]!);
      expect(response.error, JSON.stringify(response.error)).toBeUndefined();
      const reply = tool(response.result);
      expect(reply.isError, reply.content[0]!.text).not.toBe(true);
      return JSON.parse(reply.content[0]!.text);
    };
    try {
      if (kind === "grep") {
        const all = await call("outline_grep", { pattern: "^Harvest mark \\d+$" });
        expect(all.matches).toHaveLength(1101);
        expect(all.matches.at(-1)).toMatchObject({ id: note.id, title: "Orchard log", line: 1106, text: "Harvest mark 1100" });
        expect(all.more).toBe(false);
        const first = await call("outline_grep", { pattern: "^Harvest mark", limit: 1000 });
        expect(first).toMatchObject({ more: true, nextOffset: 1000 });
        const rest = await call("outline_grep", { pattern: "^Harvest mark", offset: first.nextOffset });
        expect([...first.matches, ...rest.matches]).toEqual(all.matches);
        expect((await call("outline_grep", { pattern: "Words separated" })).matches[0].id).toBe(loose.id);
      } else if (kind === "find") {
        for (const semantic of [false, true]) {
          const found = await call("outline_find", { query: '"amber moon"', semantic });
          expect(found.matches[0]).toMatchObject({ id: note.id, lines: [{ line: 3, text: "Amber moon over the orchard.", before: "Before the watch.", after: "After the watch." }] });
        }
      } else {
        const lean = await call("outline_read", { ref: note.id });
        expect(lean.record).toMatchObject({ body: expect.stringContaining("Amber moon"), properties: [{ key: "season", values: ["autumn"] }], links: [target.id] });
        expect(lean.record.fields).toBeUndefined();
        const detail = await call("outline_read", { ref: note.id, detail: true });
        expect(detail.record.fields[0]).toMatchObject({ key: "season", offset: expect.any(Number) });
        expect(detail.record.links[0]).toMatchObject({ target: target.id, bodySpans: expect.any(Array) });
      }
    } finally { await board.trash(note.id); await board.trash(loose.id); }
  }, 30_000);

  test("a connected MCP keeps writing across grammar and protocol installs without a connector toggle", async () => {
    // A disposable installed checkout; only the handshake numbers change, all tools still use the real host.
    const repo = join(scratch.root, "installed");
    for (const name of ["door", "outline-core"]) {
      const dest = join(repo, "packages", name);
      mkdirSync(dest, { recursive: true });
      cpSync(resolve(import.meta.dir, `../../${name}/src`), join(dest, "src"), { recursive: true });
      cpSync(resolve(import.meta.dir, `../../${name}/package.json`), join(dest, "package.json"));
    }
    symlinkSync(resolve(import.meta.dir, "../assets"), join(repo, "packages/door/assets"));
    const modules = join(repo, "packages/door/node_modules");
    mkdirSync(join(modules, "@ep0ch"), { recursive: true });
    symlinkSync(join(repo, "packages/outline-core"), join(modules, "@ep0ch/outline-core"));
    symlinkSync(resolve(import.meta.dir, "../../outliner"), join(modules, "@ep0ch/outliner"));
    for (const name of readdirSync(resolve(import.meta.dir, "../node_modules"))) {
      if (name !== "@ep0ch") symlinkSync(resolve(import.meta.dir, "../node_modules", name), join(modules, name));
    }
    const wire = join(repo, "packages/outline-core/src/protocol.ts");
    let source = readFileSync(wire, "utf8");
    if (!source.includes("export const GRAMMAR =")) source += "\nexport const GRAMMAR = 1;\n";
    writeFileSync(wire, source);
    const grammar = Number(/export const GRAMMAR = (\d+);/.exec(source)![1]);
    let hostProtocol = PROTOCOL, hostGrammar = grammar;
    const proxyPath = join(scratch.root, "versions.sock");
    const connections = new Set<import("node:net").Socket>();
    const proxy = createServer(client => {
      const upstream = connect(scratch.sock);
      connections.add(client); connections.add(upstream);
      client.pipe(upstream);
      const lines = createInterface({ input: upstream });
      lines.on("line", line => {
        const reply = JSON.parse(line);
        if (reply.result?.protocolVersion !== undefined) {
          reply.result.protocolVersion = hostProtocol; reply.result.grammarVersion = hostGrammar;
        }
        client.write(JSON.stringify(reply) + "\n");
      });
      client.on("close", () => { upstream.destroy(); connections.delete(client); connections.delete(upstream); lines.close(); });
    });
    await new Promise<void>(r => proxy.listen(proxyPath, r));
    await board.configureMcpAccess("full");
    const child = Bun.spawn([process.execPath, join(repo, "packages/door/src/main.ts"), "--ws", scratch.name, "mcp"], {
      cwd: scratch.root, env: { ...process.env, ...scratch.env, EP0CH_WS: "wrong-seedlings", EP0CH_SOCKET: proxyPath }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    const errors = new Response(child.stderr).text();
    const output = createInterface({ input: require("node:stream").Readable.fromWeb(child.stdout) });
    const replies = output[Symbol.asyncIterator]();
    let id = 0;
    const rpc = async (method: string, params: unknown) => {
      const requestId = ++id;
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
      const next = await replies.next();
      if (next.done) throw new Error(await errors);
      const reply = JSON.parse(next.value!);
      expect(reply.id).toBe(requestId);
      return reply;
    };
    const write = async (text: string) => {
      const reply = await rpc("tools/call", { name: "outline_create", arguments: { ref: target.id, text } });
      expect(reply.error).toBeUndefined();
      expect(reply.result.isError, JSON.stringify(reply)).not.toBe(true);
      return reply;
    };
    try {
      await rpc("initialize", { clientInfo: { name: "version-gardener" } });
      await write("Before the install");
      const created = await rpc("tools/call", { name: "outline_new", arguments: { name: "version-seedlings", purpose: "Version handover checks", seed: ["Seed tray"] } });
      expect(created.result.isError, JSON.stringify(created)).not.toBe(true);
      const seedlings = new SocketBoard(scratch.sock, undefined, "version-seedlings");
      let tray: string;
      try { tray = (await seedlings.roots())[0]!.id; } finally { seedlings.close(); }
      hostGrammar++;
      const warning = await write("New drawing rules");
      expect(JSON.stringify(warning)).toContain("drawn with older rules");
      expect(JSON.stringify(await write("Still captures"))).not.toContain("drawn with older rules");
      writeFileSync(wire, source.replace(/export const GRAMMAR = \d+;/, `export const GRAMMAR = ${hostGrammar};`));
      await write("After the grammar install");
      const kept = await rpc("tools/call", { name: "outline_create", arguments: { outline: "version-seedlings", ref: tray, text: "Still my tray" } });
      expect(kept.result.isError, JSON.stringify(kept)).not.toBe(true);
      hostProtocol++;
      const refused = await rpc("tools/call", { name: "outline_create", arguments: { ref: target.id, text: "Must refuse" } });
      expect(JSON.stringify(refused)).toContain("ep0ch install --apply");
      writeFileSync(wire, readFileSync(wire, "utf8").replace(/export const GRAMMAR = \d+;/, `export const GRAMMAR = ${hostGrammar + 1};`));
      const stillOld = await rpc("tools/call", { name: "outline_create", arguments: { ref: target.id, text: "Still must refuse" } });
      expect(JSON.stringify(stillOld)).toContain("ep0ch install --apply");
      writeFileSync(wire, readFileSync(wire, "utf8").replace(/export const PROTOCOL = \d+;/, `export const PROTOCOL = ${hostProtocol};`));
      await Promise.all([write("After the protocol install"), write("Queued during handover")]);
      const saved = await board.request<{ text: string; actorId: string }[]>("children", { parentId: target.id });
      expect(saved.some(b => b.text === "After the protocol install" && b.actorId.includes("version-gardener"))).toBe(true);
      child.stdin.end();
      expect(await child.exited, await errors).toBe(0);
    } finally {
      child.kill(); await child.exited; output.close();
      for (const socket of connections) socket.destroy();
      await new Promise<void>(r => proxy.close(() => r()));
    }
  }, 60_000);

  test("artifact upload accepts a folder over CLI and MCP writes obey the access level", async () => {
    const folder = join(scratch.root, "built-site");
    mkdirSync(join(folder, "assets"), { recursive: true });
    writeFileSync(join(folder, "index.html"), "<h1>Moth garden</h1>");
    const binary = Buffer.alloc(130_000, 255);
    writeFileSync(join(folder, "assets", "pixel.bin"), binary);
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "artifact", "put", folder, "--name", "garden-site", "--ws", scratch.name], { env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, error).toBe(0);
    expect(JSON.parse(output).name).toBe("garden-site");
    expect(readFileSync(join(scratch.outlines, ".artifacts/live/garden-site/assets/pixel.bin"))).toEqual(binary);
    symlinkSync(join(folder, "index.html"), join(folder, "linked.html"));
    const refused = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "artifact", "put", folder, "--name", "garden-site", "--ws", scratch.name], { env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe" });
    const [refusedCode, refusedError] = await Promise.all([refused.exited, new Response(refused.stderr).text(), new Response(refused.stdout).text()]);
    expect(refusedCode).toBe(1);
    expect(refusedError).toContain("without links");
    expect(readFileSync(join(scratch.outlines, ".artifacts/live/garden-site/index.html"), "utf8")).toBe("<h1>Moth garden</h1>");
    const call = async () => {
      const lines: string[] = [];
      await mcpCommand(["mcp"], { input: linesOf([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "artifact_put", arguments: { name: "mcp-garden", kind: "html", content: "<h1>Agent garden</h1>" } } })]), write: line => lines.push(line), err: line => lines.push(line) });
      return JSON.parse(lines[0]!).result;
    };
    await board.configureMcpAccess("read");
    expect((await call()).isError).toBe(true);
    expect(existsSync(join(scratch.outlines, ".artifacts/live/mcp-garden"))).toBe(false);
    await board.configureMcpAccess("full");
    expect((await call()).isError).not.toBe(true);
    expect(readFileSync(join(scratch.outlines, ".artifacts/live/mcp-garden/index.html"), "utf8")).toBe("<h1>Agent garden</h1>");
  }, 30_000);

  test("query_suggest records only with applied write access through the spawned MCP CLI", async () => {
    await board.request("create", { text: 'Query words [type::rule] [rule-name::query-words]\n[alias::seedlings=text~"Addressable seed"]' });
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "query_suggest", arguments: { text: "seedlings" } } };
    const call = async () => {
      const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "--ws", scratch.name, "mcp"], {
        env: { ...process.env, ...scratch.env }, stdin: new Blob([JSON.stringify(request) + "\n"]), stdout: "pipe", stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code, err).toBe(0);
      return JSON.parse(out.trim()).result;
    };
    for (const level of ["read", "propose"] as const) {
      await board.configureMcpAccess(level);
      expect((await call()).isError).toBe(true);
      expect((await board.queryNotes('type=suggestion component=query', 200, "show")).notes).toHaveLength(0);
    }
    await board.configureMcpAccess("full");
    const result = await call();
    expect(result.isError).not.toBe(true);
    const suggestion = JSON.parse(result.content[0].text);
    expect((await board.queryNotes(suggestion.where)).notes.map(b => b.id)).toContain(target.id);
    expect((await board.queryNotes('type=suggestion component=query', 200, "show")).notes.map(b => b.id)).toContain(suggestion.id);
  }, 30_000);

  test("MCP usage survives the server and reports bytes, redacted shapes and percentiles", async () => {
    await board.request("mcp.access.configure", { level: "read" });
    const state = join(scratch.root, "usage-state");
    const env = { ...process.env, ...scratch.env, EP0CH_STATE: state };
    const run = async (args: string[], input?: string) => {
      const p = Bun.spawn(["bun", resolve(import.meta.dir, "../src/main.ts"), "mcp", ...args], {
        env, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(code, err || out).toBe(0);
      return out;
    };
    mkdirSync(join(state, "mcp-usage"), { recursive: true });
    writeFileSync(join(state, "mcp-usage", "2000-01-01.jsonl"), "old measurements\n");
    await board.request("create", { parentId: null, text: "Rose beds [garden.zone::secret églantine]" });
    const req = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "outline_query", arguments: {
      query: 'garden.zone="secret églantine" OR garden.zone=hidden', fields: "id,title", limit: 3, sort: "updated",
    } } };
    const hello = { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "census-bot" } } };
    const output = (await run([], JSON.stringify(hello) + "\n" + JSON.stringify(req) + "\n")).trim().split("\n");
    await board.request("mcp.access.configure", { level: "none" });
    expect(JSON.parse(output[1]!).result.isError).not.toBe(true);
    // A separate process must see what the MCP server recorded before it exited.
    const report = JSON.parse(await run(["usage", "--since", "24h", "--by", "actor", "--json"]));
    expect(report.total.calls).toBe(1);
    const rows = readdirSync(join(state, "mcp-usage")).flatMap(f => readFileSync(join(state, "mcp-usage", f), "utf8").trim().split("\n").map(l => JSON.parse(l)));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ tool: "outline_query", outline: scratch.name, actor: `mcp:census-bot@${machine}`,
      requestBytes: Buffer.byteLength(JSON.stringify(req)), responseBytes: Buffer.byteLength(output[1]!),
      shape: { query: 'garden.zone=? OR garden.zone=?', fields: "id,title", limit: 3, sort: "updated" },
    });
    expect(JSON.stringify(row)).not.toContain("secret églantine");
    expect(JSON.stringify(row)).not.toContain("hidden");
    expect(row.requestTokens).toBe(row.requestBytes / 4);
    expect(row.responseTokens).toBe(row.responseBytes / 4);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.total.responseBytes).toEqual({ total: row.responseBytes, median: row.responseBytes, p90: row.responseBytes });
    expect(report.groups[0].key).toBe(row.actor);
    expect(await run(["usage", "--by", "tool"])).toContain("outline_query");
    expect(existsSync(join(state, "mcp-usage", "2000-01-01.jsonl"))).toBe(false);
    const batch = [
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "missing_tool", arguments: { where: '[garden.zone::hidden] AND child>=2:garden.zone=other AND links:[[secret [[nested]]]] AND text~"private words"' } } },
    ];
    const replies = JSON.parse((await run([], JSON.stringify(batch) + "\n")).trim());
    const sizes = [row.responseBytes, ...replies.map((r: unknown) => Buffer.byteLength(JSON.stringify(r)))].sort((a, b) => a - b);
    const all = JSON.parse(await run(["usage", "--by", "outline", "--json"]));
    expect(all.total.calls).toBe(3);
    expect(all.total.responseBytes).toEqual({ total: sizes[0] + sizes[1] + sizes[2], median: sizes[1], p90: sizes[2] });
    expect(all.groups[0].key).toBe(scratch.name);
    const last = readdirSync(join(state, "mcp-usage")).flatMap(f => readFileSync(join(state, "mcp-usage", f), "utf8").trim().split("\n").map(l => JSON.parse(l))).at(-1);
    expect(last.shape.where).toBe('garden.zone=? AND child>=?:garden.zone=? AND links:? AND text~?');
  }, 30_000);

  test("a recorded query shape keeps keys and never a value, parentheses inside a value included", () => {
    const shape = (where: string) => String(usageShape("outline_query", { where }).where);
    expect(shape("text~fern(private)")).not.toContain("private");
    expect(shape("(stage=doing OR stage=review) AND owner=wren")).toBe("(stage=? OR stage=?) AND owner=?");
  });

  test("the SQL census measures live blocks by latest actor and top-level branch", async () => {
    const root = await board.request<{ id: string }>("create", { parentId: null, text: "éé", author: "agent", provenance: { actorId: "census-gardener" } });
    await board.request("create", { parentId: root.id, text: "123456", author: "agent", provenance: { actorId: "census-gardener" } });
    const gone = await board.request<{ id: string }>("create", { parentId: root.id, text: "x".repeat(100), author: "agent", provenance: { actorId: "census-gardener" } });
    await board.request("delete", { blockId: gone.id });
    const result = await board.request<any>("blocks.census");
    expect(result.actors.find((a: any) => a.key === "census-gardener")).toMatchObject({ blocks: 2, characters: 8, median: 4, p90: 6 });
    expect(result.branches.find((a: any) => a.key === root.id)).toMatchObject({ blocks: 2, characters: 8, median: 4, p90: 6 });
    expect(result.outline.blocks).toBeGreaterThanOrEqual(2);
    const p = Bun.spawn(["bun", resolve(import.meta.dir, "../src/main.ts"), "mcp", "usage", "--census", "--ws", scratch.name, "--json"], {
      env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(code, err).toBe(0);
    expect(JSON.parse(out).census).toEqual(result);
  }, 30_000);

  test("requires an explicit outline MCP grant, then reads private blocks through the same envelope until revoked", async () => {
    const hiddenChild = await board.request<{ id: string }>("create", { parentId: target.id, text: "Private child\nVisible to local MCP after grant.", author: "agent" });
    const outDenied: string[] = [];
    const deniedCode = await mcpCommand(["mcp"], { input: linesOf([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "outline_read", arguments: { uri: publishedShell.uri } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: publishedShell.uri } }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "outline_find", arguments: { query: "Published shell", limit: 5 } } }),
    ]), write: line => outDenied.push(line), err: line => outDenied.push(`ERR ${line}`) });
    expect(deniedCode).toBe(0);
    const denied = outDenied.map(responseOf);
    expect(tool(denied[0]?.result).isError).toBe(true);
    expect(tool(denied[0]?.result).content[0]!.text).toContain("local MCP access is none");
    expect(denied[1]?.error?.message).toContain("local MCP access is none");
    expect(tool(denied[2]?.result).isError).toBe(true);

    const configured: string[] = [];
    expect(await mcpCommand(["mcp", "access", "read", "--json"], { input: linesOf([]), write: line => configured.push(line), err: line => configured.push(line) })).toBe(0);
    expect(JSON.parse(configured[0]!) as { level: string; canRead: boolean }).toMatchObject({ level: "read", canRead: true });
    // Reads to proposals adds the gateway's write tools: a connected client won't see them until it reconnects.
    const said: string[] = [];
    expect(await mcpCommand(["mcp", "access", "propose"], { input: linesOf([]), write: line => said.push(line), err: line => said.push(line) })).toBe(0);
    expect(said.join("\n")).toContain("reconnect it to see the write tools appear or go");
    said.length = 0;
    expect(await mcpCommand(["mcp", "access", "full"], { input: linesOf([]), write: line => said.push(line), err: line => said.push(line) })).toBe(0);
    expect(said.join("\n")).not.toContain("reconnect");
    expect(await mcpCommand(["mcp", "access", "read"], { input: linesOf([]), write: line => said.push(line), err: line => said.push(line) })).toBe(0);
    expect(said.join("\n")).toContain("reconnect");

    const out: string[] = [];
    const requests = [
      { jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2099-01-01" } },
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "outline_find", arguments: { query: "Private seed", limit: 5 } } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri } } },
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "outline_links", arguments: { ref: `((${target.id}))` } } },
      { jsonrpc: "2.0", id: 9, method: "resources/read", params: { uri: privateNote.uri } },
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "outline_read", arguments: { uri: target.uri.replace(`@${machine}`, "@elsewhere") } } },
      { jsonrpc: "2.0", id: 11, method: "ping" },
      { jsonrpc: "1.0", id: 12, method: "tools/list" },
      [{ jsonrpc: "2.0", id: 13, method: "resources/list" }, { jsonrpc: "2.0", method: "tools/list" }, { jsonrpc: "2.0", id: 14, method: "nope" }],
      { jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "outline_read", arguments: { uri: publishedShell.uri } } },
      // Another outline's URI in a ref (spaces around it too) is refused, never read by its id here.
      { jsonrpc: "2.0", id: 18, method: "tools/call", params: { name: "outline_links", arguments: { ref: `  ${target.uri.replace(`${scratch.name}@`, "other-garden@")}` } } },
      { jsonrpc: "2.0", id: 19, method: "tools/call", params: { name: "outline_read", arguments: { ref: target.uri.replace(`${scratch.name}@`, "other-garden@") } } },
      { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "list_outlines", arguments: {} } },
    ].map(r => JSON.stringify(r));
    const remote = join(scratch.outlines, ".remote");
    mkdirSync(remote, { recursive: true });
    const away = join(remote, "laptop.sock");
    symlinkSync(join(scratch.root, "absent.sock"), away);
    const code = await mcpCommand(["mcp"], { input: linesOf(requests), write: line => out.push(line), err: line => out.push(`ERR ${line}`) }).finally(() => rmSync(away));
    expect(code).toBe(0);
    const responses = out.map(line => JSON.parse(line) as RpcResponse | RpcResponse[]);
    const flat = responses.flatMap(r => Array.isArray(r) ? r : [r]);
    const response = (id: number) => flat.find(r => r.id === id);
    expect(fields(response(4)?.result).serverInfo).toMatchObject({ name: "ep0ch" });
    expect(fields(response(4)?.result).protocolVersion).toBe("2025-11-25");
    const listed = fields(response(5)?.result).tools as { name: string; inputSchema?: any }[];
    expect(listed.map(t => t.name)).not.toContain("outline_patch");
    expect(listed.find(t => t.name === "outline_read")!.inputSchema.oneOf).toEqual([{ required: ["ref"] }, { required: ["uri"] }]);

    const find = JSON.parse(tool(response(6)?.result).content[0]!.text) as { matches: { id: string; uri: string }[] };
    expect(find.matches).toContainEqual(expect.objectContaining({ id: privateNote.id, uri: privateNote.uri }));

    const read = JSON.parse(tool(response(7)?.result).content[0]!.text) as { uri: string; outlineInstanceId: string; revision: number; reachability: { status: string; level: string }; record: { id: string; body: string; backlinks: string[]; children: string[] } };
    expect(read).toMatchObject({ uri: target.uri, outlineInstanceId: expect.any(String), revision: expect.any(Number), reachability: { status: "reachable", level: "read" }, record: { id: target.id, body: expect.stringContaining("Ready for local tools") } });
    expect(read.record.backlinks).toContain(source.id);
    expect(read.record.children).toContain(hiddenChild.id);

    const links = JSON.parse(tool(response(8)?.result).content[0]!.text) as { away: { machine: string }[]; backlinks: { blockId: string }[]; reachability: { status: string; level: string } };
    expect(links.reachability).toMatchObject({ status: "reachable", level: "read" });
    expect(links.backlinks.map(b => b.blockId)).toContain(source.id);
    expect(links.away).toContainEqual({ machine: "laptop" });

    const resource = fields(response(9)?.result) as { uri: string; outlineInstanceId: string; revision: number; reachability: { status: string; level: string }; record: { id: string; body: string }; contents: { uri: string; text: string }[] };
    expect(resource).toMatchObject({ uri: privateNote.uri, outlineInstanceId: expect.any(String), revision: expect.any(Number), reachability: { status: "reachable", level: "read" }, record: { id: privateNote.id, body: expect.stringContaining("Private seed") }, contents: [{ uri: privateNote.uri, text: expect.stringContaining("Private seed") }] });

    const wrongOutline = tool(response(10)?.result);
    expect(wrongOutline.isError).toBe(true);
    expect(wrongOutline.content[0]!.text).toContain("this MCP server is bound to");
    expect(fields(response(11)?.result)).toEqual({});
    expect(response(12)?.error?.message).toContain("jsonrpc");
    const batch = responses.find(Array.isArray) as RpcResponse[];
    expect(batch.map(r => r.id)).toEqual([13, 14]);
    const listedResources = fields(batch[0]!.result).resources as { uri: string }[];
    expect(listedResources.map(r => r.uri)).toContain(`ep0ch://${scratch.name}@${machine}/components/heading-style`);
    expect(batch[1]!.error?.message).toContain("Method not found");
    for (const id of [18, 19]) {
      expect(tool(response(id)?.result).isError).toBe(true);
      expect(tool(response(id)?.result).content[0]!.text).toContain(`names other-garden@${machine}; this MCP server is bound to ${scratch.name}@${machine}`);
    }
    // The bound outline is the one this server lists: live, read now, with its access setting.
    expect(JSON.parse(tool(response(20)?.result).content[0]!.text)).toEqual({ outlines: [{ outline: scratch.name, machine, uri: `ep0ch://${scratch.name}@${machine}`, source: "live", asOf: expect.any(String), access: "read" }], call: expect.objectContaining({ id: expect.stringMatching(/^c-[0-9a-f]{10}$/) }), tools: { writes: false, said: expect.stringContaining("only the read tools are offered") } });
    expect(JSON.parse(tool(response(7)?.result).content[0]!.text).reachability).toMatchObject({ source: "live", asOf: expect.any(String) });
    const publishedRead = JSON.parse(tool(response(15)?.result).content[0]!.text) as { record: { links: string[] } };
    expect(publishedRead.record.links).toContain(privateNote.id);

    const revoked: string[] = [];
    const revokingInput = (async function* () {
      yield JSON.stringify({ jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "outline_read", arguments: { uri: privateNote.uri } } });
      while (revoked.length < 1) await Bun.sleep(10);
      await board.request("mcp.access.configure", { level: "none" });
      yield JSON.stringify({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "outline_read", arguments: { uri: privateNote.uri } } });
    })();
    expect(await mcpCommand(["mcp"], { input: revokingInput, write: line => revoked.push(line), err: line => revoked.push(`ERR ${line}`) })).toBe(0);
    const revokedResponses = revoked.map(responseOf);
    expect(JSON.parse(tool(revokedResponses[0]?.result).content[0]!.text)).toMatchObject({ reachability: { status: "reachable" } });
    expect(tool(revokedResponses[1]?.result).isError).toBe(true);
    expect(tool(revokedResponses[1]?.result).content[0]!.text).toContain("local MCP access is none");
  }, 30_000);

  test("rejects unsupported mcp command arguments before opening a board", async () => {
    const out: string[] = [];
    const code = await mcpCommand(["mcp", "--machin", "box-a"], { input: linesOf([]), write: line => out.push(line), err: line => out.push(line) });
    expect(code).toBe(2);
    expect(out[0]).toContain("mcp doesn't take");
  }, 30_000);

  describe("one security model: the stdio server writes by the same access levels as the gateway", () => {
    const stdio = async (messages: unknown[]) => {
      const out: string[] = [];
      expect(await mcpCommand(["mcp"], { input: linesOf(messages.map(m => JSON.stringify(m))), write: line => out.push(line), err: line => out.push(`ERR ${line}`) })).toBe(0);
      return out.map(l => JSON.parse(l) as RpcResponse);
    };
    const hello = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", clientInfo: { name: "claude-desktop", version: "1" } } };
    const names = (r: RpcResponse | undefined) => (fields(r?.result).tools as { name: string }[]).map(t => t.name);
    const setAccess = (level: string) => mcpCommand(["mcp", "access", level], { input: linesOf([]), write: () => {}, err: () => {} });
    const called = (r: RpcResponse | undefined) => { const t = tool(r?.result); return { isError: !!t.isError, json: (() => { try { return JSON.parse(t.content[0]!.text); } catch { return null; } })(), text: t.content[0]!.text }; };
    const patch = (id: number, revision: number, observed: string, replacement: string) =>
      ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "outline_patch", arguments: { uri: target.uri, revision, patches: [{ observed, replacement }] } } });
    const revisionOf = async () => (await board.records([target.id])).records[0]!.revision;

    test("none and read offer no write tools and refuse a write; propose makes proposals; full applies, as mcp:<client>", async () => {
      await setAccess("none");
      expect(names((await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/list" }])).find(r => r.id === 2))).not.toContain("outline_patch");
      await setAccess("read");
      const readOnly = await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/list" }, patch(3, await revisionOf(), "Ready for local tools", "Ready")]);
      expect(names(readOnly.find(r => r.id === 2))).toContain("outline_read");
      expect(names(readOnly.find(r => r.id === 2))).not.toContain("outline_patch");
      expect(called(readOnly.find(r => r.id === 3)).isError).toBe(true);

      await setAccess("propose");
      const proposed = await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/list" }, patch(3, await revisionOf(), "Ready for local tools", "Ready for stdio proposals")]);
      expect(names(proposed.find(r => r.id === 2))).toContain("outline_patch");
      expect(called(proposed.find(r => r.id === 3)).json).toMatchObject({ outcome: "proposed" });
      expect((await board.records([target.id])).records[0]!.text).toContain("Ready for local tools");

      await setAccess("full");
      const full = await stdio([hello, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "outline_create", arguments: { uri: target.uri, text: "Written over stdio" } } }, patch(5, await revisionOf(), "Ready for local tools", "Ready for stdio writes")]);
      const made = called(full.find(r => r.id === 4)).json;
      expect(made.outcome).toBe("applied");
      expect(called(full.find(r => r.id === 5)).json).toMatchObject({ outcome: "applied", machine });
      expect((await board.records([target.id])).records[0]!.text).toContain("Ready for stdio writes");
      const child = (await board.records([made.uri.split("/b/")[1]])).records[0]!;
      expect(child).toMatchObject({ author: "agent", actor: `mcp:claude-desktop@${machine}` });
      // A stale write is an actionable error over stdio too, without a proposal or overwrite.
      const stale = await stdio([hello, patch(6, 1, "Ready for stdio writes", "Overwritten")]);
      expect(called(stale.find(r => r.id === 6)).isError).toBe(true);
      expect(called(stale.find(r => r.id === 6)).text).toContain("read it again and send the patch against the new text");
      expect((await board.records([target.id])).records[0]!.text).not.toContain("Overwritten");
      await setAccess("read");
    }, 60_000);

    test("scripts, the mod CLI and MCP patch the same note with each writer attributed", async () => {
      // The outliner owns its type-check configuration, as with the gateway's agent-tools import.
      const hostApiModule = "@ep0ch/outliner/host-api";
      const { hostApi } = await import(hostApiModule);
      const api = hostApi({
        request: <T>({ action, ...rest }: { action: string } & Record<string, unknown>) => board.request<T>(action, rest),
        requireCompatibleService: () => board.info(),
      }, { actorId: "garden-script", sessionId: "script-run" });
      const made = await api.tool.outline_create!({ parent: "root", text: "Seed ledger\nBring labels." }) as { id: string };
      const record = async () => (await board.records([made.id])).records[0]!;
      const edit = async (observed: string, replacement: string) => ({ ref: made.id, revision: (await record()).revision, patches: [{ observed, replacement }] });
      await api.tool.outline_patch!(await edit("Bring labels.", "Bring twine."));
      expect(await record()).toMatchObject({ text: "Seed ledger\nBring twine.", author: "agent", actor: "garden-script" });

      const command = OUTLINE_TOOLS.find(t => t.name === "outline_patch")!.command(await edit("Bring twine.", "Bring pots."));
      if (typeof command === "string") throw new Error(command);
      const child = Bun.spawn(["bun", "src/cli.ts", "agent", command.operation, "--json", JSON.stringify(command.input), "--actor", "garden-mod"], {
        cwd: outliner!, env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code, stderr || stdout).toBe(0);
      expect(await record()).toMatchObject({ text: "Seed ledger\nBring pots." });

      await setAccess("full");
      try {
        const response = await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "outline_patch", arguments: await edit("Bring pots.", "Bring seeds.") } }]);
        expect(called(response.find(r => r.id === 2))).toMatchObject({ isError: false, json: { outcome: "applied" } });
        expect(await record()).toMatchObject({ text: "Seed ledger\nBring seeds." });
        for (const actorId of ["garden-script", "garden-mod", `mcp:claude-desktop@${machine}`]) {
          const activity = await board.request<{ entries: { block: { id: string }; actorId?: string }[] }>("activity.recent", { since: "2000-01-01T00:00:00.000Z", author: "agent", actorId, limit: 100, kinds: ["text"] });
          expect(activity.entries).toContainEqual(expect.objectContaining({ block: expect.objectContaining({ id: made.id }), actorId }));
        }
      } finally { await setAccess("read"); }
    }, 60_000);

    test("scripts, the mod CLI and MCP settle proposals without a reader", async () => {
      const module = "@ep0ch/outliner/host-api";
      const { hostApi } = await import(module);
      const api = hostApi({ request: <T>({ action, ...rest }: { action: string } & Record<string, unknown>) => board.request<T>(action, rest), requireCompatibleService: () => board.info() }, { actorId: "garden-mod" });
      const make = async (actorId: string) => {
        const note = await board.request<any>("create", { parentId: null, text: "Seed plan\nPlant beans." });
        const p = await board.request<any>("draft.patch", { blockId: note.id, revision: note.revision,
          patches: [{ observed: "Plant beans.", replacement: "Plant peas." }], propose: true, mutation: { author: "agent", actorId } });
        return { note, id: p.proposalId as string };
      };
      for (const op of ["dismiss", "apply"]) {
        const name = `outline_proposal_${op}`;
        const script = await make("garden-mod");
        expect(await api.call(name, { ref: script.id })).toMatchObject({ outcome: op === "apply" ? "applied" : "dismissed" });
        const mod = await make("garden-mod");
        const command = OUTLINE_TOOLS.find(t => t.name === name)!.command({ ref: mod.id });
        if (typeof command === "string") throw new Error(command);
        const child = Bun.spawn(["bun", "src/cli.ts", "agent", command.operation, "--json", JSON.stringify(command.input), "--actor", "garden-mod"], { cwd: outliner!, env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(code, stderr || stdout).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ outcome: op === "apply" ? "applied" : "dismissed" });
        await setAccess("full");
        const remote = await make(`mcp:claude-desktop@${machine}`);
        await setAccess("propose");
        const denied = await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: { ref: remote.id, outline: scratch.name } } }]);
        expect(called(denied.find(r => r.id === 2))).toMatchObject({ isError: true });
        expect(prop((await board.get(remote.id))!, "proposal-status")).toBe("open");
        await setAccess("full");
        const response = await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: { ref: remote.id, outline: scratch.name } } }]);
        expect(called(response.find(r => r.id === 2))).toMatchObject({ isError: false, json: { outcome: "applied" } });
        expect(prop((await board.get(remote.id))!, "proposal-status")).toBe(op === "apply" ? "applied" : "dismissed");
        expect((await board.get(remote.note.id))!.text).toContain(op === "apply" ? "Plant peas." : "Plant beans.");
      }
      const other = await make("another-agent");
      // Another agent's proposal: any agent may settle it (Evan, Oct 17), recorded as the one who did.
      expect(await api.call("outline_proposal_dismiss", { ref: other.id })).toMatchObject({ outcome: "dismissed" });
      expect((await board.get(other.id))!.deleted).toBe(true);
      await setAccess("read");
    }, 60_000);

    test("EP0CH_MCP_PERSONAS maps the principal (the client on this machine) to a persona", async () => {
      await setAccess("full");
      const was = process.env.EP0CH_MCP_PERSONAS;
      process.env.EP0CH_MCP_PERSONAS = `claude-desktop@${machine}=desk`;
      try {
        const r = await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "outline_create", arguments: { uri: target.uri, text: "Named by persona" } } }]);
        const child = (await board.records([called(r.find(x => x.id === 2)).json.uri.split("/b/")[1]])).records[0]!;
        expect(child.actor).toBe(`mcp:desk/claude-desktop@${machine}`);
        const childProcess = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "mcp"], {
          env: { ...process.env, ...scratch.env },
          stdin: new Blob([[hello, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "outline_create", arguments: { uri: target.uri, text: "Scout's tray over stdio", persona: "scout" } } }].map(m => JSON.stringify(m)).join("\n") + "\n"]),
          stdout: "pipe", stderr: "pipe",
        });
        const [output, error, code] = await Promise.all([new Response(childProcess.stdout).text(), new Response(childProcess.stderr).text(), childProcess.exited]);
        expect({ code, error }).toEqual({ code: 0, error: "" });
        const receipt = called(output.trim().split("\n").map(line => JSON.parse(line) as RpcResponse).find(x => x.id === 3));
        expect(receipt.json.by).toBe(`scout (claude-desktop@${machine})`);
        expect((await board.records([receipt.json.uri.split("/b/")[1]])).records[0]!.actor).toBe(`mcp:scout/claude-desktop@${machine}`);
      } finally { if (was === undefined) delete process.env.EP0CH_MCP_PERSONAS; else process.env.EP0CH_MCP_PERSONAS = was; await setAccess("read"); }
    }, 30_000);

    test("stdio and the HTTP gateway list the same tools for the same grant and caller, at every level", async () => {
      const sock = scratch.sock;
      const gateway = machineOutlines(scratch.name, () => {}, async () => Object.assign(new SocketBoard(sock), { address: { outline: scratch.name, machine } }) as any, [], async () => [scratch.name], undefined, undefined, localAdmin());
      try {
        for (const level of ["none", "read", "propose", "full"]) {
          await setAccess(level);
          const viaStdio = names((await stdio([hello, { jsonrpc: "2.0", id: 2, method: "tools/list" }])).find(r => r.id === 2));
          const viaHttp = names((await answerMcp(gateway, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), { sub: "user_fictional_a", clientId: "claude-desktop" }))!.reply as RpcResponse);
          expect(viaStdio, level).toEqual(viaHttp);
          expect(viaStdio.includes("outline_patch"), level).toBe(level === "propose" || level === "full");
        }
      } finally { gateway.close(); await setAccess("read"); }
    }, 60_000);
  });
});
