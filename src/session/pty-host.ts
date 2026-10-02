// The session's terminal host (PIE-418): a small process of its own that holds the ptys of a door session's terminal
// tiles, so their programs outlive the daemon. A daemon that is upgraded (`ep0ch session upgrade`) or dies hands
// nothing over by itself: Bun can't pass a pty to another process (Bun.Terminal doesn't expose its file descriptor,
// and Bun sockets can't carry one). So the ptys never belonged to the daemon: they belong to this host, which the
// next daemon connects to. It adopts each program by its tile (`<home>:<tile id>`), replays what the program wrote
// into a fresh emulator (the last RING bytes: its screen and scrollback), and the program never notices.
//
// One host per session (state dir): `pty.sock`, mode 0600 in the 0700 state dir. One daemon at a time: a new
// connection is the daemon that took over, and the old one is let go. Ending the session ends the host and every
// program in it (`end`). With no daemon and no program left, it goes by itself.
//
// Its code changes rarely and its protocol has a version (HOST_PROTOCOL): a daemon that finds a host of another
// version can't adopt its programs, ends them and starts a host of its own (the tiles run their programs again).
import { chmodSync, closeSync, unlinkSync, writeSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { constants } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { privateDir, stateDir } from "../state";
import type { Adopted, PtyBackend, PtyMeta, PtyProc, PtyStart } from "../desk/pty-backend";
import { spawnReady } from "./start";
import { jsonLine, listening } from "../jsonl";

export const HOST_PROTOCOL = 1;
/** What the host keeps of each program's output, to replay into the next daemon's emulator. */
export const RING = 1 << 20;
export const ptyHostSocket = () => join(stateDir(), "pty.sock");
const hostLog = () => join(stateDir(), "pty-host.log");

// ── frames: one byte of type, four of id, four of length, then the payload (raw bytes, or JSON) ──────────────

/** Daemon → host: hello, spawn, write, resize, kill, forget, meta, end. Host → daemon: list, replay, ready, spawned, error, output, exit. */
type T = "h" | "s" | "w" | "z" | "k" | "f" | "m" | "q" | "l" | "r" | "y" | "p" | "e" | "o" | "x";
const RAW = new Set<T>(["w", "r", "o"]);

export function frame(t: T, id: number, body: Uint8Array | string | object = ""): Buffer {
  const payload = body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  const head = Buffer.alloc(9);
  head.write(t, 0, "latin1");
  head.writeUInt32BE(id >>> 0, 1);
  head.writeUInt32BE(payload.length, 5);
  return Buffer.concat([head, payload]);
}

export interface HostFrame { t: T; id: number; raw: Buffer; json: any }
export class HostFrames {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): HostFrame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: HostFrame[] = [];
    while (this.buf.length >= 9) {
      const len = this.buf.readUInt32BE(5);
      if (len > 64 << 20) throw new Error(`a frame of ${len} bytes is over the limit`);
      if (this.buf.length < 9 + len) break;
      const t = String.fromCharCode(this.buf[0]!) as T, id = this.buf.readUInt32BE(1);
      const raw = Buffer.from(this.buf.subarray(9, 9 + len));
      this.buf = this.buf.subarray(9 + len);
      out.push({ t, id, raw, json: RAW.has(t) || !raw.length ? null : JSON.parse(raw.toString("utf8")) });
    }
    return out;
  }
}

/** A program as the host lists it to a daemon. */
export interface HostPty { id: number; key: string | null; argv: string[]; cols: number; rows: number; meta: PtyMeta; pid?: number; exited: number | null }

// ── the host process ──────────────────────────────────────────────────────────────────────────────────────

interface Held extends HostPty { pty: InstanceType<typeof Bun.Terminal>; proc: Subprocess | null; ring: Buffer[]; bytes: number; trimmed: boolean }

/** Run the host (`ep0ch session pty-host`): serve pty.sock until the session ends. Never returns. */
export async function servePtyHost(): Promise<never> {
  const ready = (m: object) => {
    if (process.env.EP0CH_SESSION_READY !== "3") return;
    try { writeSync(3, jsonLine(m)); closeSync(3); } catch { /* the starter went */ }
    delete process.env.EP0CH_SESSION_READY;
  };
  if (!privateDir(stateDir(), true)) { ready({ ok: false, error: `${stateDir()} isn't yours alone` }); process.exit(1); }
  const path = ptyHostSocket();
  if (await listening(path)) { ready({ ok: false, error: `a terminal host already serves ${path}` }); process.exit(1); }
  try { unlinkSync(path); } catch { /* none */ }
  const held = new Map<number, Held>();
  let daemon: Socket | null = null;
  // A daemon that stops reading isn't buffered for without end: a program's output it misses is in the ring, sent
  // whole again (`r`) once it drains, so its emulator starts over from it rather than miss part of a sequence.
  const dropped = new Set<number>();
  const send = (b: Buffer, id?: number) => {
    if (!daemon || daemon.destroyed) return;
    if (id !== undefined && (dropped.has(id) || daemon.writableLength >= RING)) { dropped.add(id); return; }
    daemon.write(b);
  };
  let idle: Timer | null = null;
  /** Nobody to keep running for: no daemon and no program. */
  const checkIdle = () => {
    if (idle) { clearTimeout(idle); idle = null; }
    if (daemon || [...held.values()].some(h => h.exited === null)) return;
    idle = setTimeout(() => process.exit(0), 10_000);
  };

  const spawnOne = (id: number, s: Omit<PtyStart, "meta"> & { meta?: PtyMeta }) => {
    const h: Held = { id, key: s.key, argv: s.argv, cols: s.cols, rows: s.rows, meta: s.meta ?? {}, exited: null, proc: null, ring: [], bytes: 0, trimmed: false, pty: null as never };
    h.pty = new Bun.Terminal({
      cols: s.cols, rows: s.rows, name: "xterm-256color",
      data: (_t, d) => {
        const b = Buffer.from(d);
        h.ring.push(b); h.bytes += b.length;
        while (h.bytes > RING && h.ring.length > 1) { h.bytes -= h.ring.shift()!.length; h.trimmed = true; }
        send(frame("o", id, b), id);
      },
    });
    held.set(id, h);
    try { h.proc = Bun.spawn(s.argv, { terminal: h.pty, cwd: s.cwd, env: s.env }); }
    catch (e) { h.exited = 127; try { h.pty.close(); } catch { /* never opened */ } send(frame("e", id, { message: (e as Error).message })); return; }
    h.pid = h.proc.pid;
    send(frame("p", id, { pid: h.pid }));
    const proc = h.proc;
    void proc.exited.then(code => {
      // Killed by a signal: 128 + its number, as a shell says it.
      h.exited = code ?? 128 + (constants.signals[proc.signalCode as keyof typeof constants.signals] ?? 1);
      try { h.pty.close(); } catch { /* closed */ }
      send(frame("x", id, { code: h.exited }));
      checkIdle();
    });
  };
  const forget = (id: number) => {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    if (h.exited === null) { try { h.proc?.kill("SIGHUP"); } catch { /* gone */ } }
    try { h.pty.close(); } catch { /* closed */ }
  };
  const endAll = async () => {
    for (const h of held.values()) if (h.exited === null) { try { h.proc?.kill("SIGHUP"); } catch { /* gone */ } }
    await Promise.race([Promise.all([...held.values()].map(h => h.proc?.exited)), Bun.sleep(3000)]);
    for (const h of held.values()) if (h.exited === null) { try { h.proc?.kill("SIGKILL"); } catch { /* gone */ } }
    try { unlinkSync(path); } catch { /* gone */ }
    process.exit(0);
  };

  const server = createServer(sock => {
    const frames = new HostFrames();
    sock.on("data", (chunk: Buffer) => {
      let fs: HostFrame[];
      try { fs = frames.push(chunk); } catch { sock.destroy(); return; }
      for (const f of fs) {
        const h = held.get(f.id);
        switch (f.t) {
          case "h": {
            // The daemon is the connection that says hello (anything else is a probe: is a host here?). A new one
            // took over: the old connection is let go (its daemon is going, or gone).
            if (daemon && daemon !== sock) daemon.destroy();
            daemon = sock;
            dropped.clear();
            sock.on("drain", () => {
              for (const id of dropped) { const x = held.get(id); if (x && daemon === sock) sock.write(frame("r", id, replayOf(x))); }
              dropped.clear();
            });
            checkIdle();
            const list: HostPty[] = [...held.values()].map(({ id, key, argv, cols, rows, meta, pid, exited }) => ({ id, key, argv, cols, rows, meta, ...(pid ? { pid } : {}), exited }));
            sock.write(frame("l", 0, { proto: HOST_PROTOCOL, pid: process.pid, ptys: list }));
            for (const x of held.values()) sock.write(frame("r", x.id, replayOf(x)));
            sock.write(frame("y", 0));
            break;
          }
          case "s": if (!held.has(f.id)) spawnOne(f.id, f.json); else sock.write(frame("e", f.id, { message: `id ${f.id} is taken` })); break;
          case "w": if (h && h.exited === null) { try { h.pty.write(f.raw.toString("utf8")); } catch { /* exiting */ } } break;
          case "z": if (h) { h.cols = f.json.cols; h.rows = f.json.rows; if (h.exited === null) { try { h.pty.resize(h.cols, h.rows); } catch { /* exiting */ } } } break;
          case "k": if (h && h.exited === null) { try { h.proc?.kill(f.json?.signal ?? "SIGTERM"); } catch { /* gone */ } } break;
          case "m": if (h) h.meta = f.json ?? {}; break;
          case "f": forget(f.id); checkIdle(); break;
          case "q": void endAll(); break;
        }
      }
    });
    sock.on("close", () => { if (daemon === sock) { daemon = null; checkIdle(); } });
    sock.on("error", () => sock.destroy());
  });
  await new Promise<void>((res, rej) => { server.once("error", rej); server.listen(path, () => res()); }).catch(e => { ready({ ok: false, error: (e as Error).message }); process.exit(1); });
  chmodSync(path, 0o600);
  // Nobody's terminal is the host's; it ends only when the session does.
  for (const sig of ["SIGHUP", "SIGINT"] as const) process.on(sig, () => {});
  process.on("SIGTERM", () => void endAll());
  ready({ ok: true });
  checkIdle();
  return await new Promise<never>(() => {});
}

/**
 * What a program wrote, to replay: its ring, from the first line it kept whole once the ring has dropped its oldest
 * (never from the middle of an escape sequence or a character).
 */
function replayOf(h: Held): Buffer {
  const all = Buffer.concat(h.ring);
  if (!h.trimmed) return all;
  const nl = all.indexOf(0x0a);
  return nl >= 0 ? all.subarray(nl + 1) : all;
}

/** Start the host for this state dir, detached, and wait until it serves (it says so on fd 3). */
export const startPtyHost = (timeoutMs = 15_000) => spawnReady(["session", "pty-host"], process.env as Record<string, string>, hostLog(), "the terminal host", timeoutMs);

// ── the daemon's side: a PtyBackend over the host ──────────────────────────────────────────────────────────

interface Entry {
  id: number; key: string | null; argv: string[]; cols: number; rows: number; meta: PtyMeta; pid?: number; exited: number | null;
  /** Where its output goes once a tile has it; till then it's kept to replay. */
  live: ((d: Uint8Array) => void) | null;
  /** Where its whole output goes again, when the host had to drop some (the tile's emulator starts over). */
  resync?: ((replay: Uint8Array) => void) | null;
  pending: Buffer[];
  done: (code: number) => void;
  exitedP: Promise<number>;
  adopted: boolean;
}

/**
 * The daemon's connection to its session's terminal host: a PtyBackend whose programs live in the host. Made by
 * `connect`, which reads what the host keeps (from an earlier daemon) before any tile starts, so a tile adopts its
 * program as it is first drawn.
 */
export class HostPtys implements PtyBackend {
  readonly kind = "host" as const;
  private entries = new Map<number, Entry>();
  private nextId = 1;
  /** Said when the connection to the host is lost (it was killed): every program in it has gone. */
  onLost: (() => void) | null = null;
  private constructor(private readonly sock: Socket, readonly hostPid: number) {}

  /** Connect to the host on `path` and read what it keeps. Rejects when it doesn't answer, or speaks another protocol. */
  static connect(path = ptyHostSocket(), ms = 10_000): Promise<HostPtys> {
    return new Promise((resolve, reject) => {
      const sock = connect(path);
      const frames = new HostFrames();
      let self: HostPtys | null = null;
      let listed: HostPty[] = [];
      const t = setTimeout(() => { sock.destroy(); reject(new Error("the terminal host didn't answer")); }, ms);
      sock.on("connect", () => sock.write(frame("h", 0)));
      sock.on("error", e => { clearTimeout(t); reject(e); });
      sock.on("close", () => { clearTimeout(t); if (self) self.lost(); else reject(new Error("the terminal host went away")); });
      sock.on("data", (chunk: Buffer) => {
        let fs: HostFrame[];
        try { fs = frames.push(chunk); } catch (e) { sock.destroy(); return; }
        for (const f of fs) {
          if (f.t === "l") {
            if (f.json.proto !== HOST_PROTOCOL) {
              clearTimeout(t);
              const old = new HostPtys(sock, f.json.pid);
              for (const p of f.json.ptys ?? []) old.add(p);
              reject(Object.assign(new Error(`the terminal host speaks protocol ${f.json.proto}, this door ${HOST_PROTOCOL}`), { host: old }));
              return;
            }
            self = new HostPtys(sock, f.json.pid);
            listed = f.json.ptys;
            for (const p of listed) self.add(p);
          } else if (f.t === "y") { clearTimeout(t); resolve(self!); }
          else self?.on(f);
        }
      });
    });
  }

  private add(p: HostPty): Entry {
    let done: (code: number) => void = () => {};
    const exitedP = new Promise<number>(r => { done = r; });
    const e: Entry = { ...p, live: null, pending: [], done, exitedP, adopted: false };
    if (p.exited !== null) done(p.exited);
    this.entries.set(p.id, e);
    this.nextId = Math.max(this.nextId, p.id + 1);
    return e;
  }

  private on(f: HostFrame) {
    const e = this.entries.get(f.id);
    if (!e) return;
    switch (f.t) {
      case "r": case "o":
        // Its output again, whole, after the host dropped some (this daemon fell behind): the tile starts over from it.
        if (f.t === "r" && e.adopted && e.resync) e.resync(f.raw);
        else if (e.live) e.live(f.raw);
        else { e.pending.push(f.raw); let n = e.pending.reduce((a, b) => a + b.length, 0); while (n > RING && e.pending.length > 1) n -= e.pending.shift()!.length; }
        break;
      case "p": e.pid = f.json.pid; break;
      case "e": e.live?.(Buffer.from(`\r\ncan't start ${e.argv.join(" ")}: ${f.json.message}\r\n`)); e.exited = 127; e.done(127); break;
      case "x": e.exited = f.json.code; e.done(f.json.code); break;
    }
  }

  /** Let go of on purpose (a handoff): the programs run on in the host, so none of them is said to have ended. */
  private released = false;
  private lost() {
    if (this.released) return;
    for (const e of this.entries.values()) if (e.exited === null) { e.exited = 129; e.done(129); }
    this.onLost?.();
  }

  private procOf(e: Entry): PtyProc {
    const sock = this.sock, send = (b: Buffer) => { if (!sock.destroyed) sock.write(b); };
    return {
      get pid() { return e.pid; },
      exited: e.exitedP,
      write: d => send(frame("w", e.id, Buffer.from(d, "utf8"))),
      resize: (cols, rows) => { e.cols = cols; e.rows = rows; send(frame("z", e.id, { cols, rows })); },
      kill: sig => send(frame("k", e.id, { signal: sig ?? "SIGTERM" })),
      close: () => { this.entries.delete(e.id); send(frame("f", e.id)); },
      set onResync(f: ((replay: Uint8Array) => void) | null) { e.resync = f; },
    };
  }

  spawn(s: PtyStart, onData: (d: Uint8Array) => void): PtyProc {
    // A tile starting its program again under a key the host still keeps: the old one goes first.
    for (const e of this.entries.values()) if (s.key && e.key === s.key) this.procOf(e).close();
    const e = this.add({ id: this.nextId++, key: s.key, argv: s.argv, cols: s.cols, rows: s.rows, meta: s.meta ?? {}, exited: null });
    e.live = onData; e.adopted = true;
    if (!this.sock.destroyed) this.sock.write(frame("s", e.id, s));
    else { e.exited = 129; e.done(129); }
    return this.procOf(e);
  }

  adopt(key: string, cmd: string[], onData: (d: Uint8Array) => void): Adopted | null {
    const e = [...this.entries.values()].find(x => x.key === key && !x.adopted);
    if (!e) return null;
    // The tile runs something else now (its layout changed while no daemon ran): the kept one goes.
    if (e.meta.cmd && JSON.stringify(e.meta.cmd) !== JSON.stringify(cmd)) { this.procOf(e).close(); return null; }
    e.adopted = true;
    const replay = Buffer.concat(e.pending);
    e.pending = [];
    e.live = onData;
    return { proc: this.procOf(e), replay, cols: e.cols, rows: e.rows, argv: e.argv, meta: e.meta, exited: e.exited };
  }

  meta(key: string, meta: PtyMeta): void {
    const e = [...this.entries.values()].find(x => x.key === key && x.adopted);
    if (e) { e.meta = meta; if (!this.sock.destroyed) this.sock.write(frame("m", e.id, meta)); }
  }

  holds(key: string): boolean { return [...this.entries.values()].some(e => e.key === key && !e.adopted && e.exited === null); }

  /** Programs the host keeps that no tile has adopted (yet): `session list` says them. */
  unadopted(): HostPty[] { return [...this.entries.values()].filter(e => !e.adopted && e.exited === null).map(({ id, key, argv, cols, rows, meta, pid, exited }) => ({ id, key, argv, cols, rows, meta, ...(pid ? { pid } : {}), exited })); }

  /** End every program and the host (the session ends). */
  endAll(): void { if (!this.sock.destroyed) this.sock.end(frame("q", 0)); }
  /** Let go of the host, every program left running in it for the next daemon (a handoff). */
  release(): void { this.released = true; this.onLost = null; this.sock.destroy(); }
}

/**
 * The session's terminal host, started when there is none: connected, with what it keeps. A host of another protocol
 * is ended (its programs with it: the tiles start them again) and a new one started; `ended` says how many went.
 */
export async function ensurePtyHost(): Promise<{ host: HostPtys; ended: number }> {
  const path = ptyHostSocket();
  let ended = 0;
  if (await listening(path)) {
    try { return { host: await HostPtys.connect(path), ended }; }
    catch (e) {
      const old = (e as { host?: HostPtys }).host;
      if (!old) throw e;
      ended = old.unadopted().length;
      old.endAll();
      for (let i = 0; i < 50 && (await listening(path, 200)); i++) await Bun.sleep(100);
    }
  }
  const started = await startPtyHost();
  if (!started.ok) throw new Error(started.error);
  return { host: await HostPtys.connect(path), ended };
}
