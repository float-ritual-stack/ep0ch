// Where an outline's door lives (PIE-418 with PIE-530): one session per outline, like `herdr --session <name>`. Each
// outline the door opens has its own folder in the state dir, named by where the outline is and its name:
//
//   <state>/sessions/local/<name>/          an outline on this machine's host
//   <state>/sessions/<ssh-name>/<name>/     one on another machine (--machine, EP0CH_MACHINE, a .ep0ch's machine)
//   <state>/sessions/socket-<hash>/<name>/  one on a host named outright (EP0CH_SOCKET)
//   <state>/sessions/~/<hash>/              any of these whose socket paths would be too long for a unix socket
//
// It holds the outline's session (session.sock, session.json naming the outline, session.lock, session.log), its
// terminal host (pty.sock, pty-host.log) and checkpoint (session-state.json), its control socket (door.sock), and the
// state that is the outline's rather than the person's (src/state.ts, `outlineState()`). This is the one rule for where
// a session lives: the client that starts or attaches, the daemon, its terminal host, `session list` and the home base
// all ask it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostSocketOf, resolveTarget } from "../discover";
import { listening } from "../jsonl";
import { homeState, stateDir } from "../state";
import type { SessionInfo } from "./protocol";

type Env = Record<string, string | undefined>;

/** Which outline, and where it is: on this machine's host, a machine's (by its ssh name), or a host's socket named outright. */
export interface OutlineKey { outline: string; machine?: string; socket?: string }
export interface Place extends OutlineKey { dir: string }

/**
 * Unix sockets fail past 104 bytes on macOS (108 on Linux). The longest socket a place holds is a door's own control
 * socket, `door-<pid>.sock` (src/control.ts; a pid is at most 7 digits on Linux, fewer on macOS).
 */
export const SOCKET_MAX = 103;
const LONGEST = "door-0000000.sock";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);
const safe = (s: string) => s.replace(/[^\w.-]/g, "_");

/** The folder an outline's session and state live in. */
export function placeOf(k: OutlineKey, root = stateDir(), env: Env = process.env): Place {
  const where = k.machine ? (k.machine === "local" ? "machine-local" : safe(k.machine))
    : !k.socket || resolve(k.socket) === resolve(hostSocketOf(env)) ? "local" : `socket-${hash(resolve(k.socket))}`;
  let dir = join(root, "sessions", where, safe(k.outline));
  if (Buffer.byteLength(join(dir, LONGEST)) > SOCKET_MAX) dir = join(root, "sessions", "~", hash(`${where}\0${k.outline}`));
  return { outline: k.outline, ...(k.machine ? { machine: k.machine } : !k.socket || where === "local" ? {} : { socket: resolve(k.socket) }), dir };
}

/**
 * The place the door's arguments name (`--ws`, EP0CH_WS, the folder's .ep0ch; `--machine`, EP0CH_MACHINE; EP0CH_SOCKET),
 * by resolveTarget's rule; null when nothing names an outline here.
 */
export function placeFor(args: readonly string[], env: Env = process.env, cwd = process.cwd()): Place | null | { error: string } {
  const t = resolveTarget(args, env, cwd);
  if ("error" in t) return { error: t.error };
  if ("unnamed" in t) return null;
  return placeOf({ outline: t.outline, ...(t.machine ? { machine: t.machine } : { socket: t.path }) }, stateDir(), env);
}

export const sessionSocket = (dir: string) => join(dir, "session.sock");
export const sessionFile = (dir: string) => join(dir, "session.json");
export const sessionLock = (dir: string) => join(dir, "session.lock");
export const sessionLog = (dir: string) => join(dir, "session.log");
/** What a place is, kept in its folder for good (session.json goes with its session): a hashed folder still names its outline. */
export const placeFile = (dir: string) => join(dir, "place.json");

/** Write `place.json` into its folder (the daemon does, as it starts). */
export function recordPlace(p: Place): void {
  try { writeFileSync(placeFile(p.dir), JSON.stringify({ outline: p.outline, ...(p.machine ? { machine: p.machine } : {}), ...(p.socket ? { socket: p.socket } : {}) }), { mode: 0o600 }); } catch { /* not fatal */ }
}

/** The place a folder of the state dir is, from its place.json; null for one no session has started in. */
export function readPlace(dir: string): Place | null {
  try {
    const k = JSON.parse(readFileSync(placeFile(dir), "utf8")) as OutlineKey;
    return typeof k?.outline === "string" ? { outline: k.outline, ...(k.machine ? { machine: k.machine } : {}), ...(k.socket ? { socket: k.socket } : {}), dir } : null;
  } catch { return null; }
}

/** Every outline folder in the state dir (whether a session runs there or not). */
export function placeDirs(root = stateDir()): string[] {
  const top = join(root, "sessions");
  const dirs = (d: string) => { try { return readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(d, e.name)); } catch { return []; } };
  return dirs(top).flatMap(dirs).sort();
}

/** A session as `ep0ch session list` and the home base show it: its folder, and what it says of itself. */
export interface Running { dir: string; info: SessionInfo }

/** The session on `path`, or null. (One request on its socket, without attaching.) */
export async function sessionInfo(path: string): Promise<SessionInfo | null> {
  if (!(await listening(path))) return null;
  const { askSession } = await import("./start");
  const r = await askSession(path, { t: "query" });
  return r?.t === "info" ? r.info : null;
}

/** Every session that runs on this state dir, outline by outline. */
export async function runningSessions(root = stateDir()): Promise<Running[]> {
  const found = await Promise.all(placeDirs(root).map(async dir => {
    const info = await sessionInfo(sessionSocket(dir)).catch(() => null);
    return info ? { dir, info } : null;
  }));
  return found.filter((r): r is Running => r !== null);
}

/** Folders whose terminal host still runs the programs of a session whose daemon stopped. */
export async function waitingHosts(root = stateDir()): Promise<string[]> {
  const dirs = await Promise.all(placeDirs(root).map(async d => (!(await listening(sessionSocket(d))) && (await listening(join(d, "pty.sock"))) ? d : null)));
  return dirs.filter((d): d is string => d !== null);
}

/**
 * How a command the person is told to run starts: `ep0ch `, or `EP0CH_STATE=<dir> ep0ch ` when this door's state isn't
 * the default, and `EP0CH_SOCKET=<socket> ` before it for a session on a host named outright (`place`), so what's
 * printed can be pasted as it is.
 */
export const ep0ch = (env: Env = process.env, place?: { socket?: string }) =>
  `${env.EP0CH_STATE ? `EP0CH_STATE=${env.EP0CH_STATE} ` : ""}${place?.socket ? `EP0CH_SOCKET=${place.socket} ` : ""}ep0ch `;

/** What names a session in a command, after `ep0ch(env, place)`: `--ws <name>` and its `--machine`, filled in so it can be pasted. */
export function sessionFlags(i: Pick<SessionInfo, "place">): string {
  return `--ws ${i.place.outline}${i.place.machine ? ` --machine ${i.place.machine}` : ""}`;
}

/** How a session's outline reads: `pie`, `pie on float-2`. */
export const placeLabel = (p: { outline: string; machine?: string }) => `${p.outline}${p.machine ? ` on ${p.machine}` : ""}`;

/**
 * The session a `session` command acts on: the outline its arguments or folder name (running or not), else, when
 * nothing names one, the only session running. Several running and none named: which to name, as commands.
 */
export async function pickSession(args: readonly string[], verb: string, env: Env = process.env, cwd = process.cwd()): Promise<Place | { error: string }> {
  const named = placeFor(args, env, cwd);
  if (named && "error" in named) return named;
  if (named) return named;
  const running = await runningSessions();
  if (running.length === 1) return { ...running[0]!.info.place, dir: running[0]!.dir };
  if (!running.length) return { error: `no session runs on ${stateDir()} · \`${ep0ch(env).trim()}\` starts one (where no outline is named, the home base asks which)` };
  return { error: `${running.length} sessions run and this folder names no outline · name one:\n${running.map(r => `  ${ep0ch(env, r.info.place)}session ${verb} ${sessionFlags(r.info)}`).join("\n")}` };
}

/**
 * The control socket `ep0ch peek|act|snap|open|actions|subscribe` reaches when EP0CH_CONTROL names none: the door on the
 * outline this folder names (EP0CH_WS, the .ep0ch), else the only door serving on this state dir (a session's or one
 * opened with --no-daemon). Several and none named: which to name, as commands.
 */
export async function controlFor(env: Env = process.env, cwd = process.cwd()): Promise<string | { error: string }> {
  const named = placeFor([], env, cwd);
  if (named && "error" in named) return named;
  if (named) {
    if (await listening(join(named.dir, "door.sock"))) return join(named.dir, "door.sock");
    return { error: `no door runs on ${placeLabel(named)} · \`${ep0ch(env, named)}${sessionFlags({ place: named })}\` starts one, \`${ep0ch(env)}session list\` says what runs` };
  }
  // Each outline's door, and the home base (on no outline yet: its socket is in its own folder, homeState()).
  const live = (await Promise.all([homeState(), ...placeDirs()].map(async d => ((await listening(join(d, "door.sock"))) ? d : null)))).filter((d): d is string => d !== null);
  if (live.length === 1) return join(live[0]!, "door.sock");
  if (!live.length) return { error: `no door runs on ${stateDir()} · \`${ep0ch(env).trim()}\` starts one` };
  const said = (d: string) => (d === homeState() ? "the home base" : ((p => (p ? placeLabel(p) : d))(readPlace(d))));
  return { error: `${live.length} doors run and this folder names no outline · name one with EP0CH_CONTROL:\n${live.map(d => `  EP0CH_CONTROL=${join(d, "door.sock")} ep0ch peek   # ${said(d)}`).join("\n")}` };
}
