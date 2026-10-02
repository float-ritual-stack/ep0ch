// The door session (PIE-418): a door that keeps running without a terminal, and the terminals that attach to it.
// - the protocol's frames, whole however they arrive;
// - two clients on one session: the keys where the person last typed, each painted at its own size and video mode,
//   a click aimed at another size's frame only taking the session, a watcher never the keys, the terminal handed
//   over to the client with the keys, logging off detaching only that client;
// - a real session on a scratch service: attach, open a terminal tile, detach, attach again and find the tile's
//   program still running with its scrollback, an unsaved draft and the layout; two clients consistent; an agent
//   acting through the control socket; `end` asking while programs run, then ending.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { App } from "../src/app";
import { Mirror } from "../src/mirror";
import { SocketBoard } from "../src/socket";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type Hello } from "../src/session/protocol";
import { SessionTerm, type Link } from "../src/session/session-term";
import { sessionInfo, startSession } from "../src/session/client";
import { sessionFile, sessionSocket } from "../src/session/daemon";
import { controlSocket } from "../src/control";
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
    const app = new App(term, { supports: () => null, capabilities: null } as any, Date.now(), () => {});
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
    term.input(cw, "q");
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
    await control({ cmd: "act", action: "tile.type", tile: opened.id, args: { text: "echo leeks-$((6*7))\\n" }, as: "test-agent" });
    await until(() => a.screen().includes("leeks-42"), "the tile's output on the client", 10_000);
    await control({ cmd: "act", action: "open", args: { id: plot }, as: "test-agent" });
    await until(() => a.screen().includes("Water the leeks before noon"), "the note in the reader", 10_000);
    // The person, on this client: the reader (2), edit (e), type, and leave it unsaved.
    a.type("2"); await Bun.sleep(200);
    a.type("e"); await Bun.sleep(400);
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
    await until(() => true, "");
  }, 30_000);

  test("ending asks while programs run in its tiles, then ends: every client told, the files gone", async () => {
    const a = await RawClient.attach(sessionSocket(), 100, 30);
    const asker = await RawClient.attach(sessionSocket(), 80, 24, { watch: true });
    asker.send({ t: "end" });
    await until(() => asker.got.some(m => m.t === "ask"), "the question", 5000);
    expect((asker.got.find(m => m.t === "ask") as any).message).toMatch(/running in the session's terminal tiles/);
    asker.send({ t: "end", force: true });
    await until(() => a.closed, "the session to end", 15_000);
    expect(a.got.at(-1)).toMatchObject({ t: "bye", reason: "ended" });
    await until(() => !existsSync(sessionSocket()) && !existsSync(sessionFile()), "the session's files to go", 5000);
    pid = 0;
  }, 30_000);
});
