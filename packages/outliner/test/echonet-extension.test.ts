// EchoNet's tosser (PIE-779), end to end: a scratch outline host serving made-up outlines (a shack, a cafe and an
// attic), the repo's extensions/echonet copied into its user folder, areas and subscriptions between them, and tosses
// driven by hand; and a second machine through the fake ssh. Every note is made up.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { tossHealth } from "../src/echo-health";
import { OutlineHost } from "../src/outline-host";
import type { Block } from "../src/types";

const socket = (outlines: string) => outlineLayout(outlines).socket;

const EXTENSION = join(import.meta.dir, "..", "extensions", "echonet");
// Each test tosses by hand, in the order it names: a packet's arrival doesn't set the receiver's tosser off here.
process.env.EP0CH_ECHONET_ARRIVAL_TOSS = "0";

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
  const where = (outline: string, w: string) => call<{ blocks: Block[] }>(outline, { action: "blocks.query", query: { where: w, machinery: "show" } }).then((r) => r.blocks);
  const edit = async (outline: string, blockId: string, change: (text: string) => string) => {
    const block = await get(outline, blockId);
    return call<Block>(outline, { action: "update", blockId, expectedRevision: block.revision, text: change(block.text), author: "user" });
  };
  const comment = async (outline: string, block: Block, body: string, quote?: string) => {
    const receipt = await call<{ annotations: Array<{ block: Block }> }>(outline, {
      action: "annotations.batch", requestId: crypto.randomUUID(), author: "user",
      operations: [{ operationId: "c", type: "block-comment", input: { blockId: block.id, expectedRevision: block.revision, body, source: "user", ...(quote ? { passage: { quote } } : {}) } }],
    });
    return receipt.annotations[0]!.block;
  };
  const reply = (outline: string, annotationId: string, body: string) =>
    call(outline, { action: "annotations.reply", requestId: crypto.randomUUID(), author: "user", input: { annotationId, body, source: "user" } });
  /** A toss of `outline`'s EchoNet, here (its tosser writes only that outline). */
  const tossAt = async (outline: string) => {
    const message = (await call<{ message: string }>(outline, { action: "extensions.act", extension: "echonet", extensionAction: "toss", mutation: { author: "user" } })).message;
    if (process.env.ECHO_DEBUG) {
      const list = (await where(outline, "type=nodelist"))[0]!;
      console.log((await children(outline, list.id)).filter((b) => b.text.includes("[type::toss]")).at(-1)!.text);
    }
    return message;
  };
  /** The latest toss log of `outline`'s own. */
  const lastLog = async (outline: string) => (await where(outline, "type=toss")).filter((block) => block.text.startsWith("Toss")).sort((a, b) => a.createdAt!.localeCompare(b.createdAt!)).at(-1)!.text;
  return { call, create, get, children, threads, where, edit, comment, reply, toss: tossAt, lastLog };
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
  return { root, outlines: outlines.root, socket, machine, ...talk, act, access, config, board };
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
  const { machine, toss, create, get, edit, call, threads, where, board } = await setup();
  const view = await create("shack", "Recon [type::virtual-branch] [query::type=recon] [echo::recon]");
  const cron = await create("shack", "Recon: flaky cron on larder [type::recon]\n\nJitter of 40s, see ((00000000-0000-4000-8000-000000000001|the old note)).");
  await create("shack", "Recon: disk on kettle [type::recon] [page::kettle-disk] [publish::never]");
  const posted = await create("shack", "The shed's cert expires Friday [type::peer-message] [peer::gardener] [echo::recon, ideas]");
  const queue = await create("shack", "Recon: queue drops on restart [type::recon] [from::karen]\n\nIn the log: `((00000000-0000-4000-8000-000000000002))`.");
  await create("shack", "repro: send 50, restart at 25", queue.id);
  // Never a message: a note that is itself a copy from elsewhere, and the area's own view.
  await create("shack", `Recon: from the attic [type::recon] [from::attic@${machine}/00000000-0000-4000-8000-000000000003]`);
  await create("shack", "A task, not recon [type::task]");
  const sub = await create("cafe", `Recon from the shack [subscribe::shack@${machine}] [echo::recon] [since::all]`);

  // The shack publishes its bulletin at its toss; the cafe copies from it.
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 4");
  let { board: shackBoard, copies } = await board("cafe", sub, `shack@${machine}`);
  expect(shackBoard!.text).toBe(`shack@${machine} [echo-source::shack@${machine}]`);
  const titles = copies.map((copy) => copy.text.split("\n")[0]!);
  expect(titles[0]).toMatch(new RegExp(`^Recon: flaky cron on larder \\[type::recon\\] \\[from::shack@${machine}/${cron.id}\\] \\[echo::recon\\] \\[from-rev::1\\] \\[from-author::user\\] \\[tossed::`));
  // An address the original owns is renamed; a note kept off the web stays off it.
  expect(titles[1]).toContain("[from-page::kettle-disk] [from-publish::never]");
  expect(titles[1]).toEndWith("[publish::never]");
  expect(titles[2]).toContain(`The shed's cert expires Friday [type::peer-message] [peer::gardener] [source-echo::recon, ideas] [from::shack@${machine}/${posted.id}] [echo::recon]`);
  expect(titles[3]).toContain("[from::karen]".replace("from", "source-from"));
  expect(copies).toHaveLength(4);
  // Code is literal; a reference into the origin becomes an ep0ch:// link into it; the note under a message is a copy too.
  expect(copies[3]!.text).toEndWith("In the log: `((00000000-0000-4000-8000-000000000002))`.");
  expect(copies[0]!.text).toContain(`[the old note](ep0ch://shack@${machine}/b/00000000-0000-4000-8000-000000000001)`);
  expect((await call<Block[]>("cafe", { action: "children", parentId: copies[3]!.id }))[0]!.text).toStartWith("repro: send 50, restart at 25 [from::shack@");
  // Seen-by: the cafe hands the shack a packet, and the shack's own tosser marks the original, its text untouched.
  expect(await threads("shack", cron.id)).toEqual([]);
  expect(await toss("shack")).toContain("seen-by in 4");
  expect((await get("shack", cron.id)).revision).toBe(1);
  const seen = (await threads("shack", cron.id))[0]!;
  expect([seen.body, seen.properties?.kind, seen.block.actorId]).toEqual([`also in: cafe@${machine} (Recon from the shack)`, ["echo-seen-by"], "ext:echonet"]);
  expect(seen.properties?.machine).toEqual(["echonet"]);

  // A note and the note under it both in the area: one copy each, the child under its parent's copy.
  const parent = await create("shack", "Recon: the well pump [type::recon]");
  await create("shack", "Recon: its pressure switch [type::recon]", parent.id);
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 1,");
  ({ copies } = await board("cafe", sub, `shack@${machine}`));
  expect(copies.map((copy) => copy.text.split(" [")[0])).toContain("Recon: the well pump");
  expect(copies.map((copy) => copy.text.split(" [")[0])).not.toContain("Recon: its pressure switch");
  await call("shack", { action: "delete", blockId: parent.id, author: "user" });
  await toss("shack");
  await toss("cafe");
  await call("cafe", { action: "delete", blockId: copies.find((copy) => copy.text.startsWith("Recon: the well pump"))!.id, author: "user" });
  // A child of the view is a message too, as soon as it's published.
  await create("shack", "Recon: the gate sensor sleeps [type::note]", view.id);
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 1");
  // Trash one copy and edit another's original; trash a third's original: trashed stays trashed, newer and gone are markers.
  await call("cafe", { action: "delete", blockId: copies[1]!.id, author: "user" });
  await edit("shack", cron.id, (text) => `${text}\nNow 90s.`);
  await call("shack", { action: "delete", blockId: posted.id, author: "user" });
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 0, waiting 0, newer 1, gone 1, skipped 1");
  ({ copies } = await board("cafe", sub, `shack@${machine}`));
  expect(copies).toHaveLength(4);
  expect(copies[0]!.text).toContain("[upstream-newer::2]");
  expect(copies[0]!.text).not.toContain("Now 90s.");
  expect(copies[1]!.text).toContain("[upstream-gone::");
  // Restored upstream, the marker goes.
  await call("shack", { action: "trash.restore", blockId: posted.id, author: "user" });
  await toss("shack");
  await toss("cafe");
  expect((await get("cafe", copies[1]!.id)).text).not.toContain("upstream-gone");

  // The nodelist and the toss log; the origin's own nodelist knows the cafe reads it.
  const nodelist = (await where("cafe", "type=nodelist"))[0]!;
  expect(nodelist.text).toContain(`## shack@${machine}\n- reachable · we read its recon`);
  expect(nodelist.text).toContain("recon (Recon)");
  await toss("shack");
  const shackList = (await where("shack", "type=nodelist"))[0]!;
  expect(shackList.text).toContain(`## cafe@${machine}`);
  expect(shackList.text).toContain("reads our areas");
}, 60_000);

test("a copy keeps labelled references and labelled page links whole: label and target, by outline-core's grammar (PIE-1289)", async () => {
  const { machine, toss, create, board } = await setup(["shack", "cafe"]);
  await create("shack", "Recon [type::virtual-branch] [query::type=recon] [echo::recon]");
  const plan = await create("shack", "The plan for the beds [page::bed-plan]");
  const rough = "00000000-0000-4000-8000-000000000011";
  await create("shack", [
    "Recon: labels survive [type::recon]",
    "",
    `See ((${rough}|Rough edges (x))) and ((${rough}^beds|the beds)).`,
    "The plan: [[bed-plan|the plan]], or [[bed-plan]].",
    "Yesterday: [[[[2026-10-06]] - notes]].",
    "Elsewhere: ((attic:00000000-0000-4000-8000-000000000012|the attic's)) and [web](https://example.com/a_(b)).",
  ].join("\n"));
  const sub = await create("cafe", `Recon from the shack [subscribe::shack@${machine}] [echo::recon] [since::all]`);
  await toss("shack");
  await toss("cafe");
  const { copies } = await board("cafe", sub, `shack@${machine}`);
  const uri = (id: string) => `ep0ch://shack@${machine}/b/${id}`;
  expect(copies.map((copy) => copy.text.split("\n").slice(1).join("\n"))).toEqual([[
    "",
    `See [Rough edges (x)](${uri(rough)}) and [the beds](${uri(rough)}#beds).`,
    `The plan: [the plan](${uri(plan.id)}), or [bed-plan](${uri(plan.id)}).`,
    "Yesterday: 2026-10-06 - notes (in shack).",
    "Elsewhere: ((attic:00000000-0000-4000-8000-000000000012|the attic's)) and [web](https://example.com/a_(b)).",
  ].join("\n")]);
}, 60_000);

test("a toss that moved nothing writes no log; its nodelist's last toss and its bulletin say it ran (PIE-798)", async () => {
  const { machine, outlines, toss, create, where, board } = await setup(["shack", "cafe"]);
  await create("shack", "Plot 1: the beans are up [echo::plot]");
  const sub = await create("cafe", `Plot [subscribe::shack@${machine}] [echo::plot] [since::all]`);
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 1");
  const logs = async () => (await where("cafe", "type=toss")).length;
  const before = await logs();
  const lastToss = async () => (await where("cafe", "type=nodelist"))[0]!.text.match(/\[last-toss::([^\]]+)\]/)![1]!;
  const was = await lastToss();
  await Bun.sleep(5);
  // Nothing new: a toss, no log; the nodelist's last toss moves, and so does the bulletin beside the outline.
  expect(await toss("cafe")).toEndWith("copies 0, waiting 0, newer 0, gone 0, skipped 0, seen-by 0, netmail out 0, in 0, queued 0, undeliverable 0 · nothing moved, so no log (the nodelist's last toss says when)");
  expect(await logs()).toBe(before);
  expect(await lastToss()).not.toBe(was);
  expect(tossHealth(outlines).map((h) => h.outline)).toEqual([]);   // EchoNet here is the host's, not in an outline's folder
  // Something moved: a log again.
  await create("shack", "Plot 2: slugs on the lettuce [echo::plot]");
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 1");
  expect(await logs()).toBe(before + 1);
  expect((await board("cafe", sub, `shack@${machine}`)).copies).toHaveLength(2);
}, 60_000);

test("echo status: when each outline's tosser last ran, from its bulletin, and a warning with the command when it's late", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "echo-health-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["pie", "gurgle", "attic"]) {
    mkdirSync(join(root, name, "extensions", "echonet"), { recursive: true });
    cpSync(join(EXTENSION, "extension.json"), join(root, name, "extensions", "echonet", "extension.json"));
  }
  mkdirSync(join(root, "plain"));                     // no EchoNet: not said
  const now = Date.now();
  for (const [name, minutes] of [["pie", 4], ["gurgle", 75]] as const) {
    mkdirSync(join(root, name, "echonet"), { recursive: true });
    writeFileSync(join(root, name, "echonet", "bulletin.json"), "{}");
    utimesSync(join(root, name, "echonet", "bulletin.json"), new Date(now - minutes * 60_000), new Date(now - minutes * 60_000));
  }
  const health = tossHealth(root, now);
  expect(health.map((h) => [h.outline, h.status, h.detail, h.fix])).toEqual([
    ["attic", "stale", "EchoNet is on, and it has never tossed (every 30m): is its outline host running?", "ep0ch echo toss --ws attic"],
    ["gurgle", "stale", "last tossed 75 min ago, and it tosses every 30m: its schedule isn't running (is its outline host?)", "ep0ch echo toss --ws gurgle"],
    ["pie", "ok", "tossed 4 min ago (every 30m)", undefined],
  ]);
});

test("a subscription takes what's new from its first toss, at most its cap a toss, and says how many wait", async () => {
  const { machine, toss, create, get, board, where, call } = await setup(["shack", "cafe"]);
  for (const n of [1, 2, 3, 4, 5]) await create("shack", `Plot ${n}: notes on the beans [echo::plot]`);
  await toss("shack");
  const fromNow = await create("cafe", `Plot from the shack [subscribe::shack@${machine}] [echo::plot]`);
  expect(await toss("cafe")).toContain("copies 0");
  expect((await get("cafe", fromNow.id)).text).toMatch(/\[since::\d{4}-\d\d-\d\dT/);
  await Bun.sleep(5);
  await create("shack", "Plot 6: frost tonight [echo::plot]");
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 1");
  expect((await board("cafe", fromNow, `shack@${machine}`)).copies.map((copy) => copy.text.split(" [")[0])).toEqual(["Plot 6: frost tonight"]);
  // A since it can't read is said in the toss log, never taken as "all".
  const typo = await create("cafe", `Plot typo [subscribe::shack@${machine}] [echo::plot] [since::yesterday]`);
  expect(await toss("cafe")).toContain("copies 0");
  expect((await where("cafe", "type=toss")).some((log) => log.text.includes("[since::yesterday] isn't a date"))).toBe(true);
  await call("cafe", { action: "delete", blockId: typo.id, author: "user" });

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
  const { machine, toss, create, children, where, edit, board } = await setup(["shack", "cafe", "attic", "porch"]);
  await create("shack", "Requests [type::virtual-branch] [query::type=request] [echo::ep0ch.requests]");
  await create("shack", "Request: a dark theme for the nodelist [type::request]");
  await create("attic", "Recon on the repos [echo::ep0ch.recon.repos]");
  await create("porch", "The porch has no ep0ch areas [echo::garden]");
  for (const name of ["shack", "attic", "porch"]) await toss(name);
  const everyone = await create("cafe", `All of ep0ch [subscribe::*@${machine}] [echo::ep0ch.*] [since::all]`);
  expect(await toss("cafe")).toContain("copies 2");
  const sources = (await children("cafe", everyone.id)).map((child) => child.text);
  expect(sources.sort()).toEqual([`attic@${machine} [echo-source::attic@${machine}]`, `shack@${machine} [echo-source::shack@${machine}]`]);
  expect((await board("cafe", everyone, `attic@${machine}`)).copies[0]!.text).toContain("[echo::ep0ch.recon.repos]");

  await create("cafe", "Known nodes [page::known]\n\n- the porch: porch@" + machine);
  const listed = await create("cafe", "Garden from the known nodes [subscribe::@known] [echo::garden] [since::all]");
  expect(await toss("cafe")).toContain("copies 1");
  expect((await board("cafe", listed, `porch@${machine}`)).copies[0]!.text).toStartWith("The porch has no ep0ch areas");
  // Taken off the list, the porch isn't read any more; its board and copies stay.
  const known = (await where("cafe", "page=known"))[0]!;
  await edit("cafe", known.id, (text) => text.replace(`porch@${machine}`, "nobody yet"));
  await create("porch", "Second porch note [echo::garden]");
  await toss("porch");
  expect(await toss("cafe")).toContain("copies 0");
  expect((await board("cafe", listed, `porch@${machine}`)).copies).toHaveLength(1);
}, 60_000);

test("netmail both ways; nothing bounces between nodes that read each other; an original gone leaves it undeliverable", async () => {
  const { machine, toss, create, get, call, threads, where, comment, reply, access, config, board, lastLog } = await setup();
  // The MCP access level is for agents (ADR 0005): at none, the outlines still mail each other.
  for (const name of ["shack", "cafe", "attic"]) await access(name, "none");
  const cron = await create("shack", "Recon: flaky cron on larder [echo::recon]\n\nThe jitter is forty seconds.");
  await create("cafe", "Recon: the cafe's espresso timer drifts [echo::recon]");
  const quote = await create("attic", "On queues [echo::quotes]\n\n> A queue that forgets on restart is a wish.");
  const recon = await create("cafe", `Recon from the shack [subscribe::shack@${machine}] [echo::recon] [since::all]`);
  const quotes = await create("cafe", `Quotes from the attic [subscribe::attic@${machine}] [echo::quotes] [since::all]`);
  // The shack reads the cafe's recon back: the cafe's copies of the shack's notes carry [echo::recon] and never bounce.
  const back = await create("shack", `Recon from the cafe [subscribe::cafe@${machine}] [echo::recon] [since::all]`);
  await toss("attic");
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 2");
  expect(await toss("shack")).toContain("copies 1");
  expect((await board("shack", back, `cafe@${machine}`)).copies.map((copy) => copy.text.split(" [")[0])).toEqual(["Recon: the cafe's espresso timer drifts"]);
  expect(await toss("cafe")).toContain("copies 0");

  const copy = (await board("cafe", recon, `shack@${machine}`)).copies[0]!;
  const quoteCopy = (await board("cafe", quotes, `attic@${machine}`)).copies[0]!;
  expect(quoteCopy.text).toContain(`[from::attic@${machine}/${quote.id}]`);
  expect(await toss("attic")).toContain("seen-by in 1");

  const mark = await comment("cafe", copy, "is it the NTP drift again?", "forty seconds");
  await comment("cafe", quoteCopy, "", "forgets on restart");
  // The shack's lid is shut: its netmail waits here, nothing lost.
  await config({ offline: [`shack@${machine}`], undeliverableAfter: 2 });
  expect(await toss("cafe")).toContain("netmail out 2, in 0, queued 1");
  expect(await lastLog("cafe")).toContain(`- shack@${machine}: 1 queued (unreachable: offline`);
  expect((await threads("shack", cron.id)).filter((thread) => thread.properties?.["netmail-from"])).toEqual([]);

  await config({ undeliverableAfter: 2 });
  expect(await toss("cafe")).toContain("netmail out 0, in 0, queued 0");
  expect(await toss("shack")).toContain("in 1");
  const there = (await threads("shack", cron.id)).find((thread) => thread.properties?.["netmail-from"])!;
  expect(there.body).toBe("is it the NTP drift again?");
  expect(there.properties).toMatchObject({ via: [`echonet:cafe@${machine}`], "netmail-from": [`cafe@${machine}/${mark.id}`], "netmail-author": ["user"] });
  expect(there.block.actorId).toBe("ext:echonet");
  expect(await lastLog("shack")).toContain(`## imported\n`);
  expect(await lastLog("shack")).toContain(`- netmail from cafe@${machine} on ((${cron.id}|Recon: flaky cron on larder))`);
  await reply("shack", there.block.id, "no, it's the backup window");
  await reply("cafe", mark.id, "then move the window");
  await toss("shack");
  expect(await toss("cafe")).toContain("netmail out 1, in 1");
  // What came in carries netmail-from, so neither side sends it back.
  await toss("shack");
  expect(await toss("cafe")).toContain("netmail out 0, in 0");
  const local = (await threads("cafe", copy.id)).find((thread) => thread.block.id === mark.id)!;
  expect(local.replies.map((r) => [r.body, r.properties?.via?.[0] ?? "here"])).toEqual([
    ["then move the window", "here"], ["no, it's the backup window", `echonet:shack@${machine}`],
  ]);
  expect((await threads("shack", cron.id)).find((thread) => thread.block.id === there.block.id)!.replies.map((r) => [r.body, r.properties?.via?.[0] ?? "here"])).toEqual([
    ["no, it's the backup window", "here"], ["then move the window", `echonet:cafe@${machine}`],
  ]);
  expect((await get("shack", cron.id)).revision).toBe(1);

  // The original goes: the next mark is tried for two tosses, then left as an undeliverable note beside the copy.
  await call("shack", { action: "delete", blockId: cron.id, author: "user" });
  await toss("shack");
  const late = await comment("cafe", await get("cafe", copy.id), "still there?");
  expect(await toss("cafe")).toContain("undeliverable 0");
  expect(await toss("cafe")).toContain("undeliverable 1");
  const note = (await where("cafe", "type=echo-undeliverable"))[0]!;
  expect(note.parentId).toBe(copy.parentId);
  expect(note.text).toContain(`Undeliverable: “still there?” [type::echo-undeliverable] [echonet::cafe@${machine}] [machine::echonet] [netmail::${late.id}]`);
  expect(note.text).toContain(`Netmail on ((${copy.id}))`);
  expect(await toss("cafe")).toContain("undeliverable 0");
  // Back from Trash, the original gets nothing that was left undeliverable.
  // PIE-868: everything the tossers wrote is the extension's (agent, ext:echonet), none of it a person's, and carries the
  // echonet mark: copies, receipts, carried comments, the nodelist, the ledger and the toss logs.
  for (const name of ["shack", "cafe", "attic"]) {
    const marked = (await call<{ blocks: Block[] }>(name, { action: "blocks.query", query: { where: "echonet", limit: 500, machinery: "show" } })).blocks;
    const wrote = marked.map((block) => block.text.match(/\[type::([a-z-]+)\]/)?.[1] ?? block.properties.find((p) => p.key === "kind")?.value ?? "comment");
    expect(wrote).toContain("nodelist");
    expect(wrote).toContain("echo-ledger");
    expect(wrote).toContain("toss");
    for (const block of marked) expect({ name, author: block.author, actor: block.actorId }).toEqual({ name, author: "agent", actor: "ext:echonet" });
    // Every copy it made is its write too (a copy carries from/echo, the others the echonet mark).
    for (const copy of (await call<{ blocks: Block[] }>(name, { action: "blocks.query", query: { where: "from-rev", limit: 500 } })).blocks) expect({ name, author: copy.author, actor: copy.actorId }).toEqual({ name, author: "agent", actor: "ext:echonet" });
  }
  await call("shack", { action: "trash.restore", blockId: cron.id, author: "user" });
  await toss("shack");
  expect(await toss("cafe")).toContain("netmail out 0");
  await toss("shack");
  expect((await threads("shack", cron.id)).filter((thread) => thread.body === "still there?")).toEqual([]);
}, 90_000);

test("a packet is imported only onto what the receiver publishes; a bulletin only for a subscription that reads it", async () => {
  const { machine, socket: sock, toss, create, threads, lastLog, outlines } = await setup(["shack", "cafe"]);
  const kept = await create("shack", "The shed's own notes, in no area");
  const offered = await create("shack", "Recon: the pond pump hums [echo::recon]");
  await toss("shack");
  // A node hands the shack netmail for a note it offers and one it doesn't, and its bulletin, which nothing reads.
  const packet = {
    from: `cafe@${machine}`, at: new Date().toISOString(), dialsIn: false,
    bulletin: { node: `cafe@${machine}`, machine, aliases: [], dialsIn: false, at: new Date().toISOString(), blocks: {}, tagged: [], areaResults: {}, children: {}, threads: {}, seenBy: {}, pages: {}, subscriptions: [] },
    items: [
      { kind: "netmail", original: offered.id, key: `cafe@${machine}/00000000-0000-4000-8000-0000000000aa`, body: "is it the bearing?", properties: {}, author: "user" },
      { kind: "netmail", original: kept.id, key: `cafe@${machine}/00000000-0000-4000-8000-0000000000bb`, body: "let me in", properties: {}, author: "user" },
    ],
  };
  // Handing it over writes no note: it is a file in the shack's inbound until the shack's own tosser runs.
  const sequence = () => send<unknown>(sock, { outline: "shack", action: "changes.since", sequence: Number.MAX_SAFE_INTEGER });
  const before = JSON.stringify(await sequence());
  await send(sock, { outline: "shack", action: "echonet.put", from: `cafe@${machine}`, packet });
  expect(await threads("shack", offered.id)).toEqual([]);
  expect(JSON.stringify(await sequence())).toBe(before);
  expect(await toss("shack")).toContain("in 1,");
  expect((await threads("shack", offered.id)).map((thread) => thread.body)).toEqual(["is it the bearing?"]);
  expect(await threads("shack", kept.id)).toEqual([]);
  const said = await lastLog("shack");
  expect(said).toContain(`- netmail from cafe@${machine}: ((${kept.id})) isn't a note this node publishes; dropped`);
  expect(said).toContain(`- cafe@${machine}: its bulletin, which no subscription here reads; dropped`);
  // An item it can't read, or one aiming past the note it names (a reply into a thread that isn't that note's): dropped,
  // and nothing in it stops the toss.
  await send(sock, { outline: "shack", action: "echonet.put", from: `cafe@${machine}`, packet: { from: `cafe@${machine}`, at: new Date().toISOString(), items: [
    null, { kind: "thread-reply", original: offered.id, root: kept.id, key: `cafe@${machine}/00000000-0000-4000-8000-0000000000dd`, body: "sneaking in", author: "user" },
  ] } });
  expect(await toss("shack")).toContain("dropped 2");
  // A packet's arrival sets the receiver's own tosser off: no one tosses by hand.
  process.env.EP0CH_ECHONET_ARRIVAL_TOSS = "1";
  try {
    await send(sock, { outline: "shack", action: "echonet.put", from: `cafe@${machine}`, packet: { ...packet, bulletin: undefined, items: [{ ...packet.items[0], key: `cafe@${machine}/00000000-0000-4000-8000-0000000000cc`, body: "or the impeller?" }] } });
    for (let i = 0; i < 100 && (await threads("shack", offered.id)).length < 2; i += 1) await Bun.sleep(100);
    expect((await threads("shack", offered.id)).map((thread) => thread.body)).toEqual(["is it the bearing?", "or the impeller?"]);
    // The note is written part-way through that toss: it goes on (its nodelist, its log) and lets go of its lock when
    // it is done. The test ends only then, or the host is closed under a toss still writing, and the next test is the
    // one that sees the reset (PIE-893).
    for (let i = 0; i < 300 && existsSync(join(outlines, "shack", "echonet", "toss.lock")); i += 1) await Bun.sleep(100);
    expect(existsSync(join(outlines, "shack", "echonet", "toss.lock"))).toBe(false);
  } finally {
    process.env.EP0CH_ECHONET_ARRIVAL_TOSS = "0";
  }
}, 60_000);

test("a comment in an area is copied as a note: what it's on, linked back, its thread under it; a comment on the copy joins that thread", async () => {
  const { machine, toss, create, get, children, threads, comment, reply, board } = await setup();
  await create("shack", "Asks [type::virtual-branch] [query::#garden-ask] [echo::asks]");
  const bed = await create("shack", "The north bed\n\nMulch is thin by the fence.");
  const ask = await comment("shack", bed, "#garden-ask more mulch by the fence?\nas `[type::annotation]` says", "Mulch is thin");
  await reply("shack", ask.id, "after the rain");
  const sub = await create("cafe", `Asks from the shack [subscribe::shack@${machine}] [echo::asks] [since::all]`);
  await toss("shack");
  expect(await toss("cafe")).toContain("copies 1");
  const copy = (await board("cafe", sub, `shack@${machine}`)).copies[0]!;
  const [head, meta] = copy.text.split("\n");
  expect(head).toBe(`Comment on “Mulch is thin” in [The north bed](ep0ch://shack@${machine}/b/${bed.id}) [from::shack@${machine}/${ask.id}] [echo::asks] [from-rev::${ask.revision}] [from-author::user] [tossed::${head!.match(/\[tossed::([^\]]*)\]/)![1]}]`);
  expect(meta).toContain("[from-type::annotation]");
  expect(meta).not.toContain("[type::annotation]");
  expect(copy.text).toContain("#garden-ask more mulch by the fence?\nas `[type::annotation]` says");
  // PIE-868: the copy carries a person's words but is the extension's write, with the source's author beside it.
  expect(copy).toMatchObject({ author: "agent", actorId: "ext:echonet" });
  expect(copy.text).toContain("[from-author::user]");
  expect(copy.text).toContain("[from::");
  const thread = await children("cafe", copy.id);
  expect(thread.map((note) => [note.text.split("\n").at(-1), note.properties.find((p) => p.key === "from-type")?.value])).toEqual([["after the rain", "annotation-reply"]]);
  // No seen-by on a comment: the original thread has only its own reply.
  await toss("shack");
  expect((await threads("shack", bed.id)).find((t) => t.block.id === ask.id)!.replies.map((r) => r.body)).toEqual(["after the rain"]);
  // A comment on the copy joins the original's thread as a reply, once.
  await comment("cafe", await get("cafe", copy.id), "the cafe has spare mulch");
  expect(await toss("cafe")).toContain("netmail out 1");
  expect(await toss("cafe")).toContain("netmail out 0");
  await toss("shack");
  const there = (await threads("shack", bed.id)).find((t) => t.block.id === ask.id)!;
  expect(there.replies.map((r) => [r.body, r.properties?.via?.[0] ?? "here"])).toEqual([
    ["after the rain", "here"], ["the cafe has spare mulch", `echonet:cafe@${machine}`],
  ]);
}, 60_000);

test("take the newer version: replace a copy's text, or propose it beside the copy, only when asked", async () => {
  const { machine, toss, create, get, edit, act, call, board } = await setup(["shack", "cafe"]);
  const original = await create("shack", "Recon: the kettle's disk is at 80% [echo::recon] [page::kettle]");
  const sub = await create("cafe", `Recon [subscribe::shack@${machine}] [echo::recon] [since::all]`);
  await toss("shack");
  await toss("cafe");
  const copy = (await board("cafe", sub, `shack@${machine}`)).copies[0]!;
  expect((await act("cafe", "take-newer", copy.id)).message).toContain("already has");
  await edit("cafe", copy.id, (text) => `${text}\n\nMy note: clear the logs first.`);
  await edit("shack", original.id, (text) => text.replace("80%", "95%"));
  await toss("shack");
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
  expect(taken.text.split("\n")[0]).toMatch(new RegExp(`^Recon: the kettle's disk is at 95% \\[source-echo::recon\\] \\[from-page::kettle\\] \\[from::shack@${machine}/${original.id}\\] \\[echo::recon\\] \\[from-rev::2\\] \\[from-author::user\\] \\[tossed::`));
  expect(taken.text).not.toContain("My note");
  expect((await act("shack", "take-newer", original.id)).message).toContain("isn't an EchoNet copy");
  await call("shack", { action: "delete", blockId: original.id, author: "user" });
  await toss("shack");
  expect((await act("cafe", "take-newer", copy.id)).message).toContain("gone");
}, 60_000);

test("a copy never runs as a rule, and stays off the web once either side keeps it off", async () => {
  const { machine, toss, create, get, edit, act, board } = await setup(["shack", "cafe"]);
  await create("shack", "Recon: loud bands [echo::recon] [rule-name::loud] [rule-match::type=recon] [rule-decorate::band]");
  const gate = await create("shack", "Recon: the gate code [echo::recon]");
  const hedge = await create("shack", "Recon: the hedge [echo::recon]");
  const sub = await create("cafe", `Recon [subscribe::shack@${machine}] [echo::recon] [since::all]`);
  await toss("shack");
  await toss("cafe");
  const copyOf = async (title: string) => (await board("cafe", sub, `shack@${machine}`)).copies.find((copy) => copy.text.startsWith(title))!;
  const rule = await copyOf("Recon: loud bands");
  expect(rule.text).toContain("[from-rule-name::loud] [from-rule-match::type=recon] [from-rule-decorate::band]");
  expect(rule.text).not.toMatch(/\[rule-/);

  // Kept off the web there after it was copied: the copy is kept off at once, its text not taken.
  await edit("shack", gate.id, (text) => `${text} [publish::never]`);
  await toss("shack");
  await toss("cafe");
  const gateCopy = await copyOf("Recon: the gate code");
  expect(gateCopy.text).toContain("[publish::never]");
  expect(gateCopy.text).toContain("[upstream-newer::2]");

  // Kept off the web here: taking the newer text keeps it off.
  const hedgeCopy = await copyOf("Recon: the hedge");
  await edit("cafe", hedgeCopy.id, (text) => `${text} [publish::never]`);
  await edit("shack", hedge.id, (text) => text.replace("hedge", "hedge, trimmed"));
  await toss("shack");
  await toss("cafe");
  expect((await act("cafe", "take-newer", hedgeCopy.id)).message).toContain("now has");
  const taken = await get("cafe", hedgeCopy.id);
  expect(taken.text).toStartWith("Recon: the hedge, trimmed");
  expect(taken.text).toContain("[publish::never]");
}, 60_000);

test("another machine: a mask finds the outlines there that publish, and bulletins and packets go through the forward", async () => {
  const { root, outlines, machine, toss, create, threads, where, comment, board } = await setup(["cafe"]);
  const far = await farMachine(root, outlines);
  for (const name of ["field", "barn"]) {
    await send(far.socket, { action: "outlines.create", name });
    await far.call(name, { action: "extensions.list", reload: true });
  }
  const hedge = await far.create("field", "Field: the hedge by the gate flowers late [echo::field.notes]");
  await far.create("barn", "Barn: the roof leaks over bay 3 [echo::field.notes]");
  const sub = await create("cafe", "Field notes from the box [subscribe::*@box-b] [echo::field.*] [since::all]");

  // Neither has tossed: neither publishes a bulletin, so neither is listed and nothing comes.
  expect(await toss("cafe")).toContain("copies 0");
  await far.toss("field");
  expect(await toss("cafe")).toContain("copies 1");
  const copies = (await board("cafe", sub, "field@box-b")).copies;
  expect(copies[0]!.text).toContain(`[from::field@box-b/${hedge.id}]`);
  // The seen-by went over as a packet; the field's own tosser marked the original.
  expect(await far.toss("field")).toContain("seen-by in 1");
  const seen = (await far.threads("field", hedge.id))[0]!;
  expect([seen.body, seen.block.actorId]).toEqual([`also in: cafe@${machine} (Field notes from the box)`, "ext:echonet"]);

  // Netmail while the far host is down: queued here, then handed over once it is back.
  const mark = await comment("cafe", copies[0]!, "which week, roughly?", "flowers late");
  await far.stop();
  expect(await toss("cafe")).toContain("queued 1");
  expect((await where("cafe", "type=nodelist"))[0]!.text).toMatch(/## field@box-b\n- unreachable: /);
  await far.start();
  expect(await toss("cafe")).toContain("queued 0");
  await far.toss("field");
  const there = (await far.threads("field", hedge.id)).find((thread) => thread.properties?.["netmail-from"])!;
  expect(there.properties?.["netmail-from"]).toEqual([`cafe@${machine}/${mark.id}`]);
  await far.reply("field", there.block.id, "the third week of June");
  await far.toss("field");
  expect(await toss("cafe")).toContain("in 1");
  expect((await threads("cafe", copies[0]!.id)).find((thread) => thread.block.id === mark.id)!.replies.map((r) => r.body)).toEqual(["the third week of June"]);
}, 90_000);

test("one node, one name: a machine given a name keeps its marks made under its host name's, and the nodelist says both", async () => {
  const { root, outlines, machine: hostForm, toss, create, threads, where, comment, board, get, edit } = await setup(["cafe"]);
  const far = await farMachine(root, outlines);
  await send(far.socket, { action: "outlines.create", name: "field" });
  await far.call("field", { action: "extensions.list", reload: true });
  const hedge = await far.create("field", "Field: the hedge by the gate flowers late [echo::field.notes]");
  const sub = await create("cafe", "Field notes from the box [subscribe::field@box-b] [echo::field.*] [since::all]");
  // Unnamed, the cafe signs as its host name's form.
  await far.toss("field");
  expect(await toss("cafe")).toContain("copies 1");
  const copy = (await board("cafe", sub, "field@box-b")).copies[0]!;
  const mark = await comment("cafe", copy, "which week, roughly?", "flowers late");
  expect(await toss("cafe")).toContain("netmail out 1");
  await far.toss("field");
  expect((await far.threads("field", hedge.id)).map((thread) => thread.properties?.["echo.node"]?.[0] ?? thread.properties?.["netmail-from"]?.[0]))
    .toEqual([`cafe@${hostForm}`, `cafe@${hostForm}/${mark.id}`]);

  // Named (what `ep0ch install --apply` writes): both machines, the far one as the ssh name the cafe reaches it by.
  writeFileSync(outlineLayout(outlines).machineName, "box-a\n");
  writeFileSync(outlineLayout(join(root, "far", "outlines")).machineName, "box-b\n");
  // The far machine's tosser once read the cafe under its host name: its seen-by mark here says field@<host name>.
  const posted = await create("cafe", "Cafe: the espresso timer drifts [echo::cafe.notes]");
  await send(socket(outlines), { outline: "cafe", action: "annotations.batch", requestId: crypto.randomUUID(), author: "agent", actorId: "ext:echonet",
    operations: [{ operationId: "seen", type: "block-comment", input: { blockId: posted.id, expectedRevision: posted.revision, source: "agent", body: `also in: field@${hostForm}`,
      properties: { kind: "echo-seen-by", "echo.node": `field@${hostForm}`, via: `echonet:field@${hostForm}` } } }] });
  // A toss that lost its ledger reads the bulletin there: the marks under the old name are this node's.
  const ledger = (await where("cafe", "type=echo-ledger"))[0]!;
  await edit("cafe", ledger.id, () => "EchoNet ledger [type::echo-ledger]");
  await far.toss("field");
  const after = await toss("cafe");
  expect(after).toStartWith("cafe@box-a tossed:");
  expect(after).toContain("seen-by 0");
  expect(after).toContain("netmail out 0");
  await far.toss("field");
  expect(await far.threads("field", hedge.id)).toHaveLength(2);
  const nodelistBlock = (await where("cafe", "type=nodelist"))[0]!;
  expect(nodelistBlock.properties).toContainEqual({ key: "machine", value: "echonet" });
  expect(nodelistBlock.properties).toContainEqual({ key: "node", value: "cafe@box-a" });
  const nodelist = nodelistBlock.text;
  expect(nodelist).toStartWith("Nodelist [type::nodelist]");
  expect(nodelist).toContain(`## cafe@box-a\n- this node\n- also known as: cafe@${hostForm}`);
  // One node, one heading: what it reads of ours and what we read of its, under the name the cafe reaches it by.
  expect(nodelist).toContain(`## field@box-b\n- reachable · we read its field.*, reads our areas\n- also known as: field@${hostForm}`);
  expect(nodelist).not.toContain(`## field@${hostForm}`);
  expect((await get("cafe", copy.id)).text).toContain("[from::field@box-b/");
  expect((await threads("cafe", copy.id)).map((thread) => thread.body)).toEqual(["which week, roughly?"]);
}, 90_000);

test("a machine that dials in: never called, it takes its mail and leaves its bulletin; the hub holds what waits for it", async () => {
  const { root, outlines, machine: hostForm, toss, act, create, get, threads, where, comment, board, access, lastLog } = await setup(["cafe"]);
  const far = await farMachine(root, outlines);
  const farOutlines = join(root, "far", "outlines");
  // box-b's inbound ssh is off; it still calls out, to box-a, where it reads the cafe's outlines folder.
  const sshLog = join(root, "ssh.log");
  Object.assign(process.env, { FAKE_SSH_REFUSE: "box-b", FAKE_SSH_LOG: sshLog });
  cleanups.push(() => { delete process.env.FAKE_SSH_REFUSE; delete process.env.FAKE_SSH_LOG; });
  writeFileSync(outlineLayout(outlines).machineName, "box-a\n");
  writeFileSync(outlineLayout(farOutlines).machineName, "box-b\n");
  writeFileSync(outlineLayout(farOutlines).dialsIn, "");
  mkdirSync(join(farOutlines, ".remote"), { recursive: true, mode: 0o700 });
  writeFileSync(join(farOutlines, ".remote", "box-a.json"), JSON.stringify({ outlines }));
  await send(far.socket, { action: "outlines.create", name: "field" });
  await far.call("field", { action: "extensions.list", reload: true });
  // Agents' access is no part of it (ADR 0005): the cafe lets no agent in, and still takes the mail it subscribed to.
  await access("cafe", "none");
  const hedge = await far.create("field", "Field: the hedge by the gate flowers late [echo::field.notes]");
  const espresso = await create("cafe", "Cafe: the espresso timer drifts [echo::cafe.notes]");
  const sub = await create("cafe", "Field notes from the box [subscribe::field@box-b] [echo::field.*] [since::all]");
  await far.create("field", "Cafe notes [subscribe::cafe@box-a] [echo::cafe.*] [since::all]");

  // Before box-b has called, the cafe tries it like any machine, and can't reach it.
  expect(await toss("cafe")).toContain("copies 0");
  expect(await lastLog("cafe")).toContain("- field@box-b (Field notes from the box): unreachable (");
  // Its toss calls: it reads the cafe, and leaves its bulletin and its seen-by there.
  expect(await far.toss("field")).toStartWith("field@box-b tossed: copies 1,");
  expect(await far.lastLog("field")).toContain("- cafe@box-a: left our bulletin");

  // The cafe's own tosser imports it: the call is noted, the copies come from the bulletin it left, written here.
  const before = readFileSync(sshLog, "utf8").split("\n").filter((line) => line.includes("box-b")).length;
  const first = await toss("cafe");
  expect(first).toContain("copies 1");
  expect(first).toContain("seen-by in 1");
  expect(first).toContain("held 1");
  const copy = (await board("cafe", sub, "field@box-b")).copies[0]!;
  expect(copy.text).toContain(`[from::field@box-b/${hedge.id}] [echo::field.notes]`);
  expect(copy.actorId).toBe("ext:echonet");
  expect((await where("cafe", "type=echo-ledger"))[0]!.text).toMatch(/^- call field@box-b -> \d{4}-/m);
  // Never called again: never down, and what waits for it is held here.
  const mark = await comment("cafe", copy, "which week, roughly?", "flowers late");
  const waiting = await toss("cafe");
  expect(waiting).toContain("held 2");
  expect(waiting).not.toContain("unreachable");
  let nodelist = (await where("cafe", "type=nodelist"))[0]!.text;
  expect(nodelist).toMatch(/## field@box-b\n- dials in · last call \d{4}-\d\d-\d\d \d\d:\d\d UTC · we read its field\.\*, reads our areas\n- also known as: field@\S+\n- netmail held: 2 \(its next call takes them\)/);
  expect(readFileSync(sshLog, "utf8").split("\n").filter((line) => line.includes("box-b")).length).toBe(before);

  // Its next call takes what was held (its tosser marks the original and adds the comment), and hands over its own.
  const farCopy = (await far.where("field", "from"))[0]!;
  expect(farCopy.text).toContain(`[from::cafe@box-a/${espresso.id}]`);
  await far.comment("field", farCopy, "decaf too?");
  const call = await far.toss("field");
  expect(call).toContain("netmail out 1, in 1");
  expect(await far.lastLog("field")).toContain("- cafe@box-a: called; took 2 packets");
  const there = (await far.threads("field", hedge.id)).find((thread) => thread.properties?.["netmail-from"])!;
  expect([there.body, there.properties?.["netmail-from"], there.block.actorId]).toEqual(["which week, roughly?", [`cafe@box-a/${mark.id}`], "ext:echonet"]);
  expect(await toss("cafe")).toContain("in 1,");
  expect(await lastLog("cafe")).toContain(`- netmail from field@box-b on ((${espresso.id}|Cafe: the espresso timer drifts))`);
  expect((await threads("cafe", espresso.id)).map((thread) => thread.body)).toContain("decaf too?");
  nodelist = (await where("cafe", "type=nodelist"))[0]!.text;
  expect(nodelist).toContain("- netmail held: 0\n");
  // A reply written there comes back in the bulletin its next call leaves.
  await far.reply("field", there.block.id, "the third week of June");
  await far.toss("field");
  expect(await toss("cafe")).toContain("in 1,");
  expect((await threads("cafe", copy.id)).find((thread) => thread.block.id === mark.id)!.replies.map((r) => r.body)).toEqual(["the third week of June"]);
  expect(nodelist).toContain(`- also known as: field@${hostForm}`);

  // The newer version, from the bulletin its last call left.
  await far.edit("field", hedge.id, (text) => `${text}\nIt flowered on the 20th.`);
  await far.toss("field");
  await toss("cafe");
  expect((await get("cafe", copy.id)).text).toContain("[upstream-newer::2]");
  expect((await act("cafe", "take-newer", copy.id)).message).toContain("now has");
  expect((await get("cafe", copy.id)).text).toEndWith("It flowered on the 20th.");

  // Said outright on this side, the cafe calls it again (and finds it refused).
  writeFileSync(join(outlines, ".remote", "box-b.json"), JSON.stringify({ outlines: farOutlines, dialsIn: false }));
  await toss("cafe");
  expect((await where("cafe", "type=nodelist"))[0]!.text).toMatch(/## field@box-b\n- unreachable: /);
}, 120_000);

test("ep0ch echo: subscribe writes a subscription, toss runs the tosser, areas reads what an outline offers and reads", async () => {
  const { outlines, machine, create, where } = await setup(["shack", "cafe"]);
  await create("shack", "Recon [type::virtual-branch] [query::type=recon] [echo::recon]");
  await create("shack", "Recon: the boiler's pressure log [type::recon]");
  await create("shack", "Ideas for the shed [echo::ideas]");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("EP0CH_")));
  const echo = async (...args: string[]) => {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "echo", ...args], { env: { ...env, EP0CH_OUTLINES: outlines, EP0CH_ECHONET_ARRIVAL_TOSS: "0" }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { out, err, code };
  };
  expect((await echo("subscribe", "not/a mask", "recon", "--ws", "cafe")).err).toContain("isn't a node mask");
  const made = await echo("subscribe", `shack@${machine}`, "recon", "--ws", "cafe", "--since", "all", "--cap", "10");
  expect(made.code).toBe(0);
  expect(made.out).toContain(`recon from shack@${machine} [subscribe::shack@${machine}] [echo::recon] [since::all] [cap::10]`);
  expect((await echo("toss", "--ws", "shack")).code).toBe(0);
  // A toss that takes longer than a plain request (here, waiting on a toss already running for six seconds, well past
  // the client's three) is waited for: its own answer, never a timeout for a toss that worked.
  const lock = join(outlines, "cafe", "echonet", "toss.lock");
  mkdirSync(join(outlines, "cafe", "echonet"), { recursive: true });
  writeFileSync(lock, "another toss\n");
  const release = setTimeout(() => rmSync(lock, { force: true }), 6_000);
  cleanups.push(() => clearTimeout(release));
  const tossed = await echo("toss", "--ws", "cafe");
  expect([tossed.code, tossed.out.trim(), tossed.err]).toEqual([0, expect.stringContaining("copies 1"), ""]);
  expect((await where("cafe", "from")).map((block) => block.text.split(" [")[0])).toEqual(["Recon: the boiler's pressure log"]);
  const shack = await echo("areas", "--ws", "shack");
  expect(shack.out).toContain("shack offers:\n  recon  view Recon (type=recon)\n  ideas  1 posted");
  const cafe = await echo("areas", "--ws", "cafe");
  expect(cafe.out).toContain(`cafe reads:\n  recon from shack@${machine}  (recon from shack@${machine}; since all, cap 10)\n    shack@${machine}: 1 copies`);
  expect(cafe.out).toContain(`Other nodes, as the nodelist last saw them:\n  shack@${machine}: ideas (1 posted); recon (Recon)`);
}, 60_000);

test("a ledger written before the echonet mark gets it on the next toss, with no entry changed (PIE-868)", async () => {
  const { toss, where, call, get } = await setup();
  await toss("shack");
  const ledger = (await where("shack", "type=echo-ledger"))[0]!;
  expect(ledger.text.split("\n")[0]).toContain("[echonet::");
  // As an older tosser left it: the same ledger without the mark.
  const old = ledger.text.replace(/ \[echonet::[^\]]*\]/, "");
  await call("shack", { action: "update", blockId: ledger.id, text: old, expectedRevision: ledger.revision, author: "user" });
  expect((await get("shack", ledger.id)).text).not.toContain("[echonet::");
  await toss("shack");
  expect((await get("shack", ledger.id)).text.split("\n")[0]).toContain("[echonet::");
}, 60_000);
