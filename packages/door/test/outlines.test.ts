// The door on the outline host (PIE-466, PIE-530): every line names its outline; which outline is `--ws`, then
// EP0CH_WS, then the nearest .ep0ch; a folder that names none gets the home base (test/home.test.ts), never a guess;
// `ep0ch outline|init|status` drive the host. Unit tests use a fake socket; the rest run against a scratch host.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hostSocketOf, resolveTarget, slugOutlineName } from "../src/discover";
import { attachTarget, deletionPlan, formatOutlines, nameTheOutline, parseOutlineArgs, writeDotEp0ch } from "../src/outlines";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { type HostedOutline, hostRequest, SocketBoard, type OutlineEvent } from "../src/socket";
import { hostOutliner, ScratchHost, until } from "./scratch";
import { everyOutline } from "../src/machine";

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

const ping = (extra: Record<string, unknown> = {}) => ({ protocolVersion: PROTOCOL, location: { hostname: "shed", workspaceRoot: "/fictional/shed" }, ...extra });
const hostPing = (outline = "bob") => ping({ outline: { name: outline }, host: { socket: "/fictional/outliner.sock", defaultOutline: "bob", outlines: ["bob", "fred"] } });

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

  test("a host that answers for another outline than the one named is refused", async () => {
    const svc = await fakeService(join(dir, "other.sock"), () => hostPing("bob"));
    const named = new SocketBoard(join(dir, "other.sock"), 3000, "fred");
    try {
      await expect(named.info()).rejects.toThrow(`answered for "bob", not "fred"`);
    } finally { named.close(); await svc.close(); }
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
  test("each command, --json and --yes", () => {
    expect(parseOutlineArgs(["list", "--json"])).toEqual({ op: "list", json: true });
    expect(parseOutlineArgs(["list", "--all", "--lines"])).toEqual({ op: "list", json: false, all: true, lines: true });
    expect(parseOutlineArgs(["attach", "jam-shelf"])).toEqual({ op: "attach", name: "jam-shelf", json: false });
    expect(parseOutlineArgs(["create", "uncle", "--json"])).toEqual({ op: "create", name: "uncle", json: true });
    expect(parseOutlineArgs(["stop", "fred"])).toEqual({ op: "stop", name: "fred", json: false });
    expect(parseOutlineArgs(["delete", "bandit", "--yes"])).toEqual({ op: "delete", name: "bandit", yes: true, json: false });
    expect(parseOutlineArgs(["import", "old/outliner.sqlite", "fred"], "/fictional"))
      .toEqual({ op: "import", path: "/fictional/old/outliner.sqlite", name: "fred", json: false });
    expect(parseOutlineArgs(["status", "--json"])).toEqual({ op: "status", json: true });
    expect(parseOutlineArgs(["init"])).toEqual({ op: "init", json: false });
    expect(parseOutlineArgs(["init", "jam-shelf", "--json"])).toEqual({ op: "init", name: "jam-shelf", json: true });
  });

  test("refusals say why", () => {
    expect(parseOutlineArgs(["create", "Not A Name"])).toMatchObject({ error: expect.stringContaining("isn't an outline name") });
    expect(parseOutlineArgs(["import", "only-one"])).toMatchObject({ error: expect.stringContaining("takes <database.sqlite> <name>") });
    expect(parseOutlineArgs(["init", "a", "b"])).toMatchObject({ error: "init takes [<name>]" });
    expect(parseOutlineArgs(["adopt", "a.sqlite", "fred"])).toMatchObject({ error: expect.stringContaining("unknown outline command adopt") });
    expect(parseOutlineArgs([])).toMatchObject({ error: expect.stringContaining("ep0ch outline list") });
  });

  test("the listing and what delete will do", () => {
    const bob: HostedOutline = { name: "bob", database: "/fictional/outlines/bob.sqlite", folder: "/fictional/outlines/bob", open: true, default: true };
    const fred: HostedOutline = { name: "fred", database: "/fictional/outlines/fred.sqlite", folder: "/fictional/outlines/fred", open: false };
    expect(formatOutlines([bob, fred]).split("\n")).toEqual([
      "bob   open · default  /fictional/outlines/bob.sqlite",
      "fred  closed          /fictional/outlines/fred.sqlite",
    ]);
    expect(formatOutlines([])).toContain("no outlines in");
    expect(deletionPlan(fred)).toContain(`/.deleted/; nothing is erased`);
  });
});

describe("which outline the door opens (PIE-530)", () => {
  const base = mkdtempSync(join(tmpdir(), "ep0ch-target-"));
  const env = { HOME: join(base, "home"), EP0CH_OUTLINES: join(base, "outlines") };
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  test("--ws from anywhere, then EP0CH_WS, then the nearest .ep0ch; the host is this machine's unless a socket is named", () => {
    const garden = join(base, "work", "garden"), deep = join(garden, "beds", "peas");
    mkdirSync(deep, { recursive: true });
    writeDotEp0ch(garden, "garden");
    expect(readFileSync(join(garden, ".ep0ch"), "utf8")).toBe('ws = "garden"\n');
    const host = hostSocketOf(env);
    expect(host).toBe(join(base, "outlines", ".host", "host.sock"));
    expect(resolveTarget(["--ws", "float-hub"], env, deep)).toEqual({ path: host, outline: "float-hub", attach: true, remote: false, why: "the outline float-hub (--ws float-hub)" });
    expect(resolveTarget([], { ...env, EP0CH_WS: "pie" }, deep)).toMatchObject({ outline: "pie", why: "the outline pie (EP0CH_WS=pie)" });
    expect(resolveTarget([], env, deep)).toEqual({ path: host, outline: "garden", attach: true, remote: false, why: `the outline garden (${join(garden, ".ep0ch")})` });
    // EP0CH_SOCKET names a host's socket outright, asked for the same name.
    expect(resolveTarget([], { ...env, EP0CH_SOCKET: "/fictional/env.sock" }, deep)).toMatchObject({ path: "/fictional/env.sock", outline: "garden", remote: true });
    // --ws takes a name, never a folder.
    expect(resolveTarget(["--ws", "./garden"], env, base)).toMatchObject({ error: expect.stringContaining("takes an outline's name, not a folder") });
    expect(resolveTarget(["--ws", "Not A Name"], env, base)).toMatchObject({ error: expect.stringContaining("isn't an outline name") });
    expect(slugOutlineName("Tïn_Drawer!!")).toBe("tin-drawer");
  });

  test("a folder that names nothing is unnamed: the guess is offered, never taken; $HOME and /tmp get no guess", () => {
    const repo = join(base, "bandit-repo"), sub = join(repo, "src", "deep");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    expect(resolveTarget([], env, sub)).toMatchObject({ unnamed: expect.stringContaining("no .ep0ch here or above"), folder: sub, guess: { name: "bandit-repo", folder: repo } });
    mkdirSync(env.HOME, { recursive: true });
    expect(resolveTarget([], env, env.HOME)).not.toHaveProperty("guess");
    expect(resolveTarget([], env, "/tmp")).not.toHaveProperty("guess");
  });

  test("without a terminal, an unnamed folder is an error that says what to run", async () => {
    const plain = join(base, "jam-shelf");
    mkdirSync(plain, { recursive: true });
    const cwd = process.cwd();
    const saved = { HOME: process.env.HOME, EP0CH_OUTLINES: process.env.EP0CH_OUTLINES };
    try {
      process.chdir(plain); Object.assign(process.env, env);
      const r = await nameTheOutline([], false, async () => null) as { error: string };
      expect(r.error).toContain(`ep0ch init (starts "jam-shelf", writing ${plain}/.ep0ch)`);
      expect(r.error).toContain("ep0ch outline import <database.sqlite> <name>");
      expect(await nameTheOutline(["--ws", "pie"], false, async () => null)).toEqual({ args: ["--ws", "pie"] });
      writeDotEp0ch(plain, "jam-shelf");
      expect(await nameTheOutline(["--desk"], false, async () => null)).toEqual({ args: ["--desk", "--ws", "jam-shelf"] });
      // A folder that names none, in a terminal: the home base's choice becomes the door's arguments, and its notice.
      const attic = join(base, "attic");
      mkdirSync(attic, { recursive: true });
      process.chdir(attic);
      const asked: unknown[] = [];
      const chose = (c: Awaited<ReturnType<Parameters<typeof nameTheOutline>[2]>>) => async (a: unknown) => { asked.push(a); return c; };
      expect(await nameTheOutline(["--desk"], true, chose({ outline: "fern", machine: "box-a", wrote: `${attic}/.ep0ch`, by: "helper" }))).toEqual({
        args: ["--desk", "--ws", "fern", "--machine", "box-a"], notice: `an agent (helper) opened fern on box-a from the home base · ${attic}/.ep0ch names it now`,
      });
      // It's opened over the host the rule names (EP0CH_SOCKET's here), with the folder and its guess.
      process.env.EP0CH_SOCKET = "/fictional/elsewhere.sock";
      await nameTheOutline([], true, chose(null));
      expect(asked.at(-1)).toEqual({ folder: attic, guess: { name: "attic", folder: attic }, socket: "/fictional/elsewhere.sock" });
      delete process.env.EP0CH_SOCKET;
      // A machine named with no outline opens the home base on it; a choice on this machine drops EP0CH_MACHINE.
      process.env.EP0CH_MACHINE = "box-a";
      expect(await nameTheOutline([], true, chose({ outline: "bob" }))).toEqual({ args: ["--ws", "bob", "--here"], notice: "opened bob from the home base" });
      expect(asked.at(-1)).toMatchObject({ folder: attic, machine: "box-a" });
      expect(process.env.EP0CH_MACHINE).toBeUndefined();
      expect(await nameTheOutline([], true, chose(null))).toBeNull();
    } finally {
      delete process.env.EP0CH_SOCKET; delete process.env.EP0CH_MACHINE;
      process.chdir(cwd);
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    }
  });
});

describe.skipIf(!hostOutliner)("the door against a scratch outline host", () => {
  const host = new ScratchHost();
  const MAIN = join(import.meta.dir, "../src/main.ts");
  const run = async (cwd: string, ...args: string[]) => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...host.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock" };
    delete env.EP0CH_SOCKET; delete env.EP0CH_WS;
    const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env, cwd });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };
  beforeAll(async () => { await host.start(); await host.create("bob"); await host.create("fred"); }, 30_000);
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

  test("`ep0ch --ws garden` from anywhere and `ep0ch` inside the folder open the same file, and moving the folder changes nothing", async () => {
    const garden = host.folder("garden"), deep = join(garden, "beds", "peas");
    mkdirSync(deep, { recursive: true });
    const init = await run(garden, "init", "--json");
    expect(init.code, init.err).toBe(0);
    expect(JSON.parse(init.out)).toMatchObject({ name: "garden", created: true, file: join(garden, ".ep0ch") });
    const database = async (target: ReturnType<typeof resolveTarget>) => {
      if (!("outline" in target)) throw new Error(JSON.stringify(target));
      expect(await attachTarget(target)).toEqual({ created: false });
      const board = new SocketBoard(target.path, 5000, target.outline);
      try { return (await board.request<{ location: { database: string } }>("ping")).location.database; } finally { board.close(); }
    };
    const fromAnywhere = await database(resolveTarget(["--ws", "garden"], host.env, "/"));
    const inside = await database(resolveTarget([], host.env, deep));
    expect(fromAnywhere).toBe(join(host.outlines, "garden.sqlite"));
    expect(inside).toBe(fromAnywhere);
    // The folder moves and is renamed: its .ep0ch goes with it.
    const moved = join(dirname(garden), "kitchen-garden");
    renameSync(garden, moved);
    expect(await database(resolveTarget([], host.env, join(moved, "beds", "peas")))).toBe(fromAnywhere);
    // `ep0ch clients` inside the folder reads the same outline (it names it, and never creates one).
    expect((await run(join(moved, "beds"), "clients")).code).toBe(0);
    const nameless = await run(host.folder("nameless"), "clients");
    expect(nameless.code).toBe(1);
    expect(nameless.err).toContain("Name the outline");
  });

  test("ep0ch outline list|create|attach|import|stop|delete and status, with --json", async () => {
    const created = await run(host.root, "outline", "create", "uncle", "--json");
    expect(created.code).toBe(0);
    expect(JSON.parse(created.out)).toMatchObject({ name: "uncle", open: true, database: join(host.outlines, "uncle.sqlite") });
    const again = await run(host.root, "outline", "create", "uncle");
    expect(again.code).toBe(1);
    expect(again.err).toContain('An outline named "uncle" already exists');
    const attached = await run(host.root, "outline", "attach", "bandit", "--json");
    expect(JSON.parse(attached.out)).toMatchObject({ created: true, outline: { name: "bandit" } });
    expect(JSON.parse((await run(host.root, "outline", "attach", "bandit", "--json")).out)).toMatchObject({ created: false });
    const list = JSON.parse((await run(host.root, "outline", "list", "--json")).out);
    expect(list.outlines.map((o: any) => o.name)).toEqual(expect.arrayContaining(["bandit", "bob", "fred", "uncle"]));
    expect((await run(host.root, "outline", "list")).out).toMatch(/^bob\s+open/m);
    expect(JSON.parse((await run(host.root, "outline", "stop", "uncle", "--json")).out)).toMatchObject({ name: "uncle", open: false });
    const status = JSON.parse((await run(host.root, "status", "--json")).out);
    expect(status).toMatchObject({ socket: host.sock, folder: host.outlines });
    expect(status.open).toContain("bob");
    expect(status.open).not.toContain("uncle");
    const missing = await run(host.root, "outline", "import", "fictional-missing.sqlite", "aunt");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("No database at");
    // delete asks first; with no terminal and no --yes it refuses and says what it would do.
    const refused = await run(host.root, "outline", "delete", "bandit");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`not deleted (pass --yes to move the outline "bandit"`);
    const deleted = await run(host.root, "outline", "delete", "bandit", "--yes", "--json");
    expect(deleted.code).toBe(0);
    expect(JSON.parse(deleted.out).movedTo).toContain(join(host.outlines, ".deleted"));
    const after = JSON.parse((await run(host.root, "outline", "list", "--json")).out).outlines.map((o: any) => o.name);
    expect(after).not.toContain("bandit");
  });

  test("outline list --all: this machine's outlines, then each machine opened before, not connected said (nothing started)", async () => {
    const state = mkdtempSync(join(tmpdir(), "ep0ch-every-"));
    writeFileSync(join(state, "machines.json"), JSON.stringify({ machines: [{ name: "box-a", at: 1 }] }));
    try {
      const every = await everyOutline(host.sock, { ...host.env, EP0CH_STATE: state, EP0CH_SSH: "/bin/false" });
      expect(every.filter(o => !o.machine).map(o => o.name)).toEqual(expect.arrayContaining(["bob", "fred"]));
      expect(every.at(-1)).toEqual({ machine: "box-a", problem: "not connected" });
      const lines = await run(host.root, "outline", "list", "--lines");
      expect(lines.out.split("\n")).toContain("bob\t\t");
    } finally { rmSync(state, { recursive: true, force: true }); }
  });

  test("--ws jam-pot creates the outline on first open and attaches on the next; ep0ch clients never creates", async () => {
    const first = resolveTarget(["--ws", "jam-pot"], host.env, host.root);
    expect(first).toMatchObject({ path: host.sock, outline: "jam-pot", attach: true });
    expect(await attachTarget(first as any)).toEqual({ created: true });
    expect(await attachTarget(first as any)).toEqual({ created: false });
    const board = new SocketBoard(host.sock, 5000, "jam-pot");
    try { expect((await board.info()).outline).toBe("jam-pot"); } finally { board.close(); }
    const clients = await run(host.root, "clients", "--ws", "nobody-here");
    expect(clients.code).toBe(1);
    expect(JSON.parse((await run(host.root, "outline", "list", "--json")).out).outlines.map((o: any) => o.name)).not.toContain("nobody-here");
  });
});
