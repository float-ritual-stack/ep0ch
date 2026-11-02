// PIE-1498: `ssh ep0ch` lands where Evan left off after a deploy. The session is started the way the ssh door starts
// it (no --screen flag: the logon, then the main menu, then D for the desk), and handed over with no terminal attached,
// which is how `ep0ch install --apply` finds it. The next daemon's checkpoint must hold the desk, and a terminal
// attaching after the handover sees the desk with its tiles and the drawer as they were.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { Mirror } from "../src/mirror";
import { SocketBoard } from "../src/socket";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type Hello } from "../src/session/protocol";
import { startSession } from "../src/session/start";
import { placeFor, sessionFile, sessionInfo as infoOn, sessionLog, sessionSocket, type Place } from "../src/session/place";
import { outliner, Scratch, ScratchHost, scratchDir, until } from "./scratch";

class Term {
  readonly mirror: Mirror;
  readonly got: DaemonMsg[] = [];
  closed = false;
  private frames = new Frames<DaemonMsg>();
  private constructor(private sock: Socket, cols: number, rows: number) {
    this.mirror = new Mirror(cols, rows);
    sock.on("data", (d: Buffer) => { for (const m of this.frames.push(d)) { this.got.push(m); if (m.t === "output") this.mirror.write(m.text); } });
    sock.on("close", () => { this.closed = true; });
    sock.on("error", () => {});
  }
  static async attach(path: string, cols: number, rows: number): Promise<Term> {
    const sock = await new Promise<Socket>((res, rej) => { const s = connect(path, () => res(s)); s.once("error", rej); });
    const c = new Term(sock, cols, rows);
    const hello: Hello = { proto: PROTOCOL, remote: false, cols, rows, cellW: 9, cellH: 16, kitty: false, pid: 4242 };
    c.send({ t: "hello", hello });
    return c;
  }
  send(m: ClientMsg) { this.sock.write(encode(m)); }
  type(s: string) { this.send({ t: "input", text: s }); }
  screen() { return this.mirror.text().join("\n"); }
  close() { this.sock.destroy(); }
}

let dir = "";
function request(m: ClientMsg, ms = 30_000): Promise<DaemonMsg | "closed"> {
  return new Promise(res => {
    const sock = connect(sessionSocket(dir)), f = new Frames<DaemonMsg>();
    const t = setTimeout(() => { sock.destroy(); res("closed"); }, ms);
    sock.on("connect", () => sock.write(encode(m)));
    sock.on("data", (d: Buffer) => { const got = f.push(d)[0]; if (got) { clearTimeout(t); sock.end(); res(got); } });
    sock.on("close", () => { clearTimeout(t); res("closed"); });
    sock.on("error", () => {});
  });
}
/** `session end --force` on a session in `d` (not the module's `dir`). */
function askEnd(d: string, ms = 10_000): Promise<DaemonMsg | "closed"> {
  return new Promise(res => {
    const sock = connect(sessionSocket(d)), f = new Frames<DaemonMsg>();
    const t = setTimeout(() => { sock.destroy(); res("closed"); }, ms);
    sock.on("connect", () => sock.write(encode({ t: "end", force: true })));
    sock.on("data", (d: Buffer) => { const got = f.push(d)[0]; if (got) { clearTimeout(t); sock.end(); res(got); } });
    sock.on("close", () => { clearTimeout(t); res("closed"); });
    sock.on("error", () => {});
  });
}
const control = (req: Record<string, unknown>) => new Promise<any>((res, rej) => {
  const s = connect(join(dir, "door.sock"));
  let buf = "";
  s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
  s.on("data", d => { buf += d; if (buf.includes("\n")) { s.end(); const r = JSON.parse(buf); r.ok ? res(r.result) : rej(new Error(r.error)); } });
  s.on("error", rej);
});
const daemonPid = () => JSON.parse(readFileSync(sessionFile(dir), "utf8")).pid as number;
const checkpoint = () => JSON.parse(readFileSync(join(dir, "session-state.json"), "utf8")) as { menu: boolean; screens: { action: string; args?: Record<string, unknown> }[] };
/** The last `restored {...}` line the daemons wrote to the session log. */
const lastRestored = () => {
  const line = readFileSync(sessionLog(dir), "utf8").split("\n").filter(l => l.includes(": restored ")).at(-1);
  return line ? JSON.parse(line.slice(line.indexOf("restored ") + "restored ".length)) as { screens: number; checkpoint: { screens: number } } : null;
};

describe.skipIf(!outliner)("a handover with no terminal attached keeps the screen (PIE-1498)", () => {
  let scratch: Scratch;
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string | undefined) => { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };

  beforeAll(async () => {
    scratch = new Scratch();
    const sock = await scratch.start();
    const b = new SocketBoard(sock);
    await b.info();
    await b.request("create", { parentId: null, text: "Seed swap list\nBeans, chard", author: "agent" });
    b.close();
    env("EP0CH_STATE", join(scratch.root, "door"));
    env("EP0CH_SOCKET", sock);
    env("EP0CH_WS", scratch.name);
    env("EP0CH_LANDING", undefined);
    env("EP0CH_DAILY_AGENT", "sh");
    dir = (placeFor([]) as Place).dir;
    // As the ssh door starts it: no screen flag, the logon first.
    expect(await startSession(dir, [])).toEqual({ ok: true });
  }, 60_000);

  afterAll(async () => {
    const info = await infoOn(sessionSocket(dir)).catch(() => null);
    if (info) await request({ t: "end", force: true }, 10_000);
    for (const pid of [info?.pid, info?.host]) if (pid) { try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await scratch.dispose();
  }, 30_000);

  test("logon, the desk with two tiles and the drawer up; detach; upgrade; the next daemon restores the desk and a terminal sees it", async () => {
    const a = await Term.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().toLowerCase().includes("enter"), "the logon", 10_000);
    a.type("\r");                                            // hurries the modem script
    await Bun.sleep(200);
    a.type("\r");                                            // logs on
    await until(() => a.screen().includes("main menu"), "the main menu", 10_000).catch(e => { console.log(a.screen()); throw e; });
    a.type("D");
    await until(() => a.screen().includes("outline"), "the desk", 15_000);
    const opened = await control({ cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    expect(opened.tile).toBeTruthy();
    a.type("\x1ba");                                          // alt+a: the drawer up
    const drawerUp = async () => !!(await control({ cmd: "peek" })).screen.drawer?.open;
    for (let i = 0; i < 50 && !(await drawerUp()); i++) await Bun.sleep(100);
    const stateBefore = await control({ cmd: "peek" });
    expect(stateBefore?.screen?.drawer?.open).toBe(true);
    const tilesBefore = (await control({ cmd: "act", action: "layout.get", as: "test-agent" })).tiles?.map((t: any) => t.name ?? t.tile).sort();

    // The checkpoint, written as the screens changed, holds the desk.
    await until(() => checkpoint().screens.some(s => s.action === "screen.open" && s.args?.name === "desk"), "the desk in the checkpoint", 5000)
      .catch(e => { console.log("checkpoint:", JSON.stringify(checkpoint())); throw e; });

    // The person's terminal goes away (ssh closed): the session goes on without one, as a deploy finds it.
    a.close();
    await until(() => a.closed, "the terminal gone", 5000);
    await Bun.sleep(300);
    const before = daemonPid();
    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => { try { return daemonPid() !== before; } catch { return false; } }, "the new daemon", 20_000);
    await until(() => lastRestored() !== null && lastRestored()!.checkpoint !== undefined, "the restore logged", 20_000);
    const restored = lastRestored()!;
    expect(restored.checkpoint.screens).toBeGreaterThan(0);
    expect(restored.screens).toBeGreaterThan(0);

    // A terminal attaching now lands on the desk, its tiles and the drawer as they were.
    const b = await Term.attach(sessionSocket(dir), 140, 40);
    await until(() => b.screen().includes("outline"), "the desk after the handover", 15_000).catch(e => { console.log(b.screen()); throw e; });
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 10_000);
    const tilesAfter = (await control({ cmd: "act", action: "layout.get", as: "test-agent" })).tiles?.map((t: any) => t.name ?? t.tile).sort();
    expect(tilesAfter).toEqual(tilesBefore);
    expect((await control({ cmd: "peek" })).screen.drawer?.open).toBe(true);
    b.close();
  }, 120_000);

  test("the desk left in the background (q with a program running), a handover with no terminal: D brings it back with its tile", async () => {
    const a = await Term.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("outline"), "the desk", 15_000);
    const shells = async () => (await infoOn(sessionSocket(dir)))!.terminals.filter(t => t.cmd === "sh").map(t => t.pid).sort();
    const before = await shells();
    expect(before.length).toBe(2);                            // the desk's tile and the drawer's
    a.type("\x1ba");                                          // alt+a: the drawer away, so q is the desk's
    await Bun.sleep(300);
    a.type("q");
    await until(() => a.screen().includes("main menu"), "back on the main menu", 10_000).catch(e => { console.log(a.screen()); throw e; });
    await until(() => checkpoint().screens.some(s => s.action === "screen.back"), "the desk kept in the background in the checkpoint", 5000)
      .catch(e => { console.log("checkpoint:", JSON.stringify(checkpoint())); throw e; });
    a.close();
    await until(() => a.closed, "the terminal gone", 5000);
    await Bun.sleep(300);
    const pid = daemonPid();
    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => { try { return daemonPid() !== pid; } catch { return false; } }, "the new daemon", 20_000);
    await until(() => lastRestored() !== null && lastRestored()!.checkpoint.screens > 0 && lastRestored()!.screens > 0, "the restore logged with the desk", 20_000)
      .catch(e => { console.log("restored:", JSON.stringify(lastRestored()), "checkpoint:", JSON.stringify(checkpoint())); throw e; });
    // The next checkpoint, written as the new daemon settles, still holds the desk (else the handover after this one loses it).
    await Bun.sleep(1000);
    expect(checkpoint().screens.map(s => s.action)).toEqual(["screen.open", "screen.back"]);
    const b = await Term.attach(sessionSocket(dir), 140, 40);
    await until(() => b.screen().includes("main menu"), "the main menu after the handover", 15_000).catch(e => { console.log(b.screen()); throw e; });
    b.type("D");
    await until(() => b.screen().includes("outline"), "the desk back", 15_000).catch(e => { console.log(b.screen()); throw e; });
    // The desk's shell is back in its tile; the drawer's stays kept until the drawer is pulled up and drawn.
    for (let i = 0; i < 50 && (await shells()).length < 1; i++) await Bun.sleep(100);
    expect(before).toContain((await shells())[0]!);
    b.type("\x1ba");                                          // alt+a: the drawer up
    for (let i = 0; i < 50 && (await infoOn(sessionSocket(dir)))!.kept.length; i++) await Bun.sleep(100);
    expect((await infoOn(sessionSocket(dir)))!.kept).toEqual([]);
    expect(await shells()).toEqual(before);                   // the same two shells, in their tiles
    b.close();
  }, 120_000);
});

// The second half of PIE-1498: an outline on another machine. The session is started as the ssh door starts it
// (`--ws garden --machine box-a`), the machine being a scratch host behind the fake ssh; the status line, walked by
// keys, says `garden on box-a · session on <this machine>`.
describe.skipIf(!outliner)("the status line names the session's machine (PIE-1498)", () => {
  const far = new ScratchHost();   // box-a
  const local = new ScratchHost(); // this machine's host, so nothing is created here
  let here = "";
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string | undefined) => { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  let machineDir = "";

  beforeAll(async () => {
    await far.start("garden");
    await local.start();
    here = scratchDir("ep0ch-handover-machine-");
    for (const d of ["bin", "far-home", "outlines"]) mkdirSync(join(here, d), { recursive: true, mode: 0o700 });
    writeFileSync(join(here, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
    writeFileSync(join(here, "bin", "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "../src/main.ts")} "$@"\n`);
    for (const f of ["ssh", "ep0ch"]) chmodSync(join(here, "bin", f), 0o755);
    env("EP0CH_STATE", join(here, "door"));
    env("EP0CH_OUTLINES", local.outlines);
    env("EP0CH_SOCKET", undefined);
    env("EP0CH_WS", undefined);
    env("EP0CH_MACHINE", undefined);
    env("EP0CH_LANDING", undefined);
    env("EP0CH_DAILY_AGENT", "sh");
    env("EP0CH_SSH", join(here, "bin", "ssh"));
    env("FAKE_SSH_HOME", join(here, "far-home"));
    env("FAKE_SSH_OUTLINES", far.outlines);
    env("FAKE_SSH_BIN", join(here, "bin"));
    env("FAKE_SSH_LOG", join(here, "ssh.log"));
    mkdirSync(join(here, "door"), { recursive: true, mode: 0o700 });
    const placed = placeFor(["--ws", "garden", "--machine", "box-a"]);
    expect(placed && !("error" in placed)).toBe(true);
    machineDir = (placed as Place).dir;
    // `--create`: the one way an outline is made on another machine (PIE-545); the ssh door never passes it.
    expect(await startSession(machineDir, ["--ws", "garden", "--machine", "box-a", "--create"])).toEqual({ ok: true });
  }, 60_000);

  afterAll(async () => {
    const info = await infoOn(sessionSocket(machineDir)).catch(() => null);
    if (info) await askEnd(machineDir);
    for (const pid of [info?.pid, info?.host]) if (pid) { try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await local.dispose();
    await far.dispose();
    rmSync(here, { recursive: true, force: true });
  }, 30_000);

  test("logon, then the main menu: the status line says garden on box-a · session on this machine", async () => {
    const a = await Term.attach(sessionSocket(machineDir), 160, 40);
    await until(() => a.screen().toLowerCase().includes("enter"), "the logon", 15_000).catch(e => { console.log(a.screen()); throw e; });
    a.type("\r"); await Bun.sleep(200); a.type("\r");
    await until(() => a.screen().includes("main menu"), "the main menu", 10_000).catch(e => { console.log(a.screen()); throw e; });
    const said = `garden on box-a · session on ${hostname()}`;
    await until(() => a.screen().includes(said), "the status line naming both machines (once the start-up notice goes)", 30_000).catch(e => { console.log(a.screen().split("\n").at(-1)); throw e; });
    const info = (await infoOn(sessionSocket(machineDir)))!;
    expect(info.place).toMatchObject({ outline: "garden", machine: "box-a" });
    a.close();
  }, 60_000);
});
