// The door session (PIE-418): a door that keeps running without a terminal, and the terminals that attach to it.
// - the protocol's frames, whole however they arrive;
// - two clients on one session: the keys where the person last typed, each painted at its own size and video mode,
//   a click aimed at another size's frame only taking the session, a watcher never the keys, the terminal handed
//   over to the client with the keys, logging off detaching only that client;
// - the handoff and the restore (at the end): the terminal host, the journal, `session restart` and a daemon killed
//   with -9 keeping the programs;
// - a real session on a scratch service: attach, open a terminal tile, detach, attach again and find the tile's
//   program still running with its scrollback, an unsaved draft and the layout; two clients consistent; an agent
//   acting through the control socket; `end` asking while programs run, then ending.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { App } from "../src/app";
import { Mirror } from "../src/mirror";
import { Draft } from "../src/edit";
import { openInEditor } from "../src/surface/editor";
import { SocketBoard } from "../src/socket";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type Hello } from "../src/session/protocol";
import { SessionTerm, type Link } from "../src/session/session-term";
import { doorMode, runEnv, sessionInfo } from "../src/session/client";
import { sessionEnv, startSession } from "../src/session/start";
import { ancestors, sessionFile, sessionSocket, takeLock } from "../src/session/daemon";
import { controlSocket } from "../src/control";
import { ensurePtyHost, frame, HostFrames, HOST_PROTOCOL, ptyHostSocket } from "../src/session/pty-host";
import { restore, screenSteps, type Checkpoint } from "../src/session/restore";
import { MainMenu } from "../src/screens";
import { createServer } from "node:net";
import { USER } from "../src/socket";
import { localPtys, usePtyBackend } from "../src/desk/pty-backend";
import { mouseBytes, PtyPane } from "../src/desk/pty";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("the session protocol", () => {
  test("frames come out whole however the stream cuts them, raw text and JSON alike", () => {
    const msgs: (ClientMsg | DaemonMsg)[] = [
      { t: "input", text: "j\x1b[<0;6;7Mé漢🙂" },
      { t: "resize", cols: 120, rows: 40 },
      { t: "output", text: "\x1b[1;1Hrow one\x1b[K" },
      { t: "bye", reason: "detached", message: "see you" },
    ];
    const bytes = Buffer.concat(msgs.map(encode));
    for (const cut of [1, 3, 7, bytes.length]) {
      const f = new Frames<ClientMsg | DaemonMsg>(), got: unknown[] = [];
      for (let i = 0; i < bytes.length; i += cut) got.push(...f.push(bytes.subarray(i, i + cut)));
      expect(got).toEqual(msgs);
    }
  });

  test("a frame of an unknown type, or over the limit, is refused, never guessed at", () => {
    expect(() => new Frames().push(Buffer.from([0x5a, 0, 0, 0, 0]))).toThrow(/unknown frame type/);
    const big = Buffer.alloc(5); big.write("o", 0, "latin1"); big.writeUInt32BE(0xffffffff, 1);
    expect(() => new Frames().push(big)).toThrow(/over the limit/);
  });
});

describe("the door is a session by default", () => {
  test("`ep0ch` attaches (starting one when none runs); --no-daemon and EP0CH_DAEMON=0 open it in this terminal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-mode-")), was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    try {
      expect(await doorMode([], {})).toEqual({ mode: "attach", running: false });
      expect(await doorMode(["--board"], { EP0CH_DAEMON: "1" })).toEqual({ mode: "attach", running: false });
      expect(await doorMode(["--no-daemon"], {})).toEqual({ mode: "local", running: false });
      expect(await doorMode([], { EP0CH_DAEMON: "0" })).toEqual({ mode: "local", running: false });
    } finally {
      if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a session is for a terminal", () => {
  test("`ep0ch` with no terminal (a script, an agent's shell) starts no session and says what to run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-notty-"));
    try {
      const env: Record<string, string> = { ...(process.env as Record<string, string>), EP0CH_STATE: join(dir, "s"), EP0CH_CONTROL: join(dir, "s", "door.sock"), EP0CH_SOCKET: join(dir, "nowhere.sock") };
      delete env.EP0CH_DAEMON;
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts")], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      expect(await p.exited).toBe(1);
      expect(await new Response(p.stderr).text()).toContain("not a terminal");
      expect(existsSync(join(dir, "s", "session.sock"))).toBe(false);
      expect(existsSync(join(dir, "s", "session.lock"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a process's parents are found, so a program kept from an earlier daemon can't attach the session into itself", () => {
    expect(ancestors(process.pid)[0]).toBe(process.ppid);
  });
});

describe("the session's environment", () => {
  test("a session keeps nothing of the terminal that started it, nor of an outer door it was started in", () => {
    const env = sessionEnv({ HOME: "/home/fern", TERM: "xterm-kitty", SSH_TTY: "/dev/pts/4", TMUX: "/tmp/tmux-1/default,1,0", EP0CH_STATE: "/tmp/plot", EP0CH_CONTROL: "/tmp/outer/door.sock", EP0CH_TILE: "t2", EP0CH_IN_DOOR: "1", EP0CH_NEST: "ssh:pts/4" });
    expect(env).toEqual({ HOME: "/home/fern", EP0CH_STATE: "/tmp/plot" });
    // A test door's own EP0CH_CONTROL (not inside a door) is kept.
    expect(sessionEnv({ EP0CH_CONTROL: "/tmp/plot/door.sock" })).toEqual({ EP0CH_CONTROL: "/tmp/plot/door.sock" });
  });

  test("a program the session hands a terminal runs with that terminal's TERM, ssh, tmux and locale, its layers first", () => {
    const env = runEnv({ HOME: "/home/fern", EP0CH_CONTROL: "/tmp/plot/door.sock", EP0CH_NEST: "shell:4242" }, { TERM: "xterm-ghostty", SSH_TTY: "/dev/pts/9", LANG: "en_NZ.UTF-8", EP0CH_NEST: "ssh:pts/9", HOME: "/elsewhere" });
    expect(env).toEqual({ HOME: "/home/fern", EP0CH_CONTROL: "/tmp/plot/door.sock", TERM: "xterm-ghostty", SSH_TTY: "/dev/pts/9", LANG: "en_NZ.UTF-8", EP0CH_NEST: "ssh:pts/9 › shell:4242" });
  });
});

describe("$EDITOR's text is never dropped", () => {
  const draftIn = async (change: (d: Draft) => void, code: number | null, held = true) => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-editor-")), was = { state: process.env.EP0CH_STATE, editor: process.env.EDITOR, visual: process.env.VISUAL };
    process.env.EP0CH_STATE = dir; process.env.EDITOR = "true"; delete process.env.VISUAL;
    try {
      const d = new Draft("0a1b2c3d-plot", 4, "Water the leeks");
      const ctx = {
        suspend: async (run: (t: { run(argv: string[]): Promise<number | null> }) => Promise<unknown>) => {
          await run({ run: async argv => { writeFileSync(argv.at(-1)!, "Water the leeks and the beans\n"); change(d); return code; } });
        },
      };
      await openInEditor(ctx as any, d, () => held);
      return { d, dir };
    } finally {
      if (was.state === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was.state;
      if (was.editor === undefined) delete process.env.EDITOR; else process.env.EDITOR = was.editor;
      if (was.visual !== undefined) process.env.VISUAL = was.visual;
    }
  };
  test("back into the draft when nothing else touched it", async () => {
    const { d, dir } = await draftIn(() => {}, 0);
    expect(d.text).toBe("Water the leeks and the beans");
    rmSync(dir, { recursive: true, force: true });
  });
  test("copied to disk when the draft changed meanwhile, when the editor's terminal went, or when the draft was closed", async () => {
    for (const [change, code, held, why] of [[(d: Draft) => d.replace("typed on the phone"), 0, true, /changed while it was out/], [() => {}, null, true, /without a code/], [() => {}, 0, false, /closed meanwhile/]] as const) {
      const { d, dir } = await draftIn(change as (d: Draft) => void, code, held);
      expect(d.note).toMatch(why);
      const copy = /text is at (\S+)/.exec(d.note ?? "")![1]!;
      expect(readFileSync(copy, "utf8")).toContain("and the beans");
      expect(d.text).not.toContain("and the beans");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the session lock", () => {
  test("a lock left by a dead session, or naming a pid now someone else's, is taken over; a live session's isn't", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-lock-")), lock = join(dir, "session.lock");
    const sleeper = Bun.spawn(["sleep", "30"]), named = Bun.spawn(["bash", "-c", "exec -a 'bun main.ts session serve' sleep 30"]);
    try {
      await Bun.sleep(100);
      writeFileSync(lock, "999999999");                      // nobody
      expect(await takeLock(lock)).toBe(true);
      writeFileSync(lock, String(sleeper.pid));               // a live process, but not a session (its pid reused)
      expect(await takeLock(lock)).toBe(true);
      writeFileSync(lock, String(named.pid));                 // a live session
      expect(await takeLock(lock)).toBe(false);
    } finally { sleeper.kill(); named.kill(); rmSync(dir, { recursive: true, force: true }); }
  });
});

/** A fake client's link: what the session sent it, drawn into a mirror of its size. */
function fakeLink(cols: number, rows: number) {
  const mirror = new Mirror(cols, rows), sent: DaemonMsg[] = [];
  let closed: DaemonMsg | undefined | null = null, backlog = 0, drain: () => void = () => {};
  const link: Link = {
    send: m => { sent.push(m); if (m.t === "output") mirror.write(m.text); },
    backlog: () => backlog, onDrain: f => { drain = f; },
    close: bye => { closed = bye; },
  };
  return { link, mirror, sent, get closed() { return closed; }, setBacklog(n: number) { backlog = n; if (!n) drain(); }, text: () => mirror.text() };
}
const hello = (cols: number, rows: number, more: Partial<Hello> = {}): Hello => ({ proto: PROTOCOL, cols, rows, cellW: 9, cellH: 16, kitty: false, pid: 4242, ...more });

describe("two clients on one session", () => {
  function session() {
    const term = new SessionTerm();
    const keys: unknown[] = [];
    const app = new App(term, { supports: () => null, protocol: null } as any, Date.now(), () => {});
    // A screen that says how big it was drawn and records its keys.
    app.push({ title: "plot board", noDock: true, key: (k: unknown) => { keys.push(k); }, render: (ctx: any) => ({ lines: Array.from({ length: ctx.t.rows - 1 }, (_, i) => `row ${i} of ${ctx.t.cols}×${ctx.t.rows}`) }) } as any);
    const paint = () => (app as any).paint();
    return { term, app, keys, paint };
  }

  test("the first client to attach has the keys; the session is drawn at its size", () => {
    const { term, paint } = session();
    const a = fakeLink(100, 30);
    term.attach(a.link, hello(100, 30));
    paint();
    expect(term.info.cols).toBe(100);
    expect(a.text()[0]).toBe("row 0 of 100×30");
    expect(a.text()[29]).toContain("plot board");          // the status bar
    expect(term.list()).toMatchObject([{ cols: 100, rows: 30, active: true }]);
  });

  test("another size sees the same frame cut to its size, and its bottom row says whose size it is", () => {
    const { term, paint } = session();
    const a = fakeLink(100, 30), b = fakeLink(60, 20);
    term.attach(a.link, hello(100, 30));
    term.attach(b.link, hello(60, 20));
    paint();
    expect(b.text()[0]).toBe("row 0 of 100×30");
    expect(b.text()[19]).toContain("drawn at 100×30 for another terminal");
    expect(Math.max(...b.text().map(l => Bun.stringWidth(l)))).toBeLessThanOrEqual(60);
    expect(a.text()[0]).toBe("row 0 of 100×30");
  });

  test("a key typed in the other client takes the session: drawn at its size, the first one told", () => {
    const { term, keys, paint } = session();
    const a = fakeLink(100, 30), b = fakeLink(60, 20);
    const ca = term.attach(a.link, hello(100, 30)), cb = term.attach(b.link, hello(60, 20));
    paint();
    term.input(cb, "j");
    paint();
    expect(keys).toEqual([{ kind: "char", ch: "j" }]);
    expect(term.info.cols).toBe(60);
    expect(b.text()[0]).toBe("row 0 of 60×20");
    expect(a.text()[0]).toBe("row 0 of 60×20");
    expect(a.text()[29]).toContain("drawn at 60×20 for another terminal");
    expect(term.list().find(c => c.id === cb.id)!.active).toBe(true);
    // Back on the first: it takes it back.
    term.input(ca, "k");
    paint();
    expect(term.info.cols).toBe(100);
    expect(keys.at(-1)).toEqual({ kind: "char", ch: "k" });
  });

  test("a click from the other client only takes the session: it was aimed at a frame of another size", () => {
    const { term, keys, paint } = session();
    const a = fakeLink(100, 30), b = fakeLink(60, 20);
    term.attach(a.link, hello(100, 30));
    const cb = term.attach(b.link, hello(60, 20));
    paint();
    term.input(cb, "\x1b[<0;5;5M\x1b[<0;5;5m");
    expect(keys).toEqual([]);
    term.input(cb, "\x1b[<0;5;5M");
    expect(keys).toEqual([{ kind: "mouse", action: "down", button: 0, x: 4, y: 4 }]);
  });

  test("each client in its own video mode: a Kitty terminal gets the tube under its text, a plain one none", () => {
    const { term, paint } = session();
    const a = fakeLink(80, 24), b = fakeLink(80, 24);
    term.attach(a.link, hello(80, 24, { kitty: true }));
    term.attach(b.link, hello(80, 24));
    paint();
    const images = (l: ReturnType<typeof fakeLink>) => l.sent.filter(m => m.t === "output" && m.text.includes("\x1b_G")).length;
    expect(images(a)).toBeGreaterThan(0);
    expect(images(b)).toBe(0);
    expect(term.list().map(c => c.video)).toEqual(["kitty+crt", "cells"]);
  });

  test("a watcher is shown the session and never given the keys; q stops watching", () => {
    const { term, keys, paint } = session();
    const a = fakeLink(80, 24), w = fakeLink(80, 24);
    term.attach(a.link, hello(80, 24));
    const cw = term.attach(w.link, hello(80, 24, { watch: true }));
    paint();
    term.input(cw, "jk\r");
    expect(keys).toEqual([]);
    expect(w.text()[23]).toContain("read-only");
    expect(term.list().find(c => c.watch)!.active).toBe(false);
    // A pasted q is text, not the key; a Kitty keyboard terminal's ctrl+c (CSI 99;5u) stops watching as ctrl+c does.
    term.input(cw, "\x1b[200~quiet\x1b[201~");
    expect(w.closed).toBeNull();
    term.input(cw, "\x1b[99;5u");
    expect(w.closed).toMatchObject({ t: "bye", reason: "detached" });
  });

  test("the terminal is handed to the client with the keys; it isn't painted until the program ends", async () => {
    const { term, paint } = session();
    const a = fakeLink(80, 24), b = fakeLink(80, 24);
    const ca = term.attach(a.link, hello(80, 24));
    term.attach(b.link, hello(80, 24));
    paint();
    const ran = term.handOver(["sh", "-l"], { cwd: "/tmp", banner: "ep0ch · shell" });
    const run = a.sent.find(m => m.t === "run") as Extract<DaemonMsg, { t: "run" }>;
    expect(run).toMatchObject({ argv: ["sh", "-l"], cwd: "/tmp", banner: "ep0ch · shell" });
    expect(b.sent.some(m => m.t === "run")).toBe(false);
    const before = a.sent.length;
    term.invalidate(); paint();
    expect(a.sent.length).toBe(before);                    // away: nothing painted to it
    expect(term.list()[0]!.away).toBe("sh");
    term.ran(ca, run.id, 3);
    expect(await ran).toBe(3);
    paint();
    expect(a.sent.length).toBeGreaterThan(before);
  });

  test("logging off detaches only the client with the keys; the next one who typed has them", () => {
    const { term, app } = session();
    const a = fakeLink(80, 24), b = fakeLink(70, 20);
    const ca = term.attach(a.link, hello(80, 24)), cb = term.attach(b.link, hello(70, 20));
    term.input(cb, "x"); term.input(ca, "y");
    let gone: number | null = null;
    term.onLogoff = c => { gone = c.id; term.detach(c); };
    app.logoff();
    expect(gone as number | null).toBe(ca.id);
    expect(term.list().map(c => [c.id, c.active])).toEqual([[cb.id, true]]);
    expect(term.info.cols).toBe(70);
  });

  test("the Goodbye lets go of the terminal G was pressed on, even when another typed during its fade", () => {
    const { term, app } = session();
    const a = fakeLink(80, 24), b = fakeLink(80, 24);
    const ca = term.attach(a.link, hello(80, 24)), cb = term.attach(b.link, hello(80, 24));
    term.input(ca, "y");
    const from = app.typingOn();
    term.input(cb, "x");                                  // b typed while a's Goodbye faded
    let gone: number | null = null;
    term.onLogoff = c => { gone = c.id; term.detach(c); };
    app.logoff(from);
    expect(gone as number | null).toBe(ca.id);
  });

  test("ending: an agent's session.end is refused; in a door with no session, E says there is none", async () => {
    const { app } = session();
    await expect(app.act({ action: "session.end", args: { force: true }, as: "test-agent" })).rejects.toThrow(/an agent doesn't end the person's session/);
    const own = new App({ info: { cols: 80, rows: 24, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} } as any, { supports: () => null, protocol: null } as any, Date.now(), () => {});
    own.push({ title: "plot board", key() {}, render: () => ({ lines: [] }) } as any);
    await own.dispatch.press("session.end");
    expect((own as any).message).toContain("not as a session: G logs off");
  });

  test("a client that stops reading is skipped, then painted whole when it catches up", () => {
    const { term, paint } = session();
    const a = fakeLink(80, 24);
    term.attach(a.link, hello(80, 24));
    paint();
    a.setBacklog(64 << 20);
    const before = a.sent.length;
    term.invalidate(); paint();
    expect(a.sent.length).toBe(before);
    a.setBacklog(0);
    expect(a.sent.length).toBeGreaterThan(before);
    expect(a.text()[0]).toBe("row 0 of 80×24");
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
  static async attach(path: string, cols: number, rows: number, more: Partial<Hello> = {}): Promise<RawClient> {
    const sock = await new Promise<Socket>((res, rej) => { const s = connect(path, () => res(s)); s.once("error", rej); });
    const c = new RawClient(sock, cols, rows);
    c.send({ t: "hello", hello: hello(cols, rows, more) });
    return c;
  }
  send(m: ClientMsg) { this.sock.write(encode(m)); }
  type(s: string) { this.send({ t: "input", text: s }); }
  text() { return this.mirror.text(); }
  screen() { return this.text().join("\n"); }
  close() { this.sock.destroy(); }
}

describe.skipIf(!outliner)("a real session on a scratch service", () => {
  let scratch: Scratch;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };
  let pid = 0;
  let plot = "";
  /** An agent's request on the session's control socket. */
  const control = (req: Record<string, unknown>) => new Promise<any>((res, rej) => {
    const s = connect(controlSocket());
    let buf = "";
    s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
    s.on("data", d => { buf += d; if (buf.includes("\n")) { s.end(); const r = JSON.parse(buf); r.ok ? res(r.result) : rej(new Error(r.error)); } });
    s.on("error", rej);
  });

  beforeAll(async () => {
    scratch = new Scratch();
    const sock = await scratch.start();
    const b = new SocketBoard(sock);
    await b.info();
    plot = (await b.request<{ id: string }>("create", { parentId: null, text: "Allotment plot 7\nWater the leeks before noon", author: "agent" })).id;
    b.close();
    state = join(scratch.root, "door");
    env("EP0CH_STATE", state);
    env("EP0CH_SOCKET", sock);
    env("EP0CH_DAILY_AGENT", "sh");
    const started = await startSession(["--desk"]);
    expect(started).toEqual({ ok: true });
    pid = JSON.parse(readFileSync(sessionFile(), "utf8")).pid;
  }, 60_000);

  afterAll(async () => {
    try { if (pid) process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    if (pid) await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the session to end", 10_000).catch(() => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } });
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await scratch.dispose();
  }, 30_000);

  test("its socket and the control socket are the user's alone, in the state dir", () => {
    const { statSync } = require("node:fs");
    expect(statSync(sessionSocket()).mode & 0o777).toBe(0o600);
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(existsSync(controlSocket())).toBe(true);
  });

  test("detach and attach again: the layout, a terminal tile's program and scrollback, and an unsaved draft are all there", async () => {
    const a = await RawClient.attach(sessionSocket(), 150, 44);
    await until(() => a.screen().includes("outline"), "the desk on the client", 10_000);
    // An agent opens a terminal tile through the control socket, and a note in the reader (the person's keys stay theirs).
    const opened = await control({ cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    // Its program starts at the tile's first paint: typed once it runs.
    for (let i = 0; ; i++) {
      try { await control({ cmd: "act", action: "tile.type", tile: opened.id, args: { text: "echo leeks-$((6*7))\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => a.screen().includes("leeks-42"), "the tile's output on the client", 10_000);
    await control({ cmd: "act", action: "open", args: { id: plot }, as: "test-agent" });
    await until(() => a.screen().includes("Water the leeks before noon"), "the note in the reader", 10_000);
    // The person, on this client: the reader (2), edit (e), type, and leave it unsaved.
    a.type("2");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "reader"; i++) await Bun.sleep(100);
    a.type("e");
    await until(() => a.screen().includes("ctrl+s"), "the edit open", 10_000);
    a.type(" and net the brassicas");
    await until(() => a.screen().includes("and net the brassicas"), "the typed text in the draft", 10_000);
    const shape = async () => { const l = await control({ cmd: "act", action: "layout.get", as: "test-agent" }); return JSON.stringify({ rev: l.rev, tiles: (l.tiles ?? []).map((t: any) => [t.id, t.kind, t.name]) }); };
    const layout = await shape();
    a.send({ t: "detach" });
    await until(() => a.closed, "the detach", 5000);
    expect(a.got.at(-1)).toMatchObject({ t: "bye", reason: "detached" });
    const info = await sessionInfo();
    expect(info!.clients).toEqual([]);
    expect(info!.terminals.map(t => t.cmd)).toContain("sh");
    // Attach again, at another size: the same tiles, the program's scrollback, the draft still open and unsaved.
    const b = await RawClient.attach(sessionSocket(), 120, 40);
    await until(() => b.screen().includes("leeks-42") && b.screen().includes("and net the brassicas"), "the tile's scrollback and the draft after attaching again", 10_000);
    expect(await shape()).toBe(layout);
    const peek = await control({ cmd: "peek" });
    expect(JSON.stringify(peek.screen.person)).toContain("typing");
    b.send({ t: "detach" });
    await until(() => b.closed, "the detach", 5000);
  }, 60_000);

  test("two clients on one screen stay consistent; the keys follow whoever typed last", async () => {
    const a = await RawClient.attach(sessionSocket(), 120, 40), b = await RawClient.attach(sessionSocket(), 120, 40);
    await until(() => a.screen().includes("outline") && b.screen().includes("outline"), "both clients drawn", 10_000);
    b.type("\t");
    await until(() => a.screen() === b.screen() && (a.text()[39] ?? "").length > 0, "the same frame on both", 10_000);
    const info = await sessionInfo();
    expect(info!.clients.map(c => c.active)).toEqual([false, true]);
    expect(a.text()).toEqual(b.text());
    a.close(); b.close();
    for (let i = 0; i < 50 && (await sessionInfo())!.clients.length; i++) await Bun.sleep(100);
    expect((await sessionInfo())!.clients).toEqual([]);
  }, 30_000);

  test("a terminal is refused: another protocol, inside the session, before hello, naming another outline", async () => {
    const said = async (more: Partial<Hello> | null, first?: ClientMsg) => {
      const sock = await new Promise<Socket>((res, rej) => { const s = connect(sessionSocket(), () => res(s)); s.once("error", rej); });
      const got: DaemonMsg[] = [], f = new Frames<DaemonMsg>();
      sock.on("data", (d: Buffer) => got.push(...f.push(d)));
      sock.write(encode(first ?? { t: "hello", hello: hello(80, 24, more ?? {}) }));
      await until(() => got.some(m => m.t === "bye"), "the refusal", 5000);
      sock.destroy();
      return got.find(m => m.t === "bye") as Extract<DaemonMsg, { t: "bye" }>;
    };
    expect((await said({ proto: PROTOCOL + 1 })).message).toMatch(/speaks protocol/);
    expect((await said({ nest: `ssh:pts/3 › door:${pid}/desk/t2:pty` })).message).toMatch(/inside the session already/);
    expect((await said({ nest: `shell:${pid}` })).message).toMatch(/inside the session already/);
    expect((await said(null, { t: "input", text: "j" })).message).toBe("say hello first");
    expect((await said({ target: { socket: "/elsewhere/plot/outliner.sock", outline: "seed-library" } })).message).toMatch(/not the outline you named \(seed-library\)/);
    // The same outline, named: attached.
    const named = await RawClient.attach(sessionSocket(), 80, 24, { target: { socket: process.env.EP0CH_SOCKET! } });
    await until(() => named.got.some(m => m.t === "output"), "the named client drawn", 5000);
    named.close();
    for (let i = 0; i < 50 && (await sessionInfo())!.clients.length; i++) await Bun.sleep(100);
    expect((await sessionInfo())!.clients).toEqual([]);
  }, 30_000);

  test("ending asks while programs run in its tiles, then ends: every client told, the files gone", async () => {
    const a = await RawClient.attach(sessionSocket(), 100, 30);
    // An attached terminal (a watcher above all) can't end it over the wire: the menu's E is how.
    const watcher = await RawClient.attach(sessionSocket(), 80, 24, { watch: true });
    watcher.send({ t: "end", force: true });
    await until(() => watcher.got.some(m => m.t === "ask"), "the refusal", 5000);
    expect((watcher.got.find(m => m.t === "ask") as any).message).toMatch(/from the main menu \(E\)/);
    // `ep0ch session end` connects without attaching: asked first, then forced.
    const asker = await new Promise<Socket>((res, rej) => { const s = connect(sessionSocket(), () => res(s)); s.once("error", rej); });
    const asked: DaemonMsg[] = [], f = new Frames<DaemonMsg>();
    let closed = false;
    asker.on("data", (d: Buffer) => asked.push(...f.push(d)));
    asker.on("close", () => { closed = true; });
    asker.write(encode({ t: "end" }));
    await until(() => asked.some(m => m.t === "ask"), "the question", 5000);
    expect((asked.find(m => m.t === "ask") as any).message).toMatch(/running in a tile|isn.t saved/);
    asker.write(encode({ t: "end", force: true }));
    await until(() => closed, "the asker let go", 15_000);
    await until(() => a.closed, "the session to end", 15_000);
    expect(a.got.at(-1)).toMatchObject({ t: "bye", reason: "ended" });
    await until(() => !existsSync(sessionSocket()) && !existsSync(sessionFile()), "the session's files to go", 5000);
    pid = 0;
  }, 30_000);
});

// ── the handoff and the restore ─────────────────────────────────────────────────────────────────────────────
// The terminal host keeps the programs; a new daemon adopts them, reopens the screens and the edits that were open,
// and replays what's safe from the journal. In this file with the session's other tests, so the daemons they start
// run one after another, not beside the rest of the suite's.
describe("a terminal tile adopting a kept program", () => {
  /** A backend that keeps one program, and records what the tile sends it. */
  function keeping(replay: string, exited: number | null = null) {
    const writes: string[] = [], sizes: [number, number][] = [];
    const proc = { pid: 4242, exited: new Promise<number>(() => {}), write: (d: string) => { writes.push(d); }, resize: (c: number, r: number) => { sizes.push([c, r]); }, kill() {}, close() {} };
    const backend = {
      kind: "host" as const, spawn: () => { throw new Error("not this test"); }, meta() {}, holds: () => true,
      adopt: (key: string) => (key === "desk.json:t5" ? { proc, replay: Buffer.from(replay), cols: 30, rows: 8, argv: ["sh"], meta: { cmd: ["sh"], socket: null }, exited } : null),
    };
    return { backend, writes, sizes, proc };
  }
  const pane = () => { const p = new PtyPane({ cmd: ["sh"] }); p.home = "desk.json"; p.tileId = "t5"; p.init({ redraw() {}, ctx: { flash() {} } } as any); return p; };

  test("what it wrote is drawn, its modes followed, its old queries never answered into it; then it's asked to redraw", async () => {
    const k = keeping("\x1b[?1006h\x1b[?1000hseed list\r\n\x1b[6n\x1b[c\x1b]11;?\x07\x1b[?u");
    usePtyBackend(k.backend);
    try {
      const p = pane();
      p.render(30, 8, false, {} as any);
      await until(() => k.sizes.length >= 2, "the redraw asked for", 2000);
      expect(p.text().join("\n")).toContain("seed list");
      expect(k.writes).toEqual([]);                          // no cursor report, no DA, no colour, no keyboard answer
      expect(k.sizes).toEqual([[30, 7], [30, 8]]);           // the same size: a resize away and back
      expect(mouseBytes({ kind: "mouse", action: "down", button: 0, x: 1, y: 1 }, 1, 1, (p as any).sgr)).toBe("\x1b[<0;2;2M");
      p.input("x");
      expect(k.writes).toEqual(["x"]);
      // The host dropped some output (the daemon fell behind) and sent all it kept again: the tile starts over from it.
      (k.proc as any).onResync(Buffer.from("seed list\r\nchard, beans\r\n\x1b[6n"));
      await until(() => p.text().join("\n").includes("chard, beans"), "the tile started over", 2000);
      expect(p.text().filter(l => l.includes("seed list"))).toHaveLength(1);
      expect(k.writes).toEqual(["x"]);
    } finally { usePtyBackend(localPtys); }
  });

  test("one that ended during the handoff says so in its tile", async () => {
    const k = keeping("bye\r\n", 3);
    usePtyBackend(k.backend);
    try {
      const p = pane();
      p.render(30, 8, false, {} as any);
      expect(p.exited).toBe(3);
      expect(p.running).toBe(false);
    } finally { usePtyBackend(localPtys); }
  });
});

describe("the terminal host", () => {
  test("its frames come out whole however the stream cuts them", () => {
    const bytes = Buffer.concat([frame("o", 7, Buffer.from("leeks\x1b[1m")), frame("z", 7, { cols: 80, rows: 24 }), frame("y", 0)]);
    for (const cut of [1, 4, 9, bytes.length]) {
      const f = new HostFrames(), got: { t: string; id: number }[] = [];
      for (let i = 0; i < bytes.length; i += cut) got.push(...f.push(bytes.subarray(i, i + cut)).map(x => ({ t: x.t, id: x.id, ...(x.json ? { json: x.json } : { raw: x.raw.toString() }) })));
      expect(got).toEqual([{ t: "o", id: 7, raw: "leeks\x1b[1m" }, { t: "z", id: 7, json: { cols: 80, rows: 24 } }, { t: "y", id: 0, raw: "" }] as any);
    }
  });

  test("its raw frames are its own copies, and one over the limit is refused, as the session's are", () => {
    const chunk = frame("o", 3, Buffer.from("kale")), [got] = new HostFrames().push(chunk);
    chunk.fill(0);
    expect(got!.raw.toString()).toBe("kale");
    const big = Buffer.alloc(9); big.write("o", 0, "latin1"); big.writeUInt32BE(65 << 20, 5);
    expect(() => new HostFrames().push(big)).toThrow(/over the limit/);
  });

  test("a daemon that lets go of the host leaves its programs running, and the next one adopts them with their output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-host-")), was = process.env.EP0CH_STATE;
    let hostPid = 0;
    process.env.EP0CH_STATE = dir;
    try {
      const { host: first } = await ensurePtyHost();
      hostPid = first.hostPid;
      let out = "";
      const proc = first.spawn({ key: "desk.json:t5", argv: ["sh", "-c", "echo sown-$((6*7)); exec sleep 30"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, cols: 40, rows: 10, meta: { cmd: ["sh"] } }, d => { out += Buffer.from(d).toString(); });
      await until(() => out.includes("sown-42"), "the program's output", 5000);
      let ended: number | null = null;
      void proc.exited.then(c => { ended = c; });
      first.release();
      await Bun.sleep(100);
      expect(ended).toBeNull();                              // let go of, not ended
      const { host: next } = await ensurePtyHost();
      expect(next.hostPid).toBe(first.hostPid);
      let more = "";
      const kept = next.adopt("desk.json:t5", ["sh"], d => { more += Buffer.from(d).toString(); })!;
      expect(Buffer.from(kept.replay).toString()).toContain("sown-42");
      expect(kept.proc.pid).toBe(proc.pid!);
      expect(next.adopt("desk.json:t5", ["sh"], () => {})).toBeNull();   // adopted once
      kept.proc.write("x");
      next.endAll();
      await until(() => !existsSync(ptyHostSocket()), "the host to end", 5000);
      expect(() => process.kill(proc.pid!, 0)).toThrow();
    } finally {
      // Whatever it left: the host, by pid (SIGTERM ends it and its programs).
      if (hostPid) { try { process.kill(hostPid, "SIGTERM"); } catch { /* gone */ } }
      if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  test("a connection that doesn't say hello is a probe: it never takes the host from its daemon", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-host-")), was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    let host: Awaited<ReturnType<typeof ensurePtyHost>>["host"] | null = null;
    try {
      ({ host } = await ensurePtyHost());
      let lost = false;
      host.onLost = () => { lost = true; };
      for (let i = 0; i < 3; i++) await new Promise<void>(r => { const c = connect(ptyHostSocket(), () => { c.end(); r(); }); });
      await Bun.sleep(200);
      expect(lost).toBe(false);
    } finally {
      const pid = host?.hostPid;
      host?.endAll();
      if (pid) await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the host gone", 5000).catch(() => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } });
      if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

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

describe("the checkpoint and the restore", () => {
  /** An App enough for a restore: a stack, the actions' replay declarations, a dispatcher that records what it's asked. */
  function stubApp(refuse: (s: { action: string; tile?: string; args: Record<string, unknown> }) => string | null = () => null) {
    const stack: any[] = [], ran: { action: string; tile?: string; args: Record<string, unknown> }[] = [];
    const declared: Record<string, "safe" | "ask"> = { "screen.open": "safe", "screen.back": "safe", "screen.shell": "ask", open: "safe", edit: "ask" };
    const app = {
      background: [], screens: () => stack, push: (s: any) => { stack.push(s); }, flush() {},
      dispatch: {
        list: () => ({ actions: Object.entries(declared).map(([name, replay]) => ({ name, replay })) }),
        act: async (req: { action: string; tile?: string; args: Record<string, unknown> }) => {
          const no = refuse(req);
          if (no) throw new Error(no);
          ran.push({ action: req.action, ...(req.tile ? { tile: req.tile } : {}), args: req.args });
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

  test("a restore runs the replay-safe steps through the dispatcher, holds the rest, and reopens the edit once its note is read", async () => {
    let noteRead = false;
    const { app, ran } = stubApp(req => (req.action === "edit" && !noteRead ? "this reader shows no note; open one first" : null));
    setTimeout(() => { noteRead = true; }, 250);
    const c: Checkpoint = {
      v: 2, at: 0, menu: true,
      screens: [{ action: "screen.open", args: { name: "desk" } }, { action: "screen.back" }, { action: "screen.shell" }, { action: "screen.open", args: { name: "board" } }],
      reopen: [{ action: "open", tile: "reader", args: { id: "0a1b2c3d" }, screen: "board" }, { action: "edit", tile: "reader", screen: "board" }],
    };
    const r = await restore(app, c);
    expect(app.screens()[0]).toBeInstanceOf(MainMenu);
    expect(ran.map(x => x.action)).toEqual(["screen.open", "screen.back", "screen.open", "open", "edit"]);
    expect(r).toMatchObject({ screens: 2, held: ["screen.shell"], reopened: 1, errors: [] });
  });

  test("a checkpoint from before anyone logged on restores nothing: the next daemon starts at the logon", async () => {
    const { app, ran } = stubApp();
    expect(await restore(app, { v: 2, at: 0, menu: false, screens: [], reopen: [] })).toMatchObject({ screens: 0 });
    expect(app.screens()).toEqual([]);
    expect(ran).toEqual([]);
  });
});

/** A client for the handoff tests: the protocol over the session socket, with a mirror for a terminal. */
class HandoffClient {
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
  static async attach(path: string, cols: number, rows: number): Promise<HandoffClient> {
    const sock = await new Promise<Socket>((res, rej) => { const s = connect(path, () => res(s)); s.once("error", rej); });
    const c = new HandoffClient(sock, cols, rows);
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
    const a = await HandoffClient.attach(sessionSocket(), 140, 40);
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

    const b = await HandoffClient.attach(sessionSocket(), 140, 40);
    await until(() => b.screen().includes("chard-42") && b.screen().includes("and kale"), "the shell's output and the edit after the handoff", 10_000).catch(e => { console.log(b.screen()); throw e; });
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 5000);
    const peek = await control({ cmd: "peek" });
    // The edit is open again on the same note, unsaved, its text brought back from where the handoff put it aside.
    expect(JSON.stringify(peek.screen.state)).toContain(`"place":"edit:${plot}"`);
    expect(JSON.stringify(peek.screen.state)).toContain(`"dirty":true`);
    b.close();
  }, 60_000);

  test("a desk kept in the background comes back with its program: D on the menu shows it, the same process", async () => {
    const a = await HandoffClient.attach(sessionSocket(), 140, 40);
    await until(() => a.screen().includes("chard-42"), "the desk", 10_000);
    a.type("\x1b[23;5u");                                  // ctrl+w (as a Kitty terminal sends it) is ^W on the desk; esc after it stays…
    a.type("q");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.screen !== "main menu"; i++) { a.type("q"); await Bun.sleep(100); }
    expect((await control({ cmd: "peek" })).screen.screen).toBe("main menu");
    const shell = await shellPid();
    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => a.closed, "the old daemon to let go", 5000);
    const b = await HandoffClient.attach(sessionSocket(), 140, 40);
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 10_000);
    b.type("d");
    await until(() => b.screen().includes("chard-42"), "the desk's shell after the handoff", 10_000);
    expect(await shellPid()).toBe(shell);
    b.close();
  }, 60_000);

  test("a daemon killed with -9: the next start restores the screens and adopts the shell", async () => {
    const before = { daemon: daemonPid(), shell: await shellPid() };
    // The checkpoint is written a moment after the screens change: the desk opened just now is in it before the kill.
    await until(() => !readFileSync(join(scratch.root, "door", "session-state.json"), "utf8").includes("screen.back"), "the checkpoint with the desk on top", 5000);
    process.kill(before.daemon, "SIGKILL");
    await until(() => { try { process.kill(before.daemon, 0); return false; } catch { return true; } }, "the daemon gone", 5000);
    expect(await startSession([])).toEqual({ ok: true });
    expect(daemonPid()).not.toBe(before.daemon);
    // Kept in the terminal host (adopted by its tile as the desk is drawn, maybe already).
    const after = (await sessionInfo())!;
    expect([...after.kept!.map(k => k.pid), ...after.terminals.map(t => t.pid)]).toContain(before.shell!);
    const c = await HandoffClient.attach(sessionSocket(), 120, 36);
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
