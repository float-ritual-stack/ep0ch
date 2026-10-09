// Which outline `ep0ch` opens, and on which host (PIE-530). The rule is outline-core's `whichOutline`, the same one
// the outliner's Herdr panes, CLI and Claude mod apply: `--ws <name>` from anywhere, then EP0CH_WS, then the nearest
// `.ep0ch` walking up from the folder. Nothing else names an outline: a folder that names none gets the home base
// (src/home.ts), never a guess and never a default. The host is this machine's (its socket under
// the outlines folder, EP0CH_OUTLINES or ~/outlines); another machine's, through its forward, when one is named
// (`--machine <ssh-name>`, EP0CH_MACHINE, the `.ep0ch`'s `machine`: src/machine.ts); or EP0CH_SOCKET, the low-level
// way to name any host's socket.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { type LocationReader, outlineLayout, outlinesFolder, whichOutline } from "@ep0ch/outline-core/outline-location";
import { forwardPaths } from "@ep0ch/outline-core/machine";
import type { OutlineAbout } from "@ep0ch/outline-core/protocol";
import { hostRequest, type HostStatus } from "./socket";

export { slugifyOutlineName as slugOutlineName } from "@ep0ch/outline-core/outline-location";

type Env = Record<string, string | undefined>;

const homeOf = (env: Env) => resolve(env.HOME?.trim() || homedir());

/** The outlines folder: EP0CH_OUTLINES, else ~/outlines. */
export const outlinesDir = (env: Env = process.env) => outlinesFolder({ EP0CH_OUTLINES: env.EP0CH_OUTLINES }, homeOf(env));

/** This machine's outline host's socket (`<outlines>/.host/host.sock`). */
export const hostSocketOf = (env: Env = process.env) => outlineLayout(outlinesDir(env)).socket;

/** The disk, as the location rule reads it. */
export const disk: LocationReader = {
  readFile(path) {
    try { return readFileSync(path, "utf8"); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      throw e;
    }
  },
  exists: existsSync,
};

/**
 * What the host at `path` says about itself, or null when nothing answers there or it isn't a host. It asks
 * `outlines.list`, which only a host answers.
 */
export async function hostLive(path: string, timeoutMs = 1500): Promise<(HostStatus & { abouts?: Record<string, OutlineAbout> }) | null> {
  if (!existsSync(path)) return null;
  try {
    const list = await hostRequest<{ defaultOutline?: string; outlines: { name: string; about?: OutlineAbout }[] }>(path, "outlines.list", {}, timeoutMs);
    const abouts = Object.fromEntries(list.outlines.flatMap(o => o.about ? [[o.name, o.about]] : []));
    return { socket: path, ...(list.defaultOutline ? { defaultOutline: list.defaultOutline } : {}), outlines: list.outlines.map(o => o.name), ...(Object.keys(abouts).length ? { abouts } : {}) };
  } catch { return null; }
}

/**
 * Where the door connects, and which outline it names there. `attach`: the door opens a session, so it asks the
 * host for the outline (like `herdr --session <name>`): a name someone wrote down (`--ws`, EP0CH_WS, a `.ep0ch`) is
 * made when nobody has yet on this machine, and `created` says so on screen; on another machine only with
 * `--create` (mayCreate in src/outlines.ts, PIE-545). `unnamed`: nothing names one here; the
 * door opens the home base. `machine`: the host is that machine's, `path` the local end of its forward (started as
 * the door connects). `remote`: the host isn't this machine's (a machine's, or a socket named outright).
 */
export type Target =
  | { path: string; why: string; outline: string; attach: true; remote: boolean; machine?: string }
  | { path: string; unnamed: string; folder: string; guess?: { name: string; folder: string }; remote: boolean; machine?: string }
  | { error: string };

/** A flag's value: absent, the value, or why it's missing. */
function flagValue(args: readonly string[], flag: string, what: string): string | undefined | { error: string } {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const v = args[at + 1];
  return !v || v.startsWith("--") ? { error: `${flag} needs ${what}` } : v;
}

/**
 * The target: the host (EP0CH_SOCKET, else the named machine's forward, else this machine's),
 * and the outline by the rule (`--ws`, EP0CH_WS, the nearest `.ep0ch` from `cwd`; the machine by `--machine`,
 * EP0CH_MACHINE, that `.ep0ch`). Reads only; asks nothing of the host and starts no forward.
 */
export function resolveTarget(args: readonly string[], env: Env = process.env, cwd = process.cwd()): Target {
  const ws = flagValue(args, "--ws", "an outline name (ep0ch outline list)");
  if (typeof ws === "object") return ws;
  if (ws?.includes("/")) return { error: `--ws takes an outline's name, not a folder (${ws}); a folder names its outline in its .ep0ch (ep0ch init there)` };
  // A socket path as an argument named a host once; EP0CH_SOCKET does now. Refused, never read as "this machine's".
  const path0 = args.find((a, i) => a.includes("/") && !a.startsWith("--") && !["--ws", "--layout", "--machine"].includes(args[i - 1] ?? "") && args[i - 2] !== "--screen" && args[i - 1] !== "--screen");
  if (path0) return { error: `${path0}: a host's socket is named by EP0CH_SOCKET=${path0} (or the machine it is on by --machine <ssh-name>), not as an argument` };
  const machineFlag = flagValue(args, "--machine", "a machine: an ssh config name (a Host in ~/.ssh/config)");
  if (typeof machineFlag === "object") return machineFlag;
  const explicit = env.EP0CH_SOCKET?.trim();
  if (explicit && machineFlag) return { error: `--machine ${machineFlag} and EP0CH_SOCKET both name a host; leave one out` };
  let which;
  try { which = whichOutline({ flag: ws, env: env.EP0CH_WS, machineFlag, machineEnv: env.EP0CH_MACHINE, here: args.includes("--here"), folder: resolve(cwd), home: homeOf(env), fs: disk }); }
  catch (e) { return { error: (e as Error).message }; }
  // A socket named outright is the host, whatever machine a file or EP0CH_MACHINE names.
  const machine = explicit ? undefined : which.machine;
  const path = explicit || (machine ? forwardPaths(outlinesDir(env), machine).socket : hostSocketOf(env));
  const on = machine ? { machine } : {};
  const remote = !!explicit || !!machine;
  if (which.kind === "unnamed") {
    return { path, unnamed: which.reason, folder: which.folder, ...(which.guess ? { guess: which.guess } : {}), remote, ...on };
  }
  const how = which.source === "flag" ? `--ws ${which.name}` : which.source === "env" ? `EP0CH_WS=${which.name}` : which.file!;
  const where = machine ? ` on ${machine}${which.machineSource === "flag" ? "" : which.machineSource === "env" ? " (EP0CH_MACHINE)" : ""}` : explicit ? ` on ${path}` : "";
  return { path, outline: which.name, attach: true, remote, ...on, why: `the outline ${which.name} (${how})${where}` };
}
