// An extension reaching another outline (PIE-779): on this host, held to that outline's access level once its owner set
// one; on another machine, relayed through the shared ssh forward (the fake ssh here) and held there, where a level
// never set is none. A scratch outline host with three made-up outlines and a made-up extension, "poker".
import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlineHost } from "../src/outline-host";
import type { Block } from "../src/types";

const OUTLINE_TS = join(import.meta.dir, "..", "extensions", "almanac", "outline.ts");

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function send<T>(socket: string, request: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("error", reject);
    connection.once("connect", () => connection.write(`${JSON.stringify({ id: crypto.randomUUID(), ...request })}\n`));
    connection.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      connection.destroy();
      const response = JSON.parse(buffer.slice(0, end)) as { ok: boolean; result?: T; error?: string };
      if (response.ok) resolve(response.result as T);
      else reject(new Error(response.error));
    });
  });
}

/** The poker reads, comments on and creates in the outline its target.json names, and says which of them worked. */
const POKER = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outline } from "./outline";
const target = JSON.parse(readFileSync(join(import.meta.dir, "target.json"), "utf8"));
const tries: Record<string, string> = {};
const attempt = async (name: string, run: () => Promise<unknown>) => { try { await run(); tries[name] = "ok"; } catch (e) { tries[name] = String((e as Error).message); } };
const [note] = (await outline<{ blocks: Array<{ id: string; revision: number }> }>({ action: "blocks.query", query: { where: "type=recon" } }, target).catch(() => ({ blocks: [] }))).blocks;
await attempt("read", () => outline({ action: "blocks.query", query: { where: "type=recon" } }, target));
await attempt("comment", () => outline({ action: "annotations.batch", requestId: crypto.randomUUID(), operations: [{ operationId: "c", type: "block-comment", input: { blockId: note?.id, expectedRevision: note?.revision, body: "hi", source: "agent" } }] }, target));
await attempt("create", () => outline({ action: "create", text: "from the cafe" }, target));
// Refusals run longer than an answer's message may: they go to a file beside it.
await Bun.write(join(import.meta.dir, "tries.json"), JSON.stringify(tries));
process.stdout.write(JSON.stringify({ ok: true, value: { message: "poked" } }));
`;

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ext-cross-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  const userExtensions = join(root, "user-extensions");
  const folder = join(userExtensions, "poker");
  mkdirSync(folder, { recursive: true });
  cpSync(OUTLINE_TS, join(folder, "outline.ts"));
  writeFileSync(join(folder, "poker.ts"), POKER);
  writeFileSync(join(folder, "extension.json"), JSON.stringify({
    contract: 2, id: "poker", version: 1, name: "Poker", description: "Reaches into another outline", run: ["bun", "poker.ts"],
    actions: [{ id: "poke", label: "Poke", on: "outline", effects: "write" }],
  }));
  process.env.OUTLINER_EXTENSIONS_DIR = userExtensions;
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlines = outlineLayout(join(root, "outlines"));
  const host = new OutlineHost({ outlinesFolder: outlines.root, log: () => {} });
  await host.start();
  cleanups.push(async () => {
    await host.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const call = <T>(outline: string, request: Record<string, unknown>) => send<T>(host.socketPath, { outline, ...request });
  for (const name of ["shack", "cafe"]) await send(host.socketPath, { action: "outlines.create", name });
  await call("cafe", { action: "extensions.list", reload: true });
  const machine = (await call<{ machine: string }>("cafe", { action: "notes.address" })).machine;
  const aim = (target: { outline: string; machine?: string }) => writeFileSync(join(folder, "target.json"), JSON.stringify(target));
  const poke = async () => {
    await call("cafe", { action: "extensions.act", extension: "poker", extensionAction: "poke", mutation: { author: "user" } });
    return JSON.parse(readFileSync(join(folder, "tries.json"), "utf8")) as Record<string, string>;
  };
  const access = (outline: string, level: string) => call(outline, { action: "mcp.access.configure", level });
  const create = (outline: string, text: string) => call<Block>(outline, { action: "create", text, author: "user" });
  return { root, outlines: outlines.root, call, machine, aim, poke, access, create };
}

/**
 * A second machine, `box-b`: an outline host in a scratch folder of its own, reached through the fake ssh
 * (test/fake-ssh.ts as EP0CH_SSH), its outlines folder named in this machine's `.remote/box-b.json`.
 */
async function farMachine(root: string, outlines: string) {
  const far = join(root, "far");
  for (const dir of ["home", "outlines", "bin"]) mkdirSync(join(far, dir), { recursive: true, mode: 0o700 });
  mkdirSync(join(outlines, ".remote"), { recursive: true, mode: 0o700 });
  writeFileSync(join(outlines, ".remote", "box-b.json"), JSON.stringify({ outlines: join(far, "outlines") }));
  writeFileSync(join(far, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "fake-ssh.ts")} "$@"\n`);
  chmodSync(join(far, "bin", "ssh"), 0o755);
  const vars = { EP0CH_SSH: join(far, "bin", "ssh"), FAKE_SSH_HOME: join(far, "home"), FAKE_SSH_OUTLINES: join(far, "outlines"), FAKE_SSH_BIN: join(far, "bin") };
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const host = new OutlineHost({ outlinesFolder: join(far, "outlines"), log: () => {} });
  await host.start();
  cleanups.push(async () => {
    try { process.kill(Number(readFileSync(join(outlines, ".remote", "box-b.ctl"), "utf8"))); } catch { /* not running */ }
    await host.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const call = <T>(outline: string, request: Record<string, unknown>) => send<T>(host.socketPath, { outline, ...request });
  return { call, socket: host.socketPath };
}

test("another outline's extension is held to this outline's access level once its owner set one; its own never is", async () => {
  const { aim, poke, access, create } = await setup();
  aim({ outline: "shack" });
  await create("shack", "Recon: the shed's cert [type::recon]");
  // Never set: open to the host's extensions.
  expect(await poke()).toEqual({ read: "ok", comment: "ok", create: "ok" });
  await access("shack", "propose");
  expect(await poke()).toMatchObject({ read: "ok", comment: "ok", create: expect.stringContaining("ext:poker runs for cafe, and shack grants other outlines propose: create needs full (its owner runs `ep0ch mcp access full --ws shack`)") });
  await access("shack", "read");
  expect(await poke()).toMatchObject({ read: "ok", comment: expect.stringContaining("annotations.batch needs propose") });
  await access("shack", "none");
  expect(await poke()).toMatchObject({ read: expect.stringContaining("needs read") });
  // Its own outline is never checked.
  aim({ outline: "cafe" });
  await create("cafe", "Recon: the cafe's own [type::recon]");
  await access("cafe", "none");
  expect(await poke()).toEqual({ read: "ok", comment: "ok", create: "ok" });
}, 60_000);

test("another machine: the request goes through the ssh forward, as the extension from its node, and that outline's level holds there", async () => {
  const { root, outlines, machine, aim, poke } = await setup();
  const far = await farMachine(root, outlines);
  await send(far.socket, { action: "outlines.create", name: "field" });
  const hedge = await far.call<Block>("field", { action: "create", text: "Recon: the hedge flowers late [type::recon]", author: "user" });
  aim({ outline: "field", machine: "box-b" });

  // Never set is none across machines, held by the field's own host.
  expect(await poke()).toMatchObject({ read: expect.stringContaining(`ext:poker@cafe@${machine} runs for cafe@${machine}, and field grants other outlines none: blocks.query needs read`) });
  await far.call("field", { action: "mcp.access.configure", level: "propose" });
  expect(await poke()).toMatchObject({ read: "ok", comment: "ok", create: expect.stringContaining("create needs full") });
  const threads = await far.call<Array<{ body: string; block: Block }>>("field", { action: "annotations.list", query: { subject: { kind: "block", blockId: hedge.id } } });
  expect(threads.map((t) => [t.body, t.block.actorId])).toEqual([["hi", `ext:poker@cafe@${machine}`]]);
  await far.call("field", { action: "mcp.access.configure", level: "full" });
  expect(await poke()).toEqual({ read: "ok", comment: "ok", create: "ok" });

  // Asked directly, as another machine's host would: host management, secrets and a read-only call's write are refused.
  const relayed = { extension: "poker", node: `cafe@${machine}`, label: "ext.poker.poke", writes: true };
  await expect(send(far.socket, { action: "outlines.delete", name: "field", relayed })).rejects.toThrow("is the host's");
  await expect(far.call("field", { action: "secrets.group", group: "anything", relayed })).rejects.toThrow("runs on another machine");
  await expect(far.call("field", { action: "create", text: "from the cafe", relayed: { ...relayed, writes: false } })).rejects.toThrow("only reads");
}, 90_000);

test("a machine that can't be reached is refused with why, so the extension can try again next run", async () => {
  const { root, outlines, aim, poke } = await setup();
  await farMachine(root, outlines);
  aim({ outline: "field", machine: "box-b" });
  process.env.FAKE_SSH_DOWN = "1";
  try {
    expect((await poke()).read).toMatch(/box-b/);
  } finally {
    delete process.env.FAKE_SSH_DOWN;
  }
}, 60_000);
