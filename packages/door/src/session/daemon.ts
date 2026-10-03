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
import { createServer, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import type { App } from "../app";
import { openDoor, connectTarget, guardDoor, type Door } from "../door";
import { jsonLine, listening } from "../jsonl";
import { endUnkept, livePrograms } from "../desk/pty";
import { usePtyBackend } from "../desk/pty-backend";
import { ensurePtyHost, type HostPtys } from "./pty-host";
import { Checkpoints, readCheckpoint, restore, restoredSaying, type Restored } from "./restore";
import { nestLayers } from "../nest";
import { Offline, USER } from "../socket";
import { alive, privateDir, readLastCall, stateDir, unclaimState, writeLastCall } from "../state";
import { serveAs, SessionTerm, type Link, type SessionClient } from "./session-term";
import { encode, Frames, PROTOCOL, type ClientMsg, type DaemonMsg, type Hello, type SessionInfo } from "./protocol";
import { sessionFile, sessionLock, sessionSocket, startSession, waitFor } from "./start";
export { sessionFile, sessionLog, sessionSocket } from "./start";

/** The checkout this code runs from, and its commit (an upgrade compares them). */
export function codeVersion(dir = resolve(import.meta.dir, "../..")): { dir: string; commit: string | null } {
  try {
    const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    return { dir, commit: r.exitCode === 0 ? r.stdout.toString().trim() : null };
  } catch { return { dir, commit: null }; }
}

/** A process's parents, nearest first, up to init (Linux's /proc, else ps); empty when it can't be read. */
export function ancestors(pid: number): number[] {
  const out: number[] = [];
  const parentOf = (p: number): number => {
    try { const st = readFileSync(`/proc/${p}/stat`, "utf8"); return Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]); } catch { /* not Linux */ }
    try { return Number(Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(p)], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim()); } catch { return 0; }
  };
  for (let p = pid, i = 0; p > 1 && i < 64; i++) { p = parentOf(p); if (!Number.isInteger(p) || p <= 1) break; out.push(p); }
  return out;
}

/** Whose a process is: its command line (Linux's /proc, else ps), or null when it can't be read. */
function commandOf(pid: number): string | null {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "); } catch { /* not Linux */ }
  try { const r = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" }); return r.exitCode === 0 ? r.stdout.toString() : null; } catch { return null; }
}

/**
 * Hold the state dir's session lock: true when this process now has it. A lock left by a session that died (kill -9),
 * or naming a process that isn't a session (its pid reused since), is taken over; one held by a live session is not.
 * Two taking over a stale lock at once: each reads it back after a moment, and only the one it names goes on.
 */
export async function takeLock(path = sessionLock()): Promise<boolean> {
  for (let tries = 0; tries < 3; tries++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid)); closeSync(fd);
      await Bun.sleep(50);
      if (readFileSync(path, "utf8").trim() !== String(process.pid)) return false;
      process.on("exit", () => { try { if (readFileSync(path, "utf8") === String(process.pid)) rmSync(path, { force: true }); } catch { /* gone */ } });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return false;
      let pid = 0;
      try { pid = Number(readFileSync(path, "utf8").trim()); } catch { continue; }
      const theirs = Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid) && /\bsession serve\b/.test(commandOf(pid) ?? "session serve");
      if (theirs) return false;
      rmSync(path, { force: true });
    }
  }
  return false;
}

/** Run the session: open the door on a SessionTerm, serve the session socket. Never returns. */
export async function serve(args: string[]): Promise<never> {
  // The starter's readiness pipe is this process's alone: nothing it starts (a tile's program) inherits the variable.
  const readyFd = process.env.EP0CH_SESSION_READY === "3" ? 3 : null;
  delete process.env.EP0CH_SESSION_READY;
  const ready = (m: { ok: true; socket: string } | { ok: false; error: string }) => {
    if (readyFd === null) return;
    try { writeSync(readyFd, jsonLine(m)); } catch { /* the starter went */ }
    try { closeSync(readyFd); } catch { /* closed */ }
  };
  const dir = privateDir(stateDir(), true);
  if (!dir) { ready({ ok: false, error: `${stateDir()} isn't yours alone (it needs mode 700): no session` }); process.exit(1); }
  if (!(await takeLock())) { ready({ ok: false, error: `${LOCKED} on ${stateDir()}` }); process.exit(1); }
  const opened = await connectTarget(args);
  if ("error" in opened) { ready({ ok: false, error: opened.error }); console.error(`ep0ch session: ${opened.error}`); process.exit(1); }
  // How this daemon came to be: handed a session by the one before it (an upgrade), or after one that stopped.
  const handedOver = process.env.EP0CH_SESSION_RESTORE === "upgrade";
  delete process.env.EP0CH_SESSION_RESTORE;
  const checkpoint = readCheckpoint();
  // The terminal tiles' programs live in the session's terminal host, which outlives this daemon: the programs a
  // daemon before this one left there are adopted by their tiles as they're drawn.
  let host: HostPtys;
  let endedOld = 0;
  try { ({ host, ended: endedOld } = await ensurePtyHost()); }
  catch (e) { ready({ ok: false, error: `no terminal host: ${(e as Error).message}` }); process.exit(1); }
  usePtyBackend(host);
  const keptPrograms = host.unadopted().length;

  const term = new SessionTerm(checkpoint?.size);
  serveAs(term);
  const started = Date.now();
  const code = codeVersion();
  const sockets = new Set<Socket>();
  let door: Door | null = null;
  let server: Server | null = null;
  let over = false;
  /** When the person last logged on (a terminal attached with nobody else's keys): their last call, written as they leave. */
  let loggedOnAt = Date.now();
  const path = sessionSocket();

  const info = (): SessionInfo => ({
    pid: process.pid, started, proto: PROTOCOL, code, state: stateDir(), socket: path, control: door?.control?.path ?? null,
    outline: { host: opened.service.host, workspace: opened.service.workspace, ...(opened.service.outline ? { outline: opened.service.outline } : {}), socket: opened.board.path },
    screen: door?.app.screens().at(-1)?.title ?? null,
    clients: term.list(),
    terminals: livePrograms().map(p => ({ tile: p.tileName ?? p.run.label ?? p.title(), cmd: p.run.cmd.join(" "), ...(p.pid ? { pid: p.pid } : {}) })),
    kept: host.unadopted().map(p => ({ key: p.key, cmd: (p.meta.cmd ?? p.argv).join(" "), ...(p.pid ? { pid: p.pid } : {}) })),
    host: host.hostPid,
  });
  const writeInfo = () => { if (over) return; try { writeFileSync(sessionFile(), JSON.stringify(info(), null, 1), { mode: 0o600 }); } catch { /* not fatal */ } };
  term.onClients = writeInfo;
  // Logging off (Goodbye, ctrl+c) detaches the client it was done from: the session says so and goes on.
  term.onLogoff = c => { writeLastCall(loggedOnAt); c.link.close({ t: "bye", reason: "detached", message: detachedSaying() }); };

  // Nobody's terminal is the daemon's: any signal ends the session (drafts kept), as `session end --yes` does.
  const guard = guardDoor({ door: () => door, signal: () => 0, now: (exit, crash) => { if (crash !== undefined) console.error(crash); process.exit(exit); } });

  /** The session is over (App.quit): every client told why, then everything closed. */
  const finish = (app: App) => {
    over = true;
    // Ended for good: nothing to restore next time, and the programs end with it.
    checkpoints?.clear();
    host.endAll();
    const ending = guard.ending();
    writeLastCall(loggedOnAt);
    const kept = app.keptOnExit.length ? `\nunsaved text was copied to:\n  ${app.keptOnExit.join("\n  ")}` : "";
    const crash = ending?.crash !== undefined ? `\nthe session crashed:\n${ending.crash instanceof Error ? ending.crash.stack ?? ending.crash.message : String(ending.crash)}` : "";
    const clients = new Set(term.all().map(c => c.link));
    for (const c of term.all()) c.link.close({ t: "bye", reason: "ended", message: `the session ended${kept}${crash}`, code: crash ? 1 : 0 });
    if (crash) console.error(crash.trim());
    door?.control?.close();
    opened.board.close();
    server?.close();
    try { unlinkSync(path); } catch { /* gone */ }
    rmSync(sessionFile(), { force: true });
    // Connections that aren't terminals (the `session end` that asked) are closed too; the byes go out before the
    // process does (a client that stopped reading isn't waited for long).
    for (const s of sockets) if (![...clients].some(l => (l as { sock?: Socket }).sock === s)) s.end();
    const left = [...sockets].filter(s => !s.destroyed);
    Promise.race([Promise.all(left.map(s => new Promise(r => s.once("close", r)))), Bun.sleep(1000)]).finally(() => process.exit(ending?.code ?? 0));
  };

  let checkpoints: Checkpoints | null = null;
  let restored: Restored | null = null;
  door = await openDoor({
    term, mirror: term.mirror, info: () => term.info, board: opened.board, service: opened.service, args, ...(opened.notice ? { notice: opened.notice } : {}), done: finish,
    // A session that ran before on this state dir (handed over, or its daemon stopped): what was open, opened again.
    ...(checkpoint ? { start: async (app: App) => {
      restored = await restore(app, checkpoint);
      console.error(`ep0ch session ${process.pid}: restored ${JSON.stringify({ ...restored, checkpoint: { screens: checkpoint.screens.length, reopen: checkpoint.reopen.length } })}`);
    } } : {}),
  });
  const app = door.app;
  checkpoints = new Checkpoints(app, () => ({ cols: term.info.cols, rows: term.info.rows }));
  checkpoints.start();
  // Programs the terminal host keeps that no tile has adopted yet (a screen not drawn since the handoff) end with the
  // session too: ending it says so.
  app.quitWarning = () => { const n = host.unadopted().length; return n ? `${n} program${n === 1 ? "" : "s"} kept in the terminal host for a screen not opened since the handoff · ending the session ends ${n === 1 ? "it" : "them"} · again within 3s ends it` : null; };
  host.onLost = () => { if (!over) app.flash("the terminal host went away: the programs in the session's tiles ended (⏎ on a tile runs its program again)", 20_000); };
  if (endedOld) app.flash(`the terminal host was older than this door: its ${endedOld} program${endedOld === 1 ? "" : "s"} ended, and the tiles start them again`, 20_000);
  // Said once the screens have been drawn (their tiles adopt their programs as they are).
  if (restored || keptPrograms) setTimeout(() => {
    const adopted = keptPrograms - host.unadopted().length;
    app.flash(restoredSaying(restored ?? { screens: 0, held: [], reopened: 0, errors: [] }, handedOver ? "upgrade" : "crash", adopted), 15_000);
  }, 400);
  const same = (t: Hello["target"]) => !t || (resolve(t.socket) === resolve(opened.board.path) && (t.outline ?? null) === (opened.board.outline ?? null));
  const where = opened.service.outline ? `the outline ${opened.service.outline}` : opened.service.workspace;

  /** Every terminal starts again on the code in the checkout and attaches again: the session goes on as it is. */
  const reload = (): string => {
    const n = term.all().length;
    for (const c of term.all()) c.link.close({ t: "bye", reason: "restart", message: "restarting this terminal on new code · it attaches again" });
    return `${n} terminal${n === 1 ? "" : "s"} starting again on the checkout's code`;
  };

  /**
   * Hand the session to a new daemon on the code in the checkout (`ep0ch session upgrade`): the checkpoint written with
   * the edits open, their text put aside; every terminal told to attach again; the terminal host let go of with every
   * program in it; the sockets and lock given up; then the successor started, which restores and adopts. This daemon
   * exits once it serves (or says why it couldn't: the programs still run in the host, and the next `ep0ch` restores).
   */
  const handOver = async (): Promise<{ ok: boolean; message: string }> => {
    if (over) return { ok: false, message: "the session is already ending or being handed over" };
    over = true;
    checkpoints?.write(true);
    checkpoints?.stop();
    for (const s of [...app.screens(), ...app.background]) { try { s.keepDrafts?.(); } catch { /* the rest still go */ } }
    // A ctrl+e editor on a temp file has no tile to come back to: its text is copied out, and it ends.
    for (const s of [...app.screens(), ...app.background]) { try { s.keepEdits?.(); } catch { /* the rest still go */ } }
    endUnkept();
    for (const c of term.all()) c.link.close({ t: "bye", reason: "upgrade", message: "the session is being handed over to new code · this terminal attaches again" });
    host.release();
    door?.control?.close();
    server?.close();
    try { unlinkSync(path); } catch { /* gone */ }
    rmSync(sessionFile(), { force: true });
    rmSync(sessionLock(), { force: true });
    unclaimState();
    opened.board.close();
    let next = await startSession(args, { EP0CH_SESSION_RESTORE: "upgrade" });
    // A terminal attaching again started one first (it restores the same way): that one is the successor.
    if (!next.ok && next.error.startsWith(LOCKED) && (await waitFor(path, 15_000))) next = { ok: true };
    // Gone once the asker has its answer.
    setTimeout(() => process.exit(next.ok ? 0 : 1), 300);
    return next.ok ? { ok: true, message: "handed over" } : { ok: false, message: `the new daemon didn't start: ${next.error} · the programs still run in the terminal host; \`ep0ch\` starts a session that adopts them` };
  };
  app.session = { upgrade: handOver, reload };

  server = createServer(sock => {
    sockets.add(sock);
    const frames = new Frames<ClientMsg>();
    let client: SessionClient | null = null;
    const link: Link & { sock: Socket } = {
      sock,
      send: m => { if (!sock.destroyed) sock.write(encode(m)); },
      backlog: () => sock.writableLength,
      onDrain: f => { sock.on("drain", f); },
      close: bye => { if (sock.destroyed) return; if (bye) sock.end(encode(bye)); else sock.end(); },
    };
    const gone = () => { sockets.delete(sock); if (client) { const c = client; client = null; term.detach(c); if (!over) app.redraw(); } };
    sock.on("close", gone);
    sock.on("error", () => sock.destroy());
    sock.on("data", (chunk: Buffer) => {
      let msgs: ClientMsg[];
      try { msgs = frames.push(chunk); } catch (e) { link.close({ t: "bye", reason: "refused", message: (e as Error).message, code: 2 }); return; }
      for (const m of msgs) {
        // The session is ending: nothing more is taken, and a new terminal is told so.
        if (over) { if (m.t === "hello") link.close({ t: "bye", reason: "ended", message: "the session is ending" }); continue; }
        try { handle(m); } catch (e) { if (e instanceof Offline) app.flash(e.message); else throw e; }
      }
    });
    function handle(m: ClientMsg) {
      switch (m.t) {
        case "hello": {
          if (client) return;
          const h = m.hello;
          if (h.proto !== PROTOCOL) {
            link.close({ t: "bye", reason: "refused", code: 2, message: `this session speaks protocol ${PROTOCOL}, the client ${h.proto}: the two checkouts differ; \`ep0ch session list\` says which runs where` });
            return;
          }
          // A terminal inside this session (one of its tiles, its drop shell) would show the session inside itself,
          // every frame drawn into the tile that draws it.
          // Its own nest names this daemon; a program kept from a daemon before it (a handoff) is found by its
          // process: a child of the terminal host, or of this daemon.
          if (nestLayers(h.nest).some(l => l.startsWith(`door:${process.pid}/`) || l === `shell:${process.pid}`) || ancestors(h.pid).some(p => p === process.pid || p === host.hostPid)) {
            link.close({ t: "bye", reason: "refused", code: 1, message: "this terminal is inside the session already (one of its tiles, or its drop shell): attaching would show the session inside itself" });
            return;
          }
          // A client that named another outline (--ws, a socket, EP0CH_SOCKET) isn't given this one.
          if (!same(h.target)) {
            link.close({ t: "bye", reason: "refused", code: 1, message: `this state dir's session is on ${where}, not the outline you named (${h.target!.outline ?? h.target!.socket}) · \`ep0ch session end\` ends it, or open that outline with --no-daemon or its own EP0CH_STATE` });
            return;
          }
          const others = term.all().filter(c => !c.watch).length;
          client = term.attach(link, h);
          // The person logs on again: their last call is when they last left, and "new since" counts from it.
          if (!others && !h.watch) { app.lastCall = readLastCall() || app.lastCall; loggedOnAt = Date.now(); }
          // What it asked for and the session didn't do (the one that started it asked for what it did).
          const ignored = screenFlags(h.args ?? []).filter(f => !screenFlags(args).includes(f));
          if (ignored.length) app.flash(`attached to the running session · ${ignored.join(" ")} not applied (the session keeps its screens)`, 8000);
          else if (others && !h.watch) app.flash(`another terminal attached (${h.tty ?? `pid ${h.pid}`}) · the keys are wherever you last typed`, 6000);
          app.redraw();
          return;
        }
        case "query": link.send({ t: "info", info: info() }); return;
        case "upgrade": case "reload": {
          // `ep0ch session upgrade` at the person's shell: the same action an attached terminal can't run over the wire.
          if (client) { link.send({ t: "ask", message: `\`ep0ch session upgrade\` does that, not an attached terminal` }); return; }
          void app.dispatch.act({ action: "session.upgrade", args: { clients: m.t === "reload" } }, USER).then(
            r => { link.send({ t: "ask", message: (r as { message: string }).message }); link.close(); },
            e => { link.send({ t: "ask", message: e instanceof Error ? e.message : String(e) }); link.close(); });
          return;
        }
        case "end": {
          // Ending is the person's (`ep0ch session end` at their shell), the same action as E on the main menu. A
          // terminal attached here (a watcher above all) ends it from the menu, not over the wire.
          if (client) { link.send({ t: "ask", message: "a terminal attached to the session ends it from the main menu (E), not this way" }); return; }
          void app.dispatch.act({ action: "session.end", args: { force: !!m.force } }, USER).then(
            r => { const why = (r as { why?: string } | null)?.why; if (why) link.send({ t: "ask", message: why }); },
            e => link.send({ t: "ask", message: e instanceof Error ? e.message : String(e) }));
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

/** What a refused start says when another session holds the state dir: a starter that sees it waits for that one. */
export const LOCKED = "a session is already running or starting";

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
