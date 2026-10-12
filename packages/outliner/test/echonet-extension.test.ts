// EchoNet's tosser (PIE-779), end to end: a scratch outline host serving made-up outlines (a shack, a cafe and an
// attic), the repo's extensions/echonet copied into its user folder, areas and subscriptions between them, and tosses
// driven by hand; and a second machine through the fake ssh. Every note is made up.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

/** Talking to one host: its outlines, and EchoNet's runs in them. */
function speaker(socket: string) {
  const call = <T>(outline: string, request: Record<string, unknown>) => send<T>(socket, { outline, ...request });
  const create = (outline: string, text: string, parentId?: string) => call<Block>(outline, { action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const get = (outline: string, blockId: string) => call<Block>(outline, { action: "get", blockId });
  const children = (outline: string, parentId: string) => call<Block[]>(outline, { action: "children", parentId });
  const threads = (outline: string, blockId: string) =>
    call<Thread[]>(outline, { action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
  const where = (outline: string, w: string) => call<{ blocks: Block[] }>(outline, { action: "blocks.query", query: { where: w } }).then((r) => r.blocks);
  const edit = async (outline: string, blockId: string, change: (text: string) => string) => {
    const block = await get(outline, blockId);
    return call<Block>(outline, { action: "update", blockId, expectedRevision: block.revision, text: change(block.text), author: "user" });
  };
  return { call, create, get, children, threads, where, edit };
}

async function setup(names = ["shack", "cafe", "attic"]) {
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
  const talk = speaker(socket);
  for (const name of names) {
    await send(socket, { action: "outlines.create", name });
    const listed = await talk.call<{ extensions: Array<{ id: string; state: string; error?: string }> }>(name, { action: "extensions.list", reload: true });
    expect(listed.extensions.find((entry) => entry.id === "echonet")).toMatchObject({ state: "active" });
  }
  const machine = (await talk.call<{ machine: string }>("cafe", { action: "notes.address" })).machine;
  const act = (outline: string, extensionAction: string, blockId?: string) =>
    talk.call<{ message: string; open?: string }>(outline, { action: "extensions.act", extension: "echonet", extensionAction, mutation: { author: "user" }, ...(blockId ? { blockId } : {}) });
  const toss = async (outline: string) => {
    const message = (await act(outline, "toss")).message;
    if (process.env.ECHO_DEBUG) {
      const list = (await talk.where(outline, "type=nodelist"))[0]!;
      console.log((await talk.children(outline, list.id)).filter((b) => b.text.includes("[type::toss]")).at(-1)!.text);
    }
    return message;
  };
  const comment = async (outline: string, block: Block, body: string, quote?: string) => {
    const receipt = await talk.call<{ annotations: Array<{ block: Block }> }>(outline, {
      action: "annotations.batch", requestId: crypto.randomUUID(), author: "user",
      operations: [{ operationId: "c", type: "block-comment", input: { blockId: block.id, expectedRevision: block.revision, body, source: "user", ...(quote ? { passage: { quote } } : {}) } }],
    });
    return receipt.annotations[0]!.block;
  };
  const reply = (outline: string, annotationId: string, body: string) =>
    talk.call(outline, { action: "annotations.reply", requestId: crypto.randomUUID(), author: "user", input: { annotationId, body, source: "user" } });
  const access = (outline: string, level: string) => talk.call(outline, { action: "mcp.access.configure", level });
  const config = async (value: Record<string, unknown>) => {
    writeFileSync(join(userExtensions, "echonet", "config.json"), JSON.stringify({ config: value }));
    await talk.call("cafe", { action: "extensions.list", reload: true });
  };
  /** The source board a subscription keeps for `node`, and the copies on it. */
  const board = async (outline: string, sub: Block, node: string) => {
    const found = (await talk.children(outline, sub.id)).find((child) => child.text.includes(`[echo-source::${node}]`));
    return { board: found, copies: found ? (await talk.children(outline, found.id)).filter((child) => child.text.includes("[from::")) : [] };
  };
  return { root, outlines: outlines.root, socket, machine, ...talk, act, toss, comment, reply, access, config, board };
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
  let host = new OutlineHost({ outlinesFolder: join(far, "outlines"), log: () => {} });
  await host.start();
  cleanups.push(async () => {
    try { process.kill(Number(readFileSync(join(outlines, ".remote", "box-b.ctl"), "utf8"))); } catch { /* not running */ }
    await host.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return {
    ...speaker(join(far, "outlines", ".host", "host.sock")),
    socket: join(far, "outlines", ".host", "host.sock"),
    stop: () => host.close(),
    start: async () => { host = new OutlineHost({ outlinesFolder: join(far, "outlines"), log: () => {} }); await host.start(); },
  };
}

test("an area is a named view: its query, its children and the notes tagged with it; copies land on a source board and drift", async () => {
  const { machine, toss, create, get, edit, call, threads, where, access, board } = await setup();
  await access("shack", "propose");
  const view = await create("shack", "Recon [type::virtual-branch] [query::type=recon] [echo::recon]");
  const cron = await create("shack", "Recon: flaky cron on larder [type::recon]\n\nJitter of 40s, see ((00000000-0000-4000-8000-000000000001|the old note)).");
  await create("shack", "Recon: disk on kettle [type::recon] [page::kettle-disk] [publish::never]");
  const posted = await create("shack", "The shed's cert expires Friday [echo::recon, ideas]");
  const queue = await create("shack", "Recon: queue drops on restart [type::recon] [from::karen]\n\nIn the log: `((00000000-0000-4000-8000-000000000002))`.");
  await create("shack", "repro: send 50, restart at 25", queue.id);
  // Never a message: a note that is itself a copy from elsewhere, and the area's own view.
  await create("shack", `Recon: from the attic [type::recon] [from::attic@${machine}/00000000-0000-4000-8000-000000000003]`);
  await create("shack", "A task, not recon [type::task]");
  const sub = await create("cafe", `Recon from the shack [subscribe::shack@${machine}] [echo::recon] [since::all]`);

  expect(await toss("cafe")).toContain("copies 4");
  let { board: shackBoard, copies } = await board("cafe", sub, `shack@${machine}`);
  expect(shackBoard!.text).toBe(`shack@${machine} [echo-source::shack@${machine}]`);
  const titles = copies.map((copy) => copy.text.split("\n")[0]!);
  expect(titles[0]).toMatch(new RegExp(`^Recon: flaky cron on larder \\[type::recon\\] \\[from::shack@${machine}/${cron.id}\\] \\[echo::recon\\] \\[from-rev::1\\] \\[tossed::`));
  // An address the original owns is renamed; a note kept off the web stays off it.
  expect(titles[1]).toContain("[from-page::kettle-disk] [from-publish::never]");
  expect(titles[1]).toEndWith("[publish::never]");
  expect(titles[2]).toContain(`The shed's cert expires Friday [source-echo::recon, ideas] [from::shack@${machine}/${posted.id}] [echo::recon]`);
  expect(titles[3]).toContain("[from::karen]".replace("from", "source-from"));
  expect(copies).toHaveLength(4);
  // Code is literal; a reference into the origin becomes an ep0ch:// link into it; the note under a message is a copy too.
  expect(copies[3]!.text).toEndWith("In the log: `((00000000-0000-4000-8000-000000000002))`.");
  expect(copies[0]!.text).toContain(`[the old note](ep0ch://shack@${machine}/b/00000000-0000-4000-8000-000000000001)`);
  expect((await call<Block[]>("cafe", { action: "children", parentId: copies[3]!.id }))[0]!.text).toStartWith("repro: send 50, restart at 25 [from::shack@");
  // Seen-by: a mark on the original, its text untouched.
  expect((await get("shack", cron.id)).revision).toBe(1);
  expect((await threads("shack", cron.id)).map((thread) => [thread.body, thread.properties?.kind])).toEqual([[`also in: cafe@${machine} (Recon from the shack)`, ["echo-seen-by"]]]);

  // A child of the view is a message too, as soon as it's written.
  await create("shack", "Recon: the gate sensor sleeps [type::note]", view.id);
  expect(await toss("cafe")).toContain("copies 1");
  // Trash one copy and edit another's original; trash a third's original: trashed stays trashed, newer and gone are markers.
  await call("cafe", { action: "delete", blockId: copies[1]!.id, author: "user" });
  await edit("shack", cron.id, (text) => `${text}\nNow 90s.`);
  await call("shack", { action: "delete", blockId: posted.id, author: "user" });
  expect(await toss("cafe")).toContain("copies 0, waiting 0, newer 1, gone 1, skipped 1");
  ({ copies } = await board("cafe", sub, `shack@${machine}`));
  expect(copies).toHaveLength(4);
  expect(copies[0]!.text).toContain("[upstream-newer::2]");
  expect(copies[0]!.text).not.toContain("Now 90s.");
  expect(copies[1]!.text).toContain("[upstream-gone::");
  // Restored upstream, the marker goes.
  await call("shack", { action: "trash.restore", blockId: posted.id, author: "user" });
  await toss("cafe");
  expect((await get("cafe", copies[1]!.id)).text).not.toContain("upstream-gone");

  // The nodelist and the toss log; the origin's own nodelist knows the cafe reads it.
  const nodelist = (await where("cafe", "type=nodelist"))[0]!;
  expect(nodelist.text).toContain(`## shack@${machine}`);
  expect(nodelist.text).toContain("reachable · access propose · we read its recon");
  expect(nodelist.text).toContain("recon (Recon)");
  await toss("shack");
  const shackList = (await where("shack", "type=nodelist"))[0]!;
  expect(shackList.text).toContain(`## cafe@${machine}`);
  expect(shackList.text).toContain("reads our areas");
}, 60_000);

test("a subscription takes what's new from its first toss, at most its cap a toss, and says how many wait", async () => {
  const { machine, toss, create, get, board } = await setup(["shack", "cafe"]);
  for (const n of [1, 2, 3, 4, 5]) await create("shack", `Plot ${n}: notes on the beans [echo::plot]`);
  const fromNow = await create("cafe", `Plot from the shack [subscribe::shack@${machine}] [echo::plot]`);
  expect(await toss("cafe")).toContain("copies 0");
  expect((await get("cafe", fromNow.id)).text).toMatch(/\[since::\d{4}-\d\d-\d\dT/);
  await Bun.sleep(5);
  await create("shack", "Plot 6: frost tonight [echo::plot]");
  expect(await toss("cafe")).toContain("copies 1");
  expect((await board("cafe", fromNow, `shack@${machine}`)).copies.map((copy) => copy.text.split(" [")[0])).toEqual(["Plot 6: frost tonight"]);

  const backlog = await create("cafe", `Every plot [subscribe::shack@${machine}] [echo::plot] [since::all] [cap::2]`);
  expect(await toss("cafe")).toContain("waiting 3");
  let at = await board("cafe", backlog, `shack@${machine}`);
  // Oldest first; plot 6 is the cafe's already (one copy per original, whichever subscription brought it).
  expect(at.copies.map((copy) => copy.text.split(":")[0])).toEqual(["Plot 1", "Plot 2"]);
  expect(at.board!.text).toContain("[waiting::3]");
  await toss("cafe");
  await toss("cafe");
  at = await board("cafe", backlog, `shack@${machine}`);
  expect(at.copies).toHaveLength(5);
  expect(at.board!.text).not.toContain("waiting");
}, 60_000);

test("masks and dotted names: every node with a matching area gets a board of its own; a named list of nodes", async () => {
  const { machine, toss, create, children, board } = await setup(["shack", "cafe", "attic", "porch"]);
  await create("shack", "Requests [type::virtual-branch] [query::type=request] [echo::ep0ch.requests]");
  await create("shack", "Request: a dark theme for the nodelist [type::request]");
  await create("attic", "Recon on the repos [echo::ep0ch.recon.repos]");
  await create("porch", "The porch has no ep0ch areas [echo::garden]");
  const everyone = await create("cafe", `All of ep0ch [subscribe::*@${machine}] [echo::ep0ch.*] [since::all]`);
  expect(await toss("cafe")).toContain("copies 2");
  const sources = (await children("cafe", everyone.id)).map((child) => child.text);
  expect(sources.sort()).toEqual([`attic@${machine} [echo-source::attic@${machine}]`, `shack@${machine} [echo-source::shack@${machine}]`]);
  expect((await board("cafe", everyone, `attic@${machine}`)).copies[0]!.text).toContain("[echo::ep0ch.recon.repos]");

  await create("cafe", "Known nodes [page::known]\n\n- the porch: porch@" + machine);
  const listed = await create("cafe", "Garden from the known nodes [subscribe::@known] [echo::garden] [since::all]");
  expect(await toss("cafe")).toContain("copies 1");
  expect((await board("cafe", listed, `porch@${machine}`)).copies[0]!.text).toStartWith("The porch has no ep0ch areas");
}, 60_000);

test("netmail both ways; nothing bounces between nodes that read each other; an original gone leaves it undeliverable", async () => {
  const { machine, toss, create, get, call, threads, where, comment, reply, access, config, board } = await setup();
  await access("shack", "propose");
  await access("cafe", "propose");
  await access("attic", "read");
  const cron = await create("shack", "Recon: flaky cron on larder [echo::recon]\n\nThe jitter is forty seconds.");
  await create("cafe", "Recon: the cafe's espresso timer drifts [echo::recon]");
  const quote = await create("attic", "On queues [echo::quotes]\n\n> A queue that forgets on restart is a wish.");
  const recon = await create("cafe", `Recon from the shack [subscribe::shack@${machine}] [echo::recon] [since::all]`);
  const quotes = await create("cafe", `Quotes from the attic [subscribe::attic@${machine}] [echo::quotes] [since::all]`);
  // The shack reads the cafe's recon back: the cafe's copies of the shack's notes carry [echo::recon] and never bounce.
  const back = await create("shack", `Recon from the cafe [subscribe::cafe@${machine}] [echo::recon] [since::all]`);
  await toss("cafe");
  expect(await toss("shack")).toContain("copies 1");
  expect((await board("shack", back, `cafe@${machine}`)).copies.map((copy) => copy.text.split(" [")[0])).toEqual(["Recon: the cafe's espresso timer drifts"]);
  expect(await toss("cafe")).toContain("copies 0");

  const copy = (await board("cafe", recon, `shack@${machine}`)).copies[0]!;
  const quoteCopy = (await board("cafe", quotes, `attic@${machine}`)).copies[0]!;
  // The attic grants read: copied, but no seen-by.
  expect(quoteCopy.text).toContain(`[from::attic@${machine}/${quote.id}]`);
  expect(await threads("attic", quote.id)).toEqual([]);

  const mark = await comment("cafe", copy, "is it the NTP drift again?", "forty seconds");
  await comment("cafe", quoteCopy, "", "forgets on restart");
  // The shack's lid is shut: queued, nothing lost.
  await config({ offline: [`shack@${machine}`], undeliverableAfter: 2 });
  expect(await toss("cafe")).toContain("queued 2");
  expect((await threads("shack", cron.id)).filter((thread) => thread.properties?.["netmail-from"])).toEqual([]);

  await config({ undeliverableAfter: 2 });
  expect(await toss("cafe")).toContain("netmail out 1, in 0, queued 1");
  const there = (await threads("shack", cron.id)).find((thread) => thread.properties?.["netmail-from"])!;
  expect(there.body).toBe("is it the NTP drift again?");
  expect(there.properties).toMatchObject({ via: [`echonet:cafe@${machine}`], "netmail-from": [`cafe@${machine}/${mark.id}`], "netmail-author": ["user"] });
  await reply("shack", there.block.id, "no, it's the backup window");
  await reply("cafe", mark.id, "then move the window");
  expect(await toss("cafe")).toContain("netmail out 1, in 1");
  // The shack's own toss sends nothing of it back: what came in carries netmail-from.
  await toss("shack");
  expect(await toss("cafe")).toContain("netmail out 0, in 0");
  const local = (await threads("cafe", copy.id)).find((thread) => thread.block.id === mark.id)!;
  expect(local.replies.map((r) => [r.body, r.properties?.via?.[0] ?? "here"])).toEqual([
    ["then move the window", "here"], ["no, it's the backup window", `echonet:shack@${machine}`],
  ]);
  expect((await get("shack", cron.id)).revision).toBe(1);
  const nodelist = (await where("cafe", "type=nodelist"))[0]!;
  const logs = (await call<Block[]>("cafe", { action: "children", parentId: nodelist.id })).filter((block) => block.text.includes("[type::toss]"));
  expect(logs.at(-1)!.text).toContain(`attic@${machine} grants read; netmail needs propose`);

  // The original goes: the next mark is tried for two tosses, then left as an undeliverable note beside the copy.
  await call("shack", { action: "delete", blockId: cron.id, author: "user" });
  const late = await comment("cafe", await get("cafe", copy.id), "still there?");
  expect(await toss("cafe")).toContain("undeliverable 0");
  const gaveUp = await toss("cafe");
  expect(gaveUp).toContain("undeliverable 1");
  const note = (await where("cafe", "type=echo-undeliverable"))[0]!;
  expect(note.parentId).toBe(copy.parentId);
  expect(note.text).toContain(`Undeliverable: “still there?” [type::echo-undeliverable] [netmail::${late.id}]`);
  expect(note.text).toContain(`Netmail on ((${copy.id}))`);
  expect(await toss("cafe")).toContain("queued 1, undeliverable 0");
}, 90_000);

test("take the newer version: replace a copy's text, or propose it beside the copy, only when asked", async () => {
  const { machine, toss, create, get, edit, act, call, board } = await setup(["shack", "cafe"]);
  const original = await create("shack", "Recon: the kettle's disk is at 80% [echo::recon] [page::kettle]");
  const sub = await create("cafe", `Recon [subscribe::shack@${machine}] [echo::recon] [since::all]`);
  await toss("cafe");
  const copy = (await board("cafe", sub, `shack@${machine}`)).copies[0]!;
  expect((await act("cafe", "take-newer", copy.id)).message).toContain("already has");
  await edit("cafe", copy.id, (text) => `${text}\n\nMy note: clear the logs first.`);
  await edit("shack", original.id, (text) => text.replace("80%", "95%"));
  await toss("cafe");
  expect((await get("cafe", copy.id)).text).toContain("[upstream-newer::2]");

  const proposed = await act("cafe", "compare-newer", copy.id);
  expect(proposed.message).toContain("proposed beside the copy");
  const proposal = await get("cafe", proposed.open!);
  expect(proposal.parentId).toBe(copy.id);
  // The copy is as it was until the person applies it.
  expect((await get("cafe", copy.id)).text).toContain("My note: clear the logs first.");

  expect((await act("cafe", "take-newer", copy.id)).message).toContain("now has");
  const taken = await get("cafe", copy.id);
  expect(taken.text.split("\n")[0]).toMatch(new RegExp(`^Recon: the kettle's disk is at 95% \\[source-echo::recon\\] \\[from-page::kettle\\] \\[from::shack@${machine}/${original.id}\\] \\[echo::recon\\] \\[from-rev::2\\] \\[tossed::`));
  expect(taken.text).not.toContain("My note");
  expect((await act("shack", "take-newer", original.id)).message).toContain("isn't an EchoNet copy");
  await call("shack", { action: "delete", blockId: original.id, author: "user" });
  expect((await act("cafe", "take-newer", copy.id)).message).toContain("gone");
}, 60_000);

test("another machine: a mask finds the outlines there that opted in, and copies, seen-by and netmail go through the forward", async () => {
  const { root, outlines, machine, toss, create, threads, where, comment, board } = await setup(["cafe"]);
  const far = await farMachine(root, outlines);
  for (const name of ["field", "barn"]) await send(far.socket, { action: "outlines.create", name });
  const hedge = await far.create("field", "Field: the hedge by the gate flowers late [echo::field.notes]");
  await far.create("barn", "Barn: the roof leaks over bay 3 [echo::field.notes]");
  const sub = await create("cafe", "Field notes from the box [subscribe::*@box-b] [echo::field.*] [since::all]");

  // Neither set a level: none across machines, so neither is listed and nothing comes.
  expect(await toss("cafe")).toContain("copies 0");
  await far.call("field", { action: "mcp.access.configure", level: "propose" });
  expect(await toss("cafe")).toContain("copies 1");
  const copies = (await board("cafe", sub, "field@box-b")).copies;
  expect(copies[0]!.text).toContain(`[from::field@box-b/${hedge.id}]`);
  const seen = (await far.threads("field", hedge.id))[0]!;
  expect(seen.body).toBe(`also in: cafe@${machine} (Field notes from the box)`);
  expect(seen.block.actorId).toBe(`ext:echonet@cafe@${machine}`);

  // Netmail while the far host is down: queued, then delivered once it is back.
  const mark = await comment("cafe", copies[0]!, "which week, roughly?", "flowers late");
  await far.stop();
  expect(await toss("cafe")).toContain("queued 1");
  expect((await where("cafe", "type=nodelist"))[0]!.text).toMatch(/## field@box-b\n- unreachable: /);
  await far.start();
  expect(await toss("cafe")).toContain("netmail out 1");
  const there = (await far.threads("field", hedge.id)).find((thread) => thread.properties?.["netmail-from"])!;
  expect(there.properties?.["netmail-from"]).toEqual([`cafe@${machine}/${mark.id}`]);
  await far.call("field", { action: "annotations.reply", requestId: crypto.randomUUID(), author: "user", input: { annotationId: there.block.id, body: "the third week of June", source: "user" } });
  expect(await toss("cafe")).toContain("in 1");
  expect((await threads("cafe", copies[0]!.id)).find((thread) => thread.block.id === mark.id)!.replies.map((r) => r.body)).toEqual(["the third week of June"]);
}, 90_000);

test("ep0ch echo: subscribe writes a subscription, toss runs the tosser, areas reads what an outline offers and reads", async () => {
  const { outlines, machine, create, where, access } = await setup(["shack", "cafe"]);
  await access("shack", "read");
  await create("shack", "Recon [type::virtual-branch] [query::type=recon] [echo::recon]");
  await create("shack", "Recon: the boiler's pressure log [type::recon]");
  await create("shack", "Ideas for the shed [echo::ideas]");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("EP0CH_")));
  const echo = async (...args: string[]) => {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "echo", ...args], { env: { ...env, EP0CH_OUTLINES: outlines }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { out, err, code };
  };
  expect((await echo("subscribe", "not/a mask", "recon", "--ws", "cafe")).err).toContain("isn't a node mask");
  const made = await echo("subscribe", `shack@${machine}`, "recon", "--ws", "cafe", "--since", "all", "--cap", "10");
  expect(made.code).toBe(0);
  expect(made.out).toContain(`recon from shack@${machine} [subscribe::shack@${machine}] [echo::recon] [since::all] [cap::10]`);
  const tossed = await echo("toss", "--ws", "cafe");
  expect([tossed.code, tossed.out.trim()]).toEqual([0, expect.stringContaining("copies 1")]);
  expect((await where("cafe", "from")).map((block) => block.text.split(" [")[0])).toEqual(["Recon: the boiler's pressure log"]);
  const shack = await echo("areas", "--ws", "shack");
  expect(shack.out).toContain("shack offers:\n  recon  view Recon (type=recon)\n  ideas  1 posted");
  const cafe = await echo("areas", "--ws", "cafe");
  expect(cafe.out).toContain(`cafe reads:\n  recon from shack@${machine}  (recon from shack@${machine}; since all, cap 10)\n    shack@${machine}: 1 copies`);
  expect(cafe.out).toContain(`Other nodes, as the nodelist last saw them:\n  shack@${machine}: recon (Recon); ideas (1 posted)`);
}, 60_000);
