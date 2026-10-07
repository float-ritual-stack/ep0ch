// A door session's client: `ep0ch` (and `ssh ep0ch`, whose ForceCommand runs it) attached to the session of the outline
// it names (src/session/daemon.ts; one per outline, src/session/place.ts), starting it first when none runs. It owns
// only the terminal: it probes it (size, Kitty graphics, the keyboard protocol), sends what it types and its size,
// writes what the session sends, runs a program the session hands it (the drop shell, $EDITOR) and gives the terminal
// back when it detaches.
//
//   ep0ch session list [--json]                   every session on this state dir: outline, machine, pid, code,
//                                                 terminals attached, programs
//   ep0ch session attach [--watch] [--ws <name>]  attach to this folder's (or --ws's) session (--watch: read-only)
//   ep0ch session end [--yes] [--all]             end it (asks when programs run in its tiles; --all asks first)
//   ep0ch session upgrade [--clients] [--all]     hand it to a new daemon on this checkout's code (programs keep running)
//   ep0ch session restart                         hand it over whatever code it runs
//   ep0ch session serve [door flags]              run one in the foreground (what `ep0ch` starts, detached)
//
// Which session: `--ws <name>` (and `--machine`), else EP0CH_WS, else the folder's .ep0ch, by the rule `ep0ch` opens
// an outline by; with none named, the only session running (several: it says which to name).
import { connect, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { listening } from "../jsonl";
import { forwardTo } from "../machine";
import { appendNest, nestLayers } from "../nest";
import { stateDir } from "../state";
import { runProgram, Term } from "../term";
import { ago } from "../text";
import { codeVersion, LOCKED, serve } from "./daemon";
import { HostPtys, ptyHostSocket, servePtyHost } from "./pty-host";
import { forgetSession } from "./restore";
import { askSession, sessionEnv, startSession, TERMINAL_VARS, waitFor } from "./start";
import { ep0ch, pickSession, placeFor, placeLabel, readPlace, runningSessions, sessionFlags, sessionInfo, sessionSocket, waitingHosts, type Place, type Running } from "./place";
export { sessionInfo };
import { encode, Frames, PROTOCOL, type DaemonMsg, type Hello, type SessionInfo } from "./protocol";
import { encodeProgramStatus } from "@ep0ch/outline-core/program-status";

/**
 * Whether `ep0ch` attaches to a session or opens the door in this terminal: the door is a session by default (its
 * outline's, attached to, started first when none runs); `--no-daemon` or EP0CH_DAEMON=0 opens it here, in this
 * terminal, as before sessions.
 */
export function doorMode(args: readonly string[], env: Record<string, string | undefined> = process.env): { mode: "attach" | "local" } {
  return { mode: args.includes("--no-daemon") || env.EP0CH_DAEMON === "0" ? "local" : "attach" };
}

/**
 * `ep0ch [door flags]` with sessions: the session of the outline the flags name (main.ts named it first: the folder's,
 * or the home base's choice, pinned as --ws and --machine), started first when none runs; then attached.
 */
export async function attachDoor(args: string[]): Promise<number> {
  // A session is for a terminal: run without one (a script, an agent's shell, cron, ssh without -t), `ep0ch` would
  // start a daemon that outlives the caller, maybe the person's own. Refused, with what to run instead.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`ep0ch: not a terminal, so no session is started or attached · \`${ep0ch()}--no-daemon\` opens the door here, \`${ep0ch()}session list\` says what runs`);
    return 1;
  }
  const place = placeFor(args);
  if (!place) { console.error(`ep0ch: no outline is named here · \`${ep0ch()}--ws <name>\` names one (\`${ep0ch()}outline list\` lists them)`); return 1; }
  if ("error" in place) { console.error(`ep0ch: ${place.error}`); return 1; }
  const path = sessionSocket(place.dir);
  if (!(await listening(path))) {
    const started = await startSession(place.dir, args.filter(a => a !== "--daemon"));
    // Another `ep0ch` started it a moment before: that one is waited for, then attached to.
    if (!started.ok && !(started.error.startsWith(LOCKED) && (await waitFor(path, 15_000)))) {
      console.error(`ep0ch: ${started.error} · \`${ep0ch(process.env, place)}session list\` says what runs; its log is ${join(place.dir, "session.log")}`);
      return 1;
    }
  }
  return attach(path, { args: pinned(args, place) });
}

/** A client's arguments with its session's outline pinned (`--ws`, `--machine`): attaching again after a handoff finds the same one. */
function pinned(args: readonly string[], place: Place): string[] {
  const rest = args.filter((a, i) => !["--ws", "--machine"].includes(a) && !["--ws", "--machine"].includes(args[i - 1] ?? ""));
  return [...rest, "--ws", place.outline, ...(place.machine ? ["--machine", place.machine] : [])];
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

/** `session list`, as text: one session. */
export function formatSession(i: SessionInfo, now = Date.now()): string {
  const on = i.place.machine ? `on ${i.place.machine}` : i.place.socket ? `on ${i.place.socket}` : `on ${i.outline.host}`;
  const lines = [`${i.place.outline} ${on} · session ${i.pid} · up ${ago(i.started, now)} · on the ${i.screen ?? "logon"}${i.code.commit ? ` · code ${i.code.commit.slice(0, 9)}` : ""}`, `  ${i.dir}`];
  lines.push(i.clients.length ? `  ${i.clients.length} terminal${i.clients.length === 1 ? "" : "s"} attached:` : "  no terminal attached");
  for (const c of i.clients) lines.push(`    #${c.id} ${c.tty ?? `pid ${c.pid}`} ${c.cols}×${c.rows} ${c.video}${c.active ? " · has the keys" : ""}${c.watch ? " · watching" : ""}${c.away ? ` · running ${c.away}` : ""} · idle ${ago(now - c.idle, now)}`);
  lines.push(i.terminals.length ? `  ${i.terminals.length} program${i.terminals.length === 1 ? "" : "s"} running${i.host ? ` in its terminal host (pid ${i.host})` : ""}: ${i.terminals.map(t => `${t.tile} (${t.cmd}${t.pid ? `, pid ${t.pid}` : ""})`).join(", ")}` : "  no programs running in its tiles");
  if (i.kept?.length) lines.push(`  ${i.kept.length} kept without a tile yet (a screen not opened since a handoff): ${i.kept.map(k => `${k.cmd}${k.pid ? ` (pid ${k.pid})` : ""}`).join(", ")}`);
  return lines.join("\n");
}

/** `session list`, as text: every session, and the terminal hosts whose daemon stopped. */
export function formatSessions(running: readonly Running[], waiting: readonly string[], now = Date.now()): string {
  const out = running.map(r => formatSession(r.info, now));
  for (const d of waiting) {
    // Its place.json names the outline (a hashed folder's too).
    const p = readPlace(d);
    const run = p ? `\`${ep0ch(process.env, p)}${sessionFlags({ place: p })}\` restores it, \`${ep0ch(process.env, p)}session end ${sessionFlags({ place: p })}\` ends its programs` : `its outline is unknown (no place.json)`;
    out.push(`${p ? placeLabel(p) : d}: its terminal host still runs the programs of a session whose daemon stopped · ${run}`);
  }
  return out.length ? out.join("\n\n") : `no session runs on ${stateDir()} · \`${ep0ch().trim()}\` starts one`;
}

/** `ep0ch session …`. */
export async function sessionCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;
  if (cmd === "serve") return serve(rest);
  if (cmd === "pty-host") return servePtyHost(rest[0] ?? "");
  const flag = (f: string) => { const i = rest.indexOf(f); if (i >= 0) rest.splice(i, 1); return i >= 0; };
  const all = flag("--all");
  if (cmd === "list" || cmd === undefined) {
    const running = await runningSessions();
    if (rest.includes("--json")) { console.log(JSON.stringify(running.map(r => r.info))); return 0; }
    console.log(formatSessions(running, await waitingHosts()));
    return 0;
  }
  if (cmd === "upgrade" || cmd === "restart") {
    const o = { clients: flag("--clients"), handoff: cmd === "restart" };
    if (all) {
      const rs = await upgradeAll(o);
      if (!rs.length) { console.log(`ep0ch: no session runs on ${stateDir()}`); return 0; }
      for (const r of rs) (r.ok ? console.log : console.error)(`ep0ch: ${r.message}`);
      return rs.every(r => r.ok) ? 0 : 1;
    }
    const place = await pickSession(rest, cmd);
    if ("error" in place) { console.error(`ep0ch: ${place.error}`); return 1; }
    const r = await upgradeSession(place, o);
    (r.ok ? console.log : console.error)(`ep0ch: ${r.message}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === "attach") {
    // --wait <s>: a terminal attaching again after a handoff waits for the new daemon to serve; --or-start: with none
    // by then, one is started (it restores the session), as `ep0ch` starts one.
    const at = rest.indexOf("--wait"), wait = at >= 0 ? Number(rest[at + 1]) || 30 : 0;
    if (at >= 0) rest.splice(at, 2);
    const orStart = flag("--or-start"), watch = flag("--watch");
    // Nothing named and waiting (a terminal attaching again after a handoff): the only session, once its successor serves.
    let place = await pickSession(rest, "attach");
    for (const until = Date.now() + wait * 1000; "error" in place && wait && placeFor(rest) === null && Date.now() < until;) { await Bun.sleep(250); place = await pickSession(rest, "attach"); }
    if ("error" in place) { console.error(`ep0ch: ${place.error}`); return 1; }
    // A machine's forward is started here, in the person's terminal, where ssh has their agent.
    if (place.machine) await forwardTo(place.machine).catch(e => console.error(`ep0ch: can't reach the outline host on ${place.machine}: ${(e as Error).message}`));
    const path = sessionSocket(place.dir);
    if (!(await (wait ? waitFor(path, wait * 1000) : listening(path)))) {
      if (orStart && !watch) return attachDoor(pinned(rest, place));
      console.error(`ep0ch: no session runs for ${placeLabel(place)} · \`${ep0ch(process.env, place)}${sessionFlags({ place })}\` starts one`);
      return 1;
    }
    return attach(path, { args: pinned(rest, place), watch });
  }
  if (cmd === "end") {
    const force = flag("--yes") || flag("-y");
    if (all) {
      // Every session, and every terminal host left running by a session whose daemon stopped.
      const running = await runningSessions(), waiting = (await waitingHosts()).map(d => readPlace(d) ?? { outline: d, dir: d });
      const n = running.length + waiting.length;
      if (!n) { console.log(`ep0ch: no session runs on ${stateDir()}`); return 0; }
      const names = [...running.map(r => placeLabel(r.info.place)), ...waiting.map(p => `${placeLabel(p)}'s terminal host`)].join(", ");
      if (!force) {
        if (!process.stdin.isTTY) { console.error(`ep0ch: ${n} session${n === 1 ? "" : "s"} run (${names}) · \`${ep0ch()}session end --all --yes\` ends them all`); return 1; }
        if (!(await confirm(`End ${n} session${n === 1 ? "" : "s"} (${names})? [y/N] `))) { console.error("ep0ch: they go on"); return 1; }
      }
      let code = 0;
      for (const r of running) if (!(await endSession(sessionSocket(r.dir), `${placeLabel(r.info.place)}'s session`, true, ""))) code = 1;
      for (const p of waiting) if ((await endHost(p, true)) !== 0) code = 1;
      return code;
    }
    const place = await pickSession(rest, "end");
    if ("error" in place) { console.error(`ep0ch: ${place.error}`); return 1; }
    const path = sessionSocket(place.dir);
    if (!(await listening(path))) return endHost(place, force);
    return (await endSession(path, `${placeLabel(place)}'s session`, force, `${ep0ch(process.env, place)}session end ${sessionFlags({ place })} --yes`)) ? 0 : 1;
  }
  console.error(`ep0ch: session ${cmd}? try: ep0ch session list | attach [--watch] [--ws <name>] | end [--yes] [--all] | upgrade [--clients] [--all] | restart`);
  return 2;
}

/**
 * End the session on `path`, asking (unless `force`) when it says programs run or text isn't saved. Whether it ended.
 * `anyway`: the command that ends it without asking, said when it can't ask.
 */
async function endSession(path: string, what: string, force: boolean, anyway: string): Promise<boolean> {
  for (;;) {
    const r = await endOnce(path, force);
    if (r.t === "ask") {
      if (force || !process.stdin.isTTY) { console.error(`ep0ch: ${what}: ${r.message}${anyway ? ` · \`${anyway}\` ends it anyway` : ""}`); return false; }
      if (!(await confirm(`${what}: ${r.message}. End it anyway? [y/N] `))) { console.error("ep0ch: the session goes on"); return false; }
      force = true;
      continue;
    }
    console.log(`ep0ch: ${what} ended`);
    return true;
  }
}

/** No daemon, but the programs of a session whose daemon stopped still run in its terminal host: they end too. */
async function endHost(place: Place, force: boolean): Promise<number> {
  const flags = sessionFlags({ place });
  if (!(await listening(ptyHostSocket(place.dir)))) { console.error(`ep0ch: no session runs for ${placeLabel(place)} · \`${ep0ch(process.env, place)}session list\` says what runs`); return 1; }
  const host = await HostPtys.connect(ptyHostSocket(place.dir)).catch(() => null);
  const n = host?.unadopted().length ?? 0;
  const ask = `no session runs for ${placeLabel(place)}, but its terminal host still runs ${n} program${n === 1 ? "" : "s"} (${host?.unadopted().map(p => (p.meta.cmd ?? p.argv).join(" ")).join(", ")})`;
  if (n && !force) {
    if (!process.stdin.isTTY) { console.error(`ep0ch: ${ask} · \`${ep0ch(process.env, place)}session end ${flags} --yes\` ends ${n === 1 ? "it" : "them"}`); host?.release(); return 1; }
    if (!(await confirm(`${ask}. End ${n === 1 ? "it" : "them"}? [y/N] `))) { host?.release(); console.error("ep0ch: left running"); return 1; }
  }
  host?.endAll();
  forgetSession(place.dir);
  console.log(`ep0ch: ${placeLabel(place)}'s terminal host ended${n ? `, with its ${n} program${n === 1 ? "" : "s"}` : ""}`);
  return 0;
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
      // What the session reported on this terminal (OSC 7501) goes with it: the door isn't running here any more.
      if (term.info.pst) { try { term.write(encodeProgramStatus({ state: "clear" })); } catch { /* the terminal is gone */ } }
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
    ...(process.env.TERN_PANE ? { clientHost: { kind: "tern", pane: process.env.TERN_PANE } } : {}),
    args: o.args ?? [], ...(o.watch ? { watch: true } : {}),
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
 * A session onto the code in its checkout (`ep0ch session upgrade`, `ep0ch install --apply`). A daemon on other
 * code hands over to a new one: the programs in its tiles keep running in the terminal host, the screens and edits
 * come back, every terminal attaches again. One on this code already (or `clients`) only has its terminals start again;
 * `handoff` hands over whatever code it runs (`ep0ch session restart`). What happened, said; `ok` false when it failed.
 */
/** A session handed to a new daemon, as data (install's table): pids and commits before and after. */
export interface Handover { name: string; pid: [number, number | null]; code: [string | null, string | null]; programs: number; terminals: number }
export interface UpgradeResult { ok: boolean; message: string; handover?: Handover }

export async function upgradeSession(place: Place, o: { clients?: boolean; handoff?: boolean } = {}): Promise<UpgradeResult> {
  const path = sessionSocket(place.dir), name = placeLabel(place);
  const before = await sessionInfo(path);
  if (!before) return { ok: false, message: `no session runs for ${name} · \`${ep0ch(process.env, place)}${sessionFlags({ place })}\` starts one` };
  const here = codeVersion();
  if (o.clients || (!o.handoff && before.code.commit && before.code.commit === here.commit)) {
    await askSession(path, { t: "reload" });
    const n = before.clients.length;
    return { ok: true, message: `${name}: the session (pid ${before.pid}) runs ${before.code.commit?.slice(0, 9) ?? "this code"} already · its ${n} terminal${n === 1 ? "" : "s"} start${n === 1 ? "s" : ""} again on this checkout${o.clients ? "" : ` (\`${ep0ch(process.env, place)}session restart ${sessionFlags({ place })}\` hands it over anyway, for changes not committed yet)`}` };
  }
  const r = await askSession(path, { t: "upgrade" }, 60_000);
  if (r?.t !== "ask" || r.message !== "handed over") return { ok: false, message: `${name}: ${r?.t === "ask" ? r.message : "the session didn't answer the handoff"}` };
  const after = await sessionInfo(path);
  const progs = before.terminals.length, n = before.clients.length;
  const handover: Handover = { name, pid: [before.pid, after?.pid ?? null], code: [before.code.commit ?? null, after?.code.commit ?? null], programs: progs, terminals: n };
  return { ok: true, message: handoverMessage(handover), handover };
}

/** A handover as one sentence (`session upgrade`, install's --json); install's terminal shows it as a table row. */
export function handoverMessage(h: Handover): string {
  return `${h.name}: the session was handed over: pid ${h.pid[0]} → ${h.pid[1] ?? "?"}, code ${h.code[0]?.slice(0, 9) ?? "?"} → ${h.code[1]?.slice(0, 9) ?? "?"} · ${h.programs} program${h.programs === 1 ? "" : "s"} kept running · ${h.terminals} terminal${h.terminals === 1 ? "" : "s"} attaching again`;
}

/**
 * Every session on this state dir onto the checkout's code (`session upgrade --all`, `ep0ch install`), one by one. One
 * already on this code is left as it is (its terminals aren't restarted) unless `clients` or `handoff` asks for that.
 */
export async function upgradeAll(o: { clients?: boolean; handoff?: boolean } = {}): Promise<UpgradeResult[]> {
  const out: UpgradeResult[] = [];
  const { commit: here, dir: checkout } = codeVersion();
  for (const r of await runningSessions()) {
    const place = { ...r.info.place, dir: r.dir };
    // Another checkout's session is that checkout's to upgrade (doctor says so).
    if (resolve(r.info.code.dir) !== resolve(checkout)) out.push({ ok: true, message: `${placeLabel(place)}: runs another checkout's door (${r.info.code.dir}), left as it is · run its \`ep0ch session upgrade ${sessionFlags({ place })}\`` });
    else if (!o.clients && !o.handoff && here && r.info.code.commit === here) out.push({ ok: true, message: `${placeLabel(place)}: runs this code already (${here.slice(0, 9)})` });
    else out.push(await upgradeSession(place, o));
  }
  return out;
}

/** This terminal's name (`/dev/pts/3`), for `session list`. */
function ttyName(): string | null {
  try { const r = Bun.spawnSync(["tty"], { stdin: "inherit", stdout: "pipe" }); return r.exitCode === 0 ? r.stdout.toString().trim() || null : null; } catch { return null; }
}
