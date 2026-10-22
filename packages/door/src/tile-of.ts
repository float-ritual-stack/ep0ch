// `host.tileOf` (PIE-1043): which of this door's terminal tiles a process is drawn in. A program in a tile finds its tile
// by its ancestors (`ep0ch where`); a Claude that came in over ssh (sshd → bash → claude, possibly on another machine)
// has none, but the ssh *client* in the tile owns the TCP connection whose client port sshd put in SSH_CONNECTION.
// Read-only; the process table and /proc/net/tcp are read here, on the door's machine, never by the asker.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { procAncestors } from "./where";

export interface TileProc { id: string; name: string; pid: number }
export interface TileOfDeps {
  /** A process's ancestors' pids, nearest first. */
  ancestors(pid: number): number[];
  /** The processes holding a TCP socket with this local port. */
  portOwners(port: number): number[];
}
export interface TileOfAnswer { tile: string | null; name: string | null; by: "pid" | "port" | null }

/** The tile whose program is, or is the ancestor of, the process `pid` (or the owner of local TCP port `port`); null when none. */
export function tileOf(tiles: readonly TileProc[], q: { pid?: number; port?: number }, deps: TileOfDeps): TileOfAnswer {
  const find = (pid: number) => tiles.find(t => t.pid === pid || deps.ancestors(pid).includes(t.pid));
  if (q.pid !== undefined) {
    const t = find(q.pid);
    if (t) return { tile: t.id, name: t.name, by: "pid" };
  }
  if (q.port !== undefined) {
    for (const owner of deps.portOwners(q.port)) {
      const t = find(owner);
      if (t) return { tile: t.id, name: t.name, by: "port" };
    }
  }
  return { tile: null, name: null, by: null };
}

/** Linux: /proc/net/tcp{,6} rows with this local port, then the processes holding their socket inodes. */
export function procPortOwners(port: number): number[] {
  const inodes = new Set<string>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let rows: string[];
    try { rows = readFileSync(file, "utf8").split("\n").slice(1); } catch { continue; }
    for (const row of rows) {
      const f = row.trim().split(/\s+/);
      const local = f[1]?.split(":")[1];
      if (local && parseInt(local, 16) === port && f[9] && f[9] !== "0") inodes.add(f[9]);
    }
  }
  if (!inodes.size) return [];
  const owners: number[] = [];
  let pids: string[] = [];
  try { pids = readdirSync("/proc").filter(n => /^\d+$/.test(n)); } catch { return []; }
  for (const p of pids) {
    try {
      for (const fd of readdirSync(`/proc/${p}/fd`)) {
        const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${p}/fd/${fd}`));
        if (m && inodes.has(m[1]!)) { owners.push(Number(p)); break; }
      }
    } catch { /* another user's process, or gone */ }
  }
  return owners;
}

export const realTileDeps = (): TileOfDeps => ({ ancestors: pid => procAncestors(pid), portOwners: procPortOwners });
