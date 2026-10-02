// A door session's client: `ep0ch` (and `ssh ep0ch`, whose ForceCommand runs it) attached to the session in the state
// dir (src/session/daemon.ts), starting the session first when none runs. It owns only the terminal: it probes it (size,
// Kitty graphics, the keyboard protocol), sends what it types and its size, writes what the session sends, runs a
// program the session hands it (the drop shell, $EDITOR) and gives the terminal back when it detaches.
//
//   ep0ch session list [--json]        the session in this state dir: its outline, terminals, programs
//   ep0ch session attach [--watch]     attach to it (--watch: read-only, never the person's keys)
//   ep0ch session end [--yes]          end it (asks when programs run in its tiles)
//   ep0ch session upgrade [--clients]  hand it to a new daemon on this checkout's code (its programs keep running)
//   ep0ch session restart              hand it over whatever code it runs
//   ep0ch session serve [door flags]   run one in the foreground (what `ep0ch` starts, detached)
import { connect, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { listening } from "../control";
import { resolveTarget } from "../discover";
import { appendNest, nestLayers } from "../nest";
import { stateDir } from "../state";
import { runProgram, Term } from "../term";
import { codeVersion, LOCKED, serve } from "./daemon";
import { HostPtys, ptyHostSocket, servePtyHost } from "./pty-host";
import { forgetSession } from "./restore";
import { ask, sessionEnv, sessionInfo, sessionSocket, startSession, TERMINAL_VARS, waitFor } from "./start";
export { sessionInfo };
import { encode, Frames, PROTOCOL, type DaemonMsg, type Hello, type SessionInfo } from "./protocol";

/**
 * Whether `ep0ch` attaches to a session or opens the door in this terminal: the door is a session by default (the
 * one in this state dir attached to, started first when none runs); `--no-daemon` or EP0CH_DAEMON=0 opens it here,
 * in this terminal, as before sessions.
 */
export async function doorMode(args: readonly string[], env: Record<string, string | undefined> = process.env): Promise<{ mode: "attach" | "local"; running: boolean }> {
  if (args.includes("--no-daemon") || env.EP0CH_DAEMON === "0") return { mode: "local", running: false };
  return { mode: "attach", running: await listening(sessionSocket()) };
}

/** `ep0ch [door flags]` with sessions: the session in this state dir, started first when none runs; then attached. */
export async function attachDoor(args: string[], how: { running: boolean }): Promise<number> {
  // A session is for a terminal: run without one (a script, an agent's shell, cron, ssh without -t), `ep0ch` would
  // start a daemon that outlives the caller, maybe the person's own. Refused, with what to run instead.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("ep0ch: not a terminal, so no session is started or attached · `ep0ch --no-daemon` opens the door here, `ep0ch session list` says what runs");
    return 1;
  }
  // The outline it names, when it names one and a session runs: a session on another one refuses it. (One starting
  // now takes these same flags.)
  const target = how.running ? await namedTarget(args) : null;
  if (target && "error" in target) { console.error(`ep0ch: ${target.error}`); return 1; }
  if (!how.running) {
    const started = await startSession(args.filter(a => a !== "--daemon"));
    // Another `ep0ch` started it a moment before: that one is waited for, then attached to.
    if (!started.ok && !(started.error.startsWith(LOCKED) && (await waitFor(sessionSocket(), 15_000)))) { console.error(`ep0ch: ${started.error}`); return 1; }
  }
  return attach(sessionSocket(), { args, ...(target ? { target } : {}) });
}

/**
 * The outline the door flags name (`--ws <name|root>`, a socket path, EP0CH_SOCKET), as resolveTarget names it (its
 * service's socket, and the outline on it): the same resolution the session made when it started, without asking the
 * service (an outline not open yet is opened by the session that starts). Null when they name none: the session in the
 * state dir is attached to, whichever outline it's on.
 */
export async function namedTarget(args: readonly string[], env: Record<string, string | undefined> = process.env): Promise<{ socket: string; outline?: string } | { error: string } | null> {
  const named = args.includes("--ws") || args.some((a, i) => a.includes("/") && !["--board", "--ws", "--root"].includes(args[i - 1] ?? "")) || !!env.EP0CH_SOCKET;
  if (!named) return null;
  const t = await resolveTarget(args, env);
  if ("error" in t) return { error: t.error };
  return { socket: resolve(t.path), ...(t.outline ? { outline: t.outline } : {}) };
}

/**
 * A program the session hands this terminal (the drop shell, $EDITOR) runs with the session's environment and this
 * terminal's own: its TERM and colours, its ssh login, tmux, display; and the layers it runs in before the session's.
 */
export function runEnv(session: Record<string, string> | undefined, here: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = { ...(session ?? sessionEnv(here)) };
  for (const k of TERMINAL_VARS) { const v = here[k]; if (v !== undefined) out[k] = v; else if (k !== "EP0CH_NEST") delete out[k]; }
  for (const [k, v] of Object.entries(here)) if (/^LC_|^LANG$/.test(k) && v !== undefined) out[k] = v;
  out.EP0CH_NEST = appendNest(here.EP0CH_NEST, ...nestLayers(session?.EP0CH_NEST));
  if (!out.EP0CH_NEST) delete out.EP0CH_NEST;
  return out;
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);

/** `session list`, as text. */
export function formatSession(i: SessionInfo, now = Date.now()): string {
  const where = i.outline.outline ? `${i.outline.host} · ${i.outline.outline}` : `${i.outline.host}:${i.outline.workspace}`;
  const lines = [`session ${i.pid} · ${where} · up ${ago(now - i.started)} · on the ${i.screen ?? "logon"}`, `  state ${i.state}${i.code.commit ? ` · code ${i.code.commit.slice(0, 9)}` : ""}`];
  lines.push(i.clients.length ? `  ${i.clients.length} terminal${i.clients.length === 1 ? "" : "s"} attached:` : "  no terminal attached");
  for (const c of i.clients) lines.push(`    #${c.id} ${c.tty ?? `pid ${c.pid}`} ${c.cols}×${c.rows} ${c.video}${c.active ? " · has the keys" : ""}${c.watch ? " · watching" : ""}${c.away ? ` · running ${c.away}` : ""} · idle ${ago(c.idle)}`);
  lines.push(i.terminals.length ? `  ${i.terminals.length} program${i.terminals.length === 1 ? "" : "s"} running${i.host ? ` in its terminal host (pid ${i.host})` : ""}: ${i.terminals.map(t => `${t.tile} (${t.cmd}${t.pid ? `, pid ${t.pid}` : ""})`).join(", ")}` : "  no programs running in its tiles");
  if (i.kept?.length) lines.push(`  ${i.kept.length} kept without a tile yet (a screen not opened since a handoff): ${i.kept.map(k => `${k.cmd}${k.pid ? ` (pid ${k.pid})` : ""}`).join(", ")}`);
  return lines.join("\n");
}

/** `ep0ch session …`. */
export async function sessionCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;
  const path = sessionSocket();
  if (cmd === "serve") return serve(rest);
  if (cmd === "pty-host") return servePtyHost();
  if (cmd === "upgrade") return upgradeCommand(rest);
  if (cmd === "restart") return upgradeCommand([...rest, "--handoff"]);
  if (cmd === "list" || cmd === undefined) {
    const i = await sessionInfo(path);
    if (rest.includes("--json")) { console.log(JSON.stringify(i ? [i] : [])); return 0; }
    const waiting = !i && (await listening(ptyHostSocket())) ? ` · its terminal host still runs the programs of one whose daemon stopped: \`ep0ch\` restores it` : "";
    console.log(i ? formatSession(i) : `no session in ${stateDir()}${waiting || " · `ep0ch` starts one"}`);
    return 0;
  }
  if (cmd === "attach") {
    // --wait <s>: a terminal attaching again after a handoff waits for the new daemon to serve; --or-start: with none
    // by then, one is started (it restores the session), as `ep0ch` starts one.
    const at = rest.indexOf("--wait"), wait = at >= 0 ? Number(rest[at + 1]) || 30 : 0;
    if (at >= 0) rest.splice(at, 2);
    const orStart = rest.includes("--or-start");
    if (orStart) rest.splice(rest.indexOf("--or-start"), 1);
    if (!(await (wait ? waitFor(path, wait * 1000) : listening(path)))) {
      if (orStart && !rest.includes("--watch")) return attachDoor(rest, { running: false });
      console.error(`ep0ch: no session in ${stateDir()} · \`ep0ch\` starts one`);
      return 1;
    }
    const args = rest.filter(a => a !== "--watch"), target = await namedTarget(args);
    if (target && "error" in target) { console.error(`ep0ch: ${target.error}`); return 1; }
    return attach(path, { args, watch: rest.includes("--watch"), ...(target ? { target } : {}) });
  }
  if (cmd === "end") {
    let force = rest.includes("--yes") || rest.includes("-y");
    if (!(await listening(path))) {
      // No daemon, but the programs of a session whose daemon stopped still run in its terminal host: they end too.
      if (!(await listening(ptyHostSocket()))) { console.error(`ep0ch: no session in ${stateDir()}`); return 1; }
      const host = await HostPtys.connect().catch(() => null);
      const n = host?.unadopted().length ?? 0;
      const ask = `no session runs, but its terminal host still runs ${n} program${n === 1 ? "" : "s"} (${host?.unadopted().map(p => (p.meta.cmd ?? p.argv).join(" ")).join(", ")})`;
      if (n && !force) {
        if (!process.stdin.isTTY) { console.error(`ep0ch: ${ask} · \`ep0ch session end --yes\` ends ${n === 1 ? "it" : "them"}`); host?.release(); return 1; }
        if (!(await confirm(`${ask}. End ${n === 1 ? "it" : "them"}? [y/N] `))) { host?.release(); console.error("ep0ch: left running"); return 1; }
      }
      host?.endAll();
      forgetSession();
      console.log(`ep0ch: the session's terminal host ended${n ? `, with its ${n} program${n === 1 ? "" : "s"}` : ""}`);
      return 0;
    }
    for (;;) {
      const r = await endOnce(path, force);
      if (r.t === "ask") {
        if (force || !process.stdin.isTTY) { console.error(`ep0ch: ${r.message} · \`ep0ch session end --yes\` ends it anyway`); return 1; }
        if (!(await confirm(`${r.message}. End it anyway? [y/N] `))) { console.error("ep0ch: the session goes on"); return 1; }
        force = true;
        continue;
      }
      console.log(`ep0ch: ${r.message}`);
      return r.code ?? 0;
    }
  }
  console.error(`ep0ch: session ${cmd}? try: ep0ch session list | attach [--watch] | end [--yes] | upgrade [--clients] | restart`);
  return 2;
}

/** Send `end` and wait: `ask` (it didn't end, and why), or the session's goodbye once it has gone. */
function endOnce(path: string, force: boolean): Promise<{ t: "ask"; message: string; code?: number } | { t: "bye"; message: string; code?: number }> {
  return new Promise(res => {
    const sock = connect(path);
    const frames = new Frames<DaemonMsg>();
    sock.on("connect", () => sock.write(encode({ t: "end", force })));
    sock.on("data", (d: Buffer) => { for (const m of frames.push(d)) if (m.t === "ask") { sock.end(); res({ t: "ask", message: m.message }); } });
    // It ended: the connection closes with the session.
    sock.on("close", () => res({ t: "bye", message: "the session ended" }));
    sock.on("error", () => {});
  });
}

function confirm(q: string): Promise<boolean> {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(q, a => { rl.close(); res(/^y(es)?$/i.test(a.trim())); });
  });
}

/**
 * Attach this terminal to the session on `path` until it detaches or the session ends; the exit code. The terminal is
 * put back whichever way it goes (Term.stop; its guard covers a kill -9).
 */
export async function attach(path: string, o: { args?: string[]; watch?: boolean; target?: Hello["target"] } = {}): Promise<number> {
  const sock = await new Promise<Socket>((res, rej) => { const s = connect(path, () => res(s)); s.once("error", rej); }).catch((e: Error) => { console.error(`ep0ch: can't reach the session on ${path}: ${e.message}`); return null; });
  if (!sock) return 1;
  const term = new Term();
  let done: (code: number) => void = () => {};
  const finished = new Promise<number>(r => { done = r; });
  let said = "";
  let over = false;
  /** Told to attach again (a handoff, new code): what to say as it does. */
  let again: string | null = null;
  /** A program the session handed this terminal is running (the drop shell, $EDITOR): the terminal is its. */
  let handed = 0;
  let running: Promise<void> = Promise.resolve();
  const leave = (code: number, message = "") => {
    if (over) return;
    over = true;
    sock.destroy();
    // A program that has the terminal keeps it until it ends; then the terminal is put back and the reason said.
    void running.then(() => {
      term.stop();
      if (again !== null) return reattach(again, o);
      if (message) (code ? console.error : console.log)(`ep0ch: ${message}`);
      done(code);
    });
  };
  const send = (m: Parameters<typeof encode>[0]) => { if (!sock.destroyed) sock.write(encode(m)); };
  // The terminal closed or the client was told to go: the session goes on without it. While a program has the
  // terminal, ctrl+c and ctrl+\ are its (a shell without job control shares this process group).
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT", "SIGQUIT"] as const) process.on(sig, () => { if (handed && (sig === "SIGINT" || sig === "SIGQUIT")) return; leave(0); });
  process.on("uncaughtException", e => { const c = (e as NodeJS.ErrnoException).code; leave(c === "EIO" || c === "EPIPE" ? 0 : 1, c === "EIO" || c === "EPIPE" ? "" : String((e as Error).stack ?? e)); });
  const frames = new Frames<DaemonMsg>();
  sock.on("data", (chunk: Buffer) => {
    let msgs: DaemonMsg[];
    try { msgs = frames.push(chunk); } catch (e) { leave(1, `the session sent something unreadable: ${(e as Error).message}`); return; }
    for (const m of msgs) {
      if (m.t === "output") { if (!over && !handed) process.stdout.write(m.text); }
      else if (m.t === "ground") term.sessionGround = m.set;
      else if (m.t === "bye") {
        said = m.message;
        // The session is handed to new code (or this terminal is asked to start again on it): this process becomes the
        // new client, in this same terminal, and attaches again.
        if (m.reason === "upgrade" || m.reason === "restart") { again = m.message; leave(0); }
        else leave(m.code ?? 0, m.message);
      }
      else if (m.t === "run") {
        // One program at a time, in the order asked; the terminal is the program's until it ends.
        handed++;
        running = running.then(async () => {
          term.stop();
          let code: number | null;
          try { code = await runProgram(m.argv, { ...(m.cwd ? { cwd: m.cwd } : {}), env: runEnv(m.env), ...(m.banner ? { banner: m.banner } : {}) }); }
          catch (e) { process.stderr.write(`ep0ch: can't run ${m.argv[0]}: ${(e as Error).message}\n`); code = 127; }
          handed--;
          if (over) return;
          term.resume();
          send({ t: "ran", id: m.id, code });
        });
      }
    }
  });
  sock.on("close", () => leave(said ? 0 : 1, said ? "" : "the session went away"));
  sock.on("error", () => {});
  await term.start();
  const hello: Hello = {
    proto: PROTOCOL, ...term.info, pid: process.pid,
    ...(ttyName() ? { tty: ttyName()! } : {}), ...(process.env.EP0CH_NEST ? { nest: process.env.EP0CH_NEST } : {}),
    args: o.args ?? [], ...(o.watch ? { watch: true } : {}), ...(o.target ? { target: o.target } : {}),
  };
  send({ t: "hello", hello });
  term.pass = text => { if (!handed) send({ t: "input", text }); };
  term.onResize(() => send({ t: "resize", cols: term.info.cols, rows: term.info.rows }));
  return finished;
}

/**
 * Become a new client on the code in the checkout, in this same process and terminal (execve keeps the pid, the tty
 * and an ssh session's ForceCommand), waiting for the session to serve again.
 */
function reattach(message: string, o: { args?: string[]; watch?: boolean }): void {
  console.log(`ep0ch: ${message}`);
  const main = join(import.meta.dir, "../main.ts");
  // It waits for the new daemon to serve; with none by then (it didn't start), it starts one, as `ep0ch` would, which
  // restores the session and adopts its programs. A watcher only waits.
  const argv = [process.execPath, main, "session", "attach", "--wait", "30", ...(o.watch ? ["--watch"] : ["--or-start"]), ...(o.args ?? [])];
  const env = process.env as Record<string, string>;
  if (typeof process.execve === "function") process.execve(process.execPath, argv, env);
  // A runtime without execve: the new client runs as this one's child, in this terminal, and this one goes with it.
  const child = Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"], env });
  void child.exited.then(code => process.exit(code ?? 1));
  return undefined as never;
}

/**
 * The session onto the code in its checkout (`ep0ch session upgrade`, `ep0ch install --apply`). A daemon on other
 * code hands over to a new one: the programs in its tiles keep running in the terminal host, the screens and edits
 * come back, every terminal attaches again. One on this code already (or `clients`) only has its terminals start again;
 * `handoff` hands over whatever code it runs (`ep0ch session restart`). What happened, said; `ok` false when it failed.
 */
export async function upgradeSession(o: { clients?: boolean; handoff?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  const path = sessionSocket();
  const before = await sessionInfo(path);
  if (!before) return { ok: false, message: `no session in ${stateDir()}` };
  const here = codeVersion();
  if (o.clients || (!o.handoff && before.code.commit && before.code.commit === here.commit)) {
    await ask(path, { t: "reload" });
    const n = before.clients.length;
    return { ok: true, message: `the session (pid ${before.pid}) runs ${before.code.commit?.slice(0, 9) ?? "this code"} already · its ${n} terminal${n === 1 ? "" : "s"} start${n === 1 ? "s" : ""} again on this checkout${o.clients ? "" : " (`ep0ch session restart` hands it over anyway, for changes not committed yet)"}` };
  }
  const r = await ask(path, { t: "upgrade" }, 60_000);
  if (r?.t !== "ask" || r.message !== "handed over") return { ok: false, message: r?.t === "ask" ? r.message : "the session didn't answer the handoff" };
  const after = await sessionInfo(path);
  const progs = before.terminals.length, n = before.clients.length;
  return { ok: true, message: `the session was handed over: pid ${before.pid} → ${after?.pid ?? "?"}, code ${before.code.commit?.slice(0, 9) ?? "?"} → ${after?.code.commit?.slice(0, 9) ?? "?"} · ${progs} program${progs === 1 ? "" : "s"} kept running · ${n} terminal${n === 1 ? "" : "s"} attaching again` };
}

async function upgradeCommand(rest: string[]): Promise<number> {
  const r = await upgradeSession({ clients: rest.includes("--clients"), handoff: rest.includes("--handoff") });
  (r.ok ? console.log : console.error)(`ep0ch: ${r.message}`);
  return r.ok ? 0 : 1;
}

/** This terminal's name (`/dev/pts/3`), for `session list`. */
function ttyName(): string | null {
  try { const r = Bun.spawnSync(["tty"], { stdin: "inherit", stdout: "pipe" }); return r.exitCode === 0 ? r.stdout.toString().trim() || null : null; } catch { return null; }
}
