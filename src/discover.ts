// Which outline service `ep0ch` talks to when none is named: EP0CH_SOCKET, else the service of the workspace
// the current directory is in (the nearest ancestor with a live service, hashed as `--ws` hashes it), else the
// only live service. Several live services and none of them the current directory's: ask for --ws.
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SocketBoard } from "./socket";

export const stateBase = () => process.env.OUTLINER_STATE_DIR ?? join(homedir(), ".local/state/pi-herdr-outliner");
/** A workspace root's service socket: state/<sha256(root)[0:12]>/outliner.sock, as the outliner keeps it. */
export const socketOf = (root: string, base = stateBase()) =>
  join(base, createHash("sha256").update(resolve(root.replace(/^~/, homedir()))).digest("hex").slice(0, 12), "outliner.sock");

/** The candidates in order: the current directory and its ancestors first, then every other socket. */
export function candidates(cwd: string, base = stateBase()): { path: string; nearest: boolean }[] {
  const out: { path: string; nearest: boolean }[] = [];
  const seen = new Set<string>();
  for (let d = resolve(cwd); ; d = dirname(d)) {
    const p = socketOf(d, base);
    if (existsSync(p) && !seen.has(p)) { seen.add(p); out.push({ path: p, nearest: true }); }
    if (dirname(d) === d) break;
  }
  if (existsSync(base)) {
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const p = join(base, e.name, "outliner.sock");
      if (e.isDirectory() && existsSync(p) && !seen.has(p)) { seen.add(p); out.push({ path: p, nearest: false }); }
    }
  }
  return out;
}

async function live(path: string): Promise<{ workspace: string } | null> {
  const b = new SocketBoard(path, 1500);
  try { const i: any = await b.info(); return { workspace: String(i?.workspace ?? "?") }; }
  catch { return null; }
  finally { b.close(); }
}

export type Discovery = { path: string; why: string } | { error: string };

/** The socket to use, and why; or why none could be chosen. */
export async function discoverSocket(cwd = process.cwd(), base = stateBase()): Promise<Discovery> {
  if (process.env.EP0CH_SOCKET) return { path: process.env.EP0CH_SOCKET, why: "EP0CH_SOCKET" };
  const all = candidates(cwd, base);
  for (const c of all.filter(c => c.nearest)) {
    const l = await live(c.path);
    if (l) return { path: c.path, why: `the workspace ${l.workspace}, which this directory is in` };
  }
  const others = (await Promise.all(all.filter(c => !c.nearest).map(async c => ({ c, l: await live(c.path) })))).filter(x => x.l);
  if (others.length === 1) return { path: others[0]!.c.path, why: `the only running outline, ${others[0]!.l!.workspace}` };
  if (!others.length) return { error: `no outline service is running (looked in ${base}); start one, or pass --ws <workspace root> or a socket path` };
  return { error: `several outlines are running; pick one with --ws:\n${others.map(x => `  ep0ch --ws ${x.l!.workspace}`).join("\n")}` };
}
