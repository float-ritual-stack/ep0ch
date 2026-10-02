// A door session's client: `ep0ch` (and `ssh ep0ch`, whose ForceCommand runs it) attached to the session in the state
// dir (src/session/daemon.ts), starting the session first when none runs. It owns only the terminal: it probes it (size,
// Kitty graphics, the keyboard protocol), sends what it types and its size, writes what the session sends, runs a
// program the session hands it (the drop shell, $EDITOR) and gives the terminal back when it detaches.
//
//   ep0ch session list [--json]        the session in this state dir: its outline, terminals, programs
//   ep0ch session attach [--watch]     attach to it (--watch: read-only, never the person's keys)
//   ep0ch session end [--yes]          end it (asks when programs run in its tiles)
//   ep0ch session serve [door flags]   run one in the foreground (what `ep0ch` starts, detached)
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runProgram } from "../drop";
import { privateDir, stateDir } from "../state";
import { Term } from "../term";
import { listening, serve, sessionLog, sessionSocket } from "./daemon";
import { encode, Frames, PROTOCOL, type DaemonMsg, type Hello, type SessionInfo } from "./protocol";

/**
 * Whether `ep0ch` attaches to a session or opens the door in this terminal: a running session is attached to; with
 * none, EP0CH_DAEMON=1 (or `--daemon`) starts one; `--no-daemon` or EP0CH_DAEMON=0 opens the door here, as before.
 */
export async function doorMode(args: readonly string[], env: Record<string, string | undefined> = process.env): Promise<{ mode: "attach" | "local"; running: boolean }> {
  if (args.includes("--no-daemon") || env.EP0CH_DAEMON === "0") return { mode: "local", running: false };
  const running = await listening(sessionSocket());
  if (running) return { mode: "attach", running };
  return { mode: args.includes("--daemon") || env.EP0CH_DAEMON === "1" ? "attach" : "local", running };
}

/** `ep0ch [door flags]` with sessions: the session in this state dir, started first when none runs; then attached. */
export async function attachDoor(args: string[], how: { running: boolean }): Promise<number> {
  if (!how.running) {
    const started = await startSession(args.filter(a => a !== "--daemon"));
    if (!started.ok) { console.error(`ep0ch: ${started.error}`); return 1; }
  }
  return attach(sessionSocket(), { args });
}

/** The variables a session doesn't keep from the terminal that started it: it outlives that terminal, its pane and its ssh login. */
export const TERMINAL_VARS = ["HERDR_PANE_ID", "HERDR_TAB_ID", "EP0CH_NEST", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "TMUX", "TMUX_PANE", "WINDOWID", "STY"] as const;

/**
 * Start the session for this state dir, detached (its own process group and session, no terminal), and wait until it
 * serves: it says so on fd 3, or why it couldn't. Its output goes to session.log in the state dir.
 */
export async function startSession(args: readonly string[], timeoutMs = 30_000): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!privateDir(stateDir(), true)) return { ok: false, error: `${stateDir()} isn't yours alone (it needs mode 700): no session` };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(TERMINAL_VARS as readonly string[]).includes(k)) env[k] = v;
  env.EP0CH_SESSION_READY = "3";
  const log = openSync(sessionLog(), "a", 0o600);
  const main = join(import.meta.dir, "../main.ts");
  const child = spawn(process.execPath, [main, "session", "serve", ...args], { detached: true, stdio: ["ignore", log, log, "pipe"], env, cwd: process.cwd() });
  closeSync(log);
  const said = await new Promise<string>(res => {
    let got = "";
    const pipe = child.stdio[3] as NodeJS.ReadableStream | null;
    const t = setTimeout(() => res(""), timeoutMs);
    pipe?.on("data", (d: Buffer) => { got += d.toString(); if (got.includes("\n")) { clearTimeout(t); res(got); } });
    pipe?.on("end", () => { clearTimeout(t); res(got); });
    child.once("exit", () => setTimeout(() => { clearTimeout(t); res(got); }, 50));
  });
  child.unref();
  (child.stdio[3] as unknown as { destroy?(): void } | null)?.destroy?.();
  try {
    const m = JSON.parse(said.split("\n")[0]!) as { ok: boolean; error?: string };
    return m.ok ? { ok: true } : { ok: false, error: m.error ?? "the session didn't start" };
  } catch {
    return { ok: false, error: `the session didn't start; its log: ${sessionLog()}${tail(sessionLog())}` };
  }
}

const tail = (path: string) => { try { const l = readFileSync(path, "utf8").trim().split("\n").slice(-6); return l.length ? `\n  ${l.join("\n  ")}` : ""; } catch { return ""; } };

/** One request to the session, its first answer (not attached: `session list`, `session end`). */
function ask(path: string, m: Parameters<typeof encode>[0], ms = 5000): Promise<DaemonMsg | null> {
  return new Promise(res => {
    const sock = connect(path);
    const frames = new Frames<DaemonMsg>();
    const t = setTimeout(() => { sock.destroy(); res(null); }, ms);
    sock.on("connect", () => sock.write(encode(m)));
    sock.on("data", (d: Buffer) => { const got = frames.push(d)[0]; if (got) { clearTimeout(t); sock.end(); res(got); } });
    sock.on("error", () => { clearTimeout(t); res(null); });
    sock.on("close", () => { clearTimeout(t); res(null); });
  });
}

/** The session in this state dir, or null. */
export async function sessionInfo(path = sessionSocket()): Promise<SessionInfo | null> {
  if (!(await listening(path))) return null;
  const r = await ask(path, { t: "query" });
  return r?.t === "info" ? r.info : null;
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);

/** `session list`, as text. */
export function formatSession(i: SessionInfo, now = Date.now()): string {
  const where = i.outline.outline ? `${i.outline.host} · ${i.outline.outline}` : `${i.outline.host}:${i.outline.workspace}`;
  const lines = [`session ${i.pid} · ${where} · up ${ago(now - i.started)} · on the ${i.screen ?? "logon"}`, `  state ${i.state}${i.code.commit ? ` · code ${i.code.commit.slice(0, 9)}` : ""}`];
  lines.push(i.clients.length ? `  ${i.clients.length} terminal${i.clients.length === 1 ? "" : "s"} attached:` : "  no terminal attached");
  for (const c of i.clients) lines.push(`    #${c.id} ${c.tty ?? `pid ${c.pid}`} ${c.cols}×${c.rows} ${c.video}${c.active ? " · has the keys" : ""}${c.watch ? " · watching" : ""}${c.away ? ` · running ${c.away}` : ""} · idle ${ago(c.idle)}`);
  lines.push(i.terminals.length ? `  ${i.terminals.length} program${i.terminals.length === 1 ? "" : "s"} running: ${i.terminals.map(t => `${t.tile} (${t.cmd}${t.pid ? `, pid ${t.pid}` : ""})`).join(", ")}` : "  no programs running in its tiles");
  return lines.join("\n");
}

/** `ep0ch session …`. */
export async function sessionCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;
  const path = sessionSocket();
  if (cmd === "serve") return serve(rest);
  if (cmd === "list" || cmd === undefined) {
    const i = await sessionInfo(path);
    if (rest.includes("--json")) { console.log(JSON.stringify(i ? [i] : [])); return 0; }
    console.log(i ? formatSession(i) : `no session in ${stateDir()} · \`ep0ch\` starts one`);
    return 0;
  }
  if (cmd === "attach") {
    if (!(await listening(path))) { console.error(`ep0ch: no session in ${stateDir()} · \`ep0ch\` starts one`); return 1; }
    return attach(path, { args: rest.filter(a => a !== "--watch"), watch: rest.includes("--watch") });
  }
  if (cmd === "end") {
    if (!(await listening(path))) { console.error(`ep0ch: no session in ${stateDir()}`); return 1; }
    let force = rest.includes("--yes") || rest.includes("-y");
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
  console.error(`ep0ch: session ${cmd}? try: ep0ch session list | attach [--watch] | end [--yes]`);
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
export async function attach(path: string, o: { args?: string[]; watch?: boolean } = {}): Promise<number> {
  const sock = await new Promise<Socket>((res, rej) => { const s = connect(path, () => res(s)); s.once("error", rej); }).catch((e: Error) => { console.error(`ep0ch: can't reach the session on ${path}: ${e.message}`); return null; });
  if (!sock) return 1;
  const term = new Term();
  let done: (code: number) => void = () => {};
  const finished = new Promise<number>(r => { done = r; });
  let said = "";
  let over = false;
  const leave = (code: number, message = "") => {
    if (over) return;
    over = true;
    term.stop();
    if (message) (code ? console.error : console.log)(`ep0ch: ${message}`);
    sock.destroy();
    done(code);
  };
  const send = (m: Parameters<typeof encode>[0]) => { if (!sock.destroyed) sock.write(encode(m)); };
  // The terminal closed or the client was told to go: the session goes on without it.
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT", "SIGQUIT"] as const) process.on(sig, () => leave(0));
  process.on("uncaughtException", e => { const c = (e as NodeJS.ErrnoException).code; leave(c === "EIO" || c === "EPIPE" ? 0 : 1, c === "EIO" || c === "EPIPE" ? "" : String((e as Error).stack ?? e)); });
  const frames = new Frames<DaemonMsg>();
  let running: Promise<void> = Promise.resolve();
  sock.on("data", (chunk: Buffer) => {
    let msgs: DaemonMsg[];
    try { msgs = frames.push(chunk); } catch (e) { leave(1, `the session sent something unreadable: ${(e as Error).message}`); return; }
    for (const m of msgs) {
      if (m.t === "output") { if (!over) process.stdout.write(m.text); }
      else if (m.t === "ground") term.sessionGround = m.set;
      else if (m.t === "bye") { said = m.message; leave(m.code ?? 0, m.message); }
      else if (m.t === "run") {
        // One program at a time, in the order asked; the terminal is the program's until it ends.
        running = running.then(async () => {
          term.stop();
          if (m.banner) process.stdout.write(`\x1b[2J\x1b[H${m.banner}\n`);
          let code: number | null;
          try { code = await runProgram(m.argv, { ...(m.cwd ? { cwd: m.cwd } : {}), ...(m.env ? { env: m.env } : {}) }); }
          catch (e) { process.stderr.write(`ep0ch: can't run ${m.argv[0]}: ${(e as Error).message}\n`); code = 127; }
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
    args: o.args ?? [], ...(o.watch ? { watch: true } : {}),
  };
  send({ t: "hello", hello });
  term.pass = text => send({ t: "input", text });
  term.onResize(() => send({ t: "resize", cols: term.info.cols, rows: term.info.rows }));
  return finished;
}

/** This terminal's name (`/dev/pts/3`), for `session list`. */
function ttyName(): string | null {
  try { const r = Bun.spawnSync(["tty"], { stdin: "inherit", stdout: "pipe" }); return r.exitCode === 0 ? r.stdout.toString().trim() || null : null; } catch { return null; }
}
