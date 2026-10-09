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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { App } from "../src/app";
import { Mirror } from "../src/mirror";
import { Draft } from "../src/edit";
import { openInEditor } from "../src/surface/editor";
import { SocketBoard } from "../src/socket";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type Hello } from "../src/session/protocol";
import { SessionTerm, type Link } from "../src/session/session-term";
import { doorMode, runEnv } from "../src/session/client";
import { sessionEnv, startSession } from "../src/session/start";
import { ancestors, detachedSaying, takeLock } from "../src/session/daemon";
import { controlFor, ep0ch, pickSession, placeFor, placeOf, runningSessions, sessionFile, sessionFlags, sessionInfo as infoOn, sessionSocket, type Place } from "../src/session/place";
import { ensurePtyHost, frame, HostFrames, HOST_PROTOCOL, ptyHostSocket } from "../src/session/pty-host";
import { restore, screenSteps, type Checkpoint } from "../src/session/restore";
import { MainMenu } from "../src/screens";
import { controlPlace, servingSocket } from "../src/control";
import { homeState, useOutlineState } from "../src/state";
import { createServer } from "node:net";
import { USER } from "../src/socket";
import { localPtys, usePtyBackend } from "../src/desk/pty-backend";
import { mouseBytes, PtyPane } from "../src/desk/pty";
import { outliner, Scratch, ScratchHost, scratchRoot, until } from "./scratch";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";

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
  test("`ep0ch` attaches (starting one when none runs); --no-daemon and EP0CH_DAEMON=0 open it in this terminal", () => {
    expect(doorMode([], {})).toEqual({ mode: "attach" });
    expect(doorMode(["--screen", "board"], { EP0CH_DAEMON: "1" })).toEqual({ mode: "attach" });
    expect(doorMode(["--no-daemon"], {})).toEqual({ mode: "local" });
    expect(doorMode([], { EP0CH_DAEMON: "0" })).toEqual({ mode: "local" });
  });
});

describe("a session is for a terminal", () => {
  test("`ep0ch` with no terminal (a script, an agent's shell) starts no session and says what to run", async () => {
    const dir = mkdtempSync(join(scratchRoot(), "ep0ch-notty-"));
    try {
      const env: Record<string, string> = { ...(process.env as Record<string, string>), EP0CH_STATE: join(dir, "s"), EP0CH_CONTROL: join(dir, "s", "door.sock"), EP0CH_SOCKET: join(dir, "nowhere.sock") };
      delete env.EP0CH_DAEMON;
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts")], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      expect(await p.exited).toBe(1);
      expect(await new Response(p.stderr).text()).toContain("not a terminal");
      expect(existsSync(join(dir, "s", "sessions"))).toBe(false);
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
    // An outer door's outline session folder goes with its other variables (PIE-604).
    expect(sessionEnv({ EP0CH_IN_DOOR: "1", EP0CH_PLACE: "/tmp/plot/sessions/local/outer" })).toEqual({});
  });

  test("a door serves in its own outline's folder: an inherited EP0CH_CONTROL naming another outline's never becomes its socket (PIE-604)", () => {
    const saved = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = "/tmp/plot-state";
    try {
      useOutlineState("/tmp/plot-state/sessions/local/garden");
      const own = "/tmp/plot-state/sessions/local/garden/door.sock";
      expect(servingSocket({})).toBe(own);
      expect(servingSocket({ EP0CH_CONTROL: "/tmp/plot-state/sessions/local/allotment/door.sock" })).toBe(own);
      expect(servingSocket({ EP0CH_CONTROL: "/tmp/plot-state/sessions/local/garden/door-77.sock" })).toBe("/tmp/plot-state/sessions/local/garden/door-77.sock");
      // A test door's socket moved out of the state dir on purpose is kept, and its tiles get no session folder to follow.
      expect(servingSocket({ EP0CH_CONTROL: "/tmp/test-door/ctl.sock" })).toBe("/tmp/test-door/ctl.sock");
      expect(controlPlace(own)).toBe("/tmp/plot-state/sessions/local/garden");
      expect(controlPlace("/tmp/test-door/ctl.sock")).toBeNull();
      useOutlineState(homeState());
      expect(controlPlace("/tmp/plot-state/home/door.sock")).toBeNull();
    } finally {
      useOutlineState(null);
      if (saved === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = saved;
    }
  });

  test("a program the session hands a terminal runs with that terminal's TERM, ssh, tmux and locale, its layers first", () => {
    const env = runEnv({ HOME: "/home/fern", EP0CH_CONTROL: "/tmp/plot/door.sock", EP0CH_NEST: "shell:4242" }, { TERM: "xterm-ghostty", SSH_TTY: "/dev/pts/9", LANG: "en_NZ.UTF-8", EP0CH_NEST: "ssh:pts/9", HOME: "/elsewhere" });
    expect(env).toEqual({ HOME: "/home/fern", EP0CH_CONTROL: "/tmp/plot/door.sock", TERM: "xterm-ghostty", SSH_TTY: "/dev/pts/9", LANG: "en_NZ.UTF-8", EP0CH_NEST: "ssh:pts/9 › shell:4242" });
  });
});

describe("$EDITOR's text is never dropped", () => {
  const draftIn = async (change: (d: Draft) => void, code: number | null, held = true) => {
    const dir = mkdtempSync(join(scratchRoot(), "ep0ch-editor-")), was = { state: process.env.EP0CH_STATE, editor: process.env.EDITOR, visual: process.env.VISUAL };
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
    const dir = mkdtempSync(join(scratchRoot(), "ep0ch-lock-")), lock = join(dir, "session.lock");
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
    app.push({ title: "plot board", noDrawer: true, key: (k: unknown) => { keys.push(k); }, render: (ctx: any) => ({ lines: Array.from({ length: ctx.t.rows - 1 }, (_, i) => `row ${i} of ${ctx.t.cols}×${ctx.t.rows}`) }) } as any);
    const paint = () => (app as any).paint();
    return { term, app, keys, paint };
  }

  test("the first client to attach has the keys; the session is drawn at its size", () => {
    const { term, paint } = session();
    const a = fakeLink(100, 30);
    term.attach(a.link, hello(100, 30, { clientHost: { kind: "tern", pane: "pane-7" } }));
    paint();
    expect(term.info.cols).toBe(100);
    expect(a.text()[0]).toBe("row 0 of 100×30");
    expect(a.text()[29]).toContain("plot board");          // the status bar
    expect(term.list()).toMatchObject([{ cols: 100, rows: 30, active: true, clientHost: { kind: "tern", pane: "pane-7" } }]);
  });

  test("with no terminal attached nothing is rendered; peek, an act and the next terminal to attach get the frame drawn now", () => {
    const term = new SessionTerm();
    const app = new App(term, { supports: () => null, protocol: null } as any, Date.now(), () => {});
    let renders = 0, n = 0;
    app.push({ title: "plot board", noDrawer: true, render: () => { renders++; return { lines: [`tick ${n}`] }; } } as any);
    const paint = () => (app as any).paint();
    const before = renders;
    n = 1; paint(); paint(); paint();                       // a busy terminal tile, seen by nobody
    expect(renders).toBe(before);
    app.catchUp();                                         // the control socket, before peek or an act
    expect(renders).toBe(before + 1);
    expect(term.mirror.text()).toContain("tick 1");
    app.catchUp();                                         // nothing was skipped since: nothing more
    expect(renders).toBe(before + 1);
    n = 2; paint();
    const a = fakeLink(100, 30);
    term.attach(a.link, hello(100, 30));                   // the first to attach sees what's there now
    expect(a.text()[0]).toBe("tick 2");
    n = 3; paint();                                        // attached: every frame is drawn again
    expect(a.text()[0]).toBe("tick 3");
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

/** The outline folder of the session a describe below starts (src/session/place.ts): its socket, files and control socket. */
let dir = "";

describe.skipIf(!outliner)("a real session on a scratch service", () => {
  let scratch: Scratch;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };
  let pid = 0;
  let plot = "";
  /** An agent's request on the session's control socket. */
  const control = (req: Record<string, unknown>) => new Promise<any>((res, rej) => {
    const s = connect(join(dir, "door.sock"));
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
    env("EP0CH_WS", scratch.name);
    dir = (placeFor([]) as Place).dir;
    env("EP0CH_DAILY_AGENT", "sh");
    const started = await startSession(dir, ["--screen", "desk"]);
    expect(started).toEqual({ ok: true });
    pid = JSON.parse(readFileSync(sessionFile(dir), "utf8")).pid;
  }, 60_000);

  afterAll(async () => {
    try { if (pid) process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    if (pid) await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the session to end", 10_000).catch(() => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } });
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await scratch.dispose();
  }, 30_000);

  test("its socket and the control socket are the user's alone, in its outline's folder of the state dir", async () => {
    const { statSync } = require("node:fs");
    expect(dir.startsWith(join(state, "sessions", "socket-"))).toBe(true);
    expect(dir.endsWith(`/${scratch.name}`)).toBe(true);
    expect(statSync(sessionSocket(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dir, "door.sock"))).toBe(true);
    const info = (await infoOn(sessionSocket(dir)))!;
    expect(info.place).toEqual({ outline: scratch.name, socket: process.env.EP0CH_SOCKET });
    expect(JSON.parse(readFileSync(sessionFile(dir), "utf8")).place.outline).toBe(scratch.name);
  });

  test("attaching with --screen <name> opens that screen in the running session and says so", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 150, 44, { args: ["--screen", "library"] });
    await until(() => a.screen().includes("component library") || a.screen().includes("library ·"), "the library on the attached client", 10_000);
    expect(a.screen()).toContain("library");
    expect(a.screen()).toContain("opened library");
    // Again, on the screen it is on: said, not silently nothing.
    const b = await RawClient.attach(sessionSocket(dir), 150, 44, { args: ["--screen", "library"] });
    await until(() => b.screen().includes("already on library"), "the already-there note", 10_000);
    a.send({ t: "detach" }); b.send({ t: "detach" });
    await until(() => a.closed && b.closed, "the detach", 5000);
    // The person's way back to the desk the session started on.
    await control({ cmd: "act", action: "screen.back" });
  }, 30_000);

  test("detach and attach again: the layout, a terminal tile's program and scrollback, and an unsaved draft are all there", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 150, 44);
    await until(() => a.screen().includes("outline"), "the desk on the client", 10_000);
    // An agent opens a terminal tile through the control socket, and a note in the reader (the person's keys stay theirs).
    const opened = await control({ cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    // Its program starts at the tile's first paint: typed once it runs.
    for (let i = 0; ; i++) {
      try { await control({ cmd: "act", action: "tile.type", tile: opened.id, args: { text: "echo leeks-$((6*7))\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => a.screen().includes("leeks-42"), "the tile's output on the client", 10_000);
    // The desk starts with the person's keys in the reader: they go to the outline first, so the agent's open lands there.
    a.type("1");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "tree"; i++) await Bun.sleep(100);
    await control({ cmd: "act", action: "open", args: { id: plot }, as: "test-agent" });
    await until(() => a.screen().includes("Water the leeks before noon"), "the note in the reader", 10_000);
    // The person, on this client: the reader (2), edit (e), type, and leave it unsaved.
    a.type("2");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "reader"; i++) await Bun.sleep(100);
    a.type("e");
    await until(() => a.screen().includes("ctrl+s"), "the edit open", 10_000);
    a.type(" and nets");   // short: the reader beside the new terminal is narrow, and a longer line wraps
    await until(() => a.screen().includes("and nets"), "the typed text in the draft", 10_000);
    const shape = async () => { const l = await control({ cmd: "act", action: "layout.get", as: "test-agent" }); return JSON.stringify({ rev: l.rev, tiles: (l.tiles ?? []).map((t: any) => [t.id, t.kind, t.name]) }); };
    const layout = await shape();
    a.send({ t: "detach" });
    await until(() => a.closed, "the detach", 5000);
    expect(a.got.at(-1)).toMatchObject({ t: "bye", reason: "detached" });
    const info = await infoOn(sessionSocket(dir));
    expect(info!.clients).toEqual([]);
    expect(info!.terminals.map(t => t.cmd)).toContain("sh");
    // Attach again, at another size: the same tiles, the program's scrollback, the draft still open and unsaved.
    const b = await RawClient.attach(sessionSocket(dir), 120, 40);
    await until(() => b.screen().includes("leeks-42") && b.screen().includes("and nets"), "the tile's scrollback and the draft after attaching again", 10_000);
    expect(await shape()).toBe(layout);
    const peek = await control({ cmd: "peek" });
    expect(JSON.stringify(peek.screen.person)).toContain("typing");
    b.send({ t: "detach" });
    await until(() => b.closed, "the detach", 5000);
  }, 60_000);

  test("two clients on one screen stay consistent; the keys follow whoever typed last", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 120, 40), b = await RawClient.attach(sessionSocket(dir), 120, 40);
    await until(() => a.screen().includes("outline") && b.screen().includes("outline"), "both clients drawn", 10_000);
    b.type("\t");
    await until(() => a.screen() === b.screen() && (a.text()[39] ?? "").length > 0, "the same frame on both", 10_000);
    const info = await infoOn(sessionSocket(dir));
    expect(info!.clients.map(c => c.active)).toEqual([false, true]);
    expect(a.text()).toEqual(b.text());
    a.close(); b.close();
    for (let i = 0; i < 50 && (await infoOn(sessionSocket(dir)))!.clients.length; i++) await Bun.sleep(100);
    expect((await infoOn(sessionSocket(dir)))!.clients).toEqual([]);
  }, 30_000);

  test("a terminal tile's program copies (OSC 52): the client with the keys gets it once, a watcher never; a read, or an agent's, is dropped", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 120, 40), w = await RawClient.attach(sessionSocket(dir), 120, 40, { watch: true });
    await until(() => a.screen().includes("outline") && w.screen().includes("outline"), "both clients drawn", 10_000);
    const clip = (c: RawClient) => c.got.filter(m => m.t === "output" && m.text.includes("\x1b]52;")).map(m => (m as { text: string }).text);
    const opened = await control({ cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    const copying = (what: string, done: string) => `printf '\\033]52;c;?\\007'; printf '\\033]52;c;%s\\007' "$(printf '${what}' | base64)"; echo ${done}-$((6*7))`;
    // An agent typing into the shell: the copy is the program's, but the person isn't using the tile: not passed on.
    for (let i = 0; ; i++) {
      try { await control({ cmd: "act", action: "tile.type", tile: opened.id, args: { text: copying("Pull the bindweed", "agent") + "\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => a.screen().includes("agent-42"), "the agent's command to run", 10_000);
    await until(() => a.screen().includes("click in it, then copy again"), "the toast saying it wasn't copied", 5000);
    expect(clip(a)).toEqual([]);
    // The person clicks in the tile (they type there) and runs it themselves.
    const t = (await control({ cmd: "act", action: "layout.get", as: "test-agent" })).tiles.find((x: any) => x.id === opened.id);
    const x = t.rect.col + 4, y = t.rect.row + 3;
    a.type(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== t.name; i++) await Bun.sleep(100);
    a.type(copying("Net the brassicas", "copied") + "\r");
    await until(() => a.screen().includes("copied-42") && clip(a).length > 0, "the copy on the client with the keys", 10_000);
    await Bun.sleep(200);
    expect(clip(a)).toEqual([`\x1b]52;c;${Buffer.from("Net the brassicas").toString("base64")}\x07`]);
    expect(clip(w)).toEqual([]);
    a.type("\x1d");                                       // ctrl+] back to the door
    await control({ cmd: "act", action: "tile.close", tile: opened.id, as: "test-agent" }).catch(() => {});
    a.close(); w.close();
    for (let i = 0; i < 50 && (await infoOn(sessionSocket(dir)))!.clients.length; i++) await Bun.sleep(100);
  }, 40_000);

  test("a terminal is refused: another protocol, inside the session, before hello", async () => {
    const said = async (more: Partial<Hello> | null, first?: ClientMsg) => {
      const sock = await new Promise<Socket>((res, rej) => { const s = connect(sessionSocket(dir), () => res(s)); s.once("error", rej); });
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
  }, 30_000);

  test("ending asks while programs run in its tiles, then ends: every client told, the files gone", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 100, 30);
    // An attached terminal (a watcher above all) can't end it over the wire: the menu's E is how.
    const watcher = await RawClient.attach(sessionSocket(dir), 80, 24, { watch: true });
    watcher.send({ t: "end", force: true });
    await until(() => watcher.got.some(m => m.t === "ask"), "the refusal", 5000);
    expect((watcher.got.find(m => m.t === "ask") as any).message).toMatch(/from the main menu \(E\)/);
    // `ep0ch session end` connects without attaching: asked first, then forced.
    const asker = await new Promise<Socket>((res, rej) => { const s = connect(sessionSocket(dir), () => res(s)); s.once("error", rej); });
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
    await until(() => !existsSync(sessionSocket(dir)) && !existsSync(sessionFile(dir)), "the session's files to go", 5000);
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
    const dir = mkdtempSync(join(scratchRoot(), "ep0ch-host-")), was = process.env.EP0CH_STATE;
    let hostPid = 0;
    process.env.EP0CH_STATE = dir;
    try {
      const { host: first } = await ensurePtyHost(dir);
      hostPid = first.hostPid;
      let out = "";
      const proc = first.spawn({ key: "desk.json:t5", argv: ["sh", "-c", "echo sown-$((6*7)); exec sleep 30"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, cols: 40, rows: 10, meta: { cmd: ["sh"] } }, d => { out += Buffer.from(d).toString(); });
      await until(() => out.includes("sown-42"), "the program's output", 5000);
      let ended: number | null = null;
      void proc.exited.then(c => { ended = c; });
      first.release();
      await Bun.sleep(100);
      expect(ended).toBeNull();                              // let go of, not ended
      const { host: next } = await ensurePtyHost(dir);
      expect(next.hostPid).toBe(first.hostPid);
      let more = "";
      const kept = next.adopt("desk.json:t5", ["sh"], d => { more += Buffer.from(d).toString(); })!;
      expect(Buffer.from(kept.replay).toString()).toContain("sown-42");
      expect(kept.proc.pid).toBe(proc.pid!);
      expect(next.adopt("desk.json:t5", ["sh"], () => {})).toBeNull();   // adopted once
      kept.proc.write("x");
      next.endAll();
      await until(() => !existsSync(ptyHostSocket(dir)), "the host to end", 5000);
      expect(() => process.kill(proc.pid!, 0)).toThrow();
    } finally {
      // Whatever it left: the host, by pid (SIGTERM ends it and its programs).
      if (hostPid) { try { process.kill(hostPid, "SIGTERM"); } catch { /* gone */ } }
      if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  test("a connection that doesn't say hello is a probe: it never takes the host from its daemon", async () => {
    const dir = mkdtempSync(join(scratchRoot(), "ep0ch-host-")), was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    let host: Awaited<ReturnType<typeof ensurePtyHost>>["host"] | null = null;
    try {
      ({ host } = await ensurePtyHost(dir));
      let lost = false;
      host.onLost = () => { lost = true; };
      for (let i = 0; i < 3; i++) await new Promise<void>(r => { const c = connect(ptyHostSocket(dir), () => { c.end(); r(); }); });
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
    const dir = mkdtempSync(join(scratchRoot(), "ep0ch-host-")), was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    let ended = false;
    const old = createServer(sock => {
      const f = new HostFrames();
      sock.on("data", (d: Buffer) => {
        for (const x of f.push(d)) {
          if (x.t === "h") { sock.write(frame("l", 0, { proto: HOST_PROTOCOL + 1, pid: 1, ptys: [] })); sock.write(frame("y", 0)); }
          if (x.t === "q") { ended = true; old.close(); try { rmSync(ptyHostSocket(dir)); } catch { /* gone */ } }
        }
      });
    });
    await new Promise<void>(r => old.listen(ptyHostSocket(dir), () => r()));
    try {
      const { host, ended: n } = await ensurePtyHost(dir);
      expect(ended).toBe(true);
      expect(n).toBe(0);
      expect(host.hostPid).not.toBe(1);
      host.endAll();
      await until(() => !existsSync(ptyHostSocket(dir)), "the new host to end", 5000);
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
    const menu = new MainMenu(), desk = { title: "desk", name: "desk" }, detail = { title: "detail", name: "detail", openArgs: () => ({ note: "a1111111-1111-4111-8111-111111111111" }) }, list = { title: "new scan" };
    expect(screenSteps([menu, detail, list] as any, [desk] as any)).toEqual([
      { action: "screen.open", args: { name: "desk" } }, { action: "screen.back" }, { action: "screen.open", args: { name: "detail", note: "a1111111-1111-4111-8111-111111111111" } },
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
    const sock = connect(sessionSocket(dir)), f = new Frames<DaemonMsg>();
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
  let plot = "", hostSock = "";
  const control = (req: Record<string, unknown>) => new Promise<any>((res, rej) => {
    const s = connect(join(dir, "door.sock"));
    let buf = "";
    s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
    s.on("data", d => { buf += d; if (buf.includes("\n")) { s.end(); const r = JSON.parse(buf); r.ok ? res(r.result) : rej(new Error(r.error)); } });
    s.on("error", rej);
  });
  const daemonPid = () => JSON.parse(readFileSync(sessionFile(dir), "utf8")).pid as number;
  const shellPid = async () => (await infoOn(sessionSocket(dir)))!.terminals.find(t => t.cmd === "sh")?.pid;

  beforeAll(async () => {
    scratch = new Scratch();
    const sock = await scratch.start();
    const b = new SocketBoard(sock);
    await b.info();
    plot = (await b.request<{ id: string }>("create", { parentId: null, text: "Seed swap list\nBeans, chard", author: "agent" })).id;
    b.close();
    env("EP0CH_STATE", join(scratch.root, "door"));
    env("EP0CH_SOCKET", sock); hostSock = sock;
    env("EP0CH_WS", scratch.name);
    dir = (placeFor([]) as Place).dir;
    env("EP0CH_DAILY_AGENT", "sh");
    expect(await startSession(dir, ["--screen", "desk"])).toEqual({ ok: true });
  }, 60_000);

  afterAll(async () => {
    // Whatever is left of it: ended (its terminal host with it), then killed by pid if it didn't go.
    const info = await infoOn(sessionSocket(dir)).catch(() => null);
    if (info) { await request({ t: "end", force: true }, 10_000); }
    for (const pid of [info?.pid, info?.host]) if (pid) { try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await scratch.dispose();
  }, 30_000);

  test("a handover keeps a reader's way back: three notes, then back in order with the scroll kept, the zoom and the focus too, and the same after another handover (PIE-643)", async () => {
    // A trail of three: the shed links the tools, the tools link the rake. The shed is long, its link far down.
    const b = new SocketBoard(hostSock);
    await b.info();
    const make = async (text: string) => (await b.request<{ id: string }>("create", { parentId: null, text, author: "agent" })).id;
    const rake = await make("Rake\nTines up.");
    const tools = await make(`Tools\nSharp ones first. The rake: ((${rake})).`);
    const shed = await make(`Shed\n${Array.from({ length: 90 }, (_, i) => `Row ${i + 1} of the shed.`).join("\n")}\nThe tools are in ((${tools})).`);
    b.close();
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("outline"), "the desk", 10_000);
    await control({ cmd: "act", action: "open", args: { id: shed }, as: "test-agent" });
    await until(() => a.screen().includes("Row 1 of the shed"), "the shed in the reader", 10_000);
    a.type("2");
    const state = async () => (await control({ cmd: "peek" })).screen.state;
    const reader = async () => (await state()).readers.find((r: any) => r.name === "reader");
    for (let i = 0; i < 50 && (await state()).focus !== "reader"; i++) await Bun.sleep(100);
    const follow = async (to: string) => {
      a.type("]");
      await Bun.sleep(150);
      a.type("\r");
      await until(() => a.screen().includes(to), `${to} after the link`, 10_000);
    };
    await follow("Sharp ones first");
    await follow("Tines up");
    const titles = async () => (await reader()).history.back.map((x: any) => x.title);
    expect((await titles()).slice(0, 2)).toEqual(["Tools", "Shed"]);
    await control({ cmd: "act", action: "tile.zoom", tile: "reader", as: "test-agent" });
    expect((await state()).zoom).toBe(2);   // the reader, tile 2

    const hand = async (c: HandoffClient) => {
      expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
      await until(() => c.closed, "the old daemon to let the terminal go", 5000);
      const n = await HandoffClient.attach(sessionSocket(dir), 140, 40);
      await until(() => n.screen().includes("handed over to a new daemon"), "the handoff said", 10_000);
      return n;
    };
    const b1 = await hand(a);
    await until(() => b1.screen().includes("Tines up"), "the rake after the handoff", 10_000);
    expect(await state()).toMatchObject({ zoom: 2, focus: "reader" });
    expect((await titles()).slice(0, 2)).toEqual(["Tools", "Shed"]);
    b1.type("\x1b[1;3D");                                   // alt+←
    await until(() => b1.screen().includes("Sharp ones first"), "back on the tools", 10_000);
    b1.type("\x1b[1;3D");
    await until(() => b1.screen().includes("The tools are in") && !b1.screen().includes("Row 1 of the shed"), "back on the shed, as far down as it was", 10_000);
    expect((await reader()).history.forward.map((x: any) => x.title)).toEqual(["Tools", "Rake"]);

    // Once more, from the middle of the trail: forward is still there, and the place with it.
    const b2 = await hand(b1);
    await until(() => b2.screen().includes("The tools are in") && !b2.screen().includes("Row 1 of the shed"), "the shed after the second handoff", 10_000);
    b2.type("\x1b[1;3C");                                   // alt+→
    await until(() => b2.screen().includes("Sharp ones first"), "forward to the tools", 10_000);
    await control({ cmd: "act", action: "tile.zoom", tile: "reader", args: { on: false }, as: "test-agent" });
    b2.close();
  }, 180_000);

  test("`session restart`: a new daemon, the same shell with its output, the screens and the edit open again", async () => {
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
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

    const b = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => b.screen().includes("chard-42") && b.screen().includes("and kale"), "the shell's output and the edit after the handoff", 10_000).catch(e => { console.log(b.screen()); throw e; });
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 5000);
    const peek = await control({ cmd: "peek" });
    // The edit is open again on the same note, unsaved, its text brought back from where the handoff put it aside.
    expect(JSON.stringify(peek.screen.state)).toContain(`"place":"edit:${plot}"`);
    expect(JSON.stringify(peek.screen.state)).toContain(`"dirty":true`);
    b.close();
  }, 60_000);

  test("an agent in a tile follows its door through a handover: its `ep0ch where` and `act` reach the new daemon, by its outline's session (PIE-604)", async () => {
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("chard-42"), "the desk with its shell", 10_000);
    // The fake agent is the shell the first test opened: a program in a tile, kept through every handover.
    const shell = await shellPid();
    const tile = ((await control({ cmd: "peek" })).screen.state.panes as any[]).find(p => p?.terminal?.pid === shell)!.id as string;
    const before = daemonPid();
    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => a.closed, "the old daemon to let the terminal go", 5000);
    const b = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 10_000);
    expect(daemonPid()).not.toBe(before);
    expect(await shellPid()).toBe(shell);
    const out = mkdtempSync(join(scratch.root, "agent-"));
    const ep0chCmd = `${process.execPath} ${join(import.meta.dir, "../src/main.ts")}`;
    // As the agent: where it is, an act, and an act from an environment whose socket went with an old process
    // (door-<pid>.sock: a door that started beside another on its outline).
    const line = `${ep0chCmd} where --json > ${out}/where.json; ${ep0chCmd} act layout.get --as fake-agent > ${out}/act.json; ` +
      `EP0CH_CONTROL=$EP0CH_PLACE/door-${before}.sock ${ep0chCmd} act layout.get --as fake-agent > ${out}/act-old.json; echo followed-$((6*7))\\n`;
    await control({ cmd: "act", action: "tile.type", tile, args: { text: line }, as: "test-agent" });
    await until(() => b.screen().includes("followed-42"), "the agent's commands", 20_000);
    const w = JSON.parse(readFileSync(join(out, "where.json"), "utf8"));
    expect(w.door).toMatchObject({ pid: daemonPid(), answers: true, moved: false, control: join(dir, "door.sock") });
    expect(w.door.stale).toContain(`it answers for pid ${daemonPid()}`);
    expect(w.door.tile).toMatchObject({ found: true, descends: true });
    expect(JSON.parse(readFileSync(join(out, "act.json"), "utf8"))).toBeTruthy();
    expect(JSON.parse(readFileSync(join(out, "act-old.json"), "utf8"))).toEqual(JSON.parse(readFileSync(join(out, "act.json"), "utf8")));
    // The shell's screen as the tests after this one know it.
    await control({ cmd: "act", action: "tile.type", tile, args: { text: "clear; echo chard-$((6*7))\\n" }, as: "test-agent" });
    await until(() => !b.screen().includes("followed-42") && b.screen().includes("chard-42"), "the shell cleared", 10_000);
    b.close();
  }, 60_000);

  test("a desk kept in the background comes back with its program: D on the menu shows it, the same process", async () => {
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("chard-42"), "the desk", 10_000);
    a.type("\x1b[23;5u");                                  // ctrl+w (as a Kitty terminal sends it) is ^W on the desk; esc after it stays…
    a.type("q");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.screen !== "main menu"; i++) { a.type("q"); await Bun.sleep(100); }
    expect((await control({ cmd: "peek" })).screen.screen).toBe("main menu");
    const shell = await shellPid();
    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => a.closed, "the old daemon to let go", 5000);
    const b = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => b.screen().includes("handed over to a new daemon"), "the handoff said", 10_000);
    b.type("d");
    await until(() => b.screen().includes("chard-42"), "the desk's shell after the handoff", 10_000);
    expect(await shellPid()).toBe(shell);
    b.close();
  }, 60_000);

  test("a daemon killed with -9: the next start restores the screens and adopts the shell", async () => {
    const before = { daemon: daemonPid(), shell: await shellPid() };
    // The checkpoint is written a moment after the screens change: the desk opened just now is in it before the kill.
    await until(() => !readFileSync(join(dir, "session-state.json"), "utf8").includes("screen.back"), "the checkpoint with the desk on top", 5000);
    process.kill(before.daemon, "SIGKILL");
    await until(() => { try { process.kill(before.daemon, 0); return false; } catch { return true; } }, "the daemon gone", 5000);
    expect(await startSession(dir, [])).toEqual({ ok: true });
    expect(daemonPid()).not.toBe(before.daemon);
    // Kept in the terminal host (adopted by its tile as the desk is drawn, maybe already).
    const after = (await infoOn(sessionSocket(dir)))!;
    expect([...after.kept!.map(k => k.pid), ...after.terminals.map(t => t.pid)]).toContain(before.shell!);
    const c = await HandoffClient.attach(sessionSocket(dir), 120, 36);
    await until(() => c.screen().includes("chard-42"), "the shell's output after the crash", 10_000);
    expect(await shellPid()).toBe(before.shell);
    await until(() => c.screen().includes("came back after its daemon stopped"), "the restore said", 5000);
    c.close();
  }, 60_000);

  test("ending the session ends its terminal host and the programs in it; nothing is left to restore", async () => {
    const info = (await infoOn(sessionSocket(dir)))!;
    const shell = await shellPid();
    expect(await request({ t: "end", force: true }, 15_000)).toBe("closed");
    await until(() => { try { process.kill(info.host!, 0); return false; } catch { return true; } }, "the terminal host to end", 10_000);
    expect(() => process.kill(shell!, 0)).toThrow();
    for (const f of ["session-state.json", "session.json", "pty.sock", "session.sock"]) expect(existsSync(join(dir, f))).toBe(false);
  }, 30_000);
});

// ── one session per outline ─────────────────────────────────────────────────────────────────────────────────
// Like `herdr --session <name>`: an outline's session lives in its own folder of the state dir, so two outlines run
// side by side, each attached to by naming it; `session list` shows both, and `end --all` ends both.
describe("where a session lives (src/session/place.ts)", () => {
  test("its outline's folder: this machine's under local/, a machine's under its ssh name, a socket named outright by its hash", () => {
    const env = { HOME: "/home/wren", EP0CH_OUTLINES: "/home/wren/outlines" };
    expect(placeOf({ outline: "garden" }, "/s", env)).toEqual({ outline: "garden", dir: "/s/sessions/local/garden" });
    expect(placeOf({ outline: "garden", socket: "/home/wren/outlines/.host/host.sock" }, "/s", env)).toEqual({ outline: "garden", dir: "/s/sessions/local/garden" });
    expect(placeOf({ outline: "garden", machine: "allotment" }, "/s", env)).toEqual({ outline: "garden", machine: "allotment", dir: "/s/sessions/allotment/garden" });
    const named = placeOf({ outline: "garden", socket: "/tmp/plot/host.sock" }, "/s", env);
    expect(named.dir).toMatch(/^\/s\/sessions\/socket-[0-9a-f]{10}\/garden$/);
    expect(named.socket).toBe("/tmp/plot/host.sock");
    // A machine named "local" is never this machine.
    expect(placeOf({ outline: "garden", machine: "local" }, "/s", env).dir).toBe("/s/sessions/machine-local/garden");
  });

  test("a command for a session on a host named outright carries its EP0CH_SOCKET, so it opens that session and no other", () => {
    const at = { outline: "garden", socket: "/tmp/plot/host.sock" };
    expect(ep0ch({ EP0CH_STATE: "/s" }, at) + sessionFlags({ place: at })).toBe("EP0CH_STATE=/s EP0CH_SOCKET=/tmp/plot/host.sock ep0ch --ws garden");
    expect(ep0ch({}, {}) + sessionFlags({ place: { outline: "garden", machine: "allotment" } })).toBe("ep0ch --ws garden --machine allotment");
    expect(detachedSaying(at)).toContain(`\`${ep0ch(process.env, at)}session end --ws garden\` ends it`);
    expect(ep0ch({}, at)).toBe("EP0CH_SOCKET=/tmp/plot/host.sock ep0ch ");
  });

  test("a path too long for a unix socket gets a short hash in sessions/~/, the same every time", () => {
    const root = `/tmp/${"deep/".repeat(8)}state`;
    const a = placeOf({ outline: "seed-library-and-tool-shed-notes", machine: "allotment-north" }, root, {});
    expect(a.dir).toMatch(new RegExp(`^${root}/sessions/~/[0-9a-f]{10}$`));
    expect(join(a.dir, "door-4194304.sock").length).toBeLessThanOrEqual(103);
    expect(placeOf({ outline: "seed-library-and-tool-shed-notes", machine: "allotment-north" }, root, {}).dir).toBe(a.dir);
    expect(placeOf({ outline: "seed-library-and-tool-shed-notex", machine: "allotment-north" }, root, {}).dir).not.toBe(a.dir);
  });
});

describe.skipIf(!outliner)("one session per outline, two at once", () => {
  let host: ScratchHost;
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  let garden: Place, orchard: Place, none = "", gardenNote = "";
  const cli = async (...args: string[]) => {
    const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), ...args], { cwd: none, env: process.env as Record<string, string>, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  };
  const control = (dir: string, req: Record<string, unknown>) => new Promise<any>((res, rej) => {
    const s = connect(join(dir, "door.sock"));
    let buf = "";
    s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
    s.on("data", d => { buf += d; if (buf.includes("\n")) { s.end(); const r = JSON.parse(buf); r.ok ? res(r.result) : rej(new Error(r.error)); } });
    s.on("error", rej);
  });

  beforeAll(async () => {
    host = new ScratchHost();
    await host.start();
    await host.create("garden");
    await host.create("orchard");
    none = host.folder("none");
    for (const [k, v] of Object.entries(host.env)) env(k, v);
    env("EP0CH_STATE", join(host.root, "state"));
    env("EP0CH_DAILY_AGENT", "sh");
    env("EP0CH_WS", undefined); env("EP0CH_SOCKET", undefined); env("EP0CH_CONTROL", undefined);
    garden = placeFor(["--ws", "garden"], process.env, none) as Place;
    orchard = placeFor(["--ws", "orchard"], process.env, none) as Place;
    const board = new SocketBoard(host.sock, undefined, "garden");
    gardenNote = (await board.request<{ id: string }>("create", { text: "Mint bed\nWater every morning.", author: "agent" })).id;
    board.close();
    expect(await startSession(garden.dir, ["--ws", "garden", "--screen", "desk"])).toEqual({ ok: true });
    expect(await startSession(orchard.dir, ["--ws", "orchard", "--screen", "desk"])).toEqual({ ok: true });
  }, 60_000);

  afterAll(async () => {
    for (const p of [garden, orchard]) {
      const i = p ? await infoOn(sessionSocket(p.dir)).catch(() => null) : null;
      for (const pid of [i?.pid, i?.host]) if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await host.stop();
    rmSync(host.root, { recursive: true, force: true });
  }, 30_000);

  test("each runs in its own folder, on its own outline, with its own control socket", async () => {
    expect(garden.dir).toBe(join(host.root, "state", "sessions", "local", "garden"));
    expect(orchard.dir).toBe(join(host.root, "state", "sessions", "local", "orchard"));
    const running = await runningSessions();
    expect(running.map(r => r.info.place.outline).sort()).toEqual(["garden", "orchard"]);
    expect(new Set(running.map(r => r.info.pid)).size).toBe(2);
    expect((await control(garden.dir, { cmd: "peek" })).screen.outline ?? (await infoOn(sessionSocket(garden.dir)))!.outline.outline).toBe("garden");
    expect((await infoOn(sessionSocket(orchard.dir)))!.outline.outline).toBe("orchard");
  });

  test("open accepts a canonical URI and reports the receiving session and host pane", async () => {
    const attached = await RawClient.attach(sessionSocket(garden.dir), 120, 36, { clientHost: { kind: "tern", pane: "pane-7" } });
    await until(() => attached.screen().includes("garden"), "garden session attached", 10_000);
    const uri = formatEp0chBlockUri({ outline: "garden", machine: canonicalLocalMachineName(), blockId: gardenNote });
    const agentControl = join(host.root, "state", "agent-pane-7.sock");
    rmSync(agentControl, { force: true });
    symlinkSync(join(garden.dir, "door.sock"), agentControl);
    const oldControl = process.env.EP0CH_CONTROL;
    process.env.EP0CH_CONTROL = agentControl;
    let r: Awaited<ReturnType<typeof cli>> | null = null;
    try { r = await cli("open", uri, "--json"); }
    finally { if (oldControl === undefined) delete process.env.EP0CH_CONTROL; else process.env.EP0CH_CONTROL = oldControl; }
    if (!r) throw new Error("open did not run");
    const opened = JSON.parse(r.out);
    expect([r.code, opened.opened]).toEqual([0, true]);
    expect(opened).toMatchObject({
      id: gardenNote,
      receiver: {
        session: { outline: "garden", machine: null },
        clientHost: { kind: "tern", pane: "pane-7" },
      },
    });
    const gardenText = (await control(garden.dir, { cmd: "peek" })).text.join("\n");
    expect(gardenText).toContain("Mint bed");
    // The URI's #fragment goes on to the open (the reader scrolls to it, or says it's missing).
    process.env.EP0CH_CONTROL = agentControl;
    try { r = await cli("open", `${uri}#late-sowing`, "--json"); }
    finally { if (oldControl === undefined) delete process.env.EP0CH_CONTROL; else process.env.EP0CH_CONTROL = oldControl; }
    expect(JSON.parse(r.out)).toMatchObject({ opened: true, id: gardenNote, fragment: "late-sowing" });
    expect((await control(orchard.dir, { cmd: "peek" })).text.join("\n")).not.toContain("Mint bed");
    attached.send({ t: "detach" });
  });

  test("an explicit control socket refuses a URI for another outline", async () => {
    const uri = formatEp0chBlockUri({ outline: "garden", machine: canonicalLocalMachineName(), blockId: gardenNote });
    const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "open", uri, "--json"], {
      cwd: none,
      env: { ...(process.env as Record<string, string>), EP0CH_CONTROL: join(orchard.dir, "door.sock") },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    const result = JSON.parse(out);
    expect(result.opened).toBe(false);
    expect(result.reason).toContain("that URI names garden");
    expect(result.reason).toContain("but this door is orchard");
  });

  test("attaching names the outline: each terminal gets its own outline's session, and each desk saves in its own folder", async () => {
    const a = await RawClient.attach(sessionSocket(garden.dir), 120, 36), b = await RawClient.attach(sessionSocket(orchard.dir), 120, 36);
    await until(() => a.screen().includes("garden") && b.screen().includes("orchard"), "each desk on its outline", 10_000).catch(e => { console.log(a.screen(), b.screen()); throw e; });
    await control(garden.dir, { cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    await until(() => existsSync(join(garden.dir, "desk.json")), "garden's desk saved in its folder", 10_000);
    const g = readFileSync(join(garden.dir, "desk.json"), "utf8");
    expect(g).toContain("\"pty\"");
    expect(existsSync(join(orchard.dir, "desk.json")) ? readFileSync(join(orchard.dir, "desk.json"), "utf8") : "").not.toContain("\"pty\"");
    expect(existsSync(join(host.root, "state", "desk.json"))).toBe(false);
    a.send({ t: "detach" }); b.send({ t: "detach" });
    await until(() => a.closed && b.closed, "both detached", 5000);
    expect(a.got.at(-1)).toMatchObject({ t: "bye", reason: "detached", message: expect.stringContaining(`\`EP0CH_STATE=${join(host.root, "state")} ep0ch --ws garden\` attaches again`) });
  }, 30_000);

  test("with nothing named, a command says which to name, as commands; named, it acts on that one", async () => {
    const env0 = process.env as Record<string, string>;
    const picked = await pickSession([], "attach", env0, none);
    // Each pasteable as it is: this state dir's EP0CH_STATE filled in.
    const st = `EP0CH_STATE=${join(host.root, "state")}`;
    expect("error" in picked && picked.error).toContain(`  ${st} ep0ch session attach --ws garden\n  ${st} ep0ch session attach --ws orchard`);
    expect(await pickSession(["--ws", "orchard"], "attach", env0, none)).toEqual(orchard);
    const ctl = await controlFor(env0, none);
    expect(typeof ctl === "object" && ctl.error).toContain(`EP0CH_CONTROL=${join(garden.dir, "door.sock")} ep0ch peek   # garden`);
    expect(await controlFor({ ...env0, EP0CH_WS: "orchard" }, none)).toBe(join(orchard.dir, "door.sock"));
  });

  test("`session list` shows both; `session end --all --yes` ends both", async () => {
    const list = await cli("session", "list");
    expect(list.code).toBe(0);
    expect(list.out).toMatch(/^garden on .* · session \d+/m);
    expect(list.out).toMatch(/^orchard on .* · session \d+/m);
    const json = JSON.parse((await cli("session", "list", "--json")).out) as { place: { outline: string } }[];
    expect(json.map(i => i.place.outline).sort()).toEqual(["garden", "orchard"]);
    const ended = await cli("session", "end", "--all", "--yes");
    expect(ended.code).toBe(0);
    expect(ended.out).toContain("garden's session ended");
    expect(ended.out).toContain("orchard's session ended");
    await until(() => !existsSync(sessionSocket(garden.dir)) && !existsSync(sessionSocket(orchard.dir)), "both sessions gone", 10_000);
    expect((await cli("session", "list")).out).toContain("no session runs");
    // Named, with no door on it: said, with the command that starts one.
    const ctl = await controlFor({ ...(process.env as Record<string, string>), EP0CH_WS: "garden" }, none);
    expect(typeof ctl === "object" && ctl.error).toContain(`no door runs on garden · \`EP0CH_STATE=${join(host.root, "state")} ep0ch --ws garden\` starts one`);
  }, 60_000);
});
