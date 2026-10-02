// The session's handoff and restore (PIE-418): the terminal host keeps the programs; a new daemon adopts them, reopens
// the screens and the edits that were open, and replays what's safe from the journal.
// - the terminal host's frames, and a host of another protocol ended and replaced;
// - the journal: what it records, and a restore that runs the checkpoint, the safe actions on their screen, holds the
//   ones that write, and waits for a reader to have its note before reopening its edit;
// - a real session on a scratch service: `session restart` hands over to a new daemon, and the shell in a tile is the
//   same process with its output, the edit open again; a daemon killed with -9 comes back the same way; ending the
//   session ends the terminal host and its programs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mirror } from "../src/mirror";
import { USER } from "../src/socket";
import { SocketBoard } from "../src/socket";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type Hello } from "../src/session/protocol";
import { ensurePtyHost, frame, HostFrames, HOST_PROTOCOL, ptyHostSocket } from "../src/session/pty-host";
import { restore, screenSteps, type Checkpoint, type Step } from "../src/session/restore";
import { sessionInfo } from "../src/session/client";
import { sessionFile, sessionSocket, startSession } from "../src/session/start";
import { controlSocket } from "../src/control";
import { MainMenu } from "../src/screens";
import { outliner, Scratch, until } from "./scratch";

describe("the terminal host", () => {
  test("its frames come out whole however the stream cuts them", () => {
    const bytes = Buffer.concat([frame("o", 7, Buffer.from("leeks\x1b[1m")), frame("z", 7, { cols: 80, rows: 24 }), frame("y", 0)]);
    for (const cut of [1, 4, 9, bytes.length]) {
      const f = new HostFrames(), got: { t: string; id: number }[] = [];
      for (let i = 0; i < bytes.length; i += cut) got.push(...f.push(bytes.subarray(i, i + cut)).map(x => ({ t: x.t, id: x.id, ...(x.json ? { json: x.json } : { raw: x.raw.toString() }) })));
      expect(got).toEqual([{ t: "o", id: 7, raw: "leeks\x1b[1m" }, { t: "z", id: 7, json: { cols: 80, rows: 24 } }, { t: "y", id: 0, raw: "" }] as any);
    }
  });

  test("a host of another protocol is ended and a new one started (its programs can't be adopted)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-host-")), was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    let ended = false;
    const old = createServer(sock => {
      const f = new HostFrames();
      sock.on("data", (d: Buffer) => {
        for (const x of f.push(d)) {
          if (x.t === "h") { sock.write(frame("l", 0, { proto: HOST_PROTOCOL + 1, pid: 1, ptys: [] })); sock.write(frame("y", 0)); }
          if (x.t === "q") { ended = true; old.close(); try { rmSync(ptyHostSocket()); } catch { /* gone */ } }
        }
      });
    });
    await new Promise<void>(r => old.listen(ptyHostSocket(), () => r()));
    try {
      const { host, ended: n } = await ensurePtyHost();
      expect(ended).toBe(true);
      expect(n).toBe(0);
      expect(host.hostPid).not.toBe(1);
      host.endAll();
      await until(() => !existsSync(ptyHostSocket()), "the new host to end", 5000);
    } finally {
      if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("the journal and the restore", () => {
  /** An App enough for a restore: a stack, and a dispatcher that records what it's asked and refuses what it's told to. */
  function stubApp(refuse: (s: { action: string; reader?: string; args: Record<string, unknown> }) => string | null = () => null) {
    const stack: any[] = [], ran: { action: string; reader?: string; args: Record<string, unknown>; as: string }[] = [];
    const app = {
      background: [], screens: () => stack, push: (s: any) => { stack.push(s); },
      dispatch: {
        act: async (req: { action: string; reader?: string; args: Record<string, unknown> }, actor: { kind: string; id?: string }) => {
          const no = refuse(req);
          if (no) throw new Error(no);
          ran.push({ action: req.action, ...(req.reader ? { reader: req.reader } : {}), args: req.args, as: actor.kind === "agent" ? actor.id! : "you" });
          if (req.action === "screen.open") stack.push({ title: String(req.args.name), name: req.args.name });
          if (req.action === "screen.back") stack.pop();
          return {};
        },
      },
    };
    return { app: app as any, ran };
  }

  test("the screens open are the steps that open them: the background's kept so, nothing before the logon", () => {
    const menu = new MainMenu(), desk = { title: "desk", name: "desk" }, board = { title: "board", name: "board" }, list = { title: "new scan" };
    expect(screenSteps([menu, board, list] as any, [desk] as any)).toEqual([
      { action: "screen.open", args: { name: "desk" } }, { action: "screen.back" }, { action: "screen.open", args: { name: "board" } },
    ]);
    expect(screenSteps([{ title: "logon" }] as any, [])).toEqual([]);
  });

  test("a restore opens the screens, replays the safe steps on the screen they ran on, holds what writes, and reopens the edit", async () => {
    let noteRead = false;
    const { app, ran } = stubApp(req => (req.action === "edit" && !noteRead ? "this reader shows no note; open one first" : req.action === "tile.split" ? "the layout changed since revision 12 (it is 1790000000000 now)" : null));
    setTimeout(() => { noteRead = true; }, 250);
    const c: Checkpoint = { v: 1, at: 0, screens: [{ action: "screen.open", args: { name: "desk" } }], reopen: [{ action: "edit", tile: "reader", screen: "desk" }] };
    const journal: Step[] = [
      { action: "scroll", args: { by: 5 }, tile: "reader", replay: "safe", screen: "desk", actor: USER },
      { action: "tile.split", args: { expected: 12 }, tile: "reader", replay: "safe", screen: "desk", actor: USER },
      { action: "edit.save", tile: "reader", replay: "ask", screen: "desk", actor: USER },
      { action: "fold", args: { at: 2 }, tile: "outline", replay: "safe", screen: "board", actor: { kind: "agent", id: "gardener" } },
    ];
    const r = await restore(app, c, journal);
    expect(app.screens()[0]).toBeInstanceOf(MainMenu);
    expect(ran.map(x => x.action)).toEqual(["screen.open", "scroll", "edit"]);
    expect(r).toMatchObject({ screens: 1, replayed: 1, refused: 2, held: ["edit.save"], reopened: 1 });
  });
});

/** A client speaking the protocol over the session socket, with a mirror for a terminal. */
class RawClient {
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
  static async attach(path: string, cols: number, rows: number): Promise<RawClient> {
    const sock = await new Promise<Socket>((res, rej) => { const s = connect(path, () => res(s)); s.once("error", rej); });
    const c = new RawClient(sock, cols, rows);
    const hello: Hello = { proto: PROTOCOL, cols, rows, cellW: 9, cellH: 16, kitty: false, pid: 4242 };
    c.send({ t: "hello", hello });
    return c;
  }
  send(m: ClientMsg) { this.sock.write(encode(m)); }
  type(s: string) { this.send({ t: "input", text: s }); }
  screen() { return this.mirror.text().join("\n"); }
  close() { this.sock.destroy(); }
}

/** One request on the session socket without attaching (as `ep0ch session restart` and `end` send them): its first answer, or the close. */
function request(m: ClientMsg, ms = 30_000): Promise<DaemonMsg | "closed"> {
  return new Promise(res => {
    const sock = connect(sessionSocket()), f = new Frames<DaemonMsg>();
    const t = setTimeout(() => { sock.destroy(); res("closed"); }, ms);
    sock.on("connect", () => sock.write(encode(m)));
    sock.on("data", (d: Buffer) => { const got = f.push(d)[0]; if (got) { clearTimeout(t); sock.end(); res(got); } });
    sock.on("close", () => { clearTimeout(t); res("closed"); });
    sock.on("error", () => {});
  });
}

describe.skipIf(!outliner)("handing a real session over, and back after a crash", () => {
  let scratch: Scratch;
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };
  let plot = "";
  const control = (req: Record<string, unknown>) => new Promise<any>((res, rej) => {
    const s = connect(controlSocket());
    let buf = "";
    s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
    s.on("data", d => { buf += d; if (buf.includes("\n")) { s.end(); const r = JSON.parse(buf); r.ok ? res(r.result) : rej(new Error(r.error)); } });
    s.on("error", rej);
  });
  const daemonPid = () => JSON.parse(readFileSync(sessionFile(), "utf8")).pid as number;
  const shellPid = async () => (await sessionInfo())!.terminals.find(t => t.cmd === "sh")?.pid;

  beforeAll(async () => {
    scratch = new Scratch();
    const sock = await scratch.start();
    const b = new SocketBoard(sock);
    await b.info();
    plot = (await b.request<{ id: string }>("create", { parentId: null, text: "Seed swap list\nBeans, chard", author: "agent" })).id;
    b.close();
    env("EP0CH_STATE", join(scratch.root, "door"));
    env("EP0CH_SOCKET", sock);
    env("EP0CH_DAILY_AGENT", "sh");
    expect(await startSession(["--desk"])).toEqual({ ok: true });
  }, 60_000);

  afterAll(async () => {
    // Whatever is left of it: ended (its terminal host with it), then killed by pid if it didn't go.
    const info = await sessionInfo().catch(() => null);
    if (info) { await request({ t: "end", force: true }, 10_000); }
    for (const pid of [info?.pid, info?.host]) if (pid) { try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await scratch.dispose();
  }, 30_000);

  test("`session restart`: a new daemon, the same shell with its output, the screens and the edit open again", async () => {
    const a = await RawClient.attach(sessionSocket(), 140, 40);
    await until(() => a.screen().includes("outline"), "the desk", 10_000);
    const opened = await control({ cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    for (let i = 0; ; i++) {
      try { await control({ cmd: "act", action: "tile.type", tile: opened.id, args: { text: "echo chard-$((6*7))\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => a.screen().includes("chard-42"), "the shell's output", 10_000);
    await control({ cmd: "act", action: "open", args: { id: plot }, as: "test-agent" });
    await until(() => a.screen().includes("Beans, chard"), "the note in the reader", 10_000);
    a.type("2");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "reader"; i++) await Bun.sleep(100);
    a.type("e");
    await until(() => a.screen().includes("ctrl+s"), "the edit open", 10_000);
    a.type(" and kale");
    await until(() => a.screen().includes("and kale"), "the typed text", 10_000);
    const before = { daemon: daemonPid(), shell: await shellPid() };
    expect(before.shell).toBeGreaterThan(0);

    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => a.closed, "the old daemon to let the terminal go", 5000);
    expect(a.got.find(m => m.t === "bye")).toMatchObject({ reason: "upgrade" });
    expect(daemonPid()).not.toBe(before.daemon);
    expect(await shellPid()).toBe(before.shell);           // the same process, never restarted

    const b = await RawClient.attach(sessionSocket(), 140, 40);
    await until(() => b.screen().includes("chard-42") && b.screen().includes("and kale"), "the shell's output and the edit after the handoff", 10_000).catch(e => { console.log(b.screen()); throw e; });
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 5000);
    const peek = await control({ cmd: "peek" });
    // The edit is open again on the same note, unsaved, its text brought back from where the handoff put it aside.
    expect(JSON.stringify(peek.screen.state)).toContain(`"place":"edit:${plot}"`);
    expect(JSON.stringify(peek.screen.state)).toContain(`"dirty":true`);
    b.close();
  }, 60_000);

  test("a daemon killed with -9: the next start restores the screens and adopts the shell", async () => {
    const before = { daemon: daemonPid(), shell: await shellPid() };
    process.kill(before.daemon, "SIGKILL");
    await until(() => { try { process.kill(before.daemon, 0); return false; } catch { return true; } }, "the daemon gone", 5000);
    expect(await startSession([])).toEqual({ ok: true });
    expect(daemonPid()).not.toBe(before.daemon);
    // Kept in the terminal host (adopted by its tile as the desk is drawn, maybe already).
    const after = (await sessionInfo())!;
    expect([...after.kept!.map(k => k.pid), ...after.terminals.map(t => t.pid)]).toContain(before.shell!);
    const c = await RawClient.attach(sessionSocket(), 120, 36);
    await until(() => c.screen().includes("chard-42"), "the shell's output after the crash", 10_000);
    expect(await shellPid()).toBe(before.shell);
    await until(() => c.screen().includes("came back after its daemon stopped"), "the restore said", 5000);
    c.close();
  }, 60_000);

  test("ending the session ends its terminal host and the programs in it; nothing is left to restore", async () => {
    const info = (await sessionInfo())!;
    const shell = await shellPid();
    expect(await request({ t: "end", force: true }, 15_000)).toBe("closed");
    await until(() => { try { process.kill(info.host!, 0); return false; } catch { return true; } }, "the terminal host to end", 10_000);
    expect(() => process.kill(shell!, 0)).toThrow();
    for (const f of ["session-state.json", "session-journal.jsonl", "session.json", "pty.sock", "session.sock"]) expect(existsSync(join(scratch.root, "door", f))).toBe(false);
  }, 30_000);
});
