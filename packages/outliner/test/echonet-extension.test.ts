// EchoNet's tosser (spike/echonet), end to end: a scratch outline host serving three made-up outlines (a shack, a cafe
// and an attic), the repo's extensions/echonet copied into its user folder, areas and subscriptions between them, and
// tosses driven by hand. Every note is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlineHost } from "../src/outline-host";
import type { Block } from "../src/types";

const EXTENSION = join(import.meta.dir, "..", "extensions", "echonet");

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

interface Thread { block: Block; body: string; properties?: Record<string, string[]>; replies: Array<{ block: Block; body: string; properties?: Record<string, string[]> }> }

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "echonet-ext-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  const userExtensions = join(root, "user-extensions");
  cpSync(EXTENSION, join(userExtensions, "echonet"), { recursive: true });
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
  const socket = host.socketPath;
  const call = <T>(outline: string, request: Record<string, unknown>) => send<T>(socket, { outline, ...request });
  for (const name of ["shack", "cafe", "attic"]) {
    await send(socket, { action: "outlines.create", name });
    const listed = await call<{ extensions: Array<{ id: string; state: string; error?: string }> }>(name, { action: "extensions.list", reload: true });
    expect(listed.extensions.find((entry) => entry.id === "echonet")).toMatchObject({ state: "active" });
  }
  const machine = (await call<{ machine: string }>("cafe", { action: "notes.address" })).machine;
  const toss = (outline: string) =>
    call<{ message: string }>(outline, { action: "extensions.act", extension: "echonet", extensionAction: "toss", mutation: { author: "user" } }).then((r) => r.message);
  const create = (outline: string, text: string, parentId?: string) => call<Block>(outline, { action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const get = (outline: string, blockId: string) => call<Block>(outline, { action: "get", blockId });
  const children = (outline: string, parentId: string) => call<Block[]>(outline, { action: "children", parentId });
  const threads = (outline: string, blockId: string) =>
    call<Thread[]>(outline, { action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
  const comment = async (outline: string, block: Block, body: string, quote?: string, source = "user") => {
    const receipt = await call<{ annotations: Array<{ block: Block }> }>(outline, {
      action: "annotations.batch", requestId: crypto.randomUUID(), author: "user",
      operations: [{ operationId: "c", type: "block-comment", input: { blockId: block.id, expectedRevision: block.revision, body, source, ...(quote ? { passage: { quote } } : {}) } }],
    });
    return receipt.annotations[0]!.block;
  };
  const reply = (outline: string, annotationId: string, body: string) =>
    call(outline, { action: "annotations.reply", requestId: crypto.randomUUID(), author: "user", input: { annotationId, body, source: "user" } });
  const access = (outline: string, level: string) => call(outline, { action: "mcp.access.configure", level });
  const config = async (value: Record<string, unknown>) => {
    writeFileSync(join(userExtensions, "echonet", "config.json"), JSON.stringify({ config: value }));
    await call("cafe", { action: "extensions.list", reload: true });
  };
  return { socket, call, machine, toss, create, get, children, threads, comment, reply, access, config };
}

test("a subscription copies an area's messages once, keeps a trashed copy trashed, marks newer upstream and leaves seen-by on the original", async () => {
  const { call, machine, toss, create, get, children, threads, access } = await setup();
  await access("shack", "propose");
  await create("shack", "Recon areas [type::echo-area] [echo::recon] [query::type=recon]");
  const cron = await create("shack", "Recon: flaky cron on larder [type::recon]\n\nJitter of 40s, see ((00000000-0000-4000-8000-000000000001|the old note)).");
  await create("shack", "Recon: disk on kettle [type::recon] [page::kettle-disk]");
  const queue = await create("shack", "Recon: queue drops on restart [type::recon] [from::karen]\n\nIn the log: `((00000000-0000-4000-8000-000000000002))` and `[page::not-a-page]`.");
  await create("shack", "repro: send 50, restart at 25 [type::recon]", queue.id);
  await create("shack", "A task, not recon [type::task]");
  const sub = await create("cafe", `Recon from the shack [type::echo-sub] [subscribe::shack@${machine}] [echo::recon]`);

  expect(await toss("cafe")).toContain("copies 3");
  let copies = await children("cafe", sub.id);
  expect(copies.map((copy) => copy.text.split("\n")[0])).toEqual([
    expect.stringMatching(new RegExp(`^Recon: flaky cron on larder \\[type::recon\\] \\[from::shack@${machine}/${cron.id}\\] \\[echo::recon\\] \\[from-rev::1\\] \\[tossed::`)),
    expect.stringContaining("[from-page::kettle-disk]"),
    `Recon: queue drops on restart [type::recon] [source-from::karen] [from::shack@${machine}/${queue.id}] [echo::recon] [from-rev::1] [tossed::${copies[2]!.text.match(/\[tossed::([^\]]+)\]/)![1]}]`,
  ]);
  // Code is literal; the note under a message is a copy too (with its own from), so it isn't copied again on its own.
  expect(copies[2]!.text).toEndWith("In the log: `((00000000-0000-4000-8000-000000000002))` and `[page::not-a-page]`.");
  expect((await children("cafe", copies[2]!.id))[0]!.text).toStartWith("repro: send 50, restart at 25 [type::recon] [from::shack@");
  // A reference into the origin becomes an ep0ch:// link into it.
  expect(copies[0]!.text).toContain(`[the old note](ep0ch://shack@${machine}/b/00000000-0000-4000-8000-000000000001)`);
  // Seen-by: a mark on the original, its text untouched.
  expect((await get("shack", cron.id)).revision).toBe(1);
  expect((await threads("shack", cron.id)).map((thread) => [thread.body, thread.properties?.kind])).toEqual([[`also in: cafe@${machine} (Recon from the shack)`, ["echo-seen-by"]]]);

  // Again: nothing new. Trash one copy, edit the other's original: the trashed one stays trashed, the other is marked.
  expect(await toss("cafe")).toContain("copies 0");
  await call("cafe", { action: "delete", blockId: copies[1]!.id, author: "user" });
  const edited = await get("shack", cron.id);
  await call("shack", { action: "update", blockId: cron.id, expectedRevision: edited.revision, text: `${edited.text}\nNow 90s.`, author: "user" });
  expect(await toss("cafe")).toContain("copies 0, newer 1, skipped 1");
  copies = await children("cafe", sub.id);
  expect(copies).toHaveLength(2);
  expect(copies[0]!.text).toContain("[upstream-newer::2]");
  expect(copies[0]!.text).not.toContain("Now 90s.");
  expect((await threads("shack", cron.id)).filter((thread) => thread.properties?.kind?.includes("echo-seen-by"))).toHaveLength(1);

  // The nodelist and the toss log.
  const nodelist = (await call<{ blocks: Block[] }>("cafe", { action: "blocks.query", query: { where: "type=nodelist" } })).blocks[0]!;
  expect(nodelist.text).toContain(`## shack@${machine}`);
  expect(nodelist.text).toContain("reachable · access propose · we read its recon");
  const logs = (await children("cafe", nodelist.id)).filter((block) => block.text.includes("[type::toss]"));
  expect(logs).toHaveLength(3);
  // The origin's own nodelist knows the cafe reads it.
  await toss("shack");
  const shackList = (await call<{ blocks: Block[] }>("shack", { action: "blocks.query", query: { where: "type=nodelist" } })).blocks[0]!;
  expect(shackList.text).toContain(`## cafe@${machine}`);
  expect(shackList.text).toContain("reads our areas");
}, 60_000);

test("netmail: a mark on a copy reaches the original, replies come back, nothing loops; read access and offline hold it", async () => {
  const { call, machine, toss, create, get, children, threads, comment, reply, access, config } = await setup();
  await access("shack", "propose");
  await access("attic", "read");
  await create("shack", "Recon areas [type::echo-area] [echo::recon] [query::type=recon]");
  const cron = await create("shack", "Recon: flaky cron on larder [type::recon]\n\nThe jitter is forty seconds.");
  await create("attic", "Quotes [type::echo-area] [echo::quotes] [query::type=quote]");
  const quote = await create("attic", "On queues [type::quote]\n\n> A queue that forgets on restart is a wish.");
  const recon = await create("cafe", `Recon from the shack [type::echo-sub] [subscribe::shack@${machine}] [echo::recon]`);
  const quotes = await create("cafe", `Quotes from the attic [type::echo-sub] [subscribe::attic@${machine}] [echo::quotes]`);
  await toss("cafe");
  const copy = (await children("cafe", recon.id))[0]!;
  const quoteCopy = (await children("cafe", quotes.id))[0]!;
  // The attic grants read: copied, but no seen-by.
  expect(quoteCopy.text).toContain(`[from::attic@${machine}/${quote.id}]`);
  expect(await threads("attic", quote.id)).toEqual([]);

  const mark = await comment("cafe", copy, "is it the NTP drift again?", "forty seconds");
  await comment("cafe", quoteCopy, "", "forgets on restart");
  // The shack's lid is shut: queued, nothing lost.
  await config({ offline: [`shack@${machine}`] });
  const offline = await toss("cafe");
  expect(offline).toContain("queued 2");
  expect((await threads("shack", cron.id)).filter((thread) => thread.properties?.["netmail-from"])).toEqual([]);

  await config({});
  expect(await toss("cafe")).toContain("netmail out 1, in 0, queued 1");
  const there = (await threads("shack", cron.id)).find((thread) => thread.properties?.["netmail-from"])!;
  expect(there.body).toBe("is it the NTP drift again?");
  expect(there.properties).toMatchObject({ via: [`echonet:cafe@${machine}`], "netmail-from": [`cafe@${machine}/${mark.id}`], "netmail-author": ["user"] });
  // A reply in the shack comes back into the copy's thread; a reply in the cafe goes out; neither comes back again.
  await reply("shack", there.block.id, "no, it's the backup window");
  await reply("cafe", mark.id, "then move the window");
  expect(await toss("cafe")).toContain("netmail out 1, in 1");
  expect(await toss("cafe")).toContain("netmail out 0, in 0");
  const local = (await threads("cafe", copy.id)).find((thread) => thread.block.id === mark.id)!;
  expect(local.replies.map((r) => [r.body, r.properties?.via?.[0] ?? "here"])).toEqual([
    ["then move the window", "here"], ["no, it's the backup window", `echonet:shack@${machine}`],
  ]);
  const remote = (await threads("shack", cron.id)).find((thread) => thread.block.id === there.block.id)!;
  expect(remote.replies.map((r) => r.body)).toEqual(["no, it's the backup window", "then move the window"]);
  // The original's text never changed.
  expect((await get("shack", cron.id)).revision).toBe(1);
  // The attic's highlight is still queued, and the toss log says why.
  const nodelist = (await call<{ blocks: Block[] }>("cafe", { action: "blocks.query", query: { where: "type=nodelist" } })).blocks[0]!;
  const last = (await children("cafe", nodelist.id)).filter((block) => block.text.includes("[type::toss]")).at(-1)!;
  expect(last.text).toContain("[queued::1]");
  expect(last.text).toContain(`attic@${machine} grants read; netmail needs propose`);
  // The ledger keeps what went where, both ways.
  const ledger = (await call<{ blocks: Block[] }>("cafe", { action: "blocks.query", query: { where: "type=echo-ledger" } })).blocks[0]!;
  expect(ledger.text).toContain(`- out ${mark.id} -> shack@${machine}/${there.block.id}`);
}, 60_000);

test("the host holds another outline's extension to that outline's access level, once its owner set one", async () => {
  const { call, create, access } = await setup();
  // A made-up extension that reaches into another outline: a read, a comment and a new note.
  const folder = join(process.env.OUTLINER_EXTENSIONS_DIR!, "poker");
  mkdirSync(folder, { recursive: true });
  cpSync(join(EXTENSION, "outline.ts"), join(folder, "outline.ts"));
  writeFileSync(join(folder, "extension.json"), JSON.stringify({
    contract: 2, id: "poker", version: 1, name: "Poker", description: "Reaches into another outline", run: ["bun", "poker.ts"],
    actions: [{ id: "poke", label: "Poke", on: "outline", effects: "write" }],
  }));
  writeFileSync(join(folder, "poker.ts"), `import { outline } from "./outline";
const tries: Record<string, string> = {};
const target = { outline: "shack" };
const attempt = async (name: string, run: () => Promise<unknown>) => { try { await run(); tries[name] = "ok"; } catch (e) { tries[name] = String((e as Error).message); } };
const [note] = (await outline<{ blocks: Array<{ id: string; revision: number }> }>({ action: "blocks.query", query: { where: "type=recon" } }, target).catch(() => ({ blocks: [] }))).blocks;
await attempt("read", () => outline({ action: "blocks.query", query: { where: "type=recon" } }, target));
await attempt("comment", () => outline({ action: "annotations.batch", requestId: crypto.randomUUID(), operations: [{ operationId: "c", type: "block-comment", input: { blockId: note?.id, expectedRevision: note?.revision, body: "hi", source: "agent" } }] }, target));
await attempt("create", () => outline({ action: "create", text: "from the cafe" }, target));
process.stdout.write(JSON.stringify({ ok: true, value: { message: JSON.stringify(tries) } }));
`);
  await call("cafe", { action: "extensions.list", reload: true });
  await create("shack", "Recon: the shed's cert [type::recon]");
  const poke = async () => JSON.parse((await call<{ message: string }>("cafe", { action: "extensions.act", extension: "poker", extensionAction: "poke", mutation: { author: "user" } })).message) as Record<string, string>;

  // Never set: open to the host's extensions, as before.
  expect(await poke()).toEqual({ read: "ok", comment: "ok", create: "ok" });
  await access("shack", "propose");
  expect(await poke()).toMatchObject({ read: "ok", comment: "ok", create: expect.stringContaining("ext:poker runs for cafe, and shack grants other outlines propose: create needs full (its owner runs `ep0ch mcp access full --ws shack`)") });
  await access("shack", "read");
  expect(await poke()).toMatchObject({ read: "ok", comment: expect.stringContaining("annotations.batch needs propose") });
  await access("shack", "none");
  expect(await poke()).toMatchObject({ read: expect.stringContaining("needs read") });
  // Its own outline is never checked.
  await access("cafe", "none");
  await access("shack", "full");
  expect(await poke()).toEqual({ read: "ok", comment: "ok", create: "ok" });
}, 60_000);
