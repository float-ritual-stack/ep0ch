// The door on an outline host (PIE-466): every line names its outline, a single-outline service is refused
// when a name is asked for, the target is chosen like a Herdr session, and `ep0ch outline|status` drive the
// host. Unit tests use a fake socket; the rest run against a scratch host (EP0CH_OUTLINER_HOST).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bindingOf, clientConfigOf, hostSocketOf, resolveTarget, slugOutlineName, socketOf } from "../src/discover";
import { attachTarget, deletionPlan, formatOutlines, parseOutlineArgs } from "../src/outlines";
import { hostRequest, SocketBoard, type OutlineEvent } from "../src/socket";
import { hostOutliner, ScratchHost, until } from "./scratch";

/** A fake service on a Unix socket: records every line and answers with `answer(request)`. */
async function fakeService(path: string, answer: (r: any) => unknown) {
  const lines: any[] = [];
  const server: Server = createServer(s => {
    let buf = "";
    s.on("data", d => {
      buf += d.toString();
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const r = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        lines.push(r);
        s.write(JSON.stringify({ id: r.id, ok: true, result: answer(r), sequence: 1 }) + "\n");
      }
    });
    s.on("error", () => {});
  });
  mkdirSync(dirname(path), { recursive: true });
  await new Promise<void>(res => server.listen(path, res));
  return { lines, close: () => new Promise<void>(res => server.close(() => res())) };
}

const ping = (extra: Record<string, unknown> = {}) => ({ protocolVersion: 82, minClientProtocol: 82, capabilities: ["blocks.read"], location: { hostname: "shed", workspaceRoot: "/fictional/shed" }, ...extra });
const hostPing = (outline = "bob") => ping({ capabilities: ["blocks.read", "request.outline", "ping.host"], outline: { name: outline }, host: { socket: "/fictional/outliner.sock", defaultOutline: "bob", outlines: ["bob", "fred"] } });

describe("SocketBoard with an outline", () => {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-outline-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("every request line and the subscribe line name the outline; info reports it", async () => {
    const svc = await fakeService(join(dir, "host.sock"), r => r.action === "ping" ? hostPing("fred") : r.action === "events.subscribe" ? {} : []);
    const board = new SocketBoard(join(dir, "host.sock"), 3000, "fred");
    try {
      expect((await board.info()).outline).toBe("fred");
      await board.roots();
      board.subscribe(() => {});
      await until(() => svc.lines.some(l => l.action === "events.subscribe"), "the subscribe line");
      expect(svc.lines.map(l => [l.action, l.outline])).toEqual([["ping", "fred"], ["children", "fred"], ["events.subscribe", "fred"]]);
    } finally { board.close(); await svc.close(); }
  });

  test("without an outline, nothing is added, and a host's default is reported as the outline", async () => {
    const svc = await fakeService(join(dir, "default.sock"), () => hostPing("bob"));
    const board = new SocketBoard(join(dir, "default.sock"), 3000);
    try {
      expect((await board.info()).outline).toBe("bob");
      expect(svc.lines[0]).not.toHaveProperty("outline");
    } finally { board.close(); await svc.close(); }
  });

  test("a single-outline service is refused when an outline is named, and has no outline otherwise", async () => {
    const svc = await fakeService(join(dir, "single.sock"), () => ping());
    const named = new SocketBoard(join(dir, "single.sock"), 3000, "fred");
    const plain = new SocketBoard(join(dir, "single.sock"), 3000);
    try {
      await expect(named.info()).rejects.toThrow(`serves one outline and can't route by name (no request.outline), so it can't open the outline "fred"`);
      expect((await plain.info()).outline).toBeUndefined();
    } finally { named.close(); plain.close(); await svc.close(); }
  });

  test("hostRequest asks on its own connection and names no outline", async () => {
    const svc = await fakeService(join(dir, "ask.sock"), r => ({ asked: r.action }));
    try {
      expect(await hostRequest<unknown>(join(dir, "ask.sock"), "outlines.list")).toEqual({ asked: "outlines.list" });
      expect(svc.lines[0]).toEqual({ id: "host", action: "outlines.list" });
    } finally { await svc.close(); }
  });
});

describe("ep0ch outline arguments", () => {
  test("each command, --json, --yes and --root", () => {
    expect(parseOutlineArgs(["list", "--json"])).toEqual({ op: "list", json: true });
    expect(parseOutlineArgs(["attach", "jam-shelf"])).toEqual({ op: "attach", name: "jam-shelf", json: false });
    expect(parseOutlineArgs(["create", "uncle", "--json"])).toEqual({ op: "create", name: "uncle", json: true });
    expect(parseOutlineArgs(["stop", "fred"])).toEqual({ op: "stop", name: "fred", json: false });
    expect(parseOutlineArgs(["delete", "bandit", "--yes"])).toEqual({ op: "delete", name: "bandit", yes: true, json: false });
    expect(parseOutlineArgs(["adopt", "db/outliner.sqlite", "fred", "--root", "work/fred"], "/fictional"))
      .toEqual({ op: "adopt", path: "/fictional/db/outliner.sqlite", name: "fred", root: "/fictional/work/fred", json: false });
    expect(parseOutlineArgs(["status", "--json"])).toEqual({ op: "status", json: true });
  });

  test("refusals say why", () => {
    expect(parseOutlineArgs(["create", "Not A Name"])).toMatchObject({ error: expect.stringContaining("isn't an outline name") });
    expect(parseOutlineArgs(["adopt", "only-one"])).toMatchObject({ error: expect.stringContaining("takes <path> <name>") });
    expect(parseOutlineArgs(["adopt", "a.sqlite", "fred", "--root"])).toMatchObject({ error: "--root needs a folder" });
    expect(parseOutlineArgs(["rename", "fred"])).toMatchObject({ error: expect.stringContaining("unknown outline command rename") });
    expect(parseOutlineArgs([])).toMatchObject({ error: expect.stringContaining("ep0ch outline list") });
  });

  test("the listing and what delete will do", () => {
    const bob = { name: "bob", database: "/fictional/state/outlines/bob.sqlite", adopted: false, open: true, default: true, root: "/fictional/bob" };
    const fred = { name: "fred", database: "/fictional/fred/outliner.sqlite", adopted: true, open: false, default: false };
    expect(formatOutlines([bob, fred]).split("\n")).toEqual([
      "bob   open · default            /fictional/bob",
      "fred  closed · adopted          /fictional/fred/outliner.sqlite",
    ]);
    expect(formatOutlines([])).toBe("no outlines on this host");
    expect(deletionPlan(fred, "/fictional/state")).toContain("its database stays where it lies, at /fictional/fred/outliner.sqlite");
    expect(deletionPlan(bob, "/fictional/state")).toContain("to /fictional/state/deleted/");
  });
});

describe("which outline the door opens", () => {
  const base = mkdtempSync(join(tmpdir(), "ep0ch-target-"));
  const config = join(base, "config");
  const env = { XDG_CONFIG_HOME: config };
  let svc: Awaited<ReturnType<typeof fakeService>> | null = null;
  afterAll(async () => { await svc?.close(); rmSync(base, { recursive: true, force: true }); });

  test("without a host: --ws <root>, a socket, EP0CH_SOCKET and discovery, as before; --ws <name> says there is no host", async () => {
    expect(await resolveTarget(["--ws", "/fictional/shed"], env, base, base)).toEqual({ path: socketOf("/fictional/shed", base), why: "the workspace /fictional/shed" });
    expect(await resolveTarget(["/fictional/shed.sock"], env, base, base)).toEqual({ path: "/fictional/shed.sock", why: "the socket named" });
    expect(await resolveTarget([], { ...env, EP0CH_SOCKET: "/fictional/env.sock" }, base, base)).toEqual({ path: "/fictional/env.sock", why: "EP0CH_SOCKET" });
    expect(await resolveTarget([], env, join(base, "jam-shelf"), base)).toMatchObject({ error: expect.stringContaining("no outline service is running") });
    expect(await resolveTarget(["--ws", "jam-shelf"], env, base, base)).toMatchObject({ error: expect.stringContaining("no outline host is running") });
    // With a socket named, --ws <name> asks that socket for the outline (a tunnel to another machine's host).
    expect(await resolveTarget(["--ws", "fred"], { ...env, EP0CH_SOCKET: "/fictional/tunnel.sock" }, base, base))
      .toEqual({ path: "/fictional/tunnel.sock", outline: "fred", attach: true, why: "the outline fred on /fictional/tunnel.sock" });
  });

  test("with a host: --ws <name>, then the folder's binding or the nearest bound folder above, then its name", async () => {
    svc = await fakeService(hostSocketOf(base), r => r.action === "outlines.list" ? { defaultOutline: "bob", outlines: [{ name: "bob" }, { name: "fred" }] } : hostPing());
    expect(await resolveTarget(["--ws", "fred"], env, base, base)).toEqual({ path: hostSocketOf(base), outline: "fred", attach: true, why: "the outline fred" });
    // A --ws with a / is a folder root: on a host, the folder's outline.
    expect(await resolveTarget(["--ws", "./fred"], env, base, base)).toMatchObject({ path: hostSocketOf(base), outline: "fred", attach: true });

    const bound = join(base, "fred-folder"), jam = join(base, "Jam Shelf"), old = join(base, "uncle-folder"), remote = join(base, "bandit-folder");
    for (const f of [bound, jam, old, remote]) mkdirSync(f, { recursive: true });
    mkdirSync(dirname(clientConfigOf(bound, env)), { recursive: true });
    writeFileSync(clientConfigOf(bound, env), JSON.stringify({ workspaceRoot: bound, outline: "fred" }));
    mkdirSync(dirname(clientConfigOf(remote, env)), { recursive: true });
    writeFileSync(clientConfigOf(remote, env), JSON.stringify({ workspaceRoot: remote, mode: "remote", socketPath: "/fictional/tunnel.sock" }));
    expect(bindingOf(bound, env)).toEqual({ outline: "fred" });
    expect(bindingOf(remote, env)).toEqual({ other: "remote" });

    expect(await resolveTarget([], env, bound, base)).toEqual({ path: hostSocketOf(base), outline: "fred", attach: true, why: `the outline fred, which ${bound} is bound to` });
    expect(await resolveTarget([], env, jam, base)).toEqual({ path: hostSocketOf(base), outline: "jam-shelf", attach: true, why: `the outline jam-shelf, named after ${jam}` });
    expect(slugOutlineName("Tïn_Drawer!!")).toBe("tin-drawer");
    // Below a bound folder: the nearest bound folder's outline.
    const deep = join(bound, "notes", "drafts");
    mkdirSync(deep, { recursive: true });
    expect(await resolveTarget([], env, deep, base)).toMatchObject({ outline: "fred", why: `the outline fred, which ${bound} (above ${deep}) is bound to` });
    expect(await resolveTarget(["--ws", deep], env, base, base)).toMatchObject({ outline: "fred" });
    // An old hash database doesn't keep a folder off the host; another connection choice does.
    mkdirSync(dirname(socketOf(old, base)), { recursive: true });
    writeFileSync(join(dirname(socketOf(old, base)), "outliner.sqlite"), "");
    expect(await resolveTarget([], env, old, base)).toMatchObject({ outline: "uncle-folder" });
    expect(await resolveTarget([], env, remote, base)).toMatchObject({ error: expect.stringContaining("no outline service is running") });
    expect(await resolveTarget(["--ws", remote], env, base, base)).toEqual({ path: socketOf(remote, base), why: `the workspace ${remote}` });
    // The home folder is not an outline's name: the host's default.
    expect(await resolveTarget([], env, homedir(), base)).toMatchObject({ outline: "bob", why: expect.stringContaining("default outline") });
    // EP0CH_SOCKET is an explicit override, over a running host and over --ws <root>.
    expect(await resolveTarget([], { ...env, EP0CH_SOCKET: "/fictional/env.sock" }, jam, base)).toEqual({ path: "/fictional/env.sock", why: "EP0CH_SOCKET" });
    expect(await resolveTarget(["--ws", jam], { ...env, EP0CH_SOCKET: "/fictional/env.sock" }, base, base)).toEqual({ path: "/fictional/env.sock", why: "EP0CH_SOCKET" });
  });
});

describe.skipIf(!hostOutliner)("the door against a scratch outline host", () => {
  const host = new ScratchHost();
  const MAIN = join(import.meta.dir, "../src/main.ts");
  const run = async (...args: string[]) => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...host.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock" };
    delete env.EP0CH_SOCKET;
    const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env, cwd: host.root });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };
  beforeAll(async () => { await host.start("bob"); await host.create("bob"); await host.create("fred"); }, 30_000);
  afterAll(() => host.dispose());

  test("a board on bob reads only bob, and its subscription sees only bob's changes", async () => {
    const bob = new SocketBoard(host.sock, 5000, "bob"), fred = new SocketBoard(host.sock, 5000, "fred");
    try {
      expect(await bob.info()).toMatchObject({ outline: "bob" });
      expect(await fred.info()).toMatchObject({ outline: "fred" });
      const fredNote = await fred.request<{ id: string }>("create", { text: "Fred's fictional compass" });
      const bobNote = await bob.request<{ id: string }>("create", { text: "Bob's fictional kettle" });
      expect((await bob.get(bobNote.id))?.text).toContain("kettle");
      expect(await bob.get(fredNote.id)).toBeNull();
      expect((await bob.search("fictional", 20)).map(m => m.id)).not.toContain(fredNote.id);
      const seen: OutlineEvent[] = [];
      bob.subscribe(e => seen.push(e));
      await Bun.sleep(300);
      await fred.request("create", { text: "Fred's fictional lantern" });
      const teapot = await bob.request<{ id: string }>("create", { text: "Bob's fictional teapot" });
      await until(() => seen.some(e => e.blockId === teapot.id), "bob's change");
      await Bun.sleep(200);
      expect(seen.filter(e => e.domain === "content").map(e => e.blockId)).toEqual([teapot.id]);
    } finally { bob.close(); fred.close(); }
  });

  test("ep0ch outline list|create|attach|stop|delete and status, with --json", async () => {
    const created = await run("outline", "create", "uncle", "--json");
    expect(created.code).toBe(0);
    expect(JSON.parse(created.out)).toMatchObject({ name: "uncle", open: true, adopted: false });
    const again = await run("outline", "create", "uncle");
    expect(again.code).toBe(1);
    expect(again.err).toContain('An outline named "uncle" already exists');
    const attached = await run("outline", "attach", "bandit", "--json");
    expect(JSON.parse(attached.out)).toMatchObject({ created: true, outline: { name: "bandit" } });
    expect(JSON.parse((await run("outline", "attach", "bandit", "--json")).out)).toMatchObject({ created: false });
    const list = JSON.parse((await run("outline", "list", "--json")).out);
    expect(list.defaultOutline).toBe("bob");
    expect(list.outlines.map((o: any) => o.name)).toEqual(["bandit", "bob", "fred", "uncle"]);
    expect((await run("outline", "list")).out).toMatch(/^bob\s+open · default/m);
    expect(JSON.parse((await run("outline", "stop", "uncle", "--json")).out)).toMatchObject({ name: "uncle", open: false });
    const status = JSON.parse((await run("status", "--json")).out);
    expect(status).toMatchObject({ socket: host.sock, defaultOutline: "bob" });
    expect(status.open).toContain("bob");
    expect(status.open).not.toContain("uncle");
    // delete asks first; with no terminal and no --yes it refuses and says what it would do.
    const refused = await run("outline", "delete", "bandit");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`not deleted (pass --yes to move the outline "bandit"`);
    const deleted = await run("outline", "delete", "bandit", "--yes", "--json");
    expect(deleted.code).toBe(0);
    expect(JSON.parse(deleted.out).movedTo).toContain(join(host.state, "deleted"));
    expect(JSON.parse((await run("outline", "list", "--json")).out).outlines.map((o: any) => o.name)).toEqual(["bob", "fred", "uncle"]);
  });

  test("--ws jam-shelf creates the outline on first open and attaches on the next", async () => {
    const env = host.env;
    const first = await resolveTarget(["--ws", "jam-shelf"], env, host.root, host.state);
    expect(first).toMatchObject({ path: host.sock, outline: "jam-shelf", attach: true });
    expect(await attachTarget(first as any)).toEqual({ created: true });
    expect(await attachTarget(first as any)).toEqual({ created: false });
    const board = new SocketBoard(host.sock, 5000, "jam-shelf");
    try { expect((await board.info()).outline).toBe("jam-shelf"); } finally { board.close(); }
    // An unbound folder named after an outline opens that outline.
    const folder = host.folder("fred");
    expect(await resolveTarget([], env, folder, host.state)).toMatchObject({ outline: "fred", attach: true });
    // ssh ep0ch's form, --ws <folder path>: through the host, to the outline named after the folder.
    const pie = host.folder("pie");
    const byPath = await resolveTarget(["--ws", pie], env, "/", host.state);
    expect(byPath).toMatchObject({ path: host.sock, outline: "pie", attach: true });
    expect(await attachTarget(byPath as any)).toEqual({ created: true });
    const pieBoard = new SocketBoard(host.sock, 5000, "pie");
    try {
      const note = await pieBoard.request<{ id: string }>("create", { text: "Pie's fictional recipe" });
      expect((await pieBoard.get(note.id))?.text).toContain("recipe");
    } finally { pieBoard.close(); }
    expect(await attachTarget(byPath as any)).toEqual({ created: false });
    // ep0ch clients reads only: naming a missing outline does not create it.
    const clients = await run("clients", "--ws", "nobody-here");
    expect(clients.code).toBe(1);
    expect(JSON.parse((await run("outline", "list", "--json")).out).outlines.map((o: any) => o.name)).not.toContain("nobody-here");
  });
});
