// PIE-1242: a door running on another machine, peeked and acted in through the machine link. Three made-up machines on
// scratch folders: "box-a" runs the doors and dials out (the laptop's role), "hub" serves its link (float-2's), and this
// test's own folders are the machine the agents run on (float-box's), reaching hub through the fake ssh. Each door is a
// stand-in control socket that answers every request with what it was asked, so a test sees the request arrive whole,
// attributed, on the machine it was meant for.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { connectLink, serveLink } from "@ep0ch/outliner/link";
import { linkDoorSocket, readLinkDoors, type LinkDoor } from "@ep0ch/outliner/link-doors";
import { outliner, ScratchHost, scratchDir, until } from "./scratch";

const DOOR = resolve(import.meta.dir, "..");
const hub = new ScratchHost();
let here = "", server: ReturnType<typeof serveLink>, connector: ReturnType<typeof connectLink>;
const asked: { door: string; req: any }[] = [];
const fakeDoors: Server[] = [];
let doors: LinkDoor[] = [];
const sockets = new Map<string, string>();

/** A door's control socket that answers each request with what it got (and which door it is). */
async function fakeDoor(name: string, path: string) {
  const s = createServer(c => {
    let buf = "";
    c.on("data", d => {
      buf += d.toString();
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        asked.push({ door: name, req });
        c.write(JSON.stringify({ ok: true, result: { door: name, screen: { outline: name, text: [`the ${name} door`] }, req } }) + "\n");
      }
    });
    c.on("error", () => {});
  });
  await new Promise<void>(r => s.listen(path, r));
  fakeDoors.push(s);
  return path;
}

const env = () => ({
  ...process.env, EP0CH_OUTLINES: join(here, "outlines"), EP0CH_STATE: join(here, "state"), HOME: join(here, "home"),
  EP0CH_SSH: join(here, "bin", "ssh"), FAKE_SSH_LOG: join(here, "ssh.log"), FAKE_SSH_HOME: join(here, "far-home"),
  FAKE_SSH_OUTLINES: hub.outlines, FAKE_SSH_BIN: join(here, "bin"), EP0CH_DAEMON: "0",
});
async function ep0ch(args: string[], extra: Record<string, string> = {}) {
  const p = Bun.spawn([process.execPath, "src/main.ts", ...args], { cwd: DOOR, env: { ...env(), ...extra }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}

beforeAll(async () => {
  await hub.start();
  here = scratchDir("ep0ch-rdoor-");
  for (const d of ["outlines", "state", "bin", "home", "far-home", "laptop"]) mkdirSync(join(here, d), { recursive: true, mode: 0o700 });
  writeFileSync(join(here, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(here, "bin", "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(here, "bin", f), 0o755);
  writeFileSync(join(here, "ssh.log"), "");
  sockets.set("garden", await fakeDoor("garden", join(here, "laptop", "garden.sock")));
  sockets.set("orchard@hub", await fakeDoor("orchard", join(here, "laptop", "orchard.sock")));
  doors = [{ key: "garden", outline: "garden", idle: 90_000, clients: 1, screen: "desk" }];
  server = serveLink({ outlines: hub.outlines, port: 0, keys: { "box-a": "fictional-machine-key" }, log() {} });
  connector = connectLink({
    server: `http://127.0.0.1:${server.port}`, machine: "box-a", key: "fictional-machine-key", host: join(here, "laptop", "no-host.sock"),
    doors: async () => doors, doorSocket: key => sockets.get(key) ?? null, log() {},
  });
  await until(() => !!readLinkDoors(hub.outlines, "box-a")?.doors.length, "the link announces box-a's doors", 10_000);
}, 30_000);

afterAll(async () => {
  connector?.stop(); await server?.stop();
  for (const s of fakeDoors) s.close();
  try { process.kill(Number(readFileSync(join(here, "outlines", ".remote", "hub.ctl"), "utf8"))); } catch { /* gone */ }
  await hub.dispose();
  rmSync(here, { recursive: true, force: true });
});

const request = (path: string, req: unknown) => new Promise<any>((resolve, reject) => {
  const c = createConnection(path, () => c.write(JSON.stringify(req) + "\n"));
  let buf = "";
  c.on("data", d => { buf += d; if (buf.includes("\n")) { c.destroy(); resolve(JSON.parse(buf.slice(0, buf.indexOf("\n")))); } });
  c.on("error", reject);
  c.on("close", () => resolve(null));
});

describe("the link carries the connector's doors", () => {
  test("each door session there has a control socket here that reaches it, and only the ones it offers", async () => {
    const record = readLinkDoors(hub.outlines, "box-a")!;
    expect(record.doors.map(d => d.key)).toEqual(["garden"]);
    expect(record.addresses).toEqual(expect.any(Array));
    const path = linkDoorSocket(hub.outlines, "box-a", "garden");
    expect(record.doors[0]!.control).toBe(path);
    const answer = await request(path, { cmd: "peek", full: true });
    expect(answer.result).toMatchObject({ door: "garden", req: { cmd: "peek", full: true } });
    // A second door appears: its socket with it. One the connector stops naming: its socket goes.
    doors = [...doors, { key: "orchard@hub", outline: "orchard", machine: "hub", idle: 2000, clients: 1, screen: "board" }];
    await until(() => existsSync(linkDoorSocket(hub.outlines, "box-a", "orchard@hub")), "the second door's socket", 10_000);
    expect((await request(linkDoorSocket(hub.outlines, "box-a", "orchard@hub"), { cmd: "peek" })).result.door).toBe("orchard");
    doors = doors.filter(d => d.key !== "orchard@hub");
    await until(() => !existsSync(linkDoorSocket(hub.outlines, "box-a", "orchard@hub")), "the gone door's socket removed", 10_000);
    doors = [...doors, { key: "orchard@hub", outline: "orchard", machine: "hub", idle: 2000, clients: 1, screen: "board" }];
    await until(() => existsSync(linkDoorSocket(hub.outlines, "box-a", "orchard@hub")), "the door back", 10_000);
  }, 30_000);

  test("a stream to a door the connector didn't offer is closed, not sent anywhere else", async () => {
    const { LinkStreams } = await import("@ep0ch/outliner/link-streams");
    const { frame, readFrame, OPEN, CLOSE } = await import("@ep0ch/outliner/link-frame");
    const sent: Buffer[] = [];
    const streams = new LinkStreams(b => sent.push(b), t => (t === "" ? "/nowhere/host.sock" : t === "door:garden" ? sockets.get("garden")! : null));
    streams.receive(frame(OPEN, 7, Buffer.from("door:../../etc")));
    expect(sent.map(b => readFrame(b))).toEqual([{ op: CLOSE, id: 7, data: Buffer.alloc(0) }]);
    streams.close();
  });
});

describe("an agent here reaches box-a's doors through hub's link", () => {
  test("with no link named, a remote door is refused with the command that sets it up", async () => {
    const r = await ep0ch(["session", "list", "--machine", "box-a"], { FAKE_SSH_REFUSE: "box-a" });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("ep0ch session list");
  });

  test("link via, then session list --machine lists them; peek and act --remote reach the door the person is in", async () => {
    const via = await ep0ch(["link", "via", "box-a", "hub"]);
    expect(via.code, via.err).toBe(0);
    expect(JSON.parse(readFileSync(join(here, "outlines", ".remote", "box-a.json"), "utf8"))).toEqual({ via: "hub" });

    const list = await ep0ch(["session", "list", "--machine", "box-a"]);
    expect(list.code, list.err).toBe(0);
    expect(list.out).toContain("Sessions on box-a (through hub's link)");
    expect(list.out).toContain("ep0ch peek --remote box-a --ws garden");
    expect(list.out).toContain("orchard@hub");
    const json = JSON.parse((await ep0ch(["session", "list", "--machine", "box-a", "--json"])).out);
    expect(json).toMatchObject({ machine: "box-a", via: "hub" });
    // Forwarded over hub's ssh connection, to the same names here.
    expect(json.doors.map((d: any) => d.control)).toEqual(json.doors.map((d: any) => linkDoorSocket(join(here, "outlines"), "box-a", d.key)));
    const log = readFileSync(join(here, "ssh.log"), "utf8");
    expect(log).toContain('"-O","forward"');

    // The one the person typed in last (orchard, 2s ago, over garden's 90s), unless --ws names one.
    asked.length = 0;
    const peek = await ep0ch(["peek", "--json", "--remote", "box-a"]);
    expect(peek.code, peek.err).toBe(0);
    expect(asked.at(-1)).toMatchObject({ door: "orchard", req: { cmd: "peek" } });
    const named = await ep0ch(["peek", "--json", "--remote", "box-a", "--ws", "garden"]);
    expect(named.code, named.err).toBe(0);
    expect(asked.at(-1)).toMatchObject({ door: "garden" });
    const act = await ep0ch(["act", "block.mark", "id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", "--remote", "box-a", "--ws", "garden", "--as", "gardener"]);
    expect(act.code, act.err).toBe(0);
    expect(asked.at(-1)).toMatchObject({ door: "garden", req: { cmd: "act", action: "block.mark", as: "gardener" } });

    const missing = await ep0ch(["peek", "--remote", "box-a", "--ws", "meadow"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no door runs on meadow there (garden, orchard@hub)");
  }, 60_000);

  test("ep0ch where lists the doors on other machines, and an ssh session from box-a reaches its door first", async () => {
    const where = await ep0ch(["where", "--json"]);
    expect(where.code, where.err).toBe(0);
    const w = JSON.parse(where.out);
    expect(w.elsewhere).toEqual([{ machine: "box-a", via: "hub", doors: ["garden", "orchard@hub"] }]);
    expect(w.summary).toContain("doors on other machines: box-a (through hub's link): garden, orchard@hub");
    const address = Object.values(networkInterfaces()).flat().find(i => i && !i.internal)?.address;
    if (!address) return; // A machine with no network interface but loopback: the connector announced no address to match.
    const fromBox = await ep0ch(["where", "--json"], { SSH_CONNECTION: `${address} 50123 10.0.0.2 22` });
    const r = JSON.parse(fromBox.out);
    expect(r.reach).toMatchObject({ rule: "ssh" });
    expect(r.reach.text).toContain("reached box-a's door on orchard@hub, where this ssh session comes from (through hub's link)");
    expect(r.door.outline).toBe("orchard");
    // Somewhere else: not box-a's.
    const other = JSON.parse((await ep0ch(["where", "--json"], { SSH_CONNECTION: "192.0.2.77 50123 10.0.0.2 22" })).out);
    expect(other.reach.rule).not.toBe("ssh");
  }, 60_000);
});

describe("a real door session, through the link", () => {
  test("its own control protocol answers through the socket the link gives it, and an agent's act is attributed there", async () => {
    const { startSession } = await import("../src/session/start");
    const { placeOf } = await import("../src/session/place");
    const { linkDoorSessions } = await import("../src/link");
    await hub.create("meadow");
    const laptopState = join(here, "laptop-state");
    mkdirSync(laptopState, { recursive: true, mode: 0o700 });
    const laptop = { ...process.env, ...hub.env, EP0CH_WS: "", EP0CH_MACHINE: "", EP0CH_SOCKET: "", EP0CH_CONTROL: "", EP0CH_STATE: laptopState, EP0CH_DAILY_AGENT: "sh" } as Record<string, string>;
    expect(await startSession(placeOf({ outline: "meadow" }, laptopState, laptop).dir, ["--ws", "meadow", "--screen", "desk"], laptop)).toEqual({ ok: true });
    const outlines = join(here, "real-hub");
    mkdirSync(outlines, { recursive: true, mode: 0o700 });
    const real = serveLink({ outlines, port: 0, keys: { "box-b": "fictional-machine-key" }, log() {} });
    const sessions = linkDoorSessions(laptopState);
    const link = connectLink({ server: `http://127.0.0.1:${real.port}`, machine: "box-b", key: "fictional-machine-key", host: hub.sock, doors: sessions.list, doorSocket: sessions.socket, log() {} });
    try {
      await until(() => !!readLinkDoors(outlines, "box-b")?.doors.length, "the session announced", 10_000);
      const control = linkDoorSocket(outlines, "box-b", "meadow");
      const peek = await ep0ch(["peek", "--json"], { EP0CH_CONTROL: control });
      expect(peek.code, peek.err).toBe(0);
      expect(JSON.parse(peek.out).outline).toBe("meadow");
      const layout = JSON.parse((await ep0ch(["act", "layout.get", "--as", "gardener"], { EP0CH_CONTROL: control })).out);
      const shown = layout.tiles.find((t: any) => t.name === "reader").showing.id;
      // An agent's mark, as itself: the door records who, and never moves the person's focus.
      const mark = await ep0ch(["act", "block.mark", `id=${shown}`, "reason=needs your call", "--as", "gardener"], { EP0CH_CONTROL: control });
      expect(mark.code, mark.err).toBe(0);
      const after = await ep0ch(["peek", "--json"], { EP0CH_CONTROL: control });
      expect(after.out).toContain("gardener");
      expect(JSON.parse((await ep0ch(["act", "layout.get"], { EP0CH_CONTROL: control })).out).focus).toBe(layout.focus);
    } finally {
      link.stop(); await real.stop();
      await ep0ch(["session", "end", "--all", "--yes"], { EP0CH_STATE: laptopState, ...hub.env });
    }
  }, 60_000);
});
