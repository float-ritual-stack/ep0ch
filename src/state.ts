// Where the door keeps per-user state: the layouts, drafts, marks, last call, the default control socket,
// snapshots, ctrl+e edit files and the media cache. One root, `stateDir()`: EP0CH_STATE moves all of it.
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Read at call time so scripts (the snapshot harness) can point it elsewhere first.
export const stateDir = () => join(process.env.EP0CH_STATE ?? join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door"));

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

/** A folder of the state dir, private (0700). The state dir is tightened too: it holds drafts and the socket. */
export function stateSub(name: string): string | null {
  return privateDir(stateDir(), true) && privateDir(join(stateDir(), name), true);
}

export function readState<T>(name: string): T | null {
  try { return JSON.parse(readFileSync(join(stateDir(), name), "utf8")) as T; } catch { return null; }
}

/** Written whole or not at all: a temp file beside it, renamed over it (a crash mid-write never leaves half a layout). */
export function writeState(name: string, value: unknown): void {
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const path = join(stateDir(), name), tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    renameSync(tmp, path);
  } catch { /* not fatal */ }
}

/** Is process `pid` running? (EPERM: it is, as someone else.) */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Say this door uses the state dir (doors/<pid>, removed when it exits) and return the other doors that
 * do, so the second is warned: the desk layout is last-writer-wins between them (marks merge, LocalMarks).
 * A pid file whose door is gone (kill -9) is swept.
 */
export function claimState(): number[] {
  const dir = stateSub("doors");
  if (!dir) return [];
  // Claimed before looking: two doors starting at once each see the other (look first, and both may see none).
  const mine = join(dir, String(process.pid));
  try { writeFileSync(mine, "", { mode: 0o600 }); process.on("exit", () => rmSync(mine, { force: true })); } catch { /* not fatal */ }
  const others: number[] = [];
  for (const n of readdirSync(dir)) {
    const pid = Number(n);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (alive(pid)) others.push(pid);
    else rmSync(join(dir, n), { force: true });
  }
  return others;
}
