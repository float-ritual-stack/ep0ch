// Which outline `ep0ch` opens, and on which host (PIE-530). The rule is outline-core's `whichOutline`, the same one
// the outliner's Herdr panes, CLI and Claude mod apply: `--ws <name>` from anywhere, then EP0CH_WS, then the nearest
// `.ep0ch` walking up from the folder. Nothing else names an outline: a folder that names none gets init, pick or
// import (src/outlines.ts), never a guess and never a default. The host is this machine's (its socket under the
// outlines folder, EP0CH_OUTLINES or ~/outlines), or EP0CH_SOCKET / a socket path argument for a host elsewhere.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { type LocationReader, outlineLayout, outlinesFolder, whichOutline } from "@ep0ch/outline-core/outline-location";
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
export async function hostLive(path: string, timeoutMs = 1500): Promise<HostStatus | null> {
  if (!existsSync(path)) return null;
  try {
    const list = await hostRequest<{ defaultOutline?: string; outlines: { name: string }[] }>(path, "outlines.list", {}, timeoutMs);
    return { socket: path, ...(list.defaultOutline ? { defaultOutline: list.defaultOutline } : {}), outlines: list.outlines.map(o => o.name) };
  } catch { return null; }
}

/**
 * Where the door connects, and which outline it names there. `attach`: the door opens a session, so it asks the
 * host for the outline with `create` (like `herdr --session <name>`): a name someone wrote down (`--ws`, EP0CH_WS,
 * a `.ep0ch`) is made when nobody has yet, and `created` says so on screen. `unnamed`: nothing names one here; the
 * door offers init (with `guess`), pick or import before it opens.
 */
export type Target =
  | { path: string; why: string; outline: string; attach: true; remote: boolean }
  | { path: string; unnamed: string; folder: string; guess?: { name: string; folder: string }; remote: boolean }
  | { error: string };

/** A socket path given as an argument: a value with a `/` that isn't a flag's value. */
const socketArgument = (args: readonly string[]) =>
  args.find((a, i) => a.includes("/") && !a.startsWith("--") && !["--board", "--ws", "--layout"].includes(args[i - 1] ?? ""));

/**
 * The target: the host (a socket argument, else EP0CH_SOCKET, else this machine's), and the outline by the rule
 * (`--ws`, EP0CH_WS, the nearest `.ep0ch` from `cwd`). Reads only; asks nothing of the host.
 */
export function resolveTarget(args: readonly string[], env: Env = process.env, cwd = process.cwd()): Target {
  const wsAt = args.indexOf("--ws");
  const ws = wsAt >= 0 ? args[wsAt + 1] : undefined;
  if (wsAt >= 0 && (!ws || ws.startsWith("--"))) return { error: "--ws needs an outline name (ep0ch outline list)" };
  if (ws?.includes("/")) return { error: `--ws takes an outline's name, not a folder (${ws}); a folder names its outline in its .ep0ch (ep0ch init there)` };
  const socketArg = socketArgument(args);
  const explicit = socketArg ?? env.EP0CH_SOCKET?.trim();
  const path = explicit || hostSocketOf(env);
  const remote = !!explicit;
  let which;
  try { which = whichOutline({ flag: ws, env: env.EP0CH_WS, folder: resolve(cwd), home: homeOf(env), fs: disk }); }
  catch (e) { return { error: (e as Error).message }; }
  if (which.kind === "unnamed") {
    return { path, unnamed: which.reason, folder: which.folder, ...(which.guess ? { guess: which.guess } : {}), remote };
  }
  const how = which.source === "flag" ? `--ws ${which.name}` : which.source === "env" ? `EP0CH_WS=${which.name}` : which.file!;
  return { path, outline: which.name, attach: true, remote, why: `the outline ${which.name} (${how})${remote ? ` on ${path}` : ""}` };
}
