// Scratch folders for tests, shared by every package's tests (the door's test/scratch.ts re-exports them, the
// outliner's test/scratch-outline.ts uses them): a temp folder short enough for the sockets a test makes under it,
// under any TMPDIR (agent-env's is long), with no .ep0ch above it. PIE-1654.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Whether a process with this id runs (EPERM: it does, as another user's). */
export const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
};

/**
 * The pid namespace this process sees its ids in (Linux; "" elsewhere). A run in a container or sandbox that
 * shares /tmp has ids this one can't see: its live run must not look gone.
 */
const pidSpace = () => { try { return readlinkSync("/proc/self/ns/pid"); } catch { return ""; } };

/**
 * Where scratch dirs go: the temp folder, unless it can't hold one. Two things make it unfit, both met under
 * `scripts/agent-env` (TMPDIR=~/.agent-env/<name>/tmp):
 * - a path so long that a session's sockets under it pass the unix socket limit, so its place is hashed into
 *   `sessions/~/` instead of the folder the tests check;
 * - a `.ep0ch` above it (the person's `~/.ep0ch` names their real outline), which a folder that should name no
 *   outline would find walking up.
 * Then a short private folder of /tmp is used: `/tmp/ep0ch-<uid>` (mode 700, this user's).
 */
export function scratchRoot(base = tmpdir()): string {
  // The folder as it is on disk (a symlinked temp folder is checked where it really is), in bytes, as sockets count.
  const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const named = (dir: string): boolean => existsSync(join(dir, ".ep0ch")) || (dirname(dir) !== dir && named(dirname(dir)));
  const fits = (p: string) => Buffer.byteLength(p) <= SCRATCH_BASE_MAX && !named(real(p));
  if (fits(base) && fits(real(base))) return base;
  const uid = process.getuid?.() ?? 0, dir = `/tmp/ep0ch-${uid}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o077)) throw new Error(`${dir} isn't this user's alone (no access for others): scratch dirs can't go there`);
  if (named(dir)) throw new Error(`a .ep0ch above ${dir} names an outline: scratch dirs can't go under it`);
  return dir;
}
/**
 * The longest temp folder (bytes) a scratch dir goes in: the deepest socket the tests make under it,
 * `<base>/ep0ch-scratch-XXXXXX/door/sessions/socket-<10 hex>/scratch/door-<7 digits>.sock`, is 79 bytes past it, so
 * it stays within 103 (the door's src/session/place.ts SOCKET_MAX).
 */
const SCRATCH_BASE_MAX = 24;

/**
 * A temp dir for a scratch service, named `prefix…`, with the id of the test process that owns it (and the pid
 * namespace that id is in) in its `pid` file. The dirs a killed run left (their `pid` names a process that's
 * gone) are removed first: only this prefix's, only this user's, only ones written from this pid namespace,
 * never one whose process runs or that has no `pid` file.
 */
export function scratchDir(prefix: string): string {
  return ownedDir(scratchRoot(), prefix, "pid");
}

/**
 * A temp dir in the temp folder itself (`$TMPDIR`), owned as `scratchDir`'s are, its owner in `.owner`: a test preload's
 * folder (the door's state dir, the fake ssh's owner file). `bun test` (1.4) never fires `exit`, and a preload's
 * `afterAll` runs before the last repetition's tests under --rerun-each, so neither can remove it: the next run does,
 * once this process is gone (PIE-1742: every test process had left two in /tmp, 445,000 by Nov 11).
 */
export function ownedTempDir(prefix: string): string {
  return ownedDir(tmpdir(), prefix, ".owner");
}

/** `prefix…` in `base`, its owner written in `marker`; the dirs of that prefix whose owner is gone are removed first. */
function ownedDir(base: string, prefix: string, marker: string): string {
  const uid = process.getuid?.(), space = pidSpace();
  for (const name of readdirSync(base)) {
    if (!name.startsWith(prefix)) continue;
    const dir = join(base, name);
    try {
      const st = lstatSync(dir);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
      const [id, ns = ""] = readFileSync(join(dir, marker), "utf8").trim().split("\n");
      const pid = Number(id);
      if (ns === space && Number.isInteger(pid) && pid > 0 && pid !== process.pid && !alive(pid)) rmSync(dir, { recursive: true, force: true });
    } catch { /* no owner file, or gone already: left alone */ }
  }
  const dir = mkdtempSync(join(base, prefix));
  writeFileSync(join(dir, marker), `${process.pid}\n${space}`);
  return dir;
}
