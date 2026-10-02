// The door session (PIE-418): one door that keeps running without a terminal, and the terminals that attach to it.
// It holds what the door holds (the screens and their layouts, the dispatcher, draft sessions, terminal tiles with
// their programs and scrollback, the service connection and its change feed); a client (src/session/client.ts) only
// shows what it's sent and sends what its terminal types. Quitting a client (Goodbye, ctrl+c, closing the terminal,
// a dropped ssh connection) detaches it; the session ends only when asked (`session.end`, E on the main menu,
// `ep0ch session end`).
//
// One per user and state dir (EP0CH_STATE): its socket is `session.sock` there, mode 0600 in the 0700 state dir,
// beside the control socket agents use (door.sock), which the session serves as the door always has. A test door on
// its own state dir has its own session and never reaches the person's.
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync, writeSync, chmodSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join, resolve } from "node:path";
import type { App } from "../app";
import { openDoor, connectTarget, type Door } from "../door";
import { livePrograms } from "../desk/pty";
import { nestLayers } from "../nest";
import { Offline } from "../socket";
import { alive, privateDir, stateDir, writeLastCall } from "../state";
import { serveAs, SessionTerm, type Link, type SessionClient } from "./session-term";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type SessionInfo } from "./protocol";

/** The session's socket, file (who it is), lock and log: all in the state dir. */
export const sessionSocket = () => join(stateDir(), "session.sock");
export const sessionFile = () => join(stateDir(), "session.json");
const sessionLock = () => join(stateDir(), "session.lock");
export const sessionLog = () => join(stateDir(), "session.log");

/** The checkout this code runs from, and its commit (an upgrade compares them). */
export function codeVersion(dir = resolve(import.meta.dir, "../..")): { dir: string; commit: string | null } {
  try {
    const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    return { dir, commit: r.exitCode === 0 ? r.stdout.toString().trim() : null };
  } catch { return { dir, commit: null }; }
}

/** Is a session listening on `path`? */
export const listening = (path: string, ms = 2000) => new Promise<boolean>(res => {
  if (!existsSync(path)) return res(false);
  const c = connect(path, () => { c.end(); res(true); });
  const t = setTimeout(() => { c.destroy(); res(false); }, ms);
  c.on("error", () => { clearTimeout(t); res(false); });
  c.on("close", () => clearTimeout(t));
});

/**
 * Hold the state dir's session lock: true when this process now has it. A lock left by a session that died (kill -9)
 * is taken over; one held by a live process is not.
 */
export function takeLock(path = sessionLock()): boolean {
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid)); closeSync(fd);
      process.on("exit", () => { try { if (readFileSync(path, "utf8") === String(process.pid)) rmSync(path, { force: true }); } catch { /* gone */ } });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return false;
      const pid = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) return false;
      rmSync(path, { force: true });
    }
  }
  return false;
}

/**
 * The starter waits on fd 3 for one line: `{"ok":true}` once the session serves, or what went wrong. A daemon started
 * any other way (`ep0ch session serve` by hand) has no fd 3 and says nothing.
 */
function ready(m: { ok: true; socket: string } | { ok: false; error: string }) {
  if (process.env.EP0CH_SESSION_READY !== "3") return;
  try { writeSync(3, JSON.stringify(m) + "\n"); closeSync(3); } catch { /* the starter went */ }
  delete process.env.EP0CH_SESSION_READY;
}

/** Run the session: open the door on a SessionTerm, serve the session socket. Never returns. */
export async function serve(args: string[]): Promise<never> {
  const dir = privateDir(stateDir(), true);
  if (!dir) { ready({ ok: false, error: `${stateDir()} isn't yours alone (it needs mode 700): no session` }); process.exit(1); }
  if (!takeLock()) { ready({ ok: false, error: `a session is already running or starting on ${stateDir()}` }); process.exit(1); }
  const opened = await connectTarget(args);
  if ("error" in opened) { ready({ ok: false, error: opened.error }); console.error(`ep0ch session: ${opened.error}`); process.exit(1); }

  const term = new SessionTerm();
  serveAs(term);
  const started = Date.now();
  const code = codeVersion();
  const sockets = new Set<Socket>();
  let door: Door | null = null;
  let server: Server | null = null;
  let ending: { code: number; crash?: unknown } | null = null;
  const path = sessionSocket();

  const info = (): SessionInfo => ({
    pid: process.pid, started, proto: PROTOCOL, code, state: stateDir(), socket: path, control: door?.control?.path ?? null,
    outline: { host: opened.service.host, workspace: opened.service.workspace, ...(opened.service.outline ? { outline: opened.service.outline } : {}), socket: opened.board.path },
    screen: door?.app.screens().at(-1)?.title ?? null,
    clients: term.list(),
    terminals: livePrograms().map(p => ({ tile: p.tileName ?? p.run.label ?? p.title(), cmd: p.run.cmd.join(" "), ...(p.pid ? { pid: p.pid } : {}) })),
  });
  const writeInfo = () => { if (ending) return; try { writeFileSync(sessionFile(), JSON.stringify(info(), null, 1), { mode: 0o600 }); } catch { /* not fatal */ } };
  term.onClients = writeInfo;
  // Logging off (Goodbye, ctrl+c) detaches the client with the person's keys: the session says so and goes on.
  term.onLogoff = c => { writeLastCall(Date.now()); c.link.close({ t: "bye", reason: "detached", message: detachedSaying() }); };

  /** The session is over (App.quit): every client told why, then everything closed. */
  const finish = (app: App) => {
    ending ??= { code: 0 };
    const kept = app.keptOnExit.length ? `\nunsaved text was copied to:\n  ${app.keptOnExit.join("\n  ")}` : "";
    const crash = ending?.crash !== undefined ? `\nthe session crashed:\n${ending.crash instanceof Error ? ending.crash.stack ?? ending.crash.message : String(ending.crash)}` : "";
    for (const c of term.all()) c.link.close({ t: "bye", reason: "ended", message: `the session ended${kept}${crash}`, code: crash ? 1 : 0 });
    if (crash) console.error(crash.trim());
    door?.control?.close();
    opened.board.close();
    server?.close();
    try { unlinkSync(path); } catch { /* gone */ }
    rmSync(sessionFile(), { force: true });
    // The byes go out before the process does (a client that stopped reading isn't waited for long).
    const left = [...sockets].filter(s => !s.destroyed);
    Promise.race([Promise.all(left.map(s => new Promise(r => s.once("close", r)))), Bun.sleep(1000)]).finally(() => process.exit(ending?.code ?? 0));
  };

  const end = (exit: number, crash?: unknown) => {
    if (ending || !door) { if (crash !== undefined) console.error(crash); process.exit(ending?.code ?? exit); }
    ending = { code: exit, ...(crash !== undefined ? { crash } : {}) };
    door.app.terminate();
  };
  // Nobody's terminal is the daemon's: a signal ends the session (drafts kept), as `session end` does.
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => end(0));
  process.on("uncaughtException", e => (e instanceof Offline && door && !ending ? door.app.flash(e.message) : end(1, e)));
  process.on("unhandledRejection", e => (e instanceof Offline && door && !ending ? door.app.flash(e.message) : end(1, e)));

  door = await openDoor({ term, mirror: term.mirror, info: () => term.info, board: opened.board, service: opened.service, args, ...(opened.notice ? { notice: opened.notice } : {}), done: finish });
  const app = door.app;

  server = createServer(sock => {
    sockets.add(sock);
    const frames = new Frames<ClientMsg>();
    let client: SessionClient | null = null;
    const link: Link = {
      send: m => { if (!sock.destroyed) sock.write(encode(m)); },
      backlog: () => sock.writableLength,
      onDrain: f => { sock.on("drain", f); },
      close: bye => { if (sock.destroyed) return; if (bye) sock.end(encode(bye)); else sock.end(); },
    };
    const gone = () => { sockets.delete(sock); if (client) { const c = client; client = null; term.detach(c); app.redraw(); } };
    sock.on("close", gone);
    sock.on("error", () => sock.destroy());
    sock.on("data", (chunk: Buffer) => {
      let msgs: ClientMsg[];
      try { msgs = frames.push(chunk); } catch (e) { link.close({ t: "bye", reason: "refused", message: (e as Error).message, code: 2 }); return; }
      for (const m of msgs) {
        try { handle(m); } catch (e) { if (e instanceof Offline) app.flash(e.message); else throw e; }
      }
    });
    function handle(m: ClientMsg) {
      switch (m.t) {
        case "hello": {
          if (client) return;
          if (m.hello.proto !== PROTOCOL) {
            link.close({ t: "bye", reason: "refused", code: 2, message: `this session speaks protocol ${PROTOCOL}, the client ${m.hello.proto}: the two checkouts differ; \`ep0ch session list\` says which runs where` });
            return;
          }
          // A terminal inside one of this session's own tiles (a shell in a tile running `ep0ch`) would show the
          // session inside itself, every frame drawn into the tile that draws it.
          if (nestLayers(m.hello.nest).some(l => l.startsWith(`door:${process.pid}/`))) {
            link.close({ t: "bye", reason: "refused", code: 1, message: "this terminal is inside the session already (one of its own tiles): attaching would show the session inside itself" });
            return;
          }
          const others = term.all().filter(c => !c.watch).length;
          client = term.attach(link, m.hello);
          const ignored = screenFlags(m.hello.args ?? []);
          if (ignored.length) app.flash(`attached to the running session · ${ignored.join(" ")} not applied (the session keeps its screens)`, 8000);
          else if (others && !m.hello.watch) app.flash(`another terminal attached (${m.hello.tty ?? `pid ${m.hello.pid}`}) · the keys are wherever you last typed`, 6000);
          app.redraw();
          return;
        }
        case "query": link.send({ t: "info", info: info() }); return;
        case "end": {
          const running = livePrograms().filter(p => !p.herdr);
          if (running.length && !m.force) {
            link.send({ t: "ask", message: `${running.length} program${running.length === 1 ? " is" : "s are"} running in the session's terminal tiles (${running.map(p => p.title()).join(", ")}): ending the session stops ${running.length === 1 ? "it" : "them"}` });
            return;
          }
          end(0);
          return;
        }
      }
      if (!client) { link.close({ t: "bye", reason: "refused", code: 2, message: "say hello first" }); return; }
      switch (m.t) {
        case "input": term.input(client, m.text); return;
        case "resize": term.resize(client, m.cols, m.rows); return;
        case "ran": term.ran(client, m.id, m.code); return;
        case "detach": link.close({ t: "bye", reason: "detached", message: detachedSaying() }); return;
      }
    }
  });
  try {
    if (existsSync(path)) { if (await listening(path)) throw new Error(`a session already serves on ${path}`); unlinkSync(path); }
    await new Promise<void>((res, rej) => { server!.once("error", rej); server!.listen(path, () => res()); });
    chmodSync(path, 0o600);
  } catch (e) {
    ready({ ok: false, error: `can't serve the session on ${path}: ${(e as Error).message}` });
    process.exit(1);
  }
  writeInfo();
  ready({ ok: true, socket: path });
  return await new Promise<never>(() => {});
}

/** What a detached client prints once its terminal is back. */
export const detachedSaying = () => `detached · the session goes on (pid ${process.pid}) · \`ep0ch\` attaches again, \`ep0ch session end\` ends it`;

/** The door flags that open a screen: applied when a session starts, not when one is attached to. */
export function screenFlags(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (["--board", "--layout"].includes(a)) { const v = args[i + 1]; out.push(v && !v.startsWith("--") ? `${a} ${v}` : a); }
    else if (["--desk", "--river", "--brief", "--welcome", "--showcase"].includes(a)) out.push(a);
  }
  return out;
}

export type { DaemonMsg };
