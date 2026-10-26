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
import { FRAMES_IN_FLIGHT, SessionTerm, type Link } from "../src/session/session-term";
import { doorMode, runEnv } from "../src/session/client";
import { sessionEnv, startSession } from "../src/session/start";
import { ancestors, detachedSaying, takeLock } from "../src/session/daemon";
import { controlFor, ep0ch, pickSession, placeFor, placeOf, runningSessions, sessionFile, sessionFlags, sessionInfo as infoOn, sessionSocket, type Place } from "../src/session/place";
import { ensurePtyHost, frame, HostFrames, HOST_PROTOCOL, ptyHostSocket } from "../src/session/pty-host";
import { restore, restoredSaying, screenSteps, type Checkpoint } from "../src/session/restore";
import { tuningOf } from "../src/look";
import { MainMenu, SHELL_ACTIONS } from "../src/screens";
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
const hello = (cols: number, rows: number, more: Partial<Hello> = {}): Hello => ({ proto: PROTOCOL, remote: false, cols, rows, cellW: 9, cellH: 16, kitty: false, pid: 4242, ...more });

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
    n = 4; app.redraw();
    app.catchUp();                                         // a control read before the queued frame is due
    expect(term.mirror.text()).toContain("tick 4");
    app.quit();
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

  test("a terminal attaching takes the session from one left untouched (its terminal restarted, its ssh not yet dropped): drawn at its size, images placed whole", () => {
    const { term, keys, paint } = session();
    const stale = fakeLink(100, 30), fresh = fakeLink(80, 24);
    const cs = term.attach(stale.link, hello(100, 30, { kitty: true }));
    paint();
    // Its terminal went away without a goodbye: its link stays open, and nobody has typed on it for a minute.
    (cs as unknown as { since: number }).since = Date.now() - 60_000;
    const cf = term.attach(fresh.link, hello(80, 24, { kitty: true }));
    paint();
    expect(term.info.cols).toBe(80);
    expect(term.list().find(c => c.id === cf.id)!.active).toBe(true);
    expect(fresh.text()[0]).toMatch(/^row 0 of 80.24$/);     // CP437 under the tube: × reads x
    expect(fresh.text().join("\n")).not.toContain("for another terminal");
    // Its own uploads, placed at its size (the tube under its text): nothing cut away for the other terminal's.
    expect(fresh.sent.filter(m => m.t === "output" && m.text.includes("a=t,")).length).toBeGreaterThan(0);
    term.input(cf, "j");
    expect(keys).toEqual([{ kind: "char", ch: "j" }]);
    // One typed on a moment ago keeps the keys when another attaches: both are in use.
    const third = fakeLink(60, 20);
    term.attach(third.link, hello(60, 20));
    expect(term.list().find(c => c.id === cf.id)!.active).toBe(true);
    // Nor does a terminal running a program the session handed it, however long since it typed here.
    (cf as unknown as { lastInput: number }).lastInput = Date.now() - 60_000;
    cf.away = "vim";
    term.attach(fakeLink(60, 20).link, hello(60, 20));
    expect(term.list().find(c => c.id === cf.id)!.active).toBe(true);
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

  test("hover reports fold into the newest, in step with the clicks and drags around them; a frame apart, none is lost (PIE-1300)", async () => {
    const { term, app, keys, paint } = session();
    const a = fakeLink(100, 30);
    const ca = term.attach(a.link, hello(100, 30));
    paint();
    // A click aimed at a frame the terminal hadn't seen only takes the session: a key first.
    term.input(ca, "j"); keys.length = 0;
    const hover = (x: number, y: number) => `\x1b[<35;${x + 1};${y + 1}M`;
    const motion = (x: number, y: number) => ({ kind: "mouse", action: "drag", button: 3, x, y });
    // What one socket read held is one batch. Three hovers, a click, two hovers, a drag with the left button held, a hover:
    // the newest hover before each other report stands, the others are never held back or dropped, and the order is kept.
    term.readBatch(() => {
      for (const text of [hover(1, 1), hover(2, 1), hover(3, 1), "\x1b[<0;5;5M", "\x1b[<0;5;5m", hover(4, 2), hover(5, 2), "\x1b[<32;6;2M", hover(7, 2)]) term.input(ca, text);
    });
    expect(keys).toEqual([
      motion(3, 1),
      { kind: "mouse", action: "down", button: 0, x: 4, y: 4 },
      { kind: "mouse", action: "up", button: 0, x: 4, y: 4 },
      motion(5, 2),
      { kind: "mouse", action: "drag", button: 0, x: 5, y: 1 },
    ]);
    // The last one was handled less than a frame after the one before it: it comes when the frame is up.
    await until(() => keys.length === 6, "the held hover to be handled", 1000);
    expect(keys.at(-1)).toEqual(motion(7, 2));
    expect((app.describe() as any).speed.motionCoalesced).toBe(3);
    // A batch that throws still leaves its newest hover handled.
    keys.length = 0;
    await Bun.sleep(30);
    expect(() => term.readBatch(() => { term.input(ca, hover(1, 3)); term.input(ca, hover(2, 3)); throw new Error("a screen's key threw"); })).toThrow("a screen's key threw");
    expect(keys).toEqual([motion(2, 3)]);
    // Reads of one report each, a frame apart or more: each is handled as it comes. Closer than that, the newest of them is.
    keys.length = 0;
    await Bun.sleep(30);
    term.input(ca, hover(1, 1));
    expect(keys).toEqual([motion(1, 1)]);
    term.input(ca, hover(2, 1)); term.input(ca, hover(3, 1));
    expect(keys).toHaveLength(1);
    await until(() => keys.length === 2, "the newest hover, a frame later", 1000);
    expect(keys.at(-1)).toEqual(motion(3, 1));
    expect((app.describe() as any).speed.motionCoalesced).toBe(5);
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

// PIE-1163, Evan Oct 21 tethered over ssh: after a wifi drop mid-drag he watched a replay of every frame. The daemon
// can't see the link (the client's socket is local; the slow hop is sshd to the Mac), so it asks the terminal: each frame
// is followed by CSI 5 n, the terminal answers CSI 0 n once it has taken everything before it, and a client with
// FRAMES_IN_FLIGHT frames unanswered is not painted (Rows.paint diffs against what it last wrote, so the rows that
// changed meanwhile are remembered by that) until an answer comes; then it is painted with the latest.
describe("a slow link gets the latest frame, never a queue of old ones (PIE-1163)", () => {
  /** A session whose screen says which frame it is, and the frames a client's terminal was sent, by number. */
  function counting() {
    const term = new SessionTerm();
    let n = 0;
    const app = new App(term, { supports: () => null, protocol: null } as any, Date.now(), () => {});
    app.push({ title: "plot board", noDrawer: true, key: () => {}, render: (ctx: any) => ({ lines: Array.from({ length: ctx.t.rows - 1 }, (_, i) => (i ? `row ${i}` : `frame ${n}`)) }) } as any);
    const paint = () => (app as any).paint();
    const make = (to: number) => { for (; n < to; ) { n++; paint(); } };
    const frames = (l: ReturnType<typeof fakeLink>) => l.sent.filter((m): m is Extract<DaemonMsg, { t: "output" }> => m.t === "output" && m.text.includes("\x1b[?2026l"));
    const numbers = (l: ReturnType<typeof fakeLink>) => frames(l).map(m => Number(/frame (\d+)/.exec(m.text)?.[1] ?? NaN));
    return { term, app, paint, make, frames, numbers };
  }
  const answer = "\x1b[0n";

  test("a reader that stops answering while 200 frames are made gets the latest one next when it resumes, not the backlog", async () => {
    const { term, make, numbers } = counting();
    const a = fakeLink(80, 24);
    const ca = term.attach(a.link, hello(80, 24, { acks: true }));
    expect(numbers(a)).toEqual([0]);                      // the screen as it was when the terminal attached
    make(1);                                              // frame 1: the second in flight
    await Bun.sleep(200);                                 // the terminal reads nothing, answers nothing
    make(200);
    expect(numbers(a)).toEqual([0, 1]);                   // 2..199 were never sent
    expect(term.speed()[0]).toMatchObject({ id: ca.id, unacked: FRAMES_IN_FLIGHT, skipped: 199 });
    term.input(ca, answer);                               // it takes the first: the latest is painted, once
    expect(numbers(a)).toEqual([0, 1, 200]);
    expect(a.text()[0]).toBe("frame 200");
    term.input(ca, answer); term.input(ca, answer);       // nothing more was made: nothing more is sent
    expect(numbers(a)).toEqual([0, 1, 200]);
    expect(term.speed()[0]).toMatchObject({ unacked: 0 });
    make(201);                                            // and it goes on as before
    expect(numbers(a)).toEqual([0, 1, 200, 201]);
  });

  test("every frame asks to be answered, in order after its synchronized update; the answers never reach the screen as keys", () => {
    const { term, app, paint, frames } = counting();
    const keys: unknown[] = [];
    (app as any).stack.at(-1).key = (k: unknown) => { keys.push(k); };
    const a = fakeLink(80, 24);
    const ca = term.attach(a.link, hello(80, 24, { acks: true }));
    paint();
    expect(frames(a)[0]!.text.endsWith("\x1b[?2026l\x1b[5n")).toBe(true);
    term.input(ca, answer + "j" + answer);
    expect(keys).toEqual([{ kind: "char", ch: "j" }]);
    // Nor into a paste still arriving over a slow link, and the answer inside it is counted.
    term.invalidate(); paint();
    const waiting = term.speed()[0]!.unacked;
    const typedBefore = keys.length;
    term.input(ca, "\x1b[200~pasted "); term.input(ca, answer); term.input(ca, "text\x1b[201~");
    expect(keys.slice(typedBefore).map((k: any) => k.ch ?? `<${k.kind}>`).join("")).toBe("pasted text");
    expect(term.speed()[0]!.unacked).toBe(waiting - 1);
    // Nor into a program typed to in a terminal tile (raw input): it would see ESC [ 0 n.
    const typed: string[] = [];
    term.rawSink = () => b => typed.push(b);
    term.invalidate(); paint();
    expect(term.speed()[0]!.unacked).toBe(1);
    term.input(ca, "ab" + answer + "cd");
    expect(typed.join("")).toBe("abcd");
    expect(term.speed()[0]!.unacked).toBe(0);               // counted all the same
  });

  test("an answer alone isn't the person: it doesn't give the client the keys, nor reset how long it has been left alone", async () => {
    const { term } = counting();
    const a = fakeLink(80, 24), b = fakeLink(60, 20);
    const ca = term.attach(a.link, hello(80, 24, { acks: true })), cb = term.attach(b.link, hello(60, 20, { acks: true }));
    const idle = cb.lastInput;
    term.input(cb, answer);
    expect(term.activeClient).toBe(ca);
    expect(cb.lastInput).toBe(idle);
    term.input(cb, "j");
    expect(term.activeClient).toBe(cb);
  });

  test("a terminal that doesn't answer CSI 5 n (said at attach) is painted every frame, as before, and is asked nothing", () => {
    const { term, make, numbers, frames } = counting();
    const a = fakeLink(80, 24);
    term.attach(a.link, hello(80, 24));
    make(50);
    expect(numbers(a)).toEqual(Array.from({ length: 51 }, (_, i) => i));      // the one drawn at attach, then each
    expect(frames(a).some(m => m.text.includes("\x1b[5n"))).toBe(false);
  });

  test("a client that never answers isn't left dark: after a while the latest frame goes anyway, and it is counted", async () => {
    const { term, make, numbers } = counting();
    term.ackStaleMs = 60;
    const a = fakeLink(80, 24);
    term.attach(a.link, hello(80, 24, { acks: true }));
    make(5);
    expect(numbers(a)).toEqual([0, 1]);
    await until(() => numbers(a).length === 3, "the latest frame to go after the stale time, with no other paint to bring it", 400);
    expect(numbers(a)).toEqual([0, 1, 5]);
    expect(term.speed()[0]).toMatchObject({ ackTimeouts: 1, unacked: 1 });
    // The answers to the two given up on come late: they are theirs, not frame 5's.
    term.input(term.all()[0]!, answer); term.input(term.all()[0]!, answer);
    expect(term.speed()[0]).toMatchObject({ unacked: 1 });
    term.input(term.all()[0]!, answer);
    expect(term.speed()[0]).toMatchObject({ unacked: 0 });
  });

  test("the round trip of the answers is measured for each client, beside the frames waiting", async () => {
    const { term, make } = counting();
    const a = fakeLink(80, 24), b = fakeLink(80, 24);
    const ca = term.attach(a.link, hello(80, 24, { acks: true })), cb = term.attach(b.link, hello(80, 24, { acks: true }));
    make(1);
    await Bun.sleep(40);
    term.input(ca, answer); term.input(ca, answer);
    const [sa, sb] = term.speed();
    expect(sa!.id).toBe(ca.id);
    expect(sa!.ackMs).toBeGreaterThanOrEqual(35);
    expect(sa!.unacked).toBe(0);
    expect(sb!.id).toBe(cb.id);
    expect(sb!.unacked).toBeGreaterThan(0);               // the other one is still waiting: one client's pace is not the other's
  });

  test("a program that has the terminal isn't sent a late answer: the run waits for the frames in flight (or gives up), and the window starts again after", async () => {
    const { term, make, paint, numbers } = counting();
    const a = fakeLink(80, 24);
    const ca = term.attach(a.link, hello(80, 24, { acks: true }));
    make(1);
    const ran = term.handOver(["sh", "-l"]);
    await Bun.sleep(30);
    expect(a.sent.some(m => m.t === "run")).toBe(false);  // the answers would have gone to the shell
    term.input(ca, answer); term.input(ca, answer);
    await until(() => a.sent.some(m => m.t === "run"), "the run, once everything sent was answered", 1000);
    const run = a.sent.find(m => m.t === "run") as Extract<DaemonMsg, { t: "run" }>;
    term.ran(ca, run.id, 0);
    expect(await ran).toBe(0);
    paint();
    expect(numbers(a).at(-1)).toBe(1);
    expect(term.speed()[0]).toMatchObject({ unacked: 1 });
  });

  test("catching up after a stall draws every row again, and frees no image: the terminal still has them", () => {
    const { term, paint } = counting();
    const a = fakeLink(80, 24);
    term.attach(a.link, hello(80, 24, { kitty: true }));
    paint();
    const deletes = () => a.sent.filter(m => m.t === "output" && m.text.includes("\x1b_Ga=d")).length;
    const uploads = () => a.sent.filter(m => m.t === "output" && /\x1b_G[^\x1b]*a=t/.test(m.text)).length;
    const up = uploads();
    expect(up).toBeGreaterThan(0);                        // the tube under the text is an image
    a.setBacklog(64 << 20);
    term.invalidate(); paint();
    a.setBacklog(0);
    expect(a.text()[0]).toBe("frame 0");
    expect({ deletes: deletes(), uploads: uploads() }).toEqual({ deletes: 0, uploads: up });
  });
});

/** A client speaking the protocol over the session socket, with a mirror for a terminal. */
class RawClient {
  readonly mirror: Mirror;
  readonly got: DaemonMsg[] = [];
  /** When each frame of output (the daemon's paints) arrived. */
  readonly drawn: number[] = [];
  closed = false;
  private frames = new Frames<DaemonMsg>();
  private constructor(private sock: Socket, cols: number, rows: number) {
    this.mirror = new Mirror(cols, rows);
    sock.on("data", (d: Buffer) => { for (const m of this.frames.push(d)) { this.got.push(m); if (m.t === "output") { this.drawn.push(performance.now()); this.mirror.write(m.text); } } });
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
  /** Frames written back to back in one socket write: the daemon reads them as one chunk, as it does from a busy link. */
  sendAll(ms: ClientMsg[]) { this.sock.write(Buffer.concat(ms.map(encode))); }
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
    await b.installExtension("runbook");
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

  test("client losses and goodbyes say why in the session log", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 100, 30);
    await until(() => a.got.some(m => m.t === "output"), "the client drawn");
    const attached = (await infoOn(sessionSocket(dir)))!.clients.find(c => c.pid === 4242)!;
    a.close();
    await until(() => readFileSync(join(dir, "session.log"), "utf8").includes(`session client ${attached.id} (pid 4242): socket closed:`), "the lost client's reason logged");
    const b = await RawClient.attach(sessionSocket(dir), 100, 30);
    await until(() => b.got.some(m => m.t === "output"), "the second client drawn");
    b.send({ t: "detach" });
    await until(() => b.closed, "the goodbye");
    expect(b.got.at(-1)).toMatchObject({ t: "bye", reason: "detached" });
    expect(readFileSync(join(dir, "session.log"), "utf8")).toContain('bye sent: {"t":"bye","reason":"detached"');
  });

  test("a real terminal client prints its last received message when the daemon disappears", async () => {
    let output = "";
    const terminal = new Bun.Terminal({ cols: 100, rows: 30, data(_t, bytes) { output += Buffer.from(bytes).toString("utf8"); } });
    const cli = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "--ws", scratch.name], {
      env: { ...process.env, EP0CH_DAEMON: "1", EP0CH_KITTY: "0", EP0CH_SIZED: "0" }, terminal, stderr: "pipe",
    });
    const stderr = new Response(cli.stderr).text();
    try {
      await until(() => output.includes("outline"), "the attached client's screen", 10_000);
      process.kill(pid, "SIGKILL");
      expect(await cli.exited).toBe(1);
      const error = output + await stderr;
      expect(error).toContain("the session went away");
      expect(error).toContain('last received: {"t":"output","text":');
    } finally {
      if (cli.exitCode === null) { cli.kill(); await cli.exited; }
      terminal.close();
      expect(await startSession(dir, ["--screen", "desk"])).toEqual({ ok: true });
      pid = JSON.parse(readFileSync(sessionFile(dir), "utf8")).pid;
    }
  }, 30_000);

  test("attaching with --screen <name> opens that screen in the running session and says so", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 150, 44, { args: ["--screen", "library"] });
    await until(() => a.screen().includes("component library") || a.screen().includes("library ·"), "the library on the attached client", 10_000);
    expect(a.screen()).toContain("library");
    // Said once the open has finished, which can be a frame after the library is first drawn.
    await until(() => a.screen().includes("opened library"), "opened library, said", 10_000);
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
      try { await control({ cmd: "act", action: "tile.type", tile: opened.tile, args: { text: "echo leeks-$((6*7))\\n" }, as: "test-agent" }); break; }
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

  test("a burst of mouse motion, in one read or in two hundred, paints a few frames, where the pointer is now; a click after it lands after it (PIE-1300)", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 100, 30);
    await until(() => a.screen().includes("outline"), "the desk on the client", 10_000);
    // Quiet: nothing painted for a while (the clock, a clipped label scrolling) before the burst is measured.
    const quiet = async () => { for (let last = -1; last !== a.drawn.length;) { last = a.drawn.length; await Bun.sleep(400); } };
    await quiet();
    // The tree's clipped labels (a ... where a value was cut short): hovering one reveals it in place, in other colours.
    const cuts = a.text().slice(1, 12).map((line, y) => ({ y: y + 1, x: line.slice(0, 23).lastIndexOf("…") - 2 })).filter(c => c.x > 1);
    expect(cuts.length).toBeGreaterThanOrEqual(3);
    const look = (c: { x: number; y: number }) => JSON.stringify(a.mirror.cells[c.y]![c.x]);
    const plain = cuts.map(look);
    const motion = (c: { x: number; y: number }): ClientMsg => ({ t: "input", text: `\x1b[<35;${c.x + 1};${c.y + 1}M` });
    // 200 reports, one input frame each, sweeping the cuts; the last is on the second one.
    const sweep = Array.from({ length: 200 }, (_, i) => motion(cuts[i === 199 ? 1 : i % cuts.length]!));
    const click: ClientMsg = { t: "input", text: "\x1b[<0;40;10M\x1b[<0;40;10m" };
    const nextTurn = () => new Promise<void>(res => setImmediate(res));
    // The door paints at most once a frame period (App.redraw's 16 ms), so what a burst may paint is what its time holds, not a number
    // that holds on a quiet machine only (a loaded one sends two hundred reports slowly and paints more, still a few for the hundred):
    // the frames of its duration and a few for the last report and what comes after it. Unfolded, it is a paint for each report.
    const FRAME_MS = 16, allowed = (sending: number) => Math.max(10, Math.ceil(sending / FRAME_MS) + 6);
    /** The frames the daemon painted for what was sent, and when the last of them arrived. */
    const sent = async (shape: "one write" | "200 writes", ...after: ClientMsg[]) => {
      await quiet();
      const before = (await control({ cmd: "peek" })).screen.speed;
      const t0 = performance.now();
      if (shape === "one write") a.sendAll([...sweep, ...after]);
      else { for (const m of sweep) { a.send(m); await nextTurn(); } for (const m of after) a.send(m); }
      const sending = performance.now() - t0;
      await quiet();
      const speed = (await control({ cmd: "peek" })).screen.speed;
      return { sending, frames: a.drawn.filter(t => t >= t0).length, idle: Math.max(0, ...a.drawn.filter(t => t >= t0)) - t0, painted: speed.frames - before.frames, folded: speed.motionCoalesced - before.motionCoalesced,
        reports: speed.reports - before.reports, bursts: speed.settle.n - before.settle.n, worst: speed.settle.worst as number | null };
    };

    for (const shape of ["one write", "200 writes"] as const) {
      // The motion alone: a few frames, soon over, the pointer where the last report put it (that label revealed, the others not).
      let r = await sent(shape);
      expect(r.frames).toBeLessThanOrEqual(allowed(r.sending));
      expect(r.idle).toBeLessThan(500);
      expect(r.painted).toBeLessThanOrEqual(allowed(r.sending));
      // Nearly every report was folded into a newer one, however the link cut them into reads.
      expect(r.folded).toBeGreaterThanOrEqual(150);
      // The door counted every report it was handed, and measured the burst: the last report to the frame that showed it,
      // which cannot have taken longer than the whole sweep took to reach the screen (PIE-1309).
      expect(r.reports).toBeGreaterThanOrEqual(150);
      expect(r.bursts).toBeGreaterThanOrEqual(1);
      expect(r.worst).not.toBeNull();
      expect(r.worst!).toBeLessThan(Math.max(r.idle + 100, 1000));
      const now = cuts.map(look);
      expect(now[1]).not.toBe(plain[1]);
      expect(now.filter((_, i) => i !== 1)).toEqual(plain.filter((_, i) => i !== 1));
      expect((await control({ cmd: "peek" })).screen.hover.pointer).toEqual({ x: cuts[1]!.x, y: cuts[1]!.y });

      // A click right behind the motion is handled after it: the pointer is the person's again, and the click took the reader.
      a.type("1");
      for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "tree"; i++) await Bun.sleep(100);
      r = await sent(shape, click);
      expect(r.frames).toBeLessThanOrEqual(allowed(r.sending));
      expect(r.idle).toBeLessThan(500);
      expect(r.painted).toBeLessThanOrEqual(allowed(r.sending));
      expect(cuts.map(look)).toEqual(plain);
      const screen = (await control({ cmd: "peek" })).screen;
      expect(screen.person.focus).toBe("reader");
      expect(screen.hover.pointer).toBeNull();
    }
    // Anything else a read holds is one paint too, not one per frame: 60 wheel reports in one write.
    await quiet();
    const wheel: ClientMsg = { t: "input", text: "\x1b[<65;40;10M" };
    const before = (await control({ cmd: "peek" })).screen.speed.frames;
    a.sendAll(Array.from({ length: 60 }, () => wheel));
    await quiet();
    expect((await control({ cmd: "peek" })).screen.speed.frames - before).toBeLessThanOrEqual(5);

    a.close();
  }, 60_000);

  // PIE-1163, over the real socket: the client's terminal answers CSI 5 n after each frame, and this one has stopped.
  test("a client whose terminal stopped answering is sent no more than the frames in flight of a long burst, and the latest when it answers", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 120, 40, { acks: true }), b = await RawClient.attach(sessionSocket(dir), 120, 40);
    await until(() => a.screen().includes("outline") && b.screen().includes("outline"), "both clients drawn", 10_000);
    const framesToA = () => a.got.filter(m => m.t === "output" && m.text.includes("\x1b[?2026l")).length;
    for (let i = 0; i < 31; i++) { b.type("\t"); await Bun.sleep(25); }
    await until(() => (a.text()[39] ?? "").length > 0, "the burst handled", 10_000);
    await Bun.sleep(300);
    expect(framesToA()).toBeLessThanOrEqual(FRAMES_IN_FLIGHT);
    expect(a.screen()).not.toBe(b.screen());                   // it was left where it was; b has moved on
    for (let i = 0; i < FRAMES_IN_FLIGHT + 2; i++) { a.type("\x1b[0n"); await Bun.sleep(30); }
    await until(() => a.screen() === b.screen(), "the answered client shown the latest frame", 10_000);
    expect(framesToA()).toBeLessThanOrEqual(FRAMES_IN_FLIGHT + 2);
    const speed = (await control({ cmd: "peek" })).screen.speed.clients.slice(-2);          // ours are the last two attached
    expect(speed.map((c: any) => [c.acks, c.unacked])).toEqual([[true, 0], [false, 0]]);
    expect(speed[0].skipped).toBeGreaterThan(0);
    a.close(); b.close();
    for (let i = 0; i < 50 && (await infoOn(sessionSocket(dir)))!.clients.length; i++) await Bun.sleep(100);
  }, 60_000);

  test("a terminal tile's program copies (OSC 52): the client with the keys gets it once, a watcher never; a read, or an agent's, is dropped", async () => {
    const a = await RawClient.attach(sessionSocket(dir), 120, 40), w = await RawClient.attach(sessionSocket(dir), 120, 40, { watch: true });
    await until(() => a.screen().includes("outline") && w.screen().includes("outline"), "both clients drawn", 10_000);
    const clip = (c: RawClient) => c.got.filter(m => m.t === "output" && m.text.includes("\x1b]52;")).map(m => (m as { text: string }).text);
    const opened = await control({ cmd: "act", action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "test-agent" });
    const copying = (what: string, done: string) => `printf '\\033]52;c;?\\007'; printf '\\033]52;c;%s\\007' "$(printf '${what}' | base64)"; echo ${done}-$((6*7))`;
    // An agent typing into the shell: the copy is the program's, but the person isn't using the tile: not passed on.
    for (let i = 0; ; i++) {
      try { await control({ cmd: "act", action: "tile.type", tile: opened.tile, args: { text: copying("Pull the bindweed", "agent") + "\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => a.screen().includes("agent-42"), "the agent's command to run", 10_000);
    await until(() => a.screen().includes("click in it, then copy again"), "the toast saying it wasn't copied", 5000);
    expect(clip(a)).toEqual([]);
    // The person clicks in the tile (they type there) and runs it themselves. First their terminal takes the session (a
    // pointer move): a click that changes the session's size only takes it (SessionTerm.key), and the tile's rect is the
    // one drawn at that size.
    a.type("\x1b[<35;1;1M");
    const holds = async () => !!(await infoOn(sessionSocket(dir)))!.clients.find(c => c.active && !c.watch && c.cols === 120 && c.rows === 40);
    for (let i = 0; i < 50 && !(await holds()); i++) await Bun.sleep(100);
    expect(await holds()).toBe(true);
    const t = (await control({ cmd: "act", action: "layout.get", as: "test-agent" })).tiles.find((x: any) => x.tile === opened.tile);
    const x = t.rect.col + 4, y = t.rect.row + 3;
    a.type(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== t.name; i++) await Bun.sleep(100);
    a.type(copying("Net the brassicas", "copied") + "\r");
    await until(() => a.screen().includes("copied-42") && clip(a).length > 0, "the copy on the client with the keys", 10_000);
    await Bun.sleep(200);
    expect(clip(a)).toEqual([`\x1b]52;c;${Buffer.from("Net the brassicas").toString("base64")}\x07`]);
    expect(clip(w)).toEqual([]);
    a.type("\x1d");                                       // ctrl+] back to the door
    await control({ cmd: "act", action: "tile.close", tile: opened.tile, as: "test-agent" }).catch(() => {});
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

  test("a session restart records a temporary run as lost", async () => {
    const b = new SocketBoard(scratch.sock);
    const a = await RawClient.attach(sessionSocket(dir), 150, 44);
    try {
      const step = await b.createBlock(null, "Wait through install [type::runbook]\nrun::\n```sh\nprintf 'WAIT\\n'; read -r line; printf 'DONE\\n'\n```");
      await control({ cmd: "act", action: "ext.runbook.run-step", args: { block: step.id }, as: "runbook-test" });
      await until(() => a.screen().includes("WAIT"), "the runbook's terminal", 10000);
      const cli = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "session", "restart", "--all"], { env: { ...process.env, EP0CH_OUTLINES: scratch.outlines }, stdout: "pipe", stderr: "pipe" });
      const [output, error, code] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited]);
      pid = JSON.parse(readFileSync(sessionFile(dir), "utf8")).pid;
      expect(code, output + error).toBe(0);
      const records = await b.children(step.id);
      expect(records.some(record => record.text.includes("[run.status::lost]"))).toBe(true);
    } finally { a.close(); b.close(); }
  }, 45000);

  test("a session restart stops its runbook program even when the record writer rejects", async () => {
    const b = new SocketBoard(scratch.sock);
    const a = await RawClient.attach(sessionSocket(dir), 150, 44);
    try {
      const pidFile = join(scratch.root, "runbook-program.pid");
      const step = await b.createBlock(null, `Wait for a refused record [type::runbook]\n\nWait here\n\`\`\`sh run\nprintf '%s' $$ > '${pidFile}'; printf 'REFUSED-WAIT\\n'; read -r line\n\`\`\``);
      await control({ cmd: "act", action: "ext.runbook.run-step", args: { block: step.id }, as: "runbook-test" });
      await until(() => existsSync(pidFile), "the runbook program's pid", 10000);
      const program = Number(readFileSync(pidFile, "utf8"));
      const previous = pid;
      await b.uninstallExtension("runbook", "keep");
      const cli = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "session", "restart", "--all"], { env: { ...process.env, EP0CH_OUTLINES: scratch.outlines }, stdout: "pipe", stderr: "pipe" });
      const [output, error, code] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited]);
      expect(code, output + error).toBe(0);
      pid = JSON.parse(readFileSync(sessionFile(dir), "utf8")).pid;
      expect(pid).not.toBe(previous);
      await until(() => { try { process.kill(program, 0); return false; } catch { return true; } }, "the runbook program stopped", 5000);
      expect(readFileSync(join(dir, "session.log"), "utf8")).toContain("Run record could not be saved");
    } finally { await b.installExtension("runbook"); a.close(); b.close(); }
  }, 45000);

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
  function stubApp(refuse: (s: { action: string; tile?: string; args: Record<string, unknown> }) => string | null = () => null, answer: (s: { action: string; tile?: string }) => unknown = () => ({})) {
    const stack: any[] = [], ran: { action: string; tile?: string; args: Record<string, unknown> }[] = [];
    const declared: Record<string, "safe" | "ask"> = { "screen.open": "safe", "screen.back": "safe", "screen.shell": "ask", open: "safe", edit: "ask" };
    const app = {
      background: [], screens: () => stack, push: (s: any) => { stack.push(s); }, flush() {}, board: {},
      dispatch: {
        list: () => ({ actions: Object.entries(declared).map(([name, replay]) => ({ name, replay })) }),
        act: async (req: { action: string; tile?: string; args: Record<string, unknown> }, as?: { kind: string; id?: string }) => {
          const no = refuse(req);
          if (no) throw new Error(no);
          ran.push({ action: req.action, ...(req.tile ? { tile: req.tile } : {}), args: req.args, ...(as && as.kind !== "user" ? { as } : {}) });
          if (req.action === "screen.open") stack.push({ title: String(req.args.name), name: req.args.name });
          if (req.action === "screen.back") stack.pop();
          return answer(req);
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
      reopen: [{ action: "open", tile: "reader", args: { id: "0a1b2c3d" }, screen: "board" }, { action: "edit", tile: "reader", screen: "board", opens: "edit" }],
    };
    const r = await restore(app, c);
    expect(app.screens()[0]).toBeInstanceOf(MainMenu);
    expect(ran.map(x => x.action)).toEqual(["screen.open", "screen.back", "screen.open", "open", "edit"]);
    expect(r).toMatchObject({ screens: 2, held: ["screen.shell"], reopened: 1, errors: [] });
  });

  test("a comment opened again sits where it sat, and the look's unsaved nudges come back as whoever made them; one whose words are gone takes its place and cursor with it (PIE-847)", async () => {
    const { app, ran } = stubApp(req => (req.action === "passage.act" && req.tile === "gone" ? "no passage “the old gate” in the note now"
      : req.action === "comment.move" && req.tile === "narrow" ? "the comment is split, not floating" : null),
      req => (req.action === "passage.act" ? { restored: req.tile !== "blank" } : {}));
    const comment = (tile: string) => [
      { action: "open", tile, args: { id: "0a1b2c3d" } },
      { action: "passage.act", tile, args: { action: "comment", quote: "Beans, chard", near: 15 }, opens: "comment" as const, words: true },
      { action: "comment.place", tile, args: { place: "floating" } },
      { action: "comment.move", tile, args: { row: 9, col: 12, cols: 50, rows: 8 } },
      { action: "draft.place", tile, args: { line: 2, col: 4 } },
    ];
    const fern = { kind: "agent" as const, id: "fern" };
    const r = await restore(app, {
      v: 2, at: 0, menu: true, screens: [],
      reopen: [
        ...comment("gone"), ...comment("reader"), ...comment("narrow"), ...comment("blank"),
        { action: "look.nudge", args: { target: "screen:desk", field: "measure", value: "120" }, as: fern },
        // The keys were on the reader whose words are gone: they go back there all the same.
        { action: "tile.focus", tile: "gone" },
      ],
    });
    expect(ran.filter(x => x.tile === "gone").map(x => x.action)).toEqual(["open", "tile.focus"]);
    expect(ran.filter(x => x.tile === "reader").map(x => x.action)).toEqual(comment("reader").map(x => x.action));
    expect(ran.filter(x => x.tile === "narrow").map(x => x.action)).toEqual(["open", "passage.act", "comment.place"]);
    expect(ran.find(x => x.action === "look.nudge")).toMatchObject({ as: fern });
    expect(ran.at(-1)).toMatchObject({ action: "tile.focus", tile: "gone" });
    expect(r.errors).toEqual(["passage.act in gone: no passage “the old gate” in the note now", "comment.move in narrow: the comment is split, not floating", "passage.act in blank: its words weren't brought back"]);
    // As it sat, back with its words but not its place, opened without its words: each said apart.
    const said = restoredSaying(r, "upgrade", 0);
    expect(said).toContain("your comment is as you left it");
    expect(said).toContain("your comment is back with its words, not where it sat");
    expect(said).toContain("a comment opened without its words");
  });

  test("look.nudge puts a nudge back in memory, unsaved, as whoever made it; a field or value the look doesn't have is refused", async () => {
    const ctx = { board: {}, redraw() {} } as any;
    const fern = { kind: "agent" as const, id: "fern" };
    await SHELL_ACTIONS.run("look.nudge", { target: "screen:desk", field: "measure", value: "120" }, { ctx }, fern);
    expect(tuningOf(ctx.board).unsaved()).toEqual([{ target: "screen:desk", fields: [["measure", "120"]] }]);
    expect(tuningOf(ctx.board).get("screen:desk" as any, "measure" as any)?.by).toEqual(fern);
    expect(() => SHELL_ACTIONS.run("look.nudge", { target: "screen:desk", field: "girth", value: "3" }, { ctx }, USER)).toThrow(/look token/);
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
    const hello: Hello = { proto: PROTOCOL, remote: false, cols, rows, cellW: 9, cellH: 16, kitty: false, pid: 4242 };
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

  test("YOLO survives a handover, but ends with the door (PIE-980)", async () => {
    const board = new SocketBoard(hostSock);
    await board.info();
    let client = await HandoffClient.attach(sessionSocket(dir), 200, 40);
    const yolo = async () => (await control({ cmd: "peek" })).screen.person.yolo === true;
    const turnOn = async () => {
      await until(() => client.screen().includes("outline"), "the desk", 10_000);
      client.type("\x0b");
      client.type("> agents.yolo on=true");
      client.type("\r");
      for (let i = 0; i < 100 && !(await board.mcpAccessStatus()).yolo; i++) await Bun.sleep(50);
      expect((await board.mcpAccessStatus()).yolo).toBe(true);
      expect(await yolo()).toBe(true);
    };
    try {
      await turnOn();
      expect(await request({ t: "upgrade" })).toMatchObject({ message: "handed over" });
      await until(() => client.closed, "the old daemon to let go", 5000);
      client = await HandoffClient.attach(sessionSocket(dir), 200, 40);
      expect(await yolo()).toBe(true);
      expect((await board.mcpAccessStatus()).yolo).toBe(true);
      await until(() => client.screen().includes("YOLO kept across the update"), "the YOLO handover notice", 5000);

      for (const how of ["end", "crash"] as const) {
        if (how === "crash") await turnOn();
        if (how === "end") await request({ t: "end", force: true });
        else process.kill(daemonPid(), "SIGKILL");
        await until(() => client.closed, "the door to end", 5000);
        for (let i = 0; i < 100 && (await board.mcpAccessStatus()).yolo; i++) await Bun.sleep(50);
        expect((await board.mcpAccessStatus()).yolo === true).toBe(false);
        expect(await startSession(dir, ["--screen", "desk"])).toEqual({ ok: true });
        client = await HandoffClient.attach(sessionSocket(dir), 200, 40);
        expect(await yolo()).toBe(false);
        expect((await board.mcpAccessStatus()).yolo === true).toBe(false);
      }
    } finally { client.close(); board.close(); }
  }, 60_000);

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
    expect((await control({ cmd: "act", action: "layout.get", as: "test-agent" })).zoom).toBe("reader");

    const hand = async (c: HandoffClient) => {
      expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
      await until(() => c.closed, "the old daemon to let the terminal go", 5000);
      const n = await HandoffClient.attach(sessionSocket(dir), 140, 40);
      await until(() => n.screen().includes("handed over to a new daemon"), "the handoff said", 10_000);
      return n;
    };
    const b1 = await hand(a);
    await until(() => b1.screen().includes("Tines up"), "the rake after the handoff", 10_000);
    expect(await control({ cmd: "act", action: "layout.get", as: "test-agent" })).toMatchObject({ zoom: "reader", focus: "reader" });
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
      try { await control({ cmd: "act", action: "tile.type", tile: opened.tile, args: { text: "echo chard-$((6*7))\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => a.screen().includes("chard-42"), "the shell's output", 10_000);
    await control({ cmd: "act", action: "open", args: { id: plot }, as: "test-agent" });
    await until(() => a.screen().includes("Beans, chard"), "the note in the reader", 10_000);
    a.type("2");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "reader"; i++) await Bun.sleep(100);
    a.type("e");
    await until(() => a.screen().includes("ctrl+s"), "the edit open", 10_000);
    a.type("\x05");
    a.type(" and kale");
    await until(() => a.screen().includes("and kale"), "the typed text", 10_000);
    a.type("\x01");
    const draft = async () => ((await control({ cmd: "peek" })).screen.state.readers as any[]).find(p => p?.editing)?.editing;
    for (let i = 0; i < 50 && (await draft())?.cursor.col !== 1; i++) await Bun.sleep(100);
    const cursor = (await draft()).cursor;
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
    expect((await draft()).cursor).toEqual(cursor);
    const board = new SocketBoard(hostSock);
    await board.info();
    const textIs = async (text: string) => {
      for (let i = 0; i < 100; i++) {
        if ((await board.readDraft(plot)).text === text) break;
        await Bun.sleep(50);
      }
      expect((await board.readDraft(plot)).text).toBe(text);
    };
    try {
      // The handover invites e to carry on; it must not become draft text.
      b.type("e");
      b.type("X");
      await textIs("XSeed swap list and kale\nBeans, chard");
      b.type("\x1a");
      await textIs("Seed swap list and kale\nBeans, chard");
      b.type("\x1a");
      await textIs("Seed swap list and \nBeans, chard");
      b.type("\x19");
      await textIs("Seed swap list and kale\nBeans, chard");
      b.type("\x1b[D"); b.type("\x1b[D"); b.type("X");
      await textIs("Seed swap list and kaXle\nBeans, chard");
    } finally { board.close(); }
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

  test("a comment being written comes back after a handover as it was: its text, floating where it was moved, its size and cursor (PIE-847)", async () => {
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("chard-42"), "the desk", 10_000);
    const commenting = async () => ((await control({ cmd: "peek" })).screen.state.panes as any[]).find(p => p?.commenting)?.commenting;
    // The edit the restart test brought back is saved first: a reader holds an edit or a comment, not both.
    a.type("\x13");
    for (let i = 0; i < 50 && JSON.stringify((await control({ cmd: "peek" })).screen.state).includes(`"place":"edit:`); i++) await Bun.sleep(100);
    a.type("2");
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.person.focus !== "reader"; i++) await Bun.sleep(100);
    // C with nothing selected writes on the whole note (PIE-846); ctrl+o floats it, ctrl+g and the arrows move it.
    a.type("C");
    for (let i = 0; i < 50 && (await commenting())?.mode !== "compose"; i++) await Bun.sleep(100);
    a.type("onions by the gate"); a.type("\r"); a.type("and a sign for the leeks");
    a.type("\x0f");
    for (let i = 0; i < 50 && (await commenting())?.place !== "floating"; i++) await Bun.sleep(100);
    a.type("\x07");
    a.type("\x1b[C"); a.type("\x1b[C"); a.type("\x1b[B");
    a.type("\r");
    a.type("\x1b[A");
    await until(() => a.screen().includes("onions by the gate"), "the comment written", 10_000);
    for (let i = 0; i < 50 && !(await commenting())?.float; i++) await Bun.sleep(100);
    const before = await commenting();
    expect(before).toMatchObject({ mode: "compose", place: "floating", dirty: true, cursor: { line: 1 } });
    expect(before.float).toBeTruthy();

    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => a.closed, "the old daemon to let the terminal go", 5000);
    const b = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    // Status chips can clip the sentence; the composer assertions below prove what was restored.
    await until(() => b.screen().includes("handed over to a new daemon"), "the handover said", 15_000);
    await until(() => b.screen().includes("onions by the gate") && b.screen().includes("and a sign for the leeks"), "the comment's text", 10_000);
    const after = await commenting();
    expect(after).toMatchObject({ mode: "compose", place: "floating", dirty: true, float: before.float, cursor: before.cursor, whole: true });
    const continued = "onions by the gate".slice(0, before.cursor.col - 1) + "X" + "onions by the gate".slice(before.cursor.col - 1);
    b.type("X");
    await until(() => b.screen().includes(continued), "the next key in the restored composer");
    b.type("\x1a");
    await until(() => !b.screen().includes(continued), "undoing the next comment key");
    b.type("\x1a");
    await until(() => !b.screen().includes("leeks"), "undoing comment typing from before handover");
    b.type("\x19");
    await until(() => b.screen().includes("leeks"), "redoing the comment typing");
    // Put aside (esc twice), so the tests after this one find the reader reading.
    b.type("\x1b"); b.type("\x1b");
    for (let i = 0; i < 50 && (await commenting()); i++) await Bun.sleep(100);
    b.close();
  }, 60_000);

  test("a desk kept in the background comes back with its program: D on the menu shows it, the same process", async () => {
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("chard-42"), "the desk", 10_000);
    // The edit the test before brought back stays open until it's saved or closed (PIE-812): ctrl+s saves it first.
    a.type("\x13");
    for (let i = 0; i < 50 && JSON.stringify((await control({ cmd: "peek" })).screen.state).includes(`"place":"edit:`); i++) await Bun.sleep(100);
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
    await until(() => c.screen().includes("came back"), "the restore said", 5000);
    c.close();
  }, 60_000);

  // Last but one: the drawer's own program is a second `sh` in the daemon, which the tests above count their shell among.
  // PIE-1286 (Evan's pie door, Oct 25): after the session's handovers, `tile.info tile=drawer.agent` said "closed" while the
  // drawer's program ran. The program is the tile with role agent, kept with its tile through a handover; both of Evan's
  // buttons name it that way (`agent.lift`, `tile.zoom tile=role:agent reach=column`).
  test("the drawer's own program through a handover: role:agent and drawer.agent still name the running program, and both lift it", async () => {
    const a = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => a.screen().includes("outline"), "the desk", 10_000);
    const info = (tile: string) => control({ cmd: "act", action: "tile.info", tile, as: "test-agent" });
    const running = async (tile: string) => {
      for (let i = 0; i < 100; i++) {
        try { const r = await info(tile); if (r.terminal?.running) return r; } catch { /* not there yet */ }
        await Bun.sleep(100);
      }
      return info(tile);
    };
    a.type("\x1ba");                                        // alt+a: the drawer comes up and starts its program
    const before = await running("role:agent");
    expect(before.terminal.running).toBe(true);
    expect((await info("drawer.agent")).tile).toBe(before.tile);
    a.type("\x1d");                                         // ctrl+]: the keys back to the screen
    for (let i = 0; i < 50 && (await control({ cmd: "peek" })).screen.drawer?.entered; i++) await Bun.sleep(100);

    const hand = async (c: HandoffClient) => {
      expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
      await until(() => c.closed, "the old daemon to let the terminal go", 5000);
      return HandoffClient.attach(sessionSocket(dir), 140, 40);
    };
    let at = await hand(a);
    for (let handover = 1; handover <= 2; handover++) {
      await until(() => at.screen().includes("outline"), `the desk after handover ${handover}`, 10_000);
      const after = await running("role:agent");
      expect([handover, after.terminal.pid, after.tile]).toEqual([handover, before.terminal.pid, before.tile]);   // the same program, the same tile
      expect((await info("drawer.agent")).tile).toBe(before.tile);
      // Evan's two buttons: the preset, and tile.zoom by role. Each lifts, and drops.
      for (const lift of [{ action: "agent.lift", args: {} }, { action: "tile.zoom", tile: "role:agent", args: { reach: "column" } }]) {
        const up = await control({ cmd: "act", ...lift, as: "test-agent" });
        expect([handover, lift.action, up.zoomed]).toEqual([handover, lift.action, true]);
        const down = await control({ cmd: "act", ...lift, as: "test-agent" });
        expect([handover, lift.action, down.zoomed]).toEqual([handover, lift.action, false]);
      }
      if (handover === 1) at = await hand(at);
    }
    // The program out on the desk, through a handover: the terminal host adopts it by its key, the tile comes back with its role.
    const out = await control({ cmd: "act", action: "tile.drawer", tile: "role:agent", args: { on: false }, as: "test-agent" });
    const away = await running("role:agent");
    expect([away.terminal.pid, away.name]).toEqual([before.terminal.pid, out.name]);
    at = await hand(at);
    await until(() => at.screen().includes("outline"), "the desk after the handover with the program out", 10_000);
    const gone = await running("role:agent");
    expect([gone.terminal.pid, gone.tile]).toEqual([before.terminal.pid, away.tile]);              // the same program, the same tile, out on the desk
    expect((await control({ cmd: "act", action: "agent.lift", as: "test-agent" })).zoomed).toBe(true);
    expect((await control({ cmd: "act", action: "tile.zoom", tile: "role:agent", args: { reach: "column" }, as: "test-agent" })).zoomed).toBe(false);
    at.close();
  }, 120_000);

  // PIE-1330 (Evan's pie door, Oct 26, 05:51–05:56): the drawer's agent gathered into a group, then a handover: the group's
  // tab drew "drawer.own isn't available here", the program was never reattached, `kept` went on listing it after it died,
  // and the next agent started in the drawer ended it. Every drawer agent is a terminal tab with role agent (PIE-1331): in a
  // group, on the desk or in the drawer, it comes back running in its group after a handover, the same program.
  test("the drawer's agent in a group through a handover, in the drawer and on the desk: the same program comes back running in its group; nothing is left kept (PIE-1330)", async () => {
    const info = (tile: string) => control({ cmd: "act", action: "tile.info", tile, as: "test-agent" });
    const running = async (tile: string) => {
      for (let i = 0; i < 100; i++) {
        try { const r = await info(tile); if (r.terminal?.running) return r; } catch { /* not there yet */ }
        await Bun.sleep(100);
      }
      return info(tile);
    };
    const hand = async (c: HandoffClient) => {
      expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
      await until(() => c.closed, "the old daemon to let the terminal go", 5000);
      const n = await HandoffClient.attach(sessionSocket(dir), 140, 40);
      await until(() => n.screen().includes("handed over to a new"), "the handover said", 10_000);
      return n;
    };
    const kept = async () => (await infoOn(sessionSocket(dir)))!.kept ?? [];
    let at = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => at.screen().includes("outline"), "the desk", 10_000);
    // The test before left the drawer's agent out on the desk, a terminal tile with role agent.
    const before = await running("role:agent");
    expect(before.terminal.running).toBe(true);
    // On the desk: gathered into a group, handed over.
    const bench = await control({ cmd: "act", action: "tile.group", tile: "role:agent", args: { name: "bench" }, as: "test-agent" });
    expect(bench.grouped).toEqual([before.name]);
    at = await hand(at);
    let back = await running("role:agent");
    expect([back.terminal.running, back.terminal.pid]).toEqual([true, before.terminal.pid]);
    expect(at.screen()).not.toContain("isn't available here");
    expect(await kept()).toEqual([]);
    // Back into the drawer, beside a shell, both gathered into a group there (Evan's group3), handed over.
    await control({ cmd: "act", action: "tile.group", tile: "bench", args: { on: false }, as: "test-agent" });
    await control({ cmd: "act", action: "tile.drawer", tile: "role:agent", args: {}, as: "test-agent" });
    const shell = await control({ cmd: "act", action: "host.shell", as: "test-agent" });
    const group3 = await control({ cmd: "act", action: "tile.group", tile: "role:agent@drawer", args: { with: shell.name, name: "group3" }, as: "test-agent" });
    expect(group3.grouped).toEqual([before.name, shell.name]);
    at = await hand(at);
    back = await running("role:agent");
    expect([back.terminal.running, back.terminal.pid]).toEqual([true, before.terminal.pid]);
    expect((await control({ cmd: "peek" })).text.join("\n")).not.toContain("isn't available here");
    expect(await kept()).toEqual([]);
    // A new agent tab started in the drawer then (05:54:35) ends nothing: the one in group3 runs on.
    await control({ cmd: "act", action: "host.agent", args: { name: "shell" }, as: "test-agent" }).catch(() => null);
    await Bun.sleep(300);
    expect((await info(back.tile)).terminal).toMatchObject({ running: true, pid: before.terminal.pid });
    at.close();
  }, 120_000);

  // PIE-1342 (Evan's pie door, Oct 26 ~7:45): after a handover with the drawer put away, `tile.info tile=role:agent` said
  // "no agent tab is open" while drawer-tiles.json held the agent tab and its program waited in the terminal host, so a
  // lift before alt+a would have started a second agent. The drawer's saved tabs are known from the first ask.
  test("the drawer put away through a handover: role:agent names the kept agent before the drawer is drawn, and agent.lift lifts that program; no second starts (PIE-1342)", async () => {
    const info = (tile: string) => control({ cmd: "act", action: "tile.info", tile, as: "test-agent" });
    const pids = async () => { const s = (await infoOn(sessionSocket(dir)))!; return [...(s.kept ?? []), ...s.terminals].map(t => t.pid).sort(); };
    let at = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => at.screen().includes("outline"), "the desk", 10_000);
    // The tests before left two agent tabs in the drawer: one in group3, and the one PIE-1330's last step opened, used last,
    // which role:agent names. It is a tab behind group3, as Evan's claude was behind what-changed.
    const before = await info("role:agent");
    expect([before.shown, before.tabShown]).toEqual([false, "group3"]);
    expect(before.terminal.running).toBe(true);
    await control({ cmd: "act", action: "host.toggle", args: { open: false }, as: "test-agent" });
    expect((await control({ cmd: "peek" })).screen.drawer?.shown ?? false).toBe(false);
    expect(await request({ t: "upgrade" })).toMatchObject({ t: "ask", message: "handed over" });
    await until(() => at.closed, "the old daemon to let the terminal go", 5000);
    at = await HandoffClient.attach(sessionSocket(dir), 140, 40);
    await until(() => at.screen().includes("handed over to a new"), "the handover said", 10_000);
    const programs = await pids();
    expect(programs).toContain(before.terminal.pid);
    // Asked before anything draws the drawer: the same tile, its program reattached.
    const named = await info("role:agent");
    expect([named.tile, named.terminal?.pid]).toEqual([before.tile, before.terminal.pid]);
    const up = await control({ cmd: "act", action: "agent.lift", as: "test-agent" });
    expect([up.zoomed, up.tile]).toEqual([true, before.tile]);
    expect((await info("role:agent")).terminal).toMatchObject({ running: true, pid: before.terminal.pid });
    expect((await control({ cmd: "peek" })).screen.drawer?.shown ?? false).toBe(false);        // the drawer stays put away (PIE-1336)
    expect(await pids()).toEqual(programs);                                                     // no second agent started
    expect((await control({ cmd: "act", action: "agent.lift", as: "test-agent" })).zoomed).toBe(false);
    at.close();
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

  test("an explicit control socket opens another outline's note in its door and refuses an outline the host lacks", async () => {
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
    expect(result).toMatchObject({ opened: true, id: gardenNote });
    const layout = await control(orchard.dir, { cmd: "act", action: "layout.get", as: "test-agent" });
    expect(layout.tiles.some((tile: any) => tile.showing?.id === gardenNote)).toBe(true);
    expect((await control(orchard.dir, { cmd: "peek" })).text.join("\n")).toContain("Mint bed");

    const missing = formatEp0chBlockUri({ outline: "absent-garden", machine: canonicalLocalMachineName(), blockId: gardenNote });
    const refused = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "open", missing, "--json"], {
      cwd: none,
      env: { ...(process.env as Record<string, string>), EP0CH_CONTROL: join(orchard.dir, "door.sock") },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const refusal = JSON.parse(await new Response(refused.stdout).text());
    expect(await refused.exited).toBe(0);
    expect(refusal).toMatchObject({ opened: false, reason: expect.stringContaining("absent-garden") });
    expect(existsSync(join(host.root, "outlines", "absent-garden.sqlite"))).toBe(false);
    const after = await control(orchard.dir, { cmd: "act", action: "layout.get", as: "test-agent" });
    expect(after.tiles.some((tile: any) => tile.showing?.id === gardenNote)).toBe(true);
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
