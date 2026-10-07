// Where the door keeps per-user state: the screens' layouts, drafts, marks, last call, the default control socket,
// snapshots, ctrl+e edit files and the media cache. One root, `stateDir()`: EP0CH_STATE moves all of it. (A screen saved
// by name is a screen note in the outline, PIE-565, not state here.)
//
// Two kinds of state live there. What's the person's whatever outline they're on is shared, in the state dir itself:
// the theme, the machines opened, drafts and ctrl+e files, the drawer, the summary keys, the daily scratch and the media
// cache. What belongs to one outline lives in that outline's own folder,
// `outlineState()` (sessions/<where>/<name>/, src/session/place.ts): its session's files, the screens' saved layouts
// (desk.json, river.json, delivery.json), the river's index, the last call, the marks (on its blocks), the doors on it
// and its control socket.
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// Read at call time so scripts (the snapshot harness) can point it elsewhere first.
export const stateDir = () => join(process.env.EP0CH_STATE ?? defaultStateDir());
/** The person's own state dir, where a door without EP0CH_STATE keeps everything: $XDG_STATE_HOME/ep0ch-door. */
export const defaultStateDir = (env: Record<string, string | undefined> = process.env) => join(env.XDG_STATE_HOME ?? join(env.HOME!, ".local/state"), "ep0ch-door");

/**
 * Cached media (converted images). Under the state dir when EP0CH_STATE names one, so a test door writes
 * nothing outside it; otherwise the user's cache ($XDG_CACHE_HOME/ep0ch-door).
 */
export const cacheDir = () => process.env.EP0CH_STATE ? join(process.env.EP0CH_STATE, "cache") : join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME!, ".cache"), "ep0ch-door");

/**
 * `dir`, made if missing, and only if it is this user's and nobody else's (no group or other bits): the
 * nvim tiles' sockets, the control socket and ctrl+e edit files live in one. A dir the door owns (`own`:
 * the state dir and its folders) that it finds too open is tightened to 0700; any other is refused (null).
 */
export function privateDir(dir: string, own = false): string | null {
  const uid = process.getuid?.();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let st = statSync(dir);
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) return null;
    if ((st.mode & 0o077) !== 0 && own) { chmodSync(dir, 0o700); st = statSync(dir); }
    return (st.mode & 0o077) === 0 ? dir : null;
  } catch { return null; }
}

/** `p` is `root` or inside it. */
export function isInside(root: string, p: string): boolean {
  const rel = relative(resolve(root), resolve(p));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/** A folder of the state dir, private (0700). The state dir is tightened too: it holds drafts and the socket. */
export function stateSub(name: string): string | null {
  return privateDir(stateDir(), true) && privateDir(join(stateDir(), name), true);
}

/**
 * The folder of the outline this door is on (src/session/place.ts names it), set once the door knows its outline
 * (openDoor, the session's daemon). The home base, on no outline yet, has `homeState()`.
 */
let outlineHome: string | null = null;
export function useOutlineState(dir: string | null): void { outlineHome = dir; }
/** Where the home base (a door on no outline yet, openDoor) keeps what an outline's door would: never the state dir itself. */
export const homeState = () => join(stateDir(), "home");
/** The folder set by useOutlineState; unset only in an App a test builds on a scratch board, which keeps it in the state dir. */
export const outlineState = () => outlineHome ?? stateDir();
/** Whether this door is on an outline (its folder set, and not the home base's). */
export const onOutline = () => outlineHome !== null && outlineHome !== homeState();

/** A shared file of the state dir, or with `dir` (outlineState()) the outline's own. */
export function readState<T>(name: string, dir = stateDir()): T | null {
  try { return JSON.parse(readFileSync(join(dir, name), "utf8")) as T; } catch { return null; }
}

/** Written whole or not at all: a temp file beside it, renamed over it (a crash mid-write never leaves half a layout). */
export function writeState(name: string, value: unknown, dir = stateDir()): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name), tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    renameSync(tmp, path);
  } catch { /* not fatal */ }
}

/** Is process `pid` running? (EPERM: it is, as someone else.) */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
  // A zombie (exited, not yet reaped by whoever started it: a session daemon after a handover) is gone. Linux says so in
  // /proc; elsewhere the signal is all there is.
  try { return !/^\d+ \(.*\) Z/s.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
}

/**
 * Say this door is on its outline (doors/<pid> in the outline's folder, removed when it exits) and return the other
 * doors that are, so the second is warned: the desk layout is last-writer-wins between them (marks merge, LocalMarks).
 * A pid file whose door is gone (kill -9) is swept.
 */
export function claimState(): number[] {
  const dir = privateDir(stateDir(), true) && privateDir(outlineState(), true) && privateDir(join(outlineState(), "doors"), true);
  if (!dir) return [];
  // Claimed before looking: two doors starting at once each see the other (look first, and both may see none).
  const mine = join(dir, String(process.pid));
  try { writeFileSync(mine, "", { mode: 0o600 }); process.on("exit", () => unclaimState()); } catch { /* not fatal */ }
  const others: number[] = [];
  for (const n of readdirSync(dir)) {
    const pid = Number(n);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (alive(pid)) others.push(pid);
    else rmSync(join(dir, n), { force: true });
  }
  return others;
}

/** When the person last called (logged on) on this outline: "new since your last call" reads it. */
export const readLastCall = () => Number(readState<{ at?: number }>("lastcall.json", outlineState())?.at) || 0;
export const writeLastCall = (at: number) => writeState("lastcall.json", { at }, outlineState());

/** This door leaves its outline (it exits, or a session's daemon hands over to the next): its claim goes. */
export function unclaimState(): void { rmSync(join(outlineState(), "doors", String(process.pid)), { force: true }); }
